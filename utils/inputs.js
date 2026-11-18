/**
 * Small input normalisers shared by the CRM services.
 * express-validator checks the format; these helpers make the stored value
 * consistent (trimmed text, 13-digit CNIC with dashes, nullable numbers).
 */
'use strict';

function text(value, max = 1000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

/**
 * Parse an optional numeric form field.
 * @returns {number|null}
 */
function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Return a CNIC in 12345-1234567-1 form, or the trimmed input if incomplete. */
function cnic(value) {
  const raw = text(value, 20);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 13) return raw;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/**
 * Parse latitude/longitude form fields.
 * @returns {{lat: number|null, lng: number|null}}
 */
function gps(latValue, lngValue) {
  return {
    lat: optionalNumber(latValue),
    lng: optionalNumber(lngValue),
  };
}

/** Percentage (0–100) to integer basis points (0–10000). */
function percentToBps(value) {
  const percentage = optionalNumber(value);
  if (percentage === null) return 0;
  return Math.round(percentage * 100);
}

module.exports = { text, optionalNumber, cnic, gps, percentToBps };
