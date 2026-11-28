# Tasks: Store-specific selling prices (Module 012)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Rules for every task**
- Branch `012-store-rates`. No new package. Never edit migrations 0001 to 0011; the only new file is `supabase/migrations/0012_store_rates.sql`.
- Write the named test first and see it fail, then the code (constitution Principle VIII). Never claim a result that was not run.
- No purchase price, MRP, cost, margin or profit in any new type, route, screen or device record. Money is `numeric` in the database and a two-decimal string elsewhere.
- Everything committed is English. Commit, push and merge only when the owner says.

## Phase 1: Setup

- [x] T001 Record the baseline in `specs/012-store-rates/quickstart.md` section 4: `npm run lint`, `npx tsc --noEmit`, and the test counts of the last full run (Module 011: 193 files, 1,921 tests), saying whether it was re-run.

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Shared price cases in `tests/fixtures/effective-price-cases.json`: typed beats rate beats catalog beats none; removed rate; inactive product; line unit different from the product unit (rate ignored, catalog kept); no catalog price with a typed price; typed line.
- [x] T003 [P] `tests/unit/effective-price.test.ts` (every case of T002), then `src/lib/orders/price.ts`: `effectivePrice(input)` returning `{ price, source }`, `parsePriceInput(text)` (above zero, at most two decimals, at most 10 digits), `needsPriceConfirmation(price, catalog)` (differs by more than half).
- [x] T004 [P] `tests/integration/db-store-rates-schema.pglite.test.ts`: both new tables and columns exist, RLS on, no insert/update/delete grant, `store_rate_events` refuses update and delete (except service role), another business sees nothing, a rate cannot point at another business's store or product, and `chosen_price` and `price_source` of a line with a snapshot cannot be updated.
- [x] T005 `supabase/migrations/0012_store_rates.sql` part 1: `store_rates`, `store_rate_events`, `order_lines.chosen_price` and `price_source`, constraints, indexes, policies, append-only trigger, `order_lines_guard` replaced (from 0003) so it also protects `chosen_price` and `price_source` once a snapshot exists, rollback note in the header (data-model.md). The whole file must be safe to run again (`if not exists`, `create or replace`, drop and create for policies and triggers). Make T004 pass.
- [x] T006 `tests/integration/db-store-rates-price.pglite.test.ts` (every case of T002 against the database), then in `0012_store_rates.sql` the function `order_line_effective_price`.
- [x] T007 [P] Add the two new tables to `KNOWN_TABLE_ORDER` in `tests/helpers/tenant-cleanup.ts` and a case in `tests/unit/delete-tenant-helper.test.ts`; check `tests/integration/db-rls-all-tables.pglite.test.ts` covers them.

**Checkpoint**: the price rule exists in one place per side and agrees.

**Note (2026-11-27)**: the database tests of T004, T006, T008, T009, T019, T022, T028 and T032 are in one file, `tests/integration/db-store-rates.pglite.test.ts`.

## Phase 3: User Story 1 - Set the price of a line while taking an order (P1) MVP

**Goal**: change a draft line's price; that price is billed. **Independent test**: spec US1.

### Tests

- [x] T008 [P] [US1] `tests/integration/db-order-prices.pglite.test.ts`: save keeps `chosen_price` when `price` is absent, clears it on null, refuses zero, negative, three decimals and a typed line; draft JSON and `order_list` totals use it; confirm records it with `price_source`; a confirmed line refuses a different price; a new line on a confirmed order takes the typed price, and its `edited` history entry shows the price actually billed (typed or store rate), never just the catalog price; changing a line's unit without sending a price clears the typed price; replay changes nothing; the `confirmed` event holds price and source per line.
- [x] T009 [P] [US1] `tests/integration/db-order-price-check.pglite.test.ts`: `expected_prices` matching confirms; a catalog or rate change in between answers `price_changed` and records nothing; null parameter confirms as before; adding a line to a confirmed order with an `expected_price` that no longer holds answers `price_changed` and saves nothing; exactly one `order_confirm` exists (no overload).
- [x] T010 [P] [US1] Extend `tests/unit/order-validation.test.ts` and `tests/unit/order-totals.test.ts` for `price`, `remember`, `rate_version`, `expected_prices`.

