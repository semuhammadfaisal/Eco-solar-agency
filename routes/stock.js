/**
 * Stock ledger, supplier return and valuation routes.
 * Ledger access is broad (all signed-in roles) because movement rows are
 * stripped of cost fields per role; the pages that carry cost value are
 * gated to owner/accountant/storekeeper.
 */
'use strict';

const express = require('express');
const stockController = require('../controllers/stockController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { supplierReturnRules } = require('../validators/purchaseValidators');

const router = express.Router();

router.use(isAuthenticated, requirePermission('inventory.view'));

router.get('/', stockController.index);

router.get('/returns', requirePermission('inventory.manage'), stockController.returnsForm);
router.post(
  '/returns',
  requirePermission('inventory.manage'),
  supplierReturnRules,
  validate,
  stockController.createReturn
);

router.get('/valuation', requirePermission('valuation.view'), stockController.valuation);

module.exports = router;
