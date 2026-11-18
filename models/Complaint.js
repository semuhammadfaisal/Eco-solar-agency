'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const {
  COMPLAINT_TYPES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  COMPLAINT_SLA_HOURS,
} = require('../config/installations');

const partUsedSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    serialNumber: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SerialNo',
      default: null,
    },
    serialString: {
      type: String,
      trim: true,
      default: '',
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const complaintSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: [true, 'Ticket number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Ticket number cannot exceed 30 characters'],
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null,
      index: true,
    },
    installation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Installation',
      default: null,
      index: true,
    },
    issueType: {
      type: String,
      enum: COMPLAINT_TYPES,
      required: [true, 'Issue type is required'],
      index: true,
    },
    priority: {
      type: String,
      enum: COMPLAINT_PRIORITIES,
      default: 'medium',
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Complaint description is required'],
      trim: true,
      maxlength: [3000, 'Description cannot exceed 3000 characters'],
    },
    photos: {
      type: [String],
      default: [],
    },
    assignedTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    visitDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: COMPLAINT_STATUSES,
      default: 'open',
      index: true,
    },
    slaHours: {
      type: Number,
      default: function () {
        return COMPLAINT_SLA_HOURS[this.priority] || 72;
      },
    },
    targetResolutionDate: {
      type: Date,
      default: function () {
        const sla = this.slaHours || COMPLAINT_SLA_HOURS[this.priority] || 72;
        const base = this.createdAt ? new Date(this.createdAt) : new Date();
        return new Date(base.getTime() + sla * 60 * 60 * 1000);
      },
      index: true,
    },
    isUnderWarranty: {
      type: Boolean,
      default: true,
      index: true,
    },
    serviceChargePaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    partsUsed: {
      type: [partUsedSchema],
      default: [],
    },
    resolutionNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Resolution notes cannot exceed 2000 characters'],
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    customerFeedback: {
      rating: { type: Number, min: 1, max: 5, default: null },
      comment: { type: String, trim: true, default: '' },
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

complaintSchema.virtual('isSlaBreached').get(function () {
  if (['resolved', 'closed'].includes(this.status)) {
    if (!this.resolvedAt || !this.targetResolutionDate) return false;
    return new Date(this.resolvedAt) > new Date(this.targetResolutionDate);
  }
  if (!this.targetResolutionDate) return false;
  return new Date() > new Date(this.targetResolutionDate);
});

complaintSchema.pre('validate', function (next) {
  if (this.priority && (!this.slaHours || this.isModified('priority'))) {
    this.slaHours = COMPLAINT_SLA_HOURS[this.priority] || 72;
  }
  if (!this.targetResolutionDate && this.slaHours) {
    const base = this.createdAt ? new Date(this.createdAt) : new Date();
    this.targetResolutionDate = new Date(base.getTime() + this.slaHours * 60 * 60 * 1000);
  }
  next();
});

complaintSchema.index(
  { ticketNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
complaintSchema.index({ customer: 1, status: 1 });
complaintSchema.index({ assignedTechnician: 1, status: 1 });

complaintSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Complaint', complaintSchema);
