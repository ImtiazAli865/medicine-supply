# Quickstart: Pending Products (Quick Register, Linking, Pending Prices)

**Branch**: `004-pending-products` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

How to build, run and verify Module 004 once implemented. Nothing here has been run yet; section 6 is filled in during implementation with real results only.

## 1. Prerequisites

- Module 003 is available: either PR #2 (`003-manual-orders`) has been merged into `master` and this branch has been updated from it, or this branch is still stacked on `003-manual-orders` (it was created from it). Module 004 needs the Module 003 order tables and functions.
- `.env.local` (dev project) and `.env.test.local` (test project) exist as before; **never commit them** and never paste keys into chat.
- `npm install` has been run (this module adds **no** new packages).
- Migrations `0001` to `0003` are already applied to the test project and to the dev project (they are).

## 2. Apply the migration

Migration `supabase/migrations/0004_pending_products.sql` is applied the same way as 0003:

1. **Test project first** (`medicine-supply-test`): paste the file into the Supabase SQL Editor (the owner signs in; never ask for or type passwords or keys) and run it. A "destructive operations" warning may appear for the `drop ... if exists` and the `drop constraint` lines; it is expected and they only touch objects of this module or the one `order_events` check that the file replaces.
2. Run the automated tests (section 3) against the test project.
3. Only after the tests pass and the owner agrees, apply the same file to the **dev project** (`medicine-supply-dev`). Before and after, run the read-only counts: medicines, stores, orders, order lines (the dev catalog had 156 medicines and 1 store on 2026-11-10; record the actual numbers at the time). They must be identical after the migration, and `typed_name` must be null on every existing line.

The migration only adds objects, replaces one check constraint and one view function; the rollback notes are in data-model section 9.

## 3. Automated checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

- `npm test` runs Vitest: unit tests, PGlite tests (real PostgreSQL in memory, no credentials), and the Supabase integration tests (these need `.env.test.local` and are skipped with a message when it is missing).
- `npm run test:e2e` builds the app against the **test** project and runs Playwright. It rebuilds `.next` with the test env: stop any running dev-project server first and rebuild with `npm run build` before using the app on the dev project again.
- Module 003's tests must still pass unchanged (the order write functions are not modified).

## 4. Manual walkthrough (owner, on a phone)

Serve the dev-project build to the phone: `npm run build`, then `npm run start -- -H 0.0.0.0`, and open `http://<PC IP>:3000` on the same Wi-Fi.

1. **Register from an order**: take an order with a typed medicine that is not in the catalog (for example "Noran 20mg cap", quantity 3, unit strip), confirm it. On the order, tap "Register this medicine". Check the form shows the typed text and unit as suggestions and nothing else is filled. Save with only the name and unit. The line now shows the medicine and "As typed: Noran 20mg cap"; the quantity and unit are unchanged; the history shows the link.
2. **Duplicate protection**: try to register the same medicine again from another typed line: it is blocked and offers "Use the existing medicine". Try the same name with a different strength: a warning asks you to confirm "Create as a separate medicine".
3. **Link to an existing medicine**: on another typed line choose "This is an existing medicine", search, pick one, and check the side-by-side details before confirming.
4. **Proposals**: type "Noran 20mg cap" in orders for two other stores (one draft, one confirmed) and "Noran 40mg cap" in a third. Register or link the first; the "Link these too?" list shows the two matching lines with store, order number and quantity, and the 40 mg line only under "Looks different, not proposed". Confirm one line and ignore the other: only the confirmed one changes.
5. **Pending Prices**: Home shows "Needs attention". Open it, choose a medicine without a price, enter a price (try 0 and 12.345: both refused), review the list of lines, and confirm "Save price and fill these lines". Check the lines now show the price and total, lines that already had a price did not change, and the history shows the fill. Repeat the confirm (refresh and press again): nothing changes twice.
6. **Save price only**: on another medicine choose "Save price only"; confirmed lines stay on the list as waiting.
7. **Nothing lost**: while registering from a draft, keep the draft open in a second tab; the second tab says the order changed elsewhere and keeps its typed data.
8. **Empty states**: with nothing pending, Home, the typed list and the prices list each say so and offer a next action.

## 5. Things to check that automation cannot

- The register and link dialogs are comfortable with one hand at 360 px; the side-by-side comparison makes a different strength obvious at a glance.
- The review list for a price fill is understandable (store, order number, quantity, total) and the supplier can tell which lines will not be touched.
- The Home "Needs attention" card is noticed and not noisy when many imported medicines have no price.

## 6. Verification results

*(To be completed during implementation. Record only what was actually run: lint, typecheck, test, build and e2e counts with skips and reasons; the 1,000-pending-lines / 500-unpriced-medicines list time; and the owner's walkthrough answers.)*

## 7. Items checked at first apply (from research.md)

*(To be completed: the eight items listed at the end of research.md, on PGlite and on both Supabase projects.)*
