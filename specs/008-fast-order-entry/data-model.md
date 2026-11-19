# Data Model: Fast Order Entry

**Date**: 2026-11-19 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## No schema change

This module creates **no table, column, index, function, policy or migration**. Everything is derived from existing tables, read with the signed-in user's session (Row Level Security applies), and every write goes through the existing `order_save` (Module 003).

| Existing object | Used for | Access |
|-----------------|----------|--------|
| `products` | the on-device medicine list; the usual cards; the repeat lines' current details | select (policy `products_select`), only the slim columns below |
| `orders` | the latest confirmed-or-later order of a store; the recent orders of a store | select (policy `orders_select`) |
| `order_lines` | the lines of those orders (`product_id`, `quantity`, `unit`, `name`, `position`, `removed_at`) | select (policy `order_lines_select`); price snapshot columns are never selected |
| `order_save` (function) | creating and changing the draft, including a repeat (one call with all lines) | execute, idempotent by `request_id` |

Indexes relied on (all exist): `products_business_active_name_idx`, `orders_business_store_created_idx`, `order_lines_order_idx`.

## Derived shapes (TypeScript, not stored)

### SlimMedicine (the only medicine shape the new routes return)

| Field | Type | Note |
|-------|------|------|
| `id` | uuid | |
| `name` | string | |
| `unit` | string | the medicine's own unit |
| `brand`, `generic_name`, `sku` | string or null | used only to search |
| `strength`, `dosage_form`, `pack_size`, `manufacturer` | string or null | always shown with a result |
| `selling_price` | decimal string or null | only to show "No selling price" and the current price like Module 003 |

**Never present**: purchase price, MRP, cost, unit profit, snapshots, `version`, timestamps.

### MedicineListState (screen only)

`status`: `loading` / `ready` / `too_large` / `error`; `items`: `SlimMedicine[]` with a lower-case `searchText` and `dosage` per row; `loaded`: count. Lives in the component; gone when the screen closes.

### UsualMedicine

| Field | Type | Note |
|-------|------|------|
| `medicine` | SlimMedicine | active only |
| `order_count` | integer | the number of the store's recent qualifying orders that contain it (once per order) |
| `last_ordered_at` | timestamp | `confirmed_at` of the latest such order |
| `last_quantity`, `last_unit` | integer, string | from its latest line |

At most 12, sorted by `order_count` desc, then `last_ordered_at` desc, then `id`.

### RepeatSource

`order_id`, `order_number`, `confirmed_at`, `line_count` (non-removed lines of the store's latest `confirmed` or `fulfilled` order, any age). Absent when the store has none.

### RepeatPlan (returned when the supplier taps the repeat button)

| Field | Note |
|-------|------|
| `lines[]` | `{ kind: "catalog", medicine: SlimMedicine, quantity, unit }` or `{ kind: "typed", name, quantity, unit }`, in the source order's position order, at most 200 |
| `skipped[]` | `{ name, reason: "inactive" | "missing" | "over_limit" }`; shown in a message that stays until dismissed |

### Client-only

- `AddedAction`: `{ label, lineIds[], expiresAt }`, the one pending Undo (8 seconds).
- `ParsedQuery`: `{ words[], quantity: number | null, quantityText: string | null }` from the search box (rules D4 and D5).

## Validation

| Rule | Where enforced |
|------|----------------|
| `store_id`, `order_id` are UUIDs; `limit` 1 to 900; `cursor` is an offset token | Zod in the route (same helpers as Module 001 lists) |
| A repeat source must belong to that store and be confirmed or fulfilled | the route (the query filters by store and status; RLS filters by business) |
| Quantity 1 to 100,000, whole number; unit 1 to 50 characters; at most 200 lines; typed names cleaned as in Module 003 | the existing `parseQuantity`, `LIMITS`, and `order_save` (server side) |
| An inactive medicine is never added from a stale list | `order_save` refuses it (`invalid_lines`) and the screen shows the message |
| No price, MRP, cost or profit in any response | explicit column lists in the repository; a test checks the raw JSON |

## State changes

None added. A repeat or a one-tap add changes the draft only through the existing autosave (`PUT /api/orders/{id}` -> `order_save`), which keeps its version check, idempotency and all-or-nothing behaviour. The draft's status stays `draft`; confirming is still the supplier's own action.
