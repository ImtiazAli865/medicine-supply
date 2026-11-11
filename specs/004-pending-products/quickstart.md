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

**Status (2026-11-11): all five stories and the polish and verification tasks T054 to T060 are built, tested and recorded. A clean full run exists (lint, typecheck, 630 unit and integration tests, 289 browser tests, build). NOT done: the owner steps T061 (apply `0004` and `0005` to the dev project), T062 (phone walkthrough) and T063 (ADR consent), and the pull request T064. So this is not a completed module: nothing has been tried by the owner on a phone, and the dev project does not have the migrations yet. Everything below was actually run on 2026-11-10 and 2026-11-11.**

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` (all Vitest suites) | 56 files, 604 tests, all passed (the Module 003 total was 467; the 137 new are 17 schema, 25 register, 13 link, 8 candidates, 16 price fill and 9 summary on PGlite, 33 register, link, candidates, summary, pending prices API and simultaneous requests on Supabase, 16 validation) |
| Order screens and Module 004 browser tests together (`orders-*`, `pending-*`, `touch-targets`, `shell`, `states`, mobile project) | After US5: the US5 spec first run 8 passed, 1 failed, which found a real defect (a line linked from the proposals list stayed on the To register list; fixed); the second run failed in my own test (a race: it read the review panel before it was drawn; fixed); the third run passed 9 of 9. The wider regression (orders, pending, products, touch targets, shell, states) passed 108 of 109 on the second run, the one failure being that same test race; it was not rerun as a whole after the fix, only the US5 spec was. After US4 (this set plus the `products` spec): 100 passed, 0 failed in 11.5 minutes; the two failures seen after US3 did not come back, but their cause stays unproven. Earlier, first run after US3: 89 passed, 2 failed (a US3 same-order test and the register "draft open in a second page" test, both timing out on a very slow 33-minute run); run again on their own, both spec files passed 17 of 17 (9 register, 8 proposals). The cause of the two failures in the long run is not proven (not reproduced, load suspected). Earlier chain: 75 passed (59 existing, 9 register, 7 link) |

- **Baseline (T001):** the first baseline attempt was started before the migration file existed and finished while the file was half written, so its failures (database suites) were caused by that and it is not counted. The clean reference is the Module 003 verification (46 files, 467 tests, all passed, recorded in `specs/003-manual-orders/quickstart.md`); the full `npm test` above passes every one of those 467 tests plus the new ones, so nothing regressed.
- Two real defects were found and fixed while testing: the migration was first assembled with JavaScript `String.replace`, which turned `$$` into `$` (the database tests failed at once); and the browser's own `required` check hid the app's field messages in the register form (fixed with `noValidate`).
- The simultaneous-request tests ran against separate connections to the real test project: 10 identical register requests gave one medicine, one link, one event, and ten matching responses (one new, nine replayed).
- Not run yet: `npm run build` and the full e2e suite (both planned for T060), the 1,000-line scale check (T056), and the owner's walkthrough (T062).

### Polish results (T054 to T059)

| Check | Result |
|---|---|
| Isolation (T054) | `db-pending-rls.pglite.test.ts` 10 passed and `rls-pending.test.ts` (TEST project, two real users) 5 passed. A crafted order, line, medicine or request id of business A gets business B exactly the answer of a missing id; 0 rows of A change; a request id used by A is not replayed for B; `pending_requests` is closed to both users and visitors; a visitor can call none of the functions |
| History (T055) | `db-pending-history.pglite.test.ts` 6 passed: `linked` and `price_filled` events cannot be changed or deleted, `typed_name` is write-once and survives edits and a cancel, an editor holding the old typed line gets `version_conflict` |
| 360 px, states, navigation (T057) | `touch-targets`, `states` and `shell` specs, mobile project: 32 passed. New: every pending screen and dialog has no target under 44 px and no sideways scroll; both Pending lists and the Home card have loading, error with Retry and empty states; the bottom navigation still has 5 items |
| Security and honesty sweep (T058) | In `src/` the words purchase price / MRP appear in pending code only in the register form fields; no `localStorage`/`sessionStorage`/`indexedDB` for pending data (the only `sessionStorage` use is the Module 002 import wizard); no service-role or secret key; no "synced" or "saved on this device" wording; no `any`, no empty `catch`, no `@ts-ignore`; no "link all" or auto-linking (the one mention is a comment saying there is none); typed text is never parsed for strength or form (the only text handling is the name and label comparison and the first word used to list look-alikes); every button in `src/components/pending` has a handler. One note: the trigger function `pending_requests_guard` can be executed by `anon` as a function, but a trigger function cannot be called through the API |
| README (T059) | Module 004 section added; migration `0004` in the setup steps |

**Scale (T056, SC-011).** 1,000 typed lines, 1,000 waiting lines of one medicine and 500 medicines without a price, on the TEST project, 5 runs each, times are the database calls from this machine (network round trip included, the Next.js route and the browser are not).

| Call | Before `0005` (ms) | After `0005` (ms, max of 5) |
|---|---|---|
| Home summary | 281 | 233 |
| Need a price, first page | 2,557 to 2,792 (over the 2 s limit) | 254 |
| Need a price, search | 339 | 242 |
| Need a price, last page | up to 2,740 (over the limit) | 209 |
| To register, first page / search / late page | 251 / 381 / 251 | 262 / 274 / 379 |
| Proposals for a medicine with 250 matching lines | statement timeout (over 8 s) | 241 |
| Price review of 1,000 lines | 619 | 422 |
| Price fill of 1,000 lines (once) | 834 | 346 |

Cause (found with EXPLAIN ANALYZE on PGlite): the planner re-ran the "waiting lines" aggregate once for each of the 501 medicines (about 4.5 million buffer hits), and `pending_candidates` recomputed every medicine's labels for every typed line. Fix: migration `0005_pending_perf.sql` (the aggregate is `MATERIALIZED`; labels are computed once). Only function bodies changed. On PGlite the same data went from 115 s to 0.1 s for the list and from 14.5 s to 0.05 s for the proposals. `0005` was applied to the TEST project only (see section 7); it is NOT applied to the dev project.

### Full verification (T060)

| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | pass |
| `npm test` | 60 files, 630 tests, all passed |
| `npm run test:e2e` (mobile and desktop), first full run | 286 passed, 87 skipped by design (tests that are for one project only), **3 failed**: (1) mobile, the Need a price loading test: two `loading` elements at once, strict-mode error in my new test, fixed with `.first()`; (2) desktop, the Home card loading test: it used the shared test business, which holds other tests' data, fixed with a fresh business; (3) desktop, Module 002 "5,000-row xlsx" import: timed out at 60 s in the full run, passed in 5.9 s when run alone (csv and xlsx); the cause is not proven (load suspected) |
| `npm run test:e2e`, rerun after the two test fixes | **289 passed, 87 skipped, 0 failed**, exit code 0, 24.4 minutes (full run of 2026-11-11 after the two test fixes, as one chain with `npm test` and the build; the rerun that was stopped by hand on 2026-11-10 is not counted). The 87 skips are the tests that declare they run in one project only (mobile or desktop), the same mechanism as in Module 003. The three failures of the first run did not come back, including the Module 002 "5,000-row" import test, so its one timeout stays unexplained and not reproduced |
| `npm run build` after the e2e run | exit code 0, run right after the e2e run, so `.next` is built for the dev environment again (the e2e run builds it for the TEST project) |
| Section 17 mapping | the table below |

**Master prompt Section 17, the items this module touches** (every file named here was part of the passing run above):

| Item | Covered by | Note |
|---|---|---|
| 3 and 4: orders for several stores kept apart | `pending-proposals.spec.ts` (confirming one line changes only that line; the other stores' orders keep their version), `db-pending-link.pglite.test.ts` (only the chosen line changes), `db-pending-rls.pglite.test.ts`, `rls-pending.test.ts` | Module 003 covers creating the orders; here: register, link and fill never mix stores or orders |
| 6: unknown medicines without losing quantities | `db-pending-register.pglite.test.ts`, `pending-register.spec.ts` | typed text, quantity and unit stay on the line |
| 7: linking a newly registered product to existing pending orders | `db-pending-candidates.pglite.test.ts`, `pending-api.test.ts` (candidates), `pending-proposals.spec.ts` | one confirmed line at a time, no link-all |
| 9: different strengths and pack sizes kept separate | `db-pending-register.pglite.test.ts` (a similar medicine needs explicit confirmation), `db-pending-candidates.pglite.test.ts` (a 40 mg line is not proposed for 20 mg), `pending-register.spec.ts`, `pending-proposals.spec.ts` (a look-alike is linked only by hand) | |
| 14: historical prices preserved | `db-pending-price-fill.pglite.test.ts` (a line that has a price is identical byte for byte after a fill), `pending-prices.test.ts`, `pending-prices.spec.ts` | in this module: a recorded price is never changed; Module 003 covers a later catalog price change |
| 19: RLS restrictions | `db-pending-rls.pglite.test.ts` (10), `rls-pending.test.ts` (5, two real users), `db-schema.pglite.test.ts` (`pending_requests` has RLS on) | |
| 20: responsive layouts | `touch-targets.spec.ts` (every pending screen and dialog at 360 px), `states.spec.ts`, `shell.spec.ts` | **print output is not covered here** (this module has no print) |
| 22: Quick Register with only name and unit, linking other stores' lines after confirmation | `pending-register.spec.ts`, `pending-link.spec.ts`, `pending-proposals.spec.ts`, `db-pending-register.pglite.test.ts`, `db-pending-link.pglite.test.ts` | |
| 24: the Pending Prices flow | `db-pending-price-fill.pglite.test.ts`, `pending-prices.test.ts`, `pending-prices.spec.ts` | **blocking invoice issue until the Selling Price is set is NOT covered here**; it belongs to Module 006 |

The other items of Section 17 (1, 2, 5, 8, 10 to 13, 15 to 18, 21, 23, 25) are not part of this module.

## 7. Items checked at first apply (from research.md)

**Migration `0004_pending_products.sql` applied to the TEST project (`medicine-supply-test`) on 2026-11-10** through the owner's signed-in Supabase tab (page title checked as `medicine-supply-test` before running). Read-only counts before and after: 15 medicines, 3 stores, 1 order, 2 order lines, 0 events, identical. After: `typed_name` exists and is null on every line; `pending_requests` exists with RLS on and no grants for `anon` or `authenticated`; 3 indexes; 8 public functions, all executable by signed-in users and not by `anon`; `pending_link_line` not executable by either; the `order_events` check lists the six event types. Supabase showed its generic "destructive operations" warning because the file has `drop trigger if exists` and replaces one check constraint.

Checked so far against the eight items of research.md:
1. Event check replaced, existing events unchanged, new kinds insert: PGlite and TEST project.
2. `typed_name` null everywhere and write-once (also with the flag on): PGlite.
3. Direct writes to the order tables, `order_events` and `pending_requests` refused; functions not executable by `anon`: PGlite; TEST project (grants query).
4. The snapshot-edit flag is off after a success and after a refusal: PGlite (the error path rolls the transaction back).
5. Register: replay, 10 simultaneous identical requests, stale version: PGlite and TEST project. Link and fill: not yet.
6. Lines that already carry a price are identical after a fill: not yet (US4).
7. The reads return no purchase price or MRP: register response and history checked; the read functions are not built into screens yet.
8. The 1,000 lines / 500 medicines list time: measured (T056), see section 6; it needed `0005`.

**Migration `0005_pending_perf.sql` applied to the TEST project on 2026-11-10** through the owner's signed-in Supabase tab (page title checked as `medicine-supply-test`; "Success. No rows returned."). Read-only check afterwards: `pending_prices_list` and `pending_summary` contain `materialized`, `pending_candidates` uses the new label set, `pending_candidates` is executable by signed-in users, the internal helper `pending_link_line` is not. **Not applied to the dev project.** When `0004` is applied to dev (T061), `0005` must be applied right after it, in that order.
