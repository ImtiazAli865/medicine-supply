# Medicine Supply & Order Management

Mobile-first app for a pharmaceutical supplier: stores, medicines, orders, invoices and store accounts.
Built module by module with Spec Kit; this repository currently contains **Module 001** (login, products, stores) and **Module 002** (setup checklist, business settings, catalog import).

Product requirements: `docs/master-prompt.txt` and `docs/negative-prompt.txt`.
Project rules: `.specify/memory/constitution.md` and `CLAUDE.md`.
Module 001 spec, plan and tasks: `specs/001-auth-products-stores/`. Module 002: `specs/002-setup-catalog-import/`.

## What works in Module 001

- Email + password sign-in and sign-out, protected screens, session-expiry handling.
- Stores: add (only the name is required), edit, search, deactivate and reactivate.
- Medicines: add (only name and unit are required), edit, search as you type, deactivate and reactivate,
  duplicate and similar-product checks, exact PKR prices, internal unit gross profit.
- Every record belongs to a business and is protected by Row Level Security. Nothing is ever hard-deleted.

## What works in Module 002

- **Settings**: business name, phone, address, thermal receipt paper width (40-120 mm, default 80) and the default for printing the optional Account Summary. Saved with a version check ("changed elsewhere" instead of silent overwrite).
- **Setup checklist** on Home: three optional items derived from real data (details saved, a store exists, a medicine exists); dismissible and brought back from Settings. It never blocks any screen.
- **Catalog import** from CSV or Excel (.xlsx): download a template, choose a file, see a preview where every row is New, Already exists, Similar, Duplicate in file, SKU already used or Invalid (with the reason), choose what to do with Similar rows, confirm. The file is read in your browser (only text rows are sent), the import is one all-or-nothing transaction, retrying creates no duplicates, and empty cells stay empty. Limits: 10,000 rows, 5 MB, 4 MB of text per request.

Not included yet: orders, market list, invoices, ledger, voice, offline sync, reports.

## Status and limits

See `specs/001-auth-products-stores/quickstart.md`, section 8 "Verification results". In short: lint,
typecheck and build pass; the database migration and RLS pass on a real PostgreSQL engine (PGlite);
the tests that need a Supabase project (35 integration, 72 E2E) pass on a separate test project, and the app has been tried by the owner on a live Supabase dev project.

Module 002 results (272 unit and integration tests, 168 E2E tests passed on the test project, 5,000-row import measured) are in `specs/002-setup-catalog-import/quickstart.md`, section 6. Migration `0002` is applied to the test project and to the owner's dev project; the Import and Settings screens have not yet been tried by the owner on a real phone.

## Setup

Requirements: Node.js 24 and npm.

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL and anon key
npm run dev
```

1. Create a Supabase project. Apply `supabase/migrations/0001_init.sql` and then `supabase/migrations/0002_settings_and_import.sql` (CLI `supabase db push` or the SQL editor; the editor may warn about `drop ... if exists`, which only touches the new objects).
2. In the dashboard add a user (Authentication → Users), then run `supabase/seed/provision-owner.sql`
   after replacing the email and business name placeholders. Without this the account sees "not set up".
3. Open the app and sign in.

Secrets: only the public URL and anon key are used by the app. Never put a service-role key in `.env.local`
or in `src/`. `npm run lint` fails if one appears.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint plus the secrets check |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |
| `npm test` | Unit tests, PGlite database tests, and (with test credentials) Supabase integration tests |
| `npm run test:e2e` | Playwright tests in mobile (360 px) and desktop browsers |

Tests that need a Supabase test project are skipped with a visible message until `.env.test.local` is set.
See quickstart sections 9 and 10. Stop `npm run dev` before `npm run test:e2e`.