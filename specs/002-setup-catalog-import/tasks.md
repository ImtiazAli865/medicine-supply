---

description: "Task list for Module 002: Setup Checklist, Business Settings, and Catalog Import"
---

# Tasks: Setup Checklist, Business Settings, and Catalog Import

**Input**: Design documents from `/specs/002-setup-catalog-import/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.openapi.yaml, quickstart.md
**Tests**: INCLUDED. Constitution Principles I, IV, V, VIII and spec success criteria SC-002 to SC-009 require them. Write each story's tests first and confirm they fail before implementing.
**Organization**: Grouped by user story. Priority order: US1 import (P1), US2 settings (P1), US4 isolation (P1), then US3 checklist (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 catalog import · US2 business settings · US3 setup checklist · US4 business isolation
- Paths are relative to the repository root `D:\my project\medicine-supply`. Do not touch `docs/`, `.specify/`, `.claude/`, `CLAUDE.md`, or Module 001 specs while implementing (checking boxes in this file is allowed).
- Never create real credentials in files. Tests use the separate TEST Supabase project (`.env.test.local`), never the owner's dev project.

## Path Conventions

Same single Next.js project as Module 001: `src/app`, `src/components`, `src/lib`, `supabase/migrations`, `tests/{unit,integration,e2e,fixtures}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and conventions

- [X] T001 Install runtime dependencies `papaparse`, `read-excel-file`, `write-excel-file`, `fflate` and dev dependency `@types/papaparse` in `package.json` (commit the lockfile). Do NOT install `xlsx` or `exceljs`. Before using each library, read its installed README/type definitions and record the verified import style and function signatures (CSV parse with header/skip-empty options, `.xlsx` read of first sheet only, `.xlsx` write, `unzipSync` entry filter) plus the installed versions in `specs/002-setup-catalog-import/research.md` (new final section "Verified at install"). If an API differs from plan.md, update the later task wording in this file.
- [X] T002 [P] Create the folder `tests/fixtures/import/` with small committed text fixtures: `valid-5.csv` (5 distinct medicines, one with Urdu text), `all-problems.csv` (new, exact duplicate of a medicine the test seeds, similar, in-file duplicate, repeated SKU, missing unit, negative price, 3-decimal price, text over 200 chars), `bad-header.csv` (unknown column), `missing-unit-column.csv`, `header-only.csv`, `empty.csv`, `not-a-sheet.pdf` (a tiny file renamed with the `.pdf` extension), `semicolon.csv`. Fixtures contain only invented sample data. Create the helper `tests/helpers/import-files.ts` that builds binary and large files in memory at test time (no committed binaries): `valid-5.xlsx` (same data as `valid-5.csv`, built with `write-excel-file`), `damaged.xlsx` (truncated zip bytes), `password-protected.xlsx` (starts with the `D0 CF 11 E0` header), `macro.xlsx` (a valid zip containing `xl/vbaProject.bin`, built with `fflate`), `too-large` (> 5 MB), `too-many-rows` (10,001 data rows), `too-wide` (within 5 MB and 10,000 rows but over 4 MB of cell text), and generators for 5,000-row CSV and `.xlsx` files. Playwright uses these through `setInputFiles` buffers.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The database objects every story needs. No story work can begin until this phase is complete.

**⚠️ CRITICAL**: Module 002 depends on Module 001's `supabase/migrations/0001_init.sql`; keep it untouched.

