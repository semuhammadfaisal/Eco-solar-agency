'use strict';

const { body } = require('express-validator');
const { SYSTEM_TYPES, DISCOUNT_TYPES } = require('../config/systems');

const systemConfigRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('System name is required.')
    .isLength({ max: 180 })
    .withMessage('System name cannot exceed 180 characters.'),

  body('systemType')
    .isIn(SYSTEM_TYPES)
    .withMessage('Select a valid system type.'),

  body('discountType')
    .optional()
    .isIn(DISCOUNT_TYPES)
    .withMessage('Invalid discount type.'),

  body('discountValue')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Discount value cannot be negative.'),

  body('salesCommissionRateBps')
    .optional({ values: 'falsy' })
    .isInt({ min: 0, max: 10000 })
    .withMessage('Commission cannot exceed 100% (10,000 bps).'),

  body('remarks')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 3000 })
    .withMessage('Remarks cannot exceed 3000 characters.'),
];

const approvalRules = [
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Approval notes cannot exceed 1000 characters.'),
];

module.exports = { systemConfigRules, approvalRules };
