---

description: "Task list for Module 001: Foundation — Login, Products, and Stores"
---

# Tasks: Foundation — Login, Products, and Stores

**Input**: Design documents from `/specs/001-auth-products-stores/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.openapi.yaml, quickstart.md
**Tests**: INCLUDED. The constitution (Principles I, V, VIII), spec success criteria SC-003/SC-005/SC-007, and quickstart section 6 require them. Write each story's tests first and confirm they fail before implementing.
**Organization**: Grouped by user story. Priority order: US1, US2, US3, US5 (all P1), then US4 (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 sign-in · US2 stores · US3 products · US4 mobile shell and states · US5 business isolation
- Paths are relative to the repository root `D:\my project\medicine-supply`. Do not touch `docs/`, `specs/` (except checking boxes), `history/`, `.specify/`, `.claude/`, or `CLAUDE.md` while scaffolding.

## Path Conventions

Single Next.js project (see plan.md): `src/app`, `src/components`, `src/lib`, `supabase/`, `tests/{unit,integration,e2e}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling

- [X] T001 Scaffold a Next.js App Router + TypeScript + Tailwind CSS + ESLint project with a `src/` directory at the repository root. If the folder is non-empty, scaffold in a temporary folder and move the generated files in without overwriting existing files. Record the installed versions of next, react, tailwindcss, typescript in `specs/001-auth-products-stores/research.md` (final section).
- [X] T002 Install runtime dependencies `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `lucide-react` and dev dependencies `vitest`, `@playwright/test`, `supabase` (CLI), `dotenv` in `package.json`; commit the lockfile.
- [X] T003 [P] Add npm scripts `lint`, `typecheck` (`tsc --noEmit`), `test` (Vitest), `test:e2e` (Playwright), `build` in `package.json`.
- [X] T004 [P] Create `.env.example` with placeholder names only (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and add `.env*` (except `.env.example`) and `.env.test.local` to `.gitignore`.
- [X] T005 [P] Create `vitest.config.ts` (node environment, alias `@` to `src`, setup file loading `.env.test.local`) and the folders `tests/unit`, `tests/integration`, `tests/helpers`.
- [X] T006 [P] Create `playwright.config.ts` with two projects: mobile (360×800, touch) and desktop (1280×800), base URL from env, web server `npm run dev`.
- [X] T007 Verify against official docs and record the result in `specs/001-auth-products-stores/research.md`: (a) Next 16 uses `src/proxy.ts` instead of `middleware.ts`, (b) the current `@supabase/ssr` cookie API, (c) whether the installed TypeScript version is supported by Next. Adjust later tasks' file names if (a) differs.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database, RLS, shared libraries, API helpers and UI primitives that every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Run `supabase init` and set up `supabase/config.toml`; decide and document in `specs/001-auth-products-stores/quickstart.md` whether tests use a local Supabase stack (Docker) or a dedicated hosted test project.
- [X] T009 Write `supabase/migrations/0001_init.sql` part 1: `businesses`, `profiles`, `current_business_id()` (SECURITY DEFINER, STABLE, fixed search_path), the shared trigger function that sets `updated_at`, increments `version`, and rejects changes to `id`/`business_id`, and RLS policies for `businesses` and `profiles` (select own row only; no write policies), per `data-model.md`. *(Verified on a real PostgreSQL engine via PGlite, `tests/integration/db-schema.pglite.test.ts`; not yet applied to a Supabase project.)*
- [X] T010 Append to `supabase/migrations/0001_init.sql` the `stores` table: columns, length checks, generated `search_text`, indexes (including the `pg_trgm` GIN index and the normalized-name index), triggers, RLS select/insert/update policies with `WITH CHECK`, and `REVOKE DELETE` for `authenticated` and `anon`.
- [X] T011 Append to `supabase/migrations/0001_init.sql` the `products` table: columns, length checks, `NUMERIC(12,2)` non-negative checks, generated `search_text`, the exact-duplicate unique index on normalized identity, the partial unique SKU index, trigram GIN and btree indexes, triggers, RLS policies, and `REVOKE DELETE`. Confirm the generated column is accepted as immutable.
- [X] T012 [P] Create `supabase/seed/provision-owner.sql`: documented manual script that inserts one `businesses` row and one `profiles` row for an existing auth user, with placeholder email and business name.
- [X] T013 Apply the migration to the chosen test database and verify with SQL that `businesses`, `profiles`, `stores`, `products` exist with RLS enabled (record the query and result in `quickstart.md`). Do not claim the database is connected until this succeeds. *(Applied 2026-11-05 to the Supabase project `medicine-supply-dev` through the SQL Editor; verified: 4 tables, RLS on, policies 1/3/1/3, signed-out requests get "permission denied". This is the owner's dev project, not a separate test project.)*
- [X] T014 [P] Implement exact money helpers in `src/lib/money.ts`: parse a decimal string (max 2 decimals, non-negative) to integer paisa, format back to a canonical string, subtract, and PKR display formatting. No floating-point arithmetic.
- [X] T015 [P] Implement `norm()` in `src/lib/normalize.ts` (lowercase, trim, collapse whitespace, null → empty) matching the SQL `norm` rule, plus `escapeLike()` that escapes `%`, `_`, `\`.
- [X] T016 [P] Implement `newId()` in `src/lib/ids.ts` using `crypto.randomUUID()`.
- [X] T017 [P] Implement the error taxonomy and response helpers in `src/lib/api/errors.ts` (codes from `contracts/api.openapi.yaml`: unauthenticated, no_business, not_found, validation_error, duplicate_product, similar_products, similar_store, sku_conflict, version_conflict, server_error; HTTP statuses 401/403/404/400/409/500).
- [X] T018 [P] Implement Zod money field validation in `src/lib/validation/money.ts` (string, ≥ 0, ≤ 2 decimals, max 10 integer digits; empty string → undefined).
- [X] T019 [P] Implement Supabase clients using the anon key only: `src/lib/supabase/server.ts` (cookie-based, server), `src/lib/supabase/browser.ts`, and `src/lib/supabase/proxy.ts` (session refresh helper), following the API verified in T007.
- [X] T020 Implement `requireBusinessUser()` in `src/lib/api/auth.ts`: verify the user with `getUser()`, return `{ user, supabase }`, and throw the 401 `unauthenticated` or 403 `no_business` error (depends on T017, T019; uses `current_business_id()` through a profile lookup).
- [X] T021 [P] Implement `useDebouncedValue` (250 ms) in `src/lib/hooks/useDebouncedValue.ts` and `fetchJson` with abort support and 401 handling stub in `src/lib/api/client.ts` (full expiry redirect is finished in US1).
- [X] T022 [P] Create global styles and design tokens in `src/app/globals.css` and UI primitives in `src/components/ui/` (`Button.tsx`, `Input.tsx`, `Field.tsx`, `Dialog.tsx`, `Toast.tsx`, `Spinner.tsx`, `EmptyState.tsx`, `ErrorState.tsx` with Retry). All interactive controls at least 44×44 px; English text; accessible labels. Text inputs and rendered names use `dir="auto"` and the font stack includes an Urdu-capable fallback so Urdu or mixed-script names display correctly. Consult the `ui-ux-pro-max` skill for tokens.
- [X] T023 Create the app shell in `src/components/shell/AppShell.tsx` and `src/components/shell/BottomNav.tsx` (Home, Products, Stores; active item highlighted; bottom bar on phones, side/top bar from `md` up) using lucide-react icons.
- [X] T024 [P] Unit tests for money in `tests/unit/money.test.ts` (parse, subtract, formatting, rejects 3 decimals/negatives/non-numeric, exact for values like 0.10 + 0.20 and 125.50 − 99.99).
- [X] T025 [P] Unit tests for normalization in `tests/unit/normalize.test.ts` (case, spacing, Urdu text, `%`/`_` escaping).
- [ ] T026 Create `tests/helpers/supabase-test.ts`: using a test-only env file, create two auth users in two separate businesses (A and B), return signed-in clients for each plus an anonymous client, and clean up created rows. The service-role key may appear only in `.env.test.local`, never in `src/`. **WRITTEN, NOT RUN: `tests/helpers/supabase-test.ts` needs the Supabase test project.**

**Checkpoint**: Foundation ready — migrations applied and verified, helpers and UI primitives exist, unit tests pass.

---

## Phase 3: User Story 1 — Sign in and reach a protected app (Priority: P1) 🎯 MVP

**Goal**: Email+password sign-in/out, protected routes, session expiry handling, clear errors.

**Independent Test**: With one provisioned account, sign in, reach Home, sign out, and confirm every protected address redirects to sign-in.

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [ ] T027 [P] [US1] E2E in `tests/e2e/auth.spec.ts`: protected URL redirects to sign-in and returns to it after sign-in; wrong credentials show a non-revealing error and create no session; network failure shows a connection error; sign-out then browser Back does not reveal protected data; a signed-in user who closes and reopens the browser context with stored cookies is still signed in (FR-003); an expired session keeps the open form and its typed text on screen, shows the expiry notice with a sign-in link, and allows retrying the save after signing in again. **WRITTEN, NOT RUN: needs the Supabase test project (skipped, not passed).**
- [ ] T028 [P] [US1] Integration in `tests/integration/auth-guard.test.ts` (verifies the guard built in T020, so it is expected to pass on its first run; the "fail first" rule applies to T027): `requireBusinessUser()` returns 401 `unauthenticated` with no session and 403 `no_business` for a user with no profile; business routes return nothing in both cases. **NOT WRITTEN AS A VITEST FILE: the signed-out 401 checks run in `tests/e2e/smoke.spec.ts` (passing); the 403 `no_business` check is in `tests/e2e/auth.spec.ts` (written, not run). `tests/integration/auth-guard.test.ts` does not exist.**

### Implementation for User Story 1

- [X] T029 [US1] Implement `src/proxy.ts` to refresh the session and redirect signed-out visitors to `/sign-in?next=<path>` for all non-public routes (public: `/sign-in`, static assets).
- [X] T030 [P] [US1] Build the sign-in screen `src/app/(auth)/sign-in/page.tsx` and `src/components/auth/SignInForm.tsx`: email + password, loading state, non-revealing error message, connection-error message, and a `next` redirect that accepts only same-origin relative paths.
- [X] T031 [US1] Add sign-out (button in the shell) in `src/components/shell/SignOutButton.tsx` that ends the session, clears client state, and navigates to `/sign-in` (depends on T023).
- [X] T032 [US1] Create the protected layout `src/app/(app)/layout.tsx` that verifies the user server-side with `getUser()`, renders `AppShell`, and redirects when there is no user; add `src/app/(app)/account-not-set-up/page.tsx` shown when the account has no business (depends on T020, T023).
- [X] T033 [US1] Complete `src/lib/api/client.ts`: on any 401 response show "Your session expired. Please sign in again." as a banner while keeping the current form mounted with its typed text, with a "Sign in" link that opens `/sign-in?next=<current path>&reason=expired` in a new tab; after signing in the user retries Save. When the user is not in a form, redirect directly to the same URL. Text is discarded only when the user chooses to leave the form.
- [X] T034 [US1] Build the Home screen `src/app/(app)/page.tsx` with two real navigation cards (Products, Stores) and the signed-in business name, read server-side from `businesses` with the user's session (RLS already allows reading the own row; no API route needed).

**Checkpoint**: US1 works alone; run T027 and T028 until they pass.

---

## Phase 4: User Story 2 — Manage stores (Priority: P1)

**Goal**: Add, edit, view, search, deactivate and reactivate stores; only the name is required.

**Independent Test**: Starting with zero stores, add a store with only a name, search it by partial name, edit its phone, deactivate it, reactivate it.

### Tests for User Story 2 ⚠️

- [X] T035 [P] [US2] Unit tests for the store schema in `tests/unit/store-validation.test.ts` (name required and trimmed, length limits, optional fields).
- [ ] T036 [P] [US2] Integration tests in `tests/integration/stores-api.test.ts`: create with name only; retry with the same id returns the existing record (50 repeated attempts create exactly one row, SC-005); `similar_store` 409 needs `confirm_duplicate`; version conflict on stale `expected_version`; deactivate/reactivate; default list excludes inactive; search by partial name, contact person, phone, Urdu text, and with special characters `% _ ' "`; cursor paging returns every row exactly once; with 500 seeded stores each search responds in under 1 second (SC-002); no hard delete path exists. **WRITTEN, NOT RUN: needs the Supabase test project.**
- [ ] T037 [P] [US2] E2E in `tests/e2e/stores.spec.ts` at 360 px: empty state "Add your first store", add, search, edit, deactivate with confirmation, reactivate, error keeps entered data and shows no false success, same record edited in two tabs shows the version-conflict message. **WRITTEN, NOT RUN: needs the Supabase test project.**

