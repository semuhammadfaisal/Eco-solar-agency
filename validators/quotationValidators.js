'use strict';

const { body } = require('express-validator');
const { QUOTATION_STATUSES, PAYMENT_OPTIONS } = require('../config/quotations');
const { DISCOUNT_TYPES } = require('../config/systems');

const quotationRules = [
  body('customer')
    .notEmpty()
    .withMessage('Select a valid customer.')
    .isMongoId()
    .withMessage('Invalid customer identifier.'),

  body('validUntil')
    .notEmpty()
    .withMessage('Validity date is required.')
    .isISO8601()
    .withMessage('Enter a valid date.'),

  body('paymentOption')
    .optional()
    .isIn(PAYMENT_OPTIONS)
    .withMessage('Select a valid payment option.'),

  body('discountType')
    .optional()
    .isIn(DISCOUNT_TYPES)
    .withMessage('Invalid discount type.'),

  body('discountValue')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Discount cannot be negative.'),

  body('terms')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 4000 })
    .withMessage('Terms cannot exceed 4000 characters.'),

  body('warrantyTerms')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Warranty terms cannot exceed 2000 characters.'),
];

const statusRules = [
  body('status')
    .isIn(QUOTATION_STATUSES)
    .withMessage('Select a valid status.'),

  body('reason')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Reason cannot exceed 500 characters.'),
];

const emailRules = [
  body('recipientEmail')
    .trim()
    .notEmpty()
    .withMessage('Recipient email is required.')
    .isEmail()
    .withMessage('Enter a valid recipient email address.')
    .toLowerCase(),

  body('subject')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Subject cannot exceed 200 characters.'),

  body('message')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 3000 })
    .withMessage('Message cannot exceed 3000 characters.'),
];

module.exports = { quotationRules, statusRules, emailRules };
