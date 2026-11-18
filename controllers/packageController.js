'use strict';

const asyncHandler = require('../utils/asyncHandler');
const packageService = require('../services/packageService');
const itemService = require('../services/itemService');
const { safeReferrer } = require('../utils/urls');
const ApiError = require('../utils/ApiError');
const { can } = require('../config/permissions');

const packagesBreadcrumb = { label: 'Packages', url: '/packages' };

exports.index = asyncHandler(async (req, res) => {
  const { packages, total, pagination } = await packageService.listPackages(req.query, req.user);

  return res.render('packages/index', {
    layout: 'layouts/admin',
    title: 'Solar Packages',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Packages' }],
    packages,
    total,
    pagination,
    filters: {
      search: req.query.search || '',
      systemType: req.query.systemType || '',
      status: req.query.status || '',
    },
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  const items = await itemService.listItemsForSelector(req.user);

  return res.render('packages/form', {
    layout: 'layouts/admin',
    title: 'Create Solar Package',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      packagesBreadcrumb,
      { label: 'New package' },
    ],
    pkg: null,
    items,
    formAction: '/packages',
    formMethod: 'POST',
    isEdit: false,
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    let rawItems = [];
    if (req.body.itemsJson) {
      try {
        rawItems = JSON.parse(req.body.itemsJson);
      } catch (e) {
        throw ApiError.badRequest('Invalid package items format.');
      }
    } else if (Array.isArray(req.body.items)) {
      rawItems = req.body.items;
    }

    const payload = { ...req.body, items: rawItems };
    const pkg = await packageService.createPackage(payload, req.user, req);

    req.flash('success', `${pkg.code} — ${pkg.name} has been created.`);
    return res.redirect(`/packages/${pkg._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/packages/new');
    }
    throw err;
  }
});

exports.show = asyncHandler(async (req, res) => {
  const pkg = await packageService.getPackageOrThrow(req.params.id);
  const canManage = can(req.user, 'packages.manage');

  return res.render('packages/show', {
    layout: 'layouts/admin',
    title: `${pkg.code} — ${pkg.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      packagesBreadcrumb,
      { label: pkg.code },
    ],
    pkg,
    canManage,
  });
});

exports.editForm = asyncHandler(async (req, res) => {
  const [pkg, items] = await Promise.all([
    packageService.getPackageOrThrow(req.params.id),
    itemService.listItemsForSelector(req.user),
  ]);

  return res.render('packages/form', {
    layout: 'layouts/admin',
    title: `Edit ${pkg.code}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      packagesBreadcrumb,
      { label: pkg.code, url: `/packages/${pkg._id}` },
      { label: 'Edit' },
    ],
    pkg,
    items,
    formAction: `/packages/${pkg._id}`,
    formMethod: 'PUT',
    isEdit: true,
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    let rawItems = undefined;
    if (req.body.itemsJson) {
      try {
        rawItems = JSON.parse(req.body.itemsJson);
      } catch (e) {
        throw ApiError.badRequest('Invalid package items format.');
      }
    } else if (Array.isArray(req.body.items)) {
      rawItems = req.body.items;
    }

    const payload = { ...req.body };
    if (rawItems !== undefined) payload.items = rawItems;

    const pkg = await packageService.updatePackage(req.params.id, payload, req.user, req);
    req.flash('success', `${pkg.code} has been updated.`);
    return res.redirect(`/packages/${pkg._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect(`/packages/${req.params.id}/edit`);
    }
    throw err;
  }
});

exports.destroy = asyncHandler(async (req, res) => {
  try {
    const pkg = await packageService.softDeletePackage(req.params.id, req.user, req);
    req.flash('success', `${pkg.code} — ${pkg.name} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect(safeReferrer(req, '/packages'));
});

/**
 * JSON API endpoint returning package for the System Builder.
 */
exports.getJson = asyncHandler(async (req, res) => {
  const data = await packageService.getPackageForBuilder(req.params.id, req.user);
  return res.json({ success: true, data });
});
