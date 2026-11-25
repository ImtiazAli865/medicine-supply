# Feature Specification: Hardening and Offline Payments

**Feature Branch**: `011-hardening-offline-payments`  
**Created**: 2026-11-24  
**Status**: Draft  
**Input**: User description: "Module 011 Hardening and offline payments for the Medicine Supply & Order Management app (builds on Modules 001 to 010, all merged into master at a010bec). Part A: finish the one feature the constitution requires and Module 009 deferred, recording a payment without the internet, with a pending-sync balance and the same sync machinery. Part B: check, tighten and document everything built so far: a test and acceptance traceability table, a security review, honesty fixes (a warning when the offline worker cannot start, a password reset path), test-infrastructure fixes, a Reports speed re-measure, and the final documentation. Deployment itself is not part of this module." (the full request text is kept in the Prompt History Record of this stage)

## Overview

Modules 001 to 010 give the supplier orders, a market list, purchases, invoices, store accounts (khata), offline order taking and reports. Two things stand between this and real use:

1. **Payments cannot be recorded without the internet.** The constitution (Principle VII) says payment recording must work offline; Module 009 kept it online by the owner's decision and said a later module must add it. A supplier collecting cash in a shop with no signal must not have to write the amount on paper and remember it later.
2. **Nobody has yet checked the whole.** There is no single place that shows which of the master prompt's tests and acceptance criteria are covered, no recorded security review, a few known honesty gaps (no warning when the offline worker cannot start, no way to reset a forgotten password), a test helper that hides delete errors, and no final list of what works and what does not.

Words used in this specification:

- **Waiting payment** = a payment recorded on this phone that the server has not confirmed yet.
- **Pending sync** = the label on a balance that does not yet include the waiting payments.
- **Online only** = an action that needs the internet and says so instead of pretending.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a cash payment with no internet (Priority: P1)

In a shop with no signal, the supplier opens the app, chooses **Record payment**, picks the store from the stores kept on the phone, enters the amount, the date and an optional reference, and saves. The phone keeps the payment as **Waiting**, says so in plain words ("Saved on this phone. It is not in the store's account until it is sent."), and never calls it recorded or synced. The same rules as online apply to the amount and the date.

**Why this priority**: It is the missing piece of the constitution and the owner's daily reality; everything else in Part A depends on it.

**Independent Test**: With the phone offline after being online once, record three payments for two stores (one with a reference, one for a store made on the phone that is itself still waiting). All three appear as Waiting, none is described as recorded, and closing and reopening the app keeps all three.

**Acceptance Scenarios**:

1. **Given** the phone is offline and has the stores copy, **When** the supplier records a payment of PKR 5,000 for a store, **Then** it is saved on the phone as Waiting with the store, amount, date and reference, and the screen says it is not yet in the store's account.
2. **Given** an amount that is zero, negative, has more than two decimals, or a date in the future or before 2000-01-01, **When** the supplier saves, **Then** it is refused with the same messages as online and nothing is saved.
3. **Given** the supplier taps Save twice, or closes the app right after saving, **When** the app is opened again, **Then** exactly one waiting payment exists.
4. **Given** the phone is offline, **When** the supplier opens Record payment, **Then** the screen says plainly that the balance and what the payment settles are worked out by the server when it is sent (no invented preview), and shows the waiting payments of that store.
5. **Given** a store that was itself created on the phone and is still waiting to be sent, **When** a payment is recorded for it, **Then** it is accepted as Waiting and is sent only after the store exists on the server.
6. **Given** a waiting payment that has not been sent, **When** the supplier removes it, **Then** a confirmation names the amount and the store and says it cannot be undone, and nothing is removed without that confirmation.

---

### User Story 2 - Waiting payments are sent once, safely and in order (Priority: P1)

When the connection returns, the waiting payments are sent by themselves, one at a time, in the order they were recorded, by the same sending machinery as waiting orders (waits that grow after failures, one sender even with several tabs open, the same sync status screen and conflict panel). The server records each payment exactly once, however often it is sent. A payment the server cannot accept (the store no longer exists, the key was already used for something different, an amount the server refuses) is shown in the conflict panel with the reason and the supplier's choices; it is never dropped and never applied to another store. While any payment is waiting, the store's balance is shown as **pending sync**.

