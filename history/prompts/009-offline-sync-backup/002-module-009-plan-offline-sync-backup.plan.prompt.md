---
id: 002
title: Module 009 plan offline sync backup
stage: plan
date: 2026-11-19
surface: agent
model: claude-sonnet-5-5
feature: 009-offline-sync-backup
branch: 009-offline-sync-backup
user: ImtiazAli865
command: /sp.plan
labels: ["plan","offline","sync","backup","indexeddb","service-worker","module-009"]
links:
  spec: specs/009-offline-sync-backup/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/009-offline-sync-backup/plan.md
 - specs/009-offline-sync-backup/research.md
 - specs/009-offline-sync-backup/data-model.md
 - specs/009-offline-sync-backup/quickstart.md
 - specs/009-offline-sync-backup/contracts/api.openapi.yaml
 - specs/009-offline-sync-backup/contracts/backup-file.schema.json
 - specs/009-offline-sync-backup/spec.md
tests:
 - none (planning only)
---

## Prompt

Owner messages that led to this stage (translated from Roman Urdu where marked):

1. "Commit the working tree changes with a sensible message." (the Module 009 spec was committed as b586fbf).
2. "yes continue for plan" (translated from Roman Urdu; the original is English with Roman Urdu words).
3. "Yes, later" (translated from Roman Urdu): the owner's answer to the question whether offline payment recording may be deferred to a later module.

## Response snapshot

Read the existing code (autosave state machine, order and store repositories and the `order_save` function, order screens, proxy, fetch client, Module 008 hooks) and wrote the Module 009 plan. Key findings and decisions: the server already has idempotent save by request id, optimistic versions and idempotent store create, so there is no migration and no new npm package; the device keeps a per-business IndexedDB with a draft journal; the existing autosave machine gets a journal and an `on_device` status and a client `SyncCenter` keeps unsynced drafts retrying; a hand-written service worker plus a client-only `/offline` shell page opens the app offline and reuses the order screens, whose GET requests are answered from the device copy when the network fails; two read-only routes are added (`/api/ping`, `/api/backup/export`); the backup import goes through the same queue so duplicates are prevented in one place; confirming stays online. Small spec edits: the device copy may hold the current selling price (labelled "last known price"), and SC-007 restores onto a clean device of the same business. One constitution item: Principle VII says payment recording must work offline, which the owner's brief excludes; recorded in Complexity Tracking, and the owner acknowledged the deferral ("yes, later"); the constitution text is not amended.

## Outcome

- ✅ Impact: Module 009 planned; the payment deferral is acknowledged; ready for /sp.tasks when the owner says.
- 🧪 Tests: none (planning only); the test strategy and the gating spike are in the plan and quickstart.
- 📁 Files: plan.md, research.md, data-model.md, quickstart.md, contracts/ (2 files) and two small spec edits.
- 🔁 Next prompts: commit when told, optionally /sp.adr offline-first-device-sync, then /sp.tasks.
- 🧠 Reflection: Reusing the autosave machine and answering reads behind `fetchJson` keeps the diff small and leaves the online tests meaningful.

## Evaluation notes (flywheel)

- Failure modes observed: the agent-context script only prepended a byte-order mark to CLAUDE.md; that change was reverted.
- Graders run and results (PASS/FAIL): constitution check passes with one tracked deviation (Principle VII, payments).
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): run the Playwright offline spike first when implementing.
