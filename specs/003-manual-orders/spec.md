# Feature Specification: Manual Orders and Store-wise Order History

**Feature Branch**: `003-manual-orders`  
**Created**: 2026-11-06  
**Status**: Draft  
**Input**: User description: "Module 003 Manual orders (builds on Module 001 products/stores and Module 002 setup/import). (1) Take orders by hand (typing/tapping, no voice): select a store first, with an inline "Add new store" inside the store selector (only the store name is required); add multiple lines, each with a medicine searched from the catalog (autocomplete on name, strength, form, manufacturer, SKU), a quantity and a unit; edit or remove lines; add order notes. (2) Orders are auto-saved as drafts while being entered so nothing is lost on refresh or navigation; show last saved time. Statuses: draft, confirmed, cancelled (fulfilled is only defined, not used yet). Confirm an order; reopen/edit rules for confirmed orders; cancel with a reason; unique order number per business; order source = manual. (3) Price snapshots: each line keeps a snapshot of purchase price, selling price and MRP so later catalog price changes never silently change existing orders; a line whose medicine has no selling price is shown clearly as having no selling price but never blocks saving or confirming. Line total only when a selling price exists; never invent a price. (4) Store-wise Order History: every store has its own independent history; search/filter by store, date, order number and status; view an order without overwriting it; multiple orders per store per day. Changing the store on a draft must never move lines between stores. (5) A typed medicine that is not in the catalog is kept as a line with its exact typed name, quantity and unit and marked "not registered" (pending); it never blocks saving or confirming. Registering pending lines is out of scope (Module 004), but the data model must not need to change for it. English UI, mobile-first, large touch targets, loading/error/empty states, idempotent save/confirm that is safe to retry, RLS isolation between two businesses, owner-only. Out of scope: voice and AI, Quick Register and pending-product registration, market list, purchases, invoices and printing, ledger and payments, offline queue and sync, reports, multi-user roles."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Take a manual order for a store (Priority: P1)

A pharmacy phones or messages the supplier with a list of medicines. The supplier opens "New order", picks the store (or adds it on the spot), searches the catalog for each medicine, enters the quantity, adds the next one, writes a note if needed, and confirms the order.

**Why this priority**: Taking an order is the core job of the whole app. Everything later (market list, purchases, invoices, khata) is built on confirmed orders. Without this module the product has no orders.

**Independent Test**: With a catalog of a few medicines and one store, create an order with three lines, confirm it, and find it in Order History with the right store, lines, quantities, units, notes and an order number.

**Acceptance Scenarios**:

1. **Given** the supplier is signed in, **When** they choose "New order", **Then** they are first asked to select a store; no medicine can be added until a store is chosen.
2. **Given** the store selector, **When** the supplier types a store name that does not exist and chooses "Add new store", **Then** a store is created from the name alone (contact details can be added later), it is selected for the order, and the order is not lost or reset.
3. **Given** the store selector, **When** the supplier tries to add a store whose name already exists (ignoring case and spacing), **Then** the existing store is shown and offered instead; no duplicate store is created silently.
4. **Given** a selected store, **When** the supplier types part of a medicine name, strength, dosage form, manufacturer, brand, generic name or SKU, **Then** matching active medicines appear as they type, each result showing enough detail (name, strength, form, pack size, manufacturer, unit) to tell similar medicines apart.
5. **Given** a search result, **When** the supplier selects it and enters a quantity, **Then** a line is added with that medicine, the quantity and the medicine's unit (which the supplier may change before saving the line).
6. **Given** an order with lines, **When** the supplier edits a line's quantity or unit, or removes a line, **Then** the order shows the change immediately and it is saved; a removed line is not silently kept and not silently restored.
7. **Given** a medicine already in the order, **When** the supplier selects the same medicine again, **Then** the existing line is shown for adjusting; a second line for the same medicine is created only if the supplier explicitly chooses to add it separately. Lines are never merged silently.
8. **Given** an order with at least one line, **When** the supplier confirms it, **Then** the order becomes Confirmed with its order number and confirmed time, and the supplier sees the finished order.
9. **Given** an order with no lines, **When** the supplier tries to confirm, **Then** confirming is refused with a clear message, and the draft is kept.
10. **Given** no medicine exists in the catalog yet, **When** the supplier takes an order, **Then** they can still enter every medicine as a typed line (Story 3); a pre-loaded list is never required.
11. **Given** no store exists yet, **When** the supplier opens "New order", **Then** the store selector offers "Add your first store" and the order can be started from there.

