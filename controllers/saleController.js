'use strict';

const asyncHandler = require('../utils/asyncHandler');
const saleService = require('../services/saleService');
const customerService = require('../services/customerService');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');
const { SALE_STATUS_LABELS } = require('../config/quotations');
const { sanitisedOldInput } = require('../middleware/validate');

const projectsBreadcrumb = { label: 'Projects', url: '/projects' };

exports.index = asyncHandler(async (req, res) => {
  const { sales, total, pagination, stats, scope } = await saleService.listSales(
    req.query,
    req.user
  );

  const [customers, officers] = await Promise.all([
    customerService.listCustomerOptions(500),
    req.user.role === ROLES.SALES
      ? Promise.resolve([])
      : User.find({
          role: { $in: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES] },
          isActive: true,
        })
          .select('name role')
          .sort({ name: 1 })
          .lean(),
  ]);

  return res.render('projects/index', {
    layout: 'layouts/admin',
    title: 'Projects',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, projectsBreadcrumb],
    sales,
    total,
    stats,
    activeScope: scope,
    pagination,
    customers,
    officers,
    filters: {
      search: req.query.search || '',
      customer: req.query.customer || '',
      assignedTo: req.query.assignedTo || '',
    },
    canViewProfit: can(req.user, 'profit.view'),
    canViewCosts: can(req.user, 'costs.view'),
    canManage: can(req.user, 'projects.manage'),
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  const [customers, officers] = await Promise.all([
    customerService.listCustomerOptions(500),
    User.find({
      role: { $in: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES] },
      isActive: true,
    })
      .select('name role')
      .sort({ name: 1 })
      .lean(),
  ]);

  return res.render('projects/form', {
    layout: 'layouts/admin',
    title: 'Start a project',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      projectsBreadcrumb,
      { label: 'New project' },
    ],
    customers,
    officers,
    canViewCosts: can(req.user, 'costs.view'),
    isSalesUser: req.user.role === ROLES.SALES,
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    const sale = await saleService.createProject(req.body, req.user, req);

    req.flash(
      'success',
      `Project ${sale.saleNumber} started for ${sale.projectTitle || 'the customer'}.`
    );
    return res.redirect(`/projects/${sale._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      req.flash('oldInput', sanitisedOldInput(req.body));
      return res.redirect('/projects/new');
    }
    throw err;
  }
});

exports.show = asyncHandler(async (req, res) => {
  const sale = await saleService.getSaleOrThrow(req.params.id, req.user);

  return res.render('projects/show', {
    layout: 'layouts/admin',
    title: `${sale.saleNumber} — ${sale.customer ? sale.customer.name : 'Project'}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      projectsBreadcrumb,
      { label: sale.saleNumber },
    ],
    sale,
    canViewProfit: can(req.user, 'profit.view'),
    canViewCosts: can(req.user, 'costs.view'),
    canManage: can(req.user, 'projects.manage'),
  });
});

exports.updateStatus = asyncHandler(async (req, res) => {
  try {
    const { status, notes } = req.body;
    const sale = await saleService.updateSaleStatus(req.params.id, status, notes, req.user, req);
    req.flash(
      'success',
      `${sale.saleNumber} status updated to ${SALE_STATUS_LABELS[status] || status}.`
    );
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(`/projects/${req.params.id}`);
});
