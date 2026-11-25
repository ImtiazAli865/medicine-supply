# Security review (Module 011)

Real outputs, taken on 2026-11-24 from the commands named in each section. Nothing here is a guess; a section says plainly what was not checked.

## 1. Row level security of every table

**After every migration, on a real PostgreSQL engine (PGlite)**: `tests/integration/db-rls-all-tables.pglite.test.ts` (8 tests, passed). It applies every file of `supabase/migrations/` and reads the catalog.

```
Public tables (18):
business_settings            rls=on  business_id=yes policies=2
businesses                   rls=on  business_id=no  policies=1
imports                      rls=on  business_id=yes policies=2
invoice_counters             rls=on  business_id=yes policies=0
invoice_events               rls=on  business_id=yes policies=1
invoice_lines                rls=on  business_id=yes policies=1
invoices                     rls=on  business_id=yes policies=1
ledger_entries               rls=on  business_id=yes policies=1
order_counters               rls=on  business_id=yes policies=0
order_events                 rls=on  business_id=yes policies=1
order_lines                  rls=on  business_id=yes policies=1
orders                       rls=on  business_id=yes policies=1
pending_requests             rls=on  business_id=yes policies=0
products                     rls=on  business_id=yes policies=3
profiles                     rls=on  business_id=yes policies=1
purchase_entries             rls=on  business_id=yes policies=1
purchase_voids               rls=on  business_id=yes policies=1
stores                       rls=on  business_id=yes policies=3
```

Findings:

- Row level security is **on for all 18 tables**, with no exception.
- Every table that holds a business's data has at least one policy **except three**: `order_counters`, `invoice_counters` and `pending_requests`. They are **function-only** by design: row level security is on, there is no policy, and `anon` and `authenticated` have **no right at all** (select, insert, update or delete) on them (the test checks every right for both roles). Only the database functions, which run with their own rights, touch them. This is listed with a reason in the test, so a new table without a policy fails the test until someone writes a reason.
- The only table without a `business_id` is `businesses` (the business itself), which has a policy.
- The anonymous visitor has **no right on any table of a business** (checked for select, insert, update and delete on every table with a `business_id`).

**On the Supabase TEST project (the real hosted database)**: `tests/integration/rls-audit-test-project.test.ts` (2 tests, passed) calls the existing `rls_audit()` function with the service role.

```
Tables of the test project (20):
business_settings, businesses, imports, invoice_counters, invoice_events, invoice_lines, invoices, ledger_entries,
order_counters, order_events, order_lines, orders, pending_requests, products, profiles, purchase_entries,
purchase_voids, stores, voice_diagnostics, voice_parse_attempts   -> rls=on for all 20
```

