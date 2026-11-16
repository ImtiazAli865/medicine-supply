# Implementation Plan: Store Accounts (Khata), Payments, Account Summary and Store Statement

**Branch**: `007-store-accounts-payments` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-store-accounts-payments/spec.md`

## Summary

Module 007 gives every store a running account (khata). The account is only a list of append-only entries (opening balance, invoice, payment, adjustment, reversal); the balance and the paid status of every invoice are always worked out from those entries, never stored. Issuing an invoice adds its entry (and, when the supplier took money at the door, a payment) in the same transaction; cancelling an invoice adds a reversal. An issued invoice also keeps an unchangeable Account Summary snapshot that the print screen can show or hide. The supplier can record payments, write off or add small amounts, enter an opening balance on any day, reverse mistakes with a reason, see who owes what, and print a Store Statement.

Approach (details and rationale in [research.md](research.md)):

- **One append-only table `ledger_entries`**, written only by functions; select-only Row Level Security; composite keys tie every entry to one business, and composite foreign keys tie an entry to the same store as its invoice or the entry it reverses, so a payment can never reach another store (D1, D2).
- **The balance is a sum and the allocation is a window calculation, never stored.** One SQL function (`ledger_allocation`) settles credits against debits oldest first (opening balances first, then everything else by date and order of recording) and gives each invoice its unpaid, partly paid or paid status. The invoices list, the invoice screen, the account screen and the Home total all read the same definitions (D3, D4, D13).
- **Exactly-once by keys the database enforces**: the client entry id is the request id for opening balances, payments, adjustments and reversals; one invoice entry per invoice, one reversal per entry and one payment per invoice (received at issue) are partial unique indexes (D5).
- **Issue and cancel are extended, not replaced**: `invoice_issue` gains the optional payment, the invoice entry and the Account Summary snapshot; `invoice_cancel` gains the reversal of the invoice entry; both stay atomic and replay-safe. One lock order for everything: invoice, then order, then the store's ledger, then the invoice counter (D6, D7, D8).
- **The Account Summary snapshot is four new columns on `invoices`**, set in the same update that issues the invoice. The existing guard already freezes every column of an issued invoice, so no trigger is changed; a test proves it (D9).
- **The khata starts empty** (owner's decision): invoices issued before this module get `in_account = false`, show "Not in the account" and have no summary; cancelling one adds nothing (D10).
- **Store Statement and the print screen's Account Summary box** use server pages with print-media CSS, the same approach as the invoice print; no server-side PDF (D14, D15).
- **No new packages and no sixth navigation item**: Home gets a card, and the stores screen, the invoice screen and the account pages link to each other (D16).
- **Migration `0008_store_accounts.sql`** changes five Module 006 objects (the `invoices` table, `invoice_json`, `invoice_issue`, `invoice_cancel`, `invoice_list`) and nothing else of earlier modules; row counts are compared before and after (D17).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages** (money is handled by the existing `src/lib/money.ts` paisa helpers and `formatPKR`; printing is plain HTML and print CSS).
**Storage**: Supabase PostgreSQL. New migration `supabase/migrations/0008_store_accounts.sql`: table `ledger_entries` with guard triggers, RLS (select only), grants and indexes; four new columns on `invoices` with two checks and one extra unique key; writes `ledger_opening_add`, `ledger_payment_add`, `ledger_adjustment_add`, `ledger_entry_reverse` (SECURITY DEFINER), the changed `invoice_issue` and `invoice_cancel`, and the internal helper `ledger_insert_entry` (not callable by users); reads `ledger_stores`, `ledger_summary`, `ledger_account`, `ledger_payment_preview`, `ledger_statement` and the internal invoker helpers `ledger_balances`, `ledger_allocation`, `ledger_entry_json`; changed reads `invoice_json` and `invoice_list` (data-model sections 1 to 6).
**Testing**: Vitest (unit: validation, label and status helpers), PGlite (real PostgreSQL: schema and constraints, opening balance, payment, adjustment, reversal, allocation with randomised sequences, invoice entry and replay, cancel reversal, issue with payment and forced failure, snapshot values and immutability, legacy invoices through a staged migration, append-only, no cost, RLS), Supabase integration with two real users (API round trips, 10 simultaneous identical saves, issue and payment at the same time on one store, cross-business refusal, a 2,000-entry account and a 100-store list scale check), Playwright e2e at 360 px (opening balance, payment with preview, issue with payment, summary on A4 and thermal, adjustment and reversal, statement, stores list and Home card, paid filter, touch targets, states).
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: A store account with 2,000 entries opens (balance and first page) within 3 seconds; the stores list for 100 stores within 3 seconds; recording a payment within 2 seconds; the invoices list for 1,000 invoices (Module 006 goal, 3 seconds) must not get slower because of the status calculation (SC-012, to be measured on the TEST project, not assumed).
**Constraints**: Money PKR, `numeric` end to end (amounts above 0, at most two decimals, at most 9,999,999,999.99 like all money in the app); entry dates not in the future (Pakistan time) and not before 2000-01-01; reasons 1 to 500 characters; entries never edited or deleted; an entry is reversed at most once and a reversal is never reversed; an invoice entry is reversed only by cancelling its invoice; online only (offline payments and "pending sync" are Module 009); no cost, MRP, margin or profit in any output; list pages of at most 50 rows; a statement of at most 2,000 lines (flagged, and print refused when cut).
**Scale/Scope**: 1 business / 1 owner; tens of stores, hundreds of entries per store in a year. New screens: Store accounts list, Store account (entries, record payment, add opening balance, add adjustment, reverse), Store Statement (print), Home card; changed screens: the issue dialog (payment field), the cancel dialog (note), the invoice screen and list (paid status, "Not in the account"), the invoice print page (Account Summary box and block), the stores screen (link).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real ledger, payments and statements | PASS: every control calls a real function; success is shown only after the server confirms; the statement and summary are tested with print-media emulation and the browser's own save as PDF; **no real printer is claimed**; offline payments and "pending sync" are not claimed (Module 009) |
| II. Billing integrity and price snapshots | Yes: the Account Summary snapshot and the paid statuses are written into this principle | PASS: issued invoices and their Account Summary snapshot (previous balance, this invoice, payment received, balance due) are immutable (the snapshot is set in the same update that issues, and the existing guard freezes it); unpaid, partly paid and paid are derived from the ledger and never stored; invoice status is still stored only as draft, issued or cancelled; customer output has no cost, MRP, margin or profit (no such column exists in the ledger) |
| III. Append-only ledger (core) | Yes: this is the module the principle is written for | PASS: entry types are exactly opening_balance, invoice, payment, adjustment, reversal; the balance is computed; entries are never edited or deleted (trigger); a mistake is a reversal with a reason plus a new entry; only issued invoices create entries (the entry is written inside `invoice_issue`); payments belong to the store account, are allocated oldest first, can never reach another store (composite foreign keys) and an overpayment is kept as an advance and applied to the next invoice (it is part of the credit pool); every entry has an idempotency key (the client entry id and the partial unique indexes); issue with "payment received now" is one atomic function. "Pending sync" is Module 009 |
| IV. Medicine identification and order safety | No medicine or order data is created or changed here | PASS (n/a); order lines, delivered quantities and the order status rules of Module 006 are untouched |
| V. Security, RLS and secrets | Yes: one new table and about twelve functions | PASS: RLS select-only policy, no write grants, composite foreign keys, a business filter in every statement, crafted-id tests on PGlite and with two real users, the same answer as for a missing record; every rule is enforced in the database; audit by the entries themselves (who, when, reason); no secrets in the browser; the service role is used only by test cleanup |
| VI. Server-side AI | No AI in scope | PASS (n/a); no balance or amount is ever sent to any provider |
| VII. Offline-first with honest sync | Partly: the constitution wants payments recordable offline | PASS with a tracked deferral (the same as Modules 003 to 006): payments, opening balances and adjustments are online only here; a failed save keeps the form and shows an error; the app never says "saved on this device" or "pending sync"; offline payments (IndexedDB queue, "pending sync" balance) are Module 009. Issuing still requires a connection by this very principle, which is what makes the previous balance exact |
| VIII. Mobile-first, verifiable delivery | Yes: new screens and print pages | PASS: Playwright at 360 px with the touch-target check on every new screen and dialog; the statement is an A4 print page without application chrome; the Account Summary prints in A4 and thermal; lint, typecheck, build and tests are run before anything is called done |

**Post-design re-check (after Phase 1)**: All gates still PASS. Risks recorded to revisit: (1) the statement orders entries by date, so an opening balance added later with an earlier date changes the running balances of old lines but never a saved Account Summary (recorded in the spec and shown on the statement); (2) the status calculation runs on every read of an invoice and of the invoices list, so its cost is measured (SC-012) and, if needed, restricted to the stores on the page; (3) invoices issued before this module are not in the account, and nothing can detect that the supplier counted them again in an opening balance (the form warns); (4) migration `0008` changes five Module 006 objects, so the existing counts are compared before and after it is applied and the Module 006 tests are rerun; (5) one lock order (invoice, order, ledger, counter) must be kept by every function, proved by a simultaneous issue-and-payment test; (6) offline payments are deferred to Module 009.

## Project Structure

### Documentation (this feature)

```text
specs/007-store-accounts-payments/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.openapi.yaml # Phase 1 output (REST route handlers)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/sp.tasks - NOT created by /sp.plan)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0008_store_accounts.sql                     # ledger table, guards, functions, snapshot columns, changes to Module 006 objects

