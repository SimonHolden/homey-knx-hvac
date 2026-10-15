'use strict';

// Generates the compose files that depend on the DPT 20.105 mode table, so
// lib/hvac-modes.js stays the single source of truth.
//   node scripts/generate-compose.js

const fs = require('fs');
const path = require('path');
const { MODES } = require('../lib/hvac-modes');

const root = path.join(__dirname, '..');
const write = (file, data) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
};

// Capability with every DPT 20.105 value. Each device narrows this list at
// runtime to the modes ticked in its settings.
write('.homeycompose/capabilities/hvac_mode.json', {
  type: 'enum',
  title: { en: 'HVAC mode' },
  getable: true,
  setable: true,
  uiComponent: 'picker',
  values: MODES.map((m) => ({ id: m.id, title: { en: m.name } })),
});

const ga = (id, label, hint) => ({
  id,
  type: 'text',
  label: { en: label },
  value: '',
  ...(hint ? { hint: { en: hint } } : {}),
});

const settings = [
  {
    type: 'group',
    label: { en: 'On/Off (DPT 1.001)' },
    children: [
      ga('ga_onoff_write', 'Control address', 'Group address Homey writes to, for example 1/0/1. Leave empty if the thermostat has no on/off object.'),
      ga('ga_onoff_status', 'Status address', 'Group address the device reports its state on.'),
    ],
  },
  {
    type: 'group',
    label: { en: 'Mode (DPT 20.105)' },
    children: [
      ga('ga_mode_write', 'Control address', 'HVAC controller mode, 1 byte.'),
      ga('ga_mode_status', 'Status address'),
    ],
  },
  {
    type: 'group',
    label: { en: 'Heat/Cool (DPT 1.100)' },
    children: [
      ga(
        'ga_heatcool_write',
        'Control address',
        'Simple binary object, 0 = cool, 1 = heat. Use it on its own for thermostats without a mode object. If the 20.105 mode is also set, 20.105 is authoritative and this address is kept in sync when heat or cool is selected.',
      ),
      ga('ga_heatcool_status', 'Status address', 'Only used when no 20.105 mode address is set.'),
    ],
  },
  {
    type: 'group',
    label: { en: 'Setpoint (DPT 9.001)' },
    children: [
      ga('ga_setpoint_write', 'Control address'),
      ga('ga_setpoint_status', 'Status address'),
    ],
  },
  {
    type: 'group',
    label: { en: 'Room temperature (DPT 9.001)' },
    children: [
      ga('ga_temp_status', 'Status address', 'For example the AC return temperature.'),
      {
        id: 'temp_from_flow',
        type: 'checkbox',
        label: { en: 'Room temperature is set by a flow' },
        value: false,
        hint: { en: 'Shows the room temperature on the device even without a status address, so the "Set room temperature" flow card can update it, for example from another sensor. If both are used, whichever updated last is shown.' },
      },
      ga('ga_temp_write', 'Send flow value to address', 'Optional. The "Set room temperature" flow card also writes its value here (DPT 9.001), for example the external temperature input of an AC gateway. Leave empty to only update Homey.'),
    ],
  },
  {
    type: 'group',
    label: { en: 'Fan speed (DPT 5.001 / 5.010)' },
    children: [
      ga('ga_fan_write', 'Control address', 'Fan speed object, 1 byte.'),
      ga('ga_fan_status', 'Status address'),
      {
        id: 'fan_speeds',
        type: 'dropdown',
        label: { en: 'Number of speeds' },
        value: '3',
        values: [
          { id: '2', label: { en: '2 (Low, High)' } },
          { id: '3', label: { en: '3 (Low, Medium, High)' } },
        ],
      },
      {
        id: 'fan_dpt',
        type: 'dropdown',
        label: { en: 'Data type' },
        value: 'enum',
        values: [
          { id: 'percent', label: { en: 'Percentage (DPT 5.001)' } },
          { id: 'enum', label: { en: 'Enumerated (DPT 5.010)' } },
        ],
        hint: { en: 'Percentage sends 50/100 % for 2 speeds or 33/67/100 % for 3 speeds; received values snap to the nearest speed. Enumerated sends a speed number.' },
      },
      {
        id: 'fan_enum_base',
        type: 'dropdown',
        label: { en: 'Enumerated: first speed value' },
        value: '1',
        values: [
          { id: '1', label: { en: '1 (speeds 1, 2, 3)' } },
          { id: '0', label: { en: '0 (speeds 0, 1, 2)' } },
        ],
        hint: { en: 'Only used with DPT 5.010. Match the gateway parameter, for example the Intesis "fan speed enumeration starts at" setting.' },
      },
    ],
  },
  {
    type: 'group',
    label: { en: 'Fan auto (DPT 1.001)' },
    children: [
      ga('ga_fanauto_write', 'Control address', '1 = auto fan, 0 = manual. When set, Auto is added to the fan speed picker. Choosing a fixed speed sends 0 here first.'),
      ga('ga_fanauto_status', 'Status address'),
    ],
  },
  {
    type: 'group',
    label: { en: 'Setpoint range' },
    children: [
      { id: 'temp_min', type: 'number', label: { en: 'Minimum (°C)' }, value: 16, min: 5, max: 40 },
      { id: 'temp_max', type: 'number', label: { en: 'Maximum (°C)' }, value: 32, min: 5, max: 40 },
      { id: 'temp_step', type: 'number', label: { en: 'Step (°C)' }, value: 1, min: 0.1, max: 5 },
    ],
  },
  {
    type: 'group',
    label: { en: 'Modes to expose' },
    children: [
      {
        id: 'modes_hint',
        type: 'label',
        label: { en: 'Tick the DPT 20.105 modes this device supports. Only ticked modes appear in the app and in flows. Without a 20.105 address, only Heat and Cool are used.' },
        value: '',
      },
      ...MODES.map((m) => ({
        id: `mode_${m.id}`,
        type: 'checkbox',
        label: { en: `${m.value}: ${m.name}` },
        value: Boolean(m.default),
      })),
    ],
  },
];

write('drivers/thermostat/driver.settings.compose.json', settings);
console.log(`Generated hvac_mode capability (${MODES.length} modes) and driver settings.`);
