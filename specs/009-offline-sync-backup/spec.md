# Feature Specification: Offline Order Taking, Automatic Sync and Backup

**Feature Branch**: `009-offline-sync-backup`
**Created**: 2026-11-19
**Status**: Draft
**Input**: User description (condensed, English): Module 009 "Offline order taking, automatic sync and backup" for the Medicine Supply & Order Management app (builds on Modules 001 to 008, all merged into master; the dropped voice work stays out). Goal: the supplier can keep taking orders when the internet is slow or gone, and nothing is lost or duplicated when it returns. Scope: (1) an offline cache on the device of the active medicine catalog (identifying details only, no purchase price, MRP or cost) and the store list, with a visible "last updated" time; (2) offline creating and editing of draft orders using the Module 008 fast entry, written to the device first and only then shown as "Saved on this device", never shown as "Synced" before the server confirms; (3) a pending sync queue with safe retries, no duplicate orders or lines, a state for each item (waiting, syncing, synced, failed with reason and Retry), a visible online/offline indicator and pending count, and no deletion of an unsynced order without explicit confirmation; (4) conflict handling that never overwrites either side silently; (5) new medicines and stores created offline stay as typed lines and inline stores that sync in order; (6) backup export and import with preview and duplicate protection, never including secrets; (7) a Settings area that shows sync status and the backup actions. Out of scope and online only: issuing invoices, recording payments or ledger entries, purchases, price changes, reports and profit (Module 010), voice or any AI, pasted WhatsApp text, roles, background push, and real-time sync between devices. Businesses stay isolated, including two businesses using one device. No new npm package unless the plan proves it is needed. Prefer no new database migration; any migration is numbered 0011 or higher (0009 and 0010 of the dropped voice work are already applied to the TEST and DEV projects) and needs the owner's approval with an ADR.

## Clarifications

### Session 2026-11-19

