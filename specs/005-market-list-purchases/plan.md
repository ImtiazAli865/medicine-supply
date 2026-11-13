# Implementation Plan: Market List and Purchases

**Branch**: `005-market-list-purchases` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-market-list-purchases/spec.md`

## Summary

Module 005 gives the supplier one combined list to take to the wholesale market and a safe way to record what was really bought. The list adds up the quantities of the orders confirmed on a Pakistan day by medicine (and unit), shows each store's share, puts typed medicines in their own "Not yet registered" group so no quantity is ever left out, and shows purchased and remaining quantities and a status. Purchases are recorded by quantity (partial purchases allowed), never by a tick alone, and are append-only. The list can be printed and exported without any cost or price.

Approach (details and rationale in [research.md](research.md)):

- **The list is computed, not stored.** One internal SQL function `market_rows(date)` is the single definition; `market_list` and `market_summary` read it, so the Home count always equals the "still to buy" list (D1, D6).
- **Orders by confirmed day.** Orders with status confirmed or fulfilled whose `confirmed_at` falls inside the Pakistan day (the owner's choice); draft and cancelled never count (D2).
- **Group by medicine and unit.** Quantities in different units are never added; typed lines are grouped by normalized text and unit using the existing `norm_text` helper (D3).
- **Two append-only tables, two SECURITY DEFINER functions** (`purchase_record`, `purchase_void`). The client-created entry id is the request id, so a repeat gives one entry; a cancellation is a separate `purchase_voids` row (unique per entry), so an entry row is never changed (D4). This follows the ADR-0003/0004 pattern.
- **Purchased quantity belongs to (medicine, unit, purchase date).** A store filter changes what is shown and printed, not the bought figures (D5).
- **Typed lines cannot be bought until registered** (the function needs a real medicine); the row offers "Register this medicine" (Module 004 flow).
- **No cost ever leaves the purchase screens.** The list, summary, print data and CSV functions never select a cost, price or MRP column; a key-name test and a text test on the PDF and CSV prove it (D9).
- **The medicine's purchase price is updated only after an explicit confirmation**, through the existing product update; no new write path (D10).
- **Print and CSV**: a dedicated print page with print-media CSS and a CSV route handler with formula-character protection (D9).
- **Planner safety** from Module 004's `0005` lesson: materialized CTEs and a measured scale test (D7).
- **No new packages and no sixth navigation item** (D11).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages** (CSV is written by a small function, the print layout is plain HTML and CSS).
**Storage**: Supabase PostgreSQL. New migration `supabase/migrations/0006_market_list_purchases.sql`: tables `purchase_entries` and `purchase_voids` with append-only triggers, RLS (select only) and grants; index `orders_market_idx`; functions `purchase_record`, `purchase_void` (SECURITY DEFINER) and `market_rows`, `market_list`, `market_summary`, `purchase_entries_list` (SECURITY INVOKER); revoke and grant lines (data-model sections 1 to 3).
**Testing**: Vitest (unit: validation, the market key and status helpers, CSV cell escaping), PGlite (real PostgreSQL: list rules, recalculation, purchase functions, triggers, RLS, replay), Supabase integration (two real users: API round trips, 10 simultaneous identical requests, cross-business refusal, a 200-order / 1,000-line scale check), Playwright e2e at 360 px (list, record, cancel, price offer, typed row, print media and PDF text, CSV, Home card, touch targets, states).
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: The list for 200 orders and 1,000 lines opens within 3 seconds and a purchase save answers within 2 seconds on the TEST project (SC-010, to be measured); finding a medicine and recording a purchase in under 30 seconds (SC-012, owner timing, recorded only if given).
**Constraints**: Quantity 1 to 100,000; cost PKR at most two decimals, 0 or more; purchase date today or earlier (Pakistan); at most 2,000 rows per list (safety cap, flagged on screen); store ids at most 50 per call; no offline queue (Module 009); no cost, price or MRP in the list, print or CSV.
**Scale/Scope**: 1 business / 1 owner; a day has tens to a few hundred medicine rows. New screens: Market list (with a purchase dialog and a history panel) and the print page; Home gains a card; the Orders screen gains a link.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real totals from real orders; purchases saved in the real database; success shown only after the server confirms; no dead buttons; print and CSV are real files and pages | PASS: every control calls a real function; failures show the reason; the print is tested with print-media emulation and a generated PDF (a real printer is not claimed) |
| II. Billing integrity & snapshots | Yes (guard rail): the module must not touch order prices or delivered quantities, and must not show cost on customer-facing output | PASS: the write functions touch only the two new tables; the "nothing else changed" test compares orders, lines and snapshots before and after; the list, print and CSV never select a cost, price or MRP; the product purchase price changes only after an explicit confirmation |
| III. Append-only ledger | No ledger in scope; the same discipline is applied to purchase entries | PASS: entries and cancellations are append-only (triggers), a wrong entry is cancelled with a reason and a corrected one is added; balance-like numbers (purchased, remaining, status) are computed, never stored |
| IV. Medicine identification & order safety (core) | Yes: grouping by medicine identity, never by similar text; no merging of strengths, forms, manufacturers or pack sizes; no quantity left out; no mixing of stores | PASS: the key is the product id plus the unit; typed lines grouped by exact normalized text only; the sum rule (SC-001) is a test; store breakdown on every row |
| V. Security, RLS and secrets | Yes: two new tables and six functions; business filter in every statement; no secrets in the browser | PASS: RLS select-only policies, no write grants, composite foreign keys, crafted-id tests on PGlite and with two Supabase users, same answer as for a missing record; CSV formula protection |
| VI. Server-side AI | No AI in scope | PASS (n/a) |
| VII. Offline-first with honest sync | Partly: the constitution wants purchases usable offline; this module is online only | PASS with the same tracked deferral as Modules 003 and 004: offline is Module 009; no "saved on this device" claim; a visible error and a kept form when a save fails |
| VIII. Mobile-first, verifiable delivery | Yes: 360 px, 44 px targets, loading / error / empty states | PASS: Playwright at 360 px with the touch-target check on every new screen and dialog; lint, typecheck, build and tests are run before anything is called done. Printing: one compact A4 layout without the application navigation now; the thermal layout (80 mm, width as a setting) comes with invoices in Module 006, as agreed with the owner on 2026-11-13 |

**Post-design re-check (after Phase 1)**: All gates still PASS. Risks recorded to revisit: (1) the unit split can show the same medicine twice on purpose; (2) an order confirmed after midnight Pakistan time lands on the next day's list; (3) the 2,000-row cap is a safety limit and the real time at 1,000 lines is measured, not assumed.

## Project Structure

### Documentation (this feature)

```text
specs/005-market-list-purchases/
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
└── 0006_market_list_purchases.sql           # tables, triggers, index, functions, grants

