# Data Model: Hardening and Offline Payments (Module 011)

**No server table, column or function changes** for offline payments. The server keeps the ledger as it is (Module 007). Everything new for Part A lives on the phone (IndexedDB, one database per business) and in the backup file. A migration `0012` is created only if the audit or the speed rule of research D14 finds something (none planned).

## Device storage (schema version 1 to 2)

New object store `paymentOps`, key `paymentId`. Added by the upgrade step for version 2; a version 1 database keeps all its other stores unchanged.

### `PaymentOpRecord`

| Field | Type | Meaning |
|-------|------|---------|
| `paymentId` | uuid | Made on the phone once per payment; it is the ledger entry id and the request id |
| `rev` | integer | Incremented by every write (the same optimistic rule as the other records) |
| `seq` | integer | Order in which the payment was recorded; sending follows it |
| `storeId` | uuid | The store (may be a store still waiting on the phone) |
| `amount` | string | Typed amount, canonical two decimals ("5000.00"), above zero |
| `date` | string | `YYYY-MM-DD`, not in the future and not before 2000-01-01 |
| `reference` | string or null | At most 100 characters |
| `state` | `on_device`, `syncing`, `waiting`, `conflict` | `synced` is never stored: a confirmed payment is removed |
| `reason` | string or null | A plain sentence for the supplier |
| `conflict` | `not_found`, `request_reused`, `refused` or null | Which refusal, for the conflict card |
| `attempted` | boolean | Written `true` before the first send; a payment with `attempted = true` and no answer cannot be removed |
| `tries` | integer | Attempts for the current unresolved request (drives the backoff) |
| `nextTryTick` | integer | Sender tick after which the next try is due (a counter, never the clock) |
| `recordedOn` | string | Display only: when it was recorded on the phone |

No balance, invoice, ledger entry, running total or allocation is stored. The "total waiting" shown on screens is computed on the fly as the exact sum of `amount` in integer paisa.

`SyncStatus` gains `payments: { waiting, syncing, conflict }` counts, a list of `SyncItem` entries with `kind: "payment"`, and a per-store map `waitingByStore: Record<storeId, { count, paisa }>` for the pending-sync notes.

## Backup file (version 1 to 2)

`format: "medsupply-backup"`, `version: 2`. One new array under `waiting`:

```json
"waiting": { "orders": [...], "stores": [...], "payments": [
  { "paymentId": "uuid", "storeId": "uuid", "amount": "5000.00", "date": "2026-11-24",
    "reference": null, "syncState": "waiting", "reason": null }
] }
```

`counts` gains `waitingPayments`. A version 1 file (no `payments`) is read as an empty list. The file never contains a balance, invoice, ledger entry or any price or cost; the forbidden-key check allows the key `payments` only at `$.waiting.payments` and its seven fields above.

## Restore rules for payments

| In the file | On the phone | Result |
|-------------|--------------|--------|
| a payment id not on the phone | none | queued as waiting ("new on this phone"); if the server already has it, sending is a replay and records nothing |
| a payment id already waiting on the phone | same id | kept as is ("already on this phone"); never doubled |
| a payment whose store is neither on the phone nor on the server | n/a | queued; becomes a conflict "the store is not on the server" when sent |

## Derived views (nothing stored)

- **Pending-sync note** for a store: `count` and `paisa` of its waiting payments, shown with the label "pending sync" next to any balance the app shows online.
- **Traceability table**: 47 rows `item | status | test file or reason`.
- **Security review record**: the real outputs of the checks in research D10.

## Password reset (no stored data of ours)

The reset uses the authentication service's own recovery token and session. The app stores nothing about it. Three routes: `GET /forgot-password` (page), `GET /auth/confirm?token_hash=&type=recovery` (route handler, redirects), `GET /reset-password` (page). See `contracts/auth-reset.openapi.yaml`.
