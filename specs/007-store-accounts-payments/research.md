# Research: Store Accounts (Khata), Payments, Account Summary and Store Statement

**Feature**: 007-store-accounts-payments | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

All decisions below were checked against the merged code of Modules 001 to 006 (`supabase/migrations/0001` to `0007`, `src/lib/invoices`, `src/lib/money.ts`, `src/lib/settings`, the invoice screens and the test helpers) and against the master prompt (store ledger section, Account Summary section, Section 17 items 16 and 25 to 29) and the constitution (Principles II and III). The spec has no open clarifications (the three owner decisions were taken in chat on 2026-11-16); this file records the technical choices and what was rejected.

## Facts found in the existing code (they shape the decisions)

1. `invoice_issue(p_id uuid, p_expected_version int)` and `invoice_cancel(p_id uuid, p_reason text)` are `SECURITY DEFINER` functions that take an advisory lock on the invoice, then on the order, then (issue only) the counter row. Both return `{done, replayed, invoice}` or `{done: false, reason}`; a replay returns early before any write.
2. `invoices_guard` lets a draft change freely, lets an issued invoice change only to `cancelled` (comparing the whole row as JSON with a short ignore list: status, the three cancellation columns, `updated_at`, `version`), and refuses every change of a cancelled one. Any new column on `invoices` is therefore frozen after issue without touching the trigger, as long as it is set in the same update that issues the invoice.
3. `invoice_json` is `SECURITY INVOKER` and is the only place that shapes an invoice for the screens and the print page; `invoice_list` has an eight-argument signature that the repository calls by name.
4. Money is `numeric` in the database and a decimal string in TypeScript; `src/lib/money.ts` accepts at most ten whole digits and two decimals (9,999,999,999.99) and does exact paisa arithmetic (`parseMoneyToPaisa`, `subtractMoney`, `compareMoney`, `formatPKR`). `invoice` amounts are `numeric(18,2)`.
5. `business_settings.account_summary_default` (boolean, default false) already exists (Module 002) and is already on the Settings screen. Nothing is added to Settings.
6. Stores have `is_active`; archiving hides a store from pickers but its rows remain. Composite keys `(business_id, id)` are used on every business table; `set_row_meta()` maintains `updated_at` and `version`.
7. The invoice print page is a server page with a toolbar of real links (`?layout=a4|thermal`); the thermal page injects the `@page` width from Settings. The same approach carries the Account Summary box (`?summary=`) and the statement page.
8. The existing e2e and Supabase tests call `invoice_issue` with two arguments and read `invoice_json` output; test cleanup (`deleteTenant`) deletes invoice tables first, so the ledger table must be deleted before invoices.
9. `createTestDb()` applies every migration file in order. To test an invoice issued before this migration, the helper needs a staged option (apply up to `0007`, build data, then apply `0008`).

## D1. One append-only table, `ledger_entries`

- **Decision**: a single table holds all five entry kinds. Columns: `id` (the client key), `business_id`, `store_id`, `seq` (an identity number that gives the order of recording), `entry_type`, `entry_date`, `debit`, `credit`, `invoice_id`, `reverses_entry_id`, `payment_method`, `reference`, `note`, `created_by`, `created_at`. A payment is an entry of type `payment`; there is no separate payments table. Check constraints give each type its shape (an invoice entry is a debit with an invoice; a payment is a credit with a method; an adjustment and a reversal carry a reason; exactly one of debit and credit is above 0).
- **Rationale**: the master prompt says "one entry per event"; a second payments table would be a second source of truth for money received and would need its own idempotency and RLS. The "related invoice or payment" of the prompt is the entry's own id.
- **Rejected**: separate `payments` and `adjustments` tables (more joins, two places to lock and to test); a stored `balance` column per store (forbidden by the constitution).

## D2. The store can never be wrong: composite foreign keys

