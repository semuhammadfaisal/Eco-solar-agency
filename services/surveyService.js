'use strict';

const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const settingsService = require('./settingsService');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { ROLES } = require('../config/roles');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { text, optionalNumber } = require('../utils/inputs');
const { monthKey } = require('../utils/dates');
const { toPaisa } = require('../utils/money');
const {
  SURVEY_STATUSES,
  ROOF_TYPES,
  DIRECTIONS,
  SHADING_LEVELS,
  STRUCTURE_TYPES,
  PHASES,
  METER_TYPES,
  SYSTEM_TYPES,
} = require('../config/surveys');

function isSurveyor(actor) {
  return Boolean(actor && actor.role === ROLES.SURVEYOR);
}

function applyScope(filter, actor) {
  if (isSurveyor(actor)) filter.surveyor = actor._id;
  return filter;
}

function parseDateTime(value) {
  const raw = String(value || '');
  // datetime-local has no offset. Asia/Karachi is UTC+05:00 year-round,
  // so store the intended visit instant explicitly on any server timezone.
  const date = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00+05:00` : raw);
  if (!value || Number.isNaN(date.getTime())) throw ApiError.badRequest('Enter a valid scheduled date and time.');
  return date;
}

function parseOptionalNumber(value, label, max = 10000000) {
  const number = optionalNumber(value);
  if (number === null) return null;
  if (number < 0 || number > max) throw ApiError.badRequest(`${label} must be between 0 and ${max}.`);
  return number;
}

function enumValue(value, allowed) {
  return allowed.includes(value) ? value : '';
}

function normalizeMonthlyUsage(input = {}) {
  const months = Array.isArray(input.monthlyMonths) ? input.monthlyMonths : [];
  const units = Array.isArray(input.monthlyUnits) ? input.monthlyUnits : [];
  const bills = Array.isArray(input.monthlyBills) ? input.monthlyBills : [];
  const rows = [];

  for (let index = 0; index < 12; index += 1) {
    const month = /^\d{4}-\d{2}$/.test(String(months[index] || ''))
      ? String(months[index])
      : `Month ${index + 1}`;
    const unitValue = parseOptionalNumber(units[index], `Units for ${month}`) || 0;
    let amountPaisa = 0;
    if (bills[index] !== '' && bills[index] !== undefined) {
      try {
        amountPaisa = toPaisa(bills[index]);
      } catch (_err) {
        throw ApiError.badRequest(`Enter a valid bill amount for ${month}.`);
      }
    }
    rows.push({ month, units: unitValue, amountPaisa });
  }
  return rows;
}

function calculateSuggestion(monthlyUsage, settings) {
  const positive = monthlyUsage.map((row) => Number(row.units || 0)).filter((value) => value > 0);
  if (!positive.length) return { averageUnits: 0, suggestedKw: null, basis: '' };

  const averageUnits = positive.reduce((sum, value) => sum + value, 0) / positive.length;
  const production = Math.max(1, Number(settings.surveyMonthlyUnitsPerKw || 120));
  const buffer = Math.max(0, Number(settings.surveySizingBufferPercent || 0));
  const step = Math.max(0.1, Number(settings.surveySizeStepKw || 0.5));
  const raw = (averageUnits / production) * (1 + buffer / 100);
  const suggestedKw = Math.ceil(raw / step) * step;
  const roundedAverage = Math.round(averageUnits * 10) / 10;

  return {
    averageUnits: roundedAverage,
    suggestedKw: Math.round(suggestedKw * 100) / 100,
    basis: `${roundedAverage} average monthly units / ${production} units per kW, plus ${buffer}% design buffer`,
  };
}

async function resolveRelations(input, actor) {
  if (!mongoose.isValidObjectId(input.customer)) throw ApiError.badRequest('Select a valid customer.');
  const customer = await Customer.findById(input.customer).select('_id name phone');
  if (!customer) throw ApiError.badRequest('Select a valid customer.');

  if (!mongoose.isValidObjectId(input.surveyor)) throw ApiError.badRequest('Select an active surveyor.');
  const surveyor = await User.findOne({ _id: input.surveyor, role: ROLES.SURVEYOR, isActive: true }).select('_id name');
  if (!surveyor) throw ApiError.badRequest('Select an active surveyor.');
  if (isSurveyor(actor) && String(surveyor._id) !== String(actor._id)) {
    throw ApiError.forbidden('Surveyors can only update their own assigned surveys.');
  }
  return { customer, surveyor };
}

function mapUploads(files = {}) {
  const fields = { roofPhotos: 'roof', meterPhotos: 'meter', billPhotos: 'bill', dbPanelPhotos: 'db_panel' };
  const photos = [];
  for (const [field, type] of Object.entries(fields)) {
    for (const file of files[field] || []) {
      photos.push({
        type,
        path: `/uploads/surveys/${file.filename}`,
        originalName: text(file.originalname, 180),
        mimeType: file.mimetype,
        size: file.size,
      });
    }
  }
  return photos;
}

async function nextSurveyNumber() {
  const seq = await Counter.next('survey');
  return `SUR-${String(seq).padStart(4, '0')}`;
}

async function listSurveyors() {
  return User.find({ role: ROLES.SURVEYOR, isActive: true }).select('name email phone').sort({ name: 1 }).lean();
}

function buildFilter({ search, status, surveyor, from, to } = {}, actor) {
  const filter = {};
  if (SURVEY_STATUSES.includes(status)) filter.status = status;
  if (!isSurveyor(actor) && surveyor && mongoose.isValidObjectId(surveyor)) filter.surveyor = surveyor;
  if (from || to) {
    filter.scheduledAt = {};
    if (from) filter.scheduledAt.$gte = new Date(`${from}T00:00:00+05:00`);
    if (to) filter.scheduledAt.$lt = new Date(`${to}T23:59:59.999+05:00`);
  }
  const term = text(search, 80);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$or = [{ number: regex }, { remarks: regex }];
  }
  return applyScope(filter, actor);
}

async function paginateSurveys(params = {}, actor) {
  const filter = buildFilter(params, actor);
  const total = await Survey.countDocuments(filter);
  const pagination = createPagination(params.page, params.limit, total);
  const items = await Survey.find(filter).sort({ scheduledAt: -1 }).skip(pagination.skip).limit(pagination.limit)
    .populate('customer', 'code name phone city')
    .populate('surveyor', 'name email phone').lean();
  return { items, total, pagination };
}

async function getCalendar(month, actor) {
  const key = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : monthKey();
  const [year, monthNumber] = key.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const range = {
    start: new Date(`${key}-01T00:00:00+05:00`),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+05:00`),
  };
  const filter = applyScope({ scheduledAt: { $gte: range.start, $lt: range.end } }, actor);
  const items = await Survey.find(filter).sort({ scheduledAt: 1 })
    .populate('customer', 'name').populate('surveyor', 'name').lean();
  return { month: key, items };
}

