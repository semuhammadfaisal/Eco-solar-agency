'use strict';

const mongoose = require('mongoose');
const Warranty = require('../models/Warranty');
const Installation = require('../models/Installation');
const SerialNo = require('../models/SerialNo');
const Item = require('../models/Item');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { buildWarrantyCertificatePdf } = require('./warrantyPdfService');
const { getSettings } = require('./settingsService');
const { paginate } = require('../utils/pagination');
const { escapeRegex, text } = require('../utils/inputs');
const { DEFAULT_WARRANTY_DURATIONS_YEARS } = require('../config/installations');

async function nextWarrantyNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`warranty_${year}`);
  return `WAR-${year}-${String(seq).padStart(4, '0')}`;
}

async function getWarrantyOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid warranty ID.');
  const warranty = await Warranty.findById(id)
    .populate('customer')
    .populate('sale', 'saleNumber')
    .populate('installation', 'installationNumber completedAt')
    .populate('item')
    .populate('serialNumber');

  if (!warranty) throw ApiError.notFound('Warranty record not found.');
  return warranty;
}

/**
 * Automatically creates warranty records upon installation completion / commissioning.
 */
async function autoCreateWarrantiesForInstallation(installationId, actor, req) {
  const inst = await Installation.findById(installationId)
    .populate('customer')
    .populate('sale')
    .populate('materialsIssued.item')
    .populate('materialsIssued.serialNumber');

  if (!inst) throw ApiError.notFound('Installation not found.');

  const startDate = inst.completedAt || inst.commissionedAt || new Date();
  const createdWarranties = [];

  const addYears = (baseDate, years) => {
    const d = new Date(baseDate);
    d.setFullYear(d.getFullYear() + years);
    return d;
  };

  // Group materials to prevent duplicate workmanship warranties
  const materials = inst.materialsIssued || [];

  for (const mat of materials) {
    const item = mat.item;
    if (!item) continue;

    const sDoc = mat.serialNumber;
    const sString = mat.serialString || (sDoc ? sDoc.serial : '');

    if (item.category === 'panel') {
      // 1. Panel Product Warranty
      const prodYears = item.productWarrantyYears || DEFAULT_WARRANTY_DURATIONS_YEARS.panel_product;
      const prodEnd = addYears(startDate, prodYears);
      const w1Number = await nextWarrantyNumber();

      const w1 = await Warranty.create({
        warrantyNumber: w1Number,
        customer: inst.customer._id,
        sale: inst.sale ? inst.sale._id : null,
        installation: inst._id,
        item: item._id,
        serialNumber: sDoc ? sDoc._id : null,
        serialString: sString,
        warrantyType: 'panel_product',
        startDate,
        endDate: prodEnd,
        years: prodYears,
        status: 'active',
        createdBy: actor ? actor._id : null,
      });
      createdWarranties.push(w1);

      // 2. Panel 25-Year Performance Warranty
      const perfYears = item.performanceWarrantyYears || DEFAULT_WARRANTY_DURATIONS_YEARS.panel_performance;
      const perfEnd = addYears(startDate, perfYears);
      const w2Number = await nextWarrantyNumber();

      const w2 = await Warranty.create({
        warrantyNumber: w2Number,
        customer: inst.customer._id,
        sale: inst.sale ? inst.sale._id : null,
        installation: inst._id,
        item: item._id,
        serialNumber: sDoc ? sDoc._id : null,
        serialString: sString,
        warrantyType: 'panel_performance',
        startDate,
        endDate: perfEnd,
        years: perfYears,
        status: 'active',
        createdBy: actor ? actor._id : null,
      });
      createdWarranties.push(w2);

      // Update Serial document dates
      if (sDoc) {
        await SerialNo.updateOne(
          { _id: sDoc._id },
          { $set: { productWarrantyEnd: prodEnd, performanceWarrantyEnd: perfEnd } }
        );
      }
    } else if (item.category === 'inverter') {
      const invYears = item.productWarrantyYears || DEFAULT_WARRANTY_DURATIONS_YEARS.inverter;
      const invEnd = addYears(startDate, invYears);
      const wNumber = await nextWarrantyNumber();

      const w = await Warranty.create({
        warrantyNumber: wNumber,
        customer: inst.customer._id,
        sale: inst.sale ? inst.sale._id : null,
        installation: inst._id,
        item: item._id,
        serialNumber: sDoc ? sDoc._id : null,
        serialString: sString,
        warrantyType: 'inverter',
        startDate,
        endDate: invEnd,
        years: invYears,
        status: 'active',
        createdBy: actor ? actor._id : null,
      });
      createdWarranties.push(w);

      if (sDoc) {
        await SerialNo.updateOne({ _id: sDoc._id }, { $set: { productWarrantyEnd: invEnd } });
      }
    } else if (item.category === 'battery') {
      const batYears = item.productWarrantyYears || DEFAULT_WARRANTY_DURATIONS_YEARS.battery;
      const batEnd = addYears(startDate, batYears);
      const wNumber = await nextWarrantyNumber();

      const w = await Warranty.create({
        warrantyNumber: wNumber,
        customer: inst.customer._id,
        sale: inst.sale ? inst.sale._id : null,
        installation: inst._id,
        item: item._id,
        serialNumber: sDoc ? sDoc._id : null,
        serialString: sString,
        warrantyType: 'battery',
        startDate,
        endDate: batEnd,
        years: batYears,
        status: 'active',
        createdBy: actor ? actor._id : null,
      });
      createdWarranties.push(w);

      if (sDoc) {
        await SerialNo.updateOne({ _id: sDoc._id }, { $set: { productWarrantyEnd: batEnd } });
      }
    }
  }

  // Workmanship Warranty (covers system installation)
  const workYears = DEFAULT_WARRANTY_DURATIONS_YEARS.workmanship;
  const workEnd = addYears(startDate, workYears);
  const workNumber = await nextWarrantyNumber();

  // Find primary item or first item for reference
  const firstItem = materials[0] ? materials[0].item : null;

  if (firstItem) {
    const workW = await Warranty.create({
      warrantyNumber: workNumber,
      customer: inst.customer._id,
      sale: inst.sale ? inst.sale._id : null,
      installation: inst._id,
      item: firstItem._id,
      serialNumber: null,
      serialString: 'Complete Turnkey System',
      warrantyType: 'workmanship',
      startDate,
      endDate: workEnd,
      years: workYears,
      status: 'active',
      terms: 'Covers physical mounting, AC/DC cable terminations, and earthing bonding integrity.',
      createdBy: actor ? actor._id : null,
    });
    createdWarranties.push(workW);
  }

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.WARRANTY_CREATED,
      'warranties',
      inst._id,
      {},
      { count: createdWarranties.length },
      { req, description: `Auto-generated ${createdWarranties.length} warranties for ${inst.installationNumber}` }
    );
  }

  return createdWarranties;
}

