// supabase/functions/coach-learn/index.ts
// ───────────────────────────────────────────────────────────────────────
// The Coach's learning loop. After each exchange the client fires this with
// {q, a}. We read the user's existing consolidated profile + league state,
// run a cheap Haiku pass that EXTRACTS durable signals and MERGES them into a
// compact dossier (not raw Q/A), and persist it. The Coach injects this dossier
// next session, so it genuinely "knows you" more each conversation.
//
// Two memory rows per user (latest wins), stored in `memories`:
//   league_id = '__PROFILE__'           → cross-league tendencies (durable)
//   league_id = '__STATE__:<leagueName>' → that league's situation (volatile)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE  = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function latest(sb: any, userId: string, leagueId: string): Promise<string> {
  const { data } = await sb.from('memories')
    .select('content').eq('user_id', userId).eq('league_id', leagueId)
    .order('tagged_date', { ascending: false }).limit(1);
  return data?.[0]?.content ?? '';
}

async function extract(profile: string, state: string, leagueName: string, q: string, a: string): Promise<any> {
  const prompt = `You maintain a fantasy-football manager's profile for an AI coach. Update it from the latest exchange. MERGE — reinforce repeats, let recent facts override stale ones, drop noise. Be specific and durable; ignore one-off trivia.

EXISTING PROFILE (cross-league tendencies — who this manager is):
${profile || '(none yet)'}

EXISTING LEAGUE STATE${leagueName ? ` for "${leagueName}"` : ''} (their current situation):
${state || '(none yet)'}

LATEST EXCHANGE:
User: ${String(q).slice(0, 600)}
Coach: ${String(a).slice(0, 600)}

Return ONLY this JSON, no prose:
{"profile":"<=6 bullet-style tendencies as one string, '; '-separated (risk tolerance, position biases, roster-build style, whether they trust vs push back on rankings, rookie appetite)","leagueState":"<=5 facts about THIS league as one '; '-separated string (contender vs rebuild, positional needs, recent moves, key players they're high/low on)"}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  let txt = data?.content?.[0]?.text ?? '';
  txt = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
  return JSON.parse(txt);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    if (!token) return new Response(JSON.stringify({ error: 'no_auth' }), { status: 401, headers: CORS });
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: 'bad_auth' }), { status: 401, headers: CORS });
    const { data: urow } = await sb.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!urow) return new Response(JSON.stringify({ error: 'no_user_row' }), { status: 404, headers: CORS });
    const userId = urow.id;

    const { q, a, leagueName = '', platform = '' } = await req.json();
    if (!q || !a) return new Response(JSON.stringify({ error: 'missing q/a' }), { status: 400, headers: CORS });

    const stateKey = leagueName ? `__STATE__:${leagueName}` : '';
    const profile = await latest(sb, userId, '__PROFILE__');
    const state   = stateKey ? await latest(sb, userId, stateKey) : '';

    // Haiku: extract + consolidate into a compact, bounded JSON dossier.
    let parsed: any = {};
    try { parsed = await extract(profile, state, leagueName, q, a); }
    catch { return new Response(JSON.stringify({ ok: false, error: 'parse' }), { headers: { ...CORS, 'Content-Type': 'application/json' } }); }

    const now = new Date().toISOString();
    const writes: any[] = [];
    if (parsed.profile) writes.push({ user_id: userId, league_id: '__PROFILE__', platform: 'learned', content: String(parsed.profile).slice(0, 1200), tagged_date: now });
    if (parsed.leagueState && stateKey) writes.push({ user_id: userId, league_id: stateKey, platform: 'learned', content: String(parsed.leagueState).slice(0, 1200), tagged_date: now });
    if (writes.length) await sb.from('memories').insert(writes);
    // Prune: keep only the newest profile/state row to avoid table bloat.
    for (const key of ['__PROFILE__', stateKey].filter(Boolean)) {
      const { data: old } = await sb.from('memories').select('id, tagged_date')
        .eq('user_id', userId).eq('league_id', key).order('tagged_date', { ascending: false });
      const stale = (old ?? []).slice(3).map((r: any) => r.id);
      if (stale.length) await sb.from('memories').delete().in('id', stale);
    }

    return new Response(JSON.stringify({ ok: true, profile: parsed.profile ?? '', leagueState: parsed.leagueState ?? '' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
