'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { SYSTEM_TYPES } = require('../config/systems');

const packageItemSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Item reference is required'],
    },
    qty: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0.01, 'Quantity must be greater than zero'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [300, 'Notes cannot exceed 300 characters'],
    },
  },
  { _id: true }
);

const packageSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Package code is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Package code cannot exceed 30 characters'],
    },
    name: {
      type: String,
      required: [true, 'Package name is required'],
      trim: true,
      maxlength: [150, 'Package name cannot exceed 150 characters'],
    },
    systemType: {
      type: String,
      enum: { values: SYSTEM_TYPES, message: 'Invalid system type' },
      default: 'on_grid',
      index: true,
    },
    capacityKw: {
      type: Number,
      required: [true, 'Capacity (kW) is required'],
      min: [0.1, 'Capacity must be at least 0.1 kW'],
      max: [100000, 'Capacity is too large'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    items: {
      type: [packageItemSchema],
      default: [],
    },
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
    defaultDiscountPercent: {
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative'],
      max: [100, 'Discount cannot exceed 100%'],
    },
    isActive: {
      type: Boolean,
      default: true,
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

packageSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
packageSchema.index({ name: 1 });
packageSchema.index({ systemType: 1, capacityKw: 1 });
packageSchema.index({ isActive: 1, createdAt: -1 });

packageSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Package', packageSchema);
