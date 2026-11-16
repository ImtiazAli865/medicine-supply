---
id: 001
title: Module 007 spec store accounts payments
stage: spec
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 007-store-accounts-payments
branch: 007-store-accounts-payments
user: ImtiazAli865
command: /sp.specify
labels: ["spec","khata","ledger","payments","account-summary","store-statement","module-007"]
links:
  spec: specs/007-store-accounts-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/007-store-accounts-payments/spec.md
 - specs/007-store-accounts-payments/checklists/requirements.md
tests:
 - none (specification only); the quality checklist was validated in one pass, all items pass
---

## Prompt

Owner messages that led to this stage (translated from Roman Urdu where marked):

1. "Continue module 007 but you told me that you will ask some questions before you continue." (translated from Roman Urdu for the second half)
2. The assistant asked three questions (what happens to invoices already issued in Module 006, whether adjustments are in scope, when an opening balance may be entered). The owner's answers: "Q1. I did not understand" and "Q2. Yes, the option to write off a small amount should be there" (translated from Roman Urdu). The assistant re-explained Q1 and Q3 in simpler words.
3. "Q1. Option 2 is right, the khata should be empty and then we will maintain the opening balance ourselves. Q3. We can enter it on any day." (translated from Roman Urdu)

The assistant then ran:

/sp.specify Module 007 Store accounts (khata), payments, Account Summary on invoices and Store Statement for the Medicine Supply & Order Management app (builds on Modules 001 to 006, all merged into master). Scope: the store ledger (append-only entries: opening_balance, invoice, payment, adjustment, reversal; balance computed, never stored); the opening balance on any day with the khata starting empty (invoices issued in Module 006 are not put into the ledger); cash payments belonging to the store account, allocated oldest unpaid first, advance kept and applied automatically, retry-safe with a client key, reversal with a reason; adjustments with a required reason; "payment received now" at issue as one atomic operation; the Account Summary snapshot saved at issue and shown by a print-screen checkbox (default from Settings); a Store Account screen, a stores list and a Home card; a printable Store Statement; the derived paid status on the invoices list. Out of scope: offline payments and pending sync (Module 009), voice (Module 008), profit and reports (Module 010), bank or wallet processing, multi-user roles, discounts, taxes, returns, interest, credit limits, reminders, server-side PDF. (The full feature description is recorded in the spec's Input line and its success criteria.)

## Response snapshot

- Read the master prompt sections on the store ledger and the Account Summary and the constitution Principle III, and asked the owner only the three decisions that were not already fixed by them. Recorded the answers in the spec as owner decisions (Assumptions 1 to 3), including that the assistant had recommended copying old invoices in and the owner chose an empty khata.
- Created branch `007-store-accounts-payments` (the create-new-feature script printed its usual parameter error and a branch warning, but the branch and the specs folder were created; it was run once).
- Wrote `specs/007-store-accounts-payments/spec.md`: 7 user stories (P1: opening balance and account view, issued invoices entering the account with cancel reversal, recording a payment with allocation, advance and derived paid status; P2: payment received now at issue, Account Summary snapshot, adjustments and reversals; P3: Store Statement, stores list and Home total), edge cases, 37 functional requirements (including an explicit list of what Module 006 issue, cancel and immutability gain), 15 success criteria and 14 assumptions.
- Wrote and validated `checklists/requirements.md` (all items pass; no clarification markers). The notes list what the plan must settle: where the previous balance is read, one shared allocation definition, how the immutability guard allows the snapshot to be set once, and how invoices issued before this module are told apart.

## Outcome and evaluation

- Spec ready for `/sp.clarify` (optional) or `/sp.plan`. Nothing is committed yet. An ADR may be suggested during planning (append-only ledger with derived allocation and the extension of issue and cancel); it will not be created without the owner's consent.
