# Feature Specification: Pending Products (Quick Register, Linking, Pending Prices)

**Feature Branch**: `004-pending-products`  
**Created**: 2026-11-10  
**Status**: Draft  
**Input**: User description: "Module 004 Pending products: Quick Register, linking pending order lines, and Pending Prices (builds on Module 001 products/stores, Module 002 import and Module 003 manual orders, whose code is on branch 003-manual-orders, PR #2 not yet merged). Scope only: (1) Quick Register from an order line that is a typed, not registered medicine: only name and unit required, everything else optional and never invented, duplicate check before creating (exact duplicate blocked and offered as 'use the existing medicine', similar name with a different strength, form or pack size is a warning needing explicit confirmation and never auto-merged), creating the medicine and linking the line is one atomic, retry-safe operation, the order and its other lines are never lost and the typed name is kept. (2) Link a pending line to an existing catalog medicine the supplier picks, never auto-merging different strengths, dosage forms or pack sizes. (3) After a medicine is registered, propose linking the other pending lines (any store, draft or confirmed orders) whose typed name matches, each confirmed individually, nothing linked automatically, visibly different strength/form/pack lines not proposed. (4) A Pending Prices screen listing every active medicine without a selling price and every confirmed order line with no selling price snapshot, grouped by medicine; the supplier enters a PKR price once, reviews the exact lines that would get it, and confirms; only lines with no price snapshot are filled, lines that already carry a snapshot are never changed, each fill is recorded in the order change history, a retry never double-applies; linking a typed line to a medicine that has a selling price fills that line's price only after the supplier confirms. Purchase price and MRP are never shown on order or pricing screens beyond the registration form. (5) Pending items stay visible: a count and link on Home and on order screens, empty states with the next action, mobile-first, large touch targets, loading and error states. Out of scope: market list and purchases (Module 005), invoices and the invoice-issue block (Module 006), ledger and payments, voice and Gemini, offline sync, reports, multi-user roles, editing a confirmed order's quantities. Follow docs/master-prompt.txt (sections 7A, 8, 16 item 13, 17 items 7, 22 and 24), docs/negative-prompt.txt and constitution principles I-VIII."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register a typed medicine from the order line (Priority: P1)

A store asked for "Noran 20mg cap" and the supplier typed it as a not registered line while taking the order. Later, with the order still open or already confirmed, the supplier taps "Register this medicine" on that line. A short form opens with the typed text and unit already filled in as suggestions. The supplier confirms or corrects the name and unit, optionally adds strength, dosage form, manufacturer, pack size and prices, and saves. The medicine now exists in the catalog and the line is linked to it. The order, its quantities and every other line are exactly as they were.

**Why this priority**: This is how the catalog grows from real orders (master prompt 7A and 8). Without it, every typed line stays "Not registered" forever and nothing after Module 004 (market list grouping, invoices) can treat that medicine properly.

**Independent Test**: Take an order with one typed line "Noran 20mg cap" (quantity 3 strip) and one catalog line, confirm it, register the typed line with only a name and a unit, and check that the medicine is in the catalog and searchable, the line is linked to it, the quantity, unit and typed text are unchanged, the other line is untouched, and the order has the same number of lines.

**Acceptance Scenarios**:

1. **Given** an order (draft or confirmed) with a typed line, **When** the supplier opens that line, **Then** a "Register this medicine" action is offered; lines already linked to a catalog medicine do not offer it.
2. **Given** the Register form, **When** it opens, **Then** the name field holds the typed text and the unit holds the line's unit as editable suggestions; strength, dosage form, manufacturer, pack size, SKU and the three prices are empty and are never filled in from the typed text.
3. **Given** the form with only a name and a unit, **When** the supplier saves, **Then** the medicine is created with those two values (other fields empty, no default prices) and the line is linked to it in one step.
4. **Given** the form, **When** the name or the unit is empty, a price is negative or not a number, or a text is too long, **Then** saving is refused with a message on that field, and nothing is created.
5. **Given** a medicine that is the same as an existing one (same name, strength, dosage form, pack size and manufacturer, ignoring case and spacing), **When** the supplier saves, **Then** nothing is created, the existing medicine is shown, and the supplier is offered "Use the existing medicine" (Story 2).
6. **Given** an existing medicine with the same name but a different strength, dosage form or pack size, **When** the supplier saves, **Then** a warning lists the existing medicines with their details and creating the new one requires an explicit confirmation ("Create as a separate medicine"); the two are never merged.
7. **Given** a SKU that is already used by another medicine, **When** the supplier saves, **Then** saving is refused with a message on the SKU field.
8. **Given** a save that is repeated (double tap, refresh, lost response, two tabs), **When** it is repeated up to 10 times, including at the same moment, **Then** exactly one medicine exists, the line is linked once, and the repeat shows the same result.
9. **Given** the register step fails halfway (network loss, error), **When** the supplier looks at the order, **Then** the order is exactly as before or exactly as intended (medicine created and line linked), never a created medicine with an unlinked line or the reverse.
10. **Given** a registered line, **When** the supplier opens the order, **Then** the line shows the registered medicine's details and still shows the text as typed originally (for example "As typed: Noran 20mg cap"), and the order change history records the link.
11. **Given** a confirmed order, **When** the typed line is registered and the new medicine has a selling price, **Then** the supplier is shown that price and asked to confirm using it for this line; only on confirmation does the line get that price (Story 4 rule); declining leaves the line without a price, and it appears in Pending Prices.
12. **Given** the Register form was opened from a draft that the supplier is still editing, **When** the line is registered, **Then** the draft keeps working (no lost typed data), and a second tab with the same draft is told the order changed elsewhere instead of overwriting it.

---

### User Story 2 - Link a typed line to an existing medicine (Priority: P1)

The typed name turns out to be a medicine that is already in the catalog (for example, the supplier typed it in a hurry, or imported the catalog later). The supplier taps "This is an existing medicine", searches the catalog, picks the right one, sees both side by side, and confirms. The line is linked. No new medicine is created.

**Why this priority**: Registering a duplicate would pollute the catalog; picking the existing medicine is the safe path and is needed by Story 1 (exact duplicate) and by the Module 002 import.

**Independent Test**: Import or add "Panadol 500mg Tablet", take an order with a typed line "panadol 500", link it to the catalog medicine by picking it, and check the line shows the catalog medicine with the typed text kept, the quantity unchanged, and the link recorded in the history. Then try a medicine with a different strength: it is offered only as a different, separately picked medicine, never merged automatically.

**Acceptance Scenarios**:

1. **Given** a typed line, **When** the supplier chooses "This is an existing medicine", **Then** a search of the catalog opens (same search as the order screen) and the supplier must pick one result; nothing is linked until they confirm.
2. **Given** a picked medicine, **When** the confirm step opens, **Then** it shows the typed text and the picked medicine's name, strength, dosage form, pack size and manufacturer next to each other, so that a difference is visible before confirming.
3. **Given** the supplier confirms, **When** the link is saved, **Then** the line is linked to that medicine, the typed text and the quantity and unit are kept, the link is recorded in the order change history (when, who, typed text, medicine), and the order is otherwise unchanged.
4. **Given** the picked medicine has a different strength, dosage form or pack size from what the typed text shows, **When** the supplier confirms, **Then** the link is still allowed only because the supplier chose it explicitly, and is never done automatically or in bulk.
5. **Given** a retry of the same link (double tap, lost response), **When** it is repeated, **Then** the line is linked once and one history entry exists.
6. **Given** an inactive medicine, **When** the supplier searches, **Then** it is not offered for linking (same rule as adding to an order).
7. **Given** a line that is already linked, **When** the supplier opens it, **Then** no link action is offered (undoing a link is not part of this module).

