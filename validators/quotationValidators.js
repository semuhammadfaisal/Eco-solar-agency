'use strict';

const { body } = require('express-validator');
const { QUOTATION_STATUSES, PAYMENT_OPTIONS } = require('../config/quotations');
const { DISCOUNT_TYPES } = require('../config/systems');
const { CUSTOMER_TYPES, CUSTOMER_SOURCES } = require('../config/crm');

// Missing customerMode means the classic "existing customer" flow.
const creatingNewCustomer = (_value, { req }) =>
  Boolean(req.body && req.body.customerMode === 'new');
const usingExistingCustomer = (_value, { req }) => !creatingNewCustomer(_value, { req });

const quotationRules = [
  body('customerMode')
    .optional({ values: 'falsy' })
    .isIn(['existing', 'new'])
    .withMessage('Choose an existing customer or create a new one.'),

  // Existing customer
  body('customer')
    .if(usingExistingCustomer)
    .trim()
    .notEmpty()
    .withMessage('Select a valid customer.')
    .bail()
    .isMongoId()
    .withMessage('Invalid customer identifier.'),

  // New customer
  body('name')
    .if(creatingNewCustomer)
    .trim()
    .notEmpty()
    .withMessage('Customer name is required.')
    .bail()
    .isLength({ max: 120 })
    .withMessage('Customer name cannot exceed 120 characters.'),

  body('phone')
    .if(creatingNewCustomer)
    .trim()
    .notEmpty()
    .withMessage('Customer phone number is required.')
    .bail()
    .matches(/^[0-9+\-()\s]{7,20}$/)
    .withMessage('Enter a valid phone number.'),

  body('whatsapp')
    .if(creatingNewCustomer)
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9+\-()\s]{7,20}$/)
    .withMessage('Enter a valid WhatsApp number.'),

  body('cnic')
    .if(creatingNewCustomer)
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{5}-?\d{7}-?\d$/)
    .withMessage('Enter a valid CNIC (12345-1234567-1).'),

  body('address')
    .if(creatingNewCustomer)
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 250 })
    .withMessage('Address cannot exceed 250 characters.'),

  body('city')
    .if(creatingNewCustomer)
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 })
    .withMessage('City cannot exceed 80 characters.'),

  body('customerType')
    .if(creatingNewCustomer)
    .optional({ values: 'falsy' })
    .isIn(CUSTOMER_TYPES)
    .withMessage('Select a valid customer type.'),

  body('customerSource')
    .if(creatingNewCustomer)
    .optional({ values: 'falsy' })
    .isIn(CUSTOMER_SOURCES)
    .withMessage('Select a valid lead source.'),

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
