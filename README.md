# Solar Business Management System

A server-rendered business management system for a solar company in Pakistan, built with
Node.js, Express, MongoDB and EJS. This repository contains **Step 1: the project foundation** —
authentication, role-based access, user management, company settings, audit logging and the
admin UI shell — **Step 2: customers and employees**, and **Step 3: inventory,
suppliers, purchase orders, goods receipts and serial-number tracking**.

No React, no client-side build step. Bootstrap 5, Alpine.js, Chart.js and FullCalendar are
served locally from `node_modules` through the `/vendor/*` static mounts, so the app keeps
working on offline or unreliable shop networks.

---

## 1. What is included

| Area | Details |
| --- | --- |
| App shell | `app.js` with Helmet, CSP, sessions (connect-mongo), CSRF, flash messages, login rate limiting, 404 + central error handler |
| Auth | Email/password login, logout, change own password, session regeneration on login, deactivated users are logged out on their next request |
| Users | Owner-only CRUD, search/filter/pagination, activate/deactivate, soft delete, "last owner" protection |
| Customers | `CUS-0001` codes, contact/GPS/DISCO/type/source fields, search + filters, profile page with 8 module tabs |
| Employees | Employee profile linked to a user account, salary (paisa), commission (basis points), daily attendance and monthly summary |
| Items | SKU catalogue with category (panel/inverter/battery/structure/cable/breaker/earthing/other), brand, model, unit, specs, serial tracking, minimum stock, purchase/selling prices and warranty defaults |
| Suppliers | `SUP-0001` codes, contact/company/NTN/address fields, derived payable balance, supplier profile with purchases and returns |
| Purchases | PO → GRN flow: multi-line orders, partial receipts, supplier invoice, payment status, cancellation before receipt, average-cost update on receipt |
| Stock | Append-only signed ledger (IN/OUT/RETURN/ADJUSTMENT), running balance, low-stock highlighting, stock adjustments, supplier returns and a valuation report |
| Serials | One row per serialised unit, CSV/newline paste with duplicate + count validation, status history (In stock / Issued / Installed / Returned / Defective), customer/project/warranty tracking and full-history search |
| Surveys | Site survey scheduling, monthly consumption sizing, DISCO & roof assessment, photo attachments, and PDF reports |
| Packages & BOM | Reusable solar package templates ("5kW On-Grid", "10kW Hybrid"), bill-of-materials builder with live inventory selection, net-metering & overheads, and PDF/print view |
| Profit Engine | Authoritative server-side pricing & margin calculations, sales commission, below-cost & low-margin warnings, and owner approval gates |
| Quotations | Professional proposal generator with numbering (`QT-2026-0001`), immutable revision tracking (`Rev 1`, `Rev 2`), snapshot equipment items, optional add-on extras, cash & milestone installment schedules, bilingual Urdu support, WhatsApp share, Nodemailer PDF emailing, and conversion metrics |
| Projects | Project register (`SAL-2026-0001`) at `/projects` with All / Ongoing / Completed / Cancelled tabs, KPI ribbon, customer & salesperson filters. Start projects directly for an existing or new customer, or let quotation approval create one automatically. Tracks system summary, contract value, milestone schedule, equipment snapshot and project stage (`confirmed` → `in_progress` → `completed`). Legacy `/sales` URLs redirect here |
| Installments | Solar financing plans (`IP-2026-0001`), down payments, markup options, automated schedule generation, payment allocations with receipts (`RC-0001`), rescheduling, late fee waivers, and customer statements |
| Collection Calendar | FullCalendar repayment timeline color-coded by stage (due today / upcoming / overdue / paid), with area & customer filters and click-to-collect workflow |
| Cheque Vault | Cheque register (`held`, `deposited`, `cleared`, `bounced`) with a direct **Add cheque** flow that links each cheque to its customer plus the project/sale, POS order and/or installment plan it pays for, maturity tracking, and automatic recovery flagging upon bounced cheques |
| Installment Security | Guarantor records, legal document checklist, mandatory material release gate (blocked until checklist complete or owner override), and dashboard 7-day cheque alerts |
| Recovery & Reminders | Idempotent multi-channel reminder dispatch (`notificationService.js` for WhatsApp Cloud API, Twilio/SMS, Nodemailer, and Dry-Run mode), automated daily `node-cron` schedule (-3d, 0d, +1d, +3d, +7d, +15d), Promise-to-Pay tracking with broken promise detection, call/visit interaction notes, mobile-first Today's recovery queue, and navbar notification bell with alerts for due cheques, low stock, and expiring warranties |
| Installations & Engineering | Full installation project lifecycle (`INS-2026-0001`, `approved` → `material_issued` → `scheduled` → `in_progress` → `completed` → `net_metering_pending` → `commissioned`), warehouse material issue with actual serial number assignment and stock deduction (`OUT` movements), checklist & multimeter testing measurements (Voc, Isc, Earth pit resistance < 5Ω, grid voltage), customer sign-off & 5-star ratings, and downloadable Commissioning Report PDF |
| Warranty Registry | Automatic warranty creation on commissioning per installed serial (panel product 12y, panel 25-yr performance, inverter 5y, battery 5y, workmanship 2y), status tracking (`active`, `expiring`, `expired`, `claimed`), official Warranty Certificate PDF, and warranty claim tracking with replacement serial swap |
| Complaints & Support | Support ticketing (`CMP-2026-0001`), issue categories, automated SLA timers & breach detection (urgent 24h, high 48h, medium 72h, low 7d), automated warranty vs. paid service determination, technician assignment, and resolution with replacement parts inventory deduction |
| Periodic Maintenance | Cleaning and preventive maintenance scheduling (`MNT-2026-0001`), frequency presets, automated 3-day WhatsApp reminders, and technician completion logging |
| Roles | owner, manager, sales, surveyor, technician, accountant, storekeeper |
| Settings | Company identity & logo upload, contact details, NTN/STRN, bank details, quotation/invoice terms |
| Audit | Append-only `AuditLog` with actor snapshot, before/after, IP and user agent; secrets redacted |
| UI | Responsive dark sidebar (role-filtered), sticky topbar with user menu, breadcrumbs, flash partials, reusable table/pagination/delete-modal partials, empty states, 403/404/500 pages |
| Data rules | Soft delete plugin, timestamps, integer-paisa money helpers, server-side stripping of cost/profit fields |

---

## 2. Requirements

