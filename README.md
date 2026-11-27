# Medicine Supply & Order Management

Mobile-first app for a pharmaceutical supplier: stores, medicines, orders, a market list and purchases, invoices, store accounts (khata), offline order taking and payments, reports and profit. Built module by module with Spec Kit; the repository contains **Modules 001 to 011** (voice ordering was dropped). Start with the **Status** section below, and the four guides in `guides/`.

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

## What works in Module 008 (fast order entry; code written, see its quickstart for what has been verified)

- **Repeat last order**: for a draft with no lines, one tap copies the lines of the store's latest confirmed order (medicine, quantity and unit; typed lines exactly as typed) into the new draft in one save. Nothing is confirmed and no price is copied. A medicine that is now inactive or missing is listed in a message that stays until dismissed. An Undo removes exactly the lines the repeat added.
- **Usual medicines**: up to 12 active medicines this store ordered most often in the last 180 days (looking at its 100 latest confirmed orders), on cards with strength, form, pack size, maker and the last quantity and unit. One tap adds a line; a stepper and quick buttons change the quantity first.
- **A search box that stays on the order screen** (the add-medicine pop-up is gone): the active medicines are loaded when the screen opens and searched on the device, so results show as you type. Choosing a result keeps the keyboard open and puts the cursor in the quantity; Enter adds the line and returns to the search box. Nothing is preselected unless exactly one medicine is left; digits in a name are never a quantity; `pan x20` means quantity 20 only when the text matches no medicine and only when you choose a result. Different strengths, forms, makers and pack sizes are never merged. A medicine that is not in the catalog can always be added as typed.
- **Choose from last order** (a checklist for orders of 20 to 30 lines): every line of the store's last order is a compact row; tap the ones the store asks for, change a quantity where needed, and add them all with one tap. Rows already on the order show "On order" and cannot be chosen again. It reuses the same read as Repeat and never copies a price.
- Online only (a failed save says "Not saved" and keeps the screen; offline is Module 009). No microphone, no AI, no new package and no database migration. The new routes (`/api/orders/medicines`, `/usual`, `/repeat`) are read-only, run as the signed-in user and never return a purchase price, MRP or cost. Not included: voice, pasted WhatsApp text, medicine nicknames, barcode.

## What works in Module 009 (offline order taking, sync and backup; in progress, see its quickstart for what has been verified)

- **Taking orders without the internet.** After the phone has been online once, the app opens and the order screens work with no signal: search, usual medicines, repeat last order and the last-order checklist use a copy of the active medicines and stores kept on the phone (identifying details and the current selling price only, never a purchase price, MRP or cost). Every change is written to the phone first and the screen then says "Saved on this device, not yet sent". The words "Saved at" and "Synced" appear only after the server confirmed the change.
- **Sending by itself, once.** When the connection returns the waiting orders are sent in the order they were made, one request at a time, with waits that grow after failures. A request that may have reached the server is repeated with the same request id, so the server applies it once: no duplicate order, line or store. Each order shows its own state (waiting, sending, failed with a reason and Retry, or needing a decision). Sending happens only while the app is open.
- **Nothing is silently overwritten or lost.** If the server's copy of an order changed meanwhile, both versions are shown side by side and nothing changes until you choose (keep the phone version, keep the server version, or keep both as separate orders), after a preview that says what is replaced or lost. An order that never reached the server is never deleted without a confirmation. Waiting orders belong to the signed-in business: another business on the same phone never sees or sends them, and signing out or an expired session keeps them.
- **Online only, and the app says so:** confirming an order (prices are fixed from the server), editing or cancelling a confirmed order, Register and Link of a typed medicine, invoices, payments, purchases, price changes and reports. Offline payment recording is deferred to a later module.
- **How it works.** No database migration and no new package: the existing idempotent order save and store create are the server side. The phone keeps its data in IndexedDB (one database per business); a small hand-written service worker (`public/sw.js`) keeps the app files and a client-only `/offline` page so the app opens without a signal. `npm run build` now also writes `public/sw-assets.json` (generated, git-ignored). Two read-only routes were added: `/api/ping` (is the server reachable) and `/api/backup/export`.
- **Honest limits.** Offline data is on this phone only: other devices do not see it until it has been sent, and it is not safe if the phone is lost or its browser data is cleared. There is no background sending while the app is closed and no real-time sync between devices.
- **If the app cannot read what is waiting on the phone.** A database written by a newer version of the app is never changed or deleted: the app says so in Settings and keeps working online. Before using an older copy of the app, or before clearing the browser data of a phone that still has waiting orders, use Settings > Sync and backup > Export backup first (while the phone can still read its data); the file can be imported again later and its orders are sent through the same safe queue.