### Implementation

- [x] T011 [US1] In `0012_store_rates.sql` replace `order_save` (start from 0003, keep every existing rule), `order_to_json` (start from 0004; add `price_source`, `chosen_price`, `catalog_price`, `rate`), `order_list` and `order_confirm` (new `p_expected_prices` default null: `drop function if exists` the three-argument version first, then revoke and grant again). In `order_save`, the `added` history entry uses the effective price and source, a unit change clears a typed price, and a new line on a confirmed order checks `expected_price`. All existing `db-orders-*.pglite` tests must pass unchanged.
- [x] T012 [US1] `src/lib/validation/order.ts`, `src/lib/orders/types.ts`, `src/lib/orders/repository.ts`, `src/app/api/orders/[id]/route.ts` and `confirm/route.ts`: new fields, required `expected_prices` in the confirm route, `expected_price` for lines added to a confirmed order, 409 `price_changed`.
- [x] T013 [US1] `src/lib/orders/editor-state.ts`, `totals.ts`, `autosave.ts`: the line input carries `price`; the shown price and source follow `price.ts`; a unit change clears the typed price and the remember tick and re-applies the rule.
- [x] T014 [P] [US1] `tests/e2e/order-line-price.spec.ts` (mobile and desktop): change a price, total updates, survives reload, confirm, invoice shows it, catalog unchanged; refused inputs; the more-than-half question; price changed in another tab before confirm shows the new price and asks again; changing the unit clears the typed price and says so; changing a price takes at most 3 taps plus typing (SC-003); controls at least 44 px at 360 px.
- [x] T015 [US1] `src/components/orders/LinePriceEditor.tsx` (new) used by `OrderLineRow.tsx`; source label ("Typed", "Store rate", "Catalog price", "No selling price"); the confirmation of T003; the note that a unit change cleared the typed price; the price-changed dialog in `ConfirmOrderDialog.tsx` / `OrderEditor.tsx` (confirm, and adding a line to a confirmed order); `OrderView.tsx` read-only for confirmed lines. Make T014 pass; `tests/e2e/orders-*.spec.ts` stay green.

### Offline half of US1 (FR-017)

- [x] T016 [P] [US1] Extend `tests/unit/sync-center.test.ts` and `tests/unit/backup.test.ts`: a typed price survives the journal, reload, send and replay; backup version 3 carries it only at `$.waiting.orders[i].lines[j].price`; versions 1 and 2 still read; a price anywhere else is refused.
- [x] T017 [US1] `src/lib/device/journal.ts`, `sync-center.ts`, `save-transport.ts` (as needed), `local-api.ts`; `src/lib/backup/file.ts`, `preview.ts`, `apply.ts` (contracts/backup-file.v3.delta.json). Update `tests/unit/offline-no-price.test.ts` and `fast-no-price.test.ts` only where they must change, and list those changes for the owner (plan "Constitution Check").
- [x] T018 [P] [US1] `tests/e2e/order-line-price-offline.spec.ts`: type a price with no signal, reload, reconnect, the server records it once; export and import a backup keeps it.

**Checkpoint**: US1 works online and offline without any remembered rate.

## Phase 4: User Story 2 - Remember a store's rate (P1)

**Goal**: tick "remember" and the next order of that store is pre-filled. **Independent test**: spec US2.

### Tests

- [x] T019 [P] [US2] `tests/integration/db-store-rates-remember.pglite.test.ts`: remember sets version 1 and an event with the order id; changing moves the version; same price is a no-op; a stale `rate_version` saves the order and reports `rate_conflicts` without overwriting; replay writes no second event; another store and another business are untouched; a line in another unit is not remembered.
- [x] T020 [P] [US2] `tests/integration/store-rates-api.test.ts` (TEST project): `GET /api/orders/rates`, rate fields on the order JSON, 401 and 404 rules; extend `tests/unit/api-auth-routes.test.ts`.
- [x] T021 [P] [US2] `tests/e2e/order-store-rate.spec.ts`: three stores get 220, 230 and the catalog price; search, usual medicines, repeat last order and the checklist all pre-fill the store's rate; search results and usual-medicine cards on the order screen show the store's rate (never "No selling price" when a rate exists); remember is off by default and unavailable when the line unit differs from the medicine's unit; a rate conflict is said on screen.