- **Node.js 20+** (tested on Node 22)
- **MongoDB 6+** — local install, Docker, or MongoDB Atlas
- npm 10+

---

## 3. Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
copy .env.example .env        # Windows
# cp .env.example .env        # macOS / Linux

# 3. Edit .env — at minimum set MONGODB_URI and SESSION_SECRET
#    Generate a secret:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Create the first owner account (and the settings document)
npm run seed

# 5. Start the app
npm run dev
```

Open <http://localhost:3000>. The seed script prints the owner credentials once. If you did not
set `SEED_OWNER_PASSWORD`, a strong temporary password is generated — change it after signing in.

For a Render Free + MongoDB Atlas deployment, follow
[`docs/render-deployment.md`](docs/render-deployment.md). The repository includes a
`render.yaml` Blueprint and a database-aware `/healthz` endpoint.

### Seeding options

```bash
npm run seed
npm run seed -- --name "Ali Khan" --email owner@company.pk --password "StrongPass123"
npm run seed -- --force        # reset an existing owner's password / role
```

`npm run seed` is safe to re-run: if the account already exists it changes nothing unless
`--force` is passed. `SEED_OWNER_NAME`, `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` and
`SEED_OWNER_PHONE` can also be provided through `.env`.

---

## 4. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables secure cookies, HSTS and hides stack traces |
| `PORT` | `3000` | HTTP port |
| `APP_NAME` | `SolarPro` | Fallback brand name before settings are configured |
| `APP_URL` | `http://localhost:3000` | Public base URL |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/solar_agency` | MongoDB connection string |
| `SESSION_SECRET` | dev fallback | Signing/encryption secret. **Required** in production |
| `SESSION_MAX_AGE_DAYS` | `14` | Session lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost (10–15) |
| `LOGIN_RATE_WINDOW_MINUTES` | `15` | Login rate-limit window |
| `LOGIN_RATE_MAX_ATTEMPTS` | `10` | Failed attempts per window per IP |
| `SEED_OWNER_*` | — | First owner used by `npm run seed` |

---

## 5. Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with nodemon (auto-restart) |
| `npm run seed` | Create the first owner + default settings |
| `npm run seed:force` | Reset the existing owner's password and role |

---

## 6. Roles and permissions

| Capability | Owner | Manager | Sales | Surveyor | Technician | Accountant | Storekeeper |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| User management | ✓ | — | — | — | — | — | — |
| Company settings | ✓ | ✓ | — | — | — | — | — |
| Audit trail | ✓ | — | — | — | — | — | — |
| View costs (`costs.view`) | ✓ | ✓ | — | — | — | ✓ | — |
| View profit (`profit.view`) | ✓ | ✓ | — | — | — | — | — |
| View purchase prices (`purchase_prices.view`) | ✓ | — | — | — | — | ✓ | ✓ |
| Items — browse | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Items / stock — manage | ✓ | ✓ | — | — | — | — | ✓ |
| Stock ledger & serial search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stock adjustments & supplier returns | ✓ | ✓ | — | — | — | — | ✓ |
| Purchases & suppliers — view | ✓ | — | — | — | — | ✓ | ✓ |
| Purchases — create / receive / cancel | ✓ | — | — | — | — | — | ✓ |
| Record purchase payments | ✓ | — | — | — | — | ✓ | — |
| Valuation report (`valuation.view`) | ✓ | — | — | — | — | ✓ | ✓ |
| Customers — view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Customers — manage | ✓ | ✓ | ✓ | — | — | — | — |
| Employees & attendance | ✓ | ✓ (view/mark) | — | — | — | — | — |
| Employee profile management | ✓ | — | — | — | — | — | — |

Two independent mechanisms enforce this:

1. **Route access** — `requireRole()` / `requirePermission()` middleware. Unauthorised requests
   receive the 403 page (never a redirect that hides the failure).
2. **Field visibility** — `utils/sanitize.js` deep-copies results and removes `purchasePrice`,
   `cost`, `profit`, `margin` etc. for roles without `costs.view` / `profit.view`. Use it before
   returning data from controllers/services, and before rendering any document that may contain
   financial fields. Hiding a column in EJS is **not** sufficient.

Permissions are declared once in `config/permissions.js` and shared by middleware, controllers
and views (`can('profit.view')`).

### CRM access rules (Step 2)

- Employees are split into *view/mark attendance* (owner, manager) and *profile management*
  (owner only). The employee page links a staff account 1:1 (`Employee.user` is unique among live
  rows), so one login cannot be attached to two employee profiles.

### Inventory & purchasing access rules (Step 3)

- **Purchase prices are narrower than cost visibility.** `purchase_prices.view` is granted only
  to owner, accountant and storekeeper. The manager has `costs.view` but deliberately **not**
  `purchase_prices.view`, so purchase prices, moving-average cost and stock value never reach a
  manager's responses.
- **Stripping happens in the service.** `itemService`, `stockService` and `serialService` remove
  `purchasePricePaisa`, `avgCostPaisa`, `stockValuePaisa`, `lastPurchasePricePaisa` and movement
  `unitCostPaisa` before documents leave the service layer. Templates hide the columns as well,
  but the server is the control.
- **Cost-bearing pages are route-gated, not just hidden.** `/purchases` and `/suppliers` require
  `purchases.view`; `/stock/valuation` requires `valuation.view`. A manager receives 403 rather
  than an empty-cost version of those pages.
- **Serialised stock is never adjusted by hand.** Adjustments are limited to non-serial items.
  Serialised units move through GRNs, supplier returns and serial status changes, each of which
  writes a ledger movement when the on-hand group changes.
- **Every inventory mutation writes an audit row** (`item.*`, `supplier.*`, `purchase.*`,
  `stock.*`, `serial.*`) with actor, before/after and the document reference.

---

## 7. Project structure

