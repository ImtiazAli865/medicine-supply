# Quickstart and Verification Guide: Invoices and Printing

**Feature**: 006-invoices-printing | **Status**: planned, nothing implemented or verified yet

This file says how the module will be run and checked. The "Results" section stays empty until real runs exist; nothing here may be read as a claim that something passed.

## 1. Prerequisites

- Modules 001 to 005 are merged into master (Module 005 merge commit `4c98bf6`).
- `.env.local` has the DEV project values; `.env.test.local` has the TEST project values (same files as before; no secret is committed).
- Migration `supabase/migrations/0007_invoices.sql` is applied to the TEST project (through the owner's signed-in Supabase tab, with the owner's say-so) before the Supabase integration tests and the e2e run, and to the DEV project only when the owner asks. The migration also changes three Module 003 objects (order status guard, order event kinds, delivered quantity check), so the counts of existing rows must be compared before and after, as for migration 0006.
- Port 3000 is free for the e2e run (the e2e builds a production build against the TEST project and does not reuse a server).

## 2. Commands (same as earlier modules)

```bash
npm run lint
npm run typecheck
npm test                  # unit + PGlite + Supabase integration
npm run test:e2e          # Playwright, mobile and desktop projects
npm run build             # run again after e2e so .next matches the DEV env
```

## 3. Manual walkthrough on a phone (owner, DEV project, after the module is built)

1. Settings: check that the business name, phone, address and the thermal paper width (80) are saved (they are printed on the invoice).
2. Take an order for one store with three priced medicines; confirm it. On the order screen tap **Create invoice**. Check the draft: each line shows ordered and delivered quantity, the price and the line total; the grand total is the sum.
3. Change one delivered quantity (for example 10 to 8) and save: only that line total and the grand total change; the ordered quantity stays 10.
4. Tap **Create invoice** again, and refresh the page: still one draft.
5. Take a second order with one typed (unregistered) medicine and confirm it. Create its invoice: the typed line says it needs a verified selling price and **Issue** is refused with a link to Pending Prices. Register and price the medicine there, come back, tap **Refresh from order**, and check the quantities.
6. Issue the first invoice: it gets a number (for example INV-000001), the order shows Fulfilled, and the order history shows "Invoice issued". Tap **Issue** a second time (or reload): the same number, no new one.
7. Print the issued invoice as **A4** and as **Thermal** (the browser print preview). Check: business name and details, number, date, store, product name, quantity, selling price, line total, the grand total at the bottom, and no purchase price, MRP, cost or profit anywhere.
8. Change a medicine's selling price in Products, then reprint the issued invoice: the numbers are the same.
9. Cancel the issued invoice with a reason: it shows Cancelled with its number and reason, the order is Confirmed again, and **Create invoice** is offered. Create and issue the replacement: the next number.
10. Open **Invoices**: filter by status and store, search by number; open the **To invoice** tab and compare its count with the Home card.
11. Print an order sheet: option A from an order, option B for the day with two stores (two separate sections, no prices).

## 4. Master prompt Section 17 mapping

| Item | Where it is proven |
|------|--------------------|
| 12. Invoice line totals and grand totals | PGlite `db-invoice-totals`, unit `invoice-money`, Supabase `invoices-api` (every line of every tested invoice) |
| 13. Hiding Purchase Price, MRP and internal profit from invoices | PGlite `db-invoice-nocost` (column list and json keys), e2e print text checks, Supabase `invoices-api` |
| 14. Preserving historical prices after a catalog price update | PGlite `db-invoice-create` (draft uses the snapshot), `db-invoice-immutable` (issued invoice unchanged after price, name, store and business edits) |
| 15. Preventing duplicate invoices during retries | PGlite `db-invoice-create`, `db-invoice-issue`; Supabase `invoices-concurrency` (10 simultaneous creates, issues and cancels) |
| 4. Preserving separate store-wise order records (order sheets) | PGlite `db-order-sheet` (sections never mix), e2e `order-sheets` |
| 7. Pending line blocks the invoice, not the order | PGlite `db-invoice-issue` (typed line), e2e `invoice-draft` |

