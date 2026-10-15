'use strict';

const Homey = require('homey');
const { MODES, byId, byValue } = require('../../lib/hvac-modes');
const { parseGa } = require('../../lib/ga');
const { decodeBool, decodeByte, decodeTemp } = require('../../lib/knx-link');
const { AUTO, speedsFor, fanName, encodeFan, decodeFan } = require('../../lib/fan-speeds');

const GA_KEYS = [
  'ga_onoff_write', 'ga_onoff_status',
  'ga_mode_write', 'ga_mode_status',
  'ga_heatcool_write', 'ga_heatcool_status',
  'ga_fan_write', 'ga_fan_status',
  'ga_fanauto_write', 'ga_fanauto_status',
  'ga_setpoint_write', 'ga_setpoint_status',
  'ga_temp_status', 'ga_temp_write',
];

const RX_EVENTS = new Set(['GroupValue_Write', 'GroupValue_Response']);
const READ_GAP_MS = 150;

const round1 = (n) => Math.round(n * 10) / 10;
const validTemp = (n) => n !== null && n > -50 && n < 100;

module.exports = class ThermostatDevice extends Homey.Device {
  async onInit() {
    this._cfg = {};
    this._exposed = [];
    this._fan = { count: 3, dpt: 'enum', base: 1 };
    this._fanOptions = [];
    this._fanAuto = null;
    this._fanSpeed = null;
    this._unsubs = [];
    this._listening = new Set();
    this._readTimers = [];

    this._onLinkState = (state) => this._handleLinkState(state);
    this.link.on('state', this._onLinkState);

    await this._applyConfig(this.getSettings());
    this._handleLinkState(this.link.state);
  }

  get link() {
    return this.homey.app.link;
  }

  getExposedModes() {
    return this._exposed.map((id) => byId(id));
  }

  getFanOptions() {
    return this._fanOptions;
  }

  // ---------------------------------------------------------------- config

  async onSettings({ newSettings }) {
    for (const key of GA_KEYS) {
      const value = String(newSettings[key] || '').trim();
      if (value && !parseGa(value)) {
        throw new Error(`"${value}" is not a valid group address. Use the format 1/2/3 (main 0-31, middle 0-7, sub 0-255).`);
      }
    }
    if (!(Number(newSettings.temp_min) < Number(newSettings.temp_max))) {
      throw new Error('The minimum setpoint must be lower than the maximum.');
    }
    if (!(Number(newSettings.temp_step) > 0)) {
      throw new Error('The setpoint step must be greater than zero.');
    }
    const modes = this._computeExposed(newSettings);
    if (modes.hasModeObject && modes.exposed.length === 0) {
      throw new Error('Tick at least one mode to expose.');
    }
    if (modes.hasAnyModeObject && modes.exposed.length === 0) {
      throw new Error('Tick Heat and/or Cool to use the heat/cool object.');
    }
    await this._applyConfig(newSettings);
  }

  _computeExposed(settings) {
    const hasModeObject = Boolean(this._ga(settings, 'ga_mode_write') || this._ga(settings, 'ga_mode_status'));
    const hasHeatCool = Boolean(this._ga(settings, 'ga_heatcool_write') || this._ga(settings, 'ga_heatcool_status'));
    let exposed = [];
    if (hasModeObject) {
      exposed = MODES.filter((m) => settings[`mode_${m.id}`]).map((m) => m.id);
    } else if (hasHeatCool) {
      exposed = ['heat', 'cool'].filter((id) => settings[`mode_${id}`]);
    }
    return { hasModeObject, hasAnyModeObject: hasModeObject || hasHeatCool, exposed };
  }

  _ga(settings, key) {
    return parseGa(String(settings[key] || '')) || '';
  }

  async _applyConfig(settings) {
    this._teardownSubscriptions();

    const cfg = {};
    for (const key of GA_KEYS) cfg[key] = this._ga(settings, key);
    this._cfg = cfg;

    const { hasModeObject, hasAnyModeObject, exposed } = this._computeExposed(settings);
    this._exposed = exposed;

    this._fan = {
      count: Number(settings.fan_speeds) === 2 ? 2 : 3,
      dpt: settings.fan_dpt === 'percent' ? 'percent' : 'enum',
      base: Number(settings.fan_enum_base) === 0 ? 0 : 1,
    };
    const hasFanSpeed = Boolean(cfg.ga_fan_write || cfg.ga_fan_status);
    const hasFanAuto = Boolean(cfg.ga_fanauto_write || cfg.ga_fanauto_status);
    this._fanOptions = [
      ...(hasFanAuto ? [AUTO] : []),
      ...(hasFanSpeed ? speedsFor(this._fan.count) : []),
    ];
    this._fanAuto = null;
    this._fanSpeed = null;

    const wanted = {
      onoff: Boolean(cfg.ga_onoff_write || cfg.ga_onoff_status),
      hvac_mode: hasAnyModeObject && exposed.length > 0,
      fan_speed: this._fanOptions.length > 0,
      target_temperature: Boolean(cfg.ga_setpoint_write || cfg.ga_setpoint_status),
      measure_temperature: Boolean(cfg.ga_temp_status || cfg.ga_temp_write) || Boolean(settings.temp_from_flow),
    };
    for (const [capability, want] of Object.entries(wanted)) {
      if (want && !this.hasCapability(capability)) await this.addCapability(capability);
      if (!want && this.hasCapability(capability)) {
        await this.removeCapability(capability);
        this._listening.delete(capability);
      }
    }

    if (wanted.hvac_mode) {
      await this.setCapabilityOptions('hvac_mode', {
        values: exposed.map((id) => ({ id, title: { en: byId(id).name } })),
      });
      if (!exposed.includes(this.getCapabilityValue('hvac_mode'))) {
        await this.setCapabilityValue('hvac_mode', null);
      }
    }
    if (wanted.fan_speed) {
      await this.setCapabilityOptions('fan_speed', {
        values: this._fanOptions.map((s) => ({ id: s.id, title: { en: s.name } })),
      });
      if (!this._fanOptions.some((s) => s.id === this.getCapabilityValue('fan_speed'))) {
        await this.setCapabilityValue('fan_speed', null);
      }
    }
    if (wanted.target_temperature) {
      await this.setCapabilityOptions('target_temperature', {
        min: Number(settings.temp_min),
        max: Number(settings.temp_max),
        step: Number(settings.temp_step),
      });
    }

    this._registerListeners();
    this._subscribe(hasModeObject);

    if (Object.values(wanted).some(Boolean)) {
      await this.unsetWarning().catch(() => {});
    } else {
      await this.setWarning('Open the device settings and enter the KNX group addresses.').catch(() => {});
    }

    if (this.link.state === 'connected') this._readAll();
  }

  _registerListeners() {
    const listeners = {
      onoff: (value) => this._setOnOff(value),
      hvac_mode: (value) => this.setMode(value),
      fan_speed: (value) => this.setFanSpeed(value),
      target_temperature: (value) => this._setTarget(value),
    };
    for (const [capability, fn] of Object.entries(listeners)) {
      if (this.hasCapability(capability) && !this._listening.has(capability)) {
        this.registerCapabilityListener(capability, fn);
        this._listening.add(capability);
      }
    }
  }

  // ------------------------------------------------------------- receiving

  _subscribe(hasModeObject) {
    const cfg = this._cfg;
    const on = (gas, handler) => {
      for (const ga of new Set(gas.filter(Boolean))) {
        this._unsubs.push(this.link.subscribe(ga, (evt, buf) => {
          if (!RX_EVENTS.has(evt) || !buf) return;
          try {
            handler(buf);
          } catch (err) {
            this.error('Failed to handle KNX telegram:', err);
          }
        }));
      }
    };

    on([cfg.ga_onoff_write, cfg.ga_onoff_status], (buf) => {
      const value = decodeBool(buf);
      if (value !== null) this._setCap('onoff', value);
    });

    on([cfg.ga_setpoint_write, cfg.ga_setpoint_status], (buf) => {
      const value = decodeTemp(buf);
      if (validTemp(value)) this._setCap('target_temperature', round1(value));
    });

    on([cfg.ga_temp_status, cfg.ga_temp_write], (buf) => {
      const value = decodeTemp(buf);
      if (validTemp(value)) this._setCap('measure_temperature', round1(value));
    });

    on([cfg.ga_mode_write, cfg.ga_mode_status], (buf) => {
      const raw = decodeByte(buf);
      if (raw === null) return;
      const mode = byValue(raw);
      if (!mode) {
        this.log(`Ignoring unknown HVAC mode value ${raw}`);
      } else if (!this._exposed.includes(mode.id)) {
        this.log(`Ignoring HVAC mode "${mode.name}" because it is not enabled in the device settings`);
      } else {
        this._updateMode(mode.id);
      }
    });

    on([cfg.ga_fan_write, cfg.ga_fan_status], (buf) => {
      const raw = decodeByte(buf);
      const id = decodeFan(raw, this._fan);
      if (id) {
        this._fanSpeed = id;
        this._refreshFan();
      } else if (raw !== null) {
        this.log(`Ignoring fan speed value ${raw}`);
      }
    });

    on([cfg.ga_fanauto_write, cfg.ga_fanauto_status], (buf) => {
      const auto = decodeBool(buf);
      if (auto === null) return;
      this._fanAuto = auto;
      this._refreshFan();
    });

    // The binary heat/cool object only drives the mode when there is no 20.105 object.
    if (!hasModeObject) {
      on([cfg.ga_heatcool_write, cfg.ga_heatcool_status], (buf) => {
        const heat = decodeBool(buf);
        if (heat === null) return;
        const id = heat ? 'heat' : 'cool';
        if (this._exposed.includes(id)) this._updateMode(id);
      });
    }
  }

  _teardownSubscriptions() {
    for (const unsubscribe of this._unsubs) unsubscribe();
    this._unsubs = [];
    for (const timer of this._readTimers) clearTimeout(timer);
    this._readTimers = [];
  }

  _setCap(capability, value) {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    this.setCapabilityValue(capability, value).catch((err) => this.error(`Failed to set ${capability}:`, err));
  }

  async _updateMode(id) {
    if (!this.hasCapability('hvac_mode') || this.getCapabilityValue('hvac_mode') === id) return;
    try {
      await this.setCapabilityValue('hvac_mode', id);
      this.driver.triggerModeChanged(this, byId(id));
    } catch (err) {
      this.error('Failed to set hvac_mode:', err);
    }
  }

  // Auto status wins; otherwise show the last known fixed speed.
  _refreshFan() {
    const id = this._fanAuto ? AUTO.id : this._fanSpeed;
    if (id) this._updateFan(id);
  }

  async _updateFan(id) {
    if (!this.hasCapability('fan_speed') || this.getCapabilityValue('fan_speed') === id) return;
    try {
      await this.setCapabilityValue('fan_speed', id);
      this.driver.triggerFanChanged(this, { id, name: fanName(id) });
    } catch (err) {
      this.error('Failed to set fan_speed:', err);
    }
  }

  // --------------------------------------------------------------- sending

  async _setOnOff(value) {
    if (!this._cfg.ga_onoff_write) throw new Error('No on/off control address is set in the device settings.');
    this.link.writeBool(this._cfg.ga_onoff_write, value);
  }

  async _setTarget(value) {
    if (!this._cfg.ga_setpoint_write) throw new Error('No setpoint control address is set in the device settings.');
    this.link.writeTemp(this._cfg.ga_setpoint_write, value);
  }

  async setMode(id) {
    const mode = byId(id);
    if (!mode || !this._exposed.includes(id)) {
      throw new Error(`The mode "${mode ? mode.name : id}" is not enabled for this device.`);
    }
    const { ga_mode_write: modeGa, ga_heatcool_write: heatCoolGa } = this._cfg;
    const sendsHeatCool = Boolean(heatCoolGa) && (id === 'heat' || id === 'cool');
    if (!modeGa && !sendsHeatCool) {
      throw new Error(`No control address is set to send the mode "${mode.name}".`);
    }
    if (modeGa) this.link.writeByte(modeGa, mode.value);
    if (sendsHeatCool) this.link.writeBool(heatCoolGa, id === 'heat');
    await this._updateMode(id);
  }

  // Room temperature pushed from a flow, and sent on to KNX when a send address is set.
  // KNX telegrams keep updating it too; the latest value wins.
  async setRoomTemperature(value) {
    if (!this.hasCapability('measure_temperature')) {
      throw new Error('Tick "Room temperature is set by a flow" in the device settings first.');
    }
    const temp = Number(value);
    if (!validTemp(temp)) {
      this.log(`Ignoring room temperature ${value} from flow, outside -50 to 100 °C`);
      return;
    }
    this._setCap('measure_temperature', round1(temp));
    if (this._cfg.ga_temp_write) this.link.writeTemp(this._cfg.ga_temp_write, round1(temp));
  }

  async setFanSpeed(id) {
    if (!this._fanOptions.some((s) => s.id === id)) {
      throw new Error(`The fan speed "${fanName(id)}" is not available on this device.`);
    }
    const { ga_fan_write: fanGa, ga_fanauto_write: autoGa } = this._cfg;
    if (id === AUTO.id) {
      if (!autoGa) throw new Error('No fan auto control address is set in the device settings.');
      this.link.writeBool(autoGa, true);
      this._fanAuto = true;
    } else {
      if (!fanGa) throw new Error('No fan speed control address is set in the device settings.');
      if (autoGa) {
        this.link.writeBool(autoGa, false);
        this._fanAuto = false;
      }
      this.link.writeByte(fanGa, encodeFan(id, this._fan));
      this._fanSpeed = id;
    }
    await this._updateFan(id);
  }

  // ------------------------------------------------------- link and refresh

  _handleLinkState(state) {
    if (state === 'connected') {
      this.setAvailable().catch(() => {});
      this._readAll();
    } else if (state === 'unconfigured') {
      this.setUnavailable('Set the KNX connection in the app settings.').catch(() => {});
    } else {
      this.setUnavailable('Waiting for the KNX connection.').catch(() => {});
    }
  }

  // Ask the bus for the current state of every configured object, spaced out.
  _readAll() {
    for (const timer of this._readTimers) clearTimeout(timer);
    this._readTimers = [];
    const cfg = this._cfg;
    const targets = [
      cfg.ga_onoff_status || cfg.ga_onoff_write,
      cfg.ga_mode_status || cfg.ga_mode_write,
      cfg.ga_mode_write || cfg.ga_mode_status ? '' : cfg.ga_heatcool_status || cfg.ga_heatcool_write,
      cfg.ga_fan_status || cfg.ga_fan_write,
      cfg.ga_fanauto_status || cfg.ga_fanauto_write,
      cfg.ga_setpoint_status || cfg.ga_setpoint_write,
      cfg.ga_temp_status,
    ].filter(Boolean);
    targets.forEach((ga, i) => {
      this._readTimers.push(setTimeout(() => this.link.read(ga), i * READ_GAP_MS));
    });
  }

  async onDeleted() {
    this._shutdown();
  }

  async onUninit() {
    this._shutdown();
  }

  _shutdown() {
    this.link.removeListener('state', this._onLinkState);
    this._teardownSubscriptions();
  }
};
