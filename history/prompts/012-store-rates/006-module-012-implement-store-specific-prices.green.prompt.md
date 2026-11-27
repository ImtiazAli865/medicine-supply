---
id: 006
title: Module 012 implement store specific prices
stage: green
date: 2026-11-27
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: /sp.implement
labels: ["implement","store-rates","migration-0012","offline","module-012"]
links:
  spec: specs/012-store-rates/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - supabase/migrations/0012_store_rates.sql
 - src/lib/orders/price.ts and the order, rate, pending, validation, device and backup code
 - src/app/api/orders/rates/route.ts
 - src/app/api/stores/[id]/rates/
 - src/components/orders/LinePriceEditor.tsx
 - src/components/stores/StoreRates.tsx
 - src/components/shell/RateConflictNotice.tsx
 - tests/ (new and updated unit, database, API, scale and browser tests)
 - README.md and guides/
 - specs/012-store-rates/quickstart.md
 - specs/012-store-rates/tasks.md
tests:
 - npm test (198 files, 197 passed; 1,989 tests, 1,988 passed; one timing check failed under load and passed alone)
 - npm run test:e2e (934 tests, run in parts; 576 passed, 358 skipped by design; 9 failed on first attempt and passed when run again)
 - npm run lint, npx tsc --noEmit (passed)
---

## Prompt

Yes, implement it (translated from Roman Urdu).

Follow-ups during the same work (translated from Roman Urdu): "Yes, I ran it" and twice "It said success" (applying migration 0012 on the TEST project), and "continue".

## Response snapshot

Built migration 0012, the one price rule on both sides, the price editor on order lines, remembering a rate per store and medicine, the store's price list, the price check at confirm, offline rates (phone database version 3), backup file version 3 and the documents. Found and fixed on the way: the TEST project's leftover eight-argument `order_save` from the dropped voice work, and the phone saving rates after the medicine list. Results are in quickstart section 4. Open: T042 (the owner applies 0012 on DEV and tries it) and T043 (show the backup guard change, then commit and pull request only when told).

## Outcome

- Impact: Module 012 works on the TEST project; nothing is committed and DEV is unchanged.
- Tests: see above; limits are listed in quickstart section 4 under "Not covered".
- Files: see the list above.
- Next prompts: apply 0012 on DEV and try quickstart section 3; commit when the owner says.
- Reflection: the planned test files were combined into fewer files; tasks.md records where each case went.

## Evaluation notes (flywheel)

- Failure modes observed: a long browser run stopped with the session; an edit script's result counts were first reported wrongly (corrected to 197 of 198 files).
- Next experiment: run the browser suite in parts with separate logs from the start.