**Why this priority**: Recording offline is worthless if sending can lose, duplicate or misapply money. This is the heart of Principles III and VII.

**Independent Test**: Record payments offline, go online, and also simulate lost answers, two tabs, a restart mid-send and a slow network: each payment exists once in the ledger, in the right store, and the balance equals the sum of the entries. Force each refusal and check it lands in the conflict panel with its reason.

**Acceptance Scenarios**:

1. **Given** three waiting payments and the connection returns, **When** sending runs, **Then** the three are recorded on the server once each, in the order recorded for each store, and then show as Synced and leave the waiting list.
2. **Given** the answer to a send is lost, or the app is closed during the send, **When** sending resumes, **Then** the same payment key is sent again and the server returns the stored payment; no second payment is recorded.
3. **Given** the same phone is open in two tabs, **When** the connection returns, **Then** only one tab sends and no payment is recorded twice.
4. **Given** a waiting payment for a store that no longer exists, **When** it is sent, **Then** it is shown in the conflict panel as "the store is not on the server", never deleted silently, never applied to another store, and the supplier can keep it for later or remove it after a confirmation.
5. **Given** a payment key the server already holds with different content, **When** it is sent, **Then** it is shown as a conflict with both versions and nothing is applied until the supplier chooses.
6. **Given** one store has waiting payments, **When** the supplier opens that store's account while online, **Then** the balance carries the label **pending sync** and a line "N payments waiting on this phone, PKR X, not counted yet"; another store's balance and the totals on Home say the same only if they include waiting payments of their own.
7. **Given** a payment was sent and the server confirmed it, **When** the account screen is opened, **Then** the payment is in the entries with a normal ledger entry and the pending-sync label is gone.
8. **Given** a payment is waiting, **When** the supplier tries to issue an invoice with a payment received now, reverse an entry, add an opening balance or an adjustment, or open a statement while offline, **Then** the screen says "Needs the internet" and does nothing.

---

### User Story 3 - The backup and the phone copy carry waiting payments, and nothing else about money (Priority: P2)

The Module 009 backup file gains the waiting payments (store, amount, date, reference, key, state) so that payments recorded offline are as safe as waiting orders. It never gains a balance, an invoice, a ledger entry, a cost, a margin or a profit. Restoring a backup shows the payments first, like orders, and never applies a payment twice.

**Why this priority**: A waiting payment is money. If the phone is lost before it is sent, the backup is the only protection.

**Independent Test**: Export a backup with waiting payments, clear the phone's data, restore the backup, go online: each payment is recorded once, even if some had already been sent before the phone was cleared.

**Acceptance Scenarios**:

1. **Given** waiting payments on the phone, **When** the supplier exports a backup, **Then** the file lists them and the screen says how many payments and what total are in it.
2. **Given** a backup file from Module 009 (without payments), **When** it is restored, **Then** it still works exactly as before.
3. **Given** a restored backup that contains a payment the server already recorded, **When** it is sent, **Then** the server returns the stored payment and no second payment exists.
4. **Given** any backup file or phone copy, **When** it is searched, **Then** it contains no balance, invoice, ledger entry, purchase price, MRP, cost, margin or profit.

---

### User Story 4 - A recorded check of everything built (Priority: P2)

The owner gets one document that shows, for each of the 31 test items of the master prompt's Section 17 and each of its 16 final acceptance criteria, which named test covers it, whether it is only partly covered, or whether it was dropped with voice ordering. Every real gap is closed with a test or reported as a limitation, in plain words. A security review is recorded too: row level security on every table, every API route needing a signed-in business user, no secret in browser code, the result of a dependency audit, and the backup and phone copy checked for forbidden data.

**Why this priority**: This is how the owner can trust that "all done" means something, and it is the final deliverable list the master prompt asks for.

