# Quickstart and Verification Guide: Store Accounts (Khata), Payments, Account Summary and Store Statement

**Feature**: 007-store-accounts-payments | **Status**: planned, nothing implemented or verified yet

This file says how the module will be run and checked. The "Results" section stays empty until real runs exist; nothing here may be read as a claim that something passed.

## 1. Prerequisites

- Modules 001 to 006 are merged into master (Module 006 merge commit `d1ae526`, then `7e7959a`).
- `.env.local` has the DEV project values; `.env.test.local` has the TEST project values (same files as before; no secret is committed).
- Migration `supabase/migrations/0008_store_accounts.sql` is applied to the TEST project (through the owner's signed-in Supabase tab, with the owner's say-so) before the Supabase integration tests and the e2e run, and to the DEV project only when the owner asks. The migration changes five Module 006 objects (the `invoices` table, `invoice_json`, `invoice_issue`, `invoice_cancel`, `invoice_list`), so the counts of existing rows (invoices, issued invoices, cancelled invoices, order lines, order events) must be compared before and after, as for migrations 0006 and 0007. Invoices that exist before the migration must show `in_account = false` afterwards.
- Port 3000 is free for the e2e run (the e2e builds a production build against the TEST project and does not reuse a server).
- The PGlite helper `createTestDb` gets an `upTo` option so one test can issue an invoice with migration `0007` only and then apply `0008` (the "invoice issued before this module" test).

## 2. Commands (same as earlier modules)

```bash
npm run lint
npm run typecheck
npm test                  # unit + PGlite + Supabase integration
npm run test:e2e          # Playwright, mobile and desktop projects
npm run build             # run again after e2e so .next matches the DEV env
```

## 3. Manual walkthrough on a phone (owner, DEV project, after the module is built and migration 0008 is applied to DEV)

Use a test store (for example "Nimer") so nothing real is touched.

1. Open **Home**: the new card **Stores owe you** shows 0 or the total. Tap it: the **Store accounts** list opens, every store with its balance.
2. Open one store. Tap **Add opening balance**: read the warning about invoices issued before this module; enter 12,000 (the store owes), a date, and save. The balance is 12,000 and one entry is listed. Tap Save again quickly (or refresh and repeat): still one entry.
3. Create and issue an invoice for that store (for example 8,000) **without** a payment: the account shows an invoice entry and a balance of 20,000. The invoice screen shows **Unpaid**.
4. Tap **Record payment**: enter 15,000, today, a reference. Before saving, read the preview: the balance after (5,000) and which items it settles (the opening balance first, then the invoice). Save: balance 5,000; the invoice shows **Partly paid** or **Paid** as the preview said.
5. Issue a second invoice (for example 3,000) with **Payment received now** 1,000: it is issued with the next number, the account shows the invoice and the payment, and the balance is as expected (previous 5,000 + 3,000 - 1,000 = 7,000).
6. Print that invoice as **A4** and as **Thermal** with **Show Account Summary** on: Balance as on the date, Previous Balance 5,000, This Invoice 3,000, Payment Received 1,000, Balance Due 7,000. Record another payment, then print again: the summary is the same. Turn the box off: no summary.
7. Add an **adjustment** that reduces what the store owes by a small amount, with a reason; try it without a reason (refused). Then **reverse** it with a reason: both entries stay visible and the balance returns.
8. Cancel the invoice that had the payment: the reversal appears, the cancel dialog first said that the payment stays on the account. Check the balance.
9. Open an invoice issued before this module (for example one from the Module 006 walkthrough): it says **Not in the account**, has no paid status, and the print screen explains there is no Account Summary.
10. Open **Store statement** for the store and a date range: opening balance, every entry with its running balance, closing balance. Print it (A4) and check there is no cost, MRP or profit.
11. Open **Invoices** and filter by **Unpaid**, **Partly paid** and **Paid**. Check the Home total against the sum of the stores that owe in the list.
12. Time yourself: from Home to a saved payment (goal: at most 4 taps), and report any real printer result for the statement or the summary ("not tested" if none).

