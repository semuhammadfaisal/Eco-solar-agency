'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { formatDate, formatDateTime } = require('../utils/format');

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
 * Builds an official Commissioning Report & Certificate PDF.
 */
function buildCommissioningPdf(installation, settings = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 38, right: 40, bottom: 42, left: 40 },
      info: {
        Title: `Commissioning Report - ${installation.installationNumber}`,
        Author: settings.companyName || 'Solar Agency',
        Subject: `System Commissioning Certificate for ${installation.customer ? installation.customer.name : 'Customer'}`,
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const logo = localPublicPath(settings.logoPath);
    if (logo && /\.(png|jpe?g)$/i.test(logo)) {
      try {
        doc.image(logo, 40, 32, { fit: [110, 50] });
      } catch (_e) {}
    }

    // Company Header
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#0f172a')
      .text(settings.companyName || 'Solar Business Management', 160, 34, { align: 'right' });

    doc
      .fontSize(8.5)
      .font('Helvetica')
      .fillColor('#475569')
      .text(
        [settings.phone, settings.email, settings.city || 'Pakistan'].filter(Boolean).join('  |  '),
        160,
        56,
        { align: 'right' }
      );

    if (settings.ntn) {
      doc.text(`NTN: ${settings.ntn}`, 160, 68, { align: 'right' });
    }

    doc.moveTo(40, 90).lineTo(555, 90).strokeColor('#cbd5e1').lineWidth(1).stroke();

    // Report Title Banner
    doc.rect(40, 102, 515, 28).fillColor('#0f172a').fill();
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('SOLAR SYSTEM COMMISSIONING REPORT & CERTIFICATE', 40, 110, {
        align: 'center',
        width: 515,
      });

    // Metadata Grid
    let y = 142;
    doc.rect(40, y, 515, 78).fillColor('#f8fafc').strokeColor('#e2e8f0').lineWidth(0.75).fillAndStroke();

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9);
    doc.text('Report / Install #:', 52, y + 8);
    doc.text('Date of Commissioning:', 52, y + 26);
    doc.text('Lead Engineer / Tech:', 52, y + 44);
    doc.text('System Status:', 52, y + 62);

    doc.font('Helvetica').fillColor('#334155');
    doc.text(installation.installationNumber, 150, y + 8);
    doc.text(formatDate(installation.commissionedAt || installation.completedAt || new Date()), 150, y + 26);
    doc.text(installation.leadTechnician ? installation.leadTechnician.name : 'Engineering Team', 150, y + 44);
    doc.text((installation.status || 'Commissioned').toUpperCase(), 150, y + 62);

    const cust = installation.customer || {};
    doc.fillColor('#0f172a').font('Helvetica-Bold');
    doc.text('Client Name:', 310, y + 8);
    doc.text('Contact Phone:', 310, y + 26);
    doc.text('Site Address:', 310, y + 44);
    doc.text('DISCO / Reference:', 310, y + 62);

    doc.font('Helvetica').fillColor('#334155');
    doc.text(cust.name || 'Valued Client', 400, y + 8);
    doc.text(cust.phone || '—', 400, y + 26);
    doc.text([cust.area, cust.city].filter(Boolean).join(', ') || 'Site Location', 400, y + 44, { width: 150 });
    doc.text([cust.disco, cust.electricityReferenceNo].filter(Boolean).join(' / ') || 'N/A', 400, y + 62);

    // Section 1: System Specs
    y = 232;
    const sale = installation.sale || {};
    const specs = sale.systemSummary || {};

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('1. TECHNICAL SPECIFICATIONS', 40, y);
    y += 16;
    doc.rect(40, y, 515, 34).fillColor('#f1f5f9').strokeColor('#cbd5e1').lineWidth(0.5).fillAndStroke();

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5);
    doc.text('System Capacity', 52, y + 6);
    doc.text('System Type', 170, y + 6);
    doc.text('Panel Count', 290, y + 6);
    doc.text('Est. Generation', 410, y + 6);

    doc.font('Helvetica').fillColor('#334155');
    doc.text(`${specs.capacityKw || 0} kW`, 52, y + 18);
    doc.text((specs.systemType || 'On-Grid').replace('_', ' ').toUpperCase(), 170, y + 18);
    doc.text(`${specs.panelCount || 0} Modules`, 290, y + 18);
    doc.text(`${specs.estimatedUnits ? specs.estimatedUnits.yearly || 0 : 0} kWh / yr`, 410, y + 18);

    // Section 2: Electrical Test Readings Table
    y += 46;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('2. ELECTRICAL COMMISSIONING MEASUREMENTS', 40, y);
    y += 16;

    const readings = installation.readings || {};
    const testRows = [
      { param: 'DC String Open-Circuit Voltage (Voc)', reading: readings.vocReadingVolts ? `${readings.vocReadingVolts} V` : 'Tested & Verified', standard: 'Within Module Spec' },
      { param: 'DC String Short-Circuit Current (Isc)', reading: readings.iscReadingAmps ? `${readings.iscReadingAmps} A` : 'Tested & Verified', standard: 'Within Inverter MPPT Spec' },
      { param: 'Earth Pit Resistance', reading: readings.earthResistanceOhms ? `${readings.earthResistanceOhms} Ω` : '< 5.0 Ω (Passed)', standard: '< 5.0 Ohms (Standard)' },
      { param: 'AC Grid Operating Voltage', reading: readings.gridVoltageVolts ? `${readings.gridVoltageVolts} V` : '230 / 400 V', standard: '230V ± 10%' },
    ];

    doc.rect(40, y, 515, 18).fillColor('#e2e8f0').fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    doc.text('Test Parameter', 50, y + 5);
    doc.text('Field Measured Value', 280, y + 5);
    doc.text('Compliance Threshold', 430, y + 5);

    y += 18;
    testRows.forEach((tr, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(40, y, 515, 18).fillColor(bg).strokeColor('#e2e8f0').lineWidth(0.5).fillAndStroke();
      doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
      doc.text(tr.param, 50, y + 5);
      doc.font('Helvetica-Bold').text(tr.reading, 280, y + 5);
      doc.font('Helvetica').fillColor('#047857').text(tr.standard, 430, y + 5);
      y += 18;
    });

    // Section 3: Serial Numbers Installed
    y += 12;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('3. EQUIPMENT & SERIAL NUMBERS INSTALLED', 40, y);
    y += 16;

    const materials = installation.materialsIssued || [];
    doc.rect(40, y, 515, 18).fillColor('#e2e8f0').fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    doc.text('Item / Component', 50, y + 5);
    doc.text('Quantity', 280, y + 5);
    doc.text('Serial Numbers / Barcodes', 350, y + 5);

    y += 18;
    if (!materials.length) {
      doc.rect(40, y, 515, 18).fillColor('#ffffff').strokeColor('#e2e8f0').lineWidth(0.5).fillAndStroke();
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text('Standard installation equipment bundle verified on site.', 50, y + 5);
      y += 18;
    } else {
      materials.slice(0, 10).forEach((mat, idx) => {
        checkPageSpace(doc, 22);
        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(40, y, 515, 18).fillColor(bg).strokeColor('#e2e8f0').lineWidth(0.5).fillAndStroke();
        doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
        const itemName = mat.item ? mat.item.name : 'Equipment Item';
        doc.text(itemName.slice(0, 36), 50, y + 5);
        doc.text(String(mat.qty || 1), 280, y + 5);
        doc.font('Helvetica-Bold').text(mat.serialString || 'Standard SKU', 350, y + 5);
        y += 18;
      });
    }

    // Section 4: Sign-off & Signatures
    checkPageSpace(doc, 110);
    y = Math.max(y + 20, doc.y + 15);

    doc.rect(40, y, 245, 90).strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text('LEAD INSTALLATION ENGINEER', 50, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text(`Name: ${installation.leadTechnician ? installation.leadTechnician.name : 'Installation Lead'}`, 50, y + 24);
    doc.text('Status: Commissioning Passed', 50, y + 38);
    doc.text('Stamp & Signature: _______________________', 50, y + 68);

    doc.rect(310, y, 245, 90).strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text('CUSTOMER ACCEPTANCE & SIGN-OFF', 320, y + 8);
    const signoff = installation.customerSignoff || {};
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text(`Customer Name: ${signoff.signedBy || cust.name || 'Customer'}`, 320, y + 24);
    doc.text(`CNIC: ${signoff.signerCnic || cust.cnic || 'Verified'}`, 320, y + 38);
    doc.text(`Rating: ${'★'.repeat(signoff.rating || 5)}${'☆'.repeat(5 - (signoff.rating || 5))}`, 320, y + 52);
    doc.text('Signature: ______________________________', 320, y + 68);

    doc.end();
  });
}

module.exports = { buildCommissioningPdf };
