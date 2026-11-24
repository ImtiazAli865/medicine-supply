# Feature Specification: Reports and Profit

**Feature Branch**: `010-reports-profit`  
**Created**: 2026-11-24  
**Status**: Draft  
**Input**: User description: "Module 010 Reports and profit for the Medicine Supply & Order Management app (builds on Modules 001 to 009, all merged into master). Internal, read-only business reports for the owner (the supplier): sales summary, purchase summary, estimated gross profit, realized gross profit, store-wise sales, product-wise sales and outstanding balances by store, by day, week and month, with honest Estimate/Incomplete labels, a visible cost-missing list, a CSV export, and no report content on any customer-facing document, the offline device copy or the backup file. Follows docs/master-prompt.txt Section 12 and Section 13, docs/negative-prompt.txt and the constitution." (the full request text is kept in the Prompt History Record of this stage)

## Overview

The supplier already takes orders (Module 003), buys at the market (Module 005), issues invoices (Module 006) and keeps each store's account (Module 007). This module adds one new place, **Reports**, where the owner can see how the business is doing: what was sold, what was bought, what was earned, which stores and medicines matter most, and who still owes money.

Reports are **internal and read-only**. They never change an order, an invoice, a purchase, a price or the ledger, and nothing from them ever appears on a customer-facing document.

Words used in this specification:

