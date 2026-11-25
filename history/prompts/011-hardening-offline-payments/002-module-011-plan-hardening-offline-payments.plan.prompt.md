---
id: 002
title: Module 011 plan hardening and offline payments
stage: plan
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 011-hardening-offline-payments
branch: 011-hardening-offline-payments
user: ImtiazAli865
command: /sp.plan
labels: ["hardening","offline-payments","plan","module-011"]
links:
  spec: specs/011-hardening-offline-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/011-hardening-offline-payments/plan.md
 - specs/011-hardening-offline-payments/research.md
 - specs/011-hardening-offline-payments/data-model.md
 - specs/011-hardening-offline-payments/quickstart.md
 - specs/011-hardening-offline-payments/contracts/offline-payments.md
 - specs/011-hardening-offline-payments/contracts/backup-file.v2.delta.json
 - specs/011-hardening-offline-payments/contracts/auth-reset.openapi.yaml
 - specs/011-hardening-offline-payments/spec.md (customer-printout exception added)
 - history/prompts/011-hardening-offline-payments/002-module-011-plan-hardening-offline-payments.plan.prompt.md
tests:
 - none (planning only; nothing was run)
---

## Prompt

Owner message (translated from Roman Urdu): "Yes, make the plan" (the answer to "Shall I make the plan for Module 011 now?").

The `/sp.plan` command itself carried no extra text.

## Response snapshot

Read the real code first: the sync centre and its store-operation queue, the device schema and upgrade steps, the backup file code and its forbidden-key check, the payment dialog and the ledger payment function and its refusals, the offline shell and its blocked areas, the proxy's public paths, the API routes and the offline static guard. Main decisions: offline payments are one more persisted queue in the existing sync centre (a new device store, schema version 2) with the ledger entry id as the key and the attempt written before the send; no balance on the phone; online screens that show a balance gain a pending-sync note; the guards that forbade the word "payment" on the device are narrowed to named files and one backup path, with every other forbidden word still forbidden; backup version 2 with version 1 still readable; hardening that a test can prove is a test (traceability table checked by a unit test, route-auth scan, RLS audit, bundle secret scan, a recorded npm audit); a visible warning for a non-secure address; a password reset with a cross-device token-hash link; `deleteTenant` rewritten to fail loudly; Reports speed measured three times with a stated rule for adding a covering index; a `guides/` folder. No server change for payments and no migration planned. The spec got one clarification: customer printouts never mention what waits on one phone.

## Outcome

- ✅ Impact: Module 011 plan, research, data model, three contracts and quickstart written; all constitution gates pass.
- 🧪 Tests: none run (planning only).
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.tasks` for Module 011; an ADR is suggested (`/sp.adr offline-payments-queue-and-pending-sync`) but not created; owner approvals are needed later for the leftover sweep on the TEST project and the DEV email template.
- 🧠 Reflection: the narrowed-guard decision is the delicate one: a guard that bans a word everywhere cannot coexist with the feature, so it is replaced by a path-limited allow-list that keeps the other words banned.

## Evaluation notes (flywheel)

- Failure modes observed: none in this stage.
- Graders run and results (PASS/FAIL): constitution check PASS (all eight principles).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): write the guard change first (with planted-word tests) before any payment code, so the rule is pinned early.
