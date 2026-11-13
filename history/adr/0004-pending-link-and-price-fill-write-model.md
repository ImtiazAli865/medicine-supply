# ADR-0004: Pending Link and Price-Fill Write Model (function-only link and fill, one replay table, write-once typed text, reviewed-list price fill)

> **Scope**: One decision cluster made in Module 004 (pending products). The parts were chosen together and would change together: how a typed order line becomes a real medicine link, how a missing price is filled later, and how each is kept retry-safe, audited and isolated. It uses the exception that ADR-0003 reserved.

- **Status:** Accepted (the owner asked for this ADR on 2026-11-11)
- **Date:** 2026-11-11
- **Feature:** 004-pending-products
- **Related:** ADR-0003 (order write model and price snapshots: this ADR is the "future `SECURITY DEFINER` function" it reserved the snapshot-edit exception for, and the review it said was needed when the exception is first used). ADR-0002 (REST handlers over RLS, client-generated ids, versions).
- **Context:** Module 003 lets a supplier type a medicine that is not in the catalog; the line is kept as typed (`product_id` null, "pending registration") and confirmed orders keep an immutable price snapshot, often with no price. Module 004 must (1) register the medicine or link the line to an existing one without losing the order, the quantity or the typed text, (2) offer other typed lines that clearly match, one confirmed line at a time, and (3) let the supplier set a missing selling price once and give it to the confirmed lines still waiting for it. The hard rules are: never link or price anything the supplier did not confirm, never change a price that is already recorded, never merge a different strength, form or pack size, never create a duplicate medicine on a retry, and never cross businesses. These touch rows that the Module 003 guard trigger protects, and a price fill changes many orders at once, so a plain "update with a form" is not enough.

<!-- Significance checklist: 1) Impact: yes, invoices (Module 006) and the ledger depend on lines being linked and priced only this way. 2) Alternatives: yes, listed below. 3) Scope: yes, database, handlers, order screens, history, and every later module that reads order lines. -->

## Decision

1. **Link and fill have exactly three write functions, all `SECURITY DEFINER`, and no new write grants.** `pending_line_register`, `pending_line_link` and `pending_price_apply` read the business from `current_business_id()` and filter every statement by it. A shared internal helper (`pending_link_line`) has no grants at all. The order tables stay select-only for signed-in users. The five reads (`pending_summary`, `pending_typed_groups`, `pending_candidates`, `pending_prices_list`, `pending_price_preview`) are `SECURITY INVOKER`, so Row Level Security still applies to them.
2. **Register is one transaction: create the medicine and link the line.** It repeats the Module 001 checks inside the function (code conflict, exact duplicate including inactive medicines, similar name with a different identity only with explicit confirmation); the unique indexes stay the last guard. A failure cannot leave a created medicine with an unlinked line.
3. **One replay table for all three functions: `pending_requests (business_id, request_id, kind, result)`.** It is written in the same transaction as the change, append-only, with Row Level Security on and no grants to anyone. The replay lookup is done twice, before and after the advisory locks, so ten simultaneous identical requests give one change and the same stored result. A request id used by another business is never replayed. The functions do not touch `orders.last_request_id`, so `order_save` replays are unaffected.
4. **Locking follows `order_save`.** The functions take `pg_advisory_xact_lock` on `'product:' || id` first, then on `'order:' || id` for every order they touch (sorted by id, so a multi-order fill cannot deadlock). A link bumps the order's version, so an editor open elsewhere gets `version_conflict` ("changed elsewhere") instead of overwriting the linked line.
5. **The typed text is kept in a write-once column `order_lines.typed_name`**, set when the line is linked and never changeable afterwards (a trigger refuses any change, also under the snapshot-edit flag). The medicine's description is copied into the line's own snapshot columns, so a confirmed line keeps showing what the order recorded, with "As typed: ..." beside it.
6. **The snapshot-edit exception of ADR-0003 is used in exactly two places** (the link helper and `pending_price_apply`), set with `set_config('app.line_snapshot_edit', 'on', true)` (transaction-local), switched off again before the function returns, and rolled back with the transaction on any error. A price is only recorded on a line when the order is confirmed, the line has no price, the medicine has one, and the supplier answered "yes" to the price question (`apply_price`). The `update` itself repeats `selling_price_snapshot is null`, so even a wrong id list cannot overwrite a recorded price.
7. **Price fill is: set the price once, review the exact list, confirm, all or nothing.** The browser sends the ids it reviewed; the function recomputes the waiting lines under the locks (confirmed order, not removed, snapshot taken, no price, oldest orders first, at most 1,000 per request) and refuses with `list_changed` (and the current list) if the two differ. The catalog price is set only when the medicine has none; a different price for a priced medicine is `price_differs`; the price must be greater than zero with at most two decimals. A row-count mismatch raises and rolls everything back. "Save price only" is the same call with an empty list.
8. **History gets two append-only event kinds, `linked` and `price_filled`.** Each records, per line, what was linked or priced, how (`registered`, `existing`, `proposal`), the previous price (none) and the new price, the actor and the time. Purchase price and MRP never appear in an event, a result or an order screen. Each touched order's version goes up once and gets one `price_filled` event.
9. **Proposals use a deliberately narrow rule and never act.** A typed line is proposed only when its normalised text equals the medicine's name, name + strength, or name + strength + dosage form, and no other active medicine has the same label. Look-alikes sharing the first word are listed as "Looks different, not proposed". Typed text is never parsed into strength or form. Nothing is linked until the supplier confirms that one line; there is no "link all".
10. **Counts and lists share one definition.** `pending_summary` returns counts that equal the length of the lists they link to, and the lists open from partial indexes (`0004`) and materialized aggregates (`0005`).

