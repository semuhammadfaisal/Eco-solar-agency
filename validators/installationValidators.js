'use strict';

const { body } = require('express-validator');

const createInstallationRules = [
  body('saleId')
    .notEmpty()
    .withMessage('Sale ID is required.')
    .isMongoId()
    .withMessage('Invalid sale identifier.'),

  body('leadTechnician')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid lead technician ID.'),

  body('scheduledStartDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid scheduled start date.'),
];

const scheduleRules = [
  body('leadTechnician')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid lead technician ID.'),

  body('scheduledStartDate')
    .notEmpty()
    .withMessage('Scheduled start date is required.')
    .isISO8601()
    .withMessage('Enter a valid scheduled start date.'),

  body('scheduledEndDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid scheduled end date.'),
];

const signoffRules = [
  body('signedBy')
    .notEmpty()
    .withMessage('Signer customer name is required.')
    .trim()
    .isLength({ max: 120 }),

  body('signerCnic')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 20 }),

  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5 stars.'),

  body('feedback')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 }),
];

module.exports = {
  createInstallationRules,
  scheduleRules,
  signoffRules,
};
