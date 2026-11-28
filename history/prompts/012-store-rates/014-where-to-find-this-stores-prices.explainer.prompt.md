---
id: 014
title: Where to find this store's prices
stage: explainer
date: 2026-11-28
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: none
labels: ["walk-through","store-rates","module-012"]
links:
  spec: specs/012-store-rates/spec.md
  ticket: null
  adr: null
  pr: https://github.com/ImtiazAli865/medicine-supply/pull/12
files:
 - history/prompts/012-store-rates/014-where-to-find-this-stores-prices.explainer.prompt.md
tests:
 - none run
---

## Prompt

With a screenshot of draft order ORD-0041 for one store: "1. This store's prices: see this list on that store's page. A rate can be edited or removed there." Where will this option come from? (translated from Roman Urdu)

## Response snapshot

Open Stores in the menu, choose the store, and scroll below its details to "This store's prices"; each rate has Change and Remove. A rate appears there after "Remember for this store" is ticked for a typed price on an order line. The screenshot also shows the development overlay reporting one issue; the server log shows no server error, and the owner was asked to open it and send a screenshot.

## Outcome

- Impact: none on the code.
- Tests: none run.
- Files: this record, not yet committed.
- Next prompts: what the "1 Issue" badge says; the rest of the walk-through (T042).
- Reflection: walk-through steps should name the exact path and button labels.

## Evaluation notes (flywheel)

- Failure modes observed: the earlier instruction did not say how to reach the store page and called the Change button "edit".
- Next experiment: give each step as menu, page, button.
