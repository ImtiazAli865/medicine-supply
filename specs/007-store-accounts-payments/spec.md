# Feature Specification: Store Accounts (Khata), Payments, Account Summary and Store Statement

**Feature Branch**: `007-store-accounts-payments`  
**Created**: 2026-11-16  
**Status**: Draft  
**Input**: User description: "Module 007 for the Medicine Supply & Order Management app (builds on Modules 001 to 006, all merged into master; Module 006 invoices are issued, immutable, numbered INV-000001 and priced from the order line selling price snapshot). Scope only: (1) a store ledger (khata): one running account per store, computed only from append-only entries (opening balance, invoice, payment, adjustment, reversal), never an editable balance; (2) opening balance entered by the supplier on any day, because the khata starts empty and invoices issued before this module are not put into it; (3) cash payments that belong to the store account, are allocated to the oldest unpaid item first, keep any excess as an advance, and are recorded once even when retried; invoices show a derived status of unpaid, partially paid or paid; (4) adjustments (write off or add a small amount) with a required reason; (5) a 'payment received now' amount on the issue screen, recorded together with the issue in one atomic operation; (6) an optional Account Summary block on the invoice (previous balance, this invoice, payment received, balance due) saved as an unchangeable snapshot at issue; (7) a Store Account screen, a stores balance list and a Home card; (8) a printable Store Statement for a date range; (9) the derived paid status on the invoices list and screen. Out of scope: offline payments and 'pending sync' (Module 009), voice (Module 008), profit and reports (Module 010), bank or wallet processing, multi-user roles, discounts, taxes, returns, interest, credit limits, reminders, server-side PDF."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a store's account and enter its opening balance (Priority: P1)

