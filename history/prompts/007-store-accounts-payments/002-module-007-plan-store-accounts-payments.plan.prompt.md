---
id: 002
title: Module 007 plan store accounts payments
stage: plan
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 007-store-accounts-payments
branch: 007-store-accounts-payments
user: ImtiazAli865
command: /sp.plan
labels: ["plan","ledger","khata","payments","account-summary","migration-0008","module-007"]
links:
  spec: specs/007-store-accounts-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/007-store-accounts-payments/plan.md
 - specs/007-store-accounts-payments/research.md
 - specs/007-store-accounts-payments/data-model.md
 - specs/007-store-accounts-payments/contracts/api.openapi.yaml
 - specs/007-store-accounts-payments/quickstart.md
 - specs/007-store-accounts-payments/spec.md
tests:
 - none (planning only); no code, migration or test was written or run in this stage
---

## Prompt

generate the plan now (translated from Roman Urdu: the owner's message after the spec was written)

The assistant then ran /sp.plan for the feature branch 007-store-accounts-payments.

## Response snapshot

- Read the constitution, the Module 006 plan and migration 0007 (the invoices table and its guard trigger, `invoice_json`, `invoice_issue`, `invoice_cancel`), the invoice repository, print page and toolbar, the money helpers, the stores table, the navigation and the test helpers, so the plan names the real objects it changes.
- Wrote `plan.md` (summary, technical context, a constitution check of Principles I to VIII with a tracked deferral for offline payments, project structure, complexity tracking, risks and an ADR suggestion), `research.md` (D1 to D20 and six risks), `data-model.md` (the `ledger_entries` table, the four snapshot columns on `invoices`, the allocation definition, all functions, reasons, grants, JSON shapes and a rollback note), `contracts/api.openapi.yaml` and `quickstart.md` (prerequisites, phone walkthrough, Section 17 mapping, the test list; the results sections are empty on purpose).
- Key decisions: one append-only ledger table with composite foreign keys so a payment can never reach another store; balance and allocation computed, never stored; opening balances are settled before invoices; exactly-once by the client entry id plus three partial unique indexes; issue and cancel extended inside the same functions with one lock order (invoice, order, store ledger, counter); the Account Summary snapshot as four columns on `invoices`, frozen by the existing guard without changing the trigger; invoices issued before this module stay out of the account (owner's choice); the reversal and the cancellation entry are dated the day they are made.
- One refinement made to the spec while planning: FR-013 and Assumption 8 now say that an opening balance is settled before invoices even when its date is later, because the master prompt says "the opening balance, then invoices by date" and the supplier may not know the real date of an old balance.
- `update-agent-context.ps1` was not run (it adds a byte-order mark to CLAUDE.md), the same as for Modules 005 and 006.

## Outcome and evaluation

- Plan ready for `/sp.tasks`. Nothing is committed. An ADR is suggested at the end of the plan (`/sp.adr store-ledger-and-account-summary`) and will not be created without the owner's consent. The migration `0008_store_accounts.sql` must not be applied to TEST or DEV without the owner's say-so.
