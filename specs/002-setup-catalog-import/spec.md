# Feature Specification: Setup Checklist, Business Settings, and Catalog Import

**Feature Branch**: `002-setup-catalog-import`  
**Created**: 2026-11-06  
**Status**: Draft  
**Input**: User description: "Module 002 Setup and catalog import (builds on Module 001: login, products, stores). (1) A short, skippable first-time setup checklist on the home screen with three optional items: business details and invoice settings; add stores; optional catalog import. It shows done/not-done, can be dismissed, and reappears from Settings. (2) Business settings screen: business name, contact details (phone, address), thermal receipt paper width in mm (default 80), and the default for printing the optional Account Summary on invoices (default off). (3) Optional catalog import from CSV or Excel (.xlsx): download a template, choose a file, see a PREVIEW before anything is saved with every row classified (new, exact duplicate, similar, duplicate inside the file, conflicting code, invalid with reason), choose what to do with problem rows, confirm; the confirmed import is all-or-nothing and safe to retry; a summary shows created and skipped counts and reasons. Never invent values. Large files (5,000 rows) must work; a bad file gives a clear error. Out of scope: orders, invoices, ledger, voice, offline sync, reports, multi-user roles, importing stores or balances."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import a medicine list from a file, with a preview (Priority: P1)

The supplier has a medicine list in a spreadsheet. They download the template, fill it (or reshape their own list to match it), choose the file, and the app shows a preview of what will happen to every row before anything is saved. They decide what to do with problem rows, confirm, and see a summary.

**Why this priority**: This is the main value of the module: getting hundreds of medicines into the catalog correctly in minutes instead of typing them one by one, without creating duplicates or inventing data.

**Independent Test**: With an empty catalog, import a small valid file and confirm that every row appears as a medicine exactly as written. Then import a file containing every problem type and confirm the preview classification and the final result agree.

**Acceptance Scenarios**:

