# Research: Module 001 — Login, Products, Stores

All Technical Context items are resolved; no `NEEDS CLARIFICATION` remain. Versions below were read from the npm registry on 2026-11-05 (`npm view`) and must be re-verified when the project is scaffolded.

## D1. Application structure and API surface
- **Decision**: One Next.js App Router project. All business reads/writes go through REST route handlers (`/api/products`, `/api/stores`) that validate with Zod and use a Supabase client bound to the user's session.
- **Rationale**: Gives a single replay-friendly, idempotent HTTP surface that the offline queue (module 009) can reuse; keeps validation server-side (Principle V); simple to test.
- **Alternatives**: Server Actions only (harder to replay offline, not a stable contract); direct browser-to-PostgREST (validation would live only in the client and DB constraints, error messages harder to control); a separate backend service (extra deployment for a solo app).

## D2. Authentication and sessions
- **Decision**: Supabase Auth email+password via `@supabase/ssr` cookie sessions. A Next.js `proxy.ts` (Next 16 successor to `middleware.ts`) refreshes the session and redirects signed-out visitors; the `(app)` layout and every route handler also verify the user with `getUser()` (not `getSession()`).
- **Rationale**: Redirect-only protection is not a security boundary; server re-verification plus RLS is. Expiry handling: 401 from handlers → client redirects to sign-in with a "session expired" message.
- **Alternatives**: Magic link / OAuth (not requested; email+password chosen by user); client-only session (cannot protect server-rendered pages).
- **Verify at scaffold**: confirm Next 16 `proxy.ts` naming and the current `@supabase/ssr` cookie API in official docs.

## D3. Business model and isolation
- **Decision**: Tables `businesses` and `profiles(user_id → business_id)`. A `SECURITY DEFINER` helper `current_business_id()` reads the caller's profile. Every data table has `business_id uuid not null default current_business_id()` plus RLS policies for select/insert/update using `business_id = current_business_id()`. No delete policy and delete privilege revoked (no hard delete). Owner/business is provisioned manually with a documented SQL script run in the Supabase SQL editor.
- **Rationale**: Constitution V requires `business_id` and RLS from migration one. Manual provisioning avoids shipping a service-role key or a public sign-up path; matches the spec assumption (no self-registration).
- **Alternatives**: JWT custom claim for business_id (needs hook configuration, harder to test); per-business schemas (overkill); self-registration creating a business (not requested, expands attack surface).

## D4. Duplicates, SKU uniqueness, normalization
- **Decision**:
  - Unit is not part of the identity, and inactive products still count (decided after `/sp.analyze`, finding H1).
  - Exact-duplicate rule is a **unique index** on `(business_id, norm(name), norm(strength), norm(dosage_form), norm(pack_size), norm(manufacturer))`, where `norm` = lowercase, trimmed, collapsed whitespace, null → empty string. Violation → 409 `duplicate_product`.
  - Similar rule (same normalized name, any other attribute differs) is checked by `/api/products/similar` and by POST when `confirm_similar` is not true → 409 `similar_products` with the matches.
  - SKU: unique index on `(business_id, lower(btrim(sku)))` where sku is not null → 409 `sku_conflict` naming the conflicting product.
  - Store names: case/space-insensitive match returns 409 `similar_store` unless `confirm_duplicate: true`; no DB unique index (the spec allows creating after confirmation).
- **Rationale**: Database-level uniqueness survives races and double submits; app-level similarity is advisory by design (never auto-merge).
- **Alternatives**: App-only checks (race-prone); fuzzy/trigram duplicate blocking (would block legitimate distinct medicines).

## D5. Search
- **Decision**: A generated, lowercase `search_text` column concatenating searchable fields using `||` with `coalesce` (immutable), with a `pg_trgm` GIN index; queries use `ILIKE '%term%'` with `%`, `_`, `\` escaped; result limit and cursor paging; client debounce 250 ms with request cancellation of stale responses. Stores use the same pattern on name, contact person, phone.
- **Rationale**: Handles partial matches like "PAN" and mixed scripts, comfortably under 1 s for 5,000 rows, no extra service.
- **Alternatives**: Postgres full-text search (poor for partial substrings and Urdu/Roman Urdu); client-side filtering of the whole catalog (violates "server-side querying", poor at thousands); external search service (unneeded).
- **Verify**: generated-column expression is accepted as immutable by the migration; benchmark with a seeded 5,000-row set.

## D6. Money
- **Decision**: `NUMERIC(12,2)` with `CHECK (value >= 0)`; the API carries money as decimal **strings** (`"125.50"`); TypeScript helper converts to integer paisa (BigInt/number-safe) for arithmetic and formatting; Zod rejects more than two decimals. Unit Gross Profit is computed in the app layer from strings only when both prices exist and returned by the API as a string or `null`.
- **Rationale**: No float drift (SC-009); matches Principle II.
- **Alternatives**: floats (rejected); a decimal library (extra dependency; integer-paisa arithmetic is enough for subtraction/formatting).

## D7. Idempotent create and optimistic concurrency
- **Decision**: Clients generate the UUID (`crypto.randomUUID()`) when the form opens and send it as `id`. Create with an existing `id` for the same business returns the existing record with 200 (idempotent); an `id` that belongs to another business returns the same generic `validation_error` on field `id` that any unusable id produces (no dedicated error code, so nothing about other businesses is revealed), and the client generates a new id. Collision is practically impossible with random UUIDs. Each row has an integer `version` bumped by trigger; PATCH requires `expected_version` and returns 409 `version_conflict` if it differs.
- **Rationale**: Satisfies FR-008/FR-028, SC-005, and prepares offline sync.
- **Alternatives**: `updated_at` comparison (timestamp precision issues); last-write-wins (forbidden by spec).

## D8. Testing strategy
- **Decision**: Vitest unit tests (money, normalization, Zod schemas); integration tests that call route handlers and the database with two real users in two businesses (RLS isolation, SC-003); Playwright E2E at 360×800 and desktop for flows, touch-target size (≥ 44 px), and empty/loading/error states. Database tests run against a local Supabase stack (`supabase start`, needs Docker) or a dedicated hosted test project selected by environment variables; they never touch production data.
- **Rationale**: Principle I forbids mocking the database; Principle VIII forbids claiming unrun tests.
- **Risk**: Docker may not be available on the dev machine; fall back to a dedicated hosted test project. Decide at quickstart time.

## D9. UI foundations
- **Decision**: Tailwind CSS 4 with a small in-repo component set (buttons, inputs, list rows, dialogs, toasts, empty/error/loading states), Lucide icons, bottom navigation on small screens that becomes a side/top bar on wide screens, minimum 44×44 px targets, system font stack with Urdu-capable fallback. The existing `ui-ux-pro-max` skill is consulted when implementing the design system.
- **Alternatives**: A full component kit (heavier bundle, more to override for large touch targets).

## D10. Environment and secrets
- **Decision**: `.env.example` lists `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (placeholders). This module needs no service-role key; test provisioning of two users uses a separate, test-only env file kept out of git.
- **Rationale**: Principle V.

## Summary of package versions observed (verify at scaffold)
next 16.4.5, react 19.3.1, tailwindcss 4.3.4, @supabase/supabase-js 2.119.0, @supabase/ssr 0.12.7, zod 4.6.7, lucide-react 1.68.0, vitest 5.1.0, @playwright/test 1.64.1, supabase CLI 3.0.0, TypeScript 7.0.2 (confirm Next compatibility before adopting; otherwise use the version Next's scaffold selects).
