'use strict';

// Fan speeds for 2- and 3-speed units. 'auto' is only offered when the
// device has a 1-bit fan auto object.
const AUTO = { id: 'auto', name: 'Auto' };
const SPEEDS = {
  2: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
  3: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
};

const speedsFor = (count) => SPEEDS[Number(count) === 2 ? 2 : 3];

function fanName(id) {
  if (id === AUTO.id) return AUTO.name;
  const speed = SPEEDS[3].find((s) => s.id === id);
  return speed ? speed.name : id;
}

/**
 * Raw byte for a speed id.
 *   percent (DPT 5.001): speed n of N is n/N of full scale, e.g. 33/67/100 % or 50/100 %.
 *   enum    (DPT 5.010): speed n is sent as base + n - 1.
 * Returns null when the id is not one of this device's speeds.
 */
function encodeFan(id, { count, dpt, base }) {
  const speeds = speedsFor(count);
  const index = speeds.findIndex((s) => s.id === id);
  if (index < 0) return null;
  if (dpt === 'percent') return Math.round(((index + 1) / speeds.length) * 255);
  return Number(base) + index;
}

/**
 * Speed id for a received raw byte, or null when it does not map to a speed.
 * Percentages snap to the nearest speed; 0 % is ignored.
 */
function decodeFan(raw, { count, dpt, base }) {
  if (raw === null) return null;
  const speeds = speedsFor(count);
  let index;
  if (dpt === 'percent') {
    if (raw === 0) return null;
    index = Math.min(speeds.length, Math.max(1, Math.round((raw / 255) * speeds.length))) - 1;
  } else {
    index = raw - Number(base);
  }
  return speeds[index] ? speeds[index].id : null;
}

module.exports = { AUTO, speedsFor, fanName, encodeFan, decodeFan };
