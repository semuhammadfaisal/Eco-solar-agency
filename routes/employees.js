/**
 * Employee routes.
 * Owner manages employee profiles; owner and manager can view profiles,
 * mark attendance and read the monthly summary.
 */
'use strict';

const express = require('express');
const employeeController = require('../controllers/employeeController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const {
  createEmployeeRules,
  updateEmployeeRules,
  attendanceDateRule,
} = require('../validators/employeeValidators');

const router = express.Router();

router.use(isAuthenticated);

router.get('/', requirePermission('employees.view'), employeeController.index);

// Attendance screens must be declared before parameterised routes.
router.get(
  '/attendance/summary',
  requirePermission('attendance.view'),
  employeeController.attendanceSummary
);
router.get(
  '/attendance',
  requirePermission('attendance.view'),
  employeeController.attendance
);
router.post(
  '/attendance',
  requirePermission('attendance.manage'),
  attendanceDateRule,
  validate,
  employeeController.saveAttendance
);

router.get('/new', requirePermission('employees.manage'), employeeController.newForm);
router.post(
  '/',
  requirePermission('employees.manage'),
  createEmployeeRules,
  validate,
  employeeController.create
);

router.get(
  '/:id/edit',
  requirePermission('employees.manage'),
  employeeController.editForm
);
router.put(
  '/:id',
  requirePermission('employees.manage'),
  updateEmployeeRules,
  validate,
  employeeController.update
);
router.delete(
  '/:id',
  requirePermission('employees.manage'),
  employeeController.destroy
);

module.exports = router;