```
solar_agency_software/
├─ app.js                     # Express app, middleware order, lifecycle
├─ config/
│  ├─ app.js                  # Env parsing, limits, paths
│  ├─ db.js                   # Mongoose connection + safe logging
│  ├─ roles.js                # Role names, labels, descriptions, badges
│  ├─ permissions.js          # Capability → roles map
│  ├─ navigation.js           # Sidebar groups (role filtered)
│  ├─ crm.js                  # Customer / employee / attendance enums + labels
│  ├─ inventory.js            # Item, unit, serial, movement and purchase enums + limits
│  └─ auditActions.js         # Canonical audit action keys
├─ models/
│  ├─ User.js                 # bcryptjs, select:false hash, partial unique email
│  ├─ AuditLog.js             # Append-only audit rows
│  ├─ Settings.js             # Singleton company settings
│  ├─ Counter.js              # Atomic per-entity sequence (codes and document numbers)
│  ├─ Customer.js             # CUS-0001 code, contact, GPS, DISCO, type, source
│  ├─ Employee.js             # 1:1 user link, salary paisa, commission bps
│  ├─ Attendance.js           # One live row per employee per UTC day
│  ├─ Supplier.js             # SUP-0001 code, company/contact/NTN, opening balance
│  ├─ Item.js                 # SKU, stock + moving-average cost (paisa), warranty defaults
│  ├─ Purchase.js             # PO lines, GRN receipts, payment totals, status
│  ├─ SerialNo.js             # One row per serialised unit + status event history
│  ├─ StockMovement.js        # Append-only signed ledger with running balance
│  └─ plugins/softDelete.js   # deletedAt/deletedBy + default query filter
├─ services/                  # All business rules (controllers stay thin)
│  ├─ authService.js
│  ├─ userService.js
│  ├─ settingsService.js
│  ├─ auditService.js
│  ├─ dashboardService.js
│  ├─ customerService.js
│  ├─ employeeService.js
│  ├─ supplierService.js      # Supplier CRUD + derived payable balance
│  ├─ itemService.js          # Item CRUD, cost stripping, selector options
│  ├─ purchaseService.js      # PO → GRN, serial validation, average cost, payments
│  ├─ stockService.js         # Ledger, adjustments, supplier returns, valuation
│  └─ serialService.js        # Serial search/history and status transitions
├─ controllers/               # HTTP layer
├─ routes/                    # express.Router modules + guards
├─ middleware/
│  ├─ isAuthenticated.js
│  ├─ requireRole.js
│  ├─ requirePermission.js
│  ├─ loadUser.js
│  ├─ validate.js             # express-validator → flash + redirect back
│  ├─ upload.js               # multer logo upload (images only, 2 MB)
│  ├─ locals.js               # res.locals: user, CSRF, helpers, inventory vocab, flash
│  └─ errorHandler.js         # 404 + central error handling
├─ validators/                # express-validator rule sets
├─ utils/                     # money, dates, inputs, format, sanitize, redact, pagination, urls, serials
├─ views/
│  ├─ layouts/                # admin, auth, bare (errors)
│  ├─ partials/               # flash, breadcrumbs, page-header, table, pagination, delete-modal, form-errors
│  ├─ auth/                   # login, change password
│  ├─ dashboard/
│  ├─ users/                  # index + form
│  ├─ customers/              # index, form, show (8 tabs)
│  ├─ employees/              # index, form, attendance, attendance-summary
│  ├─ items/                  # index, form, show
│  ├─ suppliers/              # index, form, show
│  ├─ purchases/              # index, form, show, receive (GRN)
│  ├─ stock/                  # index (ledger), adjustments, returns, valuation
│  ├─ serials/                # index (search), show (history)
│  ├─ settings/
│  └─ errors/                 # 403, 404, 500
├─ public/
│  ├─ css/app.css
│  ├─ js/app.js               # alerts, delete modal, sidebar, optional flatpickr/DataTables
│  ├─ js/inventory.js         # PO lines/totals, serial counters, CSV import, balance previews
│  └─ uploads/company/        # company logos (runtime)
├─ scripts/seed.js
└─ .env.example
```

### MVC flow

```
route (guards + validators) → controller (HTTP) → service (rules + data) → model
                                     ↓
                              res.render(view)
```

Controllers never talk to Mongoose directly for business logic, and never hash passwords or
write audit rows themselves.

---

## 8. Security decisions

- **Passwords** — bcryptjs with cost 12 (`BCRYPT_ROUNDS`). `passwordHash` is `select: false` and
  stripped again by the model's `toJSON`. Login compares against a dummy hash for unknown emails
  to equalise timing.
- **Sessions** — server-side store in MongoDB (`sessions` collection), encrypted at rest by
  connect-mongo using a SHA-256-derived key. `httpOnly`, `sameSite=lax`, `secure` in production,
  rolling expiry. The session is regenerated on login (session fixation defence).
- **CSRF** — `csurf` with the session store (no cookie). Every state-changing form includes
  `_csrf`; failures render the 403 page with a helpful message. Because the settings form is
  `multipart/form-data`, its token is also sent in the query string (CSRF runs before multer parses
  the body) and the access log redacts it as `_csrf=[redacted]`.
- **Rate limiting** — 10 failed login attempts per IP per 15 minutes; successful logins are not
  counted.
- **Headers** — Helmet with a CSP allowing only self + jsDelivr. `frame-ancestors 'self'`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. HSTS only in production.
  Inline scripts and Alpine require `'unsafe-inline'` (and `'unsafe-eval'` for Alpine); this is a
  deliberate trade-off for a server-rendered EJS app. Move to Alpine's CSP build + nonces if you
  later need a strict policy.
- **Uploads** — images only (JPG/PNG/WEBP/GIF, SVG rejected to avoid stored XSS), 2 MB limit,
  randomised filenames, stored outside the view layer. Old logos are deleted safely (path is
  verified to be inside `public/uploads`).
- **Input** — `express-validator` on every form, escaped output via EJS `<%=`, regex search
  input escaped, `sanitizeFilter` enabled in Mongoose. Internal operator filters (`$in`, `$ne`,
  date ranges) are wrapped in `mongoose.trusted(...)` so the global sanitiser never turns them
  into `$eq` and breaks a query.
- **Soft delete** — records keep history; queries exclude deleted rows by default. Deactivated or
  deleted users lose access on their next request.
- **Audit** — every user/role/credential/settings change writes an `AuditLog` row with
  before/after snapshots. Passwords, hashes and tokens are redacted before storage.

### Currency

All money is stored as **integer paisa** (`1 PKR = 100 paisa`). Use `utils/money.js`:

```js
const { toPaisa, formatPKR } = require('../utils/money');

const priceInPaisa = toPaisa('1,250.50'); // 125050
formatPKR(priceInPaisa);                  // "PKR 1,251" (0 decimals by default)
```

Never store `1250.5` as a Number for money and never do arithmetic on rupee floats.

---

## 9. CRM modules (Step 2)

### Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/customers` | Search, filter (type, city, source, DISCO), paginate |
| GET/POST | `/customers/new`, `/customers` | Create |
| GET | `/customers/:id?tab=overview\|surveys\|quotations\|...` | Profile with tabs |
| GET/POST | `/customers/:id/edit`, `/customers/:id` | Update (`_method=PUT`) |
| POST | `/customers/:id` (`_method=DELETE`) | Soft delete and release the code |
| GET | `/employees` | Employee list |
| GET/POST | `/employees/new`, `/employees` | Create (owner only) |
| GET | `/employees/attendance` | One day's attendance sheet |
| POST | `/employees/attendance` | Upsert each employee's status/check-in/check-out |
| GET | `/employees/attendance/summary?month=YYYY-MM` | Monthly totals + attendance rate |

### Data rules

- **Customer codes** are generated atomically from `Counter` (`CUS-0001`, `CUS-0002`, …).
  The unique index is partial on `deletedAt: null`, so a soft-deleted customer releases its code.
- **Salary** is stored as integer paisa; **commission** as integer basis points
  (`2.5% → 250 bps`). Form inputs accept rupees/percent and are converted in the service.
- **Attendance** stores `date` at UTC midnight for the company-timezone (`Asia/Karachi`) day.
  Dates come from `utils/dates.js` (`todayKey`, `dayRange`, `monthKey`, `monthRange`), so
  "today" never drifts between the browser and the server. One live row per employee per day.
- **Soft delete** covers every CRM model. Dashboard aggregations explicitly
  include `{ deletedAt: null }` because Mongoose query middleware does not run on pipelines.
- **Audit** actions: `customer.*`, `employee.*`, and `attendance.*`
  (see `config/auditActions.js`). Every mutation stores before/after snapshots.

---

## 10. Inventory & purchasing modules (Step 3)

### Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/items` | Item catalogue with search, category/brand/stock filters and low-stock highlighting |
| GET/POST | `/items/new`, `/items` | Create an item (owner, manager, storekeeper) |
| GET | `/items/:id` | Item detail: stock, ledger, serials, purchase history |
| GET/PUT | `/items/:id/edit` (`_method=PUT`) | Update an item |
| DELETE | `/items/:id` (`_method=DELETE`) | Soft delete an item |
| GET | `/suppliers` | Supplier list with derived payable balances |
| GET/POST | `/suppliers/new`, `/suppliers` | Create a supplier |
| GET | `/suppliers/:id` | Supplier profile, purchases and returns |
| GET/PUT | `/suppliers/:id/edit` | Update a supplier |
| DELETE | `/suppliers/:id` | Soft delete a supplier |
| GET | `/purchases` | Purchase-order list with status, payment and date filters |
| GET/POST | `/purchases/new`, `/purchases` | Raise a PO (status `ordered`, no stock movement) |
| GET | `/purchases/:id` | PO detail, GRN history, serials, payment status |
| GET/PUT | `/purchases/:id/edit` | Edit an order before any receipt |
| GET/POST | `/purchases/:id/receive` | Post a GRN: quantities, serials, location, invoice |
| POST | `/purchases/:id/payments` | Record a supplier payment (owner, accountant) |
| POST | `/purchases/:id/cancel` | Cancel an order before any receipt |
| GET | `/stock` | Append-only stock ledger with item/type/date filters |
| GET/POST | `/stock/adjustments` | Non-serial stock adjustment (`ADJ-0001`) |
| GET/POST | `/stock/returns` | Supplier return (`RET-0001`), serial-aware |
| GET | `/stock/valuation` | On-hand value at moving-average cost (owner, accountant, storekeeper) |
| GET | `/serials` | Serial search: serial, item, status, supplier, customer, project |
| GET | `/serials/:id` | Full serial history, warranty dates and linked movements |
| POST | `/serials/:id/status` | Move a serial through its lifecycle |

### Data rules

- **Item and supplier identity.** SKUs and supplier codes are uppercase and unique among live
  rows (partial index on `deletedAt: null`). Document numbers come from `Counter`:
  `SUP-0001`, `PO-0001`, `GRN-0001`, `ADJ-0001`, `RET-0001`.
- **Moving average cost.** `Item.avgCostPaisa` is denormalised integer paisa and only moves on a
  GRN:
  `(oldQty × oldAvg + receivedQty × unitCost) ÷ (oldQty + receivedQty)`, rounded to paisa.
  `lastPurchasePricePaisa` records the latest GRN cost. Catalogue `purchasePricePaisa` is never
  used to rewrite history.
- **Signed ledger.** `StockMovement.qty` is positive for IN, negative for OUT/RETURN and either
  sign for ADJUSTMENT. `balanceAfter` snapshots the resulting item balance so the ledger page
  never replays history. Movements are append-only: no edit or delete route exists.
- **PO → GRN.** Creating a PO writes no stock. A GRN receives one or more lines, writes IN
  movements, updates stock and average cost, and advances the PO to `partial` or `received`.
  Over-receiving a line is rejected; a GRN cannot be edited after posting.
- **Serial validation.** Serialised lines accept whole units only. Serial numbers can be pasted
  one per line or imported from the first CSV column; a `Serial`/`Serial No` header is ignored,
  values are uppercased and must match `^[A-Z0-9][A-Z0-9._/-]{1,59}$`. Duplicates are rejected
  within the input, across lines and against existing (including soft-deleted) serials. The
  entered count must exactly equal the received quantity. At most 500 serials per line.
- **Server-side cost redaction.** Item and stock-movement cost fields are removed in services
  before rendering any page available to roles outside owner, accountant and storekeeper,
  including serial history and recent adjustment/return lists.
- **Serial stock effect.** `in_stock` and `defective` count as on-hand; `issued`, `installed` and
  `returned` are deployed. Changing a serial between those groups writes a ±1 ledger movement.
  Supplier returns set selected serials to `returned` and post the RETURN movement directly.
- **Warranty defaults.** Each serial copies the item's product/performance warranty years and
  stamps the end dates at receipt, so later item edits cannot change an installed unit's cover.
- **Supplier payable is derived, never stored:**
  `opening balance + Σ(live purchase totals) − Σ(payments)`. It therefore cannot disagree with
  the purchase records.
- **Status vocabulary.** Purchase: `ordered`, `partial`, `received`, `cancelled`. Payment:
  `unpaid`, `partial`, `paid`, derived from paid amount vs total. Cancellation is allowed only
  while no stock has been received.
