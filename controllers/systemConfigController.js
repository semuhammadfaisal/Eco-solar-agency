'use strict';

const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const systemConfigService = require('../services/systemConfigService');
const packageService = require('../services/packageService');
const itemService = require('../services/itemService');
const customerService = require('../services/customerService');
const surveyService = require('../services/surveyService');
const { getSettings } = require('../services/settingsService');
const { safeReferrer } = require('../utils/urls');
const ApiError = require('../utils/ApiError');
const { can } = require('../config/permissions');

const systemsBreadcrumb = { label: 'Saved Systems', url: '/system-configs' };

/**
 * System Builder interactive page (EJS + Alpine.js).
 */
exports.builder = asyncHandler(async (req, res) => {
  const [settings, inventoryItems, packages] = await Promise.all([
    getSettings(),
    itemService.listItemsForSelector(req.user),
    packageService.listActivePackages(),
  ]);

  let initialConfig = {
    name: 'New Solar System',
    systemType: 'on_grid',
    customer: null,
    survey: null,
    package: null,
    lines: [],
    laborCost: settings.defaultLaborCostPaisa ? (settings.defaultLaborCostPaisa / 100) : 0,
    transportCost: settings.defaultTransportCostPaisa ? (settings.defaultTransportCostPaisa / 100) : 0,
    netMeteringCost: settings.defaultNetMeteringCostPaisa ? (settings.defaultNetMeteringCostPaisa / 100) : 0,
    additionalCost: 0,
    discountType: 'percent',
    discountValue: 0,
    salesCommissionRateBps: 0,
    remarks: '',
  };

  // If loading from survey:
  if (req.query.survey && mongoose.isValidObjectId(req.query.survey)) {
    try {
      const survey = await surveyService.getSurveyOrThrow(req.query.survey, req.user);
      initialConfig.survey = survey._id;
      initialConfig.customer = survey.customer ? survey.customer._id : null;
      if (survey.systemType) initialConfig.systemType = survey.systemType;

      const contactName = survey.customer ? survey.customer.name : '';
      const kwLabel = survey.recommendedKw ? `${survey.recommendedKw}kW ` : '';
      initialConfig.name = `${kwLabel}System - ${contactName || survey.number}`;
    } catch (e) {
      /* ignore invalid survey */
    }
  }

  // If loading from customer:
  if (req.query.customer && mongoose.isValidObjectId(req.query.customer)) {
    try {
      const customer = await customerService.getCustomerOrThrow(req.query.customer);
      initialConfig.customer = customer._id;
      initialConfig.name = `Solar System - ${customer.name}`;
    } catch (e) {
      /* ignore */
    }
  }

  // If preloading from a package template:
  if (req.query.package && mongoose.isValidObjectId(req.query.package)) {
    try {
      const pkgData = await packageService.getPackageForBuilder(req.query.package, req.user);
      initialConfig.package = pkgData.id;
      initialConfig.systemType = pkgData.systemType;
      initialConfig.name = pkgData.name;
      initialConfig.lines = pkgData.lines;
      if (pkgData.laborCostPaisa) initialConfig.laborCost = pkgData.laborCostPaisa / 100;
      if (pkgData.transportCostPaisa) initialConfig.transportCost = pkgData.transportCostPaisa / 100;
      if (pkgData.netMeteringCostPaisa) initialConfig.netMeteringCost = pkgData.netMeteringCostPaisa / 100;
      if (pkgData.additionalCostPaisa) initialConfig.additionalCost = pkgData.additionalCostPaisa / 100;
      if (pkgData.defaultDiscountPercent) initialConfig.discountValue = pkgData.defaultDiscountPercent;
    } catch (e) {
      /* ignore */
    }
  }

  // If editing an existing SystemConfig:
  if (req.query.config && mongoose.isValidObjectId(req.query.config)) {
    try {
      const existing = await systemConfigService.getSystemConfigOrThrow(req.query.config, req.user);
      initialConfig = {
        _id: existing._id,
        number: existing.number,
        name: existing.name,
        systemType: existing.systemType,
        customer: existing.customer ? existing.customer._id : null,
        survey: existing.survey ? existing.survey._id : null,
        package: existing.package ? existing.package._id : null,
        lines: (existing.lines || []).map((l) => ({
          item: l.item ? (l.item._id || l.item) : null,
          itemSnapshot: l.itemSnapshot || {},
          qty: l.qty,
          unitSellingPricePaisa: l.unitSellingPricePaisa,
          unitCostPaisa: l.unitCostPaisa || 0,
          notes: l.notes || '',
        })),
        laborCost: (existing.laborCostPaisa || 0) / 100,
        transportCost: (existing.transportCostPaisa || 0) / 100,
        netMeteringCost: (existing.netMeteringCostPaisa || 0) / 100,
        additionalCost: (existing.additionalCostPaisa || 0) / 100,
        discountType: existing.discountType || 'percent',
        discountValue: existing.discountType === 'amount' ? (existing.discountPaisa || 0) / 100 : (existing.discountPercent || 0),
        salesCommissionRateBps: existing.salesCommissionRateBps || 0,
        remarks: existing.remarks || '',
      };
    } catch (e) {
      /* ignore */
    }
  }

  // Pre-fetch customer options for builder selector
  const customers = await customerService.listCustomerOptions(500);

  return res.render('system_builder/builder', {
    layout: 'layouts/admin',
    title: 'System Builder',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      systemsBreadcrumb,
      { label: 'System Builder' },
    ],
    initialConfig,
    inventoryItems,
    packages,
    customers,
    settings: {
      minMarginPercent: settings.minMarginPercent || 10,
      maxDiscountPercentWithoutApproval: settings.maxDiscountPercentWithoutApproval || 5,
      surveyMonthlyUnitsPerKw: settings.surveyMonthlyUnitsPerKw || 120,
    },
    userPermissions: {
      isOwner: req.user.role === 'owner',
      canViewCosts: can(req.user, 'costs.view'),
      canViewProfit: can(req.user, 'profit.view'),
    },
  });
});

