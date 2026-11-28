---
id: 017
title: Show newest lines below the search
stage: green
date: 2026-11-28
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: none
labels: ["order-screen","layout","owner-trial"]
links:
  spec: specs/008-fast-order-entry/spec.md
  ticket: null
  adr: null
  pr: https://github.com/ImtiazAli865/medicine-supply/pull/12
files:
 - src/lib/orders/line-view.ts
 - src/components/orders/OrderEditor.tsx
 - src/components/orders/OrderLineRow.tsx
 - src/components/orders/OrderView.tsx
 - specs/008-fast-order-entry/spec.md
 - tests/unit/line-view.test.ts
 - tests/e2e/order-lines-newest.spec.ts
 - tests/e2e/orders-helpers.ts
tests:
 - npm run lint, npx tsc --noEmit, tests/unit (84 files, 933 tests passed)
 - order-screen browser tests, mobile (228 tests; 227 passed, the new one failed on its own seed data and passed after that was corrected)
 - remaining mobile and all desktop browser tests (still running when this was written)
---

## Prompt

Option 1

## Response snapshot

A draft order now shows its lines directly below the search box, newest first, with the latest three open and a button for the rest. Lines with an invalid entry or being pointed at are never hidden. The saved order, the invoice and the editing of a confirmed order are unchanged.

## Outcome

- Impact: a line just added is in view without scrolling.
- Tests: see above.
- Files: see the list above, not committed.
- Next prompts: the owner's look at the screen; results of the remaining tests; commit when the owner says.
- Reflection: the test helper now finds a line by its place in the saved order, so the older tests kept their meaning.

## Evaluation notes (flywheel)

- Failure modes observed: the new test's seed data lacked an id.
- Next experiment: none.
