'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { CHEQUE_STATUSES } = require('../config/installments');

const chequeSchema = new mongoose.Schema(
  {
    chequeNumber: {
      type: String,
      required: [true, 'Cheque number is required'],
      trim: true,
      maxlength: [50, 'Cheque number cannot exceed 50 characters'],
      index: true,
    },
    bankName: {
      type: String,
      required: [true, 'Bank name is required'],
      trim: true,
      maxlength: [100, 'Bank name cannot exceed 100 characters'],
    },
    branch: {
      type: String,
      trim: true,
      default: '',
      maxlength: 100,
    },
    amountPaisa: {
      type: Number,
      required: [true, 'Cheque amount is required'],
      min: [1, 'Amount must be greater than zero'],
    },
    chequeDate: {
      type: Date,
      required: [true, 'Cheque maturity/issue date is required'],
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    /**
     * What the cheque is paying for. A cheque can be linked to a project/sale,
     * a POS order, an installment plan, or any combination of them.
     */
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null,
      index: true,
    },
    posSale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PosSale',
      default: null,
      index: true,
    },
    installmentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstallmentPlan',
      default: null,
      index: true,
    },
    installmentNumber: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: CHEQUE_STATUSES,
      default: 'held',
      index: true,
    },
    depositedAt: {
      type: Date,
      default: null,
    },
    clearedAt: {
      type: Date,
      default: null,
    },
    bouncedAt: {
      type: Date,
      default: null,
    },
    bounceReason: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
    receivedBy: {
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

chequeSchema.index({ customer: 1, chequeDate: 1 });
chequeSchema.index({ status: 1, chequeDate: 1 });
chequeSchema.index({ sale: 1, chequeDate: 1 });
chequeSchema.index({ posSale: 1, chequeDate: 1 });

chequeSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Cheque', chequeSchema);
