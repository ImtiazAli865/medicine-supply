---
id: 005
title: Module 010 apply analysis edits
stage: misc
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 010-reports-profit
branch: 010-reports-profit
user: ImtiazAli865
command: (follow-up to /sp.analyze)
labels: ["reports","profit","analysis-edits","module-010"]
links:
  spec: specs/010-reports-profit/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/010-reports-profit/spec.md
 - specs/010-reports-profit/plan.md
 - specs/010-reports-profit/research.md
 - specs/010-reports-profit/data-model.md
 - specs/010-reports-profit/contracts/api.openapi.yaml
 - specs/010-reports-profit/tasks.md
 - history/prompts/010-reports-profit/005-module-010-apply-analysis-edits.misc.prompt.md
tests:
 - none (documents only; task count re-checked: still 61 well-formed tasks)
---

## Prompt

Owner message (translated from Roman Urdu): "Yes, the balances CSV too" (the answer to "Do you also want a CSV export of the balances report?").

The owner did not answer the second question (what "sort by profit" means). The assistant applied its own recommendation (realized profit, rows with unknown profit last) and said so; the owner can change it.

## Response snapshot

Applied the analysis findings to the spec, plan, research, data model, contract and tasks. Balances now export CSV (spec user story 5 scenario 4, contract `report=balances` without a period, tasks T044 to T048). Other edits: the estimate's cost source is the order line's saved purchase price everywhere; FR-008 and SC-001 now talk about sales totals and the rounding assumption says cost and profit rows may differ from their total by a paisa; sort by profit means realized profit with unknown last (spec, data model, contract, tasks T033 and T034); FR-015 is stated as vacuous for this module; the function count is 7 plus one helper; T012 gained the billed-versus-ordered quantity and not-in-account cases; T052 names the existing print specs; T057 checks that no package or offline code changed; T059 says one approval covers re-applying the migration to TEST. The constitution was not changed; the Principle II wording clarification stays an open owner decision.

## Outcome

- ✅ Impact: spec, plan and tasks agree; the two High and the Medium analysis findings are closed.
- 🧪 Tests: none run.
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.implement` starting with T001 and T002; ask the owner before applying the migration to TEST.
- 🧠 Reflection: where the owner leaves a question unanswered, apply the recommended default, say it plainly and keep it easy to change.

## Evaluation notes (flywheel)

- Failure modes observed: none.
- Graders run and results (PASS/FAIL): leftover-placeholder search PASS; task count 61 PASS.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): none.
