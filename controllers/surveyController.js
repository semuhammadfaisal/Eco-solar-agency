'use strict';

const fs = require('fs/promises');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const surveyService = require('../services/surveyService');
const reportService = require('../services/surveyReportService');
const customerService = require('../services/customerService');
const settingsService = require('../services/settingsService');
const { can } = require('../config/permissions');

const breadcrumb = { label: 'Site surveys', url: '/surveys' };

async function cleanupRequestFiles(files = {}) {
  const rows = Array.isArray(files) ? files : Object.values(files || {}).flat();
  await Promise.all(rows.filter((file) => file && file.path).map((file) => fs.unlink(file.path).catch(() => {})));
}

function dateTimeInput(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function formOptions(actor) {
  const scopedSurveyor = actor && actor.role === 'surveyor';
  const [customers, surveyors, settings] = await Promise.all([
    scopedSurveyor ? [] : customerService.listCustomerOptions(500),
    scopedSurveyor ? [{ _id: actor._id, name: actor.name, email: actor.email }] : surveyService.listSurveyors(),
    settingsService.getSettings(),
  ]);
  return { customers, surveyors, sizingSettings: settings };
}

exports.index = asyncHandler(async (req, res) => {
  const filters = {
    search: req.query.search || '', status: req.query.status || '', surveyor: req.query.surveyor || '',
    from: req.query.from || '', to: req.query.to || '', page: req.query.page, limit: req.query.limit,
  };
  const [{ items, total, pagination }, surveyors] = await Promise.all([
    surveyService.paginateSurveys(filters, req.user), surveyService.listSurveyors(),
  ]);
  res.render('surveys/index', {
    layout: 'layouts/admin', title: 'Site surveys', breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, breadcrumb],
    surveyRows: items, total, pagination, surveyors, filters,
    canSchedule: can(req.user, 'surveys.schedule'),
  });
});

exports.calendar = asyncHandler(async (req, res) => {
  const calendar = await surveyService.getCalendar(req.query.month, req.user);
  const [year, month] = calendar.month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDay = {};
  for (const survey of calendar.items) {
    const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', day: 'numeric' }).format(survey.scheduledAt));
    (byDay[day] ||= []).push(survey);
  }
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  res.render('surveys/calendar', {
    layout: 'layouts/admin', title: 'Survey calendar', breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, breadcrumb, { label: 'Calendar' }],
    ...calendar, firstWeekday, daysInMonth, byDay, previous, next,
    canSchedule: can(req.user, 'surveys.schedule'),
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  res.render('surveys/form', {
    layout: 'layouts/admin', title: 'Schedule survey', breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, breadcrumb, { label: 'Schedule' }],
    survey: null, ...(await formOptions(req.user)), isEdit: false,
    formAction: `/surveys?_csrf=${encodeURIComponent(res.locals.csrfToken)}`,
    scheduledDefault: dateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    const survey = await surveyService.createSurvey(req.body, req.files, req.user, req);
    req.flash('success', `${survey.number} has been scheduled.`);
    return res.redirect(`/surveys/${survey._id}`);
  } catch (err) {
    await cleanupRequestFiles(req.files);
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect('/surveys/new');
  }
});

exports.show = asyncHandler(async (req, res) => {
  const survey = await surveyService.getSurveyOrThrow(req.params.id, req.user, { lean: true });
  res.render('surveys/show', {
    layout: 'layouts/admin', title: survey.number, breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, breadcrumb, { label: survey.number }],
    survey, canPerform: can(req.user, 'surveys.perform'),
  });
});

exports.editForm = asyncHandler(async (req, res) => {
  const survey = await surveyService.getSurveyOrThrow(req.params.id, req.user, { lean: true });
  res.render('surveys/form', {
    layout: 'layouts/admin', title: `Survey ${survey.number}`, breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, breadcrumb, { label: survey.number, url: `/surveys/${survey._id}` }, { label: 'Survey form' }],
    survey, ...(await formOptions(req.user)), isEdit: true,
    formAction: `/surveys/${survey._id}?_method=PUT&_csrf=${encodeURIComponent(res.locals.csrfToken)}`,
    scheduledDefault: dateTimeInput(survey.scheduledAt),
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const survey = await surveyService.updateSurvey(req.params.id, req.body, req.files, req.user, req);
    req.flash('success', `${survey.number} has been saved.`);
    return res.redirect(`/surveys/${survey._id}`);
  } catch (err) {
    await cleanupRequestFiles(req.files);
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/surveys/${req.params.id}/edit`);
  }
});

exports.report = asyncHandler(async (req, res) => {
  const [survey, settings] = await Promise.all([
    surveyService.getSurveyOrThrow(req.params.id, req.user, { lean: true }), settingsService.getSettings(),
  ]);
  const pdf = await reportService.buildSurveyPdf(survey, settings.toObject ? settings.toObject() : settings);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${survey.number}-site-survey.pdf"`, 'Content-Length': pdf.length });
  return res.end(pdf);
});

exports.dateTimeInput = dateTimeInput;
