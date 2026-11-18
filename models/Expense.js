'use strict';

/**
 * Expense Voucher Model.
 *
 * Tracks operating expenses (rent, fuel, wages, marketing, sundries)
 * paid from either Cash in Hand or Bank Alfalah. Linked automatically to
 * a double-entry JournalEntry.
 */

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const expenseSchema = new mongoose.Schema(
  {
    voucherNumber: {
      type: String,
      required: [true, 'Voucher number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [30, 'Voucher number cannot exceed 30 characters'],
    },
    date: {
      type: Date,
      required: [true, 'Expense date is required'],
      default: Date.now,
      index: true,
    },
    /**
     * Branch that paid this expense from its cash drawer. Legacy expenses have
     * no branch and are treated as main-branch expenses by daily closing.
     */
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    categoryAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Expense category account is required'],
      index: true,
    },
    paymentAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Payment account (Cash or Bank) is required'],
      index: true,
    },
    amountPaisa: {
      type: Number,
      required: [true, 'Expense amount is required'],
      min: [1, 'Amount must be greater than zero'],
      validate: {
        validator: Number.isInteger,
        message: 'Amount must be an integer paisa amount',
      },
    },
    payee: {
      type: String,
      required: [true, 'Payee name is required'],
      trim: true,
      maxlength: [150, 'Payee name cannot exceed 150 characters'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    receiptAttachment: {
      type: String,
      default: null,
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
      required: [true, 'Recorded by user is required'],
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

expenseSchema.plugin(softDeletePlugin);

expenseSchema.index({ date: -1, createdAt: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
