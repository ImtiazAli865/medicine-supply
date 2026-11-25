---
id: 005
title: Module 011 apply analysis edits
stage: misc
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 011-hardening-offline-payments
branch: 011-hardening-offline-payments
user: ImtiazAli865
command: (follow-up to /sp.analyze)
labels: ["hardening","offline-payments","analysis-edits","module-011"]
links:
  spec: specs/011-hardening-offline-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/011-hardening-offline-payments/spec.md
 - specs/011-hardening-offline-payments/plan.md
 - specs/011-hardening-offline-payments/research.md
 - specs/011-hardening-offline-payments/data-model.md
 - specs/011-hardening-offline-payments/contracts/offline-payments.md
 - specs/011-hardening-offline-payments/contracts/backup-file.v2.delta.json
 - specs/011-hardening-offline-payments/contracts/auth-reset.openapi.yaml
 - specs/011-hardening-offline-payments/tasks.md
 - history/prompts/011-hardening-offline-payments/005-module-011-apply-analysis-edits.misc.prompt.md
tests:
 - none (documents only; task count re-checked: still 67 well-formed tasks)
---

## Prompt

Owner message (translated from Roman Urdu): "Yes, apply them" (the answer to "Shall I apply the findings' edits, with two defaults?"). The two defaults were per-store sending order and an 8-character password minimum.

## Response snapshot

Applied the analysis findings. High: the test clean-up helper now discovers every table that carries a business id (from the existing `rls_audit()`), deletes in passes and fails loudly, because a read-only look at the TEST project showed that `business_settings` and the TEST-only voice tables were never deleted (so a loud helper that only reported errors would have failed every test at teardown); T048 and T052 say so and T052 starts with a read-only check of what blocks deletion. Medium: payments are sent in recorded order within each store and a payment waiting for its retry never holds back another store (spec FR-004, research D1, the contract, T005, T017); the account screen lists the store's waiting payments next to its entries (spec FR-008, T022, T025); the password reset enforces a minimum of 8 characters (spec FR-017, research D12, the contract, T043, T046); the bundle secret scan looks only at non-public variables (T037). Low: T034's allow-list sentence, FR-003's wording, the unused `failed` state removed from the data model, the backup contract and the tasks, an explicit note that this module supersedes Module 009's FR-028, and a note that the owner sees the exact guard diff before it is committed (plan Complexity Tracking, T006).

## Outcome

- ✅ Impact: spec, plan, tasks and contracts agree; the high and medium findings are closed.
- 🧪 Tests: none run.
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.implement` starting with T001 and T006; the leftover sweep and any migration on TEST or DEV need the owner's yes.
- 🧠 Reflection: where a plan changes a shared helper, look at the real state of what it cleans before writing the tasks.

## Evaluation notes (flywheel)

- Failure modes observed: a long node one-liner with apostrophes failed to parse; the edits were redone one by one with the editor tool.
- Graders run and results (PASS/FAIL): leftover-marker search PASS; task count 67 PASS.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): none.
