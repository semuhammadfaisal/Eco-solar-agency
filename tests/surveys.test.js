'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const { calculateSuggestion, applyScope } = require('../services/surveyService');
const { buildSurveyPdf } = require('../services/surveyReportService');
const { can } = require('../config/permissions');

test('survey sizing uses average units, buffer, and configured step', () => {
  const usage = Array.from({ length: 12 }, (_value, index) => ({ month: String(index + 1), units: 120 }));
  const result = calculateSuggestion(usage, {
    surveyMonthlyUnitsPerKw: 120,
    surveySizingBufferPercent: 15,
    surveySizeStepKw: 0.5,
  });
  assert.equal(result.averageUnits, 120);
  assert.equal(result.suggestedKw, 1.5);
  assert.match(result.basis, /15%/);
});

test('survey sizing ignores empty months', () => {
  const result = calculateSuggestion([{ month: 'A', units: 0 }, { month: 'B', units: 240 }], {
    surveyMonthlyUnitsPerKw: 120,
    surveySizingBufferPercent: 0,
    surveySizeStepKw: 0.5,
  });
  assert.equal(result.averageUnits, 240);
  assert.equal(result.suggestedKw, 2);
});

test('surveyor scope always pins queries to the signed-in surveyor', () => {
  const id = new mongoose.Types.ObjectId();
  const filter = applyScope({ status: 'scheduled' }, { _id: id, role: 'surveyor' });
  assert.equal(String(filter.surveyor), String(id));
  assert.equal(filter.status, 'scheduled');
});

test('survey permissions separate scheduling from field completion', () => {
  assert.equal(can('sales', 'surveys.schedule'), true);
  assert.equal(can('sales', 'surveys.perform'), false);
  assert.equal(can('surveyor', 'surveys.schedule'), false);
  assert.equal(can('surveyor', 'surveys.perform'), true);
});

test('survey model rejects more than twelve monthly rows', () => {
  const survey = new Survey({
    number: 'SUR-TEST',
    surveyor: new mongoose.Types.ObjectId(),
    scheduledAt: new Date(),
    monthlyUsage: Array.from({ length: 13 }, (_value, index) => ({ month: String(index), units: 1 })),
  });
  const error = survey.validateSync();
  assert.ok(error.errors.monthlyUsage);
});

test('survey report service returns a valid PDF buffer', async () => {
  const pdf = await buildSurveyPdf({
    number: 'SUR-TEST', status: 'scheduled', scheduledAt: new Date(),
    customer: { name: 'Test Customer', phone: '03000000000' },
    surveyor: { name: 'Test Surveyor' }, monthlyUsage: [], photos: [],
    recommendedKw: 5, systemType: 'on_grid', remarks: '',
  }, { companyName: 'Test Solar' });
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(pdf.length > 1000);
});
