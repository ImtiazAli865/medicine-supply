# Implementation Plan: Foundation — Login, Products, and Stores

**Branch**: `001-auth-products-stores` | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-auth-products-stores/spec.md`

## Summary

Module 001 delivers the greenfield foundation: a Next.js (App Router, TypeScript) mobile-first
app with Supabase email+password sign-in, protected routes, and CRUD (add, edit, view, search,
deactivate/reactivate, no hard delete) for Stores and Products. Every table carries
`business_id` and has Row Level Security from the first migration. Mutations and reads go
through REST route handlers that validate input with Zod and call Supabase using the signed-in
user's session, so RLS is always the enforcement layer. Database constraints enforce duplicate
rules, SKU uniqueness, non-negative `NUMERIC(12,2)` money, and optimistic-concurrency
versions. Records use client-generated UUIDs so retries are idempotent and later offline work
(module 009) needs no rework. Details and rationale: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (latest stable compatible with Next.js; pinned at scaffold), Node.js 24 LTS-line runtime as installed locally (v24.16.0)
**Primary Dependencies**: Next.js 16.x (App Router), React 19.x, Tailwind CSS 4.x, lucide-react, `@supabase/supabase-js` 2.x, `@supabase/ssr`, Zod 4.x. Exact versions are taken from the registry at scaffold time and committed in the lockfile.
**Storage**: Supabase PostgreSQL (authoritative); SQL migrations under `supabase/migrations/`; no IndexedDB in this module
**Testing**: Vitest (unit + integration), Playwright (mobile viewport E2E and accessibility checks), SQL/RLS integration tests with two real JWT sessions against a local Supabase stack or a dedicated test project
**Target Platform**: Android mobile browsers first (Chrome); responsive to tablet/desktop
**Project Type**: Web application (single Next.js project; backend = route handlers + Supabase)
**Performance Goals**: Product search < 1 s at 5,000 products; store search < 1 s at 500 stores; sign-in to home < 3 s on a normal mobile connection; first load of the app shell small enough for mobile (no heavy UI kit)
**Constraints**: No hard deletes; RLS on every table; service-role key never used by this module; no real secrets in git; no offline behavior required; English UI; PKR money, two decimals
**Scale/Scope**: 1 business, 1 user (solo) now; schema multi-business ready; ≤ 5,000 products, ≤ 500 stores; 8 screens (sign-in, home, products list, product form/detail, stores list, store form/detail, account-not-set-up, error/not-found)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: every button works against the real backend; "connected" only after integration tests pass | PASS — plan includes integration tests and the quickstart verifies the connection; no mocks of the database |
| II. Billing integrity & snapshots | Partly: money stored as `NUMERIC(12,2)`, non-negative, exact arithmetic; unit gross profit internal-only | PASS — no invoices yet; money helper uses integer minor units, never floats |
| III. Append-only ledger | No ledger in scope | PASS (n/a) — schema leaves room; nothing here blocks it |
| IV. Medicine identification & order safety | Yes: duplicate block, similar-product confirmation, never auto-merge, empty catalog usable | PASS — unique index on normalized identity; similar check requires explicit confirmation |
| V. Security, RLS, secrets | Yes: `business_id` + RLS from first migration; server-side validation; no service-role key | PASS — RLS tests with two businesses are a done-criterion; `.env.example` placeholders only |
| VI. Server-side AI | No AI in scope | PASS (n/a) |
| VII. Offline-first | Partly: client-generated UUIDs, idempotent create; no offline queue yet | PASS — create is idempotent on `id`; REST design is replay-friendly for module 009 |
| VIII. Mobile-first, verifiable delivery | Yes: bottom nav, 44 px targets, loading/error/empty states, lint/type/build gates | PASS — Playwright 360 px checks and CI-style gate commands are in the plan |

**Post-design re-check (after Phase 1)**: All gates still PASS. No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-auth-products-stores/
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
src/
├── app/
│   ├── (auth)/sign-in/page.tsx
│   ├── (app)/                      # protected group; layout re-checks the user server-side
│   │   ├── layout.tsx              # app shell + bottom navigation
│   │   ├── page.tsx                # home
│   │   ├── products/               # list, new, [id], [id]/edit
│   │   └── stores/                 # list, new, [id], [id]/edit
│   ├── api/
│   │   ├── products/route.ts       # GET (list/search), POST (create)
│   │   ├── products/[id]/route.ts  # GET, PATCH
│   │   ├── products/similar/route.ts
│   │   ├── stores/route.ts
│   │   ├── stores/[id]/route.ts
│   │   └── stores/similar/route.ts
│   └── layout.tsx, globals.css
├── proxy.ts                        # session refresh + redirect for signed-out users
├── components/                     # ui primitives, forms, list/empty/error/loading states, BottomNav
├── lib/
│   ├── supabase/                   # server.ts, browser.ts, proxy helper (anon key only)
│   ├── validation/                 # Zod schemas (product, store, money, normalize)
│   ├── money.ts                    # integer-minor-unit arithmetic, PKR formatting
│   ├── normalize.ts                # name normalization shared with SQL rules
│   ├── api/                        # typed error taxonomy, response helpers
│   └── ids.ts                      # client UUID generation
supabase/
├── migrations/                     # 0001_init (businesses, profiles, stores, products, RLS, indexes)
├── seed/provision-owner.sql        # documented, manual owner/business provisioning
└── config.toml
tests/
├── unit/                           # money, normalize, validation
├── integration/                    # route handlers + RLS isolation (two businesses)
└── e2e/                            # Playwright at 360 px and desktop
.env.example                        # placeholder names only
```

**Structure Decision**: One Next.js project at the repository root (no separate backend service). Route handlers are the single REST surface for business data so later modules, including the offline queue, call the same endpoints. Database rules live in SQL migrations so they hold regardless of client.

## Complexity Tracking

No constitution violations to justify.
