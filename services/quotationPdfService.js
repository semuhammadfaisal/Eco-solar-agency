'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { SYSTEM_TYPE_LABELS } = require('../config/systems');
const { QUOTATION_STATUS_LABELS, PAYMENT_OPTION_LABELS } = require('../config/quotations');
const { formatDate, formatPKR, formatQty, numberToWordsPKR } = require('../utils/format');

function localPublicPath(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const root = path.resolve(path.join(__dirname, '..', 'public'));
  const absolute = path.resolve(path.join(root, publicPath.replace(/^\/+/, '')));
  return absolute.startsWith(root + path.sep) && fs.existsSync(absolute) ? absolute : null;
}

function display(val, fallback = '—') {
  return val === null || val === undefined || val === '' ? fallback : String(val);
}

function checkPageSpace(doc, needed = 60) {
  if (doc.y + needed > 760) {
    doc.addPage();
    return true;
  }
  return false;
}

function addSectionHeader(doc, title, subtitle = '') {
  checkPageSpace(doc, 45);
  doc.moveDown(0.5);
  const y = doc.y;
  doc.rect(40, y, 515, 18).fill('#f1f5f9');
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f766e').text(title.toUpperCase(), 48, y + 4);
  if (subtitle) {
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(subtitle, 350, y + 4, { align: 'right', width: 195 });
  }
  doc.y = y + 23;
}

/**
 * Builds a high-resolution, print-ready PDF buffer for a quotation.
 *
 * @param {object} quotation
 * @param {object} settings Company settings
 * @returns {Promise<Buffer>}
 */
