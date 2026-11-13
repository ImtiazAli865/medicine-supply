---
id: 014
title: ADR for the pending link and price-fill write model
stage: misc
date: 2026-11-11
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.adr pending-link-and-price-fill-write-model
labels: ["adr","pending-products","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: history/adr/0004-pending-link-and-price-fill-write-model.md
  pr: null
files:
 - history/adr/0004-pending-link-and-price-fill-write-model.md
 - specs/004-pending-products/plan.md
 - specs/004-pending-products/quickstart.md
 - specs/004-pending-products/tasks.md
tests:
 - none (documentation only); the facts in the ADR come from the runs recorded in quickstart sections 6 and 7
---

## Prompt

Yes, create the ADR. (translated from Roman Urdu)

(the owner's consent to the ADR suggested in plan.md; the command run was `/sp.adr pending-link-and-price-fill-write-model`)

## Response snapshot

- Checked the existing ADRs (0001 to 0003): no conflict; ADR-0003 reserved the snapshot-edit exception for this module and asked for a review when it is first used, which this ADR records.
- The `create-adr` script does not exist in this project (`.specify/scripts` holds only the PowerShell scripts), so the file was written by hand from the template and the ADR-0003 format, as ADR-0003 was.
- One decision cluster, ADR-0004: three function-only write paths, the `pending_requests` replay table, locking and the version bump, the write-once `typed_name`, the two uses of the snapshot-edit exception, reviewed-list all-or-nothing price fill, the `linked` and `price_filled` events, the narrow proposal rule. Alternatives, positive and negative consequences listed, including the planner problem found by the scale test and fixed in `0005`.
- Task T063 ticked (63 of 64). Only the pull request T064 is open; it waits for PR #2 to be merged.
