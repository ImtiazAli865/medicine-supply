---
id: 006
title: Module 004 MVP implementation (register)
stage: green
date: 2026-11-10
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.implement
labels: ["implementation","pending-products","quick-register","migration","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - supabase/migrations/0004_pending_products.sql
 - src/lib/pending/types.ts
 - src/lib/pending/repository.ts
 - src/lib/validation/pending.ts
 - src/lib/api/errors.ts
 - src/lib/api/client.ts
 - src/lib/orders/types.ts
 - src/lib/orders/editor-state.ts
 - src/lib/hooks/useOrderEditor.ts
 - src/app/api/orders/[id]/lines/[lineId]/register/route.ts
 - src/components/pending/RegisterMedicineDialog.tsx
 - src/components/pending/PendingLineActions.tsx
 - src/components/orders/OrderLineRow.tsx
 - src/components/orders/OrderView.tsx
 - src/components/orders/OrderEditor.tsx
 - src/components/orders/OrderScreen.tsx
 - src/components/orders/OrderHistoryLog.tsx
 - tests/helpers/pending.ts
 - tests/helpers/pending-db.ts
 - tests/helpers/supabase-test.ts
 - tests/integration/db-pending-schema.pglite.test.ts
 - tests/integration/db-pending-register.pglite.test.ts
 - tests/integration/pending-api.test.ts
 - tests/integration/pending-concurrency.test.ts
 - tests/integration/db-schema.pglite.test.ts
 - tests/unit/pending-validation.test.ts
 - tests/e2e/pending-register.spec.ts
 - specs/004-pending-products/tasks.md
 - specs/004-pending-products/quickstart.md
tests:
 - npm run lint: pass; npm run typecheck: pass
 - npm test: 51 files, 538 tests passed (Module 003 had 467; 71 new)
 - order browser tests after the order screens changed (mobile): 59 passed
 - pending-register.spec.ts (mobile): 9 of 9 passed
---

## Prompt

Haan, shuru karo

(the owner's go-ahead to start implementing Module 004; this stage covers the MVP agreed in the plan: Setup, Foundational and User Story 1)

## Response snapshot

- Checklist status 16 of 16; wrote migration `0004` (typed_name write-once column, `pending_requests`, new event kinds, indexes, `order_to_json` with typed_name, three write functions, five read functions, privileges). The first assembled copy had `$$` turned into `$` by JavaScript `replace`, found by the database tests and fixed.
- Applied `0004` to the TEST project through the owner's signed-in Supabase tab after read-only counts, and verified objects, RLS, grants and the event check.
- Types, validation, repository, error codes, register route, Register dialog, line actions, history log entries, editor hook method `prepareForPending`, typed_name display.
- Tests written and run: schema 17, register PGlite 25, register API plus simultaneous requests on Supabase 13, validation 16, browser 9. Found and fixed a real defect (browser `required` check hid the app's messages: `noValidate`).
- 24 of 64 tasks ticked (T001 to T024). Not done: US2 to US5, polish, full e2e and build, dev apply, phone check, ADR consent, PR.
- The first baseline run was contaminated by the half-written migration and is recorded as such in the quickstart.
