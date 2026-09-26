# PharmaDesk — System Architecture

PharmaDesk is an **offline-first desktop pharmacy management system**: point of sale,
batch-based inventory with FEFO, purchasing, suppliers, customers/prescriptions,
expenses, cash drawer management, accounting-grade profit reporting, audit logging,
and backup/restore. It runs entirely on the pharmacy computer. Internet access is
never required for any pharmacy operation.

> Companion documents
> - [`DATABASE.md`](./DATABASE.md) — ERD, schema, conventions
> - [`BUSINESS_RULES.md`](./BUSINESS_RULES.md) — inventory, pricing, profit, cash, returns rules
> - [`USER_GUIDE.md`](./USER_GUIDE.md) — installing and operating the application

---

## 1. Goals and non-goals

| Goals (v1) | Non-goals (v1, architected for later) |
|---|---|
| Every workflow works with no network | Cloud backup, multi-branch sync |
| Single source of truth: local SQLite file | Online dashboard / mobile companion |
| Batch-level traceability for every unit of stock | SMS / WhatsApp notifications |
| Financial correctness (integer money, transactions, no deletes) | E-commerce, supplier EDI, loyalty |
| Very fast, keyboard-driven POS | Accounting-software export (hook points exist) |
| Installable on Windows with no developer tools | |

## 2. Technology decisions

| Concern | Choice | Why |
|---|---|---|
| Desktop shell | **Electron 44** | Mature, Chromium printing (thermal + A4), Windows installers via electron-builder |
| UI | **React 19 + TypeScript + Tailwind CSS 4** | Component model, strict typing, design-token driven styling |
| UI primitives | **Radix UI** (dialog, menu, select, tabs, tooltip…) | Accessible, unstyled primitives → fully custom premium design |
| Data fetching (renderer) | **TanStack Query** | Caching, loading/error states, invalidation after mutations |
| Local UI state | **Zustand** | POS cart, session, preferences |
| Charts | **Recharts** | Declarative React charts |
| Database | **SQLite (better-sqlite3 13)** | Embedded, zero-admin, ACID, WAL. v13 ships **N-API prebuilt binaries for every platform**, so the same binary works in Node (tests) and Electron and cross-packaging for Windows needs no compiler |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Type-safe schema & queries, plain SQL migrations shipped with the app and applied at startup. Chosen over Prisma because Prisma needs a separate query-engine binary and its CLI to migrate on end-user machines, both fragile inside a packaged Electron app |
| Validation | **Zod 4** (shared by main + renderer) | One schema validates forms in the UI and **re-validates every request in the main process** |
| Password hashing | **Node `crypto.scrypt`** (N=2¹⁵, r=8, p=1, 16-byte salt) | Memory-hard KDF, no native dependency |
| Excel export | **ExcelJS** | Pure JS .xlsx writer |
| PDF / printing | Chromium `printToPDF` / `webContents.print` on generated HTML | Same HTML template for preview, printer and PDF; supports 58/80 mm thermal and A4 |
| Barcodes | **bwip-js** (SVG, in main process) | Code128/EAN label generation without a DOM |
| Localization | **i18next** | English now; Urdu (RTL) added by dropping in a resource file |
| Packaging | **electron-builder (NSIS)** | Standard Windows installer with Start-menu/desktop shortcuts |
| Tests | **Vitest** (real SQLite, temp files) + **Playwright for Electron** (offline smoke test) | Business logic tested against the real database engine |

## 3. Process model

