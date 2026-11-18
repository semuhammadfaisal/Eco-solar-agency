/** Daily closing & cash drawer form validation. */
'use strict';

const { body } = require('express-validator');

const businessDateRule = body('businessDate')
  .optional({ values: 'falsy' })
  .trim()
  .matches(/^\d{4}-\d{2}-\d{2}$/)
  .withMessage('Select a valid business date.');

const amountRule = (field, label) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{1,9}(\.\d{1,2})?$/)
    .withMessage(`Enter a valid ${label}.`);

const adjustmentRules = [
  businessDateRule,
  body('kind')
    .trim()
    .isIn(['in', 'out'])
    .withMessage('Choose whether cash is coming in or going out.'),
  body('amount')
    .trim()
    .notEmpty()
    .withMessage('Enter the cash amount.')
    .bail()
    .matches(/^\d{1,9}(\.\d{1,2})?$/)
    .withMessage('Enter a valid cash amount.'),
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A reason is required for every cash adjustment.')
    .bail()
    .isLength({ min: 3, max: 300 })
    .withMessage('The reason must be between 3 and 300 characters.'),
];

const closeRules = [
  businessDateRule,
  body('countedCash')
    .trim()
    .notEmpty()
    .withMessage('Enter the physical cash count.')
    .bail()
    .matches(/^\d{1,9}(\.\d{1,2})?$/)
    .withMessage('Enter a valid physical cash count.'),
  body('closedByName')
    .trim()
    .notEmpty()
    .withMessage('Enter the name of the person closing the drawer.')
    .bail()
    .isLength({ max: 150 })
    .withMessage('The closer name cannot exceed 150 characters.'),
  body('varianceReason')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('The variance reason cannot exceed 500 characters.'),
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Closing notes cannot exceed 1,000 characters.'),
];

const quickCloseRules = [
  ...closeRules,
  amountRule('cashIn', 'cash-in amount'),
  body('cashInReason')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 })
    .withMessage('The cash-in reason cannot exceed 300 characters.'),
  amountRule('cashOut', 'cash-out amount'),
  body('cashOutReason')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 })
    .withMessage('The cash-out reason cannot exceed 300 characters.'),
];

const reopenRules = [
  businessDateRule,
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A reopen reason is required.')
    .bail()
    .isLength({ min: 5, max: 500 })
    .withMessage('The reopen reason must be between 5 and 500 characters.'),
];

module.exports = {
  adjustmentRules,
  closeRules,
  quickCloseRules,
  reopenRules,
};
