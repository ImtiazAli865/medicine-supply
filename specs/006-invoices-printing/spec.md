# Feature Specification: Invoices and Printing

**Feature Branch**: `006-invoices-printing`  
**Created**: 2026-11-14  
**Status**: Draft  
**Input**: User description: "Module 006 Invoices: a draft invoice from a confirmed order, issuing it, printing it on A4 and on 80 mm thermal paper, cancelling it, and the order prints (options A and B) for the Medicine Supply & Order Management app (builds on Modules 001 to 005, all merged into master). Scope only: (1) an invoice draft per confirmed order, priced only from the order's selling price snapshots, with a delivered (billed) quantity per line; (2) an atomic, retry-safe issue step with a controlled invoice number, an immutable snapshot and the order marked fulfilled; (3) A4 and thermal layouts for the customer-facing invoice that never show cost, purchase price, MRP, margin or profit; (4) an invoices list with filters and search, links from the order screen and a Home count of orders still to invoice; (5) cancellation of an issued invoice with a reason; (6) order print options A (one store) and B (several stores, one section each). Out of scope: the Account Summary block, payments and balances (Module 007), paid and partially paid statuses, discounts, server-side PDF files, voice, offline sync, reports, multi-user roles, editing a confirmed order's quantities."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an invoice draft from a confirmed order and check it (Priority: P1)

The supplier has delivered (or is about to deliver) a store's confirmed order. They open the order and tap "Create invoice". A draft appears with one line per order line, each priced from the price that was taken for that order line, with line totals and a grand total. They can change the delivered quantity of each line (for example, only 8 of 10 were delivered). If any line has no verified selling price, the draft says exactly which lines and why, and links to the Pending Prices screen, so nothing is ever priced by guessing.

**Why this priority**: The draft is the base of everything else. Without it, there is nothing to issue or print, and it already shows the supplier what will be billed.

**Independent Test**: Confirm an order for one store with three lines (all priced) and open "Create invoice": three lines, each with quantity x selling price, and a grand total equal to the sum of the line totals. Change one delivered quantity: only that line total and the grand total change. Tap "Create invoice" again, refresh, and retry: still one draft. Confirm another order that has one typed (pending registration) line: the draft shows it as "Needs a verified selling price" with a link to Pending Prices.

**Acceptance Scenarios**:

1. **Given** a confirmed order whose lines all carry a selling price snapshot, **When** the supplier taps "Create invoice", **Then** a draft is created with one line per order line, price and line total taken from the order line's snapshot, and a grand total equal to the sum of the line totals.
2. **Given** the catalog selling price of a medicine was changed after the order was confirmed, **When** the draft is created or opened, **Then** the line still uses the order line's snapshot price, never the current catalog price.
3. **Given** a draft exists, **When** the supplier lowers a line's delivered quantity from 10 to 8, **Then** that line's total and the grand total are recalculated from the new quantity, and the ordered quantity (10) is still shown unchanged next to it.
4. **Given** a draft exists, **When** the supplier sets a line's delivered quantity to 0, **Then** the line is shown as "Not delivered, not billed" and is excluded from the total; a delivered quantity above the ordered quantity is allowed but shows a visible "more than ordered" note.
5. **Given** an order line is typed (not registered) or has no selling price snapshot, **When** the draft is shown, **Then** the line is marked "Needs a verified selling price", the draft cannot be issued, and a link opens the Pending Prices screen; no price is guessed or shown for that line.
6. **Given** the "Create invoice" request is repeated (double tap, slow network, refresh, retry), **When** it reaches the server several times, **Then** exactly one live invoice exists for the order.
7. **Given** the order is a draft, cancelled or already has a live invoice, **When** the supplier looks at it, **Then** "Create invoice" is not offered for a draft or cancelled order, and for an order with a live invoice it shows "View invoice" instead.
8. **Given** the order changed after the draft was created (a line quantity, a line added or removed, or a price filled in), **When** the supplier opens the draft, **Then** a notice says the order has changed and offers "Refresh from order"; refreshing rebuilds the lines from the order and asks the supplier to re-check the delivered quantities.

