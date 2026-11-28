# Research and decisions: Store-specific selling prices (Module 012)

All findings are from the code on master 7b7c1b6.

## How prices flow today

- `order_to_json` and `order_list` show a draft line at the product's live `selling_price`, and a confirmed line at `selling_price_snapshot`.
- `order_confirm` copies the product's prices into every catalog line. `order_save` does the same for lines added to a confirmed order.
- `pending_link_line` (Register / Link) and `pending_price_apply` (Pending Prices) can fill a confirmed line that has no price.
- `invoice_create` / `invoice_refresh` copy `selling_price_snapshot`; reports read invoice lines. Neither needs a change.
- `order_save` refuses a store change while the draft has lines (`store_locked`).
- The phone keeps medicines with `selling_price`; the backup file refuses every key containing "price".

## D1. Where a store rate lives

- **Decision**: a new table `store_rates` (one row per business, store, product) plus an append-only `store_rate_events`.
- **Rationale**: one current value per pair, history kept separately, same pattern as `orders` / `order_events`.
- **Rejected**: a JSON column on `stores` (no constraints, no per-row security or history); deriving the rate from the store's last invoice (invents a rate the supplier never chose).

## D2. Where a price typed on an order lives

- **Decision**: `order_lines.chosen_price` (null = automatic) and `order_lines.price_source` (`typed`, `store_rate`, `catalog`; set when the snapshot is taken).
- **Rationale**: a draft must keep the typed price across refresh, sync and devices; the source makes every invoiced price traceable (SC-005).
- **Rejected**: writing `selling_price_snapshot` on a draft (breaks "snapshot at confirm" and the existing check that a price needs a snapshot time).

## D3. One effective-price rule

- **Decision**: one SQL function used by `order_to_json`, `order_list`, `order_confirm` and `order_save`: `chosen_price`, else the order store's rate for the product (only when the line's unit equals the product's unit), else the product's selling price, else none. The same rule is written once in TypeScript for the screen and the phone, with one shared table of test cases.
- **Rationale**: the screen and the server must never disagree.
- **Note**: today the catalog price applies whatever unit the line has. That stays; only the store rate is limited to the product's own unit, and the screen says so.

## D4. How a rate is remembered

- **Decision**: it travels with the order save: a line carries `remember: true` and `rate_version` (the version the screen saw, or null). The server upserts the rate in the same transaction.
- **Rationale**: offline orders already reach the server through this save, so remembering works offline with no second queue, and a replayed request changes nothing twice.
- **Conflict rule**: if the stored rate changed since the screen read it, the order is saved, the rate is **not** overwritten, and the answer lists it in `rate_conflicts`. If the stored rate already equals the typed price, nothing happens and nothing is reported.
- **Rejected**: a separate "set rate" request from the order screen (two requests that can half-fail; needs its own offline queue).

## D5. The price shown is the price recorded (FR-005)

- **Decision**: confirm sends `expected_prices` (line id and price, or null). Inside the confirm transaction the server locks the products and rates it reads, computes the effective prices, and on any difference answers `price_changed` with the current order and changes nothing.
- **Rationale**: a version number does not move when a catalog price or a rate changes.
- **Compatibility**: the database parameter defaults to null (older tests and a phone with an older cached app keep working); the application route requires it.

## D6. Confirmed lines

- **Decision**: a recorded price never changes. A `price` sent for an existing confirmed line that differs from the snapshot is refused with a message. A line **added** to a confirmed order takes the effective price at that moment, which may be typed.
- **Rationale**: constitution Principle II.

## D7. Register, Link and Pending Prices

- **Decision**: Register/Link apply the order store's rate when there is one, else the product's price, and the dialog shows which. Pending Prices preview shows, per line, the price it will get (the store's rate or the typed price) and applies exactly that; its existing "list changed" refusal also covers a changed rate.
- **Rationale**: spec edge cases; no line gets a price the supplier did not see.

## D8. Store changes

- **Decision**: no change to `store_locked`. A draft with lines cannot change store, so a typed price cannot move to another store that way. The spec's US2 scenario 5 is corrected to match.
- **The one path that remaps a store**: a store created offline that turns out to exist ("Use the existing store"). The typed prices stay on the order (they are what was agreed), every `remember` flag is cleared, and the screen says so.

## D9. The phone

- **Decision**: device schema version 3 adds a `storeRates` object store (store id, product id, rate, version, catalog price at set time), filled with the other lists. Only these selling prices are added.
- **Freshness**: refreshed with the medicine list; the offline screen shows when it was updated. A change on the server is caught at confirm (D5), which is online.
- **Rejected**: rates only for recently opened stores (an offline order for another store would silently show the catalog price).

## D10. Backup file

- **Decision**: version 3. A waiting order line may carry `price` and `remember`/`rateVersion`. The forbidden-key rule allows `price` only at `$.waiting.orders[i].lines[j]`. Server orders in the file keep no price, and store rates are not exported (they are on the server). Versions 1 and 2 are still read.
- **Rationale**: FR-017 with the smallest opening of the Module 009 rule.

## D11. Guard against a mistyped price (FR-012)

- **Decision**: the screen asks for confirmation when the typed price differs from the catalog price by more than half. The server only enforces above zero, two decimals, at most 10 digits.
- **Rationale**: it is a typing aid, not a business rule; with no catalog price there is nothing to compare.

## D12. Traceability of typed prices (FR-011)

- **Decision**: every rate change writes `store_rate_events`. The `confirmed` order event adds the price and source of each line. Intermediate typing on a draft is not logged.
- **Rationale**: the recorded price is what matters; drafts autosave on every change.

## D13. Findings of the analysis (2026-11-26)

- **Guard**: `order_lines_guard` (0003) protects only the old snapshot columns. 0012 replaces it so `chosen_price` and `price_source` cannot change once a snapshot exists (the Pending flows keep their existing explicit switch).
- **Overloads**: adding a parameter with `create or replace` creates a second function and makes calls ambiguous. 0012 drops the old `order_confirm` and `pending_price_apply` signatures first and grants again.
- **History**: the `added` entry of a confirmed order records the catalog price today; it must record the effective price and its source.
- **Unit change**: it clears a typed price (a price is agreed for one unit), on the screen and in `order_save`. The owner agreed.
- **Lines added to a confirmed order**: they carry `expected_price`, with the same `price_changed` answer as confirm.
- **Price source**: Register, Link and Pending Prices set it too.
- **Per-store list**: needed by the order screen, so it is built with US2, not US4.

## D14. No new package

Everything uses the existing stack.
