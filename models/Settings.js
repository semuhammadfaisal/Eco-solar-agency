/**
 * Settings — a singleton document holding company-wide configuration used on
 * quotations, invoices and the app chrome.
 *
 * Access: owner + manager (requirePermission('settings.manage')).
 */
'use strict';

const mongoose = require('mongoose');
const config = require('../config/app');

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'company',
      unique: true,
      immutable: true,
    },

    // Company identity
    companyName: { type: String, trim: true, default: '', maxlength: 150 },
    legalName: { type: String, trim: true, default: '', maxlength: 150 },
    logoPath: { type: String, trim: true, default: '', maxlength: 255 },

    // Contact
    address: { type: String, trim: true, default: '', maxlength: 500 },
    city: { type: String, trim: true, default: '', maxlength: 80 },
    phone: { type: String, trim: true, default: '', maxlength: 30 },
    phoneAlt: { type: String, trim: true, default: '', maxlength: 30 },
    email: { type: String, trim: true, lowercase: true, default: '', maxlength: 190 },
    website: { type: String, trim: true, default: '', maxlength: 190 },

    // Tax identifiers (Pakistan)
    ntn: { type: String, trim: true, default: '', maxlength: 30 },
    strn: { type: String, trim: true, default: '', maxlength: 30 },

    // Banking (printed on quotations / invoices)
    bankName: { type: String, trim: true, default: '', maxlength: 120 },
    bankBranch: { type: String, trim: true, default: '', maxlength: 120 },
    bankAccountTitle: { type: String, trim: true, default: '', maxlength: 150 },
    bankAccountNumber: { type: String, trim: true, default: '', maxlength: 60 },
    bankIban: { type: String, trim: true, default: '', maxlength: 60 },

    // Document defaults
    quotationTerms: { type: String, trim: true, default: '', maxlength: 3000 },
    invoiceTerms: { type: String, trim: true, default: '', maxlength: 3000 },

    // Site-survey sizing formula: average monthly units divided by expected
    // monthly production per installed kW, plus a configurable design buffer.
    surveyMonthlyUnitsPerKw: { type: Number, default: 120, min: 1, max: 1000 },
    surveySizingBufferPercent: { type: Number, default: 15, min: 0, max: 100 },
    surveySizeStepKw: { type: Number, default: 0.5, min: 0.1, max: 10 },

    // Daily closing & cash drawer
    // The business day may cross midnight (e.g. 22:00 -> 06:00). A value of
    // "HH:MM" is always interpreted in the company timezone above.
    businessDayStart: {
      type: String,
      default: '09:00',
      trim: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Business day start must be a valid HH:MM time'],
    },
    businessDayEnd: {
      type: String,
      default: '21:00',
      trim: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Business day end must be a valid HH:MM time'],
    },
    defaultOpeningFloatPaisa: { type: Number, default: 0, min: 0 },
    dailyClosingReminderEnabled: { type: Boolean, default: true },

    // Pricing & profit controls
    minMarginPercent: { type: Number, default: 10, min: 0, max: 100 },
    maxDiscountPercentWithoutApproval: { type: Number, default: 5, min: 0, max: 100 },
    defaultLaborCostPaisa: { type: Number, default: 3500000, min: 0 },
    defaultTransportCostPaisa: { type: Number, default: 1500000, min: 0 },
    defaultNetMeteringCostPaisa: { type: Number, default: 10000000, min: 0 },

    // Fixed business defaults
    currency: { type: String, default: config.currency, immutable: true },
    timezone: { type: String, default: config.timezone, immutable: true },
  },
  { timestamps: true }
);

/** Fetch (creating on first use) the singleton settings document. */
settingsSchema.statics.getSingleton = async function getSingleton() {
  const existing = await this.findOne({ key: 'company' });
  if (existing) return existing;
  return this.create({
    key: 'company',
    companyName: config.appName,
    quotationTerms:
      '1. Prices are valid for 15 days from the quotation date.\n' +
      '2. 50% advance payment is required to confirm the order.\n' +
      '3. Delivery and installation timeline will be confirmed after site survey.\n' +
      '4. Warranty is as per the manufacturer terms and conditions.',
    surveyMonthlyUnitsPerKw: 120,
    surveySizingBufferPercent: 15,
    surveySizeStepKw: 0.5,
  });
};

module.exports = mongoose.model('Settings', settingsSchema);
