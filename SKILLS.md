# Synapse — Project Skills

This file packages procedural knowledge for building Synapse, following the format of
the open **Agent Skills** standard (agentskills.io), which originated as Anthropic's
`SKILL.md` format and is now supported across Claude Code, Codex CLI, Gemini CLI, and
Antigravity. Each skill below uses the standard's YAML frontmatter (`name`, `description`)
followed by Markdown instructions, Examples, and Guidelines.

They are kept in one file for now because Antigravity/Gemini CLI loads context via
`GEMINI.md` (with `@file.md` imports) rather than a native per-skill discovery mechanism.
**If you later work on this project with a tool that supports native Agent Skills
discovery (Claude Code, Codex CLI)**, split each block below into its own
`skills/<name>/SKILL.md` folder — the content is already in the correct format to do so
directly, no rewriting needed.

---

```yaml
---
name: supabase-rls-schema
description: Use when creating or modifying any Supabase table for Synapse — ensures every table ships with correct Row Level Security from the start.
---
```
# Supabase Schema + RLS

Every table in Synapse belongs to a single user. No table should ever be created,
or have its schema changed, without a matching Row Level Security policy in the
same migration.

## Instructions
1. Define the table with a `user_id uuid references auth.users` column (directly, or
   indirectly via a parent row that itself has `user_id`, e.g. `checklist_items` via
   `note_blocks` via `notes`).
2. Enable RLS: `alter table <table> enable row level security;`
3. Add policies for `select`, `insert`, `update`, `delete`, each scoped to
   `auth.uid() = user_id` (or the equivalent join for child tables without a direct
   `user_id` column).
4. For child tables (e.g. `checklist_items`, `note_blocks`, `attachments`,
   `note_embeddings`), write the policy as a subquery/join back to the owning `notes`
   or `notebooks` row rather than duplicating `user_id` redundantly, unless denormalizing
   `user_id` onto the child table simplifies the policy (this is done for `note_embeddings`
   in the plan — keep that pattern for any new embedding-adjacent tables).
5. Test with two separate test users locally before considering the migration done.

## Examples
- Adding a `note_versions` table for edit history → needs `user_id` + 4 RLS policies before merging.
- Adding a column to `notes` → does not need new policies, just confirm existing ones still apply.

## Guidelines
- Never ship a migration that creates a table without RLS in the same commit.
- Never rely on client-side filtering (`.eq('user_id', ...)`) as the only protection —
  RLS is the actual security boundary.

---

```yaml
---
name: rag-pipeline-gemini
description: Use when building or modifying the embedding pipeline, the RAG chat Edge Function, or anything that calls the Gemini API for Synapse.
---
```
# RAG Pipeline (Gemini + pgvector)

Synapse's RAG chat depends on two Supabase Edge Functions: `embed-note` and `rag-chat`.
Both are the only places the Gemini API key may ever be referenced.

## Instructions
1. **Never** put the Gemini API key in client code, Expo config, or any file bundled
   into the app. It lives only in the Edge Function's environment/secrets.
2. `embed-note`: given a note ID, fetch its title + text blocks + checklist item text,
   chunk it (block-aware — don't split a checklist item across chunks), call
   `text-embedding-004` per chunk, delete old rows for that note in `note_embeddings`,
   insert the new ones.
3. `rag-chat`: given a user question and an optional `notebook_id` scope, embed the
   question, call the `match_note_embeddings` Postgres RPC (cosine similarity,
   always filtered by `user_id`, additionally by `notebook_id` when scoped), take the
   top-k chunks (default k=6), build a grounded prompt that includes each chunk's
   source note title, call `gemini-2.0-flash`, and return both the answer text and the
   list of source notes.
4. Trigger `embed-note` from the app on note save, debounced (don't re-embed on every
   keystroke).
5. If a note is deleted, its `note_embeddings` rows must cascade-delete (already handled
   via `on delete cascade` in the schema — verify this isn't broken by future migrations).

## Examples
- User asks "what did I write about my car insurance renewal" with no notebook selected
  → global scope → RPC searches across all of the user's `note_embeddings`.
- User asks the same question while inside the "Finance" notebook chat →
  RPC filters `notebook_id = <finance-notebook-id>` in addition to `user_id`.

## Guidelines
- Always cite sources (note titles/ids) in the RAG answer — never return an ungrounded answer.
- Keep chunk size reasonable (~300 tokens) — too large hurts retrieval precision, too
  small loses context within a chunk.
- If retrieval returns zero relevant chunks above a similarity threshold, say so rather
  than letting the model guess from general knowledge.

---

```yaml
---
name: expo-reminders
description: Use when implementing or touching the note reminder / local notification feature.
---
```
# Reminders (expo-notifications)

## Instructions
1. Use `expo-notifications` to schedule a **local** notification at `notes.reminder_at`
   when a reminder is set, and cancel/reschedule it if the date changes or the note is deleted.
2. Store the scheduled notification's identifier so it can be cancelled later
   (either in local state/AsyncStorage, or recompute deterministically from `note_id`).
3. On notification tap, deep-link into the specific note screen.
4. Request notification permissions at the point the user first sets a reminder, not
   on app launch — ask for permission at the moment of relevance.

## Examples
- User sets a reminder for tomorrow 9am on a note → schedule local notification →
  user edits the time → cancel old, schedule new → user deletes the note → cancel.

## Guidelines
- This is single-device, one-off reminders only for v1 — no server-side cron, no
  recurring reminders.

---

```yaml
---
name: markdown-notebook-export
description: Use when implementing the notebook download/export feature.
---
```
# Notebook Export (Markdown + zip)

## Instructions
1. Fetch the full notebook tree (sub-notebooks, notes, blocks, checklist items,
   attachment references).
2. Convert each note to a `.md` file: title as `# heading`, text blocks as paragraphs,
   checklists as `- [ ]` / `- [x]` with nesting via indentation.
3. Download attachments from Supabase Storage into an `attachments/` folder, referenced
   by relative path from the note's Markdown.
4. Include a `manifest.json` at the zip root with tags, created/updated dates, and
   notebook hierarchy, so the export is machine-readable too, not just human-readable.
5. Zip client-side (`expo-file-system` + a JS zip library) and hand off to the Android
   share sheet / Downloads folder.

## Guidelines
- Keep the Markdown output clean enough to re-import later if that feature gets built —
  don't embed app-specific IDs directly in the visible Markdown (put them in `manifest.json` instead).

---

```yaml
---
name: dark-theme-per-screen
description: Use for any UI work — ensures the color-per-screen dark design system stays consistent instead of drifting screen by screen.
---
```
# Dark Theme, Color-Coded by Screen

## Instructions
1. Before styling a new screen, check `SYNAPSE_PROJECT_PLAN.md` §5 for the base/accent
   colors already assigned to that screen category (Home, Notebook, Note, Chat).
2. Reuse the shared neutral text/background tokens across all screens — only the
   *accent* color changes between screens, not the whole palette.
3. Use the accent sparingly: primary actions, active states, focus rings, selected
   items — not as a dominant fill color.
4. If a new screen type is added that isn't in the original four, propose a new accent
   color that's visually distinct from the existing ones and update §5 of the plan file.

## Guidelines
- Don't let two different screens converge on visually similar accents — the entire
  point is instant visual disambiguation.
- No pure black (`#000000`) backgrounds — use the specified near-black for depth.
