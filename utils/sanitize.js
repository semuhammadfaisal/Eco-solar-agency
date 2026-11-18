/**
 * Server-side field visibility.
 *
 * Requirement: purchase price and profit must never reach an unauthorised
 * role, even in an API/JSON payload or a shared service result. Views are a
 * second line of defence only.
 *
 * Usage in a controller/service before rendering or serialising:
 *   const safe = sanitizeForRole(records, req.user.role);
 */
'use strict';

const { can } = require('../config/permissions');
const { redact } = require('./redact');

// Lowercase keys removed for roles without the matching permission.
const COST_FIELDS = [
  'purchaseprice',
  'purchaserate',
  'costprice',
  'cost',
  'costamount',
  'unitcost',
  'supplierprice',
  'waccost',
];

const PROFIT_FIELDS = [
  'profit',
  'profitamount',
  'profitmargin',
  'margin',
  'grossprofit',
  'netprofit',
  'markup',
];

const ALWAYS_HIDDEN = ['passwordhash', 'password', 'resetpasswordtoken', 'csrftoken'];

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function toPlain(value) {
  if (value && typeof value.toObject === 'function') {
    return value.toObject({ depopulate: true, getters: false, virtuals: false });
  }
  return value;
}

/**
 * Deep copy an entity while removing fields the role may not see.
 * Mongoose documents are converted with toObject() first.
 *
 * @param {*} entity Document, plain object, or array of either
 * @param {string} role Role of the requesting user
 * @returns {*} Sanitized deep copy
 */
function sanitizeForRole(entity, role) {
  const blocked = new Set(ALWAYS_HIDDEN);

  if (!can(role, 'costs.view')) COST_FIELDS.forEach((field) => blocked.add(field));
  if (!can(role, 'profit.view')) PROFIT_FIELDS.forEach((field) => blocked.add(field));

  // Seeded with the fields already stripped so nested copies stay consistent.
  const seen = new WeakMap();

  function walk(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (depth > 8) return '[max-depth]';
    if (value instanceof Date) return value;
    if (Buffer.isBuffer(value)) return value;
    if (typeof value !== 'object') return value;

    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const arr = [];
      seen.set(value, arr);
      for (const item of value) arr.push(walk(item, depth + 1));
      return arr;
    }

    const plain = toPlain(value);
    if (!isPlainObject(plain)) return plain;

    const out = {};
    seen.set(value, out);
    if (plain._id !== undefined) out._id = plain._id;

    for (const [key, val] of Object.entries(plain)) {
      if (key === '__v') continue;
      if (blocked.has(key.toLowerCase())) continue;
      out[key] = walk(val, depth + 1);
    }
    return out;
  }

  return walk(entity);
}

/** Convenience wrapper for the common "strip secrets for audit" case. */
function safeSnapshot(entity) {
  return redact(toPlain(entity));
}

module.exports = { sanitizeForRole, safeSnapshot, COST_FIELDS, PROFIT_FIELDS };