- **Decision**: `invoices` gains `unique (business_id, store_id, id)`; `ledger_entries` has `foreign key (business_id, store_id, invoice_id) references invoices (business_id, store_id, id)` and `foreign key (business_id, store_id, reverses_entry_id) references ledger_entries (business_id, store_id, id)` (which needs `unique (business_id, store_id, id)` on the ledger itself). `(business_id, store_id)` references `stores`.
- **Rationale**: "never apply one store's payment to another store" becomes true by structure: a payment entry cannot point at another store's invoice, and a reversal cannot point at another store's entry, whatever code runs. This is the same idea as the composite business keys of earlier modules.

## D3. Allocation is computed, oldest first, opening balances first

- **Decision**: `ledger_allocation(p_biz, p_store)` returns one row per open debit item with `amount`, `allocated`, `outstanding` and a status. Items are entries with a debit above 0 whose type is `opening_balance`, `invoice` or `adjustment`, **not reversed** (no reversal entry points at them). The credit pool is the sum of the credits of entries of type `payment`, `opening_balance` (the store paid in advance) and `adjustment`, also not reversed. Reversal entries are left out of both sides, so a reversed entry and its reversal net to zero. Items are ordered by `(type rank, entry_date, seq)` where an opening balance has rank 0 and everything else rank 1. Each item receives `least(amount, greatest(0, pool - cumulative amount of the earlier items))`, computed with one window function over the ordered items. Status: allocated equal to the amount is `paid`; allocated 0 is `unpaid`; anything between is `partially_paid`.
- **Rationale**: it is set based (no loop), exact, and gives the master prompt rule "the opening balance, then invoices by date". An advance needs no special code: credits beyond all debits simply wait in the pool and settle the next debit that is added, which is "applied automatically to the next invoice".
- **Why the opening balance sorts first even when its date is later**: the supplier will usually type the old udhaar "as on" today because the real date is unknown; sorting by date alone would let today's invoice be settled before the old balance, which is the opposite of the owner's rule. The spec (FR-013) is worded accordingly.
- **Rejected**: storing an allocation table (it would have to be rebuilt after every reversal and could drift); allocating each payment to one invoice at entry time (the spec says a payment belongs to the account).

## D4. The balance and the shared definitions

- **Decision**: balance = sum of `debit` minus sum of `credit` over all entries of the store (a positive number means the store owes the supplier; a negative number is an advance). Two internal invoker functions are the only definitions: `ledger_balances(p_biz)` (one row per store with its balance) and `ledger_allocation`. The stores list, the Home total, the account screen, the statement, the payment preview and the invoice json all read them, so the Home number and the list can never disagree (the rule of ADR-0004 point 10 and ADR-0005 point 1, reused).
- **Home total** = the sum of the positive balances; advances are returned separately and are not subtracted.

## D5. Exactly-once is enforced by keys the database owns