## 5. What the automated checks must prove (summary of the plan's test list)

- **Create**: one live invoice per order (unique index), replay by id, existing returned for a second id, `request_reused`, only confirmed non-empty orders, foreign order looks like a missing one.
- **Prices**: draft lines use the order line snapshot, never the catalog; a catalog price change after confirm changes nothing; a typed line or a missing price is `needs_price`; a line with delivered 0 is not billed and does not block; a price of 0 is a verified price.
- **Quantities**: 0 to 100,000, version check, ordered quantity never changed, totals recomputed in SQL, "more than ordered" flag.
- **Stale**: a quantity change, an added or removed line, a link and a price fill on the order make the draft stale; issue refused with `order_changed`; refresh rebuilds.
- **Issue**: number from the counter, 50 issues give 50 different increasing numbers, 10 simultaneous issues of one draft give one number, two different drafts at the same time give two numbers, a refused issue uses no number, the snapshot (business, store, date, totals) is frozen, the delivered quantities are written back, the order is `fulfilled`, both histories get an entry, and the market list shows the same figures before and after.
- **Cancel**: reason required, order back to `confirmed`, delivered back to ordered, number and lines unchanged, a repeat keeps the first reason, the replacement gets a new number.
- **Immutability** (PGlite, trigger level): every forbidden update or delete on `invoices`, `invoice_lines` and `invoice_events` is refused; direct writes by a signed-in user are refused.
- **No cost**: no cost, price-of-purchase or MRP column in the four invoice tables; no forbidden key in any function result; no forbidden word in the print pages and order sheets.
- **Isolation**: two real users, crafted ids on every function, the same answer as for a missing record.
- **Scale**: 1,000 invoices list time, a 60-line invoice get and issue time, measured and recorded (not assumed).
- **Screens** (Playwright, 360 px): create, edit, refresh, issue, print A4 and thermal (print media and PDF text), cancel, list, filters, to-invoice tab, Home card, order screen link, order sheets A and B, touch targets, loading, error and empty states.

## 6. Results

### Baseline before any change (T001, 2026-11-14, branch 006-invoices-printing from master 4c98bf6 plus the planning commit)

- `npm run lint`: exit 0 (secrets check passed). `npm run typecheck`: exit 0.
- `npm test`: 76 files, 816 tests, all passed (duration 623 s, TEST project reachable).

### Database layer (T004 to T011, 2026-11-14, PGlite)

- `tests/integration/db-invoice-schema.pglite.test.ts`: 41 tests passed (four tables with RLS and business_id, no cost-like column, the constraints and shape rules, one live invoice per order, per-business numbers, select-only privileges, the guard triggers, the three Module 003 changes). Honest note: the migration file was already in place when this suite was first run, so the "tests fail first" step was not observed; the first run failed only because of a seeding helper bug (duplicate medicine names), not because of the migration.
- All PGlite suites after migration 0007: 29 files, 408 tests passed (the older order, pending and market suites are unchanged and green). Unit suites: 23 files, 304 tests passed (includes the new invoice status and validation tests). `npm run typecheck` and `npm run lint`: exit 0.

### Module 006 code written before the TEST migration (2026-11-14, nothing run against Supabase yet)

- PGlite database tests for create, quantities, stale and refresh, discard, totals, issue, immutability, market list unchanged, cancel, no cost, list and to-invoice, order sheets and isolation: all PGlite suites together, 41 files and 497 tests passed (the older suites are unchanged and green). Unit suites: 23 files, 304 tests passed. `npm run typecheck` and `npm run lint`: exit 0.
- Not yet run: the Supabase integration tests (T021, T030, T043, T048, T056, T057), the Playwright tests (T022, T031, T037, T040, T042, T048, T053, T058) and the build. They need migration 0007 on the TEST project (T015, owner step).
- Finding from the market-list test: a typed line with delivered 0 on an invoiced order stays on the market list and cannot be registered while the order is fulfilled (the known limitation of the spec; the test documents it and checks that cancelling the invoice makes registering work).
- Change outside the module folders: the Orders list can now be filtered by Fulfilled (the API accepted only draft, confirmed and cancelled), and the unit test that expected "fulfilled" to be refused was updated.

