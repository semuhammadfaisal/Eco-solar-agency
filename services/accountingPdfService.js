'use strict';

/**
 * PDF Statement Generation for Double-Entry Accounting & Financial Reports.
 *
 * Generates:
 * 1. Trial Balance Statement PDF
 * 2. Profit & Loss (Income Statement) PDF
 * 3. Cash Book Ledger PDF
 * 4. Daily Closing Sheet PDF
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { formatDate, formatDateTime, formatPKR } = require('../utils/format');

function localPublicPath(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const root = path.resolve(path.join(__dirname, '..', 'public'));
  const absolute = path.resolve(path.join(root, publicPath.replace(/^\/+/, '')));
  return absolute.startsWith(root + path.sep) && fs.existsSync(absolute) ? absolute : null;
}

function checkPageSpace(doc, needed = 40) {
  if (doc.y + needed > 760) {
    doc.addPage();
    return true;
  }
  return false;
}

function renderHeader(doc, title, subtitle, settings = {}) {
  const logo = localPublicPath(settings.logoPath);
  if (logo && /\.(png|jpe?g)$/i.test(logo)) {
    try {
      doc.image(logo, 40, 32, { fit: [110, 50] });
    } catch (_e) {}
  }

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f766e').text(settings.companyName || 'SOLAR AGENCY', 160, 34, { align: 'right' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
  const companyLines = [
    settings.legalName && settings.legalName !== settings.companyName ? settings.legalName : '',
    [settings.address, settings.city].filter(Boolean).join(', '),
    [settings.phone ? `Ph: ${settings.phone}` : '', settings.email ? `Email: ${settings.email}` : ''].filter(Boolean).join(' | '),
    [settings.ntn ? `NTN: ${settings.ntn}` : '', settings.strn ? `STRN: ${settings.strn}` : ''].filter(Boolean).join(' | '),
  ].filter(Boolean);
  doc.text(companyLines.join('\n'), 160, 52, { align: 'right', lineGap: 1.5 });

  doc.moveTo(40, 96).lineTo(555, 96).lineWidth(1.5).strokeColor('#0f766e').stroke();
  doc.y = 106;

  const titleY = doc.y;
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(title, 40, titleY);
  doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(subtitle, 40, titleY + 18);
  doc.y = titleY + 36;
}

/**
 * 1. Build Trial Balance PDF
 */
function buildTrialBalancePdf({ trialBalance, asOfDate, settings = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderHeader(
      doc,
      'TRIAL BALANCE STATEMENT',
      `As of ${formatDate(asOfDate || trialBalance.asOfDate)}  |  Double-Entry Verification`,
      settings
    );

    // Table Header
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 20).fill('#0f766e');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('Code', 48, tableTop + 6);
    doc.text('Account Name', 100, tableTop + 6);
    doc.text('Type', 300, tableTop + 6);
    doc.text('Debit Balance (PKR)', 370, tableTop + 6, { width: 85, align: 'right' });
    doc.text('Credit Balance (PKR)', 460, tableTop + 6, { width: 85, align: 'right' });

    doc.y = tableTop + 22;

    trialBalance.rows.forEach((r, idx) => {
      checkPageSpace(doc, 20);
      const rowY = doc.y;
      if (idx % 2 === 1) doc.rect(40, rowY - 2, 515, 18).fill('#f8fafc');

      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      doc.text(r.code, 48, rowY + 2);
      doc.font('Helvetica-Bold').text(r.name, 100, rowY + 2, { width: 195 });
      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(r.type.toUpperCase(), 300, rowY + 2);

      doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
      doc.text(r.debitBalancePaisa ? formatPKR(r.debitBalancePaisa) : '—', 370, rowY + 2, { width: 85, align: 'right' });
      doc.text(r.creditBalancePaisa ? formatPKR(r.creditBalancePaisa) : '—', 460, rowY + 2, { width: 85, align: 'right' });

      doc.y = rowY + 18;
    });

    // Total row
    checkPageSpace(doc, 30);
    const totY = doc.y + 4;
    doc.rect(40, totY, 515, 22).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f766e');
    doc.text('TOTAL TRIAL BALANCE', 48, totY + 6);
    doc.text(formatPKR(trialBalance.totalDebitPaisa), 370, totY + 6, { width: 85, align: 'right' });
    doc.text(formatPKR(trialBalance.totalCreditPaisa), 460, totY + 6, { width: 85, align: 'right' });

    // Balance verification box
    doc.y = totY + 30;
    const isBalanced = trialBalance.isBalanced;
    doc.rect(40, doc.y, 515, 22).fill(isBalanced ? '#ecfdf5' : '#fef2f2');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(isBalanced ? '#065f46' : '#991b1b');
    doc.text(
      isBalanced
        ? '✓ LEDGER IS PERFECTLY BALANCED: Total Debits equal Total Credits down to the exact paisa.'
        : `⚠ UNBALANCED LEDGER: Discrepancy of ${formatPKR(Math.abs(trialBalance.differencePaisa))}`,
      48,
      doc.y + 6
    );

    doc.end();
  });
}

