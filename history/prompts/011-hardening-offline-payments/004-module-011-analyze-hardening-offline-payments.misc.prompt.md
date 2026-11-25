---
id: 004
title: Module 011 analyze hardening and offline payments
stage: misc
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 011-hardening-offline-payments
branch: 011-hardening-offline-payments
user: ImtiazAli865
command: /sp.analyze
labels: ["hardening","offline-payments","analyze","consistency","module-011"]
links:
  spec: specs/011-hardening-offline-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - history/prompts/011-hardening-offline-payments/004-module-011-analyze-hardening-offline-payments.misc.prompt.md
tests:
 - none (read-only analysis; one read-only probe of the TEST project's leftover test businesses, no data changed)
---

## Prompt

Owner message (translated from Roman Urdu): "Run analyze."

The `/sp.analyze` command itself carried no extra text.

## Response snapshot

Read-only cross-check of spec.md (21 functional requirements, 13 success criteria), plan.md, research.md, data-model.md, the contracts and tasks.md (67 tasks) against the real code. No critical issue and no constitution conflict. One high finding found by looking at the TEST project (a read-only probe, names and counts only): the shared test clean-up helper does not delete `business_settings` (created for every business) or the voice tables `voice_parse_attempts` and `voice_diagnostics` that exist only on the TEST and DEV projects, so the business row can never be deleted; the 169 leftover test businesses are the proof. The planned "fail loudly" rewrite of `deleteTenant` (T048, T052) would therefore fail every test at teardown unless it deletes by discovery of every table with a business id and repeats passes. Medium findings: the sending order of payments is ambiguous (strict global order versus per-store order; credits form one pool so per-store is enough and matches how drafts behave); an edge case promises waiting payments next to the store's recent entries online but no task shows them; the password minimum is 6 in the plan (the service's setting) while 8 is the recommendation; the bundle secret scan would flag the public Supabase values that are legitimately in the bundle. Low findings: a garbled allow-list sentence in T034, the spec says Record payment is also reachable from "the order screens' shell" but the plan has the offline home only, the stored state `failed` is unused, Module 009's FR-028 ("backup holds no payments") is superseded and should say so, and the narrowed guard should be shown to the owner as the deliberate deviation it is. Coverage: all 21 requirements and all 13 success criteria have tasks. Proposed edits were listed for the owner and not applied.

## Outcome

- ✅ Impact: one real planning gap found before implementation (the clean-up helper), plus clarifications; no file of the module changed.
- 🧪 Tests: none run.
- 📁 Files: only this PHR.
- 🔁 Next prompts: the owner confirms the two defaults (per-store sending order; 8-character minimum) and the edits are applied to spec, plan and tasks; then `/sp.implement`.
- 🧠 Reflection: the highest-value finding came from looking at the actual state of the shared test project instead of trusting the plan's description of the helper.

## Evaluation notes (flywheel)

- Failure modes observed: a first probe asked for every leftover business (thousands of requests) and had to be stopped; the second looked at three of each kind.
- Graders run and results (PASS/FAIL): n/a (analysis only).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): when a plan changes a shared test helper, probe the project it cleans up before writing the tasks.
