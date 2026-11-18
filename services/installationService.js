'use strict';

const mongoose = require('mongoose');
const Installation = require('../models/Installation');
const Sale = require('../models/Sale');
const Customer = require('../models/Customer');
const Item = require('../models/Item');
const SerialNo = require('../models/SerialNo');
const StockMovement = require('../models/StockMovement');
const Counter = require('../models/Counter');
const AppNotification = require('../models/AppNotification');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { checkMaterialIssueGate } = require('./installmentService');
const { autoCreateWarrantiesForInstallation } = require('./warrantyService');
const { buildCommissioningPdf } = require('./commissioningPdfService');
const { getSettings } = require('./settingsService');
const { paginate, escapeRegex } = require('../utils/pagination');
const { text } = require('../utils/inputs');
const { ROLES } = require('../config/roles');

async function nextInstallationNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`installation_${year}`);
  return `INS-${year}-${String(seq).padStart(4, '0')}`;
}

async function getInstallationOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid installation ID.');
  const inst = await Installation.findById(id)
    .populate('customer')
    .populate('sale')
    .populate('leadTechnician', 'name email phone role')
    .populate('technicians', 'name email phone role')
    .populate('materialsIssued.item', 'sku name category unit currentStock hasSerial')
    .populate('materialsIssued.serialNumber', 'serial status');

  if (!inst) throw ApiError.notFound('Installation record not found.');
  return inst;
}

/**
 * Creates an Installation from an Approved Sale.
 */
async function createInstallationFromSale(saleId, payload = {}, actor, req) {
  if (!mongoose.isValidObjectId(saleId)) throw ApiError.badRequest('Invalid sale ID.');
  const sale = await Sale.findById(saleId).populate('customer');
  if (!sale) throw ApiError.notFound('Sale contract not found.');

  // If already exists, return existing
  const existing = await Installation.findOne({ sale: saleId, deletedAt: null });
  if (existing) return existing;

  const installationNumber = await nextInstallationNumber();

  const inst = await Installation.create({
    installationNumber,
    sale: sale._id,
    customer: sale.customer._id,
    leadTechnician: payload.leadTechnician || null,
    technicians: payload.technicians || [],
    status: 'approved',
    scheduledStartDate: payload.scheduledStartDate ? new Date(payload.scheduledStartDate) : null,
    scheduledEndDate: payload.scheduledEndDate ? new Date(payload.scheduledEndDate) : null,
    createdBy: actor ? actor._id : null,
  });

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.INSTALLATION_CREATED,
      'installations',
      inst._id,
      {},
      { installationNumber, saleNumber: sale.saleNumber },
      { req, description: `Installation project created: ${installationNumber}` }
    );
  }

  return inst;
}

/**
 * Material Issue: Picks actual serial numbers from stock, generates OUT movements,
 * marks serials Issued, and verifies the installment checklist security gate.
 */
async function issueMaterials({ installationId, materialLines = [], notes = '', actor, req }) {
  const installation = await Installation.findById(installationId).populate('sale customer');
  if (!installation) throw ApiError.notFound('Installation not found.');

  // Check installment security checklist gate if sale is installment-financed
  if (installation.sale) {
    await checkMaterialIssueGate(installation.sale._id, actor);
  }

  if (!materialLines.length) {
    throw ApiError.badRequest('No materials specified for issue.');
  }

  const issuedRecords = [];

  for (const line of materialLines) {
    const itemId = line.itemId || line.item;
    const qty = Math.max(1, parseInt(line.qty, 10) || 1);
    const serialStrings = Array.isArray(line.serials)
      ? line.serials
      : typeof line.serials === 'string' && line.serials.trim()
      ? line.serials.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean)
      : [];

    const item = await Item.findById(itemId);
    if (!item) throw ApiError.notFound(`Item ID ${itemId} not found.`);

    if (item.currentStock < qty) {
      throw ApiError.conflict(
        `Insufficient stock for ${item.name} (${item.sku}). Available: ${item.currentStock} ${item.unit}, Requested: ${qty} ${item.unit}.`
      );
    }

    if (item.hasSerial) {
      if (serialStrings.length !== qty) {
        throw ApiError.badRequest(
          `Item ${item.sku} requires exactly ${qty} serial numbers. Provided: ${serialStrings.length}.`
        );
      }

      for (const sStr of serialStrings) {
        const cleanS = sStr.trim().toUpperCase();
        const serialDoc = await SerialNo.findOne({ serial: cleanS, deletedAt: null });
        if (!serialDoc) {
          throw ApiError.notFound(`Serial number "${cleanS}" not found in system.`);
        }
        if (serialDoc.status !== 'in_stock') {
          throw ApiError.conflict(
            `Serial "${cleanS}" cannot be issued. Current status: ${serialDoc.status}. Must be in_stock.`
          );
        }

        // Mark serial issued and link to customer and project
        serialDoc.status = 'issued';
        serialDoc.customer = installation.customer._id;
        serialDoc.project = installation.installationNumber;
        serialDoc.events.push({
          status: 'issued',
          at: new Date(),
          note: `Issued for installation ${installation.installationNumber}`,
          customer: installation.customer._id,
          project: installation.installationNumber,
          user: actor ? actor._id : null,
        });
        await serialDoc.save();

        issuedRecords.push({
          item: item._id,
          serialNumber: serialDoc._id,
          serialString: serialDoc.serial,
          qty: 1,
          issuedAt: new Date(),
          issuedBy: actor ? actor._id : null,
        });
      }
    } else {
      issuedRecords.push({
        item: item._id,
        serialNumber: null,
        serialString: '',
        qty,
        issuedAt: new Date(),
        issuedBy: actor ? actor._id : null,
      });
    }

    // Deduct stock balance
    const newStock = item.currentStock - qty;
    await Item.updateOne({ _id: item._id }, { $set: { currentStock: newStock } });

    // Append OUT stock ledger movement
    await StockMovement.create({
      item: item._id,
      type: 'OUT',
      qty: -qty,
      unitCostPaisa: item.avgCostPaisa || 0,
      balanceAfter: newStock,
      reference: installation.installationNumber,
      referenceType: 'installation',
      notes: notes || `Issued to site for project ${installation.installationNumber}`,
      occurredAt: new Date(),
      createdBy: actor ? actor._id : null,
    });
  }

  // Update installation materials & status
  installation.materialsIssued.push(...issuedRecords);
  if (['approved'].includes(installation.status)) {
    installation.status = 'material_issued';
  }
  await installation.save();

  // Mark linked Sale as material issued
  if (installation.sale) {
    await Sale.updateOne(
      { _id: installation.sale._id },
      {
        $set: {
          isMaterialIssued: true,
          materialIssuedAt: new Date(),
          materialIssuedBy: actor ? actor._id : null,
          materialIssueNotes: notes,
        },
      }
    );
  }

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.MATERIAL_ISSUED,
      'installations',
      installation._id,
      {},
      { materialsIssuedCount: issuedRecords.length },
      { req, description: `Issued ${issuedRecords.length} equipment items for ${installation.installationNumber}` }
    );
  }

  return installation;
}

