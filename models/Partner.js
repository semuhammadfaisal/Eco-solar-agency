/**
 * Business partner.
 *
 * Equity is stored as integer basis points (10000 bps = 100%) so a share such
 * as 33.33% is exact and the active partners can never silently exceed 100%.
 * The service enforces that rule on every save.
 *
 * A partner is never hard-deleted: transactions stay linked for audit, so a
 * partner with history must be deactivated instead of removed.
 */
'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const partnerSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Partner code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [20, 'Partner code cannot exceed 20 characters'],
    },
    name: {
      type: String,
      required: [true, 'Partner name is required'],
      trim: true,
      maxlength: [150, 'Partner name cannot exceed 150 characters'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      maxlength: [30, 'Phone cannot exceed 30 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      maxlength: [150, 'Email cannot exceed 150 characters'],
    },
    cnic: {
      type: String,
      trim: true,
      default: '',
      maxlength: [15, 'CNIC cannot exceed 15 characters'],
      validate: {
        validator: (value) => !value || /^\d{5}-?\d{7}-?\d$/.test(value),
        message: 'Enter a valid CNIC (12345-1234567-1)',
      },
    },
    address: {
      type: String,
      trim: true,
      default: '',
      maxlength: [300, 'Address cannot exceed 300 characters'],
    },
    /** Equity share in basis points: 5000 = 50.00%. */
    equityBps: {
      type: Number,
      required: [true, 'Equity share is required'],
      default: 0,
      min: [0, 'Equity share cannot be negative'],
      max: [10000, 'Equity share cannot exceed 100%'],
      validate: {
        validator: Number.isInteger,
        message: 'Equity share must be a whole basis point value',
      },
    },
    joinedAt: {
      type: Date,
      required: [true, 'Joining date is required'],
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
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

partnerSchema.index({ name: 1 });
partnerSchema.index({ createdAt: -1 });

partnerSchema.virtual('equityPercent').get(function equityPercentVirtual() {
  return Number((Number(this.equityBps || 0) / 100).toFixed(2));
});

partnerSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Partner', partnerSchema);
