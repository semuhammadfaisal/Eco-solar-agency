'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { SYSTEM_TYPES, DISCOUNT_TYPES } = require('../config/systems');
const { QUOTATION_STATUSES, PAYMENT_OPTIONS } = require('../config/quotations');

const quotationItemSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      default: null,
    },
    itemSnapshot: {
      sku: { type: String, default: '' },
      name: { type: String, default: '' },
      category: { type: String, default: 'other' },
      brand: { type: String, default: '' },
      model: { type: String, default: '' },
      unit: { type: String, default: 'pcs' },
      wattage: { type: Number, default: null },
      capacityKw: { type: Number, default: null },
      warrantyYears: { type: Number, default: null },
    },
    qty: {
      type: Number,
      required: [true, 'Item quantity is required'],
      min: [0.01, 'Quantity must be positive'],
    },
    unitCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Unit cost cannot be negative'],
    },
    unitSellingPricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Unit selling price cannot be negative'],
    },
    totalCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Total cost cannot be negative'],
    },
    totalSellingPricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Total selling price cannot be negative'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [300, 'Notes cannot exceed 300 characters'],
    },
    isOptionalExtra: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true }
);

const paymentMilestoneSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    amountPaisa: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, default: null },
    notes: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: QUOTATION_STATUSES, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { _id: false }
);

const quotationSchema = new mongoose.Schema(
  {
    quotationNumber: {
      type: String,
      required: [true, 'Quotation number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Number cannot exceed 30 characters'],
    },
    revision: {
      type: Number,
      default: 1,
      min: 1,
    },
    isLatestRevision: {
      type: Boolean,
      default: true,
      index: true,
    },
    parentQuotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quotation',
      default: null,
      index: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    survey: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Survey',
      default: null,
      index: true,
    },
    systemConfig: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SystemConfig',
      default: null,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Salesperson assignment is required'],
      index: true,
    },

    // System Overview Snapshot
    systemSummary: {
      capacityKw: { type: Number, default: 0 },
      systemType: { type: String, enum: SYSTEM_TYPES, default: 'on_grid' },
      panelCount: { type: Number, default: 0 },
      inverterCapacityKw: { type: Number, default: 0 },
      batteryCapacityKwh: { type: Number, default: 0 },
      estimatedUnits: {
        daily: { type: Number, default: 0 },
        monthly: { type: Number, default: 0 },
        yearly: { type: Number, default: 0 },
      },
    },

    // Bill of Materials Item Snapshot
    items: {
      type: [quotationItemSchema],
      default: [],
    },

    // Overheads & Logistics
    laborCostPaisa: { type: Number, default: 0, min: 0 },
    transportCostPaisa: { type: Number, default: 0, min: 0 },
    netMeteringCostPaisa: { type: Number, default: 0, min: 0 },
    additionalCostPaisa: { type: Number, default: 0, min: 0 },

    // Financial Totals
    totalItemCostPaisa: { type: Number, default: 0, min: 0 },
    totalItemSellingPricePaisa: { type: Number, default: 0, min: 0 },
    totalBaseCostPaisa: { type: Number, default: 0, min: 0 },
    grossPricePaisa: { type: Number, default: 0, min: 0 },

    discountType: { type: String, enum: DISCOUNT_TYPES, default: 'percent' },
    discountValue: { type: Number, default: 0, min: 0 },
    discountPaisa: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0 },

    salesCommissionRateBps: { type: Number, default: 0, min: 0 },
    salesCommissionPaisa: { type: Number, default: 0, min: 0 },

    finalPricePaisa: { type: Number, default: 0, min: 0 },
    netProfitPaisa: { type: Number, default: 0 },
    netProfitMarginPercent: { type: Number, default: 0 },

    // Payment Option & Milestone schedule
    paymentOption: {
      type: String,
      enum: PAYMENT_OPTIONS,
      default: 'cash',
    },
    paymentPlan: {
      type: [paymentMilestoneSchema],
      default: [],
    },

    // Terms, Warranty & Validity
    quotationDate: { type: Date, default: Date.now },
    validUntil: { type: Date, required: [true, 'Validity date is required'] },
    terms: { type: String, trim: true, default: '', maxlength: 4000 },
    warrantyTerms: { type: String, trim: true, default: '', maxlength: 2000 },
    includeUrdu: { type: Boolean, default: false },
    urduNotes: { type: String, trim: true, default: '', maxlength: 2000 },

    // Status & Approval tracking
    status: {
      type: String,
      enum: QUOTATION_STATUSES,
      default: 'draft',
      index: true,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },

    // Linked Sale / Project upon approval
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

quotationSchema.index(
  { quotationNumber: 1, revision: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
quotationSchema.index({ customer: 1, createdAt: -1 });
quotationSchema.index({ assignedTo: 1, status: 1 });
quotationSchema.index({ status: 1, createdAt: -1 });

quotationSchema.virtual('fullNumber').get(function fullNumber() {
  return this.revision > 1
    ? `${this.quotationNumber} (Rev ${this.revision})`
    : this.quotationNumber;
});

quotationSchema.virtual('isExpired').get(function isExpired() {
  if (['approved', 'rejected'].includes(this.status)) return false;
  return Boolean(this.validUntil && new Date(this.validUntil) < new Date());
});

quotationSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Quotation', quotationSchema);
