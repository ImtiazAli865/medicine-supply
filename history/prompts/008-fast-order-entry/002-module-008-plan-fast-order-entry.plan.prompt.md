---
id: 002
title: Module 008 plan fast order entry
stage: plan
date: 2026-11-19
surface: agent
model: claude-sonnet-5-5
feature: 008-fast-order-entry
branch: 008-fast-order-entry
user: ImtiazAli865
command: /sp.plan
labels: ["plan","fast-order-entry","no-migration","on-device-search","usual-medicines","repeat-order","module-008"]
links:
  spec: specs/008-fast-order-entry/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/008-fast-order-entry/plan.md
 - specs/008-fast-order-entry/research.md
 - specs/008-fast-order-entry/data-model.md
 - specs/008-fast-order-entry/contracts/api.openapi.yaml
 - specs/008-fast-order-entry/quickstart.md
 - specs/008-fast-order-entry/spec.md
tests:
 - none (planning only)
---

## Prompt

Owner messages that led to this stage:

1. "Commit the working tree changes with a sensible message." (the spec was committed as e58c0de)
2. "Start plan" (answer to "Start /sp.plan for fast order entry now?")

## Response snapshot

- Read the spec, the constitution and the existing code before deciding: the add-medicine dialog and its search hook, the editor hook and the autosave, the order and product repositories, the order tables, grants and policies, the test layout and the e2e steps that use the dialog.
- Findings that shaped the plan: the existing product route sends purchase price and MRP to the browser (so a new slim route is needed); the PostgREST cap of 1,000 rows (so every list read pages); the orders, order lines and products tables already allow select with business filters (so no migration); `order_save` already creates a draft with all lines at once and is idempotent (so a repeat is one save); the dialog is used only by the order editor (so it can be removed); six e2e specs and one helper use the dialog (so they are updated in one pass).
- Decided: no migration (a SQL function numbered 0011 or higher is the stated fallback if a measured budget is missed); a slim medicine route; the list loaded page by page and searched on the device with the server search covering the first seconds and the too-large case; pure matching code with the one-match highlight rule; the "x20" quantity read only when the text finds nothing and applied only when the supplier chooses a result; two always-mounted inputs so the phone keyboard stays open; one Undo; usual and repeat routes computed as the user over at most 100 recent orders of 180 days, read in pages; a repeat applied as one editor change.
- Small spec edits made for consistency: FR-008 now says draft screens and at most the 100 latest qualifying orders; FR-019 now says the "x" quantity is used only when a result is chosen and then adds the line at once; one clarification was added (usual and repeat belong to drafts).
- Wrote plan, research, data model, one OpenAPI contract and the quickstart. No ADR (decisions are local, reversible, store no data). Flagged for the owner only: the constitution's module list still says "008 voice". The agent-context update script was not run (CLAUDE.md has not been changed by it since Module 003).

## Outcome

- ✅ Impact: A complete, measurable plan with budgets and fallbacks; all eight constitution gates pass.
- 🧪 Tests: none run (planning only); the test strategy and measurements are in the plan, research D12 and quickstart section 4.
- 📁 Files: the plan documents and three small spec edits.
- 🔁 Next prompts: /sp.tasks, then /sp.analyze, then /sp.implement, each only when the owner says.
- 🧠 Reflection: reading the product repository showed that the "no prices anywhere" rule could not be met by reusing the existing route, which would have been easy to miss from the spec alone.

## Evaluation notes (flywheel)

- Failure modes observed: the plan setup script was started through a shell without `pwsh` and printed a parse error before the Windows fallback ran; the plan template was copied once and filled by hand.
- Graders run and results (PASS/FAIL): constitution check PASS on all eight principles (before and after design); no tests run.
- Prompt variant (if applicable): none.
- Next experiment (smallest change to try): measure the usual route and the 5,000-medicine load on the TEST project in the first implementation tasks, before building the screens on top of them.
