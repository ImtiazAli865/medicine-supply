---
id: 003
title: Module 009 tasks offline sync backup
stage: tasks
date: 2026-11-19
surface: agent
model: claude-sonnet-5-5
feature: 009-offline-sync-backup
branch: 009-offline-sync-backup
user: ImtiazAli865
command: /sp.tasks
labels: ["tasks","offline","sync","backup","module-009"]
links:
  spec: specs/009-offline-sync-backup/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/009-offline-sync-backup/tasks.md
tests:
 - none (task list only)
---

## Prompt

Owner messages that led to this stage (translated from Roman Urdu where marked):

1. "Commit the working tree changes with a sensible message." (the Module 009 plan was committed as 59a08ca).
2. "/sp.tasks" (the command with no extra text; the owner chose to continue after the plan was committed).

## Response snapshot

Wrote `specs/009-offline-sync-backup/tasks.md` with 75 tasks (T001 to T075): Setup 2 (baseline, the Playwright offline spike), Foundational 17 (device schema and storage, identity, connectivity, ping route, `fetchJson` timeouts and local-answer hook, autosave journal extension, journal, device copy refresh, local answers, SyncCenter, service worker and build step, offline shell, provider and indicator, offline test helpers), US1 offline order taking 9, US2 sync exactly once 7, US3 nothing lost or silently overwritten 9, US4 new stores and typed medicines 6, US5 backup and restore 8, US6 Settings status 6, Polish and owner steps 11. Tests come first in every story; the matching, journal, ordering and conflict rules are pure code with unit tests; no migration and no new npm package; `package.json` changes only in the `build` script. MVP is US1 + US2, and US3 must be done before the owner relies on the module. All 75 lines follow the checklist format and the ids are sequential.

## Outcome

- ✅ Impact: Module 009 has an executable task list; ready for /sp.analyze (recommended) and then /sp.implement when the owner says.
- 🧪 Tests: none (task list only); format validated by a script (75 tasks, sequential ids, no bad lines).
- 📁 Files: specs/009-offline-sync-backup/tasks.md.
- 🔁 Next prompts: commit when told, then /sp.analyze, then /sp.implement only when the owner says.
- 🧠 Reflection: The Playwright offline behaviour with a service worker is the one unknown that shapes every offline test, so it is the first real task.

## Evaluation notes (flywheel)

- Failure modes observed: none.
- Graders run and results (PASS/FAIL): checklist-format validation PASS.
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): run /sp.analyze before implementing, as for Module 008.
