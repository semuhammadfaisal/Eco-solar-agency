'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { PLAN_STATUSES, FREQUENCIES } = require('../config/installments');

const checklistItemSchema = new mongoose.Schema(
  {
    submitted: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { _id: false }
);

const chequeChecklistItemSchema = new mongoose.Schema(
  {
    submitted: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    count: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { _id: false }
);

const securityChecklistSchema = new mongoose.Schema(
  {
    stampAgreement: { type: checklistItemSchema, default: () => ({}) },
    customerCnicCopy: { type: checklistItemSchema, default: () => ({}) },
    guarantorCnicCopy: { type: checklistItemSchema, default: () => ({}) },
    utilityBillCopy: { type: checklistItemSchema, default: () => ({}) },
    promissoryNote: { type: checklistItemSchema, default: () => ({}) },
    postDatedCheques: { type: chequeChecklistItemSchema, default: () => ({ count: 0 }) },
    isComplete: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ownerOverride: {
      isOverridden: { type: Boolean, default: false },
      reason: { type: String, trim: true, default: '', maxlength: 500 },
      overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      overriddenAt: { type: Date, default: null },
    },
  },
  { _id: false }
);

const guarantorSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '', maxlength: 100 },
    cnic: { type: String, trim: true, default: '', maxlength: 20 },
    phone: { type: String, trim: true, default: '', maxlength: 30 },
    relation: { type: String, trim: true, default: '', maxlength: 50 },
    address: { type: String, trim: true, default: '', maxlength: 300 },
    workplace: { type: String, trim: true, default: '', maxlength: 150 },
    photos: { type: [String], default: [] },
  },
  { _id: false }
);

const rescheduleLogSchema = new mongoose.Schema(
  {
    rescheduledAt: { type: Date, default: Date.now },
    rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    oldScheduleSummary: { type: String, trim: true, default: '' },
    newScheduleSummary: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const installmentPlanSchema = new mongoose.Schema(
  {
    planNumber: {
      type: String,
      required: [true, 'Plan number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Plan number cannot exceed 30 characters'],
    },
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: [true, 'Linked sale contract is required'],
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },

    // Commercial Breakdown in Integer Paisa
    totalSaleAmountPaisa: {
      type: Number,
      required: [true, 'Sale total is required'],
      min: [0, 'Total cannot be negative'],
    },
    downPaymentPaisa: {
      type: Number,
      required: [true, 'Down payment is required'],
      min: [0, 'Down payment cannot be negative'],
    },
    downPaymentPaid: {
      type: Boolean,
      default: true,
    },
    downPaymentPaidAt: {
      type: Date,
      default: Date.now,
    },
    financedAmountPaisa: {
      type: Number,
      required: [true, 'Financed amount is required'],
      min: [0, 'Financed amount cannot be negative'],
    },

    // Markup Rules
    markupType: {
      type: String,
      enum: ['percent', 'fixed_amount'],
      default: 'percent',
    },
    markupRatePercent: {
      type: Number,
      default: 0,
      min: [0, 'Markup rate cannot be negative'],
      max: [200, 'Markup rate exceeds limit'],
    },
    markupPaisa: {
      type: Number,
      default: 0,
      min: [0, 'Markup amount cannot be negative'],
    },
    totalPayablePaisa: {
      type: Number,
      required: [true, 'Total payable is required'],
      min: [0, 'Total payable cannot be negative'],
    },

    // Schedule Parameters
    installmentCount: {
      type: Number,
      required: [true, 'Number of installments is required'],
      min: [1, 'Must have at least 1 installment'],
      max: [120, 'Exceeds maximum installment duration'],
    },
    installmentAmountPaisa: {
      type: Number,
      required: [true, 'Installment amount is required'],
      min: [0, 'Installment amount cannot be negative'],
    },
    frequency: {
      type: String,
      enum: FREQUENCIES,
      default: 'monthly',
    },
    startDate: {
      type: Date,
      required: [true, 'Schedule start date is required'],
    },

    // Late Fee Policy
    lateFeeRule: {
      graceDays: { type: Number, default: 5, min: 0 },
      type: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
      amountPaisa: { type: Number, default: 50000, min: 0 }, // 500 PKR default
      percent: { type: Number, default: 0, min: 0, max: 100 },
    },

    // Balances and Running Totals
    totalPaidPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalLateFeesAssessedPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalLateFeesPaidPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalLateFeesWaivedPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingBalancePaisa: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: PLAN_STATUSES,
      default: 'active',
      index: true,
    },

    // Field Officer / Collection Agent
    assignedOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // Security & Compliance
    securityChecklist: {
      type: securityChecklistSchema,
      default: () => ({}),
    },
    guarantor: {
      type: guarantorSchema,
      default: () => ({}),
    },

    // Recovery & Default Flagging
    isFlaggedForRecovery: {
      type: Boolean,
      default: false,
      index: true,
    },
    recoveryFlagNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
    recoveryFlaggedAt: {
      type: Date,
      default: null,
    },

    rescheduleHistory: {
      type: [rescheduleLogSchema],
      default: [],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [3000, 'Notes cannot exceed 3000 characters'],
    },
    createdBy: {
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

installmentPlanSchema.index(
  { planNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
installmentPlanSchema.index({ customer: 1, status: 1 });
installmentPlanSchema.index({ status: 1, remainingBalancePaisa: 1 });

installmentPlanSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('InstallmentPlan', installmentPlanSchema);
