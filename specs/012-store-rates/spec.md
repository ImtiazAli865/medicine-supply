# Feature Specification: Store-specific selling prices (Module 012)

**Feature Branch**: `012-store-rates`
**Created**: 2026-11-26
**Status**: Draft (open questions resolved 2026-11-26; ready for planning)
**Input**: Owner (translated from Roman Urdu): "While taking an order, if the price of each medicine differs, can it be changed? For example one pharmacy pays 200 for Panadol and another 220. If I add the price once, do I have to add it separately for every store, or is the price editable when making the invoice? Next week the market rate changes to 210, one store should pay 220, another 230 and a new store 215." Owner's choice when asked how rates are set: "Every shopkeeper has a different rate for every medicine, by negotiation."

## Background (how prices work today)

- A medicine has **one** selling price, used for every store.
- That price is copied into an order line when the order is confirmed (or when a line is added to an already confirmed order). Invoices total from that copy.
- The price cannot be typed or changed on an order or on an invoice.

So the supplier cannot bill two stores at different rates without changing the catalog price between orders, which is easy to get wrong.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set the price of a line while taking an order (Priority: P1)

While taking an order the supplier sees the price each line will be billed at and can change it for this order, before confirming.

**Why this priority**: it alone solves the problem: the right price reaches the invoice for each store.

**Independent Test**: take an order for one store, change one line's price, confirm, issue the invoice, and check that the invoice shows the typed price while the catalog price is unchanged and another store's order still shows the catalog price.

**Acceptance Scenarios**:

1. **Given** a draft order with a medicine whose catalog price is 210, **When** the supplier changes that line's price to 220 and confirms, **Then** the order total and the invoice use 220 and the catalog price stays 210.
2. **Given** a line whose price was not touched and a store with no rate of its own, **When** the order is confirmed, **Then** the line is billed at the catalog price, as today.
3. **Given** a medicine with no catalog price, **When** the supplier types a price on the order line, **Then** the line is billed at that price and the medicine still has no catalog price.
4. **Given** a confirmed order, **When** the supplier looks at an existing line, **Then** its price cannot be changed.
5. **Given** a typed price that is empty, zero, negative or has more than two decimals, **When** the supplier tries to use it, **Then** it is refused with a plain message and nothing changes.
6. **Given** a line with a typed price, **When** the supplier changes its unit, **Then** the typed price is cleared, the screen says so, and the line shows the price for the new unit by the normal rule.

---

### User Story 2 - Remember a store's rate (Priority: P1)

The supplier marks a price as "this store's rate" for that medicine, and the next order of the same store is pre-filled with it.

**Why this priority**: without it the supplier would retype negotiated rates on every order, which is the main source of billing mistakes.

**Independent Test**: save a rate of 220 for store A and 230 for store B; take a new order for each and for a third store, and check the pre-filled prices are 220, 230 and the catalog price.

**Acceptance Scenarios**:

1. **Given** the supplier types 220 on a line and chooses to remember it, **When** a later order of the same store adds that medicine, **Then** 220 is pre-filled and the line says it is this store's rate.
2. **Given** the supplier types a price and does not choose to remember it, **When** the next order is taken, **Then** the earlier saved rate (or the catalog price) is pre-filled; the one-off price is not remembered.
3. **Given** store A has a rate for a medicine, **When** an order is taken for store B, **Then** store A's rate is never shown or used.
4. **Given** "Repeat last order", usual medicines or the last-order checklist is used, **When** the lines are added, **Then** each takes the store's current rate (or the catalog price), never the old order's price.
5. **Given** a draft order that already has lines, **When** the supplier looks for a way to change its store, **Then** the store cannot be changed (the existing rule), so a price typed for one store never moves to another; a draft without lines may change store and then takes the new store's rates.

---

### User Story 3 - Be warned when the market price moved (Priority: P2)

When the catalog price changed after a store's rate was saved, the order line says so, so the supplier can renegotiate and update the rate.

**Why this priority**: rates change with the market; a silent old rate causes losses.

**Independent Test**: save a rate while the catalog price is 200, change the catalog price to 210, take an order for the store and check the warning and that the saved rate is still used until the supplier changes it.

**Acceptance Scenarios**:

1. **Given** a saved rate made when the catalog price was 200, **When** the catalog price is now 210 and the medicine is added to that store's order, **Then** the saved rate is pre-filled with a note naming both catalog prices.
2. **Given** that note, **When** the supplier types a new price and remembers it, **Then** the note disappears for later orders until the catalog price changes again.
3. **Given** that note, **When** the supplier does nothing, **Then** the saved rate is not changed by the app.

---

### User Story 4 - See and remove a store's rates (Priority: P3)

On a store's page the supplier sees every remembered rate (medicine, rate, when it was set, the catalog price now) and can change or remove one.

**Why this priority**: mistakes in saved rates must be findable and fixable without taking an order.

**Independent Test**: remove a rate on the store page and check the next order uses the catalog price.

**Acceptance Scenarios**:

1. **Given** a store with saved rates, **When** the supplier opens them, **Then** each shows medicine identity (name, strength, form, pack size, maker), rate, date set and the current catalog price.
2. **Given** a rate is removed, **When** the next order adds that medicine, **Then** the catalog price is used. Confirmed orders and invoices do not change.
3. **Given** a store with no saved rate, **When** the list is opened, **Then** an empty state explains how a rate is saved.

### Edge Cases

