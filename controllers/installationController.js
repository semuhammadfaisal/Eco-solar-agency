'use strict';

const installationService = require('../services/installationService');
const User = require('../models/User');
const Item = require('../models/Item');
const SerialNo = require('../models/SerialNo');
const Sale = require('../models/Sale');
const { ROLES } = require('../config/roles');
const { INSTALLATION_CHECKLIST } = require('../config/installations');

async function index(req, res, next) {
  try {
    const { installations, total, pagination } = await installationService.listInstallations(
      req.query,
      req.user
    );

    const technicians = await User.find({
      role: { $in: [ROLES.TECHNICIAN, ROLES.MANAGER, ROLES.OWNER] },
      isActive: true,
    }).lean();

    return res.render('installations/index', {
      title: 'Installation Projects & Commissioning',
      installations,
      total,
      pagination,
      technicians,
      filters: req.query,
      breadcrumbs: [
        { label: 'Operations', url: '/installations' },
        { label: 'Installations', url: '/installations' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const installation = await installationService.getInstallationOrThrow(req.params.id);

    const technicians = await User.find({
      role: { $in: [ROLES.TECHNICIAN, ROLES.MANAGER, ROLES.OWNER] },
      isActive: true,
    }).lean();

    // Available inventory items & in_stock serials for material issuing modal
    const availableItems = await Item.find({ currentStock: { $gt: 0 }, deletedAt: null })
      .select('name sku category unit currentStock hasSerial')
      .lean();

    const inStockSerials = await SerialNo.find({ status: 'in_stock', deletedAt: null })
      .populate('item', 'name sku')
      .limit(200)
      .lean();

    return res.render('installations/show', {
      title: `Installation ${installation.installationNumber}`,
      installation,
      technicians,
      availableItems,
      inStockSerials,
      checklistDef: INSTALLATION_CHECKLIST,
      breadcrumbs: [
        { label: 'Operations', url: '/installations' },
        { label: 'Installations', url: '/installations' },
        { label: installation.installationNumber },
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { saleId, leadTechnician, scheduledStartDate, scheduledEndDate } = req.body;

    const inst = await installationService.createInstallationFromSale(
      saleId,
      { leadTechnician, scheduledStartDate, scheduledEndDate },
      req.user,
      req
    );

    req.flash('success', `Installation project ${inst.installationNumber} opened.`);
    return res.redirect(`/installations/${inst._id}`);
  } catch (err) {
    next(err);
  }
}

async function issueMaterials(req, res, next) {
  try {
    const { itemId, qty, serials, notes } = req.body;

    const lines = [];
    if (Array.isArray(itemId)) {
      for (let i = 0; i < itemId.length; i++) {
        if (!itemId[i]) continue;
        lines.push({
          itemId: itemId[i],
          qty: qty[i] || 1,
          serials: serials && serials[i] ? serials[i] : '',
        });
      }
    } else if (itemId) {
      lines.push({ itemId, qty, serials });
    }

    await installationService.issueMaterials({
      installationId: req.params.id,
      materialLines: lines,
      notes,
      actor: req.user,
      req,
    });

    req.flash('success', 'Materials and serial numbers successfully issued from warehouse.');
    return res.redirect(`/installations/${req.params.id}`);
  } catch (err) {
    req.flash('error', err.message);
    return res.redirect(`/installations/${req.params.id}`);
  }
}

async function updateSchedule(req, res, next) {
  try {
    const inst = await installationService.updateSchedule(
      req.params.id,
      req.body,
      req.user,
      req
    );

    req.flash('success', 'Installation schedule and technician team updated.');
    return res.redirect(`/installations/${inst._id}`);
  } catch (err) {
    next(err);
  }
}

async function updateChecklist(req, res, next) {
  try {
    const { checklist, readings, status } = req.body;

    await installationService.updateChecklistAndReadings(
      req.params.id,
      { checklist, readings, status },
      req.user,
      req
    );

    req.flash('success', 'Checklist and electrical readings saved.');
    return res.redirect(req.get('Referrer') || `/installations/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function recordSignoff(req, res, next) {
  try {
    await installationService.recordCustomerSignoff(
      req.params.id,
      req.body,
      req.user,
      req
    );

    req.flash('success', 'Customer sign-off and rating recorded.');
    return res.redirect(req.get('Referrer') || `/installations/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function commission(req, res, next) {
  try {
    const { commissioningNotes } = req.body;

    const { installation, warranties } = await installationService.commissionInstallation(
      req.params.id,
      { commissioningNotes },
      req.user,
      req
    );

    req.flash(
      'success',
      `Installation ${installation.installationNumber} commissioned! ${warranties.length} official warranty certificates generated.`
    );
    return res.redirect(`/installations/${installation._id}`);
  } catch (err) {
    next(err);
  }
}

async function commissioningPdf(req, res, next) {
  try {
    const pdfBuffer = await installationService.generateCommissioningPdf(req.params.id);
    const inst = await installationService.getInstallationOrThrow(req.params.id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Commissioning-Report-${inst.installationNumber}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  index,
  show,
  create,
  issueMaterials,
  updateSchedule,
  updateChecklist,
  recordSignoff,
  commission,
  commissioningPdf,
};
