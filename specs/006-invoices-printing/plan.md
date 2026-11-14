# Implementation Plan: Invoices and Printing

**Branch**: `006-invoices-printing` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-invoices-printing/spec.md`

## Summary

Module 006 turns a confirmed order into a bill the store can receive. The supplier creates a draft invoice from the order, adjusts the delivered (billed) quantity per line, fixes any line that has no verified selling price, issues the invoice (it gets a controlled number and is frozen) and prints it on A4 or on an 80 mm thermal receipt. A wrong invoice is cancelled with a reason and replaced. The module also adds the invoices list with a Home "to invoice" count, and the two missing order sheets (option A one store, option B several stores in sections).

Approach (details and rationale in [research.md](research.md)):

- **Four new tables written only by functions** (`invoices`, `invoice_lines`, `invoice_events`, `invoice_counters`), select-only Row Level Security, composite business keys (D1).
- **One live invoice per order is enforced by a partial unique index**; creating a draft uses the client invoice id as the request id, so a retry, a double tap or two devices give one draft (D2, D3).
- **No cost can reach an invoice because no invoice table has a cost, purchase price or MRP column**; tests list the columns and scan every output (D4, D15).
- **Totals come only from the order line's selling price snapshot** and are computed in SQL; a line without a verified price blocks issuing and links to Pending Prices (D4, D7, D19).
- **Delivered quantity is entered on the draft** (owner's choice) and written back to the order lines at issue, so ordered and delivered stay distinct and the order tells the truth; cancelling resets it to the ordered quantity (D6).
- **A draft knows when its order changed**: a fingerprint of the copied facts is stored; a stale draft cannot be issued and is rebuilt with "Refresh from order" (D5).
- **Issue is one atomic function**: checks, next invoice number from a per-business counter, frozen business and store details, write-back, order becomes `fulfilled`, both histories; a repeat returns the same invoice (D8, D9).
- **Immutability is enforced by triggers**, not by the screens: an issued invoice can only change to cancelled, a cancelled one never changes, lines are locked, history is append-only (D10, D12, D13).
- **The market list stays the same** when an order becomes fulfilled (it already counts confirmed and fulfilled); this is a test, not an assumption (D11).
- **One shared definition of "to invoice"** feeds the Home count and the list (D14).
- **Printing** uses dedicated server pages with print-media CSS; the thermal page sets its page width from the existing Settings value (80 mm by default); order sheets A and B come from a price-free function (D16, D17).
- **No new packages and no sixth navigation item** (D18).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages** (printing is plain HTML and print CSS; money is formatted with the existing `formatPKR`).
**Storage**: Supabase PostgreSQL. New migration `supabase/migrations/0007_invoices.sql`: tables `invoices`, `invoice_lines`, `invoice_counters`, `invoice_events` with guard triggers, RLS (select only) and grants; indexes (`invoices_order_live_idx`, `invoices_list_idx`, `invoices_store_idx`, `invoice_lines_invoice_idx`, the event indexes); writes `invoice_create`, `invoice_set_quantities`, `invoice_refresh`, `invoice_discard`, `invoice_issue`, `invoice_cancel` (SECURITY DEFINER); reads `invoice_get`, `invoice_list`, `invoice_todo`, `invoice_summary`, `invoice_orders_summary`, `order_sheet`, `order_sheet_day`, internal `invoice_todo_rows`, `order_lines_fingerprint` (SECURITY INVOKER); three changes to Module 003 objects (order status guard, order event kinds, delivered quantity check); revoke and grant lines (data-model sections 1 to 5).
**Testing**: Vitest (unit: validation, status and number label helpers, print helper functions), PGlite (real PostgreSQL: create, quantities, stale, issue, cancel, immutability, no-cost, totals, market list unchanged, order sheets, RLS, replay), Supabase integration (two real users: API round trips, 10 simultaneous creates, issues and cancels, 50 numbers in a row, two different drafts at once, cross-business refusal, a 1,000-invoice list and a 60-line invoice scale check), Playwright e2e at 360 px (draft, quantities, blockers, stale and refresh, issue, print A4 and thermal in print media and PDF text, cancel and replace, list and filters, to-invoice tab, Home card, order screen link, order sheets A and B, touch targets, states).
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: A draft for an order with 20 lines is created within 2 seconds; the Invoices list for 1,000 invoices opens within 3 seconds; issuing a 60-line invoice answers within 2 seconds on the TEST project (SC-001, SC-009, to be measured, not assumed).
**Constraints**: Delivered quantity 0 to 100,000; money PKR with two decimals, `numeric` end to end; invoice numbers only at issue, unique per business, never reused; an issued invoice is immutable; issuing needs a connection (constitution VII; no offline queue); no cost, price of purchase, MRP, margin or profit in any invoice or order sheet output; at most 200 lines per invoice (the same cap as an order); list pages of at most 50 rows; print by the browser only.
**Scale/Scope**: 1 business / 1 owner; tens of invoices a day, a few thousand in total. New screens: Invoices (list and to-invoice tab), the invoice screen (draft editor and frozen view with history), three print pages (invoice, order sheet A, order sheet B); Home gains a card; the order screen gains an invoice action; the Orders screen gains a link.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real invoices, numbers and prints | PASS: every control calls a real function; success is shown only after the server confirms; the print is tested with print-media emulation and a generated PDF; **a real thermal printer is not claimed** (stated in the quickstart); "save as PDF" is the browser's own |
| II. Billing integrity and price snapshots (core) | Yes: this is the module the principle is written for | PASS: totals use the order line snapshot only (the invoice tables copy `selling_price_snapshot` and nothing else); no price is invented (a missing price blocks issuing); issuing is refused while any billed line lacks a verified price; invoice status is stored as draft, issued or cancelled only; issued invoices are immutable by trigger; corrections are cancellation plus a replacement; numbers come from a controlled counter, never duplicated on retry; ordered, purchased and delivered quantities stay distinct (delivered written back to the order lines at issue); customer output has no cost, MRP, margin or profit (no such column exists). The **Account Summary snapshot** and unpaid or paid states belong to Module 007 (owner confirmed on 2026-11-14) and are explicitly out of scope, not forgotten |
| III. Append-only ledger | No ledger in scope; the same discipline is applied | PASS: nothing creates ledger entries here; invoice history is append-only; a later module reads issued invoices only. Module 007 will add the ledger entry for an issued invoice and the Account Summary snapshot without altering issued rows (a new table, as the data model keeps room for it) |
| IV. Medicine identification and order safety | Yes: pending lines block the invoice, not the order; stores never mix | PASS: a typed line keeps its text and is shown as needing a price, never guessed or merged; each invoice and each order-sheet section belongs to one store; lines are copied per order line, never grouped by similar text |
| V. Security, RLS and secrets | Yes: four new tables and sixteen functions | PASS: RLS select-only policies, no write grants, composite foreign keys, a business filter in every statement, crafted-id tests on PGlite and with two real users, the same answer as for a missing record; server-side enforcement of every rule (the screens only show them); audit history for every invoice change; no secrets in the browser |
| VI. Server-side AI | No AI in scope | PASS (n/a) |
| VII. Offline-first with honest sync | Partly: issuing REQUIRES a connection by this very principle | PASS: issue, cancel and the number are online only, with a visible error and a kept screen when a request fails; drafts are not queued offline (offline is Module 009) and no "saved on this device" claim is made |
| VIII. Mobile-first, verifiable delivery | Yes: new screens and print layouts | PASS: Playwright at 360 px with the touch-target check on every new screen and dialog; A4 and thermal layouts with the thermal width read from the existing Settings value (default 80 mm); prints have no application chrome; lint, typecheck, build and tests are run before anything is called done |

**Post-design re-check (after Phase 1)**: All gates still PASS. Risks recorded to revisit: (1) after a cancellation the replacement draft starts again from the ordered quantities (the supplier re-enters the delivered figures); (2) stale detection is strict, any change to a copied order fact needs a refresh; (3) the print layouts are verified in print emulation and PDF text, not on paper; (4) migration `0007` changes three Module 003 objects, so the existing-row counts are compared before and after it is applied; (5) a typed line with delivered 0 on an invoiced order cannot be registered until the invoice is cancelled (research risk 4, a known limitation).

## Project Structure

### Documentation (this feature)

```text
specs/006-invoices-printing/
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
└── 0007_invoices.sql                          # tables, guards, indexes, functions, grants, Module 003 changes

