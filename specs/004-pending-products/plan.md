# Implementation Plan: Pending Products (Quick Register, Linking, Pending Prices)

**Branch**: `004-pending-products` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-pending-products/spec.md`

## Summary

Module 004 turns the typed ("Not registered") lines of Module 003 into real medicines and makes unpriced confirmed lines ready for invoicing, without ever merging look-alike medicines or touching a recorded price. The supplier can **register** a typed medicine from the order line (name and unit only), **link** a typed line to an existing medicine, accept **proposals** to link the same typed medicine in other orders one by one, and use **Pending Prices** to enter a selling price once, review the exact lines, and confirm. Pending items stay visible on Home and on the order screens.

Approach (details and rationale in [research.md](research.md)):

- **Three database functions are the only write path** (`pending_line_register`, `pending_line_link`, `pending_price_apply`), `SECURITY DEFINER`, reading the business from the session, following ADR-0003. Register creates the medicine and links the line in one transaction, so a failure never leaves a created medicine with an unlinked line (D1).
- **Replay safety for all three** through a small table `pending_requests` keyed by `(business_id, request_id)`: a repeated request returns the stored result, including simultaneous repeats serialised by advisory locks that use the same key as `order_save` (D2, D3).
- **A link bumps the order version**, so an open editor sees "changed elsewhere" and never overwrites a linked line (D3). The typed text is kept in a new write-once column `order_lines.typed_name`, and the line takes the medicine's description (D4).
- **The recorded-price rule is enforced twice**: the function compares the reviewed list of line ids with the lines that are really waiting, and the `update` itself only touches rows whose `selling_price_snapshot is null`. Zero, negative and over-precise prices are refused; an existing catalog price is never overwritten (D6).
- **Duplicate and similar-name checks reuse the Module 001 rules** inside the function, with the same codes, so the existing similar-medicine dialog is reused (D7).
- **Proposals are narrow on purpose**: only an exact label match is proposed; look-alikes are listed as "not proposed"; nothing is linked without a per-line confirmation (D8).
- **New history entry types** (`linked`, `price_filled`) keep the audit trail append-only (D5).
- **Reuse over new surface**: no new packages, the existing medicine search for linking, no sixth navigation item (D11).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages.**
**Storage**: Supabase PostgreSQL. New migration `supabase/migrations/0004_pending_products.sql`: column `order_lines.typed_name` and its write-once trigger; table `pending_requests`; the `order_events` event-type check extended to `linked` and `price_filled`; `order_to_json` replaced to return `typed_name`; three write functions and five read functions; three partial indexes (data-model sections 1 to 6).
**Testing**: Vitest (unit: validation of the new bodies and queries, label and money helpers), PGlite (real PostgreSQL: functions, constraints, triggers, RLS, the snapshot-edit flag, replay, version conflict), Supabase integration (two real users: API round trips, 10 simultaneous identical requests, cross-business refusal, a 1,000-line / 500-medicine scale check), Playwright e2e at 360 px (register, link, proposals, Pending Prices, Home card, touch targets, states).
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: Pending Prices and the proposals list open within 2 seconds with 1,000 pending lines and 500 unpriced medicines (SC-011); register in under 1 minute from the tap (SC-001); the Home count is recomputed on open.
**Constraints**: Price greater than zero, at most `9999999999.99`, two decimals; a fill reviews at most 1,000 lines in one request; proposal groups show at most 200 lines each with a cursor; request ids and the new medicine id are created on the device; no offline queue (Module 009); purchase price and MRP appear only as optional fields of the register form and the Module 001 product screens.
**Scale/Scope**: 1 business / 1 owner; up to about 5,000 medicines and thousands of order lines. New screens: Pending (two tabs) and Set price with review; new dialogs: Register, Link, Proposals; Home gains a "Needs attention" card; order lines gain actions and an "As typed" line.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real medicines, links and prices in the real database; success shown only after the server confirms; no dead buttons | PASS: every action calls a real function; failures show the reason (duplicate, similar, conflict, list changed); tests include induced failures and replays |
| II. Billing integrity & snapshots | Yes (core): recorded prices never change; a missing price is filled only after confirmation, through Pending Prices, with an audit record; prices are never invented | PASS: the fill compares the reviewed list and the `update` itself requires `selling_price_snapshot is null`; zero price refused; an existing catalog price is not overwritten; history entry per line; purchase price and MRP never exposed |
| III. Append-only ledger | No ledger in scope | PASS (n/a). History entries are append-only like the rest of the order history |
| IV. Medicine identification & order safety (core) | Yes: no auto-merge of strengths, forms or pack sizes; duplicate check before creating; Quick Register needs only name and unit; per-link confirmation; no line, quantity or store mixing | PASS: exact duplicates blocked by the same rules and unique indexes as Module 001; similar names need explicit confirmation; proposals only for exact labels and never linked automatically; a link changes one line and never moves it between orders |
| V. Security, RLS, secrets | Yes: new functions and table; business filter in every statement; composite foreign keys; server-side validation; audit history; no secrets in the browser | PASS: cross-business tests (reads, links, fills, crafted line and product ids) on PGlite and with two Supabase users; the idempotency table has no grants; the snapshot-edit flag is transaction-local and checked in tests |
| VI. Server-side AI | No AI in scope | PASS (n/a) |
| VII. Offline-first with honest sync | Partly: the constitution wants order work offline; registering and pricing are online-only here | PASS with the same tracked deferral as Module 003: offline is Module 009; this module never claims "saved on this device" and shows a visible error when the request fails |
| VIII. Mobile-first, verifiable delivery | Yes: 360 px, 44 px targets, loading/error/empty states, reused search | PASS: Playwright at 360 px with the touch-target check on every new screen and dialog; lint, typecheck, build and tests are run before anything is called done |

**Post-design re-check (after Phase 1)**: All gates still PASS. Recorded risk to revisit: undoing a wrong link or a wrong price fill is out of scope (spec Assumptions); the confirm steps are the protection, and the correction path will be decided with invoicing in Module 006. The Home card can show a large "need a price" number right after a catalog import; it shows two separate counts and the list defaults to medicines that have waiting orders first.

## Project Structure

### Documentation (this feature)

```text
specs/004-pending-products/
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
└── 0004_pending_products.sql                # column, table, indexes, check, functions, grants

