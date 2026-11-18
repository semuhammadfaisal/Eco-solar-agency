/**
 * Partner cash movement.
 *
 * Every row is a permanent ledger entry and posts a balanced double-entry
 * JournalEntry:
 *
 *   contribution : Debit cash/bank, Credit 3010 Owner's Equity
 *   drawing      : Debit 3030 Partner Drawings, Credit cash/bank
 *   expense      : Debit expense account, Credit 3010 Owner's Equity
 *
 * Amounts are integer paisa. Account code/name are snapshotted so history
 * still reads correctly if the chart of accounts is renamed later.
 */
'use strict';

const mongoose = require('mongoose');
const { PARTNER_TRANSACTION_TYPES } = require('../config/partners');
const softDeletePlugin = require('./plugins/softDelete');

const partnerTransactionSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: [true, 'Transaction reference is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [30, 'Reference cannot exceed 30 characters'],
    },
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: [true, 'Partner is required'],
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Transaction type is required'],
      enum: {
        values: PARTNER_TRANSACTION_TYPES,
        message: 'Select a valid partner transaction type',
      },
      index: true,
    },
    amountPaisa: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be greater than zero'],
      validate: {
        validator: Number.isInteger,
        message: 'Amount must be an integer paisa amount',
      },
    },
    date: {
      type: Date,
      required: [true, 'Transaction date is required'],
      default: Date.now,
      index: true,
    },
    /** Cash/bank account for contributions and drawings, expense account for expenses. */
    accountCode: {
      type: String,
      trim: true,
      default: '',
      maxlength: [20, 'Account code cannot exceed 20 characters'],
    },
    accountName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [150, 'Account name cannot exceed 150 characters'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    journalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
      index: true,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

partnerTransactionSchema.index({ partner: 1, date: -1, createdAt: -1 });
partnerTransactionSchema.index({ date: -1, createdAt: -1 });

partnerTransactionSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('PartnerTransaction', partnerTransactionSchema);
