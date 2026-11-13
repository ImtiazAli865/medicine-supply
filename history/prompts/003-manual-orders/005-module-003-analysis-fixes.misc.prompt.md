---
id: 005
title: Module 003 analysis fixes applied
stage: misc
date: 2026-11-06
surface: agent
model: claude-sonnet-5-5
feature: 003-manual-orders
branch: 003-manual-orders
user: ImtiazAli865
command: /sp.analyze (remediation)
labels: ["analyze","remediation","autosave","price-snapshot","module-003"]
links:
  spec: specs/003-manual-orders/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/003-manual-orders/spec.md
 - specs/003-manual-orders/plan.md
 - specs/003-manual-orders/research.md
 - specs/003-manual-orders/data-model.md
 - specs/003-manual-orders/tasks.md
 - history/prompts/003-manual-orders/005-module-003-analysis-fixes.misc.prompt.md
tests:
 - none (documents only)
---

## Prompt

Yes, apply the fixes. (translated from Roman Urdu)

## Response snapshot

Applied all 18 findings from the analysis to the design documents with one scripted exact-match edit (33 replacements, each old text had to occur exactly once; nothing is written if any replacement fails). HIGH: U1 flush-before-confirm (`flush()` in the autosave machine T017, `confirm()` and `discard()` await it in T031, Confirm disabled while unsaved in T030, new FR-024 sentence, e2e and unit cases); U2 retry rules (only network and 5xx are retried, 400/401/404/409 stop, an edit made while a request is retrying waits for it); I1 a cancelled draft shows no price (data-model price_basis and list totals, research D5, tests T008, T035, T051). MEDIUM: PostgREST `or()` escaping (T022, T025, research D11); induced-failure atomicity tests (T035, T066); Section 17 mapping and a no-stores, empty-catalog end-to-end (T046, T079); FR-007 e2e case (T023); the "search within lines" edge case removed and a 200-line UI rule added (spec, T031). LOW: plan test tree updated, edit-mode local total (T054), replay limit recorded (research D2), `fulfilled` guard note, typed-line link test (T045), delivered quantity at confirm (T020), inactive-store draft (T035), direct-call name cleaning (T009, T020, data-model), animation limit 200 ms (FR-044). Verified afterwards: tasks.md still has 82 correctly formatted tasks; nothing committed.

## Outcome

- ✅ Impact: The three HIGH gaps and all other findings are closed in the documents; Module 003 is ready for `/sp.implement`.
- 🧪 Tests: none run (documents only); tasks.md format re-checked (82 tasks, 0 malformed lines).
- 📁 Files: spec.md, plan.md, research.md, data-model.md, tasks.md.
- 🔁 Next prompts: `/sp.implement` (start with Phases 1 and 2); owner decides when to commit.
- 🧠 Reflection: one script with exact-match assertions made 33 edits safe in a single pass.

## Evaluation notes (flywheel)

- Failure modes observed: none; every replacement matched exactly once on the first run.
- Graders run and results (PASS/FAIL): format check PASS.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): none.