```
┌──────────────────────────────── Electron app (single Windows process tree) ───────────────────────────────┐
│                                                                                                             │
│  Renderer process (sandboxed Chromium)                  Main process (Node.js — trusted)                    │
│  ┌───────────────────────────────────┐                 ┌──────────────────────────────────────────────────┐ │
│  │ React UI (no Node access)         │                 │ IPC router                                        │ │
│  │  features/*  pages & components   │  invoke(ch,req) │  • channel allow-list                             │ │
│  │  lib/api.ts  typed client ────────┼──contextBridge──┼─▶• session check  • permission check              │ │
│  │  TanStack Query cache             │ ◀── Result ─────┼──• Zod validation • error normalisation           │ │
│  └───────────────────────────────────┘                 │                                                    │ │
│              ▲ preload (contextIsolation,              │ Services (pure business logic, no Electron)       │ │
│              │ exposes window.pharmacy only)           │  auth · products · inventory(FEFO) · purchases    │ │
│                                                        │  sales · returns · customers · prescriptions      │ │
│                                                        │  expenses · cash · payments · reports · audit     │ │
│                                                        │                                                    │ │
│                                                        │ Infrastructure                                     │ │
│                                                        │  Drizzle + better-sqlite3 ──▶ pharmacy.db (WAL)    │ │
│                                                        │  printing (hidden windows) · backup · scheduler    │ │
│                                                        └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

* **The main process is the only place business rules and money calculations run.**
  The renderer asks for a *quote* (e.g. POS totals) and displays what the main process
  computed. When the sale is committed the main process recomputes everything inside a
  database transaction and rejects the request if the result differs from the quote the
  cashier saw (e.g. stock changed).
* **Services are framework-free.** Every service function has the signature
  `fn(ctx: ServiceContext, input)` where `ctx` carries the Drizzle db handle, the acting
  user and a clock. The same functions run in Electron and in Vitest.
* **IPC handlers are thin adapters**: validate input with the shared Zod schema, check the
  session and permission, call the service, wrap the result as
  `{ ok: true, data } | { ok: false, error: { code, message, fields? } }`.

## 4. Security model

| Layer | Measure |
|---|---|
| Electron | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; strict Content-Security-Policy (no remote origins); `will-navigate` and `setWindowOpenHandler` block navigation / new windows; permission requests (camera, geolocation…) denied; DevTools disabled in production builds |
| Preload | Exposes a single frozen object `window.pharmacy` with `invoke(channel, payload)` and `on(event, cb)`. Channels are checked against a generated allow-list — no raw `ipcRenderer`, no Node APIs |
| Network | All outbound web requests from renderers are blocked at the session level (`webRequest.onBeforeRequest`) except the local dev server in development. Guarantees offline behaviour and prevents data exfiltration |
| Authentication | scrypt password hashes; failed-attempt lockout; forced password change for seeded/default and admin-reset accounts |
| Session | Held **only in the main process**. Idle auto-lock (configurable) requires re-entering the password; the renderer cannot forge a user |
| Authorisation | Fine-grained permission keys (e.g. `sales.void`, `stock.adjust`). Every IPC channel declares the permission it requires; roles are configurable in the UI |
| Supervisor override | Sensitive actions by a user who lacks the permission (sell expired stock, price override, discount above limit, void) require a supervisor's username + password; the main process issues a single-use, 2-minute override token bound to that action and records it in the audit log |
| Data integrity | Append-only audit log and stock-movement tables enforced by SQLite triggers; financial documents cannot be deleted (void/reversal only) |
| SQL | Parameterised queries only (Drizzle / prepared statements) |

## 5. Offline-first design

* SQLite file in the user-data directory (`%APPDATA%/PharmaDesk/data/pharmacy.db`) is
  the source of truth. No component makes internet calls.
* Fonts, icons and all assets are bundled; no CDN references (checked by an automated test).
* The status bar shows **"Offline-ready · Local database"** rather than depending on
  connectivity; there is nothing that degrades when the network drops.
* Durability: `journal_mode=WAL`, `synchronous=FULL` (protects committed transactions
  across power cuts), `foreign_keys=ON`. Every multi-row financial operation runs in a
  single transaction — a crash mid-sale leaves no partial sale.
* Future sync readiness: every business entity has a `uuid` column and `updated_at`,
  documents carry immutable numbers, and all changes are append-style (movements,
  ledgers, audit). A later sync agent can replicate these without schema rewrites.

## 6. Folder structure

```
pharmacy/
├─ docs/                       Architecture, database, business rules, user guide
├─ build/                      Installer resources (icons, NSIS include)
├─ resources/                  Runtime resources (app icon)
├─ drizzle/                    Generated SQL migrations (shipped with the app)
├─ scripts/                    Dev scripts (seed runner, e2e smoke/screenshot runner)
├─ src/
│  ├─ shared/                  Code shared by main + renderer (no Node / DOM APIs)
│  │  ├─ contract.ts           IPC channel → input/output type map
│  │  ├─ permissions.ts        Permission keys, default roles
│  │  ├─ schemas/              Zod input schemas per module
│  │  ├─ types/                DTOs returned by the main process
│  │  ├─ settings.ts           Settings keys, defaults, Zod schema
│  │  └─ money.ts, dates.ts    Pure helpers (integer money, formatting)
│  ├─ main/                    Electron main process (trusted)
│  │  ├─ index.ts              App lifecycle, single-instance lock
│  │  ├─ window.ts, security.ts
│  │  ├─ db/                   schema (Drizzle), client (pragmas + migrate), seed
│  │  ├─ core/                 errors, ipc router, session, permissions, audit,
│  │  │                        sequences (document numbers), override tokens
│  │  ├─ modules/<module>/     <module>.service.ts (logic) + <module>.ipc.ts (adapter)
│  │  └─ printing/             receipt / A4 invoice / report / label HTML templates
│  ├─ preload/index.ts         contextBridge — window.pharmacy
│  └─ renderer/                React application (untrusted, sandboxed)
│     ├─ index.html
│     └─ src/
│        ├─ app/               router, providers, shell layout, guards
│        ├─ components/ui/     design system (Button, Input, Dialog, DataTable…)
│        ├─ components/        composite widgets (PageHeader, StatCard, MoneyInput…)
│        ├─ features/<module>/ pages, forms, hooks per module
│        ├─ lib/               api client, formatters, keyboard shortcuts
│        ├─ stores/            Zustand stores (session, POS cart, preferences)
│        ├─ i18n/              i18next setup, en resources (ur later)
│        └─ styles/            Tailwind entry + design tokens (light/dark)
├─ tests/                      Vitest suites (unit + service integration) & e2e
├─ electron.vite.config.ts     Build config (main / preload / renderer)
├─ electron-builder.yml        Windows NSIS installer config
└─ drizzle.config.ts
```

## 7. Modules

| Module | Main-process responsibilities | Key screens |
|---|---|---|
| **auth / users / roles** | Login, lockout, auto-lock, password change, users CRUD, role ↔ permission matrix, supervisor override tokens | Login, Lock screen, Users, Roles & permissions |
| **products** | Medicine master, categories, manufacturers, search index, price-change audit, barcode labels | Products list, Product sheet (details, batches, movements, sales), Categories, Manufacturers |
| **inventory** | Batches, opening stock, stock adjustments/write-offs, stock-movement ledger, FEFO allocator, integrity check | Stock overview, Batches, Adjustments, Movement ledger |
| **purchases** | Draft → post purchase invoices, batch creation/merge, bonus quantities, cost allocation, supplier ledger, void | Purchases list, Purchase editor, Purchase detail |
| **suppliers** | Supplier master, ledger (opening, purchases, payments, returns), balances, aging | Suppliers, Supplier profile (ledger) |
| **sales (POS)** | Quote, complete sale (FEFO allocation, payments, credit), held bills, reprint, void | POS, Sales history, Invoice detail |
| **returns** | Return against invoice, restock to original batch or dispose, refunds, customer credit | Returns list, New return |
| **expiry / reorder** | Expiry buckets, low-stock / out-of-stock / reorder calculations | Expiry dashboard, Reorder planner |
| **customers** | Customer master, purchase history, credit ledger, receive payments | Customers, Customer profile |
| **prescriptions** | Prescription records with attached scans, linked to customers and sales; permission-restricted | Prescriptions, Prescription editor |
| **expenses** | Expense categories, record/void expenses | Expenses |
| **cash** | Open/close shift, cash adjustments, expected vs counted cash, denomination count, closing report | Cash register |
| **payments** | Supplier payments (out), customer receipts (in), void | Payments |
| **reports** | Sales, inventory, purchase, financial and analytics reports; CSV / XLSX / PDF / print | Reports hub, Report viewer |
| **dashboard** | KPI aggregation, charts, alerts | Dashboard |
| **audit** | Append-only audit log, filters | Audit log |
| **backup** | Manual/automatic online backups, restore with validation and safety copy | Backup & restore |
| **settings** | Pharmacy profile, receipt/invoice, currency, tax, inventory, sales, security, backup, printer, locale | Settings |
| **printing** | Receipt (58/80 mm), A4 invoice, report PDFs, barcode labels | Print preview dialogs |

## 8. IPC contract

`src/shared/contract.ts` declares every channel once:

```ts
export interface Contract {
  'products.search': [ProductSearchInput, ProductSearchResult[]];
  'sales.quote':     [SaleQuoteInput, SaleQuote];
  'sales.complete':  [SaleCompleteInput, SaleCompleted];
  // …
}
```

* The main process registers handlers with `router.handle('sales.complete', { permission: 'pos.access', schema: SaleCompleteSchema }, fn)`
  — TypeScript enforces that the handler matches the contract.
* The renderer calls `api('sales.complete', payload)`, fully typed, returning a Promise
  that rejects with an `AppError` (code, message, field errors) on failure.
* The preload allow-list is generated from the same contract keys.

## 9. Printing

* Templates are pure functions `(data, settings) → HTML string` in `src/main/printing`.
* **Receipt** (58 mm / 80 mm thermal): monospace-friendly layout, logo, pharmacy details,
  items with batch/expiry (configurable), totals, payment, change, footer, barcode of the
  invoice number for fast return lookup.
* **A4 invoice**: letterhead layout for customers who need a formal invoice.
* The renderer shows a preview (sandboxed `iframe srcdoc`); printing uses a hidden
  `BrowserWindow` → `webContents.print({ deviceName, silent, pageSize })`. PDF export uses
  `printToPDF`. Printer names are chosen in Settings from `getPrintersAsync()`.
* Thermal printers are used through their Windows driver (standard for Epson/Xprinter/
  BlackCopper devices); no raw ESC/POS dependency.

## 10. Backup & restore

* **Backup** uses SQLite's online backup API (`db.backup()`) — a consistent snapshot even
  while the app is in use, including WAL content. File name
  `PharmacyBackup_YYYY-MM-DD_HHmmss.db`; if a file with that name exists a numeric suffix is
  added — an existing backup is never overwritten.
* After writing, the backup is opened read-only and `PRAGMA integrity_check` is run; the
  result is recorded.
* **Automatic backups**: configurable interval + on application exit, into a chosen folder,
  keeping the last *N* automatic backups (manual backups are never pruned).
* **Restore**: the chosen file is validated (SQLite header, integrity check, PharmaDesk
  schema marker, migration version not newer than the app); the current database is
  first saved as a *pre-restore safety backup*; then the file is swapped in, pending
  migrations applied and the app restarts. Every step is audit-logged.

## 11. Localization

* All UI strings go through i18next `t('key', 'English default')`; English defaults live
  next to the code, so adding Urdu means providing `ur.json` for the same keys.
* The root element's `dir` attribute follows the language (RTL ready); layout uses logical
  properties (`ps-*`, `me-*`) where direction matters.
* Money, number and date formatting go through `src/shared/format.ts`, driven by the
  currency / locale settings (PKR · `Rs` by default, configurable decimals and date format).

## 12. Extensibility for future features

| Future feature | Hook already present |
|---|---|
| Cloud backup | Backup module produces verified snapshot files; add an uploader provider |
| Multi-branch / central inventory | `uuid` on all entities, append-only movements and ledgers, `settings.branch` block |
| SMS / WhatsApp | Domain events emitted after commit (`sale.completed`, `stock.low`) through an in-process event bus |
| Accounting integration | Ledgers (supplier/customer), expenses and sales are already double-entry friendly |
| Loyalty | Customers module + sale → customer link |
| Mobile companion / online dashboard | Services are transport-agnostic; an HTTP adapter could wrap the same router |

## 13. Assumptions and clarifications

Where the brief was ambiguous a conservative professional default was chosen. All are
configurable or easy to change.

1. **Single terminal, single pharmacy (v1).** One cash drawer session open at a time.
   Multi-terminal on a LAN would require a server process; not in v1.
2. **Units & packs.** Stock is held in the product's *base unit* (tablet, capsule, bottle,
   tube, piece). Each product has a *pack size* (units per pack). Prices are entered **per
   pack** (as printed on the box / supplier invoice); loose-unit sales are priced
   pro-rata with integer rounding. Products flagged "no loose sale" can only be sold in whole packs.
3. **Batch identity** = product + batch number. Re-receiving the same batch adds to the
   existing batch (expiry must match; cost becomes weighted average). Different batches are
   never merged.
4. **Expiry dates** are stored as full dates; when only month/year is printed the last day
   of that month is used. Stock is treated as *expired on* its expiry date.
5. **Money** is stored as integer paisa; PKR shown with 2 decimals by default (configurable to 0).
   Invoice rounding (to 1/5/10 rupees) is optional and recorded as a separate round-off amount.
6. **Tax** is disabled by default (most medicines in Pakistan are GST-exempt). When enabled,
   each product has a rate and prices may be tax-exclusive or tax-inclusive (setting).
   Purchase tax is treated as part of inventory cost (non-recoverable) unless configured otherwise.
7. **Revenue recognition** is at the time of sale (credit sales included). Returns reduce
   revenue on the return date. Profit uses the exact cost of the batch sold.
8. **Customer credit** (udhaar) is supported: a sale may be partly/fully on account for a
   selected customer, with a customer ledger and receipts.
9. **Supplier payments** are applied to the supplier's running balance (not bill-by-bill),
   which matches how most distributors keep accounts.
10. **Prescription data** is limited to what a pharmacy needs to record (patient name,
    prescriber, date, medicines, notes, scan). No diagnoses. Access requires the
    `prescriptions.*` permissions. The system never recommends or prescribes medicines.
11. **Controlled medicines** can be flagged; selling them can require a linked prescription
    (setting: off / warn / require).
12. **Voids**: a sale can be voided only while its cash session is open; afterwards use a
    return. Posted purchases can be voided only while none of their stock has been consumed.
13. **Default admin**: the first run creates `admin` / `admin123` and forces a password change
    at first login. Seed/demo data is optional (developer command or first-run choice).
