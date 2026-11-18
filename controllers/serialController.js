/** Serial number search and lifecycle controllers. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const serialService = require('../services/serialService');
const itemService = require('../services/itemService');
const supplierService = require('../services/supplierService');
const customerService = require('../services/customerService');
const branchInventory = require('../services/branchInventoryService');
const { can } = require('../config/permissions');
const { sanitisedOldInput } = require('../middleware/validate');

const serialsBreadcrumb = { label: 'Serial numbers', url: '/serials' };

/** Branch-scoped roles may only see their own branch in pickers. */
function visibleBranches(branches, user) {
  if (user && ['shopkeeper', 'sales'].includes(user.role) && user.branch) {
    return branches.filter((branch) => String(branch._id) === String(user.branch));
  }
  return branches;
}

exports.index = asyncHandler(async (req, res) => {
  const { search = '', status = '', item = '', supplier = '', customer = '' } = req.query;

  const [{ serials, total, pagination }, stats, items, suppliers] = await Promise.all([
    serialService.paginateSerials({
      search,
      status,
      item,
      supplier,
      customer,
      page: req.query.page,
      limit: req.query.limit,
    }),
    serialService.getSerialStats(),
    itemService.listItemOptions(),
    supplierService.listSupplierOptions(),
  ]);

  return res.render('serials/index', {
    layout: 'layouts/admin',
    title: 'Serial numbers',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, serialsBreadcrumb],
    serials,
    total,
    pagination,
    stats,
    items,
    suppliers,
    canManage: can(req.user, 'inventory.manage'),
    filters: {
      search: String(search).slice(0, 80),
      status,
      item,
      supplier,
      customer,
    },
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  const [items, suppliers, branches] = await Promise.all([
    itemService.listItemOptions(),
    supplierService.listSupplierOptions(),
    branchInventory.listBranches(),
  ]);
  const branch = await branchInventory.getAccessibleBranch(req.user, req.query.branch);

  return res.render('serials/form', {
    layout: 'layouts/admin',
    title: 'Register serials',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      serialsBreadcrumb,
      { label: 'Register' },
    ],
    isEdit: false,
    serial: null,
    items,
    suppliers,
    branches: visibleBranches(branches, req.user),
    branchId: String(branch._id),
    selectedItemId: String(req.query.item || ''),
    formAction: '/serials',
    canViewCosts: can(req.user, 'purchase_prices.view'),
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    const result = await serialService.registerSerials(req.body, req.user, req);
    req.flash(
      'success',
      `${result.reference}: registered ${result.qty} serial${result.qty === 1 ? '' : 's'} for ${result.item.sku}.`
    );
    return res.redirect(`/serials?item=${result.item._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    req.flash('oldInput', sanitisedOldInput(req.body));
    const query = req.body.item ? `?item=${encodeURIComponent(req.body.item)}` : '';
    return res.redirect(`/serials/new${query}`);
  }
});

exports.editForm = asyncHandler(async (req, res) => {
  const [{ serial }, items, suppliers] = await Promise.all([
    serialService.getSerialDetail(req.params.id, req.user),
    itemService.listItemOptions(),
    supplierService.listSupplierOptions(),
  ]);

  return res.render('serials/form', {
    layout: 'layouts/admin',
    title: `Edit ${serial.serial}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      serialsBreadcrumb,
      { label: serial.serial, url: `/serials/${serial._id}` },
      { label: 'Edit' },
    ],
    isEdit: true,
    serial,
    items,
    suppliers,
    branches: [],
    branchId: '',
    selectedItemId: '',
    formAction: `/serials/${serial._id}`,
    canViewCosts: can(req.user, 'purchase_prices.view'),
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const { serial } = await serialService.updateSerial(req.params.id, req.body, req.user, req);
    req.flash('success', `Serial ${serial.serial} updated.`);
    return res.redirect(`/serials/${serial._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    req.flash('oldInput', sanitisedOldInput(req.body));
    return res.redirect(`/serials/${req.params.id}/edit`);
  }
});

exports.show = asyncHandler(async (req, res) => {
  const [{ serial, movements }, customers] = await Promise.all([
    serialService.getSerialDetail(req.params.id, req.user),
    customerService.listCustomerOptions(),
  ]);

  return res.render('serials/show', {
    layout: 'layouts/admin',
    title: serial.serial,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      serialsBreadcrumb,
      { label: serial.serial },
    ],
    serial,
    movements,
    customers,
    canManage: can(req.user, 'inventory.manage'),
  });
});

exports.changeStatus = asyncHandler(async (req, res) => {
  try {
    const { serial } = await serialService.changeStatus(req.params.id, req.body, req.user, req);
    req.flash('success', `Serial ${serial.serial} is now ${serial.status.replace('_', ' ')}.`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
  }

  return res.redirect(`/serials/${req.params.id}`);
});
