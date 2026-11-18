/**
 * Purchase routes (PO → GRN).
 * The router-level purchases.view guard keeps cost-bearing pages unreachable
 * for roles without purchase-price visibility.
 */
'use strict';

const express = require('express');
const purchaseController = require('../controllers/purchaseController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const {
  createPurchaseRules,
  updatePurchaseRules,
  grnRules,
  paymentRules,
} = require('../validators/purchaseValidators');

const router = express.Router();

router.use(isAuthenticated, requirePermission('purchases.view'));

router.get('/', purchaseController.index);

router.get('/new', requirePermission('purchases.manage'), purchaseController.newForm);
router.post(
  '/',
  requirePermission('purchases.manage'),
  createPurchaseRules,
  validate,
  purchaseController.create
);

router.get('/:id', purchaseController.show);
router.get('/:id/edit', requirePermission('purchases.manage'), purchaseController.editForm);
router.put(
  '/:id',
  requirePermission('purchases.manage'),
  updatePurchaseRules,
  validate,
  purchaseController.update
);

router.get('/:id/receive', requirePermission('purchases.manage'), purchaseController.receiveForm);
router.post(
  '/:id/receive',
  requirePermission('purchases.manage'),
  grnRules,
  validate,
  purchaseController.receive
);

router.post(
  '/:id/payments',
  requirePermission('purchases.payment'),
  paymentRules,
  validate,
  purchaseController.pay
);
router.post('/:id/cancel', requirePermission('purchases.manage'), purchaseController.cancel);

module.exports = router;
