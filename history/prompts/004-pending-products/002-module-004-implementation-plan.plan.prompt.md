---
id: 002
title: Module 004 implementation plan
stage: plan
date: 2026-11-10
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.plan
labels: ["plan","pending-products","quick-register","pending-prices","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/004-pending-products/plan.md
 - specs/004-pending-products/research.md
 - specs/004-pending-products/data-model.md
 - specs/004-pending-products/quickstart.md
 - specs/004-pending-products/contracts/api.openapi.yaml
 - specs/004-pending-products/spec.md
tests:
 - none (planning only)
---

## Prompt

Yes, run the plan. (translated from Roman Urdu)

## Response snapshot

- Read the Module 003 migration and code the plan builds on (typed lines, the snapshot guard and its reserved flag, `order_save` refusing a changed medicine, the event-type check, the product duplicate rules) and wrote plan, research (12 decisions), data model, OpenAPI contract and quickstart.
- Design: three `SECURITY DEFINER` write functions (register, link, price apply) and five invoker read functions; idempotency table `pending_requests`; same advisory lock key as `order_save`; link bumps the order version; new write-once column `order_lines.typed_name`; new history types `linked` and `price_filled`; reviewed-line-list comparison plus an `update` that only touches rows with no price snapshot; narrow proposal matching; three partial indexes.
- One spec change found while planning: Pending Prices requires a price greater than zero (a zero price would look priced), and never overwrites an existing catalog price (FR-017).
- Constitution check passes on all eight principles; no complexity violations. ADR suggested (not created): `pending-link-and-price-fill-write-model`.
- The agent-context script only added a byte order mark to CLAUDE.md; that change was reverted.
- Nothing committed yet; next step is `/sp.tasks`.
