'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const promiseToPaySchema = new mongoose.Schema(
  {
    installmentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstallmentPlan',
      required: [true, 'Installment plan is required'],
      index: true,
    },
    installment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Installment',
      default: null,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    promisedDate: {
      type: Date,
      required: [true, 'Promised payment date is required'],
      index: true,
    },
    promisedAmountPaisa: {
      type: Number,
      required: [true, 'Promised amount is required'],
      min: [1, 'Promised amount must be greater than zero'],
    },
    status: {
      type: String,
      enum: ['pending', 'kept', 'broken'],
      default: 'pending',
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Officer recording promise is required'],
    },
    keptAt: {
      type: Date,
      default: null,
    },
    brokenAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

promiseToPaySchema.index({ customer: 1, promisedDate: 1 });
promiseToPaySchema.index({ status: 1, promisedDate: 1 });

promiseToPaySchema.plugin(softDeletePlugin);

module.exports = mongoose.model('PromiseToPay', promiseToPaySchema);
