'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { SURVEY_STATUS_LABELS, ROOF_TYPE_LABELS, SYSTEM_TYPE_LABELS, SURVEY_PHOTO_LABELS } = require('../config/surveys');
const { formatDateTime, formatPKR } = require('../utils/format');

function display(value, suffix = '') {
  return value === null || value === undefined || value === '' ? '-' : `${value}${suffix}`;
}

function localPublicPath(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const root = path.resolve(path.join(__dirname, '..', 'public'));
  const absolute = path.resolve(path.join(root, publicPath.replace(/^\/+/, '')));
  return absolute.startsWith(root + path.sep) && fs.existsSync(absolute) ? absolute : null;
}

function addHeading(doc, text) {
  if (doc.y > 690) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f766e').text(text, 50, doc.y, { width: 495 });
  doc.moveDown(0.25).strokeColor('#99f6e4').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.45).fillColor('#111827').font('Helvetica').fontSize(9);
}

function addRows(doc, rows) {
  for (const [label, value] of rows) {
    if (doc.y > 745) doc.addPage();
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor('#4b5563').text(label, 50, y, { width: 150 });
    doc.font('Helvetica').fillColor('#111827').text(display(value), 205, y, { width: 340 });
    doc.y = Math.max(doc.y, y + 16);
  }
}

function buildSurveyPdf(survey, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 45, right: 50, bottom: 48, left: 50 }, info: { Title: `Site Survey ${survey.number}`, Author: settings.companyName || 'Solar company' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const logo = localPublicPath(settings.logoPath);
    if (logo && /\.(png|jpe?g)$/i.test(logo)) {
      try { doc.image(logo, 50, 38, { fit: [90, 52] }); } catch (_err) { /* keep text letterhead */ }
    }
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#0f766e').text(settings.companyName || 'SolarPro', 155, 42, { align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('#4b5563').text([settings.address, settings.city, settings.phone, settings.email].filter(Boolean).join(' | '), 155, 65, { align: 'right' });
    doc.moveTo(50, 96).lineTo(545, 96).lineWidth(1.5).strokeColor('#0f766e').stroke();
    doc.y = 112;

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text('SITE SURVEY REPORT');
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`${survey.number} | ${formatDateTime(survey.scheduledAt)} | ${SURVEY_STATUS_LABELS[survey.status] || survey.status}`);

    const contact = survey.customer || {};
    addHeading(doc, 'Customer and visit');
    addRows(doc, [
      ['Customer', contact.name || contact.contactName],
      ['Customer code', contact.code],
      ['Phone', contact.phone],
      ['Address', [contact.address, contact.area, contact.city].filter(Boolean).join(', ')],
      ['Surveyor', survey.surveyor && survey.surveyor.name],
    ]);

    addHeading(doc, 'Roof and installation conditions');
    addRows(doc, [
      ['Roof type', ROOF_TYPE_LABELS[survey.roofType] || survey.roofType],
      ['Usable roof area', display(survey.roofAreaSqFt, ' sq ft')],
      ['Direction / tilt', `${display(survey.direction)} / ${display(survey.tiltDegrees, ' deg')}`],
      ['Shading', survey.shading],
      ['Structure', survey.structureType],
      ['Floor height', display(survey.floorHeight, ' ft')],
      ['Cable distance', display(survey.cableDistanceMeters, ' m')],
    ]);

    addHeading(doc, 'Electricity profile');
    addRows(doc, [
      ['Sanctioned load', display(survey.sanctionedLoadKw, ' kW')],
      ['Phase / meter', `${display(survey.phase)} / ${display(survey.meterType)}`],
    ]);
    const usage = survey.monthlyUsage || [];
    if (usage.length) {
      const startY = doc.y;
      const colWidth = 82.5;
      usage.forEach((row, index) => {
        const col = index % 6;
        const line = Math.floor(index / 6);
        const x = 50 + col * colWidth;
        const y = startY + line * 35;
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280').text(row.month, x, y, { width: colWidth - 4 });
        doc.font('Helvetica').fontSize(8).fillColor('#111827').text(`${row.units || 0} units`, x, y + 11, { width: colWidth - 4 });
      });
      doc.y = startY + 75;
    }

    addHeading(doc, 'Recommendation');
    const boxY = doc.y;
    doc.roundedRect(50, boxY, 495, 62, 6).fillAndStroke('#ecfdf5', '#a7f3d0');
    const recY = boxY + 13;
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#047857').text(`${display(survey.recommendedKw, ' kW')} ${SYSTEM_TYPE_LABELS[survey.systemType] || survey.systemType || 'system'}`, 65, recY);
    doc.font('Helvetica').fontSize(8).fillColor('#374151').text(survey.recommendationBasis || 'Recommendation based on site conditions and electricity usage.', 65, recY + 25, { width: 455 });
    doc.y = boxY + 72;
    if (survey.remarks) doc.font('Helvetica').fontSize(9).fillColor('#111827').text(`Remarks: ${survey.remarks}`);

    const printablePhotos = (survey.photos || []).map((photo) => ({ ...photo, absolute: localPublicPath(photo.path) })).filter((photo) => photo.absolute && /\.(png|jpe?g)$/i.test(photo.absolute));
    if (printablePhotos.length) {
      addHeading(doc, 'Site photographs');
      for (let index = 0; index < printablePhotos.length; index += 2) {
        if (doc.y > 610) doc.addPage();
        const y = doc.y;
        for (let column = 0; column < 2; column += 1) {
          const photo = printablePhotos[index + column];
          if (!photo) continue;
          const x = column === 0 ? 50 : 302;
          try {
            doc.image(photo.absolute, x, y, { fit: [235, 135], align: 'center', valign: 'center' });
            doc.font('Helvetica').fontSize(8).fillColor('#4b5563').text(SURVEY_PHOTO_LABELS[photo.type] || photo.type, x, y + 139, { width: 235, align: 'center' });
          } catch (_err) { /* skip corrupt images */ }
        }
        doc.y = y + 165;
      }
    }

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(index);
      doc.font('Helvetica').fontSize(7).fillColor('#9ca3af').text(`Generated by ${settings.companyName || 'SolarPro'} | Page ${index + 1} of ${range.count}`, 50, 780, { width: 495, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { buildSurveyPdf };
