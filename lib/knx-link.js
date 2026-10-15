'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const knx = require('knx');
const DPTLib = require('knx/src/dptlib');
const { parseGa } = require('./ga');

const ROUTING_ADDR = '224.0.23.12';
// A connection that is not up this long after an attempt (or a drop) is closed and retried.
const ATTEMPT_MS = 15000;
// Longest wait for the interface to confirm a disconnect.
const CLOSE_MS = 3500;
const LIVE_STATES = new Set(['idle', 'connected', 'sendDatagram', 'sendTunnReq_waitACK', 'recvTunnReqIndication', 'requestingConnState']);
const DPT9 = DPTLib.resolve('DPT9.001');

/**
 * Validate and normalise the connection settings saved by the settings page.
 * Returns { cfg } on success or { error } when the settings are unusable.
 */
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'No KNX connection configured' };
  const mode = raw.mode === 'routing' ? 'routing' : 'tunnel';
  let ip = String(raw.ip || '').trim();
  if (mode === 'routing' && !ip) ip = ROUTING_ADDR;
  if (!ip) return { error: 'No KNX/IP interface address configured' };
  if (!net.isIPv4(ip)) return { error: `"${ip}" is not a valid IPv4 address` };
  const port = Number(raw.port) || 3671;
  const physAddr = String(raw.physAddr || '15.15.250').trim();
  return { cfg: { mode, ip, port, physAddr } };
}

/**
 * Close a knx Connection for good and resolve once it is closed.
 *
 * The knx library retries on its own timers (60 s after the interface reports no free
 * tunnels, and with a backoff of up to 5 minutes after timeouts). Those timers would
 * revive a connection we have already replaced, holding a second tunnel slot, so every
 * route back to 'connecting' is blocked first. A live tunnel is closed with a
 * DISCONNECT_REQUEST so the interface frees the slot straight away.
 */
function retire(conn) {
  const transition = conn.transition.bind(conn);
  conn.transition = (state, ...args) => {
    if (state !== 'connecting' && state !== 'jumptoconnecting') transition(state, ...args);
  };
  conn.Connect = () => {};

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(conn.connecttimer);
      clearTimeout(conn.idletimer);
      clearTimeout(conn.connstatetimer);
      try {
        if (conn.socket) conn.socket.close();
      } catch (err) {
        // Already closed.
      }
      resolve();
    };
    const timer = setTimeout(finish, CLOSE_MS);

    if (LIVE_STATES.has(conn.state)) {
      try {
        conn.Disconnect(finish);
      } catch (err) {
        finish();
      }
    } else {
      clearInterval(conn.connecttimer);
      transition('uninitialized');
      finish();
    }
  });
}

/**
 * One shared KNX/IP connection for the whole app. Devices subscribe to group
 * addresses and write through it. Emits 'state' (state, detail) where state is
 * 'unconfigured' | 'disconnected' | 'connected' | 'error'.
 *
 * While it is not connected it retries every ATTEMPT_MS with a fresh connection, so
 * after a restart it reconnects as soon as the interface frees the old tunnel.
 */
class KnxLink extends EventEmitter {
  constructor(logger) {
    super();
    this.setMaxListeners(0);
    this.logger = logger || { log() {}, error() {} };
    this.state = 'unconfigured';
    this.detail = '';
    this._conn = null;
    this._gen = 0;
    this._retry = null;
    this._attempt = 0;
    this._subs = new Map();
    this.cfg = null;
  }

  _setState(state, detail = '') {
    if (state === this.state && detail === this.detail) return;
    this.state = state;
    this.detail = detail;
    this.emit('state', state, detail);
  }

  /** Apply new connection settings. Resolves once the previous connection is closed. */
  configure(raw) {
    this._teardown();
    const gen = this._gen;
    const closing = this._closeConn();
    this._attempt = 0;
    const { cfg, error } = normalise(raw);
    this.cfg = cfg || null;
    if (!cfg) {
      this._setState('unconfigured', error);
      return closing;
    }
    this._setState('disconnected', 'Connecting');
    // Wait for the old tunnel to close so an interface with one free slot can take the new one.
    return closing.then(() => {
      if (gen === this._gen) this._connect();
    });
  }

