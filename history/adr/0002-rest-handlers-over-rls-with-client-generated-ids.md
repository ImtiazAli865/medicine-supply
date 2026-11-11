# ADR-0002: Data Access Architecture (REST route handlers over RLS-enforced Supabase access, client-generated ids, versioned updates)

> **Scope**: One decision cluster made in Module 001 and reused by Modules 002 and 003. The parts below were chosen together, depend on each other and would change together.

- **Status:** Accepted
- **Date:** 2026-11-06
- **Feature:** 001-auth-products-stores (foundation); followed by 002-setup-catalog-import; refined for writes in 003-manual-orders
- **Context:** The app is a mobile-first, solo-supplier tool whose every business record (stores, medicines, later orders, invoices, ledger) belongs to one business and must never leak to another (constitution Principle V). Requirements that shaped the design: validation of money and duplicates must not rely on the browser (Principles II, IV, V); a retry, double tap or refresh must never create a duplicate record (FR-008, SC-005); two tabs or a later offline queue must never silently overwrite newer data (FR-028, Principle VII); the service-role key must never reach browser code; there is one developer and no separate backend team, so the design must stay small; later modules (market list, invoices, khata, voice, offline sync) must reuse the same surface without rework. The Supabase anon key and the user's session token are public by nature (they sit in the browser), so anyone signed in can also call Supabase's own REST interface directly: the real security boundary has to be the database, not the route handlers.

<!-- Significance checklist: 1) Impact: yes, it fixes how every present and future feature reads and writes data and where each rule lives. 2) Alternatives: yes, listed below. 3) Scope: yes, it spans browser, route handlers, database, tests and every later module. -->

## Decision

1. **A single REST surface of Next.js route handlers (`src/app/api/**/route.ts`) is the only way the app's screens read or write business data.**
   - Each handler verifies the caller with `supabase.auth.getUser()` (a call to the auth server, never an unverified cookie), parses the body with a Zod schema, and calls a repository function (`src/lib/*/repository.ts`). Errors leave in one documented shape (`ApiError` with a code, message, optional field messages and the current record) and fixed HTTP statuses (400 validation, 401 session expired, 403 no business, 404, 409 conflicts, 500 with no internals).
   - Pages that must be server-rendered call the same repositories with the same user-bound client.
