// supabase/functions/content-poll/index.ts
// ───────────────────────────────────────────────────────────────────────
// Analyst-takes pipeline, stage 1: poll every enabled RSS source and
// upsert new episodes/articles into content_items (status='pending').
// Downstream extractors claim pending rows. Runs every 2h via pg_cron
// (aiomni-content-poll); safe to invoke manually:
//   curl -X POST .../functions/v1/content-poll -H "Authorization: Bearer $ANON"
//
// The regex-based RSS parsing mirrors services/newsFeed.ts, which has
// survived these exact feeds in production since May. Atom feeds (The
// Ringer) use <entry>/<link href>, RSS 2.0 uses <item>/<link>; both are
// handled. Item bodies are NOT stored — only metadata.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type FeedItem = {
  guid: string;
  title: string;
  url: string | null;
  publishedAt: string;      // ISO
  audioUrl: string | null;  // podcast enclosure
  durationS: number | null;
};

const strip = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
   .replace(/<[^>]+>/g, '')
   .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&#8217;|&rsquo;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"')
   .trim();

// "1:02:33" | "3753" → seconds
function parseDuration(raw: string | null): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const parts = t.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  // RSS 2.0 <item> and Atom <entry> blocks.
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g) ?? [];
  for (const block of blocks) {
    const title = strip(block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '');
    if (!title) continue;

    // RSS link is element text; Atom link is an href attribute.
    const rssLink  = strip(block.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const atomLink = block.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '';
    const url = rssLink || atomLink || null;

    const guidRaw = strip(block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]
                      ?? block.match(/<id[^>]*>([\s\S]*?)<\/id>/)?.[1] ?? '');
    const guid = guidRaw || url || title;   // last-resort dedupe key

    const dateRaw = strip(
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1]
        ?? block.match(/<published[^>]*>([\s\S]*?)<\/published>/)?.[1]
        ?? block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/)?.[1] ?? '');
    const ts = dateRaw ? new Date(dateRaw) : new Date();
    const publishedAt = isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString();

    const audioUrl = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="audio[^"]*"/)?.[1]
                  ?? block.match(/<enclosure[^>]*type="audio[^"]*"[^>]*url="([^"]+)"/)?.[1]
                  ?? null;
    const durationS = parseDuration(
      block.match(/<itunes:duration[^>]*>([\s\S]*?)<\/itunes:duration>/)?.[1] ?? null);

    out.push({ guid, title, url, publishedAt, audioUrl, durationS });
  }
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: sources, error: srcErr } = await sb
    .from('content_sources').select('*').eq('enabled', true);
  if (srcErr) {
    return new Response(JSON.stringify({ error: srcErr.message }), { status: 500, headers: CORS });
  }

  const results: Record<string, { found: number; inserted: number } | { error: string }> = {};
  for (const src of sources ?? []) {
    try {
      const res = await fetch(src.feed_url, {
        headers: { 'User-Agent': 'AIOmni/1.0 (+https://getaiomni.com)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text())
        // Only look back 7 days — history beyond that predates the pipeline
        // and would burn extraction budget on stale news.
        .filter(i => Date.now() - new Date(i.publishedAt).getTime() < 7 * 24 * 3600 * 1000)
        .slice(0, 50);

      const rows = items.map(i => ({
        source_id: src.id,
        guid: i.guid.slice(0, 500),
        title: i.title.slice(0, 500),
        url: i.url,
        published_at: i.publishedAt,
        audio_url: src.kind === 'podcast' ? i.audioUrl : null,
        duration_s: src.kind === 'podcast' ? i.durationS : null,
      }));

      let inserted = 0;
      if (rows.length) {
        // ignoreDuplicates keeps re-polls idempotent (unique source_id+guid)
        // and — critically — never resets the status of an already-processed
        // row back to 'pending'.
        const { data: ins, error: insErr } = await sb
          .from('content_items')
          .upsert(rows, { onConflict: 'source_id,guid', ignoreDuplicates: true })
          .select('id');
        if (insErr) throw new Error(insErr.message);
        inserted = ins?.length ?? 0;
      }

      await sb.from('content_sources')
        .update({ last_polled_at: new Date().toISOString() })
        .eq('id', src.id);
      results[src.name] = { found: items.length, inserted };
    } catch (e) {
      // One broken feed must never stall the rest.
      results[src.name] = { error: String(e) };
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
