# ADR-0001: Catalog Import Architecture (browser parsing, one SQL classification, fingerprint-guarded atomic apply)

> **Scope**: One decision cluster. The three parts below were chosen together, depend on each other and would change together.

- **Status:** Accepted
- **Date:** 2026-11-05
- **Feature:** 002-setup-catalog-import
- **Context:** A supplier must be able to load hundreds or thousands of medicines from a CSV or Excel file without creating duplicates, merging different strengths/forms/pack sizes, inventing values, or corrupting the catalog (constitution Principles I, IV, V, VIII; negative-prompt rules "no unvalidated CSV imports" and "never merge different strengths"). Requirements that shaped the design: a preview must show exactly what the import will do (SC-003); a confirmed import is all-or-nothing and safe to retry (SC-004, SC-006); two imports or a manual edit may race; 5,000 rows must finish in 30 s (preview) and 60 s (import); no uploaded file may be kept (FR-034); the owner is a solo supplier on Android phones, on mobile data.

<!-- Significance checklist: 1) Impact: yes, it fixes how every future bulk write (e.g. a later stores import) is built and where duplicate rules live. 2) Alternatives: yes, listed below. 3) Scope: yes, it spans browser, API, database and tests. -->

## Decision

1. **Files are read in the browser, not on the server.**
   - CSV with Papa Parse, `.xlsx` with `read-excel-file` (first sheet only, numbers kept as exact text), template built with `write-excel-file`, and `fflate` to inspect the `.xlsx` zip before parsing (type, size, password-protected/old format, macros, entry count, declared size). Libraries are loaded on demand on the Import screen only.
   - The server never receives a file. It receives only text rows as JSON (limits: 10,000 rows, 5 MB file, 4 MB of text per request). The browser is never trusted: the server re-runs the same pure field validation (`validate-row.ts`) on every preview and import request.
2. **Everything that depends on the catalog or on other rows is classified in ONE SQL function, `import_classify`.**
   - Statuses: `new`, `exists`, `similar`, `file_duplicate`, `sku_used` (and `invalid` from field validation). Priority: file_duplicate > exists > sku_used > similar > new. It uses `norm_text()`, the same normalisation as the unique indexes `products_identity_uniq` and `products_sku_uniq`, so "duplicate" means the same thing in the preview, the import and the indexes (which remain the last guard).
   - It runs as `SECURITY INVOKER`, so Row Level Security applies and a business can never read or affect another's catalog.
3. **The confirmed import is one database function, `import_apply`, run as one transaction.**
   - Takes a per-business advisory lock, replays the stored result when the client-generated `import_id` already exists (idempotency), re-classifies the rows, compares an MD5 **fingerprint** (`row_no:status:conflict_id` of all rows) with the one from the approved preview, and applies nothing (`import_changed`, HTTP 409) if it differs or if a chosen "create as separate" row is no longer `similar`. Otherwise it inserts the `imports` record and all approved products in one statement. Any error rolls back everything.
   - Every created product carries `import_id` through a composite foreign key `(business_id, import_id)`, so it can never point at another business's import.
   - Exact duplicates, in-file duplicates, repeated SKUs and invalid rows are never creatable; only `similar` rows can be created, and only by an explicit per-row (or "all similar") choice.

## Consequences

### Positive

- The preview and the import cannot disagree: one implementation, one normalisation, one fingerprint. Tested on a real PostgreSQL engine (PGlite) and on a Supabase test project, including 10 simultaneous confirms with one id (created once) and two simultaneous imports with different ids (one applied, one refused).
- No file upload surface: a hostile or broken file can only affect the user's own browser tab; nothing is stored (FR-034 is true by construction); small request bodies.
- Retries, double taps, lost connections and refreshes are safe (idempotency key + replay), and a failure leaves zero rows.
- Fast: set-based SQL measured on the Supabase test project at 2.6 s (preview) and 2.3 s (import) for 5,000 rows; in the browser CSV import took about 6 s end to end.
- Reusable: a later import (for example stores) can reuse the same pattern; `products.import_id` allows a later "undo this import".

### Negative

- Business rules live in SQL (harder to read and refactor than TypeScript) and are shipped as migrations; every change needs a migration applied to each Supabase project.
- A third request limit (4 MB of text per request) exists besides 10,000 rows and 5 MB; an unusually wide file must be split. Very large `.xlsx` files can be slow or memory-heavy on an old phone (CSV is recommended).
- The fingerprint is deliberately strict: any change to a medicine that touches the file's rows (even by the same user in another tab) makes the import refuse and re-preview. That is safe but can surprise the user.
- `read-excel-file` reads a formula that cannot be evaluated as an empty cell, so such error cells cannot be reported as invalid. The zip checks rely on declared sizes in the zip directory, which a crafted file could misstate (the effect stays inside the user's own tab).
- Only the file's text is cleaned (trim, collapse spaces); strength, form, pack size and manufacturer are never extracted from a combined name, so a list like "NORAN 20MG CAP" needs reshaping by the supplier.
- Found by the owner's phone test: browser APIs available only in secure contexts (such as `crypto.randomUUID`) are missing when the app is opened over plain http on a LAN; `newId()` now has a fallback. Client-side generation of `import_id` therefore depends on such fallbacks staying in place.
- Imports require a connection (preview and apply), consistent with Principle VII, so import is not an offline feature.

## Alternatives Considered

- **Alternative A: upload the file and parse it on the server.** Rejected: larger attack surface (zip bombs, malformed XML on the server), upload size limits on serverless hosting, the file would transit the network and (to be retryable) tempt us to store it, contradicting FR-034.
- **Alternative B: stage rows in a database table, then classify and apply in steps.** Rejected: keeps a copy of the supplier's data, needs cleanup jobs, and still needs the same classification and idempotency logic; more moving parts for no gain at this scale.
- **Alternative C: classify in TypeScript (browser or server).** Rejected: a second copy of the duplicate rules would drift from the unique indexes; classifying against a downloaded catalog does not scale to thousands of products and races with other writers; client-sent statuses would have to be trusted or recomputed anyway.
- **Alternative D: insert row by row from the API with per-row error handling.** Rejected: not all-or-nothing, slow for 5,000 rows, and a failure mid-way leaves a half-imported catalog.
- **Alternative E: SheetJS `xlsx` from npm, or `exceljs`.** Rejected: the npm `xlsx` release is stuck at 0.18.5 with known security issues; `exceljs` is about 21 MB unpacked, too heavy for a mobile bundle.
- **Alternative F: trust the preview without a fingerprint (last writer wins, rely on the unique indexes only).** Rejected: the indexes catch exact duplicates but not a changed classification (for example a medicine that became "exists" or a "similar" row whose conflicting product vanished); the supplier could import something different from what was approved (violates FR-027).

## References

- Feature Spec: specs/002-setup-catalog-import/spec.md
- Implementation Plan: specs/002-setup-catalog-import/plan.md
- Research (decisions D1-D8, verified library APIs): specs/002-setup-catalog-import/research.md
- Data model and SQL signatures: specs/002-setup-catalog-import/data-model.md; migration supabase/migrations/0002_settings_and_import.sql
- Related ADRs: none yet (a Module 001 ADR on REST handlers over RLS-enforced access with client-generated ids is still waiting for the owner's consent, task T075 of Module 001)
- Evaluator Evidence: specs/002-setup-catalog-import/quickstart.md section 6 (test results, 5,000-row timings, owner phone verification); history/prompts/002-setup-catalog-import/006-module-002-implementation.green.prompt.md
