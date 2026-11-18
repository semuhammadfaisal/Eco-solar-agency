/**
 * Money helpers.
 *
 * RULE: every monetary value in this application is stored as an INTEGER
 * number of paisa (1 PKR = 100 paisa). Floats are never persisted for money.
 * Use toPaisa() when parsing user input and formatPKR() when rendering.
 */
'use strict';

const { formatPKR } = require('./format');

/**
 * Parse rupees (string or number) into integer paisa.
 * Accepts "1,250.50", "Rs 1250", 1250, "1250.5".
 * Throws on invalid input so callers can surface a validation error.
 *
 * @param {string|number} input
 * @returns {number} integer paisa
 */
function toPaisa(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid amount');
    return Math.round(input * 100);
  }

  if (typeof input !== 'string') throw new Error('Invalid amount');

  const cleaned = input
    .replace(/pkr|rs\.?/gi, '')
    .replace(/[,\s]/g, '')
    .trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error('Invalid amount');
  }

  // Multiply via string parts to avoid floating point rounding surprises.
  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole, fraction = ''] = unsigned.split('.');
  const paisa = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));

  if (!Number.isSafeInteger(paisa)) throw new Error('Amount is too large');
  return negative ? -paisa : paisa;
}

/** Convert integer paisa back to a plain rupee number (for display only). */
function toRupees(paisa) {
  if (paisa === null || paisa === undefined) return null;
  return Number(paisa) / 100;
}

module.exports = { toPaisa, toRupees, formatPKR };
