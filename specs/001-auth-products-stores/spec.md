# Feature Specification: Foundation — Login, Products, and Stores

**Feature Branch**: `001-auth-products-stores`  
**Created**: 2026-11-05  
**Status**: Draft  
**Input**: User description: "Module 001 Foundation: login, products, and stores for the Medicine Supply & Order Management app. Scope ONLY: email+password login/logout with session handling and protected screens; each user belongs to one business (solo use) and all data is isolated per business from the first release; Products (add, edit, view, search, deactivate/reactivate, empty catalog allowed, only name and unit required, one selling price, internal unit gross profit, duplicate check, PKR money); Stores (add, edit, view, search, deactivate/reactivate, only name required); mobile-first app shell with bottom navigation, loading/error/empty states, English UI. Out of scope: setup checklist, CSV import, orders, Quick Register from orders, market list, purchases, invoices, ledger/payments, voice/AI, offline sync, reports."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in and reach a protected app (Priority: P1)

The supplier opens the app on their phone, signs in with email and password, and lands on the home screen with navigation to Products and Stores. Without signing in, no business screen or data is reachable. They can sign out at any time.

**Why this priority**: Nothing else can be used or protected without identity and a business to attach data to. It is the base of every later module.

**Independent Test**: With one provisioned account, sign in, see the home screen, sign out, and confirm that every protected address redirects to the sign-in screen.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor, **When** they open any protected screen address directly, **Then** they are sent to the sign-in screen and, after a successful sign-in, returned to the screen they asked for.
2. **Given** valid credentials, **When** the supplier submits the sign-in form, **Then** they land on the home screen within 3 seconds on a normal mobile connection.
3. **Given** wrong credentials, **When** the supplier submits the form, **Then** a clear error is shown that does not reveal whether the email exists, and no session is created.
4. **Given** a signed-in supplier, **When** they choose Sign out, **Then** the session ends and the back button cannot reopen protected data.
5. **Given** a session that has expired, **When** the supplier performs any action, **Then** they are told the session expired. The open form stays on screen with its typed text, and a notice offers a sign-in link that opens in a new tab; after signing in again the supplier can retry the save. Leaving the form discards the text only after the supplier chooses to leave.
6. **Given** the sign-in screen with the network unavailable, **When** the supplier submits, **Then** a clear connection error is shown (never a fake success).

---

### User Story 2 - Manage stores (Priority: P1)

The supplier adds the pharmacies they supply. Only the store name is required; contact person, phone, address, and notes can be added later. They can search, view, edit, and deactivate or reactivate stores.

**Why this priority**: Stores are required by every order workflow that follows, and the app must be usable with only a name.

**Independent Test**: Starting with zero stores, add a store with only a name, search for it by partial name, edit its phone, deactivate it, and reactivate it.

**Acceptance Scenarios**:

1. **Given** no stores exist, **When** the supplier opens Stores, **Then** an empty state explains the screen and offers "Add your first store".
2. **Given** the add-store form, **When** the supplier enters only a name and saves, **Then** the store is saved and appears in the list.
3. **Given** a store named "Al Madina Medical", **When** the supplier types "madi" in search, **Then** the store is listed, matching case-insensitively and on partial text, also by contact person or phone.
4. **Given** an existing store, **When** the supplier adds or changes optional details and saves, **Then** the changes are stored and shown on the store's detail view.
5. **Given** an active store, **When** the supplier deactivates it after confirming, **Then** it disappears from the default list, remains viewable under an "Inactive" filter, and can be reactivated. No store can be permanently deleted.
6. **Given** a store whose name matches an existing store ignoring case and spacing, **When** the supplier saves, **Then** they are warned about the possible duplicate and must explicitly confirm to create it anyway.
7. **Given** the save fails (network or server error), **When** the supplier saves, **Then** an error is shown, the entered data remains on screen, and the store is not displayed as saved.

---

### User Story 3 - Manage the medicine catalog (Priority: P1)

The supplier registers medicines they sell. Only the product name and unit are required. Strength, dosage form, manufacturer, pack size, code (SKU), purchase price, selling price, and MRP are optional and never filled in on the supplier's behalf. They can search quickly, view, edit, and deactivate or reactivate products. The catalog may be empty.

