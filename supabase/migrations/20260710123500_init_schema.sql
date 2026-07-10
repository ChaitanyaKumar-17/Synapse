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

-- Enable RLS
alter table notebooks enable row level security;
alter table notes enable row level security;
alter table note_blocks enable row level security;
alter table checklist_items enable row level security;
alter table tags enable row level security;
alter table note_tags enable row level security;
alter table attachments enable row level security;
alter table note_embeddings enable row level security;

-- Notebooks RLS
create policy "Users can manage own notebooks" on notebooks
  for all using (auth.uid() = user_id);

-- Notes RLS
create policy "Users can manage own notes" on notes
  for all using (auth.uid() = user_id);

-- Note Blocks RLS
create policy "Users can manage own note_blocks" on note_blocks
  for all using (
    exists (select 1 from notes where notes.id = note_blocks.note_id and notes.user_id = auth.uid())
  );

-- Checklist Items RLS
create policy "Users can manage own checklist_items" on checklist_items
  for all using (
    exists (
      select 1 from note_blocks
      join notes on notes.id = note_blocks.note_id
      where note_blocks.id = checklist_items.block_id and notes.user_id = auth.uid()
    )
  );

-- Tags RLS
create policy "Users can manage own tags" on tags
  for all using (auth.uid() = user_id);

-- Note Tags RLS
create policy "Users can manage own note_tags" on note_tags
  for all using (
    exists (select 1 from notes where notes.id = note_tags.note_id and notes.user_id = auth.uid())
  );

-- Attachments RLS
create policy "Users can manage own attachments" on attachments
  for all using (
    exists (select 1 from notes where notes.id = attachments.note_id and notes.user_id = auth.uid())
  );

-- Note Embeddings RLS
create policy "Users can manage own note_embeddings" on note_embeddings
  for all using (auth.uid() = user_id);

-- Storage bucket
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false);

-- Storage RLS
create policy "Users can manage own attachment files" on storage.objects
  for all using (
    bucket_id = 'attachments' and (auth.uid() = owner)
  );
