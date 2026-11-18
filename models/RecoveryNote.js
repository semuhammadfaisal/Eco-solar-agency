'use strict';

const mongoose = require('mongoose');

const recoveryNoteSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    installmentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstallmentPlan',
      default: null,
      index: true,
    },
    officer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Officer recording note is required'],
      index: true,
    },
    callOutcome: {
      type: String,
      enum: [
        'spoke_to_customer',
        'promise_to_pay',
        'call_not_answered',
        'phone_switched_off',
        'wrong_number',
        'dispute',
        'refused_to_pay',
        'site_visit',
      ],
      default: 'spoke_to_customer',
    },
    notes: {
      type: String,
      required: [true, 'Interaction notes are required'],
      trim: true,
      maxlength: [2000, 'Notes cannot exceed 2000 characters'],
    },
    nextActionDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

recoveryNoteSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model('RecoveryNote', recoveryNoteSchema);
