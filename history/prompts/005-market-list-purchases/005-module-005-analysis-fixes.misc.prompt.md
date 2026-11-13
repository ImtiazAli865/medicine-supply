---
id: 005
title: Module 005 analysis fixes
stage: misc
date: 2026-11-13
surface: agent
model: claude-sonnet-5-5
feature: 005-market-list-purchases
branch: 005-market-list-purchases
user: ImtiazAli865
command: /sp.analyze (remediation)
labels: ["analyze","fixes","module-005"]
links:
  spec: specs/005-market-list-purchases/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/005-market-list-purchases/spec.md
 - specs/005-market-list-purchases/plan.md
 - specs/005-market-list-purchases/research.md
 - specs/005-market-list-purchases/data-model.md
 - specs/005-market-list-purchases/contracts/api.openapi.yaml
 - specs/005-market-list-purchases/tasks.md
 - specs/005-market-list-purchases/quickstart.md
 - specs/005-market-list-purchases/checklists/requirements.md
tests:
 - none (documents only); checked by search that every edit landed and that the 59 tasks still use the checklist format
---

## Prompt

thermal print is also required for invoice so what you suggest to me it will be in module 006 if yes then continue with fixes

(the owner's answer to the analysis report: they asked whether thermal print would be built with the invoices in Module 006. The assistant answered yes, the owner's wording was taken as agreement, and all the recommended fixes were applied.)

## Response snapshot

- A1 (MEDIUM): the market list print is one compact A4 layout without the application navigation; thermal (80 mm, width as the `thermal_paper_mm` setting that already exists) is built with invoices in Module 006. Written into the spec Assumptions and Out of Scope, the plan's Constitution Check and Complexity Tracking, the research, and the print task T041.
- B1 (MEDIUM): a purchase date that is not the list date shows a notice before saving ("This purchase will count for <date>, not for <list date>.") and the confirmation names the date. Spec FR-008 and an edge case, tasks T030 and T032, and the quickstart walkthrough.
- C1 (MEDIUM): "who" is shown as "You" (solo use). The contract gets `recorded_by_me` on every entry and `void.by_me`; the data model entry list uses the same names; T029 and T033 test and show it; FR-011 states it.
- D1: units are compared with `public.norm_text` on both sides (research D3 and D5, data model, tasks T006 and T008, plus a test in T026).
- E1, F1: plan file lists match the tasks; T035 and the plan now name the Pending page and `TypedGroupList` as modified files (an optional initial search text).
- G1: "Bought all remaining" is offered only when remaining is above zero (FR-010, T030, T032).
- H1: "cancel" equals "void" is stated in the spec Assumptions.
- I1: the "no cost on screen" assertion in T030 is limited to the list rows and the Home card; the purchase dialogs may show the cost the supplier typed.
- J1: T026 asserts that cancelling the only entry returns the row to "Not bought" while the cancelled entry stays listed.
- K1: the print header uses `businesses.name` (data model section 4).
- Result: 31 edits applied with no failures; `tasks.md` still has 59 tasks in the checklist format; no Roman Urdu in the new files. Nothing is committed; the next step is `/sp.implement`.