---

### User Story 2 - Never lose an order: automatic draft saving (Priority: P1)

While the supplier is entering an order, the app saves it automatically as a draft. If the page is refreshed, the supplier navigates away, the phone locks, or the browser is closed, the order is still there, and the supplier can see when it was last saved and whether the latest change is saved.

**Why this priority**: The product rule is that no order may be lost mid-entry. The supplier often takes orders while talking on the phone, so interruptions are normal.

**Independent Test**: Start an order, add two lines, refresh the page: both lines are still there. Go to another screen and come back: the draft is listed and can be continued. Cut the connection and edit: the screen says the change is not saved.

**Acceptance Scenarios**:

1. **Given** a store has been selected, **When** the first change is made, **Then** a draft order is created and saved automatically, with an order number, and the screen shows "Saved" with the time of the last save.
2. **Given** a draft with lines, **When** the page is refreshed, **Then** the same draft opens with all saved lines, quantities, units and notes.
3. **Given** a draft in progress, **When** the supplier navigates to another screen and returns, **Then** the draft is still listed (in Order History as Draft and as "Continue order" on the home screen) and opens exactly as left.
4. **Given** an edit, **When** the save has not yet reached the server (slow or lost connection), **Then** the screen shows "Not saved" with a Retry, keeps the typed data on screen, warns before the supplier leaves the page, and NEVER shows "Saved" for data the server has not confirmed.
5. **Given** the connection returns, **When** the supplier retries (or the automatic retry runs), **Then** the pending change is saved once, without duplicating lines.
6. **Given** the same draft open in two tabs, **When** the second tab saves after the first saved a change, **Then** the second tab is told the order changed elsewhere and must review it; the older data never silently overwrites the newer.
7. **Given** several drafts for different stores, **When** the supplier switches between them, **Then** each keeps only its own store's lines.
8. **Given** a draft the supplier no longer wants, **When** they choose to discard it and confirm, **Then** it is cancelled (kept in history as Cancelled, not erased).

---

### User Story 3 - A medicine that is not in the catalog (Priority: P1)

The pharmacy asks for a medicine that is not in the catalog yet (or the catalog is empty). The supplier types the name as the pharmacy said it, adds quantity and unit, and the order carries on. The line is clearly marked as not registered.

**Why this priority**: Constitution Principle IV: an unknown medicine must never block or lose an order. This is also how the catalog starts when it is empty.

**Independent Test**: With an empty catalog, create an order containing two typed lines, confirm it, and verify the lines keep the exact typed names, quantities and units, are marked "Not registered", and the order was confirmed without any block.

**Acceptance Scenarios**:

1. **Given** a search with no matching medicine, **When** the supplier chooses "Add as typed: <what they typed>", **Then** a line is added that keeps the exact typed name, the quantity and a unit the supplier enters, and is marked "Not registered".
2. **Given** a search with several possible matches, **When** the supplier wants none of them, **Then** "None of these, it is a new medicine" is always offered and creates a typed line; the supplier is never stuck choosing a match.
3. **Given** a typed name that equals or resembles catalog medicines, **When** the supplier adds it as typed, **Then** the matches are shown first so they can pick one, but picking is never forced and nothing is auto-matched or substituted.
4. **Given** an order containing typed (not registered) lines, **When** the supplier confirms it, **Then** it is confirmed normally; "Not registered" lines never block saving or confirming.
5. **Given** a confirmed order with typed lines, **When** it is viewed, **Then** each typed line shows "Not registered" and "No selling price", the exact name as typed, and no price is invented.
6. **Given** two typed lines with the same text in one order, **When** added, **Then** the supplier is warned of the repeat and may keep both or remove one; they are not merged automatically.
7. **Given** a typed line, **When** the supplier edits its name, quantity or unit before confirming, **Then** the exact new text is kept (only leading, trailing and repeated spaces are cleaned).

---

### User Story 4 - Prices stay as they were: snapshots and unpriced lines (Priority: P2)

