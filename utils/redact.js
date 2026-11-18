/**
 * Remove secrets from objects before they are persisted to the audit log
 * or logged to the console.
 *
 * Audit rows are permanent, so a password hash or CSRF token must never
 * reach them, even if a controller accidentally passes a whole document.
 */
'use strict';

const SECRET_KEY = /password|passwd|secret|token|hash|authorization|csrf/i;
const REDACTED = '[redacted]';

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * @param {*} value
 * @param {number} [depth] Internal recursion guard
 * @returns {*} A deep copy with sensitive keys replaced
 */
function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[max-depth]';

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  }

  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return '[buffer]';

  // Mongoose documents expose toObject(); plain objects do not.
  if (typeof value.toObject === 'function') {
    return redact(value.toObject({ depopulate: true, getters: false, virtuals: false }), depth + 1);
  }

  if (isPlainObject(value)) {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === '__v') continue;
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}

module.exports = { redact, REDACTED };
