# Implementation Plan: Manual Orders and Store-wise Order History

**Branch**: `003-manual-orders` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-manual-orders/spec.md`

## Summary

Module 003 adds the core of the product on top of Modules 001 and 002: the supplier takes an **order by hand** for one store, it is **auto-saved as a draft**, it is **confirmed** (which freezes the prices), it can be **edited or cancelled** afterwards, and every store has its own searchable **order history**. Medicines that are not in the catalog are kept as typed "Not registered" lines that never block anything.

Approach (details and rationale in [research.md](research.md)):

- **Orders are written only by database functions.** `order_save`, `order_confirm` and `order_cancel` run as `SECURITY DEFINER`, take the business from the caller's session, and are the only way to change `orders`, `order_lines` and the change history. Users get `select` only on those tables, so a direct request cannot skip a price snapshot or a status rule. Composite foreign keys make a cross-business reference impossible even if a function were wrong (D1).
- **Saves are idempotent and conflict-safe.** Ids are created on the device; every save carries a `request_id` and the version it was based on. Repeating the same request returns the stored result; an older copy is refused with the current order instead of overwriting (D2).
- **Order numbers come from a per-business counter updated in the same transaction**, so concurrent creates never duplicate or skip a number (D3).
- **The price snapshot is taken at confirm and is immutable** (a trigger enforces it). A draft shows the live current price, labelled as such. Totals are computed in SQL from exact `NUMERIC`; an unpriced line is never counted as zero silently (D5, D6).
- **Autosave is a small, tested state machine** on the client: one request in flight, debounce, retry with the same `request_id`, honest "Saving / Saved / Not saved / Changed elsewhere" states, and a warning before leaving with unsaved data. A confirmed order is edited with an explicit "Save changes" that writes one history entry (D7, D8).
- **Rules that protect data are enforced in the database**: the store of a draft is locked once it has a line, lines are never hard-deleted (soft removal), the history is append-only (D4, D9, D14).
- **Reuse over new surface**: medicine search and inline store creation use the existing `/api/products` and `/api/stores` endpoints and the existing hooks (D11).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages.**
**Storage**: Supabase PostgreSQL. New migration `supabase/migrations/0003_orders.sql`: tables `order_counters`, `orders`, `order_lines`, `order_events`; unique `(business_id, id)` on `stores` and `products`; functions `order_save`, `order_confirm`, `order_cancel`, `order_get`, `order_list` and small internal helpers; triggers for immutability and append-only history; RLS (select only) on every new table.
**Testing**: Vitest (unit: autosave state machine, validation, totals, number and date helpers), PGlite (real PostgreSQL: functions, constraints, triggers, RLS), Supabase integration (two real users: idempotency, simultaneous requests, conflicts, isolation, timings), Playwright (production build: order flows at a phone viewport, recovery, conflicts, 360 px / 44 px).
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: A typical 10-line order is taken in under 3 minutes (SC-001); medicine search shows results within 1 s for 95% of searches on 5,000 medicines (SC-009); first page of the history opens within 2 s with 1,000 orders (SC-010). Each save is one request carrying at most 200 lines (a few KB).
**Constraints**: Quantity 1 to 100,000 (whole numbers); at most 200 lines per order; notes up to 1,000 and cancel reason up to 500 characters; order and line ids and the save `request_id` are created on the device; no offline queue (Module 009), so a failed save is shown as "Not saved" and nothing is claimed about the device; money is PKR `NUMERIC` and moves as exact strings; purchase price and MRP are stored in the snapshot but never returned to order screens.
**Scale/Scope**: 1 business / 1 owner; hundreds to low thousands of orders; up to about 5,000 medicines. New screens: Orders (history), New order (store choice), Order (editor and read-only view with change history). Home gains a "New order" action and "Continue order" cards; navigation gains an Orders item; the store page gains a link to its orders.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real orders in the real database; "Saved" only after the server confirms; no dead buttons; no offline claim | PASS: states come from real responses; the autosave machine is unit-tested with lost responses; tests run on a real engine (PGlite) and the Supabase test project |
| II. Billing integrity & snapshots | Yes (core): snapshot at confirm; unpriced lines stay unpriced; exact PKR; delivered quantity defaults to ordered quantity; no invoice here | PASS: snapshot columns are protected by a trigger; line total is a generated column; draft prices are shown as "current price" and never stored; no price is ever invented; purchase price and MRP are not exposed to order screens |
| III. Append-only ledger | No ledger in scope | PASS (n/a). The change history is append-only as the same spirit requires |
| IV. Medicine identification & order safety | Yes (core): typed lines never block; nothing auto-matched or merged; one store per order; saved orders never overwritten or emptied | PASS: store lock enforced in the database; matching only by explicit choice; "None of these" always offered; versions refuse stale overwrites; soft removal only |
| V. Security, RLS, secrets | Yes: new tables with RLS; writes only through functions that filter by business; composite foreign keys; audit history; no secrets | PASS: cross-business tests (reads, writes, crafted ids) on PGlite and Supabase are done-criteria; no service-role key in the app |
| VI. Server-side AI | No AI in scope | PASS (n/a) |
| VII. Offline-first with honest sync | Partly: the constitution wants order taking and drafts to work offline | PASS with a tracked deferral: offline is scheduled for Module 009. This module never claims offline or "saved on this device"; it shows "Not saved" when the server cannot be reached; client-generated ids, request ids and versions are exactly what the later queue needs. See Complexity Tracking |
| VIII. Mobile-first, verifiable delivery | Yes: 360 px, 44 px targets, loading/error/empty states, searchable selectors, no slow animations; lint, typecheck, build and tests before "done" | PASS: Playwright at 360 px with a touch-target test; a timed 10-line order; results recorded honestly |

**Post-design re-check (after Phase 1)**: All gates still PASS. The only deviation is the recorded Module 009 deferral of offline order taking.

## Project Structure

### Documentation (this feature)

```text
specs/003-manual-orders/
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
└── 0003_orders.sql                          # tables, RLS, grants, triggers, functions