- **Decision**: opening balance, payment, adjustment and reversal calls take the client-created UUID as the entry id (the primary key is `(business_id, id)`). The same id with the same content returns the stored entry (`replayed`); the same id with different content is refused (`request_reused`). Partial unique indexes: one invoice entry per invoice (`entry_type = 'invoice'`), one reversal per reversed entry (`reverses_entry_id is not null`), and one payment per invoice (`entry_type = 'payment' and invoice_id is not null`, the payment received at issue).
- **Rationale**: exactly-once from the record's own key, the same idea as ADR-0005 point 4. The payment at issue needs no client key because its invoice's own request id already gives exactly-once, and the index makes a second one impossible even for a future code path.
- **Rejected**: a separate replay table (the entry's key is enough); relying on the screen to disable the button (the constitution forbids trusting the client for financial data).

## D6. Issue is extended in the same function

- **Decision**: `invoice_issue(p_id, p_expected_version, p_payment numeric default null)`. The old two-argument function is dropped and replaced, so there is one function. After the existing checks (status, order confirmed, not stale, something billed, every billed line priced) and before the number is taken, the function validates the payment (above 0, at most two decimals, at most 9,999,999,999.99; otherwise it refuses with `invalid_amount`, nothing changes, no number is used), takes the store's ledger lock, reads the store balance (the previous balance), and then in one transaction: takes the number, updates the invoice (status, number, date, copied details, **and the four Account Summary columns**), inserts the invoice entry (debit = the recomputed grand total, dated the invoice date), inserts the payment entry when a payment was given (credit, dated the invoice date, linked to the invoice), writes the invoice event (with the payment in its detail) and the order changes of Module 006. A replay of an already issued invoice returns before any of this, so it never records a second payment, whatever amount the repeat carries.
- **Snapshot figures**: previous = the store balance read under the lock; payment received = the payment or null; balance due = previous + grand total - payment (signed numeric; a negative value is an advance). "Balance as on" is the invoice date.
- **Rationale**: one function means one transaction: a failure anywhere rolls back the number, the invoice, the entries and the order together (SC-008).

## D7. Cancel is extended in the same function

- **Decision**: `invoice_cancel` keeps its signature. When the invoice has `in_account = true` it takes the store's ledger lock and inserts one reversal entry (credit = the invoice's grand total, `reverses_entry_id` = the invoice entry, the reason = the cancellation reason, dated the day of cancellation in Pakistan time). A payment received with the invoice is **not** touched; it stays on the account and becomes part of the credit pool (an advance if nothing else is owed). A legacy invoice (`in_account = false`) adds nothing. A replay returns before any write, so it adds no second reversal.
- **Rationale**: the spec (FR-021) says only the invoice entry is reversed; taking the money back is a different event that the supplier must record deliberately (reversing the payment with its own reason).

## D8. One lock order for the whole module

- **Decision**: invoice advisory lock, then the order advisory lock, then the store's ledger advisory lock (`ledger:<business>:<store>`), then the invoice counter row. Functions that touch only the ledger (opening, payment, adjustment, reversal) take only the ledger lock. Every function that takes more than one lock takes them in this order.
- **Rationale**: it prevents deadlocks between a simultaneous issue and payment on the same store and gives the previous balance a stable meaning (every entry recorded before this one is visible and nothing can slip in between). A test runs an issue and a payment on the same store at the same time and checks that the balance is exact and the Account Summary equals the sum of the entries before it.

## D9. The Account Summary snapshot lives on the invoice row

- **Decision**: four new columns on `invoices`: `in_account boolean not null default false`, `summary_previous numeric(18,2)`, `summary_payment numeric(18,2)` and `summary_due numeric(18,2)`. A check makes them agree with the status: a draft has `in_account = false` and all three figures null; an `in_account` invoice that is issued or cancelled has `summary_previous` and `summary_due` filled (the payment may be null); an invoice that is not in the account has all three null. They are set by the update that issues the invoice, so `invoices_guard` freezes them with every other column. **No trigger is changed**; a test updates each of the columns of an issued invoice and expects a refusal.
- **Rationale**: "the snapshot is part of the invoice" is the simplest way to make it immutable and to make a reprint read exactly one row.
- **Rejected**: a separate snapshot table (a second thing to freeze, an extra join on every print); computing the summary again at print time (it would change when payments are recorded later).

## D10. Invoices issued before this module