### Supabase integration and scale (TEST project, 2026-11-14, after migration 0007 was applied)

- `invoices-api`: 10 tests passed (create, replay and existing, the documented refusals, quantities with a stale version, stale and refresh, discard, issue with the order fulfilled and the delivered quantities written back, blockers, cancel and replacement, list and search and the to-invoice count equal to its list, order sheets; every response scanned for forbidden keys and cost values, every returned line and grand total re-added).
- `invoices-concurrency`: 7 tests passed against the real project (10 simultaneous identical creates give one draft; 10 creates with different ids for one order give one live invoice; 10 simultaneous issues give one number and nine replays; two different drafts issued at once get two numbers; 10 different drafts issued at once get the numbers 1 to 10 with no gap and no duplicate; refused issues use no number; 10 simultaneous cancels give one cancellation with the first reason).
- `rls-invoices`: 6 tests passed with two real users (reads and every write by business B answer exactly like a missing id and change nothing of A; the same invoice id in two businesses stays separate and each business counts from 1; direct table writes and the counter are refused; the internal helpers return nothing for another business and the write helpers cannot be called; a signed-out visitor can call nothing).
- `invoices-scale` (1,000 invoices over 50 stores, 200 more confirmed orders to invoice, five runs each, times include the network round trip, maximum in ms; the goals were 3,000 for lists, 2,000 for create and issue): first page of 1,000 invoices 741; status filter 502; one store 213; by number 600; by store name 572; last page 458; to-invoice list 235; summary 247; create a draft with 20 lines 316; issue an invoice with 60 lines 488; read it back 407. A first run before a seeding fix showed one list page at 2,209 ms and others near 1,300 ms (network jitter on the hosted project); the final run is above. No performance migration (0008) was needed.
- Two mistakes in the first runs of these tests were test seeding errors, not product bugs (a seeded invoice number clashing with the counter, and orders without lines that correctly do not appear in the to-invoice list); both were fixed in the tests.

### Browser tests on the mobile project (360 px, production build against the TEST project, 2026-11-14)

Specs: `invoice-draft` (9 tests), `invoice-issue` (5), `invoice-print` (7), `invoice-cancel` (3), `invoices-list` (6), `invoices-home` (2), `order-sheets` (3), `invoice-layout` (3, touch targets and layout), `invoice-states` (2). All of them passed at least once; they were run in several batches while fixing mistakes in the tests themselves, not in the app: a strict-mode locator, a missing wait after a filter click (a stale list was read), print media set after the page opened (the text was read without line breaks the first time), a store label locator, a heading that matched two texts, a test timeout of 60 s for the longest print test (raised to 150 s), and a wrong expected invoice count in the layout test. No app code was changed because of these runs. A full run of everything together is recorded under the full verification below.

- Print is checked under print-media emulation and with a generated PDF that is only checked to be a real, non-empty PDF (no PDF text reader is installed). Checked: business name, phone and address from Settings, number, date, store, lines, grand total, the draft and CANCELLED marks, a line with delivered 0 not printed, the thermal page width equal to the Settings value (80 mm gives about 280 CSS pixels, 58 mm gives under 215) with no sideways overflow, a 60-line invoice keeps every line and the grand total in both layouts, a very long product name wraps, a reprint after a catalog price change and a rename is identical, no purchase, MRP, cost, margin or profit word in any print or order sheet, and at most 5 taps from the confirmed order to the printed A4 invoice (SC-001).
- **No real printer was used.** A real 80 mm thermal printer is not tested.

### Sweeps (T059 and T060, 2026-11-14)