## 4. Master prompt Section 17 mapping

| Item | Where it is proven |
|------|--------------------|
| 16. Recording payments and calculating balances | PGlite `db-ledger-payment`, `db-ledger-statement`; Supabase `accounts-api`; e2e `account-payment` |
| 25. Ledger balance carry-forward across several invoices and payments | PGlite `db-ledger-invoice-entry` (the 20,000 / 15,000 / 8,000 / 10,000 example), `db-ledger-allocation` |
| 26. Payment allocation to the oldest unpaid item first, advance handling, no duplicate payments on retry | PGlite `db-ledger-allocation` (random sequences), `db-ledger-payment`; Supabase `accounts-concurrency` (10 simultaneous identical payments) |
| 27. Reversal entries instead of edits or deletes | PGlite `db-ledger-append-only`, `db-ledger-reversal`, `db-ledger-cancel`; e2e `account-adjust-reverse` |
| 28. Account Summary snapshot on issued invoices (on and off, A4 and thermal), no cost or profit | PGlite `db-ledger-summary`, `db-ledger-nocost`; e2e `account-summary-print` |
| 29. Issuing an invoice together with a payment received now, atomically | PGlite `db-ledger-issue-payment` (forced failure); Supabase `accounts-concurrency`; e2e `account-issue-payment` |
| 12/13. (Module 006 items still true) no cost on any customer document | PGlite `db-ledger-nocost`, e2e statement and summary text checks |
| 19. Supabase authentication and RLS restrictions | PGlite `db-ledger-rls`; Supabase `rls-accounts` (two real users) |
| 20. Responsive layouts and print output | e2e `account-statement`, `account-summary-print`, `touch-targets` |

## 5. What the automated checks must prove (summary of the plan's test list)

