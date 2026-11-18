/** New project form validation. */
'use strict';

const { body } = require('express-validator');
const { toPaisa } = require('../utils/money');
const { SYSTEM_TYPES } = require('../config/systems');
const { PAYMENT_OPTIONS } = require('../config/quotations');

function moneyRule(field, label, { required = true } = {}) {
  const rule = body(field).trim();
  if (!required) {
    rule.optional({ values: 'falsy' });
  } else {
    rule.notEmpty().withMessage(`${label} is required.`).bail();
  }
  return rule.custom((value) => {
    if (value === undefined || value === null || value === '') return true;
    let paisa;
    try {
      paisa = toPaisa(String(value));
    } catch (_err) {
      throw new Error(`Enter a valid ${label.toLowerCase()}.`);
    }
    if (paisa < 0 || (required && paisa === 0)) {
      throw new Error(`Enter a valid ${label.toLowerCase()}.`);
    }
    return true;
  });
}

const createProjectRules = [
  body('customerMode')
    .optional({ values: 'falsy' })
    .isIn(['existing', 'new'])
    .withMessage('Choose an existing customer or create a new one.'),

  // Existing customer
  body('customer')
    .if(body('customerMode').equals('existing'))
    .trim()
    .notEmpty()
    .withMessage('Select an existing customer.')
    .bail()
    .isMongoId()
    .withMessage('Select a valid customer.'),

  // New customer
  body('name')
    .if(body('customerMode').equals('new'))
    .trim()
    .notEmpty()
    .withMessage('Customer name is required.')
    .bail()
    .isLength({ max: 120 })
    .withMessage('Customer name cannot exceed 120 characters.'),
  body('phone')
    .if(body('customerMode').equals('new'))
    .trim()
    .notEmpty()
    .withMessage('Customer phone number is required.')
    .bail()
    .matches(/^[0-9+\-()\s]{7,20}$/)
    .withMessage('Enter a valid phone number.'),
  body('whatsapp')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9+\-()\s]{7,20}$/)
    .withMessage('Enter a valid WhatsApp number.'),
  body('cnic')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{5}-?\d{7}-?\d$/)
    .withMessage('Enter a valid CNIC (12345-1234567-1).'),
  body('address').optional().trim().isLength({ max: 250 }).withMessage('Address cannot exceed 250 characters.'),
  body('city').optional().trim().isLength({ max: 80 }).withMessage('City cannot exceed 80 characters.'),
  body('area').optional().trim().isLength({ max: 80 }).withMessage('Area cannot exceed 80 characters.'),

  // Project
  body('projectTitle')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('Project title cannot exceed 120 characters.'),
  body('capacityKw')
    .trim()
    .notEmpty()
    .withMessage('System capacity is required.')
    .bail()
    .isFloat({ gt: 0 })
    .withMessage('System capacity must be greater than zero.'),
  body('systemType').trim().isIn(SYSTEM_TYPES).withMessage('Select a valid system type.'),
  body('panelCount')
    .optional({ values: 'falsy' })
    .isInt({ min: 0 })
    .withMessage('Panel count must be a whole number.'),
  body('inverterCapacityKw')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Inverter capacity must be zero or more.'),
  body('batteryCapacityKwh')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Battery capacity must be zero or more.'),
  body('startDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid start date.'),

  // Commercials
  moneyRule('amount', 'Contract amount'),
  moneyRule('estimatedCost', 'Estimated project cost', { required: false }),
  body('paymentType').trim().isIn(PAYMENT_OPTIONS).withMessage('Select a valid payment type.'),
  body('milestoneLabel.*').optional().trim().isLength({ max: 120 }).withMessage('Milestone label cannot exceed 120 characters.'),
  body('milestonePercent.*')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 100 })
    .withMessage('Milestone percentage must be between 0 and 100.'),
  body('milestoneDueDate.*')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid milestone due date.'),

  body('assignedTo')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Select a valid salesperson.'),
  body('notes').optional().trim().isLength({ max: 3000 }).withMessage('Notes cannot exceed 3000 characters.'),
];

module.exports = { createProjectRules };