- [X] T003 Write the failing schema test `tests/integration/db-settings-import-schema.pglite.test.ts` (PGlite via `tests/helpers/pglite.ts`, applying `0001` then `0002`): tables `business_settings` and `imports` exist with RLS enabled; every pre-existing business gets a `business_settings` row from the backfill; a business created after the migration gets a default settings row from the trigger (paper width 80, Account Summary default false, `details_saved` false, `checklist_dismissed` false, version 1); `CHECK` rejects paper width 39 and 121; `products.import_id` exists, is nullable, and cannot reference another business's import (the composite foreign key rejects it); updating only `checklist_dismissed` leaves `version` unchanged while `updated_at` still changes; `anon` has no privileges on the new tables; `authenticated` has no DELETE and no INSERT/UPDATE on `business_settings`/`imports` beyond the grants in data-model.md (UPDATE only on column `checklist_dismissed`; INSERT only on `imports`); `authenticated` cannot update `businesses` directly.
- [X] T004 Write `supabase/migrations/0002_settings_and_import.sql` part 1: table `business_settings` (columns, checks, defaults per data-model.md), `AFTER INSERT` trigger on `businesses` (security definer, fixed `search_path`) that inserts the default row, backfill `INSERT … SELECT` for existing businesses, its OWN small `BEFORE UPDATE` trigger that only maintains `updated_at` (do NOT reuse `set_row_meta()`: it bumps `version` on every update, and dismissing the checklist must not change `version`; `version` is bumped only inside `save_business_settings`), RLS enabled, select policy by `current_business_id()`, `GRANT UPDATE (checklist_dismissed)` with an update policy limited to the caller's own row. Revoke all from `anon`.
- [X] T005 In the same file, part 2: table `imports` (columns, `file_kind` check, index `(business_id, created_at desc)`, `UNIQUE (business_id, id)`), `ALTER TABLE products ADD COLUMN import_id uuid` with the composite foreign key `(business_id, import_id) REFERENCES imports (business_id, id)` (no `ON DELETE` action) and an index, so a product can never point at another business's import, RLS enabled on `imports`, select policy and insert policy (`WITH CHECK (business_id = current_business_id())`), grants (`SELECT, INSERT` on `imports` to `authenticated`; no update/delete). The existing product policies stay unchanged. Make the whole migration re-runnable-safe where practical (`IF NOT EXISTS`) and wrapped so a failure leaves nothing half-applied.
- [X] T006 In the same file, part 3: function `save_business_settings(p_expected_version int, p_name text, p_phone text, p_address text, p_thermal_paper_mm int, p_account_summary_default boolean) RETURNS jsonb` exactly as in data-model.md (security definer, `search_path = public`, resolves the business via `current_business_id()` and raises `no_business` when null, creates a default settings row with `INSERT … ON CONFLICT DO NOTHING` if none exists, locks the settings row, raises `version_conflict` when the version differs, updates `businesses.name` and the settings row, sets `details_saved = true`, bumps version, returns the full settings JSON). `REVOKE ALL … FROM PUBLIC, anon`; `GRANT EXECUTE … TO authenticated`.
- [X] T007 In the same file, part 4: functions `import_classify(p_rows jsonb)`, `import_preview(p_rows jsonb)` and `import_apply(p_import_id uuid, p_file_name text, p_file_kind text, p_rows jsonb, p_invalid jsonb, p_fingerprint text, p_create_similar int[])` exactly as in data-model.md (all `SECURITY INVOKER`; classification priority `file_duplicate → exists → sku_used → similar → new`, set-based, using `norm_text`; fingerprint = md5 of ordered `row_no:status:conflict_id`; `import_apply` takes `pg_advisory_xact_lock(hashtext(current_business_id()::text))`, replays an existing `imports` row for the same id and business with `replayed: true`, returns `{applied:false, reason:'catalog_changed'}` on any fingerprint mismatch or when a number in `p_create_similar` is not currently `similar`, inserts approved products with one `INSERT … SELECT` setting `import_id`, empty strings → `NULL`, prices cast to `numeric(12,2)`, then inserts the `imports` row including the skipped list and counts). Grants: `EXECUTE` to `authenticated` only; revoked from `PUBLIC` and `anon`.
- [X] T008 Run the T003 test until it passes; also run `npm test -- db-schema` so the Module 001 schema suite (22 tests) still passes. Fix only the migration.
- [X] T009 [P] Extend the error taxonomy in `src/lib/api/errors.ts` and `src/lib/api/client.ts`: add code `import_changed` (HTTP 409) and a typed `current` payload for settings `version_conflict`, reusing the existing mapping style. Add a small helper `readJsonBodyCapped(request, maxBytes)` in `src/lib/api/body.ts` that rejects bodies over 4 MB with `validation_error` ("File too large to send: split it into smaller files") before parsing.
- [X] T010 [P] Confirm `tests/integration/rls-enabled.test.ts` (uses the `rls_audit` function) automatically covers the two new tables; if it uses a fixed table list, add `business_settings` and `imports`.
- [X] T011 Apply `supabase/migrations/0002_settings_and_import.sql` to the TEST Supabase project (`medicine-supply-test`, ref `zhmsupwlanuxumtmaabx`) through the SQL Editor (the owner signs in; never ask for or type passwords or the secret key). Verify the tables, the backfill row for the test business, `products.import_id`, and the four functions exist. Apply it to the owner's dev project (`medicine-supply-dev`) only after the owner says so, and record both results in `specs/002-setup-catalog-import/quickstart.md` section "Verification results". **Status 2026-11-05: applied to the TEST project (verified by 32 passing Supabase tests) and, with the owner's approval, to the owner's dev project (read-only check: 1 settings row, 68 medicines unchanged, 4 functions, import_id column).**

