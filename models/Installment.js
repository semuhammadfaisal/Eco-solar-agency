'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { INSTALLMENT_STATUSES } = require('../config/installments');

const installmentSchema = new mongoose.Schema(
  {
    installmentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstallmentPlan',
      required: [true, 'Installment plan is required'],
      index: true,
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
    installmentNumber: {
      type: Number,
      required: [true, 'Installment number is required'],
      min: [1, 'Installment number must be positive'],
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
      index: true,
    },
    amountPaisa: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    paidAmountPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Paid amount cannot be negative'],
    },
    lateFeeAssessedPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Late fee cannot be negative'],
    },
    lateFeePaidPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Paid late fee cannot be negative'],
    },
    lateFeeWaivedPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Waived late fee cannot be negative'],
    },
    status: {
      type: String,
      enum: INSTALLMENT_STATUSES,
      default: 'pending',
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

installmentSchema.virtual('balanceDuePaisa').get(function () {
  const totalDue = (this.amountPaisa || 0) + (this.lateFeeAssessedPaisa || 0);
  const totalSettled = (this.paidAmountPaisa || 0) + (this.lateFeePaidPaisa || 0) + (this.lateFeeWaivedPaisa || 0);
  return Math.max(0, totalDue - totalSettled);
});

installmentSchema.index({ installmentPlan: 1, installmentNumber: 1 });
installmentSchema.index({ dueDate: 1, status: 1 });
installmentSchema.index({ customer: 1, dueDate: 1 });

installmentSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Installment', installmentSchema);
