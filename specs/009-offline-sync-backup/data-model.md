# Data Model: Offline Order Taking, Automatic Sync and Backup (Module 009)

**No server table, column, function or migration is added.** Everything below lives on the device (IndexedDB) or in the backup file. The server keeps using the existing `orders`, `order_lines`, `stores` and `order_save` of Modules 001 and 003.

## Device databases

### `medsupply-registry` (one per browser profile)

| Store | Key | Fields | Notes |
|-------|-----|--------|-------|
| `users` | `userId` | `businessId`, `businessName`, `lastSignedInAt` (server time as text) | Written when the app is open and online. Lets the offline shell find the business of the signed-in user. |

The registry holds no orders, medicines or prices.

### `medsupply-<businessId>` (one per business on this device, schema version 1)

| Store | Key | Fields | Purpose |
|-------|-----|--------|---------|
| `meta` | `key` | `value` | `schemaVersion`, `medicinesUpdatedAt`, `storesUpdatedAt`, `lastSyncAt`, `lastSyncAttemptAt`, `journalSeq`, `deviceId` (random id made on first use), `recentStores` (ids of the stores whose order screens were opened here) |
| `medicines` | `id` | the slim medicine shape of Module 008 (`name`, `unit`, `brand`, `generic_name`, `strength`, `dosage_form`, `manufacturer`, `pack_size`, `sku`, `selling_price`) | Active medicines. A refresh replaces the whole list in ONE transaction, so an interrupted refresh leaves the previous list. Never a purchase price, MRP or cost. |
| `stores` | `id` | `name`, `contact_person`, `phone`, `is_active`, `pending` (true for a store made on this device and not yet created on the server) , `pendingSeq` | Active stores plus device-made stores. |
| `storeExtras` | `storeId` | `usual` (the `/api/orders/usual` answer), `repeatPlan` (the `/api/orders/repeat` answer), `updatedAt` | Recently used stores only (the last 10). |
| `drafts` | `orderId` | see "Draft journal record" | Every draft with a change the server has not confirmed, and the last confirmed copy of drafts opened on this device. |
| `storeOps` | `storeId` | `payload` (the create body: id, name, contact fields), `state`, `reason`, `tries`, `nextTryAt`, `seq`, `matches` (similar stores returned by the server) | Stores made offline waiting to be created. |

Every store except `meta` carries no field that identifies another business: the database itself is the boundary.

### Draft journal record (`drafts`)

| Field | Type | Meaning |
|-------|------|---------|
| `orderId` | uuid | Made on the device for a new order; the server's id otherwise. |
| `rev` | integer | Incremented by every journal write; a write is applied only if the stored `rev` equals the one the writer read (two tabs, FR-022). |
| `seq` | integer | Order in which the draft was first changed while waiting; sends follow it. |
| `storeId` | uuid | The store; may be a device-made store (`stores.pending`). |
| `state` | `EditorState` | `storeId`, `notes`, `lines` (`OrderLineInput[]`: id, product_id, typed name, quantity, unit). The phone version. |
| `lineInfo` | map lineId → `LineInfo` | Display details (name, strength, form, pack size, manufacturer, last known price, typed flag). |
| `baseVersion` | integer or null | The server version the phone version is based on; null before the first server save. |
| `inflight` | object or null | The unresolved request: `requestId`, `expectedVersion`, `state`. Kept until the server answers, so a retry after a restart repeats the same request id and payload. |
| `serverOrder` | `Order` or null | The last order the server returned (for display and for conflict comparison). |
| `syncState` | enum | `on_device` (changes not yet confirmed), `waiting`, `syncing`, `synced`, `failed`, `conflict`, `blocked` (waits for a device-made store) |
| `reason` | text or null | Plain reason for `failed`, `conflict` or `blocked`. |
| `conflict` | object or null | `{ server: Order, kind: "changed" \| "not_editable" \| "missing" \| "line_problem" \| "store_problem", message }`. |
| `tries`, `nextTryAt` | integer, counter-based time | Backoff bookkeeping; `nextTryAt` is "after attempt number N of the sender", never a clock time that decides correctness. |
| `neverSent` | boolean | True while the order has never reached the server (lets a local discard be offered). A draft opened online from the server is written as a `synced` record with `serverOrder` and `baseVersion` set and `neverSent` false, so it can be edited offline later. |
| `updatedOnDevice` | text | Display time only (never used for decisions). |

State transitions (per draft):

```
on_device --(sender picks it, store ready)--> syncing --ok--> synced
syncing --network/5xx--> waiting (same inflight request, backoff)
syncing --400-type refusal--> failed (inflight cleared, phone version kept)
syncing --version_conflict / order_not_editable / order missing--> conflict (both versions kept)
on_device --(device-made store not yet created)--> blocked --(store created)--> on_device
failed --Retry--> on_device          waiting --(backoff elapsed or Retry)--> syncing
conflict --keep phone--> on_device (re-based)     conflict --keep server--> synced (phone version discarded after confirmation)
conflict --keep both--> synced (old order adopted) + a new draft in on_device
```

An edit while `syncing` or `waiting` changes `state` only; it is sent as the next request after the in-flight one is resolved. `synced` means the server confirmed the last request and no newer edit exists.

### Store operation (`storeOps`)

Same states and backoff as a draft (`waiting`, `syncing`, `synced`, `failed`) plus `similar` (the server found a store with a similar name: the supplier chooses "Use the existing store" or "Create a new store anyway"; nothing is merged silently). Orders for the store stay `blocked` until it is `synced`.

## Derived values (never stored)

- **Sync status**: online or offline (from D9), `lastSyncAt`, and counts of drafts and store operations per state (waiting = `on_device` + `waiting` + `blocked`, syncing, failed, conflict).
- **Cache age**: now minus `medicinesUpdatedAt` / `storesUpdatedAt`; "older than a day" note.

## Backup file (`medsupply-backup`, version 1)

Fields: `format`, `version`, `exportedAt`, `businessId`, `source` (`"server+device"` or `"device-only"`), `counts`, `stores[]`, `orders[]`, `waiting[]`.

- `stores[]`: `id`, `name`, `contact_person`, `phone`, `address`, `is_active`.
- `orders[]`: `id`, `order_number`, `status`, `source`, `notes`, `version`, `created_at`, `updated_at`, `confirmed_at`, `cancelled_at`, `cancel_reason`, `store_id`, `lines[]` (`id`, `position`, `product_id`, `name` for typed lines and display name otherwise, `strength`, `dosage_form`, `pack_size`, `manufacturer`, `quantity`, `unit`, `delivered_quantity`).
- `waiting[]`: the journal drafts that are not `synced` (`orderId`, `storeId`, `state`, `lineInfo`, `baseVersion`, `neverSent`, `syncState`, `reason`) and the unsent store operations.
- Never present: any price, MRP, cost, margin, profit, balance, invoice, payment, ledger or purchase data, any password, key or token, the auth cookie, the device id.

Validation on import: `format` and `version` known, `businessId` equal to the signed-in business, counts match the lists, every id a UUID, quantities whole numbers from 1 to 100,000, at most 200 lines per order; anything else refuses the whole file with a reason (nothing partly imported).

## Identity rules on the device

- The business id used to open `medsupply-<businessId>` comes from the registry entry of the signed-in user (cookie `sub` offline, server answer online). If they disagree the app refuses to open any database and asks to sign in.
- A sign-out never deletes a database. "Clear device data" deletes the current business's database only, after a warning and the backup offer.
