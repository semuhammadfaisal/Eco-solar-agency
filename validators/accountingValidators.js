'use strict';

/**
 * Validation rules for accounting, expenses, supplier payments, and journals.
 */

const { body } = require('express-validator');

const createExpenseRules = [
  body('categoryAccountCode')
    .notEmpty()
    .withMessage('Expense category account is required.')
    .trim(),

  body('paymentAccountCode')
    .notEmpty()
    .withMessage('Payment account (Cash or Bank) is required.')
    .isIn(['1010', '1020'])
    .withMessage('Payment account must be Cash in Hand (1010) or Bank Alfalah (1020).'),

  body('amount')
    .notEmpty()
    .withMessage('Expense amount is required.')
    .custom((val) => {
      const num = parseFloat(String(val).replace(/,/g, ''));
      if (isNaN(num) || num <= 0) {
        throw new Error('Expense amount must be greater than zero.');
      }
      return true;
    }),

  body('payee')
    .notEmpty()
    .withMessage('Payee name is required.')
    .trim()
    .isLength({ max: 150 })
    .withMessage('Payee name cannot exceed 150 characters.'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),

  body('date')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid expense date.'),
];

const createSupplierPaymentRules = [
  body('supplierId')
    .notEmpty()
    .withMessage('Supplier is required.')
    .isMongoId()
    .withMessage('Invalid supplier ID.'),

  body('amount')
    .notEmpty()
    .withMessage('Payment amount is required.')
    .custom((val) => {
      const num = parseFloat(String(val).replace(/,/g, ''));
      if (isNaN(num) || num <= 0) {
        throw new Error('Payment amount must be greater than zero.');
      }
      return true;
    }),

  body('paymentAccountCode')
    .notEmpty()
    .withMessage('Payment account is required.')
    .isIn(['1010', '1020'])
    .withMessage('Payment account must be Cash in Hand (1010) or Bank Alfalah (1020).'),

  body('reference')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Reference cannot exceed 100 characters.'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),
];

const disburseSalaryRules = [
  body('employeeId')
    .notEmpty()
    .withMessage('Employee is required.')
    .isMongoId()
    .withMessage('Invalid employee ID.'),

  body('amount')
    .notEmpty()
    .withMessage('Disbursement amount is required.')
    .custom((val) => {
      const num = parseFloat(String(val).replace(/,/g, ''));
      if (isNaN(num) || num <= 0) {
        throw new Error('Disbursement amount must be greater than zero.');
      }
      return true;
    }),

  body('paymentAccountCode')
    .notEmpty()
    .withMessage('Payment account is required.')
    .isIn(['1010', '1020'])
    .withMessage('Payment account must be Cash (1010) or Bank (1020).'),

  body('disbursementType')
    .optional()
    .isIn(['salary', 'commission'])
    .withMessage('Disbursement type must be salary or commission.'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),
];

module.exports = {
  createExpenseRules,
  createSupplierPaymentRules,
  disburseSalaryRules,
};
