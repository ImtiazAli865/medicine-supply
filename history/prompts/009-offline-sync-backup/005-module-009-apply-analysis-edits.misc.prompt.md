---
id: 005
title: Module 009 apply analysis edits
stage: misc
date: 2026-11-21
surface: agent
model: claude-sonnet-5-5
feature: 009-offline-sync-backup
branch: 009-offline-sync-backup
user: ImtiazAli865
command: apply analysis remediation
labels: ["analyze","remediation","tasks","module-009"]
links:
  spec: specs/009-offline-sync-backup/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/009-offline-sync-backup/tasks.md
 - specs/009-offline-sync-backup/plan.md
 - specs/009-offline-sync-backup/research.md
 - specs/009-offline-sync-backup/data-model.md
 - specs/009-offline-sync-backup/quickstart.md
 - specs/009-offline-sync-backup/spec.md
tests:
 - none (documents only); the task list format was re-validated by a script (75 tasks, sequential ids, no bad lines)
---

## Prompt

Owner message (translated from Roman Urdu): "Yes, apply them." The answer to the offer made after the Module 009 analysis (apply the fixes for all high, medium and low findings, or only the 3 high ones).

## Response snapshot

Applied all findings of the Module 009 analysis (PHR 004). High: a draft opened online is now written to the journal as a synced copy (T023, T025, data model); the failed-read behaviour change for the Module 008 failure-state specs is handled with a `blockDeviceStorage(page)` helper (T019) and a longer update list in T028 (plus a preamble rule and a plan risk note); `fetchJson` gets an `onUnauthorized: "event"` option so a 401 during a background send never navigates away (T010, T032, T034, plan, research, static guard T066, sweep T067). Medium and low: US5 independent-test wording; refresh throttle and storage-quota warning (T013, T021, T027, research D8); source of "recent stores" (T013, data model); layout passes user and business ids (T018, plan); offline shell header, indicator, sign-out note and "Open the full app" link (T017); service worker `skipWaiting` and `clients.claim` (T016, research D3); cookie chunks and `base64-` prefix (T007, research D4); Register and Link of a typed line offline (T021, T024); hanging-server and wrong-clock tests (T030); never-sent order display and identity check in local answers (T014, T025); backup conflict case (T053); shared `ExportOffer` so the sign-out warning no longer needs a later story (T042, T057, T063, dependencies); wording unified to "Saved on this device, not yet sent" everywhere.

## Outcome

- ✅ Impact: tasks.md, plan, research, data model, quickstart and spec are consistent with the analysis; ready to commit and then /sp.implement.
- 🧪 Tests: none (documents only); format validation passed.
- 📁 Files: six spec documents edited; PHRs 004 and 005 added.
- 🔁 Next prompts: commit when told, then /sp.implement (first task T001, then the T002 spike).
- 🧠 Reflection: Comparing tasks with the real `fetchJson` and the Module 008 specs found behaviour changes that the plan had only described in general.

## Evaluation notes (flywheel)

- Failure modes observed: none; every replacement matched exactly once (the script asserts this).
- Graders run and results (PASS/FAIL): task-list format validation PASS.
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): none.
