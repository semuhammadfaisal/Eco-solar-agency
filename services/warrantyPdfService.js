'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { formatDate } = require('../utils/format');
const { WARRANTY_TYPE_LABELS } = require('../config/installations');

function localPublicPath(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const root = path.resolve(path.join(__dirname, '..', 'public'));
  const absolute = path.resolve(path.join(root, publicPath.replace(/^\/+/, '')));
  return absolute.startsWith(root + path.sep) && fs.existsSync(absolute) ? absolute : null;
}

/**
 * Builds an official Warranty Certificate PDF.
 */
function buildWarrantyCertificatePdf(warranty, settings = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
      info: {
        Title: `Warranty Certificate - ${warranty.warrantyNumber}`,
        Author: settings.companyName || 'Solar Agency',
        Subject: `Solar Equipment Warranty Certificate for ${warranty.customer ? warranty.customer.name : 'Customer'}`,
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Decorative border frame
    doc.rect(25, 25, 545, 792).strokeColor('#0f172a').lineWidth(2).stroke();
    doc.rect(29, 29, 537, 784).strokeColor('#e2e8f0').lineWidth(1).stroke();

    const logo = localPublicPath(settings.logoPath);
    if (logo && /\.(png|jpe?g)$/i.test(logo)) {
      try {
        doc.image(logo, 45, 45, { fit: [110, 50] });
      } catch (_e) {}
    }

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#0f172a')
      .text(settings.companyName || 'Solar Business Management', 160, 48, { align: 'right' });

    doc
      .fontSize(8.5)
      .font('Helvetica')
      .fillColor('#475569')
      .text(
        [settings.phone, settings.email, settings.city || 'Pakistan'].filter(Boolean).join('  |  '),
        160,
        70,
        { align: 'right' }
      );

    doc.moveTo(45, 105).lineTo(550, 105).strokeColor('#0f172a').lineWidth(1.5).stroke();

    // Certificate Title Ribbon
    let y = 120;
    doc.rect(45, y, 505, 36).fillColor('#0f172a').fill();
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('OFFICIAL WARRANTY CERTIFICATE', 45, y + 10, {
        align: 'center',
        width: 505,
      });

    // Certificate Number
    y += 50;
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#0f172a')
      .text(`CERTIFICATE NUMBER: ${warranty.warrantyNumber}`, 45, y, { align: 'center', width: 505 });

    // Client & Coverage Grid
    y += 28;
    doc.rect(45, y, 505, 110).fillColor('#f8fafc').strokeColor('#cbd5e1').lineWidth(0.75).fillAndStroke();

    const cust = warranty.customer || {};
    const item = warranty.item || {};

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9);
    doc.text('Beneficiary / Customer:', 58, y + 12);
    doc.text('Contact Phone:', 58, y + 32);
    doc.text('Customer CNIC:', 58, y + 52);
    doc.text('Site Address:', 58, y + 72);
    doc.text('Installation Ref:', 58, y + 92);

    doc.font('Helvetica').fillColor('#334155');
    doc.text(cust.name || 'Valued Client', 180, y + 12);
    doc.text(cust.phone || '—', 180, y + 32);
    doc.text(cust.cnic || '—', 180, y + 52);
    doc.text([cust.address, cust.city].filter(Boolean).join(', ') || 'N/A', 180, y + 72, { width: 340 });
    doc.text(warranty.installation ? warranty.installation.installationNumber || 'INS-Project' : 'Direct Supply', 180, y + 92);

    // Equipment & Warranty Period Details
    y += 126;
    doc.rect(45, y, 505, 115).fillColor('#ffffff').strokeColor('#0f172a').lineWidth(1).fillAndStroke();

    const typeLabel = WARRANTY_TYPE_LABELS[warranty.warrantyType] || warranty.warrantyType;

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.5);
    doc.text('COVERAGE DETAILS & SPECIFICATIONS', 58, y + 10);
    doc.moveTo(58, y + 24).lineTo(535, y + 24).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
    doc.text('Warranty Classification:', 58, y + 32);
    doc.text('Covered Item / Model:', 58, y + 50);
    doc.text('Registered Serial #:', 58, y + 68);
    doc.text('Effective Warranty Period:', 58, y + 86);

    doc.font('Helvetica').fillColor('#334155');
    doc.text(typeLabel, 200, y + 32);
    doc.text(`${item.name || 'Solar Equipment'} (${item.sku || 'N/A'})`, 200, y + 50);
    doc.font('Helvetica-Bold').fillColor('#0f172a').text(warranty.serialString || 'System Standard Bundle', 200, y + 68);
    doc.font('Helvetica').fillColor('#047857').text(
      `${formatDate(warranty.startDate)} to ${formatDate(warranty.endDate)} (${warranty.years} Years Duration)`,
      200,
      y + 86
    );

    // Terms & Conditions
    y += 130;
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text('WARRANTY TERMS & CONDITIONS', 45, y);
    y += 14;

    const termsText =
      warranty.terms ||
      `1. This warranty covers manufacturing defects, hardware component failures, and degradation exceeding manufacturer tolerances under standard operating conditions.\n` +
      `2. Workmanship warranty covers wiring integrity, mounting structure rigidity, and earthing connection reliability for the specified term.\n` +
      `3. Exclusions: Damage caused by grid surges, lightning strikes without SPD, unauthorized tampering/servicing, or physical external impacts.\n` +
      `4. To lodge a claim, contact our 24/7 helpline with this certificate number (${warranty.warrantyNumber}) or your customer code (${cust.code || 'CUS'}).`;

    doc.rect(45, y, 505, 80).fillColor('#f8fafc').strokeColor('#cbd5e1').lineWidth(0.5).fillAndStroke();
    doc.fontSize(7.8).font('Helvetica').fillColor('#475569').text(termsText, 55, y + 8, {
      width: 485,
      lineGap: 3,
    });

    // Authorised Seal & Signature
    y += 105;
    doc.rect(45, y, 240, 75).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text('AUTHORIZED SIGNATORY', 55, y + 8);
    doc.fontSize(8).font('Helvetica').fillColor('#475569').text('For and on behalf of:', 55, y + 22);
    doc.text(settings.companyName || 'Solar Agency Management', 55, y + 34);
    doc.text('Authorized Signature & Stamp: ________________', 55, y + 56);

    doc.rect(310, y, 240, 75).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text('CUSTOMER ACKNOWLEDGEMENT', 320, y + 8);
    doc.fontSize(8).font('Helvetica').fillColor('#475569').text(`Name: ${cust.name || 'Client'}`, 320, y + 22);
    doc.text(`CNIC: ${cust.cnic || 'Verified'}`, 320, y + 34);
    doc.text('Signature: ________________________________', 320, y + 56);

    doc.end();
  });
}

module.exports = { buildWarrantyCertificatePdf };
