/**
 * Inventory item routes.
 * Every authenticated role can browse the catalogue; only owner, manager and
 * storekeeper can change it. Purchase prices are stripped inside itemService
 * for roles without purchase_prices.view.
 */
'use strict';

const express = require('express');
const itemController = require('../controllers/itemController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { createItemRules, updateItemRules, stockInRules } = require('../validators/itemValidators');

const router = express.Router();

router.use(isAuthenticated, requirePermission('inventory.view'));

router.get('/', itemController.index);

router.get('/stock-in', requirePermission('inventory.manage'), itemController.stockInForm);
router.post(
  '/stock-in',
  requirePermission('inventory.manage'),
  stockInRules,
  validate,
  itemController.stockIn
);

router.get('/new', requirePermission('inventory.manage'), itemController.newForm);
router.post(
  '/',
  requirePermission('inventory.manage'),
  createItemRules,
  validate,
  itemController.create
);

router.get('/:id', itemController.show);
router.get('/:id/edit', requirePermission('inventory.manage'), itemController.editForm);
router.put(
  '/:id',
  requirePermission('inventory.manage'),
  updateItemRules,
  validate,
  itemController.update
);
router.delete('/:id', requirePermission('inventory.manage'), itemController.destroy);

module.exports = router;
