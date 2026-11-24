# Implementation Plan: Reports and Profit

**Branch**: `010-reports-profit` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-reports-profit/spec.md`

## Summary

Module 010 gives the owner internal, read-only business reports: sales, purchases, estimated and realized gross profit, sales by store and by medicine, a "cost missing" list, outstanding balances and a CSV export. It changes no invoice, order, purchase, payment or ledger record and adds nothing to any customer-facing document, the offline device copy or the backup file.

Approach (details and rationale in [research.md](research.md)):

- **One migration, `0011_reports.sql`, read-only**: database functions (`SECURITY INVOKER`, filtered by the business) and one partial index. No table and no stored total, so nothing can go stale (D1).
- **One shared base function** `report_sales_lines` feeds every report, so the summary, the store rows and the medicine rows cannot disagree (D2).
- **The owner's cost rule** is applied in the database: realized cost = weighted average actual cost of that medicine and unit on the order's market date, nothing borrowed from other days; estimated cost = the order line's saved purchase price; a missing cost is reported, never invented (D3).
- **Exact money**: `numeric` all the way, unrounded line costs, one rounding per reported figure, the browser only formats strings (D4).
- **Balances reuse** the existing `ledger_stores` and `ledger_summary` (one definition with Home) plus a tiny note function for invoices "not in the account" (D6).
- **Six read routes plus a CSV route** (the CSV covers all six reports, balances included, read from the existing account list), six screens plus a hub, a Home card and a Settings link; the bottom navigation stays at five items; `/reports` joins the offline shell's "needs the internet" areas (D8, D10).
- **Kept internal by tests**: a static test fails if customer-facing, offline or backup code touches the report code; existing no-cost tests stay green (D11).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24, PostgreSQL 17 on Supabase (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages.**
**Storage**: Supabase PostgreSQL; **no new table or column**. One migration `0011_reports.sql` (functions and one index). Reads: `invoices`, `invoice_lines`, `order_lines`, `orders`, `products`, `stores`, `purchase_entries`, `purchase_voids`, and the ledger through the existing functions.
**Testing**: Vitest unit tests (period helper, money display, CSV cells, labels, static no-leak guard); PGlite database tests for every function (rules, exclusions, rounding, two tenants, crafted business id, read-only, grants); integration tests on the TEST project (real Supabase, two users); Playwright at 360 px and desktop (flows, states, offline message, touch targets, five navigation items, CSV download).
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (the same single Next.js project)
**Performance Goals**: sales summary, store and medicine reports for 5,000 issued invoices (50,000 lines) within 2 s on the TEST project; list pages of 50 rows; CSV of up to 5,000 rows.
**Constraints**: period at most 731 days; read-only; no cost or profit key outside `/api/reports/*`; online only (honest message offline); money as decimal strings; no service-role key in browser code; 44 px targets and no sideways scroll at 360 px; five bottom-navigation items.
**Scale/Scope**: 1 business / 1 owner; thousands of invoices, a few thousand medicines, tens of stores. New: 7 report functions plus 5 helpers and 1 index, 6 routes (+ export), 7 screens (hub, sales, purchases, stores, medicines, cost-missing, balances), a small shared screen kit, a pure TypeScript library (period, labels, CSV). Changed: Home (one card), Settings (one link), the offline shell's blocked-area list (one line).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes | PASS: every number comes from real invoices, purchases and ledger entries through real functions; no placeholder screen; export is real CSV and no PDF is claimed; a failed load shows an error with Retry, never zero; offline says "needs the internet" |
| II. Billing integrity and price snapshots | Yes (reads them) | PASS: revenue is the invoice's frozen line totals, never the catalog price; estimated cost is the order line's snapshot; quantities are billed (delivered), never ordered or purchased; no invoice or price is created or changed; reports never reach an invoice or the Account Summary. **Note**: the constitution says profit uses "the weighted average of actual recorded purchase costs". The owner's rule is that average taken over the order's market day (research D3). This narrows, not contradicts; a PATCH clarification is offered to the owner, not made here |
| III. Append-only ledger | Reads it | PASS: balances come from the existing ledger functions and are never stored or typed; nothing is written |
| IV. Medicine identification and order safety | Yes (grouping) | PASS: rows group by product id and unit, never by similar text; strengths, forms, manufacturers and pack sizes stay separate; typed lines stay visible in "Not registered"; no medicine is substituted or dropped |
| V. Security, RLS and secrets | Yes | PASS: functions run as the user (`SECURITY INVOKER`) with explicit business filters on top of RLS; revoked from `public` and `anon`; a crafted business id returns nothing (tested); no service-role key in browser code; validation of periods and limits is on the server; cost and profit appear only in `/api/reports/*` responses |
| VI. Server-side AI | No AI | PASS (n/a); no outside service and no financial data sent anywhere |
| VII. Offline-first with honest sync | Partly | PASS with a tracked deferral: reports are online only (the constitution does not require offline reports); `/reports` is a blocked area in the offline shell; the device copy and the backup file gain no field (tested); every balance is server-confirmed because payments are online only (offline payments were deferred in Module 009) |
| VIII. Mobile-first, verifiable delivery | Yes | PASS: 360 px, 44 px targets, stacked cards on phones, loading, error and empty states, five navigation items; lint, typecheck, test and build must run and only real results are claimed; migration is version-controlled with a rollback note |

**Post-design re-check (after Phase 1)**: All gates still PASS. Risks to revisit: (1) speed on the real database must be measured, not assumed; (2) a purchase recorded a day late leaves that day "cost missing" (by design of the owner's rule); (3) rows are rounded one by one, so cost and profit rows may differ from their total by a paisa (stated on screen, tested).

## Project Structure

### Documentation (this feature)

```text
specs/010-reports-profit/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.openapi.yaml # Phase 1 output
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # Phase 2 output (/sp.tasks, not created here)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0011_reports.sql                          # NEW: 7 read-only functions, 1 index, grants

src/lib/reports/                              # NEW (pure and server code)
├── types.ts                                  # response types (mirror contracts)
├── period.ts                                 # presets, Pakistan dates, validation, labels
├── validation.ts                             # Zod query schemas
├── repository.ts                             # supabase.rpc calls and refusal mapping
├── csv.ts                                    # per-report CSV (csvCell for text, csvNumber for numbers)
├── labels.ts                                 # Estimate / Realized / Incomplete wording, reason texts
└── client.ts                                 # fetch helpers for the screens

src/app/api/reports/                          # NEW
├── sales/route.ts  purchases/route.ts  stores/route.ts  medicines/route.ts  cost-missing/route.ts
├── balances-note/route.ts
└── export/route.ts

src/app/(app)/reports/                        # NEW
├── page.tsx                                  # hub
├── sales/page.tsx  purchases/page.tsx  stores/page.tsx  medicines/page.tsx
├── cost-missing/page.tsx  balances/page.tsx

src/components/reports/                       # NEW
├── ReportShell.tsx (title, period chooser, group switch, export button, states, offline note)
├── PeriodChooser.tsx  GroupSwitch.tsx  StatusBadge.tsx  BarList.tsx  MoneyFigure.tsx
├── SalesReportScreen.tsx  PurchasesReportScreen.tsx  StoresReportScreen.tsx
├── MedicinesReportScreen.tsx  CostMissingScreen.tsx  BalancesReportScreen.tsx
└── ReportsHub.tsx

src/app/(app)/page.tsx                        # CHANGED: one "Reports" card
src/app/(app)/settings/page.tsx               # CHANGED: one link
src/lib/device/shell-route.ts                 # CHANGED: one blocked area ("/reports")

tests/unit/            reports-period, reports-csv, reports-labels, reports-no-leak (static guard)
tests/integration/     db-report-*.pglite.test.ts (sales rules, cost rules, market-day example, exclusions,
                       rounding, by-store, by-medicine, cost-missing, purchases, balances note, rls, readonly,
                       scale), reports-api.test.ts (TEST project, two tenants)
tests/e2e/             reports-flow, reports-states, reports-touch-targets, reports-offline, reports-export
tests/helpers/         reports-db.ts (seed invoices, purchases, costs)
```

**Structure Decision**: the same single Next.js project and the same layering as Modules 005 to 007: SQL functions for computation, a thin repository, route handlers that validate and call it, client screens that read through `fetchJson`. Report code sits in its own folders so a static test can prove nothing customer-facing or offline imports it.

## Complexity Tracking

No constitution violation to justify. One recorded deviation of wording only: the market-day average of FR-012 narrows Principle II's "weighted average of actual recorded purchase costs" (see the Constitution Check note); it needs no amendment to build and is flagged for the owner.

## Suggested ADR

📋 Architectural decision detected: report computation as read-only database functions with a single shared sales-line base, and the market-day cost rule for realized profit. Document reasoning and tradeoffs? Run `/sp.adr reports-cost-rule-and-read-only-functions`