/**
 * 2. Build Profit & Loss Statement PDF
 */
function buildProfitLossPdf({ profitLoss, fromDate, toDate, settings = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const periodStr = [
      fromDate ? `From: ${formatDate(fromDate)}` : '',
      toDate ? `To: ${formatDate(toDate)}` : '',
    ].filter(Boolean).join('  ') || 'Cumulative All-Time';

    renderHeader(doc, 'PROFIT & LOSS STATEMENT', `Income & Expenditure Statement  |  ${periodStr}`, settings);

    function renderSection(title, items, totalPaisa, headerBg = '#f1f5f9', titleColor = '#0f766e') {
      checkPageSpace(doc, 45);
      doc.rect(40, doc.y, 515, 18).fill(headerBg);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(titleColor).text(title, 48, doc.y + 4);
      doc.y += 22;

      if (!items || items.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#94a3b8').text('No entries recorded in this period.', 50, doc.y);
        doc.y += 16;
      } else {
        items.forEach((it, idx) => {
          checkPageSpace(doc, 18);
          const rowY = doc.y;
          if (idx % 2 === 1) doc.rect(40, rowY - 2, 515, 16).fill('#f8fafc');

          doc.font('Helvetica').fontSize(8).fillColor('#334155');
          doc.text(it.code, 50, rowY + 1);
          doc.text(it.name, 110, rowY + 1, { width: 280 });
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(formatPKR(it.amountPaisa), 400, rowY + 1, { width: 145, align: 'right' });
          doc.y = rowY + 16;
        });
      }

      // Subtotal line
      const subY = doc.y;
      doc.rect(40, subY, 515, 18).fill('#f8fafc');
      doc.moveTo(40, subY).lineTo(555, subY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(titleColor).text(`TOTAL ${title}`, 50, subY + 4);
      doc.text(formatPKR(totalPaisa), 400, subY + 4, { width: 145, align: 'right' });
      doc.y = subY + 24;
    }

    renderSection('OPERATING REVENUE & SALES', profitLoss.incomeItems, profitLoss.totalIncomePaisa, '#ecfdf5', '#047857');
    renderSection('COST OF GOODS SOLD (COGS)', profitLoss.cogsItems, profitLoss.totalCogsPaisa, '#fffbeb', '#b45309');

    // Gross Profit Highlight Box
    checkPageSpace(doc, 32);
    const gpY = doc.y;
    doc.rect(40, gpY, 515, 24).fill('#e0f2fe');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0369a1');
    doc.text(`GROSS PROFIT (${profitLoss.grossMarginPercent}% margin)`, 48, gpY + 7);
    doc.text(formatPKR(profitLoss.grossProfitPaisa), 400, gpY + 7, { width: 145, align: 'right' });
    doc.y = gpY + 32;

    renderSection('OPERATING EXPENSES (OPEX)', profitLoss.operatingExpenseItems, profitLoss.totalOperatingExpensePaisa, '#f8fafc', '#475569');

    // Net Profit Box
    checkPageSpace(doc, 36);
    const npY = doc.y;
    const isProfitable = profitLoss.netProfitPaisa >= 0;
    doc.rect(40, npY, 515, 28).fill(isProfitable ? '#dcfce7' : '#fee2e2');
    doc.font('Helvetica-Bold').fontSize(11).fillColor(isProfitable ? '#15803d' : '#b91c1c');
    doc.text(`NET OPERATING ${isProfitable ? 'PROFIT' : 'LOSS'} (${profitLoss.netMarginPercent}% margin)`, 48, npY + 8);
    doc.text(formatPKR(profitLoss.netProfitPaisa), 400, npY + 8, { width: 145, align: 'right' });

    doc.end();
  });
}

