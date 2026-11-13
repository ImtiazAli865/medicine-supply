---
id: 004
title: Module 004 cross-artifact analysis
stage: misc
date: 2026-11-10
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.analyze
labels: ["analyze","pending-products","consistency","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - (none modified: the analysis is read-only)
tests:
 - none (analysis only)
---

## Prompt

Yes, run the analysis. (translated from Roman Urdu)

## Response snapshot

- Read-only analysis of spec.md, plan.md, tasks.md, data-model.md, research.md and the OpenAPI contract against the constitution. No file was changed.
- Result: 0 critical, 2 high, 5 medium, 8 low findings. All 33 functional requirements and 12 success criteria have at least one task; 5 of them are only partly covered.
- High: (1) the idempotency lookup happens before the advisory locks only, so a simultaneous duplicate request would get a refusal instead of the stored result (data-model "Common behaviour", T007, T008); (2) the spec defines one "Pending Prices screen" that also lists typed lines, but plan and tasks split it into two tabs and the prices tab lists only medicines (FR-016, US4 scenarios 1 and 11, T042, T050).
- Medium: the Home count "(M have orders waiting)" is not a subset of "N need a price", so SC-007 (Home count equals list length) is not testable as written; no rule for more than 1,000 waiting lines of one medicine; no spec scenario for filling waiting lines of a medicine that already has a price; proposals cannot be reopened from the Pending screen as FR-014 says; no browser test for the "Use PKR X for this line?" prompt; migration re-apply rule missing.
- No constitution violation. A note was recorded that the link-time price confirmation is part of the Pending Prices flow for Principle II.
- Remediation offered, not applied.
