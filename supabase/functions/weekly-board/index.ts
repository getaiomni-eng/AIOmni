// The weekly board — "who should I start", as opposed to "who should I own".
//
// The Formula is a rest-of-season board: it averages schedule out on purpose,
// which is right for ownership and wrong for a lineup. McBride can be
// correctly TE1 for the season and a mediocre week-1 start because of who
// Arizona plays. This adjusts each player's rest-of-season score by the two
// things the season board deliberately smooths away:
//
//   1. The specific defence he faces  (nfl_dvp rank_vs_pos, 1 = toughest)
//   2. How many points his team is expected to score (Vegas implied total)
//
// Multipliers are intentionally modest. A matchup moves a player; it does not
// replace talent. A bad matchup for a great player should still usually
// outrank a great matchup for a replacement one, which is how real lineup
// decisions actually go.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function nflSeason(d = new Date()) { return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }
function nflWeek(season: number, now = new Date()): number {
  const sep1 = new Date(Date.UTC(season, 8, 1));
  const dow = sep1.getUTCDay();
  const opener = new Date(Date.UTC(season, 8, 1 + ((8 - (dow === 0 ? 7 : dow)) % 7) + 3));
  return Math.min(18, Math.max(1, Math.floor((now.getTime() - opener.getTime()) / 86400000 / 7) + 1));
}
const norm = (n: string) =>
  n.toLowerCase().replace(/[.'’]/g, "").replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "").replace(/\s+/g, " ").trim();

async function sb(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}
const j = async (path: string) => { const r = await sb(path); return r.ok ? await r.json() : []; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season")) || nflSeason();
  const week   = Number(url.searchParams.get("week"))   || nflWeek(season);

  // ── inputs ────────────────────────────────────────────────────────────
  const [board, sched, dvpRows, players] = await Promise.all([
    j(`nfl_proprietary_rankings_v2?format=eq.PPR&select=rank,name,position,team,score&order=rank.asc&limit=300`),
    j(`nfl_schedule?season=eq.${season}&week=eq.${week}&select=home_team,away_team`),
    // DVP is published per season; before week 1 the only real signal is last
    // year's, so take the newest season present rather than assuming this one.
    j(`nfl_dvp?select=season,team,position,rank_vs_pos&order=season.desc&limit=400`),
    j(`nfl_players?select=gsis_id,full_name&limit=6000`),
  ]);
  if (!board.length) return new Response(JSON.stringify({ ok: false, error: "no rankings" }), { status: 500, headers: CORS });
  if (!sched.length) return new Response(JSON.stringify({ ok: false, error: `no schedule for ${season} wk ${week}` }), { status: 500, headers: CORS });

  const nameToGsis = new Map<string, string>();
  for (const p of players) if (p.full_name && p.gsis_id) nameToGsis.set(norm(p.full_name), p.gsis_id);

  // opponent for each team this week; a team absent from the schedule is on bye
  const opp = new Map<string, string>();
  for (const g of sched) { opp.set(g.home_team, g.away_team); opp.set(g.away_team, g.home_team); }

  const dvpSeason = Math.max(...dvpRows.map((d: any) => d.season));
  const dvp = new Map<string, number>();
  for (const d of dvpRows) if (d.season === dvpSeason) dvp.set(`${d.team}:${d.position}`, d.rank_vs_pos);

  // Vegas implied totals, best effort. A missing feed must not stop the board
  // -- it just means the total multiplier is neutral for everyone.
  let totals = new Map<string, number>();
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/external-api-proxy?service=odds`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (r.ok) {
      const odds = await r.json();
      for (const g of (Array.isArray(odds) ? odds : odds.games ?? [])) {
        if (g.homeTeam && g.homeImpliedScore) totals.set(g.homeTeam, Number(g.homeImpliedScore));
        if (g.awayTeam && g.awayImpliedScore) totals.set(g.awayTeam, Number(g.awayImpliedScore));
      }
    }
  } catch { /* neutral for everyone */ }
  const avgTotal = totals.size ? [...totals.values()].reduce((a, b) => a + b, 0) / totals.size : null;

  // ── adjust ────────────────────────────────────────────────────────────
  const rows: any[] = [];
  for (const p of board) {
    if (!["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    const gsis = nameToGsis.get(norm(p.name));
    if (!gsis || !p.team) continue;
    const o = opp.get(p.team);
    if (!o) continue;                      // bye week: not startable, so not ranked

    // rank 1 = toughest defence -> 0.88 ; rank 32 = softest -> 1.12
    const dr = dvp.get(`${o}:${p.position}`) ?? null;
    const dvpMult = dr ? 0.88 + ((dr - 1) / 31) * 0.24 : 1.0;

    // A team expected to score more offers more to go round. Clamped so a
    // shootout cannot outweigh being good at football.
    const it = totals.get(p.team) ?? null;
    const totalMult = it && avgTotal ? Math.max(0.90, Math.min(1.10, it / avgTotal)) : 1.0;

    rows.push({
      season, week, format: "ppr", gsis_id: gsis, player_name: p.name,
      position: p.position, team: p.team, opponent: o,
      ros_score: p.score, dvp_rank: dr, dvp_mult: Number(dvpMult.toFixed(3)),
      implied_total: it, total_mult: Number(totalMult.toFixed(3)),
      week_score: Number((Number(p.score) * dvpMult * totalMult).toFixed(3)),
      rank: 0, pos_rank: 0,
    });
  }

  rows.sort((a, b) => b.week_score - a.week_score);
  const seen: Record<string, number> = {};
  rows.forEach((r, i) => { r.rank = i + 1; seen[r.position] = (seen[r.position] ?? 0) + 1; r.pos_rank = seen[r.position]; });

  const ins = await sb("nfl_weekly_board?on_conflict=season,week,format,gsis_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) {
    return new Response(JSON.stringify({ ok: false, error: (await ins.text()).slice(0, 200) }), { status: 500, headers: CORS });
  }

  // Enter it in the accuracy comparison as a WEEKLY board, so it is judged on
  // the week rather than on cumulative points.
  await sb("ranking_snapshots?on_conflict=season,week,source,format,player_name", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows.map(r => ({
      season, week, source: "aiomni_weekly", kind: "weekly", format: "ppr",
      gsis_id: r.gsis_id, player_name: r.player_name, position: r.position,
      team: r.team, rank: r.rank, pos_rank: r.pos_rank,
    }))),
  });

  return new Response(JSON.stringify({
    ok: true, season, week, players: rows.length,
    dvp_season_used: dvpSeason,
    vegas_totals: totals.size,
    top10: rows.slice(0, 10).map(r =>
      `${r.rank}. ${r.player_name} ${r.position}${r.pos_rank} vs ${r.opponent} (dvp ${r.dvp_rank ?? "-"}, x${r.dvp_mult})`),
  }, null, 2), { headers: CORS });
});
