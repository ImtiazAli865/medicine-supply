---
id: 002
title: Constitution module list voice dropped
stage: constitution
date: 2026-11-19
surface: agent
model: claude-sonnet-5-5
feature: none
branch: 008-fast-order-entry
user: ImtiazAli865
command: constitution amendment (PATCH 1.0.1)
labels: ["constitution","amendment","module-list","voice-dropped"]
links:
  spec: null
  ticket: null
  adr: null
  pr: https://github.com/ImtiazAli865/medicine-supply/pull/8
files:
 - .specify/memory/constitution.md
tests:
 - none (documentation only)
---

## Prompt

Owner messages that led to this change:

1. "* Constitution ki list mein abhi bhi “008 voice” likha hai. Isay badalna aap ka faisla hai. ... ye kaam continue kren" (translated from Roman Urdu: "The constitution's list still says '008 voice'. Changing it is your decision. ... continue this work")
2. Answer to the question about the wording: "008 fast order entry; voice later (Recommended)"

## Response snapshot

- The amendment needed the owner's explicit approval (Governance), so the wording was asked first. The owner chose: list "008 fast order entry; 009 offline/sync; 010 reports; 011 hardening", with a sentence that voice ordering was dropped on 2026-11-19, its work is kept on the branch `008-voice-order-gemini`, and it may return as a later module with its own spec and approval.
- Changed only the module list in "Development Workflow & Quality Gates", the Sync Impact Report (version 1.0.0 to 1.0.1, PATCH, with the reason) and the version line. No principle was added, removed or redefined.

## Outcome

- ✅ Impact: The constitution matches the project's real module plan; the flag raised in the Module 008 plan, tasks and pull request is resolved.
- 🧪 Tests: none (documentation only).
- 📁 Files: `.specify/memory/constitution.md`.
- 🔁 Next prompts: none needed.
- 🧠 Reflection: asking for the exact wording before editing kept the amendment within the owner's decision.

## Evaluation notes (flywheel)

- Failure modes observed: none.
- Graders run and results (PASS/FAIL): none.
- Prompt variant (if applicable): none.
- Next experiment (smallest change to try): none.
