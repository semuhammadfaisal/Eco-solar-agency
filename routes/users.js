/**
 * User management routes — owner only.
 * Every route is guarded server-side; the sidebar hiding the menu is cosmetic.
 */
'use strict';

const express = require('express');
const userController = require('../controllers/userController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const {
  createUserRules,
  updateUserRules,
  resetPasswordRules,
  branchPasswordRules,
} = require('../validators/userValidators');
const { ROLES } = require('../config/roles');

const router = express.Router();

router.use(isAuthenticated, requireRole(ROLES.OWNER));

router.get('/', userController.index);

// Shared branch logins. These live before the /:id routes so a branch id can
// never be mistaken for a user id.
router.get('/branch-logins', userController.branchLogins);
router.get('/branch-logins/:id/password', userController.branchPasswordForm);
router.post(
  '/branch-logins/:id/password',
  branchPasswordRules,
  validate,
  userController.setBranchPassword
);
router.post('/branch-logins/:id/disable', userController.clearBranchPassword);

router.get('/new', userController.newForm);
router.post('/', createUserRules, validate, userController.create);

router.get('/:id/edit', userController.editForm);
router.put('/:id', updateUserRules, validate, userController.update);

router.get('/:id/password', userController.passwordForm);
router.post(
  '/:id/password',
  resetPasswordRules,
  validate,
  userController.resetPassword
);

router.post('/:id/toggle-active', userController.toggleActive);
router.delete('/:id', userController.destroy);

module.exports = router;
