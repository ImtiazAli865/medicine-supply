---
id: 003
title: Module 008 ADR voice AI boundary
stage: misc
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 008-voice-order-gemini
branch: 008-voice-order-gemini
user: ImtiazAli865
command: sp.adr
labels: ["adr","voice","ai-boundary","order-writer","module-008"]
links:
  spec: specs/008-voice-order-gemini/spec.md
  ticket: null
  adr: history/adr/0008-voice-ai-boundary-and-voice-order-creation.md
  pr: null
files:
 - history/adr/0008-voice-ai-boundary-and-voice-order-creation.md
tests:
 - none (documentation only)
---

## Prompt

"ADR, then tasks" (translated from Roman Urdu; the owner's answer when asked whether to write the suggested ADR first or go straight to tasks)

## Response snapshot

- Wrote ADR-0008 by hand (no script), in the same structure as ADR-0007: scope, status (accepted at the plan stage, nothing implemented), the significance checklist, eight decisions (the AI only reads words; the AI never decides what a word means; the answer is validated and a wrong shape is refused whole; nothing exists until the supplier confirms; one order writer extended with two parameters; failures never block an order; diagnostics without secrets plus a database spend guard; secrets and tests), positive and negative consequences, eleven rejected alternatives and references.
- No new ADR beyond the one the owner asked for.