---

### User Story 3 - Propose linking the same typed medicine in other orders (Priority: P2)

After the medicine "Noran 20mg Capsule" is registered (or a line is linked to it), other orders in other stores may still hold a typed line with the same name. The supplier is shown those lines, one by one, with their store, order number, typed text and quantity, and decides for each whether it is the same medicine. Only the lines the supplier confirms are linked. Lines that visibly look like a different strength, dosage form or pack size are not proposed.

**Why this priority**: Without it the supplier would have to open every order to link the same medicine again. But it must stay a proposal: automatic merging of look-alike medicines is exactly the mistake the product rules forbid.

**Independent Test**: Create typed lines "Noran 20mg cap" in orders for three stores (one draft, two confirmed) and "Noran 40mg cap" in a fourth; register Noran 20mg from the first; confirm the proposals for two of the three; check that exactly those two are linked, the third is still pending, and the 40 mg line was not proposed.

**Acceptance Scenarios**:

1. **Given** a medicine was just registered or linked, **When** other pending lines with a matching typed name exist in orders that are not cancelled (any store, draft or confirmed), **Then** a "Link these too?" list appears with, for each line, its store, order number, typed text, quantity and unit, and a separate confirm for each.
2. **Given** the list, **When** the supplier ignores it or closes it, **Then** nothing is linked; the proposals can be opened again later from the medicine's own page ("Lines waiting for this medicine"), and the remaining typed lines stay on the "To register" tab of the Pending screen where each can still be linked by hand (nothing is lost).
3. **Given** a candidate whose typed text shows a different strength, dosage form or pack size than the medicine, **When** the list is built, **Then** that line is not proposed as a match; it is shown in a separate "Looks different, not proposed" group so the supplier can still pick it manually (Story 2).
4. **Given** a candidate with an ambiguous text (it could be one of several medicines), **When** the list is built, **Then** it is not proposed automatically; the supplier links it by hand if they wish.
5. **Given** the supplier confirms one candidate, **When** it is saved, **Then** only that line changes (link and history entry); the other candidates and the other lines of the same order are untouched, and no line moves between stores or orders.
6. **Given** a candidate in a draft that is open in another tab, **When** it is linked, **Then** the other tab is told the order changed elsewhere and does not overwrite the link.
7. **Given** candidates in cancelled orders, **Then** they are neither proposed nor changed.

---

### User Story 4 - Pending Prices: set a price once, fill the lines after review (Priority: P2)

Some medicines have no selling price: registered with a name and unit only, or imported without one. Confirmed orders may contain lines for them without a price. The supplier opens "Pending Prices" and sees every active medicine without a selling price, with how many confirmed order lines and orders are waiting for it, and every typed line that still needs registering. The supplier enters the selling price once for a medicine, sees the exact list of order lines that would receive it, and confirms. Only lines that have no price get it. Lines that already carry a price are never touched.

**Why this priority**: A medicine without a selling price cannot be invoiced (Module 006). This screen is the single place that makes lines ready for invoicing, and it must be safe: the price comes from the supplier, and recorded prices are never silently rewritten.

**Independent Test**: Register a medicine with no price, put it on two confirmed orders (one before and one after a price existed, so one line has a price and one does not). Open Pending Prices: the medicine is listed with 1 line in 1 order. Enter 125.50, review, confirm: the unpriced line gets 125.50, the other line keeps its original price, the history shows the fill, and repeating the confirm changes nothing.

**Acceptance Scenarios**:

