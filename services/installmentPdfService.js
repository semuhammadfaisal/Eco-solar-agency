'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { formatDate, formatPKR, numberToWordsPKR } = require('../utils/format');
const { PAYMENT_METHOD_LABELS } = require('../config/installments');

function localPublicPath(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const root = path.resolve(path.join(__dirname, '..', 'public'));
  const absolute = path.resolve(path.join(root, publicPath.replace(/^\/+/, '')));
  return absolute.startsWith(root + path.sep) && fs.existsSync(absolute) ? absolute : null;
}

function checkPageSpace(doc, needed = 60) {
  if (doc.y + needed > 760) {
    doc.addPage();
    return true;
  }
  return false;
}

/**
 * Builds an official PDF buffer for a Payment Receipt RC-XXXX.
 */
function buildReceiptPdf(payment, settings = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
      info: {
        Title: `Receipt ${payment.receiptNumber}`,
        Author: settings.companyName || 'Solar Agency',
        Subject: `Payment Receipt for ${payment.customer ? payment.customer.name : 'Customer'}`,
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // 1. Header / Letterhead
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
    doc.y = 104;

    // 2. Receipt Title & Meta
    const metaY = doc.y;
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text('OFFICIAL PAYMENT RECEIPT', 40, metaY);
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text('Installment & Billing Acknowledgment', 40, metaY + 18);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f766e').text(payment.receiptNumber, 360, metaY, { align: 'right', width: 195 });
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text(`Receipt Date: ${formatDate(payment.paymentDate)}`, 360, metaY + 18, { align: 'right', width: 195 });
    if (payment.installmentPlan && payment.installmentPlan.planNumber) {
      doc.text(`Plan Ref: ${payment.installmentPlan.planNumber}`, 360, metaY + 30, { align: 'right', width: 195 });
    }

    doc.y = metaY + 46;

    // 3. Customer & Commercial Summary Box
    const boxY = doc.y;
    doc.roundedRect(40, boxY, 515, 68, 4).fillAndStroke('#f8fafc', '#e2e8f0');

    // Left: Customer details
    const customer = payment.customer || {};
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f766e').text('RECEIVED FROM (CUSTOMER):', 50, boxY + 8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(customer.name || 'Valued Client', 50, boxY + 20);
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text(`Phone: ${customer.phone || '—'}  |  Code: ${customer.code || '—'}`, 50, boxY + 34);
    doc.text(`Address: ${[customer.address, customer.city].filter(Boolean).join(', ') || '—'}`, 50, boxY + 46);

    // Right: Amount and Method
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f766e').text('AMOUNT RECEIVED:', 340, boxY + 8);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#15803d').text(formatPKR(payment.amountPaisa), 340, boxY + 20);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    const methodLabel = PAYMENT_METHOD_LABELS[payment.paymentMethod] || payment.paymentMethod;
    doc.text(`Method: ${methodLabel}`, 340, boxY + 38);
    if (payment.reference) {
      doc.text(`Ref / Cheque #: ${payment.reference}`, 340, boxY + 50);
    }

    doc.y = boxY + 78;

    // Amount in Words Ribbon
    const wordsY = doc.y;
    doc.rect(40, wordsY, 515, 20).fill('#ecfdf5');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#065f46').text('Amount in Words:', 48, wordsY + 5);
    doc.font('Helvetica').fontSize(8).fillColor('#047857')
      .text(numberToWordsPKR(payment.amountPaisa, true), 135, wordsY + 5, { width: 410 });
    doc.y = wordsY + 28;

    // 4. Installment Allocation Table
    doc.rect(40, doc.y, 515, 18).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f766e').text('PAYMENT ALLOCATION BREAKDOWN', 48, doc.y + 4);
    doc.y += 24;

    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 18).fill('#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e293b');
    doc.text('#', 48, tableTop + 5);
    doc.text('Installment Stage', 70, tableTop + 5);
    doc.text('Principal Paid', 240, tableTop + 5, { width: 90, align: 'right' });
    doc.text('Late Fee Paid', 340, tableTop + 5, { width: 90, align: 'right' });
    doc.text('Total Allocated', 440, tableTop + 5, { width: 105, align: 'right' });

    doc.y = tableTop + 20;

    let totalAllocatedSum = 0;
    (payment.allocations || []).forEach((al, idx) => {
      checkPageSpace(doc, 22);
      const rowY = doc.y;
      if (idx % 2 === 1) doc.rect(40, rowY - 2, 515, 18).fill('#f8fafc');

      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      doc.text(String(idx + 1), 48, rowY + 2);
      doc.text(`Installment #${al.installmentNumber}${al.wasFullySettled ? ' (Fully Settled)' : ' (Partial)'}`, 70, rowY + 2);
      doc.text(formatPKR(al.principalPaidPaisa || 0), 240, rowY + 2, { width: 90, align: 'right' });
      doc.text(formatPKR(al.lateFeePaidPaisa || 0), 340, rowY + 2, { width: 90, align: 'right' });
      doc.font('Helvetica-Bold').text(formatPKR(al.totalAllocatedPaisa || 0), 440, rowY + 2, { width: 105, align: 'right' });

      totalAllocatedSum += al.totalAllocatedPaisa || 0;
      doc.y = rowY + 18;
    });

    if (payment.excessAdvancePaisa > 0) {
      const advY = doc.y;
      doc.rect(40, advY - 2, 515, 18).fill('#eff6ff');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e40af');
      doc.text('Advance Overpayment (Credited to future installments)', 70, advY + 2);
      doc.text(formatPKR(payment.excessAdvancePaisa), 440, advY + 2, { width: 105, align: 'right' });
      doc.y = advY + 20;
    }

    doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc.y += 6;

    // 5. Balance Summary Box
    checkPageSpace(doc, 50);
    const sumY = doc.y;
    doc.roundedRect(300, sumY, 255, 48, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text('Total Amount Received:', 310, sumY + 8);
    doc.font('Helvetica-Bold').fillColor('#0f172a').text(formatPKR(payment.amountPaisa), 420, sumY + 8, { align: 'right', width: 125 });

    doc.font('Helvetica').fillColor('#475569').text('Remaining Plan Balance:', 310, sumY + 26);
    doc.font('Helvetica-Bold').fillColor('#dc2626').text(formatPKR(payment.remainingPlanBalancePaisa), 420, sumY + 26, { align: 'right', width: 125 });

    doc.y = sumY + 60;

    // 6. Signatures Area
    checkPageSpace(doc, 75);
    const signY = doc.y + 25;

    // Left: Customer Copy Note
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
    doc.text('This is a computer-generated official receipt.', 40, signY);
    doc.text(`Received by: ${payment.receivedBy ? payment.receivedBy.name : 'Authorized Staff'}`, 40, signY + 12);

    // Right: Authorized Signature & Stamp
    doc.moveTo(375, signY + 20).lineTo(555, signY + 20).lineWidth(0.75).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(settings.companyName || 'Authorized Signatory', 375, signY + 25, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Authorized Cashier / Official Stamp', 375, signY + 35, { width: 180, align: 'center' });

    // Footer on all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8')
        .text(
          `${payment.receiptNumber} | Generated by ${settings.companyName || 'Solar Agency'} | Page ${i + 1} of ${range.count}`,
          40,
          805,
          { width: 515, align: 'center', lineBreak: false }
        );
    }

    doc.end();
  });
}

