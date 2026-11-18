/**
 * Serialised stock unit.
 *
 * A serial row is created during a GRN (one row per received unit). Its
 * `events` array is the full audit-friendly history of status changes, shown
 * on the serial search page. Serial numbers are unique among live rows.
 */
'use strict';

const mongoose = require('mongoose');
const { SERIAL_STATUSES } = require('../config/inventory');
const softDeletePlugin = require('./plugins/softDelete');

const serialEventSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: { values: SERIAL_STATUSES, message: 'Select a valid serial status' },
      required: true,
    },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true, default: '', maxlength: 300 },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    project: { type: String, trim: true, default: '', maxlength: 120 },
    reference: { type: String, trim: true, default: '', maxlength: 120 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const serialSchema = new mongoose.Schema(
  {
    serial: {
      type: String,
      required: [true, 'Serial number is required'],
      trim: true,
      uppercase: true,
      maxlength: [60, 'Serial number cannot exceed 60 characters'],
    },
    /** Optional barcode / QR payload printed on the same unit label. */
    barcode: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      maxlength: [80, 'Barcode cannot exceed 80 characters'],
    },
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Item is required'],
      index: true,
    },
    purchase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Purchase',
      default: null,
      index: true,
    },
    purchaseLineId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: { values: SERIAL_STATUSES, message: 'Select a valid serial status' },
      default: 'in_stock',
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    project: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'Project cannot exceed 120 characters'],
    },
    location: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'Location cannot exceed 100 characters'],
    },
    receivedAt: { type: Date, default: null },
    productWarrantyEnd: { type: Date, default: null },
    performanceWarrantyEnd: { type: Date, default: null },
    issuedAt: { type: Date, default: null },
    installedAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    events: { type: [serialEventSchema], default: [] },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Notes cannot exceed 500 characters'],
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

serialSchema.index(
  { serial: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
// Barcodes are optional, so only stored strings take part in the unique index.
serialSchema.index(
  { barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null, barcode: { $type: 'string' } },
  }
);
serialSchema.index({ item: 1, status: 1 });
serialSchema.index({ status: 1, createdAt: -1 });
serialSchema.index({ customer: 1, createdAt: -1 });

serialSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('SerialNo', serialSchema);