/**
 * Update schedule & technician team.
 */
async function updateSchedule(installationId, payload, actor, req) {
  const inst = await Installation.findById(installationId);
  if (!inst) throw ApiError.notFound('Installation not found.');

  if (payload.leadTechnician) inst.leadTechnician = payload.leadTechnician;
  if (Array.isArray(payload.technicians)) inst.technicians = payload.technicians;
  if (payload.scheduledStartDate) inst.scheduledStartDate = new Date(payload.scheduledStartDate);
  if (payload.scheduledEndDate) inst.scheduledEndDate = new Date(payload.scheduledEndDate);

  if (inst.status === 'material_issued' && inst.scheduledStartDate) {
    inst.status = 'scheduled';
  }

  await inst.save();

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.INSTALLATION_SCHEDULED,
      'installations',
      inst._id,
      {},
      { scheduledStartDate: inst.scheduledStartDate },
      { req, description: `Installation scheduled for ${inst.installationNumber}` }
    );
  }

  return inst;
}

/**
 * Update technical checklist & electrical measurements.
 */
async function updateChecklistAndReadings(installationId, { checklist = {}, readings = {}, status }, actor, req) {
  const inst = await Installation.findById(installationId);
  if (!inst) throw ApiError.notFound('Installation not found.');

  // Update checklist flags
  for (const [k, v] of Object.entries(checklist)) {
    inst.checklist[k] = v === true || v === 'true' || v === 'on';
  }

  // Update readings
  if (readings.vocReadingVolts !== undefined && readings.vocReadingVolts !== '') {
    inst.readings.vocReadingVolts = Number(readings.vocReadingVolts);
  }
  if (readings.iscReadingAmps !== undefined && readings.iscReadingAmps !== '') {
    inst.readings.iscReadingAmps = Number(readings.iscReadingAmps);
  }
  if (readings.earthResistanceOhms !== undefined && readings.earthResistanceOhms !== '') {
    inst.readings.earthResistanceOhms = Number(readings.earthResistanceOhms);
  }
  if (readings.gridVoltageVolts !== undefined && readings.gridVoltageVolts !== '') {
    inst.readings.gridVoltageVolts = Number(readings.gridVoltageVolts);
  }

  if (status && ['in_progress', 'completed', 'net_metering_pending'].includes(status)) {
    inst.status = status;
    if (status === 'in_progress' && !inst.actualStartDate) {
      inst.actualStartDate = new Date();
    }
  } else if (inst.status === 'scheduled') {
    inst.status = 'in_progress';
    inst.actualStartDate = inst.actualStartDate || new Date();
  }

  await inst.save();

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.INSTALLATION_UPDATED,
      'installations',
      inst._id,
      {},
      { status: inst.status },
      { req, description: `Technical checklist & readings updated for ${inst.installationNumber}` }
    );
  }

  return inst;
}

/**
 * Record customer acceptance and sign-off.
 */
