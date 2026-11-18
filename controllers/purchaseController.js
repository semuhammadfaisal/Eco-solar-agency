/** Purchase order and GRN controllers. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const purchaseService = require('../services/purchaseService');
const supplierService = require('../services/supplierService');
const itemService = require('../services/itemService');
const { can } = require('../config/permissions');
const { todayKey } = require('../utils/dates');
const branchInventoryService = require('../services/branchInventoryService');

const purchasesBreadcrumb = { label: 'Purchases', url: '/purchases' };

async function formOptions() {
  const [suppliers, items] = await Promise.all([
    supplierService.listSupplierOptions(),
    itemService.listPurchaseItemOptions(),
  ]);
  return { suppliers, items };
}

exports.index = asyncHandler(async (req, res) => {
  const { search = '', status = '', paymentStatus = '', supplier = '', from = '', to = '' } =
    req.query;

  const [{ items, total, pagination }, stats, suppliers] = await Promise.all([
    purchaseService.paginatePurchases({
      search,
      status,
      paymentStatus,
      supplier,
      from,
      to,
      page: req.query.page,
      limit: req.query.limit,
    }),
    purchaseService.getPurchaseStats(),
    supplierService.listSupplierOptions(),
  ]);

  return res.render('purchases/index', {
    layout: 'layouts/admin',
    title: 'Purchases',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, purchasesBreadcrumb],
    purchases: items,
    total,
    pagination,
    stats,
    suppliers,
    filters: {
      search: String(search).slice(0, 80),
      status,
      paymentStatus,
      supplier,
      from,
      to,
    },
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  const { suppliers, items } = await formOptions();

  return res.render('purchases/form', {
    layout: 'layouts/admin',
    title: 'New purchase order',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      purchasesBreadcrumb,
      { label: 'New purchase order' },
    ],
    purchase: null,
    suppliers,
    items,
    today: todayKey(),
    formAction: '/purchases',
    formMethod: 'POST',
    isEdit: false,
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    const purchase = await purchaseService.createPurchase(req.body, req.user, req);
    req.flash('success', `Purchase order ${purchase.number} has been created.`);
    return res.redirect(`/purchases/${purchase._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect('/purchases/new');
  }
});

exports.show = asyncHandler(async (req, res) => {
  const { purchase, serials, serialsByLine } = await purchaseService.getPurchaseDetail(
    req.params.id
  );

  return res.render('purchases/show', {
    layout: 'layouts/admin',
    title: purchase.number,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      purchasesBreadcrumb,
      { label: purchase.number },
    ],
    purchase,
    serials,
    serialsByLine,
    canManage: can(req.user, 'purchases.manage'),
    canPay: can(req.user, 'purchases.payment'),
  });
});

exports.editForm = asyncHandler(async (req, res) => {
  const purchase = await purchaseService.getPurchaseDetail(req.params.id);
  if (purchase.purchase.status !== 'ordered' || purchase.purchase.receipts.length > 0) {
    req.flash('warning', 'Only an unreceived purchase order can be edited.');
    return res.redirect(`/purchases/${purchase.purchase._id}`);
  }

  const { suppliers, items } = await formOptions();

  return res.render('purchases/form', {
    layout: 'layouts/admin',
    title: `Edit ${purchase.purchase.number}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      purchasesBreadcrumb,
      { label: purchase.purchase.number, url: `/purchases/${purchase.purchase._id}` },
      { label: 'Edit' },
    ],
    purchase: purchase.purchase,
    suppliers,
    items,
    today: todayKey(),
    formAction: `/purchases/${purchase.purchase._id}`,
    formMethod: 'PUT',
    isEdit: true,
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const purchase = await purchaseService.updatePurchase(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash('success', `Purchase order ${purchase.number} has been updated.`);
    return res.redirect(`/purchases/${purchase._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/purchases/${req.params.id}/edit`);
  }
});

exports.receiveForm = asyncHandler(async (req, res) => {
  const { purchase, serialsByLine } = await purchaseService.getPurchaseDetail(req.params.id);

  if (purchase.status === 'cancelled') {
    req.flash('error', 'A cancelled purchase order cannot receive stock.');
    return res.redirect(`/purchases/${purchase._id}`);
  }
  if (purchase.status === 'received' || purchase.isFullyReceived) {
    req.flash('info', 'Every line on this purchase order has already been received.');
    return res.redirect(`/purchases/${purchase._id}`);
  }

  return res.render('purchases/receive', {
    layout: 'layouts/admin',
    title: `Receive ${purchase.number}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      purchasesBreadcrumb,
      { label: purchase.number, url: `/purchases/${purchase._id}` },
      { label: 'Receive stock' },
    ],
    purchase,
    serialsByLine,
    today: todayKey(),
    branches: await branchInventoryService.listBranches(),
  });
});

exports.receive = asyncHandler(async (req, res) => {
  try {
    const result = await purchaseService.receivePurchase(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash(
      'success',
      `${result.receipt.number} posted: ${result.itemCount} line${
        result.itemCount === 1 ? '' : 's'
      } received${result.serialCount ? `, ${result.serialCount} serials created` : ''}.`
    );
    return res.redirect(`/purchases/${result.purchase._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/purchases/${req.params.id}/receive`);
  }
});

exports.pay = asyncHandler(async (req, res) => {
  try {
    const purchase = await purchaseService.recordPayment(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash('success', `Payment recorded on ${purchase.number}.`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
  }

  return res.redirect(`/purchases/${req.params.id}`);
});

exports.cancel = asyncHandler(async (req, res) => {
  try {
    const purchase = await purchaseService.cancelPurchase(req.params.id, req.user, req);
    req.flash('success', `Purchase order ${purchase.number} has been cancelled.`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
  }

  return res.redirect(`/purchases/${req.params.id}`);
});