## Consequences

### Positive

- A user cannot link or price a line, skip the confirmation or change a recorded price, even by calling Supabase directly (tested: direct writes are refused on PGlite and on the real test and dev projects; a line that already has a price is byte-for-byte identical after a fill).
- A lost response, a double tap, a refresh or ten simultaneous identical requests give one medicine, one link per line and one fill per line, with the same result (tested on PGlite and on the Supabase test project).
- A price fill of 1,000 lines is one transaction: an injected failure on the second line rolls back every line, the catalog price and the events (tested).
- Business isolation is enforced in the functions and tested with crafted ids and a shared request id for two real users; a refusal looks exactly like a missing id.
- Later invoices can total from the snapshot without extra work, and the history shows who filled which price, when.

### Negative

- More rules in SQL (about 1,300 lines in `0004` plus `0005`), so every change is a migration with PGlite and Supabase tests. A missing business filter in a `SECURITY DEFINER` function would be a leak. Mitigation: composite foreign keys, filters on every statement, two-user tests with crafted ids.
- The snapshot-edit flag is a deliberate hole in the guard trigger. It is now used by two functions and must stay used only there; any new use needs the same review.
- A link or a price fill cannot be undone in this module (out of scope on purpose: the correction path is a later module's decision, for example with invoices in Module 006). A wrong link needs a new feature.
- The narrow proposal rule misses some matches; each miss costs one manual link. A looser rule can be added later because it only changes what is listed.
- The cap of 1,000 lines per fill means a very large backlog needs several confirmations; accepted for a solo supplier.
- Read performance depends on Postgres planning: with the row estimate of 1 for `current_business_id()` conditions, the planner re-ran an aggregate once per medicine and recomputed labels per typed line (Need a price list 2.5 to 2.8 s, proposals over 8 s at 1,000 lines and 500 medicines). Fixed in `0005_pending_perf.sql` (`MATERIALIZED`, labels computed once; all calls at most 422 ms on the test project). Consequence: new reads of this kind must be measured at scale, not only tested for correctness.

## Alternatives Considered

- **A handler that creates the product through the existing products endpoint and then links the line.** Rejected: a failure between the two calls leaves a created medicine with an unlinked line, and a retry cannot be proven atomic.
- **Column-level `UPDATE` on `order_lines` for signed-in users, protected by the guard trigger.** Rejected: a direct call could change a snapshot or skip the confirmation, and the trigger exception would have to be reachable by users.
- **Idempotency through `orders.last_request_id`, through the product id, or through a key in each event.** Rejected: a per-order marker cannot cover a fill of many orders or a register of a product and an order; a fill has no id of its own; scanning events for a replay is slow and the history table must stay pure history.
- **Keep the typed text only in the history event, or in a separate links table.** Rejected: every screen would read events to show "As typed", and a link is one-to-one and never undone, so a column is exact, small and cheaper.
- **Fill every waiting line of the medicine without a reviewed list, or apply the price lazily at invoice time.** Rejected: the supplier must see and confirm the exact lines, and a price must be recorded with an audit entry when it is confirmed, not when an invoice is made.
- **Looser matching (trigram similarity, token containment) or automatic linking.** Rejected: it would propose "Noran 40mg" for "Noran 20mg"; the rules forbid merging a different strength, form or pack size and forbid linking without confirmation.
- **A background job for more than 1,000 waiting lines.** Rejected for now: more machinery than a solo supplier needs; the cap and a repeat step are enough.

## References

- Feature Spec: specs/004-pending-products/spec.md
- Implementation Plan: specs/004-pending-products/plan.md (the ADR suggestion is at its end); research D1 to D10: specs/004-pending-products/research.md; data model: specs/004-pending-products/data-model.md; API: specs/004-pending-products/contracts/api.openapi.yaml
- Migrations: supabase/migrations/0004_pending_products.sql and supabase/migrations/0005_pending_perf.sql (applied to the test project 2026-11-10 and the dev project 2026-11-11)
- Related ADRs: history/adr/0003-order-write-model-and-price-snapshots.md, history/adr/0002-rest-handlers-over-rls-with-client-generated-ids.md
- Evaluator Evidence: specs/004-pending-products/quickstart.md sections 6 and 7 (real test counts, scale times before and after `0005`, isolation and history tests, the owner's phone check with its limits); PHRs history/prompts/004-pending-products/006 to 013
