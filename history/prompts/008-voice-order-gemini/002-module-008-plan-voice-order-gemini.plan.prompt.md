---
id: 002
title: Module 008 plan voice order Gemini
stage: plan
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 008-voice-order-gemini
branch: 008-voice-order-gemini
user: ImtiazAli865
command: sp.plan
labels: ["plan","research","data-model","contract","voice","gemini","module-008"]
links:
  spec: specs/008-voice-order-gemini/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/008-voice-order-gemini/plan.md
 - specs/008-voice-order-gemini/research.md
 - specs/008-voice-order-gemini/data-model.md
 - specs/008-voice-order-gemini/contracts/api.openapi.yaml
 - specs/008-voice-order-gemini/quickstart.md
tests:
 - none (planning only)
---

## Prompt

"The spec is fine, plan" (translated from Roman Urdu; the owner's answer when asked whether the spec was fine or /sp.clarify should run)

## Response snapshot

- Ran the plan setup script, read the spec, the constitution (Principles V to VII), the existing order functions (`order_save`, `order_to_json`, `orders_guard`), the product and store search indexes, the order API and validation, the medicine search component and the error taxonomy.
- Findings that shaped the plan: `orders.source` already allows `voice` but `order_save` always writes `manual`; `pg_trgm` and a trigram index on medicine and store search text already exist; `.env.example` has no Gemini entries; the Playwright config passes only two env values to the app.
- Wrote research (19 decisions and 5 risks), data model (one new column, an extended `order_save`, two tables, five new functions, migration `0009_voice_orders.sql`), the API contract (parse, diagnostics, the extended order save), the quickstart (including the owner's phone walkthrough with their paid key and the Section 6 and 17 mapping) and the plan with a concrete source tree.
- Key decisions: a panel on the New order screen; a client speech interface and a server parser interface with Gemini through the built-in `fetch` (no new packages) and a pure rule-based fallback; matching facts from SQL but the matched or choose-one decision in one TypeScript function (matched only for exactly one exact candidate); a pure preview reducer; the tab-only `sessionStorage` copy; creation through the existing idempotent order save extended with `p_source` and `p_spoken_text`; an append-only diagnostic log without transcripts or secrets; a database rate limit (20 per minute); tests with a fake speech engine and a local fake Gemini server plus a guard against the real host.
- Constitution check: all eight gates pass, with the same Module 009 offline deferral as earlier modules. The agent-context update script was not run (CLAUDE.md has not been changed by it since Module 003).
- Noted for the owner: an ADR is suggested for the AI boundary decisions; it is not created without consent.
