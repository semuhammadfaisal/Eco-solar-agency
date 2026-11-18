/**
 * Employee profile linked one-to-one with a User account.
 *
 * Salary is stored as integer paisa. Commission is stored as integer basis
 * points (250 bps = 2.5%) so no floating-point rate is ever persisted.
 */
'use strict';

const mongoose = require('mongoose');
const { EMPLOYEE_STATUSES } = require('../config/crm');
const softDeletePlugin = require('./plugins/softDelete');

const employeeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Select a staff account to link'],
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true,
      maxlength: [100, 'Designation cannot exceed 100 characters'],
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
    salaryPaisa: {
      type: Number,
      required: true,
      min: [0, 'Salary cannot be negative'],
      default: 0,
    },
    joiningDate: {
      type: Date,
      required: [true, 'Joining date is required'],
    },
    commissionRateBps: {
      type: Number,
      default: 0,
      min: [0, 'Commission rate cannot be negative'],
      max: [10000, 'Commission rate cannot exceed 100%'],
    },
    status: {
      type: String,
      enum: { values: EMPLOYEE_STATUSES, message: 'Select a valid employee status' },
      default: 'active',
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

// One live employee profile per staff account.
employeeSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
employeeSchema.index({ designation: 1 });
employeeSchema.index({ status: 1 });
employeeSchema.index({ createdAt: -1 });

employeeSchema.virtual('commissionRatePercent').get(function commissionRatePercent() {
  return Number(this.commissionRateBps || 0) / 100;
});

employeeSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Employee', employeeSchema);
