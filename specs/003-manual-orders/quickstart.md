# Quickstart: Manual Orders and Store-wise Order History

**Branch**: `003-manual-orders` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

How to build, run and verify Module 003 once implemented. Nothing here has been run yet; section 6 is filled in during implementation with real results only.

## 1. Prerequisites

- Modules 001 and 002 are merged into `master` (they are) and this branch is checked out.
- `.env.local` (dev project) and `.env.test.local` (test project) exist as before; **never commit them** and never paste keys into chat.
- `npm install` has been run (this module adds **no** new packages).

## 2. Apply the migration

Migration `supabase/migrations/0003_orders.sql` is applied the same way as 0002:

1. **Test project first** (`medicine-supply-test`): paste the file into the Supabase SQL Editor and run it. A "destructive operations" warning may appear for `drop ... if exists` lines; it is expected.
2. Run the automated tests (section 3) against the test project.
3. Only after the tests pass and the owner agrees, apply the same file to the **dev project** (`medicine-supply-dev`). Check afterwards that the 68 existing medicines and the stores are unchanged (a read-only count).

The migration only adds objects and two unique constraints; rolling back means dropping the new tables and functions, which the file documents in a comment at the top.

## 3. Automated checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

- `npm test` runs Vitest: unit tests, PGlite tests (real PostgreSQL in memory, no credentials), and the Supabase integration tests (these need `.env.test.local` and are skipped with a message when it is missing).
- `npm run test:e2e` builds the app against the **test** project and runs Playwright. It rebuilds `.next` with the test env: stop any running dev-project server first and rebuild with `npm run build` before using the app on the dev project again.

## 4. Manual walkthrough (owner, on a phone)

Serve the dev-project build to the phone: `npm run build`, then `npm run start -- -H 0.0.0.0`, and open `http://<PC IP>:3000` on the same Wi-Fi.

1. **Take an order (SC-001)**: Orders -> New order, choose a store (or add a new one by name), add 10 medicines by searching, enter quantities, Confirm. Note the time from tapping "New order" to the confirmed screen; target under 3 minutes.
2. **Typed medicine**: search for something that is not in the catalog, choose "Add as typed", give a quantity and unit, and confirm the order. The line says "Not registered" and "No selling price".
3. **Refresh test**: add two lines to a draft, refresh the page; both are still there. Leave to Home, then use "Continue order".
4. **Not saved state**: turn on airplane mode, add a line: the screen says "Not saved". Turn it off and press Retry: it says "Saved" and the line is there once.
5. **Store lock**: in a draft with one line, the store cannot be changed; "Start a new order for another store" is offered.
6. **Price snapshot**: confirm an order, change that medicine's selling price in Products, reopen the order: the old price and total are shown.
7. **Edit and cancel**: edit a confirmed order (quantity, add a line, remove a line), look at its change history, then cancel it with a reason; it becomes read-only.
8. **History**: filter by store, by status, by "Today", and search an order number.

## 5. Things to check that automation cannot

- The order screen is comfortable with one hand at 360 px; the medicine search results are easy to tell apart (name, strength, form, pack size, manufacturer).
- "Saved at HH:MM" matches the phone's clock (Pakistan time).

## 6. Verification results

Recorded 2026-11-10, only what was actually run on branch `003-manual-orders` (commit d618276 plus the test fixes it contains):

| Check | Result |
|---|---|
| `npm run lint` (eslint and secret check) | pass |
| `npm run typecheck` | pass |
| `npm test` (Vitest: unit, PGlite database, Supabase test-project integration) | 46 files, 467 tests, all passed (final run, after T075 was added) |
| `npm run build` (dev environment) | pass |
| `npm run test:e2e` (Playwright, full suite, mobile and desktop projects) | Final run: 266 tests: 221 passed, **1 failed**, 44 skipped, 16.2 minutes (the failure is described below). The earlier full run, before T076 added tests, was 258 tests: 214 passed, 0 failed, 44 skipped |
| Order browser specs only (mobile project) | 47 of 47 passed |
| 1,000-order history, first page of 30 (Supabase test project) | 208 ms (SC-010 target: under 2 s) |
| Automated 10-line order, 500-medicine catalog, "New order" to Confirmed | 23.6 s in the last full run (29.0 s in another run). This is instant automated entry, not a human time |

- The 44 skipped e2e tests are all in the `desktop` project: the order specs are marked "mobile project only", so they are skipped there on purpose. They ran on the `mobile` project.
- A first full e2e attempt was cut off when the session ended (147 passed, none failed, no summary). It was discarded and the whole suite was rerun from the start; only the rerun is counted above.
- Two order e2e tests failed once because their locators matched more than one element (a total note containing "no selling price", and an inline form next to the add-medicine dialog). The product code was correct; the locators were scoped and both pass.

