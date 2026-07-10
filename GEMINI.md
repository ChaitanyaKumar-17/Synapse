# Project: Synapse

Synapse is a dark-themed, Android-only, Evernote-style notes app built with Expo
(React Native + TypeScript) and Supabase, with a Retrieval-Augmented Generation (RAG)
chatbot for asking questions across notes instead of manually searching.

Full product spec, data model, design system, and phase-by-phase implementation plan
live in `SYNAPSE_PROJECT_PLAN.md` in this same directory. Treat that file as the source
of truth for scope and architecture. This file governs *how* you work, not *what* to build.

@./SYNAPSE_PROJECT_PLAN.md

For task-specific procedural knowledge (how to write RLS policies, how to structure the
RAG pipeline, how to keep the dark theme consistent, etc.), see `SKILLS.md` in this
directory and load the relevant skill before starting related work.

@./SKILLS.md

## Working Method — Inspect First, Act Second

- Before writing or modifying any code, inspect the current state of the relevant files,
  the Supabase schema, and any prior phase's output. Do not assume what already exists.
- Produce a short status report of what you found and what you plan to do *before*
  generating code, for anything beyond a trivial one-line fix.
- Work phase by phase, exactly as ordered in `SYNAPSE_PROJECT_PLAN.md` §7. Do not start a
  later phase until the current phase's checkpoint has been explicitly approved.
- At the end of each phase, report: what was built, any deviation from the plan and why,
  and what needs approval before continuing.
- If a requirement is ambiguous or missing from the plan, stop and ask rather than
  assuming — the same standard the plan itself was built to.

## General Instructions

- Language: TypeScript everywhere (strict mode). No implicit `any`.
- Framework: Expo (managed workflow) + React Navigation.
- Backend: Supabase — Postgres (with `pgvector`), Auth, Storage, Edge Functions.
  The app queries Supabase directly from the client for data. The only exception is
  calls to the Gemini API, which must go through Supabase Edge Functions so the API key
  never ships inside the app. Do not put any AI provider key in client code, `.env`
  files bundled into the app, or `app.config.*`.
- State management: keep it simple — React Query (or equivalent) for server state,
  local component state / a lightweight store (Zustand) for UI state. Avoid introducing
  a heavier state library unless a real need shows up.
- Every new Supabase table ships with Row Level Security policies in the same migration
  that creates it. No table should ever be created without RLS scoped to `user_id = auth.uid()`.
- Follow the color-per-screen dark theme described in `SYNAPSE_PROJECT_PLAN.md` §5.
  Do not introduce new accent colors ad hoc — check the design system section first.

## Coding Style

- Functional components, hooks-based. No class components.
- 2-space indentation.
- Prefer small, focused components/files over large monolithic screens.
- Co-locate a screen's local components with that screen unless they're reused elsewhere.
- All new functions/exported types get a short doc comment explaining intent, not just
  restating the signature.
- Prefer explicit, readable code over clever one-liners — this codebase will be read and
  extended by both humans and other agents.

## Commits / Change Size

- One phase (or one checkpoint within a phase, for larger phases) = one reviewable
  chunk of work. Avoid bundling unrelated changes together.
- Flag any deviation from the schema or architecture in `SYNAPSE_PROJECT_PLAN.md` clearly
  — don't silently change the data model.
