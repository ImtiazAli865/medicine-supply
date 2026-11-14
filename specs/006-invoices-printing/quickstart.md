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

Empty on purpose until real runs exist.
