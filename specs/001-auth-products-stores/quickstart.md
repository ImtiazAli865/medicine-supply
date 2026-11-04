# Quickstart: Module 001 — Login, Products, Stores

How to run and verify this module once implemented. Nothing here claims a working app today; each step is a check to perform after `/sp.implement`.

## Prerequisites

- Node.js 24 and npm (installed: v24.16.0 / 11.13.0).
- A Supabase project (hosted) **or** Docker plus the Supabase CLI for a local stack. Use a separate project or local stack for automated tests; never run tests against real business data.

## 1. Configure environment

Copy `.env.example` to `.env.local` and fill in values from the Supabase dashboard (Project Settings → API):

```text
NEXT_PUBLIC_SUPABASE_URL=<your-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-public-key>
```

Do not commit `.env.local`. This module needs no service-role key in the app.

## 2. Apply the database migration

Hosted project: apply `supabase/migrations/0001_init.sql` with the Supabase CLI (`supabase link` then `supabase db push`) or paste it into the SQL editor.
Local stack: `supabase start` then `supabase db reset`.

Verify: tables `businesses`, `profiles`, `stores`, `products` exist, and RLS is enabled on all four.

## 3. Create the owner account and business (one time, manual)

1. In the Supabase dashboard, Authentication → Users → Add user (email + password).
2. In the SQL editor run `supabase/seed/provision-owner.sql` after replacing the email and business name placeholders. It inserts one `businesses` row and one `profiles` row linking that user.

An account without a profile will see the "account not set up" message and no data.

## 4. Run the app

```bash
npm install
npm run dev
```

Open the local address on a phone-sized viewport (360 px wide) and sign in.

## 5. Manual acceptance walk-through (maps to spec)

1. Visit `/products` while signed out → redirected to sign-in; after sign-in you return to `/products` (US1).
2. Stores: empty state shows "Add your first store"; add one with only a name; search by part of the name; edit phone; deactivate and reactivate (US2).
3. Products: empty state shows "Add your first medicine"; add with only name and unit; add one with prices and confirm Unit Gross Profit equals selling minus purchase; type "PAN" for suggestions; try an exact duplicate (blocked) and a same-name-different-strength product (confirmation required) (US3).
4. Turn the network off and save: an error appears, the form keeps your input, and nothing shows as saved (FR-027).
5. Open the same record in two tabs, save in one, then the other: a version-conflict message appears (FR-028).

## 6. Automated checks (the module is done only when all pass)

```bash
npm run lint
npm run typecheck
npm run test          # unit + integration (needs test Supabase env vars)
npm run test:e2e      # Playwright, 360 px and desktop
npm run build
```

Required test groups: money and normalization unit tests; duplicate and SKU rules; idempotent create (50 repeated trials, SC-005); version conflict; **RLS isolation with two businesses** (SC-003: list/read/update/deactivate across businesses all refused, signed-out returns nothing); search timing against a seeded 5,000-product set (SC-002); touch targets ≥ 44 px (SC-007).

## 7. Known limits of this module

No offline mode, no CSV import, no setup checklist, no orders or invoices, no in-app business editing, no self-registration, no in-app password reset.


## 8. Verification results (recorded 2026-11-05)

Only commands that were actually run are listed.

| Check | Result |
|-------|--------|
| `npm run lint` (ESLint + secrets check) | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed (18 routes) |
| `npm test` | 71 passed, 35 skipped (5 files). Passing: money, normalization, store and product validation, and `db-schema.pglite.test.ts` (22 tests: the migration, constraints, duplicate rules, versions, and Row Level Security on a real PostgreSQL engine). Skipped: the 5 integration files that need the Supabase test project |
| `npm run test:e2e` | 28 passed, 72 skipped. Passing: signed-out redirects, 401 JSON from the API, and sign-in screen layout and touch targets, in mobile (360 px) and desktop browsers. Skipped: everything that needs a signed-in user |
| Migration applied to a Supabase project (T013) | **Not done.** No Supabase credentials were available. It was applied to PGlite only |
| Manual walk-through (section 5) and SC-001 timing (T073) | **Not done** (needs Supabase) |

What is therefore NOT yet verified: the sign-in flow itself, the real PostgREST/Auth behaviour of the repositories (for example the `::text` money casts and the `find_*_by_name` functions), the Supabase role setup, search timing at 5,000 products, and the signed-in screens in a browser. The tests for these are written and will run once the test project is configured (below).

## 9. Running the Supabase-dependent tests

1. Create a SEPARATE Supabase project for tests (never use real business data).
2. Apply the migration to it: `supabase link --project-ref <test-ref>` then `supabase db push`, or paste `supabase/migrations/0001_init.sql` into its SQL editor.
3. Create `.env.test.local` (git-ignored) with `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY` (see `.env.example`).
4. Run `npm test` and `npm run test:e2e`. The previously skipped tests now run; the service-role key is used only by test helpers to create and clean up test users.