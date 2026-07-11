create or replace function match_note_embeddings (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_user_id uuid,
  p_notebook_id uuid default null
)
returns table (
  id uuid,
  note_id uuid,
  notebook_id uuid,
  chunk_text text,
  similarity float
)
language sql stable
as $$
  select
    note_embeddings.id,
    note_embeddings.note_id,
    note_embeddings.notebook_id,
    note_embeddings.chunk_text,
    1 - (note_embeddings.embedding <=> query_embedding) as similarity
  from note_embeddings
  where note_embeddings.user_id = p_user_id
    and (p_notebook_id is null or note_embeddings.notebook_id = p_notebook_id)
    and 1 - (note_embeddings.embedding <=> query_embedding) > match_threshold
  order by note_embeddings.embedding <=> query_embedding
  limit match_count;
$$;
