'use strict';

const GA_RE = /^(\d{1,2})\/(\d)\/(\d{1,3})$/;

/**
 * Parse a 3-level KNX group address ("main/middle/sub").
 * Returns the normalised string, or null when it is not valid.
 * Ranges: main 0-31, middle 0-7, sub 0-255.
 */
function parseGa(input) {
  if (typeof input !== 'string') return null;
  const match = GA_RE.exec(input.trim());
  if (!match) return null;
  const [main, middle, sub] = match.slice(1).map(Number);
  if (main > 31 || middle > 7 || sub > 255) return null;
  return `${main}/${middle}/${sub}`;
}

module.exports = { parseGa };
