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

*(To be completed during implementation. Record only what was actually run: test counts, the 5,000-medicine search time, the 1,000-order first-page time, and the owner's timed 10-line order.)*

## 7. Items checked at first apply (from research.md)

*(To be completed: `Asia/Karachi` in PGlite and on both Supabase projects; generated column cast; advisory lock and counter behaviour; products search with `dosage_form` on 5,000 medicines.)*
