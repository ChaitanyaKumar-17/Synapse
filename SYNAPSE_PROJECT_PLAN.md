# Project Plan: Synapse — Dark, RAG-Powered Notes App

> Handoff document for AI coding agents (Antigravity / Claude Code / Codex).
> Follow the **inspect-first, act-second** pattern: before starting any phase, the agent
> should read the relevant section below in full, confirm understanding of the schema/
> contracts it depends on, and only then generate code. Each phase ends with an
> approval checkpoint before moving to the next.

---

## 1. Product Idea

A single-user, Android notes app (Evernote-style) with:
- Notebooks (with sub-notebooks/sections) containing Notes.
- Notes support rich content: text blocks, nested checklists, images, and file attachments.
- User-created Tags attached to notes for filtering.
- Simple date/time reminders per note.
- A **RAG chatbot** that can answer questions using the content of one notebook (scoped)
  or across all notebooks (global), instead of the user manually searching.
- Notebook export/download (Markdown + attachments, zipped).
- A dark, minimalist, but visually distinct UI — each major screen (Home, Notebook, Note)
  has its own accent color so the user can tell where they are at a glance.

Platform: **Android only**. Backend: **Supabase** (Postgres + Auth + Storage), queried
directly from the app — with one deliberate exception (see §4.4) for protecting AI API keys.

---

## 2. Key Decisions Made (from requirements discussion)

| Area | Decision |
|---|---|
| Auth | Email/password only (Supabase Auth) |
| Platform | Android only |
| Attachments | Images + files (PDF, docs) allowed on notes |
| Notebooks | Nested (notebooks can contain sub-notebooks/sections) |
| Checklists | Nested (sub-items under items), plus separate free-text blocks |
| Search | Tag filter + keyword/text search + date/notebook filters, all combinable |
| RAG scope | Both global (all notebooks) and per-notebook chat |
| Sharing/collab | None — single-user app. Instead: notebook **export/download** |
| Reminders | Simple one-off date/time reminder per note (local notification) |
| Theme | Dark, minimalist, one distinct accent color per major screen/section |

## 3. Decisions Made by Agent (flagged for your review/override)

| Area | Recommendation | Why |
|---|---|---|
| Online/offline strategy | **Online-first with a lightweight local cache**, not full offline-first sync | Full offline-first (local DB + conflict resolution + sync engine) is a large, error-prone effort for a single-user app. A read-through cache (last-opened notebooks/notes stored locally via MMKV/AsyncStorage) gives snappy re-opens and lets the app show stale content briefly while offline, without building a sync engine. Writes require connectivity. Revisit only if you regularly use the app with no signal for long periods. |
| AI provider | **Google Gemini** — `text-embedding-004` for embeddings, `gemini-2.0-flash` for chat generation | You mentioned Gemini Pro access; Gemini also has the most generous free tier for embeddings + fast chat, and both embedding and generation live in one ecosystem, simplifying setup. |
| Vector storage | **Supabase Postgres + `pgvector` extension** | Keeps everything in one database, no separate vector DB service, and Supabase supports pgvector natively with an RPC function for similarity search. |
| Framework | **Expo (React Native, TypeScript)**, not bare RN CLI | Expo's built-in modules (`expo-notifications`, `expo-file-system`, `expo-document-picker`, `expo-image-picker`) cover reminders, file attachments, and export without hand-rolling native modules — faster to build and matches your "AI-assisted / vibe-coded" workflow. |
| Export format | **Markdown per note + a manifest**, zipped per notebook (`notebook-name.zip` containing `.md` files, an `attachments/` folder, and a `manifest.json` with tags/dates) | Markdown is portable, human-readable, diff-able, and matches the Markdown-centric workflow you already use for agent prompts. PDF export can be a later addition (Phase 8+ stretch). |
| AI key protection | Route Gemini calls (embedding + chat) through a **Supabase Edge Function**, not directly from the app | The app queries Supabase directly for data (as requested), but calling Gemini directly from the client would expose the API key inside the APK. A thin Edge Function acts purely as a secure proxy — it does not change your "direct Supabase" data model, it only shields the one secret that can't safely live on-device. |

If any of these don't match your intent, flag it before Phase 4 (RAG) or Phase 6 (export) — those are the phases that depend most on these choices.

---

## 4. Architecture

### 4.1 High-level
```
┌─────────────────────────────┐
│      Android App (Expo)     │
│  React Native + TypeScript  │
│  - Zustand/Redux (state)    │
│  - React Navigation         │
│  - Supabase JS client       │
└───────────┬─────────────────┘
            │ direct queries (CRUD, RLS-protected)
            ▼
┌─────────────────────────────┐
│         Supabase            │
│  - Postgres (+ pgvector)    │
│  - Auth (email/password)    │
│  - Storage (images/files)   │
│  - Edge Functions:          │
│     • embed-note            │
│     • rag-chat               │
└───────────┬─────────────────┘
            │ server-side only, key never on device
            ▼
┌─────────────────────────────┐
│      Google Gemini API      │
│  text-embedding-004         │
│  gemini-2.0-flash           │
└─────────────────────────────┘
```

