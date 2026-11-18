/**
 * Display formatting helpers (dates, money, text).
 * All dates are rendered in the company timezone (Asia/Karachi).
 */
'use strict';

const config = require('../config/app');

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: config.timezone,
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: config.timezone,
});

const moneyFormatter = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : '—';
}

function formatDateTime(value) {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : '—';
}

/**
 * Format an integer paisa amount as PKR.
 * @param {number|null|undefined} paisa
 * @param {{decimals?: number, fallback?: string}} [options]
 */
function formatPKR(paisa, options = {}) {
  if (paisa === null || paisa === undefined || paisa === '') {
    return options.fallback === undefined ? '—' : options.fallback;
  }
  const value = Number(paisa);
  if (!Number.isFinite(value)) return options.fallback === undefined ? '—' : options.fallback;

  const formatter = options.decimals
    ? new Intl.NumberFormat('en-PK', {
        style: 'currency',
        currency: 'PKR',
        minimumFractionDigits: options.decimals,
        maximumFractionDigits: options.decimals,
      })
    : moneyFormatter;

  return formatter.format(value / 100);
}

/**
 * Format a stock quantity: up to 3 decimals, trailing zeros removed.
 * Stock can be fractional for cable (metres) but panels are whole units.
 * @param {number|null|undefined} value
 */
function formatQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number
    .toLocaleString('en-PK', { maximumFractionDigits: 3, minimumFractionDigits: 0 })
    .replace(/\u00a0/g, ' ');
}

/** "3 days ago", "just now" — used for audit entries on the dashboard. */
function formatRelative(value) {
  const date = toDate(value);
  if (!date) return '—';

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return 'just now';
}

/** Escape a value for safe interpolation into an HTML string. */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Two-letter initials for avatars. */
function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]).join('').toUpperCase();
}

/** Shorten long text for tables. */
function truncate(value, length = 60) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertUnderThousand(n) {
  let s = '';
  if (n >= 100) {
    s += ONES[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)] + (n % 10 > 0 ? '-' + ONES[n % 10] : '') + ' ';
  } else if (n > 0) {
    s += ONES[n] + ' ';
  }
  return s.trim();
}

/**
 * Converts a Pakistani Rupee amount into words using the standard Lac / Crore convention.
 * e.g. 1,250,000 -> "Twelve Lac Fifty Thousand Rupees Only"
 *
 * @param {number} amount Amount in rupees (or paisa if isPaisa is true)
 * @param {boolean} [isPaisa=false]
 * @returns {string}
 */
function numberToWordsPKR(amount, isPaisa = false) {
  let num = Number(amount);
  if (!Number.isFinite(num)) return 'Zero Rupees Only';
  if (isPaisa) num = Math.round(num / 100);
  num = Math.abs(Math.round(num));

  if (num === 0) return 'Zero Rupees Only';

  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lac = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const remainder = num;

  const parts = [];
  if (crore > 0) parts.push(convertUnderThousand(crore) + ' Crore');
  if (lac > 0) parts.push(convertUnderThousand(lac) + ' Lac');
  if (thousand > 0) parts.push(convertUnderThousand(thousand) + ' Thousand');
  if (remainder > 0) parts.push(convertUnderThousand(remainder));

  return parts.join(' ').trim() + ' Rupees Only';
}

module.exports = {
  formatDate,
  formatDateTime,
  formatPKR,
  formatRelative,
  formatQty,
  escapeHtml,
  initials,
  truncate,
  numberToWordsPKR,
};
