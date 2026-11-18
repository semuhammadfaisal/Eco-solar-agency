'use strict';

const mongoose = require('mongoose');
const Complaint = require('../models/Complaint');
const Warranty = require('../models/Warranty');
const Item = require('../models/Item');
const SerialNo = require('../models/SerialNo');
const StockMovement = require('../models/StockMovement');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { paginate, escapeRegex } = require('../utils/pagination');
const { text } = require('../utils/inputs');
const { COMPLAINT_SLA_HOURS } = require('../config/installations');
const { ROLES } = require('../config/roles');
const accountingService = require('./accountingService');

async function nextTicketNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`complaint_${year}`);
  return `CMP-${year}-${String(seq).padStart(4, '0')}`;
}

async function getComplaintOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid complaint ID.');
  const complaint = await Complaint.findById(id)
    .populate('customer')
    .populate('sale', 'saleNumber')
    .populate('installation', 'installationNumber status')
    .populate('assignedTechnician', 'name email phone role')
    .populate('partsUsed.item', 'name sku unit');

  if (!complaint) throw ApiError.notFound('Complaint ticket not found.');
  return complaint;
}

/**
 * Creates a complaint ticket with auto-SLA calculation and automatic warranty check.
 */
async function createComplaint(payload, actor, req) {
  if (!mongoose.isValidObjectId(payload.customer)) {
    throw ApiError.badRequest('Valid customer is required.');
  }

  const ticketNumber = await nextTicketNumber();
  const priority = payload.priority || 'medium';
  const slaHours = COMPLAINT_SLA_HOURS[priority] || 72;
  const targetResolutionDate = new Date(Date.now() + slaHours * 60 * 60 * 1000);

  // Auto-check active warranty for this customer & equipment type
  let isUnderWarranty = true;
  const issueType = payload.issueType;

  let checkWarrantyType = null;
  if (issueType === 'inverter_fault') checkWarrantyType = 'inverter';
  else if (issueType === 'battery_issue') checkWarrantyType = 'battery';
  else if (['generation_drop', 'physical_damage'].includes(issueType)) checkWarrantyType = { $in: ['panel_product', 'panel_performance'] };
  else if (issueType === 'wiring_earthing') checkWarrantyType = 'workmanship';

  if (checkWarrantyType) {
    const activeWarranty = await Warranty.findOne({
      customer: payload.customer,
      warrantyType: checkWarrantyType,
      status: 'active',
      endDate: { $gte: new Date() },
      deletedAt: null,
    });
    isUnderWarranty = Boolean(activeWarranty);
  }

  const serviceChargePaisa = !isUnderWarranty && payload.serviceCharge
    ? Math.round(parseFloat(payload.serviceCharge) * 100)
    : 0;

  const complaint = await Complaint.create({
    ticketNumber,
    customer: payload.customer,
    sale: payload.sale || null,
    installation: payload.installation || null,
    issueType,
    priority,
    description: text(payload.description, 3000),
    photos: payload.photos || [],
    assignedTechnician: payload.assignedTechnician || null,
    visitDate: payload.visitDate ? new Date(payload.visitDate) : null,
    status: payload.assignedTechnician ? 'assigned' : 'open',
    slaHours,
    targetResolutionDate,
    isUnderWarranty,
    serviceChargePaisa,
    createdBy: actor ? actor._id : null,
  });

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.COMPLAINT_CREATED,
      'complaints',
      complaint._id,
      {},
      { ticketNumber, issueType, priority, isUnderWarranty },
      { req, description: `Complaint ticket created: ${ticketNumber} (${isUnderWarranty ? 'Under Warranty' : 'Paid Service'})` }
    );
  }

  return complaint;
}

/**
 * Assigns technician and sets visit date.
 */
async function assignTechnician(complaintId, { technicianId, visitDate }, actor, req) {
  const complaint = await Complaint.findById(complaintId);
  if (!complaint) throw ApiError.notFound('Complaint not found.');

  complaint.assignedTechnician = technicianId;
  complaint.visitDate = visitDate ? new Date(visitDate) : complaint.visitDate;
  if (complaint.status === 'open') {
    complaint.status = 'assigned';
  }
  await complaint.save();

  // Step 10: Auto-post service charge income in double-entry ledger
  if (complaint.serviceChargePaisa && complaint.serviceChargePaisa > 0) {
    try {
      await accountingService.postServiceCharge(
        {
          customerId: complaint.customer._id || complaint.customer,
          amountPaisa: complaint.serviceChargePaisa,
          paymentAccountCode: '1010', // Default cash collected
          notes: complaint.ticketNumber,
          complaintId: complaint._id,
        },
        actor,
        req
      );
    } catch (accErr) {
      console.error('[accounting] resolveComplaint service charge error:', accErr.message);
    }
  }

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.COMPLAINT_UPDATED,
      'complaints',
      complaint._id,
      {},
      { assignedTechnician: technicianId, status: complaint.status },
      { req, description: `Assigned technician for ticket ${complaint.ticketNumber}` }
    );
  }

  return complaint;
}

