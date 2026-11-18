'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const setup = require('../services/commerceSetupService');
const branchInventory = require('../services/branchInventoryService');
const transferService = require('../services/transferService');
const posService = require('../services/posService');
const customerService = require('../services/customerService');
const { can } = require('../config/permissions');

function renderError(req, err, fallback) {
  if (!(err instanceof ApiError)) throw err;
  req.flash('error', err.message);
  return fallback;
}

/** Cost and profit are purchase-price data; drop them for roles without it. */
function stripTransferCosts(transfer) {
  delete transfer.totalCostPaisa;
  delete transfer.totalProfitPaisa;
  (transfer.items || []).forEach((line) => {
    delete line.unitCostPaisa;
    delete line.profitPaisa;
  });
  return transfer;
}

function stripItemCosts(item) {
  delete item.purchasePricePaisa;
  delete item.avgCostPaisa;
  delete item.lastPurchasePricePaisa;
  delete item.stockValuePaisa;
  return item;
}

exports.branches = asyncHandler(async (_req, res) => {
  await branchInventory.ensureMainBranch();
  let branches = await setup.listBranches();
  if (res.locals.currentUser && ['shopkeeper', 'sales'].includes(res.locals.currentUser.role) && res.locals.currentUser.branch) branches = branches.filter((branch) => String(branch._id) === String(res.locals.currentUser.branch));
  res.render('commerce/branches', { title: 'Branches', branches, breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Branches' }] });
});

exports.branchForm = asyncHandler(async (req, res) => {
  const branch = req.params.id ? await setup.getBranch(req.params.id) : null;
  const User = require('../models/User');
  const managers = await User.find({ role: { $in: ['owner', 'manager', 'shopkeeper'] }, isActive: true }).select('name role').sort({ name: 1 }).lean();
  res.render('commerce/branch-form', { title: branch ? `Edit ${branch.name}` : 'Add branch', branch, managers, formAction: branch ? `/branches/${branch._id}` : '/branches', isEdit: Boolean(branch), breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Branches', url: '/branches' }, { label: branch ? 'Edit' : 'Add' }] });
});

exports.saveBranch = asyncHandler(async (req, res) => {
  try { const branch = await setup.saveBranch(req.params.id || null, req.body, req.user); req.flash('success', `${branch.name} has been saved.`); return res.redirect('/branches'); }
  catch (err) { return res.redirect(renderError(req, err, req.params.id ? `/branches/${req.params.id}/edit` : '/branches/new')); }
});

exports.branchStock = asyncHandler(async (req, res) => {
  const branch = await branchInventory.getAccessibleBranch(req.user, req.params.id || req.query.branch);
  const data = await branchInventory.balancesForBranch(branch._id, { search: req.query.search });
  // A branch only lists the products it actually holds; the full catalogue lives on the Inventory page.
  data.items = data.items.filter((item) => Number(item.branchStock || 0) > 0);
  res.render('commerce/branch-stock', { title: `${branch.name} stock`, ...data, search: String(req.query.search || ''), branches: await branchInventory.listBranches(), breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Branches', url: '/branches' }, { label: branch.name }] });
});

exports.brands = asyncHandler(async (_req, res) => res.render('commerce/brands', { title: 'Brands', brands: await setup.listBrands(), breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Brands' }] }));
exports.brandForm = asyncHandler(async (req, res) => { const brand = req.params.id ? await setup.getBrand(req.params.id) : null; res.render('commerce/brand-form', { title: brand ? `Edit ${brand.name}` : 'Add brand', brand, formAction: brand ? `/brands/${brand._id}` : '/brands', isEdit: Boolean(brand), breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Brands', url: '/brands' }, { label: brand ? 'Edit' : 'Add' }] }); });
exports.saveBrand = asyncHandler(async (req, res) => { try { const brand = await setup.saveBrand(req.params.id || null, req.body, req.user); req.flash('success', `${brand.name} has been saved.`); return res.redirect('/brands'); } catch (err) { return res.redirect(renderError(req, err, req.params.id ? `/brands/${req.params.id}/edit` : '/brands/new')); } });

exports.transfers = asyncHandler(async (req, res) => {
  const canViewCosts = can(req.user, 'purchase_prices.view');
  const transfers = await transferService.listTransfers(req.user);

  const summary = {
    count: transfers.length,
    branchValuePaisa: transfers.reduce((sum, transfer) => sum + Number(transfer.totalBranchValuePaisa || 0), 0),
    costPaisa: transfers.reduce((sum, transfer) => sum + Number(transfer.totalCostPaisa || 0), 0),
    profitPaisa: transfers.reduce((sum, transfer) => sum + Number(transfer.totalProfitPaisa || 0), 0),
  };

  if (!canViewCosts) transfers.forEach(stripTransferCosts);

  res.render('commerce/transfers', {
    title: 'Stock transfers',
    transfers,
    summary,
    canViewCosts,
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Stock transfers' }],
  });
});

exports.transferForm = asyncHandler(async (req, res) => {
  const canViewCosts = can(req.user, 'purchase_prices.view');
  const allBranches = await branchInventory.listBranches();
  const restricted = ['shopkeeper', 'sales'].includes(req.user.role) && req.user.branch;
  const sourceBranches = restricted
    ? allBranches.filter((branch) => String(branch._id) === String(req.user.branch))
    : allBranches;
  const source = await branchInventory.getAccessibleBranch(req.user, req.query.source);
  const destinationBranches = allBranches.filter((branch) => String(branch._id) !== String(source._id));
  const { items } = await branchInventory.balancesForBranch(source._id);
  // Only offer products the source branch actually holds, so a transfer cannot
  // be submitted for stock that is not there.
  const availableItems = items.filter((item) => !item.hasSerial && Number(item.branchStock || 0) > 0);

  res.render('commerce/transfer-form', {
    title: 'New stock transfer',
    sourceBranches,
    destinationBranches,
    items: canViewCosts ? availableItems : availableItems.map(stripItemCosts),
    canViewCosts,
    sourceBranchId: String(source._id),
    currentBranch: req.user.branch ? String(req.user.branch) : '',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Stock transfers', url: '/transfers' }, { label: 'New' }],
  });
});

exports.transferShow = asyncHandler(async (req, res) => {
  const canViewCosts = can(req.user, 'purchase_prices.view');
  const transfer = await transferService.getTransfer(req.params.id, req.user);
  if (!canViewCosts) stripTransferCosts(transfer);

  res.render('commerce/transfer-show', {
    title: transfer.number,
    transfer,
    canViewCosts,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Stock transfers', url: '/transfers' },
      { label: transfer.number },
    ],
  });
});
exports.createTransfer = asyncHandler(async (req, res) => {
  try {
    const transfer = await transferService.createTransfer(req.body, req.user);
    req.flash('success', `${transfer.number} completed successfully.`);
    return res.redirect('/transfers');
  } catch (err) {
    const source = req.body.sourceBranch ? `?source=${encodeURIComponent(req.body.sourceBranch)}` : '';
    return res.redirect(renderError(req, err, `/transfers/new${source}`));
  }
});

exports.posIndex = asyncHandler(async (req, res) => { const result = await posService.listSales(req.query, req.user); let branches = await branchInventory.listBranches(); if (['shopkeeper', 'sales'].includes(req.user.role) && req.user.branch) branches = branches.filter((b) => String(b._id) === String(req.user.branch)); res.render('commerce/pos-index', { title: 'POS sales', ...result, branches, filters: { branch: req.query.branch || '', from: req.query.from || '', to: req.query.to || '' }, breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'POS sales' }] }); });
exports.posForm = asyncHandler(async (req, res) => { const branch = await branchInventory.getAccessibleBranch(req.user, req.query.branch); let branches = await branchInventory.listBranches(); if (['shopkeeper', 'sales'].includes(req.user.role) && req.user.branch) branches = branches.filter((b) => String(b._id) === String(req.user.branch)); const products = await posService.productOptions(branch._id); const customers = req.user.isBranchLogin ? [] : await customerService.listCustomerOptions(); res.render('commerce/pos-form', { title: 'New POS sale', branch, branches, products, customers, breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'POS sales', url: '/pos' }, { label: 'New sale' }] }); });
exports.createPosSale = asyncHandler(async (req, res) => { try { const sale = await posService.createSale(req.body, req.user); req.flash('success', `${sale.number} completed.`); return res.redirect(`/pos/${sale._id}`); } catch (err) { return res.redirect(renderError(req, err, '/pos/new')); } });
exports.posShow = asyncHandler(async (req, res) => { const sale = await posService.getSale(req.params.id, req.user); res.render('commerce/pos-show', { layout: req.query.print === '1' ? 'layouts/bare' : 'layouts/admin', title: sale.number, sale, printMode: req.query.print === '1', breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'POS sales', url: '/pos' }, { label: sale.number }] }); });
exports.cancelPosSale = asyncHandler(async (req, res) => { try { const sale = await posService.cancelSale(req.params.id, req.user); req.flash('success', `${sale.number} was cancelled and stock was restored.`); } catch (err) { renderError(req, err, '/pos'); } return res.redirect(`/pos/${req.params.id}`); });
