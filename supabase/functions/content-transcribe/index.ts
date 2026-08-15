// supabase/functions/content-transcribe/index.ts
// ───────────────────────────────────────────────────────────────────────
// Analyst-takes pipeline, stage 2a: SUBMIT podcast episodes to Deepgram
// for async transcription. Deepgram fetches the audio URL itself (2GB
// cap — hours of audio) and POSTs the finished transcript to our
// content-transcribe-callback function, so no audio bytes ever move
// through an edge function and no wall-clock limit is ever at risk.
//
// v2 (2026-08-14): replaced the Whisper byte-range-chunking design —
// Deepgram's callback mode deletes ~100 lines of resumability logic.
// Requires DEEPGRAM_API_KEY (supabase secrets set); no-ops loudly
// without it. nova-2 model ≈ $0.0043/min.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEEPGRAM_KEY = Deno.env.get('DEEPGRAM_API_KEY');

const SUBMIT_PER_RUN = 3;
const CALLBACK_BASE = `${SUPABASE_URL}/functions/v1/content-transcribe-callback`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!DEEPGRAM_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'DEEPGRAM_API_KEY not set — podcast transcription idle' }),
      { status: 200, headers: CORS });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: pending } = await sb
    .from('content_items')
    .select('id, title, audio_url, content_sources!inner(kind)')
    .eq('status', 'pending').eq('content_sources.kind', 'podcast')
    .not('audio_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(SUBMIT_PER_RUN);
  if (!pending?.length) {
    return new Response(JSON.stringify({ ok: true, idle: true }), { headers: CORS });
  }

  const results: Record<string, string> = {};
  for (const item of pending) {
    try {
      // Claim before submitting so a slow Deepgram response can't cause a
      // double-submit on the next cron tick.
      await sb.from('content_items').update({ status: 'transcribing' }).eq('id', item.id);

      const params = new URLSearchParams({
        model: 'nova-2',
        smart_format: 'true',
        punctuate: 'true',
        callback: `${CALLBACK_BASE}?item_id=${item.id}`,
      });
      const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${DEEPGRAM_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: item.audio_url }),
      });
      if (!res.ok) throw new Error(`deepgram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      results[item.title] = `submitted (request ${data?.request_id ?? '?'})`;
    } catch (e) {
      await sb.from('content_items')
        .update({ status: 'failed', error: String(e).slice(0, 500) }).eq('id', item.id);
      results[item.title] = `FAILED: ${e}`;
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