- **Adjustments are for non-serial items only** and can never take a balance below zero.
  Serialised stock moves through GRNs, supplier returns and serial status changes.
- **No multi-document transactions.** The development database is a standalone `mongod`, so PO
  receipts validate every line and serial before writing, then write serials → movements → item
  balances → purchase. Failures surface as a flash message rather than a partial silent write.
- **Mongoose specifics.** `sanitizeFilter` is global, so internal operator filters use
  `mongoose.trusted(...)`. Aggregations (valuation, payable totals) explicitly filter
  `{ deletedAt: null }` because the soft-delete plugin does not run on pipelines.
- **Audit** actions: `item.*`, `supplier.*`, `purchase.*`, `stock.*`, `serial.*`
  (see `config/auditActions.js`). Every mutation stores before/after snapshots.

---

## 11. Site Survey module (Step 4)

- `/surveys` provides a paginated table; `/surveys/calendar` provides a month view.
- Owners, managers and sales staff can schedule surveys. Owners, managers and the assigned
  surveyor can complete the mobile field form. Surveyor queries are always scoped by user ID.
- Four categorized photo inputs accept JPG/PNG images only, up to 5 MB each and five per type.
  Rejected submissions remove temporary uploads; saved photos appear in the detail gallery.
- The 12-month sizing suggestion uses Settings values for expected monthly units per installed
  kW, design buffer percentage and kW rounding step. The server recalculates the suggestion.
- `/surveys/:id/report.pdf` streams a letterheaded PDF with contact, roof, electricity,
  recommendation and photograph sections.
- The quotation action in survey detail links directly into the System Builder (`/system-builder?survey=:id`).

---

## 12. Solar System Builder, Pricing & Profit (Step 5)

- **Package templates (`models/Package.js`)**: Reusable templates (e.g. "5kW On-Grid Standard", "10kW On-Grid", "6kW Hybrid") with pre-assigned items, quantities, installation labor, transport, and net-metering cost allowances.
- **System Builder page (`/system-builder`)**: Interactive EJS + Alpine.js interface for building custom solar systems. Allows adding items from live inventory, customizing quantities, overriding selling prices, and observing live system metrics (kW capacity, panel count, estimated daily/monthly/yearly unit generation, and pricing).
- **Template & Survey loader**: Preload system designs directly from a package template or site survey (`?survey=:id` or `?package=:id`), pre-populating customer references, recommended kW, and equipment lines.
- **Server-side profit service (`services/profitService.js`)**: Per-line and per-system calculation of item cost, selling price, gross margin, labor, transport, net-metering fee, discount, and sales commission. Client-side Alpine.js provides instant preview while server calculations remain authoritative.
- **Role-aware field visibility**: Owner and accountant receive cost, base cost, commission, net profit, and profit margin % fields. Sales receives only selling prices, discount, and system specifications.
- **Margin & discount approval rules**:
  - Below-cost warning when selling price < total cost.
  - Low-margin warning when net profit margin is below configured company minimum (`minMarginPercent`).
  - Owner approval required when discount exceeds configurable threshold (`maxDiscountPercentWithoutApproval`), marking system as `pending` until approved by an owner (`/system-configs/:id/approve`).
- **Bill of Materials (BOM) & Print (`models/SystemConfig.js`)**: Saved systems (`SYS-0001`) with full BOM item snapshots, commercial summary, and printable proposal view (`/system-configs/:id/print`) optimized for print and PDF generation.

---

## 13. Adding a new module (pattern to follow)

1. **Model** — add `models/Quote.js` with `{ timestamps: true }` and
   `schema.plugin(require('./plugins/softDelete'))`.
2. **Service** — `services/quoteService.js`: validation rules that span documents, cost/profit
   sanitisation, audit calls.
3. **Controller** — `controllers/quoteController.js` using `asyncHandler`; call
   `sanitizeForRole(result, req.user.role)` before rendering.
4. **Validators** — `validators/quoteValidators.js` using `express-validator`.
5. **Routes** — `routes/quotes.js`, guarded with `isAuthenticated` and `requireRole([...])`.
   Mount it in `routes/index.js`.
6. **Navigation** — add an item to `config/navigation.js` with the allowed roles.
7. **Views** — `views/quotes/index.ejs` + `form.ejs`, reusing `partials/page-header`,
   `partials/table`, `partials/pagination`, `partials/delete-modal` and `partials/form-errors`.
8. **Audit** — add action keys to `config/auditActions.js` and call `logAction(...)`.

List pages must use server-side pagination (`utils/pagination.js`) — not client-side DataTables —
so large collections stay fast.

---

## 13. Troubleshooting

| Problem | Fix |
| --- | --- |
| `MongooseServerSelectionError` | MongoDB is not running or `MONGODB_URI` is wrong. Start `mongod` / the MongoDB service, or check the Atlas IP allow-list. |
| Login says "session expired / invalid token" | Cookies are disabled, or the session store was cleared. Refresh the page and try again. |
| `SESSION_SECRET must be set…` | Set a long random `SESSION_SECRET` when `NODE_ENV=production`. |
| Logo upload rejected | Only JPG, PNG, WEBP or GIF up to 2 MB are accepted. SVG is intentionally blocked. |
| Cannot delete/demote the owner | The system always keeps at least one **active owner**. Create or promote another owner first. |
| Styles/scripts blocked by CSP | CSP only allows `'self'` for scripts, so vendor the library in `node_modules`, mount it under `/vendor/*` in `app.js`, and reference that path. Do not add external CDN hosts. |
| Uploaded logos not appearing | Ensure `public/uploads/company` exists and the app process can write to it. |
| GRN says the serial count does not match | Enter exactly the received quantity for that line, one serial per line (or CSV first column). Blank lines and the header are ignored. |
| Serial rejected as a duplicate | Serial numbers must be unique across the whole catalogue, including soft-deleted rows. Search `/serials` before re-entering. |
| Purchase page returns 403 | Your role lacks `purchases.view` (`purchase_prices.view`). Only owner, accountant and storekeeper can open cost-bearing purchase pages. |
| Cannot adjust a serialised item | By design. Receive, return or change the serial's status instead; each action writes the ledger movement. |
| Stock balance looks wrong after an import | Check the ledger for the item (`/stock?item=…`). Every movement stores `balanceAfter`; adjustments require a reason. |

## 14. Accounts, General Ledger & Executive Dashboard (Step 10)

