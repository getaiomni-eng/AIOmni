// supabase/functions/content-transcribe/index.ts
// ───────────────────────────────────────────────────────────────────────
// Analyst-takes pipeline, stage 2a: podcast transcription via OpenAI
// Whisper, RESUMABLE. Two hard limits shape the design:
//   * Whisper rejects uploads > 25MB
//   * Edge functions get ~150s wall-clock
// So each invocation advances exactly ONE ~15MB byte-range chunk of ONE
// episode (Range request → Whisper → append transcript_chunks → bump
// bytes_done). The 10-min cron drains an hour-long episode in ~4 ticks.
//
// MP3 frames self-synchronize, so cutting at arbitrary byte offsets
// costs at most a word or two per boundary — irrelevant for take
// extraction, and it avoids shipping ffmpeg into an edge function.
//
// Requires OPENAI_API_KEY (supabase secrets set). Without it the
// function no-ops loudly, leaving items pending.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_KEY   = Deno.env.get('OPENAI_API_KEY');

const CHUNK_BYTES     = 15 * 1024 * 1024;       // 15MB < Whisper's 25MB cap
const MAX_EPISODE_MB  = 250;                     // ~4.5h @128kbps — skip beyond
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!OPENAI_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'OPENAI_API_KEY not set — podcast transcription idle' }),
      { status: 200, headers: CORS });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Continue an in-flight episode first; otherwise claim a fresh one.
  // Oldest-first for in-flight (finish what we started), newest-first
  // for fresh (latest episode is the most valuable during draft season).
  let { data: item } = await sb
    .from('content_items')
    .select('id, source_id, title, audio_url, published_at, bytes_done, total_bytes, content_sources!inner(kind)')
    .eq('status', 'transcribing').eq('content_sources.kind', 'podcast')
    .order('published_at', { ascending: true })
    .limit(1).maybeSingle();
  if (!item) {
    ({ data: item } = await sb
      .from('content_items')
      .select('id, source_id, title, audio_url, published_at, bytes_done, total_bytes, content_sources!inner(kind)')
      .eq('status', 'pending').eq('content_sources.kind', 'podcast')
      .not('audio_url', 'is', null)
      .order('published_at', { ascending: false })
      .limit(1).maybeSingle());
    if (item) await sb.from('content_items').update({ status: 'transcribing' }).eq('id', item.id);
  }
  if (!item) {
    return new Response(JSON.stringify({ ok: true, idle: true }), { headers: CORS });
  }

  try {
    // First touch: discover total size (follow redirects — podcast CDNs
    // chain through 2-4 tracking hops before the real file).
    let totalBytes = Number(item.total_bytes) || 0;
    if (!totalBytes) {
      const head = await fetch(item.audio_url!, { method: 'HEAD', redirect: 'follow' });
      totalBytes = Number(head.headers.get('content-length')) || 0;
      if (!totalBytes || totalBytes > MAX_EPISODE_MB * 1024 * 1024) {
        await sb.from('content_items')
          .update({ status: 'skipped', error: `bad size: ${totalBytes}` }).eq('id', item.id);
        return new Response(JSON.stringify({ ok: true, skipped: item.title }), { headers: CORS });
      }
      await sb.from('content_items').update({ total_bytes: totalBytes }).eq('id', item.id);
    }

    const start = Number(item.bytes_done) || 0;
    const end = Math.min(start + CHUNK_BYTES, totalBytes) - 1;
    const audioRes = await fetch(item.audio_url!, {
      headers: { Range: `bytes=${start}-${end}` }, redirect: 'follow',
    });
    if (!audioRes.ok && audioRes.status !== 206) throw new Error(`audio HTTP ${audioRes.status}`);
    const bytes = new Uint8Array(await audioRes.arrayBuffer());

    const form = new FormData();
    form.append('file', new File([bytes], 'chunk.mp3', { type: 'audio/mpeg' }));
    form.append('model', 'whisper-1');
    form.append('response_format', 'text');
    // Domain glossary dramatically improves name spelling in transcripts.
    form.append('prompt', 'Fantasy football podcast: NFL players, waiver wire, PPR, dynasty, start-sit, trade advice.');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });
    if (!whisperRes.ok) throw new Error(`whisper HTTP ${whisperRes.status}: ${(await whisperRes.text()).slice(0, 200)}`);
    const text = await whisperRes.text();

    const idx = Math.floor(start / CHUNK_BYTES);
    await sb.from('transcript_chunks').upsert({ item_id: item.id, idx, text });

    const newDone = end + 1;
    const finished = newDone >= totalBytes;
    await sb.from('content_items')
      .update({ bytes_done: newDone, status: finished ? 'extracting' : 'transcribing' })
      .eq('id', item.id);

    return new Response(JSON.stringify({
      ok: true, item: item.title, chunk: idx,
      progress: `${Math.round((newDone / totalBytes) * 100)}%`,
      finished,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    await sb.from('content_items')
      .update({ status: 'failed', error: String(e).slice(0, 500) }).eq('id', item.id);
    return new Response(JSON.stringify({ ok: false, item: item.title, error: String(e) }),
      { status: 200, headers: CORS });
  }
});