/**
 * 3. Build Cash Book Ledger PDF
 */
function buildCashBookPdf({ cashBook, fromDate, toDate, settings = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const periodStr = [
      fromDate ? `From: ${formatDate(fromDate)}` : '',
      toDate ? `To: ${formatDate(toDate)}` : '',
    ].filter(Boolean).join('  ') || 'Full Ledger History';

    renderHeader(
      doc,
      'CASH IN HAND BOOK (1010)',
      `Physical Cash Register  |  ${periodStr}`,
      settings
    );

    // Opening Balance Ribbon
    const obY = doc.y;
    doc.rect(40, obY, 515, 20).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f766e').text('Opening Cash Balance:', 48, obY + 5);
    doc.text(formatPKR(cashBook.openingBalancePaisa), 400, obY + 5, { width: 145, align: 'right' });
    doc.y = obY + 26;

    // Table Header
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 18).fill('#0f766e');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('Date', 48, tableTop + 5);
    doc.text('Voucher #', 95, tableTop + 5);
    doc.text('Particulars / Memo', 160, tableTop + 5);
    doc.text('Cash IN (Debit)', 340, tableTop + 5, { width: 65, align: 'right' });
    doc.text('Cash OUT (Credit)', 410, tableTop + 5, { width: 65, align: 'right' });
    doc.text('Running Balance', 480, tableTop + 5, { width: 65, align: 'right' });

    doc.y = tableTop + 20;

    cashBook.transactions.forEach((tx, idx) => {
      checkPageSpace(doc, 20);
      const rowY = doc.y;
      if (idx % 2 === 1) doc.rect(40, rowY - 2, 515, 18).fill('#f8fafc');

      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
      doc.text(formatDate(tx.date), 48, rowY + 2);
      doc.font('Helvetica-Bold').text(tx.entryNumber, 95, rowY + 2);
      doc.font('Helvetica').text(tx.memo || tx.description || '—', 160, rowY + 2, { width: 175, height: 14 });

      doc.text(tx.debitPaisa ? formatPKR(tx.debitPaisa) : '—', 340, rowY + 2, { width: 65, align: 'right' });
      doc.text(tx.creditPaisa ? formatPKR(tx.creditPaisa) : '—', 410, rowY + 2, { width: 65, align: 'right' });
      doc.font('Helvetica-Bold').text(formatPKR(tx.runningBalancePaisa), 480, rowY + 2, { width: 65, align: 'right' });

      doc.y = rowY + 18;
    });

    // Summary closing box
    checkPageSpace(doc, 30);
    const clY = doc.y + 6;
    doc.rect(40, clY, 515, 24).fill('#ecfdf5');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#065f46');
    doc.text('CLOSING PHYSICAL CASH BALANCE', 48, clY + 7);
    doc.text(formatPKR(cashBook.closingBalancePaisa), 400, clY + 7, { width: 145, align: 'right' });

    doc.end();
  });
}

/**
 * 4. Build Daily Closing Summary PDF
 */
