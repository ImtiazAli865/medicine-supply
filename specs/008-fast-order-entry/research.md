# Research: Fast Order Entry

**Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

Facts below were read from the code on `master` (Modules 001 to 007) on 2026-11-19 unless marked "to measure".

## Facts found in the existing code

1. **Today's add flow**: `OrderEditor` opens `MedicineSearch` (a dialog, `src/components/orders/MedicineSearch.tsx`) from an "Add medicine" button; `pickProduct` closes it, adds one line with quantity 1, and the supplier edits the quantity on the line. Search is `useSearchList("/api/products", ...)`: a 250 ms debounce, then one server request per query (50 rows). The dialog is used by `OrderEditor` only.
2. **`/api/products` sends purchase price and MRP to the browser** (`COLUMNS` in `src/lib/products/repository.ts` includes `purchase_price` and `mrp`). The order screen never shows them, but they travel in the response. FR-026 says nothing new may contain them, so the new list cannot reuse this route.
3. **The PostgREST row cap is 1,000** (`supabase/config.toml`, `max_rows = 1000`; the hosted default is the same). Any list read must page.
4. **Orders are saved by `order_save`** (migration 0003; 0009 of the dropped voice work is applied on TEST and DEV but is not on `master`, and its two extra parameters have defaults, so `master` calls still work). One call carries all lines, is idempotent by `request_id`, refuses a stale `expected_version`, and applies completely or not at all. The editor (`useOrderEditor` + `createAutosave`) turns every edit into one such call.
5. **Reads need no new function**: `authenticated` has `select` on `orders` and `order_lines` with a business filter policy (`orders_select`, `order_lines_select`) and on `products` (`products_select`). Indexes exist for what is needed: `orders_business_store_created_idx (business_id, store_id, created_at desc)`, `order_lines_order_idx (order_id, position) where removed_at is null`, `products_business_active_name_idx`.
6. **Order statuses** are `draft`, `confirmed`, `cancelled`, `fulfilled`; a confirmed order has `confirmed_at`. "Confirmed or later" = `confirmed` or `fulfilled`.
7. **Duplicate handling exists**: `pickProduct` finds a line with the same `product_id` and opens the "already on this order" choice (`duplicate` state); typed duplicates get a warning (`repeatedTypedLineIds`). The 200-line limit is `LIMITS.lines`; quantity rules are `parseQuantity` / `LIMITS.quantityMax`.
8. **Local search semantics to copy** (server): every word of the query must be found in `search_text` (name, brand, generic name, strength, manufacturer, SKU, lower-cased) or in `dosage_form`.
9. **E2E steps that use the dialog**: `tests/e2e/orders-helpers.ts` (`addMedicine`) plus `orders-confirm-edit-cancel`, `orders-take`, `orders-timing`, `orders-typed`, `orders-recovery` and `touch-targets` use the `add-medicine` button and the dialog. They must be updated in one pass.

## Decisions

### D1 - No database migration

**Decision**: Everything is read with the signed-in user's session through the existing select policies, and written through the existing `order_save`. No migration is created. If a measurement (D12) proves a read too slow, a read function is added as `0011_...` or higher (never 0009/0010).
**Why**: The spec prefers no migration; the tables, indexes and policies already exist; nothing new needs to be stored (the usual list and the repeat source are derived).
**Considered**: A SQL function `order_usual_medicines(store)` doing the grouping in the database. It is exact and small on the wire, but it is a new object to migrate and test on three databases and the numbering conflict with the voice migrations makes it costly. Kept as the escalation path.

### D2 - A slim medicine endpoint for the on-device list

**Decision**: New route `GET /api/orders/medicines` returns only `id, name, unit, brand, generic_name, strength, dosage_form, manufacturer, pack_size, sku, selling_price` of **active** medicines (no purchase price, no MRP, no cost). Without `q` it pages the whole active catalog (`limit` up to 900, cursor, ordered by name then id); with `q` it is a server search (up to 30 rows, the same word rules as the existing search). Responses carry `Cache-Control: private, no-store`.
**Why**: FR-026 and Fact 2. One route serves the full load, the search while loading, and the too-large fallback.
**Considered**: Reusing `/api/products` and dropping fields in the browser (the prices would still be sent); adding a `fields` parameter to `/api/products` (changes a Module 001 contract used by other screens).

### D3 - Loading and searching the list on the device

