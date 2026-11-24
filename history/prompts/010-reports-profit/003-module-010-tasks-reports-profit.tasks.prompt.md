---
id: 003
title: Module 010 tasks reports and profit
stage: tasks
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 010-reports-profit
branch: 010-reports-profit
user: ImtiazAli865
command: /sp.tasks
labels: ["reports","profit","tasks","module-010"]
links:
  spec: specs/010-reports-profit/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/010-reports-profit/tasks.md
 - history/prompts/010-reports-profit/003-module-010-tasks-reports-profit.tasks.prompt.md
tests:
 - none (task list only; nothing was run)
---

## Prompt

Owner message (translated from Roman Urdu): "Make the tasks."

The `/sp.tasks` command itself carried no extra text.

## Response snapshot

Read the plan set and the existing test helpers (PGlite and TEST-project seeding, invoice and purchase helpers, the scale-test pattern, the end-to-end file list) and wrote `tasks.md` with 61 tasks: Setup 2, Foundational 9, US1 sales and profit 16 (MVP, includes an early speed check), US2 purchases 5, US3 stores and medicines 6, US4 balances 5, US5 CSV export 5, Polish 10, owner steps 3. Every story starts with failing tests; the one migration file `0011_reports.sql` grows story by story; applying it to TEST and DEV needs the owner's yes; end-to-end tests can only use invoices dated today, so day-by-day rules (including the 50/55 and 58/65 example) are tested on PGlite with a backdating helper. Format check passed: every task has a checkbox, an id and a path, and the per-phase counts add up to 61.

## Outcome

- ✅ Impact: Module 010 tasks ready for implementation; nothing implemented.
- 🧪 Tests: none run.
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.analyze` (optional consistency check) or `/sp.implement`, starting with T001 and T002; the owner must say yes before 0011 is applied to TEST (T021) and later DEV; commit only when the owner says.
- 🧠 Reflection: backdating invoices is only possible by disabling the guard triggers in PGlite, so the helper (T002) is a prerequisite for every rule test.

## Evaluation notes (flywheel)

- Failure modes observed: none in this stage.
- Graders run and results (PASS/FAIL): task format validation PASS (61 of 61 lines in the required shape).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): run `/sp.analyze` before implementing, as for Module 009, to catch spec and task gaps early.
