# Quickstart: Module 002 — Setup Checklist, Business Settings, Catalog Import

How to run and verify this module once implemented. Nothing here claims a working feature today; each step is a check to perform after `/sp.implement`.

## Prerequisites

- Module 001 working (sign-in, products, stores) and the same environment files: `.env.local` (app) and `.env.test.local` (separate TEST Supabase project; never use the owner's dev project for automated tests).
- New dependencies installed: `npm install papaparse read-excel-file write-excel-file fflate` and `npm install -D @types/papaparse` (verify each library's current API first; do not use the `xlsx` package).

## 1. Apply the new migration

Apply `supabase/migrations/0002_settings_and_import.sql` to each project you use, after `0001_init.sql`:

- test project: SQL Editor → paste → Run (or `supabase db push`);
- your own dev project: the same, once you are ready to use the feature.

Verify: tables `business_settings` and `imports` exist with RLS enabled; every existing business has one `business_settings` row (backfill); `products.import_id` exists.

## 2. Run the app

```bash
npm run dev
```

Sign in, open Home: the setup checklist appears with three items (not done). Open Settings from the bottom navigation.

## 3. Manual acceptance walk-through (maps to the spec)

1. **Settings (US2):** set a name, phone, address; leave paper width at 80; turn the Account Summary default on, save, reload: values persist. Try 30 or 130 mm (refused) and an empty name (refused). Open Settings in two tabs, save in one, then the other: "changed elsewhere" appears.
2. **Checklist (US3):** after saving settings, item 1 shows done. Add a store: item 2 done. The checklist never blocks any screen. Dismiss it, reload, still hidden; Settings → "Show setup checklist" brings it back.
3. **Import (US1):** Products → Import. Download the template (CSV and Excel). Fill a few rows, choose the file: the preview lists every row with a status and counts, and nothing is saved until you confirm. Try a file with: an exact duplicate of an existing medicine, a same-name medicine with a different strength (Similar: skipped unless you choose "Create as separate"), two identical rows, a repeated SKU, a missing unit, a negative price. Confirm: the summary matches the counts shown before. Press Confirm twice / refresh: no extra medicines.
4. **Bad files:** a `.pdf`, an empty file, a header-only file, a file with an unknown column, a file missing `unit`, a password-protected `.xlsx`: each shows a clear message and changes nothing.
5. **Changed catalog:** preview a file, add one of its medicines by hand in another tab, then confirm: nothing is imported and a refreshed preview appears.

## 4. Automated checks (the module is done only when all pass)

```bash
npm run lint
npm run typecheck
npm test              # unit + PGlite (import functions, RLS) + Supabase integration (test project)
npm run test:e2e      # stop `npm run dev` first; runs a production build on port 3000 against the test project
npm run build
```

Required test groups: header matching and cell reading; field validation (every invalid reason); template contents; **database classification** for every status and the status priority; preview/import agreement (same fingerprint, same counts); **all-or-nothing** on a forced failure; **idempotent replay**, including simultaneous confirms; "catalog changed" refuses everything; settings validation, version conflict, and defaults; checklist derived state and dismissal; **RLS isolation with two businesses** for settings, imports, and imported products; **5,000-row timing** (preview ≤ 30 s, import ≤ 60 s) on the test project; touch targets ≥ 44 px and loading/error/empty states at 360 px.

## 5. Known limits of this module

No undo of a whole import (each imported medicine links to its import so a later module can add it); no splitting of combined names such as "NORAN 20MG CAP" into strength and form; no import of stores or balances; reading a very large `.xlsx` on an old phone can be slow (CSV is recommended); preview and import need a connection; the JSON body of an import is capped at 4 MB, so an unusually wide 10,000-row file may need to be split.

## 6. Verification results (recorded 2026-11-05 on branch `002-setup-catalog-import`)

Only what was actually run. Everything below ran against the separate TEST Supabase project (`medicine-supply-test`) or PGlite, never the owner's dev project.

| Check | Result |
|-------|--------|
| `npm run lint` (ESLint + secrets check) | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm test` (unit + PGlite + Supabase integration) | 25 files, 272 tests passed |
| `npm run test:e2e` (production build, mobile 360 px + desktop) | 168 passed, 2 skipped by design; the first run had 2 failures caused by a wrong expectation in the test (PostgREST returns numeric columns as numbers); the corrected test passes on both projects (re-run on its own, the full suite was not re-run in one go afterwards) |
| Migration `0002` on the TEST project | applied through the SQL Editor; confirmed by the passing Supabase tests (settings, setup, import, RLS) |
| Migration `0002` on the owner's dev project | applied through the SQL Editor with the owner's approval. Read-only check afterwards: 1 settings row (backfilled for the 1 business), 68 medicines (unchanged), 0 imports, the 4 new functions exist, `products.import_id` exists. The Settings, checklist and Import screens were NOT yet clicked through on the dev project. |

Measured times for 5,000 rows:

- Server side on the Supabase test project (`import-5000.test.ts`): preview 2.6 s, import 2.3 s.
- PGlite (real PostgreSQL engine, local): preview + import within the 30 s test limit (value printed by the test).
- Browser, Playwright (reading the file, preview, import): CSV import took 6.2 s; `.xlsx` preview appeared after 4.2 s and its import took 5.3 s (desktop run). Limits in the spec: preview ≤ 30 s, import ≤ 60 s.

Verified by tests: every classification status and the status priority; preview and import agree; all-or-nothing (forced failure leaves nothing); idempotent replay including 10 simultaneous confirms; two simultaneous imports with different ids (one applied, one refused); "catalog changed" applies nothing; empty cells stay empty and prices are exact; bad files (wrong type, empty, header only, unknown or missing column, semicolons, damaged, password-protected, macros, too large, too many rows, too wide); settings validation, defaults, version conflict and failed-save behaviour; checklist derived state and dismissal; RLS isolation between two businesses for settings, imports and imported products; signed-out requests return 401; touch targets and no horizontal overflow at 360 px on every new screen.

**Not verified yet (still open, task T060):** the timed human checks SC-001 (business details saved in under 2 minutes) and SC-012 (100-row mixed file previewed and imported in under 5 minutes), and a walk-through by the owner on a real phone. The owner has not yet used the Import and Settings screens on the dev project.

Known limits found while building (also in section 5): the reader treats an Excel formula that cannot be evaluated as an empty cell, because the library does not expose error cells; a zip whose declared sizes are false could make the browser tab itself work hard, but nothing is sent to the server.