Each order keeps the prices that applied when it was confirmed. Changing a medicine's price later does not change old orders. A medicine without a selling price is shown clearly, and never blocks the order.

**Why this priority**: Constitution Principle II makes price snapshots non-negotiable; invoices (Module 006) will total from them. It must be right from the first confirmed order, but taking and confirming orders (Stories 1 to 3) works without displaying prices.

**Independent Test**: Confirm an order, change the medicine's selling price in the catalog, reopen the order: it shows the old price and total. Confirm an order containing a medicine with no selling price: it confirms, the line shows "No selling price", and no price appears.

**Acceptance Scenarios**:

1. **Given** a draft with a catalog medicine that has a selling price, **When** it is displayed, **Then** the line shows the medicine's current selling price clearly labelled as the current price, and the line total (quantity × selling price, PKR, two decimals); the draft's prices follow the catalog until confirmation.
2. **Given** a draft, **When** the supplier confirms it, **Then** every catalog line records a snapshot of the medicine's purchase price, selling price and MRP at that moment (empty stays empty), and the line total is computed from that snapshot.
3. **Given** a confirmed order, **When** the medicine's price is changed in the catalog afterwards, **Then** the confirmed order, its lines and its total are unchanged.
4. **Given** a line whose medicine has no selling price, **When** it is displayed or confirmed, **Then** it shows "No selling price" (no zero, no guessed price), it has no line total, and saving or confirming is never blocked.
5. **Given** an order with some unpriced lines, **When** the order total is shown, **Then** it is labelled as the total of priced lines only and states how many lines have no selling price; a partial total is never presented as complete.
6. **Given** a typed (not registered) line, **When** displayed, **Then** it has no price and no total, and shows both "Not registered" and "No selling price".
7. **Given** any order screen in this module, **When** displayed, **Then** it shows no margin or profit; purchase price and MRP are stored in the snapshot but are not shown on order screens in this module.

---

### User Story 5 - Order History, store by store (Priority: P2)

The supplier opens Order History to find an order: by store, date, order number or status. Each store has its own list. Viewing an order never changes it.

**Why this priority**: The supplier must be able to see what each store ordered, continue drafts, and check yesterday's orders. It is needed for every follow-up module, but depends on orders existing (Stories 1 to 3).

**Independent Test**: Create orders for two stores over two days with different statuses. Filter by each store, by date, by status, and by order number, and confirm the right subset appears every time.

**Acceptance Scenarios**:

1. **Given** orders exist, **When** Order History opens, **Then** orders are listed newest first with order number, store, date and time, status, number of lines and the total of priced lines (with a note when some lines have no selling price), loaded in pages.
2. **Given** the list, **When** the supplier filters by store, **Then** only that store's orders show; each store's history is independent of every other store's.
3. **Given** the list, **When** the supplier filters by status (draft, confirmed, cancelled) or by a date or date range (including "Today"), **Then** only matching orders show, and filters combine.
4. **Given** the search box, **When** the supplier types an order number or part of it, or a store name, **Then** matching orders show.
5. **Given** a store with several orders on the same day, **When** viewed, **Then** each appears as its own order with its own number and lines; none is merged into another.
6. **Given** any listed order, **When** the supplier opens it, **Then** it shows the store, order number, status, times, notes, every line with quantity, unit, price information and "Not registered" where applicable; viewing changes nothing.
7. **Given** a draft in the list, **When** the supplier opens it, **Then** it can be continued; a confirmed order offers Edit and Cancel; a cancelled order is read-only and shows its cancellation reason.
8. **Given** no orders exist, **When** Order History opens, **Then** the empty state says "No orders yet" with a "Take your first order" action; when filters match nothing, a different empty state offers to clear the filters.
9. **Given** a store's page, **When** the supplier looks for that store's orders, **Then** there is a visible link to that store's order history.

---

### User Story 6 - Edit or cancel a confirmed order (Priority: P2)

A pharmacy changes its mind after the order was confirmed: it wants 20 instead of 10, adds a medicine, or cancels. The supplier edits the confirmed order or cancels it, safely and with a record of what changed.

**Why this priority**: Real orders change. The rules must protect price snapshots and history, but this builds on confirmed orders (Story 1).

