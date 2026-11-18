'use strict';

const nodemailer = require('nodemailer');
const config = require('../config/app');

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user) {
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  } else {
    // Development fallback: JSON/stream transport so calls succeed and can be tested
    cachedTransporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return cachedTransporter;
}

/**
 * Sends a solar quotation PDF via email to the client.
 *
 * @param {object} params
 * @param {object} params.quotation
 * @param {string} params.recipientEmail
 * @param {string} [params.subject]
 * @param {string} [params.message]
 * @param {Buffer} params.pdfBuffer
 * @param {object} [params.settings]
 * @returns {Promise<object>}
 */
async function sendQuotationEmail({
  quotation,
  recipientEmail,
  subject,
  message,
  pdfBuffer,
  settings = {},
}) {
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    throw new Error('Enter a valid recipient email address.');
  }

  const transporter = getTransporter();
  const companyName = settings.companyName || config.appName;
  const fromAddress = process.env.SMTP_FROM || settings.email || 'no-reply@solaragency.pk';

  const revSuffix = quotation.revision > 1 ? ` (Rev ${quotation.revision})` : '';
  const emailSubject =
    subject || `Solar Proposal: ${quotation.quotationNumber}${revSuffix} — ${companyName}`;

  const defaultBody = `
Dear Valued Customer,

Please find attached the official solar system proposal (${quotation.quotationNumber}${revSuffix}) from ${companyName}.

System Overview:
- Rated Capacity: ${quotation.systemSummary ? quotation.systemSummary.capacityKw : '—'} kW
- Final Proposed Amount: PKR ${((quotation.finalPricePaisa || 0) / 100).toLocaleString('en-PK')}
- Quotation Validity: ${quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString('en-GB') : '15 days'}

Please review the attached PDF document containing detailed technical specifications, equipment Bill of Materials (BOM), warranty coverage, and payment terms.

Should you have any questions or require revisions, feel free to contact us.

Warm regards,
${companyName}
Phone: ${settings.phone || 'Our Sales Team'}
Email: ${settings.email || fromAddress}
`.trim();

  const emailBody = message && message.trim() ? message.trim() : defaultBody;

  const mailOptions = {
    from: `"${companyName}" <${fromAddress}>`,
    to: recipientEmail,
    subject: emailSubject,
    text: emailBody,
    attachments: [
      {
        filename: `${quotation.quotationNumber}${revSuffix.replace(/[() ]/g, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    messageId: info.messageId,
    simulated: Boolean(transporter.options && transporter.options.jsonTransport),
  };
}

module.exports = { sendQuotationEmail, getTransporter };
