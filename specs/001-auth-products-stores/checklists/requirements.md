# Specification Quality Checklist: Foundation — Login, Products, and Stores

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-05
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

- Validated in one pass; no [NEEDS CLARIFICATION] markers were needed. Defaults chosen and recorded under Assumptions: account provisioned by the owner (no self-registration or in-app password reset), PKR with two decimals, 200/1,000 character limits, and the duplicate-product rule (exact match blocked, similar match needs confirmation).
- The technology choices (Supabase, Next.js, RLS) live in the constitution and will appear in `/sp.plan`, not here.

## Manual walk-through results (T073), recorded 2026-11-06

**How it was done (read this first).** The walk-through was driven by an automated browser (Playwright) at a 360 x 800 phone viewport against a production build of the app connected to the separate TEST Supabase project, using throwaway businesses that were deleted afterwards. The owner's dev project and its data were not touched. I reviewed the screenshots of the key screens (home, settings, a duplicate warning, the similar-medicine dialog, an error with Retry). This is **not** a human hands-on run: no person timed it, and the SC-001 figures below are an automated measurement, not a supplier's own time. A first run on the dev server timed out after 15 minutes and lost its results (nothing was concluded from it); it was repeated on a production build with results written after every check.

**Result: 37 of 38 checks passed, 1 failed.** Every acceptance scenario of `spec.md` was exercised once.

| Scenario | Result | Evidence |
|----------|--------|----------|
| US1-1 signed-out visit redirects, returns after sign-in | PASS | `/products` -> `/sign-in?next=%2Fproducts` -> back on `/products` in 1.5 s |
| US1-2 sign-in lands on the app within 3 s | PASS | 1.5 s |
| US1-3 wrong credentials, non-revealing error | PASS | identical message for a wrong password and an unknown email |
| US1-4 sign out; Back and direct address do not reopen data | PASS | redirected to sign-in, no business name shown |
| US1-5 expired session keeps the open form | PASS | notice shown, typed text kept |
| US1-6 network down at sign-in | PASS | connection error, stays on sign-in |
| US2-1 to US2-7 stores (empty state, name only, search "MADI", edit phone, deactivate/reactivate, duplicate warning, failed save keeps data) | PASS | all seven |
| US3-1 to US3-11 medicines (empty state, name+unit shows "No selling price", "PAN" suggests both Panadols, search by brand/generic/strength/manufacturer/SKU, gross profit PKR 25.51, exact duplicate blocked, different strength needs confirmation, SKU conflict, deactivate hides, invalid prices refused, price warnings) | PASS | all eleven |
| US4-1 bottom navigation | PASS | every item opens a working screen and marks the current one |
| US4-2 loading indicator | PASS | shown while pending, no empty state |
| US4-3 error with Retry | PASS | no empty state; recovers after Retry |
| **US4-4 touch targets at least 44 x 44 px, readable text** | **FAIL** | on `/` two "Open" links in the setup checklist are 40 x 44 px; on `/settings` the Account Summary checkbox is 16 x 24 px (its label row is 44 px tall, so the tap area is large, but the control measures small). Body text is 16 px. Both pages belong to Module 002 additions; the Module 001 screens (sign-in, products, product form, stores, store form) had no small targets |
| US4-5 tablet (768) and desktop (1280) widths | PASS | no horizontal scroll, navigation and content available |
| US5-1 A sees only A's records | PASS | B's product and store are not found by search |
| US5-2 A cannot read, edit or deactivate B's records by id | PASS | GET and PATCH of B's product and store return 404; B's data unchanged |
| US5-3 signed-out requests | PASS | 401 on the product and store routes and a record route |
| US5-4 records are tied to the caller's business | PASS | a POST carrying B's `business_id` was stored under A's business |
| Quickstart step 4 (network off while saving) and step 5 (two tabs, version conflict) for stores and medicines | PASS | data kept, no success shown; conflict message shown |

**SC-001 (sign in, add a first store with only a name, add a first medicine with only name and unit, nothing pre-loaded; limit 2 minutes).** Automated runs on a fresh business: 11.5 s with instant entry (app speed only: sign-in 1.9 s, store 4.8 s, medicine 4.8 s) and 19.6 s with simulated typing at 70 ms per character. Both are far inside the limit. A real supplier on a phone will be slower; **a human timing has not been measured**.

**Observation on search speed (spec SC-002, 1 second).** From typing "PAN" to both Panadol products being visible took about 1.5 s in this run. That figure includes the 250 ms typing delay, the browser's polling, and the network round trip from this PC to the hosted test project, on a catalog of about 10 medicines. It is not a measurement of the 5,000-product requirement; that one is asserted at under 1 second per search by `tests/integration/product-search.test.ts` (recorded as passing earlier). The end-to-end 1.5 s was not under 1 s.

**Finding about the automated tests.** `tests/e2e/touch-targets.spec.ts` passed earlier for `/` and `/settings`, but it only waits for the page's `main` element, so it can measure before the checklist and the settings form have loaded and miss these controls. The failure above appeared because this walk-through waited for the network to be idle. The test should wait for the screen's content before measuring.

**Update, same day: US4-4 fixed.** The two "Open" links on the home checklist now have a minimum width of 44 px, and the Account Summary and "Create as a separate product" checkboxes no longer shrink (the box stays 24 x 24 px; tapping anywhere on its 44 px label row toggles it, so the label row is what the test measures). `tests/e2e/touch-targets.spec.ts` now waits for each screen's content before measuring and has a new test for the home screen with completed checklist items; it failed before the fix (two "Open" links at 40 x 44 px) and passed after it, together with the shell, setup-checklist, settings and import e2e tests (42 passed, mobile project). Lint and typecheck pass. The full e2e suite was not re-run in one go.