src/
├── app/
│   ├── (app)/
│   │   ├── page.tsx                         # Home: market list card (modified)
│   │   ├── market-list/page.tsx             # the list screen
│   │   ├── market-list/print/page.tsx       # print page (print-media CSS)
│   │   ├── pending/page.tsx                 # reads an optional q and passes it to the typed list (modified)
│   │   └── orders/page.tsx                  # link to the market list (modified)
│   └── api/
│       ├── market-list/route.ts             # GET
│       ├── market-list/summary/route.ts     # GET
│       ├── market-list/export/route.ts      # GET (CSV)
│       ├── purchases/route.ts               # GET (history), POST (record)
│       └── purchases/[id]/void/route.ts     # POST
├── components/
│   └── market/
│       ├── MarketListScreen.tsx             # date, search, filters, rows, refresh, states
│       ├── MarketRowCard.tsx                # row with store breakdown, status, actions
│       ├── UnregisteredGroup.tsx            # "Not yet registered" group with Register links
│       ├── RecordPurchaseDialog.tsx         # quantity, cost, supplier, reference, date; "Bought all remaining"
│       ├── PurchaseHistoryDialog.tsx        # entries including cancelled, cancel with reason
│       ├── UpdateCostOffer.tsx              # confirm before updating the medicine's purchase price
│       ├── StoreFilter.tsx                  # choose stores (display, print, export)
│       ├── MarketSummaryCard.tsx            # Home card
│       └── MarketPrintView.tsx              # compact print layout
├── lib/
│   ├── market/
│   │   ├── types.ts                         # MarketRow, MarketList, PurchaseEntry
│   │   ├── repository.ts                    # calls the functions, maps reasons to ApiError
│   │   ├── client.ts                        # fetch helpers (ids, reasons)
│   │   ├── csv.ts                           # CSV writer with formula protection
│   │   └── status.ts                        # status labels and the key rule (also used by tests)
│   ├── validation/market.ts                 # Zod: list query, record, void
│   └── api/errors.ts                        # new codes: request_reused, list_too_large (modified)

tests/
├── helpers/market.ts                        # seed confirmed orders, stores, purchases
├── unit/market-{validation,status,csv}.test.ts
├── integration/
│   ├── db-market-{schema,list,recalc,filters,nocost,rls}.pglite.test.ts
│   ├── db-purchase-{record,append-only}.pglite.test.ts
│   ├── market-api.test.ts                   # Supabase: round trips, replay, sum rule
│   ├── purchases-api.test.ts                # Supabase: purchase round trips, replay, nothing else changed
│   ├── market-concurrency.test.ts           # Supabase: 10 simultaneous identical requests
│   ├── rls-market.test.ts                   # Supabase: two businesses, crafted ids
│   └── market-scale.test.ts                 # Supabase: 200 orders / 1,000 lines list time
└── e2e/
    ├── market-list.spec.ts, purchase-record.spec.ts, market-print.spec.ts, market-home.spec.ts
    └── touch-targets.spec.ts, states.spec.ts, shell.spec.ts    # extended (modified)
```

**Structure Decision**: Same single Next.js project and layout as Modules 001 to 004. New code lives in `src/lib/market`, `src/components/market` and `src/app/(app)/market-list`, with the REST handlers under `src/app/api`. No order function, order table or pending function is modified; only the Home page, the Orders page header, the Pending page and `TypedGroupList` (an optional initial search text) and the error code list are touched.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. Deliberate limits recorded instead: (1) no allocation of a purchase to stores and no change of delivered quantities (Module 006); (2) no undo of a cancellation (a new entry is added); (3) online only, offline is Module 009; (4) print is checked with print-media emulation and a PDF, not a real printer; (5) the market list print is A4 only, thermal layouts come with invoices (Module 006).

📋 **Architectural decision detected**: the purchase write model (two append-only tables with the client-created entry id as the request id, cancellation as a separate row, purchased quantity keyed by medicine, unit and purchase date) and the rule that the list is computed from one shared definition. Document reasoning and tradeoffs? Run `/sp.adr purchase-recording-write-model`. (Not created without your consent.)
