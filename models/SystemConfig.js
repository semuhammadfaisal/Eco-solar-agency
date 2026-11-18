'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { SYSTEM_TYPES, APPROVAL_STATUSES, DISCOUNT_TYPES } = require('../config/systems');

const systemConfigLineSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Item is required'],
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
    },
    qty: {
      type: Number,
      required: [true, 'Quantity is required'],
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
    marginPaisa: {
      type: Number,
      default: 0,
    },
    marginPercent: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [300, 'Line notes cannot exceed 300 characters'],
    },
  },
  { _id: true }
);

const estimatedUnitsSchema = new mongoose.Schema(
  {
    daily: { type: Number, default: 0, min: 0 },
    monthly: { type: Number, default: 0, min: 0 },
    yearly: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const systemConfigSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: [true, 'Configuration number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Number cannot exceed 30 characters'],
    },
    name: {
      type: String,
      required: [true, 'Configuration name is required'],
      trim: true,
      maxlength: [180, 'Name cannot exceed 180 characters'],
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    survey: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Survey',
      default: null,
      index: true,
    },
    package: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Package',
      default: null,
      index: true,
    },
    systemType: {
      type: String,
      enum: { values: SYSTEM_TYPES, message: 'Invalid system type' },
      default: 'on_grid',
      index: true,
    },
    capacityKw: {
      type: Number,
      default: 0,
      min: [0, 'Capacity cannot be negative'],
    },
    panelCount: {
      type: Number,
      default: 0,
      min: [0, 'Panel count cannot be negative'],
    },
    inverterCapacityKw: {
      type: Number,
      default: 0,
      min: [0, 'Inverter capacity cannot be negative'],
    },
    batteryCapacityKwh: {
      type: Number,
      default: 0,
      min: [0, 'Battery capacity cannot be negative'],
    },
    estimatedUnits: {
      type: estimatedUnitsSchema,
      default: () => ({ daily: 0, monthly: 0, yearly: 0 }),
    },
    lines: {
      type: [systemConfigLineSchema],
      default: [],
    },
    // Add-on & installation overhead costs (in paisa)
    laborCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Labor cost cannot be negative'],
    },
    transportCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Transport cost cannot be negative'],
    },
    netMeteringCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Net-metering cost cannot be negative'],
    },
    additionalCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Additional cost cannot be negative'],
    },

    // Commercial totals
    totalItemCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Item cost cannot be negative'],
    },
    totalItemSellingPricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Item selling price cannot be negative'],
    },
    totalBaseCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Base cost cannot be negative'],
    },
    grossPricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Gross price cannot be negative'],
    },
    discountType: {
      type: String,
      enum: { values: DISCOUNT_TYPES, message: 'Invalid discount type' },
      default: 'percent',
    },
    discountValue: {
      type: Number,
      default: 0,
      min: [0, 'Discount value cannot be negative'],
    },
    discountPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Discount paisa cannot be negative'],
    },
    discountPercent: {
      type: Number,
      default: 0,
      min: [0, 'Discount percent cannot be negative'],
    },
    salesCommissionRateBps: {
      type: Number,
      default: 0,
      min: [0, 'Commission bps cannot be negative'],
    },
    salesCommissionPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Commission paisa cannot be negative'],
    },
    finalPricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Final price cannot be negative'],
    },
    netProfitPaisa: {
      type: Number,
      default: 0,
    },
    netProfitMarginPercent: {
      type: Number,
      default: 0,
    },

    // Warnings & Owner Approval
    warnings: {
      type: [String],
      default: [],
    },
    requiresApproval: {
      type: Boolean,
      default: false,
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: { values: APPROVAL_STATUSES, message: 'Invalid approval status' },
      default: 'none',
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvalNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Approval notes cannot exceed 1000 characters'],
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
      maxlength: [3000, 'Remarks cannot exceed 3000 characters'],
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

systemConfigSchema.index(
  { number: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
systemConfigSchema.index({ customer: 1, createdAt: -1 });
systemConfigSchema.index({ survey: 1, createdAt: -1 });
systemConfigSchema.index({ requiresApproval: 1, approvalStatus: 1 });
systemConfigSchema.index({ createdBy: 1, createdAt: -1 });

systemConfigSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