**Why this priority**: The catalog underlies ordering, invoicing, and the market list in later modules.

**Independent Test**: Starting with an empty catalog, add a product with only name and unit, add another with all fields, search by partial text, edit prices, and deactivate and reactivate one.

**Acceptance Scenarios**:

1. **Given** an empty catalog, **When** the supplier opens Products, **Then** an empty state offers "Add your first medicine" and the app is otherwise fully usable.
2. **Given** the add-product form, **When** the supplier enters only name and unit, **Then** the product is saved with no prices, and it is clearly shown as having no selling price.
3. **Given** products "Panadol 500mg tablet" and "Panadol Extra", **When** the supplier types "PAN", **Then** both are suggested; typing is debounced so results update while typing without a flicker of unrelated results.
4. **Given** the search box, **When** the supplier searches by brand, generic name, strength, manufacturer, or code, **Then** matching products are shown; with more than 1,000 products, results appear within 1 second.
5. **Given** a product with both purchase and selling price, **When** the supplier opens it, **Then** the internal view shows Unit Gross Profit = Selling Price − Purchase Price; when either price is missing it shows "not available" instead of a number.
6. **Given** a new product that matches an existing product on name, strength, dosage form, pack size, and manufacturer (ignoring case and spacing), **When** the supplier saves, **Then** creation is blocked and the existing product is shown to open instead; if the existing product is inactive, the supplier is offered to reactivate it.
7. **Given** a new product with the same name but a different strength, dosage form, or pack size, **When** the supplier saves, **Then** the supplier is shown the similar products and may create it as a separate product after confirming. Products are never merged automatically.
8. **Given** a code (SKU) already used by another product of the same business, **When** the supplier saves, **Then** the save is rejected with a message naming the conflicting product.
9. **Given** a product, **When** the supplier deactivates it after confirming, **Then** it no longer appears in default lists or suggestions, remains viewable under an "Inactive" filter, keeps all its data, and can be reactivated. No product can be permanently deleted.
10. **Given** a price field, **When** the supplier enters a negative value, non-numeric text, or more than two decimal places, **Then** the field shows an error and the product is not saved.
11. **Given** a selling price lower than the purchase price, or an MRP lower than the selling price, **When** the supplier saves, **Then** a non-blocking warning is shown and the supplier may still save.

---

### User Story 4 - Mobile app shell and navigation (Priority: P2)

On a phone, the supplier moves between Home, Products, and Stores using a bottom navigation bar, with large touch targets. Every screen shows clear loading, error, and empty states. On larger screens the layout adapts.

**Why this priority**: Usability on Android phones is a core product promise, but story 1–3 data flows deliver value first.

**Independent Test**: At a 360 px wide viewport, reach every screen through visible navigation only, and trigger loading, error, and empty states on each list.

**Acceptance Scenarios**:

1. **Given** a signed-in supplier on a phone-width screen, **When** they use the bottom navigation, **Then** every item leads to a working screen and the active item is visibly highlighted.
2. **Given** a list is loading, **When** data has not arrived, **Then** a loading indicator is shown instead of a blank or an empty-state message.
3. **Given** a list request fails, **When** the supplier sees the error, **Then** a message and a Retry action are shown, and the empty state is not shown in its place.
4. **Given** any interactive control, **When** measured, **Then** its touch target is at least 44 × 44 px and text is legible without zooming.
5. **Given** a tablet or desktop width, **When** the app is opened, **Then** content remains readable and every function is available.

---

### User Story 5 - Business data isolation (Priority: P1)

Each business sees only its own stores and products. Although this product is used by one supplier, isolation exists from day one so later modules never need to be retrofitted.

**Why this priority**: Constitution Principle V makes this non-negotiable, and it protects every later financial record.

**Independent Test**: With two separate business accounts each owning products and stores, confirm each account can neither list, read, change, nor deactivate the other's records, by any route.

**Acceptance Scenarios**:

1. **Given** Business A and Business B each with their own stores and products, **When** A is signed in, **Then** A's lists contain only A's records and never B's.
2. **Given** A knows the identifier of one of B's records, **When** A requests, edits, or deactivates it directly, **Then** the request is refused or returns nothing and B's record is unchanged.
3. **Given** a signed-out visitor, **When** they request business data by any route, **Then** nothing is returned.
4. **Given** a record is created, **When** it is stored, **Then** it is always tied to the signed-in user's own business and the user cannot assign it to another business.