The supplier already keeps a paper khata. On the first day of using the app, each store has an old balance (for example, Nimer owes 12,000). The supplier opens **Store accounts**, picks a store and taps "Add opening balance": amount, direction (the store owes me, or the store has paid in advance), the "as on" date and an optional note. The store account then shows the balance and the entries, one line each, with a running balance after every line. The supplier can enter another opening balance on any later day (for example a second store's old balance, or a correction), and can undo a wrong one with a reversal and a reason.

**Why this priority**: Without a starting balance the account would start at zero and be wrong for every store that already owes money. It is the base of every other story.

**Independent Test**: Open a store with no entries: balance 0 and an empty state with the next action. Add an opening balance of 12,000 (the store owes): balance 12,000 and one entry with running balance 12,000. Add a second opening balance of 500 on a later day: balance 12,500, two entries, both kept. Reverse the first with a reason: balance 500, the original entry still visible and marked reversed, with the reversal entry beside it. Try the same save twice (double tap): one entry. Open another store: its balance is unchanged.

**Acceptance Scenarios**:

1. **Given** a store with no entries, **When** the supplier opens its account, **Then** the balance is PKR 0.00, no entries are listed, and the screen explains how to add an opening balance.
2. **Given** a store account, **When** the supplier adds an opening balance of 12,000 where the store owes, **Then** one entry is added and the balance equals the sum of the entries (12,000); the entry shows its "as on" date, who added it and when.
3. **Given** a store that already has invoices or payments in its account, **When** the supplier adds an opening balance, **Then** it is accepted (any day is allowed), it is shown as its own entry with its own date, and no earlier invoice's saved Account Summary changes.
4. **Given** the supplier is about to save an opening balance, **When** the form is shown, **Then** it warns that invoices issued before this module are not in the account and must not be included again in the opening balance.
5. **Given** an opening balance was entered wrongly, **When** the supplier reverses it with a reason, **Then** a reversal entry is added, the balance returns, the original entry stays visible as reversed, and neither can be edited or deleted.
6. **Given** the opening balance save is repeated (double tap, refresh, slow network), **When** it reaches the server several times, **Then** exactly one entry exists.
7. **Given** two stores, **When** an entry is added to one, **Then** the other store's balance and entries are unchanged.

---

### User Story 2 - Issued invoices enter the account, cancelled invoices leave it (Priority: P1)

When the supplier issues an invoice, the grand total is added to that store's account automatically as one entry linked to the invoice number. A draft never touches the account. If the supplier cancels an issued invoice, a reversal entry is added with the same amount so the balance goes back, while both entries stay visible. Invoices issued before this module are not in any account; they are shown as "Not in the account" and show no paid status.

**Why this priority**: The khata is only trustworthy if every issued invoice is in it exactly once and a cancelled one is taken out in a visible way.

**Independent Test**: A store has balance 5,000. Create a draft invoice of 8,000: balance still 5,000. Issue it: balance 13,000 with one invoice entry. Retry the issue ten times, also at the same time: still one entry. Cancel the invoice with a reason: a reversal entry, balance back to 5,000, both entries visible. Open an invoice that was issued before this module: it shows "Not in the account"; cancelling it adds no reversal and changes no balance.

**Acceptance Scenarios**:

1. **Given** a draft invoice, **When** the supplier views or edits it, **Then** the store's balance and entries do not change.
2. **Given** a ready draft of PKR 8,000 for a store whose balance is 5,000, **When** the supplier issues it, **Then** one invoice entry of 8,000 linked to the invoice number is added, the balance becomes 13,000, and the invoice shows it is in the account.
3. **Given** the issue request is repeated or sent at the same time from two screens, **When** it reaches the server several times, **Then** exactly one invoice entry exists and the balance rose once.
4. **Given** an issue is refused (for example a line has no verified price), **When** the refusal happens, **Then** no invoice number is used and no entry is added.
5. **Given** an issued invoice that is in the account, **When** the supplier cancels it with a reason, **Then** a reversal entry for the same amount is added in the same operation as the cancellation, the balance returns, and both entries stay visible; a repeated cancel adds one reversal only.
6. **Given** an invoice issued before this module, **When** the supplier opens it or lists it, **Then** it is marked "Not in the account", has no paid status and no Account Summary, and cancelling it adds no ledger entry.
7. **Given** a payment was recorded together with an invoice at issue, **When** that invoice is cancelled, **Then** only the invoice entry is reversed; the payment stays on the account (it becomes part of the balance as a credit), and the cancel screen says so before confirming.

---

### User Story 3 - Record a payment and see what it paid (Priority: P1)

A store pays 15,000 in cash. The supplier opens the store account, taps "Record payment", enters the amount, the date and an optional reference. Before saving, the screen shows the balance after the payment and how the payment will be allocated: oldest unpaid item first (the opening balance, then invoices by issue date). After saving, each invoice shows unpaid, partially paid or paid, worked out from the ledger. A payment larger than the balance is kept as an advance and is used automatically against the next invoice. A payment belongs to the store account, never to one invoice and never to another store.

**Why this priority**: Recording money received is the reason for a khata and the core of Section 17 items 16, 25 and 26 of the master prompt.

**Independent Test**: Store balance 0. Issue invoices of 20,000, then record a cash payment of 15,000: balance 5,000, the invoice shows "Partially paid" (15,000 of 20,000). Issue a second invoice of 8,000: balance 13,000. Record a payment of 10,000: balance 3,000, the first invoice is "Paid", the second "Partially paid" (5,000 of 8,000 outstanding, oldest first). Record 5,000 when the balance is 3,000: balance is an advance of 2,000; issue the next invoice of 1,500: balance becomes an advance of 500 and the invoice is "Paid". Save the same payment ten times at the same time: one payment. A payment for store A never changes store B.

**Acceptance Scenarios**:

1. **Given** a store with a balance of 20,000 from one invoice, **When** the supplier records a cash payment of 15,000, **Then** one payment entry (credit 15,000) is added, the balance is 5,000, and the invoice shows "Partially paid".
2. **Given** the Record payment screen, **When** the supplier types an amount, **Then** the screen shows the balance after the payment and a list of which items the payment will settle, oldest first, before anything is saved.
3. **Given** balance 3,000, **When** the supplier records 5,000, **Then** the payment is accepted, the balance shows as an advance of 2,000 ("the store has paid in advance"), and nothing is lost.
4. **Given** an advance of 2,000, **When** an invoice of 1,500 is issued, **Then** the advance is applied automatically, the invoice shows "Paid", and the account shows an advance of 500.
5. **Given** several unpaid items, **When** a payment is recorded, **Then** it is allocated to the oldest first (the opening balance, then invoices by issue date), and each invoice's unpaid, partially paid or paid status is worked out from the ledger and never stored or edited.
6. **Given** the payment save is repeated (double tap, refresh, slow network, simultaneous requests), **When** it reaches the server several times, **Then** exactly one payment exists and the balance fell once; the same key with different content is refused.
7. **Given** a payment was recorded on the wrong store or with a wrong amount, **When** the supplier reverses it with a reason, **Then** a reversal entry is added, the balance and the paid statuses return to what they were, and the original entry stays visible as reversed.
8. **Given** two stores, **When** a payment is recorded for one, **Then** no invoice, balance or status of the other store changes.
9. **Given** the amount is zero, negative, has more than two decimals or is too large, or the date is in the future, **When** the supplier tries to save, **Then** it is refused with a clear message and nothing is recorded.

---

### User Story 4 - Take payment at delivery while issuing the invoice (Priority: P2)

At the store's door the supplier issues the invoice and gets paid at the same time. The issue screen has an optional "Payment received now" amount. When it is filled, issuing the invoice, taking its number, adding the invoice entry and recording the payment happen together, or not at all. If anything fails, no invoice number is used, no invoice entry is added and no payment is recorded.

**Why this priority**: It saves a step on the most common delivery. It builds on stories 2 and 3 and is not needed for them to work.

**Independent Test**: Issue an invoice of 8,000 with "Payment received now" 3,000 for a store with balance 5,000: the invoice is issued, the account has an invoice entry and a payment entry linked to it, the balance is 10,000. Force a refusal (for example, a line without a verified price or an invalid amount): no number used, no entry, no payment. Repeat the same issue request ten times: one invoice, one payment.

**Acceptance Scenarios**:

1. **Given** a ready draft, **When** the supplier issues it with "Payment received now" of 3,000, **Then** the invoice is issued, one invoice entry and one payment entry linked to the invoice are added, and the Account Summary snapshot shows the payment.
2. **Given** the amount is larger than the invoice total, **When** the supplier issues it, **Then** it is accepted and the excess is kept as an advance; the screen shows that before confirming.
3. **Given** the amount is invalid (zero, negative, more than two decimals, too large), **When** the supplier taps Issue, **Then** the issue is refused with the reason and no invoice number is used.
4. **Given** the issue fails or is refused for any reason, **When** the supplier checks the account, **Then** there is no invoice entry, no payment and no used number.
5. **Given** the same issue request is repeated after success, **When** it reaches the server again, **Then** it returns the already issued invoice and no second payment is recorded; a repeat with a different payment amount does not record a payment either.
6. **Given** no amount is entered, **When** the invoice is issued, **Then** it behaves exactly as in Module 006 plus the invoice entry.

---

### User Story 5 - Show the Account Summary on the invoice (Priority: P2)

The supplier wants the store to see its running balance on the printed invoice. Below the Grand Total, an optional "Account Summary" block shows: Balance as on <date>, Previous Balance, This Invoice, Payment Received (when a payment was recorded at issue) and Balance Due. It appears only when the "Show Account Summary" box on the print screen is ticked, and the box starts as the Settings default (off unless the supplier turned it on). The figures were saved when the invoice was issued, so reprinting on any later day shows the same numbers, whatever payments were recorded since.

**Why this priority**: It is a customer-facing convenience that depends on the account (stories 1 to 3) and on issuing with a payment (story 4).

**Independent Test**: Store balance 5,000; issue an invoice of 8,000 with 3,000 received: summary shows Previous 5,000, This Invoice 8,000, Payment Received 3,000, Balance Due 10,000. Record a payment of 4,000 the next day and reprint: the summary is identical. Print with the box off: no summary. Print on A4 and thermal: same numbers. An invoice issued before this module: the box is unavailable with a clear note.

**Acceptance Scenarios**:

1. **Given** an issued invoice in the account, **When** the supplier ticks "Show Account Summary" on the print screen, **Then** the block shows Balance as on the issue date, Previous Balance, This Invoice, Payment Received (only when there was one) and Balance Due, where Balance Due = Previous Balance + This Invoice - Payment Received.
2. **Given** the Settings default is off, **When** the print screen opens, **Then** the box is unticked; if the default is on, it is ticked; the supplier can change it for this print only.
3. **Given** payments, adjustments or opening balances were added after the invoice was issued, **When** the invoice is reprinted, **Then** the Account Summary shows exactly the numbers saved at issue.
4. **Given** the box is unticked, **When** the invoice is printed, **Then** no Account Summary is shown, in both layouts.
5. **Given** an invoice issued before this module, **When** the supplier opens its print screen, **Then** no Account Summary can be shown and the screen says it was not saved for this invoice.
6. **Given** the Account Summary is shown, **When** the page is checked, **Then** it contains no purchase price, cost, MRP, margin or profit, and the saved figures cannot be edited by any screen.
7. **Given** a store whose Previous Balance is an advance (the store had paid in advance), **When** the summary is shown, **Then** the advance is shown as a credit and Balance Due is calculated correctly (it can be smaller than the invoice total or zero).

---

### User Story 6 - Write off or add a small amount, and correct mistakes (Priority: P2)

A store owes 4,950 and the supplier decides to forgive 50. On the store account the supplier taps "Add adjustment", enters the amount, chooses "reduce what the store owes" or "increase what the store owes" and must write the reason. The adjustment is one more entry; it cannot be edited or deleted. A wrong adjustment is corrected by reversing it with a reason and adding the right one.

**Why this priority**: The owner asked for it, but the account works without it, so it follows the core stories.

**Independent Test**: Balance 4,950; add an adjustment "reduce" 50 with reason "Small amount forgiven": balance 4,900 and an adjustment entry showing the reason. Try without a reason: refused. Reverse it with a reason: balance 4,950, both entries visible. Save the adjustment twice: one entry.

**Acceptance Scenarios**:

1. **Given** a store account, **When** the supplier adds an adjustment that reduces what the store owes, with an amount and a reason, **Then** one entry (credit) is added with the reason shown in the history and the balance falls by the amount.
2. **Given** a store account, **When** the supplier adds an adjustment that increases what the store owes, **Then** one entry (debit) is added with its reason.
3. **Given** the reason is empty or longer than 500 characters, or the amount is zero, negative, has more than two decimals or is too large, **When** the supplier saves, **Then** it is refused and nothing is recorded.
4. **Given** an adjustment, a payment or an opening balance was recorded by mistake, **When** the supplier reverses it with a reason, **Then** a reversal entry is added and the original stays visible as reversed; a reversed entry cannot be reversed again, and a reversal entry cannot be reversed.
5. **Given** an invoice entry, **When** the supplier looks for a way to reverse it by hand, **Then** there is none; an invoice entry is reversed only by cancelling the invoice.
6. **Given** the adjustment save is repeated, **When** it reaches the server several times, **Then** exactly one entry exists.

---

### User Story 7 - Print a store statement and see who owes what (Priority: P3)

The supplier chooses a store and a date range and opens the **Store Statement**: the opening balance of the range, every entry in it (invoices, payments, adjustments, reversals) with its running balance, and the closing balance. It prints on A4 (and can be saved as a PDF by the browser). A **Store accounts** list shows every store with its balance, and Home shows the total the stores owe the supplier with a link to that list.

**Why this priority**: The statement is a separate document the supplier may hand to a store, and the list answers "who owes me?". Both only read data created by the earlier stories.

**Independent Test**: For a store with an opening balance, two invoices, a payment, an adjustment and a cancelled invoice, open the statement for a range: the opening figure of the range plus the debits minus the credits equals the closing figure, and each entry line is listed. Print it: it contains no cost, MRP or profit. The stores list shows every store with its balance; the Home total equals the sum of the positive balances in the list.

**Acceptance Scenarios**:

1. **Given** a store with entries before and inside a date range, **When** the supplier opens the statement for the range, **Then** it shows the balance at the start of the range, each entry in the range in date order with debit, credit and running balance, and the closing balance, where opening + debits - credits = closing.
2. **Given** a statement, **When** it is printed or saved as PDF through the browser, **Then** it uses an A4 layout with the business header and the store name, and it never shows purchase price, cost, MRP, margin or profit.
3. **Given** a range with no entries, **When** the statement is opened, **Then** it shows the opening and closing balance as equal and says there were no entries.
4. **Given** several stores, **When** the supplier opens the store accounts list, **Then** each store is shown with its balance (owes, advance or zero), the stores with a balance owed are easy to find, and a store with no entries is shown with 0.
5. **Given** stores that owe and stores with an advance, **When** Home shows the total, **Then** the total is the sum of the amounts stores owe; advances are not subtracted from it and are shown separately; the Home number equals the sum shown in the list.
6. **Given** the invoices list, **When** the supplier filters by "Unpaid", "Partially paid" or "Paid", **Then** only matching issued invoices in the account are listed; invoices not in the account and cancelled invoices are never marked paid.

---

### Edge Cases

- A payment is dated in the past: it is accepted (not before 1 January 2000), appears in date order on the statement, and does not change any saved Account Summary. A payment dated in the future (Pakistan time) is refused.
- An opening balance is entered after invoices already exist: the statement and the running balance show it in date order; the saved summaries of invoices issued earlier are unchanged, so a statement can legitimately show a different running balance than an old printed summary. The statement notes that summaries show the balance at the moment of issue.
- A payment larger than the whole balance leaves an advance; the advance is applied automatically to later invoices because status is worked out from all entries, so no extra action is needed.
- The oldest unpaid item is worked out over the items still counted: an entry that has been reversed (and its reversal) is ignored, so a cancelled invoice never absorbs payments.
- A cancelled invoice whose payment was recorded with it: the payment remains and becomes an advance (credit) unless the supplier reverses the payment separately with a reason.
- Cancelling an invoice issued before this module adds no entry and changes no balance.
- A reversal of a reversal, a second reversal of the same entry, and a reversal of an entry from another store are all refused.
- A store with entries cannot lose them: stores are not deleted by this module; an archived store keeps its account visible.
- Very long accounts (for example 2,000 entries for one store): the account screen pages the entries, the balance is still exact, and the statement for a range remains complete and prints without cutting a line.
- The same payment key with different content (amount, date, store) is refused as a reused key and nothing is recorded.
- A store's details or name change later: old statements and saved invoice summaries are not rewritten; the statement shows the current name for the account, and each invoice keeps its own saved details.
- Money is shown in PKR with two decimals; amounts are validated; no negative amounts are accepted (direction is a separate choice).
- Without a connection nothing here works: saves show a clear error, the form is kept, and the app never says "saved on this device" or "pending sync" (offline is Module 009).

## Requirements *(mandatory)*

### Functional Requirements

**Store ledger (khata)**

- **FR-001**: Every store MUST have one account per business, made only of entries. The balance MUST always be worked out from the entries (sum of debits minus credits) and MUST NEVER be stored or typed as an editable number.
- **FR-002**: Entry types MUST be opening balance, invoice, payment, adjustment and reversal. A debit (the store owes more) is an issued invoice, an opening balance where the store owes, or an adjustment that increases the debt; a credit (the store owes less) is a payment, an opening balance where the store paid in advance, or an adjustment that reduces the debt. A reversal takes the opposite side of the entry it reverses.
- **FR-003**: Every entry MUST record the business, the store, the entry date, its type, the debit or credit amount, the related invoice or payment where it has one, a note or reason, who created it, when, and a client-supplied key that makes the save retry-safe.
- **FR-004**: Entries MUST NEVER be edited or deleted by any screen, request or other module. A mistake MUST be corrected by a reversal entry with a required reason plus, if needed, a new correct entry. A reversed entry stays visible and marked as reversed; an entry can be reversed once and a reversal cannot be reversed.
- **FR-005**: Only issued invoices MUST create entries; drafts MUST NEVER. Issuing MUST add the invoice entry in the same operation as the issue; cancelling an issued invoice that is in the account MUST add its reversal in the same operation as the cancellation.
- **FR-006**: The khata MUST start empty. Invoices issued before this module MUST NOT be put into any account; they MUST be shown as "Not in the account", MUST show no paid status and no Account Summary, and cancelling one MUST add no entry.
- **FR-007**: Money MUST be exact (PKR, two decimals), summed by the system, and never calculated with rounding errors in the screen.

**Opening balance and adjustment**

- **FR-008**: The supplier MUST be able to add an opening balance for a store on any day: amount above zero, direction (the store owes, or the store paid in advance), an "as on" date that is not in the future, and an optional note. Several opening balances for the same store MUST be allowed, each its own entry. The form MUST warn that invoices issued before this module are not in the account and must not be counted twice.
- **FR-009**: The supplier MUST be able to add an adjustment that reduces or increases what a store owes: amount above zero, direction and a required reason of 1 to 500 characters. An adjustment MUST be one append-only entry shown with its reason in the history.
- **FR-010**: Adding an opening balance or an adjustment MUST be retry-safe: repeating the request (double tap, refresh, slow network, simultaneous requests) MUST record exactly one entry; the same key with different content MUST be refused.

**Payments and allocation**

- **FR-011**: The supplier MUST be able to record a cash payment for a store: amount above zero, a date (not in the future and not before 2000-01-01) and an optional reference. The payment MUST keep a payment method value so that bank transfer and mobile wallet can be added later, but only cash is offered now.
- **FR-012**: A payment MUST belong to the store account, never to a single invoice and never to another store. Recording a payment for one store MUST NOT change the balance, status or entries of any other store.
- **FR-013**: Allocation MUST be worked out, never stored: payments and credits are applied to the oldest unpaid item first: opening balances first (by their date), then invoices and increasing adjustments by their date (an invoice by its issue date), ties by the order they were recorded, ignoring reversed entries. An opening balance is settled before invoices even when its "as on" date is later, because the supplier may not know the real date of an old balance. Each issued invoice in the account MUST show a status of unpaid, partially paid or paid derived from this, and cancelled invoices MUST show no paid status.
- **FR-014**: When credits exceed all debits, the excess MUST be kept as an advance and shown as such; it MUST be applied automatically against later invoices without any extra action and MUST NEVER be lost.
- **FR-015**: The Record payment screen MUST show, before saving, the balance after the payment and which items the payment will settle (oldest first).
- **FR-016**: Recording a payment MUST be retry-safe with a client-created key: repeating the request, including ten simultaneous identical requests, MUST record exactly one payment; the same key with different content MUST be refused.
- **FR-017**: A payment MUST be correctable only by a reversal with a required reason (1 to 500 characters), never by editing or deleting it.

**Payment received at issue**

- **FR-018**: The issue screen MUST offer an optional "Payment received now" amount. When filled, issuing the invoice, taking its number, adding the invoice entry, recording the payment linked to the invoice and saving the Account Summary snapshot MUST happen in one atomic operation, all together or not at all.
- **FR-019**: A refused or failed issue MUST leave no used invoice number, no invoice entry and no payment. Repeating an issue request after success MUST return the issued invoice and MUST NOT record a second payment, whatever amount the repeat carries.
- **FR-020**: A payment received now larger than the invoice total MUST be accepted and kept as an advance, and the screen MUST show this before the supplier confirms.
- **FR-021**: Cancelling an invoice MUST reverse only the invoice entry; a payment recorded with it MUST stay on the account, and the cancel screen MUST say so before confirming.

**Account Summary**

- **FR-022**: When an invoice is issued, the system MUST always save an Account Summary snapshot with it: the balance as on the issue date, the previous balance (the store's balance immediately before this invoice entry), this invoice's grand total, the payment received at issue (or none) and the balance due, where balance due = previous balance + this invoice - payment received. Previous balance and balance due MUST support an advance (a credit).
- **FR-023**: The snapshot MUST be as unchangeable as the rest of the issued invoice: no screen or request MUST be able to edit it, and later payments, adjustments, opening balances or reversals MUST NOT change it.
- **FR-024**: The invoice print screen MUST offer a "Show Account Summary" box whose starting value is the existing Settings default (off unless the supplier turned it on); the choice MUST affect only that print, in both A4 and thermal layouts. The block MUST show only: Balance as on <date>, Previous Balance, This Invoice, Payment Received (when there was one) and Balance Due.
- **FR-025**: For an invoice that has no saved snapshot (issued before this module, or a draft), and for a cancelled invoice (its print is marked CANCELLED, and a void invoice must not show a balance due), the Account Summary MUST NOT be shown or invented, and the screen MUST explain why. A cancelled invoice that was in the account keeps its saved figures in the data, unchanged.

**Screens, statement and visibility**

- **FR-026**: A Store account screen MUST show the store's balance (owes, advance or zero), the actions Record payment, Add opening balance and Add adjustment, and the entries newest first or in date order with a running balance, with reversed entries marked, plus loading, error (with Retry) and empty states with the next action.
- **FR-027**: A Store accounts list MUST show every store with its balance, with the stores that owe money easy to find, a search by store name, and loading, error and empty states. Home MUST show the total stores owe (the sum of the positive balances, advances not subtracted) with a link to the list; the total and the list MUST use one shared definition so they can never disagree.
- **FR-028**: A Store Statement MUST be available for one store and a date range: the balance at the start of the range, every entry in the range in date order with debit, credit and running balance, and the closing balance. It MUST be a separate A4 document (the browser's print and save as PDF are the only outputs) with the business header and store name, and no cost, MRP or profit.
- **FR-029**: The invoices list and the invoice screen MUST show the derived paid status of issued invoices in the account, with a filter for unpaid, partially paid and paid; invoices not in the account MUST be marked as such.
- **FR-030**: The Account Summary, the Store account screen, the stores list and the Store Statement MUST NEVER show or return a purchase price, cost, MRP, margin or profit.

**Isolation, safety and history**

- **FR-031**: Every new table and operation MUST be isolated by business: a user MUST NOT see, add, reverse or print another business's entries, payments, accounts or statements, and a refusal MUST look the same as a missing record.
- **FR-032**: These rules MUST be enforced on the server side for every request, not by the screens alone, and MUST hold for any future code path.
- **FR-033**: Every entry MUST record who created it and when, and every reversal MUST record its reason, so the account can be audited from its entries alone.
- **FR-034**: Every new screen MUST work at 360 px width without sideways scrolling, with touch targets of at least 44 px and large, clear amounts.

**Changes to existing behaviour (Module 006), listed explicitly**

- **FR-035**: Issuing an invoice (Module 006) gains: the optional payment, the invoice entry, and the Account Summary snapshot, all inside the same atomic operation, with the same request-id replay behaviour as before.
- **FR-036**: Cancelling an issued invoice gains the reversal entry for invoices that are in the account, inside the same atomic operation, with the same first-reason, replay-safe behaviour as before.
- **FR-037**: The immutability of an issued invoice stays: the only new facts an issued invoice carries are its Account Summary snapshot and whether it is in the account, both set once at issue and never changed afterwards. Drafts, numbers, lines, totals and the order status rules of Module 006 are otherwise unchanged.

### Key Entities *(include if feature involves data)*

- **Store account (khata)**: The running account of one store in one business. It has no stored balance; the balance and the statuses are always worked out from its entries.
- **Ledger entry**: One append-only line on a store account: type (opening balance, invoice, payment, adjustment, reversal), entry date, debit or credit amount, the invoice or payment it relates to, a note or reason, who created it and when, a client key, and, for a reversal, the entry it reverses. Never edited or deleted.
- **Payment**: Money received from a store: amount, date, method (cash now), optional reference, and optionally the invoice it was received with. It belongs to the store account; its ledger entry is the credit.
- **Opening balance / Adjustment**: Entries that set a starting figure for a store or correct it by a small amount with a reason; each is its own entry with direction, date and (for adjustments) a required reason.
- **Reversal**: An entry that cancels exactly one earlier entry with a required reason; both stay visible.
- **Account Summary snapshot**: The five figures saved with an issued invoice at issue (balance as on date, previous balance, this invoice, payment received, balance due); immutable.
- **Derived status**: Unpaid, partially paid or paid for each issued invoice, worked out from the entries; never stored.
- **Store statement**: A printable view of one store's entries for a date range with opening and closing balances; not a stored record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every store in the tests, the displayed balance equals the sum of its entries (debits minus credits), checked after every operation of a test run with at least 30 mixed entries (verified for every store tested).
- **SC-002**: The carry-forward example works exactly: 20,000 of goods and a 15,000 payment give 5,000; an 8,000 delivery gives 13,000; a 10,000 payment gives 3,000 (verified by test).
- **SC-003**: A payment is allocated to the oldest unpaid item first in 100% of tested cases (opening balance, then invoices by issue date), and each invoice status is unpaid, partially paid or paid exactly as the entries imply, including after a reversal and after an advance.
- **SC-004**: Repeating a payment, opening balance, adjustment, issue-with-payment or cancel request 10 times, including at the same time, always produces exactly one entry set (one payment, one opening balance, one adjustment, one invoice entry with at most one payment, one reversal) (verified against the real database).
- **SC-005**: Across all tests, 0 payments or entries of one store change the balance, entries or status of another store.
- **SC-006**: No test path can edit or delete an entry: every attempted update or delete, from every kind of request, is refused and the entry is unchanged (verified directly on the database and through the API).
- **SC-007**: Cancelling an issued invoice that is in the account adds exactly one reversal and the balance returns to its earlier value; cancelling an invoice that is not in the account adds nothing (verified by test).
- **SC-008**: Issue with payment is all or nothing: in every forced failure or refusal there is no used invoice number, no invoice entry and no payment; in every success there is exactly one of each (verified with forced refusals and with 10 simultaneous requests).
- **SC-009**: The saved Account Summary of an invoice is identical on every reprint, in A4 and thermal, with the box on and off, and unchanged after later payments, adjustments, opening balances and reversals (verified by comparing the data and the printed text before and after).
- **SC-010**: In every Account Summary, Store account screen, stores list and statement, 0 occurrences of purchase price, cost, MRP, margin or profit (verified by key checks on returned data and text checks on rendered pages).
- **SC-011**: A second business's user can see, add, reverse or print 0 of the first business's entries, accounts and statements, using crafted ids (verified with two real users).
- **SC-012**: A store account with 2,000 entries opens (balance and the first page of entries) in at most 3 seconds; the stores list for 100 stores with balances opens in at most 3 seconds; recording a payment takes at most 2 seconds.
- **SC-013**: The Home total owed equals the sum of the positive balances in the stores list, and the statement of any range satisfies opening + debits - credits = closing, in all tested cases.
- **SC-014**: At 360 px width, the new screens have no sideways scrolling and all controls are at least 44 px (verified by the existing touch-target check); a statement of 200 lines prints on A4 without cutting a line and always shows the closing balance.
- **SC-015**: A supplier can record a payment received from a store in at most 4 taps from the Home screen, and can see afterwards which invoices it settled.

## Assumptions

The first three were decided by the owner in chat on 2026-11-16 (translated from Roman Urdu) after the assistant explained each with an example; the rest were decided from the master prompt, the constitution and the merged modules.

1. **The khata starts empty.** Invoices already issued in Module 006 are not put into any account; the supplier enters an opening balance per store themselves. (The assistant had recommended copying the old invoices in automatically; the owner chose to start empty.) Consequence: those old invoices show "Not in the account", have no paid status and no Account Summary, and the supplier must not count them again in the opening balance (the form warns about this).
2. **Adjustments are included** (write off or add a small amount, with a required reason).
3. **An opening balance can be entered on any day**, not only before a store's first entry. Each one is its own append-only entry with an "as on" date and is reversed, never edited. Later entries never change a saved Account Summary.
4. Cash is the only payment method offered now; a method field is kept so bank transfer and mobile wallet can be added later without changing existing entries.
5. The Account Summary snapshot is always saved at issue (for invoices issued from this module onward); the print screen only decides whether it is shown. This lets the supplier turn it on for a reprint without changing any number.
6. "Previous Balance" is the store's balance after all entries recorded up to the moment before the invoice entry was added (by the order the entries were recorded), so entries dated or added later never change it.
7. The statement lists entries by entry date, then by the order they were recorded; its running balances may therefore differ from an older printed Account Summary when an entry was added later with an earlier date. The statement says that summaries show the balance at the moment of issue.
8. Statuses (unpaid, partially paid, paid) are worked out from all non-reversed entries by the allocation rule (opening balances first, then the rest by date; see FR-013); they are never stored, so a reversal or a later payment changes them correctly.
9. The Home total counts only the amounts stores owe; advances are shown separately and are not subtracted.
10. A cancelled invoice keeps its number, its invoice entry and its reversal entry visible on the account; a payment recorded together with it stays on the account as an advance unless the supplier reverses it separately.
11. Stores are never deleted by this module; the account of an archived store stays visible.
12. Offline payments, a "pending sync" balance, voice, reports and profit, bank or wallet processing, multi-user roles, discounts, taxes, returns, interest, credit limits, reminders and server-side PDF files are out of scope and are not claimed. Without a connection, saves fail with a clear message and the form is kept (offline is Module 009).
13. The statement and the Account Summary show the reason of adjustments and reversals (the store sees why an amount changed); the supplier sees it on the entry form before saving, so no internal note should be typed there.
14. The master prompt (the store ledger section, the Account Summary section, Section 17 items 16 and 25 to 29) and the project constitution (Principle III, the append-only ledger) are the source of the rules above; where this spec is stricter, this spec applies.