**Checkpoint**: Database foundation ready; all four stories can now be built.

---

## Phase 3: User Story 1 - Import a medicine list from a file, with a preview (Priority: P1) 🎯 MVP

**Goal**: Download a template, choose a CSV or `.xlsx` file, see a preview with one status per row, confirm, and get a summary, with an all-or-nothing, retry-safe import.

**Independent Test**: With an empty catalog import `valid-5.csv` and confirm 5 medicines exist exactly as written; then import `all-problems.csv` and confirm the preview classification equals what the import applied.

### Tests for User Story 1 (write first, confirm they fail) ⚠️

- [X] T012 [P] [US1] `tests/unit/import-columns.test.ts`: heading matching ignores case, spacing and order; missing `name`/`unit`, unknown heading, repeated heading each reject with the found and expected lists; the 12 template headings are exactly name, unit, brand, generic name, strength, dosage form, manufacturer, pack size, sku, purchase price, selling price, mrp; a heading carrying an extra marker such as `name *` is an unrecognised heading.
- [X] T013 [P] [US1] `tests/unit/import-validate-row.test.ts`: required name/unit; trimming and whitespace collapse like `norm_text`; every length limit (name 200, unit 50, brand 200, generic 200, strength 100, form 100, manufacturer 200, pack size 100, SKU 100); prices: accepts `0`, `10`, `10.5`, `10.50`; rejects `-1`, `abc`, `1,250`, `PKR 100`, `1.234`, `1e3`, leading/trailing letters; warnings `selling_below_purchase` and `mrp_below_selling` are non-blocking; empty cell → `null` (never a default); the example-row marker `EXAMPLE` is ignored and reported.
- [X] T014 [P] [US1] `tests/unit/import-inspect-file.test.ts`: wrong extension/MIME rejected; size over 5 MB rejected; `.xlsx` starting with `D0 CF 11 E0` rejected as password-protected/old format; a zip containing `xl/vbaProject.bin` rejected as macros; a zip with over 1,000 entries or declared uncompressed size over 50 MB rejected without inflating; a valid minimal `.xlsx` passes. Build the test zips in the test with `fflate`.
- [X] T015 [P] [US1] `tests/unit/import-read-csv.test.ts`: UTF-8 BOM removed; quoted fields with commas, quotes and newlines; Urdu/Arabic-script text round-trips; blank and trailing blank rows ignored; header-only → "no medicines found"; empty file; semicolon-delimited file reported with a clear message (not guessed); invalid UTF-8 (replacement character) reported with the "save as UTF-8 CSV or use .xlsx" message; more than 10,000 data rows refused while reading; row numbers match the file (header is row 1).
- [X] T016 [P] [US1] `tests/unit/import-read-xlsx.test.ts` (files built in the test through `tests/helpers/import-files.ts`): numeric cell 99.99 stays `"99.99"`, 0.30000000000000004 stays as the exact text and later fails price validation; only the first sheet is read and its name is returned; formula cells use the cached value; error cells make the row invalid with a reason; blank rows ignored; more than 10,000 rows refused.
- [X] T017 [P] [US1] `tests/unit/import-template.test.ts`: row 1 of the CSV and of the first `.xlsx` sheet is exactly the 12 headings from `columns.ts` (nothing above it, nothing added to a heading), followed by one example row whose name starts with the ASCII marker `EXAMPLE`; the `.xlsx` has a second sheet `Instructions` stating that name and unit are required; reading either template back yields zero importable rows and an "example row ignored" notice.
- [X] T018 [P] [US1] `tests/integration/db-import.pglite.test.ts` (PGlite, real Postgres engine, two businesses): each status (`new`, `exists`, `similar`, `file_duplicate`, `sku_used`) is produced for the right input; inactive products count as existing; unit is not part of identity; status priority when several apply; SKU conflicts with an earlier row in the file count even if that row is itself skipped; `import_preview` twice gives the same fingerprint, a changed catalog gives a different one; `import_apply` with the approved fingerprint creates exactly the `new` rows plus the chosen `similar` rows, never `exists`/`sku_used`/`file_duplicate`, and the counts equal the preview counts (SC-003); empty cells are `NULL` and prices equal the input exactly (SC-009); a catalog change after preview applies 0 rows and returns `catalog_changed`; a chosen similar row that is no longer similar applies 0 rows; replay of the same `import_id` returns the stored result with `replayed:true` and creates 0 rows; a forced failure inside the transaction (a row violating a database check, passed directly to the function) leaves 0 new products and no `imports` row (SC-006); Business B's catalog is not read or changed by Business A's import.
- [X] T019 [P] [US1] `tests/integration/import-api.test.ts` (Supabase TEST project, skipped without env like Module 001): POST preview returns counts and `fingerprint`; invalid rows are reported by the server even if the client sent them as fine; POST import creates products and returns 201; same `import_id` again returns 200 with `replayed:true` and no extra rows; 10 simultaneous confirms with the same `import_id` create the rows once (SC-004); two simultaneous imports with DIFFERENT `import_id`s and overlapping rows are serialised by the advisory lock: one is applied, the other returns 409 `import_changed` (or classifies the overlap as `exists`) and no row is created twice; a catalog change between preview and confirm returns 409 `import_changed` and creates nothing; over 10,000 rows → 400; body over 4 MB → 400; unauthenticated → 401; GET `/api/imports` and `/api/imports/{id}` return history and the skipped list.
- [X] T020 [P] [US1] `tests/integration/import-5000.test.ts` (Supabase TEST project): a generated 5,000-row list previews in ≤ 30 s and imports in ≤ 60 s (SC-002); the measured times are printed in the test output. The browser-side reading of a 5,000-row CSV and `.xlsx` is timed in T021 (Playwright), so SC-002 is covered end to end. Clean up the created rows in `afterAll` using the test project's service connection from `tests/helpers/supabase-test.ts`.
- [X] T021 [P] [US1] `tests/e2e/import.spec.ts` (Playwright, mobile 360 px and desktop): download both templates; choose `valid-5.csv` → preview shows 5 New and nothing saved (reload shows none); confirm → summary matches counts; `valid-5.xlsx` works the same; `all-problems.csv` shows every status with reasons, filters work, similar rows are skipped by default and "Create as separate" on one row changes the final counts shown before confirming; double-press Confirm creates no duplicates; each bad fixture (`bad-header.csv`, `missing-unit-column.csv`, `header-only.csv`, `empty.csv`, `not-a-sheet.pdf`, `semicolon.csv`, and from the helper `damaged.xlsx`, `password-protected.xlsx`, `macro.xlsx`, `too-large`, `too-many-rows`, `too-wide`) shows a message naming the problem and changes nothing (SC-007); a medicine added in a second tab after preview makes Confirm show the refreshed preview instead of importing; refreshing after a confirmed import shows the same summary (address `?import=<id>`), and refreshing while a confirm is in flight (delay the route) shows the summary of that import instead of asking again (US1 scenario 12); a 5,000-row CSV and a 5,000-row `.xlsx` show a visible progress indicator while being read, a complete preview within 30 s from choosing the file, a list that stays scrollable and filterable (windowed), and import within 60 s (SC-002, FR-023). Imported medicines without a selling price show "No selling price".

