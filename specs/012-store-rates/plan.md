# Implementation Plan: Store-specific selling prices (Module 012)

**Branch**: `012-store-rates` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/012-store-rates/spec.md`

## Summary

Let the supplier set each draft line's selling price, optionally remember it as the store's rate for that medicine, and pre-fill it next time (also offline). One effective-price rule (typed, store rate, catalog, none) is applied by the database and mirrored on the screen. A recorded price never changes; confirm stops if the price shown is no longer the price that would be recorded. See [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/).

## Technical Context

**Language/Version**: TypeScript, Next.js 16 (App Router), React, Node.js 24
**Primary Dependencies**: Supabase (Postgres, Auth, RLS), Zod, Tailwind CSS 4. No new package.
**Storage**: Postgres (migration `0012_store_rates.sql`), IndexedDB (device schema 3)
**Testing**: Vitest (unit, PGlite database tests, TEST-project integration), Playwright
**Target Platform**: mobile browser first (360 px), desktop browser
**Project Type**: web application, single repository
**Performance Goals**: the order screen with 200 lines and a store with 2,000 rates stays as fast as today; `order_list` keeps one query
**Constraints**: money exact (`numeric`, decimal strings); offline order taking must never be blocked
**Scale/Scope**: up to about 200 stores and 5,000 medicines; rates are sparse (only what was remembered)

## Constitution Check (constitution 1.1.0)

| Principle | How this plan meets it | Result |
|-----------|------------------------|--------|
| I. Real functionality | Real tables, functions and screens; success only after the server answers | Pass |
| II. Billing integrity, snapshots | Snapshot still at confirm; a recorded price never changes; no price is computed from another; invoices untouched | Pass |
| III. Ledger append-only | Not touched | Pass |
| IV. Medicine identification and order safety | A rate is keyed by product id; saving an order never fails because of a rate | Pass |
| V. Security, RLS, secrets | RLS on both new tables, writes only through functions, other businesses get "not found"; no new secret | Pass |
| VI. Server-side AI | No AI | Not applicable |
| VII. Offline-first, honest sync | Rates on the phone with their age; typed prices survive sync and backup; confirm stays online | Pass |
| VIII. Mobile-first, verifiable | 360 px and 44 px controls; results recorded only after they run | Pass |
| Fixed decisions | "One catalog Selling Price per product, plus optional per-store negotiated rates" (amended 1.1.0) | Pass |

Re-checked after the design above: no violation; Complexity Tracking is empty.

**One rule of an earlier module changes on purpose**: the backup file may now carry a price, only on a waiting order line (research D10). The diff of that guard is shown to the owner before any commit.

## Project Structure

### Documentation (this feature)

```text
specs/012-store-rates/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/ (store-rates.openapi.yaml, order-prices.md, backup-file.v3.delta.json)
├── checklists/requirements.md
└── tasks.md            (next step: /sp.tasks)
```

### Source Code (repository root)

```text
supabase/migrations/0012_store_rates.sql     new
src/lib/orders/          price.ts (new: effective price), types, editor-state, totals, autosave
src/lib/rates/           new: types, repository
src/lib/validation/      order.ts (price, remember, expected_prices), rate.ts (new)
src/app/api/orders/      [id] save and confirm; rates/ (new)
src/app/api/stores/[id]/rates/               new routes
src/components/orders/   line price editor, "remember", price source and catalog-change note, price-changed dialog
src/components/stores/   store rates list (loading, error with Retry, empty)
src/components/pending/  show the price and its source in Register, Link and Pending Prices
src/lib/device/          schema 3 (storeRates), cache, local-api, sync-center (rate conflicts, store remap)
src/lib/backup/          file v3, preview, apply
tests/                   unit, integration, e2e
```

**Structure Decision**: the existing single Next.js project; one new migration; no file of an applied migration is edited.

## Delivery order (by user story)

1. **Foundation**: migration, effective-price function, TypeScript mirror with shared cases, database tests (isolation between stores and businesses).
2. **US1 price on a line** (P1): save, order JSON and totals, line editor, confirm with expected prices.
3. **US2 remember** (P1): remember on save, rate conflicts, pre-fill from search, usual, repeat and checklist.
4. **Register / Link / Pending Prices** respect store rates (spec edge cases).
5. **Offline** (FR-016, FR-017): device schema 3, offline pre-fill, sync, backup v3.
6. **US3 catalog-change note** and **US4 store rate list**.
7. Full checks, guides, README; the manual PDF is updated outside git.

## Risks

| Risk | Effect | Guard |
|------|--------|-------|
| Screen and server compute different prices | Wrong bill | One rule with shared test cases; confirm compares (D5) |
| Replacing `order_save` / `order_confirm` breaks existing behaviour | Orders cannot be saved | Existing order tests must pass unchanged before new behaviour is added |
| Migration not applied where the new app runs | Order screen errors | Apply 0012 first (quickstart 1); it is additive, so the old app keeps working with it |

## Owner steps

Apply 0012 to TEST and DEV; try quickstart section 3; commit, push and merge only when the owner says so.

## Complexity Tracking

None.
