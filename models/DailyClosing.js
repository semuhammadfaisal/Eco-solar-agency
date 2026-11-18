'use strict';

/**
 * Daily Closing & Cash Drawer Reconciliation.
 *
 * One document per branch per business date. While the drawer is open the
 * summary is computed live from POS sales and cash expenses; closing freezes
 * the numbers, records the physical count and posts a Cash Over & Short
 * journal entry when the count differs from the expected drawer balance.
 *
 * All money is integer paisa. Closed drawers are immutable except through an
 * explicit owner/accountant reopen, which is recorded in reopenHistory.
 */

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const adjustmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['in', 'out'], required: true },
    amountPaisa: {
      type: Number,
      required: true,
      min: [1, 'Adjustment amount must be greater than zero'],
      validate: {
        validator: Number.isInteger,
        message: 'Adjustment amount must be an integer paisa amount',
      },
    },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    createdByName: { type: String, trim: true, default: '', maxlength: 150 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const denominationSchema = new mongoose.Schema(
  {
    valuePaisa: { type: Number, required: true, min: 1 },
    label: { type: String, trim: true, default: '', maxlength: 30 },
    count: { type: Number, required: true, min: 0 },
    totalPaisa: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Denomination total must be an integer paisa amount',
      },
    },
  },
  { _id: false }
);

const reopenSchema = new mongoose.Schema(
  {
    reopenedAt: { type: Date, default: Date.now },
    reopenedByName: { type: String, trim: true, default: '', maxlength: 150 },
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, trim: true, default: '', maxlength: 500 },
    previousCountedCashPaisa: { type: Number, default: null },
    previousVariancePaisa: { type: Number, default: 0 },
    previousClosedAt: { type: Date, default: null },
    previousClosedByName: { type: String, trim: true, default: '', maxlength: 150 },
    previousVarianceJournalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
    },
    reversalJournalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
    },
  },
  { _id: true }
);

const dailyClosingSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    branchCode: { type: String, trim: true, uppercase: true, default: '', maxlength: 20 },
    branchName: { type: String, trim: true, default: '', maxlength: 120 },

    /** Logical business date stored at UTC midnight, e.g. 2026-11-18T00:00:00Z. */
    businessDate: { type: Date, required: true, index: true },
    /** Actual wall-clock window covered by this drawer. */
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },

    // Opening cash
    openingFloatPaisa: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Opening float must be an integer paisa amount',
      },
    },
    openingFloatSource: {
      type: String,
      enum: ['previous', 'default', 'manual'],
      default: 'default',
    },

    // Frozen at close, refreshed live while the drawer is open.
    cashSalesPaisa: { type: Number, default: 0, min: 0 },
    cashExpensesPaisa: { type: Number, default: 0, min: 0 },
    cashInPaisa: { type: Number, default: 0, min: 0 },
    cashOutPaisa: { type: Number, default: 0, min: 0 },
    expectedCashPaisa: { type: Number, default: 0 },

    // Physical count
    countedCashPaisa: { type: Number, default: null, min: 0 },
    variancePaisa: { type: Number, default: 0 },
    varianceReason: { type: String, trim: true, default: '', maxlength: 500 },
    denominations: { type: [denominationSchema], default: [] },

    // Who closed the drawer and when
    closedByName: { type: String, trim: true, default: '', maxlength: 150 },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByRole: { type: String, trim: true, default: '', maxlength: 30 },
    closedAt: { type: Date, default: null },

    closingNotes: { type: String, trim: true, default: '', maxlength: 1000 },

    // Variance journal (6070 Cash Over & Short)
    varianceJournalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
    },

    adjustments: { type: [adjustmentSchema], default: [] },

    reopenedAt: { type: Date, default: null },
    reopenedByName: { type: String, trim: true, default: '', maxlength: 150 },
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reopenCount: { type: Number, default: 0, min: 0 },
    reopenHistory: { type: [reopenSchema], default: [] },

    /** Snapshot of the sales mix, useful for reporting without re-querying. */
    summary: {
      saleCount: { type: Number, default: 0, min: 0 },
      cashSaleCount: { type: Number, default: 0, min: 0 },
      bankSaleCount: { type: Number, default: 0, min: 0 },
      creditSaleCount: { type: Number, default: 0, min: 0 },
      expenseCount: { type: Number, default: 0, min: 0 },
      salesTotalPaisa: { type: Number, default: 0, min: 0 },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

dailyClosingSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
dailyClosingSchema.index(
  { branch: 1, businessDate: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
dailyClosingSchema.index({ branch: 1, businessDate: -1 });
dailyClosingSchema.index({ status: 1, businessDate: -1 });

dailyClosingSchema.plugin(softDeletePlugin);

/** True when the drawer can no longer be edited without an explicit reopen. */
dailyClosingSchema.virtual('isClosed').get(function isClosed() {
  return this.status === 'closed';
});

/** Human-readable variance label, e.g. "Short by PKR 250". */
dailyClosingSchema.virtual('varianceLabel').get(function varianceLabel() {
  if (this.status !== 'closed' || !this.variancePaisa) return 'Balanced';
  return this.variancePaisa > 0 ? 'Over' : 'Short';
});

module.exports = mongoose.model('DailyClosing', dailyClosingSchema);
