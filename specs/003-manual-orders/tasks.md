---

description: "Task list for Module 003: Manual Orders and Store-wise Order History"
---

# Tasks: Manual Orders and Store-wise Order History

**Input**: Design documents from `/specs/003-manual-orders/`
**Prerequisites**: plan.md, spec.md, research.md (decisions D1-D16), data-model.md, contracts/api.openapi.yaml, quickstart.md
**Tests**: INCLUDED. Constitution Principles I, II, IV, V, VIII and spec success criteria SC-002 to SC-014 require them. Within each story, write its tests first and confirm they fail (or, where the database layer already exists from Phase 2, that they exercise it) before the screens are built.
**Organization**: Grouped by user story. Priority order: US1 take an order (P1), US2 never lose an order (P1), US3 typed lines (P1), then US4 prices (P2), US5 history (P2), US6 edit/cancel (P2), then cross-cutting isolation and quality gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 take a manual order · US2 never lose an order · US3 typed (not registered) lines · US4 price snapshots and unpriced lines · US5 order history · US6 edit or cancel a confirmed order
- Paths are relative to the repository root `D:\my project\medicine-supply`. Do not touch `docs/`, `.specify/`, `.claude/`, `CLAUDE.md`, or the Module 001 and 002 specs while implementing (checking boxes in this file is allowed). Existing migrations `0001_init.sql` and `0002_settings_and_import.sql` MUST NOT be edited.
- Never create real credentials in files. Tests use the separate TEST Supabase project (`.env.test.local`), never the owner's dev project. The dev project receives migration `0003` only after the owner says so.
- Purchase price and MRP are stored in the order snapshot but MUST NEVER appear in any API response or screen of this module (FR-037). Do not use LocalStorage or IndexedDB for order data (Module 009's scope). No new npm packages.

## Path Conventions

Same single Next.js project: `src/app`, `src/components`, `src/lib`, `supabase/migrations`, `tests/{unit,integration,e2e,helpers}`. Reuse existing helpers: `src/lib/ids.ts` (`newId`), `src/lib/money.ts` (exact paisa arithmetic, `formatPKR`), `src/lib/api/{auth,errors,paging,client}.ts`, `src/lib/hooks/{useSearchList,useApiResource,useDebouncedValue}.ts`, `src/components/ui/*`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Test helpers and a green baseline

- [X] T001 [P] Extend `tests/helpers/supabase-test.ts` so `deleteTenant` also deletes the new tables before stores and products (order: `order_events`, `order_lines`, `orders`, `order_counters`, then the existing deletes), and create `tests/helpers/orders.ts` with builders used by every later test: `lineInput(overrides)` (catalog or typed line with a fresh `newId()`), `savePayload(storeId, lines, overrides)` (fresh `request_id`, `expected_version: null`), and `seedStoreAndProducts(db or client)` returning a store plus three medicines (one with all three prices, one with only a selling price, one with no prices).
- [X] T002 [P] Update the hard-coded table lists so the new tables are covered: `tests/integration/db-schema.pglite.test.ts` (table list), `tests/integration/rls-enabled.test.ts` (only if it uses a fixed list; `rls_audit()` must report RLS on and a `business_id` column for `order_counters`, `orders`, `order_lines`, `order_events`), and the tenant clean-up in `tests/e2e/fixtures.ts`.
- [X] T003 Baseline: on this branch run `npm run lint`, `npm run typecheck` and `npm test` before any change and record the real counts in `specs/003-manual-orders/quickstart.md` section 6 (expected: Module 001 and 002 suites green, 272 tests). Stop and report if anything is red.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The database layer, shared types, validation, the autosave state machine and the repository. No story can begin until this phase is complete.

**CRITICAL**: Keep `0001` and `0002` untouched. Every function in `0003` reads the business from `current_business_id()` and filters every statement by it (research D1).

- [X] T004 Write the failing schema test `tests/integration/db-orders-schema.pglite.test.ts` (PGlite via `tests/helpers/pglite.ts`, which applies all migrations in order): tables `order_counters`, `orders`, `order_lines`, `order_events` exist with RLS enabled; `authenticated` has SELECT only on `orders`, `order_lines`, `order_events`, nothing on `order_counters`, and `anon` has nothing on any of them; a direct INSERT, UPDATE or DELETE by `authenticated` on each table is refused; `stores` and `products` have the new `unique (business_id, id)`; the composite foreign keys refuse an order whose store belongs to another business and a line whose product belongs to another business; checks refuse quantity 0 and 100001, empty unit, notes over 1,000, cancel reason over 500, a `cancelled` order without `cancelled_at`, a cancelled confirmed order without a reason, an unknown status or source, and a line where `product_id` is null but `item_status` is `registered` (and the reverse); a price without `snapshot_taken_at` is refused; `order_lines.line_total` is exactly `quantity * selling_price_snapshot` (for example 3 × 125.50 = 376.50) and null when the price is null; `order_events` rows cannot be updated or deleted (trigger error) even by the table owner; the `order_lines` guard refuses a change to a snapshot price, `snapshot_taken_at`, name, strength, dosage form, pack size or manufacturer once `snapshot_taken_at` is set, allows quantity, unit, position, `delivered_quantity` and `removed_at`, and allows the snapshot change when the transaction sets `app.line_snapshot_edit = 'on'` (this is the reserved Module 004 hook; assert it is off by default); the `orders` guard refuses a change of `store_id`, `order_number` or `source` and any status move other than draft to confirmed, draft to cancelled, confirmed to cancelled; `set_row_meta` bumps `version` on each order update; `select now() at time zone 'Asia/Karachi'` works (research D10 check).
- [X] T005 Write `supabase/migrations/0003_orders.sql` part 1 (wrap the whole file in `begin; ... commit;` and put a rollback note as a comment at the top): `unique (business_id, id)` on `stores` and `products` (use `add constraint ... unique`, guarded so a re-run does not fail); tables `order_counters`, `orders`, `order_lines`, `order_events` with every column, default, check, composite foreign key and index exactly as in `data-model.md` (including the generated column `line_total numeric(18,2) generated always as ((quantity * selling_price_snapshot)::numeric(18,2)) stored`, `position`, `removed_at`, `last_request_id`, and `item_status`/`product_id` consistency check). `orders.id`, `order_lines.id` have NO default (ids come from the device).
- [X] T006 In the same file, part 2, triggers: `orders_row_meta` using the existing `public.set_row_meta()`; `orders_guard` (before update: `store_id`, `order_number`, `source` immutable; allowed status moves only draft to confirmed, draft to cancelled, confirmed to cancelled; error code `22023` with a readable message); `order_lines_touch` (maintains `updated_at`; `id`, `business_id`, `order_id`, `created_at` immutable); `order_lines_guard` (snapshot immutability with the `app.line_snapshot_edit` exception, error `snapshot_immutable`); `order_events_append_only` (before update or delete raises).
- [X] T007 In the same file, part 3, security: enable RLS on all four tables; policies `orders_select`, `order_lines_select`, `order_events_select` (`business_id = (select public.current_business_id())`); NO insert/update/delete policies; `revoke all on ... from anon, authenticated` then `grant select` on the three tables to `authenticated`; nothing on `order_counters`.
- [X] T008 In the same file, part 4, read functions: internal `order_to_json(p_biz uuid, p_order uuid, p_with_events boolean)` and the public `order_get(p_id uuid) returns jsonb` (SECURITY INVOKER, stable) and `order_list(p_store uuid, p_status text, p_from date, p_to date, p_q text, p_limit int, p_offset int) returns jsonb` (SECURITY INVOKER, stable) exactly as in `data-model.md`: money as text, `price_basis` (`snapshot` when `snapshot_taken_at` is set; `current` ONLY while the order's status is `draft` and the line's medicine has a selling price; otherwise `none`, so a cancelled order that never had a snapshot shows no price and no total, FR-035), totals (`priced_total`, `priced_lines`, `unpriced_lines`, `line_count`), removed lines excluded, events newest first, `purchase_price_snapshot` and `mrp_snapshot` NEVER selected; `order_list` newest first (`created_at desc, id desc`), filters combined with AND, Pakistan-day bounds converted to a half-open `created_at` range, `p_q` matched as order-number digits (accepting `12`, `#12`, `ORD-0012`) or as store-name tokens, returns at most `p_limit + 1` rows.
- [X] T009 In the same file, part 5: `order_save(p_id uuid, p_request_id uuid, p_expected_version int, p_store_id uuid, p_notes text, p_lines jsonb) returns jsonb` (SECURITY DEFINER, `set search_path = public`) exactly as in `data-model.md`: advisory lock on `hashtext('order:' || p_id)`; create path (active store in this business, next number from `order_counters` with `insert ... on conflict (business_id) do update ... returning`, draft insert, lines insert, `created` event, `unusable_id` on a primary-key clash with another business's id); replay when `last_request_id = p_request_id`; `order_not_editable`, `version_conflict`, `store_locked` (a different store is allowed only for a draft with no active line, and the new store must be active); line validation reasons (`invalid_lines` with detail: more than 200 lines, duplicate line ids, a line id owned by another order or business, `product_id` not in this business, a NEW line for an inactive medicine, typed line without a name, quantity outside 1..100000, empty unit); the function itself trims and collapses repeated spaces in a typed line's `name` and trims `unit`, because users can call the function directly through the database API and bypass the route handler's Zod checks; whole-order replace semantics (update known active lines, insert new, set `removed_at` on missing ones, `position` from array order); draft lines copy name, strength, dosage form, pack size and manufacturer from the medicine and take no price; confirmed-order edits give NEW catalog lines their snapshot immediately, keep `delivered_quantity = quantity` for all active lines, and write ONE `edited` event listing `changes` (quantity, unit, notes, added, removed; never purchase price or MRP) only when something changed; the order row is updated exactly once per successful call.
- [X] T010 In the same file, part 6: `order_confirm(p_id uuid, p_request_id uuid, p_expected_version int)` and `order_cancel(p_id uuid, p_request_id uuid, p_expected_version int, p_reason text)` (both SECURITY DEFINER) exactly as in `data-model.md`; confirm: already confirmed returns `replayed: true` (checked before the version check), `order_not_editable`, `version_conflict`, `order_empty`, then snapshot of every active line (catalog: description plus the three prices, null stays null; typed: `snapshot_taken_at` only), `delivered_quantity = quantity`, status, `confirmed_at`, `confirmed` event with counts and priced total; cancel: already cancelled returns `replayed: true`, `order_not_editable` for fulfilled, `version_conflict`, `reason_required` for a confirmed order with a blank reason, sets status, `cancelled_at`, `cancel_reason`, writes the `cancelled` event. All six functions: `revoke all ... from public, anon`, `grant execute ... to authenticated`.
- [X] T011 Run T004 until it passes; also run `npm test -- db-schema db-settings db-import` so the Module 001 and 002 database suites still pass. Fix only the new migration.
- [X] T012 [P] Extend the error taxonomy in `src/lib/api/errors.ts` with codes `order_not_editable`, `store_locked`, `order_empty` (all HTTP 409) and mirror them in `src/lib/api/client.ts` so `ClientApiError` carries a typed `current` order for `version_conflict`, `order_not_editable` and `store_locked`.
- [X] T013 [P] Create `src/lib/orders/types.ts` with the TypeScript shapes from `contracts/api.openapi.yaml` and `data-model.md`: `OrderStatus`, `OrderLine`, `OrderTotals`, `OrderEvent`, `Order`, `OrderSummary`, `OrderPage`, `OrderSaveInput`, `OrderResult`, `PriceBasis`. No purchase price or MRP fields anywhere.
- [X] T014 [P] Write the failing unit test `tests/unit/order-validation.test.ts`, then `src/lib/validation/order.ts` (Zod 4): `OrderSaveSchema` (`request_id` uuid, `expected_version` null or integer >= 1, `store_id` uuid, `notes` trimmed up to 1,000 or null, `lines` at most 200 each with uuid `id`, `product_id` uuid or null, `name` trimmed with spaces collapsed up to 200 and required when `product_id` is null, integer `quantity` 1..100000, `unit` trimmed 1..50, duplicate line ids refused), `OrderActionSchema` (`request_id`, `expected_version`), `OrderCancelSchema` (adds `reason` up to 500, blank becomes null), `OrderListQuerySchema` (`store_id` uuid, `status` in draft/confirmed/cancelled, `from`/`to` as `YYYY-MM-DD` real dates with `from <= to`, `q` up to 200, `limit` 1..100 default 50, `cursor`). Messages are plain English field messages like the existing validation modules.
- [X] T015 [P] Write failing unit tests `tests/unit/order-number.test.ts` and `tests/unit/order-dates.test.ts`, then `src/lib/orders/number.ts` (`formatOrderNumber(12)` is `ORD-0012`, `ORD-10000` for 10000, `parseOrderSearch("#12" | "ord-0012" | "12")` returns the digits, text that is not a number returns null) and `src/lib/orders/dates.ts` (`pakistanDayRange(from, to)` and `formatPakistanTime(iso)` for "Saved at HH:MM", `todayInPakistan(now)`; Pakistan is UTC+05:00 with no daylight saving).
- [X] T016 [P] Write failing unit test `tests/unit/order-totals.test.ts`, then `src/lib/orders/totals.ts`: `lineTotal(quantity, sellingPrice)` using integer paisa from `src/lib/money.ts` (3 × "125.50" is "376.50"; 100000 × "9999999999.99" does not lose precision; null price gives null), `orderTotals(lines)` returning `{ pricedTotal, pricedLines, unpricedLines, lineCount }` (an unpriced line is never counted as zero and is counted in `unpricedLines`), and `totalsLabel(totals)` returning the wording "Total of priced lines" plus "N lines have no selling price" whenever `unpricedLines > 0`.
- [X] T017 [P] Write the failing unit test `tests/unit/autosave.test.ts` (Vitest fake timers and a fake transport that can fail, lose a response after applying, reply `replayed: true`, or reply `version_conflict`), then `src/lib/orders/autosave.ts`, a pure framework-free state machine (research D7): states `idle`, `dirty`, `saving`, `saved`, `error`, `conflict`; edits debounce about 800 ms and coalesce into ONE request; only one request is in flight; an edit during a request is sent afterwards with the version returned by the previous response and a NEW `request_id`; the first save sends `expected_version: null`; a failed request is retried with the SAME `request_id` and payload (3 attempts with back-off) and then becomes `error`, and `retry()` resends the same request; a lost response followed by a retry results in exactly one stored order and one set of lines when the fake server replays by `request_id`; `version_conflict` stops autosaving, keeps the local edits, and exposes the server's current order; no request is made when nothing changed; `flush()` returns a promise that resolves only when every local edit has been confirmed by the server (immediately when nothing is unsaved) and rejects when the machine ends in `error` or `conflict`, so Confirm, Discard and leaving the page can wait for it (an edit typed a moment before Confirm is saved first and never dropped); only network failures and HTTP 5xx responses are retried automatically, while 400, 401, 404 and 409 responses stop the machine in `error` or `conflict` with the server's message and are NEVER retried in a loop; an edit made while a request is being retried, or whose response was lost, waits until that request is resolved (retried with its own `request_id`) and is then sent with the version it returned and a NEW `request_id`, so the user's own earlier change is never reported as "Changed elsewhere"; the machine exposes `isDirty` (true from the first unsaved edit until the server confirms it) for the leave-page warning, `lastSavedAt` (the server's `updated_at`), and `status` text keys `saving | saved | not_saved | changed_elsewhere`.
- [X] T018 Write `src/lib/orders/repository.ts`: `listOrders`, `getOrder`, `saveOrder`, `confirmOrder`, `cancelOrder`, each calling the matching database function through the user's own Supabase client (`supabase.rpc`), decoding the jsonb result, and mapping the function's `reason` to `ApiError`: `version_conflict` (409, `current` = the returned order), `order_not_editable` (409, `current`), `store_locked` (409, `current`), `order_empty` (409), `not_found` (404), `store_inactive`, `invalid_lines`, `reason_required` and `unusable_id` (400 `validation_error` with `fields` such as `store_id`, `lines`, `reason`, `id`). `listOrders` takes the parsed query and returns `{ items, next_cursor }` using `decodeCursor` and `slicePage` from `src/lib/api/paging.ts`.
- [X] T019 Apply `supabase/migrations/0003_orders.sql` to the TEST Supabase project (`medicine-supply-test`) through the SQL Editor (the owner signs in; never ask for or type passwords or the secret key). Verify the four tables, the two unique constraints, the six functions, RLS on, and the `Asia/Karachi`, generated-column and advisory-lock behaviours listed in `research.md` ("Items to verify when the migration is first applied"); record the results in `specs/003-manual-orders/quickstart.md` section 7. Apply to the owner's dev project (`medicine-supply-dev`) ONLY after the owner says so, then run a read-only check that the 68 medicines and the stores are unchanged.

**Checkpoint**: Database, validation, number/date/total helpers, autosave machine and repository ready; all six stories can now be built.

---

## Phase 3: User Story 1 - Take a manual order for a store (Priority: P1) MVP

**Goal**: Choose (or add) a store, search the catalog, add lines with quantity and unit, edit and remove lines, add notes, and confirm the order.

**Independent Test**: With a catalog of a few medicines and one store, create an order with three lines, confirm it, and find it again (by its address) with the right store, lines, quantities, units, notes and an order number.

### Tests for User Story 1 (write first)

- [X] T020 [P] [US1] `tests/integration/db-orders-create-confirm.pglite.test.ts` (PGlite): first `order_save` creates a draft with order number 1 and a `created` event; a second order gets number 2; an unknown or foreign store is refused; an inactive store is refused (`store_inactive`); catalog lines copy the medicine's name, strength, form, pack size and manufacturer and carry no price while draft; `invalid_lines` for more than 200 lines, duplicate line ids, a foreign line id, a foreign or unknown product, a new line for an inactive medicine, quantity 0, empty unit; `order_confirm` with at least one line sets status, `confirmed_at` and one `confirmed` event; confirm of an order with no lines returns `order_empty` and the draft stays a draft; confirming twice returns `replayed: true` without a second event; confirm sets `delivered_quantity` equal to `quantity` on every active line (FR-030); a direct call of `order_save` with the typed name `  Panadol   500  ` stores `Panadol 500` and a unit with surrounding spaces is stored trimmed.
- [X] T021 [P] [US1] `tests/integration/orders-api.test.ts` (Supabase test project, two signed-in test users via `tests/helpers/supabase-test.ts`): `PUT /api/orders/{id}` creates (201) then repeating the same request returns 200 `replayed: true` with the same order number; `GET /api/orders/{id}` returns lines and totals and never contains the strings `purchase_price` or `mrp`; `POST .../confirm` confirms and a second confirm returns the original; unknown id 404; no session 401; bad quantity, bad unit, 201 lines and a malformed body give 400 with field messages; user B gets 404 for user A's order. Skips with a clear message when `.env.test.local` is missing, like the other Supabase tests.
- [X] T022 [P] [US1] `tests/integration/product-search.test.ts` (extend the existing file): searching a dosage form word (for example "tablet") finds medicines by dosage form; every token must match name, brand, generic name, strength, manufacturer, SKU or dosage form; existing cases still pass; search text containing a comma, brackets, a double quote or a backslash (for example `5,mg`, `a)b`, `x"y`) returns a normal result list or an empty list and never an error.
- [X] T023 [P] [US1] `tests/e2e/orders-take.spec.ts` (Playwright, 390 px phone viewport, production build, test project): add a store inline from the selector, take an order of 3 catalog lines, edit one quantity, remove one line, add a note, confirm; the confirmed order shows the store, number `ORD-0001`, lines and note; no medicine can be added before a store is chosen; with no stores the selector offers "Add your first store"; an empty-catalog message appears in the search; a duplicate store name offers the existing store instead of creating another; selecting a medicine that is already in the order shows the existing line for adjusting and adds a second line only after "Add as a separate line" (FR-007); changing a quantity and tapping Confirm immediately, before the autosave delay, confirms the order with the NEW quantity (no edit is lost).

### Implementation for User Story 1

- [X] T024 [US1] Route handlers `src/app/api/orders/[id]/route.ts` (`GET` returns `getOrder` or 404; `PUT` parses `OrderSaveSchema`, calls `saveOrder`, returns 201 for a first creation and 200 otherwise, with `{ replayed, order }`) and `src/app/api/orders/[id]/confirm/route.ts` (`POST` parses `OrderActionSchema`, calls `confirmOrder`). Follow `src/app/api/products/route.ts`: `handle(...)`, `requireBusinessUser()`, `readJson`, Zod parse; the path `id` must be a UUID.
- [X] T025 [US1] Make the medicine search match dosage form (research D11): in `src/lib/products/repository.ts` `listProducts`, replace the per-token `ilike("search_text", ...)` with an `or(...)` of `search_text` and `dosage_form` for each token (escape the token with `escapeLike`), keeping the status filter, ordering and paging unchanged. Build the filter value safely: PostgREST's `or(...)` syntax treats commas, brackets and quotes specially, so wrap each pattern in double quotes and escape backslashes and double quotes inside it (or reject those characters); never concatenate raw user text. Run `tests/integration/product-search.test.ts` and the products API tests.
- [X] T026 [P] [US1] `src/components/orders/StoreSelector.tsx`: searchable list of active stores (`useSearchList("/api/stores", q, "active")`, 44 px rows showing name and phone), an always-visible "Add new store" action that creates a store from the typed name alone with `newId()` and `POST /api/stores` (only the name), handles the existing `similar_store` response by showing the existing store(s) and offering to select one instead of creating a duplicate, selects the new store, and shows "Add your first store" when there are none. Loading, error with Retry, and empty states.
- [X] T027 [P] [US1] `src/components/orders/NewOrderStart.tsx` and `src/app/(app)/orders/new/page.tsx` (`force-dynamic`, `requirePageContext`): the store step; choosing a store generates the order id with `newId()` and goes to `/orders/<id>?store=<storeId>` with `router.replace` (nothing is created on the server yet, research D12).
- [X] T028 [P] [US1] `src/components/orders/MedicineSearch.tsx`: a searchable panel (`useSearchList("/api/products", q, "active")`, 250 ms debounce) whose results show name, strength, dosage form, pack size, manufacturer and unit so similar medicines can be told apart, plus a "No selling price" badge when the medicine has none; selecting a result returns the medicine and a quantity; "No matching medicine" and "Your catalog is empty" states with links to add or import medicines. (The typed-line options are added in US3.)
- [X] T029 [P] [US1] `src/components/orders/OrderLineRow.tsx`: one line with the medicine description, a quantity field (whole number 1..100000, numeric keyboard, 44 px) and unit field (starts from the medicine's unit, up to 50 characters), a remove button, inline field messages; if the same medicine is selected again, the existing line is highlighted for adjusting and a second line is created only after an explicit "Add as a separate line" choice (FR-007).
- [X] T030 [P] [US1] `src/components/orders/OrderStatusBadge.tsx` (draft, confirmed, cancelled, using `src/components/ui/Badge.tsx`) and `src/components/orders/ConfirmOrderDialog.tsx` (uses `src/components/ui/Dialog.tsx`: states that prices will be recorded as of now, shows the line count, disables the button while confirming, shows an error and keeps the draft when the confirm fails; the Confirm action is also disabled, with the reason shown, while the editor has unsaved edits, is saving or is in the Not saved state).
- [X] T031 [US1] `src/lib/hooks/useOrderEditor.ts` (client hook binding `src/lib/orders/autosave.ts` to React: local order state, add/update/remove line, set notes, set store, `confirm()` (it first awaits `flush()` and only then sends the confirmation with the version the server returned; if the flush fails the confirmation is NOT sent and the unsaved state is shown), `discard()` (same flush rule), online/offline events, exposes `saveStatus`, `isDirty`, `lastSavedAt`) and `src/components/orders/OrderEditor.tsx` (draft mode: store shown, notes field up to 1,000 characters, line list, "Add medicine" opening `MedicineSearch`, confirm button disabled with an explanation while there are no lines, the Add medicine action disabled at 200 lines with the message "An order can have at most 200 lines. Start a new order for more.", the order number once saved). A `new` order (404 plus a valid `?store=` parameter) starts empty and is created by the first change (a line or notes); the editor never remounts after the first save.
- [X] T032 [US1] `src/app/(app)/orders/[id]/page.tsx` (`force-dynamic`, `requirePageContext`) with a client wrapper that loads the order through `useApiResource`: shows the editor for a draft, a read-only summary for a confirmed order (Edit and Cancel are added in US6), loading and error states with Retry, and "Order not found" for a 404 without a valid `?store=`.
- [X] T033 [US1] Add a primary "New order" action to `src/app/(app)/page.tsx` (Home) linking to `/orders/new`, keeping the setup checklist and the existing cards.
- [X] T034 [US1] Run T020 to T023 until they pass; fix defects in the product code, not in the tests.

**Checkpoint**: A supplier can take and confirm a manual order for a store. MVP is demonstrable.

---

## Phase 4: User Story 2 - Never lose an order: automatic draft saving (Priority: P1)

**Goal**: Drafts save automatically, survive refresh and navigation, show honest save states, never overwrite newer data, never mix stores, and can be discarded safely.

**Independent Test**: Start an order, add two lines, refresh: both lines are still there. Leave and return via "Continue order". Cut the connection and edit: the screen says "Not saved". Open the same draft in two tabs: the second save is told the order changed elsewhere.

### Tests for User Story 2 (write first)

- [X] T035 [P] [US2] `tests/integration/db-orders-save.pglite.test.ts` (PGlite): update of a draft bumps the version by one; the same `request_id` replays (no change, no version bump, `replayed: true`); a stale `expected_version` returns `version_conflict` with the current order; `expected_version: null` for an existing order is a conflict; removing a line sets `removed_at` and the line disappears from `order_get` but the row remains (no hard delete); the store of a draft with no lines can change, and with one line returns `store_locked`; a confirmed order's store never changes; two drafts for two stores keep their own lines; `order_cancel` on a draft (discard) without a reason is allowed and the order becomes cancelled with its lines kept; replayed cancel returns `replayed: true`; an induced failure (a batch whose last line reuses a line id that belongs to another order, so its insert fails after the earlier lines were processed) leaves the order, its lines, its version, the order counter and its events exactly as before (SC-008, FR-021); an existing draft whose store has become inactive can still be saved (only creation and store changes need an active store); a discarded (cancelled) draft returns `price_basis = 'none'` and no total from the live catalog (FR-035).
- [X] T036 [P] [US2] `tests/integration/orders-concurrency.test.ts` (Supabase test project): 10 simultaneous `PUT` creates with the SAME order id and different `request_id` values produce exactly one order (one number); 10 simultaneous creates with 10 different ids produce 10 different consecutive numbers; 10 simultaneous confirms of one draft produce one confirmation (`replayed` for the rest) and one `confirmed` event; two sessions saving the same version: one succeeds and the other receives `version_conflict` with the current order; a repeated update with the same `request_id` after its response was "lost" returns success once (SC-005, SC-008, SC-011).
- [X] T037 [P] [US2] `tests/e2e/orders-recovery.spec.ts` (Playwright): after the first line, refresh the page and see all saved lines; navigate to Home and use "Continue order" to reopen the draft exactly as left; with the network blocked (`route.abort`) an edit shows "Not saved" with Retry and a warning when trying to leave, never "Saved", and after the network returns Retry saves it and the line appears once; the same draft open in two pages: the second save shows "Changed elsewhere" with a Review action that loads the current version and keeps nothing silently overwritten; two drafts for two stores keep only their own lines; with a line present the store cannot be changed and "Start a new order for another store" is offered; discarding a draft asks for confirmation and leaves it in history as Cancelled; with the network blocked, make an edit and then a second edit, restore the network: both edits are saved once and no "Changed elsewhere" message appears.

### Implementation for User Story 2

- [X] T038 [P] [US2] `src/components/orders/SaveStatus.tsx`: shows exactly "Saving...", "Saved at HH:MM" (Pakistan time from the server's `updated_at`), "Not saved" with a Retry button, or "Changed elsewhere" with a Review button; announces changes politely for screen readers; never shows "Saved" before the server confirmed.
- [X] T039 [US2] Wire the resilience behaviours into `src/lib/hooks/useOrderEditor.ts` and `src/components/orders/OrderEditor.tsx`: `beforeunload` and in-app navigation warning while `isDirty`; Retry; on conflict stop autosaving, keep the local edits visible, and offer "Review the current order" which loads the server version only after the supplier chooses it; a 401 (session expired) keeps the data on screen with a message to sign in again.
- [X] T040 [US2] Store lock in the editor: once the order has any line, show the store as read-only with the reason and a "Start a new order for another store" link to `/orders/new`; while it has no lines, a "Change store" action reopens the selector. Surface the server's `store_locked` response as the same message.
- [X] T041 [P] [US2] Route `src/app/api/orders/route.ts` `GET` (parses `OrderListQuerySchema`, calls `listOrders`; supports every filter from the start, the History screen in US5 only adds UI) and `src/app/api/orders/[id]/cancel/route.ts` `POST` (parses `OrderCancelSchema`, calls `cancelOrder`).
- [X] T042 [P] [US2] `src/components/orders/CancelOrderDialog.tsx` (discard a draft: confirmation, optional reason up to 500 characters; for a confirmed order the dialog requires a reason, wired in US6) and a "Discard draft" action in the draft editor.
- [X] T043 [P] [US2] `src/components/orders/ContinueOrders.tsx` and its use in `src/app/(app)/page.tsx`: up to three newest drafts (`GET /api/orders?status=draft&limit=3`) as 44 px cards showing order number, store, number of lines and last saved time, each linking to the draft; hidden when there are none; a failure to load it never breaks Home.
- [X] T044 [US2] Run T035 to T037 until they pass; record real results (counts, not guesses) in `specs/003-manual-orders/quickstart.md` section 6.

**Checkpoint**: No order is lost mid-entry; stale saves never overwrite; stores never mix.

---

## Phase 5: User Story 3 - A medicine that is not in the catalog (Priority: P1)

**Goal**: Type a medicine that is not in the catalog as a "Not registered" line that never blocks saving or confirming; never auto-match or substitute.

**Independent Test**: With an empty catalog, create an order with two typed lines, confirm it, and verify the lines keep the exact typed names, quantities and units, are marked "Not registered" and "No selling price", and the order confirmed without any block.

### Tests for User Story 3 (write first)

- [X] T045 [P] [US3] `tests/integration/db-orders-typed.pglite.test.ts` (PGlite): a typed line is stored with `product_id` null, `item_status = 'pending_registration'`, the exact typed name (spaces cleaned only) and no description fields; saving and confirming an order with only typed lines works; at confirm the typed line gets `snapshot_taken_at` with all three prices null and `line_total` null; a typed line without a name is refused; the same typed text twice in one order is accepted by the database (the warning is a screen rule); linking is not possible through any Module 003 function; a direct update by the table owner that sets `product_id` and `item_status = 'registered'` on a typed line succeeds and leaves `name` unchanged (the path Module 004 will use, FR-014).
- [X] T046 [P] [US3] `tests/e2e/orders-typed.spec.ts` (Playwright): starting from a brand-new business with an empty catalog AND no stores, add a store from the selector, take an order of two typed lines and confirm it (master prompt Section 17 item 21); with matching medicines present the matches are listed first and "None of these, it is a new medicine" is always offered and adds a typed line; the typed text is kept exactly (Urdu or mixed text included); entering the same typed text twice shows a warning without merging; a typed line can be edited (name, quantity, unit) before confirming; the confirmed order shows "Not registered" and "No selling price" and no price anywhere.

### Implementation for User Story 3

- [X] T047 [US3] Extend `src/components/orders/MedicineSearch.tsx` with the typed-line paths: "Add as typed: <what was typed>" shown when nothing matches, and "None of these, it is a new medicine" shown whenever the search has text, including when matches exist; both open a small form with the name (prefilled from the search text, up to 200 characters), quantity and a required unit, and add a line with `product_id: null` and the exact name. Nothing is ever auto-selected or substituted.
- [X] T048 [P] [US3] Extend `src/components/orders/OrderLineRow.tsx`: a typed line shows a "Not registered" badge and a "No selling price" badge, allows editing its name, and shows a non-blocking warning when another typed line in the same order has the same text (compared with the same case-and-space normalisation as `norm()` in `src/lib/normalize.ts`) with a "Remove this one" shortcut; lines are never merged.
- [X] T049 [US3] Make sure `src/components/orders/OrderEditor.tsx`, the confirm dialog and `src/lib/orders/autosave.ts` payload building treat typed lines exactly like catalog lines for saving and confirming (no block, no extra step), and that the confirm dialog mentions how many lines are "Not registered" (information only).
- [X] T050 [US3] Run T045 and T046 until they pass.

**Checkpoint**: The app is fully usable on day one with an empty catalog.

---

## Phase 6: User Story 4 - Prices stay as they were: snapshots and unpriced lines (Priority: P2)

**Goal**: Drafts show the current price; confirmation records an immutable snapshot; unpriced lines are clearly shown and never block; totals are exact and honest.

**Independent Test**: Confirm an order, change the medicine's selling price in the catalog, reopen the order: the old price and total are shown. Confirm an order containing a medicine with no selling price: it confirms, the line shows "No selling price", and no price appears.

### Tests for User Story 4 (write first)

- [X] T051 [P] [US4] `tests/integration/db-orders-snapshot.pglite.test.ts` (PGlite): confirm copies purchase price, selling price and MRP exactly (empty stays empty) and the medicine's description into the line with `snapshot_taken_at`; the generated `line_total` equals quantity × selling snapshot; changing the product's prices and renaming the product after confirm leaves the order's prices, totals and line description unchanged in `order_get` (`price_basis` is `snapshot`); a direct `update order_lines set selling_price_snapshot = ...` on a snapshotted line raises `snapshot_immutable` even for the table owner; the reserved flag (`set_config('app.line_snapshot_edit','on',true)`) allows a null selling price to be filled (the Module 004 hook) and nothing else in Module 003 sets it; a draft's `order_get` shows `price_basis = 'current'` with the live price and updates when the catalog price changes; unpriced medicines give `price_basis = 'none'`, null total and are counted in `unpriced_lines`; `order_get` never returns purchase price or MRP; a cancelled order that never had a snapshot (a discarded draft) shows no price and no total even when the medicine has a current selling price (FR-035).
- [X] T052 [P] [US4] `tests/integration/orders-prices.test.ts` (Supabase test project, through the API): create, confirm, change the product's selling price through `PATCH /api/products/{id}`, `GET` the order: unchanged prices and totals (SC-004); a draft's price follows the catalog; an order with one priced and one unpriced line returns `priced_total` for the priced line, `unpriced_lines: 1`; the API response bodies contain no `purchase_price` or `mrp` key at any depth.
- [X] T053 [P] [US4] `tests/e2e/orders-prices.spec.ts` (Playwright): a draft line shows "Current price" and a line total; an unpriced medicine shows "No selling price" and no total; the order total is labelled "Total of priced lines" with "1 line has no selling price" when any line is unpriced; after confirming and changing the price in Products, the confirmed order keeps the old price and total; no purchase price, MRP, margin or profit appears on any order screen.

### Implementation for User Story 4

- [X] T054 [P] [US4] Extend `src/components/orders/OrderLineRow.tsx` to show the selling price with its basis ("Current price" for a draft, plain price for a snapshot) and the line total computed by `src/lib/orders/totals.ts` for drafts (the server's `line_total` for confirmed orders as loaded; in edit mode, while a quantity is being changed, `totals.ts` with the line's snapshot selling price and the new quantity), or "No selling price" with no total; format with `formatPKR`.
- [X] T055 [P] [US4] `src/components/orders/OrderTotals.tsx`: shows the total using `orderTotals`/`totalsLabel` from `src/lib/orders/totals.ts`; when any line is unpriced the heading is "Total of priced lines" and the count of lines without a selling price is shown; never presents a partial total as complete.
- [X] T056 [US4] Use `OrderTotals` in `src/components/orders/OrderEditor.tsx` and the read-only confirmed view in `src/app/(app)/orders/[id]/page.tsx`; update `src/components/orders/ConfirmOrderDialog.tsx` to say prices are recorded as of now and, after a successful confirm, show what was recorded (totals from the confirm response).
- [X] T057 [US4] Run T051 to T053 until they pass.

**Checkpoint**: Confirmed orders carry exact, immutable prices; nothing is invented.

---

## Phase 7: User Story 5 - Order History, store by store (Priority: P2)

**Goal**: Find orders by store, status, date and order number; each store's history is independent; opening an order never changes it.

**Independent Test**: Create orders for two stores over two days with different statuses. Filter by each store, by date, by status and by order number, and confirm the right subset appears every time.

### Tests for User Story 5 (write first)

- [X] T058 [P] [US5] `tests/integration/db-orders-list.pglite.test.ts` (PGlite): newest first; each filter alone and combined (store, status, date range, text); a date filter uses the Pakistan day (an order created at 23:30 Pakistan time on day D is found on D and not on D+1; one at 00:30 on D+1 is found on D+1); `q` finds by `12`, `#12`, `ORD-0012` and by store-name words; paging with `p_limit + 1`; drafts total with the live price and confirmed orders with the snapshot; two orders of one store on the same day are separate rows; another business's orders never appear.
- [X] T059 [P] [US5] `tests/integration/orders-history.test.ts` (Supabase test project): through `GET /api/orders` every filter and cursor paging return the expected subsets; with 1,000 seeded orders (seed with the secret key from `.env.test.local` in the test only, never in `src/`) the first page returns within 2 seconds (SC-010); record the measured time.
- [X] T060 [P] [US5] `tests/e2e/orders-history.spec.ts` (Playwright): list with order number, store, date, status, line count and total of priced lines (with the unpriced note); filter by store, status and "Today"; search an order number and a store name; open an order (nothing changes); a draft offers Continue, a confirmed order shows its details, a cancelled order shows its reason; empty state "No orders yet" with "Take your first order"; a no-match state offering to clear filters; the store page shows a link to that store's orders.

### Implementation for User Story 5

- [X] T061 [P] [US5] `src/components/orders/OrderListItem.tsx` (44 px card: `ORD-0012`, store name, date and time in Pakistan time, status badge, line count, total of priced lines with an "N without price" note) and `src/components/orders/OrderFilters.tsx` (store selector, status chips, "Today" and a date range, search box; the filters are kept in the URL query string so the page can be shared and refreshed).
- [X] T062 [US5] `src/components/orders/OrderHistory.tsx` and `src/app/(app)/orders/page.tsx` (`force-dynamic`, `requirePageContext`): the list with filters, "Load more" paging, a prominent "New order" button, loading and error (Retry) states, and the two empty states (no orders at all vs no match). Reads `?store=`, `?status=`, `?from=`, `?to=`, `?q=`.
- [X] T063 [US5] Navigation: add an "Orders" item to `src/components/shell/BottomNav.tsx` (five items: Home, Orders, Products, Stores, Settings; `grid-cols-5`) and update `tests/e2e/shell.spec.ts` and `tests/e2e/touch-targets.spec.ts` for the new item and screens.
- [X] T064 [P] [US5] Add an "Orders" link to `/orders?store=<id>` on the store detail page `src/app/(app)/stores/[id]/page.tsx` (FR-040).
- [X] T065 [US5] Run T058 to T060 until they pass; record the measured first-page time in `specs/003-manual-orders/quickstart.md` section 6.

**Checkpoint**: Every store has its own searchable history.

---

## Phase 8: User Story 6 - Edit or cancel a confirmed order (Priority: P2)

**Goal**: Edit a confirmed order in place with a recorded change history; cancel with a reason; cancelled orders are final.

**Independent Test**: Confirm an order, edit a quantity, add a line and remove a line, then cancel another confirmed order with a reason; old snapshots are unchanged, the new line has its own snapshot, every change is in the change history, and a cancelled order cannot be edited.

### Tests for User Story 6 (write first)

- [X] T066 [P] [US6] `tests/integration/db-orders-edit-cancel.pglite.test.ts` (PGlite): editing a confirmed order's quantity keeps the line's snapshot and updates `line_total`; `delivered_quantity` follows the new quantity; a line added during an edit gets its snapshot at that save; a removed line gets `removed_at` and an `edited` event containing the removed line (name, quantity, unit, selling price, no purchase price or MRP); one `edited` event per save with before and after values, and no event for a save that changes nothing; the order stays `confirmed`; stale version returns `version_conflict`; the same `request_id` replays; `order_cancel` of a confirmed order requires a non-blank reason (`reason_required`), keeps lines and snapshots and writes a `cancelled` event; a cancelled order refuses save, confirm and cancel changes (`order_not_editable`, replay for a repeated cancel); events cannot be updated or deleted; an induced failure during a confirmed-order edit (a late line violating a constraint) leaves lines, snapshots, version and events exactly as before (SC-008).
- [X] T067 [P] [US6] `tests/integration/orders-edit-cancel.test.ts` (Supabase test project, API): the same behaviours through `PUT`/`POST`; two sessions editing the same confirmed order: the second gets `version_conflict` and nothing is overwritten (SC-011); a direct PostgREST `delete`, `update` and `insert` on `orders`, `order_lines` and `order_events` by the signed-in user is refused (SC-014: no hard delete through the app).
- [X] T068 [P] [US6] `tests/e2e/orders-confirm-edit-cancel.spec.ts` (Playwright): open a confirmed order, Edit, change a quantity, add a medicine, remove a line (asks to confirm), Save changes, and see the change history entries; Discard changes restores the saved order; cancel a confirmed order (reason required, blank refused), then the order is read-only with its reason and no Edit or Confirm action; two pages editing the same confirmed order: the second save shows "Changed elsewhere".

### Implementation for User Story 6

- [X] T069 [US6] Edit mode in `src/components/orders/OrderEditor.tsx` and `src/lib/hooks/useOrderEditor.ts`: for a confirmed order, no autosave; an "Edit" action puts the editor in edit mode with explicit "Save changes" (one `PUT`, status stays Confirmed) and "Discard changes"; removing a line asks for confirmation; the leave-page warning applies while there are unsaved edits; conflicts reuse the US2 handling; new lines show "Price recorded when you save" instead of a current price.
- [X] T070 [P] [US6] `src/components/orders/OrderHistoryLog.tsx`: the order's change history newest first (created, confirmed, edited with its list of changes, cancelled with the reason), times in Pakistan time; rendered on the order screen; shows no purchase price or MRP.
- [X] T071 [US6] Finish the order actions in `src/app/(app)/orders/[id]/page.tsx` and `src/components/orders/CancelOrderDialog.tsx`: a confirmed order offers Edit and Cancel; cancelling a confirmed order requires a non-blank reason (up to 500 characters) and shows the field message when blank; a cancelled order is read-only, shows its reason, and offers no Edit, Confirm or Reopen.
- [X] T072 [US6] Run T066 to T068 until they pass.

**Checkpoint**: Confirmed orders can change safely, with a record of every change.

---

## Phase 9: Cross-Cutting - Isolation, Security and Quality Gates

**Purpose**: Gates that cover the whole module; all must pass before the branch is merged.

- [X] T073 [P] `tests/integration/db-orders-rls.pglite.test.ts` (PGlite, two tenants): a user can read only their own orders, lines and events; all three write functions refuse a foreign order id (not found), a foreign store id and a foreign product id in the payload, and a foreign line id; a direct write by `authenticated` is refused; `order_list` and `order_get` never return another business's rows; order numbers are independent per business (both start at 1).
- [X] T074 [P] `tests/integration/rls-orders.test.ts` (Supabase test project, two real users): the API refuses every read, list, create-into, edit, confirm, cancel and reference attempt across businesses (SC-006) and changes 0 rows of the other business; the history of one business never includes the other's orders.
- [X] T075 [P] `tests/integration/search-5000.test.ts` (Supabase test project): seed 5,000 medicines (test only, secret key from `.env.test.local`, never in `src/`) and measure 40 searches (name, strength, manufacturer, SKU, dosage form, two-word searches): 95% return within 1 second (SC-009). If this fails because of the `dosage_form` match, add a follow-up migration `0004_products_search_dosage_form.sql` that rebuilds the generated `search_text` including `dosage_form` (and re-creates its trigram index), apply it to the test project, and re-measure. Record the measured values.
- [X] T076 [P] Update `tests/e2e/touch-targets.spec.ts` and `tests/e2e/states.spec.ts` (and `responsive.spec.ts` if needed) so every new screen (`/orders`, `/orders/new`, an order draft, a confirmed order, a cancelled order) is checked at 360 px: reachable through visible navigation, every interactive control at least 44 × 44 px, and a loading, error (with Retry) and empty state verified for each list or data screen (SC-012).
- [X] T077 [P] Timed order test `tests/e2e/orders-timing.spec.ts`: automated 10-line order on a phone viewport with a 500-medicine catalog (seed through the test helper) measuring from "New order" to the confirmed screen; record the measured time as the automated proxy for SC-001 (the owner's timed run on a real phone is T081).
- [X] T078 Security and honesty sweep: search `src/` for `purchase_price`/`mrp` in order code and responses, `localStorage`/`sessionStorage`/`indexedDB` use for order data, the service-role or secret key in browser code, "synced" or "saved on this device" wording, `any` types, ignored errors and dead buttons in the new components; fix what is found and list the checks and results in `specs/003-manual-orders/quickstart.md` section 6.
- [X] T079 Full verification, actually run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`. Record the real counts and any skips (with reasons) in `specs/003-manual-orders/quickstart.md` section 6. Never write "passed" for something that was not run. Also record a mapping of the applicable master-prompt Section 17 items to the tests that cover them: 3 and 4 (T037, T058, T060), 6 (T045, T046), 14 (T051 to T053), 18 for conflicting edits (T036, T067), 19 (T073, T074), 20 (T076), 21 (T046); an item without a passing test is reported as not covered.
- [X] T080 [P] Update `README.md` with the Orders module (how to take an order, the change-history and snapshot rules in two sentences, the new migration `0003` and how it is applied) and add `specs/003-manual-orders/quickstart.md` section 6 results.
- [X] T081 Owner verification on a real phone against the dev project (after the owner approves applying `0003` to dev): the timed 10-line order (SC-001, target under 3 minutes), a typed medicine, the refresh and Continue order test, the airplane-mode "Not saved" test, the store lock, a price change after confirm, edit and cancel, and history filters (quickstart section 4). Record the owner's answers in quickstart section 6. Mark SC-001 as not clearly met if it is not, as was done in Module 002.
- [X] T082 Ask the owner whether to record the ADR suggested in `plan.md` (`/sp.adr order-write-model-and-price-snapshots`); create it ONLY with the owner's consent. Create the PHR for the implementation work under `history/prompts/003-manual-orders/`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies; T001 and T002 can run in parallel; T003 first checks the baseline.
- **Foundational (Phase 2)**: depends on Setup. Inside it: T004 (failing test) then T005 to T010 (one migration file, in order), T011 (green), then T012 to T017 (parallel, different files) and T018 (needs T012, T013, T014), T019 (needs T011; owner involvement).
- **User stories (Phases 3 to 8)**: all depend on Phase 2.
  - US1 is the MVP and has no dependency on other stories.
  - US2 builds on the US1 editor (T031, T032) and adds its own routes, dialogs and cards.
  - US3 extends the US1 search and line row (T028, T029).
  - US4 extends the US1 line row and editor; it needs US3 only for the typed-line price cases.
  - US5 needs the list route from US2 (T041) and is otherwise independent of US3, US4, US6.
  - US6 needs US1 (confirm) and US4 (snapshots) and reuses US2's conflict handling.
- **Cross-cutting (Phase 9)**: after the stories it checks; T073 to T075 can start as soon as Phase 2 is done.

### Within each story

Tests first, then components and routes, then wiring, then the "run until green" task.

### Parallel opportunities

- Phase 1: T001 and T002 together.
- Phase 2 after T011: T012, T013, T014, T015, T016, T017 together.
- US1: T020 to T023 together; then T026 to T030 together (T024 and T025 are independent of them but touch routes and the products repository).
- US2: T035 to T037 together; T038, T041, T042, T043 together.
- US3: T045 and T046 together.
- US4: T051 to T053 together; T054 and T055 together.
- US5: T058 to T060 together; T061 and T064 together.
- US6: T066 to T068 together.
- Phase 9: T073, T074, T075, T076, T077, T080 together.
- The six stories can be split among people after Phase 2, except where a dependency above says otherwise.

### Parallel example (User Story 1)

```text
Task T020: tests/integration/db-orders-create-confirm.pglite.test.ts
Task T021: tests/integration/orders-api.test.ts
Task T022: tests/integration/product-search.test.ts
Task T023: tests/e2e/orders-take.spec.ts
-- then --
Task T026: src/components/orders/StoreSelector.tsx
Task T028: src/components/orders/MedicineSearch.tsx
Task T029: src/components/orders/OrderLineRow.tsx
Task T030: src/components/orders/ConfirmOrderDialog.tsx
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 and Phase 2 (database, validation, autosave machine, repository; migration on the TEST project).
2. Phase 3 (US1): a supplier can take and confirm a manual order. Stop and demonstrate on the test project.
3. Before any real use, add US2 (never lose an order) and US3 (typed lines): these three P1 stories together are the minimum that is safe to use for real orders.

### Incremental delivery

US1 then US2 then US3 (the safe core), then US4 (prices), US5 (history), US6 (edit and cancel), then Phase 9. Each story ends with its own "run until green" task and an honest record of results; commit and push only when the owner asks. Apply migration `0003` to the owner's dev project only after the owner approves, and rebuild `.next` with the dev env before the owner uses the app.

### Honesty rules for this module

No offline claims; "Saved" only after the server confirmed; no invented price; no purchase price or MRP on any order screen or response; no hard deletes; every claim in the quickstart results is backed by a command that was actually run.

---

## Notes

- Every task names the file or files it changes. Tests that need the Supabase test project skip with a clear message when `.env.test.local` is missing; they still count as "not run" in the final report in that case.
- Module 004 (pending products) will reuse `order_lines.product_id`, `item_status`, the typed `name` and the reserved `app.line_snapshot_edit` hook without a schema change (see `data-model.md`).
- Module 009 (offline) will reuse device-created ids, request ids, versions and the idempotent `order_save` without a schema change.
