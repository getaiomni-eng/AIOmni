// supabase/functions/content-extract-podcasts/index.ts
// ───────────────────────────────────────────────────────────────────────
// Analyst-takes pipeline, stage 2b: turn finished podcast transcripts
// into analyst_takes. A 1-2h episode transcript runs 8-15k words, so it
// is windowed (~20k chars, 1k overlap) with one Haiku call per window,
// then takes are merged per (player, stance) keeping the highest
// confidence. Transcript chunks are deleted on success — transcripts
// are intermediate data, never a stored corpus.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE  = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const MODEL       = 'claude-haiku-4-5-20251001';
const WINDOW      = 20_000;
const OVERLAP     = 1_000;
const MAX_WINDOWS = 12;      // safety ceiling ≈ 4h of talk

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Deno port of services/util/normalizeName.ts — keep in sync.
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

const SYSTEM = `You extract fantasy-football-relevant player takes from a podcast transcript segment. Return ONLY JSON matching the schema.

Rules:
- One entry per (player, distinct claim). Skip players merely name-dropped.
- "claim" is ONE sentence IN YOUR OWN WORDS stating the take. Never quote the transcript. No hedging filler.
- "stance": buy (positive outlook/acquire), sell (negative/move off), hold (neutral/wait), injury (health news changes value), usage (role/snaps/targets/touches change), situation (depth chart, coaching, scheme, contract context).
- "analyst": the speaker's name if identifiable from the transcript, else null.
- "format_note": only when the take is format-specific (dynasty, superflex, TE-premium, best ball, PPR-specific), else null.
- "confidence": how firmly the speaker commits. Throwaway line 0.3, reasoned argument 0.6, table-pounding conviction 0.9.
- Transcripts contain speech-to-text errors: if a name is slightly garbled but clearly a known NFL player in context, use the correct spelling; if genuinely unclear, skip the take.
- ONLY offensive skill players: QB, RB, WR, TE. No defensive players, no team defenses, no kickers, no coaches, no retired players, no college players unless explicitly a dynasty stash take.
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
  const stripped = raw.replace(/```json|```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(parsed?.takes)) return [];
    return parsed.takes.filter((t: any) =>
      t && typeof t.player_name === 'string' && t.player_name.trim() &&
      typeof t.claim === 'string' && t.claim.trim() && STANCES.has(t.stance));
  } catch { return []; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // One episode per run — an episode is already up to 12 Haiku calls.
  const { data: item } = await sb
    .from('content_items')
    .select('id, source_id, title, published_at, content_sources!inner(kind)')
    .eq('status', 'extracting').eq('content_sources.kind', 'podcast')
    .order('published_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!item) {
    return new Response(JSON.stringify({ ok: true, idle: true }), { headers: CORS });
  }

  try {
    const { data: chunks } = await sb
      .from('transcript_chunks').select('idx, text')
      .eq('item_id', item.id).order('idx', { ascending: true });
    const transcript = (chunks ?? []).map(c => c.text).join(' ');
    if (transcript.length < 500) throw new Error('transcript too short');

    // Player resolution map (same rules as the article extractor).
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
    const resolve = (name: string, pos: string | null) => {
      const cands = byKey.get(normalizePlayerName(name)) ?? [];
      if (cands.length === 1) return { sid: cands[0].sid, team: cands[0].team };
      if (pos) {
        const pm = cands.filter(c => c.pos === pos);
        if (pm.length === 1) return { sid: pm[0].sid, team: pm[0].team };
      }
      return { sid: null, team: null };
    };

    // Window the transcript and extract per window.
    const merged = new Map<string, Take>();   // player_key|stance → best take
    let windows = 0;
    for (let off = 0; off < transcript.length && windows < MAX_WINDOWS; off += WINDOW - OVERLAP) {
      windows++;
      const segment = transcript.slice(off, off + WINDOW);
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
          messages: [{ role: 'user', content: `Episode: "${item.title}"\n\nTranscript segment ${windows}:\n${segment}` }],
        }),
      });
      if (!aiRes.ok) throw new Error(`anthropic HTTP ${aiRes.status}`);
      const aiData = await aiRes.json();
      for (const t of parseTakes(aiData?.content?.[0]?.text ?? '')) {
        const key = `${normalizePlayerName(t.player_name)}|${t.stance}`;
        const cur = merged.get(key);
        if (!cur || (Number(t.confidence) || 0) > (Number(cur.confidence) || 0)) merged.set(key, t);
      }
    }

    const rows = [...merged.values()].map(t => {
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
    if (rows.length) {
      const { error: insErr } = await sb.from('analyst_takes').insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    await sb.from('transcript_chunks').delete().eq('item_id', item.id);
    await sb.from('content_items').update({ status: 'done' }).eq('id', item.id);

    return new Response(JSON.stringify({ ok: true, episode: item.title, windows, takes: rows.length }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    await sb.from('content_items')
      .update({ status: 'failed', error: String(e).slice(0, 500) }).eq('id', item.id);
    return new Response(JSON.stringify({ ok: false, episode: item.title, error: String(e) }),
      { status: 200, headers: CORS });
  }
});
