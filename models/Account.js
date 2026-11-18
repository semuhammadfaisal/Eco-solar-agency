'use strict';

/**
 * Chart of Accounts (COA) Model.
 *
 * Defines the standard financial accounts for double-entry bookkeeping.
 * Normal balance dictates whether debits or credits increase the balance.
 */

const mongoose = require('mongoose');
const { ACCOUNT_TYPES, NORMAL_BALANCES } = require('../config/accounting');
const softDeletePlugin = require('./plugins/softDelete');

const accountSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Account code is required'],
      unique: true,
      trim: true,
      maxlength: [20, 'Account code cannot exceed 20 characters'],
    },
    name: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
      maxlength: [150, 'Account name cannot exceed 150 characters'],
    },
    type: {
      type: String,
      required: [true, 'Account type is required'],
      enum: {
        values: Object.values(ACCOUNT_TYPES),
        message: 'Invalid account type',
      },
      index: true,
    },
    subtype: {
      type: String,
      trim: true,
      default: '',
      maxlength: [50, 'Subtype cannot exceed 50 characters'],
    },
    normalBalance: {
      type: String,
      required: [true, 'Normal balance is required'],
      enum: {
        values: Object.values(NORMAL_BALANCES),
        message: 'Normal balance must be debit or credit',
      },
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

accountSchema.plugin(softDeletePlugin);

// Helper virtual to check if account is debit normal
accountSchema.virtual('isDebitNormal').get(function () {
  return this.normalBalance === NORMAL_BALANCES.DEBIT;
});

module.exports = mongoose.model('Account', accountSchema);
