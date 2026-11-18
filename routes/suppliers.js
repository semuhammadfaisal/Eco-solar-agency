/**
 * Supplier routes.
 * Suppliers carry payable balances, so the whole module is limited to roles
 * allowed to see purchase prices (owner, accountant, storekeeper).
 */
'use strict';

const express = require('express');
const supplierController = require('../controllers/supplierController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const {
  createSupplierRules,
  updateSupplierRules,
} = require('../validators/supplierValidators');

const router = express.Router();

router.use(isAuthenticated, requirePermission('purchases.view'));

router.get('/', supplierController.index);

router.get('/new', requirePermission('purchases.manage'), supplierController.newForm);
router.post(
  '/',
  requirePermission('purchases.manage'),
  createSupplierRules,
  validate,
  supplierController.create
);

router.get('/:id', supplierController.show);
router.get('/:id/edit', requirePermission('purchases.manage'), supplierController.editForm);
router.put(
  '/:id',
  requirePermission('purchases.manage'),
  updateSupplierRules,
  validate,
  supplierController.update
);
router.delete('/:id', requirePermission('purchases.manage'), supplierController.destroy);

module.exports = router;
