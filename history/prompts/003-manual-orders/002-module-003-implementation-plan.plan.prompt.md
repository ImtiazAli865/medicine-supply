---
id: 002
title: Module 003 implementation plan
stage: plan
date: 2026-11-06
surface: agent
model: claude-sonnet-5-5
feature: 003-manual-orders
branch: 003-manual-orders
user: ImtiazAli865
command: /sp.plan
labels: ["plan","orders","security-definer","idempotency","price-snapshot","autosave","module-003"]
links:
  spec: specs/003-manual-orders/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/003-manual-orders/plan.md
 - specs/003-manual-orders/research.md
 - specs/003-manual-orders/data-model.md
 - specs/003-manual-orders/contracts/api.openapi.yaml
 - specs/003-manual-orders/quickstart.md
 - history/prompts/003-manual-orders/002-module-003-implementation-plan.plan.prompt.md
tests:
 - none (planning only)
---

## Prompt

OK, run the plan. (translated from Roman Urdu)

(The owner accepted the four assumptions from the spec: snapshot at confirm, confirmed orders edited in place, draft store locked once it has a line, cancelled orders final.)

## Response snapshot

Ran `/sp.plan` for Module 003 after reading migrations 0001 and 0002, the product and store repositories, validation, error and paging helpers, the search hook, navigation and the PGlite test helper. Produced plan.md (constitution check, structure, complexity tracking), research.md (16 decisions D1 to D16), data-model.md (migration 0003: order_counters, orders, order_lines, order_events, functions order_save, order_confirm, order_cancel, order_get, order_list), an OpenAPI contract for the order endpoints, and quickstart.md. Key decisions: writes only through SECURITY DEFINER functions with select-only grants; idempotent whole-order saves using a request id plus a version; gapless per-business order numbers from a counter updated in the same transaction; price snapshot at confirm protected by a trigger (with a flag hook reserved for Module 004); soft removal of lines; store lock enforced in the database; autosave as a tested client state machine; no new npm packages. The one constitution deviation (offline order taking, deferred to Module 009) is recorded in Complexity Tracking. The agent-context script only added a byte-order mark to CLAUDE.md, so that change was reverted.

## Outcome

- ✅ Impact: Module 003 is planned; ready for `/sp.tasks`.
- 🧪 Tests: none (planning only); the test strategy is in research.md D16.
- 📁 Files: plan.md, research.md, data-model.md, contracts/api.openapi.yaml, quickstart.md.
- 🔁 Next prompts: `/sp.tasks`, then `/sp.analyze`; optionally `/sp.adr order-write-model-and-price-snapshots` with the owner's consent.
- 🧠 Reflection: FR-004 needs dosage form in the medicine search but the stored search text lacks it; the plan matches it per token in the query and lets the 5,000-medicine timing decide whether to rebuild the column.

## Evaluation notes (flywheel)

- Failure modes observed: update-agent-context.ps1 rewrites CLAUDE.md with a BOM and no real content change.
- Graders run and results (PASS/FAIL): constitution check PASS for all eight principles, with one tracked deferral (Principle VII, Module 009).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): none.
