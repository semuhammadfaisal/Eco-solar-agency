/** Authentication form validation. */
'use strict';

const { body } = require('express-validator');
const mongoose = require('mongoose');

const loginRules = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .bail()
    .isEmail()
    .withMessage('Enter a valid email address.')
    .toLowerCase(),
  body('password').notEmpty().withMessage('Password is required.'),
];

const branchLoginRules = [
  body('branch')
    .trim()
    .notEmpty()
    .withMessage('Select a branch.')
    .bail()
    .custom((value) => mongoose.isValidObjectId(value))
    .withMessage('Select a valid branch.'),
  body('password').notEmpty().withMessage('Branch password is required.'),
];

const passwordPolicy = (field, label) =>
  body(field)
    .isLength({ min: 8, max: 72 })
    .withMessage(`${label} must be between 8 and 72 characters.`)
    .bail()
    .matches(/[A-Za-z]/)
    .withMessage(`${label} must include at least one letter.`)
    .matches(/[0-9]/)
    .withMessage(`${label} must include at least one number.`);

const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Enter your current password.'),
  passwordPolicy('newPassword', 'New password'),
  body('newPasswordConfirm')
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('New passwords do not match.'),
];

const profileRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Full name is required.')
    .bail()
    .isLength({ max: 120 })
    .withMessage('Full name cannot exceed 120 characters.'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .bail()
    .isEmail()
    .withMessage('Enter a valid email address.')
    .bail()
    .isLength({ max: 190 })
    .withMessage('Email cannot exceed 190 characters.')
    .toLowerCase(),
  body('phone')
    .trim()
    .optional({ values: 'falsy' })
    .isLength({ min: 7, max: 20 })
    .withMessage('Phone number must be between 7 and 20 characters.')
    .bail()
    .matches(/^[0-9+\-()\s]+$/)
    .withMessage('Enter a valid phone number.'),
];

module.exports = { loginRules, branchLoginRules, changePasswordRules, profileRules, passwordPolicy };
