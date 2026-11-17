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

## What works in Module 006 (in progress, see its quickstart for what has been verified)

- **Invoice draft**: on a confirmed order, "Create invoice" makes one draft (a double tap, a refresh or a second device never makes a second one). Every line is priced only from the price taken for that order line, never from the current catalog price. The delivered (billed) quantity of each line can be changed on the draft (0 means not billed); the ordered quantity is never changed. A typed or unpriced billed line blocks issuing and links to the Pending screens. If the order changes after the draft was made, the draft says so and is rebuilt with "Refresh from order".
- **Issue**: one atomic step: the invoice gets the next invoice number (INV-000001, per business, only at issue, never reused), is frozen (lines, prices, totals, the business and store details), and the order becomes Fulfilled. A second tap or a reload gives the same number. An issued invoice cannot be edited or deleted; a mistake is corrected by cancelling it with a reason (the invoice stays, marked Cancelled, and the order returns to Confirmed) and issuing a new one.
- **Print**: the invoice prints on A4 or as a thermal receipt (the paper width is the setting in Settings, 80 mm by default). It shows only the business details, the invoice number and date, the store, and each billed line with product, quantity, selling price and line total, then the grand total. No purchase price, MRP, cost, margin or profit exists in any invoice data, so none can be printed. A draft prints as "DRAFT, not an invoice", a cancelled invoice as "CANCELLED". Printing uses the browser print dialog (and its own "save as PDF"); the layouts are checked in print emulation, a real printer is not claimed.
- **Order sheets**: option A (one order) and option B (the orders of a day, one separate section per store) with quantities and units only, never a price.
- **Visible**: Home shows how many confirmed orders still need an invoice (equal to the "To invoice" list); the Invoices screen lists invoices with status, store and date filters, a search and the "To invoice" tab; the order screen has "Create invoice" or "View invoice". There is no sixth item in the bottom navigation.
- It runs through database functions (migration `0007_invoices.sql`): invoice tables are written only by functions, an issued invoice is protected by database triggers, and the history is append-only.

Not included yet: the Account Summary and payments (Module 007), paid statuses, discounts, server-side PDF files, voice, offline sync, reports. Known limitation: a typed medicine with delivered 0 on an invoiced order cannot be registered until the invoice is cancelled.

## What works in Module 007 (code written, not yet applied to a live project; see its quickstart for what has been verified)

- **Store accounts (khata)**: every store has an account worked out from its entries. The balance is never typed or stored: it is the sum of what the store owes minus what it paid. A positive balance means the store owes you; a negative one is an advance. The account starts empty. Invoices issued before this module are not copied in; enter the old balance yourself as an **opening balance** (any day, either direction, with the warning not to count old invoices twice).
- **Invoices enter the account when issued** (one entry per invoice) and leave it when cancelled (a reversal entry; nothing is edited or deleted). An invoice with no total adds nothing.
- **Payments**: record a cash payment with a date and an optional reference. A preview shows the balance after it and which items it settles (opening balances first, then invoices oldest first). Paying more than is owed is kept as an advance. Invoices show Unpaid, Partly paid or Paid, worked out from the entries. A payment can also be taken while issuing an invoice.
- **Account Summary on the invoice**: previous balance, this invoice, payment received and balance due are saved when the invoice is issued and never change. Showing it on the printout is a checkbox (the default is a setting); a cancelled invoice prints without it.
- **Adjustments and reversals**: write off or add a small amount with a required reason. A payment, an opening balance or an adjustment is corrected by a reversal with a reason (a new entry; the old one stays, marked reversed). An invoice entry is reversed by cancelling the invoice.
- **Store Statement**: choose a store and dates; it lists the entries with the balance after each, the totals and the closing balance, and prints on A4. **Home** shows the total owed and how many stores owe it.
- No purchase price, MRP, cost, margin or profit exists in any account, summary or statement data, so none can be shown. It runs through database functions (migration `0008_store_accounts.sql`): the ledger table is written only by functions and refuses edits and deletes. Payments work online only; offline payments and "pending sync" come with Module 009.

## What works in Module 008 (code written and tested against fakes; applied to the test project only; the real Gemini service and a real microphone have not been tried yet)

