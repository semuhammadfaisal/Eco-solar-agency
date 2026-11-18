/**
 * Business document numbering.
 *
 * Counters are atomic (see models/Counter) and scoped per year, so every
 * document type keeps its own gap-free sequence.
 */
'use strict';

const Counter = require('../models/Counter');
const Quotation = require('../models/Quotation');

function format(prefix, year, seq, width = 4) {
  return `${prefix}-${year}-${String(seq).padStart(width, '0')}`;
}

function formatQuotationNumber(year, seq) {
  return format('QT', year, seq);
}

async function nextQuotationNumber() {
  const year = new Date().getFullYear();
  // Seed/import scripts can create quotations without advancing Counter.
  // Keep reserving atomic sequence values until one is not already present.
  while (true) {
    const seq = await Counter.next(`quotation_${year}`);
    const number = formatQuotationNumber(year, seq);
    if (!(await Quotation.exists({ quotationNumber: number }))) return number;
  }
}

async function nextSaleNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`sale_${year}`);
  return format('SAL', year, seq);
}

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`invoice_${year}`);
  return format('INV', year, seq);
}

module.exports = { nextQuotationNumber, nextSaleNumber, nextInvoiceNumber, formatQuotationNumber };
