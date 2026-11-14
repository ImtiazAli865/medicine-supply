---
id: 004
title: Module 006 cross-artifact analysis
stage: misc
date: 2026-11-14
surface: agent
model: claude-sonnet-5-5
feature: 006-invoices-printing
branch: 006-invoices-printing
user: ImtiazAli865
command: /sp.analyze
labels: ["analysis","consistency","coverage","module-006"]
links:
  spec: specs/006-invoices-printing/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - none (read-only analysis; no artifact was changed)
tests:
 - none (analysis only)
---

## Prompt

analyze now

## Response snapshot

Read-only analysis of `spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, the contract and the constitution, with a few checks against the merged migrations `0003`, `0004` and `0006`.

Result: 0 critical, 0 high, 5 medium, 8 low findings. Every functional requirement (32) and success criterion (13) maps to at least one task; no task is unmapped.

Medium findings:

- M1: the internal helpers (`invoice_json`, `order_lines_fingerprint`, `invoice_todo_rows`) take a business id; the data model lists the last two as reads but does not state "security invoker" for them and omits `invoice_json`. The existing pattern (`order_to_json`) is invoker so Row Level Security applies; this must be explicit and tested with crafted ids.
- M2: a typed line with delivered 0 can be issued, and the order becomes fulfilled. Module 004 refuses linking and registering on fulfilled orders, the typed lists show draft and confirmed orders only, but the market list (Module 005) still counts fulfilled orders and offers "Register this medicine" for that line, which cannot work. Needs a decision, an edge case and a test.
- M3: the spec edge case "a draft whose order is later cancelled" has no task: no test that issuing is refused and discarding works, and the editor has no wording for "order no longer confirmed".
- M4: the date filter of the invoices list is undefined in the data model and tasks (the contract says drafts use their creation day).
- M5: SC-001 (order screen to printed A4 in at most 5 taps) and SC-013 (cancel and replace in at most 2 minutes) are in no test or owner step.

Low findings: FR-007 wording versus research D6, `reason_required` status versus the Zod 400, "not on the issued invoice" versus stored zero lines, e2e T022 lacks the button-by-order-state check, print header source for issued invoices (snapshot, not live Settings), function counts in the data model and plan, long product names on print, and the TEST project name in T015.

## Outcome and evaluation

- No file was changed by the analysis. The owner decides whether to apply the fixes.
