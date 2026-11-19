# Quickstart: Fast Order Entry

**Date**: 2026-11-19 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

This module needs no database migration, no new package and no new environment variable.

## 1. Run it

```powershell
npm install
npm run dev
```

Sign in with the owner account of the DEV project. Open **New order**, choose a store.

## 2. Automated checks (to be run and recorded in section 6 when implemented)

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Integration tests that need two real users run against the dedicated TEST project (`.env.test.local`, never real data). Stop `npm run dev` before the browser tests (they start their own production build).

## 3. Owner walkthrough on a real phone (DEV project, after the module is built)

Use a store that already has at least two confirmed orders (create them first if needed) and a catalog of at least a few medicines with similar names (for example two strengths of one medicine). Use Chrome on Android.

1. Open **New order** and choose that store. The order screen shows, from top to bottom: the search box, the usual medicines, and (only while the order has no lines) **Repeat last order** with the number of lines and the date. Nothing is added yet.
2. Tap **Repeat last order**. All the old lines appear on the new draft; a message names anything that was left out (try it once after making one medicine inactive). Tap **Undo** within a few seconds: the lines go away. Tap the button again, then confirm the order. Count your taps and the seconds.
3. Start another new order for the same store. Tap three usual medicines, one tap each. Change one quantity with the stepper on its card before adding.
4. In the search box type two letters of a medicine. Results appear while you type. Pick one: the cursor jumps to the quantity, **the phone keyboard stays open**. Type a number and press Enter (the green tick on the keyboard). You are back in the search box, keyboard still open, and the line is on the order. **Report if the keyboard closed or the page jumped at any point.**
5. Type the name of a medicine that has two strengths: no result is highlighted and Enter adds nothing; tap the right strength. Type a name plus its strength: the list narrows to that strength (the number is not a quantity).
6. Type `pan x20` (use a medicine that exists): choose the result; the line is added with quantity 20 at once.
7. Type a name that is not in the catalog: **Add as typed** appears next to the results; add it. The order is never blocked.
8. Turn on airplane mode and tap a usual medicine: the existing "not saved" message appears and nothing says "saved on this device". Turn it off; the change saves.
9. Compare: take a real order the way you do today (by hand) and then with this screen. Report which was faster and by how much (an estimate is fine), the phone and Chrome version, and anything you did not try.

Record what the owner reports as "reported, not seen" unless a screenshot is sent.

## 4. What proves which success criterion

| Criterion | Where it is proven |
|-----------|--------------------|
| SC-001 repeat in three interactions | e2e `fast-repeat` (counts the clicks from store choice to confirmed) |
| SC-002 one tap per usual medicine | e2e `fast-usual` (counts clicks for five cards) |
| SC-003 results within 300 ms for 5,000 medicines | unit benchmark of the filter; e2e `fast-search-scale` (5,000 seeded medicines, timed keystrokes) |
| SC-004 letters, Enter, quantity, Enter, no dialog, cursor back | e2e `fast-search` (keyboard only; asserts no dialog role appears) |
| SC-005 no preselection, no silent wrong strength | unit `fast-search` highlight rule; e2e `fast-search-similar` (several strengths of one name) |
| SC-006 double tap and retry create one draft | e2e `fast-repeat-twice`; integration replay of the repeat save |
| SC-007 no price, MRP, cost, balance or invoice value | static type test, integration test on the raw JSON of the three routes, e2e network assertion on the new requests |
| SC-008 two businesses isolated | integration `fast-order-api` (two real tenants, same names, crafted order id) |
| SC-009 360 px touch targets, five navigation items | e2e `touch-targets` and `shell` extended for the new controls and messages |
| SC-010 each failure has a message and keeps the order | e2e `fast-states` (list fails, usual fails, repeat fails, save fails, offline) |
| SC-011 owner trial | section 3 above, reported by the owner |

## 5. Not covered by any automated test

- The real phone keyboard staying open (the browser tests prove focus moves, not the Android keyboard).
- The owner's real speed compared with handwriting.
- A catalog or order history larger than the sizes measured in section 6.
- Offline use (Module 009) and any use of an outside service (none is used).

## 6. Results (filled in when implemented)

Not yet implemented. Nothing in this module has been run or verified.

| Measurement | Result | Budget |
|-------------|--------|--------|
| Filter time, 5,000 medicines, 8 words | not measured | 20 ms |
| Keystroke to results, 5,000 medicines (e2e) | not measured | 300 ms (95%) |
| Full load of 5,000 medicines (TEST) | not measured | 5 s |
| Usual route, 100 orders of 20 lines (TEST) | not measured | 1.5 s |
| Repeat route, 200 lines (TEST) | not measured | 1.5 s |
