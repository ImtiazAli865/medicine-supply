---
id: 008
title: ADR for invoice issue and immutability
stage: misc
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 006-invoices-printing
branch: 006-invoices-printing
user: ImtiazAli865
command: /sp.adr invoice-issue-and-immutability
labels: ["adr","invoice","immutability","module-006"]
links:
  spec: specs/006-invoices-printing/spec.md
  ticket: null
  adr: history/adr/0006-invoice-issue-and-immutability.md
  pr: null
files:
 - history/adr/0006-invoice-issue-and-immutability.md
 - specs/006-invoices-printing/tasks.md
tests:
 - none (documentation only)
---

## Prompt

The assistant asked whether to write the ADR suggested in the plan. The owner answered: "okay now write the ADR". The command that ran was:

/sp.adr invoice-issue-and-immutability

## Response snapshot

- Read plan.md, research.md (D1 to D20 and the risks), the existing ADRs 0001 to 0005 and the verification record. No conflict with an existing ADR was found; ADR-0003, ADR-0004 and ADR-0005 are referenced as the same pattern.
- The repository has no `create-adr.sh` script, so the file was written by hand in the format of ADR-0005: `history/adr/0006-invoice-issue-and-immutability.md`, status Accepted, one decision cluster of nine points (function-only writes, one live invoice per order by index, number only at issue from a per-business counter, atomic issue with a frozen snapshot, no cost column, md5 stale fingerprint, database guards for immutability, cancel as a status change with a reason, order status moved only by the invoice functions, shared count and list definition), consequences (positive and negative, including the accepted limitations and "no real printer tested"), eleven rejected alternatives and references.
- Significance test: impact (Module 007 and reports read issued invoices), alternatives (listed) and scope (database, handlers, screens, print, later modules) all pass; it is one cluster, not several.

## Outcome and evaluation

- ADR-0006 created with the owner's consent. T065 is ticked. Nothing is committed yet; the pull request (T066) waits for the owner.
