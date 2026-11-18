'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const {
  MAINTENANCE_TYPES,
  MAINTENANCE_FREQUENCIES,
} = require('../config/installations');

const maintenanceScheduleSchema = new mongoose.Schema(
  {
    scheduleNumber: {
      type: String,
      required: [true, 'Schedule number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Schedule number cannot exceed 30 characters'],
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    installation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Installation',
      default: null,
      index: true,
    },
    serviceType: {
      type: String,
      enum: MAINTENANCE_TYPES,
      default: 'panel_cleaning',
      required: true,
      index: true,
    },
    frequency: {
      type: String,
      enum: MAINTENANCE_FREQUENCIES,
      default: 'quarterly',
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled service date is required'],
      index: true,
    },
    assignedTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    remindersSent: {
      type: Boolean,
      default: false,
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

maintenanceScheduleSchema.index(
  { scheduleNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
maintenanceScheduleSchema.index({ customer: 1, scheduledDate: 1 });

maintenanceScheduleSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('MaintenanceSchedule', maintenanceScheduleSchema);
