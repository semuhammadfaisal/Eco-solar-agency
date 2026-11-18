/**
 * Business partner routes.
 * Owner manages partner profiles; owner, manager and accountant can view
 * equity and profit share; owner and accountant record partner cash movements.
 */
'use strict';

const express = require('express');
const partnerController = require('../controllers/partnerController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const {
  partnerRules,
  partnerTransactionRules,
} = require('../validators/partnerValidators');

const router = express.Router();

router.use(isAuthenticated);

router.get('/', requirePermission('partners.view'), partnerController.index);

router.get('/new', requirePermission('partners.manage'), partnerController.newForm);
router.post(
  '/',
  requirePermission('partners.manage'),
  partnerRules,
  validate,
  partnerController.create
);

router.get('/:id/edit', requirePermission('partners.manage'), partnerController.editForm);
router.put(
  '/:id',
  requirePermission('partners.manage'),
  partnerRules,
  validate,
  partnerController.update
);
router.delete(
  '/:id',
  requirePermission('partners.manage'),
  partnerController.destroy
);

router.post(
  '/:id/transactions',
  requirePermission('partners.transactions'),
  partnerTransactionRules,
  validate,
  partnerController.recordTransaction
);

router.get('/:id', requirePermission('partners.view'), partnerController.show);

module.exports = router;
