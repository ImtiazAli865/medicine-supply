---
id: 003
title: ADR for store ledger and account summary
stage: misc
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 007-store-accounts-payments
branch: 007-store-accounts-payments
user: ImtiazAli865
command: /sp.adr store-ledger-and-account-summary
labels: ["adr","ledger","khata","account-summary","module-007"]
links:
  spec: specs/007-store-accounts-payments/spec.md
  ticket: null
  adr: history/adr/0007-store-ledger-and-account-summary.md
  pr: null
files:
 - history/adr/0007-store-ledger-and-account-summary.md
tests:
 - none (documentation only)
---

## Prompt

The assistant asked whether to write the ADR suggested at the end of the Module 007 plan. The owner answered: "yes write ADR now" (translated from Roman Urdu where the original was Roman Urdu). The command that ran was:

/sp.adr store-ledger-and-account-summary

## Response snapshot

- Read plan.md, research.md (D1 to D20), data-model.md and the existing ADRs 0001 to 0006. No conflict was found: ADR-0006 is extended (issue and cancel gain the ledger work; the existing guard freezes the new snapshot columns), and ADR-0003, ADR-0004 and ADR-0005 are referenced as the same pattern.
- The repository has no `create-adr.sh` script, so the file was written by hand in the format of ADR-0006: `history/adr/0007-store-ledger-and-account-summary.md`, one decision cluster of nine points (one append-only table, composite keys that make a wrong store impossible, computed balance and allocation with opening balances first, exactly-once keys, issue and cancel extended with one lock order, the snapshot as columns on the immutable invoice, the khata starting empty, dates that keep old statements true, reversal rules), consequences (positive and negative, including the owner's empty-khata choice and its undetectable double count), ten rejected alternatives and references.
- Significance test: impact (reports and offline payments read the ledger), alternatives (listed) and scope (database, handlers, Module 006 flows, print page, screens, later modules) all pass; it is one cluster, not several.

## Outcome and evaluation

- ADR-0007 created with the owner's consent, status Accepted at the plan stage (nothing is implemented yet). Nothing is committed. Next: `/sp.tasks`.