**Independent Test**: Open the table: every one of the 47 rows names a test file (or a limitation or "dropped"), and running the named tests passes. Run the security checks: they pass, and the audit result is written down with its real output.

**Acceptance Scenarios**:

1. **Given** the traceability table, **When** a row says "covered", **Then** the named test exists and passes when run; a row without a test says "limitation" or "dropped" and explains why.
2. **Given** a table in the database, **When** the audit runs, **Then** row level security is on and the table carries the business id, or the table is listed as a deliberate exception with its reason.
3. **Given** each API route, **When** it is called without a session, **Then** it answers 401 (or is listed as public on purpose, such as the connectivity check, with its reason).
4. **Given** the browser code and the build output, **When** they are searched, **Then** no service-role key, secret or AI key is found.

---

### User Story 5 - Honest warnings and a way back into the account (Priority: P3)

When the offline worker cannot start because the address is not secure (a plain `http://` address other than localhost), the app says so visibly instead of failing silently when the signal drops. The owner can reset a forgotten password from the sign-in screen: an email with a link opens a reset page in the app where a new password is set; the app never shows, asks for or sends the old password.

**Why this priority**: Both were met in real use (the phone trial lost time on the first, and the owner could not sign in on the second). They are small but they decide whether the owner can recover alone.

**Independent Test**: Open the app on a non-secure address: a warning explains offline will not work there and how to fix it. Request a reset: the email arrives, the link opens the reset page, a new password is accepted, and signing in with it works.

**Acceptance Scenarios**:

1. **Given** the app is opened on `http://192.168.x.x` (not localhost, not https), **When** the signed-in screens load, **Then** a notice says the offline mode cannot start on this address and what to use instead; on `https://` or localhost no such notice appears.
2. **Given** the sign-in screen, **When** the owner chooses "Forgot password" and enters their email, **Then** the screen says an email was sent if the address is known, with the same wording whether or not the address exists (no way to find out which emails have accounts).
3. **Given** a reset link, **When** it is opened, **Then** a page asks for a new password twice, enforces the minimum rules, and on success signs in or asks to sign in; an expired or used link says so and offers a new one.

---

### User Story 6 - Reliable tests, a re-measured Reports speed and final documentation (Priority: P3)

The shared test clean-up helper no longer hides a delete error: it deletes big tables in batches and fails loudly if something remains, and scale tests clean up after themselves. The Reports speed with 5,000 invoices is measured again, and a covering index and a statistics step are added only if the measurement needs them, with the real numbers written down. The README gets a final section: what is implemented, what is not, Supabase setup with every migration in order (and the note that 0009 and 0010 belong to the dropped voice work), the offline and sync guide, the backup and restore guide (with a restore tried once on real data), and instructions for deploying to an `https://` host.

**Why this priority**: These make the next changes safe and the hand-over honest, but do not change what the supplier does day to day.

**Independent Test**: Run a scale test: no rows are left in the test project afterwards. Read the README with a clean checkout in mind: every step to set up Supabase and run the app is there in order.

**Acceptance Scenarios**:

1. **Given** a test tenant with 50,000 rows, **When** it is removed by the shared helper, **Then** it either succeeds completely or the test fails with the table and the error; it never reports success while rows remain.
2. **Given** the 5,000-invoice data set, **When** the sales report is measured, **Then** the warm median and the cold first call are recorded; if the warm median is above 2 seconds, the index and statistics step is added and the numbers are measured again.
3. **Given** the README, **When** a new person follows the setup steps, **Then** they apply every migration in order, know why 0009 and 0010 are not in the repository, and can start the app.

---

### Edge Cases