**Independent Test**: Confirm an order, edit a quantity, add a line and remove a line, then cancel another confirmed order with a reason; verify old snapshots are unchanged, new lines get their own snapshot, every change appears in the order's change history, and a cancelled order cannot be edited.

**Acceptance Scenarios**:

1. **Given** a confirmed order, **When** the supplier chooses Edit, **Then** the order opens for editing with its status still Confirmed; changes are saved when the supplier saves them, and the order is never emptied or replaced.
2. **Given** a confirmed order being edited, **When** a quantity or unit is changed, **Then** the line's existing price snapshot is unchanged and the line total follows the new quantity with the same snapshot price.
3. **Given** a confirmed order being edited, **When** a line is added, **Then** it receives its own snapshot (current catalog prices) when the edit is saved; lines already snapshotted never change.
4. **Given** a confirmed order being edited, **When** a line is removed, **Then** the supplier is asked to confirm, the line leaves the order's active lines, and the change history records the removed line (medicine, quantity, price snapshot); nothing disappears without a record.
5. **Given** any edit to a confirmed order, **When** it is saved, **Then** the change history records when, what changed (before and after), and who.
6. **Given** a draft or confirmed order, **When** the supplier cancels it, **Then** they confirm the action; for a confirmed order a reason is required (for a discarded draft it is optional); the order becomes Cancelled, keeps its lines, snapshots and number, and stays in history.
7. **Given** a cancelled order, **When** opened, **Then** it is read-only: no edit, no confirm, no reopen; its number is never reused.
8. **Given** a confirmed order edited in two tabs, **When** the second tab saves after the first, **Then** the supplier is told it changed elsewhere and must review; no silent overwrite.
9. **Given** later modules that issue invoices (Module 006), **When** an order has been invoiced, **Then** that module will decide what may still change; in this module no order has an invoice, so every confirmed order is editable.

---

### Edge Cases

- **Double tap or retry on Confirm, Cancel, or New order**: pressing twice, refreshing mid-request, or retrying after a lost connection produces one confirmed order, one cancellation, one order number; the retry shows the original result.
- **Order created twice from one action** (for example a double tap on the first line, or the first save retried): only one order exists, with one number.
- **Medicine deactivated or edited after it was added to a draft**: the line keeps its medicine link and name; a deactivated medicine can stay on existing orders but cannot be newly added; a medicine's name change does not rewrite what a confirmed order recorded (the order keeps the name as of the snapshot).
- **Medicine price changes between adding a line and confirming**: the draft shows the live current price; the confirm step shows the prices that will be recorded; the snapshot is the price at the moment of confirming.
- **Store renamed or deactivated**: the order keeps pointing to the same store and shows its current name; an inactive store cannot be chosen for a new order, but its existing orders remain visible and editable according to their status.
- **Store change on a draft**: only possible while the draft has no lines (see FR-011); once any line exists the store is locked, so no line can move between stores. To order for another store, start a new order.
- **Quantity entered as 0, negative, decimal, empty, or text, or absurdly large**: refused with a field message; the other lines are unaffected.
- **Unit empty**: refused; a catalog line starts with the medicine's own unit; a typed line requires a unit.
- **Very long typed name or note**: refused with the limit stated, never silently cut.
- **Order with many lines** (for example 100): remains usable; the supplier can scroll and the screen does not freeze; at 200 lines the Add medicine action is disabled with a message saying why.
- **Search with no matches, a very short text, or special characters**: shows "No matching medicine" with the typed option; it never errors.
- **Search while the catalog is empty**: shows the empty-catalog message with the typed option (and a link to add or import medicines).
- **Session expired mid-order**: the screen says the supplier must sign in again, keeps the data on screen, and the saved draft is there after signing in.
- **Two stores' orders open in two tabs**: lines added in one tab never appear in the other's order.
- **Delete rules**: orders and lines are never hard-deleted by the user; "discard" and "cancel" keep the record.
- **Order numbers**: assigned once per order, unique within the business, never reused, never changed; two orders created at the same moment get different numbers.
- **Another business's data**: an order, line, store or medicine from another business can never be read, referenced, or modified, even by crafting a request.

## Requirements *(mandatory)*

### Functional Requirements

**Creating and editing orders**

