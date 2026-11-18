'use strict';

const complaintService = require('../services/complaintService');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Item = require('../models/Item');
const { ROLES } = require('../config/roles');
const { COMPLAINT_TYPES, COMPLAINT_PRIORITIES } = require('../config/installations');

async function index(req, res, next) {
  try {
    const { complaints, total, pagination } = await complaintService.listComplaints(
      req.query,
      req.user
    );

    const customers = await Customer.find({ deletedAt: null }).select('name code phone').lean();
    const technicians = await User.find({
      role: { $in: [ROLES.TECHNICIAN, ROLES.MANAGER, ROLES.OWNER] },
      isActive: true,
    }).lean();

    return res.render('complaints/index', {
      title: 'Service & Complaint Tickets',
      complaints,
      total,
      pagination,
      customers,
      technicians,
      types: COMPLAINT_TYPES,
      priorities: COMPLAINT_PRIORITIES,
      filters: req.query,
      breadcrumbs: [
        { label: 'After-Sales & Service', url: '/complaints' },
        { label: 'Complaint Tickets', url: '/complaints' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const complaint = await complaintService.getComplaintOrThrow(req.params.id);

    const technicians = await User.find({
      role: { $in: [ROLES.TECHNICIAN, ROLES.MANAGER, ROLES.OWNER] },
      isActive: true,
    }).lean();

    const availableItems = await Item.find({ currentStock: { $gt: 0 }, deletedAt: null })
      .select('name sku unit currentStock hasSerial')
      .lean();

    return res.render('complaints/show', {
      title: `Complaint ${complaint.ticketNumber}`,
      complaint,
      technicians,
      availableItems,
      breadcrumbs: [
        { label: 'After-Sales & Service', url: '/complaints' },
        { label: 'Complaint Tickets', url: '/complaints' },
        { label: complaint.ticketNumber },
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const complaint = await complaintService.createComplaint(req.body, req.user, req);

    req.flash(
      'success',
      `Complaint ticket ${complaint.ticketNumber} lodged (${complaint.isUnderWarranty ? 'Covered under Warranty' : 'Paid Service'}).`
    );
    return res.redirect(`/complaints/${complaint._id}`);
  } catch (err) {
    next(err);
  }
}

async function assign(req, res, next) {
  try {
    const { technicianId, visitDate } = req.body;
    await complaintService.assignTechnician(
      req.params.id,
      { technicianId, visitDate },
      req.user,
      req
    );

    req.flash('success', 'Technician assigned successfully.');
    return res.redirect(req.get('Referrer') || `/complaints/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function resolve(req, res, next) {
  try {
    const { resolutionNotes, itemId, partQty, partSerial, serviceCharge } = req.body;

    const partsUsed = [];
    if (Array.isArray(itemId)) {
      for (let i = 0; i < itemId.length; i++) {
        if (!itemId[i]) continue;
        partsUsed.push({
          itemId: itemId[i],
          qty: partQty[i] || 1,
          serialString: partSerial && partSerial[i] ? partSerial[i] : '',
        });
      }
    } else if (itemId) {
      partsUsed.push({ itemId, qty: partQty, serialString: partSerial });
    }

    await complaintService.resolveComplaint(
      req.params.id,
      { resolutionNotes, partsUsed, serviceCharge },
      req.user,
      req
    );

    req.flash('success', 'Complaint ticket resolved.');
    return res.redirect(req.get('Referrer') || `/complaints/${req.params.id}`);
  } catch (err) {
    req.flash('error', err.message);
    return res.redirect(req.get('Referrer') || `/complaints/${req.params.id}`);
  }
}

module.exports = {
  index,
  show,
  create,
  assign,
  resolve,
};
