'use strict';

const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema(
  {
    recipientCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    recipientPhone: {
      type: String,
      trim: true,
      default: '',
    },
    recipientEmail: {
      type: String,
      trim: true,
      default: '',
    },
    channel: {
      type: String,
      enum: ['whatsapp', 'sms', 'email'],
      required: true,
      index: true,
    },
    stage: {
      type: String,
      required: true,
      index: true,
    },
    installment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Installment',
      default: null,
      index: true,
    },
    installmentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstallmentPlan',
      default: null,
      index: true,
    },
    cheque: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cheque',
      default: null,
    },
    subject: {
      type: String,
      trim: true,
      default: '',
    },
    body: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      enum: ['english', 'urdu', 'roman_urdu'],
      default: 'roman_urdu',
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed', 'dry_run'],
      default: 'sent',
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    responsePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    errorMessage: {
      type: String,
      trim: true,
      default: '',
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

notificationLogSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
