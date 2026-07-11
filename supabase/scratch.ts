import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || Deno.env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testDB() {
  console.log("Checking note_embeddings count...");
  const { count, error } = await supabase.from('note_embeddings').select('*', { count: 'exact', head: true });
  console.log("Count:", count, "Error:", error);

  if (count && count > 0) {
    const { data } = await supabase.from('note_embeddings').select('chunk_text, embedding').limit(1);
    console.log("Sample chunk text:", data[0].chunk_text);
    console.log("Sample embedding dimension:", data[0].embedding ? JSON.parse(data[0].embedding).length : 0);
  } else {
    console.log("NO EMBEDDINGS FOUND. This means embed-note is failing silently.");
  }
}

testDB();
