'use strict';

const crypto = require('crypto');
const Homey = require('homey');

module.exports = class ThermostatDriver extends Homey.Driver {
  async onInit() {
    this.modeChanged = this.homey.flow.getDeviceTriggerCard('hvac_mode_changed');

    this.modeChangedTo = this.homey.flow.getDeviceTriggerCard('hvac_mode_changed_to');
    this.modeChangedTo.registerRunListener(async (args, state) => args.mode.id === state.mode);
    this.modeChangedTo.registerArgumentAutocompleteListener('mode', (query, args) => this._modes(query, args));

    const isMode = this.homey.flow.getConditionCard('hvac_mode_is');
    isMode.registerRunListener(async (args) => args.device.getCapabilityValue('hvac_mode') === args.mode.id);
    isMode.registerArgumentAutocompleteListener('mode', (query, args) => this._modes(query, args));

    const setMode = this.homey.flow.getActionCard('set_hvac_mode');
    setMode.registerRunListener(async (args) => args.device.setMode(args.mode.id));
    setMode.registerArgumentAutocompleteListener('mode', (query, args) => this._modes(query, args));

    this.fanChanged = this.homey.flow.getDeviceTriggerCard('fan_speed_changed');

    this.fanChangedTo = this.homey.flow.getDeviceTriggerCard('fan_speed_changed_to');
    this.fanChangedTo.registerRunListener(async (args, state) => args.speed.id === state.speed);
    this.fanChangedTo.registerArgumentAutocompleteListener('speed', (query, args) => this._fanSpeeds(query, args));

    const isFan = this.homey.flow.getConditionCard('fan_speed_is');
    isFan.registerRunListener(async (args) => args.device.getCapabilityValue('fan_speed') === args.speed.id);
    isFan.registerArgumentAutocompleteListener('speed', (query, args) => this._fanSpeeds(query, args));

    const setFan = this.homey.flow.getActionCard('set_fan_speed');
    setFan.registerRunListener(async (args) => args.device.setFanSpeed(args.speed.id));
    setFan.registerArgumentAutocompleteListener('speed', (query, args) => this._fanSpeeds(query, args));

    this.homey.flow.getActionCard('set_room_temperature')
      .registerRunListener(async (args) => args.device.setRoomTemperature(args.temperature));
  }

  // Flow card dropdowns only offer the modes ticked in the device's settings.
  async _modes(query, args) {
    const modes = args.device.getExposedModes();
    const needle = String(query || '').toLowerCase();
    return modes
      .filter((m) => m.name.toLowerCase().includes(needle))
      .map((m) => ({ id: m.id, name: m.name }));
  }

  // Fan speed dropdowns only offer the speeds this device has (plus Auto when configured).
  async _fanSpeeds(query, args) {
    const needle = String(query || '').toLowerCase();
    return args.device.getFanOptions()
      .filter((s) => s.name.toLowerCase().includes(needle))
      .map((s) => ({ id: s.id, name: s.name }));
  }

  triggerFanChanged(device, speed) {
    this.fanChanged.trigger(device, { speed: speed.id, speed_name: speed.name }).catch(this.error);
    this.fanChangedTo.trigger(device, {}, { speed: speed.id }).catch(this.error);
  }

  triggerModeChanged(device, mode) {
    this.modeChanged.trigger(device, { mode: mode.id, mode_name: mode.name }).catch(this.error);
    this.modeChangedTo.trigger(device, {}, { mode: mode.id }).catch(this.error);
  }

  async onPairListDevices() {
    return [{ name: 'KNX Thermostat', data: { id: crypto.randomUUID() } }];
  }
};