src/
├── app/
│   ├── (app)/
│   │   ├── page.tsx                            # Home: "Stores owe you" card (modified)
│   │   ├── accounts/page.tsx                   # Store accounts list
│   │   ├── accounts/[storeId]/page.tsx         # one store account
│   │   ├── accounts/[storeId]/statement/page.tsx   # Store Statement print page (?from=&to=)
│   │   ├── invoices/[id]/print/page.tsx        # Account Summary box (?summary=) (modified)
│   │   └── stores/[id]/page.tsx                # link to the account (modified)
│   └── api/
│       ├── accounts/
│       │   ├── route.ts                        # GET stores with balances
│       │   ├── summary/route.ts                # GET Home totals
│       │   └── [storeId]/
│       │       ├── route.ts                    # GET account and entries
│       │       ├── payment-preview/route.ts    # GET preview
│       │       ├── payments/route.ts           # POST
│       │       ├── opening-balances/route.ts   # POST
│       │       ├── adjustments/route.ts        # POST
│       │       ├── statement/route.ts          # GET
│       │       └── entries/[entryId]/reverse/route.ts   # POST
│       └── invoices/
│           ├── route.ts                        # GET list: payment_status filter (modified)
│           └── [id]/issue/route.ts             # POST: optional payment_received (modified)
├── components/
│   ├── accounts/
│   │   ├── AccountsScreen.tsx                  # stores list: search, only owing, states
│   │   ├── AccountListItem.tsx
│   │   ├── AccountsSummaryCard.tsx             # Home card
│   │   ├── AccountScreen.tsx                   # balance, actions, entries, paging, states
│   │   ├── BalanceBadge.tsx                    # owes / advance / settled wording (one place)
│   │   ├── EntryRow.tsx                        # one entry, reversed mark, running balance
│   │   ├── RecordPaymentDialog.tsx             # amount, date, reference, preview, one key per open form
│   │   ├── PaymentPreview.tsx                  # balance after and what it settles
│   │   ├── OpeningBalanceDialog.tsx            # with the double-counting warning
│   │   ├── AdjustmentDialog.tsx                # reason required
│   │   ├── ReverseEntryDialog.tsx              # reason required
│   │   ├── StatementToolbar.tsx                # date range, print
│   │   └── StatementView.tsx                   # A4 statement
│   └── invoices/
│       ├── IssueInvoiceDialog.tsx              # "Payment received now" (modified)
│       ├── CancelInvoiceDialog.tsx             # note about a payment received with it (modified)
│       ├── InvoiceListItem.tsx                 # paid status chip (modified)
│       ├── InvoicesScreen.tsx                  # paid status filter (modified)
│       ├── InvoiceView.tsx                     # status, "Not in the account", link to the account (modified)
│       ├── InvoicePrintView.tsx                # Account Summary block (modified)
│       ├── PaymentStatusBadge.tsx              # unpaid, partly paid, paid, not in the account
│       └── PrintLayoutToolbar.tsx              # "Show Account Summary" box (modified)
├── lib/
│   ├── accounts/
│   │   ├── types.ts                            # LedgerEntry, AccountView, StoreBalanceRow, Preview, Statement
│   │   ├── repository.ts                       # calls the functions, maps reasons to ApiError
│   │   ├── client.ts                           # fetch helpers, entry ids (one per open form)
│   │   └── status.ts                           # balance wording, entry type labels, payment status labels
│   ├── invoices/{types,repository,client,status}.ts   # account fields, payment argument (modified)
│   ├── validation/account.ts                   # Zod: payment, opening, adjustment, reverse, statement range, list query
│   ├── validation/invoice.ts                   # issue body: optional payment_received; list: payment_status (modified)
│   └── api/errors.ts                           # new codes (modified)