- The phone's clock is wrong: the supplier enters the payment date (it is checked against the phone's Pakistan date); the server refuses a date in its future when it arrives and the payment goes to the conflict panel with that reason, not lost.
- A waiting payment and the same payment already recorded online by mistake (the supplier recorded it again with a new key): they are two payments with two keys; nothing can tell they are the same, so the screen shows the waiting payment next to the store's recent entries when online, before sending.
- Many waiting payments for one store (for example 30): they are sent in order and the pending-sync note shows the count and total.
- Payments for two businesses on one phone: each business has its own device database; a payment is never visible to or sent for the other business.
- The store was renamed or made inactive on the server while a payment waited: the payment is still sent to that store (it exists); only a deleted or unknown store is a conflict.
- An overpayment: it is kept as an advance by the server as before; offline, the screen does not guess whether the payment will become an advance.
- The supplier signs out with waiting payments on the phone: the existing sign-out protection for waiting items covers them (they are listed and must be confirmed or exported first).
- A newer app version wrote the device database: the existing "newer schema" protection keeps it untouched.
- A backup restored on a phone that already has waiting payments with other keys: both sets are kept; keys decide what is a duplicate.
- Password reset for an email with no account, a reset link opened twice, or a reset requested many times: the same neutral message, one use per link, and a rate limit set by the authentication service.
- The security audit finds a table without row level security: this is a defect to fix in this module (a migration numbered 0012 or higher), not a note.
- A traceability row has no test: a test is added, or the row says limitation with a reason; it is never marked covered without a test.

## Requirements *(mandatory)*

### Functional Requirements

**Part A: offline payments**

