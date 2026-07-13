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
    const { query, notebook_id, history } = await req.json();
    if (!query) throw new Error('Missing query');

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

    const COHERE_API_KEY = Deno.env.get('COHERE_API_KEY');
    if (!COHERE_API_KEY) throw new Error('Missing Cohere API Key');

    // 1. Embed query
    const embedRes = await fetch(`https://api.cohere.ai/v1/embed`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COHERE_API_KEY}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'embed-english-v3.0',
        input_type: 'search_query',
        texts: [query]
      })
    });
    const embedData = await embedRes.json();
    if (!embedData.embeddings) throw new Error(`Query embedding failed: ${JSON.stringify(embedData)}`);
    
    const queryEmbedding = embedData.embeddings[0];

    // 2. Retrieve chunks via RPC
    const { data: chunks, error: rpcError } = await supabaseClient.rpc('match_note_embeddings', {
      query_embedding: queryEmbedding,
      match_threshold: -1.0, // Disable distance filtering, just get top K
      match_count: 6,
      p_user_id: user.id,
      p_notebook_id: notebook_id || null
    });

    if (rpcError) throw new Error(`RPC Error: ${rpcError.message}`);

    const contextText = (chunks || []).map((c: any) => c.chunk_text).join('\n\n');
    const sources = (chunks || []).map((c: any) => ({ id: c.note_id, title: c.chunk_text.split('\n')[0].replace('Note Title: ', '') }));
    
    // Deduplicate sources
    const uniqueSources = Array.from(new Map(sources.map((item: any) => [item.id, item])).values());

    // 3. Prompt Cohere Chat (v2 API)
    const formattedHistory = Array.isArray(history) ? history.map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    })) : [];

    const chatRes = await fetch(`https://api.cohere.ai/v2/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COHERE_API_KEY}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'command-a-plus-05-2026',
        messages: [
          {
            role: "system",
            content: `You are Synapse AI, a friendly, human-like assistant built into a notes app.
If the user asks general conversational questions (like 'who are you', 'how are you', or 'what can you do'), answer them naturally.
Your primary capability is answering questions based on the user's notes using the provided context.
If the user asks you to modify, create, or delete any notes, tell them politely that making changes is not in your capabilities yet and you can only read and query notes.
For questions about their notes, use the provided context. If the context does not contain the answer, say you don't know based on the notes.

Context:
${contextText}`
          },
          ...formattedHistory,
          {
            role: "user",
            content: query
          }
        ]
      })
    });
    
    const chatData = await chatRes.json();
    if (!chatData.message?.content) {
      throw new Error(`Chat generation failed: ${JSON.stringify(chatData)}`);
    }
    
    const textBlock = chatData.message?.content?.find((c: any) => c.type === 'text');
    const answer = textBlock?.text;
    
    if (!answer) {
      throw new Error(`DEBUG_COHERE_RESPONSE: ${JSON.stringify(chatData)}`);
    }

    return new Response(JSON.stringify({ answer, sources: uniqueSources }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, // Return 200 so the client can read the actual error message
    });
  }
});
