'use strict';

const express = require('express');
const controller = require('../controllers/commerceController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');

const router = express.Router();
router.use(isAuthenticated);

router.get('/branches', requirePermission('branches.view'), controller.branches);
router.get('/branches/new', requirePermission('branches.manage'), controller.branchForm);
router.post('/branches', requirePermission('branches.manage'), controller.saveBranch);
router.get('/branches/:id/stock', requirePermission('branches.view'), controller.branchStock);
router.get('/branches/:id/edit', requirePermission('branches.manage'), controller.branchForm);
router.put('/branches/:id', requirePermission('branches.manage'), controller.saveBranch);

router.get('/brands', requirePermission('inventory.view'), controller.brands);
router.get('/brands/new', requirePermission('brands.manage'), controller.brandForm);
router.post('/brands', requirePermission('brands.manage'), controller.saveBrand);
router.get('/brands/:id/edit', requirePermission('brands.manage'), controller.brandForm);
router.put('/brands/:id', requirePermission('brands.manage'), controller.saveBrand);

router.get('/transfers', requirePermission('transfers.view'), controller.transfers);
router.get('/transfers/new', requirePermission('transfers.manage'), controller.transferForm);
router.post('/transfers', requirePermission('transfers.manage'), controller.createTransfer);
router.get('/transfers/:id', requirePermission('transfers.view'), controller.transferShow);

router.get('/pos', requirePermission('pos.view'), controller.posIndex);
router.get('/pos/new', requirePermission('pos.sell'), controller.posForm);
router.post('/pos', requirePermission('pos.sell'), controller.createPosSale);
router.get('/pos/:id', requirePermission('pos.view'), controller.posShow);
router.post('/pos/:id/cancel', requirePermission('pos.cancel'), controller.cancelPosSale);

module.exports = router;
