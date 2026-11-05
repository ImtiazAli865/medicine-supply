# Data Model: Module 002 — Setup Checklist, Business Settings, Catalog Import

Migration: `supabase/migrations/0002_settings_and_import.sql`. It builds on `0001_init.sql` (businesses, profiles, stores, products, `current_business_id()`, `norm_text()`, `set_row_meta()`). Every new table has Row Level Security enabled. Nothing is ever hard-deleted.

## business_settings (new)

One row per business.

| Column | Type | Rules |
|--------|------|-------|
| business_id | uuid PK | references `businesses(id)` on delete cascade |
| phone | text | null or ≤ 50 chars |
| address | text | null or ≤ 500 chars |
| thermal_paper_mm | integer not null | default 80; `CHECK (thermal_paper_mm BETWEEN 40 AND 120)` |
| account_summary_default | boolean not null | default false |
| details_saved | boolean not null | default false; set true by the first successful save of the settings form |
| checklist_dismissed | boolean not null | default false |
| version | integer not null | default 1; incremented only by `save_business_settings` (phone, address, paper width, summary default, or the business name). Updating `checklist_dismissed` alone MUST NOT change `version`, so this table gets its own small trigger (it only maintains `updated_at`) and does NOT reuse `set_row_meta()`, which bumps the version on every update |
| created_at / updated_at | timestamptz | |

- **Creation**: an `AFTER INSERT` trigger on `businesses` (security definer, fixed search path) inserts the settings row with defaults. The migration backfills a row for every existing business.
- **RLS**: `select` where `business_id = current_business_id()`. `update` allowed only on the column `checklist_dismissed` (column-level `GRANT UPDATE (checklist_dismissed)`) and only for the caller's own row (policy). No insert or delete for application roles.
- **Writes of the form** go through `save_business_settings` (below).
- **Business name** stays in `businesses.name` (1–200 chars, existing check). There is no direct update policy on `businesses`; only the function updates it.

### save_business_settings(p_expected_version int, p_name text, p_phone text, p_address text, p_thermal_paper_mm int, p_account_summary_default boolean) → jsonb

`SECURITY DEFINER` (volatile, since it writes), fixed `search_path = public`. Steps in one transaction: resolve the caller's business via `current_business_id()` (raise `no_business` if null); `INSERT INTO business_settings (business_id) VALUES (…) ON CONFLICT DO NOTHING` so a missing row (should never happen after the trigger and backfill) is created with defaults; lock the settings row; if `version <> p_expected_version` return `{ saved: false, reason: 'version_conflict', current: {…} }` without changing anything (the route turns it into HTTP 409 with the current row); validate (the table checks also enforce); update `businesses.name`; update the settings row and set `details_saved = true`; return `{ saved: true, settings: { name, phone, address, thermal_paper_mm, account_summary_default, details_saved, checklist_dismissed, version } }`. Execute granted to `authenticated` only.

## imports (new)

One row per confirmed (applied) import attempt.

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | client-generated before confirming; the idempotency key |
| business_id | uuid not null | default `current_business_id()`, references `businesses(id)` |
| created_by | uuid | default `auth.uid()`, references `auth.users(id)` on delete set null |
| file_name | text not null | ≤ 255 chars |
| file_kind | text not null | `CHECK (file_kind IN ('csv','xlsx'))` |
| submitted_rows | integer not null | data rows read from the file (non-blank) |
| created_count | integer not null | medicines created (including similar-confirmed) |
| created_similar_count | integer not null | of which created as separate similar products |
| skipped_count | integer not null | |
| status_counts | jsonb not null | e.g. `{"new":120,"exists":4,"similar":3,"file_duplicate":1,"sku_used":2,"invalid":5}` |
| skipped | jsonb not null | array of `{row_no, status, message, conflict_name?}` for every skipped row (invalid rows included), capped by the 10,000-row limit |
| fingerprint | text not null | the approved preview fingerprint |
| created_at | timestamptz not null | default now() |

- **RLS**: `select` where `business_id = current_business_id()`; no direct insert/update/delete for application roles (rows are written by `import_apply`, which runs as the invoker: it needs insert permission, so the migration grants `INSERT` on `imports` to `authenticated` with a policy `WITH CHECK (business_id = current_business_id())`; there is still no update or delete).
- **Index**: `(business_id, created_at desc)` for the history list.
- **Uniqueness**: `UNIQUE (business_id, id)` (besides the primary key on `id`) so products can reference an import of their own business only.

## products (changed)

