---
id: 003
title: Module 011 tasks hardening and offline payments
stage: tasks
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 011-hardening-offline-payments
branch: 011-hardening-offline-payments
user: ImtiazAli865
command: /sp.tasks
labels: ["hardening","offline-payments","tasks","module-011"]
links:
  spec: specs/011-hardening-offline-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/011-hardening-offline-payments/tasks.md
 - history/prompts/011-hardening-offline-payments/003-module-011-tasks-hardening-offline-payments.tasks.prompt.md
tests:
 - none (task list only; nothing was run)
---

## Prompt

Owner message (translated from Roman Urdu): "Make the tasks."

The `/sp.tasks` command itself carried no extra text.

## Response snapshot

Wrote `tasks.md` with 67 tasks: Setup 2, Foundational 6, US1 record offline 8, US2 send safely 11, US3 backup 5, US4 traceability and security 8, US5 warning and reset 7, US6 tests, speed and documents 12, Polish 4, Owner steps 4. The guard change is the first foundational task and is pinned by planted-word tests; the word "payment" is allowed only in a named list of device files while balance, invoice, ledger, price and cost stay forbidden everywhere on the device. Every story starts with failing tests; the shared files (sync centre, schema, backup code) are marked as not parallel. Migration 0012 is created only if the RLS audit or the Reports speed rule says so. Scale tests and the leftover sweep run alone and only with the owner's yes. Format check: every task has a checkbox, an id and a path; per-phase counts add up to 67; stale cross-references were fixed.

## Outcome

- ✅ Impact: Module 011 tasks ready for implementation; nothing implemented.
- 🧪 Tests: none run.
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.analyze` (optional) or `/sp.implement` from T001 and T006; owner approvals needed later for the DEV email template (T064), the leftover sweep (T065), any `0012` applied to TEST or DEV, and the PR (T067).
- 🧠 Reflection: placing the guard change first, with tests that plant each forbidden word, makes the narrowest possible exception before any payment code exists.

## Evaluation notes (flywheel)

- Failure modes observed: task numbers referred to in other tasks drifted while writing (found and fixed by a search for stale ids); a lesson for the next task list is to write cross-references last.
- Graders run and results (PASS/FAIL): task format validation PASS (67 of 67 lines in the required shape).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): run `/sp.analyze` before implementing, as for Modules 009 and 010.
