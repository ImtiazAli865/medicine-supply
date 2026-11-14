---
id: 002
title: Module 006 assumptions confirmed and plan
stage: plan
date: 2026-11-14
surface: agent
model: claude-sonnet-5-5
feature: 006-invoices-printing
branch: 006-invoices-printing
user: ImtiazAli865
command: /sp.plan
labels: ["plan","invoices","immutability","numbering","printing","module-006"]
links:
  spec: specs/006-invoices-printing/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/006-invoices-printing/spec.md
 - specs/006-invoices-printing/checklists/requirements.md
 - specs/006-invoices-printing/plan.md
 - specs/006-invoices-printing/research.md
 - specs/006-invoices-printing/data-model.md
 - specs/006-invoices-printing/quickstart.md
 - specs/006-invoices-printing/contracts/api.openapi.yaml
tests:
 - none (planning only)
---

## Prompt

Yes for 3 assumptions, but the one that says "Delivered (billed) quantity is set on the invoice draft only. There is no separate delivery screen, and the ordered quantity is never overwritten": this is an assumption, explain it first, then I will tell you. (translated from Roman Urdu)

(then, after the assistant explained it with an example:)

im agree with 4 assumptions

## Response snapshot

- The owner's confirmation of all four assumptions was recorded in the spec, the checklist and the assumptions section (2026-11-14). Assumption 2 had been explained with an example (ordered 10, delivered 8, bill for 8, the order keeps 10; the alternative of a separate delivery screen was described and not chosen).
- While planning, the code showed that Settings (Module 002) already hold the business phone, address and the thermal paper width (default 80). The spec's first draft was wrong on this point; FR-020, FR-023, the Business details entity and Assumption 5 were corrected, and nothing is added to Settings.
- Plan artifacts written: `plan.md` (Constitution Check I to VIII all PASS, with Module 007 items explicitly out of scope), `research.md` (20 decisions D1 to D20 and 10 facts found in the code), `data-model.md` (4 tables, 3 changes to Module 003 objects, 6 write functions, 9 read functions, guards, state changes), `contracts/api.openapi.yaml` (11 operations), `quickstart.md` (results empty on purpose).
- Key design points: one live invoice per order by a partial unique index; client invoice id as the request id; no cost column on any invoice table; a fingerprint to detect a stale draft; per-business invoice counter used only at issue; immutability by triggers with stored status draft, issued, cancelled; the order becomes fulfilled in the same transaction and the market list is unchanged (tested); delivered quantity written back to the order lines at issue and reset to the ordered quantity on cancel.
- Findings in Module 003 that migration 0007 must change: the order status guard (add confirmed to fulfilled and back), the order event kinds (add invoiced and invoice_cancelled) and the delivered quantity check (allow 0).
- The agent-context update script was not run (no new technology; it adds a byte order mark to `CLAUDE.md`).
- ADR suggested, not created: `/sp.adr invoice-issue-and-immutability` (needs the owner's consent).

## Outcome and evaluation

- Not done yet: `/sp.tasks`, analysis, implementation, any commit (nothing is committed on this branch).
- Open risks recorded in the plan: the replacement draft starts from the ordered quantities after a cancellation; strict stale detection; print verified in emulation only; migration 0007 touches three Module 003 objects, so row counts must be compared before and after it is applied.
