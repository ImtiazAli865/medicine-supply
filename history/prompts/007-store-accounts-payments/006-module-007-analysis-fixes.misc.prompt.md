---
id: 006
title: Module 007 analysis fixes
stage: misc
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 007-store-accounts-payments
branch: 007-store-accounts-payments
user: ImtiazAli865
command: chat
labels: ["analysis","fixes","spec","data-model","tasks","module-007"]
links:
  spec: specs/007-store-accounts-payments/spec.md
  ticket: null
  adr: history/adr/0007-store-ledger-and-account-summary.md
  pr: null
files:
 - specs/007-store-accounts-payments/spec.md
 - specs/007-store-accounts-payments/data-model.md
 - specs/007-store-accounts-payments/tasks.md
 - specs/007-store-accounts-payments/checklists/requirements.md
tests:
 - none (documentation only)
---

## Prompt

first keep fixes then continue (translated from Roman Urdu: the owner's answer after the analysis report offered to apply the ten findings)

## Response snapshot

- Applied the ten findings of the analysis (PHR 005) to the artifacts:
  - A1: FR-025 now says a cancelled invoice is printed without an Account Summary (its figures stay in the data); the data model and tasks T048 and T049 say the block is shown only for an issued invoice.
  - A2: a new refusal reason `invalid_method` (the function accepts only `cash` now; the table check keeps the later methods); tasks T008 and T014 updated.
  - A3: the allocation is computed only for the stores on the returned invoices page unless a paid filter is used; tasks T010 and T066 updated (the scale test measures both paths).
  - A4: `ledger_stores` is a left join from `stores`, so stores without entries and archived stores are listed (data model and T010).
  - A5: an archived store's visibility is tested (T059).
  - A6: the unique key on `invoices` is named `invoices_biz_store_id_uniq` and dropped in the rollback block (data model, T005).
  - A7: the reversal of a payment received with an invoice copies its invoice id for display only.
  - A8: the cancel dialog note says "if it is still recorded" (T030).
  - A9: the 4-tap check moved out of T035 (it stays in T059).
  - A10: one mapping from `unpaid`, `partially_paid`, `paid` to the screen words (T012).
- Recorded the fixes in the checklist notes.

## Outcome and evaluation

- Spec, data model and tasks are consistent again; no new open point. Nothing is committed. The owner said to continue, so the next step is the implementation (`/sp.implement`), starting with the baseline task T001.
