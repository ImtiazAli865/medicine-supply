# Feature Specification: Fast Order Entry

**Feature Branch**: `008-fast-order-entry`
**Created**: 2026-11-19
**Status**: Draft
**Input**: User description (condensed, English): Module 008 "Fast order entry" for the Medicine Supply & Order Management app (builds on Modules 001 to 007, all merged into master). Voice ordering was dropped by the owner; its branch `008-voice-order-gemini` is kept only for later, so this module does not use any of its code, tables or migrations. Goal: the supplier takes an order that a store owner tells them faster than writing it by hand, with no AI, no microphone and no new npm packages, on the existing New order and order editor screens (Module 003): (1) the store's usual medicines, addable with one tap; (2) repeat the store's last order as a new draft; (3) a search box that stays on the order screen, searches on the device, and needs only letters, Enter and a quantity; (4) measurable speed (taps and keys counted by tests, owner trial compared with handwriting). Online only, honest about it; no purchase price, MRP, cost, margin, profit, balance or invoice data in anything new; businesses isolated; 360 px touch targets; bottom navigation keeps five items; prefer no new database migration (if one is needed its number is 0011 or higher, because 0009 and 0010 of the dropped voice work are already applied to the TEST and DEV projects). Out of scope: voice, any AI, pasted WhatsApp text, medicine nicknames, offline catalog and offline orders (Module 009), reports (Module 010), barcode scanning, changes to invoices, prices or the ledger, roles, and automatic confirmation.

## Clarifications

### Session 2026-11-19

- Q: Does "usual medicines" and "last order" look at every earlier order? → A: Only the same store's orders that are confirmed or later (not draft, not cancelled). "Usual" looks at the last 180 days; "last order" is the most recent such order of any age. (Owner's brief, with the 180-day window as the default.)
- Q: What does a one-tap on a usual medicine add? → A: One real line with the quantity and unit this store ordered last time, shown on the card before the tap; the quantity can be changed on the card first or on the line afterwards.
- Q: May "usual" and "repeat" appear when editing a confirmed order? → A: No. They belong to draft orders (and the repeat only while the draft has no lines); the search box that stays on the screen also works when editing a confirmed order.
- Q: Is the number in "panadol 500" a quantity? → A: Never. Digits typed in the name are part of the search. A quantity is typed only in the quantity field after a result is chosen, or after an explicit "x" in the search box (for example "pan x20"), which is used only when the supplier then chooses a result.

## User Scenarios & Testing *(mandatory)*

The supplier is on a phone, a store owner is telling them an order, and every second spent finding a medicine is a second the store owner waits. Today each medicine takes several taps: open a pop-up, search, pick, the pop-up closes, change the quantity. This module removes those steps without ever choosing a medicine for the supplier.

### User Story 1 - Repeat the store's last order (Priority: P1)

Most stores order nearly the same medicines each time. After choosing a store that has an earlier order, the supplier taps one button and a new draft appears with the same medicines, quantities and units, ready to be adjusted and confirmed.

**Why this priority**: It is the biggest saving: a five-line order takes three interactions (choose store, one tap, confirm) and no typing at all.

**Independent Test**: With a store that has one confirmed order of five lines, start a new order for it, tap the repeat button, and confirm; check that one new draft exists with the same five lines, no prices, and that the old order is unchanged.

**Acceptance Scenarios**:

1. **Given** a store with a confirmed earlier order and a new order with no lines, **When** the supplier looks at the new order screen, **Then** a button names the source ("Repeat last order", with the number of lines and the date) and nothing has been added yet.
2. **Given** that button, **When** the supplier taps it, **Then** all lines of that order appear on the new draft in the same order with the same quantity and unit (catalog lines linked to the same medicine, typed lines exactly as typed and still marked "Not registered"), and the order is a draft, not confirmed.
3. **Given** a source line whose medicine is now inactive or no longer available, **When** the repeat is applied, **Then** that line is not added, and a visible message that stays until dismissed names each such medicine and says it was left out.
4. **Given** the repeat was just applied, **When** the supplier taps Undo within a few seconds, **Then** exactly the lines the repeat added are removed and the screen is as before.
5. **Given** the supplier taps the button twice quickly or retries after a failure, **When** the saves finish, **Then** exactly one draft exists with one copy of each line.
6. **Given** the copied lines, **When** the supplier edits a quantity or removes a line and confirms, **Then** the order behaves exactly like a manual order of Module 003 (prices are recorded at confirmation, never copied from the old order).

