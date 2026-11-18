'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const installmentController = require('../controllers/installmentController');
const {
  planRules,
  paymentRules,
  rescheduleRules,
  waiverRules,
  chequeCreateRules,
  chequeStatusRules,
  overrideRules,
} = require('../validators/installmentValidators');

router.use(isAuthenticated);

// List, form, create
router.get('/', requirePermission('installments.view'), installmentController.index);
router.get('/new', requirePermission('installments.manage'), installmentController.newForm);
router.post(
  '/',
  requirePermission('installments.manage'),
  planRules,
  validate,
  installmentController.create
);

// Calendar & Events
router.get('/calendar', requirePermission('installments.view'), installmentController.calendarView);
router.get('/calendar/events', requirePermission('installments.view'), installmentController.calendarEvents);

// Cheques Register
router.get('/cheques', requirePermission('installments.view'), installmentController.chequesIndex);
router.get(
  '/cheques/new',
  requirePermission('installments.manage'),
  installmentController.newChequeForm
);
router.post(
  '/cheques',
  requirePermission('installments.manage'),
  chequeCreateRules,
  validate,
  installmentController.createCheque
);
router.post(
  '/cheques/:id/status',
  requirePermission('installments.manage'),
  chequeStatusRules,
  validate,
  installmentController.updateCheque
);

// Receipts
router.get('/receipts', requirePermission('installments.view'), installmentController.receiptsIndex);
router.get('/receipts/:id', requirePermission('installments.view'), installmentController.showReceipt);
router.get('/receipts/:id/pdf', requirePermission('installments.view'), installmentController.downloadReceiptPdf);

// Customer Statement & Ledger
router.get('/ledger/:customerId', requirePermission('installments.view'), installmentController.customerLedger);
router.get('/ledger/:customerId/pdf', requirePermission('installments.view'), installmentController.customerStatementPdf);

// Material Issue Gate
router.post('/sales/:saleId/issue-material', requirePermission('sales.manage'), installmentController.issueMaterial);

// Late Fee Waiver
router.post(
  '/installments/:installmentId/waive',
  requirePermission('installments.waive'),
  waiverRules,
  validate,
  installmentController.waiveLateFee
);

// Detail, Payments, Reschedule, Checklist, Override
router.get('/:id', requirePermission('installments.view'), installmentController.show);
router.post(
  '/:id/payment',
  requirePermission('installments.collect'),
  paymentRules,
  validate,
  installmentController.collectPayment
);
router.post(
  '/:id/reschedule',
  requirePermission('installments.reschedule'),
  rescheduleRules,
  validate,
  installmentController.reschedule
);
router.post(
  '/:id/checklist',
  requirePermission('installments.manage'),
  installmentController.updateChecklist
);
router.post(
  '/:id/override-security',
  requirePermission('installments.security_override'),
  overrideRules,
  validate,
  installmentController.overrideSecurity
);

module.exports = router;