**Results of the last open tasks, and what is still not a clean pass:**
- **One e2e failure in the final run, cause not found:** `stores.spec.ts` "add with only a name, search by part of it, edit, deactivate and reactivate" (a Module 001 test, no order code) failed once at the step that expects the saved phone number `0300-1234567` to be visible after "Save changes". It had passed in the earlier full run and passed 8 of 8 when the spec file was repeated alone (40 of 40 tests). It did not reproduce, so it is recorded as an intermittent failure with an unproven cause (a timing race under the load of the full run is only a guess). The full suite is therefore NOT a clean pass.
- T075 (SC-009): measured on the Supabase test project with 5,000 medicines and 40 searches (name, strength, manufacturer, SKU, dosage form, two words) through `listProducts`, no warm-up: 40 of 40 within 1 second, median 214 ms, p95 256 ms, slowest 288 ms ("Maker 39"). The dosage-form match works through the existing search, so the follow-up migration `0004` was not needed. Test: `tests/integration/search-5000.test.ts`.
- T078 security and honesty sweep of `src/` (searches run on 2026-11-10): purchase price or MRP in order code or responses: only comments saying they never appear, and the SQL `order_to_json` does not return them (they exist only in the snapshot columns); browser storage for order data: none (`sessionStorage` is used only by the Module 002 import wizard); service-role or secret key and non-public env names in `src/`: none; "synced", "saved on this device" or offline wording in order code: none; `any`, `@ts-ignore`, `eslint-disable`: none; empty `catch` blocks and swallowed errors: none; order buttons without an action: 0 of 38. Note: the signed-in owner can read the snapshot columns of `order_lines` directly through the API (their own data); no order screen or order response shows them.
- Master-prompt Section 17 items that apply to this module, and the passing tests behind them: 3 and 4 (orders for several stores, store-wise records): `orders-recovery.spec.ts` (two drafts for two stores keep only their own lines), `orders-history.spec.ts`, `orders-history.test.ts`, `db-orders-list.pglite.test.ts`, `rls-orders.test.ts`; 6 (unknown medicines keep their quantities): `orders-typed.spec.ts`, `db-orders-typed.pglite.test.ts`; 14 (historical prices after a catalog price change): `orders-prices.test.ts`, `orders-prices.spec.ts`, `db-orders-snapshot.pglite.test.ts`; 18, conflicting edits only: `orders-concurrency.test.ts`, `orders-edit-cancel.test.ts`, `autosave.test.ts`, and the "changed elsewhere" tests in `orders-recovery.spec.ts` and `orders-confirm-edit-cancel.spec.ts`; 19 (authentication and RLS): `rls-orders.test.ts` (two businesses, signed-out visitor), `db-orders-rls.pglite.test.ts`; 20, responsive layouts: `touch-targets.spec.ts` (every order screen at 360 px) and `states.spec.ts`; 21 (empty catalog and no stores, full order): `orders-typed.spec.ts` first test. **Not covered here:** 18's failed sync operations (offline sync is Module 009), 20's print output (no printing in this module); items 1, 2, 5, 7 to 13, 15 to 17 and 22 belong to other modules.
- T076: `states.spec.ts` now also covers the Orders list (loading, error with Retry, empty, and "No orders match"): 28 passed, 4 skipped (desktop project, 360 px tests) in a targeted run together with `touch-targets.spec.ts`.
- T081: the owner's walk-through on a real phone (section 4, dev project build over Wi-Fi, 2026-11-10) is only partly done. Owner's answers: the first timed 10-line order took about 20 minutes, because it was the owner's first time on the screen and understanding it took longer; the owner expects it to get faster with practice, but a second timed run has not been done. **SC-001 (under 3 minutes) is therefore NOT met, and not confirmed.** Checks 2 (typed medicine), 4 (Not saved and Retry), 5 (store lock), 6 (price snapshot), 7 (edit and cancel) and 8 (history) were reported as passing and nothing odd was noticed. Check 3 (refresh test) was not understood at first; the owner then did it and reported it as done with no problem mentioned (the owner did not give a separate pass or fail wording). The walk-through is complete; SC-001 is marked not clearly met, as was done for Module 002, and a second timed run after practice is still a suggested follow-up.

## 7. Items checked at first apply (from research.md)

**Migration `0003_orders.sql` applied to the dev project (`medicine-supply-dev`) on 2026-11-10** through the Supabase SQL Editor, signed in by the owner. Read-only checks before and after:

| | Before | After |
|---|---|---|
| Medicines | 156 | 156 |
| Stores | 1 | 1 |
| Profiles | 1 | 1 |
| Order tables (`orders`, `order_lines`, `order_events`, `order_counters`) | 0 | 4 |
| Order functions | 0 | 6 |
| Row Level Security on the four order tables | n/a | on (4 of 4) |
| Table grants for signed-in users on `orders`, `order_lines`, `order_events` | n/a | SELECT only |
| Grants for signed-in users on `order_counters` | n/a | none |
| Rows in `orders` | n/a | 0 |

Supabase showed its generic "destructive operations" warning because the file has `drop trigger/policy if exists` lines; they only touch objects created by this same file. The migration is one transaction (`begin` to `commit`) and reported "Success".

Covered by tests on the TEST project and PGlite (all passing in the run above): `Asia/Karachi` day bounds, the generated `line_total` column, the advisory lock with 10 simultaneous requests, and the gapless counter. Still open: products search with `dosage_form` on 5,000 medicines (T075).