/**
 * Builds an official PDF buffer for a Customer Statement of Account.
 */
function buildCustomerStatementPdf(customer, ledgerData, settings = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
      info: {
        Title: `Statement of Account — ${customer.name}`,
        Author: settings.companyName || 'Solar Agency',
        Subject: `Installment Ledger Statement for ${customer.name}`,
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // 1. Header / Letterhead
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
    ].filter(Boolean);
    doc.text(companyLines.join('\n'), 160, 52, { align: 'right', lineGap: 1.5 });

    doc.moveTo(40, 96).lineTo(555, 96).lineWidth(1.5).strokeColor('#0f766e').stroke();
    doc.y = 104;

    // 2. Title & Statement Date
    const metaY = doc.y;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('STATEMENT OF INSTALLMENT ACCOUNT', 40, metaY);
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text('Customer Ledger & Settlement History', 40, metaY + 16);

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f766e').text(`Generated: ${formatDate(new Date())}`, 360, metaY, { align: 'right', width: 195 });
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text(`Customer Code: ${customer.code || '—'}`, 360, metaY + 14, { align: 'right', width: 195 });

    doc.y = metaY + 40;

    // 3. Customer Info Ribbon
    const cBoxY = doc.y;
    doc.roundedRect(40, cBoxY, 515, 46, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(customer.name, 50, cBoxY + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text(`Phone: ${customer.phone || '—'}  |  CNIC: ${customer.cnic || '—'}  |  City: ${customer.city || '—'}`, 50, cBoxY + 20);
    doc.text(`DISCO / Meter Ref: ${customer.disco || '—'} · ${customer.electricityReferenceNo || '—'}`, 50, cBoxY + 32);

    doc.y = cBoxY + 54;

    // 4. Financial Summary Cards (Contract, Down Payment, Paid, Outstanding)
    const sum = ledgerData.summary || {};
    const cardY = doc.y;
    const cardW = 122;

    // Card 1: Total Contract
    doc.roundedRect(40, cardY, cardW, 42, 3).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text('TOTAL CONTRACT', 46, cardY + 6);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a').text(formatPKR(sum.totalContractValuePaisa || 0), 46, cardY + 18);

    // Card 2: Down Payment
    doc.roundedRect(171, cardY, cardW, 42, 3).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text('DOWN PAYMENT', 177, cardY + 6);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f766e').text(formatPKR(sum.totalDownPaymentsPaisa || 0), 177, cardY + 18);

    // Card 3: Total Paid
    doc.roundedRect(302, cardY, cardW, 42, 3).fillAndStroke('#f0fdf4', '#bbf7d0');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#166534').text('TOTAL RECOVERED', 308, cardY + 6);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#15803d').text(formatPKR(sum.totalPaidPaisa || 0), 308, cardY + 18);

    // Card 4: Outstanding Balance
    doc.roundedRect(433, cardY, cardW, 42, 3).fillAndStroke('#fef2f2', '#fecaca');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#991b1b').text('CURRENT BALANCE DUE', 439, cardY + 6);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#dc2626').text(formatPKR(sum.totalRemainingBalancePaisa || 0), 439, cardY + 18);

    doc.y = cardY + 50;

    // 5. Transactions Table
    doc.rect(40, doc.y, 515, 18).fill('#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e293b');
    doc.text('Date', 46, doc.y + 5);
    doc.text('Transaction Details', 105, doc.y + 5);
    doc.text('Ref #', 270, doc.y + 5);
    doc.text('Debit (PKR)', 335, doc.y + 5, { width: 65, align: 'right' });
    doc.text('Credit (PKR)', 405, doc.y + 5, { width: 65, align: 'right' });
    doc.text('Balance (PKR)', 475, doc.y + 5, { width: 75, align: 'right' });

    doc.y += 20;

    (ledgerData.transactions || []).forEach((tx, idx) => {
      checkPageSpace(doc, 22);
      const rowY = doc.y;
      if (idx % 2 === 1) doc.rect(40, rowY - 2, 515, 18).fill('#f8fafc');

      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
      doc.text(formatDate(tx.date), 46, rowY + 2);
      doc.font('Helvetica-Bold').text(tx.type || '', 105, rowY + 2);
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(tx.description || '', 105, rowY + 10, { width: 160 });

      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
      doc.text(tx.reference || '—', 270, rowY + 2);
      doc.text(tx.debitPaisa ? formatPKR(tx.debitPaisa) : '—', 335, rowY + 2, { width: 65, align: 'right' });
      doc.text(tx.creditPaisa ? formatPKR(tx.creditPaisa) : '—', 405, rowY + 2, { width: 65, align: 'right' });
      doc.font('Helvetica-Bold').text(formatPKR(tx.runningBalancePaisa || 0), 475, rowY + 2, { width: 75, align: 'right' });

      doc.y = rowY + 20;
    });

    doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc.y += 10;

    // 6. Signature Block
    checkPageSpace(doc, 70);
    const signY = doc.y + 20;
    doc.moveTo(375, signY).lineTo(555, signY).lineWidth(0.75).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(settings.companyName || 'Authorized Signatory', 375, signY + 5, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Authorized Accounts Officer & Stamp', 375, signY + 15, { width: 180, align: 'center' });

    // Footer on all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8')
        .text(
          `Statement for ${customer.name} | Generated by ${settings.companyName || 'Solar Agency'} | Page ${i + 1} of ${range.count}`,
          40,
          805,
          { width: 515, align: 'center', lineBreak: false }
        );
    }

    doc.end();
  });
}

module.exports = { buildReceiptPdf, buildCustomerStatementPdf };
