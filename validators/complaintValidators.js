'use strict';

const { body } = require('express-validator');
const { COMPLAINT_TYPES, COMPLAINT_PRIORITIES } = require('../config/installations');

const createComplaintRules = [
  body('customer')
    .notEmpty()
    .withMessage('Customer is required.')
    .isMongoId()
    .withMessage('Invalid customer ID.'),

  body('issueType')
    .notEmpty()
    .withMessage('Issue type is required.')
    .isIn(COMPLAINT_TYPES)
    .withMessage('Invalid issue type selected.'),

  body('priority')
    .optional()
    .isIn(COMPLAINT_PRIORITIES)
    .withMessage('Invalid priority selected.'),

  body('description')
    .notEmpty()
    .withMessage('Description is required.')
    .trim()
    .isLength({ max: 3000 })
    .withMessage('Description cannot exceed 3000 characters.'),
];

const assignTechnicianRules = [
  body('technicianId')
    .notEmpty()
    .withMessage('Technician is required.')
    .isMongoId()
    .withMessage('Invalid technician ID.'),

  body('visitDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid visit date.'),
];

const resolveComplaintRules = [
  body('resolutionNotes')
    .notEmpty()
    .withMessage('Resolution notes are required.')
    .trim()
    .isLength({ max: 2000 }),

  body('serviceCharge')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Service charge must be a non-negative number.'),
];

module.exports = {
  createComplaintRules,
  assignTechnicianRules,
  resolveComplaintRules,
};
