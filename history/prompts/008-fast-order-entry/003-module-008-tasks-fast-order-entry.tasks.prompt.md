---
id: 003
title: Module 008 tasks fast order entry
stage: tasks
date: 2026-11-19
surface: agent
model: claude-sonnet-5-5
feature: 008-fast-order-entry
branch: 008-fast-order-entry
user: ImtiazAli865
command: /sp.tasks
labels: ["tasks","fast-order-entry","no-migration","module-008"]
links:
  spec: specs/008-fast-order-entry/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/008-fast-order-entry/tasks.md
tests:
 - none (task planning only)
---

## Prompt

Owner messages that led to this stage:

1. "Commit the working tree changes with a sensible message." (the plan documents were committed as 6c79369)
2. "Start tasks" (answer to "Start /sp.tasks now?")

## Response snapshot

- Read the spec, plan, research, data model, contract and quickstart, the task format of Module 007, the existing test layout, and the e2e steps that use the old add-medicine dialog.
- Wrote `tasks.md` with 59 tasks in 8 phases: setup (2), foundational (8: types, validation, pure usual and repeat rules, server reads, the usual route, editor extension, Undo bar, hook), US1 repeat last order (7), US2 usual medicines (6), US3 continuous search (15, including removing the dialog and updating the older e2e specs in one pass), US4 quantity shortcuts (6), US5 first use and failures (4), and polish and owner steps (11).
- Structure decisions: the usual route is built in the foundational phase because both repeat and usual cards need its source and list; the repeat route belongs to US1; the medicines route and the search box to US3. Tests come first in every story. Scale measurements are scheduled as early as possible and a missed budget is reported to the owner instead of adding a migration. The existing test ids are kept so the older specs change only in how a medicine is added.
- Recorded one honest note: the existing Module 003 confirmation dialog makes "choose store, repeat, confirm" four taps, not three, and the e2e test states this.

## Outcome

- ✅ Impact: A complete, dependency-ordered, executable task list; every functional requirement and success criterion maps to at least one task.
- 🧪 Tests: none run (planning only).
- 📁 Files: `specs/008-fast-order-entry/tasks.md`.
- 🔁 Next prompts: /sp.analyze, then /sp.implement, each only when the owner says; commit only when told.
- 🧠 Reflection: Reading the older specs showed that six e2e files and one helper depend on the dialog, so replacing it is its own task instead of a side effect.

## Evaluation notes (flywheel)

- Failure modes observed: none.
- Graders run and results (PASS/FAIL): format check (checkbox, sequential id, story label, no gaps) PASS; no tests run.
- Prompt variant (if applicable): none.
- Next experiment (smallest change to try): measure the usual route and the 5,000-medicine load right after US2 and US3 instead of at the end.
