# Contract changes to existing order requests (Module 012)

## Save (`PUT /api/orders/{id}`)

Each line may carry three optional fields:

| Field | Meaning |
|-------|---------|
| `price` | key absent: keep what the line has. `null`: automatic. A money string above zero: the price typed for this order. |
| `remember` | `true`: save `price` as this store's rate for the line's product. Ignored without `price` or without a product. |
| `rate_version` | the rate version the screen saw (`null` when it saw none). |

- A line **added to a confirmed order** also carries `expected_price` (string or null); when the price that would be recorded differs, the answer is `{ saved: false, reason: "price_changed" }` (HTTP 409) and nothing is saved.
- Changing a line's unit without sending `price` clears a typed price.
- The `added` entry of a confirmed order's history shows the price billed and its source.
- A typed (not registered) line refuses `price` ("Register the medicine before setting its price.").
- On a confirmed order, a `price` that differs from an existing line's recorded price is refused ("A recorded price cannot be changed."). A new line may carry `price`.
- The answer adds `rate_conflicts: [{ product_id, current_rate, current_version }]`: rates that were **not** overwritten because they changed meanwhile. The order itself is saved.
- A replayed request id changes nothing and returns the order.

## Order JSON (save, get, confirm)

Each line adds:

| Field | Meaning |
|-------|---------|
| `price_source` | `typed`, `store_rate`, `catalog` or `null` |
| `chosen_price` | the typed price on a draft, else `null` |
| `catalog_price` | the product's selling price now (draft lines only) |
| `rate` | `{ rate, version, catalog_price_at_set }` for a draft line whose store has a rate, else `null` |

`selling_price`, `line_total`, `price_basis` and the totals keep their meaning and now follow the effective-price rule.

## Confirm (`POST /api/orders/{id}/confirm`)

Adds the required field `expected_prices: [{ line_id, selling_price | null }]`, one entry per active line.

New answer: `{ confirmed: false, reason: "price_changed", current: Order }` (HTTP 409). Nothing is recorded; the screen shows the new prices and asks again.

## Register, Link, Pending Prices

- The Register and Link dialogs receive the price that would be filled and its source for the order's store.
- The Pending Prices preview returns, per line, `price` and `price_source`; apply sends the expected price per line and refuses (as today for a changed list) when any of them differs. Filled lines get `price_source`.