- Q: Which actions work offline? → A: Only taking orders: creating and editing draft orders, with the Module 008 fast entry. Everything that records money or a price (confirming an order, invoices, payments, purchases, price changes) and reports stay online only and say so plainly. (Owner's brief; confirming is an open question below.)
- Q: May an order be confirmed offline? → A: No. Confirming needs the internet, because prices are fixed at confirmation from the server's current selling prices. The supplier takes the draft offline and confirms it when online. (Owner accepted the default, 2026-11-19; translated from Roman Urdu: "The defaults are fine".)
- Q: What does the backup file contain? → A: Orders and their lines, stores, typed lines and the items still waiting on the phone; no invoices, payments, ledger, purchases or any purchase price, MRP, cost, margin, profit or balance. (Owner accepted the default, 2026-11-19.)
- Q: Where is the offline data kept? → A: On the device only. It is not available on another phone or computer until it has synced, and the app says so.

## User Scenarios & Testing *(mandatory)*

The supplier is often in a market lane, a shop basement or a bad-signal area. A store owner is telling an order and the signal is gone or slow. Today the screen shows an error and the order is lost or must be written on paper and typed later. This module makes the order safe on the phone first, then sends it by itself when the signal is back, and is honest at every moment about what is only on the phone and what the server has confirmed.

### User Story 1 - Take an order with no internet (Priority: P1)

The supplier opens the app on a phone that was used online earlier, loses the signal (or never has it), chooses a store, adds medicines with search, usual medicines or repeat last order, and keeps going. Every change is kept on the phone immediately, and the screen says "Saved on this device", never "Synced".

**Why this priority**: This is the whole point of the module. Without it nothing else matters.

**Independent Test**: Sign in online and let the screen load, switch the browser to offline mode, reload, create an order for a store with ten lines (searched, usual and repeated), close and reopen the app while still offline, and check that the draft with all ten lines is still there and marked "Saved on this device, not yet sent".

**Acceptance Scenarios**:

1. **Given** the supplier was online earlier on this phone and the medicine list and store list were loaded, **When** the phone goes offline and the app is reloaded, **Then** the app opens, the order screens work, the search finds medicines from the device copy, and a visible indicator says "Offline".
2. **Given** an offline draft being edited, **When** the supplier adds, changes or removes a line, **Then** the change is written to the device before the screen says "Saved on this device", and it never says "Synced" or "Saved" without "on this device".
3. **Given** the device cannot store data (storage full or blocked), **When** the supplier makes a change, **Then** the screen says plainly that the change could not be kept, keeps what is on the screen, and never claims "Saved on this device".
4. **Given** a phone that has never loaded the medicine list or store list (first use, or data cleared), **When** it is offline, **Then** the screen explains that the lists have not been loaded yet, names the next step (connect once), and still allows typed medicines and an inline typed store name so the order is not blocked.
5. **Given** the offline lists, **When** the supplier looks at the order screen, **Then** the time of the last successful refresh is visible, and when the lists are older than a day a note says so.
6. **Given** a draft order created offline, **When** the supplier closes the app, restarts the phone and reopens the app, **Then** the draft and its lines are still there.

---

### User Story 2 - The order reaches the server by itself, exactly once (Priority: P1)

When the connection returns, every order change made on the phone is sent in the order it was made, without the supplier doing anything. A weak connection that drops in the middle never creates a duplicate order or a duplicate line. Each item shows its own state.

**Why this priority**: Offline is only useful if the supplier can trust that the order arrives once and complete.

**Independent Test**: Create three orders offline, go online, cut the connection in the middle of the sending, restore it, repeat that twice, and check that exactly three orders exist on the server, each with its exact lines.

**Acceptance Scenarios**:

1. **Given** pending items on the phone, **When** the connection returns and the supplier is signed in, **Then** the app sends them by itself, one after the other in the order they were made, and each item moves through waiting, syncing and synced.
2. **Given** an item was being sent when the connection dropped or the app was closed, **When** it is sent again, **Then** the server still ends up with one order and one copy of each line.
3. **Given** the server confirms an item, **When** the item shows "Synced", **Then** the server really holds it; an item the server has not confirmed is never shown as synced.
4. **Given** an item the server refused or that failed repeatedly, **When** the supplier looks at it, **Then** it shows "Failed" with a plain reason, stays on the phone untouched, and has a Retry button; waiting items behind it that do not depend on it keep sending.
5. **Given** the phone is online but the connection is very slow, **When** a send takes long, **Then** it shows "Syncing" with the time since it started, can be left alone, and never blocks taking the next order.
6. **Given** pending items, **When** the supplier looks at the screen, **Then** an indicator shows online or offline and the number of items not yet synced, on every order screen and in Settings.
7. **Given** the retries, **When** many failures happen in a row, **Then** the app waits longer between tries instead of hammering the server, and the supplier can still tap Retry at any time.

---

### User Story 3 - Nothing is lost and nothing is silently overwritten (Priority: P1)

An order that exists only on the phone is never deleted or replaced without the supplier knowing. If the same order changed on the server in the meantime, the supplier sees both versions and chooses. Signing out, an expired session or another business using the same phone never loses or leaks pending orders.

**Why this priority**: The owner's rules say never lose an order and never overwrite newer server data with older phone data. A sync that breaks these rules is worse than no sync.

**Independent Test**: Edit a draft offline, change the same draft on the server meanwhile, go online, and check that the app shows both versions and changes nothing until the supplier chooses; then sign out with pending items, sign in as a second business on the same phone, and check that it sees none of them.

**Acceptance Scenarios**:

1. **Given** an unsynced order, **When** the supplier tries to delete or cancel it, **Then** a confirmation names the order, says it has not reached the server and that deleting it loses it, and nothing is deleted unless the supplier confirms.
2. **Given** an order that was changed on the server after the phone copy was based on it, **When** the phone copy is sent, **Then** the send is held, nothing on either side is changed, and the screen shows the phone version and the server version side by side with the choices "Keep the phone version", "Keep the server version" and, where possible, "Keep both as separate orders".
3. **Given** the supplier chooses "Keep the phone version", **When** it is applied, **Then** the supplier is told what will replace what before it happens, and the replaced server version is not lost without that choice.
4. **Given** the order was confirmed, cancelled or deleted on the server meanwhile, **When** the phone copy is sent, **Then** it is treated as a conflict, never applied silently, and the phone copy stays available.
5. **Given** pending items and the supplier signs out or the session expires, **When** they sign in again as the same business, **Then** all pending items are still there and are sent; the supplier is warned before sign-out that items are not yet synced.
6. **Given** pending items of business A on a phone, **When** business B signs in on that phone, **Then** B sees none of A's cached lists, drafts or pending items, none are sent under B, and A's items are still there when A signs in again.
7. **Given** a line whose medicine was made inactive or removed on the server after it was cached, **When** the order is sent, **Then** the line is not dropped or replaced; the order is held with a clear message naming the medicine and the supplier decides.
8. **Given** the same draft is open in two tabs or windows of the same phone, **When** both change it, **Then** the second change is treated as a conflict on the device and no edit is lost.

---

### User Story 4 - New stores and unknown medicines taken offline (Priority: P2)

Offline, the supplier meets a store that is not in the list or a medicine that is not in the catalog. The order is not blocked: the store is entered by name and the medicine stays a typed, not registered line, exactly as today. These sync in the right order and nothing typed is thrown away.

**Why this priority**: First-use and new-store cases happen in the field; the existing rule that unknown items never block an order must hold offline.

**Independent Test**: Offline, create an order for a store name that is not in the list with two typed medicines, go online, and check that the store exists once, the order belongs to it, and the two typed lines are still "Not registered" with their exact text.

**Acceptance Scenarios**:

1. **Given** a store not in the list, **When** the supplier types its name offline, **Then** the order is kept for that name, marked "New store, not yet on the server", and the screen says that other devices will not see it until it has synced.
2. **Given** a typed medicine offline, **When** the order syncs, **Then** the typed line arrives exactly as typed, quantity and unit unchanged, still marked "Not registered"; no medicine is created or matched automatically.
3. **Given** a new store and orders for it, **When** syncing, **Then** the store is created first and its orders after it, and if the store creation fails the orders wait and are not attached to another store.
4. **Given** a store typed offline that already exists on the server under a similar name, **When** it syncs, **Then** the supplier is asked whether it is the same store; nothing is merged or created silently.

---

### User Story 5 - Backup and restore (Priority: P2)

The supplier can save a backup file of their own order data and the items still waiting on the phone, and can restore it, even on a new phone, without creating duplicates and without overwriting newer server data.

**Why this priority**: A cleared browser or a lost phone must not lose orders that never synced, and the owner wants a copy they control.

**Independent Test**: With a mix of synced orders and unsynced drafts, export a backup, import it into a clean second business-empty device, and check the unsynced drafts come back and sync once; import the same file again and check nothing is duplicated.

**Acceptance Scenarios**:

1. **Given** the Settings screen, **When** the supplier taps "Export backup", **Then** a file is produced that they can save, with the date and counts shown, and nothing that works as a password, key or token is inside it.
2. **Given** a backup file, **When** the supplier chooses "Import backup", **Then** a preview shows what the file contains (orders, stores, pending items, counts and dates), what is new, what already exists and what would conflict, and nothing is changed until they confirm.
3. **Given** the same file is imported twice, **When** the second import is confirmed, **Then** no order, line or store is created a second time.
4. **Given** an item in the file that is older than the server copy, **When** it is imported, **Then** the server copy is kept untouched and the item is shown as a conflict for the supplier to decide.
5. **Given** a file that is damaged, from another app version it cannot read, or belongs to another business, **When** it is chosen, **Then** nothing is imported, and a plain message says why.
6. **Given** pending items exist, **When** the supplier clears the app data or signs out for good, **Then** a warning says that unsynced orders will be lost and offers "Export backup" first.

---

### User Story 6 - See what is going on in Settings (Priority: P2)

The supplier opens Settings and sees whether the phone is online, when the last successful sync was, how many items are waiting, syncing, failed or in conflict, with a Retry and a way to open each one, and the backup actions.

**Why this priority**: The supplier must be able to check that every order made in the field arrived, at the end of the day, in one place.

**Independent Test**: With one synced, one waiting, one failed and one conflicting item, open Settings and check that the counts and each item's state are right, and that Retry on the failed one sends it.

**Acceptance Scenarios**:

1. **Given** Settings, **When** it opens, **Then** it shows online or offline, the time of the last successful sync, the counts of waiting, syncing, failed and conflicting items, and the age of the cached lists.
2. **Given** a failed item, **When** the supplier opens it, **Then** it shows the order, the reason and a Retry button; items that are fine show no error.
3. **Given** nothing is pending, **When** Settings opens, **Then** an empty state says everything is synced as of the last successful sync time (and says nothing more than that).
4. **Given** loading, failure or empty states anywhere in this module, **When** they occur, **Then** each shows a loading, an error with Retry or an empty state that names the next step.

---

### Edge Cases

- The phone clock is wrong or changes: order of sending and conflict decisions never depend on the phone's clock.
- Connection is "up" but the server is unreachable or the request hangs: the indicator may say online but items stay waiting or syncing; nothing says synced.
- The session expired while offline: work continues on the phone; on reconnect the supplier is asked to sign in again before anything is sent; nothing is lost.
- A tab is closed in the middle of writing to the device: after reopening, the order is either the old version or the new version, never half of each.
- Storage on the phone is nearly full: a warning appears before it is full, and a change that cannot be stored is reported honestly.
- The cached medicine list is old: the app says so, search still works, and a medicine that has changed on the server is checked when the order is sent.
- A very large offline order (hundreds of lines) and many offline orders (dozens): they still sync one after the other and the screens stay responsive.
- An order synced already is edited again offline: the new change is sent as a change to that order and follows the conflict rules above.
- A pending item refers to a store that was deleted or made inactive on the server: held with a message, never attached to another store.
- The app is updated to a newer version while items are pending: the items are still readable and sync by the new version, or the supplier is told clearly what to do.
- The supplier uses a private browsing window where the device storage may be unavailable: the app says offline orders cannot be kept there.

## Requirements *(mandatory)*

### Functional Requirements

**Device copy and offline screens**

- **FR-001**: After the phone has been online and signed in once, the app MUST open and the order screens MUST work when the phone is offline, including after a reload or a restart of the phone.
- **FR-002**: The system MUST keep on the device a copy of the business's active medicine list (identifying details only: name, strength, dosage form, pack size, manufacturer and the unit) and of the store list, MUST refresh it when online, and MUST show the time of the last successful refresh.
- **FR-003**: The device copy MUST NOT contain any purchase price, MRP, cost, margin, profit, balance, invoice or ledger data.
- **FR-004**: Search, usual medicines, repeat last order and the last-order checklist of Module 008 MUST work offline from the device copy for the data that has been cached (the usual and last-order data of a store only after that store's data was loaded online); where something is not cached the screen MUST say so and offer the typed path.
- **FR-005**: First use with no cached lists MUST NOT block taking an order: unknown medicines and stores remain typed or inline-entered as in the earlier modules, and every list screen keeps an empty state that names the next action.
- **FR-006**: A visible indicator on every order screen and in Settings MUST show online or offline and the number of items not yet synced.

**Writing to the device first**

- **FR-007**: Every change to a draft order made on the phone MUST be written to the device before the screen shows "Saved on this device"; the words "Synced" or an unqualified "Saved" MUST NOT be used until the server has confirmed it.
- **FR-008**: If the device storage is unavailable, full or blocked, the app MUST say so, MUST keep the data on the screen and MUST NOT show "Saved on this device".
- **FR-009**: A write to the device MUST be all-or-nothing: after a crash, a closed tab or a restart, an order is whole and is either the old or the new version, never partly written.
- **FR-010**: Orders MUST be editable offline only while they are drafts (created on the phone, or opened on the phone while online); changes that record prices or money (confirming, editing a confirmed order, cancelling a confirmed order, invoices, payments, ledger, purchases, price changes) and reports MUST stay online only and MUST say plainly that they need the internet.
- **FR-011**: Confirming an order MUST need the internet: prices are fixed at confirmation from the server's current selling prices, so the supplier takes the draft offline and confirms it when online; an offline screen MUST say so next to the confirm button instead of offering a confirmation that cannot be made.

**Sync queue**

- **FR-012**: Every offline change MUST be placed in a pending queue with a stable id created on the device, and MUST be sent to the server in the order it was made, one item at a time per order.
- **FR-013**: Sending MUST start by itself when the connection returns and the supplier is signed in, and MUST be repeatable without ever creating a second order, a second line or a second store; the server side MUST treat a repeated send of the same item as the same item.
- **FR-014**: Each queue item MUST show one state at a time: waiting, syncing, synced, failed (with a plain reason) or conflict, and MUST be marked synced only after the server confirms it.
- **FR-015**: Failed items MUST stay on the device unchanged and MUST have a Retry; automatic retries MUST wait longer after repeated failures; an item that fails MUST NOT block unrelated items.
- **FR-016**: A send that was interrupted (lost connection, app closed, phone restarted) MUST be safely resumable at the next start.
- **FR-017**: A slow or hanging connection MUST never block taking, editing or searching on the phone.

**Conflicts, deletion and ownership**

- **FR-018**: When the server copy of an order has changed since the phone copy was based on it (changed, confirmed, cancelled or deleted elsewhere), the system MUST hold the send, change nothing on either side, and show both versions so the supplier can choose; neither version may be replaced without that choice and a preview of what changes.
- **FR-019**: Conflict decisions MUST NOT depend on the phone's clock.
- **FR-020**: An order or change that has not reached the server MUST NOT be deleted, cancelled or discarded without an explicit confirmation that says it is not on the server and will be lost.
- **FR-021**: A line whose medicine is no longer available on the server, or an order whose store is no longer available, MUST NOT be silently dropped, replaced or moved; it is held with a message and the supplier decides.
- **FR-022**: Two tabs or windows editing the same draft on one device MUST NOT lose either edit; the later one is shown as a conflict on the device.
- **FR-023**: The device data MUST belong to the signed-in business: another business signing in on the same phone MUST NOT see, change or send it; sign-out or session expiry MUST NOT delete pending items, and the supplier MUST be warned before signing out while items are not synced.
- **FR-024**: When the session has expired, pending items MUST wait and be sent only after the same business signs in again; they MUST never be sent under another account.

**New stores and medicines offline**

- **FR-025**: A store typed offline and a medicine typed offline MUST be kept as a new store and a typed (not registered) line; the screen MUST say that other devices will not see them until they have synced.
- **FR-026**: A new store MUST be sent before the orders that use it; typed lines MUST arrive exactly as typed (text, quantity, unit) and MUST NOT be matched, merged or registered automatically; a possible duplicate store MUST be put to the supplier as a question, never merged silently.

**Backup**

- **FR-027**: The Settings screen MUST offer "Export backup", producing a file the supplier saves, showing its date and counts, and MUST NOT put any password, key, token or service secret in it.
- **FR-028**: The backup file MUST contain the supplier's orders and their lines, stores, typed lines, and every item still waiting on the phone; it MUST NOT contain invoices, payments, the ledger, purchases or any purchase price, MRP, cost, margin, profit or balance, which stay on the server.
- **FR-029**: "Import backup" MUST show a preview (what is new, what already exists, what conflicts, counts and dates) and change nothing until the supplier confirms; importing the same file again MUST NOT create duplicates.
- **FR-030**: Import MUST NOT overwrite newer server data; older items that differ are shown as conflicts; a damaged file, an unreadable version or a file from another business MUST be refused with a plain reason and nothing imported.
- **FR-031**: Before the supplier clears device data or signs out for good while items are not synced, the app MUST warn that they will be lost and offer "Export backup".

**Settings, states and quality**

- **FR-032**: The Settings screen MUST show online or offline, the time of the last successful sync, the counts of waiting, syncing, failed and conflicting items, the age of the device lists, a way to open each failed or conflicting item with Retry, and the backup actions.
- **FR-033**: Every new screen or list MUST have loading, error with Retry and empty states, MUST pass the 360 px check (controls at least 44 px, no sideways scroll), and the bottom navigation MUST keep five items.
- **FR-034**: Online-only actions MUST keep the honest behaviour of Modules 003 to 008: a failed save shows an error and keeps the screen, and no offline claim is made for them.
- **FR-035**: The module MUST NOT claim offline operation, synchronization or backup unless each is implemented and tested, including browser tests run in offline mode.
- **FR-036**: Every read and write that reaches the server MUST keep running under the signed-in business's own permissions; nothing from one business may reach another, and this MUST be tested with two businesses.
- **FR-037**: The module MUST NOT add a new npm package unless the plan shows it is needed, and MUST NOT add a database change unless the plan shows it is needed (any such change is numbered 0011 or higher and needs the owner's approval with an ADR).

### Key Entities *(include if feature involves data)*

- **Device copy (cache)**: the business's active medicines (identifying details only) and stores, with the time of the last successful refresh; belongs to one signed-in business on one device.
- **Offline draft order**: an order being taken or edited on the phone, with a stable id made on the device, its lines (catalog lines and typed lines), and the version of the server copy it was based on, if any.
- **Pending item**: one change waiting to reach the server (create order, change order, create store), with its stable id, its order in the queue, its state (waiting, syncing, synced, failed, conflict), the reason if failed, and the number of tries.
- **Conflict**: a pending item whose server copy changed meanwhile, holding both versions until the supplier chooses.
- **Device owner marker**: which business the device data belongs to, so another business never sees it.
- **Backup file**: a saved copy of the supplier's own order data and waiting items with its date, counts and a format version, with no secrets.
- **Sync status**: online or offline, last successful sync time, and the counts per state, shown on every order screen and in Settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the phone set to offline mode, an order of ten lines (searched, usual and repeated medicines) is created, survives closing and reopening the app and a phone restart, and after the connection returns appears on the server once with the exact ten lines; in 100% of the runs of this test.
- **SC-002**: When the connection is cut in the middle of sending and restored three times, three orders created offline end up as exactly three orders with the exact lines on the server (zero duplicate orders, lines or stores).
- **SC-003**: Zero cases in the tests where a screen says "Synced" before the server confirmed, or "Saved on this device" before the device write finished.
- **SC-004**: Zero cases where a server change is overwritten by phone data or phone data is replaced by server data without the supplier's choice, across the conflict cases (changed, confirmed, cancelled and deleted on the server, medicine made inactive, store removed).
- **SC-005**: With two businesses on one phone, the second never sees or sends any data of the first, and the first still has all of its pending items after the second signs out; verified by a browser test and a database-permission test.
- **SC-006**: After a number of orders created offline, all of them are sent by themselves within 60 seconds of the connection returning for up to 20 orders on a normal connection, with each item's state correct, and the screens stay usable meanwhile.
- **SC-007**: A backup exported with a mix of synced and unsynced orders restores into an empty business with every unsynced order intact; importing the same file a second time creates nothing new; no secret appears in the file; a damaged file changes nothing.
- **SC-008**: Searching the device copy of a 5,000-medicine catalog shows results within 300 ms while offline.
- **SC-009**: All new screens pass the 360 px touch-target check (controls at least 44 px, no sideways scroll) and show loading, error with Retry and empty states.
- **SC-010**: The owner, on a real phone in airplane mode, takes a real order, sees it kept after closing the app, turns the connection back on and sees it arrive once; the result is recorded as reported, not seen. Each claim in the app is backed by an automated browser test that was run.

## Assumptions

- The supplier is the only user of a business (no roles), uses one main phone, and has opened the app online and signed in on that phone at least once before working offline.
- Taking orders is the only offline work: confirming, invoices, payments, purchases, price changes, the market list and reports need the internet and say so.
- A draft order can be taken offline if it was created on the phone or was opened on the phone while online; other server orders are not promised to be available offline.
- The device copy of the medicine list holds identifying details only; selling prices are not needed for drafts and are not copied, so the cache and the backup carry no price.
- "Saved on this device" means written to the phone's own storage; it does not mean the order is safe if the phone is lost or its browser data is cleared, and the app says so.
- Real-time sync between several devices, background push and automatic merging of conflicting edits are out of scope; conflicts are always decided by the supplier.
- The existing idempotent order save of Module 003 is the server side of the queue; the plan decides whether anything more is needed on the server, and whether a new package or a migration is needed at all.
- Everything committed is in English; the owner's Roman Urdu messages are translated in the prompt history.
