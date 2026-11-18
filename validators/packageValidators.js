'use strict';

const { body } = require('express-validator');
const { SYSTEM_TYPES } = require('../config/systems');

const packageRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Package name is required.')
    .isLength({ max: 150 })
    .withMessage('Package name cannot exceed 150 characters.'),

  body('systemType')
    .isIn(SYSTEM_TYPES)
    .withMessage('Select a valid system type.'),

  body('capacityKw')
    .isFloat({ min: 0.1, max: 100000 })
    .withMessage('Capacity must be between 0.1 kW and 100,000 kW.'),

  body('code')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 30 })
    .withMessage('Code cannot exceed 30 characters.'),

  body('description')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters.'),

  body('laborCost')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9,.\s]*$/)
    .withMessage('Enter a valid labor cost amount.'),

  body('transportCost')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9,.\s]*$/)
    .withMessage('Enter a valid transport cost amount.'),

  body('netMeteringCost')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9,.\s]*$/)
    .withMessage('Enter a valid net-metering cost amount.'),

  body('defaultDiscountPercent')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 100 })
    .withMessage('Default discount must be between 0% and 100%.'),
];

module.exports = { packageRules };