src/
├── app/
│   ├── (app)/
│   │   ├── page.tsx                           # Home: "To invoice" card (modified)
│   │   ├── invoices/page.tsx                  # list and "To invoice" tab
│   │   ├── invoices/[id]/page.tsx             # draft editor or frozen invoice
│   │   ├── invoices/[id]/print/page.tsx       # A4 or thermal print page (?layout=)
│   │   ├── orders/page.tsx                    # link to Invoices (modified)
│   │   ├── orders/[id]/print/page.tsx         # order sheet, option A
│   │   └── orders/print/page.tsx              # order sheets, option B (?date=&stores=)
│   └── api/
│       └── invoices/
│           ├── route.ts                       # GET list, POST create
│           ├── summary/route.ts               # GET
│           ├── to-invoice/route.ts            # GET
│           └── [id]/
│               ├── route.ts                   # GET, PATCH (quantities)
│               ├── refresh/route.ts           # POST
│               ├── discard/route.ts           # POST
│               ├── issue/route.ts             # POST
│               └── cancel/route.ts            # POST
├── components/
│   ├── invoices/
│   │   ├── InvoicesScreen.tsx                 # tabs, filters, search, paging, states
│   │   ├── InvoiceListItem.tsx
│   │   ├── ToInvoiceList.tsx                  # the list the Home count refers to
│   │   ├── InvoiceEditor.tsx                  # draft: lines, delivered quantity, totals, notices
│   │   ├── InvoiceLineRow.tsx                 # ordered vs delivered, price, total, "needs price"
│   │   ├── InvoiceBlockers.tsx                # lines without a verified price, link to Pending Prices
│   │   ├── StaleNotice.tsx                    # "The order has changed" and "Refresh from order"
│   │   ├── IssueInvoiceDialog.tsx             # confirm, shows what will be frozen
│   │   ├── CancelInvoiceDialog.tsx            # reason required
│   │   ├── DiscardDraftDialog.tsx
│   │   ├── InvoiceView.tsx                    # frozen invoice, print buttons, cancel, history
│   │   ├── InvoiceHistory.tsx
│   │   ├── InvoiceSummaryCard.tsx             # Home card
│   │   ├── OrderInvoiceAction.tsx             # "Create invoice" / "View invoice" on the order screen
│   │   ├── InvoicePrintView.tsx               # A4 and thermal layouts (same facts)
│   │   └── OrderSheetView.tsx                 # options A and B, no prices
│   ├── market/PrintButton.tsx                 # reused (print button)
│   └── orders/OrderHistoryLog.tsx             # wording for the two new event kinds (modified)
├── lib/
│   ├── invoices/
│   │   ├── types.ts                           # Invoice, InvoiceLine, InvoiceSummaryRow, ToInvoiceRow
│   │   ├── repository.ts                      # calls the functions, maps reasons to ApiError
│   │   ├── client.ts                          # fetch helpers (ids, reasons)
│   │   └── status.ts                          # labels, number label, layout names (also used by tests)
│   ├── validation/invoice.ts                  # Zod: list query, create, quantities, version, cancel
│   ├── orders/types.ts                        # OrderEventType gains two kinds (modified)
│   └── api/errors.ts                          # new codes: invoice_not_draft, invoice_not_issued, order_not_confirmed,
│                                              #   order_changed, nothing_to_bill, not_ready, reason_required (modified)

