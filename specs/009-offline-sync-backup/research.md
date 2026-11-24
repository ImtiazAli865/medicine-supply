# Research: Offline Order Taking, Automatic Sync and Backup (Module 009)

Facts below were read from the code on branch `009-offline-sync-backup` (master 8853c64) unless marked "to verify in a spike". Each decision lists the options considered.

## Facts found in the existing code

- **The server side already has everything a safe sync needs.** `order_save` (migration 0003, called from `PUT /api/orders/{id}`) takes a client-made order id, a `request_id` that is replayed instead of applied twice, and an `expected_version` that answers `version_conflict` with the server's current order. `order_not_editable`, `store_locked`, `store_not_found`, `store_inactive` and `invalid_lines` are returned as readable reasons (`src/lib/orders/repository.ts`). Store creation (`POST /api/stores`) also takes a client-made id and returns the stored record on a repeat, and refuses a similar name with `similar_store` unless `confirm_duplicate` is true (`src/lib/stores/repository.ts`).
- **The autosave state machine already is most of a sync engine** (`src/lib/orders/autosave.ts`): one request in flight, a stable request id reused on retry, edits that arrive during a retry wait, a conflict that keeps the local edits, and `flush()`. What it lacks is durability across a reload, retrying after the screen is closed, and an "on this device" state.
- **Every order screen is a server-rendered page** (`force-dynamic`, `requirePageContext()`), so a reload while offline has no page to show today. The screens themselves (`OrderScreen`, `OrderEditor`, `NewOrderStart`, the Module 008 components) are client components that load their data with `fetchJson` from `/api/...`.
- **The Supabase auth cookie is readable by page scripts** (`httpOnly: false` in `@supabase/ssr` defaults), so the signed-in user can be identified without the network.
- **`.next/static` is 1.7 MB in 49 files**, small enough to keep fully on the device.
- **The slim medicine shape already contains `selling_price`** and nothing secret (`SLIM_MEDICINE_KEYS`); the draft editor shows it as the current price.
- **Tests**: Vitest (unit, integration with real TEST project and PGlite), Playwright against `npm run build && npm run start` on port 3000 with the TEST project. No IndexedDB test double is installed.

## Decisions

### D1. No database migration, no new npm package
- Decision: nothing is added to the database. The queue sends the existing `order_save` and store create. Two small read-only routes are added: `GET /api/ping` (no sign-in, no database; used only to tell whether the server is reachable) and `GET /api/backup/export` (signed-in; reads orders, lines and stores as the user under row level security with an explicit list of safe columns).
- Rationale: idempotency and version checks already exist and are tested. A migration would need the owner's approval and an ADR (number 0011 or higher) and gives nothing here.
- Alternatives: a new SQL function for the export (rejected: plain table reads under row level security are enough and match how Module 008 reads); a service-worker library such as Serwist or an IndexedDB library such as `idb` (rejected: the brief says no package unless proven needed, and a 150-line wrapper and a 120-line worker are enough).

### D2. Device storage: raw IndexedDB, one database per business
- Decision: a small promise wrapper over IndexedDB (`src/lib/device/db.ts`) behind a `DeviceStorage` interface. Database `medsupply-<businessId>` holds that business's data; a second tiny database `medsupply-registry` maps a user id to the business id and name and records which businesses have data on this device. No data of a business is ever written to another business's database.
- Rationale: separating by database name makes "business B never sees business A" a property of the file layout, not of a filter that could be forgotten. Principle VII names IndexedDB; LocalStorage is not used for data.
- Alternatives: one shared database with a `business_id` column and filters (rejected: one missed filter leaks data); LocalStorage (forbidden by the constitution); OPFS or SQLite in the browser (rejected: heavier, no benefit).
- Unit tests use an in-memory implementation of the same interface; the real IndexedDB is covered by Playwright (D12).

### D3. Opening the app offline: a hand-written service worker and a client-only shell page
- Decision:
  - `public/sw.js` (plain JavaScript, about 120 lines) does only two jobs: keep the app files and the shell page, and answer a failed page request.
  - A client-only page `src/app/offline/page.tsx`, outside the `(app)` group, renders the offline app (order list, new order, order screen, Settings sync section) from the device copy. It carries no server data, so it is safe to make public in `src/lib/supabase/proxy.ts`.
  - After a build, `scripts/make-sw-assets.mjs` lists every file in `.next/static` plus the shell route into `public/sw-assets.json` (with the build id). The worker installs by fetching that list into a cache named after the build id and removes older caches when it activates. It calls `skipWaiting()` on install and `clients.claim()` on activate, so the first visit is controlled after one reload and a new build replaces the old worker at once.
  - Navigation requests go to the network first with a 4 second limit; when they fail or time out, the worker answers with a redirect to `/offline?go=<original path>`; the shell page reads `go`, shows the matching screen when it exists offline (`/orders`, `/orders/new`, `/orders/<id>`) or a plain "This needs the internet" page for everything else (invoices, accounts, products, import, reports).
  - Nothing authenticated is ever cached: no page HTML other than the shell, no `/api/` response. API requests are never answered by the worker.
