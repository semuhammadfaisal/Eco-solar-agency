/** Employee and attendance form validation. */
'use strict';

const { body } = require('express-validator');
const { toPaisa } = require('../utils/money');
const { parseDateKey } = require('../utils/dates');
const { EMPLOYEE_STATUSES } = require('../config/crm');

const salaryRule = body('salary')
  .trim()
  .notEmpty()
  .withMessage('Salary is required.')
  .bail()
  .custom((value) => {
    try {
      if (toPaisa(value) < 0) throw new Error('negative');
      return true;
    } catch (_err) {
      throw new Error('Enter a valid salary amount.');
    }
  });

const employeeRules = [
  body('user').trim().notEmpty().withMessage('Select a staff account.').bail().isMongoId().withMessage('Select a valid staff account.'),
  body('designation')
    .trim()
    .notEmpty()
    .withMessage('Designation is required.')
    .bail()
    .isLength({ max: 100 })
    .withMessage('Designation cannot exceed 100 characters.'),
  body('cnic')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{5}-?\d{7}-?\d$/)
    .withMessage('Enter a valid CNIC (12345-1234567-1).'),
  salaryRule,
  body('joiningDate')
    .trim()
    .notEmpty()
    .withMessage('Joining date is required.')
    .bail()
    .custom((value) => {
      if (!parseDateKey(String(value).slice(0, 10))) {
        throw new Error('Enter a valid joining date.');
      }
      return true;
    }),
  body('commissionRate')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 100 })
    .withMessage('Commission rate must be between 0% and 100%.'),
  body('status').trim().isIn(EMPLOYEE_STATUSES).withMessage('Select a valid employee status.'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
];

const attendanceDateRule = body('date')
  .trim()
  .notEmpty()
  .withMessage('Attendance date is required.')
  .bail()
  .custom((value) => {
    if (!parseDateKey(value)) throw new Error('Enter a valid attendance date.');
    return true;
  });

module.exports = {
  createEmployeeRules: employeeRules,
  updateEmployeeRules: employeeRules,
  attendanceDateRule,
};
