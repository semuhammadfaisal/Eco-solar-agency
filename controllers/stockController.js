/** Stock ledger, supplier-return and valuation controllers. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const stockService = require('../services/stockService');
const itemService = require('../services/itemService');
const supplierService = require('../services/supplierService');
const { can } = require('../config/permissions');

const stockBreadcrumb = { label: 'Stock ledger', url: '/stock' };

exports.index = asyncHandler(async (req, res) => {
  const { search = '', item = '', type = '', from = '', to = '' } = req.query;

  const [{ movements, total, pagination }, summary, items] = await Promise.all([
    stockService.paginateMovements(
      { search, item, type, from, to, page: req.query.page, limit: req.query.limit },
      req.user
    ),
    stockService.getStockOverview(req.user),
    itemService.listItemOptions(),
  ]);

  let selectedItem = null;
  if (item) {
    try {
      selectedItem = await itemService.getItemOrThrow(item, req.user);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }

  return res.render('stock/index', {
    layout: 'layouts/admin',
    title: 'Stock ledger',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, stockBreadcrumb],
    movements,
    total,
    pagination,
    summary,
    items,
    selectedItem,
    canViewCosts: can(req.user, 'purchase_prices.view'),
    canManage: can(req.user, 'inventory.manage'),
    filters: { search: String(search).slice(0, 80), item, type, from, to },
  });
});

exports.returnsForm = asyncHandler(async (req, res) => {
  const [items, suppliers, recent] = await Promise.all([
    itemService.listItemOptions(),
    supplierService.listSupplierOptions(),
    stockService.listRecentReturns(15, req.user),
  ]);

  return res.render('stock/returns', {
    layout: 'layouts/admin',
    title: 'Supplier returns',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      stockBreadcrumb,
      { label: 'Supplier returns' },
    ],
    items,
    suppliers,
    recent,
    formAction: '/stock/returns',
  });
});

exports.createReturn = asyncHandler(async (req, res) => {
  try {
    const result = await stockService.returnToSupplier(req.body, req.user, req);
    req.flash(
      'success',
      `${result.movement.reference}: ${result.movement.qty * -1} × ${result.item.sku} returned to ${result.supplier.name}.`
    );
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
  }

  return res.redirect('/stock/returns');
});

exports.valuation = asyncHandler(async (req, res) => {
  const { category = '' } = req.query;
  const report = await stockService.getValuationReport({ category });

  return res.render('stock/valuation', {
    layout: 'layouts/admin',
    title: 'Stock valuation',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      stockBreadcrumb,
      { label: 'Valuation' },
    ],
    ...report,
    filters: { category },
  });
});