- **Sales** (revenue) = the grand totals of **issued, not cancelled invoices**, taken from each invoice's own frozen lines. Drafts and cancelled invoices never count.
- **Sales date** = the invoice's issue date, in Pakistan Standard Time (the same business date the rest of the app uses).
- **Billed quantity** = the delivered quantity written on the invoice line. Ordered or requested quantity is never used as a sold quantity.
- **Actual cost** = the actual unit cost the supplier typed on a purchase entry (Module 005) that is not cancelled. A purchase entry without an actual unit cost has **no known cost**.
- **Cost missing** = a sold medicine line for which no cost can be worked out.
- **Estimate** = a figure that uses the purchase price saved on the order line when the order was confirmed (a planning price, not a proven cost; the medicine's current purchase price is never used, so an old report does not change when the price is edited later).
- **Realized** = a figure that uses only actual costs from recorded purchases.
- **Incomplete** = a figure where some lines have no cost, so the figure covers only part of the sales and says so.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See sales and profit for a period, honestly (Priority: P1)

The owner opens Reports, picks a period (today, this week, this month, or a start and end date) and sees one summary: total sales, number of invoices, the cost of what was sold, the **estimated** gross profit and the **realized** gross profit, each clearly labelled. Below the summary, sales are listed by day, by week or by month (the owner switches the grouping). When some sold lines have no known cost, the screen says exactly how many lines and how much of the sales have no cost, marks the profit figure as Incomplete or Estimate, and offers a "Cost missing" list of the medicines concerned, each with a link to the place where the cost can be fixed.

**Why this priority**: This is the core question of the module ("did I earn money?") and the one with the biggest risk of a wrong or over-confident number. Every other report reuses its rules.

**Independent Test**: Seed a business with issued invoices (some cancelled, some drafts), purchases with and without actual costs, and a medicine with no cost at all. Open the summary for the period: sales equal the sum of the issued, not cancelled invoice totals; the cost-missing count and revenue are shown; realized profit is shown as Incomplete (not as a confident figure); the day, week and month groupings each add up to the same total.

**Acceptance Scenarios**:

1. **Given** three issued invoices, one cancelled invoice and two draft invoices in the period, **When** the owner opens the sales summary, **Then** sales are the sum of the three issued invoices only, the invoice count is 3, and the screen states that one cancelled invoice and the drafts are not counted.
2. **Given** the catalog selling price of a medicine was changed after an invoice was issued, **When** the report is opened, **Then** the revenue of that invoice is still its frozen total, never recalculated from the current catalog price.
3. **Given** every sold line has an actual cost from a recorded purchase, **When** the owner opens realized profit, **Then** realized profit = sales − cost of goods sold, shown as a complete figure with no Incomplete marker.
4. **Given** some sold lines have no known cost, **When** the owner opens realized profit, **Then** the figure is marked "Incomplete", the screen shows how many lines and how much sales amount have no cost, profit is computed only over the lines with a cost and says so, and no cost is invented for the others.
5. **Given** a medicine was sold but only a purchase price saved on the medicine exists (no purchase entry with an actual cost), **When** the owner looks at the profit figures, **Then** that line counts in the **Estimate** figure only, never in the **Realized** figure, and both figures carry their own label.
6. **Given** a period in which an invoice was issued and then cancelled, **When** the owner opens the report, **Then** the cancelled invoice is excluded from sales, cost and profit, and the report names the number of cancelled invoices that were left out.
7. **Given** the owner switches the grouping from day to week to month, **When** the totals of each grouping are added up, **Then** all three give the same grand total for the same period.
8. **Given** the "Cost missing" list is shown, **When** the owner taps a medicine in it, **Then** the owner reaches the screen where its purchase price or a purchase with an actual cost can be recorded; nothing is changed by the report itself.
9. **Given** a business with no issued invoice in the period, **When** the owner opens the report, **Then** an empty state explains that there are no issued invoices in this period and names the next step (for example "Go to orders" or "Choose another period"); it does not show zeros as if they were real results.

---

### User Story 2 - See what was purchased (Priority: P2)

The owner opens the purchase summary for a period and sees the money spent at the market: the total purchase cost, the number of purchase entries, and the totals by day, week or month. Only recorded purchase entries that are not cancelled are counted, using the **actual quantity and actual cost** recorded. A purchase entry without an actual cost is listed as "no cost recorded" and is counted in the quantity but not in the money, and the screen says how many entries are in that state. A "purchased" tick or a market-list status alone never counts as a purchase.

**Why this priority**: It answers "how much did I spend?" and is the base of realized profit, but the sales and profit summary matters more to the owner day to day.

**Independent Test**: Record purchases with costs, one without a cost, and one that is cancelled. The summary counts the costed, non-cancelled entries in money, lists the one without a cost as "no cost recorded", ignores the cancelled one (and says it was left out), and the day, week and month groupings add up to the same total.

**Acceptance Scenarios**:

1. **Given** purchase entries with actual quantity and actual unit cost, **When** the owner opens the purchase summary, **Then** each entry's cost is quantity × actual unit cost and the total is their sum.
2. **Given** a purchase entry was cancelled with a reason, **When** the report is opened, **Then** the entry is not counted, and the screen says how many cancelled entries were left out.
3. **Given** a purchase entry has a quantity but no actual unit cost, **When** the report is opened, **Then** it is shown as "no cost recorded", it adds nothing to the money total, and the total is marked Incomplete with the number of such entries.
4. **Given** a medicine is marked as fully bought on the market list without a recorded quantity, **When** the report is opened, **Then** that cannot occur (the app records only quantities) and nothing is counted from a tick alone.
5. **Given** no purchase entries in the period, **When** the report is opened, **Then** an empty state names the next step ("Open the market list").

---

### User Story 3 - See which stores and medicines sell most (Priority: P3)

The owner opens **Sales by store** and **Sales by medicine** for a period. Each store row shows its sales, number of invoices and (for the owner only) its estimated and realized profit with their labels. Each medicine row shows the medicine with its strength, dosage form, pack size and manufacturer, the billed quantity and the sales, grouped by the medicine itself (its identity), never by similar text; different strengths, forms, manufacturers and pack sizes are separate rows, and the same medicine sold in two units is two rows. Lines that were typed and never registered are shown in a separate group "Not registered" by their exact typed text, so no sales amount is lost. Rows can be sorted by sales (default), by realized profit (rows whose realized profit is not available come last, and the screen says so) or by name, and searched by name.

**Why this priority**: It is the "who and what" view that helps the owner decide where to focus, and it relies on the rules of User Story 1.

**Independent Test**: Seed two stores and several medicines that differ only by strength or pack size, plus one typed line. Each is a separate row; the rows add up to the same sales total as the summary; sorting and search work; a typed line is in "Not registered".

**Acceptance Scenarios**:

1. **Given** the same brand sold in 250 mg and 500 mg, **When** Sales by medicine is opened, **Then** they are two separate rows, never merged.
2. **Given** a typed (not registered) line on an issued invoice, **When** Sales by medicine is opened, **Then** it appears in "Not registered" with its exact typed text and its sales amount, and the total still matches the summary.
3. **Given** a store with sales but no cost known for some lines, **When** Sales by store is opened, **Then** the store's profit is labelled Incomplete or Estimate in the same way as in User Story 1.
4. **Given** the owner searches "pana", **When** the list is filtered, **Then** only matching rows remain and the totals shown say they are for the filtered rows.
5. **Given** the sum of all store rows and the sum of all medicine rows (including "Not registered"), **When** compared with the summary total of the same period, **Then** all three are equal.

---

### User Story 4 - See what each store still owes (Priority: P3)

The owner opens **Outstanding balances**: every store with its current balance, worked out from the ledger (Module 007), the stores that owe money first, the total owed (the sum of positive balances, advances not subtracted, as on Home), and the stores with an advance shown as advance. The balance is never a stored or typed number. Each store links to its account screen.

**Why this priority**: The data and screen already exist in Module 007; this report gathers them in the reports area with the same single definition so figures can never disagree with Home.

**Independent Test**: With stores that owe, stores in advance and stores at zero, the report lists them correctly, its total equals the Home figure, and recording a payment for one store changes only that store's line.

**Acceptance Scenarios**:

1. **Given** stores with debits, credits and a reversal, **When** Outstanding balances is opened, **Then** each balance equals the sum of its entries (debits minus credits, reversals included) and the total equals the Home total.
2. **Given** a store has overpaid, **When** the report is opened, **Then** it is shown as "Advance" and is not subtracted from the total owed.
3. **Given** invoices issued before Module 007 that are "Not in the account", **When** the report is opened, **Then** they are not counted in any balance, and the report says so.
4. **Given** no store has any ledger entry, **When** the report is opened, **Then** an empty state names the next step ("Add an opening balance or issue an invoice").

---

### User Story 5 - Export the report I am looking at (Priority: P4)

On every report, including Outstanding balances, the owner can tap "Export CSV" and get a file generated from the same data, period and filters that are on the screen (Outstanding balances has no period: the file is the balances as on the day of the export). The Estimate, Incomplete and "cost missing" markers are kept in the file. Values that start with a spreadsheet formula character are not turned into formulas. No PDF is offered.

**Why this priority**: Useful for the accountant and for keeping records, but the on-screen reports come first.

**Independent Test**: Export each report for a known period; the rows and totals in the file equal the screen, the markers are present, and a medicine name that starts with `=` or `+` opens as text.

**Acceptance Scenarios**:

1. **Given** a report with a period and a search filter, **When** the owner exports, **Then** the file contains exactly the rows and totals on the screen for that period and filter.
2. **Given** a figure marked Incomplete, **When** exported, **Then** the same marker and the count of lines without a cost are in the file.
3. **Given** the report fails to load, **When** the owner looks for export, **Then** Export is not offered for data that was not loaded.
4. **Given** the Outstanding balances report, **When** the owner exports, **Then** the file has one row per store with its balance and whether it owes, is in advance or is at zero, a total owed equal to the screen and to Home, and the note about invoices that are not in the account; a negative balance (advance) stays a number.

---

### Edge Cases

- A period with no issued invoices, no purchases, or no ledger entries: an honest empty state with the next step, never zeros presented as results.
- A report that fails to load or times out: an error with Retry; the last good numbers are not shown as if current, and zero is never shown as the result of a failure.
- A sale line whose medicine has both a saved purchase price and recorded purchases: Estimate uses the saved purchase price, Realized uses only recorded actual costs; the line counts in each figure under its own rules.
- A medicine sold with a billed quantity of zero: it adds nothing to sales, cost or profit.
- A selling price of zero on an issued line is a real price of zero and counts as revenue zero; a missing price cannot occur on an issued invoice (Module 006).
- A purchase dated on a different day from the order's market date (earlier or later): it is not used as the cost of that sale (see FR-012); the line stays "cost missing" for the Realized figure until a purchase with an actual cost is recorded for the order's market date.
- Several purchases of the same medicine on the same market date at different costs: the weighted average of that day is used (for example 10 at 50 and 10 at 56 give 53).
- A period that crosses a month or year boundary, or a week that starts in one month and ends in the next: the week and month groupings stay correct and add up to the same total.
- Invoices issued before the store accounts module ("Not in the account"): they are still issued invoices and count in sales; they do not count in balances.
- A cancelled invoice that was issued in one period and cancelled in a later one: it is excluded from the period of its issue date as soon as it is cancelled, and the report states the exclusions for the period shown.
- A very large history (thousands of invoices): the report stays fast and still shows exact totals; it never shows partial totals as if complete.
- Two businesses on the same server: neither can see, count or export the other's data.
- The phone is offline: Reports say "Reports need the internet", show no stale numbers as current, and every other part of the app works as before.
- Money values with two decimals only: totals are exact (no rounding drift), and a line's profit is calculated from exact values before any display rounding.
- A medicine that is later made inactive: its past sales still appear in the reports.

## Requirements *(mandatory)*

### Functional Requirements

**Reports area and access**

- **FR-001**: The system MUST provide a Reports area, reachable from the existing app (the place is chosen in the plan; the bottom navigation keeps five items), listing the reports: Sales summary, Purchase summary, Profit (estimated and realized), Sales by store, Sales by medicine, Outstanding balances, and Cost missing.
- **FR-002**: Every report except Outstanding balances MUST have a period chooser with presets (today, this week, this month, last month) and a custom start and end date, in Pakistan Standard Time; a period that ends before it starts, or lies in the future only, MUST be refused with a clear message. The default is this month.
- **FR-003**: Reports with a time series (sales, purchases, profit) MUST let the owner choose the grouping by day, week (starting Monday) or month; every grouping of the same period MUST add up to the same total.
- **FR-004**: Reports MUST be visible only to the signed-in owner of the business and MUST be read-only: no report screen or request may change an order, invoice, purchase, price, payment or ledger entry.

**Sales and the rules for counting**

- **FR-005**: Sales MUST be the sum of the grand totals of issued, not cancelled invoices whose issue date falls in the period, taken from each invoice's frozen lines (billed quantity × the invoice line's own selling price), and MUST NEVER be recalculated from the current catalog price. Draft invoices, cancelled invoices and draft or cancelled orders MUST NOT count, and the report MUST state how many cancelled invoices were left out of the period.
- **FR-006**: Quantities sold MUST be billed (delivered) quantities of issued invoice lines; ordered, requested or market-list quantities MUST NEVER be used as sold quantities.
- **FR-007**: Sales by medicine MUST group by the medicine's identity and the invoice line's unit, never by similar text; medicines that differ in strength, dosage form, manufacturer or pack size MUST be separate rows; typed (not registered) lines MUST be shown in a separate group "Not registered" by exact typed text (compared ignoring capital letters and repeated spaces), so no sales amount is lost.
- **FR-008**: The **sales** of the store rows, the **sales** of the medicine rows (with "Not registered") and the summary sales total for the same period MUST be equal (cost and profit rows are rounded one by one, see FR-013); the screen MUST show when a filter makes a total cover only part of the rows.

