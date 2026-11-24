---
id: 007
title: Module 009 phone trial, PR and ADR
stage: misc
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 009-offline-sync-backup
branch: 009-offline-sync-backup
user: ImtiazAli865
command: /sp.adr offline-first-device-sync
labels: ["offline","owner-trial","pull-request","adr","module-009"]
links:
  spec: specs/009-offline-sync-backup/spec.md
  ticket: null
  adr: history/adr/0008-offline-first-device-sync.md
  pr: https://github.com/ImtiazAli865/medicine-supply/pull/9
files:
 - specs/009-offline-sync-backup/quickstart.md (section 5 step 0, section 6 owner trial and checks before the PR)
 - specs/009-offline-sync-backup/tasks.md (T074 and T075 ticked)
 - history/adr/0008-offline-first-device-sync.md
 - history/prompts/009-offline-sync-backup/007-module-009-phone-trial-pr-and-adr.misc.prompt.md
tests:
 - npm run lint (with secrets check), npm run typecheck, npm run build: passed on 2026-11-24
 - npm test: 151 files, 1,511 tests, all passed (1,363 s) on 2026-11-24
 - owner's airplane-mode walkthrough on a real Android phone (reported, not seen; screenshots seen)
---

## Prompt

Owner messages in this stage (all translated from Roman Urdu), in order:

- "I am not entering the password" and then "'Incorrect email or password' appears, I cannot log in".
- "Where can I check my password?"; then a screenshot of the Supabase Users page of the TEST project (only automated test accounts); then a screenshot of the DEV project user page with "when I click Send password recovery an email comes for the reset, but then the same error appears".
- "The run succeeded now" (after a password was set by the owner in the DEV project's SQL editor), then "login is done, what do I check now?".
- "When I switch flight mode on and refresh, Chrome says offline, and as soon as I tap Home or Orders at the bottom the no-internet error comes", then a screenshot of Chrome's "No internet" page after a reload.
- "Even with airplane mode on, the New order, Orders on this phone and Sync status buttons show, and I tapped New order and took an order and the order was done"; screenshots of the offline page, the offline order screen, Settings (Sync and backup), the Stores "This needs the internet" page and the offline Orders list; "Products and Stores show 'This needs the internet', Home is the first screenshot, Orders is the third image".
- "I switched Wi-Fi on to use WhatsApp, so that may be the time difference, and the order is there only once; paper took 15 seconds more", corrected to "no, paper took more time, but in the app the time was less"; "yes, I closed Chrome and opened it again and the order was saved".
- "Commit the working tree changes with a sensible message."; "stop the phone server and push, we will do the rest tomorrow".
- A pasted list of the remaining work (update the branch from master, rerun lint, typecheck, test and build, then open the PR; the ADR `/sp.adr offline-first-device-sync` with the owner's permission; switch the phone's Chrome flag off; say whether the DEV test order should be cancelled or deleted) followed by "continue now".
- "Yes, write it" (the answer to the offer to create the ADR), which started `/sp.adr offline-first-device-sync`.

No password or key was typed into the chat or by the assistant at any point.

## Response snapshot

Helped the owner reach a signed-in phone without handling any password (the TEST and DEV Supabase projects were told apart; the app has no password-reset page, so the owner set a new password in the DEV project's own SQL editor). Found why the phone showed Chrome's "No internet" page (the address was not treated as secure, so no service worker started), checked on the computer's Chrome at `localhost` that the worker registers, activates and keeps all 54 files, and the owner then set Chrome's insecure-origin flag correctly. Recorded the owner's trial in quickstart section 6 as reported, with the screenshots that were seen, corrected the time comparison after the owner clarified it (the app was faster than paper by about 15 seconds), and ticked T074 after the owner reported the close-and-reopen step. Committed and pushed, stopped the LAN server (the first stop left the node process running; it was stopped by process id and port 3000 was checked to be free). Updated nothing from master (the branch was level), reran lint, typecheck, build and the full unit and integration tests (all passed), recorded the results, opened PR 9 and ticked T075. After the owner's consent, wrote ADR-0008 for the offline-first device sync cluster by hand because `create-adr` is not in this repository.

## Outcome

- ✅ Impact: SC-010 confirmed by the owner's report; PR 9 open and not merged; ADR-0008 written.
- 🧪 Tests: see the front matter; a clean full Playwright run after the last two test edits was not done and is stated in the PR and the quickstart.
- 📁 Files: see the front matter.
- 🔁 Next prompts: commit and push the ADR and this PHR when the owner says; merge of PR 9 is the owner's decision; the owner still has to switch the phone's Chrome flag off and say whether to cancel or delete the DEV test order.
- 🧠 Reflection: the first plan of the trial did not say that a service worker needs a secure address; the owner lost time on the dinosaur page. The need is now in quickstart step 0 and in the ADR. An in-app warning would have saved it.

## Evaluation notes (flywheel)

- Failure modes observed: misread a Roman Urdu sentence about the time comparison (paper versus app) and recorded it backwards; corrected on the owner's reply. The reset email link of the app cannot work because the app has no reset page.
- Graders run and results (PASS/FAIL): lint PASS, typecheck PASS, build PASS, npm test PASS (1,511 tests); owner trial reported as passing.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): add an in-app notice when the browser cannot start the offline worker, and a small module for "forgot password".
