---
id: 001
title: Module 010 spec reports and profit
stage: spec
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 010-reports-profit
branch: 010-reports-profit
user: ImtiazAli865
command: /sp.specify
labels: ["reports","profit","cogs","module-010","spec"]
links:
  spec: specs/010-reports-profit/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/010-reports-profit/spec.md
 - specs/010-reports-profit/checklists/requirements.md
 - history/prompts/010-reports-profit/001-module-010-spec-reports-profit.spec.prompt.md
tests:
 - none (specification only; checklist reviewed, all items pass)
---

## Prompt

Owner messages in this stage (translated from Roman Urdu):

- "Delete the test order and then continue for next module also update the local master" (written in English by the owner).
- Answer to the one open question (translated from Roman Urdu): "For example, on 23 Nov 26 Panadol was bought at 50 and sold at 55. In the same way, on the next day 24 Nov 26, if the same Panadol was bought at 58, then a sale rate will be given to it, won't it. For example, if a sale rate of 65 is added, the profit will be 7."

Feature description passed to `/sp.specify` (written by the assistant from docs/master-prompt.txt Section 12 and the earlier modules; English):

Module 010 Reports and profit for the Medicine Supply & Order Management app (builds on Modules 001 to 009, all merged into master; the voice branch 008-voice-order-gemini stays dropped, and migrations 0009 and 0010 of that dropped work are already applied to the TEST and DEV projects, so any new migration must be numbered 0011 or higher). Goal: give the owner (the supplier) internal, read-only business reports so they can see how much they sold, what it cost, the estimated and realized gross profit, which stores and medicines sell most, what stores still owe, and what was purchased, by day, week and month, without ever mixing this with customer-facing documents. Follow docs/master-prompt.txt Section 12 (Profit and Business Reports) and Section 13 (balances come from the ledger), docs/negative-prompt.txt and .specify/memory/constitution.md principles I-VIII. Scope ONLY: (1) A Reports area reachable from the existing app (the bottom navigation keeps five items, so place the entry where the plan decides, for example under Home or Settings) with these reports: SALES SUMMARY (revenue from issued, not cancelled invoices, taken from the invoice's own price snapshot and never from the current catalog price, grouped by day, week and month for a date range the supplier picks, with presets such as today, this week, this month); PURCHASE SUMMARY (purchase cost from Module 005 actual purchases using the actual quantity and actual cost recorded, never the purchase checkbox alone, grouped by day, week and month); ESTIMATED GROSS PROFIT (selling price minus the known purchase price on the product, clearly labelled as an estimate); REALIZED GROSS PROFIT (sales revenue minus the corresponding cost of goods sold, using recorded actual acquisition costs and fulfilled quantities only, never ordered or requested quantities); STORE-WISE SALES; PRODUCT-WISE SALES (grouped by product id, never by similar text, so different strengths, forms, manufacturers and pack sizes stay separate); OUTSTANDING BALANCES BY STORE (computed from ledger entries as in Module 007, never a stored number, shown as pending where unsynced payments exist). (2) Honesty rules: when the acquisition cost of any line in a figure is unknown, that figure is marked Estimate or Incomplete and the report says how many lines or how much revenue has no cost, and never shows a confident profit for them; never invent a cost or a selling price; cancelled invoices and draft orders are excluded and the report says so; credit notes or reversals are handled as the existing invoice and ledger modules define them; a medicine with no cost appears in a visible "cost missing" list with a link to fix it. (3) Reports are internal only: no report content, number or link may appear on an invoice, the Account Summary, the Store Statement, a print layout, the offline device copy or the backup file from Module 009 (the offline copy and backup must not gain any cost, margin or profit data); purchase price, margin and profit are shown only on the report screens, behind the signed-in owner, and never to a store. (4) Export: the owner can export a report they are looking at as a CSV file generated from the same data and filters, with the Estimate or Incomplete markers kept in the file; no PDF claim unless implemented and tested. (5) Online only, honest states: loading, error with Retry and empty states with a next action on every report (a business with no invoices yet sees an empty state that names the next step), a failed load never shows zero as if it were real, and nothing says synced or saved that is not. (6) Nothing may reach another business (row level security, tested with two businesses); money arithmetic is done with exact decimal handling as in earlier modules, with rounding rules stated in the spec; large histories must stay fast (the plan sets a budget, for example a result within about 2 seconds for 5,000 invoices) so aggregation is done in the database or in a bounded query, not by downloading every row to the phone. Prefer no new migration if existing tables and views can be read safely with row level security; if a read-only database function or view is needed, the plan decides, it must keep row level security, never use the service-role key in browser code, and be numbered 0011 or higher. The new screens must be mobile-first (360 px wide, controls at least 44 px, no sideways scroll; wide tables become stacked cards on a phone), pass the existing touch-target check, and never claim anything that is not implemented. OUT OF SCOPE: changing invoices, prices, purchases, payments or the ledger, new payment or invoice features, tax or accounting exports, multi-user roles or permissions, charts that need a new npm package (no new npm package at all), forecasting, AI or voice, offline reports (reports need the internet and say so honestly), automatic emails or scheduled reports, and any customer-facing report. The owner chats in Roman Urdu but everything committed must be English.

## Response snapshot

Local master was updated to the merge of PR 9 (ae00244). The test order in the DEV project was not deleted: the app has no delete for orders (only cancel, which keeps the history), no service key is held here, and the assistant never signs in as the owner, so the owner has to cancel it in the app. Branch 010-reports-profit was created and the spec written: five user stories (sales and profit with honest labels, purchase summary, sales by store and by medicine, outstanding balances, CSV export), 25 functional requirements, edge cases, assumptions and 11 success criteria. One question was asked (which actual cost is used when a medicine was bought at different costs); the owner's example (50/55 then 58/65) set the rule: the cost of a sold line is the weighted average actual cost of that medicine's non-cancelled purchases on the order's market date, nothing borrowed from other days, otherwise cost missing.

## Outcome

- ✅ Impact: Module 010 specification complete, no open clarification markers; checklist all items pass.
- 🧪 Tests: none run (spec only).
- 📁 Files: see the front matter.
- 🔁 Next prompts: `/sp.plan` for Module 010 (decide whether a read-only database function is needed, migration 0011 or higher, where the Reports entry goes); the owner still has to cancel the DEV test order in the app.
- 🧠 Reflection: the owner explained the cost rule with a concrete example, which was clearer than the three options offered; real numbers work better than option lists for this owner.

## Evaluation notes (flywheel)

- Failure modes observed: `create-new-feature.ps1` created the branch and the empty spec but then printed a parameter error about the word "prompts" (the long description contains text it treated as extra parameters); the branch and file were fine and the script was not run again.
- Graders run and results (PASS/FAIL): spec quality checklist PASS (all items).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): pass the description to the script by a short title plus the spec file instead of the full text.
