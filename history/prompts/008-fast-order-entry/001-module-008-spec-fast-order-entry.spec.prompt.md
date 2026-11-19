---
id: 001
title: Module 008 spec fast order entry
stage: spec
date: 2026-11-19
surface: agent
model: claude-sonnet-5-5
feature: 008-fast-order-entry
branch: 008-fast-order-entry
user: ImtiazAli865
command: /sp.specify
labels: ["spec","fast-order-entry","usual-medicines","repeat-last-order","fast-search","module-008"]
links:
  spec: specs/008-fast-order-entry/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/008-fast-order-entry/spec.md
 - specs/008-fast-order-entry/checklists/requirements.md
tests:
 - none (specification only); the quality checklist was validated in one pass, all items pass
---

## Prompt

Owner messages that led to this stage (translated from Roman Urdu where marked):

1. "End voice, and give me an easy idea for taking medicine orders, so that when the medical store owner says the order, the search in the order is quick; how would that work, I mean faster than writing by hand; give an idea." (translated from Roman Urdu)
2. After the assistant gave five ideas and asked whether to close the voice pull request: "Close voice PR #7 now and keep its branch for later and scoring your idea still score reach 9.5 then continue" (partly translated from Roman Urdu).

The assistant then ran /sp.specify with a feature description for "Module 008 Fast order entry" (usual medicines in one tap, repeat last order, a continuous fast search with Enter-to-add, measurable speed, online only, no AI, no microphone, no new npm packages, no price or financial data, businesses isolated, 360 px touch targets, five navigation items, prefer no migration and number any needed one 0011 or higher). The full description is condensed in the Input line of the spec.

## Response snapshot

- Closed pull request 7 (voice) with a short English comment and kept the branch `008-voice-order-gemini`; switched to `master`; checked that the voice migration 0009 gives `order_save` two trailing parameters with defaults, so the master code still works against the DEV and TEST projects that already have 0009 and 0010.
- Scored the idea on paper before writing the spec (first version about 6.7 of 10; the gaps were the digits-in-a-name versus quantity clash, Enter choosing a wrong strength, no history on day one, copying stale data in a repeat, no measurable targets, and a claim that a text reader already existed on master when it exists only on the voice branch). The spec fixes each gap; the 9.5 is the assistant's own estimate on paper, and the real proof is the counted tests and the owner's trial.
- Created branch `008-fast-order-entry` (the create-new-feature script printed its usual parameter error after creating the branch and the specs folder; it was run once) and wrote the spec: five user stories (repeat last order, usual medicines, a search box that stays, quantity shortcuts, first use and failures), 31 functional requirements, 11 success criteria, edge cases, assumptions and a clarifications section with three defaults. No clarification markers were needed.
- Wrote the quality checklist; every item passes.

## Outcome

- ✅ Impact: A complete, testable spec for faster order taking without voice or AI; the voice work is closed but kept on its branch.
- 🧪 Tests: none (specification only).
- 📁 Files: the spec and the checklist.
- 🔁 Next prompts: owner decision on the migration-number question only if a database change is needed (plan decides); then /sp.plan.
- 🧠 Reflection: the number in a medicine name (a strength) and a typed quantity can be confused; the spec makes the quantity a separate field or an explicit "x" so that no digit is ever guessed.

## Evaluation notes (flywheel)

- Failure modes observed: the earlier chat claim that a text reader could be reused was wrong for master (it exists only on the closed voice branch); corrected in the answer to the owner.
- Graders run and results (PASS/FAIL): quality checklist PASS (single pass, 16 of 16 items).
- Prompt variant (if applicable): none.
- Next experiment (smallest change to try): in the plan, measure the real size and speed of the active-medicine list and of the usual-medicines read on the test project before choosing the limits.
