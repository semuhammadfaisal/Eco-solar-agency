/**
 * Employee and attendance service.
 *
 * Employee CRUD includes salary (integer paisa) and commission (integer basis
 * points). Attendance is day-scoped and audited per changed employee.
 */
'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { text, cnic, optionalNumber, percentToBps } = require('../utils/inputs');
const {
  EMPLOYEE_STATUSES,
  ATTENDANCE_STATUSES,
  WORKFORCE_STATUSES,
} = require('../config/crm');
const {
  todayKey,
  monthKey,
  dayRange,
  monthRange,
  parseDateKey,
} = require('../utils/dates');

const MAX_SEARCH_LENGTH = 80;

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

async function buildEmployeeFilter({ search, status, designation } = {}) {
  const filter = {};

  if (EMPLOYEE_STATUSES.includes(status)) filter.status = status;
  if (designation) filter.designation = designation;

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    const users = await User.find({
      $or: [{ name: regex }, { email: regex }, { phone: regex }],
    })
      .select('_id')
      .limit(300)
      .lean();

    filter.$or = [
      { designation: regex },
      { cnic: regex },
      { user: mongoose.trusted({ $in: users.map((user) => user._id) }) },
    ];
  }

  return filter;
}

async function paginateEmployees({ search, status, designation, page, limit } = {}) {
  const filter = await buildEmployeeFilter({ search, status, designation });
  const total = await Employee.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const items = await Employee.find(filter)
    .sort({ createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .populate('user', 'name email phone role isActive')
    .lean();

  return { items, total, pagination };
}

async function listDesignations() {
  const values = await Employee.distinct('designation', {
    designation: mongoose.trusted({ $ne: '' }),
  });
  return values.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** Load a live employee with their linked user. */
async function getEmployeeOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Employee not found.');
  const employee = await Employee.findById(id).populate(
    'user',
    'name email phone role isActive'
  );
  if (!employee) throw ApiError.notFound('Employee not found.');
  return employee;
}

/**
 * Active users not already linked to another live employee.
 * When editing, the current account is always included even if inactive.
 */
async function listAssignableUsers(includeUserId = null) {
  const linkedFilter = includeUserId
    ? { user: mongoose.trusted({ $ne: includeUserId }) }
    : {};
  const linked = await Employee.find(linkedFilter).select('user').lean();
  const linkedIds = linked.map((row) => row.user).filter(Boolean);

  const filter = { _id: mongoose.trusted({ $nin: linkedIds }) };
  if (includeUserId) {
    filter.$or = [{ isActive: true }, { _id: includeUserId }];
  } else {
    filter.isActive = true;
  }

  return User.find(filter)
    .select('name email role isActive')
    .sort({ name: 1 })
    .lean();
}

async function assertUserLinkable(userId, employeeId = null) {
  if (!mongoose.isValidObjectId(userId)) {
    throw ApiError.badRequest('Select a staff account to link.');
  }

  const user = await User.findOne({ _id: userId, isActive: true }).select('_id name');
  if (!user) throw ApiError.badRequest('Select an active staff account.');

  const duplicateFilter = { user: userId };
  if (employeeId) duplicateFilter._id = mongoose.trusted({ $ne: employeeId });
  const existing = await Employee.findOne(duplicateFilter).select('_id');
  if (existing) {
    throw ApiError.conflict('That staff account already has an employee profile.');
  }

  return user;
}

function parseSalary(value) {
  if (value === '' || value === null || value === undefined) {
    throw ApiError.badRequest('Salary is required.');
  }
  try {
    const paisa = toPaisa(value);
    if (paisa < 0) throw new Error('negative');
    return paisa;
  } catch (_err) {
    throw ApiError.badRequest('Enter a valid salary amount.');
  }
}

function parseCommission(value) {
  const percentage = optionalNumber(value);
  if (percentage === null) return 0;
  if (percentage < 0 || percentage > 100) {
    throw ApiError.badRequest('Commission rate must be between 0% and 100%.');
  }
  return percentToBps(percentage);
}

function parseJoiningDate(value) {
  const parsed = value ? parseDateKey(String(value).slice(0, 10)) : null;
  if (!parsed) throw ApiError.badRequest('Enter a valid joining date.');
  return parsed;
}

function normalizeEmployeeInput(input = {}) {
  const status = EMPLOYEE_STATUSES.includes(input.status) ? input.status : 'active';
  return {
    designation: text(input.designation, 100),
    cnic: cnic(input.cnic),
    salaryPaisa: parseSalary(input.salary),
    joiningDate: parseJoiningDate(input.joiningDate),
    commissionRateBps: parseCommission(input.commissionRate),
    status,
    notes: text(input.notes, 1000),
  };
}

async function createEmployee(input, actor, req) {
  const data = normalizeEmployeeInput(input);
  const user = await assertUserLinkable(input.user);

  if (!data.designation) throw ApiError.badRequest('Designation is required.');

  const employee = new Employee({
    ...data,
    user: user._id,
    createdBy: actor ? actor._id : null,
  });

  await employee.save();
  await employee.populate('user', 'name email phone role isActive');

  await logAction(
    actor,
    AUDIT_ACTIONS.EMPLOYEE_CREATED,
    'employees',
    employee._id,
    null,
    employee.toObject(),
    { req, description: `Created employee profile for ${user.name}` }
  );

  return employee;
}

async function updateEmployee(id, input, actor, req) {
  const employee = await getEmployeeOrThrow(id);
  const before = employee.toObject();
  const data = normalizeEmployeeInput(input);

  if (!data.designation) throw ApiError.badRequest('Designation is required.');

  if (input.user && String(input.user) !== String(employee.user && employee.user._id)) {
    const user = await assertUserLinkable(input.user, employee._id);
    employee.user = user._id;
  }

  Object.assign(employee, data);
  await employee.save();
  await employee.populate('user', 'name email phone role isActive');

  await logAction(
    actor,
    AUDIT_ACTIONS.EMPLOYEE_UPDATED,
    'employees',
    employee._id,
    before,
    employee.toObject(),
    {
      req,
      description: `Updated employee profile for ${employee.user ? employee.user.name : 'staff'}`,
    }
  );

  return employee;
}

async function softDeleteEmployee(id, actor, req) {
  const employee = await getEmployeeOrThrow(id);
  const before = employee.toObject();

  await employee.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.EMPLOYEE_DELETED,
    'employees',
    employee._id,
    before,
    { deletedAt: employee.deletedAt },
    {
      req,
      description: `Deleted employee profile for ${
        employee.user ? employee.user.name : 'staff'
      }`,
    }
  );

  return employee;
}

/**
 * Attendance for one day, joined with the active workforce.
 * @param {string} [requestedDate] YYYY-MM-DD
 */
async function getDailyAttendance(requestedDate) {
  const key = parseDateKey(requestedDate) ? requestedDate : todayKey();
  const range = dayRange(key);

  const [employees, records] = await Promise.all([
    Employee.find({ status: mongoose.trusted({ $in: WORKFORCE_STATUSES }) })
      .populate('user', 'name email phone role isActive')
      .lean(),
    Attendance.find({
      date: mongoose.trusted({ $gte: range.start, $lt: range.end }),
    }).lean(),
  ]);

  const byEmployee = new Map();
  for (const record of records) {
    byEmployee.set(String(record.employee), record);
  }

  const items = employees
    .map((employee) => ({
      employee,
      attendance: byEmployee.get(String(employee._id)) || null,
    }))
    .sort((a, b) =>
      String(a.employee.user ? a.employee.user.name : '').localeCompare(
        String(b.employee.user ? b.employee.user.name : '')
      )
    );

  const summary = { marked: 0, unmarked: 0 };
  for (const status of ATTENDANCE_STATUSES) summary[status] = 0;
  for (const item of items) {
    if (item.attendance) {
      summary.marked += 1;
      summary[item.attendance.status] = (summary[item.attendance.status] || 0) + 1;
    } else {
      summary.unmarked += 1;
    }
  }

  return { dateKey: key, items, summary };
}

/**
 * Upsert one attendance row per employee for a day.
 * @param {string} requestedDate YYYY-MM-DD
 * @param {Array<{employeeId: string, status: string, checkIn?: string, checkOut?: string, notes?: string}>} entries
 */
async function saveDailyAttendance(requestedDate, entries, actor, req) {
  const key = parseDateKey(requestedDate) ? requestedDate : todayKey();
  const range = dayRange(key);
  const saved = [];

  for (const entry of entries) {
    if (!mongoose.isValidObjectId(entry.employeeId)) continue;
    if (!ATTENDANCE_STATUSES.includes(entry.status)) continue;

    const employee = await Employee.findOne({
      _id: entry.employeeId,
      status: mongoose.trusted({ $in: WORKFORCE_STATUSES }),
    })
      .populate('user', 'name')
      .select('_id user designation');

    if (!employee) continue;

    let attendance = await Attendance.findOne({
      employee: employee._id,
      date: mongoose.trusted({ $gte: range.start, $lt: range.end }),
    });

    const existed = Boolean(attendance);
    if (!attendance) {
      attendance = new Attendance({
        employee: employee._id,
        date: range.start,
        markedBy: actor ? actor._id : null,
      });
    }

    const before = existed ? attendance.toObject() : null;
    attendance.status = entry.status;
    attendance.checkIn = text(entry.checkIn, 10);
    attendance.checkOut = text(entry.checkOut, 10);
    attendance.notes = text(entry.notes, 300);
    attendance.markedBy = actor ? actor._id : null;

    await attendance.save();
    saved.push(attendance);

    await logAction(
      actor,
      existed ? AUDIT_ACTIONS.ATTENDANCE_UPDATED : AUDIT_ACTIONS.ATTENDANCE_MARKED,
      'attendance',
      attendance._id,
      before,
      attendance.toObject(),
      {
        req,
        description: `${existed ? 'Updated' : 'Marked'} attendance for ${
          employee.user ? employee.user.name : 'employee'
        } on ${key} (${attendance.status})`,
      }
    );
  }

  return { dateKey: key, saved };
}

/**
 * Monthly attendance summary per active employee.
 * @param {string} [requestedMonth] YYYY-MM
 */
async function getMonthlySummary(requestedMonth) {
  const key = /^\d{4}-\d{2}$/.test(String(requestedMonth || ''))
    ? requestedMonth
    : monthKey();
  const range = monthRange(key);

  const [employees, records] = await Promise.all([
    Employee.find({ status: mongoose.trusted({ $in: WORKFORCE_STATUSES }) })
      .populate('user', 'name email role')
      .lean(),
    Attendance.find({
      date: mongoose.trusted({ $gte: range.start, $lt: range.end }),
    }).lean(),
  ]);

  const grouped = new Map();
  for (const record of records) {
    const employeeId = String(record.employee);
    if (!grouped.has(employeeId)) {
      grouped.set(employeeId, {
        present: 0,
        absent: 0,
        leave: 0,
        half_day: 0,
        late: 0,
        marked: 0,
      });
    }
    const bucket = grouped.get(employeeId);
    bucket[record.status] = (bucket[record.status] || 0) + 1;
    bucket.marked += 1;
  }

  const totals = { present: 0, absent: 0, leave: 0, half_day: 0, late: 0, marked: 0 };

  const rows = employees
    .map((employee) => {
      const counts = grouped.get(String(employee._id)) || {
        present: 0,
        absent: 0,
        leave: 0,
        half_day: 0,
        late: 0,
        marked: 0,
      };

      for (const field of Object.keys(totals)) totals[field] += counts[field] || 0;

      const effective = counts.present + counts.late + counts.half_day * 0.5;
      const rate = counts.marked ? Math.round((effective / counts.marked) * 100) : 0;

      return { employee, ...counts, rate };
    })
    .sort((a, b) =>
      String(a.employee.user ? a.employee.user.name : '').localeCompare(
        String(b.employee.user ? b.employee.user.name : '')
      )
    );

  return { monthKey: key, rows, totals };
}

module.exports = {
  buildEmployeeFilter,
  paginateEmployees,
  listDesignations,
  getEmployeeOrThrow,
  listAssignableUsers,
  createEmployee,
  updateEmployee,
  softDeleteEmployee,
  getDailyAttendance,
  saveDailyAttendance,
  getMonthlySummary,
};