- Rationale: a Next.js server page cannot be replayed from a cache at a different address (its inline payload belongs to its own route), so the fallback must be a different, data-free page. Redirecting keeps the URL honest and lets the normal screens be reused.
- Alternatives: cache whole page responses (rejected: stale authenticated HTML, wrong-route hydration); make the existing `/orders/[id]` page client-only (rejected: it needs the server session check and would change every online test); Background Sync API (rejected: Chromium only and not honest about the app being closed, see D5).
- Spike (first task): confirm in Playwright 1.64 that Chromium honours `context.setOffline(true)` for requests the worker makes. If it does not, the offline tests run against a second `next start` process that the test stops (the origin is then really unreachable for the page and the worker alike). The decision rule is written in the quickstart.

### D4. Who is signed in while offline
- Decision: when online, the app writes `userId -> {businessId, businessName}` to the registry. Offline, the shell reads the user id from the auth cookie (joining its chunks and stripping the `base64-` prefix as `@supabase/ssr` does, then decoding only its `sub` claim, with no trust given to it beyond choosing which device database to open), looks up the business in the registry and opens that business's database. No cookie, no registry entry, or an entry for another user: the shell shows "Sign in to see this device's orders" and no data. Signing out keeps the data on the device (so waiting orders are not lost) and hides it until the same user signs in again.
- Rationale: offline, no server can vouch for the user, so only the device's own cookie decides which partition is shown; every request that reaches the server is still checked with the real session and row level security, so a forged cookie gains nothing.
- Alternatives: call `supabase.auth.getSession()` offline (rejected as the only route: it tries a refresh when the access token has expired and then returns nothing; kept as the preferred route when it answers).
- A "Clear device data" action in Settings deletes the current business's database after warning about waiting items and offering the backup first.

