---
id: 001
title: Module 012 spec store-specific selling prices
stage: spec
date: 2026-11-26
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: /sp.specify
labels: ["pricing","store-rates","orders","module-012"]
links:
  spec: specs/012-store-rates/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/012-store-rates/spec.md
 - specs/012-store-rates/checklists/requirements.md
tests:
 - none (specification only)
---

## Prompt

Owner messages (translated from Roman Urdu):

1. "While taking an order, if the price of each medicine differs, can it be changed? For example Aftab Pharmacy gets Panadol for 200 and Rozi Medical Store for 220. Once I add the price, do I have to add it separately for every store, or is the price editable when making the invoice?"
2. "Okay, if next week the market rate changes and Panadol becomes 210, Aftab should pay 220 and Rozi 230, and any other new store 215. How will that work?"
3. "1. Every shopkeeper has a different rate for every medicine, by negotiation."

## Response snapshot

Answered from the code: one selling price per medicine, copied at confirm, not editable on order or invoice. After the owner's choice, created branch `012-store-rates` and the specification: price editable on the draft order, an explicit "remember for this store", pre-fill order of typed price, store rate, catalog price; warning when the catalog price changed; a rate list per store; confirmed lines and invoices never change. Found a constitution conflict ("One Selling Price per product"), not edited.

## Outcome

- Impact: specification ready for planning.
- Tests: none run.
- Files: spec and checklist.
- Next prompts: both open questions were answered the same day (offline: rates on the phone; constitution amendment approved, PHR in history/prompts/constitution), then /sp.plan.
- Reflection: the conflict with the constitution was found during writing, not in the earlier chat answer, which had proposed the feature without mentioning it.

## Evaluation notes (flywheel)

- Failure modes observed: the feature script printed a parameter error after creating the branch and spec file when the description was split; both existed and were checked before use.
- Next experiment: pass the feature description to the script in a single quoted argument without apostrophes or slashes.