- **FR-001**: The system MUST let the supplier create an order by hand for exactly one store. The order's source is recorded as "manual". Voice entry is not part of this module.
- **FR-002**: The system MUST require a store to be selected before any line is added, and MUST provide a store selector with search, showing each store's name and, where present, its contact details to tell similar names apart.
- **FR-003**: The store selector MUST offer an inline "Add new store" that needs only the store name, applies the same duplicate check as adding a store on the Stores screen (offering the existing store instead of creating a duplicate), selects the new store for the order, and MUST NOT reset or lose the order in progress.
- **FR-004**: The system MUST provide a medicine search that matches active medicines by name, brand, generic name, strength, dosage form, manufacturer, and SKU, ignoring case and extra spaces, results showing name, strength, dosage form, pack size, manufacturer and unit, and showing "No selling price" for medicines without one.
- **FR-005**: A catalog line MUST record the medicine, the quantity (a whole number from 1 to 100,000), and the unit (starting from the medicine's own unit and changeable, up to the same length limit as a medicine's unit); invalid input MUST be refused with a field message.
- **FR-006**: The supplier MUST be able to edit any line's quantity and unit and remove any line of a draft, and to edit the order's notes (up to 1,000 characters).
- **FR-007**: The system MUST NOT create a second line for a medicine already in the order unless the supplier explicitly chooses to add it separately, and MUST NOT merge lines silently.
- **FR-008**: An order MUST hold at most 200 lines; exceeding it MUST be refused with the limit stated, and the screen MUST disable adding at 200 lines and say why.
- **FR-009**: Medicine matching MUST be by the supplier's explicit choice only. The system MUST NOT select, substitute, or merge medicines automatically, and MUST NOT treat different strengths, dosage forms, manufacturers, or pack sizes as the same medicine.
- **FR-010**: An order, its lines, and its notes MUST belong to exactly one store; no operation MUST move or copy a line from one store's order into another's.
- **FR-011**: The store of a draft MAY be changed only while the draft has no lines; once the draft has any line, the store MUST be locked and the screen MUST say why and offer "Start a new order for another store". Confirmed and cancelled orders never change store.

**Typed (not registered) lines**

- **FR-012**: When no catalog medicine fits, the system MUST let the supplier add a typed line that keeps the exact name typed (only leading, trailing and repeated spaces cleaned, up to the same length limit as a medicine name), a quantity (as FR-005), and a unit (required), marked "Not registered".
- **FR-013**: The medicine search MUST always offer "None of these, it is a new medicine" (add as typed), including when matches exist, so the supplier is never forced to choose a match.
- **FR-014**: Typed lines MUST be allowed in draft, confirmed, and edited orders, MUST NOT block saving or confirming, MUST show "Not registered" and "No selling price", MUST have no price snapshot and no line total, and MUST never be given an invented value. Registering a typed line is not part of this module, and the stored line MUST be able to be linked to a medicine later without losing the typed name.
- **FR-015**: Repeating the same typed text in one order MUST show a warning and MUST NOT merge the lines.

**Saving drafts**

- **FR-016**: The system MUST create the order as a draft on the first change after a store is selected, assign its order number, and save every later change automatically (no "save" button required), without duplicating the order or its lines when a save is repeated.
- **FR-017**: The screen MUST show the time of the last successful save and a clear state: saving, saved, or not saved (with Retry). It MUST show "Saved" only after the server has confirmed the change, and MUST keep unsaved data on screen with a warning if the supplier tries to leave.
- **FR-018**: After a refresh, navigation, or closing and reopening the app, every saved change of a draft MUST be present, and the supplier MUST be able to find and continue any draft (from Order History filtered by Draft, and from a "Continue order" shortcut on the home screen when drafts exist).
- **FR-019**: Saves MUST be safe to repeat: every order and every line carries an identifier created on the device before the first save, and repeating a save, create, or confirm (double tap, refresh, lost connection, simultaneous requests) MUST NOT create duplicate orders, lines, or order numbers.
- **FR-020**: A save from an older copy of an order MUST NOT overwrite a newer change; the system MUST refuse it, tell the supplier the order changed elsewhere, and let them review the current version. This covers drafts and confirmed orders.
- **FR-021**: A failed or interrupted save MUST NOT lose, empty, or partially apply an order: an order's lines change together, and the order either keeps its previous saved state or has the new one, never a mixture.
- **FR-022**: The system MUST NOT claim that an order is saved on the device or synchronised in any other way; offline order taking, queueing and synchronisation are not part of this module, and without a connection the screen states that changes are not saved.