### Implementation

- [x] T022 [US2] In `0012_store_rates.sql`: remember handling inside `order_save`, `store_rates_list` and `store_rates_all`.
- [x] T023 [US2] `src/lib/rates/types.ts`, `repository.ts`, `src/app/api/orders/rates/route.ts` and `GET` in `src/app/api/stores/[id]/rates/route.ts`; the order screen loads the store's rates, applies them in `editor-state.ts` for every way of adding a line, and `FastAdd.tsx`, `UsualMedicines.tsx` and `LastOrderChecklist.tsx` show them.
- [x] T024 [US2] "Remember for this store" in `LinePriceEditor.tsx`; the rate-conflict message in `OrderEditor.tsx` / `SaveStatus.tsx`. Make T021 pass.

### Offline rates (FR-016)

- [x] T025 [P] [US2] Extend `tests/unit/device-schema.test.ts`, `device-cache.test.ts`, `sync-center-stores.test.ts`: version 2 to 3 upgrade keeps drafts, store operations and payments; rates are stored with only the whitelisted keys; "use the existing store" keeps typed prices and clears every remember flag, and says so.
- [x] T026 [US2] `src/lib/device/schema.ts` (version 3, `storeRates`), `cache.ts`, `local-api.ts`, `sync-center.ts`; the offline screen shows rates, their age, and lets the supplier remember a price.
- [x] T027 [P] [US2] `tests/e2e/order-store-rate-offline.spec.ts`: offline order shows the store rate; offline price controls are at least 44 px at 360 px; remember offline reaches the server after reconnect; a rate changed on the server in between is reported, not overwritten; upgrade from a version 2 database with waiting items.

### Register, Link and Pending Prices respect rates (spec edge cases)

- [x] T028 [P] [US2] `tests/integration/db-pending-store-rates.pglite.test.ts`: register and link fill the store's rate when one exists; the Pending Prices preview shows price and source per line; apply fills exactly those; a rate changed after the preview refuses the apply; every line filled by register, link or apply gets `price_source` (`store_rate` or `catalog`); exactly one `pending_price_apply` exists; lines that already have a price never change.
- [x] T029 [US2] In `0012_store_rates.sql` replace `pending_link_line`, `pending_price_preview`, `pending_price_apply` (latest versions in 0004/0005), setting `price_source`; `pending_price_apply` gains the expected price per line, so drop its five-argument version first and grant again; `src/lib/pending/*` and `src/components/pending/{RegisterMedicineDialog,LinkMedicineDialog,PriceFillReview}.tsx` show the price and its source. Existing pending tests pass unchanged.

**Checkpoint**: a store's negotiated rate is used everywhere a price is put on a line.

## Phase 5: User Story 3 - Warning when the catalog price moved (P2)

- [x] T030 [P] [US3] Extend `tests/unit/effective-price.test.ts` and `tests/e2e/order-store-rate.spec.ts`: note shown when `catalog_price_at_set` differs from the catalog price now (including from or to "no price"); saved rate still used; note gone after remembering again; also offline.
- [x] T031 [US3] `catalogMoved(rate, catalog)` in `src/lib/orders/price.ts` and the note in `LinePriceEditor.tsx` naming both catalog prices.

## Phase 6: User Story 4 - See and remove a store's rates (P3)