2. **Handlers talk to Supabase with a client bound to the signed-in user's session (anon key plus that user's token), so Row Level Security is always the enforcement layer.**
   - Every table carries `business_id uuid not null default current_business_id()` (a `SECURITY DEFINER` helper that reads the caller's profile), RLS is enabled from the first migration, policies compare `business_id` to `current_business_id()`, and no table has a DELETE policy or DELETE grant (records are deactivated, never hard-deleted). No endpoint accepts a `business_id` from the client.
   - The service-role key is never used by the app; it exists only in a git-ignored test environment file for test set-up and clean-up.
3. **Rules that protect data live in the database, not only in handlers.**
   - Unique indexes for exact-duplicate medicines (using the same `norm_text` normalisation the TypeScript `norm()` mirrors) and SKUs, `CHECK` constraints, `NUMERIC(12,2)` money with a non-negative check, composite foreign keys that tie references to the same business. Where a change must touch several tables atomically (settings, catalog import, and in Module 003 orders), it is one database function called through the handler; those functions follow the same rule of reading the business from the session.
   - Handlers add friendlier pre-checks (similar-name warnings, readable messages) on top, and map database violations back to the same messages when a race gets past them.
4. **Records use client-generated UUIDs and an integer `version`.**
   - The browser creates the record id before the first save (`newId()` in `src/lib/ids.ts`, with a `getRandomValues` fallback because `crypto.randomUUID()` does not exist on plain-http pages). A create that repeats an id for the same business returns the stored record (idempotent); an id that cannot be used (for example another business's) returns the same generic validation error, revealing nothing.
   - Every row has a `version` bumped by a trigger; updates send `expected_version` and receive 409 `version_conflict` with the current record instead of overwriting.

## Consequences

### Positive

- One stable, replayable contract: a retried or double-tapped save never duplicates a record (tested for products, stores, imports); a stale edit is refused instead of overwriting (tested in two tabs); a later offline queue (Module 009) can resend the same requests with the same ids and versions.
- Isolation does not depend on handler code being correct: even a handler that forgot a filter can only see the caller's own rows, and the same rules hold for any client, including direct calls to Supabase. Cross-business reads and writes are refused in tests with two real users (`tests/integration/rls-isolation.test.ts`, `rls-settings-import.test.ts`) and on a real PostgreSQL engine (PGlite).
- Validation, error messages and status codes are controlled in one place, so every screen shows the same wording and the same retry behaviour; the browser bundle carries no secret and no business rule it must be trusted with.
- Small to operate: no separate backend service, no extra deployment, one language end to end; the constitution's "no hard deletes, no service-role key in the app" rules are enforced structurally.
- Later modules (settings, import, orders) reused the pattern without changing it, which is the best evidence that the surface was right.

### Negative

- Two validation layers must be kept consistent: Zod in the handlers and constraints in SQL (including `norm()` in TypeScript versus `norm_text()` in SQL). A drift would show as a message that disagrees with the database. Mitigation: the database is the last guard, and tests cover both.
- Route handlers are not a security boundary against a signed-in user who calls Supabase's REST interface directly: any rule that matters for integrity (duplicates, money range, status moves, snapshots) must also exist in the database. This is why Module 003 narrows writes further: select-only grants on order tables and `SECURITY DEFINER` functions as the only write path. Plain table writes with RLS (the Module 001 style) are therefore right for simple master data (stores, medicines) but not enough for state machines.
- An extra network hop per operation (browser to handler to Supabase), and handler limits of the hosting platform apply (for example request body size, which caused the 4 MB request cap in Module 002).
- Idempotent create costs a read before the insert (`getProduct` then `insert`), and a rare simultaneous double-send is resolved through a unique-violation retry path that must be maintained.
- Client-generated ids depend on browser APIs (found by the owner's phone test: `crypto.randomUUID` is missing on plain http), so the fallback in `newId()` must stay; ids are chosen by the client, so the server must never trust them for anything but identity.
- Optimistic versions turn a concurrent edit into a visible conflict the user must resolve; that is intended, but it is one more state every form has to handle.
- Offset-based paging (the existing cursor is an offset) can shift slightly while a user pages a changing list. Acceptable for one owner; revisit for very large histories.

## Alternatives Considered

- **Alternative A: Next.js Server Actions only.** Rejected: harder to replay from an offline queue, no stable documented contract for later modules or tests, and error handling is less uniform. (Server Actions would still run under the same RLS, so this is a convenience trade-off, not a security one.)
- **Alternative B: the browser talks directly to Supabase's REST interface (PostgREST) with RLS only.** Rejected for master data: error messages and similar-name checks would live in the client, validation would depend on database errors alone, and a single place to log, limit and shape responses would be lost. Kept in mind as a valid option for pure reads and still compatible, because RLS already protects it.
- **Alternative C: a separate backend service (Express, NestJS, a serverless API) with the service-role key.** Rejected: an extra deployment and codebase for a solo app, and a service-role key would bypass RLS and make every handler a possible leak, against Principle V.
- **Alternative D: tenant isolation by a JWT custom claim for the business, or one schema per business.** Rejected: a claim needs auth-hook configuration and is harder to test; per-business schemas are overkill for one business per account. A `profiles` table with a `SECURITY DEFINER` lookup is simple and testable.
- **Alternative E: server-generated ids and `updated_at` timestamps for conflict detection.** Rejected: a retry after a lost response would create a second record, which an offline queue could not tolerate; timestamps have precision and clock problems, while an integer version is exact.
- **Alternative F: client-side or handler-only validation with last-write-wins updates.** Rejected: contradicts the constitution (no reliance on client validation for money and security) and the spec (no silent overwrite).

## References

- Feature Spec: specs/001-auth-products-stores/spec.md
- Implementation Plan: specs/001-auth-products-stores/plan.md
- Research (decisions D1, D3, D4, D5, D7): specs/001-auth-products-stores/research.md; data model: specs/001-auth-products-stores/data-model.md; API contract: specs/001-auth-products-stores/contracts/api.openapi.yaml; migration `supabase/migrations/0001_init.sql`
- Code: `src/lib/api/` (auth, errors, paging), `src/lib/*/repository.ts`, `src/lib/ids.ts`, `src/lib/validation/`
- Related ADRs: ADR-0001 (catalog import architecture, builds on this surface and adds database functions for multi-table atomic work). A future ADR for Module 003 (order write model: `SECURITY DEFINER` functions only, request-id idempotency, price snapshot at confirm) is proposed in specs/003-manual-orders/plan.md and refines point 3 of this decision; it does not contradict it.
- Evaluator Evidence: specs/001-auth-products-stores/quickstart.md (verification results), tests listed above; history/prompts/001-auth-products-stores/006-implement-module-001.green.prompt.md
