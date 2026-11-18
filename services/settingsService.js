/**
 * Company settings service.
 *
 * The settings document is read on almost every page (branding, footer), so
 * it is cached in process memory until something changes. Restart the app
 * (or call invalidateSettingsCache) after editing the document directly in
 * MongoDB.
 */
'use strict';

const fs = require('fs/promises');
const path = require('path');
const Settings = require('../models/Settings');
const config = require('../config/app');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');

const { toPaisa } = require('../utils/money');

let cache = null;

const EDITABLE_FIELDS = [
  'companyName',
  'legalName',
  'address',
  'city',
  'phone',
  'phoneAlt',
  'email',
  'website',
  'ntn',
  'strn',
  'bankName',
  'bankBranch',
  'bankAccountTitle',
  'bankAccountNumber',
  'bankIban',
  'quotationTerms',
  'invoiceTerms',
  'surveyMonthlyUnitsPerKw',
  'surveySizingBufferPercent',
  'surveySizeStepKw',
  'businessDayStart',
  'businessDayEnd',
  'minMarginPercent',
  'maxDiscountPercentWithoutApproval',
];

/** @returns {Promise<import('../models/Settings')>} */
async function getSettings() {
  if (cache) return cache;
  cache = await Settings.getSingleton();
  return cache;
}

function invalidateSettingsCache() {
  cache = null;
}

/** Delete a previously uploaded logo, but never outside the uploads folder. */
async function removeLogoFile(logoPath) {
  if (!logoPath) return;

  const relative = logoPath.replace(/^\/+/, '');
  const absolute = path.resolve(path.join(__dirname, '..', 'public', relative));
  const uploadsRoot = path.resolve(config.uploadsDir) + path.sep;

  if (!absolute.startsWith(uploadsRoot)) return; // defensive: never unlink outside uploads

  try {
    await fs.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[settings] could not remove old logo:', err.message);
    }
  }
}

/**
 * Update company settings and optionally replace/remove the logo.
 *
 * @param {object} payload Form body
 * @param {{logoFile?: object, removeLogo?: boolean}} uploads
 * @param {object} actor
 * @param {import('express').Request} req
 */
async function updateSettings(payload, uploads = {}, actor, req) {
  const settings = await Settings.getSingleton();
  const before = settings.toObject();

  for (const field of EDITABLE_FIELDS) {
    if (payload[field] === undefined) continue;
    const value = typeof payload[field] === 'string' ? payload[field].trim() : payload[field];
    settings[field] = value;
  }

  for (const field of [
    'surveyMonthlyUnitsPerKw',
    'surveySizingBufferPercent',
    'surveySizeStepKw',
    'minMarginPercent',
    'maxDiscountPercentWithoutApproval',
  ]) {
    if (payload[field] === undefined) continue;
    settings[field] = Number(payload[field]);
  }

  if (payload.defaultLaborCost !== undefined && payload.defaultLaborCost !== '') {
    settings.defaultLaborCostPaisa = toPaisa(payload.defaultLaborCost);
  }
  if (payload.defaultTransportCost !== undefined && payload.defaultTransportCost !== '') {
    settings.defaultTransportCostPaisa = toPaisa(payload.defaultTransportCost);
  }
  if (payload.defaultNetMeteringCost !== undefined && payload.defaultNetMeteringCost !== '') {
    settings.defaultNetMeteringCostPaisa = toPaisa(payload.defaultNetMeteringCost);
  }

  if (payload.defaultOpeningFloat !== undefined && payload.defaultOpeningFloat !== '') {
    settings.defaultOpeningFloatPaisa = toPaisa(payload.defaultOpeningFloat);
  }

  // The reminder checkbox is paired with a hidden 0 so an unchecked box still
  // submits a value. express.urlencoded turns the pair into an array.
  if (payload.dailyClosingReminderEnabled !== undefined) {
    const raw = payload.dailyClosingReminderEnabled;
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    settings.dailyClosingReminderEnabled = ['1', 'on', 'true', 'yes'].includes(
      String(value).toLowerCase()
    );
  }

  if (payload.email) settings.email = settings.email.toLowerCase();

  if (uploads.removeLogo) {
    await removeLogoFile(settings.logoPath);
    settings.logoPath = '';
  }

  if (uploads.logoFile) {
    await removeLogoFile(settings.logoPath);
    settings.logoPath = `/uploads/company/${uploads.logoFile.filename}`;
  }

  try {
    await settings.save();
  } catch (err) {
    // Remove a newly uploaded file if the document could not be saved.
    if (uploads.logoFile) await removeLogoFile(`/uploads/company/${uploads.logoFile.filename}`);
    if (err.name === 'ValidationError') {
      throw ApiError.badRequest('Please correct the highlighted settings fields.');
    }
    throw err;
  }

  invalidateSettingsCache();

  const after = settings.toObject();
  const changed = EDITABLE_FIELDS.filter((field) => before[field] !== after[field]);

  await logAction(actor, AUDIT_ACTIONS.SETTINGS_UPDATED, 'settings', settings._id, before, after, {
    req,
    description: `Updated company settings${
      changed.length ? ` (${changed.slice(0, 8).join(', ')})` : ''
    }`,
  });

  if (uploads.logoFile || uploads.removeLogo) {
    await logAction(
      actor,
      AUDIT_ACTIONS.SETTINGS_LOGO_UPDATED,
      'settings',
      settings._id,
      { logoPath: before.logoPath },
      { logoPath: after.logoPath },
      { req, description: uploads.logoFile ? 'Uploaded new company logo' : 'Removed company logo' }
    );
  }

  return settings;
}

module.exports = {
  getSettings,
  updateSettings,
  invalidateSettingsCache,
  EDITABLE_FIELDS,
};
