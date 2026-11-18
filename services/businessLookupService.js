'use strict';

const Customer = require('../models/Customer');
const Quotation = require('../models/Quotation');
const Sale = require('../models/Sale');
const InstallmentPayment = require('../models/InstallmentPayment');
const PosSale = require('../models/PosSale');
const { can } = require('../config/permissions');
const { escapeRegex } = require('../utils/pagination');

const MAX_RESULTS_PER_TYPE = 10;

function cleanNumber(value) {
  return String(value || '').trim().slice(0, 80);
}

function salesScope(actor) {
  return actor && actor.role === 'sales' ? { assignedTo: actor._id } : {};
}

function posScope(actor) {
  if (actor && ['sales', 'shopkeeper'].includes(actor.role) && actor.branch) {
    return { branch: actor.branch };
  }
  return {};
}

function toResult(type, number, title, subtitle, url, date, aliases = []) {
  return { type, number, title, subtitle, url, date, aliases };
}

/** Search the business references the signed-in user is permitted to view. */
async function lookupBusinessNumber(value, actor) {
  const query = cleanNumber(value);
  if (!query) return { query, results: [], exact: null };

  const contains = new RegExp(escapeRegex(query), 'i');
  const exactRegex = new RegExp(`^${escapeRegex(query)}$`, 'i');
  const jobs = [];

  if (can(actor, 'customers.view')) {
    jobs.push(
      Customer.find({ code: contains })
        .select('code name phone city createdAt')
        .sort({ createdAt: -1 })
        .limit(MAX_RESULTS_PER_TYPE)
        .lean()
        .then((rows) => rows.map((row) => toResult(
          'Customer', row.code, row.name, [row.phone, row.city].filter(Boolean).join(' · '),
          `/customers/${row._id}`, row.createdAt
        )))
    );
  }

  if (can(actor, 'quotations.view')) {
    jobs.push(
      Quotation.find({ ...salesScope(actor), quotationNumber: contains })
        .select('quotationNumber revision customer status createdAt')
        .populate('customer', 'name code')
        .sort({ createdAt: -1 })
        .limit(MAX_RESULTS_PER_TYPE)
        .lean()
        .then((rows) => rows.map((row) => toResult(
          'Quotation', row.quotationNumber,
          `${row.customer ? row.customer.name : 'Customer'}${row.revision > 1 ? ` · Rev ${row.revision}` : ''}`,
          row.status, `/quotations/${row._id}`, row.createdAt
        )))
    );
  }

  if (can(actor, 'sales.view')) {
    jobs.push(
      Sale.find({
        ...salesScope(actor),
        $or: [
          { invoiceNumber: contains },
          { saleNumber: contains },
          { projectTitle: contains },
        ],
      })
        .select('invoiceNumber saleNumber projectTitle customer status createdAt')
        .populate('customer', 'name code')
        .sort({ createdAt: -1 })
        .limit(MAX_RESULTS_PER_TYPE)
        .lean()
        .then((rows) => rows.map((row) => toResult(
          'Project', row.projectTitle || row.invoiceNumber || row.saleNumber,
          row.customer ? row.customer.name : 'Customer',
          `${row.saleNumber} · ${row.status}`, `/projects/${row._id}`, row.createdAt,
          [row.invoiceNumber, row.saleNumber, row.projectTitle].filter(Boolean)
        )))
    );
  }

  if (can(actor, 'installments.view')) {
    jobs.push(
      InstallmentPayment.find({ receiptNumber: contains })
        .select('receiptNumber customer amountPaisa paymentDate')
        .populate('customer', 'name code')
        .sort({ paymentDate: -1 })
        .limit(MAX_RESULTS_PER_TYPE)
        .lean()
        .then((rows) => rows.map((row) => toResult(
          'Receipt', row.receiptNumber,
          row.customer ? row.customer.name : 'Customer',
          row.customer ? row.customer.code : '', `/installments/receipts/${row._id}`, row.paymentDate
        )))
    );
  }

  if (can(actor, 'pos.view')) {
    jobs.push(
      PosSale.find({ ...posScope(actor), number: contains })
        .select('number customerName customerPhone status soldAt')
        .sort({ soldAt: -1 })
        .limit(MAX_RESULTS_PER_TYPE)
        .lean()
        .then((rows) => rows.map((row) => toResult(
          'POS Invoice', row.number, row.customerName,
          [row.customerPhone, row.status].filter(Boolean).join(' · '), `/pos/${row._id}`, row.soldAt
        )))
    );
  }

  const results = (await Promise.all(jobs)).flat();
  const exact = results.find((row) =>
    [row.number, ...(row.aliases || [])].some((number) => exactRegex.test(number))
  ) || null;
  return { query, results, exact };
}

module.exports = { cleanNumber, lookupBusinessNumber };