### D5. Writing to the device first: extend the autosave machine, add a sync centre
- Decision:
  1. `createAutosave` gets an optional `journal` (a function that stores the machine's snapshot: local state, base version, the unresolved request with its id, conflict) and an optional `canSend()`. A change is written to the journal before the status `on_device` appears; a failed journal write gives `not_saved` with a plain message and never `on_device`. A new status `on_device` means "kept on this device, the server has not confirmed it". When retries are used up the machine goes to `on_device` (when the journal write worked) instead of `not_saved`. Without a journal the machine behaves exactly as today, so the edit mode of confirmed orders (online only) and all existing unit tests are untouched.
  2. A client singleton `SyncCenter` (`src/lib/device/sync-center.ts`) owns the machines of every draft that has unsynced changes, so they keep retrying after the editor screen is closed. It re-creates machines from the journal at app start, keeps one send at a time per draft, sends drafts in the order they were first changed, applies the backoff, listens to the connection state, pauses on a 401, and exposes the counts for the indicator and Settings.
  3. Only one tab or window sends at a time: a Web Lock (`navigator.locks`) named after the business elects the sender; other tabs show the same state through a BroadcastChannel.
  4. Sending happens only while the app is open. Closing the app stops sending; the next open resumes. The app says so in Settings and next to waiting items.
- Rationale: it reuses a tested machine, keeps the online path identical, and gives ordering, durability and retry in the smallest viable diff.
- Alternatives: write a second, separate queue engine (rejected: duplicates the request-id and conflict logic); make every edit always go through the journal even online (rejected: rewrites every Module 003/008 flow and test for no user benefit); `navigator.serviceWorker` background sync (rejected, see D3).

### D6. Journal record and conflicts on the device
- Decision: one record per draft keyed by order id: the editor state, display info for each line, the base version (null before the first server save), the unresolved request (id, expected version, state sent), the server order last seen, the sync state, the reason, the number of tries, the next try time, the first-changed sequence, and a `rev` counter. Every journal write is a transaction that checks `rev`; a mismatch means another tab changed it, which is shown as a conflict on the device (FR-022).
- A server conflict (`version_conflict`, `order_not_editable`, order missing) keeps the phone version untouched and stores the server's order beside it. The screen shows both and offers: keep the phone version (re-based on the server version, only when the server order is still an editable draft), keep the server version (after a confirmation that names what will be lost), or keep both (the phone lines become a new draft with a new id).
- Order of events never uses the device clock: ordering is by a counter, conflicts by server versions.

### D7. Reads offline: answer the same GET requests from the device
- Decision: `fetchJson` gets a hook. When a GET to a short fixed list of paths fails with a network error (or the shell is active), the hook answers from the device copy with the same JSON shape the route returns and marks the result as coming from the device. The list: `/api/orders/medicines`, `/api/orders/usual`, `/api/orders/repeat`, `/api/stores` and `/api/stores/{id}`, `/api/orders/{id}` (a draft in the journal), `/api/orders` (the drafts on the device only, with a banner). Every other path stays an honest network error.
- Rationale: Module 008's components, hooks and the pure search code then work unchanged, and the Module 008 tests still describe the online behaviour.
- Alternatives: pass a data-source object through every component (rejected: touches about twenty files); do it inside the service worker (rejected: worker code is not typed, not unit-tested and cannot reuse the search code).
- A local answer is never used while the network answers; stale data is labelled ("from the copy updated 09:41").

### D8. What the device copy holds and how it is refreshed
- Decision: the active medicines in the slim shape (including the current selling price already shown by the editor, never a purchase price, MRP or cost); the active stores; for the stores used recently, their usual-medicines answer and last-order plan (so Module 008's usual list, repeat and checklist work offline for those stores); the time of each refresh. Refresh runs when the app opens, when the connection returns, every 10 minutes while open, and on a "Refresh" button; an automatic refresh is skipped when the last complete one is younger than 5 minutes (only the button forces it) and when the storage estimate is above 90% of the quota (a warning is shown instead). "Recently used stores" means the stores of the 20 latest orders plus the stores whose order screens were opened on this device. Accepted: Module 008's own list load still reads from the server on each order screen, so the list may be downloaded twice; the throttle keeps the refresh itself to once per five minutes. The medicine list is fetched completely first and then replaced in one transaction, so an interrupted refresh never leaves half a list.
- Size: about 5,000 medicines at 300 bytes is 1.5 MB; the store and usual data are small. The shell files are 1.7 MB.
- Not cached: invoices, payments, ledger, purchases, balances, any purchase price or MRP.

### D9. Connectivity state
- Decision: `navigator.onLine` is a hint only. The state is "online" after a successful request (of any kind, including `GET /api/ping`) and "offline" after a network failure or a timeout; while offline a ping runs with growing delays and on the browser `online` event. `fetchJson` gets timeouts (GET 15 s, other 20 s) so a hanging connection becomes a normal network failure instead of waiting forever. Sync sends use an `onUnauthorized: "event"` option, so a 401 pauses sending and shows a banner instead of navigating to the sign-in page; every other caller keeps the redirect.
- Rationale: phones report "online" on a Wi-Fi with no internet; only a real answer counts.

### D10. Confirming, cancelling and other money actions stay online
- Decision: while offline, Confirm, Cancel of a confirmed order, Edit of a confirmed order, invoices, payments, purchases and prices show "Needs the internet" and do nothing; the confirm button is disabled with that reason next to it (FR-011, FR-010). A never-sent offline draft can be discarded locally after a confirmation (FR-020); a draft that exists on the server is cancelled only online.

### D11. Backup file
- Decision: one JSON file, `format: "medsupply-backup"`, `version: 1`, with the business id (an opaque id, not a secret), the export time, counts and four lists: stores, orders with their lines (ids, product ids, typed names, quantities, units, status, version and times, no price of any kind), the waiting items from the journal, and the device-copy times. It is built from `GET /api/backup/export` (orders and stores from the server, online only) plus the journal (works offline, then only the waiting items and the cached stores are included and the file says so). Import reads the file, checks the format, version and business id, and builds a preview by comparing with the server (online) and the journal; nothing changes until the supplier confirms. Confirmed import turns waiting items and drafts that are missing on the server into journal drafts that the normal sync sends (so duplicate protection is the same request-id and id rules), creates missing stores through the same idempotent store create, and lists everything else as "already on the server" or "conflict". A confirmed or cancelled order that is missing from the server cannot be created again by import (confirming needs prices); it is listed as "cannot be restored".
- Rationale: import reuses the queue, so there is one path to the server and one place where duplicates are prevented. The file never contains invoices, payments, ledger, purchases or any price (FR-028).
- Alternatives: CSV (rejected: nested lines), a server-side import route (rejected: a second write path), backing up the catalog (out of scope; it is rebuilt from the server).

### D12. Testing offline for real
- Decision: pure logic gets unit tests with in-memory storage, a fake clock and a fake transport (journal, autosave extension, sync centre, backoff, local answers, identity, backup build/parse/preview). Two integration tests use the real TEST project (export route under two businesses; the same save request repeated after a cut connection is replayed, not duplicated). Playwright specs run on the mobile project against the production build and switch the network off with `context.setOffline` after the worker is active (or the stop-the-server fallback from D3); they cover offline reload, ten-line order, restart, sync once, cut during sync, conflicts, two businesses, sign-out, backup round trip, 360 px checks. Nothing offline is claimed in the UI that one of these does not test.
- Owner trial (SC-010) is recorded as reported, not seen.

### D13. Honest wording
- Decision: device-only states say "Saved on this device, not yet sent"; sent and confirmed says "Saved at HH:MM" as today and, in lists and Settings, "Synced". The words "Synced" and a bare "Saved" never appear for an item the server has not confirmed. The app states that the device copy is not available on other devices and is not a safe place if the phone is lost.

## Risks that remain open (carried to the plan)

- The offline emulation of the service worker in Playwright (D3 spike).
- The cookie-based identity offline (D4) depends on cookie lifetime and on the token not being needed; the fallback is "sign in again when online", never a data leak.
- Next.js may change the build output layout; the asset list script reads the directory instead of a manifest, so it does not depend on one.