function buildQuotationPdf(quotation, settings = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
      info: {
        Title: `Quotation ${quotation.quotationNumber}`,
        Author: settings.companyName || 'Solar Management System',
        Subject: `Solar Proposal for ${quotation.customer ? quotation.customer.name : 'Client'}`,
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
      } catch (_err) {
        /* fallback to text */
      }
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

    // Title & Quotation Meta
    const metaY = doc.y;
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text('SOLAR SYSTEM QUOTATION', 40, metaY);
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text('Custom Engineering, Procurement & Installation Proposal', 40, metaY + 18);

    const fullRevNum = quotation.revision > 1
      ? `${quotation.quotationNumber} (Rev ${quotation.revision})`
      : quotation.quotationNumber;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text(fullRevNum, 360, metaY, { align: 'right', width: 195 });
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text(`Date: ${formatDate(quotation.quotationDate || quotation.createdAt)}`, 360, metaY + 14, { align: 'right', width: 195 });
    doc.text(`Valid Until: ${formatDate(quotation.validUntil)}`, 360, metaY + 25, { align: 'right', width: 195 });
    doc.text(`Status: ${QUOTATION_STATUS_LABELS[quotation.status] || quotation.status}`, 360, metaY + 36, { align: 'right', width: 195 });

    doc.y = metaY + 50;

    // 2. Client & System Overview Panels
    const customer = quotation.customer || {};
    const summary = quotation.systemSummary || {};

    const boxY = doc.y;
    const boxHeight = 75;

    // Customer Box (Left)
    doc.roundedRect(40, boxY, 252, boxHeight, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f766e').text('CLIENT INFORMATION', 48, boxY + 6);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(display(customer.name, 'Valued Client'), 48, boxY + 19);
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
    doc.text(`Contact: ${display(customer.phone)} ${customer.whatsapp ? '· WA: ' + customer.whatsapp : ''}`, 48, boxY + 31);
    doc.text(`Address: ${display([customer.address, customer.city].filter(Boolean).join(', '))}`, 48, boxY + 42, { width: 236, height: 18 });
    if (customer.disco || customer.electricityReferenceNo) {
      doc.text(`DISCO: ${display(customer.disco)} · Ref #: ${display(customer.electricityReferenceNo)}`, 48, boxY + 54);
    }

    // System Sizing Box (Right)
    doc.roundedRect(302, boxY, 253, boxHeight, 4).fillAndStroke('#f0fdf4', '#bbf7d0');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#166534').text('SYSTEM SPECIFICATIONS', 310, boxY + 6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#15803d')
      .text(`${formatQty(summary.capacityKw)} kW ${SYSTEM_TYPE_LABELS[summary.systemType] || summary.systemType || 'On-Grid'} System`, 310, boxY + 19);
    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    doc.text(`Solar Panels: ${summary.panelCount || 0} Units · Inverter: ${summary.inverterCapacityKw || summary.capacityKw} kW`, 310, boxY + 33);
    const est = summary.estimatedUnits || {};
    doc.text(`Est. Daily Output: ~${est.daily || 0} kWh (units) / day`, 310, boxY + 45);
    doc.text(`Est. Monthly Output: ~${formatQty(est.monthly || 0)} units · Yearly: ~${formatQty(est.yearly || 0)} units`, 310, boxY + 57);

    doc.y = boxY + boxHeight + 10;

    // 3. Bill of Materials (Item Table)
    addSectionHeader(doc, 'Equipment & Bill of Materials', 'Hardware Specifications');

    // Table Header
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 17).fill('#0f766e');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('#', 44, tableTop + 5, { width: 20 });
    doc.text('ITEM DESCRIPTION & SPECIFICATIONS', 68, tableTop + 5, { width: 230 });
    doc.text('WARRANTY', 302, tableTop + 5, { width: 60 });
    doc.text('QTY', 366, tableTop + 5, { width: 45, align: 'right' });
    doc.text('RATE (PKR)', 416, tableTop + 5, { width: 64, align: 'right' });
    doc.text('TOTAL (PKR)', 485, tableTop + 5, { width: 65, align: 'right' });

    doc.y = tableTop + 18;

    const items = quotation.items || [];
    items.forEach((line, idx) => {
      checkPageSpace(doc, 24);
      const rowY = doc.y;
      const snap = line.itemSnapshot || {};

      // Alternate row zebra
      if (idx % 2 === 1) {
        doc.rect(40, rowY - 1, 515, 20).fill('#f8fafc');
      }

      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(String(idx + 1), 44, rowY + 3, { width: 20 });

      // Title & Specs
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(snap.name || 'Component item', 68, rowY + 2, { width: 228 });
      const specText = [
        snap.brand ? `${snap.brand} ${snap.model || ''}`.trim() : '',
        snap.wattage ? `${snap.wattage}W` : '',
        snap.capacityKw ? `${snap.capacityKw}kW` : '',
        line.isOptionalExtra ? '[OPTIONAL EXTRA]' : '',
      ].filter(Boolean).join(' · ');

      if (specText) {
        doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(specText, 68, rowY + 11, { width: 228 });
      }

      const warranty = snap.warrantyYears ? `${snap.warrantyYears} Years` : 'Standard';
      doc.font('Helvetica').fontSize(7.5).fillColor('#334155').text(warranty, 302, rowY + 4, { width: 60 });

      const qtyText = `${formatQty(line.qty)} ${snap.unit || 'pcs'}`;
      doc.text(qtyText, 366, rowY + 4, { width: 45, align: 'right' });

      doc.text(formatPKR(line.unitSellingPricePaisa), 416, rowY + 4, { width: 64, align: 'right' });
      doc.font('Helvetica-Bold').text(formatPKR(line.totalSellingPricePaisa), 485, rowY + 4, { width: 65, align: 'right' });

      doc.y = rowY + 21;
    });

    // 4. Scope of Works & Logistics
    checkPageSpace(doc, 90);
    doc.moveDown(0.3);
    const servicesY = doc.y;
    doc.rect(40, servicesY, 515, 14).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#334155').text('INSTALLATION & SITE SERVICES', 48, servicesY + 3);
    doc.y = servicesY + 17;

    const services = [
      ['Civil, Mechanical & Electrical Structure Installation', quotation.laborCostPaisa],
      ['Freight, Transit Insurance & Safe Site Delivery', quotation.transportCostPaisa],
      ['DISCO Net-Metering Documentation & Approvals', quotation.netMeteringCostPaisa],
      ['Custom Engineering & Ancillary Electrical Works', quotation.additionalCostPaisa],
    ].filter((s) => s[1] > 0);

    services.forEach(([label, amount]) => {
      const sy = doc.y;
      doc.font('Helvetica').fontSize(7.5).fillColor('#334155').text(label, 68, sy, { width: 350 });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text(formatPKR(amount), 485, sy, { width: 65, align: 'right' });
      doc.y = sy + 13;
    });

    // 5. Total Investment Box & Amount in Words
    checkPageSpace(doc, 75);
    doc.moveDown(0.4);
    const sumY = doc.y;
    doc.roundedRect(40, sumY, 515, 52, 4).fillAndStroke('#f8fafc', '#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#475569').text('TOTAL COMMERCIAL INVESTMENT', 48, sumY + 8);
    const words = numberToWordsPKR(quotation.finalPricePaisa, true);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#0f766e').text(`In Words: ${words}`, 48, sumY + 22, { width: 330 });
    if (quotation.discountPaisa > 0) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#dc2626')
        .text(`(Includes special discount of ${formatPKR(quotation.discountPaisa)} [${quotation.discountPercent}%])`, 48, sumY + 34);
    }

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f766e').text(formatPKR(quotation.finalPricePaisa), 380, sumY + 12, { align: 'right', width: 165 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text('Net Payable in PKR', 380, sumY + 30, { align: 'right', width: 165 });

    doc.y = sumY + 60;

    // 6. Payment Plan Table
    const plan = quotation.paymentPlan || [];
    if (plan.length) {
      checkPageSpace(doc, 60);
      addSectionHeader(doc, 'Payment Plan & Milestone Schedule', PAYMENT_OPTION_LABELS[quotation.paymentOption] || 'Milestones');
      const py = doc.y;
      doc.rect(40, py, 515, 14).fill('#e2e8f0');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e293b');
      doc.text('MILESTONE / PAYMENT TRIGGER', 48, py + 3, { width: 280 });
      doc.text('PERCENTAGE', 340, py + 3, { width: 70, align: 'right' });
      doc.text('AMOUNT (PKR)', 430, py + 3, { width: 120, align: 'right' });
      doc.y = py + 16;

      plan.forEach((ms, idx) => {
        checkPageSpace(doc, 16);
        const my = doc.y;
        if (idx % 2 === 1) doc.rect(40, my - 1, 515, 15).fill('#f8fafc');
        doc.font('Helvetica').fontSize(7.5).fillColor('#334155').text(ms.label, 48, my + 2, { width: 280 });
        doc.text(`${ms.percent || 0}%`, 340, my + 2, { width: 70, align: 'right' });
        doc.font('Helvetica-Bold').text(formatPKR(ms.amountPaisa), 430, my + 2, { width: 120, align: 'right' });
        doc.y = my + 15;
      });
      doc.moveDown(0.3);
    }

    // 7. Terms & Warranty
    checkPageSpace(doc, 70);
    addSectionHeader(doc, 'Warranty & Project Terms');
    const termsY = doc.y;
    const termsLeftWidth = 250;
    const termsRightWidth = 250;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f766e').text('Warranty Coverage:', 40, termsY);
    const warrantyText = quotation.warrantyTerms ||
      '• Solar Panels: 12-Year Product Warranty & 25-Year Linear Power Warranty.\n' +
      '• Inverter: 5-Year Replacement Warranty.\n' +
      '• Workmanship: 1-Year Free Maintenance & System Support.';
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(warrantyText, 40, termsY + 12, { width: termsLeftWidth, lineGap: 1.5 });

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f766e').text('Terms & Conditions:', 305, termsY);
    const quoteTerms = quotation.terms || settings.quotationTerms ||
      '1. Quotation valid for 15 days from date of issuance.\n' +
      '2. Prices include standard delivery & installation as specified.\n' +
      '3. Civil mounting structure customized according to site survey.';
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(quoteTerms, 305, termsY + 12, { width: termsRightWidth, lineGap: 1.5 });

    doc.y = Math.max(doc.y, termsY + 60);

    // 8. Bank Account Details
    if (settings.bankName || settings.bankAccountNumber) {
      checkPageSpace(doc, 45);
      doc.moveDown(0.3);
      const by = doc.y;
      doc.roundedRect(40, by, 515, 36, 4).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f766e').text('OFFICIAL BANK PAYMENT DETAILS', 48, by + 5);
      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
      const bankInfo = [
        settings.bankAccountTitle ? `Title: ${settings.bankAccountTitle}` : '',
        settings.bankName ? `Bank: ${settings.bankName}` : '',
        settings.bankAccountNumber ? `A/C #: ${settings.bankAccountNumber}` : '',
        settings.bankIban ? `IBAN: ${settings.bankIban}` : '',
      ].filter(Boolean).join('  |  ');
      doc.text(bankInfo, 48, by + 18, { width: 495 });
      doc.y = by + 42;
    }

    // 9. Optional Urdu Section / Bilingual Note
    if (quotation.includeUrdu || quotation.urduNotes) {
      checkPageSpace(doc, 45);
      doc.moveDown(0.2);
      const uy = doc.y;
      doc.roundedRect(40, uy, 515, 32, 4).fillAndStroke('#fffbeb', '#fef3c7');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#92400e').text('Bilingual Summary / اہم ہدایات', 48, uy + 5);
      const urduText = quotation.urduNotes ||
        'وارنٹی کلیمز مینوفیکچرر کی شرائط کے مطابق ہونگے۔ انسٹالیشن کے دوران خریدار کی تصدیق لازمی ہوگی۔';
      doc.font('Helvetica').fontSize(7.5).fillColor('#78350f').text(urduText, 48, uy + 17, { width: 495 });
      doc.y = uy + 38;
    }

    // 10. Signature & Stamp Area
    checkPageSpace(doc, 75);
    doc.moveDown(0.5);
    const signY = doc.y + 20;

    // Left: Customer Acceptance
    doc.moveTo(40, signY).lineTo(230, signY).lineWidth(0.75).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text('Customer Acceptance Signature', 40, signY + 5, { width: 190, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Name & CNIC / Date', 40, signY + 15, { width: 190, align: 'center' });

    // Right: Company Signatory & Stamp
    doc.moveTo(365, signY).lineTo(555, signY).lineWidth(0.75).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(settings.companyName || 'Authorized Signatory', 365, signY + 5, { width: 190, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Authorized Signatory & Stamp', 365, signY + 15, { width: 190, align: 'center' });

    // 11. Footer on all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8')
        .text(
          `${fullRevNum} | Generated by ${settings.companyName || 'Solar Agency'} | Page ${i + 1} of ${range.count}`,
          40,
          805,
          { width: 515, align: 'center', lineBreak: false }
        );
    }

    doc.end();
  });
}

module.exports = { buildQuotationPdf };
