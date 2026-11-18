'use strict';

const maintenanceService = require('../services/maintenanceService');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { ROLES } = require('../config/roles');
const { MAINTENANCE_TYPES, MAINTENANCE_FREQUENCIES } = require('../config/installations');

async function index(req, res, next) {
  try {
    const { schedules, total, pagination } = await maintenanceService.listMaintenance(
      req.query,
      req.user
    );

    const customers = await Customer.find({ deletedAt: null }).select('name code phone').lean();
    const technicians = await User.find({
      role: { $in: [ROLES.TECHNICIAN, ROLES.MANAGER, ROLES.OWNER] },
      isActive: true,
    }).lean();

    return res.render('maintenance/index', {
      title: 'Periodic Maintenance & Cleaning Schedules',
      schedules,
      total,
      pagination,
      customers,
      technicians,
      types: MAINTENANCE_TYPES,
      frequencies: MAINTENANCE_FREQUENCIES,
      filters: req.query,
      breadcrumbs: [
        { label: 'After-Sales & Service', url: '/maintenance' },
        { label: 'Maintenance Schedule', url: '/maintenance' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const mnt = await maintenanceService.createMaintenanceSchedule(req.body, req.user, req);

    req.flash('success', `Maintenance visit ${mnt.scheduleNumber} scheduled.`);
    return res.redirect('/maintenance');
  } catch (err) {
    next(err);
  }
}

async function complete(req, res, next) {
  try {
    const { notes } = req.body;
    await maintenanceService.completeMaintenance(req.params.id, notes, req.user, req);

    req.flash('success', 'Maintenance service marked completed.');
    return res.redirect('/maintenance');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  index,
  create,
  complete,
};
