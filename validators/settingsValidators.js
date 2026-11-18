/** Company settings form validation. */
'use strict';

const { body } = require('express-validator');

const optionalTrimmed = (field, max) =>
  body(field).optional({ values: 'falsy' }).trim().isLength({ max });

const settingsRules = [
  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Company name is required.')
    .bail()
    .isLength({ max: 150 })
    .withMessage('Company name cannot exceed 150 characters.'),

  optionalTrimmed('legalName', 150)
    .withMessage('Legal name cannot exceed 150 characters.'),

  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Enter a valid company email address.')
    .toLowerCase(),

  body('website')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#][^\s]*)?$/i)
    .withMessage('Enter a valid website address.'),

  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9+\-()\s]{7,30}$/)
    .withMessage('Enter a valid phone number.'),

  body('phoneAlt')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9+\-()\s]{7,30}$/)
    .withMessage('Enter a valid alternate phone number.'),

  optionalTrimmed('address', 500).withMessage('Address cannot exceed 500 characters.'),
  optionalTrimmed('city', 80).withMessage('City cannot exceed 80 characters.'),
  optionalTrimmed('ntn', 30).withMessage('NTN cannot exceed 30 characters.'),
  optionalTrimmed('strn', 30).withMessage('STRN cannot exceed 30 characters.'),
  optionalTrimmed('bankName', 120).withMessage('Bank name cannot exceed 120 characters.'),
  optionalTrimmed('bankBranch', 120).withMessage('Bank branch cannot exceed 120 characters.'),
  optionalTrimmed('bankAccountTitle', 150).withMessage(
    'Account title cannot exceed 150 characters.'
  ),
  optionalTrimmed('bankAccountNumber', 60).withMessage(
    'Account number cannot exceed 60 characters.'
  ),
  optionalTrimmed('bankIban', 60).withMessage('IBAN cannot exceed 60 characters.'),
  optionalTrimmed('quotationTerms', 3000).withMessage(
    'Quotation terms cannot exceed 3000 characters.'
  ),
  optionalTrimmed('invoiceTerms', 3000).withMessage(
    'Invoice terms cannot exceed 3000 characters.'
  ),

  body('surveyMonthlyUnitsPerKw')
    .optional({ values: 'falsy' })
    .isFloat({ min: 1, max: 1000 })
    .withMessage('Monthly units per kW must be between 1 and 1,000.'),
  body('surveySizingBufferPercent')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 100 })
    .withMessage('Survey sizing buffer must be between 0% and 100%.'),
  body('surveySizeStepKw')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0.1, max: 10 })
    .withMessage('System-size step must be between 0.1 and 10 kW.'),

  body('minMarginPercent')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 100 })
    .withMessage('Minimum margin percent must be between 0% and 100%.'),
  body('maxDiscountPercentWithoutApproval')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 100 })
    .withMessage('Max discount percent without approval must be between 0% and 100%.'),

  body('businessDayStart')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('Business day start must be a valid time (HH:MM).'),
  body('businessDayEnd')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('Business day end must be a valid time (HH:MM).'),
  body('defaultOpeningFloat')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{1,9}(\.\d{1,2})?$/)
    .withMessage('Enter a valid opening float amount.'),

  body('removeLogo').optional().isIn(['0', '1']).withMessage('Invalid logo option.'),
];

module.exports = { settingsRules };