The two extra tables, `voice_diagnostics` and `voice_parse_attempts`, come from the dropped voice work (migrations 0009 and 0010, applied only to the maintainer's test and development projects). Row level security is on for them too. A new production project does not have them. The test also checks that an anonymous visitor cannot call `rls_audit()`.

**Not checked here:** the owner's development project (it was not read in this module; it has the same two voice tables and was set up from the same migrations). The audit function can be run there in the SQL editor with `select * from public.rls_audit();`.

## 2. Every API route needs a signed-in business user

- **Static scan** `tests/unit/api-auth-routes.test.ts` (6 tests, passed): 58 route files under `src/app/api`, every exported handler of 57 of them calls `requireBusinessUser(` (which answers 401 without a session and gives the handler the signed-in client, so row level security applies). The one exception is `ping/route.ts` ("connectivity check: answers an empty 200 and holds no data"); the test also proves it reads no table and no cookie. No route reads a service-role key.
- **The running app** `tests/e2e/api-requires-session.spec.ts` (3 tests, passed): every method of every route (read from the source) was called with **no cookie and no token** against the production build. Every one answered **401 with code `unauthenticated`**; `/api/ping` answered 200 with an almost empty body.
- **The three new password-reset pieces** are not under `/api`: the page `/forgot-password` (public; it only asks for an email), the route `/auth/confirm` (public; it verifies a one-time token and holds no data), and the page `/reset-password` (needs the session `/auth/confirm` creates; without it the visitor is sent to `/forgot-password?error=link`). `tests/unit/reset-password-form.test.ts` proves `/auth/confirm` accepts only `type=recovery` and a well-formed token, never reads a `next` parameter, and can send the browser to only two fixed addresses.

## 3. Secrets in the browser code

- `npm run lint` runs `scripts/check-secrets.mjs` after ESLint: **"Secrets check passed."**
- `tests/unit/bundle-secrets.test.ts` (5 tests, passed) searched **60 files** of the production build (`.next/static`) and `public/` for a key that decodes to the service role, for the value of every secret-looking variable of `.env.local` and `.env.test.local` (2 values: names `GEMINI_API_KEY` and `SUPABASE_TEST_SERVICE_ROLE_KEY`; the values were read at test time and never printed), and for the names `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`, `service_role` and `GEMINI_API_KEY`. **None was found.** The public Supabase URL and anon key are in the bundle by design. The test also proves the scan itself finds a planted service-role key.
- The `GEMINI_API_KEY` value in the maintainer's `.env.local` belongs to the dropped voice work; nothing in the app reads it.

## 4. Dependencies

`npm audit` on 2026-11-24:

- **Production dependencies (`npm audit --omit=dev`): found 0 vulnerabilities.**
- All dependencies: **7 moderate**, all in one development-only chain: `minimatch` (7.0.0 to 11.0.0, advisory GHSA-g3hv-75wg-m249, "potential denial of service via globparts amplification") reached through `@typescript-eslint/typescript-estree` and the packages that depend on it (`typescript-eslint`, `@typescript-eslint/parser`, `type-utils`, `utils`, `eslint-plugin`). These run only on the developer's computer when linting; none is in the app that is shipped. No high or critical finding.
- **Not fixed.** `npm audit fix` would change `package-lock.json` (and possibly package versions), so it waits for the owner's decision (see the plan, task T040). No package was added by this module.

## 5. The backup and the phone copy

- `tests/unit/backup-payments.test.ts` (backup file version 2): the file holds exactly seven fields per waiting payment; a balance, invoice, ledger, cost, profit, margin, MRP, selling price or purchase price key is found **anywhere**, also inside a payment entry; the key `payments` is found at any place except `$.waiting.payments`; the text of a file with payments contains no such key.
- `tests/unit/backup-forbidden-payments.test.ts`, `tests/unit/offline-guard.test.ts` and `tests/unit/offline-no-price.test.ts`: the word "payment" is allowed only in an explicit list of device files, and every other forbidden word (purchase price, MRP, cost, margin, profit, balance, invoice, snapshot, ledger) is forbidden in **all** device files, payment files included. `tests/unit/offline-guard.test.ts` plants each forbidden word in a copy of a payment file and the guard rejects every one.
- `tests/e2e/offline-payments-backup.spec.ts`: the file made on the phone and the restored phone copy were read and contain no balance, invoice, ledger entry, cost or price.
- The phone keeps **no balance**: offline screens show only "N payments waiting, PKR X, not counted yet".

## 6. Other checks

- **Payments sent from the phone** (`tests/integration/payments-queue-api.test.ts`): a store of another business and a store that does not exist both answer `not_found` in the same words; nothing is applied to another business's store.
- **Behaviour found while checking, recorded as it is:** the database treats a repeated payment key as the *same* payment when the store, amount and date match, and does not compare the reference; the first reference stays. The phone never changes the details of a payment it has already sent, except after a refusal (when nothing was recorded).
- **Sending is paused per tab**: the pause is saved on the phone but another open tab only learns it when it reloads. This is not a security issue; it means "Pause sending" is reliable only when one tab of the app is open.
- **What this review did not do:** it did not penetration-test the hosted Supabase service, check rate limits of the sign-in or reset endpoints (those are Supabase's), or review the owner's development project.
