/**
 * Daily attendance record.
 *
 * `date` is normalised to UTC midnight for a company-timezone day (see
 * utils/dates.js). One live row per employee per day.
 */
'use strict';

const mongoose = require('mongoose');
const { ATTENDANCE_STATUSES } = require('../config/crm');
const softDeletePlugin = require('./plugins/softDelete');

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee is required'],
    },
    date: {
      type: Date,
      required: [true, 'Attendance date is required'],
    },
    status: {
      type: String,
      enum: { values: ATTENDANCE_STATUSES, message: 'Select a valid attendance status' },
      required: [true, 'Attendance status is required'],
    },
    checkIn: {
      type: String,
      trim: true,
      default: '',
      maxlength: [10, 'Check-in time cannot exceed 10 characters'],
    },
    checkOut: {
      type: String,
      trim: true,
      default: '',
      maxlength: [10, 'Check-out time cannot exceed 10 characters'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [300, 'Notes cannot exceed 300 characters'],
    },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

attendanceSchema.index(
  { employee: 1, date: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
attendanceSchema.index({ date: -1 });
attendanceSchema.index({ status: 1 });

attendanceSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Attendance', attendanceSchema);