tests/
├── helpers/
│   ├── accounts.ts                             # seed stores, issued invoices, entries
│   ├── accounts-db.ts                          # PGlite helpers
│   └── pglite.ts                               # createTestDb({ upTo }) for the legacy-invoice test (modified)
│   └── supabase-test.ts                        # deleteTenant removes ledger_entries first (modified)
├── unit/account-{validation,status}.test.ts
├── integration/
│   ├── db-ledger-{schema,opening,payment,adjustment,reversal,allocation,append-only,nocost,rls}.pglite.test.ts
│   ├── db-ledger-invoice-entry.pglite.test.ts      # issue adds the entry, replay, drafts add nothing
│   ├── db-ledger-cancel.pglite.test.ts             # reversal, legacy invoice adds nothing
│   ├── db-ledger-issue-payment.pglite.test.ts      # atomic, forced failure, replay, advance
│   ├── db-ledger-summary.pglite.test.ts            # snapshot values and immutability
│   ├── db-ledger-legacy.pglite.test.ts             # staged migration: invoice issued before 0008
│   ├── db-ledger-statement.pglite.test.ts          # opening + debits - credits = closing
│   ├── accounts-api.test.ts                        # Supabase: round trips, replay, no cost
│   ├── accounts-concurrency.test.ts                # Supabase: 10 simultaneous saves, issue + payment at once
│   ├── rls-accounts.test.ts                        # Supabase: two businesses, crafted ids
│   └── accounts-scale.test.ts                      # Supabase: 2,000 entries, 100 stores, invoices list
└── e2e/
    ├── account-opening.spec.ts, account-payment.spec.ts, account-issue-payment.spec.ts
    ├── account-summary-print.spec.ts, account-adjust-reverse.spec.ts, account-statement.spec.ts
    ├── accounts-list-home.spec.ts, invoices-paid-status.spec.ts
    └── touch-targets.spec.ts, states.spec.ts, shell.spec.ts    # extended (modified)