src/
├── app/
│   ├── (app)/
│   │   ├── page.tsx                         # Home: "New order" action + "Continue order" cards
│   │   ├── orders/page.tsx                  # Order History (filters from the URL: ?store= &status= &from= &to= &q=)
│   │   ├── orders/new/page.tsx              # Choose a store, then go to /orders/<new id>?store=<id>
│   │   ├── orders/[id]/page.tsx             # Editor for draft/confirmed orders, read-only view for cancelled
│   │   └── stores/[id]/page.tsx             # adds a link to that store's orders
│   └── api/
│       ├── orders/route.ts                  # GET (history)
│       ├── orders/[id]/route.ts             # GET (one order), PUT (save: create/update/edit)
│       ├── orders/[id]/confirm/route.ts     # POST
│       ├── orders/[id]/cancel/route.ts      # POST
│       └── products/route.ts                # (existing) search also matches dosage form (D11)
├── components/
│   ├── orders/
│   │   ├── OrderHistory.tsx                 # list, filters, empty states
│   │   ├── OrderFilters.tsx
│   │   ├── OrderListItem.tsx
│   │   ├── NewOrderStart.tsx                # store choice step
│   │   ├── StoreSelector.tsx                # search + inline "Add new store" (existing /api/stores)
│   │   ├── OrderEditor.tsx                  # draft autosave mode and confirmed edit mode
│   │   ├── MedicineSearch.tsx               # searchable results + "Add as typed" / "None of these"
│   │   ├── OrderLineRow.tsx                 # quantity, unit, remove, badges (Not registered, No selling price)
│   │   ├── OrderTotals.tsx                  # priced total with the unpriced-lines note
│   │   ├── SaveStatus.tsx                   # Saving / Saved at HH:MM / Not saved (Retry) / Changed elsewhere
│   │   ├── ConfirmOrderDialog.tsx
│   │   ├── CancelOrderDialog.tsx
│   │   ├── OrderStatusBadge.tsx
│   │   ├── OrderHistoryLog.tsx              # change history on the order screen
│   │   └── ContinueOrders.tsx               # Home cards
│   └── shell/BottomNav.tsx                  # 5 items: Home, Orders, Products, Stores, Settings
├── lib/
│   ├── orders/
│   │   ├── types.ts                         # Order, OrderLine, OrderSummary, OrderEvent
│   │   ├── repository.ts                    # calls the database functions, maps reasons to ApiError
│   │   ├── autosave.ts                      # pure state machine (debounce, coalesce, retry, conflict)
│   │   ├── totals.ts                        # exact line and order totals for the draft screen
│   │   ├── number.ts                        # ORD-0001 formatting and order-number search parsing
│   │   └── dates.ts                         # Pakistan-day range helpers for the filters
│   ├── validation/order.ts                  # Zod: save, action, cancel, list query
│   ├── hooks/useOrderEditor.ts              # React binding of autosave.ts (online state, beforeunload)
│   ├── api/errors.ts                        # + order_not_editable, store_locked, order_empty (409)
│   └── products/repository.ts               # search tokens also match dosage_form
tests/
├── unit/                                    # autosave, order-validation, totals, order-number, dates
├── integration/                             # db-orders-schema, db-orders-create-confirm, db-orders-save, db-orders-typed,
│                                            # db-orders-snapshot, db-orders-list, db-orders-edit-cancel, db-orders-rls (all .pglite);
│                                            # orders-api, orders-prices, orders-concurrency, orders-history, orders-edit-cancel,
│                                            # rls-orders, search-5000
├── helpers/                                 # pglite.ts (already applies all migrations), supabase-test.ts (deleteTenant + orders tables)
└── e2e/                                     # orders-take.spec, orders-recovery.spec (includes the changed-elsewhere case),
                                             # orders-typed.spec, orders-prices.spec, orders-history.spec,
                                             # orders-confirm-edit-cancel.spec, orders-timing.spec
```

**Structure Decision**: Same single Next.js project. Everything that must hold true for the data (status moves, snapshots, numbers, store lock, history, tenant isolation) lives in SQL; request shapes and limits live in Zod; the autosave and total logic live in pure modules so they can be tested without a browser; screens only bind them.

## Complexity Tracking

| Deviation | Why it is acceptable now | What closes it |
|-----------|--------------------------|----------------|
| Constitution VII asks that order taking and drafts work offline; this module needs a connection | The module list agreed with the owner places offline and sync in Module 009. This module is honest about it (no "saved on device" claim; "Not saved" with Retry; a warning before leaving) and prepares the pieces a queue needs (device-created ids, request ids, versions, idempotent save) | Module 009 (offline drafts, pending-operation queue, conflict handling) |
| `SECURITY DEFINER` functions bypass RLS | Needed so that status, snapshot, number and history rules cannot be skipped by a direct table write (D1) | Every function filters by the caller's business; composite foreign keys; cross-business tests on PGlite and the Supabase test project are a done-criterion |

## ADR candidate

📋 Architectural decision detected: orders are written only through `SECURITY DEFINER` functions with request-id idempotency and versioned whole-order saves, with the price snapshot taken at confirm and protected by a trigger. Document reasoning and tradeoffs? Run `/sp.adr order-write-model-and-price-snapshots` (only with the owner's consent).