- **Decision**: the migration adds `in_account` with default false, so every existing issued or cancelled invoice is "not in the account" with null figures. The screens show "Not in the account", no paid status and no Account Summary for them; cancelling one adds nothing. Nothing is copied into the ledger. (Owner's choice on 2026-11-16; the assistant had recommended copying them in.)
- **Consequence**: the owner must not count those invoices again in an opening balance. The opening balance form says so, and the invoice screen explains the label. No automatic check is possible (it cannot know what the owner typed).

## D11. Reversal rules

- **Decision**: `ledger_entry_reverse(p_id, p_entry_id, p_reason)` refuses with a reason when the entry is not found, is itself a reversal (`is_reversal`), is already reversed (`already_reversed`) or is an invoice entry (`invoice_entry`, the supplier cancels the invoice instead). The reversal takes the opposite side with the same amount, carries the required reason (1 to 500 characters) and is dated today (Pakistan). An insert trigger repeats the structural checks (opposite side, same amount, same store, original not a reversal) as defence in depth.
- **Rationale**: a payment, an opening balance and an adjustment can be reversed; an invoice entry has exactly one legitimate reversal, the cancellation, which also changes the order, so it is never reversed by hand.

## D12. Dates

- **Decision**: payments, opening balances and adjustments may be dated any day from 2000-01-01 up to today in Pakistan time (`Asia/Karachi`); a later date is refused (`invalid_date`). The invoice entry takes the invoice date; a reversal takes the day it is made. The statement and the running balance order entries by `(entry_date, seq)`.
- **Consequence**: a past statement is never rewritten by a later reversal or cancellation (the reversal appears on its own day); a back-dated entry changes the running balances of old lines in the statement but never a saved Account Summary. This is stated on the statement.
- **Rejected**: dating a reversal like its original (it would silently change an old statement); free future dates (cannot be a fact yet).

## D13. Reads

- **Decision**: all reads are `SECURITY INVOKER`. `ledger_stores(p_q, p_only_owing, p_limit, p_offset)` gives stores with balance, entry count and last entry date; `ledger_summary()` gives the Home totals; `ledger_account(p_store, p_limit, p_offset)` gives the store, the balance, the advance, the open items (the invoices and opening balances still unpaid, oldest first, at most 50) and a page of entries newest first with the running balance computed over the whole account; `ledger_payment_preview(p_store, p_amount)` gives the balance after and the items the payment would settle (computed by running the same window with the amount added to the pool, nothing written); `ledger_statement(p_store, p_from, p_to)` gives the headers, the balance at the start, the entries in the range with running balance, totals and the closing balance (at most 2,000 lines, with a `truncated` flag). `invoice_json` gains `in_account`, `payment_status`, `amount_paid`, `amount_outstanding` and `account_summary`; `invoice_list` gains `payment_status` and `in_account` per row and a `payment_status` filter.
- **Performance**: the business filter is computed once and `MATERIALIZED` CTEs are used (the migration `0005` lesson). Indexes: `ledger_entries (business_id, store_id, entry_date, seq)` for the account and statement, `(business_id, store_id)` partial on debit entries for the allocation, and the three unique indexes of D5. The invoices list computes the allocation only for the stores on the page when no paid-status filter is used, and for all stores of the filtered invoices when one is used. A scale test measures 2,000 entries, 100 stores and a 1,000-invoice list with statuses (SC-012); a performance migration is added only if it is slower than the goal.

## D14. Store Statement

- **Decision**: a server page `/accounts/[storeId]/statement?from=&to=` (default: the current month to today), A4 only, with the business header and the store name, the balance at the start, a table of entries (date, type, reference such as the invoice number or the payment reference, the reason for an adjustment or reversal, debit, credit, running balance), totals and the closing balance. A short note says that Account Summaries on invoices show the balance at the moment of issue. The toolbar has a date range form and the existing print button; the browser's own "Save as PDF" is the only PDF. If the range has more than 2,000 lines the screen says so and printing is refused (never a cut statement).
- **Rejected**: server-side PDF generation (a new dependency, out of scope).

## D15. Account Summary on the print screen

- **Decision**: `?summary=1|0` on `/invoices/[id]/print`; when it is absent, the value of `account_summary_default` from Settings decides. The toolbar gets a "Show Account Summary" control built as a real link (like the layout choice), so the address always says what is on screen and both layouts carry the same choice. For an invoice that is not in the account the control is replaced by a short explanation. The block shows only: Balance as on date, Previous Balance, This Invoice, Payment Received (only when there was one) and Balance Due; an advance is written as "Advance" instead of a negative number. A and thermal layouts render the same facts.
- **Rationale**: the snapshot is always stored (D9), so showing it later never changes a number.

## D16. Screens and visibility without a sixth navigation item

- **Decision**: a Home card ("Stores owe you", the total and a link), a "Store accounts" list at `/accounts` (also reached from the Stores screen), the account screen at `/accounts/[storeId]` (also reached from each store and from the invoice screen), and the statement page. The bottom navigation keeps its five items (the rule of Modules 004 to 006). Record payment is reachable in at most 4 taps from Home (card, store, Record payment, Save; SC-015). The invoice list and screen show the paid status chip; the list filter gains "Unpaid", "Partly paid", "Paid".
- **Money in the browser**: the browser only formats and compares money with the exact paisa helpers; the balance after a payment, the allocation and every total come from the server. The only browser arithmetic is the "advance" hint on the issue dialog (payment minus invoice total), done with `subtractMoney` and labelled as informational; the server decides.

## D17. Migration `0008_store_accounts.sql` and the changes to Module 006

- **Decision**: one migration. It changes five Module 006 objects and nothing else of Modules 001 to 006: (1) table `invoices`: four columns, two checks, one unique key (`business_id, store_id, id`); (2) `invoice_json` (new keys); (3) `invoice_issue` (the extra argument, the lock, the entry, the payment, the snapshot); (4) `invoice_cancel` (the reversal); (5) `invoice_list` (the filter and two keys). Dropped and recreated because their signatures change: `invoice_issue(uuid, int)` and `invoice_list(text, uuid, date, date, uuid, text, int, int)`; the grants are repeated. A rollback note in the file header says it is safe only while no entry exists.
- **Verification**: counts of invoices, issued invoices, order lines and order events are compared before and after applying it to the TEST and DEV projects, as in Modules 005 and 006; the full Module 006 test suites are rerun because they now run against the extended functions.

## D18. Money and validation

- **Decision**: all money is `numeric`; the database checks amounts above 0, at most two decimals (`p_amount = round(p_amount, 2)`) and at most 9,999,999,999.99; the route handlers validate with Zod using the same pattern as `src/lib/money.ts` and the database repeats every check. Direction values are `owes` or `advance` for an opening balance and `reduce` or `increase` for an adjustment. Reasons and notes are 1 to 500 characters (reason required for adjustments and reversals; the opening balance note and the payment reference are optional, at most 200 and 100 characters).

## D19. Audit and history

- **Decision**: the entries are the audit trail (who, when, reason, which entry each reversal points at); no separate event table is added. The invoice event for an issue gains the payment and the account figures in its `detail`, and the order history is unchanged. A discarded draft still has nothing in the ledger because drafts never write entries.

## D20. Things deliberately not built

- Offline payments and a "pending sync" balance (Module 009); voice (Module 008); profit and reports (Module 010); bank or wallet processing; multi-user roles; discounts and taxes on invoices; returns of goods; interest, credit limits and reminders; server-side PDF; automatic copy of old invoices into the khata; deleting or archiving an account; undo of a reversal (a new entry is made instead); per-invoice payment allocation chosen by the supplier.

## Risks to revisit

1. **Statement running balances can differ from an old printed Account Summary** (D12): a later back-dated entry shows in date order. The statement says so; if it confuses the supplier, a later change can show the recording order instead.
2. **The status calculation runs on every invoice read and list** (D13): measured in SC-012; if it is slow the allocation can be restricted to the stores on the page or an index added.
3. **A double count in an opening balance cannot be detected** (D10): only the form warning protects against it.
4. **Opening balances sort first** (D3): a supplier who enters an opening balance meaning "newer than some invoices" would see the invoices settled after it. The rule matches the master prompt and the owner's wording.
5. **Lock order must be kept by every future function** (D8).
6. **A payment received with a cancelled invoice stays as an advance** (D7): the supplier must reverse it separately if the money was returned; the cancel dialog says so.
