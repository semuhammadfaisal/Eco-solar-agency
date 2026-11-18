'use strict';

const NotificationLog = require('../models/NotificationLog');
const MessageTemplate = require('../models/MessageTemplate');
const { getSettings } = require('./settingsService');
const { sendMail } = require('./emailService');
const ApiError = require('../utils/ApiError');

/**
 * Replace placeholders {{var}} with actual values.
 */
function interpolate(templateString = '', variables = {}) {
  if (!templateString) return '';
  return templateString.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => {
    return variables[key] !== undefined && variables[key] !== null ? String(variables[key]) : '';
  });
}

/**
 * Format phone to international Pakistani format (03001234567 -> 923001234567).
 */
function normalizePakistaniPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  if (digits.startsWith('92')) return digits;
  return digits;
}

/**
 * Default Seed Templates for automatic reminder triggers.
 */
const DEFAULT_TEMPLATES = [
  {
    slug: 'reminder_upcoming_3d',
    title: 'Upcoming Due Reminder (3 Days Before)',
    category: 'installment_reminder',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'Muhtaram {{name}} sb, aapki solar installment plan {{planNumber}} ki qist PKR {{amount}} 3 din baad {{dueDate}} ko due hai. Baraye meherbani barwaqt adaigi ya bank transfer yakeeni banayein. Shukriya, {{companyName}}.',
    urduBody:
      'محترم {{name}} صاحب، آپ کی سولر قسط برائے {{planNumber}} رقم {{amount}} روپے 3 دن بعد {{dueDate}} کو واجب الادا ہے۔ برائے مہربانی بروقت ادائیگی یقینی بنائیں۔ شکریہ، {{companyName}}۔',
    englishBody:
      'Dear {{name}}, your solar installment of PKR {{amount}} for plan {{planNumber}} is due in 3 days on {{dueDate}}. Please ensure timely payment. Regards, {{companyName}}.',
    emailSubject: 'Upcoming Solar Installment Reminder - Due in 3 Days',
  },
  {
    slug: 'reminder_due_today',
    title: 'Installment Due Today',
    category: 'installment_reminder',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'Assalam-o-Alaikum {{name}} sb, aaj aapki solar installment PKR {{amount}} ki due date hai. Kisi bhi takheer aur late fee se bachne ke liye aaj hi adaigi karein. Shukriya, {{companyName}}.',
    urduBody:
      'السلام علیکم {{name}} صاحب، آج آپ کی سولر قسط کی رقم {{amount}} روپے کی آخری تاریخ ہے۔ لیٹ فیس سے بچنے کے لیے براہِ کرم آج ہی ادائیگی کریں۔ شکریہ، {{companyName}}۔',
    englishBody:
      'Dear {{name}}, your solar installment payment of PKR {{amount}} is due today ({{dueDate}}). Kindly settle the payment to avoid late charges. Regards, {{companyName}}.',
    emailSubject: 'Solar Installment Due Today - Timely Payment Notice',
  },
  {
    slug: 'reminder_overdue_1d',
    title: 'Overdue Notice (1 Day Past Due)',
    category: 'installment_reminder',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'Muhtaram {{name}} sb, aapki installment PKR {{amount}} kal {{dueDate}} ko due thi jo abhi tak masool nahi hui. Baraye meherbani foran rabta farmayein ya online adaigi karein. {{companyName}}.',
    urduBody:
      'محترم {{name}} صاحب، آپ کی سولر قسط رقم {{amount}} روپے کل واجب الادا تھی جو ابھی تک وصول نہیں ہوئی۔ برائے مہربانی فوری رابطہ یا ادائیگی فرمائیں۔ {{companyName}}۔',
    englishBody:
      'Dear {{name}}, your solar installment of PKR {{amount}} was due yesterday ({{dueDate}}) and remains unpaid. Please clear the pending tranche promptly. {{companyName}}.',
    emailSubject: 'Immediate Action Required: Solar Installment Overdue',
  },
  {
    slug: 'reminder_overdue_3d',
    title: 'Overdue Notice (3 Days Past Due)',
    category: 'installment_reminder',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'Zaroori Ittila: {{name}} sb, aapki installment PKR {{amount}} 3 din se overdue hai. Grace period khatam honay par late fee laagu ho sakti hai. Foran raqam ada karein. {{companyName}}.',
    urduBody:
      'ضروری اطلاع: {{name}} صاحب، آپ کی قسط 3 دن سے واجب الادا ہے۔ رعایتی مدت ختم ہونے پر جرمانہ لاگو ہو سکتا ہے۔ برائے مہربانی فوری ادائیگی کریں۔ {{companyName}}۔',
    englishBody:
      'Urgent Notice: Dear {{name}}, your installment of PKR {{amount}} is now 3 days overdue. Please settle immediately to prevent late penalty assessment. {{companyName}}.',
    emailSubject: 'Urgent Overdue Notice: Solar Installment',
  },
  {
    slug: 'reminder_overdue_7d',
    title: 'Overdue Notice (7 Days Past Due)',
    category: 'installment_reminder',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'Aakhri Ittila: {{name}} sb, aapka solar account 7 din se delinquent hai (Due: PKR {{amount}}). Hamari recovery team aap se rabta karegi. Legal ya cheque clearance proceedings se bachne ke liye aaj adaigi karein.',
    urduBody:
      'آخری اطلاع: {{name}} صاحب، آپ کا سولر اکاؤنٹ 7 دن سے تاخیر کا شکار ہے (واجب الادا: {{amount}} روپے)۔ قانونی کارروائی اور ریکوری سے بچنے کے لیے فوری ادائیگی یقینی بنائیں۔',
    englishBody:
      'Final Notice: Dear {{name}}, your installment of PKR {{amount}} is now 7 days delinquent. Our collection officer will contact you. Please pay today to avoid legal recovery proceedings.',
    emailSubject: 'Final Overdue Warning: Solar Financing Account',
  },
  {
    slug: 'reminder_overdue_15d',
    title: 'Escalation Notice (15 Days Past Due)',
    category: 'recovery_escalation',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'LEGAL WARNING: {{name}} sb, aapki 15 din se zayed ki adum-adaigi par case legal aur guarantor recovery section ko bhej diya gaya hai. Foran office visit karein ya management se rabta karein.',
    urduBody:
      'قانونی انتباہ: {{name}} صاحب، 15 دن سے زائد عدم ادائیگی پر آپ کا کیس لیگل اور ضامن ریکوری شعبے کو بھیج دیا گیا ہے۔ فوری دفتر تشریف لائیں یا انتظامیہ سے رابطہ کریں۔',
    englishBody:
      'LEGAL & RECOVERY ESCALATION: Dear {{name}}, due to non-payment exceeding 15 days, your account has been escalated to legal recovery and guarantor enforcement. Contact management immediately.',
    emailSubject: 'LEGAL ESCALATION: Delinquent Solar Financing Account',
  },
  {
    slug: 'ptp_broken',
    title: 'Broken Promise-to-Pay Alert',
    category: 'recovery_escalation',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'Muhtaram {{name}} sb, aapki taraf se ki gayi payment ki tareekh {{dueDate}} guzar chuki hai magar PKR {{amount}} ki adaigi nahi hui. Baraye meherbani foran recovery officer se rabta karein.',
    urduBody:
      'محترم {{name}} صاحب، آپ کی طرف سے دی گئی وعدہ ادائیگی کی تاریخ گزر چکی ہے لیکن رقم {{amount}} روپے موصول نہیں ہوئی۔ فوری رابطہ فرمائیں۔',
    englishBody:
      'Dear {{name}}, the promised payment date ({{dueDate}}) for PKR {{amount}} has passed without receipt. Please contact our recovery desk immediately.',
    emailSubject: 'Broken Promise-to-Pay: Immediate Contact Required',
  },
  {
    slug: 'cheque_due',
    title: 'Post-Dated Cheque Maturity Alert',
    category: 'cheque_alert',
    channel: 'all',
    preferredLanguage: 'roman_urdu',
    romanUrduBody:
      'Muhtaram {{name}} sb, aapka cheque #{{reference}} baraye PKR {{amount}} {{dueDate}} ko bank mein clearance ke liye jama karwaya ja raha hai. Baraye meherbani account balance maintain rakhein.',
    urduBody:
      'محترم {{name}} صاحب، آپ کا چیک برائے {{amount}} روپے تاریخ {{dueDate}} کو بینک میں جمع کروایا جا رہا ہے۔ اپنے اکاؤنٹ میں مطلوبہ رقم کی موجودگی یقینی بنائیں۔',
    englishBody:
      'Dear {{name}}, your security cheque #{{reference}} of PKR {{amount}} is scheduled for banking deposit on {{dueDate}}. Kindly ensure sufficient account funds.',
    emailSubject: 'Notice of Scheduled Cheque Deposit',
  },
];