### 4.2 Data model (Supabase / Postgres)

```sql
-- Users handled by Supabase Auth (auth.users)

create table notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  parent_notebook_id uuid references notebooks(id), -- null = top-level
  name text not null,
  accent_color text,           -- optional per-notebook color override
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  notebook_id uuid references notebooks(id) not null,
  title text not null default 'Untitled',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  reminder_at timestamptz         -- nullable
);

-- Block-based content: each note is an ordered list of blocks (text or checklist group)
create table note_blocks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references notes(id) on delete cascade not null,
  block_type text not null check (block_type in ('text','checklist')),
  order_index int not null,
  text_content text            -- used when block_type = 'text'
);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  block_id uuid references note_blocks(id) on delete cascade not null,
  parent_item_id uuid references checklist_items(id), -- null = top-level item, else nested sub-item
  content text not null,
  is_checked boolean default false,
  order_index int not null
);

create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  color text,
  unique(user_id, name)
);

create table note_tags (
  note_id uuid references notes(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  primary key (note_id, tag_id)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references notes(id) on delete cascade not null,
  storage_path text not null,   -- path in Supabase Storage bucket
  file_type text not null,      -- 'image' | 'file'
  file_name text not null,
  created_at timestamptz default now()
);

-- RAG: chunked, embedded note content
create extension if not exists vector;

create table note_embeddings (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references notes(id) on delete cascade not null,
  notebook_id uuid references notebooks(id) not null,
  user_id uuid references auth.users not null,
  chunk_text text not null,
  embedding vector(768),        -- text-embedding-004 dimension
  created_at timestamptz default now()
);

create index on note_embeddings using ivfflat (embedding vector_cosine_ops);
```

All tables get **Row Level Security** policies scoped to `user_id = auth.uid()`.

### 4.3 RAG pipeline

1. **On note save/update** (debounced, from the app): call the `embed-note` Edge Function
   with the note's plain-text representation (title + text blocks + checklist item text).