1. **Given** medicines without a selling price and confirmed order lines without a price, **When** the supplier opens Pending Prices (the "Need a price" tab of the Pending screen), **Then** it lists each active medicine without a selling price, and each medicine that has a price but still has confirmed lines waiting, with the number of affected confirmed order lines and orders; the other tab of the same Pending screen, "To register", lists the typed lines that still need registering (grouped by their exact typed text, with the stores and quantities); and every item has a next action (Set price, or Register).
2. **Given** nothing is pending, **When** the supplier opens the screen, **Then** an empty state says nothing needs a price and offers a next action (for example "Take an order").
3. **Given** a medicine in the list, **When** the supplier enters a selling price, **Then** it must be a PKR amount greater than zero with at most two decimals (a price of 0 would make a line look priced and could be invoiced for nothing); anything else is refused with a message; the price is never pre-filled or guessed.
4. **Given** a valid price, **When** the supplier continues, **Then** a review step shows the exact order lines (store, order number, quantity, resulting line total) that would receive the price, the lines that will not be touched because they already carry a price (count), and offers two actions: "Save price and fill these lines" and "Save price only".
5. **Given** "Save price and fill these lines" is confirmed, **When** it is saved, **Then** the medicine's current selling price is set, every listed line without a price snapshot receives that price (and its line total), and every other line is unchanged, all in one all-or-nothing step.
6. **Given** a line that already has a price recorded (even a different one), **When** any price is entered, **Then** that line is never changed, never listed as a line to fill, and never recalculated.
7. **Given** a fill, **When** it is done, **Then** each filled line has a history entry on its order (when, who, previous price "none", new price, quantity), and the order's total is shown as before but now including the filled line.
8. **Given** the confirm is repeated 10 times (double tap, refresh, two tabs, simultaneous), **When** it completes, **Then** each line was filled exactly once with one history entry, and the screen shows the same result.
9. **Given** the list changed between review and confirm (a line was priced or an order cancelled elsewhere), **When** the supplier confirms, **Then** the supplier is told the list changed and must review again; the app never fills a line that was not on the reviewed list.
10. **Given** "Save price only", **When** it is saved, **Then** only the medicine's catalog price is set (drafts will show it as the current price), no confirmed line is changed, and those lines stay on the Pending Prices screen as "waiting for a price".
11. **Given** a typed line (not registered), **When** the supplier looks at it on the "To register" tab of the Pending screen, **Then** no price can be entered for it; it offers Register or "This is an existing medicine" first, because a price belongs to a registered medicine.
12. **Given** cancelled orders, **Then** their lines are not listed and never filled.
13. **Given** a medicine that already has a selling price but still has confirmed lines waiting (for example the supplier declined the price when linking, or used "Save price only"), **When** the supplier opens it in Pending Prices, **Then** its current price is shown read-only with no price field (changing an existing catalog price stays on the Products screen), and one action "Fill the waiting lines at PKR X" leads to the same review list and explicit confirmation as for a new price.
14. **Given** more than 1,000 confirmed lines wait for one medicine, **When** the supplier reviews the fill, **Then** the review covers the first 1,000 lines (oldest orders first) and says how many remain; confirming fills exactly those; the supplier repeats the step for the rest. Nothing beyond the reviewed list is ever filled.

---

### User Story 5 - Pending items stay visible and easy to reach (Priority: P2)

The supplier should never have to remember which orders contain medicines to register or price. Home shows a clear "Needs attention" count (medicines to register, medicines or lines waiting for a price) with a link to the list; the order screen marks each pending line and offers the action on the spot; every list in this module has an empty state with the next action.

**Why this priority**: Pending lines never block taking or confirming an order, so without clear visibility they would be forgotten and later block invoicing.

**Independent Test**: With one typed line and one unpriced medicine on a confirmed order, Home shows both counts with links; after registering and pricing them, the card shows nothing pending and says so.

**Acceptance Scenarios**:

1. **Given** pending items exist, **When** the supplier opens Home, **Then** a card shows how many typed lines are not registered and how many medicines are waiting for a price, each with a link to the matching list; when nothing is pending the card says so (or is not shown) and never shows a stale count.
2. **Given** an order screen (draft, confirmed), **When** it holds typed lines, **Then** each such line shows "Not registered" with the actions "Register this medicine" and "This is an existing medicine" within reach (44 px targets), and the order total note keeps saying how many lines have no price.
3. **Given** any new list screen in this module, **When** it is loading, fails, or has no items, **Then** it shows a loading indicator, an error with Retry, or an empty state with the next action, never a blank screen or a false "nothing pending" while loading or after an error.
4. **Given** a 360 px wide phone, **When** the supplier uses any new screen, **Then** all controls are reachable by visible navigation, are at least 44 × 44 px, and nothing scrolls sideways.
5. **Given** a count on Home, **When** the supplier follows its link, **Then** the list shows the same number of items as the count.

---

### Edge Cases

- **Registering while the order is being edited elsewhere**: the order's saved version changes; an open editor on the same order is told it changed elsewhere and keeps the supplier's typed data on screen instead of overwriting (same rule as Module 003).
- **Typed text with strength, form or pack inside it** (for example "Noran 20mg cap"): the app never splits it into strength or form by itself; the form shows it only as the suggested name, and the supplier types the details. Matching for proposals compares only what the typed text clearly shows, and treats anything unclear as "do not propose".
- **Same typed name, different strength in two orders** ("Noran 20mg", "Noran 40mg"): they are different pending items, proposed and linked separately; they are never grouped by similar text.
- **Medicine deactivated after registering**: existing linked lines stay; it cannot be newly linked or added; it is not listed for pricing.
- **Exact duplicate is an inactive medicine**: registering is blocked with a message that the medicine exists but is inactive and can be reactivated (same rule as Module 001).
- **A price entered with more than two decimals, a comma, a currency sign, or text**: refused with a message; never rounded silently.
- **Very large price or quantity totals**: a price above the allowed maximum is refused; line totals stay exact in PKR with two decimals.
- **A confirmed order edited (Module 003) while a Pending Prices review is open**: if the set of lines to fill changed, the confirm is refused and the review is redone.
- **Line removed from a confirmed order before it is linked or filled**: removed lines are never linked, proposed or filled.
- **Several typed lines with the same typed text in one order**: each is its own line; registering one offers to link the others in the same order through the proposals list, never automatically.
- **Session expired during register, link or fill**: the screen says to sign in again and keeps the entered data on screen; nothing is half applied.
- **Another business's data**: a medicine, order, line or store of another business can never be read, linked, proposed or changed, even with a crafted request.
- **Hard deletes**: nothing in this module deletes an order, a line, a medicine or a history entry.

## Requirements *(mandatory)*

### Functional Requirements

**Quick Register**

- **FR-001**: A typed (not registered) line on a draft or confirmed order MUST offer "Register this medicine"; a linked line and a line on a cancelled order MUST NOT.
- **FR-002**: The register form MUST require only a name and a unit; strength, dosage form, manufacturer, pack size, SKU, purchase price, selling price and MRP MUST be optional and MUST stay empty unless the supplier types them. The typed text and the line's unit MAY be shown as editable suggestions only.
- **FR-003**: The system MUST validate on the server (not only in the browser): required fields, text length limits (the same limits as Module 001), prices as non-negative PKR with at most two decimals, SKU uniqueness within the business.
- **FR-004**: Before creating a medicine the system MUST check for duplicates within the business, including inactive medicines. An exact duplicate (same name, strength, dosage form, pack size and manufacturer, ignoring case and spacing) MUST block creation and offer "Use the existing medicine". A medicine with the same name but a different strength, dosage form or pack size MUST show a warning and require explicit confirmation before a separate medicine is created. The system MUST NOT merge medicines automatically.
- **FR-005**: Creating the medicine and linking the line MUST be one all-or-nothing, retry-safe operation: repeating it, including simultaneously, creates one medicine and one link.
- **FR-006**: Registering MUST NOT remove, reorder, change or lose any line, quantity, unit, note or typed text of the order, and MUST keep the typed text on the line for history. The order MUST remain usable and saveable while registering.
- **FR-007**: A linked line MUST show the registered medicine's details (name, strength, dosage form, pack size, manufacturer) and MUST still show the text as originally typed.