- **FR-001**: The supplier MUST be able to record a cash payment for a store with no internet. The payment MUST follow the same rules as online: an amount above zero with at most two decimals, a date that is not in the future and not before 2000-01-01, an optional reference, and a key created on the phone once per payment so that sending it twice records it once. A refusal MUST use the same wording as online and save nothing.
- **FR-002**: A payment recorded without the internet MUST be kept on the phone as a waiting payment until the server confirms it. It MUST be shown as Waiting, MUST NEVER be described as recorded, saved to the account or synced before the server confirms, and MUST survive closing the app, a restart of the phone and several tabs.
- **FR-003**: Record payment MUST be reachable offline (from the offline home), with the store chosen from the stores kept on the phone, including a store made on the phone that is still waiting. Offline it MUST NOT show a balance or a "what this payment settles" preview that it cannot know; it MUST say these are worked out by the server when the payment is sent.
- **FR-004**: Waiting payments MUST be sent automatically by the existing sending machinery of Module 009: one request at a time, in the order recorded within each store (a payment waiting for its retry never holds back another store's payment), with the same waits that grow after failures, one sender across tabs, a resend after a lost answer with the same key, and the same sync status screen. A payment for a store that is itself waiting MUST be sent only after that store exists on the server.
- **FR-005**: The server side MUST remain the existing idempotent payment function: repeating a key with the same content returns the stored payment and records nothing new; the same key with different content is refused. No new way to write ledger entries MUST be added.
- **FR-006**: A payment the server cannot accept (the store does not exist on the server, the key was used for different content, an amount or date the server refuses) MUST be shown in the existing conflict panel with the reason and the supplier's choices (keep it for later, or remove it after a confirmation that names the amount and store). It MUST NEVER be dropped silently and MUST NEVER be applied to another store.
- **FR-007**: A waiting payment MUST NEVER be removed from the phone without the supplier's explicit confirmation, and a payment whose request may already have reached the server MUST NOT be removable until the server has answered (it can only be sent again safely).
- **FR-008**: While a store has waiting payments, any balance shown for it MUST carry the label "pending sync" and a line stating how many payments are waiting and their total, and MUST say they are not counted yet; the account screen MUST also list the store's waiting payments (amount, date, reference) so a payment is not recorded twice by mistake. A balance MUST NEVER be computed on the phone from waiting payments and presented as the store's balance. The Home total owed MUST say it excludes waiting payments while any exist. Customer-facing printouts (the invoice and the store statement) are the exception: they show only the server's entries and never mention what is waiting on one phone.
- **FR-009**: The phone MUST keep no balance of any store, as in Module 009 (the owner's choice of 2026-11-24, option A). Offline, a store's screen and the sync status MUST show only the waiting payments ("N payments waiting, PKR X, not counted yet"), never a balance. A balance is shown only online, from the server, with the pending-sync note of FR-008 while payments are waiting.
- **FR-010**: Issuing an invoice (with or without a payment received now), reversals, opening balances, adjustments, statements and the other store account screens MUST remain online only and MUST say "Needs the internet" offline.
- **FR-011**: The device copy and the Module 009 backup file MUST gain only the waiting payments (store, amount, date, reference, key, state and reason). They MUST NOT contain a balance, an invoice, a ledger entry, a purchase price, an MRP, a cost, a margin or a profit. A backup made by Module 009 MUST still restore unchanged, and restoring a backup MUST show its payments first, never apply a payment twice (keys decide) and never overwrite a newer waiting or sent payment.
- **FR-012**: The device storage MUST be upgraded without losing any waiting order, store or payment; a device database written by a newer version MUST stay untouched with the existing message. The sign-out protection for waiting items MUST list waiting payments.
- **FR-013**: Payments of one business and one store MUST never be visible to, sent for or applied to another business or store; the device database stays one per business.

**Part B: hardening**

- **FR-014**: A traceability table MUST list the 31 test items of master-prompt Section 17 and the 16 final acceptance criteria, each marked covered (naming the test file), partly covered (saying what is missing), or dropped with voice (saying so). Every row marked covered MUST name a test that exists and passes when run. Every real gap MUST be closed with a test or reported as a limitation.
- **FR-015**: A security review MUST be recorded with its real results: row level security on every table that carries business data and every table listed (or its exception explained); every API route answering 401 without a session or listed as public with a reason; no service-role key, AI key or secret in browser code or in the build output; a dependency audit run with its output summarised and any high or critical finding fixed or explained; and the backup file and phone copy checked for forbidden data. A table without row level security found by the review MUST be fixed in this module.
- **FR-016**: When the offline worker cannot start because the address is not secure, the app MUST show a visible notice saying so and what to use instead; on a secure address or localhost it MUST NOT.
- **FR-017**: The owner MUST be able to reset a forgotten password from the sign-in screen with an emailed link and a reset page in the app. The request MUST give the same answer whether or not the email has an account; the link MUST work once and expire; the app MUST NEVER ask for, show or send the old password; a password shorter than 8 characters, or one that does not match its confirmation, MUST be refused with the rule shown.
- **FR-018**: The shared test clean-up helper MUST fail loudly (naming the table and the error) or delete in batches that cannot time out; it MUST NEVER report success while rows remain. Every scale test MUST remove its own data and the test project MUST be left with no rows from it.
- **FR-019**: The Reports speed with 5,000 issued invoices MUST be measured again (warm median and cold first call, on the test project). If the warm median of any report exceeds 2 seconds, a covering index and a statistics step MUST be added and measured again; otherwise none is added. The real numbers MUST be recorded.
- **FR-020**: The README MUST end with a section listing what is implemented and what is not, Supabase setup with every migration in order and the reason 0009 and 0010 are absent from the repository, the offline and sync guide, the backup and restore guide (with a restore tried once on real data and its real result), and deployment instructions for an `https://` host. Instructions only: nothing is deployed in this module.
- **FR-021**: Everything new MUST keep loading, error with Retry and empty states, work at 360 px width without sideways scrolling, use controls of at least 44 by 44 px, be written in English and pass lint, type check and build; no result MUST be claimed unless it was run.

### Key Entities *(include if feature involves data)*

- **Waiting payment**: A payment recorded on the phone: store, amount, date, reference, the key created once on the phone, a state (waiting, sending, synced, conflict) and a reason. It becomes a normal ledger payment only when the server confirms it.
- **Payment conflict**: A waiting payment the server could not accept, with the reason and the supplier's choices; shown in the existing conflict panel.
- **Pending-sync note**: The label and the line "N payments waiting, PKR X, not counted yet" shown wherever a balance is shown for a store with waiting payments.
- **Traceability table**: One row per master-prompt test item and acceptance criterion with its status and the named test.
- **Security review record**: The real results of the checks of FR-015.

## Assumptions

- Only cash payments are recorded offline, as online (the payment method value stays for later).
- The order a payment is allocated in is decided by the server from the ledger entries as in Module 007 (oldest unpaid item first); because credits form one pool, the time a payment is sent does not change how it is allocated, so unsent invoices cannot exist (invoices are online only).
- A payment for a store made on the phone and still waiting is allowed, because orders for it are already allowed; it follows the store in the sending order.
- Sending uses the existing sender, conflict panel, sync status screen and sign-out protection; payments are one more kind of waiting item, not a second system.
- The device database gets a new stored kind of record for payments with an upgrade step; the backup file format version is raised and older files still restore.
- The password reset email is sent by the authentication service the project already uses; the owner configures its email settings (for example the sender and the link address) in the Supabase project, and the reset page works on any address the app is served from. Sending reset emails from a local network address needs the Supabase redirect list to include it.
- The traceability table lives with the module's documents and is updated by tests added in this module, not by changing earlier modules' specs.
- This module supersedes FR-028 of Module 009 ("the backup holds no payments"): the backup now holds waiting payments only, and nothing else about money.
- Customer-facing printouts (invoice, Account Summary, statement) are documents for the store: they show only the server's entries and are not changed by what waits on one phone.
- Deployment is out of scope; the owner will trial on the current setup first. The deployment instructions are for later.
- Any new migration is numbered 0012 or higher.

## Out of Scope

Deployment itself; voice or any AI; parsing pasted WhatsApp text; medicine nicknames; barcode scanning; multi-user roles; tax or accounting exports; offline invoice issuing; offline reversals, opening balances and adjustments; new report types; changing the cost rule of Module 010; amending the constitution or creating ADRs without the owner's approval (the Principle II wording note and an ADR for Modules 010 and 011 stay offered to the owner).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In tests with the phone offline, 100% of saved payments are still on the phone after the app is closed and reopened, a restart, and two tabs, and none is ever described as recorded or synced before the server confirms.
- **SC-002**: Across tests that include lost answers, repeated sends, two tabs and a restart mid-send, every waiting payment exists exactly once in the ledger, in the right store (0 duplicates and 0 misapplied payments in every run).
- **SC-003**: Every refusal case (store not on the server, key reused with different content, refused amount or date) ends in the conflict panel with its reason; 0 payments are dropped silently.
- **SC-004**: While any payment is waiting, 100% of the app's own screens that show that store's balance (the account screen, the accounts list, the Home total and the Reports balances) carry the pending-sync label and the waiting count and total, and no screen shows a balance computed from waiting payments.
- **SC-005**: A backup with waiting payments restores them all on a cleared phone, and after sending, each exists once on the server even when some had been sent before (tested with each case); a Module 009 backup restores unchanged.
- **SC-006**: A search of every backup file and phone copy made in tests finds no balance, invoice, ledger entry, purchase price, MRP, cost, margin or profit.
- **SC-007**: The traceability table has 47 rows; every row marked covered names a test that exists and passes; the count of covered, partly covered, dropped and limitation rows is stated.
- **SC-008**: The security review finds every table with row level security on (or a listed exception), every API route answering 401 without a session (or listed as public), and no secret in browser code; the audit output is recorded; zero unresolved high or critical findings remain unexplained.
- **SC-009**: On a non-secure address the warning appears in 100% of tested cases and never on a secure address; a password reset completed from the emailed link lets the owner sign in with the new password, and a reused or expired link is refused with a clear message.
- **SC-010**: After every scale test, the test project holds 0 rows from it; the shared clean-up helper fails the test when a delete fails.
- **SC-011**: The Reports warm median with 5,000 invoices is at or under 2 seconds in the recorded measurement, or the index and statistics step is added and the new measurement is recorded.
- **SC-012**: A person who only reads the README can apply every migration in order, start the app, understand the offline and backup guides and know what is not implemented; the restore described was actually run once and its real result is written.
- **SC-013**: The owner can record a payment on their own phone with the signal off and see it recorded on the server after the signal returns, with the amount unchanged (the owner's trial, recorded as reported, not seen).