- Searched the invoice code (`src/lib/invoices`, `src/components/invoices`, `src/app/api/invoices`, the invoice and order sheet pages) for purchase price, MRP, cost, margin and profit: the only hits are comments that state the rule, and the CSS `margin: 3mm` of the thermal page. None of these fields is read, selected or rendered.
- No use of `localStorage`, `sessionStorage` or `indexedDB` for invoice data (the optional remembered print layout was not built), no `any`, no `ts-ignore`, no lint suppression, no "synced" or "saved on this device" wording, no key or secret in browser code (the lint secrets check passes), no control that edits or deletes an issued invoice (a browser test asserts this), no money arithmetic in the browser (the draft shows the totals the server calculated; only quantities are parsed), no invented price or number, and no claim of server-side PDF or of a real printer.
- Quantities (Principle II): the invoice stores the ordered and the delivered quantity as separate columns; the market list still reads the ordered quantity only; Module 006 changes an order line delivered quantity only inside `invoice_issue` (written from the invoice) and `invoice_cancel` (reset to the ordered quantity). The default delivered = ordered is still set by the Module 003 functions when an order is confirmed or a confirmed line is edited, as before.

### Full verification run (T062, 2026-11-14 and 2026-11-15, TEST project)

- `npm run lint` exit 0 (secrets check passed). `npm run typecheck` exit 0.
- `npm test`: 95 files, 1,007 tests: 1,006 passed and 1 failed. The failure was `setup-api` (a Module 002 test), which timed out because the PC was suspended during the run (the run reports 3.2 hours); it passed when run alone straight afterwards (7 tests passed). The Module 006 suites inside this run passed: PGlite database tests, Supabase `invoices-api`, `invoices-concurrency`, `rls-invoices` and `invoices-scale`, and the unit tests.
- `npm run test:e2e` (mobile and desktop): a first attempt was interrupted when the session ended (226 results, 2 failures that looked like slowness under load: the `invoices-list` filter test, which passed in the batches above, and the older Module 003 spec `orders-typed`). It was run again from the start: **359 passed, 156 skipped, 1 failed** in 35.7 minutes. The skips are by design (the Module 005 and 006 specs run on the mobile project only, plus the older mobile-only specs). The one failure was the older Module 001 spec `shell` on the desktop project (the heading "Add medicine" was not found within 10 seconds); run alone it passed (6 tests). In this second run `invoices-list` and `orders-typed` passed.
- `npm run build`: exit 0, and it was run again after the e2e run so `.next` matches the DEV environment.
- Honest summary: no test failed twice, but three tests (`setup-api`, `shell` on desktop and, in the interrupted run, `orders-typed`) failed once under load or after a PC suspension and passed when run again. The cause is not proven; it is recorded as an inference (timing under load), the same as for the two older specs in Module 005.
- Master prompt Section 17 mapping (applicable items): 4 (separate store records: order sheets, `db-order-sheet`, `order-sheets`), 7 (a pending line blocks the invoice, not the order: `db-invoice-issue`, `invoice-draft`), 12 (invoice line and grand totals: `db-invoice-totals`, `invoices-api`), 13 (no purchase price, MRP or profit on invoices: `db-invoice-nocost`, `invoice-print`, `invoices-api`), 14 (historical prices after a catalog update: `db-invoice-create`, `db-invoice-immutable`, `invoice-print`), 15 (no duplicate invoices on retry: `db-invoice-issue`, `invoices-concurrency`).
- Not covered: a real printer (A4 or 80 mm thermal), the owner phone check, the DEV project, and the items of later modules (the Account Summary, payments, voice, offline).

### Owner phone walkthrough (T064, 2026-11-16, DEV project, production build served to the phone on the local network)

The owner followed the steps of section 3 on a phone against the DEV project (migration 0007 applied first, section 8). Evidence level: **reported, not seen**, except where a screenshot is named.

| Step | Owner report | Evidence |
|------|--------------|----------|
| 1 to 3 (settings, draft from a confirmed order, change a delivered quantity) | Done; the owner reported that all of these steps worked. | One screenshot seen at step 3: ordered 1, delivered 2, the line shows "More than ordered", grand total PKR 280.00 (the ordered quantity stayed 1). |
| 4 (Create invoice again, refresh) | "Tap Create invoice again and refresh the page: still only one draft." (translated from Roman Urdu) | Reported, not seen |
| 5 (typed medicine blocks, register and price it, refresh the draft) | Done and confirmed. While doing it the owner asked why the selling price is not compulsory on the registration form. Answer given: by design (Module 004) only name and unit are required so that taking an order is never blocked; the invoice is what refuses to issue without a verified selling price, and the price is set on the registration form or on the Pending Prices screen. | Reported, not seen |
| 6 to 11 (issue and the same number on a second tap, A4 and thermal print, reprint after a price change, cancel and replacement, Invoices list and To invoice, order sheets A and B) | "All steps have been done and confirmed." (translated from Roman Urdu) | Reported, not seen |