**Linking to an existing medicine**

- **FR-008**: The supplier MUST be able to link a typed line to an existing active medicine of the business by picking it from the catalog search and confirming a side-by-side view of the typed text and the medicine's details. Nothing is linked before that confirmation.
- **FR-009**: Linking MUST NOT change the line's quantity, unit, store or order, and MUST be retry-safe (one link, one history entry).
- **FR-010**: Linking and registering MUST be recorded in the order's change history (when, who, typed text, medicine, order version), append-only.
- **FR-011**: The system MUST NOT link any line automatically. Every link needs the supplier's confirmation for that line.

**Proposals for other orders**

- **FR-012**: After a medicine is registered or a line is linked, the system MUST propose other typed lines whose typed text clearly matches that medicine (ignoring case and spacing), across all stores, in draft and confirmed orders, showing store, order number, typed text, quantity and unit for each, with a separate confirmation per line.
- **FR-013**: A line whose typed text shows a different strength, dosage form or pack size than the medicine, or whose match is ambiguous, MUST NOT be proposed as a match; it MUST be listed separately as not proposed, and MAY be linked manually through FR-008.
- **FR-014**: Proposals MUST be available again later from the medicine's own page (they MUST NOT disappear if ignored) and MUST NOT include lines of cancelled orders or removed lines.
- **FR-015**: Linking one proposed line MUST change only that line; no line moves between stores or orders and other lines are untouched.

**Pending Prices**

- **FR-016**: The system MUST provide a Pending screen with two lists. Pending Prices ("Need a price") lists every active medicine without a selling price, and every medicine with a price that still has confirmed lines waiting, with the number of confirmed-order lines and orders waiting for it. "To register" lists every typed line that still needs registering, grouped by exact typed text, with the stores and quantities.
- **FR-017**: A price MUST be entered by the supplier as PKR greater than zero with at most two decimals; the system MUST NOT suggest, default or compute a selling price. Pending Prices MUST NOT overwrite a selling price the medicine already has; changing an existing catalog price stays on the Products screen.
- **FR-018**: Before any line is filled, the system MUST show the exact lines that would receive the price (store, order number, quantity, resulting total) and the count of lines that will not be touched, and MUST require explicit confirmation. "Save price only" (catalog price, no lines) MUST also be offered. A review and a fill cover at most 1,000 lines (oldest orders first); when more wait, the review says how many remain and the supplier repeats the step.
- **FR-019**: Only confirmed-order lines that have no selling price recorded MUST be filled. A line that already carries a selling price MUST NEVER be changed by this module, whatever price is entered.
- **FR-020**: The fill MUST be one all-or-nothing, retry-safe operation: each line is filled once, one history entry per line; if the set of lines changed after the review, the fill MUST be refused and the review redone.
- **FR-021**: Each fill MUST be recorded in the order's change history with when, who, the previous price (none), the new price and the quantity, append-only.
- **FR-022**: When a line is linked to a medicine that has a selling price (Stories 1 and 2, confirmed orders), that price MUST be shown to the supplier and applied to the line only after the supplier's explicit confirmation; declining MUST leave the line unpriced and listed in Pending Prices. On a draft, the line simply follows the medicine's current price as in Module 003.
- **FR-023**: Purchase price and MRP MUST NOT be shown on any order, history, Home or Pending Prices screen, nor included in the data sent to those screens; they appear only as optional fields in the register form and the existing Module 001 product screens.
- **FR-024**: A typed (unlinked) line MUST NOT accept a price; it must be registered or linked first.
- **FR-025**: Cancelled orders' lines MUST be excluded from proposals, from Pending Prices and from every fill.

