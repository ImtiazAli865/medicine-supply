---
id: 010
title: Module 004 US5 pending items stay visible
stage: green
date: 2026-11-10
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.implement (continued)
labels: ["implementation","pending-products","visibility","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - src/app/api/pending/summary/route.ts
 - src/app/api/pending/typed/route.ts
 - src/components/pending/TypedGroupList.tsx
 - src/components/pending/PendingSummaryCard.tsx
 - src/components/pending/ProposalsFlow.tsx
 - src/app/(app)/pending/page.tsx
 - src/app/(app)/page.tsx
 - src/components/orders/OrderView.tsx
 - src/components/orders/OrderEditor.tsx
 - tests/integration/db-pending-summary.pglite.test.ts
 - tests/integration/pending-api.test.ts
 - tests/e2e/pending-home.spec.ts
 - specs/004-pending-products/tasks.md
 - specs/004-pending-products/quickstart.md
tests:
 - db-pending-summary.pglite.test.ts: 9 passed
 - pending-api.test.ts: 21 passed
 - pending-home.spec.ts: 9 of 9 passed (third run)
 - npm run lint and typecheck: pass
 - npm test: 56 files, 604 tests passed
 - browser regression: 108 of 109 passed on the second run (the one failure was a race in my own US5 test, fixed; only the US5 spec was rerun after the fix)
---

## Prompt

commit then run

(US4 was committed as 47393b6; "run" meant carrying on with /sp.implement, which is US5)

## Response snapshot

- Committed US4 (47393b6), then built US5: summary and typed routes (never cached), the To register tab (typed groups with Register and "This is an existing medicine" per line), the Home "Needs attention" card (error with Retry, never "nothing pending" on failure), tab counts, order screen links.
- The browser tests found a real defect: a line linked from the proposals list stayed on the To register list. Fixed by refreshing the list after any link from the proposals. A second failure was a race in my own test and was fixed in the test.
- Deviation: the signed-out 401 check is in the browser spec (request without a session), because the integration tests have no HTTP-level pattern.
- Tasks T046 to T053 ticked (53 of 64). Not committed yet. Polish T054 to T060 and the owner steps T061 to T064 remain.