/**
 * Seed default templates if they do not exist.
 */
async function seedDefaultTemplates() {
  for (const tpl of DEFAULT_TEMPLATES) {
    const existing = await MessageTemplate.findOne({ slug: tpl.slug });
    if (!existing) {
      await MessageTemplate.create(tpl);
    }
  }
}

/**
 * Dispatch notification through the configured channel or Dry-Run.
 */
async function dispatchNotification({
  channel = 'whatsapp',
  toPhone = '',
  toEmail = '',
  stage = 'custom',
  installment = null,
  installmentPlan = null,
  cheque = null,
  customer = null,
  templateSlug = '',
  variables = {},
  customBody = '',
  customSubject = '',
  language = 'roman_urdu',
  isRetry = false,
}) {
  const settings = await getSettings();
  const companyName = settings.companyName || 'Solar Agency';

  // Build idempotency key if installment and stage are provided
  const instId = installment ? (installment._id || installment) : null;
  const idempotencyKey = instId && stage ? `${instId}_${stage}_${channel}` : null;

  // Idempotency check: if already sent or delivered, return existing
  if (idempotencyKey && !isRetry) {
    const existing = await NotificationLog.findOne({
      idempotencyKey,
      status: { $in: ['sent', 'delivered', 'dry_run'] },
    });
    if (existing) {
      return { skipped: true, reason: `Reminder stage '${stage}' already sent for this installment.`, log: existing };
    }
  }

  // Determine message content
  let body = customBody;
  let subject = customSubject || `Solar Notification - ${companyName}`;

  if (!body && templateSlug) {
    const tpl = await MessageTemplate.findOne({ slug: templateSlug, isActive: true });
    if (tpl) {
      const lang = language || tpl.preferredLanguage || 'roman_urdu';
      let rawText = tpl.romanUrduBody;
      if (lang === 'urdu' && tpl.urduBody) rawText = tpl.urduBody;
      else if (lang === 'english' && tpl.englishBody) rawText = tpl.englishBody;

      const mergedVars = {
        companyName,
        name: customer ? customer.name : 'Valued Client',
        ...variables,
      };

      body = interpolate(rawText, mergedVars);
      if (tpl.emailSubject) {
        subject = interpolate(tpl.emailSubject, mergedVars);
      }
    }
  }

  if (!body) {
    body = `Notice from ${companyName}: Please contact us regarding your solar system account.`;
  }

  const phone = normalizePakistaniPhone(toPhone || (customer && (customer.whatsapp || customer.phone)));
  const email = toEmail || (customer && customer.email);

  // Check dry run mode
  const isDryRun = process.env.DRY_RUN === 'true' || process.env.NOTIFICATION_DRY_RUN === 'true';

  let status = 'sent';
  let responsePayload = null;
  let errorMessage = '';

  if (isDryRun) {
    status = 'dry_run';
    responsePayload = {
      simulated: true,
      timestamp: new Date(),
      channel,
      phone,
      email,
      body,
    };
  } else {
    try {
      if (channel === 'whatsapp') {
        // WhatsApp Provider (e.g. Meta Cloud API / Twilio)
        if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
          const endpoint = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: phone,
              type: 'text',
              text: { preview_url: false, body },
            }),
          });
          responsePayload = await res.json();
          if (!res.ok) throw new Error(responsePayload.error ? responsePayload.error.message : 'Meta API error');
        } else {
          // Fallback to simulated delivery if credentials not supplied
          status = 'dry_run';
          responsePayload = { provider: 'mock_whatsapp', phone, text: body };
        }
      } else if (channel === 'sms') {
        // SMS Gateway
        if (process.env.SMS_GATEWAY_URL && process.env.SMS_API_KEY) {
          const res = await fetch(process.env.SMS_GATEWAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: process.env.SMS_API_KEY,
              to: phone,
              message: body,
            }),
          });
          responsePayload = await res.json();
          if (!res.ok) throw new Error('SMS Gateway failure');
        } else {
          status = 'dry_run';
          responsePayload = { provider: 'mock_sms', phone, message: body };
        }
      } else if (channel === 'email') {
        if (email) {
          await sendMail({
            to: email,
            subject,
            text: body,
            html: `<div style="font-family:sans-serif;line-height:1.6;color:#333;">${body.replace(/\n/g, '<br>')}</div>`,
          });
          responsePayload = { emailSent: true, recipient: email };
        } else {
          throw new Error('No recipient email available.');
        }
      }
    } catch (err) {
      status = 'failed';
      errorMessage = err.message;
    }
  }

  // Create or update NotificationLog
  const logDoc = await NotificationLog.create({
    recipientCustomer: customer ? (customer._id || customer) : null,
    recipientPhone: phone,
    recipientEmail: email,
    channel,
    stage,
    installment: instId,
    installmentPlan: installmentPlan ? (installmentPlan._id || installmentPlan) : null,
    cheque: cheque ? (cheque._id || cheque) : null,
    subject,
    body,
    language,
    status,
    idempotencyKey,
    responsePayload,
    errorMessage,
    retryCount: isRetry ? 1 : 0,
    lastAttemptAt: new Date(),
    sentAt: new Date(),
  });

  return { skipped: false, status, log: logDoc };
}

/**
 * Retry a failed notification.
 */
async function retryNotification(logId) {
  const log = await NotificationLog.findById(logId).populate('recipientCustomer');
  if (!log) throw ApiError.notFound('Notification log not found.');

  log.retryCount += 1;
  log.lastAttemptAt = new Date();

  const result = await dispatchNotification({
    channel: log.channel,
    toPhone: log.recipientPhone,
    toEmail: log.recipientEmail,
    stage: log.stage,
    installment: log.installment,
    installmentPlan: log.installmentPlan,
    cheque: log.cheque,
    customer: log.recipientCustomer,
    customBody: log.body,
    customSubject: log.subject,
    language: log.language,
    isRetry: true,
  });

  log.status = result.status;
  log.errorMessage = result.log ? result.log.errorMessage : '';
  log.responsePayload = result.log ? result.log.responsePayload : null;
  await log.save();

  return log;
}

module.exports = {
  interpolate,
  normalizePakistaniPhone,
  seedDefaultTemplates,
  dispatchNotification,
  retryNotification,
};
