---
id: 007
title: Module 010 verification on TEST and commit
stage: misc
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 010-reports-profit
branch: 010-reports-profit
user: ImtiazAli865
command: (verification, then commit)
labels: ["reports","profit","verification","commit","module-010"]
links:
  spec: specs/010-reports-profit/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/010-reports-profit/quickstart.md (section 5 results)
 - specs/010-reports-profit/tasks.md (58 of 61 ticked)
 - src/app/(app)/page.tsx (Home card wording fixed)
 - tests/integration/reports-scale.test.ts (cold call measured on its own; own data removed in batches)
 - history/prompts/010-reports-profit/007-module-010-verify-and-commit.misc.prompt.md
tests:
 - reports-api 9/9 on the TEST project; reports browser tests 37/37
 - npm test 1,659 of 1,660 (the one failure fixed); Playwright 520 passed, 11 failed, 10 passed alone, 1 real defect fixed; 42/42 on the Home-related specs afterwards
 - lint, typecheck and build passed
---

## Prompt

Owner messages in this stage (translated from Roman Urdu):

- "Yes, I ran it" (the owner applied `0011_reports.sql` to the TEST project).
- The assistant's own scheduled follow-up prompts to read the logs (not the owner's words).
- "Commit karo" (written in Roman Urdu in the owner's message; meaning: "Commit it").

## Response snapshot

Ran every check that needs the TEST project: the API test, the 37 report browser tests, the 5,000-invoice speed test, the whole `npm test` and the whole Playwright suite. Found and fixed two of the assistant's own mistakes: the speed test left 250,000 order lines on the shared TEST project (removed in small batches, only the businesses named `reports-scale business`, and the test now cleans up after itself), and the new Home card said "profit", which breaks the existing rule that Home names no purchase, cost, margin or profit (the card now says "Your sales and what stores owe."). Recorded the honest speed numbers (warm medians 1.3 to 2.0 s, cold first call 3.1 to 4.8 s, thin margin). Committed on branch `010-reports-profit` in two commits (documents, then code and tests). Nothing was pushed and nothing was applied to the DEV project.

## Outcome

- ✅ Impact: Module 010 is committed locally; tasks T059 (DEV approval), T060 (owner phone trial) and T061 (pull request) stay open.
- 🧪 Tests: see the front matter; the whole suites were not rerun after the last two small fixes.
- 📁 Files: see the front matter.
- 🔁 Next prompts: the owner's phone trial; the owner's yes before 0011 goes to DEV; push and pull request only when the owner says; optional ADR and constitution wording clarification.
- 🧠 Reflection: a scale test on a shared hosted project must clean up its own bulk data and must not trust a helper that ignores delete errors.

## Evaluation notes (flywheel)

- Failure modes observed: see the response snapshot (leftover bulk data; a wording rule found only by the full browser suite).
- Graders run and results (PASS/FAIL): as in the front matter.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): make `deleteTenant` fail loudly (or batch) when a delete errors, so a leftover can never stay unnoticed.