**Decision**: When the order screen opens, a hook loads the pages one after another (900 rows per request) into an array and builds a lower-case search text per row. Until the load ends, typing uses the server search (D2) so the first keystrokes work at once; when it ends, typing is answered on the device. The cap is 6,000 medicines: above that the hook stops, marks the list "too large", and keeps using the server search with a one-line notice. The list is reloaded every time the screen mounts and by a "Refresh medicines" button. It is kept in the component only (no storage), so it can never be mistaken for offline data and never outlives the screen.
**Why**: 5,000 rows is about 1 MB of text (about 150 KB compressed) and about 6 requests; filtering 5,000 rows per keystroke is microseconds to a few milliseconds, which meets the 300 ms goal with a wide margin. The first few seconds are covered by the server search, so there is no waiting.
**Risks (to measure)**: load time of 5,000 rows on the TEST project (budget: fully loaded within 5 seconds on a good connection; typing is never blocked meanwhile); memory is not a concern at this size.
**Considered**: Storing the list in `sessionStorage` or IndexedDB (looks like offline data, which is Module 009, and can go stale across devices); loading all at once (the 1,000-row cap forbids it).

### D4 - Matching, ordering and the highlight rule (pure code, unit tested)

**Decision**: The query is split into lower-case words (at most 8). A medicine matches when every word is a substring of its search text or its dosage form. Results are ordered: names that start with the first word first, then the rest by name then id; at most 30 are shown, with a line "N more: keep typing" if there are more. **Highlight**: exactly one result is highlighted for Enter only when exactly one medicine matches; otherwise nothing is highlighted until the supplier taps or uses the arrow keys. Digits are ordinary text.
**Why**: FR-013 to FR-016, FR-018, SC-005. The rule never guesses between similar strengths.

### D5 - The "x" quantity

**Decision**: A trailing word of the form `x` plus 1 to 6 digits with no space (also `×`) is read as a quantity only when the whole text, including that word, matches no medicine. It is removed from the search words and shown as a small "Quantity 20" tag. It is applied only when the supplier chooses a result (tap or Enter on a highlighted result); then the line is added at once with an Undo. It never chooses a result by itself, and an invalid number (0, above 100,000) shows the allowed range and adds nothing.
**Why**: Some medicine names or pack sizes contain "x10"; the fallback order (text first) means a real medicine is never made unsearchable. FR-018 and FR-019.

### D6 - One screen, two inputs, no dialog

**Decision**: A new inline component `FastAdd` replaces the dialog. It always renders two inputs: the search box and a quantity box (disabled until a medicine is chosen). Choosing a result does `flushSync` to enable the quantity box and focuses it, selects its text (shows 1), and the result buttons ignore the press event that would blur the search box. Enter in the quantity box adds the line and focuses the search box again. The typed (not registered) form is the inline form "Add as typed" inside the same component.
**Why**: Moving focus between two inputs inside one tap keeps the phone keyboard open; a dialog open/close or a button that takes focus would close it. Playwright cannot prove the keyboard on a real phone, so the owner checks it (quickstart section 3) and it is recorded as reported, not seen.
**Considered**: One input that changes meaning (the numeric keyboard does not switch reliably on Android while focused); a bottom-sheet (another open/close).

### D7 - One Undo at a time

**Decision**: A small bar below the search shows "Added [medicine]. Undo" (or "Added N lines from the last order. Undo") for 8 seconds. It holds the ids of the lines just added. Undo removes exactly those lines through the normal edit (so the autosave sends one more save). A new action replaces the bar; the supplier can always remove a line with the existing remove control afterwards.
**Why**: FR-007 and FR-021 are the only recovery the spec asks for; stacking undo is not needed.

### D8 - The usual list and the repeat source

**Decision**: `GET /api/orders/usual?store_id=` returns the usual medicines (up to 12) and the repeat source of the store. Steps, all as the signed-in user: (1) the latest `confirmed` or `fulfilled` order of that store by `confirmed_at` (id, number, date) and its line count; (2) the up to 100 most recent such orders with `confirmed_at` in the last 180 days; (3) their lines (`product_id`, `quantity`, `unit`, `order_id`) read in pages of 1,000 until fewer come back (the row cap, Fact 3), at most 5 pages; (4) counted in code: a medicine counts once per order; sorted by count, then by latest `confirmed_at`, then by id; for each, the quantity and unit of its latest line; (5) the 12 best are looked up in `products` (active only, slim fields) and inactive ones are skipped before the cut so 12 active ones are returned when they exist.
**Why**: Fact 5 and D1. A store with 100 orders of 20 lines is 2,000 line rows, two requests.
**Risk (to measure)**: the whole route for 100 orders of 20 lines on the TEST project: budget 1.5 seconds; over that, the SQL function path of D1.

