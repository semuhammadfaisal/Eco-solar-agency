'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const messageTemplateSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: [true, 'Template slug identifier is required'],
      trim: true,
      unique: true,
      maxlength: [60, 'Slug cannot exceed 60 characters'],
    },
    title: {
      type: String,
      required: [true, 'Template title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    category: {
      type: String,
      enum: ['installment_reminder', 'cheque_alert', 'recovery_escalation', 'general'],
      default: 'installment_reminder',
      index: true,
    },
    channel: {
      type: String,
      enum: ['whatsapp', 'sms', 'email', 'all'],
      default: 'all',
    },
    preferredLanguage: {
      type: String,
      enum: ['english', 'urdu', 'roman_urdu'],
      default: 'roman_urdu',
    },
    englishBody: {
      type: String,
      trim: true,
      default: '',
      maxlength: [3000, 'English message cannot exceed 3000 characters'],
    },
    urduBody: {
      type: String,
      trim: true,
      default: '',
      maxlength: [3000, 'Urdu message cannot exceed 3000 characters'],
    },
    romanUrduBody: {
      type: String,
      trim: true,
      default: '',
      maxlength: [3000, 'Roman Urdu message cannot exceed 3000 characters'],
    },
    emailSubject: {
      type: String,
      trim: true,
      default: '',
      maxlength: [200, 'Subject cannot exceed 200 characters'],
    },
    defaultVariables: {
      type: [String],
      default: ['name', 'amount', 'dueDate', 'balance', 'installmentNumber', 'planNumber', 'companyName'],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    updatedBy: {
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

messageTemplateSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);