1. **Given** the Import screen, **When** the supplier chooses "Download template", **Then** they receive a file with the exact column headings (name, unit, brand, generic name, strength, dosage form, manufacturer, pack size, SKU, purchase price, selling price, MRP) as its first row, and an example row clearly marked as an example that is not imported. The Import screen states that name and unit are required, and the Excel template also carries this in a separate "Instructions" sheet (the headings themselves are never changed, because headings must match exactly).
2. **Given** a valid file of 5 medicines, **When** the supplier chooses it, **Then** a preview lists all 5 rows as "New" and nothing is saved yet; leaving the screen without confirming leaves the catalog unchanged.
3. **Given** the preview, **When** the supplier confirms, **Then** all "New" rows become active medicines with exactly the values from the file, empty cells stay empty (no default price, strength, pack size, or manufacturer), and a summary states how many were created and how many were skipped and why.
4. **Given** a row identical (name, strength, dosage form, pack size, manufacturer, ignoring case and spacing) to an existing medicine, **When** previewed, **Then** it is marked "Already exists" with the existing medicine named, it is skipped on import, and it is never created or merged.
5. **Given** a row with the same name as an existing medicine but a different strength, dosage form, pack size, or manufacturer, **When** previewed, **Then** it is marked "Similar to an existing medicine" with the existing one shown; by default it is skipped, and the supplier may choose per row (or for all similar rows at once) to create it as a separate product.
6. **Given** two rows in the file that are identical in name, strength, dosage form, pack size, and manufacturer, **When** previewed, **Then** the first is "New" and the later ones are marked "Duplicate inside the file" and skipped.
7. **Given** a row whose SKU is already used by an existing medicine or by an earlier row in the file, **When** previewed, **Then** it is marked "SKU already used" naming where, and it is skipped; it is never created.
8. **Given** a row with a missing name or unit, a negative or non-numeric price, a price with more than two decimals, or text longer than the allowed limit, **When** previewed, **Then** it is marked "Invalid" with the specific reason and the cell or column concerned, and it is skipped.
9. **Given** a preview with problem rows, **When** the supplier confirms, **Then** the supplier first sees a final count of how many will be created, skipped, and created-as-separate, and the import applies exactly those counts.
10. **Given** the medicine list in the catalog changed between preview and confirm (for example, another tab added one of the file's medicines), **When** the supplier confirms, **Then** nothing is imported and the supplier is shown a refreshed preview to review; the import never applies a classification different from the one the supplier approved.
11. **Given** a confirmed import, **When** a failure happens part-way (network loss, server error), **Then** none of the file's rows are saved, a clear message says so, and the same file can be imported again safely.
12. **Given** the supplier presses Confirm twice, refreshes, or retries after a lost connection, **When** the import was already applied, **Then** no duplicate medicines are created and the summary of the original import is shown. After a confirmed import the summary has its own address, so refreshing the page shows the same summary; if the page is refreshed while a confirm is still in flight, the screen checks whether that import was applied and shows its summary instead of asking again.
13. **Given** a file of 5,000 rows, **When** previewed and confirmed, **Then** both steps complete within the time limits in the success criteria, with a visible progress indicator.

---

### User Story 2 - Business settings (Priority: P1)

The supplier opens Settings to set the business name, phone and address, the thermal receipt paper width, and whether the optional Account Summary is printed on invoices by default.

**Why this priority**: Business details and print settings are needed by every later module (invoices, statements, market list). The checklist and import both depend on a place for settings.

**Independent Test**: Open Settings, change each field, save, reload the app, and confirm the saved values appear; try invalid values and confirm they are refused.

**Acceptance Scenarios**:

1. **Given** a new business, **When** Settings is opened, **Then** it shows the business name from setup, empty phone and address, thermal paper width 80 mm, and the Account Summary default set to off.
2. **Given** the Settings form, **When** the supplier changes the name, phone, or address and saves, **Then** the values are stored and shown after reload and on every screen that displays the business name.
3. **Given** the paper width field, **When** the supplier enters a number from 40 to 120 (millimetres), **Then** it is saved; a value outside that range, a decimal, or non-numeric text is refused with a message.
4. **Given** the Account Summary default, **When** the supplier turns it on or off and saves, **Then** the choice is stored as the default for later invoice printing.
5. **Given** an empty business name, or text over the length limits, **When** saving, **Then** the save is refused with a field message and the previous settings are unchanged.
6. **Given** settings opened in two tabs, **When** the second tab saves after the first, **Then** the supplier is told the settings changed elsewhere and must review, instead of the older values silently overwriting the newer ones.
7. **Given** the save fails (network or server error), **When** saving, **Then** an error is shown, the typed values stay on screen, and no success message appears.

---

### User Story 3 - First-time setup checklist (Priority: P2)

On the home screen, a short checklist invites the supplier to finish setup: save business details and invoice settings, add stores, and optionally import a medicine list. Every item is optional; the app is fully usable without completing any.

**Why this priority**: It guides a first-time user without ever blocking them (the product rule is that nothing must be required before taking an order). It is a convenience on top of stories 1 and 2.

**Independent Test**: With a brand-new business, the checklist shows three not-done items; every other screen still works; completing each item marks it done; dismissing hides it; Settings brings it back.

**Acceptance Scenarios**:

1. **Given** a business that has not completed setup, **When** the home screen opens, **Then** a checklist shows exactly three items, each with a done or not-done mark and a button that goes to the right screen (Settings, add store, Import).
2. **Given** the checklist, **When** business details and invoice settings have been saved at least once, **Then** that item shows done.
3. **Given** the checklist, **When** at least one store exists, **Then** the "add stores" item shows done; the item also says stores can be added later while taking the first order.
4. **Given** the checklist, **When** the catalog contains at least one medicine, however it was added, **Then** the "import catalog" item shows done; its wording makes clear it is optional.
5. **Given** any state of the checklist, **When** the supplier uses Products, Stores, or any other screen, **Then** nothing is blocked or hidden because setup items are not done.
6. **Given** the checklist, **When** the supplier dismisses it, **Then** it disappears from the home screen, stays dismissed on reload and on other devices signed in to the same business, and can be shown again from Settings.
7. **Given** all three items are done, **When** the home screen opens, **Then** the checklist shows a short "Setup complete" message and can be dismissed.

---

### User Story 4 - Business data isolation for settings and imports (Priority: P1)

Each business sees and changes only its own settings, checklist state, and import records, and imported medicines go only into the importing business's catalog.

**Why this priority**: Constitution Principle V makes isolation non-negotiable, and imports write many records at once, so a mistake would be costly.

**Independent Test**: With two businesses, confirm neither can read or change the other's settings, import records, or catalog through any route, and that an import by one never touches the other's catalog.

**Acceptance Scenarios**:

1. **Given** Business A and Business B, **When** A is signed in, **Then** A sees only A's settings, checklist state, and import records.
2. **Given** A knows an identifier belonging to B (a settings record or import record), **When** A tries to read or change it directly, **Then** the request is refused or returns nothing and B's data is unchanged.
3. **Given** a signed-out visitor, **When** they request settings or import data by any route, **Then** nothing is returned.
4. **Given** A imports a file that contains medicines B also has, **When** the import runs, **Then** duplicate checks use only A's catalog and B's catalog is not read, changed, or revealed.

---

### Edge Cases

- A file with only the header row, an empty file, or a file with only blank lines: a clear "no medicines found in this file" message, nothing to confirm.
- A file with the wrong type (for example PDF, image, or a spreadsheet with macros), a damaged file, or a password-protected Excel file: a clear message naming what is wrong, and no change to the catalog.
- A file missing the required `name` or `unit` column, containing a column heading that is not in the template, or repeating a column heading: the file is rejected with a message listing the exact headings found and expected. No column is silently ignored, because ignoring a column could drop data the supplier thinks was imported.
- More rows than the allowed maximum, or a file larger than the allowed size: rejected with the limits stated. A file within those limits whose text content is still too large to send in one request (over 4 MB once read, for example 10,000 very wide rows) is refused with a message asking the supplier to split it into two files; nothing is sent or saved.
- Column headings written in different capitalisation or with extra spaces are accepted; the order of columns does not matter.
- Urdu, Arabic-script, or mixed-script text, and text with accents or quotation marks, is read, shown, and saved correctly (text files are expected in UTF-8, with or without a byte-order mark; another encoding gives a clear message).
- Text values with leading or trailing spaces or repeated spaces are cleaned the same way as when a medicine is added by hand.
- Blank rows between data and a trailing run of blank rows are ignored; a row that has some cells filled but a missing name or unit is Invalid.
- In an Excel file, only the first sheet is read, and the supplier is told which sheet was used; formulas use their displayed value.
- A price written with thousands separators, a currency symbol, or letters (for example "PKR 1,250") is Invalid with a message explaining the accepted form (digits with an optional decimal point); a price with more than two decimals is Invalid, never rounded.
- A selling price lower than the purchase price, or an MRP lower than the selling price, is shown as a non-blocking warning in the preview, the same as when a medicine is added by hand.
- Two people or two tabs importing at the same moment: each import is checked at confirm time; whichever confirms second is re-previewed if the catalog changed.
- The supplier leaves the screen mid-preview: nothing is saved and the file is not kept.
- Settings or checklist state missing for a business (for example created before this module): defaults apply and are shown.

## Requirements *(mandatory)*

### Functional Requirements

**Settings**

- **FR-001**: The system MUST provide a Settings screen where the owner can view and edit the business name, phone, address, thermal receipt paper width (millimetres), and the default for printing the optional Account Summary.
- **FR-002**: Settings MUST belong to exactly one business, be created with defaults for every business (name from setup, empty phone and address, paper width 80, Account Summary default off), and be editable only by that business's owner.
- **FR-003**: The system MUST validate settings on the server: name required (up to 200 characters), phone up to 50, address up to 500, paper width a whole number from 40 to 120, and MUST refuse invalid values with field messages without changing stored settings.
- **FR-004**: Saving settings MUST refuse to overwrite a newer change made elsewhere and MUST tell the user, the same way edits to medicines and stores do.
- **FR-005**: The business name shown on screens MUST reflect the saved setting.
- **FR-006**: The paper width and Account Summary default MUST be stored so that later modules can read them; this module does not print anything.

**Setup checklist**

- **FR-007**: The home screen MUST show a setup checklist with exactly three items: business details and invoice settings; add stores; import a medicine list. Each item MUST show done or not done and link to the relevant screen.
- **FR-008**: Item states MUST be derived from real data: business details done once settings have been saved at least once; stores done when at least one store exists; import done when the catalog has at least one medicine.
- **FR-009**: No screen or action in the app MUST be blocked, hidden, or degraded because a checklist item is not done.
- **FR-010**: The checklist MUST be dismissible; the dismissed state MUST be stored per business so it persists across reloads and devices, and Settings MUST offer a way to show the checklist again.
- **FR-011**: When all three items are done the checklist MUST show a short completion message and remain dismissible.

**Catalog import: file handling**

- **FR-012**: The system MUST accept CSV and Excel (.xlsx) files for import and MUST refuse other file types, files with macros, damaged files, and password-protected files with a clear message.
- **FR-013**: The system MUST provide a downloadable template in both formats whose first row has exactly the column headings (name, unit, brand, generic name, strength, dosage form, manufacturer, pack size, SKU, purchase price, selling price, MRP) and which has an example row that is clearly an example and is never imported. Name and unit MUST be stated as required on the Import screen and in the Excel template's "Instructions" sheet (only the first sheet is ever read); the headings themselves MUST NOT be altered to carry the marking.
- **FR-014**: The system MUST require the `name` and `unit` columns, MUST match headings ignoring capitalisation and extra spaces, MUST accept columns in any order, and MUST reject a file that has a missing required column, an unrecognised column, or a repeated column, listing the headings found and expected.
- **FR-015**: The system MUST enforce a maximum of 10,000 data rows and a maximum file size of 5 MB per import, and MUST state these limits when a file exceeds them. Because only text cells are sent to the server, the content of one import request is also limited to 4 MB; a file that passes the first two limits but exceeds this MUST be refused with a clear "split the file" message before anything is sent.
- **FR-016**: The system MUST read text files as UTF-8 (with or without a byte-order mark), read only the first sheet of an Excel file and say which sheet was used, ignore completely blank rows, and report any other file-level problem with a clear message and no change to the catalog.

**Catalog import: preview and classification**

- **FR-017**: Before anything is saved, the system MUST show a preview in which every non-blank row is given exactly one status: New; Already exists (exact duplicate of an existing medicine); Similar to an existing medicine; Duplicate inside the file; SKU already used; or Invalid with the specific reason.
- **FR-018**: "Already exists" MUST use the same identity rule as adding a medicine by hand: name, strength, dosage form, pack size, and manufacturer equal ignoring case and spacing; the unit is not part of the identity; inactive medicines count as existing.
- **FR-019**: "Similar to an existing medicine" MUST apply when a row's name matches an existing medicine (ignoring case and spacing) but at least one of strength, dosage form, pack size, or manufacturer differs. Rows are compared to the existing catalog for this status; rows with the same name but different details inside the same file are each New (the file is the supplier's explicit intent).
- **FR-020**: "Duplicate inside the file" MUST apply to every row after the first that has the same identity as an earlier row; "SKU already used" MUST apply to a row whose SKU matches (ignoring case and spacing) an existing medicine's SKU or an earlier row's SKU.
- **FR-021**: "Invalid" MUST cover: missing name or unit; a price that is negative, non-numeric, has a thousands separator, currency symbol, or letters, or has more than two decimals; text over the length limits for any column. Each invalid row MUST show which cell is wrong and why.
- **FR-022**: The preview MUST show counts per status, allow filtering the list by status, show the row number from the file for every row, show the existing medicine a row conflicts with, and show non-blocking price warnings (selling below purchase, MRP below selling).
- **FR-023**: The preview MUST remain usable for 5,000 rows (paged or windowed list, filters, counts) without freezing the screen.

