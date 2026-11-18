'use strict';

const SURVEY_STATUSES = Object.freeze(['scheduled', 'completed', 'cancelled']);
const SURVEY_STATUS_LABELS = Object.freeze({
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
});
const SURVEY_STATUS_BADGES = Object.freeze({
  scheduled: 'primary',
  completed: 'success',
  cancelled: 'secondary',
});

const ROOF_TYPES = Object.freeze(['flat_concrete', 'sloped', 'metal', 'tile', 'ground', 'other']);
const ROOF_TYPE_LABELS = Object.freeze({
  flat_concrete: 'Flat concrete',
  sloped: 'Sloped roof',
  metal: 'Metal / shed',
  tile: 'Tile roof',
  ground: 'Ground mount',
  other: 'Other',
});

const DIRECTIONS = Object.freeze(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);
const SHADING_LEVELS = Object.freeze(['none', 'low', 'moderate', 'high']);
const STRUCTURE_TYPES = Object.freeze(['fixed', 'elevated', 'ballasted', 'ground_mount', 'custom']);
const PHASES = Object.freeze(['single', 'three']);
const METER_TYPES = Object.freeze(['standard', 'net_metering', 'smart', 'bidirectional', 'other']);
const SYSTEM_TYPES = Object.freeze(['on_grid', 'hybrid', 'off_grid']);
const SYSTEM_TYPE_LABELS = Object.freeze({
  on_grid: 'On-grid',
  hybrid: 'Hybrid',
  off_grid: 'Off-grid',
});
const SURVEY_PHOTO_TYPES = Object.freeze(['roof', 'meter', 'bill', 'db_panel']);
const SURVEY_PHOTO_LABELS = Object.freeze({ roof: 'Roof', meter: 'Meter', bill: 'Electricity bill', db_panel: 'DB panel' });

module.exports = {
  SURVEY_STATUSES,
  SURVEY_STATUS_LABELS,
  SURVEY_STATUS_BADGES,
  ROOF_TYPES,
  ROOF_TYPE_LABELS,
  DIRECTIONS,
  SHADING_LEVELS,
  STRUCTURE_TYPES,
  PHASES,
  METER_TYPES,
  SYSTEM_TYPES,
  SYSTEM_TYPE_LABELS,
  SURVEY_PHOTO_TYPES,
  SURVEY_PHOTO_LABELS,
};
