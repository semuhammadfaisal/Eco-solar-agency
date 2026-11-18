'use strict';

const fs = require('fs/promises');
const path = require('path');
const { buildSurveyPdf } = require('../services/surveyReportService');

async function main() {
  const output = path.join(__dirname, '..', 'output', 'pdf', 'survey-report-sample.pdf');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const months = ['2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11'];
  const survey = {
    number: 'SUR-0042', status: 'completed', scheduledAt: new Date('2026-11-10T05:30:00Z'),
    customer: { code: 'CUS-0088', name: 'Ayesha Khan', phone: '0300 1234567', address: '22 Model Town', area: 'Block C', city: 'Lahore' },
    surveyor: { name: 'Hamza Ali' }, roofType: 'flat_concrete', roofAreaSqFt: 1850,
    direction: 'south', tiltDegrees: 18, shading: 'low', structureType: 'elevated', floorHeight: 24,
    sanctionedLoadKw: 15, phase: 'three', meterType: 'net_metering', cableDistanceMeters: 32,
    monthlyUsage: months.map((month, index) => ({ month, units: 720 + index * 18, amountPaisa: (31500 + index * 900) * 100 })),
    recommendedKw: 8.5, systemType: 'on_grid', recommendationBasis: '819 average monthly units / 120 units per kW, plus 15% design buffer',
    remarks: 'South-facing clear roof. Keep a service aisle along the east parapet and route DC cable through the existing utility shaft.',
    photos: [],
  };
  const settings = { companyName: 'SolarPro Energy', address: 'Main Boulevard, Gulberg', city: 'Lahore', phone: '042-1234567', email: 'info@solarpro.pk' };
  const buffer = await buildSurveyPdf(survey, settings);
  await fs.writeFile(output, buffer);
  process.stdout.write(output);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
