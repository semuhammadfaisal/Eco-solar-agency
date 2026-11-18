/** Inventory item controllers. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const itemService = require('../services/itemService');
const stockService = require('../services/stockService');
const branchInventory = require('../services/branchInventoryService');
const { can } = require('../config/permissions');
const { ITEM_CATEGORIES } = require('../config/inventory');
const { safeReferrer } = require('../utils/urls');
const commerceSetupService = require('../services/commerceSetupService');
const { sanitisedOldInput } = require('../middleware/validate');

const itemsBreadcrumb = { label: 'Inventory', url: '/items' };

/** Branch-scoped roles may only see their own branch in pickers. */
function visibleBranches(branches, user) {
  if (user && ['shopkeeper', 'sales'].includes(user.role) && user.branch) {
    return branches.filter((branch) => String(branch._id) === String(user.branch));
  }
  return branches;
}

exports.index = asyncHandler(async (req, res) => {
  const { search = '', category = '', brand = '', stock = '' } = req.query;

  const [{ items, total, pagination }, brands, summary, categorySummary] = await Promise.all([
    itemService.paginateItems(
      {
        search,
        category,
        brand,
        stock,
        page: req.query.page,
        limit: req.query.limit,
      },
      req.user
    ),
    itemService.listBrands(),
    itemService.getInventorySummary(req.user),
    itemService.getCategorySummary(),
  ]);

  return res.render('items/index', {
    layout: 'layouts/admin',
    title: 'Inventory',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, itemsBreadcrumb],
    items,
    total,
    pagination,
    brands,
    summary,
    categorySummary,
    canViewCosts: can(req.user, 'purchase_prices.view'),
    filters: {
      search: String(search).slice(0, 80),
      category,
      brand,
      stock,
    },
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  const requestedCategory = String(req.query.category || '');
  const initialCategory = ITEM_CATEGORIES.includes(requestedCategory) ? requestedCategory : 'other';

  return res.render('items/form', {
    layout: 'layouts/admin',
    title: 'Add item',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      itemsBreadcrumb,
      { label: 'Add item' },
    ],
    item: null,
    initialCategory,
    formAction: '/items',
    formMethod: 'POST',
    isEdit: false,
    brandOptions: await commerceSetupService.brandOptions(),
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    const item = await itemService.createItem(req.body, req.user, req);
    req.flash('success', `${item.sku} — ${item.name} has been added to inventory.`);
    return res.redirect(`/items/${item._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect('/items/new');
  }
});

exports.stockInForm = asyncHandler(async (req, res) => {
  const [branches, items] = await Promise.all([
    branchInventory.listBranches(),
    itemService.listItemOptions(),
  ]);
  const branch = await branchInventory.getAccessibleBranch(req.user, req.query.branch);

  return res.render('items/stock-in', {
    layout: 'layouts/admin',
    title: 'Add stock',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      itemsBreadcrumb,
      { label: 'Add stock' },
    ],
    items,
    branches: visibleBranches(branches, req.user),
    branchId: String(branch._id),
    selectedItemId: String(req.query.item || ''),
    canViewCosts: can(req.user, 'purchase_prices.view'),
  });
});

exports.stockIn = asyncHandler(async (req, res) => {
  try {
    const result = await stockService.receiveStock(req.body, req.user, req);
    req.flash(
      'success',
      `${result.movement.reference}: received ${result.qty} ${result.item.unit} of ${result.item.sku} at ${result.branch.name}.`
    );
    return res.redirect(`/items/${result.item._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    req.flash('oldInput', sanitisedOldInput(req.body));
    const item = req.body.item ? `?item=${encodeURIComponent(req.body.item)}` : '';
    return res.redirect(`/items/stock-in${item}`);
  }
});

exports.show = asyncHandler(async (req, res) => {
  const detail = await itemService.getItemDetail(req.params.id, req.user);

  return res.render('items/show', {
    layout: 'layouts/admin',
    title: detail.item.name,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      itemsBreadcrumb,
      { label: detail.item.name },
    ],
    canViewCosts: can(req.user, 'purchase_prices.view'),
    ...detail,
  });
});

exports.editForm = asyncHandler(async (req, res) => {
  const item = await itemService.getItemOrThrow(req.params.id, req.user);

  return res.render('items/form', {
    layout: 'layouts/admin',
    title: `Edit ${item.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      itemsBreadcrumb,
      { label: item.name, url: `/items/${item._id}` },
      { label: 'Edit' },
    ],
    item,
    formAction: `/items/${item._id}`,
    formMethod: 'PUT',
    isEdit: true,
    brandOptions: await commerceSetupService.brandOptions(),
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const item = await itemService.updateItem(req.params.id, req.body, req.user, req);
    req.flash('success', `${item.sku} — ${item.name} has been updated.`);
    return res.redirect(`/items/${item._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/items/${req.params.id}/edit`);
  }
});

exports.destroy = asyncHandler(async (req, res) => {
  try {
    const item = await itemService.softDeleteItem(req.params.id, req.user, req);
    req.flash('success', `${item.sku} — ${item.name} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect(safeReferrer(req, '/items'));
});
