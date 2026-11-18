'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Installation = require('../models/Installation');
const Warranty = require('../models/Warranty');
const Complaint = require('../models/Complaint');
const MaintenanceSchedule = require('../models/MaintenanceSchedule');
const { buildCommissioningPdf } = require('../services/commissioningPdfService');
const { buildWarrantyCertificatePdf } = require('../services/warrantyPdfService');
const { checkMaterialIssueGate } = require('../services/installmentService');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');
const { COMPLAINT_SLA_HOURS } = require('../config/installations');

test('Installation model validates required installationNumber, sale, customer, and valid status', () => {
  const inst = new Installation({
    installationNumber: 'INS-2026-0001',
    sale: new mongoose.Types.ObjectId(),
    customer: new mongoose.Types.ObjectId(),
    status: 'approved',
  });

  assert.equal(inst.validateSync(), undefined);

  const invalidInst = new Installation({});
  const err = invalidInst.validateSync();
  assert.ok(err.errors.installationNumber);
  assert.ok(err.errors.sale);
  assert.ok(err.errors.customer);
});

test('Warranty model validates required warrantyNumber, customer, item, type, dates', () => {
  const w = new Warranty({
    warrantyNumber: 'WAR-2026-0001',
    customer: new mongoose.Types.ObjectId(),
    item: new mongoose.Types.ObjectId(),
    warrantyType: 'inverter',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2031-01-01'),
    years: 5,
    status: 'active',
  });

  assert.equal(w.validateSync(), undefined);

  const invalidW = new Warranty({});
  const err = invalidW.validateSync();
  assert.ok(err.errors.warrantyNumber);
  assert.ok(err.errors.customer);
  assert.ok(err.errors.item);
  assert.ok(err.errors.warrantyType);
  assert.ok(err.errors.startDate);
  assert.ok(err.errors.endDate);
});

test('Complaint model assigns SLA hours and calculates targetResolutionDate based on priority', () => {
  const baseTime = new Date('2026-06-01T10:00:00Z');

  const urgentComplaint = new Complaint({
    ticketNumber: 'CMP-2026-0001',
    customer: new mongoose.Types.ObjectId(),
    issueType: 'inverter_fault',
    priority: 'urgent',
    description: 'Inverter error 04 grid surge.',
    createdAt: baseTime,
  });

  urgentComplaint.validateSync();
  assert.equal(urgentComplaint.slaHours, COMPLAINT_SLA_HOURS.urgent); // 24 hours
  assert.ok(urgentComplaint.targetResolutionDate);
  const diffHours = (urgentComplaint.targetResolutionDate.getTime() - baseTime.getTime()) / (1000 * 60 * 60);
  assert.equal(Math.round(diffHours), 24);

  const lowComplaint = new Complaint({
    ticketNumber: 'CMP-2026-0002',
    customer: new mongoose.Types.ObjectId(),
    issueType: 'other',
    priority: 'low',
    description: 'General system cleaning check.',
    createdAt: baseTime,
  });

  lowComplaint.validateSync();
  assert.equal(lowComplaint.slaHours, COMPLAINT_SLA_HOURS.low); // 168 hours (7 days)
});

test('Complaint isSlaBreached virtual correctly detects deadline violations', () => {
  const pastTarget = new Date(Date.now() - 3600000); // 1 hour ago

  const overdueComplaint = new Complaint({
    ticketNumber: 'CMP-2026-0003',
    customer: new mongoose.Types.ObjectId(),
    issueType: 'generation_drop',
    description: 'Low solar production',
    targetResolutionDate: pastTarget,
    status: 'open',
  });

  assert.equal(overdueComplaint.isSlaBreached, true);

  const resolvedInTime = new Complaint({
    ticketNumber: 'CMP-2026-0004',
    customer: new mongoose.Types.ObjectId(),
    issueType: 'generation_drop',
    description: 'Resolved prompt',
    targetResolutionDate: new Date('2026-06-02T10:00:00Z'),
    resolvedAt: new Date('2026-06-01T15:00:00Z'),
    status: 'resolved',
  });

  assert.equal(resolvedInTime.isSlaBreached, false);
});

