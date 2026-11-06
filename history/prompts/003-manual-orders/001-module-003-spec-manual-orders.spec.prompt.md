---
id: 001
title: Module 003 spec manual orders
stage: spec
date: 2026-11-06
surface: agent
model: claude-sonnet-5-5
feature: 003-manual-orders
branch: 003-manual-orders
user: ImtiazAli865
command: /sp.specify
labels: ["spec","orders","drafts","price-snapshot","order-history","module-003"]
links:
  spec: specs/003-manual-orders/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/003-manual-orders/spec.md
 - specs/003-manual-orders/checklists/requirements.md
 - history/prompts/003-manual-orders/001-module-003-spec-manual-orders.spec.prompt.md
tests:
 - none (specification only)
---

## Prompt

PR 1 ko merge aro pehle phr next

(PR #1 was merged first. "Next" was taken as Module 003, the next module in the agreed order. The /sp.specify description was drafted by the assistant from docs/master-prompt.txt sections 4C, 4D, 7, 7A and 16 and run with this text:)

Module 003 Manual orders for the Medicine Supply & Order Management app (builds on Module 001 products/stores and Module 002 setup/import). Scope ONLY: (1) Create and take orders by hand (typing/tapping, no voice): select a store first, with an inline "Add new store" inside the store selector (only the store name is required); add multiple lines, each with a medicine searched from the catalog (autocomplete on name, strength, form, manufacturer, SKU), a quantity and a unit; edit or remove lines; add order notes. (2) Orders are auto-saved as drafts while being entered so nothing is lost on refresh or navigation; show last saved time. Statuses: draft, confirmed, cancelled (fulfilled is only defined, not used yet). Confirm an order; reopen/edit rules for confirmed orders; cancel with a reason; unique order number per business; order source = manual. (3) Price snapshots: each line stores a snapshot of purchase price, selling price and MRP taken when the line is added/confirmed, so later catalog price changes never silently change existing orders; a line whose product has no selling price is shown clearly as having no selling price but never blocks saving or confirming. Line total only when a selling price exists; never invent a price. (4) Store-wise Order History: every store has its own independent history; search/filter by store, date, order number and status; view an order without overwriting it; multiple orders per store per day. Changing the store on a draft must never move lines between stores (define a safe rule). (5) Typed free-text line for a medicine that is not in the catalog is kept as a line with its exact typed name, quantity and unit and marked "not registered" (pending); it never blocks saving or confirming. Registering pending lines (Quick Register, linking, Pending Prices screen) is OUT OF SCOPE for this module (Module 004), but the data model must not need to change for it. English UI, mobile-first, large touch targets, loading/error/empty states ("Take your first order" empty state), idempotent save/confirm that is safe to retry (client-generated ids, no duplicate order numbers), RLS isolation between two businesses, owner-only. OUT OF SCOPE: voice and Gemini, Quick Register and pending-product registration, market list, purchases, invoices and printing, ledger and payments, offline queue and sync, reports, multi-user roles. Follow docs/master-prompt.txt (sections 4C, 4D, 7, 7A, 16 items 4 and 5), docs/negative-prompt.txt and .specify/memory/constitution.md principles I-VIII. Success criteria must be testable, including: no order or line lost on refresh/navigation, no cross-store item mixing, snapshots unchanged after a catalog price change, retried confirm creates no duplicate, RLS isolation, and a stated time to take a typical 10-line order.

## Response snapshot

Merged PR #1 (Modules 001 and 002) into master through the owner's signed-in Chrome (merge commit 2efc597) and updated local master. Created branch `003-manual-orders` and wrote the Module 003 spec: 6 user stories (take an order, auto-saved drafts, typed not-registered lines, price snapshots and unpriced lines, store-wise order history, edit/cancel confirmed orders), 49 functional requirements, 14 success criteria, edge cases, assumptions and out of scope. Zero clarification markers; four judgement calls are recorded in Assumptions: the snapshot is taken at confirm (constitution Principle II), a confirmed order is edited in place and never turned back into a draft, the store of a draft is locked once it has a line, and cancelled orders are final.

## Outcome

- ✅ Impact: Module 003 is specified and checklist-validated; ready for `/sp.plan` (or an optional `/sp.clarify`).
- 🧪 Tests: none (specification only).
- 📁 Files: specs/003-manual-orders/spec.md, specs/003-manual-orders/checklists/requirements.md.
- 🔁 Next prompts: owner review of the four assumptions; `/sp.plan` for Module 003.
- 🧠 Reflection: the request said the snapshot is taken "when the line is added/confirmed"; the constitution says at confirm, so the spec follows the constitution and shows the live current price on drafts.

## Evaluation notes (flywheel)

- Failure modes observed: the first PowerShell call to create-new-feature.ps1 printed a parameter-binding error ("positional parameter ... 'prompts'") although the branch and spec skeleton were created; the script was not run a second time.
- Graders run and results (PASS/FAIL): spec quality checklist PASS (all items).
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): pass long descriptions to the script from a file to avoid quoting problems.
