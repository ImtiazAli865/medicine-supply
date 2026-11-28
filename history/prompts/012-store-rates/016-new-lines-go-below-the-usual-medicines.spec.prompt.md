---
id: 016
title: New lines go below the usual medicines
stage: spec
date: 2026-11-28
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: none
labels: ["order-screen","layout","owner-trial"]
links:
  spec: specs/008-fast-order-entry/spec.md
  ticket: null
  adr: null
  pr: https://github.com/ImtiazAli865/medicine-supply/pull/12
files:
 - history/prompts/012-store-rates/016-new-lines-go-below-the-usual-medicines.spec.prompt.md
tests:
 - none run
---

## Prompt

With three screenshots of a new order (translated from Roman Urdu): I noticed one thing. When I add a medicine to a new order, the newly added one goes to the very end and I have to scroll down every time, because the last order's medicines show above and the new ones go below, so after every new one I must scroll down. How can this be fixed? Give some suggestions, then we will fix it as suggested, and then do the remaining offline browser tests and the commit.

## Response snapshot

Three options were offered: move the order's lines directly below the search box, newest first, with the latest three open (recommended); keep the layout and add a small "Just added" box; or two tabs. No code was changed.

## Outcome

- Impact: the owner chooses before anything is built.
- Tests: none run for this prompt.
- Files: this record.
- Next prompts: the owner's choice.
- Reflection: found only in real use; the earlier timing measures did not count scrolling.

## Evaluation notes (flywheel)

- Failure modes observed: a new line out of view after adding.
- Next experiment: assert that a just added line is in the viewport.