---

### Edge Cases

- A signed-in account with no business attached: the supplier sees a clear "account not set up" message and no data, never another business's data.
- Double tapping Save: exactly one record is created (each new record is given its unique identifier before saving, so a retry cannot create a duplicate).
- Very long text in names, addresses, or notes: input is limited to a stated maximum and the supplier is told when the limit is reached.
- Leading, trailing, and repeated spaces or different letter case in names do not create "different" duplicates.
- Names written in Urdu or mixed scripts are accepted, stored, displayed, and searchable.
- Two browser tabs editing the same record: the later save must not silently overwrite a newer change; the supplier is told the record changed and must review it.
- Deactivating a product or store that later modules reference must not break those references; inactive records remain visible by identifier.
- Search with no matches shows a "No results" state with a link to add the item, not the first-time empty state.
- Search text containing special characters (such as % or quotes) is treated as plain text.

## Requirements *(mandatory)*

### Functional Requirements

**Authentication and session**

- **FR-001**: The system MUST let a user sign in with email and password and sign out.
- **FR-002**: The system MUST protect every business screen and data request so that only a signed-in user can use them, redirecting others to the sign-in screen.
- **FR-003**: The system MUST keep the user signed in across app reopening until sign-out or session expiry, and MUST handle expiry with a clear message and redirect.
- **FR-004**: The system MUST show non-revealing sign-in errors and MUST show clear errors when the network or service is unavailable.
- **FR-005**: The system MUST attach each user to exactly one business and MUST show a clear message when an account has no business.

**Data isolation**

- **FR-006**: Every record (product, store, and any later record) MUST belong to exactly one business, and a user MUST only be able to read, create, change, or deactivate records of their own business.
- **FR-007**: The system MUST enforce isolation on the server side for every operation, not only by hiding items in the interface.
- **FR-008**: Records MUST be given a unique identifier by the app before they are saved, so that repeated or retried saves cannot create duplicates.

**Stores**

- **FR-009**: Users MUST be able to add a store with only a name required; contact person, phone, address, and notes are optional.
- **FR-010**: Users MUST be able to view, edit, search (name, contact person, phone), deactivate, and reactivate stores; permanent deletion MUST NOT be offered.
- **FR-011**: The system MUST warn about a store name matching an existing store ignoring case and spacing, and allow creation only after explicit confirmation.
- **FR-012**: The default store list MUST show active stores only, with a filter to show inactive ones.

**Products**

- **FR-013**: Users MUST be able to add a product with only name and unit required. Optional fields: brand, generic name, strength, dosage form, manufacturer, pack size, code (SKU), purchase price, selling price, MRP.
- **FR-014**: The system MUST NOT invent or default any optional product value, including prices, strength, pack size, and manufacturer.
- **FR-015**: Each product MUST have at most one selling price, one purchase price, and one MRP.
- **FR-016**: Money amounts MUST be non-negative, in PKR, with at most two decimal places, stored and calculated exactly with no rounding drift.
- **FR-017**: The system MUST show Unit Gross Profit (Selling Price − Purchase Price) only on internal screens and only when both prices exist; otherwise it MUST show that it is not available.
- **FR-018**: The system MUST block creating a product that exactly duplicates an existing product's name, strength, dosage form, pack size, and manufacturer (ignoring case and spacing), and MUST show similar existing products for confirmation when only some of those differ. The unit is not part of a product's identity. Inactive products still count as existing products for this rule, and the supplier is offered to reactivate the existing product instead of creating a copy. It MUST NEVER merge or replace products automatically.
- **FR-019**: The system MUST reject a code (SKU) that another product in the same business already uses.
- **FR-020**: Users MUST be able to search products by partial, case-insensitive text across name, brand, generic name, strength, manufacturer, and code, with debounced search-as-you-type suggestions selectable with one tap.
- **FR-021**: Users MUST be able to view, edit, deactivate, and reactivate products; permanent deletion MUST NOT be offered. Deactivated products MUST be hidden from default lists and suggestions and remain retrievable.
- **FR-022**: The system MUST warn, without blocking, when a selling price is below the purchase price or an MRP is below the selling price.
- **FR-023**: The system MUST offer a unit choice from common units (for example strip, bottle, box, tablet, vial, tube, sachet) and allow a custom unit.

