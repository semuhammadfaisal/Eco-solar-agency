/** Customer controllers. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const customerService = require('../services/customerService');
const systemConfigService = require('../services/systemConfigService');
const quotationService = require('../services/quotationService');
const installmentService = require('../services/installmentService');
const Installation = require('../models/Installation');
const Warranty = require('../models/Warranty');
const Complaint = require('../models/Complaint');
const { safeReferrer } = require('../utils/urls');

const PROFILE_TABS = [
  'overview',
  'surveys',
  'quotations',
  'installments',
  'installations',
  'warranty',
  'complaints',
];

const customersBreadcrumb = { label: 'Customers', url: '/customers' };

exports.index = asyncHandler(async (req, res) => {
  const { search = '', type = '', city = '', source = '', disco = '' } = req.query;

  const [{ items, total, pagination }, cities] = await Promise.all([
    customerService.paginateCustomers({
      search,
      type,
      city,
      source,
      disco,
      page: req.query.page,
      limit: req.query.limit,
    }),
    customerService.listCities(),
  ]);

  return res.render('customers/index', {
    layout: 'layouts/admin',
    title: 'Customers',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Customers' }],
    customers: items,
    total,
    pagination,
    cities,
    filters: {
      search: String(search).slice(0, 80),
      type,
      city,
      source,
      disco,
    },
  });
});

exports.newForm = (req, res) => {
  return res.render('customers/form', {
    layout: 'layouts/admin',
    title: 'Add customer',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      customersBreadcrumb,
      { label: 'Add customer' },
    ],
    customer: null,
    formAction: '/customers',
    formMethod: 'POST',
    isEdit: false,
  });
};

exports.create = asyncHandler(async (req, res) => {
  try {
    const customer = await customerService.createCustomer(req.body, req.user, req);
    req.flash('success', `${customer.code} — ${customer.name} has been added.`);
    return res.redirect(`/customers/${customer._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect('/customers/new');
  }
});

exports.show = asyncHandler(async (req, res) => {
  const customer = await customerService.getCustomerOrThrow(req.params.id);
  const requestedTab = String(req.query.tab || 'overview').toLowerCase();
  const activeTab = PROFILE_TABS.includes(requestedTab) ? requestedTab : 'overview';

  const [
    systemConfigs,
    customerQuotations,
    installmentLedger,
    customerInstallations,
    customerWarranties,
    customerComplaints,
  ] = await Promise.all([
    activeTab === 'quotations' ? systemConfigService.listSystemConfigs({ customer: customer._id }, req.user).then(r => r.configs) : Promise.resolve([]),
    activeTab === 'quotations' ? quotationService.listQuotations({ customer: customer._id }, req.user).then(r => r.quotations) : Promise.resolve([]),
    activeTab === 'installments' ? installmentService.getCustomerInstallmentLedger(customer._id) : Promise.resolve(null),
    activeTab === 'installations' ? Installation.find({ customer: customer._id, deletedAt: null }).populate('leadTechnician', 'name').sort({ createdAt: -1 }).lean() : Promise.resolve([]),
    activeTab === 'warranty' ? Warranty.find({ customer: customer._id, deletedAt: null }).populate('item', 'name sku').sort({ endDate: -1 }).lean() : Promise.resolve([]),
    activeTab === 'complaints' ? Complaint.find({ customer: customer._id, deletedAt: null }).populate('assignedTechnician', 'name').sort({ createdAt: -1 }).lean() : Promise.resolve([]),
  ]);

  return res.render('customers/show', {
    layout: 'layouts/admin',
    title: customer.name,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      customersBreadcrumb,
      { label: customer.name },
    ],
    customer,
    systemConfigs,
    customerQuotations,
    installmentLedger,
    customerInstallations,
    customerWarranties,
    customerComplaints,
    activeTab,
    tabs: PROFILE_TABS,
  });
});

exports.editForm = asyncHandler(async (req, res) => {
  const customer = await customerService.getCustomerOrThrow(req.params.id);

  return res.render('customers/form', {
    layout: 'layouts/admin',
    title: `Edit ${customer.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      customersBreadcrumb,
      { label: customer.name, url: `/customers/${customer._id}` },
      { label: 'Edit' },
    ],
    customer,
    formAction: `/customers/${customer._id}`,
    formMethod: 'PUT',
    isEdit: true,
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const customer = await customerService.updateCustomer(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash('success', `${customer.name} has been updated.`);
    return res.redirect(`/customers/${customer._id}`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/customers/${req.params.id}/edit`);
  }
});

exports.destroy = asyncHandler(async (req, res) => {
  try {
    const customer = await customerService.softDeleteCustomer(req.params.id, req.user, req);
    req.flash('success', `${customer.name} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect(safeReferrer(req, '/customers'));
});
