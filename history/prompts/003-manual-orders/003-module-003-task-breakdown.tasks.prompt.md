---
id: 003
title: Module 003 task breakdown
stage: tasks
date: 2026-11-06
surface: agent
model: claude-sonnet-5-5
feature: 003-manual-orders
branch: 003-manual-orders
user: ImtiazAli865
command: /sp.tasks
labels: ["tasks","orders","autosave","price-snapshot","order-history","module-003"]
links:
  spec: specs/003-manual-orders/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/003-manual-orders/tasks.md
 - history/prompts/003-manual-orders/003-module-003-task-breakdown.tasks.prompt.md
tests:
 - none (task planning only; the tasks include the tests to write)
---

## Prompt

Haan, tasks banao

## Response snapshot

Ran `/sp.tasks` for Module 003 from plan.md, spec.md, research.md, data-model.md, contracts and quickstart.md, following the structure of Module 002's tasks. Produced `specs/003-manual-orders/tasks.md` with 82 tasks: Setup (T001 to T003), Foundational (T004 to T019: failing schema test, migration 0003 in six parts, validation, number/date/total helpers, the autosave state machine with unit tests, repository, applying the migration to the TEST project), US1 take an order (15 tasks), US2 never lose an order (10), US3 typed lines (6), US4 prices and snapshots (7), US5 order history (8), US6 edit or cancel a confirmed order (7), and cross-cutting isolation, search and timing gates, full verification, README, the owner's phone check and the ADR consent question (T073 to T082). Format check: all 82 lines follow the checklist format, IDs are sequential, story labels appear only in story phases, 47 tasks are marked parallel. MVP is US1; US1 to US3 together are the minimum safe for real orders.

## Outcome

- ✅ Impact: Module 003 has an executable, dependency-ordered task list; ready for `/sp.analyze` and then `/sp.implement`.
- 🧪 Tests: none run; tests are planned per story (PGlite, Supabase integration, Playwright, unit).
- 📁 Files: specs/003-manual-orders/tasks.md.
- 🔁 Next prompts: `/sp.analyze`, then `/sp.implement`; owner consent question for the ADR is task T082.
- 🧠 Reflection: the autosave state machine was placed in Foundational so US1 and US2 can both use it; the list and cancel routes sit in US2 because Home's "Continue order" and draft discard need them.

## Evaluation notes (flywheel)

- Failure modes observed: none.
- Graders run and results (PASS/FAIL): checklist-format validation PASS (82 tasks, 0 malformed lines, no gaps in numbering, no story label outside story phases).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): none.
