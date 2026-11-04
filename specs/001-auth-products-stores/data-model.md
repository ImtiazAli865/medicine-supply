# Data Model: Module 001 — Login, Products, Stores

All tables live in the `public` schema, are created by version-controlled migrations, and have Row Level Security enabled. All ids are UUIDs (clients supply them for `stores` and `products`). Money is `NUMERIC(12,2)` in PKR.

## Conventions

- `norm(x)` = `lower(btrim(regexp_replace(coalesce(x,''), '\s+', ' ', 'g')))`.
- Every data table has: `id uuid primary key`, `business_id uuid not null references businesses(id) default current_business_id()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `version integer not null default 1`.
- A `BEFORE UPDATE` trigger sets `updated_at = now()` and `version = version + 1`, and rejects any change to `id` or `business_id`.
- No `DELETE` policy and `DELETE` privilege revoked for `authenticated`/`anon`: records are deactivated, never removed.

## Business and membership

### businesses
| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | default `gen_random_uuid()` |
| name | text not null | 1–200 chars |
| created_at | timestamptz | default now() |

### profiles
| Column | Type | Rules |
|--------|------|-------|
| user_id | uuid PK | references `auth.users(id)` on delete cascade |
| business_id | uuid not null | references `businesses(id)`; one business per user |
| created_at | timestamptz | default now() |

Helper: `current_business_id()` — `SECURITY DEFINER`, `STABLE`, fixed `search_path`; returns `business_id` from `profiles` where `user_id = auth.uid()`, else `NULL`.

RLS: `businesses` and `profiles` — select only own row (`id = current_business_id()` / `user_id = auth.uid()`); no insert/update/delete for app users (provisioned manually; see quickstart).

## stores

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | client-generated |
| business_id | uuid | see conventions |
| name | text not null | trimmed, 1–200 chars |
| contact_person | text | ≤ 200 |
| phone | text | ≤ 50 |
| address | text | ≤ 500 |
| notes | text | ≤ 1000 |
| is_active | boolean not null | default true |
| search_text | text generated always | lowercase `name || ' ' || contact_person || ' ' || phone` (coalesced, immutable) |
| created_at / updated_at / version | | see conventions |

Indexes: `(business_id, is_active, lower(name))`; GIN trigram on `search_text`; index on `(business_id, norm(name))` (non-unique, used for the duplicate warning).
Rule: name duplicates (by `norm(name)`) are warned, not blocked (API-level `confirm_duplicate`).
RLS: select/insert/update where `business_id = current_business_id()`; insert/update `WITH CHECK` same.

## products

| Column | Type | Rules |
|--------|------|-------|
| id | uuid PK | client-generated |
| business_id | uuid | see conventions |
| name | text not null | trimmed, 1–200 chars |
| unit | text not null | trimmed, 1–50 chars; suggestions: strip, bottle, box, tablet, vial, tube, sachet; custom allowed |
| brand | text | ≤ 200 |
| generic_name | text | ≤ 200 |
| strength | text | ≤ 100 (for example "500 mg") |
| dosage_form | text | ≤ 100 |
| manufacturer | text | ≤ 200 |
| pack_size | text | ≤ 100 |
| sku | text | ≤ 100; null when absent (empty string stored as null) |
| purchase_price | numeric(12,2) | null or `>= 0` |
| selling_price | numeric(12,2) | null or `>= 0` |
| mrp | numeric(12,2) | null or `>= 0` |
| is_active | boolean not null | default true |
| search_text | text generated always | lowercase concatenation of name, brand, generic_name, strength, manufacturer, sku (coalesced, immutable) |
| created_at / updated_at / version | | see conventions |

Constraints and indexes:
- `UNIQUE (business_id, norm(name), norm(strength), norm(dosage_form), norm(pack_size), norm(manufacturer))` → exact duplicate block. `unit` is deliberately NOT part of the identity, and inactive products are included in the index, so a deactivated product blocks a copy and the UI offers Reactivate.
- `UNIQUE (business_id, lower(btrim(sku))) WHERE sku IS NOT NULL` → SKU conflict.
- `CHECK (purchase_price IS NULL OR purchase_price >= 0)` and the same for `selling_price`, `mrp`.
- GIN trigram on `search_text`; btree `(business_id, is_active, lower(name))`.
- Non-blocking warnings (selling < purchase, mrp < selling) are produced by the API, not by constraints.

Derived (never stored): `unit_gross_profit = selling_price - purchase_price` when both are non-null, else null. Returned only by internal product endpoints.

RLS: same four-policy pattern as `stores` (select/insert/update; no delete).

## State transitions

- Store / Product: `active ⇄ inactive` via PATCH `is_active`. Inactive records are excluded from default lists and suggestions, remain readable by id, and keep all data.
- Version: every successful update increments `version`; PATCH requires the caller's `expected_version`.

## Validation summary (shared by Zod and DB)

| Rule | Zod (API) | Database |
|------|-----------|----------|
| Name/unit required, trimmed, length limits | yes | `NOT NULL` + length checks |
| Money ≥ 0, ≤ 2 decimals | yes | `NUMERIC(12,2)` + `CHECK` |
| Exact duplicate product | pre-check for friendly error | unique index (authoritative) |
| SKU unique per business | pre-check for friendly error | partial unique index |
| Cross-business writes | n/a | RLS `WITH CHECK`, immutable `business_id` |

## Later-module compatibility notes

- Order items will snapshot prices and reference `products.id`; deactivation never removes rows, so references stay valid.
- The `version` column and client-generated ids are the hooks for offline sync and conflict detection in module 009.
