'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { SALE_STATUSES, PAYMENT_OPTIONS } = require('../config/quotations');
const { SYSTEM_TYPES } = require('../config/systems');

const saleMilestoneSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    amountPaisa: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, default: null },
    isPaid: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    saleNumber: {
      type: String,
      required: [true, 'Sale number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Number cannot exceed 30 characters'],
    },
    invoiceNumber: {
      type: String,
      required: [true, 'Invoice number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Invoice number cannot exceed 30 characters'],
    },
    /**
     * Projects can be started directly from the Projects screen, so the
     * quotation link is optional. Quotation-approved projects still store it.
     */
    quotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quotation',
      default: null,
      index: true,
    },
    projectTitle: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'Project title cannot exceed 120 characters'],
    },
    origin: {
      type: String,
      enum: ['quotation', 'direct'],
      default: 'quotation',
      index: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
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
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Salesperson is required'],
      index: true,
    },

    // Commercial values in integer paisa
    amountPaisa: {
      type: Number,
      required: [true, 'Sale amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    totalCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Cost cannot be negative'],
    },
    expectedProfitPaisa: {
      type: Number,
      default: 0,
    },
    profitMarginPercent: {
      type: Number,
      default: 0,
    },
    paymentType: {
      type: String,
      enum: PAYMENT_OPTIONS,
      default: 'cash',
    },
    paymentPlan: {
      type: [saleMilestoneSchema],
      default: [],
    },

    // System summary & snapshot
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
    itemsSnapshot: {
      type: Array,
      default: [],
    },

    status: {
      type: String,
      enum: SALE_STATUSES,
      default: 'confirmed',
      index: true,
    },
    installmentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstallmentPlan',
      default: null,
      index: true,
    },
    isMaterialIssued: {
      type: Boolean,
      default: false,
      index: true,
    },
    materialIssuedAt: {
      type: Date,
      default: null,
    },
    materialIssuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    materialIssueNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [3000, 'Notes cannot exceed 3000 characters'],
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: Date.now,
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

saleSchema.index(
  { saleNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
saleSchema.index(
  { invoiceNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null, invoiceNumber: { $type: 'string' } },
  }
);
saleSchema.index({ customer: 1, createdAt: -1 });
saleSchema.index({ assignedTo: 1, status: 1 });
saleSchema.index({ status: 1, createdAt: -1 });

saleSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Sale', saleSchema);
