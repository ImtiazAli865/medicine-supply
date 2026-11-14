---
id: 005
title: Module 006 analysis fixes
stage: misc
date: 2026-11-14
surface: agent
model: claude-sonnet-5-5
feature: 006-invoices-printing
branch: 006-invoices-printing
user: ImtiazAli865
command: (chat request)
labels: ["analysis-fixes","spec","plan","tasks","module-006"]
links:
  spec: specs/006-invoices-printing/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/006-invoices-printing/spec.md
 - specs/006-invoices-printing/plan.md
 - specs/006-invoices-printing/research.md
 - specs/006-invoices-printing/data-model.md
 - specs/006-invoices-printing/contracts/api.openapi.yaml
 - specs/006-invoices-printing/tasks.md
 - specs/006-invoices-printing/checklists/requirements.md
tests:
 - task list format re-checked by a script (66 tasks, all in the checklist format)
---

## Prompt

now continue  for fixes

## Response snapshot

All 5 medium and 8 low findings of the analysis (PHR 004) were fixed in the artifacts; no code was written.

- M1: the internal helpers (`invoice_json`, `order_lines_fingerprint`, `invoice_todo_rows`) are stated as SECURITY INVOKER; `invoice_json` is listed; function counts corrected (ten reads of which three are internal, sixteen functions in total); T056 calls the helpers directly with another business's id.
- M2: a typed line with delivered 0 on an invoiced order is recorded as a known limitation (edge case in the spec, risk 4 in research, limit 8 in the plan, assertion in T029). The owner had not chosen between the two options offered; the recommended one (known limitation) was applied because the owner asked to continue with the fixes.
- M3: `order_status` added to the invoice json and the contract; tests (T018, T022) and editor wording (T034) for a draft whose order was cancelled; spec edge case added.
- M4: the invoices list date filter defined (invoice date, or the creation day for a draft) in the spec, data model and tasks.
- M5: the 5-tap check added to the print e2e (T037); the 2-minute and tap counts added to the owner walkthrough (T064).
- Lows: FR-007 wording, `reason_required` versus the validation 400, zero-delivered lines stored but not shown, issued print header from the snapshot, long product names in the print test, e2e check of the order-screen action by order state, the TEST project name removed.

## Outcome and evaluation

- The spec, plan, tasks, data model and contract are consistent again. Not done yet: any implementation or commit (nothing is committed on this branch).
