'use strict';

const mongoose = require('mongoose');

const appNotificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    type: {
      type: String,
      enum: ['cheque_due', 'low_stock', 'warranty_expiry', 'broken_promise', 'overdue_installment', 'system'],
      default: 'system',
      index: true,
    },
    link: {
      type: String,
      trim: true,
      default: '',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    forUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

appNotificationSchema.index({ isRead: 1, createdAt: -1 });
appNotificationSchema.index({ forUser: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('AppNotification', appNotificationSchema);
