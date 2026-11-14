---
id: 001
title: Module 006 spec invoices and printing
stage: spec
date: 2026-11-14
surface: agent
model: claude-sonnet-5-5
feature: 006-invoices-printing
branch: 006-invoices-printing
user: ImtiazAli865
command: /sp.specify
labels: ["spec","invoices","printing","thermal","module-006"]
links:
  spec: specs/006-invoices-printing/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/006-invoices-printing/spec.md
 - specs/006-invoices-printing/checklists/requirements.md
tests:
 - none (specification only)
---

## Prompt

merge then continue to module 006

(The feature description passed to `/sp.specify` was written by the assistant from the master prompt sections 4F, 10, 11, 16 item 9 and 17 items 12 to 15, and the module plan: invoice draft from a confirmed order, atomic and retry-safe issue with a controlled number and an immutable snapshot, A4 and 80 mm thermal print, cancellation with a reason, invoices list with a Home count, and order print options A and B. Out of scope: Account Summary, payments and balances (Module 007), discounts, server-side PDF, voice, offline sync, reports, roles.)

## Response snapshot

- Pull request #4 (Module 005) was merged first; `master` is at `4c98bf6`.
- The branch `006-invoices-printing` was created by the feature script. The script printed a parameter error after creating the branch and the empty spec file (the same behaviour as for Module 005), so it was not run again.
- The spec has 6 user stories (draft P1, issue P1, print A4 and thermal P2, cancel and replace P2, list and Home count P2, order sheets A and B P3), 32 functional requirements, 13 success criteria, edge cases and 12 assumptions. No [NEEDS CLARIFICATION] markers; four assumptions are flagged for the owner to confirm (Account Summary and payments move to Module 007; delivered quantity entered on the draft; cancelling returns the order to Confirmed; plain increasing invoice numbers assigned only at issue).
- A fact found in the code: `orders` lines already carry `delivered_quantity` and price snapshots, but the `businesses` table has only a name, so optional phone and address are added in Settings for the invoice header.
- The quality checklist passed in one pass.

## Outcome and evaluation

- Not done yet: the owner's confirmation of the four assumptions, `/sp.plan`, `/sp.tasks`, and any commit (nothing is committed on this branch).
- Open risk to plan carefully: the invoice number sequence under concurrent issue, and keeping the market list unchanged when an order becomes fulfilled.
