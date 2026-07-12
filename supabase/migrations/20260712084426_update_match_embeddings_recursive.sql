-- Update match_note_embeddings to recursively fetch notes from descendant notebooks

DROP FUNCTION IF EXISTS match_note_embeddings;

CREATE OR REPLACE FUNCTION match_note_embeddings (
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  p_user_id uuid,
  p_notebook_id uuid DEFAULT NULL
)
RETURNS TABLE (
  note_id uuid,
  chunk_text text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE descendant_notebooks AS (
    -- Base case: the specified notebook itself
    SELECT id FROM notebooks WHERE id = p_notebook_id
    UNION ALL
    -- Recursive step: notebooks whose parent is in the descendant_notebooks list
    SELECT n.id FROM notebooks n
    INNER JOIN descendant_notebooks dn ON n.parent_notebook_id = dn.id
  )
  select
    note_embeddings.note_id,
    note_embeddings.chunk_text,
    1 - (note_embeddings.embedding <=> query_embedding) as similarity
  from note_embeddings
  join notes on notes.id = note_embeddings.note_id
  where notes.user_id = p_user_id
    and (p_notebook_id is null or notes.notebook_id IN (SELECT id FROM descendant_notebooks))
    and 1 - (note_embeddings.embedding <=> query_embedding) > match_threshold
  order by note_embeddings.embedding <=> query_embedding
  limit match_count;
$$;
