#!/usr/bin/env node
'use strict';

/**
 * Comprehensive Demo Seeder for Solar Business Management System.
 *
 * Populates realistic Pakistani solar agency data across all 10 steps:
 * 1. Users for every role (Owner, Manager, Sales, Surveyor, Technician, Storekeeper, Accountant)
 * 2. Company Settings, branding, bank details
 * 3. Employees & Attendance
 * 4. Suppliers & Inventory items with serial numbers
 * 5. Reusable Package templates
 * 6. Customers
 * 7. Site Surveys with 12-month energy bill data
 * 8. System Configs & Professional Quotations
 * 9. Confirmed Sales & Installment Plans with cheques and receipts
 * 10. Installations, Warranties, Complaint Tickets
 * 11. Chart of Accounts, Operating Expenses, and balanced Double-Entry Journal Entries
 *
 * Run:
 *   node scripts/seedDemo.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');

const User = require('../models/User');
const Settings = require('../models/Settings');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Supplier = require('../models/Supplier');
const Item = require('../models/Item');
const SerialNo = require('../models/SerialNo');
const StockMovement = require('../models/StockMovement');
const Package = require('../models/Package');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const SystemConfig = require('../models/SystemConfig');
const Quotation = require('../models/Quotation');
const Sale = require('../models/Sale');
const InstallmentPlan = require('../models/InstallmentPlan');
const Installment = require('../models/Installment');
const InstallmentPayment = require('../models/InstallmentPayment');
const Cheque = require('../models/Cheque');
const Installation = require('../models/Installation');
const Warranty = require('../models/Warranty');
const Complaint = require('../models/Complaint');
const MaintenanceSchedule = require('../models/MaintenanceSchedule');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const Expense = require('../models/Expense');
const { ROLES } = require('../config/roles');
const { DEFAULT_CHART_OF_ACCOUNTS } = require('../config/accounting');
const { seedDefaultTemplates } = require('../services/notificationService');

const DEFAULT_PASSWORD = 'Password123';

async function seed() {
  console.log('\n☀️  Starting Comprehensive Pakistani Solar Demo Seeder...\n');
  await connectDB();

  // 1. Company Settings
  console.log('1. Setting up Company Configuration...');
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({
      companyName: 'PakSolar Dynamics (Pvt) Ltd',
      legalName: 'PakSolar Dynamics Private Limited',
      phone: '+92 42 35789012',
      email: 'info@paksolardynamics.pk',
      address: 'Suite 402, Al-Hafeez Heights, Ghalib Rd, Gulberg III',
      city: 'Lahore',
      ntn: '7849302-1',
      strn: '3277876123456',
      currency: 'PKR',
      bankDetails: {
        bankName: 'Bank Alfalah Islamic',
        accountTitle: 'PakSolar Dynamics Pvt Ltd',
        accountNumber: '5510-2394819023',
        iban: 'PK36ALFH55102394819023',
        branchName: 'Gulberg Main Boulevard Branch, Lahore',
      },
      warrantyDefaults: {
        panelProductYears: 12,
        panelPerformanceYears: 25,
        inverterYears: 5,
        batteryYears: 10,
        workmanshipYears: 2,
      },
    });
  }

  // 2. Users for all 7 roles
  console.log('2. Provisioning Multi-Role Users...');
  const usersDef = [
    { name: 'Malik Zeeshan (Owner)', email: 'owner@solar.com.pk', role: ROLES.OWNER },
    { name: 'Noman Bashir (Manager)', email: 'manager@solar.com.pk', role: ROLES.MANAGER },
    { name: 'Hamza Farooq (Sales Officer)', email: 'sales@solar.com.pk', role: ROLES.SALES },
    { name: 'Usman Ghani (Site Surveyor)', email: 'surveyor@solar.com.pk', role: ROLES.SURVEYOR },
    { name: 'Rashid Mahmood (Lead Tech)', email: 'technician@solar.com.pk', role: ROLES.TECHNICIAN },
    { name: 'Kashif Mehmood (Storekeeper)', email: 'storekeeper@solar.com.pk', role: ROLES.STOREKEEPER },
    { name: 'Arsalan Qureshi (Accountant)', email: 'accountant@solar.com.pk', role: ROLES.ACCOUNTANT },
  ];

  const userMap = {};
  for (const uDef of usersDef) {
    let u = await User.findOne({ email: uDef.email });
    if (!u) {
      u = new User({
        name: uDef.name,
        email: uDef.email,
        role: uDef.role,
        isActive: true,
      });
      await u.setPassword(DEFAULT_PASSWORD);
      await u.save();
    }
    userMap[uDef.role] = u;
  }

  // 3. Employees
  console.log('3. Provisioning Staff Employees...');
  const employeesDef = [
    { user: userMap[ROLES.SALES]._id, employeeCode: 'EMP-01', designation: 'Senior Solar Sales Consultant', salaryPaisa: 6000000, commissionRateBps: 200 },
    { user: userMap[ROLES.SURVEYOR]._id, employeeCode: 'EMP-02', designation: 'Technical Site Surveyor', salaryPaisa: 5000000, commissionRateBps: 50 },
    { user: userMap[ROLES.TECHNICIAN]._id, employeeCode: 'EMP-03', designation: 'Chief Solar Engineer', salaryPaisa: 7500000, commissionRateBps: 0 },
    { user: userMap[ROLES.ACCOUNTANT]._id, employeeCode: 'EMP-04', designation: 'Head Accountant', salaryPaisa: 7000000, commissionRateBps: 0 },
  ];

  const employeeMap = {};
  for (const eDef of employeesDef) {
    let emp = await Employee.findOne({ user: eDef.user });
    if (!emp) {
      emp = await Employee.create({
        user: eDef.user,
        designation: eDef.designation,
        salaryPaisa: eDef.salaryPaisa,
        commissionRateBps: eDef.commissionRateBps,
        cnic: '35201-1234567-1',
        joiningDate: new Date('2024-01-01'),
        status: 'active',
      });
    }
    employeeMap[eDef.employeeCode] = emp;
  }

  // 4. Chart of Accounts
  console.log('4. Initializing Pakistani Solar Chart of Accounts...');
  for (const def of DEFAULT_CHART_OF_ACCOUNTS) {
    const exists = await Account.findOne({ code: def.code });
    if (!exists) await Account.create(def);
  }

  // 5. Suppliers & Hardware Items
  console.log('5. Provisioning Solar Equipment & Hardware Catalog...');
  let supLongi = await Supplier.findOne({ code: 'SUP-01' });
  if (!supLongi) {
    supLongi = await Supplier.create({
      code: 'SUP-01',
      name: 'Longi Solar Distribution Pakistan',
      contactName: 'Engr. Bilal Qasim',
      phone: '+92 42 35912345',
      city: 'Lahore',
    });
  }

  let supHuawei = await Supplier.findOne({ code: 'SUP-02' });
  if (!supHuawei) {
    supHuawei = await Supplier.create({
      code: 'SUP-02',
      name: 'Huawei Digital Power Partner PK',
      contactName: 'Zubair Akram',
      phone: '+92 21 34567890',
      city: 'Karachi',
    });
  }

  const itemsDef = [
    { sku: 'PANEL-580W-LONGI', name: 'Longi Hi-MO 6 580W Tier 1 Solar Panel', category: 'panel', currentStock: 150, minStock: 25, avgCostPaisa: 1850000, sellingPricePaisa: 2200000, wattage: 580, hasSerial: true },
    { sku: 'PANEL-550W-CS', name: 'Canadian Solar 550W HiKu6 Mono PERC', category: 'panel', currentStock: 100, minStock: 20, avgCostPaisa: 1700000, sellingPricePaisa: 2050000, wattage: 550, hasSerial: true },
    { sku: 'INV-10KW-HUAWEI', name: 'Huawei SUN2000-10KTL 10kW On-Grid Inverter', category: 'inverter', currentStock: 8, minStock: 2, avgCostPaisa: 26000000, sellingPricePaisa: 31000000, capacityKw: 10, hasSerial: true },
    { sku: 'INV-06KW-DEYE', name: 'Deye 6kW Hybrid Smart Storage Inverter', category: 'inverter', currentStock: 12, minStock: 3, avgCostPaisa: 19000000, sellingPricePaisa: 23500000, capacityKw: 6, hasSerial: true },
    { sku: 'BAT-05KWH-PYLON', name: 'Pylontech US5000 4.8kWh Lithium Battery', category: 'battery', currentStock: 14, minStock: 2, avgCostPaisa: 21500000, sellingPricePaisa: 26000000, hasSerial: true },
    { sku: 'STRUCT-L2-ALUM', name: 'Custom Elevated L2 Aluminum Structure Set', category: 'structure', currentStock: 45, minStock: 10, avgCostPaisa: 750000, sellingPricePaisa: 1100000, hasSerial: false },
    { sku: 'CABLE-06MM-DC', name: 'KBE Solar 6mm DC Flexible Cable (Meters)', category: 'cable', currentStock: 600, minStock: 100, avgCostPaisa: 18000, sellingPricePaisa: 28000, hasSerial: false },
  ];

  const itemDocs = {};
  for (const it of itemsDef) {
    let doc = await Item.findOne({ sku: it.sku });
    if (!doc) {
      doc = await Item.create(it);
    }
    itemDocs[it.sku] = doc;
  }

  // 6. Customers
  console.log('6. Provisioning Customers...');
  let cusTariq = await Customer.findOne({ phone: '+92 321 4455667' });
  if (!cusTariq) {
    cusTariq = await Customer.create({
      code: 'CUS-2026-0001',
      name: 'Chaudhry Muhammad Tariq',
      phone: '+92 321 4455667',
      email: 'tariq.chaudhry@gmail.com',
      cnic: '35202-9876543-1',
      address: 'House 142, Sector Y, Phase 6, DHA',
      city: 'Lahore',
      area: 'DHA Phase 6',
      disco: 'LESCO',
      electricityReferenceNo: '24-11234-9876501',
    });
  }

  let cusRehman = await Customer.findOne({ phone: '+92 300 8899771' });
  if (!cusRehman) {
    cusRehman = await Customer.create({
      code: 'CUS-2026-0002',
      name: 'Haji Abdul Rehman',
      phone: '+92 300 8899771',
      cnic: '33100-1122334-1',
      address: 'Plot 45-B, Peoples Colony No 1',
      city: 'Faisalabad',
      area: 'Peoples Colony',
      disco: 'FESCO',
      electricityReferenceNo: '18-44321-7788992',
    });
  }

  // 7. Site Survey for Tariq
  console.log('7. Recording Technical Site Survey...');
  let surveyTariq = await Survey.findOne({ customer: cusTariq._id });
  if (!surveyTariq) {
    surveyTariq = await Survey.create({
      number: 'SRV-2026-0001',
      customer: cusTariq._id,
      surveyor: userMap[ROLES.SURVEYOR]._id,
      scheduledAt: new Date('2026-02-10'),
      status: 'completed',
      completedAt: new Date('2026-02-11'),
      roofType: 'flat_concrete',
      roofAreaSqFt: 1850,
      recommendedKw: 10.44,
      monthlyUsage: [
        { month: 'Jan', units: 450 }, { month: 'Feb', units: 520 }, { month: 'Mar', units: 680 },
        { month: 'Apr', units: 890 }, { month: 'May', units: 1150 }, { month: 'Jun', units: 1300 },
        { month: 'Jul', units: 1380 }, { month: 'Aug', units: 1220 }, { month: 'Sep', units: 950 },
        { month: 'Oct', units: 710 }, { month: 'Nov', units: 510 }, { month: 'Dec', units: 440 },
      ],
      sanctionedLoadKw: 15,
      phase: 'three',
      remarks: 'South-facing unobstructed rooftop. Highly suitable for 10kW On-Grid Net Metered installation.',
    });
  }

  // 8. Approved Quotation & Sale
  console.log('8. Generating Approved Quotation and Sale Record...');
  let quote = await Quotation.findOne({ quotationNumber: 'QT-2026-0001' });
  if (!quote) {
    quote = await Quotation.create({
      quotationNumber: 'QT-2026-0001',
      revision: 1,
      customer: cusTariq._id,
      survey: surveyTariq._id,
      assignedTo: userMap[ROLES.SALES]._id,
      systemSummary: {
        capacityKw: 10.44,
        panelCount: 18,
        inverterSpecs: 'Huawei 10kW On-Grid',
        expectedUnitsDaily: 42,
        expectedUnitsMonthly: 1260,
        expectedUnitsYearly: 15120,
      },
      items: [
        { item: itemDocs['PANEL-580W-LONGI']._id, qty: 18, unitCostPaisa: 1850000, unitSellingPricePaisa: 2200000, totalCostPaisa: 33300000, totalSellingPricePaisa: 39600000 },
        { item: itemDocs['INV-10KW-HUAWEI']._id, qty: 1, unitCostPaisa: 26000000, unitSellingPricePaisa: 31000000, totalCostPaisa: 26000000, totalSellingPricePaisa: 31000000 },
        { item: itemDocs['STRUCT-L2-ALUM']._id, qty: 9, unitCostPaisa: 750000, unitSellingPricePaisa: 1100000, totalCostPaisa: 6750000, totalSellingPricePaisa: 9900000 },
        { item: itemDocs['CABLE-06MM-DC']._id, qty: 120, unitCostPaisa: 18000, unitSellingPricePaisa: 28000, totalCostPaisa: 2160000, totalSellingPricePaisa: 3360000 },
      ],
      totalHardwareCostPaisa: 68210000,
      totalSellingPricePaisa: 83860000,
      laborCostPaisa: 8000000,
      transportCostPaisa: 2500000,
      netMeteringCostPaisa: 12000000,
      totalBaseCostPaisa: 90710000,
      finalPricePaisa: 105000000, // 1,050,000 PKR
      netProfitPaisa: 14290000, // 142,900 PKR
      netProfitMarginPercent: 13.6,
      paymentOption: 'installment',
      status: 'approved',
      validUntil: new Date('2026-04-30'),
    });
  }

  let sale = await Sale.findOne({ saleNumber: 'SALE-2026-0001' });
  if (!sale) {
    sale = await Sale.create({
      saleNumber: 'SALE-2026-0001',
      invoiceNumber: 'INV-2026-0001',
      quotation: quote._id,
      customer: cusTariq._id,
      assignedTo: userMap[ROLES.SALES]._id,
      amountPaisa: 105000000,
      totalCostPaisa: 90710000,
      expectedProfitPaisa: 14290000,
      profitMarginPercent: 13.6,
      paymentType: 'installment',
      amountPaidPaisa: 35000000,
      status: 'confirmed',
      notes: 'Customer confirmed 10.4kW On-Grid installation with LESCO Net Metering.',
    });
    quote.sale = sale._id;
    await quote.save();
  }

  // 9. Installment Plan for Rehman
  console.log('9. Provisioning Installment Financing Plan & Cheque Register...');
  let plan = await InstallmentPlan.findOne({ planNumber: 'IP-2026-0001' });
  if (!plan) {
    plan = await InstallmentPlan.create({
      planNumber: 'IP-2026-0001',
      sale: sale._id,
      customer: cusRehman._id,
      totalSaleAmountPaisa: 80000000, // 800,000 PKR
      downPaymentPaisa: 20000000, // 200,000 PKR
      financedAmountPaisa: 60000000,
      markupRatePercent: 15,
      markupPaisa: 9000000,
      totalPayablePaisa: 69000000,
      installmentCount: 12,
      installmentAmountPaisa: 5750000,
      frequency: 'monthly',
      startDate: new Date('2026-03-01'),
      totalPaidPaisa: 0,
      remainingBalancePaisa: 69000000,
      status: 'active',
      securityChecklist: {
        isComplete: true,
      },
    });

    // Create 12 Installment stages
    for (let i = 1; i <= 12; i++) {
      const dueDate = new Date('2026-03-01');
      dueDate.setMonth(dueDate.getMonth() + (i - 1));
      const amountPaisa = 5750000; // 57,500 PKR
      const isPaid = i === 1;
      const isOverdue = i === 2;

      await Installment.create({
        installmentPlan: plan._id,
        customer: cusRehman._id,
        installmentNumber: i,
        dueDate,
        amountPaisa,
        paidAmountPaisa: isPaid ? 5750000 : (i === 2 ? 2000000 : 0),
        status: isPaid ? 'paid' : (isOverdue ? 'overdue' : 'pending'),
        paidAt: isPaid ? dueDate : null,
      });
    }

    // PDC Cheque for Security
    await Cheque.create({
      installmentPlan: plan._id,
      customer: cusRehman._id,
      chequeNumber: 'CHQ-889901',
      bankName: 'Meezan Bank Limited',
      amountPaisa: 69000000,
      chequeDate: new Date('2026-11-01'),
      status: 'held',
      notes: 'Security promissory PDC for 12-month solar installment contract',
    });
  }

  // Keep the plan's running totals derived from its stages. The dashboard and
  // collection screen read these fields directly, so a stale hardcoded total
  // would make every later payment build on the wrong balance.
  const planStages = await Installment.find({ installmentPlan: plan._id, deletedAt: null })
    .select('amountPaisa paidAmountPaisa')
    .lean();
  if (planStages.length) {
    const totalPaidPaisa = planStages.reduce((sum, stage) => sum + (stage.paidAmountPaisa || 0), 0);
    const totalPayablePaisa =
      plan.totalPayablePaisa ||
      planStages.reduce((sum, stage) => sum + (stage.amountPaisa || 0), 0);
    await InstallmentPlan.updateOne(
      { _id: plan._id },
      {
        $set: {
          totalPaidPaisa,
          remainingBalancePaisa: Math.max(0, totalPayablePaisa - totalPaidPaisa),
        },
      }
    );
  }

  // 10. Installation & Warranties
  console.log('10. Provisioning Field Installation & Warranties...');
  let inst = await Installation.findOne({ installationNumber: 'INS-2026-0001' });
  if (!inst) {
    inst = await Installation.create({
      installationNumber: 'INS-2026-0001',
      sale: sale._id,
      customer: cusTariq._id,
      leadTechnician: userMap[ROLES.TECHNICIAN]._id,
      technicians: [userMap[ROLES.TECHNICIAN]._id],
      scheduledStartDate: new Date('2026-02-15'),
      completedAt: new Date('2026-02-18'),
      status: 'completed',
      commissioningNotes: '18 Longi panels mounted on elevated structure. Huawei inverter synchronized with LESCO grid.',
    });

    // Warranties
    await Warranty.create({
      warrantyNumber: 'WAR-2026-0001',
      installation: inst._id,
      customer: cusTariq._id,
      item: itemDocs['PANEL-580W-LONGI']._id,
      warrantyType: 'panel_performance',
      startDate: new Date('2026-02-18'),
      endDate: new Date('2051-02-18'),
      years: 25,
      status: 'active',
      notes: '25-Year Tier 1 Linear Power Warranty (84.8% performance guarantee).',
    });

    await Warranty.create({
      warrantyNumber: 'WAR-2026-0002',
      installation: inst._id,
      customer: cusTariq._id,
      item: itemDocs['INV-10KW-HUAWEI']._id,
      warrantyType: 'inverter',
      startDate: new Date('2026-02-18'),
      endDate: new Date('2031-02-18'),
      years: 5,
      status: 'active',
      notes: '5-Year Replacement Warranty for Huawei SUN2000 Inverter.',
    });
  }

  // 11. Complaints Desk
  console.log('11. Provisioning Complaint Tickets...');
  let cmp = await Complaint.findOne({ ticketNumber: 'CMP-2026-0001' });
  if (!cmp) {
    await Complaint.create({
      ticketNumber: 'CMP-2026-0001',
      customer: cusTariq._id,
      issueType: 'inverter_fault',
      priority: 'high',
      description: 'Grid over-voltage warning (253V) causing intermittent inverter trip during peak noon solar hours.',
      assignedTechnician: userMap[ROLES.TECHNICIAN]._id,
      visitDate: new Date('2026-02-25'),
      status: 'resolved',
      resolvedAt: new Date('2026-02-26'),
      resolutionNotes: 'Calibrated LESCO grid over-voltage threshold parameter on Huawei SmartLogger from 253V to 258V in accordance with DISCO interconnection rules.',
      serviceChargePaisa: 0,
      isUnderWarranty: true,
    });
  }

  // 12. Double-Entry Accounting Seed
  console.log('12. Posting General Ledger Entries and Operating Expenses...');
  // Expense 1: Office Rent
  let expRent = await Expense.findOne({ voucherNumber: 'EXP-2026-0001' });
  if (!expRent) {
    const accRent = await Account.findOne({ code: '6030' });
    const accBank = await Account.findOne({ code: '1020' });
    const rentAmount = 15000000; // 150,000 PKR

    const jvRent = await JournalEntry.create({
      entryNumber: 'JV-2026-0001',
      date: new Date('2026-02-01'),
      referenceType: 'expense',
      memo: 'Head Office & Showroom Monthly Rent (Gulberg III)',
      lines: [
        { account: accRent._id, accountCode: '6030', accountName: accRent.name, debitPaisa: rentAmount, creditPaisa: 0, description: 'Office Rent' },
        { account: accBank._id, accountCode: '1020', accountName: accBank.name, debitPaisa: 0, creditPaisa: rentAmount, description: 'Paid via Bank Alfalah' },
      ],
      totalDebitPaisa: rentAmount,
      totalCreditPaisa: rentAmount,
      createdBy: userMap[ROLES.ACCOUNTANT]._id,
    });

    await Expense.create({
      voucherNumber: 'EXP-2026-0001',
      date: new Date('2026-02-01'),
      categoryAccount: accRent._id,
      paymentAccount: accBank._id,
      amountPaisa: rentAmount,
      payee: 'Al-Hafeez Property Management',
      notes: 'February 2026 Commercial Office Rent',
      journalEntry: jvRent._id,
      recordedBy: userMap[ROLES.ACCOUNTANT]._id,
    });
  }

  // Expense 2: Surveying & Field Fuel
  let expFuel = await Expense.findOne({ voucherNumber: 'EXP-2026-0002' });
  if (!expFuel) {
    const accFuel = await Account.findOne({ code: '6040' });
    const accCash = await Account.findOne({ code: '1010' });
    const fuelAmount = 1250000; // 12,500 PKR

    const jvFuel = await JournalEntry.create({
      entryNumber: 'JV-2026-0002',
      date: new Date('2026-02-12'),
      referenceType: 'expense',
      memo: 'Survey Bike Fuel & Logistics Reimbursement',
      lines: [
        { account: accFuel._id, accountCode: '6040', accountName: accFuel.name, debitPaisa: fuelAmount, creditPaisa: 0, description: 'Field Travel & Fuel' },
        { account: accCash._id, accountCode: '1010', accountName: accCash.name, debitPaisa: 0, creditPaisa: fuelAmount, description: 'Paid from Cash in Hand' },
      ],
      totalDebitPaisa: fuelAmount,
      totalCreditPaisa: fuelAmount,
      createdBy: userMap[ROLES.ACCOUNTANT]._id,
    });

    await Expense.create({
      voucherNumber: 'EXP-2026-0002',
      date: new Date('2026-02-12'),
      categoryAccount: accFuel._id,
      paymentAccount: accCash._id,
      amountPaisa: fuelAmount,
      payee: 'PSO Liberty Fuel Station',
      notes: 'DHA & Bahria Town Site Surveys Fuel',
      journalEntry: jvFuel._id,
      recordedBy: userMap[ROLES.ACCOUNTANT]._id,
    });
  }

  // Journal Entry 3: Sale Contract & Hardware COGS for Tariq
  let jvSale = await JournalEntry.findOne({ entryNumber: 'JV-2026-0003' });
  if (!jvSale) {
    const accAR = await Account.findOne({ code: '1030' });
    const accRev = await Account.findOne({ code: '4010' });
    const accCogs = await Account.findOne({ code: '5010' });
    const accInv = await Account.findOne({ code: '1040' });

    await JournalEntry.create({
      entryNumber: 'JV-2026-0003',
      date: new Date('2026-02-12'),
      referenceType: 'sale',
      referenceId: sale._id,
      memo: `Sale Approved & Contract Issued: ${sale.saleNumber}`,
      lines: [
        { account: accAR._id, accountCode: '1030', accountName: accAR.name, debitPaisa: 105000000, creditPaisa: 0, description: 'Contract Receivable for Sale SALE-2026-0001' },
        { account: accRev._id, accountCode: '4010', accountName: accRev.name, debitPaisa: 0, creditPaisa: 105000000, description: 'Solar Installation Revenue' },
        { account: accCogs._id, accountCode: '5010', accountName: accCogs.name, debitPaisa: 90710000, creditPaisa: 0, description: 'COGS Hardware Delivery' },
        { account: accInv._id, accountCode: '1040', accountName: accInv.name, debitPaisa: 0, creditPaisa: 90710000, description: 'Inventory Reduction' },
      ],
      totalDebitPaisa: 195710000,
      totalCreditPaisa: 195710000,
      createdBy: userMap[ROLES.ACCOUNTANT]._id,
    });
  }

  // Journal Entry 4: Customer Advance Payment Received
  let jvPay = await JournalEntry.findOne({ entryNumber: 'JV-2026-0004' });
  if (!jvPay) {
    const accBank = await Account.findOne({ code: '1020' });
    const accAR = await Account.findOne({ code: '1030' });

    await JournalEntry.create({
      entryNumber: 'JV-2026-0004',
      date: new Date('2026-02-14'),
      referenceType: 'payment',
      referenceId: sale._id,
      memo: `Customer Booking Payment: RC-2026-0001 (${cusTariq.name})`,
      lines: [
        { account: accBank._id, accountCode: '1020', accountName: accBank.name, debitPaisa: 35000000, creditPaisa: 0, description: 'IBFT Received into Bank Alfalah' },
        { account: accAR._id, accountCode: '1030', accountName: accAR.name, debitPaisa: 0, creditPaisa: 35000000, description: 'AR Reduction for Tariq 10kW System' },
      ],
      totalDebitPaisa: 35000000,
      totalCreditPaisa: 35000000,
      createdBy: userMap[ROLES.ACCOUNTANT]._id,
    });
  }

  // Seed default notification templates
  await seedDefaultTemplates();

  console.log('\n✅ Demo Data Successfully Seeded!\n');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('Test Accounts (Password for all: Password123):');
  console.log('  • Business Owner:   owner@solar.com.pk');
  console.log('  • Branch Manager:   manager@solar.com.pk');
  console.log('  • Sales Consultant: sales@solar.com.pk');
  console.log('  • Site Surveyor:    surveyor@solar.com.pk');
  console.log('  • Solar Technician: technician@solar.com.pk');
  console.log('  • Storekeeper:      storekeeper@solar.com.pk');
  console.log('  • Head Accountant:  accountant@solar.com.pk');
  console.log('─────────────────────────────────────────────────────────────────\n');
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal seed error:', err);
      process.exit(1);
    });
}

module.exports = { seed };
