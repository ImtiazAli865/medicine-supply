# Specification Quality Checklist: Pending Products (Quick Register, Linking, Pending Prices)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-10
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

- Validated 2026-11-10 in one pass. One wording fix was made: FR-023 first said "data endpoints" (an implementation word) and now says "the data sent to those screens". No failing items remain.
- Zero clarification markers. Judgement calls recorded in the spec's Assumptions so the owner can overrule them: (1) undoing a link or a price fill is out of scope (flagged as a risk, to be decided together with invoicing in Module 006); (2) proposals use a conservative match rule, and anything different or ambiguous is not proposed (exact rule left to planning); (3) Pending Prices fills only the selling price of confirmed lines that have none, and also sets the medicine's catalog price (with a "Save price only" option); (4) no sixth bottom-navigation item, visibility comes from a Home card and the order screens; (5) purchase price and MRP are never copied into order lines by this module.
- Constitution check: Principle I (no fake success, history of every change), II (price snapshots never changed once recorded, prices only from the supplier), III/IV (no auto-merge of different strengths, forms or pack sizes; typed lines never lost, nothing linked without confirmation), V (server-side validation, isolation per business, append-only history), VI/VII (a failed register leaves the order as before; offline stays in Module 009), VIII (mobile-first, 44 px targets, empty states).
- Dependency: builds on the Module 003 order data and on its reserved "snapshot edit" hook (ADR-0003). Branch `004-pending-products` was created from `003-manual-orders` because PR #2 is not merged yet.
- After `/sp.analyze` on 2026-11-10 the spec gained: a defined "Pending screen" with two tabs (To register, Need a price), scenarios 13 and 14 of Story 4 (a priced medicine with waiting lines; the 1,000-line batch limit), Home counts that equal the list lengths, and a short terms note in Assumptions. Still no clarification markers.
- Next step: `/sp.implement` (after the owner reviews).
