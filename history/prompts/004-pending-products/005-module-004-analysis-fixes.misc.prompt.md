---
id: 005
title: Module 004 analysis fixes
stage: misc
date: 2026-11-10
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.analyze (remediation)
labels: ["analyze","remediation","pending-products","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/004-pending-products/spec.md
 - specs/004-pending-products/data-model.md
 - specs/004-pending-products/research.md
 - specs/004-pending-products/contracts/api.openapi.yaml
 - specs/004-pending-products/tasks.md
 - specs/004-pending-products/checklists/requirements.md
tests:
 - none (planning documents only); tasks.md format re-checked: 64 tasks, sequential, all well formed
---

## Prompt

Yes, apply the fixes. (translated from Roman Urdu)

## Response snapshot

Applied the two HIGH and the six MEDIUM findings from the analysis (the LOW findings C3, C4, C6, C7, C8, K1 and A1 were not in the approved set and remain open, except that C3 and C6 were folded into the edited tasks where the same line changed):

- I1: the idempotency lookup is repeated after the advisory locks are taken, so every copy of a simultaneous request returns the stored result (data-model "Common behaviour", research D2, T007, T008, T018).
- I2: the spec now defines one Pending screen with two tabs (To register, Need a price = Pending Prices); FR-016, US4 #1 and #11 reworded; a short terms note added (also covers D1).
- I3: `pending_summary` now returns `price_items` and `price_items_with_waiting_lines` (a subset), equal to the list lengths; spec FR-026 and SC-007, data model, research D9, contract, T009, T046, T048, T051 aligned.
- U1: a 1,000-line batch limit for a preview and a fill, oldest orders first, with `total_waiting`; spec FR-018, scenario 14, data model, research D6, contract, T008, T038, T043.
- U2: new spec scenario 13 for a priced medicine with waiting lines ("Fill the waiting lines at PKR X"); T038 and T040 cover it.
- C1: proposals are reopened from the medicine's own page; FR-014, US3 #2 and T034 aligned.
- C2: browser tests for the "Use PKR X for this line?" prompt added to T019 and T027.
- C5: the migration must be re-run safe and is re-applied to the test project whenever it changes (data-model intro, T004, T005, T016).
- Nothing committed yet.
