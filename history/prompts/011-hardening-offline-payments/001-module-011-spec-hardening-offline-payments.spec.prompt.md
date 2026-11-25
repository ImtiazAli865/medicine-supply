---
id: 001
title: Module 011 spec hardening and offline payments
stage: spec
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 011-hardening-offline-payments
branch: 011-hardening-offline-payments
user: ImtiazAli865
command: /sp.specify
labels: ["hardening","offline-payments","security-review","traceability","module-011","spec"]
links:
  spec: specs/011-hardening-offline-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/011-hardening-offline-payments/spec.md
 - specs/011-hardening-offline-payments/checklists/requirements.md
 - history/prompts/011-hardening-offline-payments/001-module-011-spec-hardening-offline-payments.spec.prompt.md
tests:
 - none (specification only; checklist reviewed, all items pass)
---

## Prompt

Owner messages in this stage (translated from Roman Urdu):

- "What will be in hardening?" (answered with a proposed list taken from the master prompt and the project record).
- "Do offline payments in this module, we will do deployment later, I will do the trial first. And also tell me how much work will be left in the final project after hardening." (translated from Roman Urdu)
- Answer to the one open question: "Do not show the old balance offline" (option A, the recommended one).

Feature description passed to `/sp.specify` (written by the assistant from the owner's decisions, docs/master-prompt.txt and the project record; English): see `specs/011-hardening-offline-payments/spec.md` header and the scratchpad copy of the request; it covers Part A (offline payments with the existing sync machinery and a pending-sync balance) and Part B (traceability table, security review, an offline-worker warning, a password reset path, test-infrastructure fixes, a Reports speed re-measure, final documentation), with deployment, voice and new features out of scope.

## Response snapshot

Created branch `011-hardening-offline-payments` and wrote the spec after reading what Module 009 and ADR-0008 said about payments (kept online on purpose; the ADR says a later module must add them with a pending-sync balance and an allocation order that works with unsent invoices). Six user stories (record a payment offline; send waiting payments once, safely and in order, with conflicts in the existing panel; backup and phone copy carry waiting payments only; a recorded traceability and security check; honest warnings and a password reset; reliable tests, a Reports speed re-measure and final documentation), 21 functional requirements, edge cases, assumptions and 13 success criteria. One question went to the owner (does the phone show a last known balance offline); the owner chose option A: the phone keeps no balance, offline shows only "N payments waiting, PKR X, not counted yet". Key design fact written into the assumptions: credits form one pool allocated oldest-first by the server, so when a payment is sent does not change its allocation, and invoices are online only, so unsent invoices cannot exist.

## Outcome

- ✅ Impact: Module 011 specification complete, no open clarification markers, checklist all pass.
- 🧪 Tests: none run (spec only).
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.plan` for Module 011; the owner's trial of Module 010 on real data continues in parallel; commit when the owner says.
- 🧠 Reflection: the ADR written at the end of Module 009 had already named the hard parts of offline payments, which made the spec quick to ground in fact; recording such "a later module must" notes in the ADR pays off.

## Evaluation notes (flywheel)

- Failure modes observed: `create-new-feature.ps1` created the branch and the empty spec but then printed the same parameter error as for Module 010 (the long description is treated as extra parameters); the branch and file were fine and the script was not run again.
- Graders run and results (PASS/FAIL): spec quality checklist PASS (all items).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): fix the script's parameter binding (accept the description from a file) so the error stops appearing.
