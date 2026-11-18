/**
 * Append-only stock ledger.
 *
 * `qty` is signed: IN is positive; OUT and RETURN are negative; ADJUSTMENT can
 * be either. `balanceAfter` snapshots the item quantity after the movement so
 * a ledger page never has to replay the whole history to show a running
 * balance. Movements are never edited or deleted.
 */
'use strict';

const mongoose = require('mongoose');
const { STOCK_MOVEMENT_TYPES } = require('../config/inventory');

const REFERENCE_TYPES = Object.freeze([
  'purchase',
  'supplier_return',
  'adjustment',
  'serial',
  'opening',
  'transfer',
  'pos_sale',
  'pos_return',
  'other',
]);

const stockMovementSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Item is required'],
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    sourceBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    destinationBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    type: {
      type: String,
      enum: { values: STOCK_MOVEMENT_TYPES, message: 'Select a valid movement type' },
      required: [true, 'Movement type is required'],
      index: true,
    },
    qty: {
      type: Number,
      required: [true, 'Quantity is required'],
      validate: {
        validator: (value) => Number.isFinite(value) && value !== 0,
        message: 'Quantity cannot be zero',
      },
    },
    unitCostPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Unit cost cannot be negative'],
    },
    balanceAfter: {
      type: Number,
      required: [true, 'Balance after movement is required'],
    },
    reference: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'Reference cannot exceed 120 characters'],
    },
    referenceType: {
      type: String,
      enum: { values: REFERENCE_TYPES, message: 'Select a valid reference type' },
      default: 'other',
    },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    serials: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SerialNo' }],
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
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    occurredAt: { type: Date, default: Date.now, index: true },
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

stockMovementSchema.index({ item: 1, occurredAt: -1 });
stockMovementSchema.index({ type: 1, occurredAt: -1 });
stockMovementSchema.index({ referenceType: 1, referenceId: 1 });
stockMovementSchema.index({ serials: 1 });
stockMovementSchema.index({ supplier: 1, occurredAt: -1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