/**
 * Resolves complaint, optionally deducts parts used from inventory.
 */
async function resolveComplaint(complaintId, { resolutionNotes, partsUsed = [], serviceCharge = 0 }, actor, req) {
  const complaint = await Complaint.findById(complaintId).populate('customer');
  if (!complaint) throw ApiError.notFound('Complaint not found.');

  const partsDeducted = [];

  // Deduct parts used from inventory
  for (const p of partsUsed) {
    const itemId = p.itemId || p.item;
    const qty = Math.max(1, parseInt(p.qty, 10) || 1);
    const item = await Item.findById(itemId);
    if (!item) continue;

    if (item.currentStock < qty) {
      throw ApiError.conflict(`Insufficient stock for replacement part: ${item.name}`);
    }

    let serialDoc = null;
    if (item.hasSerial && p.serialString) {
      serialDoc = await SerialNo.findOne({ serial: p.serialString.trim().toUpperCase(), deletedAt: null });
      if (serialDoc && serialDoc.status === 'in_stock') {
        serialDoc.status = 'installed';
        serialDoc.customer = complaint.customer._id;
        serialDoc.events.push({
          status: 'installed',
          at: new Date(),
          note: `Used for service ticket ${complaint.ticketNumber}`,
          user: actor ? actor._id : null,
        });
        await serialDoc.save();
      }
    }

    const newStock = item.currentStock - qty;
    await Item.updateOne({ _id: item._id }, { $set: { currentStock: newStock } });

    await StockMovement.create({
      item: item._id,
      type: 'OUT',
      qty: -qty,
      unitCostPaisa: item.avgCostPaisa || 0,
      balanceAfter: newStock,
      reference: complaint.ticketNumber,
      referenceType: 'complaint',
      notes: `Service repair for ticket ${complaint.ticketNumber}`,
      occurredAt: new Date(),
      createdBy: actor ? actor._id : null,
    });

    partsDeducted.push({
      item: item._id,
      serialNumber: serialDoc ? serialDoc._id : null,
      serialString: serialDoc ? serialDoc.serial : (p.serialString || ''),
      qty,
      notes: p.notes || '',
    });
  }

  complaint.resolutionNotes = text(resolutionNotes, 2000);
  complaint.status = 'resolved';
  complaint.resolvedAt = new Date();
  if (partsDeducted.length) {
    complaint.partsUsed.push(...partsDeducted);
  }
  if (serviceCharge) {
    complaint.serviceChargePaisa = Math.round(parseFloat(serviceCharge) * 100);
  }

  await complaint.save();

  // Step 10: Auto-post service charge income in double-entry ledger
  if (complaint.serviceChargePaisa && complaint.serviceChargePaisa > 0) {
    try {
      await accountingService.postServiceCharge(
        {
          customerId: complaint.customer._id || complaint.customer,
          amountPaisa: complaint.serviceChargePaisa,
          paymentAccountCode: '1010', // Default cash collected
          notes: complaint.ticketNumber,
          complaintId: complaint._id,
        },
        actor,
        req
      );
    } catch (accErr) {
      console.error('[accounting] resolveComplaint service charge error:', accErr.message);
    }
  }

  if (req && actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.COMPLAINT_RESOLVED,
      'complaints',
      complaint._id,
      {},
      { status: 'resolved', partsUsedCount: partsDeducted.length },
      { req, description: `Complaint resolved: ${complaint.ticketNumber}` }
    );
  }

  return complaint;
}

/**
 * List complaints with search & filters.
 */
async function listComplaints(filters = {}, user) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));

  const query = { deletedAt: null };

  if (filters.status) query.status = filters.status;
  if (filters.priority) query.priority = filters.priority;
  if (filters.issueType) query.issueType = filters.issueType;
  if (filters.customer && mongoose.isValidObjectId(filters.customer)) {
    query.customer = filters.customer;
  }
  if (filters.technician && mongoose.isValidObjectId(filters.technician)) {
    query.assignedTechnician = filters.technician;
  }
  if (filters.search) {
    const s = escapeRegex(filters.search);
    query.$or = [{ ticketNumber: new RegExp(s, 'i') }, { description: new RegExp(s, 'i') }];
  }

  // If technician, scope to assigned tickets
  if (user && user.role === ROLES.TECHNICIAN) {
    query.assignedTechnician = user._id;
  }

  const [total, complaints] = await Promise.all([
    Complaint.countDocuments(query),
    Complaint.find(query)
      .populate('customer', 'name phone code city')
      .populate('assignedTechnician', 'name phone')
      .populate('installation', 'installationNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    complaints,
    total,
    pagination: paginate(total, page, limit),
  };
}

module.exports = {
  nextTicketNumber,
  getComplaintOrThrow,
  createComplaint,
  assignTechnician,
  resolveComplaint,
  listComplaints,
};
