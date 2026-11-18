/**
 * Customer routes.
 * View access is broader than manage access (accountants, surveyors and
 * technicians can read profiles; only owner/manager/sales can change them).
 */
'use strict';

const express = require('express');
const customerController = require('../controllers/customerController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const {
  createCustomerRules,
  updateCustomerRules,
} = require('../validators/customerValidators');

const router = express.Router();

router.use(isAuthenticated);

router.get('/', requirePermission('customers.view'), customerController.index);

router.get('/new', requirePermission('customers.manage'), customerController.newForm);
router.post(
  '/',
  requirePermission('customers.manage'),
  createCustomerRules,
  validate,
  customerController.create
);

router.get('/:id', requirePermission('customers.view'), customerController.show);
router.get(
  '/:id/edit',
  requirePermission('customers.manage'),
  customerController.editForm
);
router.put(
  '/:id',
  requirePermission('customers.manage'),
  updateCustomerRules,
  validate,
  customerController.update
);
router.delete(
  '/:id',
  requirePermission('customers.manage'),
  customerController.destroy
);

module.exports = router;
