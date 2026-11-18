'use strict';

const { body } = require('express-validator');

const ptpRules = [
  body('installmentPlanId')
    .notEmpty()
    .withMessage('Installment plan is required.')
    .isMongoId()
    .withMessage('Invalid installment plan ID.'),

  body('customerId')
    .notEmpty()
    .withMessage('Customer is required.')
    .isMongoId()
    .withMessage('Invalid customer ID.'),

  body('promisedDate')
    .notEmpty()
    .withMessage('Promised payment date is required.')
    .isISO8601()
    .withMessage('Enter a valid promised payment date.'),

  body('promisedAmount')
    .notEmpty()
    .withMessage('Promised amount is required.')
    .isFloat({ min: 1 })
    .withMessage('Promised amount must be greater than zero.'),

  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes cannot exceed 1000 characters.'),
];

const noteRules = [
  body('customerId')
    .notEmpty()
    .withMessage('Customer is required.')
    .isMongoId()
    .withMessage('Invalid customer ID.'),

  body('installmentPlanId')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid installment plan ID.'),

  body('callOutcome')
    .notEmpty()
    .withMessage('Interaction outcome is required.')
    .isIn([
      'spoke_to_customer',
      'promise_to_pay',
      'call_not_answered',
      'phone_switched_off',
      'wrong_number',
      'dispute',
      'refused_to_pay',
      'site_visit',
    ])
    .withMessage('Invalid call outcome selected.'),

  body('notes')
    .notEmpty()
    .withMessage('Notes are required.')
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes cannot exceed 2000 characters.'),

  body('nextActionDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid next action date.'),
];

const manualSendRules = [
  body('channel')
    .notEmpty()
    .withMessage('Channel is required.')
    .isIn(['whatsapp', 'sms', 'email'])
    .withMessage('Invalid notification channel.'),

  body('recipientPhone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 10, max: 20 })
    .withMessage('Enter a valid phone number.'),

  body('recipientEmail')
    .optional({ values: 'falsy' })
    .isEmail()
    .withMessage('Enter a valid email address.'),

  body('body')
    .notEmpty()
    .withMessage('Message body is required.')
    .trim()
    .isLength({ max: 3000 })
    .withMessage('Message body cannot exceed 3000 characters.'),
];

module.exports = {
  ptpRules,
  noteRules,
  manualSendRules,
};