- **Double-Entry General Ledger (`services/accountingService.js`)**:
  - Strict double-entry invariant: Total Debits must strictly equal Total Credits down to the exact integer paisa.
  - Standard Pakistani Solar Chart of Accounts (COA) with 15 pre-configured accounts:
    - Assets: Cash in Hand (`1010`), Bank Alfalah (`1020`), Accounts Receivable (`1030`), Inventory Asset (`1040`)
    - Liabilities: Accounts Payable (`2010`), Customer Advances (`2020`), Accrued Payroll & Commissions (`2030`)
    - Equity: Owner's Capital (`3010`), Retained Earnings (`3020`)
    - Revenue: Solar Installation Revenue (`4010`), After-Sales & Maintenance Income (`4020`), Late Payment Fees (`4030`)
    - Cost of Goods Sold (COGS): Solar Hardware COGS (`5010`), Direct Installation Labor (`5020`), Freight & Net Metering (`5030`)
    - Operating Expenses (OPEX): Salaries & Staff Wages (`6010`), Sales Commission (`6020`), Office Rent & Utilities (`6030`), Travel & Fuel (`6040`), Marketing & Ads (`6050`), Office Supplies (`6060`)
- **Automated Event-Driven Double-Entry Postings**:
  - `Sale Approved`: Dr Accounts Receivable (`1030`) / Cr Solar System Revenue (`4010`) + Dr COGS (`5010`) / Cr Inventory Asset (`1040`)
  - `Customer Payment`: Dr Cash in Hand (`1010`) or Bank Alfalah (`1020`) / Cr Accounts Receivable (`1030`) (+ Cr Late Fee Income `4030` if penalty assessed)
  - `Purchase GRN`: Dr Inventory Asset (`1040`) / Cr Accounts Payable (`2010`)
  - `Supplier Payment`: Dr Accounts Payable (`2010`) / Cr Cash (`1010`) or Bank (`1020`)
  - `Expense Recorded`: Dr Operating Expense (`6010`-`6060`) / Cr Cash (`1010`) or Bank (`1020`)
  - `Salary Disbursed`: Dr Salaries Expense (`6010`) / Cr Cash (`1010`) or Bank (`1020`)
  - `Sales Commission`: Dr Sales Commission (`6020`) / Cr Cash (`1010`) or Bank (`1020`)
  - `Service Charge Billed`: Dr Cash (`1010`) or AR (`1030`) / Cr Service Income (`4020`)
- **Financial Statements & Ledgers (Web, CSV, and PDFKit Export)**:
  - **Trial Balance (`/accounting/trial-balance`)**: As-of-date balance verification proving debits equal credits. Exportable to PDF and Excel CSV.
  - **Profit & Loss Statement (`/accounting/profit-loss`)**: Date-range Income Statement showing Revenue, COGS, Gross Margin %, Operating Expenses, and Net Operating Margin %. Exportable to PDF and CSV.
  - **Cash Book (`/accounting/cash-book`)**: Ledger of Cash in Hand (`1010`), opening balance, chronological ins/outs, running balance, and closing physical balance. Exportable to PDF and CSV.
  - **Bank Book (`/accounting/bank-book`)**: Bank Alfalah checking account register (`1020`) tracking deposits, clearing cheques, and vendor transfers. Exportable to PDF and CSV.
  - **Daily Closing Sheet (`/accounting/daily-closing`)**: End-of-day cash drawer reconciliation sheet comparing expected cash against physical count with cashier and branch manager signature lines. Exportable to PDF.
  - **Salary & Commission Sheet (`/accounting/salary-sheet`)**: Monthly payroll sheet tracking attendance days, sales performance volume, earned commission, disbursements, and net payable balances.
  - **Accounts Receivable (`/accounting/receivables`)**: Aging customer balances with days overdue and profile links. Exportable to CSV.
  - **Accounts Payable (`/accounting/payables`)**: Supplier bill balances with days overdue and one-click payment action. Exportable to CSV.
- **Executive & Multi-Role Dashboards**:
  - **Owner & Manager Executive Dashboard**: KPI cards for sales, collections, recovery, profit, stock, installations, and complaints; Chart.js trends and Live Operational Alerts Panel.
  - **Sales Dashboard**: Sanitized metrics for personal quotations, won contracts, and sales volume. Zero cost or profit figures are exposed.
  - **Technician Dashboard**: My Assigned Installations, Active Complaint Tickets, and direct mobile job dispatch links.
  - **Storekeeper Dashboard**: Low stock SKU warnings, pending PO receipts (GRN), today's movement counts, and serial status breakdown.
  - **Surveyor Dashboard**: Today's scheduled surveys, pending field visits, and completed surveys this month.
  - **Accountant Dashboard**: Liquid Cash in Hand, Bank Alfalah balance, Total AR, Total AP, Today's Collections, and Pending Vendor Bills.

---

## 15. Role-by-Role User Guide

### 👑 1. Business Owner (`owner@solar.com.pk`)
- **Primary View**: Executive Dashboard with top-level financial KPIs, revenue vs. collection trends, profitability margins, and urgent operational alerts.
- **Authority**:
  - Full system administration (User creation, password resets, role assignment).
  - Approving system configurations that exceed sales discount thresholds (`/system-configs/:id/approve`).
  - Granting legal security overrides for material release on installment sales (`/installments/:id/override`).
  - Viewing the full Audit Trail with actor IPs and before/after mutation snapshots.
  - Reviewing the official Trial Balance, Profit & Loss Statement, and Daily Safe Closing.

### 👔 2. Branch Manager (`manager@solar.com.pk`)
- **Primary View**: Executive Dashboard & Operations Hub.
- **Authority**:
  - Overseeing customer sales activity and scheduling site surveys.
  - Approving customer quotations and issuing confirmed project contracts.
  - Rescheduling installment plans and granting late-fee waivers with audit justification.
  - Monitoring technician installation progress, reviewing multimeter readings, and countersigning commissioning reports.
  - Conducting end-of-day cash drawer counts and signing the Daily Closing report (`/accounting/daily-closing`).

### 💼 3. Sales Consultant (`sales@solar.com.pk`)
- **Primary View**: Sales & CRM Console.
- **Workflow**:
  1. Create or open a customer record and request a technical site survey.
  3. Load the survey or package template into the **System Builder** (`/system-builder`) to configure panels, inverters, and battery sizing.
  4. Generate and send professional quotations (`QT-2026-0001`) with customized milestone plans.
  5. Share proposals via one-click WhatsApp (`wa.me`) or automated PDF email dispatch.
  6. Track personal sales volume and earned performance commissions (`/accounting/salary-sheet`).
