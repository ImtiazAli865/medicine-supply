# Feature Specification: Market List and Purchases

**Feature Branch**: `005-market-list-purchases`  
**Created**: 2026-11-13  
**Status**: Draft  
**Input**: User description: "Module 005 Market list and purchases: the consolidated wholesale market list and purchase recording for the Medicine Supply & Order Management app (builds on Modules 001 to 004, all merged into master). Scope only: (1) a consolidated market list for a selected business date that adds up the quantities of confirmed, not cancelled orders by medicine, with a store-wise breakdown, a separate 'Not yet registered' group for typed lines, purchased and remaining quantities and a purchase status; (2) purchase recording with a recorded quantity (partial purchases allowed), an optional actual unit cost, append-only entries that are voided with a reason instead of edited, and retry-safe saving; (3) print and CSV export of the market list that never show any cost; (4) visibility on Home and the orders area, with empty, loading and error states. Out of scope: invoices and the order print options A and B (Module 006), ledger and payments, voice, offline sync, profit reports, vendor master data, delivered quantities, purchase returns, multi-user roles."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See one combined list to take to the wholesale market (Priority: P1)

The supplier has confirmed orders from several stores for the day. Instead of adding the quantities up by hand, they open the market list for a date and see every medicine once, with the total quantity to buy and, under it, how much each store asked for. Typed medicines that are not registered yet are in their own group, so nothing a store asked for is ever missing.

**Why this priority**: This replaces the handwritten, hand-added market list (master prompt Section 9). It is the whole reason for the module and it is useful on its own, even before any purchase is recorded.

**Independent Test**: Confirm three orders for one day: Al Madina 20 Panadol, Shah Medical 10 Panadol, Rehman Medical 15 Panadol and 15 Brufen 400 (plus a draft and a cancelled order with Panadol, and a typed line "Noran 20mg cap" in one order). Open the market list for that day: Panadol shows total 45 with the three store quantities, the draft and the cancelled order are not counted, and "Noran 20mg cap" appears under "Not yet registered" with its store and quantity. Sum of all list quantities equals the sum of the confirmed order line quantities of the day.

**Acceptance Scenarios**:

1. **Given** three confirmed orders of the same day that each contain Panadol (20, 10 and 15), **When** the supplier opens the market list for that day, **Then** one Panadol row shows total requested 45 and lists each store with its own quantity (20, 10, 15).
2. **Given** one order has "Panadol 500mg" and another has a different Panadol product (different strength, form or pack size), **When** the list is shown, **Then** they are two separate rows; medicines are grouped by the medicine itself, never by similar text.
3. **Given** a draft order and a cancelled order contain medicines, **When** the list is shown, **Then** their quantities are not counted and those medicines do not appear because of them.
4. **Given** two confirmed orders from two stores contain the same typed text "Noran 20mg cap" (different capital letters or extra spaces), **When** the list is shown, **Then** they appear as one entry in the group "Not yet registered", with the store-wise breakdown.
5. **Given** a confirmed order's quantity is edited, the order is cancelled, or a typed line is registered or linked to a medicine, **When** the supplier reopens or refreshes the list, **Then** the list shows the new totals, and a registered line has moved from "Not yet registered" to its medicine's row.
6. **Given** no confirmed order exists for the chosen date, **When** the list opens, **Then** an empty state says so and offers the next action (take or confirm an order).

---

### User Story 2 - Record what was actually bought, including partial purchases (Priority: P1)

At the market the supplier buys some of the quantities. For each medicine they record how many they really bought, and optionally at what unit cost, from whom and with which reference. They can buy in several rounds. The list always shows how much is bought and how much is still remaining, and a tick alone never means "everything is bought".

**Why this priority**: Without it the list is only a calculation. Recording the real quantity is what lets the supplier see what is still missing before leaving the market (master prompt Sections 8E and 9) and keeps ordered, bought and (later) delivered quantities separate.

**Independent Test**: With Panadol requested 45, record 20, then record 10 more: purchased 30, remaining 15, status "Partly bought". Record 20 more: purchased 50, remaining 0, status "Bought extra 5". Retry the same save 10 times, including at the same time: still exactly one entry for it. Cancel one entry with a reason: it stops counting but stays in the history.

**Acceptance Scenarios**:

1. **Given** Panadol requested 45 and nothing bought, **When** the supplier records a purchase of 20, **Then** the row shows purchased 20, remaining 25 and "Partly bought".
2. **Given** purchased 30 of 45, **When** the supplier records 15 more, **Then** purchased 45, remaining 0 and "Fully bought".
3. **Given** purchased 45 of 45, **When** the supplier records 5 more, **Then** the row shows "Bought extra 5" and remaining 0 (never a negative number).
4. **Given** the supplier taps "Bought all remaining", **When** the form opens, **Then** it is pre-filled with the exact remaining quantity and nothing is saved until the supplier confirms; the saved entry holds that quantity, not a "full" flag.
5. **Given** an entry was typed wrongly, **When** the supplier cancels it and gives a reason, **Then** the entry stays visible in the history as cancelled (who, when, reason), it no longer counts, and a corrected entry can be added.
6. **Given** a save request is repeated (slow network, double tap, retry), **When** it reaches the server several times, **Then** exactly one entry exists.
7. **Given** a typed line has no registered medicine yet, **When** the supplier looks at its row, **Then** no purchase can be recorded for it; the row offers "Register this medicine" instead, and after registering or linking, it moves to the normal rows where a purchase can be recorded.
8. **Given** a purchase with an actual unit cost was saved, **When** the supplier is asked whether to update the medicine's current purchase price to that cost, **Then** nothing changes unless they confirm; declining leaves every price as it was.

---

### User Story 3 - Print the market list and export it (Priority: P2)

The supplier prints a compact list to carry in the market, or exports it as a spreadsheet file. The print shows each medicine with its total and its stores, the unregistered group marked as such, and empty columns to write what was bought by hand (or the recorded figures). It never shows any cost.

**Why this priority**: A paper list is how the work happens in the market today (master prompt Section 10 option C). It builds on Story 1 and does not block the rest.

**Independent Test**: Open the list with registered and typed lines, print (print preview) and export the CSV: the print has the business name and date in the header, every row with total and store breakdown, the "Not yet registered" group marked "unregistered", and no price, cost, MRP or profit anywhere; the CSV has the same rows and no cost either. Limiting the list to two chosen stores prints only those stores' quantities.

**Acceptance Scenarios**:

