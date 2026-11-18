'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { PAYMENT_METHODS } = require('../config/installments');

const paymentAllocationSchema = new mongoose.Schema(
  {
    installment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Installment',
      required: true,
    },
    installmentNumber: {
      type: Number,
      required: true,
    },
    principalPaidPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    lateFeePaidPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAllocatedPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    wasFullySettled: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const installmentPaymentSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: [true, 'Receipt number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Receipt number cannot exceed 30 characters'],
    },
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
    amountPaisa: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [1, 'Payment amount must be greater than zero'],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'cash',
    },
    reference: {
      type: String,
      trim: true,
      default: '',
      maxlength: 100,
    },
    bankName: {
      type: String,
      trim: true,
      default: '',
      maxlength: 100,
    },
    allocations: {
      type: [paymentAllocationSchema],
      default: [],
    },
    excessAdvancePaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingPlanBalancePaisa: {
      type: Number,
      default: 0,
    },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Staff member recording receipt is required'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

installmentPaymentSchema.index(
  { receiptNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
installmentPaymentSchema.index({ customer: 1, paymentDate: -1 });
installmentPaymentSchema.index({ installmentPlan: 1, paymentDate: -1 });

installmentPaymentSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('InstallmentPayment', installmentPaymentSchema);