2. Edge Function:
   - Chunks the note (e.g. ~300-token chunks, block-aware so checklists don't get split mid-item).
   - Calls Gemini `text-embedding-004` for each chunk.
   - Deletes old `note_embeddings` rows for that note, inserts new ones.
3. **On chat query** (from app, via `rag-chat` Edge Function):
   - Embed the user's question (same model).
   - Run a Postgres RPC (`match_note_embeddings`) using cosine similarity, filtered by
     `user_id` always, and by `notebook_id` when the chat is notebook-scoped.
   - Take top-k chunks (e.g. k=6), build a grounded prompt with note titles as source
     labels, call `gemini-2.0-flash` for the answer.
   - Return answer + the list of source note titles/ids so the app can show "Sources: ...".

### 4.4 Reminders
- `expo-notifications` schedules a local notification at `notes.reminder_at`.
- No server-side cron needed for v1 since it's a single device, one-off reminder.

### 4.5 Export
- "Export notebook" button → app fetches all notes/blocks/checklists/attachments for that
  notebook → converts each note to Markdown (checklists as `- [ ]` / `- [x]`, nested via
  indentation) → downloads attachments from Storage → zips everything client-side
  (`expo-file-system` + a JS zip lib) → saves to device Downloads / shares via Android
  share sheet.

---

## 5. Design System

**Principle:** dark, minimalist, but each major screen has its own accent so the user
recognizes location at a glance, purely from color — no other other app should look like this.

| Screen | Base | Accent (suggestion — refine during Phase 1) |
|---|---|---|
| Home (notebook list) | `#0E0E10` near-black | Muted cyan `#4FD1C5` |
| Notebook view (notes list) | `#0E0E10` | Warm amber `#F2A65A` |
| Note editor | `#0E0E10` | Soft violet `#9D8CFF` |
| RAG chat overlay | `#0E0E10` | Signal green `#5CE187` (distinguish "AI is talking" from normal UI) |

Shared rules:
- One base near-black background across all screens (not literal `#000000`, to keep depth).
- Accent color used sparingly: active tab/header underline, primary buttons, focus states,
  selected tag chips — not flooded across the UI.
- Neutral grays for text hierarchy (`#F5F5F5` primary text, `#9A9A9E` secondary, `#5A5A5E` disabled).
- Typography: one clean geometric sans (e.g. Inter or Manrope) for a modern, sleek feel.
- Rounded-but-not-bubbly corners (10–14px radius), generous spacing, no heavy shadows —
  rely on subtle borders/elevation via slightly lighter surface color instead of drop shadows.
- Checklist checked items: strike-through + dimmed, not deleted.
- Tag chips: small, pill-shaped, colored by the tag's own color (user-assigned).

---

## 6. Feature List (detailed)

- **Auth**: sign up / log in / log out (email + password, Supabase Auth).
- **Notebooks**: create, rename, delete, nest (sub-notebooks), reorder, assign optional accent override.
- **Notes**: create (within a notebook), title, block-based body (text blocks + checklist blocks),
  reorder blocks, delete note, move note to another notebook.
- **Checklists**: add item, nest sub-items under an item, check/uncheck (strike-through), reorder, delete.
- **Tags**: create tag (name + color), attach/detach tags to/from notes, delete tag (detaches everywhere),
  filter notes list by one or more tags.
- **Search**: keyword search across title + text content, combinable with tag filters and
  notebook/date-range filters.
- **Attachments**: attach image (camera or gallery) or file (PDF/doc) to a note, preview image inline,
  open file with system viewer, delete attachment.
- **Reminders**: set/clear a date-time reminder on a note; local notification fires at that time;
  tapping notification opens the note.
- **RAG Chat**: floating chat entry point; toggle "this notebook" vs "all notebooks"; ask a question,
  get a grounded answer with source note references; tapping a source opens that note.
- **Export**: per-notebook "Download" action producing a zipped Markdown export (see §4.5), saved/shared
  via Android's share sheet.

---

## 7. Phased Implementation Plan

Each phase should end with the agent producing a short **status report** (what was built,
what deviated from plan and why, what needs your approval) before starting the next phase —
consistent with your existing audit/approval workflow.

### Phase 0 — Project Setup
- Init Expo (TypeScript) project.
- Set up Supabase project: tables/migrations from §4.2, RLS policies, Storage bucket for attachments.
- Enable `pgvector` extension.
- Configure env vars (Supabase URL/anon key on client; Gemini key only inside Edge Functions).
- Set up navigation shell (React Navigation), base theme tokens from §5, folder structure.
- **Checkpoint:** confirm schema + navigation shell before building features on top.

### Phase 1 — Auth + Notebooks
- Email/password sign up, login, logout, session persistence.
- Home screen: list of top-level notebooks (Home accent color).
- Create / rename / delete notebook.
- Nested notebooks: navigate into a notebook to see its sub-notebooks + notes together.
- RLS verification: user A cannot see user B's notebooks (manual test).
- **Checkpoint:** demo notebook CRUD + nesting before moving on.

### Phase 2 — Notes Core (text + checklist blocks)
- Note editor screen (Note accent color): title field, add text block, add checklist block.
- Checklist block: add item, nest sub-items, check/uncheck with strike-through, reorder, delete.
- Autosave (debounced) to Supabase.
- Move note between notebooks; delete note.
- **Checkpoint:** confirm editor UX feels right before adding tags/search on top.

### Phase 3 — Tags + Search/Filter
- Tag creation (name + color picker), attach/detach on notes.
- Notes list: filter by tag(s), combine with keyword search and notebook/date filters.
- **Checkpoint:** verify filter combinations behave as expected.

### Phase 4 — Attachments
- Image attach (camera/gallery) with inline preview.
- File attach (PDF/doc) with open-in-system-viewer.
- Upload/delete via Supabase Storage, storage_path tracked in `attachments`.
- **Checkpoint:** confirm upload/delete + RLS on storage bucket.

### Phase 5 — Reminders
- Date-time picker on note editor.
- Schedule/cancel local notification via `expo-notifications`.
- Tapping notification deep-links into the note.
- **Checkpoint:** test reminder firing + deep link on a real device.

### Phase 6 — RAG Pipeline (core)
- Build `embed-note` Edge Function (chunk + embed + upsert into `note_embeddings`).
- Wire note save/update in the app to trigger `embed-note` (debounced).
- Build `match_note_embeddings` Postgres RPC (cosine similarity, user_id + optional notebook_id filter).
- Build `rag-chat` Edge Function (embed query → retrieve → prompt Gemini → return answer + sources).
- **Checkpoint:** test embedding pipeline end-to-end with a few sample notes before building chat UI.

### Phase 7 — RAG Chat UI
- Chat overlay/screen (Chat accent color) with scope toggle: "This notebook" / "All notebooks".
- Message list, source citations (tappable → opens note), loading/error states.
- **Checkpoint:** validate answer quality and source accuracy against real notes.

### Phase 8 — Export
- "Download notebook" action: fetch notebook tree, convert notes to Markdown, bundle attachments,
  zip, save/share via Android share sheet.
- **Checkpoint:** confirm exported zip opens correctly and Markdown renders as expected.

### Phase 9 — Polish & Hardening
- Empty states, error states, loading skeletons.
- Performance pass on large notebooks (pagination/virtualized lists).
- Final RLS audit across all tables and the Storage bucket.
- App icon, splash screen, final accent-color tuning per §5.
- **Checkpoint:** final review before considering v1 complete.

---

## 8. Open Items for Later (explicitly out of scope for v1)
- PDF export (Markdown is v1; PDF can be added later if needed).
- Multi-device offline sync with conflict resolution.
- Sharing/collaboration with other users.
- iOS support.

---

## 9. Notes for the Coding Agent
- Follow inspect-first, act-second: audit existing code/schema state before each phase,
  report findings, get explicit go-ahead before generating/modifying code.
- Never place the Gemini API key in client-side code or in the Expo app config — it must
  only exist as a secret in the Supabase Edge Function environment.
- All new tables must ship with RLS policies in the same migration that creates them.
- Prefer small, reviewable commits per checkpoint above rather than one large diff per phase.