src/
├── app/
│   ├── (app)/
│   │   ├── page.tsx                         # Home: "Needs attention" card
│   │   ├── pending/page.tsx                 # Tabs: To register (typed groups), Need a price (list)
│   │   ├── pending/prices/[productId]/page.tsx   # Set price, review the lines, confirm
│   │   └── products/page.tsx                # link to Pending Prices
│   └── api/
│       ├── orders/[id]/lines/[lineId]/register/route.ts   # POST
│       ├── orders/[id]/lines/[lineId]/link/route.ts       # POST
│       └── pending/
│           ├── summary/route.ts                           # GET
│           ├── typed/route.ts                             # GET
│           ├── candidates/route.ts                        # GET
│           ├── prices/route.ts                            # GET
│           └── prices/[productId]/{preview,apply}/route.ts   # GET, POST
├── components/
│   ├── pending/
│   │   ├── RegisterMedicineDialog.tsx       # form (name, unit required), similar/duplicate handling
│   │   ├── LinkMedicineDialog.tsx           # search, side-by-side confirm
│   │   ├── ProposalsDialog.tsx              # "Link these too?" per-line confirm, "Looks different" group
│   │   ├── PendingSummaryCard.tsx           # Home card
│   │   ├── TypedGroupList.tsx               # "To register" tab
│   │   ├── PendingPricesList.tsx            # "Need a price" tab
│   │   └── PriceFillReview.tsx              # price input, review list, confirm / save price only
│   └── orders/
│       ├── OrderLineRow.tsx                 # "As typed" text, Register / Link actions (modified)
│       ├── OrderView.tsx, OrderEditor.tsx   # pass the actions, flush before opening (modified)
│       └── OrderHistoryLog.tsx              # linked and price_filled entries (modified)
├── lib/
│   ├── pending/
│   │   ├── types.ts                         # response and candidate types
│   │   ├── repository.ts                    # calls the functions, maps reasons to ApiError
│   │   └── client.ts                        # fetch helpers for the screens (request ids, reasons)
│   ├── validation/pending.ts                # Zod: register, link, apply, list queries
│   ├── orders/types.ts                      # typed_name, event types (modified)
│   └── api/errors.ts                        # new codes (modified)

tests/
├── helpers/pending.ts                       # seed typed lines, confirmed orders, unpriced medicines
├── unit/pending-validation.test.ts
├── integration/
│   ├── db-pending-{schema,register,link,candidates,price-fill,rls,history}.pglite.test.ts
│   ├── pending-api.test.ts                  # Supabase: round trips, replay, conflicts
│   ├── pending-concurrency.test.ts          # Supabase: 10 simultaneous identical requests
│   ├── pending-prices.test.ts               # Supabase: existing price never changed, list_changed
│   ├── rls-pending.test.ts                  # Supabase: two businesses, crafted ids
│   └── pending-scale.test.ts                # Supabase: 1,000 lines / 500 medicines list time
└── e2e/
    ├── pending-register.spec.ts, pending-link.spec.ts, pending-proposals.spec.ts
    ├── pending-prices.spec.ts, pending-home.spec.ts
    └── touch-targets.spec.ts, states.spec.ts, shell.spec.ts    # extended (modified)
```

**Structure Decision**: Same single Next.js project and layout as Modules 001 to 003. New code lives in `src/lib/pending`, `src/components/pending` and `src/app/(app)/pending`, with the REST handlers under `src/app/api`. The order write functions and the autosave machine are not modified; only `order_to_json`, the order line row, the order screens' action slots and the history log are touched.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. Two deliberate limits are recorded instead: (1) undo of a link or a fill is not built (spec Assumptions, risk to revisit in Module 006); (2) registering and pricing need a connection (offline is Module 009).

📋 **Architectural decision detected**: how linking and price fill use the snapshot-edit hook, the `pending_requests` idempotency table, the `typed_name` column and the new history event types. Document reasoning and tradeoffs? Run `/sp.adr pending-link-and-price-fill-write-model`. (Not created without your consent. Created on 2026-11-11 with the owner's consent: `history/adr/0004-pending-link-and-price-fill-write-model.md`.)