**Visibility and screens**

- **FR-026**: Home MUST show a "Needs attention" card with two counts, each linking to its list: the typed medicines to register (the groups of the "To register" list) and the medicines that need a price (the items of the "Need a price" list), with how many of those have orders waiting. It MUST NOT show a stale count (it is recomputed when Home opens).
- **FR-027**: Order screens MUST mark typed lines as not registered and offer the register and link actions on the line.
- **FR-028**: Every list and data screen in this module MUST have a loading state, an error state with Retry, and an empty state with the next action; an error MUST NOT look like "nothing pending".
- **FR-029**: All new screens MUST work at 360 px, with every interactive control at least 44 × 44 px, in English.

**Safety, isolation and history**

- **FR-030**: Every operation MUST enforce the business boundary on the server: a medicine, order, line or store of another business cannot be read, linked, proposed, priced or changed by crafting a request, and the browser MUST NOT hold any secret.
- **FR-031**: These operations MUST respect an order's saved version: a change made by register, link or fill makes an open editor on the same order see "changed elsewhere" rather than overwrite it, and a stale request MUST be refused with the current state returned.
- **FR-032**: Nothing in this module MUST hard-delete an order, line, medicine or history entry; all changes are recorded in the append-only history.
- **FR-033**: The system MUST NOT invent any medicine detail or price anywhere in this module (no parsing of strength or form from typed text, no default prices, no copying of a price from a different medicine).

### Key Entities *(include if feature involves data)*

- **Pending line (typed line)**: An order line that holds only the supplier's typed text, a quantity and a unit, with no catalog medicine yet (Module 003). It can be registered, linked, and (once linked) priced. The typed text is kept even after linking.
- **Medicine (product)** (Module 001): The catalog record created by Quick Register or picked for linking. Name and unit are required; everything else is optional; it may have no selling price.
- **Link**: The decision, confirmed by the supplier for one line, that this typed line is this medicine. Recorded with when, who, the typed text and the medicine. Created by registering or by linking, never automatically.
- **Price fill**: The supplier's confirmed decision to give a recorded selling price to order lines that had none. Recorded per line with when, who, previous price (none), new price and quantity.
- **Order change history** (Module 003): The append-only record of changes to an order; this module adds link and price fill entries.
- **Pending item**: A view over pending lines and unpriced medicines used by Home and the Pending Prices screen; it stores nothing of its own.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A supplier can register a typed medicine with only a name and unit and see the line linked in under 1 minute from tapping "Register this medicine", on a phone.
- **SC-002**: In 100% of tests of registering, linking and filling (including induced failures and repeated requests), 0 order lines, quantities, units, notes or typed texts are lost or changed, and an order is never left half changed.
- **SC-003**: Repeating a register, a link, or a price fill 10 times, including simultaneous repeats, results in exactly one new medicine, one link per line, and each price applied once with one history entry per line, in 100% of tests.
- **SC-004**: In 100% of tests, an order line that already carries a selling price is identical before and after any price entry, link, or fill (price, line total, history), and the total of an order only changes by the lines that were filled.
- **SC-005**: In 100% of tests, 0 lines are linked or filled without the supplier's explicit confirmation for that line (or that reviewed list).
- **SC-006**: In a fixed test set of look-alike medicines (different strength, dosage form or pack size, ambiguous text), 0 are proposed as matches and 0 are merged automatically; exact duplicates are blocked in 100% of attempts.
- **SC-007**: Pending Prices lists 100% of active medicines without a selling price and of confirmed order lines without a price, 0 lines of cancelled orders, and the lines shown in the review are exactly the lines that are filled in 100% of tests; the Home count of typed medicines to register equals the number of groups on the "To register" list, and the Home count of medicines needing a price equals the number of items on the "Need a price" list (of which the Home card also says how many have orders waiting), in 100% of tests.
- **SC-008**: In 100% of tested attempts by one business to read, link, propose, price or change medicines, orders or lines of another business, the attempt is refused and 0 records of the other business change.
- **SC-009**: Every price entered is accepted only as PKR with at most two decimals, and line totals equal quantity × price exactly, in 100% of tests; 0 invented or defaulted prices or medicine details exist after any operation.
- **SC-010**: 100% of register, link and price fill operations appear in the order change history with who, when and the before and after values; 0 history entries can be edited or deleted through the app; 0 purchase price or MRP values appear on any order, history, Home or Pending Prices screen or response.
- **SC-011**: Pending Prices and the proposals list open within 2 seconds with 1,000 pending lines and 500 medicines without a price.
- **SC-012**: Every new screen is reachable by visible navigation at a 360 px width, with 100% of interactive controls at least 44 × 44 px, and a loading, error and empty state verified for each list screen.

