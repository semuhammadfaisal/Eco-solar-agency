/** Employee and attendance controllers. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const employeeService = require('../services/employeeService');
const { safeReferrer } = require('../utils/urls');
const { todayKey, monthKey } = require('../utils/dates');

const employeesBreadcrumb = { label: 'Employees', url: '/employees' };

exports.index = asyncHandler(async (req, res) => {
  const { search = '', status = '', designation = '' } = req.query;

  const [{ items, total, pagination }, designations] = await Promise.all([
    employeeService.paginateEmployees({
      search,
      status,
      designation,
      page: req.query.page,
      limit: req.query.limit,
    }),
    employeeService.listDesignations(),
  ]);

  return res.render('employees/index', {
    layout: 'layouts/admin',
    title: 'Employees',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Employees' }],
    employees: items,
    total,
    pagination,
    designations,
    filters: {
      search: String(search).slice(0, 80),
      status,
      designation,
    },
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  const users = await employeeService.listAssignableUsers();

  return res.render('employees/form', {
    layout: 'layouts/admin',
    title: 'Add employee',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      employeesBreadcrumb,
      { label: 'Add employee' },
    ],
    employee: null,
    users,
    formAction: '/employees',
    formMethod: 'POST',
    isEdit: false,
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    const employee = await employeeService.createEmployee(req.body, req.user, req);
    req.flash(
      'success',
      `Employee profile for ${employee.user ? employee.user.name : 'staff'} has been added.`
    );
    return res.redirect('/employees');
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect('/employees/new');
  }
});

exports.editForm = asyncHandler(async (req, res) => {
  const employee = await employeeService.getEmployeeOrThrow(req.params.id);
  const currentUserId = employee.user && (employee.user._id || employee.user);
  const users = await employeeService.listAssignableUsers(currentUserId);

  return res.render('employees/form', {
    layout: 'layouts/admin',
    title: `Edit ${employee.user ? employee.user.name : 'employee'}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      employeesBreadcrumb,
      { label: employee.user ? employee.user.name : 'Employee' },
      { label: 'Edit' },
    ],
    employee,
    users,
    formAction: `/employees/${employee._id}`,
    formMethod: 'PUT',
    isEdit: true,
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    const employee = await employeeService.updateEmployee(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash(
      'success',
      `Employee profile for ${employee.user ? employee.user.name : 'staff'} has been updated.`
    );
    return res.redirect('/employees');
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/employees/${req.params.id}/edit`);
  }
});

exports.destroy = asyncHandler(async (req, res) => {
  try {
    const employee = await employeeService.softDeleteEmployee(req.params.id, req.user, req);
    req.flash(
      'success',
      `Employee profile for ${employee.user ? employee.user.name : 'staff'} has been deleted.`
    );
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect(safeReferrer(req, '/employees'));
});

exports.attendance = asyncHandler(async (req, res) => {
  const { dateKey, items, summary } = await employeeService.getDailyAttendance(
    req.query.date
  );

  return res.render('employees/attendance', {
    layout: 'layouts/admin',
    title: 'Daily attendance',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      employeesBreadcrumb,
      { label: 'Attendance' },
    ],
    dateKey,
    items,
    summary,
    today: todayKey(),
  });
});

exports.saveAttendance = asyncHandler(async (req, res) => {
  const dateKey = req.body.date;
  const entries = [];

  for (const key of Object.keys(req.body)) {
    if (!key.startsWith('status_')) continue;
    const employeeId = key.slice('status_'.length);
    entries.push({
      employeeId,
      status: req.body[key],
      checkIn: req.body[`checkIn_${employeeId}`],
      checkOut: req.body[`checkOut_${employeeId}`],
      notes: req.body[`notes_${employeeId}`],
    });
  }

  try {
    const { saved } = await employeeService.saveDailyAttendance(
      dateKey,
      entries,
      req.user,
      req
    );
    req.flash(
      'success',
      saved.length
        ? `Attendance saved for ${saved.length} employee${saved.length === 1 ? '' : 's'}.`
        : 'No attendance changes to save.'
    );
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    req.flash('error', err.message);
  }

  return res.redirect(`/employees/attendance?date=${encodeURIComponent(dateKey || todayKey())}`);
});

exports.attendanceSummary = asyncHandler(async (req, res) => {
  const summary = await employeeService.getMonthlySummary(req.query.month);

  return res.render('employees/attendance-summary', {
    layout: 'layouts/admin',
    title: 'Attendance summary',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      employeesBreadcrumb,
      { label: 'Attendance summary' },
    ],
    summary,
    currentMonth: monthKey(),
  });
});
