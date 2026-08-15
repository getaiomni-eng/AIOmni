// supabase/functions/content-extract-articles/index.ts
// ───────────────────────────────────────────────────────────────────────
// Analyst-takes pipeline, stage 2 (articles): claim pending article
// items, fetch each page transiently, have Haiku extract structured
// per-player takes, resolve names against nfl_players, and insert
// analyst_takes. Article text is never stored — only the extracted
// signals (spec: docs/analyst-takes-pipeline.md, "takes are
// extractor-authored one-liners, never quotes").
//
// Runs every 2h via pg_cron (aiomni-content-extract-articles), 15 min
// after content-poll. Batch-capped so a burst of articles spreads
// across runs instead of blowing the function timeout.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE  = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const BATCH_SIZE   = 8;       // articles per run
const BODY_CAP     = 15_000;  // chars of stripped article text sent to the model
const MODEL        = 'claude-haiku-4-5-20251001';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Name normalization ────────────────────────────────────────────────
// Deno port of services/util/normalizeName.ts — keep in sync. Same rules:
// strip generational suffixes, then keep a-z only.
const SUFFIXES = [' jr', ' sr', ' ii', ' iii', ' iv', ' v', ' jr.', ' sr.', ' ii.', ' iii.', ' iv.', ' v.'];
function normalizePlayerName(name: string | null | undefined): string {
  let s = (name ?? '').toLowerCase().trim();
  for (const suf of SUFFIXES) {
    if (s.endsWith(suf)) { s = s.slice(0, -suf.length).trim(); break; }
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) out += s[i];
  }
  return out;
}

// ── Extraction prompt (verbatim from the spec) ────────────────────────
const SYSTEM = `You extract fantasy-football-relevant player takes from an article. Return ONLY JSON matching the schema.

Rules:
- One entry per (player, distinct claim). Skip players merely name-dropped.
- "claim" is ONE sentence IN YOUR OWN WORDS stating the take. Never quote the source text. No hedging filler.
- "stance": buy (positive outlook/acquire), sell (negative/move off), hold (neutral/wait), injury (health news changes value), usage (role/snaps/targets/touches change), situation (depth chart, coaching, scheme, contract context).
- "analyst": the byline if identifiable from context, else null.
- "format_note": only when the take is format-specific (dynasty, superflex, TE-premium, best ball, PPR-specific), else null.
- "confidence": how firmly the author commits. Throwaway line 0.3, reasoned argument 0.6, table-pounding conviction 0.9.
- ONLY offensive skill players: QB, RB, WR, TE. No defensive players (no edge rushers, linebackers, cornerbacks, safeties), no team defenses, no kickers, no offensive linemen, no coaches, no retired players, no college players unless explicitly a dynasty stash take.
- Empty array if nothing qualifies. That is a fine answer.

Respond with ONLY a JSON object, no markdown fences:
{"takes":[{"player_name":"string","position":"QB|RB|WR|TE|null","nfl_team":"string|null","analyst":"string|null","stance":"buy|sell|hold|injury|usage|situation","claim":"string","format_note":"string|null","confidence":0.0}]}`;

type Take = {
  player_name: string; position: string | null; nfl_team: string | null;
  analyst: string | null; stance: string; claim: string;
  format_note: string | null; confidence: number;
};

const STANCES = new Set(['buy', 'sell', 'hold', 'injury', 'usage', 'situation']);