### Implementation for User Story 2

- [X] T038 [P] [US2] Define Zod schemas `StoreCreate`/`StoreUpdate` in `src/lib/validation/store.ts` per the contract.
- [X] T039 [US2] Implement the stores repository in `src/lib/stores/repository.ts`: list/search with `ILIKE` on `search_text` (escaped), status filter, cursor paging, get by id, insert (idempotent on id), update with `expected_version`, similar-name lookup; never accepts `business_id` (depends on T015, T020, T038).
- [X] T040 [US2] Implement `GET`/`POST` in `src/app/api/stores/route.ts` (auth guard, validation, error mapping, 201/200 idempotent, 409 `similar_store`) (depends on T039).
- [X] T041 [US2] Implement `GET`/`PATCH` in `src/app/api/stores/[id]/route.ts` (404 for missing or other-business ids, 409 `version_conflict` with current record) (depends on T039).
- [X] T042 [P] [US2] Implement `GET` in `src/app/api/stores/similar/route.ts` (depends on T039).
- [X] T043 [P] [US2] Build `src/components/stores/StoreForm.tsx`: name required, optional fields, client-generated id (create) or `expected_version` (edit), double-submit protection, field errors, duplicate-warning dialog with explicit confirm, keeps input on failure. On a 409 `version_conflict` show "This store was changed elsewhere" with the typed values still visible and a "Load latest" action; never overwrite silently (FR-028).
- [X] T044 [US2] Build the stores list page `src/app/(app)/stores/page.tsx` and `src/components/stores/StoreList.tsx`: debounced search, Active/Inactive filter, loading, error with Retry, empty state "Add your first store", "No results" state with an add link (depends on T021, T022, T040).
- [X] T045 [US2] Build `src/app/(app)/stores/new/page.tsx`, `src/app/(app)/stores/[id]/page.tsx` (detail with deactivate/reactivate and confirmation dialog) and `src/app/(app)/stores/[id]/edit/page.tsx` (the edit page loads the record's current `version` and passes it to the form; deactivate/reactivate also sends `expected_version`) (depends on T041, T043).

**Checkpoint**: US2 works alone; T035–T037 pass.

---

## Phase 5: User Story 3 — Manage the medicine catalog (Priority: P1)

**Goal**: Add, edit, view, search, deactivate and reactivate products; only name and unit required; exact duplicates blocked; internal unit gross profit.

**Independent Test**: From an empty catalog, add a product with name+unit only, add one with all fields, search "PAN", edit prices, deactivate and reactivate one.

### Tests for User Story 3 ⚠️

- [X] T046 [P] [US3] Unit tests in `tests/unit/product-validation.test.ts` (name/unit required, empty optional fields become null, negative/non-numeric/3-decimal prices rejected, length limits).
- [ ] T047 [P] [US3] Integration tests in `tests/integration/products-api.test.ts`: create with name+unit only (no prices invented); exact duplicate → 409 `duplicate_product` with the existing product, including when the existing product is inactive (response flags it inactive so the UI can offer Reactivate); a product with the same name, strength, dosage form, pack size, and manufacturer but a different unit is still treated as a duplicate; same name with different strength/dosage form/pack size → 409 `similar_products` until `confirm_similar`; SKU conflict names the product; idempotent retry (50 trials); version conflict; warnings `selling_below_purchase` and `mrp_below_selling` do not block; `unit_gross_profit` equals selling − purchase exactly and is null when either price is missing; inactive products excluded from default list and suggestions but readable by id; no products are ever merged. **WRITTEN, NOT RUN: needs the Supabase test project.**
- [ ] T048 [P] [US3] Integration test `tests/integration/product-search.test.ts`: seed 5,000 products in a test business; search by name part ("PAN"), brand, generic name, strength, manufacturer, SKU, Urdu text, and special characters; cursor paging returns every row exactly once; each query responds in under 1 second (SC-002). **WRITTEN, NOT RUN: needs the Supabase test project.**
- [ ] T049 [P] [US3] E2E in `tests/e2e/products.spec.ts` at 360 px: empty state "Add your first medicine", add minimal and full products, suggestions while typing, duplicate block, similar confirmation, price warnings, deactivate/reactivate, failure keeps input, version conflict in two tabs. **WRITTEN, NOT RUN: needs the Supabase test project.**

### Implementation for User Story 3

- [X] T050 [P] [US3] Define Zod schemas `ProductCreate`/`ProductUpdate` in `src/lib/validation/product.ts` (uses `validation/money.ts`; trims; empty optional string → null).
- [X] T051 [US3] Implement the products repository in `src/lib/products/repository.ts`: list/search on `search_text` (escaped) with status filter and cursor paging, get, idempotent insert, update with `expected_version`, similar-by-normalized-name lookup, SKU and exact-duplicate error mapping from Postgres unique violations, `unit_gross_profit` and `warnings` computed with `src/lib/money.ts` (depends on T014, T015, T020, T050).
- [X] T052 [US3] Implement `GET`/`POST` in `src/app/api/products/route.ts` (201/200 idempotent, 409 codes from the contract) (depends on T051).
- [X] T053 [US3] Implement `GET`/`PATCH` in `src/app/api/products/[id]/route.ts` (depends on T051).
- [X] T054 [P] [US3] Implement `GET` in `src/app/api/products/similar/route.ts` (depends on T051).
- [X] T055 [P] [US3] Build `src/components/products/ProductForm.tsx`: name and unit required; unit picker with common units (strip, bottle, box, tablet, vial, tube, sachet) and a custom value; optional fields; money inputs with inline errors; client-generated id (create) or `expected_version` (edit); double-submit protection; keeps input on failure; shows non-blocking price warnings. On a 409 `version_conflict` show "This product was changed elsewhere" with the typed values still visible and a "Load latest" action; never overwrite silently (FR-028).
- [X] T056 [P] [US3] Build `src/components/products/SimilarProductsDialog.tsx` (shows similar or duplicate products, "Open existing" for blocked duplicates, "Reactivate existing" when the blocking product is inactive, "Create as separate product" requiring explicit confirm for similar ones).
- [X] T057 [US3] Build the products list page `src/app/(app)/products/page.tsx` and `src/components/products/ProductList.tsx` with debounced search-as-you-type suggestions selectable with one tap, Active/Inactive filter, loading, error with Retry, empty state "Add your first medicine", "No results" state with an add link, and a clear "No selling price" badge (depends on T021, T022, T052).
- [X] T058 [US3] Build `src/app/(app)/products/new/page.tsx`, `src/app/(app)/products/[id]/page.tsx` (detail with the internal panel showing purchase price, MRP, and Unit Gross Profit or "Not available"; deactivate/reactivate with confirmation) and `src/app/(app)/products/[id]/edit/page.tsx` (the edit page loads the record's current `version` and passes it to the form; deactivate/reactivate also sends `expected_version`) (depends on T053, T055, T056).

**Checkpoint**: US3 works alone; T046–T049 pass.

---

## Phase 6: User Story 5 — Business data isolation (Priority: P1)

**Goal**: Prove and harden that each business sees only its own data from day one.

**Independent Test**: With two businesses owning stores and products, neither can list, read, change, or deactivate the other's records by any route; signed-out requests return nothing.

### Tests for User Story 5 ⚠️

- [ ] T059 [P] [US5] RLS integration tests in `tests/integration/rls-isolation.test.ts` using `tests/helpers/supabase-test.ts`: A cannot select, update, or deactivate B's stores/products; A cannot insert a row with B's `business_id` and cannot change `business_id` on its own rows; no delete is possible for any role; anon returns nothing; `profiles`/`businesses` return only the caller's own row (SC-003). **WRITTEN, NOT RUN against Supabase. The same scenarios pass at SQL level on PGlite (`db-schema.pglite.test.ts`).**
- [ ] T060 [P] [US5] Route-level tests in `tests/integration/cross-business-api.test.ts`: A requesting B's store/product ids via `GET`/`PATCH` receives 404 without any detail of B's data; A's lists never include B's rows; a create using an id that exists in B returns the same generic `validation_error` on field `id` ("This id cannot be used") that any unusable id produces, with no detail of B's data, and the client generates a new id. **WRITTEN, NOT RUN: cases live in `tests/integration/rls-isolation.test.ts`; needs the Supabase test project.**
- [ ] T061 [P] [US5] Schema guard test in `tests/integration/rls-enabled.test.ts`: every table in the `public` schema has RLS enabled and a `business_id` column (except `businesses` and `profiles`), so future modules cannot forget it. **WRITTEN, NOT RUN against Supabase. The same check passes on PGlite.**

### Implementation for User Story 5

- [X] T062 [US5] Fix any gap the tests expose in `supabase/migrations/0001_init.sql` or the repositories (for example id-collision handling: after a primary-key violation, look the id up under RLS; if the row is visible it is the caller's own, so return it with 200, otherwise return the generic `validation_error` on `id` without revealing another business's row) in `src/lib/stores/repository.ts` and `src/lib/products/repository.ts`.
- [X] T063 [P] [US5] Add a secrets/leak check script `scripts/check-secrets.mjs` that fails if the strings `SERVICE_ROLE` or `GEMINI_API_KEY`, or JWT-like key values, appear under `src/`, or if a real `.env` file (anything except `.env.example`) is tracked by git or contains a service-role JWT value in any tracked file; `tests/helpers/` may reference the environment variable name only (T026), never a value. Wire it into `npm run lint`.

**Checkpoint**: T059–T061 pass; no cross-business access is possible by any tested route.

---

## Phase 7: User Story 4 — Mobile app shell and navigation (Priority: P2)

**Goal**: Reliable, touch-friendly navigation with loading, error, and empty states on every screen; responsive up to desktop.

**Independent Test**: At 360 px width reach every screen using visible navigation only, and trigger loading, error, and empty states on each list.

### Tests for User Story 4 ⚠️

- [ ] T064 [P] [US4] E2E in `tests/e2e/shell.spec.ts` (mobile project): every bottom-navigation item opens a working screen with the active item highlighted; every screen is reachable through visible controls only. **WRITTEN, NOT RUN: needs the Supabase test project.**
- [ ] T065 [P] [US4] E2E in `tests/e2e/touch-targets.spec.ts`: on every screen, all visible interactive elements measure at least 44×44 px; text is not clipped at 360 px (SC-007). **PARTLY RUN: the sign-in screen check passes (`smoke.spec.ts`); the signed-in screens are written, not run.**
- [ ] T066 [P] [US4] E2E in `tests/e2e/states.spec.ts`: using request interception, each list (stores, products) shows a loading indicator while pending, an error with Retry when the request fails (and not the empty state), and the empty state with the next action when there are no records. **WRITTEN, NOT RUN: needs the Supabase test project.**
- [ ] T067 [P] [US4] E2E in `tests/e2e/responsive.spec.ts` (desktop and tablet widths): navigation switches to the side/top bar layout and all functions remain available. **WRITTEN, NOT RUN: needs the Supabase test project.**

### Implementation for User Story 4

- [X] T068 [P] [US4] Add `loading.tsx`, `error.tsx`, and `not-found.tsx` for `src/app/(app)/`, `src/app/(app)/products/`, and `src/app/(app)/stores/`, using `Spinner`, `ErrorState` (Retry), and a not-found view with a link home.
- [ ] T069 [US4] Audit and fix `src/components/shell/BottomNav.tsx` and `src/components/ui/*` for 44 px targets, focus rings, keyboard navigation, accessible names, safe-area padding on phones, and the responsive switch at `md`. **NOT DONE: controls were built to the 44 px rule, but only the sign-in screen has been measured in a browser.**
- [X] T070 [US4] Ensure every list and form uses the shared `EmptyState`/`ErrorState` components and that no screen can render blank; fix any screen that fails T064–T067.

**Checkpoint**: T064–T067 pass.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and documentation. Report only results that were actually produced.

- [X] T071 [P] Write `README.md` at the repository root: prerequisites, environment setup, migration, owner provisioning, run, and test commands (from `quickstart.md`), plus the known limits of this module.
- [ ] T072 Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e`, and `npm run build`; fix all failures; record the real command output summary in `specs/001-auth-products-stores/quickstart.md` under a "Verification results" heading, including anything that could not be run (for example Docker unavailable). **PARTLY DONE: lint, typecheck, build pass; unit + PGlite tests pass (71); E2E smoke passes (28); 35 integration and 72 E2E tests are skipped without the Supabase test project. See quickstart.md "Verification results".**
- [ ] T073 Walk through `specs/001-auth-products-stores/quickstart.md` section 5 manually against the running app at 360 px and mark each acceptance scenario of `spec.md` as passed or failed in a short checklist appended to `specs/001-auth-products-stores/checklists/requirements.md`. Include a timed manual run of SC-001 (sign in, add a first store with only a name, add a first medicine with only name and unit) and record the elapsed time. **NOT DONE: needs a running app connected to Supabase.**
- [X] T074 Security review of the diff: confirm no service-role key, Gemini key, or real credentials in `src/` or git history; no endpoint accepts `business_id`; purchase price, MRP, and profit appear only on internal product screens.
- [ ] T075 Ensure a PHR exists for every command run during implementation and, if the user approves, record the ADR for "REST route handlers over RLS-enforced Supabase access with client-generated IDs" via `/sp.adr`. **PARTLY DONE: PHRs exist for each command; the ADR is not created (needs your approval via `/sp.adr`).**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T007 informs file names in later tasks.
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories**. T009 → T010 → T011 → T013 (same migration file, sequential). T026 depends on T013.
- **US1 (Phase 3)**: depends on Phase 2. Its auth guard (T020, T032) is needed by US2/US3 routes at runtime, so finish US1 first.
- **US2 (Phase 4)** and **US3 (Phase 5)**: depend on Phase 2 and on US1's guard; independent of each other and can run in parallel.
- **US5 (Phase 6)**: depends on US2 and US3 (it tests their tables and routes).
- **US4 (Phase 7)**: depends on US2 and US3 screens existing (it audits them).
- **Polish (Phase 8)**: depends on all stories.

### User Story Dependencies

- US1: no story dependencies (MVP).
- US2, US3: need US1's sign-in to be exercised end to end; otherwise independent.
- US5, US4: verification and hardening stories; need US2 and US3.

### Within Each User Story

Tests first (must fail) → schemas → repository → route handlers → UI components → pages.

### Parallel Opportunities

- Phase 1: T003–T006 together.
- Phase 2: T012, T014–T019, T021, T022, T024, T025 together (after T013 for DB-dependent ones).
- US2 and US3 phases in parallel by two workers once US1 is done.
- All test tasks inside a story (marked [P]) together; US5 tests T059–T061 together; US4 tests T064–T067 together.

## Parallel Example: User Story 3

```bash
# Tests together:
Task: "Unit tests in tests/unit/product-validation.test.ts"
Task: "Integration tests in tests/integration/products-api.test.ts"
Task: "Integration test tests/integration/product-search.test.ts"
Task: "E2E in tests/e2e/products.spec.ts"

# After the repository (T051) exists, in parallel:
Task: "Implement GET in src/app/api/products/similar/route.ts"
Task: "Build src/components/products/ProductForm.tsx"
Task: "Build src/components/products/SimilarProductsDialog.tsx"
```

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (including the verified migration, T013).
2. Phase 3 (US1) → **STOP and validate**: sign in, protected redirects, sign-out, expiry.

### Incremental Delivery

1. Add US2 (stores) → test → demo.
2. Add US3 (products) → test → demo.
3. Add US5 (isolation proof) and US4 (mobile polish) → test.
4. Polish: run all checks, record real results, then the module is done only when every check passes (constitution workflow gate).

### Notes

- Do not claim Supabase is connected or any test passes until it has actually been run (Principles I and VIII).
- Commit after each task or logical group. Stop at any checkpoint to validate.
- Never add features from other modules (orders, import, setup checklist, offline sync, voice, invoices).
