'use strict';

const { body } = require('express-validator');
const { PAYMENT_METHODS, CHEQUE_STATUSES, FREQUENCIES } = require('../config/installments');

const planRules = [
  body('sale')
    .notEmpty()
    .withMessage('Sale contract is required.')
    .isMongoId()
    .withMessage('Invalid sale identifier.'),

  body('downPayment')
    .notEmpty()
    .withMessage('Down payment is required.')
    .isFloat({ min: 0 })
    .withMessage('Down payment cannot be negative.'),

  body('installmentCount')
    .notEmpty()
    .withMessage('Number of installments is required.')
    .isInt({ min: 1, max: 120 })
    .withMessage('Number of installments must be between 1 and 120.'),

  body('frequency')
    .optional()
    .isIn(FREQUENCIES)
    .withMessage('Invalid installment frequency.'),

  body('startDate')
    .notEmpty()
    .withMessage('Schedule start date is required.')
    .isISO8601()
    .withMessage('Enter a valid schedule start date.'),

  body('markupRatePercent')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 200 })
    .withMessage('Markup percent must be between 0 and 200%.'),

  body('markupFixedAmount')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Markup fixed amount cannot be negative.'),
];

const paymentRules = [
  body('planId')
    .notEmpty()
    .withMessage('Installment plan is required.')
    .isMongoId()
    .withMessage('Invalid plan identifier.'),

  body('amount')
    .notEmpty()
    .withMessage('Payment amount is required.')
    .isFloat({ min: 1 })
    .withMessage('Payment amount must be greater than zero.'),

  body('paymentMethod')
    .notEmpty()
    .withMessage('Payment method is required.')
    .isIn(PAYMENT_METHODS)
    .withMessage('Select a valid payment method.'),

  body('paymentDate')
    .optional()
    .isISO8601()
    .withMessage('Enter a valid payment date.'),

  body('reference')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Reference cannot exceed 100 characters.'),
];

const rescheduleRules = [
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A mandatory reason is required to reschedule installment plans.')
    .isLength({ max: 500 })
    .withMessage('Reason cannot exceed 500 characters.'),

  body('newStartDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid new start date.'),
];

const waiverRules = [
  body('amount')
    .notEmpty()
    .withMessage('Waiver amount is required.')
    .isFloat({ min: 1 })
    .withMessage('Waiver amount must be greater than zero.'),

  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A mandatory reason is required to waive late fees.')
    .isLength({ max: 500 })
    .withMessage('Reason cannot exceed 500 characters.'),
];

const chequeCreateRules = [
  body('chequeNumber')
    .trim()
    .notEmpty()
    .withMessage('Cheque number is required.')
    .isLength({ max: 50 })
    .withMessage('Cheque number cannot exceed 50 characters.'),

  body('bankName')
    .trim()
    .notEmpty()
    .withMessage('Bank name is required.')
    .isLength({ max: 100 })
    .withMessage('Bank name cannot exceed 100 characters.'),

  body('branch')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Branch cannot exceed 100 characters.'),

  body('amount')
    .notEmpty()
    .withMessage('Cheque amount is required.')
    .matches(/^(?:PKR|Rs\.?)?\s*\d[\d,]*(?:\.\d{1,2})?$/i)
    .withMessage('Enter a valid cheque amount greater than zero.'),

  body('chequeDate')
    .notEmpty()
    .withMessage('Cheque date is required.')
    .isISO8601()
    .withMessage('Enter a valid cheque date.'),

  body('customer')
    .notEmpty()
    .withMessage('Select the customer who issued the cheque.')
    .isMongoId()
    .withMessage('Invalid customer identifier.'),

  body('sale')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid project / sale identifier.'),

  body('posSale')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid POS order identifier.'),

  body('installmentPlan')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid installment plan identifier.'),

  body('installmentNumber')
    .optional({ values: 'falsy' })
    .isInt({ min: 1 })
    .withMessage('Installment number must be a positive whole number.'),

  body('status')
    .optional({ values: 'falsy' })
    .isIn(CHEQUE_STATUSES)
    .withMessage('Select a valid cheque status.'),

  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes cannot exceed 1000 characters.'),
];

const chequeStatusRules = [
  body('status')
    .notEmpty()
    .withMessage('Status is required.')
    .isIn(CHEQUE_STATUSES)
    .withMessage('Select a valid cheque status.'),

  body('bounceReason')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bounce reason cannot exceed 500 characters.'),
];

const overrideRules = [
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A mandatory reason is required for owner security override.')
    .isLength({ max: 500 })
    .withMessage('Reason cannot exceed 500 characters.'),
];

module.exports = {
  planRules,
  paymentRules,
  rescheduleRules,
  waiverRules,
  chequeCreateRules,
  chequeStatusRules,
  overrideRules,
};
