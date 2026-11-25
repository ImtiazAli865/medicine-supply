# Research: Hardening and Offline Payments (Module 011)

Date: 2026-11-24. Every decision below was checked against the real code on master (a010bec): the sync centre (`src/lib/device/sync-center.ts`), the device schema, the backup file code, the payment dialog and ledger function (migration 0008), the proxy and the auth pages.

## What already exists and is reused

| Need | Where it already lives | Notes |
|------|------------------------|-------|
| A queue for waiting items, with backoff, one sender across tabs, a sync status screen and sign-out protection | `SyncCenter` (drafts and "store operations") | Store operations are a small, proven queue: persisted record, send in recorded order, remove after the server confirms. Payments follow the same pattern. |
| An idempotent server write | `ledger_payment_add` (0008) and `POST /api/accounts/{storeId}/payments` | The entry id is the key. Same key and same content: returns the stored entry (`replayed: true`). Same key, different content: `request_reused`. Unknown store: `not_found`. Bad amount or date: `invalid_amount`, `invalid_date`. |
| Payment rules | `RecordPaymentDialog.tsx` (amount, date, reference) and the Zod schema | The rules move into one shared pure function so the offline form cannot drift from the online one. |
| Device storage with upgrades | `db.ts`, `schema.ts` (`SCHEMA_UPGRADES`, version 1 today) | A new object store is a version 2 step; an older database upgrades in place and a newer one stays untouched (existing protection). |
| Backup file | `file.ts` (format `medsupply-backup`, version 1, strict Zod, forbidden-key check) | Gains one array; a version 1 file must still restore. |
| Offline shell | `OfflineShell.tsx`, `shell-route.ts` | `/accounts` is a "blocked area" there today; the shell gets its own Record payment screen. |
| Guards | `offline-no-price.test.ts`, `FORBIDDEN_KEY` in `file.ts` | Both forbid the word "payment" on the device today. They are changed on purpose, narrowly (D4). |

## Part A decisions: offline payments

### D1. Waiting payments are one more queue in the sync centre, not a second system

