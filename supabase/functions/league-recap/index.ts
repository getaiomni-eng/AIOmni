// AI weekly recaps (2026-09-05): the first visible AI-commissioner duty.
// Runs after Tuesday scoring; writes one recap per league per scored week
// that lacks one. The AI writes the STORY — the scores it narrates were
// computed deterministically and are quoted, never invented.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLAUDE_KEY   = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-sonnet-5';

serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const season = new Date().getUTCMonth() + 1 >= 8
    ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;

  // Scored weeks missing a recap, at most a handful per run.
  const { data: pending } = await sb.rpc('pending_recaps', {}).select?.() ?? { data: null };
  // (fallback: direct query — rpc may not exist)
  const { data: rows } = await sb.from('hosted_weekly_scores')
    .select('league_id, week')
    .eq('season', season)
    .order('week');
  const wanted = new Map<string, Set<number>>();
  for (const r of rows ?? []) {
    if (!wanted.has(r.league_id)) wanted.set(r.league_id, new Set());
    wanted.get(r.league_id)!.add(r.week);
  }
  const { data: have } = await sb.from('hosted_recaps')
    .select('league_id, week').eq('season', season);
  for (const h of have ?? []) wanted.get(h.league_id)?.delete(h.week);

  let written = 0;
  for (const [leagueId, weeks] of wanted) {
    for (const week of weeks) {
      if (written >= 20) break;  // per-run cap
      const [{ data: league }, { data: members }, { data: scores }] = await Promise.all([
        sb.from('hosted_leagues').select('name, league_kind').eq('id', leagueId).maybeSingle(),
        sb.from('hosted_members').select('user_id, team_name').eq('league_id', leagueId),
        sb.from('hosted_weekly_scores').select('user_id, week, points, lineup')
          .eq('league_id', leagueId).eq('season', season).lte('week', week),
      ]);
      if (!league || !members?.length) continue;
      const nameBy = new Map(members.map(m => [m.user_id, m.team_name]));
      const thisWeek = (scores ?? []).filter(s => s.week === week)
        .sort((a, b) => Number(b.points) - Number(a.points));
      const totals = new Map<string, number>();
      for (const s of scores ?? []) totals.set(s.user_id, (totals.get(s.user_id) ?? 0) + Number(s.points));
      const standings = [...totals.entries()].sort((a, b) => b[1] - a[1])
        .map(([uid, pts], i) => `${i + 1}. ${nameBy.get(uid)} ${pts.toFixed(1)}`).join('\n');
      const weekLines = thisWeek.map(s => {
        const top = (s.lineup as any[]).sort((a, b) => Number(b.pts) - Number(a.pts))[0];
        return `${nameBy.get(s.user_id)}: ${Number(s.points).toFixed(1)} (best: ${top?.name} ${Number(top?.pts).toFixed(1)})`;
      }).join('\n');

      const prompt = `You are The Commissioner — AIOmni's AI running the best-ball league "${league.name}". Write the week ${week} recap for the league chat: 90-130 words, confident and fun, name the week's winner and their star, one playful jab at the lowest score, note any standings shake-up. Numbers below are exact — quote them, never invent any.\n\nWEEK ${week} SCORES\n${weekLines}\n\nSTANDINGS THROUGH WEEK ${week}\n${standings}`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 400, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text;
      if (!text) continue;
      await sb.from('hosted_recaps').insert({ league_id: leagueId, season, week, content: text, model: MODEL });
      // telemetry (judgment-capture pipeline)
      const u = data?.usage ?? {};
      await sb.from('ai_response_metadata').insert({
        feature: 'recap', model: MODEL,
        input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null, http_status: res.status,
      }).then(() => {}, () => {});
      // push everyone
      await fetch(`${SUPABASE_URL}/functions/v1/hosted-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hosted-secret': Deno.env.get('HOSTED_NOTIFY_SECRET') ?? '' },
        body: JSON.stringify({ type: 'week_scored', league_id: leagueId, week }),
      }).catch(() => {});
      written++;
    }
  }
  return new Response(JSON.stringify({ recaps_written: written }), { status: 200 });
});