- **Privacy Enforcement**: Sales users **never** see wholesale purchase costs, supplier prices, or net margins.

### 📐 4. Technical Site Surveyor (`surveyor@solar.com.pk`)
- **Primary View**: Mobile-friendly Survey Schedule (`/surveys`).
- **Workflow**:
  1. Open scheduled survey on mobile browser upon arrival at customer premises.
  2. Record 12 months of electricity consumption from the utility bill (LESCO, K-Electric, FESCO, IESCO).
  3. Measure roof dimensions, note roof azimuth, structure type, and test for shadow obstructions.
  4. Upload 4 mandatory photo sets: Roof, Utility Meter, Main Distribution Board (DB), and Electricity Bill.
  5. Review the system's automated sizing suggestion and submit the completed survey for quotation.

### ⚡ 5. Solar Installation Technician (`technician@solar.com.pk`)
- **Primary View**: Installation Projects (`/installations`), scoped to assigned jobs.
- **Workflow**:
  1. View assigned installation projects with customer address and one-tap phone calling (`tel:`).
  2. Confirm site delivery of solar panels, inverters, and mounting structures with the storekeeper.
  3. Execute installation checklist: civil structure mounting, DC string cabling, inverter mounting, and AC breaker connections.
  4. Perform multimeter commissioning tests: record Open-Circuit Voltage ($V_{oc}$), Short-Circuit Current ($I_{sc}$), Earth Pit Resistance ($< 5\Omega$), and AC Grid Voltage.
  5. Capture customer signature on glass, submit commissioning report, and auto-activate warranties.
  6. Inspect and resolve warranty complaint tickets (`/complaints`), swapping defective parts and logging resolution notes.

### 📦 6. Storekeeper & Warehouse In-Charge (`storekeeper@solar.com.pk`)
- **Primary View**: Inventory, Stock Ledger & Serial Number Vault.
- **Workflow**:
  1. Receive Goods Received Notes (GRN) on purchase orders (`/purchases`), entering or pasting panel and inverter serial numbers.
  2. Monitor minimum stock thresholds and flag low-stock reorder warnings.
  3. Issue materials for approved installation projects (`/installations/:id`), scanning or selecting specific serial numbers from stock.
  4. Perform inventory stock adjustments for non-serial consumables (cables, MC4 connectors, breakers).
  5. Process supplier returns for defective units (`/stock/returns`).

### 📊 7. Head Accountant (`accountant@solar.com.pk`)
- **Primary View**: Accounting Dashboard (`/accounting/dashboard`).
- **Workflow**:
  1. Audit daily cash receipts and bank deposits from customer installment collections.
  2. Record operating expenses (`/accounting/expenses`) with uploaded vendor receipts and bills.
  3. Disburse payments to equipment suppliers against outstanding purchase bills (`/accounting/supplier-payments`).
  4. Manage the physical Cash in Hand Book (`1010`) and Bank Alfalah Book (`1020`).
  5. Review maturing post-dated cheques in the Cheque Vault (`/installments/cheques`).
  6. Process monthly staff salaries and performance sales commissions (`/accounting/salary-sheet`).
  7. Generate monthly Profit & Loss Statements and verify Trial Balance equality ($\sum \text{Dr} == \sum \text{Cr}$).

---

## 16. Production Deployment & Operations Guide

### 1. Production Architecture Overview
```
Internet ──► Nginx (Port 80/443 SSL) ──► PM2 Cluster (Node.js app.js :3000) ──► MongoDB (:27017)
                     │                                   │
             Let's Encrypt TLS                   Winston / Morgan Logs
             Static Asset Cache                  Nightly mongodump Backup
             Upload Limiter (25M)                Daily node-cron Reminders
```

### 2. Environment Configuration
Create `/var/www/solar-agency-software/.env`:
```ini
NODE_ENV=production
PORT=3000
APP_NAME="PakSolar Dynamics"
APP_URL=https://solar.example.com
MONGODB_URI=mongodb://127.0.0.1:27017/solar_agency_prod
SESSION_SECRET=c8f8b89d4e2a1b9f7c6e5d4a3b2c1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a
SESSION_MAX_AGE_DAYS=14
BCRYPT_ROUNDS=12
LOGIN_RATE_WINDOW_MINUTES=15
LOGIN_RATE_MAX_ATTEMPTS=10
BACKUP_RETENTION_DAYS=14
NOTIFICATION_DRIVER=dry_run
```

### 3. Process Management with PM2
```bash
# Start cluster with automatic CPU scaling
pm2 start ecosystem.config.js --env production

# Enable automatic systemd service restart on server reboot
pm2 startup systemd
pm2 save
```

### 4. Automated Daily Database Backups
The system includes an automated backup engine in `scripts/backup.js` scheduled via cron at **02:00 AM daily**:
- Dumps database to compressed archive: `backups/backup-YYYY-MM-DD-HHmmss.gz`.
- Prunes archives older than `BACKUP_RETENTION_DAYS` (14 days).
- Manual backup execution:
  ```bash
  npm run backup
  ```

