// supabase/functions/content-transcribe-callback/index.ts
// ───────────────────────────────────────────────────────────────────────
// Deepgram POSTs finished transcripts here (async callback from
// content-transcribe submissions). Stores the transcript and advances
// the item to 'extracting' for content-extract-podcasts.
//
// DEPLOY WITH --no-verify-jwt — Deepgram cannot send a Supabase JWT.
// Abuse surface is intentionally tiny: the caller must know a specific
// item UUID that is currently in 'transcribing' status, the payload
// must parse as a Deepgram transcript envelope, and the worst possible
// outcome of a forged call is one garbage transcript that the extractor
// then mines for nothing.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const itemId = new URL(req.url).searchParams.get('item_id');
  if (!itemId) return new Response('missing item_id', { status: 400 });

  let transcript = '';
  try {
    const body = await req.json();
    transcript = body?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  } catch {
    return new Response('bad payload', { status: 400 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: item } = await sb
    .from('content_items')
    .select('id, status')
    .eq('id', itemId)
    .eq('status', 'transcribing')
    .maybeSingle();
  if (!item) return new Response('unknown or non-transcribing item', { status: 404 });

  if (!transcript || transcript.length < 200) {
    await sb.from('content_items')
      .update({ status: 'failed', error: `callback transcript too short (${transcript.length})` })
      .eq('id', itemId);
    return new Response('ok (short transcript recorded as failure)', { status: 200 });
  }

  await sb.from('transcript_chunks').upsert({ item_id: itemId, idx: 0, text: transcript });
  await sb.from('content_items').update({ status: 'extracting' }).eq('id', itemId);

  return new Response('ok', { status: 200 });
});