---

### User Story 2 - Issue the invoice with a controlled number (Priority: P1)

When the draft is correct, the supplier taps "Issue invoice" and confirms. The invoice gets a unique invoice number, its lines, prices and totals are frozen, and the order is marked as fulfilled. From then on the invoice can be printed any number of times with exactly the same numbers.

**Why this priority**: Issuing makes the invoice a financial record. The duplicate-free number and the frozen snapshot are the heart of the billing rules (master prompt Section 11).

**Independent Test**: Issue a ready draft: the invoice shows number 1 of the business sequence, status "Issued", date and time, who issued it; the order shows "Fulfilled" and its change history records the issue. Tap "Issue" ten times in a row, including at the same time from two devices: one invoice number is used. Change the catalog price and a medicine's name afterwards: the issued invoice is unchanged. Try to issue a draft that still has a line without a verified price: refused with the reason.

**Acceptance Scenarios**:

1. **Given** a draft whose billed lines all have verified selling prices and at least one line is billed, **When** the supplier confirms "Issue invoice", **Then** the invoice becomes "Issued" with a unique invoice number, an issue date and time, the issuing user, and frozen lines, prices and totals.
2. **Given** an invoice was issued, **When** the same issue request is repeated or sent at the same moment from two screens, **Then** only one invoice number is consumed and the invoice shows the same number every time.
3. **Given** two different drafts are issued one after the other, **When** their numbers are compared, **Then** the numbers are different and increase in the order of issue; a number is never reused, not even after a cancellation.
4. **Given** a draft has a billed line without a verified selling price, or no billed line at all, **When** the supplier taps "Issue invoice", **Then** the issue is refused with a clear message naming the problem, nothing is changed, and no invoice number is used.
5. **Given** the order was changed after the draft was created, **When** the supplier tries to issue the stale draft, **Then** the issue is refused with "The order has changed, refresh the draft first" and nothing is changed.
6. **Given** an invoice was issued, **When** its medicines or catalog prices are edited later, **Then** the issued invoice (lines, prices, totals, names) is unchanged, and it cannot be edited or deleted by any screen.
7. **Given** an invoice is issued, **When** the supplier opens the order, **Then** the order shows "Fulfilled", it links to its invoice, its change history records "Invoice issued" with who and when, and its lines can no longer be edited.
8. **Given** an order is fulfilled, **When** the market list of its date is opened, **Then** it still counts the order, so the requested, purchased and remaining quantities do not change because of the invoice.

---

### User Story 3 - Print the invoice on A4 or on a thermal receipt (Priority: P2)

At print time the supplier chooses a layout: a clean A4 page, or a compact receipt for an 80 mm thermal printer. The invoice shows only what the store should see: the supplier's business name and details, the invoice number and date, the store, and each line's product name, quantity, selling price and line total, then the grand total. A draft can be printed as a preview marked "DRAFT, not an invoice"; an issued invoice prints exactly as issued; a cancelled invoice prints marked "CANCELLED".

**Why this priority**: A paper invoice is how the store receives the bill. It builds on issuing and does not block it.

**Independent Test**: Open an issued invoice and print it in each layout (print preview): A4 has the business header, invoice number, date, store, a table of lines and the grand total at the bottom; thermal is narrow (80 mm), single column per line, with the same numbers. The text of both contains no purchase price, cost, MRP, margin or profit. Reprint the next day after a catalog price change: identical numbers.

**Acceptance Scenarios**:

1. **Given** an issued invoice, **When** the supplier picks "A4" and prints, **Then** the page has the business name and details, invoice number, date, store name and contact, a table of product name, quantity, selling price and line total, and the grand total at the bottom.
2. **Given** the same invoice, **When** the supplier picks "Thermal 80 mm" and prints, **Then** the layout fits an 80 mm wide receipt with the same facts and the same grand total, with no horizontal overflow.
3. **Given** any invoice (draft, issued or cancelled), **When** it is shown or printed, **Then** no purchase price, cost, MRP, margin or profit appears in the screen, the print, or the data returned for it.
4. **Given** an issued invoice is reprinted on another day, **When** compared with the first print, **Then** every number and name is the same.
5. **Given** a draft is printed, **When** the page opens, **Then** it is clearly marked as a draft preview with no invoice number; a cancelled invoice is marked "CANCELLED" with its number kept.
6. **Given** the business has not entered its phone or address, **When** an invoice is printed, **Then** the business name is shown and the missing details are simply left out, with nothing invented.

---

### User Story 4 - Cancel a wrong invoice and replace it (Priority: P2)

An issued invoice was wrong (a wrong quantity or a wrong store's order). The supplier cancels it with a required reason. The invoice stays in the history with its number, marked cancelled, and the order goes back to "Confirmed" so a new, correct invoice can be created for it. The old invoice is never edited or deleted.

**Why this priority**: The master prompt requires that issued invoices are corrected by cancellation or replacement and never silently altered. It is needed, but only after issuing works.

**Independent Test**: Cancel an issued invoice with a reason: it shows "Cancelled" with who, when and why, keeps its number and its original lines, can still be opened and printed (marked cancelled), and the order is "Confirmed" again. Create and issue a replacement: a new number is used. Cancel twice (retry): one cancellation. Try to cancel without a reason: refused.

**Acceptance Scenarios**:

1. **Given** an issued invoice, **When** the supplier cancels it and gives a reason, **Then** the invoice is "Cancelled" with the reason, who and when; its number and lines are unchanged and still visible.
2. **Given** a cancelled invoice, **When** its order is opened, **Then** the order is "Confirmed" again, "Create invoice" is offered, and the cancelled invoice is still listed in the order's invoice history.
3. **Given** the cancel request is repeated or sent twice at once, **When** it reaches the server, **Then** exactly one cancellation exists and the first reason is kept.
4. **Given** no reason is entered, **When** the supplier confirms the cancellation, **Then** it is refused and nothing changes.
5. **Given** a draft invoice, **When** the supplier no longer wants it, **Then** they can discard the draft (no number was ever used); an issued invoice cannot be discarded, only cancelled.

---

### User Story 5 - Find invoices and see what is still to invoice (Priority: P2)

The supplier opens an Invoices screen to see all invoices, newest first, and filters them by status, store and date, or searches by invoice number or store name. Home shows how many confirmed orders are still waiting for an invoice and links to them. The order screen links to its invoice.

**Why this priority**: A list nobody can reach or search is not usable, but it comes after the invoice itself works.

**Independent Test**: With drafts, issued and cancelled invoices for several stores, open Invoices: all are listed with number (or "Draft"), store, date, grand total and status; each filter and the search work; with no invoices an empty state offers "Go to orders". Home shows N confirmed orders without an issued invoice, and N equals the length of the list that its link opens. At 360 px nothing scrolls sideways and every control is at least 44 px.

**Acceptance Scenarios**:

1. **Given** invoices of different statuses exist, **When** the supplier opens Invoices, **Then** each shows invoice number (or "Draft"), store, date, grand total and status, newest first.
2. **Given** the supplier picks a status, a store or a date range, or types part of an invoice number or a store name, **When** the list is shown, **Then** only matching invoices appear, and clearing the filters restores the list.
3. **Given** confirmed orders exist without an issued invoice, **When** Home is opened, **Then** a card shows how many, and its link opens the list of exactly those orders; when none remain, it says so.
4. **Given** no invoice exists, **When** the Invoices screen opens, **Then** an empty state explains it and offers the next action (open orders).
5. **Given** the list is loading or fails to load, **When** the screen is shown, **Then** a loading state or an error with Retry is shown, never a blank screen.
6. **Given** an order has an invoice, **When** the supplier opens the order, **Then** it shows "View invoice" with the invoice's number and status.

---

### User Story 6 - Print order sheets: one store, or several stores in sections (Priority: P3)

The supplier prints a store's order as an order sheet (option A), or prints several stores' orders of a day in one document where each store has its own section with its own product list (option B). Order sheets show quantities and units only; they are not invoices and never show prices.

**Why this priority**: Master prompt Section 10 asks for all three print options. Option C already exists (Module 005); A and B are useful but independent of invoicing.

**Independent Test**: Print option A for one order: business header, store name and contact, order number and date, each product with quantity and unit. Print option B for three stores on one date: three clearly separate sections, each with its own full list; no store's items are mixed with another's; no prices anywhere.

**Acceptance Scenarios**:

1. **Given** a confirmed order, **When** the supplier prints the order sheet (option A), **Then** the page has the business name, store name and contact, order number and date, and each product with quantity and unit, and no price.
2. **Given** several stores have confirmed orders on a date, **When** the supplier selects stores (or all) and prints option B, **Then** each store has its own section with its own complete list, and the sections are never merged into one list.
3. **Given** a typed (unregistered) line, **When** it is printed on an order sheet, **Then** it appears with the text as typed and an "unregistered" mark; nothing is invented for it.
4. **Given** the selected date or stores have no confirmed orders, **When** the supplier tries to print, **Then** an empty state says so and nothing blank is printed.

---

### Edge Cases

- An order with a typed line and nothing else can have a draft, but cannot be issued until the line is registered and priced; registering and pricing are done on the existing Module 004 screens and the draft then needs "Refresh from order".
- A draft invoice whose order is later cancelled: the draft can no longer be issued and says why; it can be discarded.
- Two devices open the same draft: the last saved delivered quantity wins only through the version check; a stale save is refused and the screen asks to reload, never overwriting newer data silently.
- Selling price snapshot of zero: it is a verified price of zero and may be billed; a missing snapshot is not zero and is never shown as zero.
- A line whose delivered quantity is 0 is kept visible in the draft, is not billed, and is not shown on the issued invoice's screen or print (it stays stored with the frozen invoice), so what the store sees contains only what was billed; at least one billed line is required to issue.
- A typed (unregistered) line with delivered quantity 0 does not block issuing, so its order becomes fulfilled. Known limitation: a fulfilled order cannot have a medicine registered or linked (Module 004 rule) while the market list (Module 005) still shows that line under "Not yet registered". To register it, the supplier cancels the invoice (the order returns to Confirmed), registers the medicine, and invoices again.
- The order of a draft invoice is cancelled afterwards: the draft says the order is no longer confirmed, cannot be issued, and can only be discarded.
- An order that is fulfilled cannot be edited (existing rule); to change the bill the supplier cancels the invoice, which returns the order to Confirmed, then edits and re-invoices.
- Very long product names and many lines (for example 60 lines): both print layouts wrap or break across pages without cutting a line or hiding the grand total.
- Invoice numbers are assigned only when issuing, so discarded drafts never leave gaps; a cancelled invoice keeps its number and the next invoice continues the sequence.
- The business name or the store details are changed after issuing: the issued invoice keeps the business and store details as they were at issue time.
- Money is shown in PKR with two decimals and is validated; a total that cannot be represented or a negative amount is refused.

## Requirements *(mandatory)*

### Functional Requirements

**Draft invoice**

- **FR-001**: A confirmed order MUST be able to produce one invoice draft for its store; a draft or cancelled order MUST NOT. An order MUST NOT have more than one live invoice (draft or issued) at a time.
- **FR-002**: Creating a draft MUST be retry-safe: repeating the request (double tap, refresh, slow network, simultaneous requests) MUST NOT create a second invoice.
- **FR-003**: Each draft line MUST copy the order line's medicine name, strength, dosage form, pack size, unit, ordered quantity, and its selling price snapshot. The current catalog price MUST NOT be used and a price MUST NEVER be invented.
- **FR-004**: The system MUST keep the ordered quantity and the delivered (billed) quantity of each line as two separate values. The draft MUST start with the delivered quantity equal to the ordered quantity, and the supplier MUST be able to change it per line between 0 and the maximum allowed quantity.
- **FR-005**: Line total MUST be delivered quantity multiplied by the snapshot selling price, and the grand total MUST be the sum of the line totals, both calculated by the system and never typed. Lines with delivered quantity 0 MUST be excluded from the total.
- **FR-006**: A line MUST be marked "Needs a verified selling price" when it is a typed line or has no selling price snapshot; such a line MUST block issuing, and the screen MUST link to the Pending Prices screen.
- **FR-007**: The system MUST detect when the order changed after the draft was created and MUST show a notice with a "Refresh from order" action; refreshing MUST rebuild the lines from the order and reset the delivered quantities to the order lines' delivered quantities (which equal the ordered quantities for an order without an issued invoice) after the supplier confirms.
- **FR-008**: The supplier MUST be able to discard a draft; a discarded draft MUST leave no invoice number gap and MUST NOT affect the order.
- **FR-009**: Saving a changed delivered quantity MUST use a version check so a stale screen cannot overwrite newer data silently.

**Issue and immutability**

- **FR-010**: Issuing MUST be one atomic, retry-safe operation that assigns the invoice number, freezes the lines, names, prices, quantities, totals, store details and business details, records who issued it and when, and marks the order as fulfilled with a history entry, all together or not at all.
- **FR-011**: Invoice numbers MUST be unique per business, assigned only at issue time from a controlled sequence, increasing in the order of issue, never reused, and not consumed by a failed, refused, repeated or simultaneous attempt.
- **FR-012**: Issuing MUST be refused, with a clear reason and no change, when any billed line lacks a verified selling price, when no line is billed, when the order is no longer confirmed, or when the draft is out of date against its order.
- **FR-013**: An issued invoice MUST NOT be edited or deleted by any screen or request; its lines, prices, quantities, totals and numbers MUST stay identical for its whole life, regardless of later catalog, store, business or order changes.
- **FR-014**: Statuses in this module MUST be draft, issued and cancelled. Paid and partially paid are not part of this module.
- **FR-015**: The order MUST show its invoice (number and status), and a fulfilled order MUST keep counting on the market list of Module 005 with unchanged requested, purchased and remaining quantities.

**Cancellation**

- **FR-016**: An issued invoice MUST be cancellable only with a required reason (1 to 500 characters); the cancellation MUST record who and when, keep the invoice and its number visible, and return the order to Confirmed so a replacement can be created.
- **FR-017**: Cancelling MUST be retry-safe: a repeated or simultaneous cancel MUST produce one cancellation and keep the first reason.

**Printing**

- **FR-018**: The customer-facing invoice MUST show only: the business name and its stored contact details, the invoice number, the date, the store name and contact, and for each billed line the product name, quantity, selling price and line total, plus the grand total at the bottom.
- **FR-019**: The invoice screen, both print layouts, and every response that carries invoice data MUST NEVER contain a purchase price, cost, MRP, margin or profit.
- **FR-020**: The supplier MUST be able to choose the layout at print time: a clean A4 layout or a compact thermal layout whose paper width comes from the existing Settings value (80 mm by default). Both MUST show the same facts and totals, MUST NOT overflow sideways, and MUST NOT cut a line or hide the grand total when the invoice is long.
- **FR-021**: A draft print MUST be marked as a draft preview without an invoice number; a cancelled invoice print MUST be marked "CANCELLED" and keep its number.
- **FR-022**: Printing MUST use the browser's print function and the browser's own save as PDF; the app MUST NOT claim any other PDF output, and a real printer MUST NOT be claimed unless one was tested.
- **FR-023**: The invoice and the order sheets MUST show the business name and the phone and address the supplier already saved in Settings (Module 002); a detail that was not entered MUST be left out and MUST NOT be invented.

**Invoices list and visibility**

- **FR-024**: An Invoices screen MUST list invoices newest first with number (or "Draft"), store, date, grand total and status, with filters for status, store and date range (the invoice date for an issued or cancelled invoice, the creation day for a draft), and a search by invoice number or store name, with loading, error (with Retry) and empty states.
- **FR-025**: The order detail screen MUST offer "Create invoice" or "View invoice" according to the order's state, and Home MUST show the count of confirmed orders without an issued invoice with a link to them; the count and the list MUST use one shared definition so they can never disagree.
- **FR-026**: Every new list and screen MUST work at 360 px width without sideways scrolling, with touch targets of at least 44 px.

**Order sheets (options A and B)**

- **FR-027**: The supplier MUST be able to print one order as an order sheet (option A) with the business header, store name and contact, order number and date, and each product with quantity and unit, with no prices.
- **FR-028**: The supplier MUST be able to print the confirmed orders of a chosen date for all or selected stores in one document (option B) where each store has a separate section with its own complete list; items of different stores MUST NEVER be merged.
- **FR-029**: Typed lines on an order sheet MUST be shown as typed with an "unregistered" mark; nothing MUST be invented for them.

**Isolation, safety and history**

- **FR-030**: Every new table and operation MUST be isolated by business: a user MUST NOT see, create, change, issue, cancel or print another business's invoice or order, and a refusal MUST look the same as a missing record.
- **FR-031**: The system MUST NOT rely on the screen alone for any of these rules; they MUST be enforced on the server side for every request.
- **FR-032**: Every change to an invoice (created, edited as a draft, refreshed, issued, cancelled, discarded) MUST be recorded with who, when and what, in a history that cannot be edited.

### Key Entities *(include if feature involves data)*

- **Invoice**: A bill for one confirmed order of one store. Has a status (draft, issued, cancelled), an invoice number (only after issue), invoice date, issue and cancel details (who, when, reason), the grand total, and a snapshot of the business and store details taken at issue. One order can have several invoices over time, but only one live (draft or issued) at a time.
- **Invoice line**: One medicine on an invoice. Holds the name and details as they were, the unit, the ordered quantity, the delivered (billed) quantity, the selling price snapshot and the line total. Frozen once the invoice is issued. A line can point back to its order line.
- **Invoice number sequence**: A per-business counter that hands out the next number only when an invoice is issued.
- **Invoice history**: An append-only record of every change to an invoice (who, when, what).
- **Business details**: The business name plus the optional phone and address already kept in Settings, shown on invoices and order sheets and copied onto the invoice at issue time.
- **Order sheet**: A printed list of an order's or several orders' products and quantities with no prices; it is a view of order data, not a stored record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Creating a draft for an order with 20 priced lines takes at most 2 seconds, and a supplier can go from the order screen to a printed A4 invoice in at most 5 taps.
- **SC-002**: Repeating a "create draft", "issue" or "cancel" request 10 times, including at the same time, always produces exactly one draft, one invoice number and one cancellation respectively (verified by tests against the real database).
- **SC-003**: 100% of issued invoices have a number that is unique within the business, and the numbers of a test run of 50 issued invoices are all different and increase in the order of issue.
- **SC-004**: After issuing, changing the catalog price, the medicine name, the store and the business details changes 0 values on the issued invoice or its print (verified by comparing the data and the printed text before and after).
- **SC-005**: For every invoice in the tests, the grand total equals the sum of the line totals, and each line total equals delivered quantity multiplied by the line's snapshot price (verified for every line of every tested invoice).
- **SC-006**: In all invoice screens, A4 and thermal prints and invoice data responses, 0 occurrences of purchase price, cost, MRP, margin or profit (verified by text checks on the rendered pages and key checks on the returned data).
- **SC-007**: Issuing is refused 100% of the time when any billed line lacks a verified selling price, when no line is billed, or when the draft is out of date, and in each case no number is used and nothing changes.
- **SC-008**: A second business's user can see, create, change, issue, cancel or print 0 of the first business's invoices and order sheets, using crafted ids (verified with two real users).
- **SC-009**: The Invoices list for a business with 1,000 invoices opens in at most 3 seconds, and the Home "still to invoice" count always equals the length of the list its link opens.
- **SC-010**: At 360 px width, the new screens have no sideways scrolling and all controls are at least 44 px (verified by the existing touch-target check); a 60-line invoice prints without cutting a line and always shows the grand total, in both layouts.
- **SC-011**: The thermal layout fits within an 80 mm page width in print emulation with no horizontal overflow; the record states that no real thermal printer was tested unless one is.
- **SC-012**: Issuing an invoice marks its order fulfilled and the market list of that date shows the same requested, purchased and remaining quantities before and after (verified by tests).
- **SC-013**: A supplier can cancel a wrong issued invoice and issue a corrected replacement for the same order in at most 2 minutes, and the cancelled invoice stays visible with its reason.

## Assumptions

These assumptions were decided from the master prompt and the merged modules. The owner confirmed the first four on 2026-11-14 (assumption 2 was explained with an example before the owner agreed).

1. **Account Summary and payments are not in this module.** The "Account Summary" block (previous balance, payment received now, balance due) and the statuses paid and partially paid need the store ledger (khata), which is Module 007. This module has the statuses draft, issued and cancelled only. The invoice data is designed so Module 007 can add the Account Summary snapshot later without changing issued invoices. *(Confirmed by the owner on 2026-11-14.)*
2. **Delivered quantity is entered on the invoice draft.** The order lines already carry a delivered quantity that equals the ordered quantity at confirmation. The supplier adjusts the billed quantity on the draft (down or up), the ordered quantity is never overwritten, and a separate delivery screen is not part of this module. *(Confirmed by the owner on 2026-11-14.)*
3. **Cancelling an issued invoice returns the order to Confirmed** so that a corrected replacement can be created; the cancelled invoice and its number remain in the history. *(Confirmed by the owner on 2026-11-14.)*
4. **Invoice numbers are a plain increasing number per business** (shown with a fixed prefix and zero padding, for example INV-000001), assigned only when issuing, so discarded drafts leave no gaps. Gaps can only appear if the supplier cancels, and then the number stays visible as cancelled. *(Confirmed by the owner on 2026-11-14.)*
5. Settings (Module 002) already keep the business phone, address and the thermal paper width (default 80 mm), so nothing is added to Settings. The invoice header uses what is saved there; nothing is invented if a detail is empty.
6. The invoice date is the issue date in Pakistan time (Asia/Karachi). A draft shows its creation date and no invoice date.
7. No discounts, taxes or delivery charges exist yet, so the grand total is the sum of the line totals. A later module can add them without changing issued invoices.
8. A line with a selling price of zero is a verified price (the supplier typed it); only a missing price blocks issuing.
9. One live invoice per order at a time; a fulfilled order cannot be edited (existing Module 003 rule), and a draft that has become stale against its order cannot be issued until refreshed.
10. Option B prints confirmed (and fulfilled) orders of one chosen Pakistan day, using the same day rule as the market list of Module 005.
11. Browser printing and the browser's own "save as PDF" are the only output; server-side PDF files, e-mail or messaging of invoices, and QR codes are out of scope.
12. Voice, offline queueing, reports, ledger, payments and multi-user roles are out of scope and are not claimed.
