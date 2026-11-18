'use strict';

const { body } = require('express-validator');

const claimRules = [
  body('issueDescription')
    .notEmpty()
    .withMessage('Issue description is required.')
    .trim()
    .isLength({ max: 1000 }),

  body('replacementSerialId')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid replacement serial ID.'),

  body('claimStatus')
    .optional()
    .isIn(['submitted', 'in_review', 'approved', 'rejected', 'replaced'])
    .withMessage('Invalid claim status.'),
];

module.exports = {
  claimRules,
};