async function getSurveyOrThrow(id, actor, { lean = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Survey not found.');
  const query = Survey.findOne(applyScope({ _id: id }, actor))
    .populate('customer', 'code name phone whatsapp address city area electricityReferenceNo disco type')
    .populate('surveyor', 'name email phone role')
    .populate('createdBy', 'name email');
  if (lean) query.lean();
  const survey = await query;
  if (!survey) throw ApiError.notFound('Survey not found.');
  return survey;
}

async function normalizeData(input, actor) {
  const { customer, surveyor } = await resolveRelations(input, actor);
  const monthlyUsage = normalizeMonthlyUsage(input);
  const settings = await settingsService.getSettings();
  const suggestion = calculateSuggestion(monthlyUsage, settings);
  const status = SURVEY_STATUSES.includes(input.status) ? input.status : 'scheduled';
  return {
    data: {
      customer: customer._id,
      surveyor: surveyor._id,
      scheduledAt: parseDateTime(input.scheduledAt),
      status,
      completedAt: status === 'completed' ? new Date() : null,
      roofType: enumValue(input.roofType, ROOF_TYPES),
      roofAreaSqFt: parseOptionalNumber(input.roofAreaSqFt, 'Roof area'),
      direction: enumValue(input.direction, DIRECTIONS),
      tiltDegrees: parseOptionalNumber(input.tiltDegrees, 'Tilt', 90),
      shading: enumValue(input.shading, SHADING_LEVELS),
      structureType: enumValue(input.structureType, STRUCTURE_TYPES),
      floorHeight: parseOptionalNumber(input.floorHeight, 'Floor height', 500),
      monthlyUsage,
      sanctionedLoadKw: parseOptionalNumber(input.sanctionedLoadKw, 'Sanctioned load', 100000),
      phase: enumValue(input.phase, PHASES),
      meterType: enumValue(input.meterType, METER_TYPES),
      cableDistanceMeters: parseOptionalNumber(input.cableDistanceMeters, 'Cable distance', 100000),
      recommendedKw: parseOptionalNumber(input.recommendedKw, 'Recommended system size', 100000) || suggestion.suggestedKw,
      suggestedKw: suggestion.suggestedKw,
      systemType: enumValue(input.systemType, SYSTEM_TYPES),
      recommendationBasis: suggestion.basis,
      remarks: text(input.remarks, 3000),
    },
  };
}

async function createSurvey(input, files, actor, req) {
  const { data } = await normalizeData(input, actor);
  data.status = 'scheduled';
  data.completedAt = null;
  const survey = new Survey({ ...data, number: await nextSurveyNumber(), photos: mapUploads(files), createdBy: actor._id });
  await survey.save();
  await logAction(actor, AUDIT_ACTIONS.SURVEY_CREATED, 'surveys', survey._id, null, survey.toObject(), { req, description: `Scheduled ${survey.number}` });
  return survey;
}

async function updateSurvey(id, input, files, actor, req) {
  const survey = await getSurveyOrThrow(id, actor);
  const before = survey.toObject();
  const scopedInput = isSurveyor(actor)
    ? {
        ...input,
        customer: survey.customer && (survey.customer._id || survey.customer),
        surveyor: actor._id,
        scheduledAt: survey.scheduledAt,
      }
    : input;
  const { data } = await normalizeData(scopedInput, actor);
  const previousStatus = survey.status;
  if (data.status === 'completed' && previousStatus === 'completed') data.completedAt = survey.completedAt;
  Object.assign(survey, data);
  if (data.status !== 'completed' && previousStatus === 'completed') survey.completedAt = before.completedAt;
  const uploaded = mapUploads(files);
  if (uploaded.length) survey.photos.push(...uploaded);
  await survey.save();
  await logAction(actor, AUDIT_ACTIONS.SURVEY_UPDATED, 'surveys', survey._id, before, survey.toObject(), { req, description: `Updated ${survey.number}` });
  if (previousStatus !== survey.status) {
    await logAction(actor, AUDIT_ACTIONS.SURVEY_STATUS_CHANGED, 'surveys', survey._id, { status: previousStatus }, { status: survey.status }, { req, description: `${survey.number}: ${previousStatus} to ${survey.status}` });
  }
  return survey;
}

module.exports = {
  applyScope,
  normalizeMonthlyUsage,
  calculateSuggestion,
  listSurveyors,
  paginateSurveys,
  getCalendar,
  getSurveyOrThrow,
  createSurvey,
  updateSurvey,
};
