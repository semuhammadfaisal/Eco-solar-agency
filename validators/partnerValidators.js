/** Partner and partner cash record form validation. */
'use strict';

const { body } = require('express-validator');
const { toPaisa } = require('../utils/money');
const { parseDateKey } = require('../utils/dates');
const {
  PARTNER_TRANSACTION_TYPES,
  PARTNER_PAYMENT_CODES,
} = require('../config/partners');
const { EXPENSE_CATEGORIES } = require('../config/accounting');

const EXPENSE_CODES = EXPENSE_CATEGORIES.map((category) => category.code);

const partnerRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Partner name is required.')
    .bail()
    .isLength({ max: 150 })
    .withMessage('Partner name cannot exceed 150 characters.'),
  body('equity')
    .trim()
    .notEmpty()
    .withMessage('Equity share is required.')
    .bail()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Equity share must be between 0% and 100%.'),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 30 })
    .withMessage('Phone cannot exceed 30 characters.'),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Enter a valid email address.')
    .bail()
    .isLength({ max: 150 })
    .withMessage('Email cannot exceed 150 characters.'),
  body('cnic')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{5}-?\d{7}-?\d$/)
    .withMessage('Enter a valid CNIC (12345-1234567-1).'),
  body('address')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 })
    .withMessage('Address cannot exceed 300 characters.'),
  body('joinedAt')
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
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes cannot exceed 1000 characters.'),
];

const partnerTransactionRules = [
  body('type')
    .trim()
    .isIn(PARTNER_TRANSACTION_TYPES)
    .withMessage('Select a valid transaction type.'),
  body('amount')
    .trim()
    .notEmpty()
    .withMessage('Amount is required.')
    .bail()
    .custom((value) => {
      try {
        if (toPaisa(value) <= 0) throw new Error('invalid');
        return true;
      } catch (_err) {
        throw new Error('Enter an amount greater than zero.');
      }
    }),
  body('date')
    .optional({ values: 'falsy' })
    .trim()
    .custom((value) => {
      if (!parseDateKey(String(value).slice(0, 10))) {
        throw new Error('Enter a valid transaction date.');
      }
      return true;
    }),
  body('paymentAccountCode')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(PARTNER_PAYMENT_CODES)
    .withMessage('Select a valid cash or bank account.'),
  body('expenseAccountCode')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(EXPENSE_CODES)
    .withMessage('Select a valid expense category.'),
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),
];

module.exports = {
  partnerRules,
  partnerTransactionRules,
};