- New nullable column `import_id uuid` with the composite foreign key `FOREIGN KEY (business_id, import_id) REFERENCES imports (business_id, id)` (default `MATCH SIMPLE`, so it is not checked while `import_id` is null; no `ON DELETE` action, because imports are never deleted), plus an index on `import_id`. This makes it impossible for a product to point at another business's import, even through a direct API call that bypasses `import_apply`. Set only by `import_apply`. Existing rows stay null. The product RLS policies from Module 001 are unchanged.

## Functions (all `SECURITY INVOKER` unless stated; RLS always applies)

### import_classify(p_rows jsonb) → table(row_no int, status text, conflict_product_id uuid, conflict_name text)

Input: a JSON array of rows that already passed field validation, each `{row_no, name, strength, dosage_form, pack_size, manufacturer, sku}` (strings or null; the other columns are not needed for classification). Output: one row per input row, status one of `new`, `exists`, `similar`, `file_duplicate`, `sku_used`. Set-based:

1. Identity key per row: `norm_text(name), norm_text(strength), norm_text(dosage_form), norm_text(pack_size), norm_text(manufacturer)`; SKU key `lower(btrim(sku))` when not empty.
2. `file_duplicate`: `row_number()` over the identity key ordered by `row_no` is greater than 1.
3. `exists`: identity key equals a product of the caller's business (active or inactive); `conflict_*` is that product.
4. `sku_used`: SKU key equals an existing product's SKU, or the row is not the first of its SKU key in the file (any earlier valid row counts, whether or not it will be created); `conflict_*` is the existing product when there is one.
5. `similar`: `norm_text(name)` equals an existing product's but the identity key does not (no row of step 3); `conflict_*` is the first such product by creation time.
6. Otherwise `new`. Priority when several apply: `file_duplicate` → `exists` → `sku_used` → `similar` → `new`.

Uses the existing indexes (`products_identity_uniq`, `products_business_normname_idx`, `products_sku_uniq`). Rows of other businesses are invisible (RLS).

### import_preview(p_rows jsonb) → jsonb

Calls `import_classify` and returns `{ fingerprint, rows: [{row_no, status, conflict_product_id, conflict_name}] }` where `fingerprint = md5(string_agg(row_no || ':' || status || ':' || coalesce(conflict_product_id::text,''), ',' ORDER BY row_no))`. Read-only.

### import_apply(p_import_id uuid, p_file_name text, p_file_kind text, p_rows jsonb, p_invalid jsonb, p_fingerprint text, p_create_similar int[]) → jsonb

One transaction (the function itself):

1. `pg_advisory_xact_lock(hashtext(current_business_id()::text))` so imports of one business run one at a time.
2. If an `imports` row with `p_import_id` exists for this business, return its stored summary with `replayed: true` and change nothing.
3. Classify `p_rows`; recompute the fingerprint. If it differs from `p_fingerprint`, or any number in `p_create_similar` is not currently a `similar` row, return `{ applied: false, reason: 'catalog_changed' }` and change nothing.
4. Insert one product for every row with status `new`, plus every `similar` row listed in `p_create_similar`, in a single `INSERT … SELECT` (new ids from `gen_random_uuid()`, `is_active = true`, `import_id = p_import_id`, empty cells stay `NULL`, prices cast from their canonical text to `numeric(12,2)`).
5. Insert the `imports` row with the counts, the status counts, the `skipped` list (every row not created, plus `p_invalid`), and the fingerprint.
6. Return `{ applied: true, replayed: false, import: {…} }`. Any exception (including a unique-index violation from a concurrent writer) rolls everything back.

## Validation summary

| Rule | TypeScript (server and browser) | Database |
|------|---------------------------------|----------|
| Required name/unit, trimmed, length limits (name 200, unit 50, brand 200, generic 200, strength 100, form 100, manufacturer 200, pack size 100, SKU 100) | `validate-row.ts` (server re-runs it) | `NOT NULL` + length checks on `products` |
| Prices non-negative, ≤ 2 decimals, digits and one dot only | `validate-row.ts` (reuses the money rules) | `NUMERIC(12,2)` + `CHECK` |
| Identity / SKU duplicates, similar | — | `import_classify` + unique indexes (last guard) |
| Settings ranges | Zod | `CHECK` on `thermal_paper_mm`, length checks |
| Isolation | — | RLS on `business_settings`, `imports`, `products`; no cross-business reads in any function |

## State transitions

- **Import**: `previewing` (client only, nothing stored) → `applied` (an `imports` row exists) or `refused` (`catalog_changed`: nothing stored). There is no stored half-done state.
- **Settings**: `version` increments on every successful form save. Dismissal is a boolean flip without a version change.

## Later-module compatibility notes

- `products.import_id` lets a later module offer "undo this import" (deactivate every product of one import) without changing this schema.
- `business_settings.thermal_paper_mm` and `account_summary_default` are read by the invoice-printing modules.
