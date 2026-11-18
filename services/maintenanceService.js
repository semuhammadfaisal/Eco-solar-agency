'use strict';

const mongoose = require('mongoose');
const MaintenanceSchedule = require('../models/MaintenanceSchedule');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { paginate, escapeRegex } = require('../utils/pagination');
const { text } = require('../utils/inputs');

async function nextScheduleNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`maintenance_${year}`);
  return `MNT-${year}-${String(seq).padStart(4, '0')}`;
}

async function createMaintenanceSchedule(payload, actor, req) {
  if (!mongoose.isValidObjectId(payload.customer)) {
    throw ApiError.badRequest('Valid customer is required.');
  }
  if (!payload.scheduledDate) {
    throw ApiError.badRequest('Scheduled date is required.');
  }

  const scheduleNumber = await nextScheduleNumber();

  const mnt = await MaintenanceSchedule.create({
    scheduleNumber,
    customer: payload.customer,
    installation: payload.installation || null,
    serviceType: payload.serviceType || 'panel_cleaning',
    frequency: payload.frequency || 'quarterly',
    scheduledDate: new Date(payload.scheduledDate),
    assignedTechnician: payload.assignedTechnician || null,
    notes: text(payload.notes, 1000),
    status: 'scheduled',
    createdBy: actor ? actor._id : null,
  });

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.MAINTENANCE_SCHEDULED,
      'maintenance',
      mnt._id,
      {},
      { scheduleNumber, serviceType: mnt.serviceType },
      { req, description: `Scheduled maintenance: ${scheduleNumber}` }
    );
  }

  return mnt;
}

async function completeMaintenance(scheduleId, notes = '', actor, req) {
  const mnt = await MaintenanceSchedule.findById(scheduleId);
  if (!mnt) throw ApiError.notFound('Maintenance schedule not found.');

  mnt.status = 'completed';
  mnt.completedAt = new Date();
  if (notes) mnt.notes = (mnt.notes ? mnt.notes + '\n' : '') + text(notes, 500);
  await mnt.save();

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.MAINTENANCE_COMPLETED,
      'maintenance',
      mnt._id,
      {},
      { status: 'completed' },
      { req, description: `Completed maintenance: ${mnt.scheduleNumber}` }
    );
  }

  return mnt;
}

async function listMaintenance(filters = {}, user) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const query = { deletedAt: null };

  if (filters.status) query.status = filters.status;
  if (filters.serviceType) query.serviceType = filters.serviceType;
  if (filters.customer && mongoose.isValidObjectId(filters.customer)) {
    query.customer = filters.customer;
  }
  if (filters.search) {
    const s = escapeRegex(filters.search);
    query.scheduleNumber = new RegExp(s, 'i');
  }

  const [total, schedules] = await Promise.all([
    MaintenanceSchedule.countDocuments(query),
    MaintenanceSchedule.find(query)
      .populate('customer', 'name phone code city address')
      .populate('assignedTechnician', 'name phone')
      .populate('installation', 'installationNumber')
      .sort({ scheduledDate: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    schedules,
    total,
    pagination: paginate(total, page, limit),
  };
}

module.exports = {
  nextScheduleNumber,
  createMaintenanceSchedule,
  completeMaintenance,
  listMaintenance,
};
