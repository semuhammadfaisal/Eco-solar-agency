/**
 * Purchase order (PO) and its goods-received notes (GRN).
 *
 * Lifecycle:
 *   ordered  → PO created, no stock received
 *   partial  → at least one GRN, but some quantity is outstanding
 *   received → every line fully received
 *   cancelled→ PO cancelled before any receipt
 *
 * Line quantities and costs are snapshotted so later item edits cannot rewrite
 * purchase history. Receiving stock is handled by purchaseService, which
 * creates StockMovement rows and recalculates the item's moving average cost.
 */
'use strict';

const mongoose = require('mongoose');
const { PURCHASE_STATUSES, PAYMENT_STATUSES } = require('../config/inventory');
const softDeletePlugin = require('./plugins/softDelete');

const purchaseLineSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Select an item on every line'],
    },
    sku: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    unit: { type: String, trim: true, default: 'pcs' },
    qty: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0.0001, 'Quantity must be greater than zero'],
    },
    unitCostPaisa: {
      type: Number,
      required: [true, 'Unit cost is required'],
      min: [0, 'Unit cost cannot be negative'],
    },
    receivedQty: {
      type: Number,
      default: 0,
      min: [0, 'Received quantity cannot be negative'],
    },
    hasSerial: { type: Boolean, default: false },
  },
  { _id: true }
);

const receiptSchema = new mongoose.Schema(
  {
    number: { type: String, trim: true, required: true },
    receivedAt: { type: Date, required: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
    lines: [
      {
        _id: false,
        item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
        qty: { type: Number, default: 0 },
        unitCostPaisa: { type: Number, default: 0 },
      },
    ],
  },
  { _id: true }
);

const purchaseSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: [true, 'Purchase number is required'],
      trim: true,
      uppercase: true,
      maxlength: [24, 'Purchase number cannot exceed 24 characters'],
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: [true, 'Select a supplier'],
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    invoiceNo: {
      type: String,
      trim: true,
      default: '',
      maxlength: [60, 'Invoice number cannot exceed 60 characters'],
    },
    purchaseDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: { values: PURCHASE_STATUSES, message: 'Select a valid purchase status' },
      default: 'ordered',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: { values: PAYMENT_STATUSES, message: 'Select a valid payment status' },
      default: 'unpaid',
      index: true,
    },
    items: {
      type: [purchaseLineSchema],
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length > 0,
        message: 'Add at least one item to the purchase order',
      },
    },
    totalPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Purchase total cannot be negative'],
    },
    paidPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Paid amount cannot be negative'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    receipts: { type: [receiptSchema], default: [] },
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

purchaseSchema.index(
  { number: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
purchaseSchema.index({ supplier: 1, purchaseDate: -1 });
purchaseSchema.index({ status: 1, createdAt: -1 });
purchaseSchema.index({ createdAt: -1 });

purchaseSchema.virtual('outstandingPaisa').get(function outstandingPaisa() {
  return Math.max(0, Number(this.totalPaisa || 0) - Number(this.paidPaisa || 0));
});

purchaseSchema.virtual('isFullyReceived').get(function isFullyReceived() {
  return (
    Array.isArray(this.items) &&
    this.items.length > 0 &&
    this.items.every((line) => Number(line.receivedQty || 0) >= Number(line.qty || 0))
  );
});

purchaseSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Purchase', purchaseSchema);