  _connect() {
    const gen = ++this._gen;
    this._attempt += 1;
    const { mode, ip, port, physAddr } = this.cfg;
    if (this._attempt > 1) {
      this._setState('disconnected', `No answer from ${ip}, retrying (attempt ${this._attempt}). After a restart the interface can hold the old tunnel for up to 2 minutes.`);
    }
    this._armRetry();
    try {
      const conn = new knx.Connection({
        ipAddr: ip,
        ipPort: port,
        physAddr,
        forceTunneling: mode === 'tunnel',
        loglevel: 'warn',
        handlers: {
          connected: () => {
            if (gen !== this._gen) return;
            clearTimeout(this._retry);
            this._attempt = 0;
            this.logger.log(`KNX connected (${mode} ${ip}:${port})`);
            this._setState('connected');
          },
          // The library also emits this at the start of every connect attempt.
          disconnected: () => {
            if (gen !== this._gen || this.state !== 'connected') return;
            this.logger.log('KNX connection lost, reconnecting');
            this._setState('disconnected', 'Connection lost, reconnecting');
            this._armRetry();
          },
          error: (err) => {
            if (gen !== this._gen) return;
            this.logger.error('KNX error:', err);
          },
        },
      });
      conn.on('event', (evt, src, dest, buf) => {
        if (gen === this._gen) this._dispatch(evt, src, dest, buf);
      });
      this._conn = conn;
    } catch (err) {
      const message = typeof err === 'string' ? err : (err && err.message) || String(err);
      this.logger.error('KNX connect failed:', message);
      this._setState('error', message);
    }
  }

  // Give the current attempt ATTEMPT_MS to come up, then replace it with a fresh one.
  _armRetry() {
    clearTimeout(this._retry);
    this._retry = setTimeout(() => {
      if (this.state === 'connected' || !this.cfg) return;
      if (this._attempt === 1 || this._attempt % 20 === 0) {
        this.logger.log(`KNX not connected after attempt ${this._attempt}, retrying every ${ATTEMPT_MS / 1000} s`);
      }
      const gen = this._gen;
      this._closeConn().then(() => {
        if (gen === this._gen) this._connect();
      });
    }, ATTEMPT_MS);
  }

  _closeConn() {
    const conn = this._conn;
    this._conn = null;
    return conn ? retire(conn) : Promise.resolve();
  }

  // Invalidate callbacks from the current connection and stop pending retries.
  _teardown() {
    this._gen += 1;
    clearTimeout(this._retry);
  }

  /** Close the connection cleanly so the interface frees the tunnel slot before the app stops. */
  destroy() {
    this._teardown();
    this.removeAllListeners();
    return this._closeConn();
  }

  _dispatch(evt, src, dest, buf) {
    const set = this._subs.get(dest);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(evt, buf, src);
      } catch (err) {
        this.logger.error('KNX subscriber failed:', err);
      }
    }
  }

  /** Listen to a group address. Returns a function that removes the listener. */
  subscribe(ga, cb) {
    const key = parseGa(ga);
    if (!key) throw new Error(`Invalid group address "${ga}"`);
    if (!this._subs.has(key)) this._subs.set(key, new Set());
    this._subs.get(key).add(cb);
    return () => {
      const set = this._subs.get(key);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) this._subs.delete(key);
    };
  }

  _ready() {
    if (this.state !== 'connected' || !this._conn) {
      throw new Error('Not connected to the KNX bus. Check the connection in the app settings.');
    }
    return this._conn;
  }

  /** Send a GroupValue_Read request. Failures are ignored. */
  read(ga) {
    try {
      this._ready().read(ga);
    } catch (err) {
      this.logger.error(`KNX read ${ga} failed:`, err.message || err);
    }
  }

  writeBool(ga, value) {
    this._ready().write(ga, value ? 1 : 0, 'DPT1.001');
  }

  writeTemp(ga, value) {
    this._ready().write(ga, Number(value), 'DPT9.001');
  }

  /** Write one raw byte (used for DPT 20.105, which the knx library does not implement). */
  writeByte(ga, value) {
    this._ready().writeRaw(ga, Buffer.from([value & 0xff]), 8);
  }
}

function decodeBool(buf) {
  if (!buf || buf.length < 1) return null;
  return (buf[0] & 0x01) === 1;
}

function decodeByte(buf) {
  if (!buf || buf.length !== 1) return null;
  return buf[0];
}

function decodeTemp(buf) {
  if (!buf || buf.length !== 2) return null;
  const value = DPTLib.fromBuffer(buf, DPT9);
  return Number.isFinite(value) ? value : null;
}

module.exports = { KnxLink, normalise, decodeBool, decodeByte, decodeTemp };