**Purchases**

- **FR-009**: The purchase summary MUST count only purchase entries that are not cancelled, with cost = actual quantity × actual unit cost; entries without an actual unit cost MUST be shown as "no cost recorded", MUST add nothing to the money total, MUST mark the total as Incomplete and MUST be counted and named; a purchase status or "bought" tick alone MUST never be treated as a purchase. The report MUST state how many cancelled entries were left out.

**Profit and honesty**

- **FR-010**: The system MUST show two separate profit figures, never mixed: **Estimated gross profit** (sales minus billed quantity × the purchase price saved on the order line at confirmation, a planning price) and **Realized gross profit** (sales minus the cost of goods sold, using only actual costs from recorded purchases). Each MUST carry its own label, with a short explanation of what it uses.
- **FR-011**: When any sold line has no cost for a figure, that figure MUST be marked "Incomplete", MUST state the number of such lines and the sales amount they represent, MUST compute profit only over the lines that have a cost and say so, and MUST NEVER show a confident profit for the missing part. A cost, a selling price or a margin MUST NEVER be invented, guessed from another medicine or copied from a similar name.
- **FR-012**: The actual cost of a sold line MUST be the weighted average actual unit cost (total actual cost divided by total purchased quantity) of the recorded, non-cancelled purchase entries of that same medicine that have an actual unit cost and are dated on the **market date of the sold line's order** (the business date on which the order was confirmed, the same date the market list of Module 005 uses). A purchase on any other date MUST NOT be used for that line, so a later purchase at a different cost never changes the profit of an earlier day. When there is no such purchase, the line is "cost missing" for the Realized figure; no earlier or later cost is borrowed. Example (owner's): on 23 Nov the medicine is bought at 50 and sold at 55, profit 5; on 24 Nov the same medicine is bought at 58 and sold at 65, profit 7; the 23 Nov profit stays 5.
- **FR-013**: Profit per line MUST be calculated from exact money values (PKR, two decimals) and rounded only for display, with the rounding rule stated in the Assumptions; totals MUST equal the sum of the unrounded line values rounded once, and MUST NEVER drift by repeated rounding.
- **FR-014**: A "Cost missing" list MUST show every sold medicine (in the chosen period) that has no cost for the Estimate or the Realized figure, with the sales amount concerned and which figure is affected, and a link from each row to the place where its purchase price can be saved or a purchase with an actual cost recorded; the report itself MUST NOT change any price.
- **FR-015**: A unit profit, if any Reports screen shows one (this module's screens show profit per period, store and medicine, not per unit), MUST appear only when both the selling price and the cost exist; otherwise the screen MUST say it is not available.

**Balances**

- **FR-016**: Outstanding balances MUST list every store with its balance worked out from the ledger entries of Module 007 (debits minus credits, reversals included), never from a stored or typed number, with stores that owe shown first, advances shown as advance, and a total owed equal to the sum of the positive balances (advances not subtracted) that MUST equal the total shown on Home through one shared definition.
- **FR-017**: Invoices that are "Not in the account" MUST NOT be counted in any balance, and the report MUST say so. Because payments are recorded online only, a balance MUST be shown as the server-confirmed balance; a store's payment MUST never be applied to another store.

**Internal only**

- **FR-018**: Purchase price, cost, margin and profit MUST appear only on the Reports screens and the internal product screens already defined in Module 001; they MUST NOT appear on any invoice, the Account Summary, the Store Statement, any print layout, the order screens, the market list print or export, the offline device copy or the backup file of Module 009, and a report MUST NOT add any cost, margin or profit field to those.
- **FR-019**: No Reports link, number or label MUST be printed on or embedded in any customer-facing document; print layouts of Modules 003, 005, 006 and 007 MUST stay unchanged.

**Export**

- **FR-020**: Each report MUST offer "Export CSV" generated from the same data, period and filters as the screen, including the Estimate, Incomplete and cost-missing markers and the totals; text starting with a spreadsheet formula character MUST NOT be turned into a formula; no PDF export may be offered or claimed. Export MUST NOT be offered while the report is loading, failed or empty.

**States and device**

- **FR-021**: Every report MUST have a loading state, an error state with Retry (a failed load MUST NEVER show zero as a result) and an empty state that names the next action. When the phone is offline, Reports MUST say they need the internet and MUST NOT show stored numbers as current.
- **FR-022**: Every Reports screen MUST be mobile-first and in English, work at 360 px width without sideways scrolling, with touch targets of at least 44 × 44 px; wide tables MUST become stacked cards on a phone; money amounts MUST be large, clear and shown with the PKR currency and two decimals.

**Isolation, speed and integrity**

- **FR-023**: Every read and every export MUST be limited to the signed-in business; a request that names another business's data MUST get the same answer as a missing record; the checks MUST be made by the server and database, not by the screen.
- **FR-024**: The system MUST compute totals for the whole selected period without the phone downloading every invoice, purchase or ledger row; a report for a period with 5,000 issued invoices MUST show its result within about 2 seconds on a normal connection, and a result that is too large to show in full MUST say so instead of showing partial totals as complete.
- **FR-025**: The module MUST NOT change any existing record, rule or screen of Modules 001 to 009 other than adding the entry point to Reports; it MUST NOT add a package, a new place to store data on the device, or any use of a secret or service key in the browser.

### Key Entities *(include if feature involves data)*

- **Report period**: A start date and end date in Pakistan Standard Time plus a grouping (day, week, month). It is a screen setting, not stored data.
- **Sales line (reporting view)**: One billed line of one issued, not cancelled invoice: invoice date, store, the medicine's identity (or typed text), unit, billed quantity, the invoice line's selling price and line total. Read from the frozen invoice; never edited.
- **Cost source**: For one sold line, the cost used by a figure: the order line's saved purchase price (Estimate), or the actual unit cost worked out from recorded purchase entries (Realized), or none (cost missing).
- **Purchase entry**: As defined in Module 005 (append-only, actual quantity, optional actual unit cost, cancelled or not).
- **Profit figure**: A number with a label (Estimate or Realized), the sales it covers, the sales it does not cover (lines without a cost) and the count of those lines.
- **Cost-missing item**: A sold medicine and period with the sales amount that has no cost for a figure, and the link to fix it.
- **Store balance**: A store's balance worked out from its ledger entries (Module 007), shown as owes, advance or zero.
- **Report export**: A generated CSV file; not stored.

## Assumptions

- The only user is the signed-in owner (no roles or permissions in this module); "behind the signed-in owner" means no store, customer or signed-out visitor can see any report.
- Sales date = invoice issue date in Pakistan Standard Time; purchase date = the date on the purchase entry; weeks start on Monday; the default period is "this month".
- Estimated profit uses the purchase price saved on the **order line at confirmation** (Module 003 snapshot), so it matches what the owner believed at the time; if that snapshot is empty the line is "cost missing" for the Estimate. The current purchase price of the medicine is used only for the "Cost missing" fix link and for no figure.
- Stock levels are not tracked in this app, so realized cost uses the same-market-day rule of FR-012 (chosen by the owner on 2026-11-24 with the example 23 Nov bought 50 / sold 55 and 24 Nov bought 58 / sold 65) rather than matching individual stock lots; the report says so in a short note. If the owner later wants an earlier purchase to be used when the market day has none, that is a separate decision and is not part of this module.
- The order's market date is the business date the order was confirmed, in Pakistan Standard Time, as already used by the market list.
- Rounding: amounts are PKR with two decimals; each line is exact before rounding; displayed totals are the exact sum rounded to two decimals half away from zero, once. Cost and profit rows are each rounded once as well, so a set of cost or profit rows may differ from its total by a paisa or two (the screen says so); sales are sums of two-decimal amounts and always add up exactly.
- Payments are online only (offline payments were deferred in Module 009), so every balance in Reports is server-confirmed and no "pending sync" balance occurs; if offline payments are added later, this report shows the same "pending sync" wording as the Store account screen.
- A cancelled invoice is simply excluded; cancelled-invoice reversals appear only in the ledger-based balance report, as Module 007 defines.
- No new package is added; charts, if any, are simple bars drawn without a library, and every chart value is also given as text.
- Whether a read-only database function or view is needed, and its migration number (0011 or higher, because 0009 and 0010 of the dropped voice work are already applied to the TEST and DEV projects), is decided in the plan.

## Out of Scope

Changing invoices, prices, purchases, payments or the ledger; new payment or invoice features; tax or accounting exports; multi-user roles or permissions; charts that need a new package; forecasting; AI or voice; offline reports; automatic emails or scheduled reports; any customer-facing report; stock tracking or stock-lot costing; PDF export of reports.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every tested period, sales shown equal the sum of the issued, not cancelled invoice totals exactly (to the paisa), and the day, week and month groupings, the store rows and the medicine rows (with "Not registered") all give the same sales total.
- **SC-002**: In tests with at least one sold line without a cost, 100% of profit figures that include it are marked Estimate or Incomplete with the number of lines and sales amount missing; no test shows a confident profit for a line with an unknown cost.
- **SC-003**: Realized profit never uses an ordered or requested quantity, a purchase tick, a cancelled purchase, a cancelled invoice, a draft, or a purchase dated on any day other than the order's market date (verified by tests for each, including the 50/55 and 58/65 example giving profits of 5 and 7).
- **SC-004**: With two businesses holding different data, a signed-in owner of one never sees, counts or exports any figure of the other (tested for every report and export).
- **SC-005**: A report for a period with 5,000 issued invoices shows its result in about 2 seconds or less on a normal connection, and totals are exact, not sampled.
- **SC-006**: A search through every invoice print, the Account Summary, the Store Statement, the order screens, the market-list print and export, the offline device copy and the backup file finds no purchase price, cost, margin or profit that was not already allowed before this module (verified by automated tests).
- **SC-007**: Every report shows a loading state, an error state with Retry and an empty state with a next action; a forced failure never shows zero as a result.
- **SC-008**: Every Reports screen has no sideways scroll at 360 px width and all touch targets are at least 44 × 44 px (verified by the existing touch-target check).
- **SC-009**: Each CSV export equals its screen (same rows, totals and markers) for the same period and filters, and a text starting with `=`, `+`, `-` or `@` opens as text in a spreadsheet.
- **SC-010**: Outstanding balances equal the sum of each store's ledger entries and the total equals the Home figure in 100% of tested cases, including advances, reversals and stores with no entries.
- **SC-011**: The owner can answer "how much did I sell and what profit can I trust this month?" from the first Reports screen in under 30 seconds (the owner's trial result is recorded as reported, not seen).
