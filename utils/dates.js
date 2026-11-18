/**
 * Date-only helpers.
 *
 * Attendance rows and other schedules are day-scoped, not instant-scoped.
 * We therefore normalise a "date key" (YYYY-MM-DD in the company timezone) to
 * UTC midnight. That makes range queries and unique indexes deterministic
 * regardless of the server's local timezone.
 */
'use strict';

const config = require('../config/app');

const KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in the company timezone, as YYYY-MM-DD. */
function todayKey(now = new Date()) {
  return KEY_FORMATTER.format(now);
}

/** Convert any Date/ISO value to a company-timezone YYYY-MM-DD key. */
function dateKey(value = new Date()) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return KEY_FORMATTER.format(date);
}

/** Current month in the company timezone, as YYYY-MM. */
function monthKey(value = new Date()) {
  return dateKey(value).slice(0, 7);
}

/**
 * Parse YYYY-MM-DD into a UTC-midnight Date, or return null when invalid.
 * @param {string} key
 * @returns {Date|null}
 */
function parseDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject impossible dates such as 2026-02-31 (they roll over).
  if (date.toISOString().slice(0, 10) !== key) return null;
  return date;
}

/**
 * Inclusive start / exclusive end range for one day.
 * @param {string} key YYYY-MM-DD
 */
function dayRange(key) {
  const start = parseDateKey(key);
  if (!start) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Inclusive start / exclusive end range for one month.
 * @param {string} key YYYY-MM
 */
function monthRange(key) {
  if (!/^\d{4}-\d{2}$/.test(String(key || ''))) return null;
  const start = parseDateKey(`${key}-01`);
  if (!start) return null;
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Accept either a date key or a full ISO timestamp and return a UTC-midnight
 * date for the company-timezone day. Returns null for empty/invalid input.
 * @param {string|Date} value
 * @returns {Date|null}
 */
function toDay(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDateKey(value);
  }
  const key = dateKey(value);
  return key ? parseDateKey(key) : null;
}

/**
 * Add whole years to a date (used for warranty expiry). Returns a new Date
 * or null for invalid input. The time of day is preserved.
 * @param {Date|string} value
 * @param {number} years
 * @returns {Date|null}
 */
function addYears(value, years) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const amount = Number(years);
  if (!Number.isFinite(amount) || amount <= 0) return date;

  date.setUTCFullYear(date.getUTCFullYear() + Math.trunc(amount));
  return date;
}

module.exports = {
  todayKey,
  dateKey,
  monthKey,
  parseDateKey,
  dayRange,
  monthRange,
  toDay,
  addYears,
};
