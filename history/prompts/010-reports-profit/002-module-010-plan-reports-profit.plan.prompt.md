---
id: 002
title: Module 010 plan reports and profit
stage: plan
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 010-reports-profit
branch: 010-reports-profit
user: ImtiazAli865
command: /sp.plan
labels: ["reports","profit","plan","read-only-functions","module-010"]
links:
  spec: specs/010-reports-profit/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/010-reports-profit/plan.md
 - specs/010-reports-profit/research.md
 - specs/010-reports-profit/data-model.md
 - specs/010-reports-profit/quickstart.md
 - specs/010-reports-profit/contracts/api.openapi.yaml
 - history/prompts/010-reports-profit/002-module-010-plan-reports-profit.plan.prompt.md
tests:
 - none (planning only; nothing was run)
---

## Prompt

Owner message (translated from Roman Urdu): "Yes, make the plan" (the answer to "Shall I make the plan for Module 010 now?").

The `/sp.plan` command itself carried no extra text.

## Response snapshot

Read the real migrations 0003, 0006, 0007, 0008, the market list code (repository, CSV, routes), the offline shell routes, the Home page and the money helper, then wrote the plan set. Main decisions: one read-only migration `0011_reports.sql` (seven `SECURITY INVOKER` functions and one partial index, no table, no stored total); one shared base function for every report so figures cannot disagree; the owner's market-day cost rule for realized profit and the order line's saved purchase price for the estimate; exact `numeric` money with one rounding per figure; outstanding balances reuse the existing ledger functions; six read routes plus a CSV route; seven screens, a Home card and a Settings link with the bottom navigation kept at five items; `/reports` added to the offline shell's blocked areas; a static test that keeps report code out of customer-facing, offline and backup code; a CSV helper for numbers so negative profits stay numbers. Constitution check passes; one wording note: Principle II says "weighted average of actual recorded purchase costs", and the owner's rule narrows that to the market day (a PATCH clarification is offered, not made). The agent-context script was not run: the module adds no new technology and `CLAUDE.md` is hand-written project rules.

## Outcome

- ✅ Impact: Module 010 plan, research, data model, API contract and quickstart written; all constitution gates pass.
- 🧪 Tests: none run (planning only).
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.tasks` for Module 010; the owner decides on an ADR (`/sp.adr reports-cost-rule-and-read-only-functions`) and later on applying 0011 to DEV; commit when the owner says.
- 🧠 Reflection: reading the actual tables first showed that invoices keep no cost and that purchases are keyed by medicine and unit, which shaped the unit-mismatch rule and the cost-missing reasons.

## Evaluation notes (flywheel)

- Failure modes observed: none in this stage.
- Graders run and results (PASS/FAIL): constitution check PASS (all eight principles).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): measure the 5,000-invoice budget on the TEST project early (first task), before building the screens.