- **Speak the order**: on New order, a microphone button and a language choice (English or Urdu) sit above the manual store list. The words are turned into text by the browser's own speech recognition, which may use the browser maker's speech service and needs a connection. The app never records, uploads or stores audio. Which browsers and languages work is not promised: support is detected when the microphone is tapped, a browser without it shows a plain message, and the typed text box (which also takes the phone keyboard's own voice typing) always works. The choice of language is remembered on the device.
- **Gemini on the server only**: the editable text is sent to the server, which asks Gemini for a list (store as spoken, and for each item the name as spoken, quantity and unit). Only the text is sent: no prices, MRP, balances, invoices or catalog data. The answer must fit a strict shape or the whole answer is refused. The key and the model name come from the server environment (`GEMINI_API_KEY`, `GEMINI_MODEL`) and are never in browser code.
- **The app decides, not the AI**: the store and medicines are matched by the app's own code against your own active records. A line is Matched only when exactly one medicine matches exactly; otherwise it is Choose one (nothing is preselected) or Not in catalog (kept as typed, like a pending line). Different strengths, forms, makers and pack sizes are never merged, and a doubtful quantity or missing unit is flagged, never rounded or guessed. It works with an empty catalog.
- **Preview and corrections**: you see what you said beside the store and lines, change the store, medicine, quantity and unit, remove a line, add a medicine by search or as typed, or change the text and read it again (keeping or discarding your corrections). Nothing exists until you tap Create draft order, which makes a normal draft order through the same safe, repeat-proof save as manual orders. The words you said stay on the order as read-only spoken text.
- **Failures never block an order**: a busy service, a slow one, an unusable answer, a missing or refused key, no connection, and an app limit of 20 AI readings a minute each show their own message and keep your text, with Retry, "Use the simple reader" (a simple rule-based reader for clear sentences that flags anything it is unsure about) and "Take this order by hand". The simple reader is never counted against the limit.
- **Voice diagnostics** (Settings): a read-only list of voice problems, newest first, with counts and the length of the text only, never what was said and never a key. Records older than 90 days are removed.
- It runs through database functions (migration `0009_voice_orders.sql`): matching, the limit, the diagnostic log and the extended order save. Migration `0010_voice_perf.sql` makes matching fast for a large catalog (a 200-item spoken order against 5,000 medicines); a spoken name that matches a medicine exactly no longer also lists similar-but-different medicines to choose from.

Not included: offline voice and offline sync (Module 009), a cloud speech provider (only the interface exists), audio storage, voice commands, reports, and any change to prices, invoices or the ledger. Automated tests never call the real Gemini service: they use a fake. The first real check of Gemini and the microphone is yours, on the dev project (see the module's quickstart).

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

1. Create a Supabase project. Apply `supabase/migrations/0001_init.sql`, then `0002_settings_and_import.sql`, then `0003_orders.sql`, then `0004_pending_products.sql`, then `0005_pending_perf.sql`, then `0006_market_list_purchases.sql`, then `0007_invoices.sql`, `0008_store_accounts.sql`, `0009_voice_orders.sql` and `0010_voice_perf.sql` (CLI `supabase db push` or the SQL editor; the editor may warn about `drop ... if exists`, which only touches the new objects).
2. In the dashboard add a user (Authentication → Users), then run `supabase/seed/provision-owner.sql`
   after replacing the email and business name placeholders. Without this the account sees "not set up".
3. Open the app and sign in.

Secrets: only the public URL and anon key are used by the app. Never put a service-role key in `.env.local`
or in `src/`. `npm run lint` fails if one appears.

Voice (Module 008): to use the voice service, put `GEMINI_API_KEY` and `GEMINI_MODEL` in `.env.local` yourself (the names are in `.env.example` with empty values; never paste the key in a chat, a commit or a pull request). Use a paid key for real business data. Without them the voice reading says the service is not set up, and the simple reader and manual entry still work. `GEMINI_API_BASE_URL` is for tests only; leave it empty. Only `src/lib/voice/gemini.ts` may read these names, and `npm run lint` fails otherwise.

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