-- Fix notes.notebook_id foreign key
ALTER TABLE notes
DROP CONSTRAINT IF EXISTS notes_notebook_id_fkey,
ADD CONSTRAINT notes_notebook_id_fkey
  FOREIGN KEY (notebook_id)
  REFERENCES notebooks(id)
  ON DELETE CASCADE;

-- Fix notebooks.parent_notebook_id foreign key
ALTER TABLE notebooks
DROP CONSTRAINT IF EXISTS notebooks_parent_notebook_id_fkey,
ADD CONSTRAINT notebooks_parent_notebook_id_fkey
  FOREIGN KEY (parent_notebook_id)
  REFERENCES notebooks(id)
  ON DELETE CASCADE;

-- Fix note_embeddings.notebook_id foreign key
ALTER TABLE note_embeddings
DROP CONSTRAINT IF EXISTS note_embeddings_notebook_id_fkey,
ADD CONSTRAINT note_embeddings_notebook_id_fkey
  FOREIGN KEY (notebook_id)
  REFERENCES notebooks(id)
  ON DELETE CASCADE;
