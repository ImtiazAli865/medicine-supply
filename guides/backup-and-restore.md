# Backup and restore

Settings → **Sync and backup** has **Export backup** and **Import backup**. A backup is one small JSON file, made on the phone and saved by the browser's download.

## What the file holds

- Your **stores** and **orders** with their lines (typed medicines too), exactly as the server has them when you are online.
- The **orders and new stores still waiting** on this phone, and the **cash payments still waiting** on this phone. A waiting payment is only what was typed: the store, the amount, the date, the reference and the payment's key. Nothing else.
- If you export without the internet, the file holds only what the phone has, and the screen says so ("This file was made offline").

## What it never holds

Prices of any kind (purchase price, MRP, selling price), costs, margins or profit, invoices, balances, ledger entries, passwords, keys, tokens or the sign-in cookie. The app refuses to read a file that contains any of these, and its tests check every file it makes.

## When to export

- Before **Clear device data** and before signing out when items are waiting. Both warn you and offer **Export backup** on the spot.
- Once a day if you work with the signal off for long stretches.

After exporting, the screen says what is in the file, for example "2 payments, PKR 7,500.00 are in this file."

## How to restore

1. Sign in with the **same business** that made the file (a file of another business is refused).
2. Settings → **Import backup** → choose the file. Restoring needs the internet, because the file is compared with what the server holds first.
3. Read the **Import preview**. It changes nothing until you press **Import**. It lists, payments first:
   - **Will be added to this phone**: new items (an order that never reached the server, a store that is not there, a payment this phone does not have).
   - **Already on the server** or **already on this phone**: skipped.
   - **Different** (nothing is replaced): the server copy or the phone copy is newer. The server's data is never overwritten.
   - **Cannot be restored**: for example a confirmed order, which needs the prices on the server.
4. Press **Import**. The restored items join the normal waiting list and are sent like anything else.

Restoring the same file twice adds nothing the second time.

## Payments and duplicates

A restored payment keeps its **original key**. If the server already holds that payment (for example because its answer was lost before the phone was cleared), sending it again is a **repeat of the same payment**, so the server records it **once**. The preview says "The server records each payment once: a payment it already holds is not recorded again." A payment already waiting on the phone is kept exactly as it is and never doubled.

## Older files

A file made before payments existed (version 1) still restores exactly as before and simply has no payments. A file made by a newer version of the app than the phone has is refused with "This backup was made by a different version of the app and cannot be read."

## The restore drill

The restore was only partly tried on real data so far:

> Result (2026-11-25, reported by the owner, not seen): importing a backup file on the phone did **not** add a payment that was already waiting there a second time. The full drill below (clear the phone's data first, then restore into the empty phone, then send) is **not yet done**.
