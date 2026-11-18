'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { WARRANTY_TYPES, WARRANTY_STATUSES } = require('../config/installations');

const warrantyClaimSchema = new mongoose.Schema(
  {
    claimNumber: {
      type: String,
      trim: true,
      default: '',
    },
    claimDate: {
      type: Date,
      default: Date.now,
    },
    issueDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    claimStatus: {
      type: String,
      enum: ['submitted', 'in_review', 'approved', 'rejected', 'replaced'],
      default: 'submitted',
    },
    oldSerial: {
      type: String,
      trim: true,
      default: '',
    },
    replacementSerial: {
      type: String,
      trim: true,
      default: '',
    },
    replacementSerialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SerialNo',
      default: null,
    },
    resolutionNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { _id: true, timestamps: true }
);

const warrantySchema = new mongoose.Schema(
  {
    warrantyNumber: {
      type: String,
      required: [true, 'Warranty number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Warranty number cannot exceed 30 characters'],
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null,
      index: true,
    },
    installation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Installation',
      default: null,
      index: true,
    },
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Covered item is required'],
      index: true,
    },
    serialNumber: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SerialNo',
      default: null,
      index: true,
    },
    serialString: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
      index: true,
    },
    warrantyType: {
      type: String,
      enum: WARRANTY_TYPES,
      required: [true, 'Warranty type is required'],
      index: true,
    },
    startDate: {
      type: Date,
      required: [true, 'Warranty start date is required'],
      index: true,
    },
    endDate: {
      type: Date,
      required: [true, 'Warranty end date is required'],
      index: true,
    },
    years: {
      type: Number,
      required: true,
      min: [0, 'Warranty duration cannot be negative'],
    },
    terms: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: WARRANTY_STATUSES,
      default: 'active',
      index: true,
    },
    claims: {
      type: [warrantyClaimSchema],
      default: [],
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

warrantySchema.index(
  { warrantyNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
warrantySchema.index({ customer: 1, status: 1 });
warrantySchema.index({ endDate: 1, status: 1 });

warrantySchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Warranty', warrantySchema);