### D9 - Applying a repeat

**Decision**: `GET /api/orders/repeat?store_id=&order_id=` reads that order's non-removed lines (at most 200) in position order and returns, for each, the data to build one editor line (catalog: product id, quantity, unit, details from the current catalog row; typed: exact name, quantity, unit) and a `skipped` list (inactive or missing medicine, with name and reason). It refuses an order that is not of that store, not confirmed or fulfilled, or not visible to the user (the same answer as "not found"). The client adds all lines in **one** editor change (one `PUT`), so the order is created with all lines or with none; the ids of the lines are made on the device before the save, so a double tap or a retry sends the same lines. The repeat button is hidden while the draft has any line.
**Why**: FR-002 to FR-007. The old order's price snapshots are never read.

### D10 - The existing editor is extended, not replaced

**Decision**: `useOrderEditor` gets `addLines(entries)` (many lines, one edit) and `removeLines(ids)`; `addCatalogLine` accepts the slim medicine type (a `Pick<Product, ...>` without prices). `OrderEditor` replaces the dialog with `FastAdd`, `UsualMedicines` and `RepeatLastOrder` (drafts only) and one `UndoBar`; `pickProduct` gets a quantity argument and keeps the "already on this order" dialog. `MedicineSearch.tsx` is deleted because nothing else uses it.
**Why**: FR-025: no other way to create or change an order.

### D11 - Which database objects and tests prove isolation

**Decision**: Both new read routes run as the user, so Row Level Security does the isolation; the proof is an integration test with two real tenants on the TEST project that have the same store, medicine and order data (each sees only their own), plus a crafted-id test (`order_id` of another business gets "not found"). A static test asserts that no response type of the new routes has a purchase price, MRP, cost or snapshot field, and the integration test asserts the raw JSON has none.

### D12 - Speed measurements (so the goals are measured, not assumed)

| Goal | How it is measured | Budget |
|------|--------------------|--------|
| Keystroke to results, 5,000 medicines | unit benchmark of the pure filter on 5,000 synthetic rows (worst case, 8 words) and an e2e timing on a 5,000-row seeded business | 300 ms for 95% of keystrokes (the filter itself should be under 20 ms) |
| Full load of 5,000 medicines | integration timing on TEST | under 5 s (typing already works through the server search) |
| Usual route, 100 orders of 20 lines | integration timing on TEST | under 1.5 s |
| Repeat route, 200 lines | integration timing | under 1.5 s |
| Tap counts | Playwright counts clicks and key presses per scenario | SC-001, SC-002, SC-004 |

### D14 - Checklist of the last order (added after the owner's trial, user story 6)

**Decision**: A new inline component `LastOrderChecklist` (no dialog) reuses the existing `GET /api/orders/repeat` read (the same lines, the same skipped list, no new route, no migration). Rows are keyed by their position in the source order (the same medicine can appear twice). A pure module `fast-checklist.ts` holds the rules (selection, quantity validation, building the lines to add, which rows are on the order). Adding uses `useOrderEditor.addLines` (one change, one save) and the existing `UndoBar`. A row whose medicine is already on the order is shown "On order" and cannot be selected, so nothing is merged silently. The control is shown for drafts with or without lines (Repeat stays only for drafts with no lines).
**Why**: The owner's orders have 20 to 30 lines and after practice the app took about the same time as handwriting; Repeat copies everything and needs a check of every line, and the usual list shows 12. One tap per wanted medicine and one add is the smallest change that matches how the owner takes an order.
**Considered**: Raising the usual list from 12 to 30 (long cards, one add per tap, no batch); a pop-up checklist (the module removed pop-ups on purpose); a new route (not needed: the repeat read already returns the lines).

### D13 - Not needed

- **ADR**: none. The decisions are local to the order screen, reversible, add no stored data and no new dependency. If the SQL function path is ever taken, that decision gets an ADR then.
- **New packages**: none.
- **Constitution**: its module list still reads "008 voice". The owner dropped voice, so the list is out of date; updating it is the owner's decision (an amendment needs approval) and is only flagged here, not done.

## Open questions

None blocking. Two things are decided by measurement during implementation: the 6,000-medicine cap (D3) and whether the usual read needs the SQL function (D8). Both have a stated budget and a stated fallback.
