# Research: Module 002 — Setup Checklist, Business Settings, Catalog Import

No `NEEDS CLARIFICATION` remain. Package versions are from the npm registry on 2026-11-06 and must be re-verified at install time.

## D1. Where files are read: in the browser, not on the server
- **Decision**: CSV and `.xlsx` files are read in the browser. The browser sends the server plain text rows as JSON. The server re-validates every row and does all catalog checks.
- **Rationale**: (a) Parsing untrusted spreadsheet files on the server is the classic attack surface (zip bombs, malformed XML); in the browser a bad file can only affect the user's own tab. (b) FR-034 (no file kept) becomes trivially true: the file never leaves the device. (c) Avoids server upload limits for large files and keeps request bodies small (text cells only). (d) The browser is never trusted: row validation and classification are repeated on the server for both preview and import.
- **Alternatives**: Upload the file and parse it on the server (more attack surface, upload limits, files transit the network); stage rows in a database table in chunks (keeps a copy of the supplier's data and contradicts FR-034).
- **Risk**: very large `.xlsx` files can use a lot of phone memory. Mitigation: 5 MB / 10,000-row limits checked before and during reading, with a clear message; CSV is recommended in the UI for very large lists.

## D2. File reading libraries
- **Decision**: `papaparse` for CSV; `read-excel-file` for `.xlsx` (first sheet only); `fflate` only to inspect the `.xlsx` zip safely before reading; `write-excel-file` to build the `.xlsx` template.
- **Rationale**: All are small, actively maintained, and work in the browser. `read-excel-file` was updated 2026-10-29; Papa Parse 5.7.0 handles quoted fields, embedded commas/newlines and BOMs.
- **Rejected**: `xlsx` (SheetJS) from npm: the npm release is stuck at 0.18.5 with known vulnerabilities (the maintainers distribute fixes elsewhere). `exceljs`: about 21 MB unpacked, far too heavy for a mobile bundle. `csv-parse`: fine but Papa Parse has the better browser story.
- **Verify at install**: the exact import style/API of `read-excel-file` v9 and `write-excel-file` v4; the libraries are loaded with dynamic `import()` only on the Import screen so the rest of the app does not pay for them.

## D3. File safety checks (before reading)
- **Decision**: In the browser, before any parsing: (1) extension and MIME must be `.csv` or `.xlsx`; (2) size ≤ 5 MB; (3) for `.xlsx` check the first bytes: a ZIP starts with `PK`; an old Office/encrypted container starts with `D0 CF 11 E0` and is refused as "password-protected or old format"; (4) list zip entries with `fflate` using a filter that does not inflate them; refuse if it contains `xl/vbaProject.bin` (macros), if there are more than 1,000 entries, or if the declared uncompressed size exceeds 50 MB (zip-bomb guard); (5) read only the first sheet and tell the user its name; (6) stop reading and refuse as soon as more than 10,000 data rows are seen.
- **CSV text**: decoded as UTF-8; a leading byte-order mark is removed; invalid UTF-8 sequences (the replacement character) produce the "save as UTF-8 CSV or use .xlsx" message. Comma delimiter is the documented format; a semicolon-only file is detected and reported with a clear message rather than guessed.
- **Rationale**: Covers every file-level rejection in the spec (type, damaged, password-protected, macros, too many rows, too large) without trusting the file.

## D4. Header rules (FR-014)
- **Decision**: Normalise headings (trim, collapse spaces, lowercase). Accepted headings are exactly the template's: `name, unit, brand, generic name, strength, dosage form, manufacturer, pack size, sku, purchase price, selling price, mrp`. Missing `name` or `unit`, any unrecognised heading, or any repeated heading rejects the whole file with the lists of found and expected headings. Column order is free.
- **Rationale**: Silent column dropping is data loss from the supplier's point of view; failing loudly is the safe default. The error lists exactly what to rename or delete.

## D5. Cell reading rules
- **Decision**: Every cell becomes a trimmed text value or `null` when empty. For `.xlsx`, numeric cells become their shortest exact decimal text (for example 99.99 stays "99.99"); formula cells use their cached value; date/boolean cells in a text column are converted to their displayed text; error cells make the row invalid with a reason. Whitespace is collapsed the same way as `norm_text`. Values are never rounded or reformatted by the reader.
- **Rationale**: Prices must follow the PKR two-decimal rule without float surprises; if Excel holds 0.30000000000000004 the row is Invalid ("more than two decimals"), which is correct.

## D6. Where classification lives: SQL, once
- **Decision**: Field validation (required name/unit, price format, lengths) is a pure TypeScript function in a shared module, run by the server on every preview and import request. Everything that depends on other rows or the catalog (already exists, similar, SKU already used, duplicate inside the file) is one SQL function, `import_classify(rows jsonb)`, called by both the preview and the import. It uses `norm_text` (the same function as the unique indexes) so the preview and the real insert agree on what "duplicate" means.
- **Order of statuses (first match wins)**: Invalid (field validation) → Duplicate inside the file (same identity as an earlier valid row) → Already exists (identity equals an existing medicine, active or inactive) → SKU already used (matches an existing SKU, or any earlier valid row's SKU, whether or not that earlier row is created) → Similar (name equals an existing medicine's but identity differs) → New.
- **Rationale**: One implementation means the preview cannot drift from the import (SC-003). The "earlier row's SKU counts even if that row is skipped" rule keeps statuses independent of the supplier's choices, so the fingerprint is stable.
- **Alternatives**: Duplicate the logic in TypeScript and SQL (drift risk); classify in TypeScript against a downloaded catalog (does not scale to thousands of rows and races with other writers).

## D7. Preview ↔ import agreement and "catalog changed"
- **Decision**: The preview returns a `fingerprint`: the MD5 of the ordered list `row_no:status:conflicting_product_id` for all valid rows. The confirm request sends the same rows, the fingerprint, and the list of "similar" row numbers the supplier chose to create. Inside the transaction the server re-classifies, recomputes the fingerprint, and if it differs applies nothing and returns `import_changed` (the client then re-runs the preview and shows a banner). A chosen "similar" row that is no longer similar is treated as a mismatch.
- **Rationale**: Small payload, no trust in client-sent statuses, and a hard guarantee that only the approved classification is ever applied (FR-027).
- **Refresh safety (FR-029 / US1 scenario 12)**: the wizard keeps the pending `import_id` in `sessionStorage` (a lightweight per-tab preference, not a data store) while a confirm is in flight; on load it asks `GET /api/imports/{id}` and, if the import exists, shows its summary instead of asking again. After success the browser moves to `/products/import?import=<id>`, which renders the summary from the server, so a refresh shows the same result.

## D8. Atomic, idempotent, race-safe import
- **Decision**: `import_apply` is a single plpgsql function (one transaction): take a per-business advisory transaction lock; if an `imports` row with this id exists, return its stored result (`replayed: true`); classify; compare the fingerprint; insert the approved products in one set-based `INSERT … SELECT` with `import_id` set; insert the `imports` record (counts, skipped list); return the summary. Any error rolls everything back, including a unique-index violation from a concurrent writer, which the API reports as "changed, try again".
- **Rationale**: The client-generated `import_id` is the idempotency key (Constitution VII). The advisory lock serialises two imports for the same business, so the second one sees the first one's rows and is re-classified. Retried, double-pressed, or simultaneous confirms return the original result and create nothing twice (SC-004). A failure leaves zero rows (SC-006).
- **Security**: the function is `SECURITY INVOKER`, so it runs as the signed-in user and Row Level Security applies to every read and write; `business_id` comes from the existing column default, never from input.

## D9. Settings storage and the owner-only editor
- **Decision**: A `business_settings` table (one row per business) holds phone, address, thermal paper width (integer 40–120, default 80), Account Summary default (default false), `details_saved`, `checklist_dismissed`, and a `version`. Rows are created by a trigger when a business is created, and backfilled for existing businesses by the migration. The business name stays in `businesses.name` (single source of truth). Saving settings is one `SECURITY DEFINER` function, `save_business_settings(expected_version, …)`, that checks the caller's business, checks the version, updates both tables, sets `details_saved`, and returns the new row. Dismissing the checklist is a direct update of that single column (column-level privilege + RLS policy), not part of the versioned form.
- **Rationale**: Users cannot update `businesses` directly (no policy), so a narrow, audited function is safer than widening policies. "Owner is the only editor" holds because only a signed-in member of that business can pass the business check; roles arrive in a later module. Dismissing does not bump the version, so it never causes a false "changed elsewhere" message.
- **Alternatives**: Let users update `businesses` directly (wider surface); duplicate the name in settings (two sources of truth).

## D10. Checklist state
- **Decision**: "Done" is derived: details done = `details_saved`; stores done = at least one store exists; import done = at least one product exists. `GET /api/setup` returns the three flags plus `dismissed`. Home renders the card on the server from the same repository, so there is no flash and no extra round trip.
- **Rationale**: Derived state cannot become stale and survives work done in any order (spec assumption).

## D11. Template files
- **Decision**: The CSV template is generated as text in the browser; the `.xlsx` template is generated with `write-excel-file`. Row 1 of both is exactly the 12 headings (nothing added to a heading or above it, so header matching in D4 and row numbering stay exact), followed by one example row whose `name` cell starts with the ASCII marker `EXAMPLE` (text: `EXAMPLE - delete this row`) and whose `unit` cell is a sample unit; the reader ignores a row whose name starts with `EXAMPLE` and reports that it did. "name and unit are required" is stated on the Import screen next to the download buttons and, for `.xlsx`, in a second sheet named `Instructions` (the reader only ever reads the first sheet).
- **Rationale**: No static binary in the repo to go stale, the headings always come from the same constant the reader checks (`columns.ts`). A CSV cannot carry a required marker without changing headings or adding rows above the header, which would break exact header matching (D4), so the marker lives in the UI and the `.xlsx` Instructions sheet.

## D12. Large lists in the preview
- **Decision**: The server returns a compact result per row (`row_no`, `status`, short reason, conflicting product id/name, warnings); the browser keeps the cell values it already read and shows a windowed (virtual) list with status filters and counts. Typical 5,000-row response ≈ 0.5–1 MB.
- **Rationale**: Meets FR-023 without a second round trip and without storing anything on the server.

## D13. Testing strategy
- **Decision**: (1) Vitest unit tests for header matching, cell reading, field validation, template, limits. (2) A PGlite suite that runs the migration and exercises `import_classify` / `import_apply` on a real PostgreSQL engine: every status, status priority, fingerprint stability, all-or-nothing on forced failure, idempotent replay (including concurrent calls), RLS isolation for settings and imports. (3) Supabase integration tests against the test project, including a 5,000-row timing test. (4) Playwright: upload a CSV and an `.xlsx` fixture, preview, change a decision, confirm, see the summary; bad-file cases; settings; checklist; at 360 px. Tests never use the owner's dev project.
- **Rationale**: Constitution I/VIII; PGlite gave fast, honest database coverage in Module 001.

## D14. Navigation and routes
- **Decision**: Settings gets a fourth bottom-navigation item. Import lives at `/products/import`, reachable from the Products screen, the checklist, and Settings. The history of imports is shown at the bottom of the Import screen.
- **Rationale**: Keeps the three existing items stable and makes every new screen reachable through visible navigation (SC-011).

## Package versions observed (verify at install)
papaparse 5.7.0, @types/papaparse 5.5.2, read-excel-file 9.3.14, write-excel-file 4.1.1, fflate 0.8.3. Rejected: xlsx 0.18.5 (outdated, known issues), exceljs 4.4.0 (too heavy).

## Verified at install (2026-11-06)

Installed: papaparse 5.7.0, @types/papaparse 5.5.2, read-excel-file 9.3.14, write-excel-file 4.1.1, fflate 0.8.3. `npm audit` reports 8 moderate findings, all in the existing eslint/typescript-eslint dev tooling (minimatch), none in the new packages.

- **read-excel-file 9**: `import { readSheet } from "read-excel-file/universal"`; `readSheet(input, 1, { parseNumber: (s) => s, trim: true })` returns the first sheet as `(string | number | boolean | Date | null)[][]`. Input is `Blob | ArrayBuffer` in the browser and universal builds (`File` in `/browser`; `Buffer`/path/stream only in `/node`). `parseNumber` receives the number's text, so returning it unchanged keeps the exact decimal text (99.99 stays `"99.99"`). Formula cells return the pre-computed value; a formula that cannot be evaluated is read as an empty cell (so error cells cannot be detected by this library and are treated as empty). The default export returns ALL sheets, so the first-sheet name is read separately from `xl/workbook.xml` in `inspect-file.ts`. Trailing empty rows are dropped by the library; empty rows in the middle are kept (our reader skips them).
- **write-excel-file 4**: `import writeExcelFile from "write-excel-file/universal"`; `await writeExcelFile(sheetData).toBlob()` (single sheet) or `writeExcelFile([{ data, sheet: "Name" }, …]).toBlob()` (several sheets). Cells are values or `{ value, type }`; strings stay strings.
- **papaparse 5.7**: `Papa.parse(text, { skipEmptyLines: "greedy" })` returns `data: string[][]` with `errors`; BOM is not stripped automatically (done in `read-csv.ts`).
- **fflate 0.8**: `unzipSync(bytes, { filter: (f) => … })` receives `{ name, size, originalSize, compression }` for every central-directory entry without inflating; returning `false` skips inflating. Used to list entries, detect `xl/vbaProject.bin`, count entries and sum declared sizes.