function buildDailyClosingPdf({ closing, date, settings = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderHeader(
      doc,
      'DAILY CLOSING & CASH DRAWER RECONCILIATION',
      `End-of-Day Financial Summary  |  Date: ${formatDate(date || closing.date)}`,
      settings
    );

    // 2-Column Summary Cards
    const cardY = doc.y;
    // Cash Drawer Card
    doc.roundedRect(40, cardY, 250, 140, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f766e').text('CASH IN HAND SUMMARY', 52, cardY + 10);

    const cashRows = [
      ['Opening Cash Balance', formatPKR(closing.cash.openingBalancePaisa)],
      ['Total Cash Collections Today', formatPKR(closing.cash.collectionsPaisa)],
      ['Total Cash Disbursements Today', formatPKR(closing.cash.disbursementsPaisa)],
      ['  - Operating Expenses', formatPKR(closing.cash.expensesPaisa)],
      ['  - Wages & Commission Paid', formatPKR(closing.cash.wagesPaisa)],
    ];

    let rowCursor = cardY + 28;
    cashRows.forEach(([lbl, val]) => {
      doc.font('Helvetica').fontSize(8).fillColor('#475569').text(lbl, 52, rowCursor);
      doc.font('Helvetica-Bold').text(val, 190, rowCursor, { width: 90, align: 'right' });
      rowCursor += 15;
    });

    doc.rect(42, cardY + 110, 246, 28).fill('#ecfdf5');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#065f46').text('Expected Cash in Drawer:', 52, cardY + 118);
    doc.fontSize(10).text(formatPKR(closing.cash.expectedClosingBalancePaisa), 170, cardY + 117, { width: 110, align: 'right' });

    // Bank Account Card
    doc.roundedRect(305, cardY, 250, 140, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0369a1').text('BANK ALFALAH SUMMARY', 317, cardY + 10);

    const bankRows = [
      ['Opening Bank Balance', formatPKR(closing.bank.openingBalancePaisa)],
      ['Total Deposits / Wire In', formatPKR(closing.bank.depositsPaisa)],
      ['Total Bank Outflows / Cheques', formatPKR(closing.bank.disbursementsPaisa)],
    ];

    rowCursor = cardY + 28;
    bankRows.forEach(([lbl, val]) => {
      doc.font('Helvetica').fontSize(8).fillColor('#475569').text(lbl, 317, rowCursor);
      doc.font('Helvetica-Bold').text(val, 455, rowCursor, { width: 90, align: 'right' });
      rowCursor += 15;
    });

    doc.rect(307, cardY + 110, 246, 28).fill('#e0f2fe');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0369a1').text('Closing Bank Balance:', 317, cardY + 118);
    doc.fontSize(10).text(formatPKR(closing.bank.closingBalancePaisa), 435, cardY + 117, { width: 110, align: 'right' });

    doc.y = cardY + 155;

    // Physical Reconciliation & Signature section
    checkPageSpace(doc, 80);
    const signY = doc.y;
    doc.rect(40, signY, 515, 65).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1e293b').text('CASH DRAWER RECONCILIATION SIGN-OFF', 50, signY + 8);
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(
      'Physical cash in the safe has been counted and verified against the expected closing balance above.',
      50,
      signY + 20
    );

    doc.moveTo(60, signY + 52).lineTo(220, signY + 52).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text('Cashier / Accountant Signature', 70, signY + 55);

    doc.moveTo(350, signY + 52).lineTo(510, signY + 52).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text('Branch Manager / Owner Signature', 360, signY + 55);

    doc.end();
  });
}

/**
 * 5. Build a branch cash-drawer reconciliation sheet.
 *
 * Unlike the company-wide daily summary above, this PDF is a printable sign-off
 * for one branch's drawer: opening float, cash build-up, physical count,
 * variance and denominations.
 */
function buildDrawerClosingPdf({ drawer, summary = null, settings = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const data = summary || {};
    const openingFloatPaisa = Number(data.openingFloatPaisa ?? drawer.openingFloatPaisa ?? 0);
    const cashSalesPaisa = Number(data.cashSalesPaisa ?? drawer.cashSalesPaisa ?? 0);
    const cashExpensesPaisa = Number(data.cashExpensesPaisa ?? drawer.cashExpensesPaisa ?? 0);
    const cashInPaisa = Number(data.cashInPaisa ?? drawer.cashInPaisa ?? 0);
    const cashOutPaisa = Number(data.cashOutPaisa ?? drawer.cashOutPaisa ?? 0);
    const expectedCashPaisa = Number(data.expectedCashPaisa ?? drawer.expectedCashPaisa ?? 0);
    const countedCashPaisa = drawer.countedCashPaisa;
    const variancePaisa = Number(drawer.variancePaisa || 0);
    const businessDate = drawer.businessDate ? new Date(drawer.businessDate) : new Date();

    renderHeader(
      doc,
      'CASH DRAWER RECONCILIATION',
      `${drawer.branchCode || 'MAIN'} ${drawer.branchName || ''}  |  ${formatDate(businessDate)}  |  ${drawer.number || ''}`,
      settings
    );

    // Status ribbon
    const ribbonY = doc.y;
    const closed = drawer.status === 'closed';
    doc.rect(40, ribbonY, 515, 22).fill(closed ? '#dcfce7' : '#fef3c7');
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(closed ? '#166534' : '#92400e')
      .text(`STATUS: ${closed ? 'CLOSED' : 'OPEN'}`, 50, ribbonY + 6);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#475569')
      .text(
        `Window: ${formatDateTime(drawer.periodStart)} — ${formatDateTime(drawer.periodEnd)}`,
        170,
        ribbonY + 7,
        { width: 375, align: 'right' }
      );
    doc.y = ribbonY + 32;

    // Cash build-up table
    const rows = [
      ['Opening float (previous drawer / default)', openingFloatPaisa],
      ['+ POS cash receipts', cashSalesPaisa],
      ['- Cash expenses paid from drawer', cashExpensesPaisa],
      ['+ Manual cash in', cashInPaisa],
      ['- Manual cash out', cashOutPaisa],
    ];
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 18).fill('#0f766e');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('CASH BUILD-UP', 48, tableTop + 5);
    doc.text('AMOUNT (PKR)', 440, tableTop + 5, { width: 105, align: 'right' });

    let cursor = tableTop + 18;
    rows.forEach(([label, value], index) => {
      doc.rect(40, cursor, 515, 17).fill(index % 2 ? '#f8fafc' : '#ffffff');
      doc.font('Helvetica').fontSize(8).fillColor('#334155').text(label, 48, cursor + 4);
      doc
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text(formatPKR(value), 440, cursor + 4, { width: 105, align: 'right' });
      cursor += 17;
    });

    // Expected box
    doc.rect(40, cursor + 4, 515, 24).fill('#e0f2fe');
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#0369a1')
      .text('EXPECTED CASH IN DRAWER', 48, cursor + 10);
    doc
      .fontSize(11)
      .text(formatPKR(expectedCashPaisa), 400, cursor + 9, { width: 145, align: 'right' });
    cursor += 40;

    // Physical count & variance
    doc.rect(40, cursor, 515, 18).fill('#0f766e');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('PHYSICAL COUNT & VARIANCE', 48, cursor + 5);
    doc.text('AMOUNT (PKR)', 440, cursor + 5, { width: 105, align: 'right' });
    cursor += 18;

    const countRows = [
      ['Counted cash (physical)', countedCashPaisa === null ? null : countedCashPaisa],
      ['Variance (counted - expected)', closed ? variancePaisa : null],
    ];
    countRows.forEach(([label, value], index) => {
      doc.rect(40, cursor, 515, 17).fill(index % 2 ? '#f8fafc' : '#ffffff');
      doc.font('Helvetica').fontSize(8).fillColor('#334155').text(label, 48, cursor + 4);
      doc
        .font('Helvetica-Bold')
        .fillColor(value === null ? '#94a3b8' : value < 0 ? '#b91c1c' : value > 0 ? '#b45309' : '#166534')
        .text(value === null ? '—' : formatPKR(value), 440, cursor + 4, { width: 105, align: 'right' });
      cursor += 17;
    });
    cursor += 10;

    // Close details
    if (closed) {
      checkPageSpace(doc, 90);
      cursor = Math.max(cursor, doc.y);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text('CLOSED BY', 40, cursor);
      doc.font('Helvetica').fontSize(8).fillColor('#475569');
      doc.text(
        [
          `Name: ${drawer.closedByName || '—'}`,
          `Role: ${drawer.closedByRole || '—'}`,
          `Closed at: ${formatDateTime(drawer.closedAt)}`,
          `Variance reason: ${drawer.varianceReason || '—'}`,
          `Notes: ${drawer.closingNotes || '—'}`,
        ].join('\n'),
        40,
        cursor + 13,
        { width: 515, lineGap: 2 }
      );
      cursor = doc.y + 12;
    }

    // Denominations
    const denominations = Array.isArray(drawer.denominations) ? drawer.denominations : [];
    if (denominations.length) {
      checkPageSpace(doc, 80);
      cursor = Math.max(cursor, doc.y);
      doc.rect(40, cursor, 515, 18).fill('#0f766e');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      doc.text('DENOMINATION COUNT', 48, cursor + 5);
      doc.text('COUNT', 330, cursor + 5, { width: 60, align: 'right' });
      doc.text('TOTAL (PKR)', 430, cursor + 5, { width: 115, align: 'right' });
      cursor += 18;
      denominations.forEach((row, index) => {
        doc.rect(40, cursor, 515, 16).fill(index % 2 ? '#f8fafc' : '#ffffff');
        doc.font('Helvetica').fontSize(8).fillColor('#334155').text(row.label || formatPKR(row.valuePaisa), 48, cursor + 4);
        doc.text(String(row.count), 330, cursor + 4, { width: 60, align: 'right' });
        doc.font('Helvetica-Bold').fillColor('#0f172a').text(formatPKR(row.totalPaisa), 430, cursor + 4, { width: 115, align: 'right' });
        cursor += 16;
      });
      cursor += 8;
    }

    // Adjustments
    const adjustments = Array.isArray(drawer.adjustments) ? drawer.adjustments : [];
    if (adjustments.length) {
      checkPageSpace(doc, 80);
      cursor = Math.max(cursor, doc.y);
      doc.rect(40, cursor, 515, 18).fill('#0f766e');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      doc.text('MANUAL CASH ADJUSTMENTS', 48, cursor + 5);
      doc.text('AMOUNT (PKR)', 440, cursor + 5, { width: 105, align: 'right' });
      cursor += 18;
      adjustments.forEach((row, index) => {
        doc.rect(40, cursor, 515, 16).fill(index % 2 ? '#f8fafc' : '#ffffff');
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#334155')
          .text(`${row.kind === 'in' ? 'IN ' : 'OUT'} · ${row.reason || ''}`, 48, cursor + 4, {
            width: 370,
            ellipsis: true,
          });
        doc
          .font('Helvetica-Bold')
          .fillColor(row.kind === 'in' ? '#166534' : '#b91c1c')
          .text(`${row.kind === 'in' ? '+' : '-'}${formatPKR(row.amountPaisa)}`, 440, cursor + 4, {
            width: 105,
            align: 'right',
          });
        cursor += 16;
      });
      cursor += 8;
    }

    // Sign-off
    checkPageSpace(doc, 80);
    cursor = Math.max(cursor, doc.y);
    doc.rect(40, cursor, 515, 62).fill('#f1f5f9');
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#1e293b')
      .text('DRAWER SIGN-OFF', 50, cursor + 8);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#475569')
      .text(
        'The physical cash in the drawer has been counted in the presence of the closer and reconciles to the figures above.',
        50,
        cursor + 20,
        { width: 495 }
      );
    doc.moveTo(60, cursor + 49).lineTo(220, cursor + 49).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text('Cashier / Shopkeeper Signature', 68, cursor + 52);
    doc.moveTo(350, cursor + 49).lineTo(510, cursor + 49).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text('Owner / Accountant Signature', 360, cursor + 52);

    doc.end();
  });
}

module.exports = {
  buildTrialBalancePdf,
  buildProfitLossPdf,
  buildCashBookPdf,
  buildDailyClosingPdf,
  buildDrawerClosingPdf,
};