1. **Given** a list with registered and typed lines, **When** the supplier prints it, **Then** the printed page has a header (business name, date), each medicine with its total, unit and store-wise quantities, and the unregistered group is marked "unregistered".
2. **Given** purchases with actual unit costs were recorded, **When** the list is printed or exported, **Then** no cost, purchase price, selling price, MRP, margin or profit appears.
3. **Given** the supplier selects only some stores, **When** they print, **Then** the print contains only those stores' quantities and says which stores are included.
4. **Given** the list is exported, **When** the CSV file is opened, **Then** it has one line per medicine and store (with the medicine's totals and status) and the unregistered lines are marked.

---

### User Story 4 - Market list stays easy to reach and to filter (Priority: P2)

The supplier sees on Home how many medicines are still to buy today, opens the list in one tap, and can search, filter and change the date.

**Why this priority**: A list nobody reaches is useless, but it comes after the list and the recording work.

**Independent Test**: With confirmed orders and one medicine fully bought, Home shows "Market list: N medicines to buy today" where N counts only rows with something remaining; the link opens the list; search by name, the "still to buy / bought / all" filter, the store filter and the date picker work; at 360 px nothing scrolls sideways and every control is at least 44 px.

**Acceptance Scenarios**:

1. **Given** confirmed orders for today with some quantities still remaining, **When** the supplier opens Home, **Then** a card shows the number of medicines still to buy today and links to today's list; when nothing remains it says so.
2. **Given** a long list, **When** the supplier types part of a medicine name, **Then** only matching rows (and unregistered entries) are shown, and clearing the search restores the list.
3. **Given** the filter "still to buy", **When** it is applied, **Then** rows with nothing remaining are hidden, and "bought" shows only rows with a purchase.
4. **Given** the list is loading, fails to load, or has no rows, **When** the screen is shown, **Then** it shows a loading state, an error with Retry, or an empty state with the next action.

---

### Edge Cases

- A confirmed order is edited or cancelled after something was bought: recorded purchases stay as they are, the requested quantity changes, so the row may show "Bought extra N"; nothing recorded is lost.
- A medicine is only on a cancelled or draft order: it is not on the list.
- Several entries for the same medicine on one date (partial purchases) add up; entries of another date do not count for this date's list.
- A purchase entry has no cost: it still counts for the quantity; the cost field stays empty, never zero.
- The supplier chooses a purchase date that is not the list date: the entry counts for that day's list, not the one being viewed. The dialog says so before saving and the confirmation names the date, so a purchase never seems to have disappeared.
- The cost has more than two decimals, is negative, or is not a number: the entry is refused with a field message.
- The quantity is zero, negative, fractional, empty or above 100,000: the entry is refused with a field message.
- Two devices or two taps record purchases at the same time: both entries are kept (they are different purchases) unless they are the same request repeated, which creates one entry.
- A typed medicine appears in a store's order and the same medicine is already registered under a slightly different name: they stay separate (the app never merges by text); the supplier can link the typed line through Module 004, after which the list moves it.
- The supplier cancels an entry that was the last one for a medicine: purchased returns to 0 and the row shows "Not bought" again, with the cancelled entry still in the history.
- The same medicine is ordered in two different units on two orders (for example "strip" and "box"): the list shows two rows, one per unit, and a purchase entry is recorded against the row (medicine and unit) it was made from; quantities in different units are never added together. Typed entries are grouped the same way (typed text and unit).
- A medicine becomes inactive after it was ordered: it stays on the list for the orders that contain it.
- The list is open while another order is confirmed: the supplier sees the change after refreshing or reopening; the screen never shows stale totals as final without a way to refresh.
- Network failure while saving a purchase: the app says it was not saved, keeps what the supplier typed, and a retry does not create a second entry. No offline queue is claimed in this module.
- Very large days (200 orders, 1,000 lines): the list still opens within the time in the success criteria.

## Requirements *(mandatory)*

### Functional Requirements

**Market list**

- **FR-001**: The system MUST show a market list for one selected business date (shown and chosen in Pakistan Standard Time, today by default) that adds up the quantities of all confirmed, not cancelled orders confirmed on that date, for the signed-in business only. Draft and cancelled orders MUST NOT count.
- **FR-002**: Each registered medicine MUST appear as one row, grouped by the medicine itself (its identity) and the unit written on the order line, never by similar text. Medicines that differ in strength, dosage form, manufacturer or pack size MUST be separate rows, and the same medicine ordered in two different units (for example strip and box) MUST be two rows, because quantities in different units are never added together.
- **FR-003**: Each row MUST show the medicine name with its strength, dosage form and pack size where it has them, the unit, the total requested quantity, one line per store with the store name and that store's quantity, the purchased quantity, the remaining quantity and a purchase status: Not bought, Partly bought, Fully bought or Bought extra.
- **FR-004**: Typed lines (not registered) of confirmed orders MUST appear in a separate group "Not yet registered", grouped by the exact typed text compared ignoring capital letters and repeated spaces, each with its store-wise breakdown, so that no requested quantity is left out. The sum of all quantities on the list (registered rows plus the unregistered group) MUST equal the sum of the quantities of the confirmed order lines of that date.
- **FR-005**: The list MUST reflect the current orders. After an order is confirmed, cancelled or has a quantity edited, or after a typed line is registered or linked, the list MUST show the new totals; recorded purchases MUST be kept, and a line that is registered or linked MUST move from "Not yet registered" into its medicine's row.
- **FR-006**: The supplier MUST be able to search by medicine name (including unregistered entries), filter by status (all, still to buy, bought) and by store, and choose the date.
- **FR-007**: The list MUST NOT show or return a purchase price, an actual unit cost, a selling price, an MRP, a margin or a profit.

**Purchase recording**

- **FR-008**: From a row of a registered medicine the supplier MUST be able to record a purchase entry (for that row's medicine and unit) with: the purchased quantity (a whole number from 1 to 100,000, required), the actual unit cost in PKR with at most two decimals (optional), the supplier or market name (optional text), a purchase reference (optional text) and the purchase date (the list date by default). Invalid input MUST be refused with a message at the field. A purchase counts only for the list of its purchase date: when the chosen purchase date is not the list date, the dialog MUST say so before saving (for example "This purchase will count for 12 Nov, not for 13 Nov.") and the saved confirmation MUST name that date.
- **FR-009**: Several purchase entries per medicine per date MUST be allowed. Purchased quantity is the sum of the entries that are not cancelled; remaining quantity is the requested quantity minus the purchased quantity and MUST never be shown below zero; buying more than requested MUST be shown as "Bought extra N".
- **FR-010**: A purchase MUST only be marked by recording a quantity. There MUST be no control that marks a medicine as fully bought without a recorded quantity. A quick action "Bought all remaining" MAY pre-fill the form with the remaining quantity, but MUST require the supplier's confirmation and MUST record that exact quantity. The quick action MUST be offered only when the remaining quantity is above zero.
- **FR-011**: Purchase entries MUST be append-only. A wrong entry MUST be cancelled with a reason (the entry stays, marked cancelled with who, when and why; "who" is the signed-in user, shown as "You" because use is solo), and a corrected entry added. An entry MUST NOT be edited or deleted through the app, and the history of entries of a medicine (who, when, quantity, cost, cancelled or not, reason) MUST stay visible.
- **FR-012**: Saving a purchase MUST be safe to repeat: the same save request, however often it reaches the server and even at the same time, MUST create exactly one entry; and cancelling the same entry twice MUST cancel it once.
- **FR-013**: A typed line (not registered) MUST NOT accept a purchase entry. Its row MUST offer "Register this medicine" (the Module 004 flow); after registering or linking, its quantity is in a registered row where a purchase can be recorded.
- **FR-014**: After a purchase that has an actual unit cost is saved, the system MAY offer to update the medicine's current purchase price to that cost. It MUST change the price only after the supplier's explicit confirmation, MUST never change a price silently, and MUST never change a selling price, an MRP or any order line price.
- **FR-015**: Recording or cancelling a purchase MUST NOT change any order, order line, ordered quantity, delivered quantity or price snapshot. Purchased quantity is a separate number from ordered and delivered quantity.

**Print and export**

- **FR-016**: The system MUST offer a print layout of the market list suitable for carrying to the market: header with the business name and the date, each medicine with its unit, total quantity and its store-wise quantities, the group "Not yet registered" with every entry marked "unregistered", and columns for the purchased and remaining quantity (filled from recorded purchases, with room to write by hand). The supplier MUST be able to limit the print to selected stores, and the print MUST say which stores are included.
- **FR-017**: The system MUST offer a CSV export of the same rows (one line per medicine and store, with the medicine's total, purchased, remaining and status, and a marker for unregistered entries). Quantities and texts that start with a spreadsheet formula character MUST NOT be turned into formulas when the file is opened.
- **FR-018**: The print and the export MUST NOT contain a purchase price, an actual unit cost, a selling price, an MRP, a margin or a profit.

**Visibility and screens**

- **FR-019**: Home MUST show a card "Market list: N medicines to buy today" (N = rows of today's list that still have a remaining quantity, with the unregistered entries counted) that links to today's list, and the orders area MUST have a link to the market list. The bottom navigation keeps five items.
- **FR-020**: Every list in this module (market list, purchase history of a medicine) MUST have a loading state, an error state with Retry and an empty state that shows the next action. The screens MUST be mobile-first, in English, with touch targets of at least 44 × 44 px and no sideways scrolling at a 360 px width.

**Safety, isolation and history**

- **FR-021**: Every read and write in this module MUST be limited to the signed-in business; a request that names a record of another business MUST get the same answer as a missing record, and change nothing. Server-side checks MUST not depend on the screen's checks.
- **FR-022**: Every purchase entry and every cancellation MUST be recorded with who, when and the values, and MUST NOT be changeable or removable by the user through the app.

### Key Entities *(include if feature involves data)*

- **Market list**: A view, not a stored document: for one business date it is the sum of the quantities of confirmed, not cancelled orders confirmed on that date, grouped by medicine (and, for typed lines, by normalized typed text), with a store-wise breakdown.
- **Purchase entry**: One real purchase at the market: the medicine, the purchase date, the purchased quantity, an optional actual unit cost, an optional supplier or market name and reference, who recorded it and when, and whether it was cancelled (with who, when and reason). Append-only.
- **Purchased quantity / remaining quantity / status**: Computed from the requested quantity of the list and the sum of the entries that are not cancelled; never stored as an editable number.
- **Order line (existing)**: Unchanged by this module. Its ordered quantity feeds the list; its delivered quantity and price snapshot are never touched.
- **Medicine (existing)**: Its current purchase price MAY be updated after the supplier confirms, from a purchase that has an actual cost.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tests, the sum of all quantities on the list (registered rows plus the "Not yet registered" group) equals the sum of the quantities of the confirmed order lines of that date, and 0 quantities of draft or cancelled orders are on it.
- **SC-002**: The master prompt example (Al Madina 20, Shah Medical 10, Rehman Medical 15 of the same Panadol) shows total 45 with the three store quantities, and medicines with a different strength, dosage form, manufacturer or pack size are separate rows in 100% of tests.
- **SC-003**: After a quantity edit, a cancellation, a new confirmation, or a registered or linked typed line, the list shows the new totals in 100% of tests, and 0 recorded purchases are lost or changed by it.
- **SC-004**: Partial purchases give the right figures in 100% of tests (for example 20 and then 10 of 45 gives purchased 30, remaining 15, "Partly bought"; more than requested gives "Bought extra N" and remaining 0, never a negative number).
- **SC-005**: Repeating one purchase save 10 times, including 10 simultaneous repeats, results in exactly one entry; repeating one cancellation results in one cancellation, in 100% of tests.
- **SC-006**: In 100% of tests, a cancelled entry stops counting, stays in the history with its reason, who and when, and no entry can be edited or deleted through the app.
- **SC-007**: In 100% of tests, recording or cancelling a purchase leaves every order, order line, ordered quantity, delivered quantity and price snapshot identical, and a purchase price is changed only after an explicit confirmation.
- **SC-008**: In 100% of tests, the printed page and the CSV file contain 0 purchase prices, actual unit costs, selling prices, MRPs, margins or profits, and every typed entry in them is marked "unregistered".
- **SC-009**: In 100% of tested attempts by one business to read or change the lists, orders, lines or purchase entries of another business, the attempt is refused with the same answer as for a missing record and 0 records of the other business change.
- **SC-010**: The market list for a day with 200 confirmed orders and 1,000 lines opens within 3 seconds, and the purchase save answers within 2 seconds, on the test project.
- **SC-011**: Every new screen is reachable by visible navigation at a 360 px width, with 100% of interactive controls at least 44 × 44 px and no sideways scrolling, and a loading, error and empty state is verified for each list.
- **SC-012**: A supplier can find a medicine on a list of 100 rows by typing part of its name and record a purchase for it in under 30 seconds on a phone.

## Assumptions

- Terms: the **market list** is the consolidated list described above; a **purchase entry** is one recorded purchase; **cancelling** an entry means marking it cancelled with a reason (it is never deleted); the database and the code call the same action "void".
- A day's list includes the orders **confirmed on that date** in Pakistan Standard Time. This is chosen because the list is about confirmed orders and an order confirmed today must never be missing from today's list, even if it was started as a draft earlier. The supplier can choose another date. This choice is flagged for the owner to confirm.
- A purchase entry belongs to the list date it was recorded for (the purchase date defaults to the list date). Purchased quantity on a list is the sum of the entries of that medicine for that date. When the list is limited to some stores for printing or viewing, the purchased and remaining quantities still refer to the whole day, and the screen says so; splitting a purchased quantity between stores is not part of this module.
- Buying more than requested is allowed (a pack that cannot be split, a better price, a mistake) and is shown clearly as "Bought extra N". A cancelled or edited order after a purchase can also lead to this.
- Typed (unregistered) lines are listed and counted, but a purchase is recorded only for registered medicines, because a purchase entry must refer to a real medicine. The supplier registers or links the medicine with the Module 004 flow first. This keeps ordered quantity, medicine identity and cost consistent.
- Recording a cost is optional because the real purchase price is usually known only at the market (master prompt Section 7A). The cost belongs to the purchase entry only; it is shown on the purchase recording screens, never on the list print, the export, an invoice or an order line.
- Updating the medicine's current purchase price from a purchase is an optional offer after the supplier confirms. It is the supplier's decision and never silent. Profit reporting from purchase costs is a later module (Module 010).
- "Delivered quantity" stays as Module 003 set it (the ordered quantity at confirmation). The market list and purchases never change it. How fulfilled quantities reach an invoice is decided in Module 006.
- The list shows the current data when opened or refreshed. Live updating while the screen stays open is not required; a visible refresh is.
- Export is a CSV file; the supplier can open it in a spreadsheet. A PDF file is not part of this module; the print layout is used with the browser's print function (including "save as PDF" if the browser offers it).
- The market list print is one compact A4 layout and never includes the application navigation. Thermal (80 mm) printing, with its width as a setting (`thermal_paper_mm`, already stored since Module 002), is required for invoices and is built with them in Module 006; the owner agreed on 2026-11-13 that thermal print comes with the invoices.
- Use is still solo: the signed-in user is the owner; "who" in the history is that signed-in user. Multi-user roles are not part of this module.
- The Home card and the orders area carry the visibility; no sixth item is added to the bottom navigation, to keep five large touch targets at 360 px.
- Quantities are whole numbers from 1 to 100,000, like order lines. Money is PKR with two decimals, exact.
- Constitution Principles I-VIII apply: server-side validation, exact PKR, isolation per business, append-only history, no invented data, and mobile-first screens with loading, error and empty states.
- This module builds on Modules 001 to 004, all merged into master. It starts from master.

## Out of Scope

Invoices, invoice numbers, invoice printing, and the individual-store and combined store-wise order prints (Module 006); store ledger and payments (Module 007); voice order entry and Gemini (Module 008); offline sync and offline purchase recording (Module 009); profit and reports built from purchase costs (Module 010); splitting a purchased quantity between stores; changing delivered or ordered quantities; supplier or vendor master data; purchase returns; PDF generation; thermal (80 mm) layouts (Module 006, with invoices); multi-user roles; editing or deleting a purchase entry (a wrong entry is cancelled with a reason and a corrected one added).
