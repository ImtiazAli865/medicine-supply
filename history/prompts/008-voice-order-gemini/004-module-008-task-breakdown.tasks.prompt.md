---
id: 004
title: Module 008 task breakdown
stage: tasks
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 008-voice-order-gemini
branch: 008-voice-order-gemini
user: ImtiazAli865
command: sp.tasks
labels: ["tasks","voice","gemini","module-008"]
links:
  spec: specs/008-voice-order-gemini/spec.md
  ticket: null
  adr: history/adr/0008-voice-ai-boundary-and-voice-order-creation.md
  pr: null
files:
 - specs/008-voice-order-gemini/tasks.md
tests:
 - none (planning only)
---

## Prompt

"ADR, then tasks" (translated from Roman Urdu; the same message as in PHR 003, which covered the ADR half; this record covers the tasks half)

## Response snapshot

- Ran the prerequisites script and wrote `tasks.md` with 69 tasks in the checklist format: Setup 5 (baseline, verification of the Gemini and browser speech facts against current documentation, `.env.example` placeholders, test helpers, the fake Gemini server and Playwright config), Foundational 9 (failing database tests first, migration `0009_voice_orders.sql` in four parts, the shared TypeScript layer, and an owner step to apply the migration to the TEST project), US1 15, US2 6, US3 10, US4 4, US5 5, US6 4, Polish 11 (concurrency, scale, layout, README, honesty sweep, AI boundary review, full verification, and the owner-gated DEV apply, phone walkthrough and pull request).
- Rules written into the file: no real key anywhere and no test may call the real service (a guard in the Gemini client refuses the real host in the test environment); no price, balance or invoice data in any voice request, response, screen or log; no new packages; copy migration function bodies instead of retyping them and show the diff of `order_save` (three changes only); stop at T014 to ask the owner to apply the migration to the TEST project; the real Gemini call and microphone are the owner's check, recorded as reported, not seen unless evidenced.
- Priority order: the two safety stories (doubtful items, failures) come before language, privacy and correction because a wrong medicine and a lost order are the worst outcomes.
