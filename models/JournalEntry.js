'use strict';

/**
 * Double-Entry Journal Entry Model.
 *
 * Fundamental invariant of double-entry accounting:
 *   Sum of all line debits MUST EXACTLY EQUAL sum of all line credits.
 * All amounts are stored as integer paisa (1 PKR = 100 paisa).
 */

const mongoose = require('mongoose');
const { REFERENCE_TYPES } = require('../config/accounting');
const softDeletePlugin = require('./plugins/softDelete');

const journalLineSchema = new mongoose.Schema(
  {
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account is required'],
    },
    accountCode: {
      type: String,
      required: [true, 'Account code is required'],
      trim: true,
    },
    accountName: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
    },
    debitPaisa: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Debit cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Debit must be an integer paisa amount',
      },
    },
    creditPaisa: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Credit cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Credit must be an integer paisa amount',
      },
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [300, 'Line description cannot exceed 300 characters'],
    },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    entryNumber: {
      type: String,
      required: [true, 'Journal entry number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [35, 'Entry number cannot exceed 35 characters'],
    },
    date: {
      type: Date,
      required: [true, 'Entry date is required'],
      default: Date.now,
      index: true,
    },
    referenceType: {
      type: String,
      required: [true, 'Reference type is required'],
      enum: {
        values: Object.values(REFERENCE_TYPES),
        message: 'Invalid reference type',
      },
      index: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    memo: {
      type: String,
      required: [true, 'Memo / description is required'],
      trim: true,
      maxlength: [500, 'Memo cannot exceed 500 characters'],
    },
    lines: {
      type: [journalLineSchema],
      required: true,
      validate: [
        {
          validator: function (lines) {
            return Array.isArray(lines) && lines.length >= 2;
          },
          message: 'Journal entry must contain at least 2 lines',
        },
        {
          validator: function (lines) {
            if (!Array.isArray(lines)) return false;
            let sumDebit = 0;
            let sumCredit = 0;
            for (const l of lines) {
              sumDebit += l.debitPaisa || 0;
              sumCredit += l.creditPaisa || 0;
            }
            return sumDebit === sumCredit && sumDebit > 0;
          },
          message: 'Unbalanced journal entry: Total Debits must equal Total Credits',
        },
      ],
    },
    totalDebitPaisa: {
      type: Number,
      default: function () {
        if (!Array.isArray(this.lines)) return 0;
        return this.lines.reduce((s, l) => s + (l.debitPaisa || 0), 0);
      },
      min: [1, 'Total debit must be greater than zero'],
      validate: {
        validator: Number.isInteger,
        message: 'Total debit must be an integer paisa amount',
      },
    },
    totalCreditPaisa: {
      type: Number,
      default: function () {
        if (!Array.isArray(this.lines)) return 0;
        return this.lines.reduce((s, l) => s + (l.creditPaisa || 0), 0);
      },
      min: [1, 'Total credit must be greater than zero'],
      validate: {
        validator: Number.isInteger,
        message: 'Total credit must be an integer paisa amount',
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

journalEntrySchema.plugin(softDeletePlugin);

// Ensure debits strictly equal credits on validation
journalEntrySchema.pre('validate', function (next) {
  if (Array.isArray(this.lines) && this.lines.length > 0) {
    let sumDebit = 0;
    let sumCredit = 0;
    for (const line of this.lines) {
      sumDebit += line.debitPaisa || 0;
      sumCredit += line.creditPaisa || 0;
    }
    this.totalDebitPaisa = sumDebit;
    this.totalCreditPaisa = sumCredit;

    if (sumDebit !== sumCredit) {
      return next(
        new Error(
          `Unbalanced journal entry: Total Debits (${sumDebit}) must equal Total Credits (${sumCredit})`
        )
      );
    }
  }
  next();
});

journalEntrySchema.index({ date: -1, createdAt: -1 });
journalEntrySchema.index({ 'lines.account': 1, date: -1 });
journalEntrySchema.index({ referenceType: 1, referenceId: 1 });

module.exports = mongoose.model('JournalEntry', journalEntrySchema);
