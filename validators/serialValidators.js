/** Serial registry validation. */
'use strict';

const { body } = require('express-validator');
const { SERIAL_STATUSES } = require('../config/inventory');
const { SERIAL_PATTERN, BARCODE_PATTERN } = require('../utils/serials');

const serialStatusRules = [
  body('status').trim().isIn(SERIAL_STATUSES).withMessage('Select a valid serial status.'),
  body('customer').optional({ values: 'falsy' }).isMongoId().withMessage('Select a valid customer.'),
  body('project').optional().trim().isLength({ max: 120 }).withMessage('Project cannot exceed 120 characters.'),
  body('location').optional().trim().isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters.'),
  body('note').optional().trim().isLength({ max: 300 }).withMessage('Note cannot exceed 300 characters.'),
];

const serialCreateRules = [
  body('item')
    .trim()
    .notEmpty()
    .withMessage('Select a product.')
    .bail()
    .isMongoId()
    .withMessage('Select a valid product.'),
  body('serials')
    .trim()
    .notEmpty()
    .withMessage('Enter at least one serial number.')
    .bail()
    .isLength({ max: 20000 })
    .withMessage('The serial list is too long. Register at most 500 units at a time.'),
  body('branch').optional({ values: 'falsy' }).isMongoId().withMessage('Select a valid branch.'),
  body('supplier').optional({ values: 'falsy' }).isMongoId().withMessage('Select a valid supplier.'),
  body('unitCost').optional({ values: 'falsy' }).trim(),
  body('location').optional().trim().isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters.'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters.'),
];

const serialUpdateRules = [
  body('item')
    .trim()
    .notEmpty()
    .withMessage('Select a product.')
    .bail()
    .isMongoId()
    .withMessage('Select a valid product.'),
  body('serial')
    .trim()
    .notEmpty()
    .withMessage('Serial number is required.')
    .bail()
    .matches(SERIAL_PATTERN)
    .withMessage('Serial must be 2–60 characters using letters, digits and . _ / - only.'),
  body('barcode')
    .optional({ values: 'falsy' })
    .trim()
    .matches(BARCODE_PATTERN)
    .withMessage('Barcode must be 2–80 characters using letters, digits and . _ / + : # - only.'),
  body('supplier').optional({ values: 'falsy' }).isMongoId().withMessage('Select a valid supplier.'),
  body('location').optional().trim().isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters.'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters.'),
];

module.exports = { serialStatusRules, serialCreateRules, serialUpdateRules };
