# Implementation Plan: Fast Order Entry

**Branch**: `008-fast-order-entry` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-fast-order-entry/spec.md`

## Summary

Module 008 makes taking an order faster than writing it by hand, with no AI, no microphone and no new package. It changes only the order screen of Module 003: the add-medicine dialog that closes after every pick is replaced by a search box that stays on the screen, and two shortcuts are added for drafts: the store's **usual medicines** (one tap each) and **Repeat last order** (one tap for a whole order).

Approach (details and rationale in [research.md](research.md)):

- **No migration.** The usual list and the repeat source are derived from existing tables with their select-only Row Level Security; every write is the existing idempotent `order_save` (D1).
- **A slim medicine route** (`/api/orders/medicines`) returns active medicines without any purchase price or MRP (the existing `/api/products` sends them), pages the catalog, and also serves the server search (D2).
- **The list is searched on the device**: loaded page by page when the screen opens, filtered in code; typing is answered by the server search until the load ends; above 6,000 medicines the server search stays in use with a notice (D3).
- **Safe matching rules in pure code**: every word must match; the Enter highlight exists only when exactly one medicine matches; digits are text; a quantity is read only from a trailing `x20` when the text finds nothing, and never chooses a medicine (D4, D5).
- **One screen, two inputs**: search box and quantity box always mounted, focus moves inside one tap so the phone keyboard stays open; Enter adds and returns to the search box (D6).
- **One Undo** (8 seconds) for the last add or the last repeat (D7).
- **Usual and repeat routes** compute on the server as the user: counts per order over at most the 100 latest qualifying orders of 180 days, read in pages under the 1,000-row cap; a repeat is applied as one editor change, so one save creates the draft with all lines or none (D8, D9).
- **Measured, not assumed**: each speed goal has a budget and a test (D12); the SQL function path stays as the fallback if a budget is missed.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages.**
**Storage**: Supabase PostgreSQL, **no change** (no migration). Reads: `products`, `orders`, `order_lines`. Writes: only `order_save` through the existing `PUT /api/orders/{id}`.
**Testing**: Vitest (unit: query parsing, matching, highlight rule, aggregation, repeat mapping, no-price types, filter benchmark); integration on the TEST project with two real tenants (isolation, crafted ids, raw JSON has no price, paging past 1,000 rows, timings); Playwright at 360 px and desktop (flows, counted taps and keys, states, touch targets, five navigation items); the existing e2e steps that used the dialog are updated in one pass.
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: keystroke to results within 300 ms for 5,000 medicines (95%); full load of 5,000 medicines within 5 s while typing keeps working; usual route within 1.5 s for 100 orders of 20 lines; repeat route within 1.5 s for 200 lines (budgets in research D12).
**Constraints**: quantity 1 to 100,000 whole; at most 200 lines per order; online only (a failed save shows the existing message and keeps the screen); no price, MRP, cost, margin, profit, balance or invoice value in any new response; PostgREST returns at most 1,000 rows per request; controls at least 44 by 44 px at 360 px; five bottom-navigation items.
**Scale/Scope**: 1 business / 1 owner; a catalog of a few hundred to 5,000 medicines; tens of stores with up to about 100 orders each in 180 days. New: three read routes, one pure search library, two hooks, four components (search with quantity and typed form, usual cards, repeat button, undo bar). Changed: `OrderEditor`, `useOrderEditor`, `editor-state` types, the e2e helpers. Removed: `MedicineSearch.tsx`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real reads and the real order save | PASS: every control calls a real route or the real autosave; nothing says saved until the server confirmed (the existing save status); no stub; the on-device list is called a copy for searching and never offline data |
| II. Billing integrity and price snapshots | Touches order lines | PASS: no price is read from an old order and none is copied; prices are still recorded only at confirm by the existing function; the module never confirms, invoices or changes a price |
| III. Append-only ledger | No | PASS (n/a); nothing touches the ledger |
| IV. Medicine identification and order safety | Yes: this is the core of the module | PASS: no auto-merge or substitution (similar strengths are all shown with their details); nothing is added or highlighted without the supplier's act, except one visible match for Enter; digits in a name are never a quantity; typed lines and unknown medicines never block; repeat lists what it left out instead of dropping silently; one store's lines never move to another store (a repeat is for the same store only, checked on the server); empty catalog and empty history work with empty states |
| V. Security, RLS and secrets | Yes: three new read routes | PASS: all three run as the user, so existing RLS applies; explicit column lists keep price, MRP and snapshots out; isolation tested with two real users and a crafted order id; no new secret; validation of ids and limits is on the server |
| VI. Server-side AI | No AI in scope | PASS (n/a); no outside service and no financial data anywhere |
| VII. Offline-first with honest sync | Partly: the constitution wants order taking offline | PASS with the same tracked deferral as Modules 003 to 007: online only; a failed save shows the existing error and keeps the screen; the app never says "saved on this device" or "pending sync"; offline is Module 009 |
| VIII. Mobile-first, verifiable delivery | Yes: new controls and messages | PASS: Playwright at 360 px with the touch-target check on every new control and message; loading, error with Retry and empty states for each list; five navigation items; lint, typecheck, test and build must pass and only real runs are claimed |

**Post-design re-check (after Phase 1)**: All gates still PASS. Risks recorded to revisit: (1) the phone keyboard staying open cannot be proven by a browser test, so it is an owner check (quickstart section 3, step 4) recorded as reported, not seen; (2) the usual route reads up to 100 orders and their lines in two or more requests: measured against its budget, with the SQL function (migration 0011 or higher) as the stated fallback; (3) the constitution's module list still says "008 voice"; updating it is the owner's decision and is flagged only.

## Project Structure

### Documentation (this feature)

```text
specs/008-fast-order-entry/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.openapi.yaml # three read routes
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/sp.tasks command, not created by /sp.plan)
```

### Source Code (repository root)

```text
src/
├── app/api/orders/
│   ├── medicines/route.ts        # new: slim active medicines (page or search)
│   ├── usual/route.ts            # new: usual medicines + repeat source for a store
│   └── repeat/route.ts           # new: lines to copy + skipped list
├── lib/
│   ├── orders/
│   │   ├── fast-types.ts         # new: SlimMedicine, UsualMedicine, RepeatSource, RepeatPlan (no price fields)
│   │   ├── fast-search.ts        # new, pure: parse query (words, x quantity), filter and order, highlight rule
│   │   ├── fast-usual.ts         # new, pure: count per order, sort, pick quantity/unit; repeat mapping
│   │   ├── fast-repository.ts    # new, server: reads with explicit columns, paging under the row cap
│   │   └── editor-state.ts       # changed: infoFromProduct accepts SlimMedicine
│   ├── validation/fast-order.ts  # new: Zod for the three routes
│   └── hooks/
│       ├── useMedicineList.ts    # new: load pages, server search meanwhile, too-large mode, refresh
│       ├── useUsualMedicines.ts  # new: usual + source for a store; repeat fetch
│       └── useOrderEditor.ts     # changed: addLines, removeLines; addCatalogLine takes SlimMedicine
└── components/orders/
    ├── FastAdd.tsx               # new: search box, results, quantity box, inline typed form
    ├── UsualMedicines.tsx        # new: cards with stepper and quick buttons
    ├── RepeatLastOrder.tsx       # new: button, skipped-lines message
    ├── UndoBar.tsx               # new: one Undo for 8 seconds
    ├── OrderEditor.tsx           # changed: uses the four components; pickProduct takes a quantity
    └── MedicineSearch.tsx        # deleted (only OrderEditor used it)

tests/
├── unit/                         # fast-search, fast-usual, fast-types (no price), filter benchmark
├── integration/                  # fast-order-api (two tenants), fast-order-scale (paging, timings)
└── e2e/                          # fast-repeat, fast-usual, fast-search, fast-states, fast-search-scale;
                                  # orders-helpers + the six specs that used the dialog updated;
                                  # touch-targets and shell extended
```

**Structure Decision**: The same single Next.js project and the same layering as Modules 003 to 007: pure logic in `src/lib/orders`, server reads in a repository, thin route handlers, hooks for screen state, components for the screen. No new top-level folder.

## Complexity Tracking

No Constitution Check violations, so nothing to justify. Deliberate limits recorded instead: (1) online only, offline is Module 009; (2) usual looks at the 100 latest qualifying orders of 180 days, not all history; (3) the on-device list is capped at 6,000 medicines, above that the server search is used and the screen says so; (4) the keyboard behaviour on a real phone is an owner check; (5) the old add-medicine dialog is removed, not kept beside the new flow; (6) medicine nicknames, pasted text, barcode and voice are not started.