test('MaintenanceSchedule model validates scheduleNumber, customer, serviceType, scheduledDate', () => {
  const mnt = new MaintenanceSchedule({
    scheduleNumber: 'MNT-2026-0001',
    customer: new mongoose.Types.ObjectId(),
    serviceType: 'panel_cleaning',
    scheduledDate: new Date('2026-07-01'),
  });

  assert.equal(mnt.validateSync(), undefined);

  const invalidMnt = new MaintenanceSchedule({});
  const err = invalidMnt.validateSync();
  assert.ok(err.errors.scheduleNumber);
  assert.ok(err.errors.customer);
  assert.ok(err.errors.scheduledDate);
});

test('buildCommissioningPdf produces a valid PDF buffer with specs and readings', async () => {
  const dummyInstallation = {
    installationNumber: 'INS-2026-0099',
    status: 'commissioned',
    commissionedAt: new Date(),
    customer: {
      name: 'Tariq Mehmood',
      phone: '0300-1122334',
      area: 'Gulberg',
      city: 'Lahore',
      disco: 'LESCO',
      electricityReferenceNo: '12-34567-8901234',
    },
    sale: {
      saleNumber: 'SAL-2026-0099',
      systemSummary: {
        capacityKw: 10,
        systemType: 'on_grid',
        panelCount: 18,
        estimatedUnits: { yearly: 15000 },
      },
    },
    leadTechnician: { name: 'Engr. Imran' },
    readings: {
      vocReadingVolts: 480.5,
      iscReadingAmps: 13.4,
      earthResistanceOhms: 2.1,
      gridVoltageVolts: 232,
    },
    materialsIssued: [
      { item: { name: 'Longi 580W Tier 1 Panel' }, qty: 18, serialString: 'LNG-580-001 ... LNG-580-018' },
      { item: { name: 'Huawei 10kW On-Grid Inverter' }, qty: 1, serialString: 'HW-10K-9901' },
    ],
    customerSignoff: {
      signedBy: 'Tariq Mehmood',
      signerCnic: '35201-1234567-1',
      rating: 5,
      feedback: 'Very professional installation.',
    },
  };

  const pdfBuffer = await buildCommissioningPdf(dummyInstallation, {
    companyName: 'Premier Solar Systems',
    phone: '042-35800000',
    city: 'Lahore',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000);
  assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF');
});

test('buildWarrantyCertificatePdf produces a valid PDF buffer with certificate styling', async () => {
  const dummyWarranty = {
    warrantyNumber: 'WAR-2026-0042',
    customer: {
      name: 'Dr. Shahzad',
      phone: '0321-9876543',
      cnic: '35202-9876543-1',
      address: 'DHA Phase 5',
      city: 'Lahore',
    },
    item: {
      name: 'Solar Inverter 10kW On-Grid IP65',
      sku: 'INV-10KW-OG',
    },
    serialString: 'INV-SN-889922',
    warrantyType: 'inverter',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2031-06-01'),
    years: 5,
    installation: { installationNumber: 'INS-2026-0042' },
  };

  const pdfBuffer = await buildWarrantyCertificatePdf(dummyWarranty, {
    companyName: 'Premier Solar Systems',
    phone: '042-35800000',
    city: 'Lahore',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000);
  assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF');
});

test('Role permissions enforce strict field-level boundaries for technicians and commissioners', () => {
  // Technicians can view & manage installations and complaints
  assert.equal(can(ROLES.TECHNICIAN, 'installations.view'), true);
  assert.equal(can(ROLES.TECHNICIAN, 'installations.manage'), true);
  assert.equal(can(ROLES.TECHNICIAN, 'complaints.view'), true);
  assert.equal(can(ROLES.TECHNICIAN, 'complaints.manage'), true);
  assert.equal(can(ROLES.TECHNICIAN, 'technician.jobs'), true);

  // But technicians NEVER have financial visibility (cost or profit)
  assert.equal(can(ROLES.TECHNICIAN, 'costs.view'), false);
  assert.equal(can(ROLES.TECHNICIAN, 'profit.view'), false);
  assert.equal(can(ROLES.TECHNICIAN, 'purchase_prices.view'), false);

  // Technicians cannot commission or release warehouse material
  assert.equal(can(ROLES.TECHNICIAN, 'installations.commission'), false);
  assert.equal(can(ROLES.TECHNICIAN, 'material.issue'), false);

  // Storekeepers can issue material from warehouse
  assert.equal(can(ROLES.STOREKEEPER, 'material.issue'), true);

  // Owners and Managers have full commissioning authority
  assert.equal(can(ROLES.OWNER, 'installations.commission'), true);
  assert.equal(can(ROLES.MANAGER, 'installations.commission'), true);
});
