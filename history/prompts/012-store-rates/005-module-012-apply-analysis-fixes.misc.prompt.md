---
id: 005
title: Module 012 apply analysis fixes
stage: misc
date: 2026-11-26
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: none
labels: ["analyze","remediation","store-rates","module-012"]
links:
  spec: specs/012-store-rates/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/012-store-rates/spec.md
 - specs/012-store-rates/research.md
 - specs/012-store-rates/data-model.md
 - specs/012-store-rates/contracts/order-prices.md
 - specs/012-store-rates/tasks.md
tests:
 - none (documents only)
---

## Prompt

Apply them (translated from Roman Urdu: "Yes, apply them"), including the proposal that changing a line's unit clears a typed price.

## Response snapshot

Applied the analysis fixes: the line guard covers the new price columns; old function signatures are dropped before adding parameters; the history of a confirmed order records the billed price; the per-store rate list moves to US2; a unit change clears a typed price (FR-002a); lines added to a confirmed order check the shown price; Register, Link and Pending Prices set the price source; search and usual cards show store rates; the missing checks were added to tasks.

## Outcome

- Impact: ready for /sp.implement.
- Tests: none run.
- Files: see the list above.
- Next prompts: /sp.implement; the owner runs 0012 on the TEST project when asked.
- Reflection: task count unchanged at 43.

## Evaluation notes (flywheel)

- Failure modes observed: a long heredoc with apostrophes failed in the shell; the script was written to a file instead.
- Next experiment: write edit scripts to files from the start.
