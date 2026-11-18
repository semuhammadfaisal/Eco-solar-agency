/**
 * Inventory item.
 *
 * `currentStock` and `avgCostPaisa` are denormalised totals maintained by the
 * stock service whenever a movement is written. `avgCostPaisa` is the moving
 * average purchase cost (integer paisa), not the catalogue purchase price.
 */
'use strict';

const mongoose = require('mongoose');
const { ITEM_CATEGORIES, ITEM_UNITS } = require('../config/inventory');
const softDeletePlugin = require('./plugins/softDelete');

const itemSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      trim: true,
      uppercase: true,
      maxlength: [40, 'SKU cannot exceed 40 characters'],
      validate: {
        validator: (value) => /^[A-Z0-9][A-Z0-9._/-]{1,39}$/.test(value),
        message: 'Use letters, digits and . _ / - only (2–40 characters)',
      },
    },
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
      maxlength: [150, 'Item name cannot exceed 150 characters'],
    },
    category: {
      type: String,
      enum: { values: ITEM_CATEGORIES, message: 'Select a valid category' },
      default: 'other',
      index: true,
    },
    brand: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'Brand cannot exceed 100 characters'],
    },
    brandRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null, index: true },
    model: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'Model cannot exceed 100 characters'],
    },
    unit: {
      type: String,
      enum: { values: ITEM_UNITS, message: 'Select a valid unit' },
      default: 'pcs',
    },
    /** Panel wattage (W). */
    wattage: {
      type: Number,
      default: null,
      min: [0, 'Wattage cannot be negative'],
      max: [1000000, 'Wattage is too large'],
    },
    /** Inverter / battery capacity (kW). */
    capacityKw: {
      type: Number,
      default: null,
      min: [0, 'Capacity cannot be negative'],
      max: [1000000, 'Capacity is too large'],
    },
    specs: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Specifications cannot exceed 2000 characters'],
    },
    hasSerial: {
      type: Boolean,
      default: false,
      index: true,
    },
    minStock: {
      type: Number,
      default: 0,
      min: [0, 'Minimum stock cannot be negative'],
    },
    purchasePricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Purchase price cannot be negative'],
    },
    sellingPricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Selling price cannot be negative'],
    },
    wholesalePricePaisa: { type: Number, default: 0, min: [0, 'Wholesale price cannot be negative'] },
    retailPricePaisa: { type: Number, default: 0, min: [0, 'Retail price cannot be negative'] },
    maxDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
    avgCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Average cost cannot be negative'],
    },
    /** Unit cost from the most recent GRN line (integer paisa). */
    lastPurchasePricePaisa: {
      type: Number,
      default: 0,
      min: [0, 'Last purchase price cannot be negative'],
    },
    currentStock: {
      type: Number,
      default: 0,
    },
    productWarrantyYears: {
      type: Number,
      default: 0,
      min: [0, 'Product warranty cannot be negative'],
      max: [50, 'Product warranty cannot exceed 50 years'],
    },
    performanceWarrantyYears: {
      type: Number,
      default: 0,
      min: [0, 'Performance warranty cannot be negative'],
      max: [50, 'Performance warranty cannot exceed 50 years'],
    },
    location: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'Location cannot exceed 100 characters'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

itemSchema.index(
  { sku: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
itemSchema.index({ name: 1 });
itemSchema.index({ brand: 1 });
itemSchema.index({ category: 1, name: 1 });
itemSchema.index({ createdAt: -1 });

itemSchema.virtual('isLowStock').get(function isLowStock() {
  return Number(this.currentStock || 0) <= Number(this.minStock || 0);
});

itemSchema.virtual('isOutOfStock').get(function isOutOfStock() {
  return Number(this.currentStock || 0) <= 0;
});

itemSchema.virtual('stockValuePaisa').get(function stockValuePaisa() {
  return Math.round(Number(this.currentStock || 0) * Number(this.avgCostPaisa || 0));
});

itemSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Item', itemSchema);