**Catalog import: decisions and confirmation**

- **FR-024**: Rows with status Already exists, Duplicate inside the file, SKU already used, or Invalid MUST NEVER be created and MUST NOT be offered a "create anyway" option; they are always skipped.
- **FR-025**: Rows with status Similar MUST be skipped by default; the supplier MUST be able to choose, for each row or for all similar rows at once, to create them as separate products. Nothing is merged or replaced automatically.
- **FR-026**: Before the final confirmation the system MUST show exactly how many medicines will be created, how many are created as separate similar products, and how many are skipped by reason; nothing is saved until the supplier confirms.
- **FR-027**: When the supplier confirms, the system MUST re-check every row against the current catalog. If any row's status differs from the approved preview, the system MUST apply nothing and show a refreshed preview for review.
- **FR-028**: A confirmed import MUST be all-or-nothing: either every approved row is created, or none is, with a clear message either way.
- **FR-029**: A confirmed import MUST be safe to retry: each import attempt has a unique identifier created before confirming, and repeating a confirmed import (double press, refresh, lost connection, simultaneous requests) MUST NOT create duplicates and MUST return the original result.
- **FR-030**: The system MUST NOT invent or default any value: empty cells MUST stay empty (including prices, strength, dosage form, pack size, manufacturer, brand, generic name, SKU). Prices MUST be stored exactly as written, in PKR with at most two decimals.
- **FR-031**: Imported medicines MUST be created active, MUST show "No selling price" wherever they appear when the selling price is empty, and MUST behave exactly like medicines added by hand.
- **FR-032**: After an import the system MUST show a summary: how many were created, how many created as separate similar products, how many skipped and why, listing skipped rows with row numbers and reasons.
- **FR-033**: Each completed import MUST be recorded (when, file name, counts by outcome), and each medicine created by an import MUST be traceable to that import record.
- **FR-034**: Leaving the Import screen before confirming MUST save nothing and MUST NOT keep the uploaded file.

