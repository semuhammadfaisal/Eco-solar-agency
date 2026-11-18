/**
 * Customer service.
 *
 * Responsibilities:
 *   - generate the CUS-0001 sequence atomically
 *   - safe search/filter/pagination
 *   - validate cross-document input
 *   - write an audit entry for every mutation
 */
'use strict';

const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Counter = require('../models/Counter');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { text, cnic, gps } = require('../utils/inputs');
const { CUSTOMER_TYPES, CUSTOMER_SOURCES, DISCO_COMPANIES } = require('../config/crm');

const MAX_SEARCH_LENGTH = 80;

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

/** Build the Mongoose filter for the customer list. */
function buildCustomerFilter({ search, type, city, source, disco } = {}) {
  const filter = {};

  if (CUSTOMER_TYPES.includes(type)) filter.type = type;
  if (CUSTOMER_SOURCES.includes(source)) filter.source = source;
  if (DISCO_COMPANIES.includes(disco)) filter.disco = disco;
  if (city) filter.city = city;

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$or = [
      { code: regex },
      { name: regex },
      { phone: regex },
      { whatsapp: regex },
      { cnic: regex },
      { city: regex },
      { area: regex },
      { electricityReferenceNo: regex },
    ];
  }

  return filter;
}

async function paginateCustomers({ search, type, city, source, disco, page, limit } = {}) {
  const filter = buildCustomerFilter({ search, type, city, source, disco });
  const total = await Customer.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const items = await Customer.find(filter)
    .sort({ createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .populate('assignedTo', 'name email')
    .lean();

  return { items, total, pagination };
}

/** Distinct non-empty cities for the filter dropdown. */
async function listCities() {
  const cities = await Customer.distinct('city', {
    city: mongoose.trusted({ $ne: '' }),
  });
  return cities.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** Latest customers for form selectors. */
async function listCustomerOptions(limit = 300) {
  return Customer.find()
    .select('code name phone city')
    .sort({ name: 1 })
    .limit(limit)
    .lean();
}

/** Load a live customer by id or throw 404. */
async function getCustomerOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Customer not found.');
  const customer = await Customer.findById(id).populate('assignedTo', 'name email');
  if (!customer) throw ApiError.notFound('Customer not found.');
  return customer;
}

async function nextCustomerCode() {
  const seq = await Counter.next('customer');
  return `CUS-${String(seq).padStart(4, '0')}`;
}

/** Validate an optional assigned user and return the id (or null). */
async function resolveAssignee(value) {
  if (!value) return null;
  if (!mongoose.isValidObjectId(value)) throw ApiError.badRequest('Select a valid staff member.');
  const user = await User.findOne({ _id: value, isActive: true }).select('_id');
  if (!user) throw ApiError.badRequest('Select an active staff member.');
  return user._id;
}

function assertGpsPair(lat, lng) {
  const hasLat = lat !== null;
  const hasLng = lng !== null;
  if (hasLat !== hasLng) {
    throw ApiError.badRequest('Enter both GPS latitude and longitude, or leave both blank.');
  }
  if (hasLat && (lat < -90 || lat > 90)) {
    throw ApiError.badRequest('Latitude must be between -90 and 90.');
  }
  if (hasLng && (lng < -180 || lng > 180)) {
    throw ApiError.badRequest('Longitude must be between -180 and 180.');
  }
}

function normalizeCustomerInput(input = {}) {
  const gpsValue = gps(input.gpsLat, input.gpsLng);
  assertGpsPair(gpsValue.lat, gpsValue.lng);

  return {
    name: text(input.name, 120),
    phone: text(input.phone, 20),
    whatsapp: text(input.whatsapp, 20),
    cnic: cnic(input.cnic),
    address: text(input.address, 250),
    city: text(input.city, 80),
    area: text(input.area, 80),
    gps: gpsValue,
    electricityReferenceNo: text(input.electricityReferenceNo, 60),
    disco: DISCO_COMPANIES.includes(input.disco) ? input.disco : '',
    type: CUSTOMER_TYPES.includes(input.type) ? input.type : 'residential',
    source: CUSTOMER_SOURCES.includes(input.source) ? input.source : 'other',
    notes: text(input.notes, 1000),
  };
}

/**
 * Create a customer and generate its code.
 * @param {object} input Form payload
 * @param {object} actor Signed-in user
 * @param {import('express').Request} req
 */
async function createCustomer(input, actor, req) {
  const data = normalizeCustomerInput(input);
  const assignedTo = await resolveAssignee(input.assignedTo);

  const customer = new Customer({
    ...data,
    code: await nextCustomerCode(),
    assignedTo,
    createdBy: actor ? actor._id : null,
  });

  await customer.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.CUSTOMER_CREATED,
    'customers',
    customer._id,
    null,
    customer.toObject(),
    { req, description: `Created customer ${customer.code} — ${customer.name}` }
  );

  return customer;
}

/** Update an existing customer. */
async function updateCustomer(id, input, actor, req) {
  const customer = await getCustomerOrThrow(id);
  const before = customer.toObject();
  const data = normalizeCustomerInput(input);

  Object.assign(customer, data);

  if (input.assignedTo !== undefined) {
    customer.assignedTo = await resolveAssignee(input.assignedTo);
  }

  await customer.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.CUSTOMER_UPDATED,
    'customers',
    customer._id,
    before,
    customer.toObject(),
    { req, description: `Updated customer ${customer.code} — ${customer.name}` }
  );

  return customer;
}

/** Soft-delete a customer, retaining the row for history. */
async function softDeleteCustomer(id, actor, req) {
  const customer = await getCustomerOrThrow(id);
  const before = customer.toObject();

  await customer.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.CUSTOMER_DELETED,
    'customers',
    customer._id,
    before,
    { deletedAt: customer.deletedAt },
    { req, description: `Deleted customer ${customer.code} — ${customer.name}` }
  );

  return customer;
}

module.exports = {
  buildCustomerFilter,
  paginateCustomers,
  listCities,
  listCustomerOptions,
  getCustomerOrThrow,
  createCustomer,
  updateCustomer,
  softDeleteCustomer,
  nextCustomerCode,
};
