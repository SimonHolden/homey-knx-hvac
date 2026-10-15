'use strict';

// All values of DPT 20.105 (DPT_HVACContrMode). `default: true` marks the
// modes that are ticked by default for a new device (the common Daikin/Intesis set).
const MODES = [
  { id: 'auto', value: 0, name: 'Auto', default: true },
  { id: 'heat', value: 1, name: 'Heat', default: true },
  { id: 'morning_warmup', value: 2, name: 'Morning warmup' },
  { id: 'cool', value: 3, name: 'Cool', default: true },
  { id: 'night_purge', value: 4, name: 'Night purge' },
  { id: 'precool', value: 5, name: 'Precool' },
  { id: 'off', value: 6, name: 'Off' },
  { id: 'test', value: 7, name: 'Test' },
  { id: 'emergency_heat', value: 8, name: 'Emergency heat' },
  { id: 'fan_only', value: 9, name: 'Fan only', default: true },
  { id: 'free_cooling', value: 10, name: 'Free cooling' },
  { id: 'ice_making', value: 11, name: 'Ice making' },
  { id: 'max_heating', value: 12, name: 'Maximum heating' },
  { id: 'economic', value: 13, name: 'Economic heat/cool' },
  { id: 'dehumidification', value: 14, name: 'Dry (dehumidification)', default: true },
  { id: 'calibration', value: 15, name: 'Calibration' },
  { id: 'emergency_cool', value: 16, name: 'Emergency cool' },
  { id: 'emergency_steam', value: 17, name: 'Emergency steam' },
  { id: 'no_demand', value: 20, name: 'No demand' },
];

const BY_ID = new Map(MODES.map((m) => [m.id, m]));
const BY_VALUE = new Map(MODES.map((m) => [m.value, m]));

module.exports = {
  MODES,
  byId: (id) => BY_ID.get(id) || null,
  byValue: (value) => BY_VALUE.get(value) || null,
};
