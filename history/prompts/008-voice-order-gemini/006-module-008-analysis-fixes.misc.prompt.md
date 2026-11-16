---
id: 006
title: Module 008 analysis fixes
stage: misc
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 008-voice-order-gemini
branch: 008-voice-order-gemini
user: ImtiazAli865
command: chat
labels: ["analysis","fixes","spec","plan","tasks","module-008"]
links:
  spec: specs/008-voice-order-gemini/spec.md
  ticket: null
  adr: history/adr/0008-voice-ai-boundary-and-voice-order-creation.md
  pr: null
files:
 - specs/008-voice-order-gemini/spec.md
 - specs/008-voice-order-gemini/plan.md
 - specs/008-voice-order-gemini/research.md
 - specs/008-voice-order-gemini/data-model.md
 - specs/008-voice-order-gemini/contracts/api.openapi.yaml
 - specs/008-voice-order-gemini/quickstart.md
 - specs/008-voice-order-gemini/tasks.md
 - history/adr/0008-voice-ai-boundary-and-voice-order-creation.md
tests:
 - none (documentation only)
---

## Prompt

"Yes, apply the fixes" (translated from Roman Urdu; the owner's answer after the analysis report of PHR 005)

## Response snapshot

- Applied the eleven findings of the analysis:
  - H1: `scripts/check-secrets.mjs` forbids the name `GEMINI_API_KEY` anywhere under `src/`, which would fail lint at the Gemini client task. T003 now changes the guard to allow that name in exactly one file (`src/lib/voice/gemini.ts`) and adds a unit test (`tests/unit/check-secrets.test.ts`) that proves the allowed file passes and any other use fails; T023 runs lint after the client; T063 checks the allow-list; plan and research D18 record it.
  - H2: the per-minute limit now counts AI parses only (spec FR-014, US5 acceptance 5, SC-012, the assumption, plan, research D14, data model, contract, ADR, quickstart, T040, T042, T059); the simple reader is never counted, so the fallback always works.
  - M1: the spec edge case now matches the plan: a quantity returned as text refuses the whole answer, a numeric but doubtful quantity is flagged.
  - M2: T044 (the tab copy of the transcript and preview) moved into User Story 1; T021 tests a refresh on the preview.
  - M3: a `rate_limited` diagnostic is recorded at most once per minute per business (spec FR-035, data model, T009, T038, T040).
  - M4: new task T070 shows a read-only, dismissible "What you said" box on the manual order screen after "Take this order by hand"; T039 tests it.
  - M5: T019 and T021 now test that a voice draft can be edited, confirmed (snapshots as for a manual order), cancelled and given an invoice draft.
  - L1 to L4: the quickstart mapping uses real spec names; T021 counts the 5 taps of SC-001; T039 and T059 cover a double tap on Parse and a create repeated after a dropped connection; one UI name, "Use the simple reader", is defined in FR-033 and used everywhere.
- Tasks now number 70 (US1 16, US2 6, US3 10, US4 4, US5 5, US6 4); task IDs stay stable and a note in the header explains the moved and added ones.
- The write was checked by searching for stale wording (none left) and for duplicate task IDs (none).
