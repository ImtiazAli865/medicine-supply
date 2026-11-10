---
id: 001
title: Module 004 spec pending products
stage: spec
date: 2026-11-10
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.specify
labels: ["spec","pending-products","quick-register","pending-prices","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: history/adr/0003-order-write-model-and-price-snapshots.md
  pr: null
files:
 - specs/004-pending-products/spec.md
 - specs/004-pending-products/checklists/requirements.md
tests:
 - none (specification only)
---

## Prompt

Haan, shuru karo

(the owner's go-ahead to start Module 004; the feature description given to /sp.specify was composed from docs/master-prompt.txt sections 7A and 8, the Module 003 spec's Module 004 compatibility notes, and ADR-0003:)

Module 004 Pending products: Quick Register, linking pending order lines, and Pending Prices for the Medicine Supply & Order Management app (builds on Module 001 products/stores, Module 002 import and Module 003 manual orders, whose code is on branch 003-manual-orders, PR #2 not yet merged). Scope ONLY: (1) Quick Register from an order: on an order (draft or confirmed) a pending line (typed medicine, item_status pending_registration, product_id null, exact typed name kept) offers "Register this medicine". Only name and unit are required; strength, dosage form, manufacturer, pack size, SKU, purchase price, selling price and MRP are optional and never invented; the form is prefilled with the typed text only as a suggestion the supplier confirms. A duplicate check runs before creating (exact same name, strength, dosage form, pack size, manufacturer ignoring case and spacing is blocked and offered as 'use the existing medicine'; similar name with a different strength, form or pack size is a warning that needs explicit confirmation and is never auto-merged). Creating the product and linking the line is one atomic, retry-safe operation; the order and its other lines are never lost while registering, and the typed name on the line is kept for history. (2) Link a pending line to an EXISTING catalog product ('this is an existing medicine') after the supplier picks it, with the same rule: never auto-merge different strengths, dosage forms or pack sizes. (3) After a product is registered, propose linking the other pending lines (any store, draft or confirmed orders) whose typed name matches the new product, listing each candidate with its store, order number, typed text and quantity; the supplier confirms each link individually; nothing is linked automatically; lines with a visibly different strength, dosage form or pack size are shown as 'different, not proposed' or left unlinked. (4) Pending Prices screen listing every active product without a selling price and every order line (confirmed orders) that has no selling price snapshot, grouped by medicine, with the number of lines and orders affected; the supplier enters a selling price once (PKR two decimals, never invented), reviews the exact list of order lines that would get that price, and confirms; only lines with no price snapshot are filled (using the reserved snapshot-edit hook from Module 003, app.line_snapshot_edit, inside a SECURITY DEFINER function); lines that already carry a price snapshot are never changed; each fill is recorded in the order change history (order_events) with who/when/old (none)/new price; a retry never double-applies. Linking a typed line to a product that has a selling price fills the line snapshot only after the supplier confirms (the snapshot rule from Module 003: confirmed lines keep their taken snapshot; a pending line gets a snapshot only on confirmed linking and is recorded in history). Purchase price and MRP are never shown on order or pricing screens beyond the registration form fields. (5) Pending items must remain visible: a count and link on the Home screen and in the bottom navigation area or order screens; empty states with the next action on every list screen; mobile-first, large touch targets, English UI, loading and error states. Success criteria must be testable, including: no order line or quantity is lost while registering; a retried register or price fill creates no duplicate product and changes no price twice; lines with an existing price snapshot are never changed; two businesses are isolated by RLS for every new function; a 360 px layout passes the touch-target check. OUT OF SCOPE: market list and purchases (Module 005), invoices and the invoice-issue block itself (Module 006; this module only makes lines ready), ledger and payments, voice and Gemini, offline sync, reports, multi-user roles, editing a confirmed order's quantities (done in Module 003). Follow docs/master-prompt.txt (sections 7A, 8, 16 item 13, 17 items 7 and 22 and 24) and docs/negative-prompt.txt (never auto-merge different strengths/forms/pack sizes, never invent details or prices, never lose an order, check duplicates before creating, never change an issued/confirmed price snapshot silently) and .specify/memory/constitution.md principles I-VIII. ADR-0003 documents the order write model and the reserved snapshot-edit hook.

## Response snapshot

- Created branch `004-pending-products` (from `003-manual-orders`, because PR #2 is not merged) and wrote `specs/004-pending-products/spec.md`: five user stories (Quick Register P1, link to an existing medicine P1, proposals for other orders P2, Pending Prices P2, visibility P2), 33 functional requirements, 12 success criteria, edge cases, assumptions and out of scope.
- Zero clarification markers; the judgement calls are in Assumptions (undo of a link or fill is out of scope and flagged as a risk; conservative proposal matching; Pending Prices fills only the selling price of confirmed lines without one and also sets the catalog price, with "Save price only"; no sixth bottom-navigation item; purchase price and MRP are never copied into order lines).
- Quality checklist `checklists/requirements.md`: all items pass after one wording fix (FR-023 "data endpoints").
- Not committed yet; next step is `/sp.clarify` (optional) or `/sp.plan`.