**Confirming, editing, and cancelling**

- **FR-023**: The order status MUST be one of draft, confirmed, cancelled, or fulfilled; this module uses only the first three, and "fulfilled" is defined for later modules and cannot be set here.
- **FR-024**: The supplier MUST be able to confirm a draft that has a store and at least one line. Confirming MUST be one atomic operation that sets the status, records the confirmed time, and records the price snapshots of all catalog lines (FR-028), all together or not at all. Before the confirmation is sent, the screen MUST first save every unsaved change; if that save fails, the confirmation MUST NOT be sent and the unsaved state MUST be shown.
- **FR-025**: Confirming MUST be allowed when the order contains typed lines, medicines without a selling price, or medicines with no prices at all, and MUST NOT require any price.
- **FR-026**: Confirming an order that is already confirmed (retry, double tap, second tab) MUST NOT change it and MUST show the original confirmation; it MUST NOT take a second snapshot or create a second order.
- **FR-027**: A confirmed order MUST be editable in place (quantities, units, notes, adding and removing lines) while it has no invoice, which is always the case in this module; its status remains Confirmed, it keeps its number and store, and it is saved by an explicit "Save changes" so the supplier reviews edits as a whole. Later modules that issue invoices will restrict this.
- **FR-028**: Price snapshot: at confirmation, each catalog line MUST record the medicine's purchase price, selling price, and MRP as they were at that moment (empty stays empty). A line's snapshot MUST NEVER change afterwards, including when the catalog price changes, when the order is edited, or when the order is viewed. A line added during an edit of a confirmed order records its snapshot when that edit is saved.
- **FR-029**: A line with no selling price at confirmation MUST stay without a selling-price snapshot (unpriced). Filling it later is not part of this module (the Pending Prices flow), and this module MUST NEVER fill or guess it.
- **FR-030**: Each line MUST also carry a delivered quantity that defaults to the ordered quantity at confirmation and is not changeable in this module; ordered, delivered, purchased and sold quantities are distinct and MUST NOT be conflated.
- **FR-031**: The supplier MUST be able to cancel a draft (called "discard") or a confirmed order after a confirmation prompt; cancelling a confirmed order MUST require a reason (up to 500 characters), and the reason is optional for a draft. A cancelled order keeps its number, store, lines and snapshots, is read-only, cannot be reopened or confirmed, and stays in history.
- **FR-032**: Orders and lines MUST NEVER be hard-deleted by any user action.
- **FR-033**: Each status change (created, confirmed, cancelled) and each saved edit to a confirmed order MUST be recorded in an order change history showing when, who, and what changed (before and after for quantities, units, notes, added lines, removed lines), shown on the order screen. This history cannot be edited or deleted.

**Prices and totals**

- **FR-034**: A catalog line in a draft MUST show the medicine's current selling price (labelled as the current price) and a line total of quantity × selling price in PKR with two decimals, calculated exactly (no rounding errors); a line without a selling price MUST show "No selling price" and no total.
- **FR-035**: A confirmed or cancelled order MUST show prices and line totals from its own snapshots only, never from the current catalog.
- **FR-036**: The order total MUST be the exact sum of the line totals that exist, MUST be labelled as the total of priced lines when any line has no selling price, and MUST state the number of lines without a selling price; an unpriced line MUST NEVER be counted as zero without that notice.
- **FR-037**: Order screens MUST NOT display margin, profit, or cost; purchase price and MRP are recorded in the snapshot only.

**Order History**

- **FR-038**: The system MUST provide Order History listing orders newest first with order number, store, date and time, status, number of lines, and the total of priced lines, loaded in pages so that large histories stay fast.
- **FR-039**: Order History MUST support filtering by store, status (draft, confirmed, cancelled), and date or date range (including quick choices such as Today), and searching by order number and store name; filters MUST combine; dates are shown and filtered in the business's local day (Pakistan Standard Time).
- **FR-040**: Every store MUST have its own independent history; one store's order MUST never appear in another store's filtered list; the store page MUST link to its own order history.
- **FR-041**: Opening an order from the list MUST only display it; it MUST NOT alter the order, its lines or its snapshots. Drafts offer Continue; confirmed orders offer Edit and Cancel; cancelled orders show their reason and are read-only.
- **FR-042**: Several orders for the same store on the same day MUST each be separate, with their own number and lines.