/**
 * Server calculation preview API (POST /system-builder/calculate).
 */
exports.calculateAjax = asyncHandler(async (req, res) => {
  const calculation = await systemConfigService.previewCalculation(req.body, req.user);
  return res.json({ success: true, data: calculation });
});

/**
 * Save SystemConfig (POST /system-builder).
 */
exports.create = asyncHandler(async (req, res) => {
  try {
    let rawLines = [];
    if (req.body.linesJson) {
      try {
        rawLines = JSON.parse(req.body.linesJson);
      } catch (e) {
        throw ApiError.badRequest('Invalid system items format.');
      }
    } else if (Array.isArray(req.body.lines)) {
      rawLines = req.body.lines;
    }

    const payload = { ...req.body, lines: rawLines };
    const config = await systemConfigService.createSystemConfig(payload, req.user, req);

    if (config.approvalStatus === 'pending') {
      req.flash(
        'warning',
        `${config.number} — ${config.name} was saved and is pending owner approval for discount/pricing.`
      );
    } else {
      req.flash('success', `${config.number} — ${config.name} has been configured and saved.`);
    }

    return res.redirect(`/system-configs/${config._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/system-builder');
    }
    throw err;
  }
});

/**
 * List saved system configurations (GET /system-configs).
 */
exports.index = asyncHandler(async (req, res) => {
  const { configs, total, pagination } = await systemConfigService.listSystemConfigs(
    req.query,
    req.user
  );

  return res.render('system_builder/index', {
    layout: 'layouts/admin',
    title: 'Saved Systems & BOM',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Saved Systems' }],
    configs,
    total,
    pagination,
    filters: {
      search: req.query.search || '',
      systemType: req.query.systemType || '',
      approvalStatus: req.query.approvalStatus || '',
    },
  });
});

/**
 * Show Bill of Materials (BOM) & System Details (GET /system-configs/:id).
 */
exports.show = asyncHandler(async (req, res) => {
  const config = await systemConfigService.getSystemConfigOrThrow(req.params.id, req.user);
  const isOwner = req.user.role === 'owner';
  const canViewCosts = can(req.user, 'costs.view');
  const canViewProfit = can(req.user, 'profit.view');

  return res.render('system_builder/show', {
    layout: 'layouts/admin',
    title: `${config.number} — ${config.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      systemsBreadcrumb,
      { label: config.number },
    ],
    config,
    isOwner,
    canViewCosts,
    canViewProfit,
  });
});

/**
 * Clean printable BOM view (GET /system-configs/:id/print).
 */
exports.print = asyncHandler(async (req, res) => {
  const config = await systemConfigService.getSystemConfigOrThrow(req.params.id, req.user);
  const settings = await getSettings();

  return res.render('system_builder/print', {
    layout: false, // standalone printable document
    config,
    settings,
    title: `BOM — ${config.number}`,
  });
});

/**
 * Owner approval (POST /system-configs/:id/approve).
 */
exports.approve = asyncHandler(async (req, res) => {
  try {
    const config = await systemConfigService.approveSystemConfig(
      req.params.id,
      req.body.notes,
      req.user,
      req
    );
    req.flash('success', `${config.number} has been approved.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(`/system-configs/${req.params.id}`);
});

/**
 * Owner rejection (POST /system-configs/:id/reject).
 */
exports.reject = asyncHandler(async (req, res) => {
  try {
    const config = await systemConfigService.rejectSystemConfig(
      req.params.id,
      req.body.notes,
      req.user,
      req
    );
    req.flash('warning', `${config.number} pricing has been rejected.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(`/system-configs/${req.params.id}`);
});

/**
 * Soft delete (DELETE /system-configs/:id).
 */
exports.destroy = asyncHandler(async (req, res) => {
  try {
    const config = await systemConfigService.softDeleteSystemConfig(req.params.id, req.user, req);
    req.flash('success', `${config.number} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(safeReferrer(req, '/system-configs'));
});