- **Schema**: the table has only the listed columns (no cost, price of purchase or MRP); the shape checks per entry type; exactly one side per entry; the composite foreign keys (an entry cannot point at another store's invoice or entry); the three partial unique indexes; a signed-in user cannot insert, update or delete; `ledger_insert_entry` is not executable by users.
- **Opening balance and adjustment**: either direction, any past day, a future day refused, zero, negative, three decimals and too-large amounts refused, a required reason for adjustments, replay by id, `request_reused`, and several opening balances for one store.
- **Payment**: the balance falls once; the date rules; replay by id and ten simultaneous identical saves give one entry; a payment never changes another store; a payment on an archived store is allowed.
- **Allocation** (randomised sequences on PGlite): the sum of the allocations equals the smaller of the credit pool and the open debits; no item is allocated more than its amount; the opening balance is settled before invoices whatever its date; reversed entries and their reversals are ignored; an advance is whatever credit is left and settles the next invoice; the statuses are unpaid, partly paid, paid exactly as the entries imply, and a reversal of a payment moves them back.
- **Invoice entry**: a draft adds nothing; issue adds exactly one debit entry equal to the grand total, dated the invoice date; a replay and ten simultaneous issues add one; a refused issue adds nothing and uses no number; the carry-forward example of the master prompt gives 5,000, 13,000 and 3,000.
- **Cancel**: an issued invoice that is in the account gets exactly one reversal and the balance returns; a repeat adds none; a legacy invoice (staged migration) adds none; a payment received with the invoice stays.
- **Issue with payment**: invoice, number, invoice entry, payment and snapshot appear together; a forced failure (a test-only trigger that raises while the payment entry is written) leaves no invoice number used, no entry, no payment and the order unchanged; an invalid amount refuses before the number is taken; a repeat never records a second payment; a payment larger than the total leaves an advance.
- **Account Summary**: the five figures are right in the cases (no payment, payment, advance before, advance after); they are identical after later payments, adjustments, opening balances and reversals; every one of the four new columns of an issued invoice cannot be updated; a legacy invoice has no summary.
- **Append-only**: every update and delete on `ledger_entries` is refused for signed-in users; only the service role may delete (test cleanup); the structural insert trigger refuses a reversal with the same side, a different amount, another store, a reversal of a reversal and a second reversal.
- **Statement**: opening + debits - credits = closing for ranges that start and end anywhere; the 2,000-line cap sets `truncated`; the data contains no forbidden keys.
- **No cost**: no forbidden key (purchase price, MRP, cost, margin, profit) in any function result; no forbidden word in the statement and the printed summary.
- **Isolation**: two real users, crafted ids on every function, the same answer as for a missing record; the same entry id in two businesses stays separate.
- **Scale**: a store with 2,000 entries (account and statement), a list of 100 stores with balances, and the 1,000-invoice list with paid statuses, with the times recorded (not assumed).
- **Screens** (Playwright, 360 px): the stores list and Home card, the account screen, opening balance with the warning, payment with the preview, issue with payment, adjustment and reversal, the Account Summary box and block on A4 and thermal (print media and PDF text), the statement page, paid status chips and filters, "Not in the account", touch targets, loading, error and empty states.
- **Module 006 regression**: the existing invoice suites (PGlite, Supabase, e2e) are run again against the extended functions and still pass.

## 6. Results

Recorded as they were actually run on 2026-11-16 (Windows laptop, hosted Supabase TEST project). Nothing here is claimed that was not run.

| Check | Result |
|---|---|
| Baseline `npm test` on a clean copy of `master` (T001) | **Not completed.** The run was interrupted when the laptop restarted, so no baseline result exists. The module is judged by its own results and by the unchanged Module 001 to 006 suites below. |
| `npx vitest run pglite` (real PostgreSQL engine, every PGlite suite including Modules 001 to 006) | 56 files, 651 tests, all passed (310 s). |
| `npm test` (whole vitest run: PGlite and Supabase TEST project, 116 files) | 1,204 of 1,207 tests passed, 3 failed. (a) Two Module 006 unit tests in `invoice-validation.test.ts` failed because the invoice list query now has a `payment_status` filter (default `all`): a real effect of this module, fixed by updating the tests and adding tests for the new filter (28 pass). (b) `product-search.test.ts` (Module 001, 5,000 products, 1,000 ms limit) took 1,061 ms once, a network timing miss; it passed on its own straight after (4 tests). The whole `npm test` was **not** repeated after these two fixes. |
| `npm run typecheck`, `npm run lint` (with the secrets check), `npm run build` | All passed after the last code change (the touch-target fix and the final test additions were made after the full e2e run; build was run after them). |
| `accounts-api` (TEST project, two real users) | 7 tests passed (first run: 2 failed because the test expected no `replayed` field; a new entry answers `replayed: false`). |
| `accounts-concurrency` (TEST project, separate connections) | 9 tests passed: 10 simultaneous issues of one draft give one invoice entry; 10 different drafts give 10 entries and the exact sum; 10 simultaneous cancels give one reversal; 10 identical payments (same id) give one entry; 10 payments with different ids give 10 entries and the exact balance; 10 simultaneous reversals of one payment give one reversal; one store payments never change another store; 10 simultaneous issues with a payment give one invoice, one invoice entry and one payment; an invalid payment adds no entry and the draft can still be issued. |
| `rls-accounts` (TEST project, two real users) | 6 tests passed: business B reads nothing of business A through every read function; every write by B on A store, entry or invoice answers like a missing id and changes nothing; the same entry id in two businesses stays separate; direct table writes change nothing; the internal helpers give B nothing and `ledger_insert_entry` cannot be called by anyone; anonymous calls are refused. PGlite `db-ledger-rls` covers the same on a real PostgreSQL engine. |
| `accounts-scale` (TEST project, 100 stores, one store with 2,000 entries, 1,000 invoices, five runs each, maximum in ms, network round trip included) | 7 tests passed. Final run: account first page 478 and last page 500; statement of the whole range (2,000 lines) 1,954 and of one month 398; Home summary 199; stores list for 100 stores 2,388 (one outlier, the other four runs were about 190 to 215) and only owing 201; payment preview 675; record a payment 220; issue with a payment 236; invoices list first page 467, paid filters 565 at most. Goals (SC-012): 3,000 for the account, list and statement, 2,000 for a payment: all met. Another run the same day gave the account at about 250 and the list at about 230, so the times move with the network. The statement for 2,000 lines is the slowest at about 1.9 s. No performance migration was needed. |
| Playwright e2e, whole suite, mobile and desktop projects (47.6 min) | 405 passed, 195 skipped (mobile-only tests on the desktop project), 2 failed: `market-home` (360 px layout, Module 005) and `pending-link` (inactive medicines, Module 004). Neither touches store accounts, and both passed when rerun alone straight after (12 of 12), so they are timing failures of the long run; they should be watched. |
| Module 007 e2e specs, mobile (360 px) | `account-opening`, `account-payment`, `account-adjust-reverse`, `account-statement`, `accounts-list-home`, `account-invoice-entry`, `account-issue-payment`, `invoices-paid-status`, `account-summary-print` (including the thermal layout and a real PDF), the account blocks of `touch-targets` (also the invoices list, the invoice and the print page) and `states`, and `shell`: all passed. The first runs had 5 failures: 4 wrong test expectations (the browser itself refuses a future date and an empty required reason before the app shows its own message; the not-found page answers status 200 with "Not found") and 1 real finding fixed in the app: the invoice number link on an entry was 19 px high, now 44 px. A few of these specs were added or extended after the full e2e run and were run separately (all passed). |
| Honesty sweep (T069) | Searched `src/` and the migration: no purchase price, MRP, cost, margin or profit is read, selected or rendered in any ledger, account, statement or summary code (the words appear only in comments that say there is none); no `localStorage`, `sessionStorage` or `indexedDB` in the account code; no service-role or secret key in `src/`; no "pending sync" or "saved on this device" wording (the e2e specs assert its absence); the only browser arithmetic is the informational advance hint on the issue dialog (paisa helpers); balances, allocation and paid status are all worked out by the database. |
| Ledger review (T070) | `ledger_entries` has exactly one insert statement, inside `ledger_insert_entry`, which only the four ledger writes, `invoice_issue` and `invoice_cancel` call; users cannot execute it (tested); no column stores a balance or a paid status; entries are refused on update and delete (the service role may delete for test cleanup only); a draft never writes an entry (tested); the invoice guard from ADR-0006 is unchanged and still freezes the four snapshot columns. Module 006 behaviour (numbers, order status, delivered quantities, market list) passed its unchanged suites. |
| Not covered | A real printer and real PDF files (print media and the browser PDF output are checked, not a printer); offline payments and "pending sync" (Module 009); the owner phone walkthrough (T073); the DEV project (T072). |

## 7. Migration 0008 on the TEST project

Applied on 2026-11-16 to the TEST project (`medicine-supply-test`) through the Supabase SQL Editor, signed in by the owner, after the owner said to run it. The file ran as one transaction (`begin` to `commit`) and the editor answered "Success. No rows returned". The editor's warning about destructive operations was expected (the migration replaces the old `invoice_issue` and `invoice_list`).

| Count (read only) | Before | After |
|---|---|---|
| invoices | 0 | 0 |
| issued invoices | 0 | not re-counted (no invoices exist) |
| cancelled invoices | 0 | not re-counted (no invoices exist) |
| order lines | 13 | 13 |
| order events | 7 | 7 |
| stores | 12 | 12 |
| `invoices.in_account` column | absent | present |
| `ledger_entries` rows | table absent | 0 (table exists) |
| functions named `ledger%` in `public` | none | 17 |

No existing row changed. The TEST project has no invoices, so the check that old invoices show `in_account = false` could not be made on TEST; the PGlite legacy test (`db-ledger-legacy.pglite.test.ts`) covers it on a real PostgreSQL engine.

## 8. Migration 0008 on the DEV project

(Empty until the owner says to apply it.)