**Order numbers**

- **FR-043**: Each order MUST get a unique, human-readable order number within its business, assigned by the server when the order is first saved, never reused, never changed, and never duplicated by retries or simultaneous creation.

**Interface and security**

- **FR-044**: All new screens MUST be English, mobile-first, with touch targets of at least 44 × 44 px, searchable selectors, and loading, error (with Retry), and empty states that name the next action (for example "Take your first order"). Entering a typical order MUST NOT require any animation longer than 200 ms or desktop-only controls.
- **FR-045**: The app MUST provide visible navigation to New order and Order History at a 360 px width, and a "New order" action on the home screen.
- **FR-046**: Each business MUST see and change only its own orders, lines, order numbers, order history, and stores; an order MUST only reference a store and medicines of the same business; this MUST be enforced on the server for every operation and MUST NOT rely on client checks alone.
- **FR-047**: All order data MUST be validated on the server (quantity range, unit and note lengths, line count, store and medicine ownership, status transitions); the client's checks MUST NOT be the only check.
- **FR-048**: The system MUST NOT report a save, confirm, edit, or cancel as successful unless it was actually stored, and MUST keep the typed values on screen when an operation fails.
- **FR-049**: Only the owner of a business can create or change that business's orders; no other account can read or change them.

### Key Entities *(include if feature involves data)*

- **Order**: One order for exactly one store in one business. Unique order number (per business), store, source ("manual" here), status (draft, confirmed, cancelled; "fulfilled" reserved), notes, created time, last saved time, confirmed time, cancelled time and reason, and a version used to detect changes made elsewhere. Created with a client-generated identifier so that repeating the creation never duplicates it.
- **Order line**: One medicine on one order. Either linked to a catalog medicine or a typed (not registered) line with the exact typed name. Name as recorded, quantity ordered, unit, delivered quantity (defaults to ordered at confirmation), price snapshot (purchase price, selling price, MRP, each possibly empty, recorded at confirmation), line total (only when there is a selling price), line status ("pending registration" for typed lines), and position in the order. Client-generated identifier. A typed line has no medicine link until a later module links it, and keeps its typed name afterwards.
- **Order change history**: An append-only record of each status change and each saved edit to a confirmed order: when, who, what changed (before and after), including removed lines with their snapshots. Never edited or deleted.
- **Order number sequence**: A per-business counter that issues numbers one at a time, without duplicates or reuse.
- **Store** (Module 001): Orders reference a store; a store can be added from the order screen with only a name.
- **Product / medicine** (Module 001): Orders reference active medicines, read their current prices for drafts, and copy them into the snapshot at confirmation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A supplier can take a typical order of 10 catalog medicines (choose the store, search and add each medicine with a quantity, and confirm) in under 3 minutes on a phone, with a catalog of at least 500 medicines.
- **SC-002**: In 100% of tested interruptions (refresh, navigating away and back, closing and reopening, switching between drafts), every change that was shown as "Saved" is still present, and 0 lines or orders are lost.
- **SC-003**: In 100% of tests that create orders for two or more stores at the same time (including two tabs, switching stores, and attempted store changes on a draft with lines), 0 lines appear in another store's order.
- **SC-004**: In 100% of tests, a confirmed order's prices, line totals and total are identical before and after the catalog prices of its medicines change, after the order is viewed, and after the order is edited (for the lines that were not newly added).
- **SC-005**: Repeating a confirmation, a cancellation, or the first creation of an order 10 times, including simultaneous repeats, results in exactly one confirmed (or cancelled, or created) order and 0 duplicate order numbers; and 10 simultaneous creations by one business receive 10 different order numbers.
- **SC-006**: In 100% of tested attempts by one business to read, list, create into, edit, confirm, cancel, or reference the orders, lines, stores, or medicines of another business, the attempt is refused, and 0 records of the other business change.
- **SC-007**: In 100% of tests, orders containing typed (not registered) lines, medicines without a selling price, or both can be saved as drafts and confirmed, and no price is invented: every such line has no selling price and no line total.
- **SC-008**: In 100% of tests of an interrupted save, confirm, or edit (induced failure), the order is either exactly as before or exactly as intended, never partially changed, and the screen never shows "Saved" for data that was not stored.
- **SC-009**: Medicine search shows results within 1 second for 95% of searches on a catalog of 5,000 medicines.
- **SC-010**: Order History finds the correct orders in 100% of tested filter and search combinations (store, status, date range, order number), and the first page opens within 2 seconds with 1,000 orders in the history.
- **SC-011**: In 100% of tests, saving an order that was changed elsewhere in another tab is refused without overwriting, and the supplier is shown the current version.
- **SC-012**: Every new screen is reachable by visible navigation at a 360 px width, with 100% of interactive controls at least 44 × 44 px, and a loading, error, and empty state verified for each list or data screen.
- **SC-013**: In 100% of tests, line totals equal quantity × selling price exactly in PKR with two decimals, and an order total with unpriced lines is always labelled as the total of priced lines with the count of unpriced lines.
- **SC-014**: 100% of tested status changes and edits to confirmed orders appear in the order's change history with the before and after values, and 0 orders or lines can be hard-deleted through the app.