**Interface and security**

- **FR-035**: All new screens MUST be English, mobile-first, with touch targets of at least 44 × 44 px, and MUST show loading, error (with Retry), and empty states with a clear next action.
- **FR-036**: Each business MUST see only its own settings, checklist state, and import records; imports MUST check duplicates only against, and create medicines only in, the importing business's catalog; this MUST be enforced on the server for every operation.
- **FR-037**: The system MUST NOT report a save or import as successful unless the data was actually stored, and MUST keep typed values on screen when a save fails.
- **FR-038**: Cost and profit data (purchase price, MRP) MUST be shown only on internal screens, never on anything customer-facing.

### Key Entities *(include if feature involves data)*

- **Business settings**: One per business. Business name, phone, address, thermal receipt paper width in millimetres (default 80), Account Summary printing default (default off), whether business details have been saved, whether the checklist is dismissed; each change tracked by a version.
- **Setup checklist state**: Derived from real data (settings saved, stores exist, medicines exist) plus the stored "dismissed" choice.
- **Import (batch)**: One attempt to import a file for one business: unique identifier created before confirming, file name, when, who, row counts per status, how many created, outcome (applied or refused), and a summary of skipped rows. Retrying the same identifier returns the same result.
- **Import row (in preview)**: One data row of the file: row number, the values read, status, reason or conflicting medicine, warnings, and the supplier's decision (skip or create as separate).
- **Product** (from Module 001): Medicines created by an import carry a link to the import that created them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new supplier can save their business details and invoice settings in under 2 minutes from the first sign-in.
- **SC-002**: A file of 5,000 rows shows its complete preview within 30 seconds, and the confirmed import finishes within 60 seconds, with progress visible throughout. "Normal mobile connection" means about 5 Mbit/s or better; the automated test measures the full browser-side reading plus server time on the test machine (the network is not throttled) for both a CSV and an `.xlsx` file of 5,000 rows.
- **SC-003**: In 100% of tested files, the status of every row in the preview equals the outcome applied by the import (the preview and the import never disagree), including when the catalog changed between preview and confirm (in which case 0 rows are applied and a new preview is shown).
- **SC-004**: Repeating a confirmed import 10 times, including simultaneous repeats, creates 0 additional medicines.
- **SC-005**: Across test files containing exact duplicates, in-file duplicates, conflicting SKUs, and similar medicines, 0 exact duplicates and 0 conflicting SKUs are ever created, and 0 medicines are merged.
- **SC-006**: When an import is interrupted at any point (induced failure), 0 of the file's rows are saved in 100% of trials.
- **SC-007**: 100% of tested bad files (wrong type, no header, missing or unrecognised or repeated columns, too many rows, too large, empty, damaged, password-protected) are refused with a message that names the problem, and the catalog is unchanged.
- **SC-008**: 100% of tested attempts by one business to read or change another business's settings, checklist state, or import records are refused, and an import by one business changes 0 records in the other's catalog.
- **SC-009**: In 100% of tested imports, empty cells remain empty and prices equal the file's values exactly; 0 default or invented values appear.
- **SC-010**: With all three checklist items not done, 100% of existing app functions (sign-in, stores, medicines) remain usable.
- **SC-011**: Every new screen is reachable through visible navigation at a 360 px width, with 100% of interactive controls at least 44 × 44 px and a loading, error, and empty state verified.
- **SC-012**: A supplier can preview, review, and import a 100-row file containing a mix of new, duplicate, and similar rows in under 5 minutes, and correctly states from the summary how many medicines were created and why others were skipped.