- [x] T032 [P] [US4] `tests/integration/db-store-rates-manage.pglite.test.ts` (set, change, remove, set again, version conflicts, events, invalid rate, other business, a deactivated store keeps its rates) and API cases in `store-rates-api.test.ts`.
- [x] T033 [US4] In `0012_store_rates.sql` `store_rate_set`, `store_rate_remove` (the list exists since T022 and T023); `src/lib/validation/rate.ts`; `src/app/api/stores/[id]/rates/[productId]/route.ts`.
- [x] T034 [P] [US4] `tests/e2e/store-rates-page.spec.ts`: list with identity, rate, date and catalog price; change; remove with a question; the next order follows; loading, error with Retry and empty states; 360 px and 44 px.
- [x] T035 [US4] `src/components/stores/StoreRates.tsx` (new) on the store page. Make T034 pass.

## Phase 7: Polish and delivery

- [x] T036 [P] Leak and guard checks: `tests/unit/offline-no-price.test.ts`, `offline-guard.test.ts`, `reports-no-leak.test.ts`, `bundle-secrets.test.ts` and the invoice, statement and order-sheet no-cost tests pass; a rate never appears on a print; a `db-report-*` case shows that sales and profit use the negotiated price (FR-014).
- [x] T037 [P] Scale: `tests/integration/store-rates-scale.test.ts` (a store with 2,000 rates, an order of 200 lines, `order_list`), run alone, real numbers recorded; clean up with `assertTenantGone`.
- [x] T038 [P] Docs: `README.md` (Module 012 and Status), `guides/supabase-setup.md` (migration 0012; keep `tests/unit/guides.test.ts` green), `guides/offline-and-sync.md` and `backup-and-restore.md` (rates, typed prices).
- [x] T039 Run everything and record real results in `quickstart.md`: lint, typecheck, `npm test`, build, `npm run test:e2e` (rerun any failure alone), and `git diff --stat master -- package.json package-lock.json`.
- [x] T040 Update the Roman Urdu manual in `manual/` (outside git, never committed) and rebuild its PDF.
- [x] T041 Owner: apply `0012_store_rates.sql` to the TEST project (needed before T020 and the browser tests).
- [ ] T042 Owner: apply it to the DEV project and try quickstart section 3; record as reported, not seen.
- [X] T043 Show the owner the guard diffs (T017), then commit, push and open the pull request only when told; merge only when told.

## Where the planned tests ended up (2026-11-27)

Several tasks name a test file of their own; the cases were written in fewer files.

- Database cases (T028, T032, T036): `tests/integration/db-store-rates.pglite.test.ts`.
- API (T020): `tests/integration/store-rates-api.test.ts`; sign-in is covered by the route scans (`api-auth-routes`, `api-requires-session`), which include the new routes without a change.
- Browser (T014, T018, T021, T027, T030, T034): `tests/e2e/order-store-rate.spec.ts` and `order-store-rate-more.spec.ts`, mobile project only. The number of taps is not asserted.
- Backup and device (T016, T025): `backup-order-prices`, `backup-payments`, `device-schema`, `device-cache`, `sync-center-stores`. The browser upgrade test starts from database version 1.
- T017: `offline-no-price` and `fast-no-price` did not need a change. The one guard that changed is in `src/lib/backup/file.ts` (a price is allowed only on a line of a waiting order); T043 shows it to the owner.
- T021, T023: usual-medicine cards and the last-order checklist show no price (unchanged); the line added from them takes the store's rate.
- T036: reports are asserted for sales (profit is computed from the same invoice lines); prints have no dedicated rate check beyond the existing print tests.

## Dependencies and order

- T002 to T006 first. T011 depends on T005 and T006.
- US1 (Phase 3) depends on Phase 2 and is the MVP. US2 depends on US1. US3 depends on US2. US4 depends on T005 and T023 only (T023 already provides the list).
- T041 comes after the migration is complete for the story being tested: after T011 for US1 browser tests, and again after T022, T029 and T033 if the file changed (the migration is written so it can be applied again).
- All parts of `0012_store_rates.sql` (T005, T006, T011, T022, T029, T033) are one file: do them in order, never in parallel.

## Parallel examples

- Phase 2: T002, T003, T004, T007 together.
- US1 tests T008, T009, T010 together; US2 tests T019, T020, T021 together.

## Strategy

MVP is US1: it alone lets the owner bill each store its own price. US2 removes the retyping. US3 and US4 are small additions. Each phase ends with its tests run and recorded.