**Interface and states**

- **FR-024**: The interface MUST be English, mobile-first, with bottom navigation on phones, touch targets of at least 44 × 44 px, and a layout that adapts to tablet and desktop.
- **FR-025**: Every list and form MUST have loading, error (with Retry), and empty states; the empty state MUST name the next action ("Add your first store", "Add your first medicine").
- **FR-026**: Destructive-style actions (deactivate) MUST require confirmation.
- **FR-027**: The system MUST NOT report a save as successful unless the data was actually stored, and MUST keep entered data on screen when a save fails.
- **FR-028**: When a record was changed elsewhere since the user opened it, the system MUST refuse to overwrite silently and tell the user.
- **FR-029**: Cost and profit information (purchase price, MRP, unit gross profit) MUST appear only in internal product screens and MUST NOT be exposed in any printable or customer-facing output.

### Key Entities *(include if feature involves data)*

- **Business**: The supplier's organization; owns all stores and products. Has a name; each user belongs to exactly one.
- **User account**: A person who signs in with email and password and belongs to one business.
- **Store**: A pharmacy the supplier serves. Name (required), contact person, phone, address, notes, active/inactive. Belongs to one business.
- **Product**: A medicine the supplier sells. Name and unit (required); brand, generic name, strength, dosage form, manufacturer, pack size, code (SKU), purchase price, selling price, MRP (all optional); active/inactive; derived internal Unit Gross Profit. Belongs to one business.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new supplier can sign in, add a first store with only a name, and add a first medicine with only name and unit in under 2 minutes without any pre-loaded data.
- **SC-002**: Search results update within 1 second for a catalog of 5,000 products and within 1 second for 500 stores.
- **SC-003**: In a test with two businesses, 100% of attempts by one business to read, change, or deactivate the other's stores or products are refused, and signed-out requests return no business data.
- **SC-004**: 100% of tested protected screens redirect a signed-out visitor to sign-in, and 100% of expired-session actions show the expiry message.
- **SC-005**: Double-tapping Save or retrying a failed save creates zero duplicate records across 50 repeated trials.
- **SC-006**: In 100% of tested failure cases (network down, server error), no false success message appears and entered data is preserved on screen.
- **SC-007**: Every screen is reachable through visible navigation at a 360 px width, and 100% of interactive controls meet the 44 × 44 px touch-target minimum.
- **SC-008**: 100% of tested exact-duplicate product attempts are blocked, and 0 products are merged automatically across tests of similar names with different strength, dosage form, or pack size.
- **SC-009**: Unit Gross Profit matches Selling Price − Purchase Price exactly for every tested price pair (including values with two decimals), and is never shown when a price is missing.
- **SC-010**: Every list screen shows a purposeful empty state with the next action when it has no records, verified for stores and products.

## Assumptions

- Use is solo: one supplier, one business. The account is created by the owner during setup; there is no public self-registration screen in this module. Password reset is performed by the owner through the account provider and is out of scope here.
- Each user account is linked to its business at provisioning time. A visible in-app way to edit business details belongs to the later setup module.
- "Code (SKU)" in this document is the same field as `SKU` in the interface labels, tables, and API.
- The default currency is PKR, shown without conversion; the interface language is English, while product and store names may be in any script.
- A product has one selling price; there are no per-store prices, batches, or expiry dates.
- Maximum text lengths (such as 200 characters for names and 1,000 for notes) are applied and communicated to the user.
- Orders, the market list, invoices, ledger, voice ordering, offline sync, CSV import, setup checklist, Quick Register from orders, and reports are separate later modules and are not part of this one.
- Constitution Principles I–VIII apply; offline behavior is not required in this module but records get client-generated identifiers so the offline module needs no rework.

## Out of Scope

Setup checklist, CSV/Excel import, orders and order history, Quick Register from orders and pending products, market list and purchases, invoices and printing, store ledger and payments, voice order and AI parsing, offline synchronization and backup, reports and dashboard, multi-user roles.
