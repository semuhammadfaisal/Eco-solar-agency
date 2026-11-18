'use strict';

const { body } = require('express-validator');
const {
  SURVEY_STATUSES,
  ROOF_TYPES,
  DIRECTIONS,
  SHADING_LEVELS,
  STRUCTURE_TYPES,
  PHASES,
  METER_TYPES,
  SYSTEM_TYPES,
} = require('../config/surveys');

const optionalEnum = (field, values, label) =>
  body(field).optional({ values: 'falsy' }).isIn(values).withMessage(`Select a valid ${label}.`);
const optionalNumber = (field, label, max = 10000000) =>
  body(field).optional({ values: 'falsy' }).isFloat({ min: 0, max }).withMessage(`${label} must be between 0 and ${max}.`);

const surveyRules = [
  body('customer').notEmpty().withMessage('Select a customer.').isMongoId().withMessage('Select a valid customer.'),
  body('surveyor').isMongoId().withMessage('Select an active surveyor.'),
  body('scheduledAt').isISO8601().withMessage('Enter a valid scheduled date and time.'),
  optionalEnum('status', SURVEY_STATUSES, 'survey status'),
  optionalEnum('roofType', ROOF_TYPES, 'roof type'),
  optionalNumber('roofAreaSqFt', 'Roof area'),
  optionalEnum('direction', DIRECTIONS, 'roof direction'),
  optionalNumber('tiltDegrees', 'Tilt', 90),
  optionalEnum('shading', SHADING_LEVELS, 'shading level'),
  optionalEnum('structureType', STRUCTURE_TYPES, 'structure type'),
  optionalNumber('floorHeight', 'Floor height', 500),
  optionalNumber('sanctionedLoadKw', 'Sanctioned load', 100000),
  optionalEnum('phase', PHASES, 'phase'),
  optionalEnum('meterType', METER_TYPES, 'meter type'),
  optionalNumber('cableDistanceMeters', 'Cable distance', 100000),
  optionalNumber('recommendedKw', 'Recommended system size', 100000),
  optionalEnum('systemType', SYSTEM_TYPES, 'system type'),
  body('monthlyUnits.*').optional({ values: 'falsy' }).isFloat({ min: 0, max: 10000000 }).withMessage('Monthly units must be valid positive numbers.'),
  body('monthlyBills.*').optional({ values: 'falsy' }).isFloat({ min: 0, max: 1000000000 }).withMessage('Monthly bill amounts must be valid positive numbers.'),
  body('remarks').optional().trim().isLength({ max: 3000 }).withMessage('Remarks cannot exceed 3,000 characters.'),
];

module.exports = { createSurveyRules: surveyRules, updateSurveyRules: surveyRules };