## Assumptions

- Use is still solo: the signed-in user is the owner, so "owner is the only editor" means no other account can change a business's settings; multi-user roles are not part of this module.
- Limits chosen as reasonable defaults: 10,000 data rows and 5 MB per import. These can change later without changing the behaviour described here.
- CSV files use commas and UTF-8; files from older Excel versions saved with another text encoding get a message asking to save as UTF-8 CSV or to use the .xlsx format.
- `unit` is required for every imported row because the product catalog requires it; a list that has no unit column must have one added. No default unit is applied, because a wrong unit is worse than a visible error.
- Strength, dosage form, pack size, and manufacturer are kept exactly as typed; the import does not try to extract them from a combined name (for example "NORAN 20MG CAP"), because guessing could create wrong medicines. A later improvement can offer suggestions the supplier confirms.
- A mistaken import cannot be undone in one step in this module; medicines can be deactivated one by one, and each carries a link to its import so a later module can offer undo. The preview and the explicit confirmation are the safeguards.
- Stores and opening balances are not imported here; stores are added by hand or while taking orders.
- The checklist's "done" states are derived from real data, so they stay correct even if the supplier did the work in another order.
- Thermal paper width is stored in whole millimetres within 40–120 (80 is the default; 58 and 80 are the common sizes); printing itself is a later module.
- Constitution Principles I–VIII apply: real server-side validation, no invented data, exact money handling in PKR, isolation per business, and mobile-first screens with loading, error, and empty states.

## Out of Scope

Orders and the order screen, Quick Register from orders and pending products, market list and purchases, invoices and printing (including the Account Summary itself), store ledger and payments, voice order and AI parsing, offline synchronization and backup, reports and dashboard, multi-user roles, importing stores or opening balances, one-step undo of an import, and extracting strength or dosage form from a combined name.
