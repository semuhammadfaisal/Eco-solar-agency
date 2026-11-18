/** Supplier form validation. */
'use strict';

const { body } = require('express-validator');
const { toPaisa } = require('../utils/money');

const supplierRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Supplier name is required.')
    .bail()
    .isLength({ max: 150 })
    .withMessage('Supplier name cannot exceed 150 characters.'),
  body('company').optional().trim().isLength({ max: 150 }).withMessage('Company cannot exceed 150 characters.'),
  body('contactName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('Contact person cannot exceed 120 characters.'),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9+\-()\s]{7,20}$/)
    .withMessage('Enter a valid phone number.'),
  body('whatsapp')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9+\-()\s]{7,20}$/)
    .withMessage('Enter a valid WhatsApp number.'),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Enter a valid email address.'),
  body('address').optional().trim().isLength({ max: 250 }).withMessage('Address cannot exceed 250 characters.'),
  body('city').optional().trim().isLength({ max: 80 }).withMessage('City cannot exceed 80 characters.'),
  body('ntn').optional().trim().isLength({ max: 30 }).withMessage('NTN cannot exceed 30 characters.'),
  body('paymentTermsDays')
    .optional({ values: 'falsy' })
    .isInt({ min: 0, max: 365 })
    .withMessage('Payment terms must be between 0 and 365 days.'),
  body('openingBalance')
    .optional({ values: 'falsy' })
    .trim()
    .custom((value) => {
      try {
        if (toPaisa(value) < 0) throw new Error('negative');
        return true;
      } catch (_err) {
        throw new Error('Enter a valid opening balance.');
      }
    }),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
];

module.exports = {
  createSupplierRules: supplierRules,
  updateSupplierRules: supplierRules,
};
