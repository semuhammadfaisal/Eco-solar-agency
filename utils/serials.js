/**
 * Serial-number input helpers.
 *
 * A GRN serial box accepts either one serial per line or pasted CSV. Only the
 * first column is used (so "serial,notes" and exported spreadsheets work), and
 * a header row such as "Serial" or "Serial No" is ignored.
 *
 * The serial registry also accepts an optional second column for the barcode:
 *   SERIAL-001,8901234567890
 */
'use strict';

/** 2–60 characters; letters, digits and a small set of separators. */
const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{1,59}$/;

/** 2–80 characters; wide enough for EAN, Code-128 and QR payloads. */
const BARCODE_PATTERN = /^[A-Z0-9][A-Z0-9._/+:#-]{1,79}$/;

const MAX_SERIALS = 500;

function normalizeSerial(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase();
}

function normalizeBarcode(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase();
}

/** Strip surrounding quotes from a CSV cell. */
function unquote(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/""/g, '"').trim();
  }
  return text;
}

/**
 * Parse a free-text serial list.
 *
 * @param {string} raw Textarea contents (newline or CSV separated).
 * @returns {{ serials: string[], duplicates: string[], invalid: string[], tooMany: boolean }}
 */
function parseSerialInput(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const serials = [];
  const duplicates = [];
  const invalid = [];
  const seen = new Set();
  let tooMany = false;
  let sawValue = false;

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    if (!String(original || '').trim()) continue;

    // CSV/TSV: use the first cell. This also handles "serial,item" headers.
    let value = String(original);
    if (/[,;\t]/.test(value)) value = value.split(/[,;\t]/)[0];
    value = unquote(value);

    if (!value) continue;

    // Ignore a header row in the first non-empty position. CSV exports often
    // contain a BOM or blank line before their headings.
    if (
      !sawValue &&
      /^(serial(\s*(no|number|#))?|s\/?n|sn|imei)$/i.test(value.replace(/\s+/g, ' '))
    ) {
      sawValue = true;
      continue;
    }

    sawValue = true;

    const serial = normalizeSerial(value);

    if (!SERIAL_PATTERN.test(serial)) {
      invalid.push(String(original).trim().slice(0, 80));
      continue;
    }

    if (seen.has(serial)) {
      duplicates.push(serial);
      continue;
    }

    if (serials.length >= MAX_SERIALS) {
      tooMany = true;
      continue;
    }

    seen.add(serial);
    serials.push(serial);
  }

  return { serials, duplicates, invalid, tooMany };
}

/** True when the value can be stored as a serial number. */
function isValidSerial(value) {
  return SERIAL_PATTERN.test(normalizeSerial(value));
}

/** True when the value can be stored as a barcode. */
function isValidBarcode(value) {
  return BARCODE_PATTERN.test(normalizeBarcode(value));
}

/**
 * Parse the serial registry textarea.
 *
 * Each non-empty line is either `SERIAL` or `SERIAL,BARCODE`. The parser
 * reports duplicate serials and duplicate barcodes separately so the form can
 * explain exactly which column conflicts.
 *
 * @param {string} raw
 * @returns {{
 *   rows: Array<{ serial: string, barcode: string }>,
 *   serials: string[],
 *   duplicates: string[],
 *   duplicateBarcodes: string[],
 *   invalid: string[],
 *   tooMany: boolean
 * }}
 */
function parseSerialBarcodeInput(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const rows = [];
  const serials = [];
  const duplicates = [];
  const duplicateBarcodes = [];
  const invalid = [];
  const seenSerials = new Set();
  const seenBarcodes = new Set();
  let tooMany = false;
  let sawValue = false;

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    if (!String(original || '').trim()) continue;

    const cells = String(original).split(/[,;\t]/);
    const serialCell = unquote(cells[0]);
    const barcodeCell = unquote(cells[1] || '');
    if (!serialCell && !barcodeCell) continue;

    // Ignore a header row in the first non-empty position.
    if (
      !sawValue &&
      /^(serial(\s*(no|number|#))?|s\/?n|sn|imei)$/i.test(
        serialCell.replace(/\s+/g, ' ')
      )
    ) {
      sawValue = true;
      continue;
    }

    sawValue = true;

    const serial = normalizeSerial(serialCell);
    const barcode = normalizeBarcode(barcodeCell);

    if (!SERIAL_PATTERN.test(serial) || (barcode && !BARCODE_PATTERN.test(barcode))) {
      invalid.push(String(original).trim().slice(0, 100));
      continue;
    }

    if (seenSerials.has(serial)) {
      duplicates.push(serial);
      continue;
    }

    if (barcode && seenBarcodes.has(barcode)) {
      duplicateBarcodes.push(barcode);
      continue;
    }

    if (rows.length >= MAX_SERIALS) {
      tooMany = true;
      continue;
    }

    seenSerials.add(serial);
    if (barcode) seenBarcodes.add(barcode);
    serials.push(serial);
    rows.push({ serial, barcode });
  }

  return { rows, serials, duplicates, duplicateBarcodes, invalid, tooMany };
}

module.exports = {
  SERIAL_PATTERN,
  BARCODE_PATTERN,
  MAX_SERIALS,
  normalizeSerial,
  normalizeBarcode,
  parseSerialInput,
  parseSerialBarcodeInput,
  isValidSerial,
  isValidBarcode,
};