tests/
├── helpers/invoices.ts                        # seed confirmed orders with priced and typed lines, settings
├── unit/invoice-{validation,status}.test.ts
├── integration/
│   ├── db-invoice-{schema,create,quantities,stale,issue,cancel,immutable,nocost,totals,rls}.pglite.test.ts
│   ├── db-invoice-market-unchanged.pglite.test.ts   # fulfilled orders keep the market list figures
│   ├── db-order-sheet.pglite.test.ts          # sections never mix, no price keys
│   ├── invoices-api.test.ts                   # Supabase: round trips, totals, replay, no cost
│   ├── invoices-concurrency.test.ts           # Supabase: 10 simultaneous creates, issues, cancels; numbers
│   ├── rls-invoices.test.ts                   # Supabase: two businesses, crafted ids
│   └── invoices-scale.test.ts                 # Supabase: 1,000 invoices list, 60-line invoice
└── e2e/
    ├── invoice-draft.spec.ts, invoice-issue.spec.ts, invoice-cancel.spec.ts, invoice-print.spec.ts
    ├── invoices-list.spec.ts, invoices-home.spec.ts, order-sheets.spec.ts
    └── touch-targets.spec.ts, states.spec.ts, shell.spec.ts    # extended (modified)
```

**Structure Decision**: Same single Next.js project and layout as Modules 001 to 005. New code lives in `src/lib/invoices`, `src/components/invoices` and `src/app/(app)/invoices`, with the REST handlers under `src/app/api/invoices` and the order sheets under `src/app/(app)/orders`. No order, order line or pending function is replaced; the migration changes three Module 003 objects only as the data model lists (status guard, event kinds, delivered quantity check). Existing files touched: Home, the Orders screen header, the order screen (invoice action), `OrderHistoryLog`, `OrderEventType`, the error code list and the shell and state e2e specs.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. Deliberate limits recorded instead: (1) no Account Summary, payments, balances or paid statuses (Module 007, owner confirmed); (2) no discounts or taxes; (3) no server-side PDF, e-mail or QR codes; (4) online only for issuing and cancelling, offline is Module 009; (5) print is checked with print-media emulation and PDF text, not a real printer; (6) the replacement draft after a cancellation starts from the ordered quantities (research D6); (7) a discarded draft is deleted and only its history entry stays; (8) a typed line with delivered 0 on an invoiced order cannot be registered or linked until the invoice is cancelled (Module 004 refuses fulfilled orders).

📋 **Architectural decision detected**: the invoice write model (client-created invoice id as the request id, one live invoice per order by a partial unique index, a per-business number counter used only at issue, immutability by guard triggers with a stored draft, issued or cancelled status, the order moving to fulfilled in the same transaction, the delivered quantity written back to the order lines, and a fingerprint to detect a stale draft). Document reasoning and tradeoffs? Run `/sp.adr invoice-issue-and-immutability`. (Not created without your consent.)