- A draft saved earlier is confirmed after the store's rate or the catalog price changed: the supplier must see the price that will be billed before confirming; a price must not change between what was shown and what is recorded.
- Two tabs or devices change the same store's rate: the later change must not silently overwrite a newer one.
- A line typed as "Not registered" has no rate; after it is registered or linked, filling its price must show the store's saved rate if there is one, and the supplier confirms.
- The Pending Prices flow fills many stores' lines from one typed price: a line of a store that has its own rate must not receive the typed catalog price without the supplier seeing it.
- A medicine is deactivated: its rate is kept and not applied while inactive.
- A store is deactivated: its rates are kept.
- A new store created on the phone that turns out to be an existing store: the existing store's rates apply; nothing is copied from the temporary one without confirmation.
- A wrong price on a confirmed order: the line keeps its price; the supplier removes the line and adds it again (or cancels the order), and the history shows both.
- A price far from the catalog price (for example 22 instead of 220): see FR-012.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On a draft order the supplier MUST be able to see and change the selling price of each catalog line before confirming.
- **FR-002**: The price offered for a line MUST be, in this order: the price the supplier typed on this order; else the order store's saved rate for that medicine; else the catalog selling price; else none (the line is unpriced, as today).
- **FR-002a**: A change of a line's unit MUST clear the price typed for it (a price is agreed for one unit), say so, and untick remember. Remembering MUST be unavailable when the line's unit differs from the medicine's unit.
- **FR-003**: The app MUST NOT invent, compute or round a price from another price; every price is typed by the supplier or is the catalog price the supplier entered.
- **FR-004**: The screen MUST say where each price comes from (typed on this order, this store's rate, catalog, none).
- **FR-005**: The price recorded at confirmation MUST equal the price shown to the supplier at that moment; if it can no longer be (a rate or catalog price changed meanwhile), confirmation MUST stop, show the new price and ask again. The same applies when a line is added to a confirmed order.
- **FR-006**: The price of a line that already has a recorded price (confirmed order or invoice) MUST NEVER change. A line added to a confirmed order may have its price chosen as it is added, and the order history MUST show the price actually billed.
- **FR-007**: The supplier MUST be able to remember a typed price as the store's rate for that medicine; remembering MUST be an explicit choice, off by default.
- **FR-008**: A saved rate belongs to exactly one store and one medicine and MUST never be applied to another store or medicine.
- **FR-009**: A saved rate MUST keep the catalog price at the time it was saved, and the app MUST say when the catalog price is now different. The app MUST NOT change a saved rate by itself.
- **FR-010**: The supplier MUST be able to list, change and remove the saved rates of a store, with loading, error with Retry and empty states.
- **FR-011**: Every change of a saved rate and every price typed on an order MUST be traceable (what, which store and medicine, old and new value, when).
- **FR-012**: A typed price MUST be above zero with at most two decimals; a price that differs from the catalog price by more than half MUST ask for confirmation before it is used.
- **FR-013**: Invoices, order sheets, the market list and the Store Statement MUST keep their current permitted fields: no purchase price, MRP, cost, margin or profit anywhere; order sheets and the market list stay without any price.
- **FR-014**: Reports MUST keep using the price recorded on the invoice line, so sales and profit reflect the negotiated price.
- **FR-015**: Quantities, units, medicine matching and the "never block order taking" behaviour MUST stay as they are; setting a price is always optional.
- **FR-016**: The phone MUST keep each store's saved rates (selling prices only, never purchase price, MRP or cost) so that offline orders show them and the supplier can set a line's price offline. The screen MUST say when that copy may be old; if the rate on the server differs when the order is confirmed, FR-005 applies.
- **FR-017**: A price typed on an order that is still waiting on the phone MUST survive refresh, sync, backup and restore, and MUST be recorded on the server exactly as typed.
- **FR-018**: Screens MUST work at 360 px with controls of at least 44 by 44 px.

### Key Entities

- **Store rate**: the negotiated selling price of one medicine for one store, the catalog price when it was set, when it was set, and its change history.
- **Order line price**: the price that will be, or was, billed for a line, and where it came from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Three stores with three different rates for the same medicine produce three invoices with exactly those prices, with no change to the catalog in between.
- **SC-002**: For a store with saved rates, taking a repeat order of 20 lines needs no price typing.
- **SC-003**: Changing a line's price takes at most 3 taps plus typing the number.
- **SC-004**: Zero confirmed order lines or issued invoices change when a rate or a catalog price changes.
- **SC-005**: Every price on an invoice can be traced to a typed price, a saved rate or the catalog price at confirmation.
- **SC-006**: A catalog price change is flagged on 100% of the order lines that use a rate saved before it.

## Assumptions

- One owner user per business; no approval step for prices.
- A rate has no expiry date; it stays until changed or removed.
- Rates are per medicine (product), and therefore per that product's unit; the app does not convert a rate between units. A line in a different unit from the medicine's own unit gets no automatic rate and the screen says so.
- Rates start empty; they are not filled from old orders or invoices.
- The invoice editor stays as it is (only delivered quantities change); prices are decided on the order.

## Dependencies

- Constitution 1.1.0 (amended 2026-11-26 with the owner's approval): one catalog Selling Price per product plus optional per-store negotiated rates. Principle II is unchanged.
- A database change numbered 0012 or higher.
- The offline copy gains store rates, and the backup file must carry prices typed on waiting orders (it excludes every price today); FR-016 and FR-017 change that and their guards must be updated on purpose.

## Out of Scope

Percentage or margin rules per store, discounts on the invoice total, editing prices on the invoice, bulk rate editing or import from files, price history reports, voice or AI, several users with roles, deployment.

## Clarifications

### Session 2026-11-26 (owner, translated from Roman Urdu)

- Q: Should the phone also hold each store's rate for orders taken without internet? -> A: Yes, on the phone (selling prices only).
- Q: May the constitution line "One Selling Price per product" change to one catalog price plus optional per-store negotiated rates? -> A: Yes, allowed.
