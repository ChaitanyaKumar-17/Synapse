create table todo_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  is_pinned boolean default false,
  pinned_at timestamptz,
  created_at timestamptz default now()
);

alter table todo_lists enable row level security;
create policy "Users can manage their own todo_lists" on todo_lists for all using (auth.uid() = user_id);

create table todos (
  id uuid primary key default gen_random_uuid(),
  todo_list_id uuid references todo_lists(id) on delete cascade not null,
  user_id uuid references auth.users not null,
  content text not null,
  is_completed boolean default false,
  order_index integer not null default 0,
  created_at timestamptz default now()
);

alter table todos enable row level security;
create policy "Users can manage their own todos" on todos for all using (auth.uid() = user_id);