/**
 * List Warranties with search, customer, serial, and status filters.
 */
async function listWarranties(filters = {}, user) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const query = { deletedAt: null };

  if (filters.status) query.status = filters.status;
  if (filters.warrantyType) query.warrantyType = filters.warrantyType;
  if (filters.customer && mongoose.isValidObjectId(filters.customer)) {
    query.customer = filters.customer;
  }
  if (filters.search) {
    const s = escapeRegex(filters.search);
    query.$or = [
      { warrantyNumber: new RegExp(s, 'i') },
      { serialString: new RegExp(s, 'i') },
    ];
  }

  const [total, warranties] = await Promise.all([
    Warranty.countDocuments(query),
    Warranty.find(query)
      .populate('customer', 'name code phone')
      .populate('item', 'name sku category')
      .populate('installation', 'installationNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    warranties,
    total,
    pagination: paginate(total, page, limit),
  };
}

/**
 * Record warranty claim and swap serial numbers if replacement issued.
 */
async function recordWarrantyClaim(
  warrantyId,
  { issueDescription, oldSerial = '', replacementSerialId = null, resolutionNotes = '', claimStatus = 'approved' },
  actor,
  req
) {
  const warranty = await Warranty.findById(warrantyId).populate('customer item installation');
  if (!warranty) throw ApiError.notFound('Warranty record not found.');

  const claimNumber = `CLM-${String(warranty.claims.length + 1).padStart(3, '0')}`;
  let replacementSerialString = '';

  // If replacement serial provided, validate and update status
  if (replacementSerialId && mongoose.isValidObjectId(replacementSerialId)) {
    const repSerial = await SerialNo.findById(replacementSerialId);
    if (!repSerial) throw ApiError.notFound('Replacement serial number not found.');
    if (repSerial.status !== 'in_stock') {
      throw ApiError.conflict(`Replacement serial "${repSerial.serial}" must be in_stock.`);
    }

    replacementSerialString = repSerial.serial;

    // Move old serial to defective
    if (warranty.serialNumber) {
      await SerialNo.updateOne(
        { _id: warranty.serialNumber },
        {
          $set: { status: 'defective' },
          $push: {
            events: {
              status: 'defective',
              at: new Date(),
              note: `Replaced under warranty claim ${claimNumber}. Reason: ${issueDescription}`,
              user: actor ? actor._id : null,
            },
          },
        }
      );
    }

    // Move new serial to installed
    repSerial.status = 'installed';
    repSerial.customer = warranty.customer._id;
    repSerial.project = warranty.installation ? warranty.installation.installationNumber : 'Warranty Replacement';
    repSerial.productWarrantyEnd = warranty.endDate;
    repSerial.events.push({
      status: 'installed',
      at: new Date(),
      note: `Issued as warranty replacement for ${warranty.serialString || 'Old Serial'} (Claim ${claimNumber})`,
      customer: warranty.customer._id,
      user: actor ? actor._id : null,
    });
    await repSerial.save();

    // Update warranty with replacement serial
    warranty.serialNumber = repSerial._id;
    warranty.serialString = repSerial.serial;
    warranty.status = 'claimed';
  }

  warranty.claims.push({
    claimNumber,
    claimDate: new Date(),
    issueDescription: text(issueDescription, 1000),
    claimStatus,
    oldSerial: oldSerial || warranty.serialString,
    replacementSerial: replacementSerialString,
    replacementSerialId: replacementSerialId || null,
    resolutionNotes: text(resolutionNotes, 1000),
    resolvedAt: claimStatus === 'approved' || claimStatus === 'replaced' ? new Date() : null,
    processedBy: actor ? actor._id : null,
  });

  await warranty.save();

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.WARRANTY_CLAIMED,
      'warranties',
      warranty._id,
      {},
      { claimNumber, replacementSerial: replacementSerialString },
      { req, description: `Warranty claim ${claimNumber} logged for ${warranty.warrantyNumber}` }
    );
  }

  return warranty;
}

/**
 * Generates Warranty Certificate PDF.
 */
async function generateWarrantyCertificatePdf(warrantyId) {
  const warranty = await getWarrantyOrThrow(warrantyId);
  const settings = await getSettings();
  return buildWarrantyCertificatePdf(warranty, settings);
}

module.exports = {
  nextWarrantyNumber,
  getWarrantyOrThrow,
  autoCreateWarrantiesForInstallation,
  listWarranties,
  recordWarrantyClaim,
  generateWarrantyCertificatePdf,
};