Not reported by the owner, so **not recorded as met**: the number of taps from the order screen to a printed A4 invoice (SC-001, goal 5), the time to cancel a wrong invoice and issue the replacement (SC-013, goal 2 minutes), and any result from a real A4 or 80 mm thermal printer. The thermal and A4 layouts are therefore verified only by print-media emulation and generated PDF text (see the sweeps above); a real printer is **not tested**.

Finding from the walkthrough (not a defect): the registration form reached from an invoice draft does not say that a selling price is needed for the invoice. A hint on that form is a possible small improvement; the price stays optional on the form. Not implemented.

The phone server (port 3000) was stopped afterwards.

## 7. Migration 0007 on the TEST project (T015, 2026-11-14)

Applied at the owner request, through the owner signed-in Supabase tab (project `medicine-supply-test`, SQL Editor, the whole file as one run; the generic "destructive operations" warning was confirmed for this migration only). Result: "Success. No rows returned."

| Check | Before | After |
|-------|--------|-------|
| medicines / stores / orders / order lines / order events / purchase entries | 28 / 7 / 6 / 11 / 7 / 1 | 28 / 7 / 6 / 11 / 7 / 1 (identical) |
| sum of `delivered_quantity` and an md5 of every order line id with its delivered quantity | 66, `d2e79db8...66c4d` | 66, `d2e79db8...66c4d` (identical) |
| invoice tables | 0 | 4 (`invoices`, `invoice_lines`, `invoice_events`, `invoice_counters`), Row Level Security on for all 4 |
| triggers on the three invoice tables | none | 5 |
| public functions of the module (writes, reads, helpers, order sheets) | none | 16, all executable by signed-in users, none by anon |
| internal write helpers (`invoice_build_lines`, `invoice_recompute_total`) | none | not executable by signed-in users or anon |
| table privileges | none | signed-in users: select on `invoices`, no insert, no access to `invoice_counters`; anon: no select |
| order line delivered quantity check | `>= 1` | `>= 0` |
| order event kinds | 6 | 8 (adds `invoiced` and `invoice_cancelled`) |

These are catalog checks and counts only; no invoice was created on the TEST project by this step.

## 8. Migration 0007 on the DEV project (T063, 2026-11-16)

Applied at the owner request ("Migration 0007 DEV par lagao", translated from Roman Urdu: apply migration 0007 to DEV), through the owner signed-in Supabase tab (project `medicine-supply-dev`, SQL Editor, the whole file as one run; the generic "destructive operations" warning was confirmed for this migration only). Result: "Success. No rows returned."

| Check | Before | After |
|-------|--------|-------|
| medicines / stores / orders / order lines / order events / purchase entries | 159 / 5 / 21 / 38 / 48 / 10 | 159 / 5 / 21 / 38 / 48 / 10 (identical) |
| sum of `delivered_quantity` and an md5 of every order line id with its delivered quantity | 140, `fc56efb2...a22c` | 140, `fc56efb2...a22c` (identical) |
| invoice tables | 0 | 4, Row Level Security on for all 4 |
| triggers on the three invoice tables | none | 5 |
| public functions of the module | none | 16, all executable by signed-in users, none by anon |
| internal write helpers | none | not executable by signed-in users or anon |
| table privileges | none | signed-in users: select on `invoices`, no insert, no access to `invoice_counters`; anon: no select |
| order line delivered quantity check | `>= 1` | `>= 0` |
| order event kinds | 6 | 8 |

These are catalog checks and counts only; no invoice was created on the DEV project by this step. The owner phone walkthrough (T064) is the next step; the production build in this folder was made against the DEV environment after the last e2e run.

