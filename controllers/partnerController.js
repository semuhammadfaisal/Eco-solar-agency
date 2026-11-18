/** Partner controllers: equity list, profit share and partner cash records. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const partnerService = require('../services/partnerService');
const { EXPENSE_CATEGORIES } = require('../config/accounting');
const { todayKey } = require('../utils/dates');

const partnersBreadcrumb = { label: 'Partners', url: '/partners' };

function cleanTerm(value) {
  return String(value || '').trim().slice(0, 80);
}

function matchesTerm(partner, term) {
  if (!term) return true;
  const needle = term.toLowerCase();
  return [partner.name, partner.code, partner.phone, partner.email, partner.cnic]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

exports.index = asyncHandler(async (req, res) => {
  const overview = await partnerService.getPartnersOverview(req.query);
  const search = cleanTerm(req.query.search);
  const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : '';

  let partners = overview.partners;
  if (status === 'active') partners = partners.filter((partner) => partner.isActive);
  if (status === 'inactive') partners = partners.filter((partner) => !partner.isActive);
  partners = partners.filter((partner) => matchesTerm(partner, search));

  return res.render('partners/index', {
    layout: 'layouts/admin',
    title: 'Partners',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Partners' }],
    partners,
    pnl: overview.pnl,
    totalEquityBps: overview.totalEquityBps,
    totalEquityPercent: overview.totalEquityPercent,
    distributedPaisa: overview.distributedPaisa,
    unallocatedPaisa: overview.unallocatedPaisa,
    period: overview.period,
    filters: { search, status },
  });
});

exports.newForm = asyncHandler(async (req, res) =>
  res.render('partners/form', {
    layout: 'layouts/admin',
    title: 'Add partner',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      partnersBreadcrumb,
      { label: 'Add partner' },
    ],
    partner: null,
    formAction: '/partners',
    formMethod: 'POST',
    isEdit: false,
    today: todayKey(),
  })
);

exports.create = asyncHandler(async (req, res) => {
  try {
    const partner = await partnerService.createPartner(req.body, req.user, req);
    req.flash('success', `Partner ${partner.name} has been added.`);
    return res.redirect('/partners');
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect('/partners/new');
  }
});

exports.editForm = asyncHandler(async (req, res) => {
  const partner = await partnerService.getPartnerOrThrow(req.params.id);

  return res.render('partners/form', {
    layout: 'layouts/admin',
    title: `Edit ${partner.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      partnersBreadcrumb,
      { label: partner.name, url: `/partners/${partner._id}` },
      { label: 'Edit' },
    ],
    partner,
    formAction: `/partners/${partner._id}`,
    formMethod: 'PUT',
    isEdit: true,
    today: todayKey(),
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const partner = await partnerService.updatePartner(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash('success', `Partner ${partner.name} has been updated.`);
    return res.redirect(`/partners/${partner._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/partners/${req.params.id}/edit`);
  }
});

exports.destroy = asyncHandler(async (req, res) => {
  try {
    const partner = await partnerService.softDeletePartner(req.params.id, req.user, req);
    req.flash('success', `Partner ${partner.name} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect('/partners');
});

exports.show = asyncHandler(async (req, res) => {
  const detail = await partnerService.getPartnerDetail(req.params.id, req.query);

  return res.render('partners/show', {
    layout: 'layouts/admin',
    title: detail.partner.name,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      partnersBreadcrumb,
      { label: detail.partner.name },
    ],
    partner: detail.partner,
    transactions: detail.transactions,
    totals: detail.totals,
    pnl: detail.pnl,
    profitSharePaisa: detail.profitSharePaisa,
    period: detail.period,
    expenseCategories: EXPENSE_CATEGORIES,
    today: todayKey(),
  });
});

exports.recordTransaction = asyncHandler(async (req, res) => {
  try {
    const { transaction } = await partnerService.recordTransaction(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash(
      'success',
      `Partner cash record ${transaction.reference} has been saved.`
    );
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect(`/partners/${req.params.id}`);
});