### Implementation for User Story 1

- [X] T022 [P] [US1] Create `src/lib/import/types.ts` and `src/lib/import/columns.ts`: the 12 template columns with labels and required flags, constants (`MAX_ROWS = 10000`, `MAX_FILE_BYTES = 5 * 1024 * 1024`, `MAX_BODY_BYTES = 4 * 1024 * 1024`), `matchHeaders(headings)` (case/space-insensitive, any order; returns a column map or a `FileError` with found and expected lists), and the row/status/warning types shared by browser and server.
- [X] T023 [US1] Create `src/lib/import/validate-row.ts` (pure, shared by browser preview and server): trims and collapses whitespace like `norm_text`, enforces required name/unit, length limits, price format via the existing money rules in `src/lib/money.ts` and `src/lib/validation/money.ts` (digits and one dot, ≤ 2 decimals, non-negative, never rounded), returns canonical price strings, `invalid` rows with `{field, message}`, and non-blocking warnings; never fills defaults. (depends on T022)
- [X] T024 [P] [US1] Create `src/lib/import/inspect-file.ts` (browser only): extension/MIME check, 5 MB limit, magic bytes (`PK` vs `D0 CF 11 E0`), `fflate` entry listing without inflating, macro, entry-count and declared-size guards, with the messages from research.md D3.
- [X] T025 [P] [US1] Create `src/lib/import/read-csv.ts` (browser only; load `papaparse` with dynamic `import()`): strict UTF-8 decode via `TextDecoder` with `fatal` detection of replacement characters, BOM removal, delimiter check, header matching via `matchHeaders`, row numbers from the file, blank-row skipping, early stop above 10,000 rows, non-blocking progress callback so the screen does not freeze.
- [X] T026 [P] [US1] Create `src/lib/import/read-xlsx.ts` (browser only; dynamic `import()` of `read-excel-file`): first sheet only with its name returned, cells converted to trimmed text per research.md D5, formula cached values, error cells flagged, same header, blank-row and row-limit rules as the CSV reader.
- [X] T027 [P] [US1] Create `src/lib/import/template.ts`: builds the CSV text and the `.xlsx` file (dynamic `import()` of `write-excel-file`) from `columns.ts`: row 1 is exactly the headings, then the clearly marked example row (name starts with `EXAMPLE`); the `.xlsx` also gets a second sheet `Instructions` stating that name and unit are required and how prices are written; export `isExampleRow()` used by both readers.
- [X] T028 [P] [US1] Create `src/lib/validation/import.ts`: Zod schemas `previewRequest`, `applyRequest` (uuid `import_id`, `file_name` ≤ 255, `file_kind` csv|xlsx, `rows` 1–10,000 items of text cells with `row_no ≥ 2`, `fingerprint`, `create_similar` int array) matching `contracts/api.openapi.yaml`.
- [X] T029 [US1] Create `src/lib/imports/repository.ts`: `previewImport(supabase, rows)` (runs `validateRow` on every row, sends only valid rows to `import_preview`, merges invalid rows, builds counts and warnings, returns the contract shape), `applyImport(supabase, request)` (re-validates, calls `import_apply` with the valid rows, `p_invalid` for the invalid ones, the fingerprint and `create_similar`; maps `catalog_changed` → `import_changed`; maps a unique-violation to `import_changed`), `listImports`, `getImport`. The business id is never sent from the client. (depends on T023, T028)
- [X] T030 [US1] Create the routes `src/app/api/imports/preview/route.ts` (POST), `src/app/api/imports/route.ts` (GET history with `limit`, POST confirm returning 201 or 200 with `replayed`), and `src/app/api/imports/[id]/route.ts` (GET, 404 for another business's id) using `requireBusinessUser`, `readJsonBodyCapped`, the Zod schemas and the repository, with the error taxonomy from the contract. (depends on T009, T029)
- [X] T031 [P] [US1] Create the UI in `src/components/import/`: `TemplateButtons.tsx` (CSV and Excel downloads, with the visible text "name and unit are required"), `FilePicker.tsx` (button + drop zone, checks via `inspect-file.ts`, shows which sheet was read, progress while reading), `PreviewFilters.tsx` (counts per status as filter chips ≥ 44 px), `PreviewList.tsx` (windowed/virtualised list so 5,000 rows do not freeze a phone; row number, status badge, reason or conflicting medicine, warnings, and a "Create as separate" toggle only on `similar` rows plus a "Create all similar as separate" control), `ConfirmPanel.tsx` (final counts: will create, created as separate, skipped by reason; Confirm disabled while sending), `SummaryCard.tsx` (created / separate / skipped with row numbers and reasons, link to Products), `ImportHistory.tsx`. All with loading, error (Retry) and empty states, English text, large touch targets.
- [X] T032 [US1] Create `src/components/import/ImportWizard.tsx` and `src/app/(app)/products/import/page.tsx` (`export const dynamic = "force-dynamic"`, `requirePageContext`): step flow choose file → preview → confirm → summary; generates `import_id` with `crypto.randomUUID()` when the preview is approved, reuses it for retries of the same approval, and keeps it in `sessionStorage` while a confirm is in flight (on load, if a pending id exists, call `GET /api/imports/{id}` and show that import's summary when it exists, otherwise clear it); after success navigates to `/products/import?import=<id>`, which renders the summary from `GET /api/imports/{id}` so a refresh shows the same result (research D7); refuses a file whose read text exceeds 4 MB with the "split the file" message before sending; on 409 `import_changed` re-runs the preview and shows a "The medicine list changed, please review again" banner; on network failure keeps the file on screen and says nothing was saved; leaving the screen keeps nothing. (depends on T030, T031)
- [X] T033 [US1] Add an "Import from file" entry point to the Products screen (`src/app/(app)/products/page.tsx` and its empty state in `src/components/products/ProductList.tsx`) and verify (the list label already exists at `src/components/products/ProductList.tsx:83`) that a product without a selling price also shows "No selling price" on its edit/detail screen `src/components/products/ProductForm.tsx`; add the label there only if it is missing.
- [X] T034 [US1] Run T012–T021 until green on the real engines (PGlite locally, TEST Supabase project for API/5,000-row/E2E tests); fix implementation, not tests, unless a test is wrong. Record the 5,000-row timings in `specs/002-setup-catalog-import/quickstart.md`.

**Checkpoint**: US1 works end to end and can be demoed alone.

---

## Phase 4: User Story 2 - Business settings (Priority: P1)

**Goal**: Edit business name, phone, address, thermal paper width and the Account Summary default, saved safely per business.

**Independent Test**: Open Settings, change each field, save, reload and see the saved values; invalid values are refused; two tabs get a "changed elsewhere" message.

### Tests for User Story 2 (write first, confirm they fail) ⚠️

- [X] T035 [P] [US2] `tests/unit/settings-validation.test.ts`: name required ≤ 200; phone ≤ 50; address ≤ 500; paper width whole number 40–120 (refuses 39, 121, 80.5, `"abc"`); Account Summary default boolean; trims and maps empty phone/address to `null`.
- [X] T036 [P] [US2] `tests/integration/settings-api.test.ts` (Supabase TEST project): GET returns defaults for a business (name, null phone/address, 80, false, `details_saved:false`); PATCH saves and a new GET shows it, `details_saved:true`, version bumped; invalid values → 400 with field messages and nothing changed; stale `expected_version` → 409 `version_conflict` with `current`; the saved name is returned by the business name shown in the shell; unauthenticated → 401.
- [X] T037 [P] [US2] `tests/e2e/settings.spec.ts` (mobile and desktop): defaults shown; save and reload persist; 30 mm and 130 mm refused; empty name refused; two tabs → "changed elsewhere"; a failed save (route blocked) shows an error and keeps the typed values with no success message.

### Implementation for User Story 2

- [X] T038 [P] [US2] Create `src/lib/validation/settings.ts` (Zod `settingsUpdate`) and `src/lib/settings/types.ts` per the contract.
- [X] T039 [US2] Create `src/lib/settings/repository.ts`: `getSettings(supabase)` (selects the settings row and the business name; defaults shown if a row were ever missing) and `saveSettings(supabase, input)` calling `save_business_settings` and mapping `version_conflict` (with the current row) and `no_business`.
- [X] T040 [US2] Create `src/app/api/settings/route.ts` (GET, PATCH) with `requireBusinessUser`, Zod validation, and the error taxonomy.
- [X] T041 [P] [US2] Create `src/components/settings/SettingsForm.tsx`: fields name, phone, address, paper width (numeric input with a hint that 58 and 80 are common), Account Summary default toggle, Save button with saving state, field errors, "changed elsewhere" review banner with a "Reload latest" action, typed values kept on failure, success message only after the server confirms.
- [X] T042 [US2] Create `src/app/(app)/settings/page.tsx` (`force-dynamic`, `requirePageContext`, loading/error/not-found handled by the shared `(app)` boundaries), and add a fourth "Settings" item to `src/components/shell/BottomNav.tsx` (icon from `lucide-react`, label visible, 44 px target); update `tests/e2e/shell.spec.ts` and `tests/e2e/touch-targets.spec.ts` for four items and the new screen at 360 px.
- [X] T043 [US2] Confirm that every screen that shows the business name (shell header, sign-in redirect pages) reads `businesses.name`, which the settings save updates (FR-005); fix any place that caches or copies the name.
- [X] T044 [US2] Run T035–T037 until green and fix the implementation.

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 4 - Business data isolation for settings and imports (Priority: P1)

**Goal**: One business can never read or change another's settings, checklist state, import records, or catalog through any route.

**Independent Test**: With two businesses, every cross-business attempt is refused and an import by one changes 0 records of the other.

### Tests for User Story 4 (write first, confirm they fail) ⚠️

- [X] T045 [P] [US4] `tests/integration/rls-settings-import.test.ts` (Supabase TEST project; two businesses, two users, as in `rls-isolation.test.ts`): A cannot select B's `business_settings` or `imports`; A cannot update B's settings row, cannot update any column of its own row except `checklist_dismissed`, cannot insert or delete settings or imports directly, cannot update `businesses`; A calling `save_business_settings`/`import_apply` can only affect A's data even with B's ids in the arguments; A's import of medicines that B also has reads and changes only A's catalog (B's product count and rows are identical before and after, SC-008); A cannot set `products.import_id` (by direct insert or update) to B's import id (the composite foreign key refuses it); GET `/api/imports/{B's id}` returns 404; signed-out requests to every route that exists at this point (`/api/settings`, `/api/imports`, `/api/imports/preview`, `/api/imports/{id}`) return 401 and no data. The signed-out checks for `/api/setup` and `/api/setup/checklist` are in T049.
- [X] T046 [P] [US4] Create `tests/integration/db-settings-rls.pglite.test.ts` so the same isolation checks as T045 (including the cross-business `import_id` refusal) also run on PGlite with two businesses and the `authenticated` role, so they run without network.

### Implementation for User Story 4

- [X] T047 [US4] Run T045–T046. Fix any failure in the migration (policies, grants, function bodies) by editing `supabase/migrations/0002_settings_and_import.sql` and re-applying it to the TEST project (record it in quickstart.md); never loosen a test and never disable RLS.
- [X] T048 [US4] Run the existing Module 001 isolation tests (`tests/integration/rls-isolation.test.ts`, `rls-enabled.test.ts`) to confirm the new migration did not weaken product/store isolation.

**Checkpoint**: Isolation proven for every new table and function.

---

## Phase 6: User Story 3 - First-time setup checklist (Priority: P2)

**Goal**: A skippable, derived checklist on Home that guides without ever blocking.

**Independent Test**: With a brand-new business the checklist shows three not-done items and every screen still works; each completed item marks done; dismissing hides it; Settings brings it back.

### Tests for User Story 3 (write first, confirm they fail) ⚠️

- [X] T049 [P] [US3] `tests/integration/setup-api.test.ts` (Supabase TEST project): GET `/api/setup` for a new business returns all three flags false; after a settings save `details_done` is true; after a store exists `stores_done` is true; after any product exists `catalog_done` is true (however it was added); PATCH `/api/setup/checklist` `{dismissed:true}` persists and `{dismissed:false}` shows it again; dismissing does not change the settings `version`; `dismissed` is shared across sessions of the same business; a body without `dismissed` → 400; unauthenticated → 401 for both `/api/setup` and `/api/setup/checklist`; Business A cannot read or change Business B's checklist state (SC-008).
- [X] T050 [P] [US3] `tests/e2e/setup-checklist.spec.ts` (mobile and desktop): a new business shows exactly three items each with a working button (Settings, add store, Import); stores and products screens still work with the checklist not done (SC-010); completing each item marks it done after returning Home; all three done shows "Setup complete"; Dismiss → hidden after reload; Settings → "Show setup checklist" brings it back.

### Implementation for User Story 3

- [X] T051 [US3] Create `src/lib/setup/repository.ts`: `getSetupState(supabase)` deriving `details_done` (`details_saved`), `stores_done` (≥ 1 store, active or not), `catalog_done` (≥ 1 product, any source) and `dismissed` using cheap `exists`/`limit 1` queries; `setChecklistDismissed(supabase, dismissed)` updating only the `checklist_dismissed` column.
- [X] T052 [P] [US3] Create `src/app/api/setup/route.ts` (GET) and `src/app/api/setup/checklist/route.ts` (PATCH with a Zod body `{dismissed: boolean}`), error taxonomy as in the contract.
- [X] T053 [P] [US3] Create `src/components/setup/SetupChecklist.tsx`: exactly three items with done/not-done marks and buttons (Settings, add store with the text that stores can also be added while taking the first order, Import marked optional), a "Setup complete" message when all three are done, a Dismiss button (≥ 44 px) with saving and error state; never renders anything that blocks navigation.
- [X] T054 [US3] Render the checklist on Home in `src/app/(app)/page.tsx` using `getSetupState` on the server (no flash), hidden when dismissed; add a "Show setup checklist" action to `src/components/settings/SettingsForm.tsx` (or a small section beside it) that calls the PATCH route.
- [X] T055 [US3] Run T049–T050 until green and fix the implementation.

**Checkpoint**: All four stories work independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finish and verify the whole module

- [X] T056 [P] Extend `tests/e2e/states.spec.ts`, `tests/e2e/touch-targets.spec.ts` and `tests/e2e/responsive.spec.ts` so Settings and Import (every step: choose file, preview, confirm, summary, history) have verified loading, error (Retry) and empty states, controls ≥ 44 × 44 px, and no horizontal scroll at 360 px; Settings and Import reachable from visible navigation (SC-011).
- [X] T057 [P] Review every new component for the product rules in `CLAUDE.md`: no cost/profit data on customer-facing screens (FR-038: purchase price and MRP only on internal screens), no fake success messages, no dead buttons, no invented values; fix any finding.
- [X] T058 [P] Run `npm run lint` (includes `scripts/check-secrets.mjs`), `npm run typecheck`, and `npm run build`; fix all errors and warnings in new code (no `any`, no ignored errors).
- [X] T059 Run the full automated suites: `npm test` (unit, PGlite, TEST-project integration) and `npm run test:e2e` (stop `npm run dev` first), in one go. Report the exact counts; do not claim "passed" for skipped suites.
- [X] T060 Walk through `specs/002-setup-catalog-import/quickstart.md` sections 3 and 5 manually against the TEST project data or, with the owner's go-ahead, the dev project; record actual results (including the 5,000-row timings and the two-tab "changed elsewhere" checks) in the "Verification results" section of `quickstart.md`. Include two timed human checks: SC-001 (a new supplier saves business details and invoice settings in under 2 minutes from first sign-in) and SC-012 (preview, review and import of a 100-row mixed file in under 5 minutes, then correctly state from the summary how many were created and why others were skipped). Mark what was verified by the owner personally separately from what was verified by tests. **Status 2026-11-05: done. Owner walk-through on a real phone recorded in quickstart.md section 6 (preview counts, Created 88 / Skipped 12, refresh shows the same summary, about 5 minutes for SC-012, about 2 minutes for SC-001 which is at the limit and not claimed as clearly met). Re-import of the same file was not tried by the owner (automated tests cover it).**
- [X] T061 [P] Update `README.md` (Module 002 features, new dependencies, how to apply migration `0002`, how to run the import tests) and `.env.example` only if a new variable was added (none is expected).
- [X] T062 Optional, only with the owner's consent: run `/sp.adr import-classification-in-sql-browser-parsing` to record the decision (browser file reading, one SQL classification function, fingerprint-guarded atomic import). Do not create an ADR without that consent. **Status 2026-11-05: done with the owner's consent: history/adr/0001-catalog-import-architecture.md.**

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none. **Foundational (Phase 2)**: needs Setup; blocks every story.
- **US1 (Phase 3)**: needs Foundational. **US2 (Phase 4)**: needs Foundational; independent of US1. **US4 (Phase 5)**: needs the migration (Phase 2) and benefits from US1/US2 routes being present for the API-level checks. **US3 (Phase 6)**: needs Foundational and US2 (the Settings screen it links to and its "Show setup checklist" action).
- **Polish (Phase 7)**: after the stories you want to ship.

### Within each story

Tests first (they must fail), then shared types and validation, then repository, routes, UI, page; run the story's tests; fix.

### Notes on the single migration file

T004–T007 edit the same file, so they run in order. Any later change to the migration must be re-applied to the TEST project (T011 procedure) before the Supabase-backed tests run.

---

## Parallel Examples

```text
# Phase 3 test group (all different files):
T012 T013 T014 T015 T016 T017 T018 T019 T020 T021

# Phase 3 implementation group after T022/T023:
T024 (inspect-file)  T025 (read-csv)  T026 (read-xlsx)  T027 (template)  T028 (Zod)  T031 (UI parts)

# US2 and US1 can proceed in parallel after Phase 2 (different files):
US1: T022–T034   |   US2: T035–T044
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (migration applied to the TEST project).
2. Phase 3 (US1) → STOP and validate with `valid-5.csv` and `all-problems.csv`, plus the 5,000-row timing.
3. Show the owner the import on the TEST project before touching the dev project.

### Incremental delivery

1. Foundation → US1 (MVP: import) → US2 (settings) → US4 (isolation proof) → US3 (checklist) → Polish.
2. Apply migration `0002` to the owner's dev project only after the owner agrees, then re-run the owner's real file (`aqib.HTM.html` was converted earlier; the owner may now import the same list through the new screen to see the "Already exists" results).

---

## Notes

- Money values are exact strings and `NUMERIC(12,2)`; never use floating point for prices.
- Server-side re-validation is mandatory: the browser reader is a convenience, never a trust boundary.
- Checklist "done" flags are derived from real data, never stored, except `details_saved` and `checklist_dismissed`.
- Commit after each task or logical group, but only when the owner asks.
