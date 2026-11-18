/** Customer form validation. */
'use strict';

const { body } = require('express-validator');
const {
  CUSTOMER_TYPES,
  CUSTOMER_SOURCES,
  DISCO_COMPANIES,
} = require('../config/crm');

const nameRule = body('name')
  .trim()
  .notEmpty()
  .withMessage('Customer name is required.')
  .bail()
  .isLength({ max: 120 })
  .withMessage('Name cannot exceed 120 characters.');

const phoneRule = body('phone')
  .trim()
  .notEmpty()
  .withMessage('Phone number is required.')
  .bail()
  .matches(/^[0-9+\-()\s]{7,20}$/)
  .withMessage('Enter a valid phone number.');

const whatsappRule = body('whatsapp')
  .optional({ values: 'falsy' })
  .trim()
  .matches(/^[0-9+\-()\s]{7,20}$/)
  .withMessage('Enter a valid WhatsApp number.');

const cnicRule = body('cnic')
  .optional({ values: 'falsy' })
  .trim()
  .matches(/^\d{5}-?\d{7}-?\d$/)
  .withMessage('Enter a valid CNIC (12345-1234567-1).');

const gpsRules = [
  body('gpsLat')
    .optional({ values: 'falsy' })
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90.'),
  body('gpsLng')
    .optional({ values: 'falsy' })
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180.'),
  body().custom((_value, { req }) => {
    const hasLat = req.body.gpsLat !== undefined && req.body.gpsLat !== '';
    const hasLng = req.body.gpsLng !== undefined && req.body.gpsLng !== '';
    if (hasLat !== hasLng) {
      throw new Error('Enter both GPS latitude and longitude, or leave both blank.');
    }
    return true;
  }),
];

const customerRules = [
  nameRule,
  phoneRule,
  whatsappRule,
  cnicRule,
  body('address').optional().trim().isLength({ max: 250 }).withMessage('Address cannot exceed 250 characters.'),
  body('city').optional().trim().isLength({ max: 80 }).withMessage('City cannot exceed 80 characters.'),
  body('area').optional().trim().isLength({ max: 80 }).withMessage('Area cannot exceed 80 characters.'),
  ...gpsRules,
  body('electricityReferenceNo')
    .optional()
    .trim()
    .isLength({ max: 60 })
    .withMessage('Electricity reference number cannot exceed 60 characters.'),
  body('disco')
    .optional({ values: 'falsy' })
    .isIn(DISCO_COMPANIES)
    .withMessage('Select a valid DISCO.'),
  body('type').trim().isIn(CUSTOMER_TYPES).withMessage('Select a valid customer type.'),
  body('source').trim().isIn(CUSTOMER_SOURCES).withMessage('Select a valid source.'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
  body('assignedTo').optional({ values: 'falsy' }).isMongoId().withMessage('Select a valid staff member.'),
];

module.exports = {
  createCustomerRules: customerRules,
  updateCustomerRules: customerRules,
};
