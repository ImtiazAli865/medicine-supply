# Implementation Plan: Setup Checklist, Business Settings, and Catalog Import

**Branch**: `002-setup-catalog-import` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-setup-catalog-import/spec.md`

## Summary

Module 002 adds three things on top of Module 001: a **Settings** screen (business name, phone, address, thermal paper width, Account Summary default), a skippable **setup checklist** on Home, and a **catalog import** from CSV or Excel with a preview before anything is saved.

Approach (details and rationale in [research.md](research.md)):

- **Files are read in the browser.** CSV (Papa Parse) and `.xlsx` (read-excel-file) are turned into plain text cells on the supplier's own device after safety checks (type, size, macros, password protection). The server never receives a file, so "the file is not kept" is true by construction. The server receives only JSON rows and re-validates everything: the browser is never trusted.
- **One classification, written once, in the database.** A single SQL function classifies the rows that passed field validation against the current catalog (already exists, similar, SKU already used, duplicate inside the file, new) using the same normalisation as the unique indexes. The preview and the confirmed import both call that same function, so they cannot disagree (SC-003).
- **The confirmed import is one database transaction.** A function re-classifies, compares a fingerprint of the approved preview, and either applies nothing (catalog changed) or creates every approved row and records the import, all-or-nothing. A client-generated import id makes retries return the original result (SC-004, SC-006).
- **Settings and checklist** use a small `business_settings` table with Row Level Security; the one multi-table write (business name + settings) goes through a single narrow database function; checklist "done" states are derived from real data.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged from Module 001)
**Primary Dependencies**: Existing stack (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react) plus **new**: `papaparse` (CSV), `read-excel-file` (read `.xlsx`), `write-excel-file` (build the `.xlsx` template), `fflate` (inspect the `.xlsx` zip safely). Versions seen on the registry 2026-11-06: papaparse 5.7.0, read-excel-file 9.3.14, write-excel-file 4.1.1, fflate 0.8.3 (verify the APIs at install time). The `xlsx` (SheetJS) package on npm is deliberately NOT used: its npm release is stuck at the old 0.18.5 with known security issues.
**Storage**: Supabase PostgreSQL. New migration `supabase/migrations/0002_settings_and_import.sql`: tables `business_settings`, `imports`; column `products.import_id`; functions `import_classify`, `import_preview`, `import_apply`, `save_business_settings`; RLS on every new table.
**Testing**: Vitest (unit: cell reading, validation, template, fingerprint helper; PGlite: classification, atomicity, idempotency, RLS on a real Postgres engine; Supabase integration incl. 5,000-row timing), Playwright (upload a file, preview, confirm; settings; checklist; 360 px)
**Target Platform**: Android mobile browsers first; responsive to tablet/desktop
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: 5,000-row file: complete preview ≤ 30 s and confirmed import ≤ 60 s on a normal mobile connection (SC-002). Design target is much better: classification and insert are set-based SQL (a few seconds); reading the file in the browser must not freeze the screen.
**Constraints**: max 10,000 data rows and 5 MB per file (client-checked); request body to the server capped at 4 MB of JSON (stated in spec FR-015 and Edge Cases) with a clear "split the file" error (leaves headroom under common 4.5 MB serverless limits and Next.js' 10 MB proxy buffer); no files stored; no network needed to read a file, but preview and import need a connection (consistent with Constitution VII); imports are never partial.
**Scale/Scope**: 1 business / 1 owner; imports up to 10,000 rows; 3 new screens (Settings, Import wizard with preview/summary, Import history list) plus the checklist card on Home and a Settings item in the navigation.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real file reading, real preview, real transactional import; no placeholder screens | PASS — tests run against a real engine (PGlite) and the real Supabase test project; progress and results are shown only from real outcomes |
| II. Billing integrity & snapshots | Partly: imported prices are exact PKR strings stored as NUMERIC; no price is invented; Account Summary default stored only | PASS — prices go through the existing exact-money rules; empty stays empty; nothing is printed here |
| III. Append-only ledger | No ledger in scope | PASS (n/a) |
| IV. Medicine identification & order safety | Yes: exact duplicates never created, similar never merged and only created after explicit choice, SKU conflicts never created, no invented strength/form/pack size | PASS — one SQL classification using the same normalisation as the unique indexes; unique indexes remain the last guard |
| V. Security, RLS, secrets | Yes: new tables with RLS; narrow SECURITY DEFINER only where a user must write two tables; server-side re-validation; no secrets | PASS — settings/imports isolation tests with two businesses are a done-criterion; no service-role key in the app |
| VI. Server-side AI | No AI in scope | PASS (n/a) |
| VII. Offline-first | Partly: client-generated import id gives retry safety; import and preview require a connection (stated, like invoice issue) | PASS — no claim of offline import; failures show clear messages and keep the file on screen until the user leaves |
| VIII. Mobile-first, verifiable delivery | Yes: 360 px screens, 44 px targets, loading/error/empty states, lint/type/build and tests before "done" | PASS — Playwright at 360 px; a 5,000-row timing test; results recorded honestly |

**Post-design re-check (after Phase 1)**: All gates still PASS. No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-setup-catalog-import/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.openapi.yaml # Phase 1 output (REST route handlers)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/sp.tasks - NOT created by /sp.plan)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0002_settings_and_import.sql        # tables, RLS, functions, backfill, trigger

src/
├── app/
│   ├── (app)/
│   │   ├── page.tsx                    # Home: adds the setup checklist card
│   │   ├── settings/page.tsx           # Settings screen
│   │   └── products/import/page.tsx    # Import wizard (+ history list); ?import=<id> shows a saved summary
│   └── api/
│       ├── settings/route.ts           # GET, PATCH
│       ├── setup/route.ts              # GET (derived checklist state)
│       ├── setup/checklist/route.ts    # PATCH (dismiss / show again)
│       ├── imports/route.ts            # GET (history), POST (confirm import)
│       ├── imports/preview/route.ts    # POST (preview)
│       └── imports/[id]/route.ts       # GET (one import summary)
├── components/
│   ├── settings/SettingsForm.tsx
│   ├── setup/SetupChecklist.tsx
│   ├── import/                         # ImportWizard, FilePicker, PreviewList, PreviewFilters, ConfirmPanel, SummaryCard, TemplateButtons
│   └── shell/BottomNav.tsx             # adds a Settings item (4 items)
├── lib/
│   ├── import/                         # shared by browser and server
│   │   ├── columns.ts                  # template columns, header matching
│   │   ├── validate-row.ts             # field validation (prices, lengths, required) — runs on the server too
│   │   ├── types.ts
│   │   ├── read-csv.ts                 # browser only: Papa Parse
│   │   ├── read-xlsx.ts                # browser only: read-excel-file
│   │   ├── inspect-file.ts             # browser only: type, size, magic bytes, zip safety, macros
│   │   └── template.ts                 # builds the CSV and .xlsx templates
│   ├── imports/repository.ts           # preview/apply/list via database functions
│   ├── settings/{repository,types}.ts
│   ├── setup/repository.ts             # derived checklist state, dismiss
│   └── api/body.ts                     # JSON body reader with the 4 MB cap
└── lib/validation/{settings,import}.ts # Zod schemas for the API
tests/
├── helpers/import-files.ts             # builds test files in memory (xlsx, damaged, protected, macro, 5,000 rows)
├── unit/                               # columns, validate-row, read-csv, read-xlsx, inspect-file, template, limits
├── integration/                        # db-settings-import-schema.pglite.test.ts, db-import.pglite.test.ts, db-settings-rls.pglite.test.ts, import-api.test.ts, settings-api.test.ts, setup-api.test.ts, rls-settings-import.test.ts, import-5000.test.ts
└── e2e/                                # import.spec.ts, settings.spec.ts, setup-checklist.spec.ts, fixtures files in tests/fixtures/
```

**Structure Decision**: Same single Next.js project. Reading and inspecting files live in browser-only modules; field validation lives in shared pure modules so the server can run exactly the same rules; everything that depends on the catalog lives in SQL.

## Complexity Tracking

No constitution violations to justify.