function parseTakes(raw: string): Take[] {
  // Model is instructed to return bare JSON, but tolerate fences/preamble:
  // take the first balanced {...} that parses.
  const stripped = raw.replace(/```json|```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(parsed?.takes)) return [];
    return parsed.takes.filter((t: any) =>
      t && typeof t.player_name === 'string' && t.player_name.trim() &&
      typeof t.claim === 'string' && t.claim.trim() &&
      STANCES.has(t.stance));
  } catch { return []; }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Claim a batch. The status flip is the claim — a concurrent run that
  // races us just claims a different (possibly empty) set next tick.
  const { data: pending, error: pendErr } = await sb
    .from('content_items')
    .select('id, source_id, title, url, published_at, content_sources!inner(kind, name)')
    .eq('status', 'pending')
    .eq('content_sources.kind', 'article')
    .order('published_at', { ascending: false })
    .limit(BATCH_SIZE);
  if (pendErr) {
    return new Response(JSON.stringify({ error: pendErr.message }), { status: 500, headers: CORS });
  }
  if (!pending?.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), { headers: CORS });
  }

  await sb.from('content_items')
    .update({ status: 'extracting' })
    .in('id', pending.map(p => p.id));

  // Player resolution map, built once per run. Key: normalized name.
  // Multiple actives sharing a normalized name → ambiguous → resolve only
  // if the extractor's position pins exactly one — else sleeper_id stays
  // NULL and the take never reaches Coach context (wrong-player injection
  // is worse than none).
  const { data: players } = await sb
    .from('nfl_players')
    .select('full_name, position, team, sleeper_id')
    .in('position', ['QB', 'RB', 'WR', 'TE'])
    .not('sleeper_id', 'is', null);
  const byKey = new Map<string, Array<{ pos: string; team: string | null; sid: string }>>();
  for (const p of players ?? []) {
    const key = normalizePlayerName(p.full_name);
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push({ pos: p.position, team: p.team, sid: p.sleeper_id });
    byKey.set(key, arr);
  }
  const resolve = (name: string, pos: string | null): { sid: string | null; team: string | null } => {
    const cands = byKey.get(normalizePlayerName(name)) ?? [];
    if (cands.length === 1) return { sid: cands[0].sid, team: cands[0].team };
    if (pos) {
      const posMatch = cands.filter(c => c.pos === pos);
      if (posMatch.length === 1) return { sid: posMatch[0].sid, team: posMatch[0].team };
    }
    return { sid: null, team: null };
  };

  const results: Record<string, string> = {};
  let totalTakes = 0;

  for (const item of pending) {
    try {
      if (!item.url) throw new Error('no url');
      const page = await fetch(item.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIOmni/1.0; +https://getaiomni.com)' },
        redirect: 'follow',
      });
      if (!page.ok) throw new Error(`fetch HTTP ${page.status}`);
      const text = stripHtml(await page.text()).slice(0, BODY_CAP);
      if (text.length < 300) {
        // Paywalled stub or JS-only shell — nothing to extract, not an error.
        await sb.from('content_items').update({ status: 'skipped', error: 'body too short' }).eq('id', item.id);
        results[item.title] = 'skipped (thin body)';
        continue;
      }

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          system: SYSTEM,
          messages: [{
            role: 'user',
            content: `Article: "${item.title}"\n\n${text}`,
          }],
        }),
      });
      if (!aiRes.ok) throw new Error(`anthropic HTTP ${aiRes.status}`);
      const aiData = await aiRes.json();
      const takes = parseTakes(aiData?.content?.[0]?.text ?? '');

      if (takes.length) {
        const rows = takes.map(t => {
          const { sid, team } = resolve(t.player_name, t.position);
          return {
            item_id: item.id,
            source_id: item.source_id,
            player_name: t.player_name.slice(0, 100),
            player_key: normalizePlayerName(t.player_name),
            sleeper_id: sid,
            position: t.position,
            nfl_team: t.nfl_team ?? team,
            analyst: t.analyst?.slice(0, 100) ?? null,
            stance: t.stance,
            claim: t.claim.slice(0, 400),
            format_note: t.format_note?.slice(0, 100) ?? null,
            confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0.5)),
            published_at: item.published_at,
          };
        });
        const { error: insErr } = await sb.from('analyst_takes').insert(rows);
        if (insErr) throw new Error(insErr.message);
        totalTakes += rows.length;
      }

      await sb.from('content_items').update({ status: 'done' }).eq('id', item.id);
      results[item.title] = `${takes.length} takes`;
    } catch (e) {
      await sb.from('content_items')
        .update({ status: 'failed', error: String(e).slice(0, 500) })
        .eq('id', item.id);
      results[item.title] = `FAILED: ${e}`;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: pending.length, totalTakes, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
