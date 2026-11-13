# Medicine Supply & Order Management

Mobile-first app for a pharmaceutical supplier: stores, medicines, orders, invoices and store accounts.
Built module by module with Spec Kit; this repository currently contains **Module 001** (login, products, stores), **Module 002** (setup checklist, business settings, catalog import) **Module 003** (manual orders and order history; `specs/003-manual-orders/`) and, in progress, **Module 004** (pending products: Quick Register, linking, Pending Prices; `specs/004-pending-products/`).

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

## What works in Module 003

- **Manual orders**: choose a store (or add it on the spot with just a name), search the catalog by name, strength, dosage form, maker or code, add lines with quantity and unit, edit or remove lines, add notes, and confirm. A medicine that is not in the catalog is added as typed and marked "Not registered"; it never blocks saving or confirming.
- **Automatic draft saving**: every change is saved as you go and survives a refresh. The screen shows only what the server confirmed ("Saving", "Saved at HH:MM", "Not saved" with Retry, "Changed elsewhere"). There is no offline mode yet: without a connection the screen says "Not saved".
- **Prices stay as they were**: a draft shows the current catalog price; confirming records an immutable price snapshot, so later catalog changes never alter an order. A medicine without a selling price is shown as such and never counted as zero.
- **Order history, store by store**: newest first, filter by store, status and day, search by order number or store name. A confirmed order can be edited in place (every change goes into its change history) or cancelled with a reason; a cancelled order is final.
- Orders can only be written through database functions (`order_save`, `order_confirm`, `order_cancel`); signed-in users have read-only access to the order tables.

Not included yet: market list, invoices, ledger, voice, offline sync, reports.

## What works in Module 004

- **Register a typed medicine**: on an order line marked "Not registered", choose "Register this medicine". Only the name and unit are needed; everything else stays empty unless you fill it. Creating the medicine and linking the line is one all-or-nothing step, retrying never creates a second medicine, and the typed text and quantity stay on the line. The same name, strength, form, pack size and maker is never created twice; a similar one with a different strength, form or pack size needs your explicit confirmation and is never merged.
- **Link to an existing medicine**: "This is an existing medicine" shows the typed text next to the medicine you picked, so a different strength or form is visible before you confirm.
- **Other orders with the same typed text**: after a register or a link, matching lines in other orders are listed. You confirm each line yourself; there is no "link all", and look-alikes ("Noran 40mg" for "Noran 20mg") are only listed under "Looks different" and never proposed.
- **Pending Prices**: medicines without a selling price, and confirmed order lines still waiting for one, grouped by medicine. Type the price once (PKR, two decimals, never filled in for you), review the exact lines, confirm. Only lines that have no price yet are filled; **a recorded price is never changed**. Each fill is in the order's history, a retry changes nothing twice, and a list that changed since the review is refused and shown again.
- **Visible**: Home shows "Needs attention" with the typed medicines to register and the medicines that need a price (the numbers equal the lists). The Pending screen has two tabs, "To register" and "Need a price". There is no sixth item in the bottom navigation.
- All of it runs through database functions (migration `0004_pending_products.sql`); purchase price and MRP are only ever typed in the register form and never shown on order or pricing screens.

Not included yet: invoices (and the check that blocks an invoice while a price is missing), ledger, voice, offline sync, reports. Module 004 results, gaps and the owner's phone check are in `specs/004-pending-products/quickstart.md`, sections 6 and 7.

## What works in Module 005 (in progress, see its quickstart for what has been verified)

- **Market list**: one combined list of the orders confirmed on a Pakistan day (today by default, any day can be chosen). Each medicine appears once (a different strength, form, manufacturer, pack size or unit is its own row) with the total, each store's share, how much is bought and how much remains. Draft and cancelled orders are never counted. Typed medicines that are not registered yet are in their own group "Not yet registered", so no requested quantity is left out. Search, a status filter (all, still to buy, bought) and a store filter are available; the choices stay in the page address.
- **Record purchases**: on a row, "Record purchase" saves the quantity really bought (partial purchases are fine, an optional cost per unit, supplier and reference). Only a recorded quantity marks something bought; "Bought all remaining" just fills the field and still needs Save. A wrong entry is cancelled with a reason (it stays in the history), never edited or deleted. A repeated save records one entry. After a purchase with a cost the app asks whether to update the medicine's purchase price; nothing changes unless you say yes.
- **Print and CSV**: a compact A4 print page and a CSV file of the same rows. Neither ever shows a price, cost, MRP or profit. Thermal printing comes with invoices.
- **Visible**: Home shows how many medicines are still to buy today, and the Orders screen links to the list. There is no sixth item in the bottom navigation.
- It runs through database functions (migration `0006_market_list_purchases.sql`): the list is computed on every read, and purchase entries are append-only.

Not included yet: invoices, ledger, voice, offline sync, reports.

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

1. Create a Supabase project. Apply `supabase/migrations/0001_init.sql`, then `0002_settings_and_import.sql`, then `0003_orders.sql`, then `0004_pending_products.sql`, then `0005_pending_perf.sql`, then `0006_market_list_purchases.sql` (CLI `supabase db push` or the SQL editor; the editor may warn about `drop ... if exists`, which only touches the new objects).
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