- **Decision**: add a persisted record kind `PaymentOp` (device object store `paymentOps`, keyed by the payment id) beside `storeOps`. The sync centre sends payment operations one at a time, in the order recorded **within each store**, after the stores operations (a payment waiting for its retry holds back later payments of the same store only; credits form one pool, so another store's payment never has to wait, as an unrelated draft never waits), only when the connection is up, this tab is the sender and sending is not paused. Waits between tries are the existing 2 s, 5 s, 15 s, 45 s, 2 min. A payment for a store that is itself still waiting is held until that store operation is gone.
- **Why**: it gives leader election, backoff, pause, the 401 handling, the status screen and the sign-out protection for free and keeps one set of rules.
- **Alternatives rejected**: (a) a separate sender (a second set of locks and timers, easy to get wrong with two tabs); (b) putting payments into the draft journal (drafts are editable documents with versions; a payment is append-only).

### D2. The key is created once, before anything is sent, and the attempt is recorded before the send

- The payment id (a UUID made on the phone when the form opens) is the ledger entry id and the request id, exactly as online. The record is written to storage with `attempted = false`; **before the first send it is rewritten with `attempted = true`**, so after a crash the sender repeats the same request. Rule: a payment with `attempted = true` and no answer cannot be removed on the phone (it may already be on the server); it can only be sent again.
- A payment whose store is renamed or made inactive is still sent (the store exists); only a store the server does not know is a conflict.

### D3. What the server answers, and what the phone does with it

| Server answer | Phone state | What the supplier sees |
|---------------|-------------|------------------------|
| 200 `done` (new or `replayed`) | removed from the queue (synced) | nothing more; the account screen shows the entry |
| network error, timeout, 5xx | waiting, retry with the backoff | "Waiting, will try again" |
| 401 | waiting, sending paused for sign-in | the existing "Sign in again" notice |
| `not_found` (store not on the server) | conflict | "The store is not on the server" |
| `request_reused` | conflict | "A payment with this key but other details already exists. Check the store's account." |
| `invalid_amount`, `invalid_date`, `reference_too_long` | conflict | the server's reason |

- Conflict choices (never automatic): **Keep for later** (stays in the list, not sent until Retry) or **Remove** after a confirmation that names the amount and the store. For a refusal that recorded nothing (amount, date, reference) the supplier may also correct the details and send again with the same key (safe, nothing was recorded); for `request_reused` and `not_found` no edit is offered.
- **Remapping**: when a similar-store answer makes the supplier "use the existing store", the waiting payments of the pending store move to the existing store's id in the same step, as orders already do.

### D4. The device may now hold payments, and the guards are narrowed, not removed

- Module 009's static guard forbids the words purchase price, MRP, cost, margin, profit, balance, invoice, ledger and payment in all device code. Waiting payments need the word "payment". The guard is changed so that **only the files of the payment queue** may contain "payment" (an explicit list, named in the test), while every other forbidden word stays forbidden everywhere, including in those files. The words "balance", "invoice" and "ledger" therefore never appear on the device (the screens use "what this payment settles" and "not counted yet").
- The backup keeps its forbidden-key check at every depth. The array is called `waiting.payments` and the check allows the key `payments` **only at that path** and only its own fields (`storeId`, `amount`, `date`, `reference`, `paymentId`, `syncState`, `reason`). A `balance`, `invoice`, `ledger` or cost key anywhere still fails the check.

### D5. No balance on the phone (owner's choice, option A)

- The phone never stores or computes a balance. Offline, the store picker and the waiting list show amounts the supplier typed; the form says "The server works out what this payment settles when it is sent."
- **Pending-sync note online**: the account screen, the accounts list, the Home total and the Reports balances read the waiting payments from the device (via the offline provider) and show "N payments waiting on this phone, PKR X, not counted yet" with the label **pending sync**. X is the exact sum of the typed amounts in integer paisa (an addition of typed values, not a balance). The Home total says it excludes waiting payments. When a payment is confirmed the screens refetch.
- **Customer-facing printouts** (invoice, Account Summary, statement) never mention waiting payments (spec assumption).

### D6. Where the supplier records a payment offline

- The offline home gets a **Record payment** button. A new shell route `payment` shows: a store picker built from the stores on the phone (including stores still waiting), amount, date, optional reference, Save, and below it the list of waiting payments of that store with a Remove button (with the confirmation of FR-007). `/accounts` stays a blocked area for everything else.
- Online, the existing Record payment dialog is unchanged (preview, immediate save). If its save fails with a **network** error, it offers **Keep it on this phone and send later**, which queues the payment with the same id the dialog already holds. If the first request had in fact reached the server, the later send is a replay and records nothing.

### D7. Storage and backup versions

- Device schema **2** adds the object store `paymentOps`; the upgrade runs for any version 1 database without touching the others. An unavailable or newer-schema database keeps today's behaviour.
- Backup file **version 2** adds `waiting.payments` and counts; the reader accepts version 1 (no payments) and 2; a file with a newer version is refused with the existing message. Restoring a payment queues it as waiting if its id is not already on the device; the server's idempotency makes a payment that was already recorded a harmless replay, so the preview marks each payment "new on this phone" or "already on this phone" and says that a payment the server already holds is not recorded twice.

### D8. No server change for payments

The server functions, routes and RLS stay as they are. There is no migration for Part A. A migration 0012 is planned only if the RLS audit (D13) or the speed measurement (D16) finds something to fix; none is expected.

## Part B decisions: hardening

### D9. The traceability table is a document checked by a test

`specs/011-hardening-offline-payments/traceability.md` has 47 rows (31 test items, 16 acceptance criteria). A unit test parses it and fails if a row is missing, a status is not one of covered, partly covered, dropped with voice or limitation, a covered row names no test file, or a named test file does not exist. It proves the table is complete and its files exist; that the named tests pass is shown by the full test run recorded in the quickstart.

### D10. Security review: automated where it can be, recorded where it cannot

- **Routes**: a unit test scans every `src/app/api/**/route.ts` and fails if one does not call the signed-in-business check, except an explicit allow-list (`ping`, and the three new password-reset routes, with their reasons). An integration test calls a sample of routes without a session and expects 401.
- **RLS**: a PGlite test applies every migration and asserts that every table with a `business_id` column has row level security enabled and at least one policy, with an explicit list of exceptions and reasons; the existing `rls_audit()` function is also run on the TEST project and its output recorded.
- **Secrets**: the existing `check-secrets` lint step stays; a test scans the built browser bundles (`.next/static`, when a build exists) for the service-role key pattern, AI key names and any `.env` value.
- **Dependencies**: `npm audit` is run and its real summary recorded; a high or critical finding is fixed or explained.
- **Backup and phone copy**: the existing forbidden-data tests are extended to payments (D4).

### D11. A warning when the offline worker cannot start

The provider already knows whether it registers the worker. A non-secure address (`window.isSecureContext` false, in a production build) shows a visible, non-blocking notice in the app shell: "Offline mode cannot start on this address because it is not https. Use the https address of the app (or localhost on a computer) to work without the internet." A secure address or localhost never shows it. A failed registration on a secure address shows a second, different sentence.

### D12. Password reset with a cross-device link

- **Decision**: three routes: `/forgot-password` (public page: email box), `/auth/confirm` (public route handler: verifies a recovery token hash and then goes to the reset page), `/reset-password` (page for a signed-in recovery session: new password twice, `updateUser`). The email template of the Supabase project is set to link to `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
- **Why the token-hash link**: the default link uses a code that only works in the browser that asked for it; the owner may ask on a computer and open the email on the phone.
- **Safety**: `type` is accepted only as `recovery`; no `next` parameter (no open redirect); the same neutral answer whether or not the email exists; one use per link and expiry are Supabase's; rate limits are Supabase's; the app never asks for or shows the old password; the form enforces a **minimum of 8 characters** (stricter than the project's own minimum of 6 in `config.toml`) and shows the rule.
- **Owner setup**: edit the "Reset password" email template, add the app's address to the redirect list, and know that Supabase's built-in email sender only mails project members and has a small hourly limit (custom SMTP lifts it). These steps go into the guides.
- **Alternative rejected**: a generated password shown on screen (insecure) or an admin-only reset (the owner is the admin).

### D13. Test infrastructure

- **Tenant clean-up**: the shared `deleteTenant` helper ignores every delete error, and it does not know every table: a read-only look at the TEST project (2026-11-24) showed that `business_settings` (made for every business) and the voice tables `voice_parse_attempts` and `voice_diagnostics` (from the dropped voice work, present only on TEST and DEV) are never deleted, so the business row can never be deleted and 169 test businesses are left behind. A loud helper that only reports errors would fail every test at teardown. It is therefore rewritten to **discover** the tables: it reads the list of tables that carry a business id from the existing `rls_audit()` function (once per test process, cached), deletes them in passes (the known safe order first, then any table it did not know), repeating a pass for the tables that failed because another table still referenced them, stops when a pass makes no progress, deletes each table in batches of at most 500 ids with halving on a timeout, and finally deletes the business row. Any table that still errors, or a business row that cannot be deleted, makes it throw one error naming every table and message. A small tenant costs one extra cached request and one plain delete per table.
- **Scale tests** clean up in batches themselves (already done for Reports); the others (`invoices-scale`, `accounts-scale`, `pending-scale`, the fast-entry and offline scale tests) are audited and given the same final check that the tenant is gone.
- **Leftover sweep**: the TEST project holds old leftover test businesses (169 today, 121 named `e2e-fresh business`). A small script lists them (dry run by default) and removes them in batches only when run with `--delete` and only for the known test labels. It runs once, with the owner's yes, as it deletes data on the TEST project.

### D14. Reports speed: measure first, change only on evidence

The existing 5,000-invoice test already gives warm medians of 1.3 to 2.0 s and a cold first call of 3.1 to 4.8 s. This module repeats it three times on a quiet project. **Rule**: if every report's warm median is at or under 2 s, nothing is added; if one is over 2 s in two of three runs, migration `0012` adds a covering index on `invoice_lines` and the measurement is repeated. The cold first call is reported, not hidden.

### D15. Documentation

New folder `guides/` (the repository's `docs/` holds the owner's source documents and is not touched): `supabase-setup.md` (every migration in order, the 0009 and 0010 note, seed, the password-reset email setup), `offline-and-sync.md`, `backup-and-restore.md` (with the restore drill), `deployment.md` (instructions for an https host; nothing is deployed). The README gets a final "Status" section: implemented, not implemented, limits, links to the guides.

### D16. The restore drill

A real restore is tried once: the owner exports a backup from the phone that has real data, clears the site data, restores the file, goes online and checks that orders, stores and waiting payments are back and recorded once. An automated browser test does the same with test data (including payments). The owner's trial is recorded as reported, not seen.

## Risks to watch

1. **Two writers of one payment** (two tabs, or the online dialog and the queue): the same id makes it one payment; tests cover it.
2. **A guard that is too loose**: the narrowed word list must still catch "balance", "invoice" and "ledger" in the payment files; a test plants each word and expects a failure.
3. **The phone clock**: a wrong date is caught by the server on arrival and becomes a visible conflict.
4. **Email delivery** for the password reset depends on the owner's Supabase email setup; the guide says exactly what to set, and the reset flow is tested with a mocked verification, then tried once for real by the owner.
5. **Large test runs** share the TEST project; scale tests are run alone.

## Needs the owner's approval later

- Running the one-time leftover sweep on the TEST project (it deletes test data).
- Editing the "Reset password" email template of the DEV project (and later the production project).
- An ADR for the offline payment queue and the pending-sync note (suggested, not created), and the optional wording clarification of constitution Principle II from Module 010.
