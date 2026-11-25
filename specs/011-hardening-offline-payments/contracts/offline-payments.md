# Contract: offline payments (Module 011)

This is a device contract, not a new server contract. The server write is the existing route; this file fixes what the phone sends and how it understands the answer.

## The request (unchanged server route)

`POST /api/accounts/{storeId}/payments`, body `{ "id": <paymentId>, "amount": "5000.00", "date": "2026-11-24", "method": "cash", "reference": null }`, sent with the option that a 401 never navigates the person away. The route, the validation and the database function are Module 007's and are not changed by this module.

## Answer to device state

| HTTP and body | Meaning | Device state | Next |
|---------------|---------|--------------|------|
| 200, `done: true` (also `replayed: true`) | recorded once | removed from `paymentOps` | refresh balances |
| network error, timeout, 502 to 504, 5xx | unknown | `waiting`, `tries + 1` | backoff, same key |
| 401 | session ended | `waiting`, sending paused, "sign in" notice | resume after sign-in |
| 404 `not_found` | the store is not on the server | `conflict` (`not_found`) | supplier chooses |
| 409 `request_reused` | the key holds different content | `conflict` (`request_reused`) | supplier chooses |
| 400 `validation_error` (amount, date, reference) | refused, nothing recorded | `conflict` (`refused`) with the server's field message | supplier may correct and send again with the same key, keep or remove |

Nothing is ever retried with a different key by the phone. A payment is never sent for a store other than the one recorded with it.

## Ordering rules

1. Store operations are sent before payment operations.
2. Payments are sent one at a time, ascending `seq` **within each store**; a payment waiting for its retry holds back later payments of the same store only, never another store's.
3. A payment whose `storeId` is still in `storeOps` is skipped until that store operation is gone; if the store operation is resolved by "use the existing store", its waiting payments are moved to the existing id in the same step.
4. The sender is the Web Lock leader tab only (or the tab whose own screen is open and forced by Retry), as for orders.

## Removal rules

- `attempted = false` (never sent): removable after the supplier confirms (the confirmation names the amount and the store).
- `attempted = true` and no answer yet: not removable; it can only be sent again.
- `conflict`: removable after the same confirmation (the supplier has seen the server's reason).

## Backup file (version 2)

See `data-model.md`. The JSON Schema file `backup-file.schema.json` of Module 009 is extended by `backup-file.v2.delta.json` in this folder.
