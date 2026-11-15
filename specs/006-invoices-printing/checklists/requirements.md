# Specification Quality Checklist: Invoices and Printing

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validation run 2026-11-14 (one pass, all items pass). No [NEEDS CLARIFICATION] markers were used: every open point has a documented default in the Assumptions section.
- Four assumptions were flagged for the owner and CONFIRMED on 2026-11-14: (1) the Account Summary, payments and the paid or partially paid statuses move to Module 007 (they need the khata ledger); (2) the delivered (billed) quantity is entered on the invoice draft, with no separate delivery screen; (3) cancelling an issued invoice returns the order to Confirmed so a replacement can be made; (4) invoice numbers are a plain increasing number per business assigned only at issue (for example INV-000001).
- Correction made while planning (2026-11-14): the first draft of the spec wrongly said that the business has only a name and that phone and address must be added. Module 002 already stores phone, address and the thermal paper width in Settings, so FR-020, FR-023 and Assumption 5 were corrected and nothing is added to Settings.
- Mentions of "version check", "server side" and "real database" describe rules and how they are verified, in the same way earlier module specs do; they are not design choices.
- Items that are reasoned, not tested, at this stage (to be proven in plan, tasks and implementation): the 2-second draft time (SC-001), the 3-second list time with 1,000 invoices (SC-009), concurrent issue and cancel behaviour (SC-002, SC-003), and the print layouts (checked with print-media emulation; a real thermal printer is not claimed).
- Analysis fixes applied 2026-11-14 (after `/sp.analyze`, PHR 004; owner asked to continue with the fixes): internal helpers stated as SECURITY INVOKER with a crafted-id test and `invoice_json` listed (function counts corrected), the order status added to the invoice json so a draft of a cancelled order says why it cannot be issued (edge case, tests, UI wording), the invoices list date filter defined (invoice date, or the creation day for a draft), the 5-tap (SC-001) and 2-minute (SC-013) checks added to the print e2e and the owner walkthrough, FR-007 wording aligned with research D6, `reason_required` versus the validation 400 clarified, zero-delivered lines described as stored but not shown, issued print header taken from the snapshot, long product names added to the print test, and the TEST project name removed from T015. The known limitation for a typed line with delivered 0 on an invoiced order (cannot be registered until the invoice is cancelled) was recorded as an edge case and a risk, following the recommendation given to the owner.
