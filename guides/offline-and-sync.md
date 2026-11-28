# Working without the internet

The app keeps working in the field when the signal is gone. This guide says exactly what works, what does not, and how to tell what has reached the server.

## What works offline

- **Taking orders**: choose a store (or add a new one on the spot), search medicines, use the "usual medicines" and "repeat last order" shortcuts, type a medicine that is not in the catalog, change quantities, add a note. Each change is saved on the phone at once.
- **Recording a cash payment** from a store (Offline home → **Record payment**). It follows the same rules as online: an amount above zero, a date not in the future and not before 2000-01-01, an optional reference.
- **Sync status**: Settings → Sync and backup shows what is waiting, what is being sent and what needs your decision.
- **Backup and restore** of what is on the phone.

## What needs the internet (and says so)

Issuing an invoice (with or without a payment received now), reversing an entry, opening balances, adjustments, store statements, reports, products, the market list, pending prices and imports. Offline, these screens say "This needs the internet" and offer to take an order instead. A store's amount owed is **never** shown without the internet, because the phone does not keep it.

## How waiting items are sent

Everything made offline stays on the phone **until the server confirms it**. It is shown as *waiting*, never as saved on the server before that.

- It is sent automatically, one item at a time, **only while the app is open** and the connection is back. Tries wait 2 seconds, 5, 15, 45 and then 2 minutes.
- Orders are sent in the order they were first changed. Payments are sent in the order they were recorded, **store by store**: a payment that is waiting for its retry holds back the later payments of the same store only, never another store's.
- A store made offline is created on the server **before** its orders and payments are sent.
- Every payment has a key made on the phone before anything is sent, so sending it twice records it **once**. After a lost answer or a restart the same key is sent again and the server answers "already recorded".
- Several tabs of the same phone: only one tab sends. A payment is never sent from a different business's sign-in.

## When the server refuses something

The item stays on the phone, marked **Needs your attention**, with the reason. Nothing is dropped and nothing is sent again by itself.

| What happened | What you see | What you can do |
|---------------|--------------|-----------------|
| The order was changed elsewhere | "Needs your decision" with both versions | keep the phone version, keep both, or accept the server's |
| A payment for a store that is not on the server | "This store is not on the server." | try again later, or remove it after a question |
| A payment key that already holds other details | "A payment with this key but other details already exists. Check the store's account." | remove it after a question (check the account first) |
| A payment the server refused for its date or amount | the server's reason | **Correct the details** and send again with the same key |

Removing a payment always asks first, names the amount and the store, and says it cannot be undone. A payment that was **sent and has no answer** cannot be removed: it may already be on the server, so it can only be sent again.

## Balances while a payment waits ("pending sync")

When you are online and a payment still waits on the phone, every balance you see is the server's balance and **does not include it**. The store's account screen, the Store accounts list, Home and the Reports balances all say so ("1 payment waiting on this phone, PKR 5,000.00, not counted yet" and a **Pending sync** label). The invoice print and the store statement never carry that note: they show only what the server has recorded. When the server confirms the payment the note disappears and the balance is read again.

## Store prices without the internet

The phone keeps each store's own selling prices (never a purchase price, MRP or cost), refreshed with the medicine list. Offline, an order of a store shows its rate; a price you type is kept with the order, and **Remember for this store** is applied when the order reaches the server. If the rate on the server changed meanwhile, it is not overwritten and the app says so. Prices are checked again when you confirm the order, which needs the internet.

## The address must be secure

The app keeps its own files on the phone so a reload works without the internet. A browser only allows that on a **secure address**: `https://...`, or `localhost` on the same computer. On a plain `http://192.168...` address the offline mode **cannot start**, and the app says so at the top of the screen ("Offline mode cannot start on this address because it is not https."). Orders and payments still work while the signal is on. For real use, use the https address of the app.

For a trial on a phone before the app is deployed, Chrome has a flag that treats one http address as secure: open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add the address (for example `http://192.168.1.4:3000`), set it to Enabled and restart Chrome. Turn it off again afterwards. This is for a trial only.

## Honest limits

- Waiting items live **on one phone**. Another device does not see them until they are sent.
- Sending happens only while the app is open on the phone. If you close the app with items waiting, open it again to send them.
- Clearing the browser's data or the app's data on the phone deletes what is waiting. Settings → **Clear device data** warns first and offers a backup file (see `backup-and-restore.md`).
- The phone keeps lists of medicines and stores that are refreshed when you are online; they can be a day old.
- A payment recorded on a phone whose date is wrong (a clock one day ahead) is refused by the server; correct its date on the conflict card.
