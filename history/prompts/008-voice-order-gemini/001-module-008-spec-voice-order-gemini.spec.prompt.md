---
id: 001
title: Module 008 spec voice order Gemini
stage: spec
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 008-voice-order-gemini
branch: 008-voice-order-gemini
user: ImtiazAli865
command: sp.specify
labels: ["spec","voice","gemini","speech-recognition","module-008"]
links:
  spec: specs/008-voice-order-gemini/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/008-voice-order-gemini/spec.md
 - specs/008-voice-order-gemini/checklists/requirements.md
tests:
 - none (specification only)
---

## Prompt

"Module 008 spec" (the owner's answer when asked which module to start next, after Module 007 was merged)

Before writing the spec the assistant asked four questions; the owner answered (translated from Roman Urdu):

1. Gemini key: "I have a paid key." (the owner puts it in the environment themselves; the key is never shared in chat)
2. Spoken language: "A language choice next to the microphone." (English or Urdu ur-PK, remembered on the device)
3. When Gemini is unavailable: "A simple rule-based parser plus manual entry."
4. Scope on the order screen: "Microphone, transcript, preview, correction, draft order."

The feature description given to `/sp.specify` was written by the assistant from the master prompt (Section 6 and Sections 7A, 8 and 17) and these four answers; it is recorded in the Input line of the spec.

## Response snapshot

- Read the master prompt voice section, the constitution voice and AI rules, and the Module 003 order spec; confirmed that the orders table already allows the source "voice" and that `.env.example` has no Gemini placeholders yet.
- Created branch `008-voice-order-gemini` and the spec folder (the create script printed the same parameter warning as for Module 007, but the branch and folder were created; it was run once).
- Wrote the spec: 6 user stories (speak an order and get a draft; doubtful items shown and never guessed; failures never block or lose an order; language choice and honest browser support; nothing sensitive leaves the supplier's control; correct and parse again), 14 edge cases, 43 functional requirements, 14 success criteria, assumptions and out of scope.
- Key rules: the AI only turns words into a draft list; matching is done by application code; "matched" only for an exact name match to exactly one active medicine, everything else is "choose one" with nothing preselected; only the transcript is sent to the AI; the preview creates a draft only on the supplier's tap and never confirms; a rule-based parser and manual entry are the fallbacks; a diagnostic log without secrets or transcripts; automated tests never call the real API.
- Validated against the quality checklist: all items pass, no clarification marker needed.
