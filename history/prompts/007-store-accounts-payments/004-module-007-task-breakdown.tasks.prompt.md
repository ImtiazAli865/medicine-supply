---
id: 004
title: Module 007 task breakdown
stage: tasks
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 007-store-accounts-payments
branch: 007-store-accounts-payments
user: ImtiazAli865
command: /sp.tasks
labels: ["tasks","ledger","khata","payments","account-summary","module-007"]
links:
  spec: specs/007-store-accounts-payments/spec.md
  ticket: null
  adr: history/adr/0007-store-ledger-and-account-summary.md
  pr: null
files:
 - specs/007-store-accounts-payments/tasks.md
tests:
 - none (planning only); the checklist format of tasks.md was checked by a script (75 tasks, sequential ids, no malformed line)
---

## Prompt

okay create the task (translated from Roman Urdu: the owner's message after the ADR was written)

The assistant then ran /sp.tasks for the feature branch 007-store-accounts-payments.

## Response snapshot

- Read the Module 006 task list for its format and the Module 007 plan, research, data model, contract and quickstart.
- Wrote `specs/007-store-accounts-payments/tasks.md`: 75 tasks in ten phases: setup (T001 to T003: baseline, test helpers, a staged-migration option for the PGlite helper and the tenant cleanup), foundational (T004 to T015: failing schema tests, the six parts of migration `0008_store_accounts.sql`, the run of all older suites, the shared TypeScript layer, validation, repository and client, and the owner step that applies the migration to TEST), one phase per user story (US1 opening balance and account view T016 to T024 as the MVP, US2 invoices in the account and cancel reversal T025 to T031, US3 payments, allocation and paid status T032 to T040, US4 payment at issue T041 to T046, US5 Account Summary T047 to T050, US6 adjustment and reversal T051 to T056, US7 statement, list and Home card T057 to T063) and polish (T064 to T075: isolation, no-cost, scale with a possible `0009_ledger_perf.sql`, touch targets and states, README, honesty sweep, ledger review, full verification, the DEV apply and phone walkthrough as owner steps, the documentation records and the pull request).
- Each story phase has its goal, an independent test, tests first and then routes, components, wiring and a run task. The file lists dependencies, shared files, parallel opportunities and an implementation strategy, and it records the owner's decisions as fixed (empty khata, adjustments built, opening balance on any day).
- Format check by script: every task line starts with a checkbox and an id, story labels appear only in the story phases (US1 9, US2 7, US3 9, US4 6, US5 4, US6 6, US7 7 tasks), ids run from T001 to T075 with no gap.

## Outcome and evaluation

- Tasks ready for `/sp.analyze`. Nothing is committed. Migration `0008` must not be applied to TEST or DEV without the owner's say-so (T015 and T072 are owner steps).