### 5. Production Reverse Proxy with Nginx & SSL
Detailed step-by-step Nginx reverse proxy, Certbot SSL configuration, WebSocket support, and caching directives are provided in [`docs/nginx-https-guide.md`](file:///c:/Users/AGC/Downloads/solar_agency_software/docs/nginx-https-guide.md).

---

## 17. End-to-End Test & Verification Checklist

Follow this complete lifecycle test to verify all 12 modules from initial customer acquisition to financial daily closing:

- [ ] **Stage 1: Customer Registration**
  - Sign in as `sales@solar.com.pk`.
  - Navigate to `/customers/new` and create customer "Chaudhry Tariq" in DHA Phase 6, Lahore.

- [ ] **Stage 2: Technical Site Survey & Load Sizing**
  - Schedule a survey for the customer (`/surveys/new`) assigning surveyor `surveyor@solar.com.pk`.
  - Sign in as `surveyor@solar.com.pk` and open `/surveys`.
  - Input 12-month utility bill units (average: 850 kWh/month).
  - Verify automated sizing suggestion calculates **10.44 kW** based on configured buffer and step.
  - Upload roof, meter, DB, and bill photos. Submit survey as `completed`.
  - Verify Survey Report PDF streams cleanly with photos (`/surveys/:id/report.pdf`).

- [ ] **Stage 3: System Builder & BOM Pricing**
  - From the completed survey, click **"Build System from Survey"**.
  - In `/system-builder`, verify 18x 580W Longi panels and 1x Huawei 10kW inverter are loaded.
  - Verify live calculations: Capacity = 10.44 kW, estimated monthly generation = 1,260 units.
  - Verify sales users cannot see cost or profit margins. Save system as `SYS-2026-0001`.

- [ ] **Stage 4: Professional Quotation Generation & Revision**
  - Convert system into a Quotation (`QT-2026-0001`, Rev 1).
  - Add optional extra: "AC/DC Type II Surge Protection Devices".
  - Select Milestone payment plan: 35% Advance Booking, 50% Material Delivery, 15% Net Metering Commissioning.
  - Generate and inspect Quotation PDF (`/quotations/:id/pdf`). Verify letterhead, logo, item table, and Urdu terms.
  - Test WhatsApp share link (`wa.me`) and email dispatch.

- [ ] **Stage 5: Quotation Approval & Automatic Project Creation**
  - Sign in as `manager@solar.com.pk` and approve the quotation (`/quotations/:id/approve`).
  - Verify confirmed Sale record (`SALE-2026-0001`) is automatically created with immutable equipment snapshots.
  - Verify double-entry journal entry is automatically posted in the ledger: Dr Accounts Receivable (`1030`) / Cr Solar System Revenue (`4010`).

- [ ] **Stage 6: Installment Financing Plan & Cheque Vault**
  - Navigate to `/installments/new` for customer "Haji Abdul Rehman".
  - Configure 12-month installment schedule with 15% markup and 200,000 PKR down payment.
  - Complete legal document checklist (stamp paper, CNIC copies, utility bill, guarantor verification).
  - Register Post-Dated Cheque (PDC) in the Cheque Vault (`/installments/cheques`).
  - Verify dashboard displays 7-day maturing cheque notification widget.

- [ ] **Stage 7: Field Installation & Serialized Material Issuance**
  - Sign in as `manager@solar.com.pk` and open confirmed sale. Click **"Create Installation Project"**.
  - Project `INS-2026-0001` created in status `approved`. Assign lead technician `technician@solar.com.pk`.
  - Storekeeper issues materials (`/installations/:id/material-issue`), assigning 18 Longi panel serials and 1 Huawei inverter serial.
  - Verify stock ledger writes `OUT` movements and deducts warehouse inventory.
  - Attempting material issue on an installment project without completed security checklist correctly blocks release.

- [ ] **Stage 8: Multimeter Commissioning & Auto-Warranty Activation**
  - Sign in as `technician@solar.com.pk` and open the assigned installation (`/installations`).
  - Complete installation checklist and record commissioning readings ($V_{oc} = 440\text{V}$, $I_{sc} = 13.2\text{A}$, Earth Pit Resistance = $2.8\Omega$).
  - Obtain customer digital signature on glass and mark installation `commissioned`.
  - Verify system automatically provisions Warranty records for all installed serial numbers (Panel: 25 years, Inverter: 5 years).
  - Download official Warranty Certificate PDF (`/warranties/:id/certificate.pdf`).

- [ ] **Stage 9: Automated Recovery Reminders & Recovery Queue**
  - Run automated reminder audit (`/recovery/cron/run` or `node-cron` 09:00 AM job).
  - Verify idempotent notification logs are created without duplicate dispatches.
  - Open mobile-friendly Today's Recovery Queue (`/recovery/today`).
  - Test Promise-to-Pay (PTP) recording and follow-up interaction notes.

- [ ] **Stage 10: Payment Receipt Collection & Official PDF**
  - Collect installment payment via Cash / Bank (`/installments/:id/collect`).
  - Verify system calculates principal vs. late fee allocation.
  - Generate official Payment Receipt PDF (`/installments/receipts/:id/pdf`) displaying amount in Pakistani words and remaining balance.
  - Verify double-entry auto-posting: Dr Cash in Hand (`1010`) / Cr Accounts Receivable (`1030`).

- [ ] **Stage 11: After-Sales Service & Warranty Claim Resolution**
  - Create support complaint ticket (`CMP-2026-0001`) for inverter warning.
  - Verify SLA timer is assigned based on priority (Urgent: 24h, High: 48h).
  - Resolve ticket with replacement surge protector part used from inventory.
  - Verify part is deducted from warehouse stock and journal entry is posted for service charge.

- [ ] **Stage 12: General Ledger Audit & Daily Closing**
  - Sign in as `accountant@solar.com.pk`.
  - Open Trial Balance (`/accounting/trial-balance`). Verify Total Debits equal Total Credits.
  - Open Profit & Loss Statement (`/accounting/profit-loss`). Verify Gross Margin and Net Operating Profit.
  - Open Cash Book (`/accounting/cash-book`) and Bank Book (`/accounting/bank-book`). Verify running balances.
  - Perform Daily Closing (`/accounting/daily-closing`). Reconcile expected cash against safe count and download signed PDF.

## 18. Multi-Branch Inventory and Fast POS

The daily shopkeeping workflow is part of this application and shares the existing item,
purchase, stock-ledger, user, accounting, and dashboard data.

| Route | Purpose |
| --- | --- |
| `/branches` | Main Agency and sub-branch setup, assigned managers, branch stock |
| `/brands` | Managed solar brands linked to catalogue items |
| `/transfers` | Immediate, audited stock transfers between branches |
| `/pos` | Retail/wholesale POS history, branch/date filters and profit totals |
| `/pos/new` | Fast counter sale with discounts, payments and automatic stock deduction |

Items now store purchase/default cost, wholesale price, retail price, and the maximum
discount a shopkeeper may apply. A completed POS sale snapshots its listed price, final
price, discount, cost, and actual profit, so later catalogue changes do not rewrite history.
POS completion and cancellation automatically post balanced accounting entries.

### Existing-data migration

The application creates `Main Agency` lazily when the commerce pages are first used. For
an existing installation, run this idempotent command once before staff begin branch work:

```bash
npm run migrate:commerce
```

It converts existing typed brand names to managed Brand records, copies existing item
stock to the Main Agency branch balance, and initializes wholesale/retail prices from the
old selling price when those fields are empty. It does not delete existing stock history.

#   E c o - s o l a r - a g e n c y  
 