---

### User Story 2 - Usual medicines in one tap (Priority: P1)

Below the store name the supplier sees the medicines this store orders most often, each on a card that shows full identifying details and the quantity the store ordered last time. One tap adds the line.

**Why this priority**: When the supplier wants only some of the usual medicines, or a few extra, there is no typing at all.

**Independent Test**: With a store that has several earlier orders, open a new order and add three usual medicines with one tap each; check three lines with the shown quantities and units, in three interactions.

**Acceptance Scenarios**:

1. **Given** a store with earlier confirmed orders, **When** its new order screen opens, **Then** up to 12 active catalog medicines appear, ordered by how many of the last 180 days' orders contain them (most first, ties by most recent), each showing name, strength, dosage form, pack size, manufacturer and the last quantity and unit.
2. **Given** a usual card, **When** the supplier taps it, **Then** one line with that medicine, quantity and unit is added and the card shows it is on the order; nothing is added without a tap and no card is preselected.
3. **Given** a usual card, **When** the supplier uses its stepper or a quick-quantity button before adding, **Then** the added line carries that quantity.
4. **Given** a medicine already on the order, **When** the supplier taps its card again, **Then** the existing "already on this order" choice of Module 003 appears and nothing is merged silently.
5. **Given** a store with no qualifying earlier orders, **When** the screen opens, **Then** no usual list and no repeat button are shown, and the search box and the typed path work as usual with a short note naming the next step.

---

### User Story 3 - A search box that stays and a pop-up-free flow (Priority: P1)

The supplier types a few letters, picks a medicine, types the quantity, presses Enter, and is back in the search box with the keyboard still open, ready for the next medicine, without any pop-up opening or closing.

**Why this priority**: For medicines that are not usual, this is the everyday path and is the part that replaces handwriting.

**Independent Test**: With a 5,000-medicine catalog, add three searched medicines using only letters, one tap or Enter each, a quantity and Enter; check three lines and that no pop-up opened.

**Acceptance Scenarios**:

