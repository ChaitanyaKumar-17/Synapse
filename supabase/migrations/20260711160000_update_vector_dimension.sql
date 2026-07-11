-- Update note_embeddings table to use 1024-dimensional vectors for Cohere

-- 1. Drop the existing embeddings (they are 768-dimensional from Gemini and cannot be cast, plus they are useless now)
TRUNCATE TABLE note_embeddings;

-- 2. Alter the column type to 1024 dimensions
ALTER TABLE note_embeddings ALTER COLUMN embedding TYPE vector(1024);

-- 3. We also need to update the match_note_embeddings function because it explicitly expects vector(768)
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
  select
    note_embeddings.note_id,
    note_embeddings.chunk_text,
    1 - (note_embeddings.embedding <=> query_embedding) as similarity
  from note_embeddings
  join notes on notes.id = note_embeddings.note_id
  where notes.user_id = p_user_id
    and (p_notebook_id is null or notes.notebook_id = p_notebook_id)
    and 1 - (note_embeddings.embedding <=> query_embedding) > match_threshold
  order by note_embeddings.embedding <=> query_embedding
  limit match_count;
$$;
