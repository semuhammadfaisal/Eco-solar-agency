'use strict';

const warrantyService = require('../services/warrantyService');
const SerialNo = require('../models/SerialNo');

async function index(req, res, next) {
  try {
    const { warranties, total, pagination } = await warrantyService.listWarranties(
      req.query,
      req.user
    );

    const inStockSerials = await SerialNo.find({ status: 'in_stock', deletedAt: null })
      .populate('item', 'name sku category')
      .limit(100)
      .lean();

    return res.render('warranties/index', {
      title: 'Equipment Warranty Registry',
      warranties,
      total,
      pagination,
      inStockSerials,
      filters: req.query,
      breadcrumbs: [
        { label: 'After-Sales & Service', url: '/warranties' },
        { label: 'Warranty Records', url: '/warranties' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const warranty = await warrantyService.getWarrantyOrThrow(req.params.id);

    const inStockSerials = await SerialNo.find({
      item: warranty.item._id,
      status: 'in_stock',
      deletedAt: null,
    }).lean();

    return res.render('warranties/show', {
      title: `Warranty ${warranty.warrantyNumber}`,
      warranty,
      inStockSerials,
      breadcrumbs: [
        { label: 'After-Sales & Service', url: '/warranties' },
        { label: 'Warranty Records', url: '/warranties' },
        { label: warranty.warrantyNumber },
      ],
    });
  } catch (err) {
    next(err);
  }
}

async function certificatePdf(req, res, next) {
  try {
    const pdfBuffer = await warrantyService.generateWarrantyCertificatePdf(req.params.id);
    const warranty = await warrantyService.getWarrantyOrThrow(req.params.id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Warranty-Certificate-${warranty.warrantyNumber}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

async function claim(req, res, next) {
  try {
    const { issueDescription, oldSerial, replacementSerialId, resolutionNotes, claimStatus } = req.body;

    const warranty = await warrantyService.recordWarrantyClaim(
      req.params.id,
      {
        issueDescription,
        oldSerial,
        replacementSerialId: replacementSerialId || null,
        resolutionNotes,
        claimStatus: claimStatus || 'approved',
      },
      req.user,
      req
    );

    req.flash('success', `Warranty claim processed for ${warranty.warrantyNumber}.`);
    return res.redirect(req.get('Referrer') || `/warranties/${warranty._id}`);
  } catch (err) {
    req.flash('error', err.message);
    return res.redirect(req.get('Referrer') || `/warranties/${req.params.id}`);
  }
}

module.exports = {
  index,
  show,
  certificatePdf,
  claim,
};
