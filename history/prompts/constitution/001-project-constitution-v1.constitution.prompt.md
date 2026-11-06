---
id: 001
title: Project constitution v1.0.0
stage: constitution
date: 2026-11-05
surface: agent
model: claude-sonnet-5-5
feature: none
branch: master
user: ImtiazAli865
command: /sp.constitution
labels: ["constitution","billing","ledger","offline","security","ai"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - .specify/memory/constitution.md
 - history/prompts/constitution/001-project-constitution-v1.constitution.prompt.md
tests:
 - none
---

## Prompt

Yes, run /sp.constitution with your suggested answers, with these clarifications:
- Invoice issue needs a connection. Order taking, drafts, and payment recording still work offline.
- The price snapshot is taken at confirm. A line with no Selling Price at confirm stays unpriced (pending) and gets its snapshot later through the Pending Prices flow, only after I confirm. Lines that already have a snapshot never change.
- Profit uses the weighted average of actual recorded purchase costs. Until a purchase is recorded, show profit as an estimate/incomplete.
- Thermal paper is 80 mm, but make the width a setting.
- Everything else as you suggested.

## Response snapshot

Replaced the constitution template with v1.0.0: eight principles (real functionality; billing integrity and price snapshots; append-only ledger; medicine identification and order safety; security/RLS/secrets; server-side AI with human confirmation; offline-first with honest sync; mobile-first verifiable delivery), a Technical Constraints section, a Development Workflow section with the module order 001-011, and Governance. Dependent templates checked; none needed changes.

## Outcome

- ✅ Impact: Constitution ratified at 1.0.0 (2026-11-05), encoding all user-confirmed decisions.
- 🧪 Tests: none (documentation only)
- 📁 Files: .specify/memory/constitution.md
- 🔁 Next prompts: /sp.specify for Module 001 (login, products, stores)
- 🧠 Reflection: plan-template's Constitution Check is generic, so it picks up the gates automatically.

## Evaluation notes (flywheel)

- Failure modes observed: none
- Graders run and results (PASS/FAIL): not run
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): none
