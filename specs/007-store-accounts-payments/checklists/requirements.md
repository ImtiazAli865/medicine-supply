# Specification Quality Checklist: Store Accounts (Khata), Payments, Account Summary and Store Statement

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-16
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

- Validation run 2026-11-16 (one pass, all items pass). The spec has 7 user stories (3 at P1, 3 at P2, 1 at P3), 37 functional requirements, 15 success criteria and 14 assumptions. No [NEEDS CLARIFICATION] markers were used: the three open scope questions were put to the owner first and answered in chat, and every other open point has a documented default in the Assumptions section.
- Three decisions were made by the owner on 2026-11-16 (translated from Roman Urdu): (1) invoices already issued in Module 006 are NOT put into the khata, which starts empty and gets an opening balance per store entered by the supplier (the assistant had recommended copying them in automatically; the owner chose to start empty, so the double-counting risk is warned about in the form and recorded as an edge case); (2) adjustments (writing off or adding a small amount, with a required reason) ARE in scope; (3) an opening balance can be entered on any day.
- Mentions of "server side", "atomic operation", "client-supplied key" and "real database" describe rules and how they are verified, in the same way the earlier module specs do; they are not design choices. The section "Changes to existing behaviour (Module 006), listed explicitly" (FR-035 to FR-037) names what issue, cancel and the immutability of an issued invoice gain, as the feature request required; how it is built is left to the plan.
- Points reasoned, not yet proven (to be proven in plan, tasks and implementation): the 3-second and 2-second goals (SC-012), the allocation rule with reversals and advances (SC-003), concurrent behaviour (SC-004, SC-008), and the print layouts (print-media emulation only; a real printer is not claimed).
- Points the plan must settle explicitly: where the "previous balance" is read (the order entries were recorded, not their dates; Assumption 6), how the allocation is worked out in one shared definition used by the invoices list, the account screen and the Home total, how the Module 006 guard on issued invoices allows the snapshot to be set once at issue, and how an invoice issued before this module is told apart from one in the account.
- Possible ADR for the plan: the append-only ledger with derived allocation and the extension of the invoice issue and cancel operations (to be suggested during `/sp.plan`; never created without the owner's consent).
- Analysis fixes applied 2026-11-16 (after `/sp.analyze`, PHR 005; the owner asked to keep the fixes and continue): FR-025 now says a cancelled invoice is printed without an Account Summary (its figures stay in the data); the function accepts only `cash` as a payment method (`invalid_method`) while the table check keeps the later values; the invoices list computes the allocation only for the stores on the page unless a paid filter is used, and the scale test measures both paths; `ledger_stores` lists stores without entries and archived stores (left join); an archived store's account visibility is tested; the rollback block drops the new unique key; the reversal of a payment received with an invoice copies its invoice id for display; the cancel dialog note says "if it is still recorded"; the 4-tap check moved to the task after the Home card exists; one mapping between data values and screen words for the paid statuses.