## Assumptions

- Use is still solo: the signed-in user is the owner, so "owner-only" means no other account can read or change a business's orders; multi-user roles are not part of this module.
- Constitution Principle II is followed over a looser reading of the request: prices on a draft follow the catalog and are displayed as the current price; the snapshot is recorded at confirmation (and for lines added while editing a confirmed order, when that edit is saved).
- Reopening a confirmed order is done by editing it in place (it stays Confirmed) rather than turning it back into a draft, because turning it back into a draft would put its price snapshots at risk. Every edit is recorded in the change history. This is the proposed default; stricter rules can be added when invoices exist (Module 006 will define what is locked once an invoice is issued).
- Cancelled orders are final in this module (no reopening), because a mistaken cancellation is protected by a confirmation prompt and a new order can be created; this can be revisited later.
- The store of a draft is locked once the draft has a line, instead of letting lines follow a store change, because moving lines between stores is the exact mistake the product rules forbid. The supplier can still change store freely on an empty draft.
- Order number format (for example a prefix and a sequence) is a planning decision; the requirement is only that it is unique per business, readable, assigned once, and never reused. Numbers used by cancelled orders are not reused, so gaps are not possible in normal use.
- Quantities are whole numbers from 1 to 100,000 and an order holds up to 200 lines; these are reasonable defaults and can change later without changing the behaviour described here. Fractional quantities are not supported.
- Order date and time default to the moment the order is first saved; dates are shown and filtered in Pakistan Standard Time. Changing the order date by hand is not part of this module.
- Only the first save needs a store; the order is created when the first change is made after choosing a store, so opening "New order" and leaving without choosing creates nothing.
- Medicines that become inactive remain on the orders they were already added to but cannot be newly added to orders.
- Ordered quantity is the only quantity edited here; the delivered quantity exists on each line (defaulting to the ordered quantity at confirmation, as the constitution requires) so that invoicing later needs no change to the order data, but it cannot be edited in this module.
- Without a connection, order taking does not work in this module; the app says changes are not saved. Offline drafts, a pending-operation queue and "Saved on this device" belong to the offline module (Module 009) and are not claimed here.
- Typed lines keep only the supplier's text. Registering them, linking them to a medicine, and filling in their prices are done in Module 004 (Pending products); this module only guarantees that the stored line can later be linked and priced without changing the order's data.
- Constitution Principles I–VIII apply: real server-side validation, exact PKR money, isolation per business, append-only history for important changes, and mobile-first screens with loading, error and empty states.

## Out of Scope

Voice order entry and any AI or Gemini parsing; Quick Register of medicines from an order, linking typed lines to registered medicines, and the Pending Prices screen (Module 004); consolidated market list and purchase recording (Module 005); invoices, invoice numbers, the Account Summary, and any printing (Module 006); store ledger (khata), payments, and balances (Module 007); offline order taking, drafts on the device, the pending-operation queue, and synchronisation (Module 009); reports and dashboard figures (Module 010); multi-user roles and permissions; editing delivered quantities; changing an order's date by hand; reopening cancelled orders; copying or repeating a previous order; attaching files or line-level notes.