## What works in Module 010 (reports and profit; code written and checked on the test project, not yet applied to the owner's dev project, see its quickstart for what has been verified)

- **Reports** (Home → Reports, or Settings → Reports): sales and profit, purchases, sales by store, sales by medicine, cost missing, and outstanding balances. They are for the owner only and read-only: nothing is changed by looking, and no report number, label or link is on any invoice, statement, print, offline copy or backup.
- **Two profit figures, never mixed.** *Estimate* uses the purchase price saved on the order line when the order was confirmed. *Realized* uses the weighted average actual cost you recorded for that medicine and unit on the day of the order (the owner's rule: a purchase on another day is never used). A line with no cost makes its figure *Incomplete*, with the number of lines and the sales amount that have no cost; no cost is ever guessed. Cancelled invoices, drafts and cancelled purchases are left out and counted.
- **Exact and fast.** Totals are computed in the database from the frozen invoice lines (a 5,000-invoice, 50,000-line history answered in 1.3 to 1.5 seconds on the test project), money stays exact and is rounded once. Day, week and month groupings add up to the same total. Each report exports a CSV that equals the screen (Estimate and Incomplete markers kept, a loss stays a number). No PDF.
- **Online only** (a failed load shows an error with Retry, never a zero; offline says "Reports need the internet"). It needs migration `supabase/migrations/0011_reports.sql` (read-only functions and one index; no table, no new package). Migrations 0009 and 0010 belong to the dropped voice work and are not in this repository.

## What works in Module 011 (offline payments and hardening; code written and checked on the test project, see its quickstart for what has been verified)

- **Record a payment without the internet** (Offline home → Record payment, or the same screen at `/accounts/pay`). It follows the online rules (an amount above zero, a date not in the future and not before 2000-01-01, an optional reference). The payment is kept on the phone and shown as *waiting*; it is never called recorded before the server confirms it, never removed without a question, and sent automatically, once, in order within each store, with a key made on the phone so sending twice records once. A refusal (a store the server does not have, a key that already holds other details, a refused date or amount) stays on the phone with its reason for you to decide.
- **Pending sync on every balance.** While a payment waits on the phone, the store's account screen, the Store accounts list, Home and the Reports balances say "Pending sync" and "N payments waiting on this phone, PKR X, not counted yet"; the invoice print and the statement never do. The phone itself keeps no balance.
- **Backup file version 2** carries the waiting payments (only the store, amount, date, reference and key) and never a balance, invoice, ledger entry or price; old files still restore. The online Record payment dialog gained "Keep it on this phone and send later" for a lost connection.
- **Sign-in help**: "Forgot password?" sends an email link that opens the app and lets you choose a new password (at least 8 characters; the old one is never asked for). A notice says so when offline mode cannot start because the address is not https.
- **Checks recorded**: `specs/011-hardening-offline-payments/traceability.md` maps the 31 test items and 16 acceptance criteria of the master prompt to named tests (and says what is not covered), and `security-review.md` holds the real outputs of the row level security audit, the route check, the secret scan and `npm audit`. The shared test clean-up helper now finds every table itself and fails loudly; `npm run test:sweep` lists the leftover test businesses.

## What works in Module 012 (store-specific selling prices; code written, see its quickstart for what has been verified)

- **A price per store.** On a draft order the supplier can change a line's price for that order and tick **Remember for this store**; the next order of that store is filled with that rate (search results show it too). A store without a rate gets the catalog selling price. A rate is per store and per medicine, only for the medicine's own unit, and is never computed from another price.
- **Nothing recorded ever changes.** The price is still fixed when the order is confirmed; confirming stops and shows the new price if a catalog price or a rate moved meanwhile. Confirmed lines and invoices never change, and invoices, statements and prints show only the selling price.
- **Market changes.** When the catalog price is no longer what it was when a rate was saved, the line says so; the app never changes a saved rate by itself. A store's page lists its rates, which can be changed or removed.
- **Register, Link and Pending Prices** use the store's rate too, and say so.
- **Offline.** The phone keeps the store rates (selling prices only); a typed price travels with the order, survives backup and restore (backup file version 3), and is remembered once the server has it. A rate changed meanwhile is never overwritten.
- **Setup.** Apply `supabase/migrations/0012_store_rates.sql` (safe to run again) before using this version.

## Status

**Implemented (Modules 001 to 011).** Sign-in and sign-out with password reset; stores and medicines (search, duplicates, exact PKR prices); setup checklist, business settings and catalog import (CSV and Excel); manual orders with automatic draft saving, typed medicines that are never lost, order history, confirm/edit/cancel; Quick Register, linking typed lines and Pending Prices; the consolidated market list and recorded purchases; fast order entry (usual medicines, repeat last order); invoices (draft, issue with the price check, cancel, print A4 and thermal, order sheets); store accounts (khata) with payments, reversals, adjustments, the optional Account Summary on invoices and the store statement; offline order taking, offline stores, offline payments, sync with a conflict panel, and backup and restore; reports and profit (online only, read only); every record is protected by row level security.

**Not implemented.** Voice ordering and anything that calls an AI service (dropped), parsing pasted text, medicine nicknames, barcodes, several users with roles, tax or accounting exports, issuing invoices offline, reversals and adjustments offline, and a public deployment (instructions only: `guides/deployment.md`).

**Limits you should know.**
- Offline data lives on **one phone**; another device sees it only after it has been sent. Waiting items are sent **only while the app is open**.
- Working without the internet needs a **secure address** (https, or localhost on a computer). On a plain http address the app says so and still works online. Print layouts are tested in the browser's print view; ink on paper from your real printers is for you to check once.
- A balance shown while a payment waits is the server's balance and does not include it (it says so). Reports and invoices need the internet.
- Reports speed, measured on the test project with 5,000 invoices and 50,000 invoice lines: three runs on 2026-11-24 gave warm medians from 0.2 s to 1.9 s (the largest, 1.86 s, is the 90-day sales report by day), under the 2 s target in every run, so no extra index was added; the **first** call after a quiet period was slower (2.4 to 3.4 s).
- Profit uses the cost rule of the owner (realized cost is the weighted average actual cost on the order's day; the estimate uses the price saved on the order line); a line with no cost is marked incomplete and never guessed.
- `npm audit`: no vulnerability in what ships; 7 moderate findings in the lint tooling (`minimatch` through `typescript-eslint`), not fixed yet (see the security review).
- The test project still holds old leftover test businesses until `npm run test:sweep -- --delete` is run on it with the owner's yes.

**Guides and records.** `guides/supabase-setup.md` (every migration in order, why there is no 0009 or 0010, the owner, the environment, the reset email), `guides/offline-and-sync.md`, `guides/backup-and-restore.md`, `guides/deployment.md`; `specs/011-hardening-offline-payments/traceability.md` and `security-review.md`; the per-module results are in `specs/<module>/quickstart.md`.

## Setup

Requirements: Node.js 24 and npm.

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL and anon key
npm run dev
```

1. Create a Supabase project and apply **every** file of `supabase/migrations/` in order (`0001` to `0008`, then `0011`; there is no `0009` or `0010`). `guides/supabase-setup.md` lists them one by one, explains the missing two, and covers the owner user, the environment file and the password-reset email.
2. In the dashboard add a user (Authentication → Users), then run `supabase/seed/provision-owner.sql`
   after replacing the email and business name placeholders. Without this the account sees "not set up".
3. Open the app and sign in. Forgot the password? Use **Forgot password?** on the sign-in screen (after the one-time email setup in the guide).

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
| `npm run test:sweep` | Lists the leftover test businesses on the **test** project (a dry run). `-- --delete` removes them (only run it when you mean to; it refuses any project that is not the test project) |

Tests that need a Supabase test project are skipped with a visible message until `.env.test.local` is set.
See quickstart sections 9 and 10. Stop `npm run dev` before `npm run test:e2e`.