1. **Given** the order screen, **When** it opens, **Then** a search box is on the screen itself (not in a pop-up), and typing one or two letters shows matching active medicines, each with name, strength, dosage form, pack size and manufacturer.
2. **Given** several results, **When** the supplier has not tapped or moved to one, **Then** none is highlighted and Enter adds nothing.
3. **Given** exactly one result remains, **When** the supplier presses Enter, **Then** that visible, highlighted result is chosen.
4. **Given** a result is chosen (by tap or Enter), **When** it is chosen, **Then** the box clears, the keyboard stays open, the cursor is in the quantity field showing 1 selected, and the line is added when the supplier presses Enter (the quantity typed replaces the 1), after which the cursor is back in the search box.
5. **Given** a line was just added, **When** it appears, **Then** it shows its full details and an Undo for a few seconds; Undo removes only that line.
6. **Given** nothing matches, **When** the supplier looks at the results, **Then** "Add as typed" is offered inline (Module 003's typed path) and the order is never blocked.
7. **Given** results are on screen, **When** the supplier types "panadol 500", **Then** the 500 narrows the search to that strength and is never read as a quantity.

---

### User Story 4 - Quantity shortcuts without mistakes (Priority: P2)

For speed, a quantity can follow the name in the search box with an explicit "x" (it is used only when the supplier then chooses a result), and the quantity field offers quick buttons; the supplier is never surprised.

**Why this priority**: Saves a few more seconds per line but the three stories above already work without it.

**Independent Test**: Type "pan x20" in the search box and choose the result (or press Enter on a single highlighted result); check a line with quantity 20 added at once. Type "pan x0" and "pan x100001" and choose a result: both refused with a message and nothing added.

**Acceptance Scenarios**:

1. **Given** text such as "pan x20" in the search box that finds no medicine as text, **When** the supplier taps a result (or presses Enter on a single highlighted result), **Then** the line is added at once with quantity 20 and an Undo, with no quantity step; the quantity box itself accepts only a plain whole number (FR-019, FR-020).
2. **Given** an invalid quantity (empty, zero, negative, a fraction, above 100,000), **When** the supplier presses Enter, **Then** nothing is added, the message states the allowed range, and what was typed is kept.
3. **Given** the quantity field, **When** the supplier taps a quick button (for example 5, 10, 20, 50) or the stepper, **Then** the field shows that value and nothing is added until Enter or the add button.
4. **Given** the order has 200 lines, **When** the screen shows the search and the usual cards, **Then** adding is disabled and the limit is stated (as in Module 003).

---

### User Story 5 - First use, failures and honest limits (Priority: P2)

The module must work on day one (no history, no catalog), when the list cannot load, and without a connection, and must say so honestly.

**Why this priority**: The owner starts with a small catalog and few orders; a fast path that needs history or a connection to start would be dead on arrival.

**Independent Test**: Run the order screen with an empty catalog and a store with no orders; check the typed path works and the empty states name the next action. Make the medicine list fail; check Retry and that the typed path still works.

**Acceptance Scenarios**:

1. **Given** an empty catalog, **When** the supplier types a medicine name, **Then** "Add as typed" is available and an empty-state note offers "Add a medicine" and "Import a list".
2. **Given** the usual list or the medicine list cannot be loaded, **When** the screen shows the error, **Then** it offers Retry, keeps the order and every line already added, and the typed path still works.
3. **Given** no connection, **When** the supplier changes the order, **Then** the existing Module 003 message says the change is not saved and keeps the screen; nothing says "saved on this device" or "pending sync".
4. **Given** the catalog changed on another device, **When** the order screen is opened again, **Then** the medicine list is loaded again, and the supplier can also ask for a refresh; a medicine made inactive meanwhile is never added by a stale list (the save refuses it with a clear message).

---

### Edge Cases

- A usual or repeated medicine has become inactive or unavailable: left out with a visible message (never silent), the rest is added.
- The source order has more than 200 lines or a line that is not valid today: only valid lines are added, up to the limit, and the message states what was left out and why.
- The same medicine appears twice on the source order: both lines are copied as they were (no silent merge), and the existing repeated-line warnings apply.
- Two medicines with the same name but different strengths, forms or pack sizes: never merged; no result is preselected; both appear with their details.
- A store changed: the store is locked once any line exists (Module 003); the usual list and the repeat button belong to the chosen store only.
- The order changed on another device: the existing "changed elsewhere" review of Module 003 applies; the repeat and the one-tap adds never overwrite a newer save.
- The supplier double-taps a card or a result: one line (or the "already on this order" choice), never two silent lines.
- Typing Urdu-script or mixed text: searched as given; no transliteration is promised.
- Many medicines (thousands): results stay fast; if the list is too large to load, the screen says results come from the server and still works.
- A very slow or failing search: the previous results stay on screen, an error with Retry appears, the box keeps its text.

## Requirements *(mandatory)*

### Functional Requirements

**Repeat last order**

- **FR-001**: After a store is chosen and while the new order has no lines, the screen MUST show a "Repeat last order" button when that store has an earlier order that is confirmed or later (not draft, not cancelled); the button MUST show the number of lines and the date of the source order. If there is none, the button MUST NOT be shown.
- **FR-002**: Tapping it MUST add every valid line of the most recent such order to the new draft in the same order, with the same quantity and unit: catalog lines linked to the same medicine by its identifier, typed lines exactly as typed and still marked "Not registered". The result MUST be a draft; it MUST NOT be confirmed, and the old order MUST NOT change.
- **FR-003**: No price, cost, MRP or price snapshot of the source order MUST be copied; prices are recorded only at confirmation, as in Module 003 (FR-028, FR-029).
- **FR-004**: A source line whose medicine is inactive or no longer available, or which is not valid today, MUST NOT be added and MUST NOT be dropped silently: a message that stays until dismissed MUST name each such line and the reason; the supplier MUST still be able to add that medicine by hand.
- **FR-005**: The repeat MUST create the lines in one change that either happens completely or not at all (no half-copied order), and MUST respect the 200-line limit of Module 003, saying which lines did not fit.
- **FR-006**: Tapping the repeat button twice, refreshing, or retrying after a failure MUST create only one draft with one copy of each line (the order and line identifiers made on the device before the first save, as in Module 003).
- **FR-007**: After a repeat, an Undo MUST be offered for a few seconds that removes exactly the lines the repeat added; after that, normal line removal applies.

**Usual medicines**

- **FR-008**: The screen of a draft order MUST show, for the chosen store, up to 12 active catalog medicines that appear in that store's confirmed-or-later orders of the last 180 days (looking at its 100 most recent such orders at most), most frequent first and ties by most recent; each card MUST show name, strength, dosage form, pack size, manufacturer, and the quantity and unit of that store's most recent line for it.
- **FR-009**: One tap on a card MUST add one line with the shown quantity and unit (or the quantity the supplier set on the card first with its stepper or quick buttons). Nothing MUST be added, selected or highlighted without a tap.
- **FR-010**: A medicine already on the order MUST be shown as added on its card, and tapping it MUST open the existing "already on this order" choice (change that line's quantity, or add a separate line); lines MUST NEVER be merged silently.
- **FR-011**: A store with no qualifying orders MUST see no usual list and no repeat button; the screen MUST show a short note saying that frequent medicines appear after the first confirmed orders, and the search remains.
- **FR-012**: Inactive medicines MUST NOT appear in the usual list, and typed (not registered) lines MUST NOT appear in it.

**Continuous fast search**

- **FR-013**: The order screen MUST contain a search box that stays on the screen (no pop-up opens or closes to add a medicine) and shows matching active medicines from the first one or two characters, matching name, brand, generic name, strength, dosage form, manufacturer and code, ignoring case and extra spaces (the matching of Module 003, FR-004).
- **FR-014**: The list of active medicines MUST be loaded when the order screen opens and searched on the device so that results show within 300 ms of a keystroke for a catalog of 5,000 medicines; it MUST be reloaded when the screen is opened again and on request ("Refresh medicines"). When the catalog is too large to load, the search MUST ask the server instead, MUST say so, and MUST keep working.
- **FR-015**: Every result and every added line MUST show strength, dosage form, pack size and manufacturer (when recorded) so that similar medicines can be told apart; different strengths, forms, manufacturers and pack sizes MUST NEVER be merged, substituted or hidden behind one result.
- **FR-016**: A result MUST be highlighted for Enter only when exactly one result remains. When several fit, no result MUST be highlighted or chosen until the supplier taps one or moves to one with the arrow keys; Enter with nothing highlighted MUST add nothing.
- **FR-017**: Choosing a result MUST clear the search box, keep the keyboard open, show the chosen medicine's details, and put the cursor in the quantity field with 1 shown and selected. Enter (or an add button) MUST add the line and return the cursor to the search box.
- **FR-018**: Digits typed in the search MUST be part of the search (for example "panadol 500" narrows to the 500 strength) and MUST NEVER be read as a quantity.
- **FR-019**: A quantity MAY be typed in the search box after an explicit "x" with no space (for example "pan x20"). It MUST be used only when the supplier chooses a result (by tap, or by Enter on a highlighted result), and never to choose one; the chosen line is then added at once with that quantity and an Undo, with no quantity step. If the text including the "x" part finds medicines, it MUST be searched as text and not read as a quantity. It MUST follow the same rules as FR-020.
- **FR-020**: A quantity MUST be a whole number from 1 to 100,000 and the unit starts from the medicine's own unit (changeable on the line), as in Module 003 (FR-005). An invalid quantity MUST add nothing, state the allowed range, and keep what was typed. Quick-quantity buttons and a stepper MUST only fill the field.
- **FR-021**: A just-added line MUST show an Undo for a few seconds that removes only that line.
- **FR-022**: When nothing matches, "Add as typed" MUST be offered inline (Module 003's typed path with the exact name kept, a quantity and a unit), and "None of these, it is a new medicine" MUST stay available whenever there is text, so a medicine can never block an order.
- **FR-023**: Adding a medicine already on the order MUST keep the existing "already on this order" choice and the repeated-typed-text warning of Module 003; nothing is merged silently.
- **FR-024**: The previous results MUST stay visible while a new search loads; a failed load MUST show an error with Retry and keep the typed text.

**Cross-cutting**

- **FR-025**: Every change made by this module MUST be saved through the same automatic, idempotent save as Module 003 (including its protection against saving over a newer version); this module MUST NOT introduce another way to create or change an order or a line.
- **FR-026**: Nothing in the new lists, buttons or requests MUST contain or ask for a purchase price, MRP, cost, margin, profit, balance or invoice data. The selling-price behaviour (the "No selling price" badge) stays as in Module 003.
- **FR-027**: Everything new MUST be limited to the signed-in business; one business MUST NEVER see another's stores, orders, medicines or usual lists (enforced by the database rules and tested with two businesses).
- **FR-028**: The module MUST work online only with the same honest messages as Modules 003 to 007: a failed save shows an error and keeps the screen; the screen MUST NEVER say "saved on this device" or "pending sync".
- **FR-029**: Every new control MUST be at least 44 by 44 px at a 360 px width with no sideways scroll; every new list MUST have loading, error with Retry and empty states; the bottom navigation MUST keep its five items.
- **FR-030**: The module MUST NOT use microphone, speech or any AI service, MUST NOT add an npm package, and MUST NOT use code, tables or migrations of the dropped voice work. If a database change turns out to be necessary, its migration number MUST be 0011 or higher.
- **FR-031**: The module MUST NOT confirm, cancel or otherwise change the status of any order by itself, and MUST NOT change any invoice, price or ledger entry.

### Key Entities *(include if feature involves data)*

- **Usual medicine (derived, not stored)**: a catalog medicine for a store, with how often and how recently that store ordered it and the quantity and unit of the latest such line. Computed from earlier confirmed-or-later orders each time; nothing new is stored.
- **Repeat source (derived)**: the most recent confirmed-or-later order of the chosen store; its lines (catalog or typed) are the pattern for the new draft. It is never changed.
- **Medicine list on the device (session copy)**: the active catalog as loaded when the order screen opened; used only for searching; it is a copy for speed, never a source of truth, and never described as offline data.
- **Added line / undo record (screen only)**: the lines added by one action, kept only so Undo can remove exactly them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A five-line repeat order for a store with history needs three interactions (choose the store, tap the repeat button, confirm; the existing confirmation question of Module 003 counts as part of confirm, so it is four taps), with no typing, and the supplier's own time for it is under 15 seconds when no quantity is changed.
- **SC-002**: Adding a usual medicine takes one tap; adding five usual medicines takes five taps.
- **SC-003**: For a catalog of 5,000 medicines, search results show within 300 ms of a keystroke for at least 95% of keystrokes, measured in an automated test on the test project's data volume.
- **SC-004**: A searched medicine is added using only letters, one tap or Enter, a quantity and Enter, with no pop-up opening or closing, and the cursor is back in the search box afterwards (verified by automated tests that count taps and keys).
- **SC-005**: In tests with several medicines of the same name but different strengths, forms or pack sizes, no line is ever added without the supplier's tap or highlighted-Enter, no medicine is ever preselected when more than one fits, and a different strength is never substituted. Zero wrong or silent lines.
- **SC-006**: A repeat or a card tap done twice quickly, or retried after a failure, creates exactly one draft and no duplicate line, in every test.
- **SC-007**: No price, MRP, cost, margin, profit, balance or invoice value appears in the usual list, the repeat button, the message about left-out lines, or any request made by this module (checked by test).
- **SC-008**: Two businesses with the same store names and medicine names never see each other's usual medicines or last orders (tested).
- **SC-009**: The New order screen with the usual list, the search results, the Undo and every message passes the 360 px check: no control below 44 by 44 px and no sideways scroll; the bottom navigation has five items.
- **SC-010**: Each failure (list fails to load, save fails, no connection, a medicine became inactive) shows its own plain message, keeps the order and every line, and offers Retry or the typed path; no order or typed line is lost.
- **SC-011**: During the owner's trial the owner compares taking a real order with this screen against handwriting and reports the result; it is recorded as reported, not seen, with what was and was not tried. The module is considered successful in practice when the owner reports it faster than handwriting.

## Assumptions

- "Usual" looks at the last 180 days; "last order" is the most recent qualifying order of any age. Orders that are drafts or cancelled never count.
- One tap on a usual card adds the quantity and unit shown on the card (the store's most recent), so the supplier sees the quantity before the tap and can change it on the line afterwards.
- The list of active medicines can be held on a phone for a few thousand medicines; above a limit chosen in the plan the search falls back to the server and says so.
- The module changes the add-medicine flow of the existing order screen; the older pop-up search is removed from the order screen (the same component may stay available for other screens that use it).
- The usual list and the last order are read through the existing tables with their row-level security; no new table is expected. A migration is allowed only if the plan proves it necessary, and then it is numbered 0011 or higher.
- Medicine nicknames, pasted WhatsApp text, barcode scanning, voice and any AI are later or dropped; they are not partly built here.
- This module needs no outside service, so automated tests use the same test project and test setup as earlier modules.
- The owner's real use on a phone is checked by the owner during the trial and recorded as reported, not seen, unless evidence is sent.
