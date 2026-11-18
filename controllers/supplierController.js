/** Supplier controllers. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const supplierService = require('../services/supplierService');
const { safeReferrer } = require('../utils/urls');

const suppliersBreadcrumb = { label: 'Suppliers', url: '/suppliers' };

exports.index = asyncHandler(async (req, res) => {
  const { search = '', city = '' } = req.query;

  const [{ items, total, pagination }, cities] = await Promise.all([
    supplierService.paginateSuppliers({
      search,
      city,
      page: req.query.page,
      limit: req.query.limit,
    }),
    supplierService.listCities(),
  ]);

  return res.render('suppliers/index', {
    layout: 'layouts/admin',
    title: 'Suppliers',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, suppliersBreadcrumb],
    suppliers: items,
    total,
    pagination,
    cities,
    filters: { search: String(search).slice(0, 80), city },
  });
});

exports.newForm = (req, res) => {
  return res.render('suppliers/form', {
    layout: 'layouts/admin',
    title: 'Add supplier',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      suppliersBreadcrumb,
      { label: 'Add supplier' },
    ],
    supplier: null,
    formAction: '/suppliers',
    formMethod: 'POST',
    isEdit: false,
  });
};

exports.create = asyncHandler(async (req, res) => {
  try {
    const supplier = await supplierService.createSupplier(req.body, req.user, req);
    req.flash('success', `${supplier.code} — ${supplier.name} has been added.`);
    return res.redirect(`/suppliers/${supplier._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect('/suppliers/new');
  }
});

exports.show = asyncHandler(async (req, res) => {
  const detail = await supplierService.getSupplierDetail(req.params.id);

  return res.render('suppliers/show', {
    layout: 'layouts/admin',
    title: detail.supplier.name,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      suppliersBreadcrumb,
      { label: detail.supplier.name },
    ],
    ...detail,
  });
});

exports.editForm = asyncHandler(async (req, res) => {
  const supplier = await supplierService.getSupplierOrThrow(req.params.id);

  return res.render('suppliers/form', {
    layout: 'layouts/admin',
    title: `Edit ${supplier.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      suppliersBreadcrumb,
      { label: supplier.name, url: `/suppliers/${supplier._id}` },
      { label: 'Edit' },
    ],
    supplier,
    formAction: `/suppliers/${supplier._id}`,
    formMethod: 'PUT',
    isEdit: true,
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const supplier = await supplierService.updateSupplier(req.params.id, req.body, req.user, req);
    req.flash('success', `${supplier.name} has been updated.`);
    return res.redirect(`/suppliers/${supplier._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/suppliers/${req.params.id}/edit`);
  }
});

exports.destroy = asyncHandler(async (req, res) => {
  try {
    const supplier = await supplierService.softDeleteSupplier(req.params.id, req.user, req);
    req.flash('success', `${supplier.name} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect(safeReferrer(req, '/suppliers'));
});
