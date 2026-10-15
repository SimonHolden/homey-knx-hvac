'use strict';

const Homey = require('homey');
const { KnxLink } = require('./lib/knx-link');

module.exports = class KnxHvacApp extends Homey.App {
  async onInit() {
    this.link = new KnxLink({
      log: (...args) => this.log(...args),
      error: (...args) => this.error(...args),
    });

    // The settings page polls this value to show the connection status.
    this.link.on('state', (state, detail) => {
      this.homey.settings.set('link_status', { state, detail, at: Date.now() });
    });

    this.homey.settings.on('set', (key) => {
      if (key === 'connection') this.link.configure(this.homey.settings.get('connection')).catch(this.error);
    });
    this.homey.settings.on('unset', (key) => {
      if (key === 'connection') this.link.configure(null).catch(this.error);
    });

    this.link.configure(this.homey.settings.get('connection')).catch(this.error);
    this.log('KNX HVAC started');
  }

  async onUninit() {
    if (this.link) await this.link.destroy();
  }
};
