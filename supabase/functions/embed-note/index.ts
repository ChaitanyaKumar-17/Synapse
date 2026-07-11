import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { note_id, notebook_id, title, text_content } = await req.json();

    if (!note_id || !text_content) {
      throw new Error('Missing required fields');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Unauthorized: No Authorization header provided in request');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Unauthorized: Missing Supabase environment variables (URL or ANON_KEY)');
    }

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error(`Unauthorized: ${authError?.message || 'No user returned from getUser()'}`);
    }

    // Simple chunking strategy (e.g. 500 characters)
    const chunkSize = 500;
    const chunks = [];
    let currentChunk = '';
    const lines = text_content.split('\n');
    
    for (const line of lines) {
      if (currentChunk.length + line.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      currentChunk += line + '\n';
    }
    if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());

    // Include title in chunks for context
    const chunksWithContext = chunks.map(c => `Note Title: ${title}\n\n${c}`);

    const COHERE_API_KEY = Deno.env.get('COHERE_API_KEY');
    if (!COHERE_API_KEY) throw new Error('Missing Cohere API Key');

    // First delete old embeddings
    await supabaseClient.from('note_embeddings').delete().eq('note_id', note_id);

    // Embed all chunks in a single request (Cohere supports batching!)
    const response = await fetch(`https://api.cohere.ai/v1/embed`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COHERE_API_KEY}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'embed-english-v3.0',
        input_type: 'search_document',
        texts: chunksWithContext
      })
    });
    
    const embedData = await response.json();
    if (!embedData.embeddings) throw new Error(`Embedding failed: ${JSON.stringify(embedData)}`);
    
    const embeddings = embedData.embeddings;

    const inserts = chunksWithContext.map((chunk, i) => ({
      note_id,
      notebook_id,
      user_id: user.id,
      chunk_text: chunk,
      embedding: embeddings[i]
    }));

    if (inserts.length > 0) {
      const { error: insertError } = await supabaseClient.from('note_embeddings').insert(inserts);
      if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
    }

    return new Response(JSON.stringify({ success: true, chunks: inserts.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, // Return 200 to allow client error parsing
    });
  }
});