## Assumptions

- Terms: a **typed line** (also called a pending line or a "Not registered" line) is an order line that holds only the supplier's typed text. The **Pending screen** has two tabs: **To register** (typed lines, grouped by typed text) and **Need a price** (this is the **Pending Prices** list of the master prompt). A **link** is the supplier's confirmed decision that a typed line is a given medicine.
- Use is still solo: the signed-in user is the owner; "who" in the history is that signed-in user. Multi-user roles are not part of this module.
- Undoing a link or a price fill is not part of this module. The confirm steps (side-by-side details, reviewed list of lines) are the protection against mistakes. Any later correction path is decided with invoicing (Module 006), because a corrected price after an invoice needs reversal and a reason, not a silent edit. This is flagged as a risk to revisit.
- Matching typed lines to a medicine is deliberately conservative: a line is proposed only when its typed text clearly equals the medicine's name (or name with the same strength and form), ignoring case and spacing. Anything with a visible difference or an ambiguous match is not proposed. The exact rule is a planning decision; the requirement is that nothing is proposed that shows a different strength, dosage form or pack size, and nothing is linked without confirmation.
- Linking changes only the link, the details shown for the line, and (after confirmation) the selling price. It never copies a purchase price or MRP into an order line; those stay as they were. The actual purchase cost comes from Purchase Recording (Module 005).
- Only the line's selling price is filled by Pending Prices. The line's unit stays as the supplier entered it, even if the medicine's own unit differs.
- Setting a price in Pending Prices also sets the medicine's current selling price in the catalog (so drafts follow it), because the price is the supplier's decision for that medicine. "Save price only" does that without touching confirmed lines.
- Draft orders are not filled by Pending Prices, because a draft shows the medicine's current price and takes its snapshot at confirmation (Module 003). Only confirmed orders hold lines that can be "waiting for a price".
- Cancelled orders are final: their lines are never proposed, listed or changed.
- The Home screen card and the order screens carry the visibility; no sixth item is added to the bottom navigation, to keep five large touch targets at 360 px. Pending Prices is reached from Home, the Products screen and the order screen.
- Typed text is never parsed into strength, dosage form or pack size by the app, because that would invent details. The supplier types them in the register form.
- Constitution Principles I-VIII apply: server-side validation of money and duplicates, exact PKR, isolation per business, append-only history, no invented data, and mobile-first screens with loading, error and empty states.
- This module builds on the Module 003 code (branch `003-manual-orders`, PR #2). It starts from that branch, and its pull request should be opened after PR #2 is merged, or be based on it.

## Out of Scope

Market list and purchase recording (Module 005); invoices, invoice numbers, the Account Summary and the rule that blocks issuing an invoice while a line lacks a selling price (Module 006; this module only makes lines ready by registering, linking and pricing them); ledger and payments; voice order entry and Gemini; offline drafts and sync; reports; multi-user roles; undoing a link or a price fill; changing quantities of a confirmed order (done in Module 003); importing orders; editing or merging existing medicines; bulk price import.
