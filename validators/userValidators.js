/** User management form validation (owner only). */
'use strict';

const { body } = require('express-validator');
const { ALL_ROLES } = require('../config/roles');
const mongoose = require('mongoose');

const nameRule = body('name')
  .trim()
  .notEmpty()
  .withMessage('Name is required.')
  .bail()
  .isLength({ max: 120 })
  .withMessage('Name cannot exceed 120 characters.');

const emailRule = body('email')
  .trim()
  .notEmpty()
  .withMessage('Email is required.')
  .bail()
  .isEmail()
  .withMessage('Enter a valid email address.')
  .toLowerCase();

const phoneRule = body('phone')
  .optional({ values: 'falsy' })
  .trim()
  .matches(/^[0-9+\-()\s]{7,20}$/)
  .withMessage('Enter a valid phone number.');

const roleRule = body('role')
  .trim()
  .isIn(ALL_ROLES)
  .withMessage('Select a valid role.');

const statusRule = body('isActive')
  .optional()
  .isIn(['0', '1'])
  .withMessage('Select a valid account status.');

const passwordRule = body('password')
  .isLength({ min: 8, max: 72 })
  .withMessage('Password must be between 8 and 72 characters.')
  .bail()
  .matches(/[A-Za-z]/)
  .withMessage('Password must include at least one letter.')
  .matches(/[0-9]/)
  .withMessage('Password must include at least one number.');

const strongPassword = (field, label) =>
  body(field)
    .isLength({ min: 8, max: 72 })
    .withMessage(`${label} must be between 8 and 72 characters.`)
    .bail()
    .matches(/[A-Za-z]/)
    .withMessage(`${label} must include at least one letter.`)
    .matches(/[0-9]/)
    .withMessage(`${label} must include at least one number.`);

const resetPasswordRules = [
  strongPassword('newPassword', 'New password'),
  body('newPasswordConfirm')
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('New passwords do not match.'),
];

const branchPasswordRules = [
  strongPassword('password', 'Branch password'),
  body('passwordConfirm')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Branch passwords do not match.'),
];

const createUserRules = [
  nameRule,
  emailRule,
  phoneRule,
  roleRule,
  statusRule,
  passwordRule,
  body('branch').optional({ values: 'falsy' }).custom((value) => mongoose.isValidObjectId(value)).withMessage('Select a valid branch.'),
  body('passwordConfirm')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.'),
];

const updateUserRules = [
  nameRule,
  emailRule,
  phoneRule,
  roleRule,
  statusRule,
  body('branch').optional({ values: 'falsy' }).custom((value) => mongoose.isValidObjectId(value)).withMessage('Select a valid branch.'),
  body('password')
    .optional({ values: 'falsy' })
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters.')
    .bail()
    .matches(/[A-Za-z]/)
    .withMessage('Password must include at least one letter.')
    .matches(/[0-9]/)
    .withMessage('Password must include at least one number.'),
  body('passwordConfirm')
    .custom((value, { req }) => {
      if (!req.body.password) return true;
      return value === req.body.password;
    })
    .withMessage('Passwords do not match.'),
];

module.exports = {
  createUserRules,
  updateUserRules,
  resetPasswordRules,
  branchPasswordRules,
};