async function recordCustomerSignoff(installationId, signoffData, actor, req) {
  const inst = await Installation.findById(installationId);
  if (!inst) throw ApiError.notFound('Installation not found.');

  inst.customerSignoff = {
    signedBy: text(signoffData.signedBy, 120),
    signerCnic: text(signoffData.signerCnic, 20),
    signedAt: new Date(),
    rating: Math.max(1, Math.min(5, parseInt(signoffData.rating, 10) || 5)),
    feedback: text(signoffData.feedback, 1000),
    signatureData: signoffData.signatureData || '',
  };

  await inst.save();

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.CUSTOMER_SIGNOFF_RECORDED,
      'installations',
      inst._id,
      {},
      { signedBy: inst.customerSignoff.signedBy, rating: inst.customerSignoff.rating },
      { req, description: `Customer sign-off logged for ${inst.installationNumber}` }
    );
  }

  return inst;
}

/**
 * Mark Installation Completed.
 */
async function completeInstallation(installationId, actor, req) {
  const inst = await Installation.findById(installationId);
  if (!inst) throw ApiError.notFound('Installation not found.');

  inst.status = 'completed';
  inst.completedAt = new Date();
  await inst.save();

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.INSTALLATION_COMPLETED,
      'installations',
      inst._id,
      {},
      { status: 'completed' },
      { req, description: `Installation marked completed for ${inst.installationNumber}` }
    );
  }

  return inst;
}

/**
 * Fully Commission Installation: Sets commissioned status, marks serials installed,
 * and auto-generates warranty certificates.
 */
async function commissionInstallation(installationId, { commissioningNotes = '' } = {}, actor, req) {
  const inst = await Installation.findById(installationId).populate('customer sale');
  if (!inst) throw ApiError.notFound('Installation not found.');

  inst.status = 'commissioned';
  inst.commissionedAt = new Date();
  inst.completedAt = inst.completedAt || new Date();
  inst.commissioningNotes = text(commissioningNotes, 2000);
  await inst.save();

  // Mark all issued serials as installed
  for (const mat of inst.materialsIssued) {
    if (mat.serialNumber) {
      await SerialNo.updateOne(
        { _id: mat.serialNumber },
        {
          $set: { status: 'installed', installedAt: new Date() },
          $push: {
            events: {
              status: 'installed',
              at: new Date(),
              note: `Commissioned on site: ${inst.installationNumber}`,
              customer: inst.customer ? inst.customer._id : null,
              project: inst.installationNumber,
              user: actor ? actor._id : null,
            },
          },
        }
      );
    }
  }

  // Auto-generate warranty records for all installed equipment & workmanship
  const createdWarranties = await autoCreateWarrantiesForInstallation(inst._id, actor, req);

  // Send AppNotification to Management
  await AppNotification.create({
    title: `Project Commissioned: ${inst.installationNumber}`,
    message: `${inst.customer ? inst.customer.name : 'Customer'} system is fully commissioned. ${createdWarranties.length} warranties activated.`,
    type: 'system',
    link: `/installations/${inst._id}`,
    entityId: inst._id,
  });

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.INSTALLATION_COMMISSIONED,
      'installations',
      inst._id,
      {},
      { warrantiesGenerated: createdWarranties.length },
      { req, description: `System commissioned: ${inst.installationNumber}` }
    );
  }

  return { installation: inst, warranties: createdWarranties };
}

/**
 * List installations with search & status filters.
 */
async function listInstallations(filters = {}, user) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const query = { deletedAt: null };

  if (filters.status) query.status = filters.status;
  if (filters.customer && mongoose.isValidObjectId(filters.customer)) {
    query.customer = filters.customer;
  }
  if (filters.leadTechnician && mongoose.isValidObjectId(filters.leadTechnician)) {
    query.leadTechnician = filters.leadTechnician;
  }
  if (filters.search) {
    const s = escapeRegex(filters.search);
    query.installationNumber = new RegExp(s, 'i');
  }

  // Technicians only see their jobs
  if (user && user.role === ROLES.TECHNICIAN) {
    query.$or = [{ leadTechnician: user._id }, { technicians: user._id }];
  }

  const [total, installations] = await Promise.all([
    Installation.countDocuments(query),
    Installation.find(query)
      .populate('customer', 'name phone code area city')
      .populate('leadTechnician', 'name phone')
      .populate('sale', 'saleNumber systemSummary')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    installations,
    total,
    pagination: paginate(total, page, limit),
  };
}

/**
 * Generates commissioning report PDF.
 */
async function generateCommissioningPdf(installationId) {
  const inst = await getInstallationOrThrow(installationId);
  const settings = await getSettings();
  return buildCommissioningPdf(inst, settings);
}

module.exports = {
  nextInstallationNumber,
  getInstallationOrThrow,
  createInstallationFromSale,
  issueMaterials,
  updateSchedule,
  updateChecklistAndReadings,
  recordCustomerSignoff,
  completeInstallation,
  commissionInstallation,
  listInstallations,
  generateCommissioningPdf,
};
