# Data Model: Voice Order Entry with Gemini (Module 008)

Migration: `supabase/migrations/0009_voice_orders.sql` (one transaction, rollback notes in its header). It changes two earlier objects (`orders`, plus the functions `order_to_json`, `orders_guard`, `order_save`) and adds two tables and six functions. No voice data is a price, a balance or audio; nothing here touches invoices, price snapshots or the ledger.

## 1. Changed: `orders`

| Column | Type | Rule |
|---|---|---|
| `spoken_text` (new) | `text null` | Check: null, or 1 to 2,000 characters after trimming **and** `source = 'voice'`. Set only when the order is created. Immutable afterwards (added to `orders_guard`, like `source`). Read-only everywhere. |

`source` already allows `manual` and `voice` and stays immutable. Existing rows keep `spoken_text = null`.

`order_to_json` (last defined in 0004) gains `'spoken_text', spoken_text` next to `'source'`. Nothing else in its output changes.

## 2. Changed: `order_save`

New signature (the old six-argument function is dropped in the same migration):

```
order_save(p_id uuid, p_request_id uuid, p_expected_version int, p_store_id uuid, p_notes text, p_lines jsonb,
           p_source text default 'manual', p_spoken_text text default null) returns jsonb
```

- `p_source` must be `manual` or `voice`; `p_spoken_text` must be null for `manual`, and 1 to 2,000 characters after trimming for `voice`. Otherwise the answer is `{ saved: false, reason: 'invalid_lines', detail: { message } }` before anything is written (the existing refusal shape).
- Both values are used **only when the order is created** (the insert); on a later save of an existing order they are ignored, so an edit can never change the source or the spoken text.
- Everything else (the order id and request id idempotency, the advisory lock, the number counter, line validation, typed lines, the 200-line limit, the `created` event, the answer shape) is the 0003 behaviour, unchanged. The migration test suite runs the Module 003 and 004 order tests against the new function and calls it in the old six-argument form to prove the defaults.

Grants: revoke from `public, anon`, grant to `authenticated`, for the new signature.

## 3. New table: `voice_diagnostics` (append-only, select-only for users)

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` default `gen_random_uuid()` | Primary key with `business_id`. |
| `business_id` | `uuid not null` default `current_business_id()` | References `businesses`. |
| `created_at` | `timestamptz not null default now()` | |
| `kind` | `text not null` | One of `ai_busy`, `ai_timeout`, `ai_invalid`, `ai_not_configured`, `ai_unavailable`, `rate_limited`, `rules_unreadable`, `low_confidence`. |
| `parser` | `text not null` | `ai` or `rules`. |
| `item_count` | `integer not null default 0` | 0 to 200. |
| `doubtful_count` | `integer not null default 0` | Items that are choose-one, unknown or have a doubtful quantity or unit. |
| `unreadable_count` | `integer not null default 0` | Parts of the transcript the parse did not use. |
| `transcript_length` | `integer not null default 0` | 0 to 2,000. The text itself is never stored. |
| `message` | `text null` | A short safe sentence (at most 200 characters), never an upstream body, a header, a key or a model secret. |

Guards: a trigger refuses update and delete (the service role may delete for test cleanup only, as for the ledger). Index `(business_id, created_at desc)`. Row Level Security on; one `select` policy for `authenticated` on `business_id = current_business_id()`; no insert, update or delete grant to users.

## 4. New table: `voice_parse_attempts` (rate limit)

`business_id uuid not null`, `at timestamptz not null default now()`, index `(business_id, at)`. Row Level Security on with no user policy and no grant: only the SECURITY DEFINER function touches it. Rows older than one hour are deleted by the function.

## 5. New functions

| Function | Kind | Purpose |
|---|---|---|
| `voice_parse_allow()` | SECURITY DEFINER | Called by the route only for the AI parser (the simple reader is never counted). Advisory lock per business; counts attempts in the last 60 seconds; at 20 or more returns `{ allowed: false, retry_after_seconds }`; otherwise records one attempt and returns `{ allowed: true }`; deletes the business's attempts older than one hour. |
| `voice_diag_add(p_kind, p_parser, p_items, p_doubtful, p_unreadable, p_transcript_length, p_message)` | SECURITY DEFINER | Validates the values (kind from the list, counts 0 to 200, length 0 to 2,000, message at most 200 characters) and appends one record for the caller's business (a `rate_limited` record is skipped when the business already has one from the last 60 seconds, returning `{ done: true, skipped: true }`); deletes that business's records older than 90 days. Returns `{ done: true }`. |
| `voice_diag_list(p_limit, p_offset)` | SECURITY INVOKER | `{ items: [...], total }` newest first, limit 1 to 50. |
| `voice_match_products(p_names jsonb)` | SECURITY INVOKER | For a JSON array of spoken names (at most 200), returns for each its index and up to five **active** medicines of the caller's business: id, name, brand, strength, dosage form, manufacturer, pack size, unit, `is_exact`, `score`. Exact forms first, then trigram similarity of the normalised spoken name against `search_text` (floor 0.3), then name. Returns no price, MRP or cost column. |
| `voice_match_stores(p_name text)` | SECURITY INVOKER | The same for active stores: id, name, contact person, phone, `is_exact`, `score`; up to five. |
| `order_to_json`, `orders_guard`, `order_save` | replaced | See sections 1 and 2. |

`is_exact` is true when the normalised (`norm_text`) spoken text equals the normalised name, the name with the strength, the name with the strength and the dosage form, or the brand (stores: the name). The function only reports facts; the matched or choose-one decision is made by application code (research D6).

Isolation: every statement filters on `current_business_id()`; the two read functions run as the caller so Row Level Security applies a second time; the two new tables have Row Level Security on. No function returns another business's row for a crafted id (tested on PGlite and with two real users).

## 6. Client-side shapes (not stored on the server)

- **Transcript**: text up to 2,000 characters; held in the page and in the tab's `sessionStorage` copy until the draft is created.
- **RawParse** (from either parser): `{ store: string | null, items: [{ name, quantity: number | null, unit: string | null }], unreadable: string[] }`.
- **Preview** (what the parse route returns and the screen edits): `{ parser, store: { spoken, state, candidates[], storeId? }, lines: [{ key, spoken, state, candidates[], quantity, unit, flags[] }], unreadable[], counts }`, where `state` is `matched`, `choose_one` or `unknown` and `flags` come from `missing_quantity`, `quantity_not_whole`, `quantity_too_small`, `quantity_too_large`, `unit_not_heard`, `duplicate_spoken`, `more_than_one_store`. It contains no price, MRP, cost, balance or invoice field.

## 7. Rollback (documented in the migration header)

Safe only while no order has `source = 'voice'`: drop the six new functions and the two tables, restore the six-argument `order_save`, `order_to_json` and `orders_guard` from 0003, 0004 and 0007, then drop `orders.spoken_text`. Row counts of `orders`, `order_lines`, `order_events` and `stores` are compared before and after the apply on the TEST and DEV projects (nothing existing changes).