```

**Structure Decision**: Same single Next.js project and layout as Modules 001 to 006. New code lives in `src/lib/accounts`, `src/components/accounts` and `src/app/(app)/accounts`, with REST handlers under `src/app/api/accounts`. Module 006 files are touched only where the spec lists changes (the issue and cancel dialogs, the invoice list, screen and print page, their types and the issue and list handlers). No order, product, pending or purchase function is replaced.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. Deliberate limits recorded instead: (1) online only, offline payments and "pending sync" are Module 009; (2) cash only, a method field is kept for later; (3) no discounts, taxes, returns, interest, credit limits or reminders; (4) no server-side PDF; print is checked with print-media emulation, not a real printer; (5) invoices issued before this module are not in any account (owner's decision) and no automatic check can catch a double count in an opening balance; (6) an opening balance sorts before invoices when payments are allocated, even when its date is later (research D3); (7) a reversal and a cancellation entry are dated on the day they are made, so a past statement is not rewritten (research D12).

📋 **Architectural decision detected**: the ledger write model (one append-only table, balance and allocation computed from entries, client entry id as the request id with partial unique indexes for one invoice entry per invoice, one reversal per entry and one payment per invoice, one lock order across invoice, order, store ledger and counter, and the Account Summary snapshot stored on the immutable invoice) and the extension of invoice issue and cancel. Document reasoning and tradeoffs? Run `/sp.adr store-ledger-and-account-summary`. (Not created without your consent.)
