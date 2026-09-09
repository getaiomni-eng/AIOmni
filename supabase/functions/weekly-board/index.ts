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
    // Paginated, not `limit=6000`: PostgREST caps a page regardless of the
    // limit asked for, so the single-request version silently returned 1000
    // players and only ~40% of the board could be mapped to a gsis_id.
    (async () => {
      const all: any[] = [];
      for (let off = 0; off < 8000; off += 1000) {
        const page = await j(`nfl_players?select=gsis_id,full_name&limit=1000&offset=${off}`);
        if (!page.length) break;
        all.push(...page);
        if (page.length < 1000) break;
      }
      return all;
    })(),
  ]);
  if (!board.length) return new Response(JSON.stringify({ ok: false, error: "no rankings" }), { status: 500, headers: CORS });
  if (!sched.length) return new Response(JSON.stringify({ ok: false, error: `no schedule for ${season} wk ${week}` }), { status: 500, headers: CORS });

  const nameToGsis = new Map<string, string>();
  for (const p of players) if (p.full_name && p.gsis_id) nameToGsis.set(norm(p.full_name), p.gsis_id);

  // opponent for each team this week; a team absent from the schedule is on bye
  const opp = new Map<string, string>();
  for (const g of sched) { opp.set(g.home_team, g.away_team); opp.set(g.away_team, g.home_team); }

  // Bounded so no matchup can outweigh talent by more than a tier or two.
  const MAX_DVP_SHIFT = 12;
  const MAX_TOTAL_SHIFT = 6;

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

    // Adjust in RANK space, not score space.
    //
    // The first version multiplied ros_score by the matchup factor. That is
    // wrong here because Formula scores go NEGATIVE past about rank 105
    // (rank 150 scores -58.8). Multiplying a negative by 1.12 for a good
    // matchup makes it MORE negative and ranks the player LOWER -- the logic
    // inverts exactly where most of the board lives. It sent Josh Jacobs from
    // 99 to 246 on a matchup that should have moved him a few spots.
    //
    // A rank shift is sign-safe, bounded, and easier to defend: the softest
    // defence is worth about a dozen places, the toughest costs about the
    // same, and nothing in between can produce a 147-place swing.
    const dr = dvp.get(`${o}:${p.position}`) ?? null;
    const dvpShift = dr ? ((dr - 16.5) / 15.5) * MAX_DVP_SHIFT : 0;

    // Vegas nudges in the same currency. Neutral when the feed is absent.
    const it = totals.get(p.team) ?? null;
    const totalShift = it && avgTotal
      ? Math.max(-MAX_TOTAL_SHIFT, Math.min(MAX_TOTAL_SHIFT,
          ((it - avgTotal) / Math.max(avgTotal, 1)) * MAX_TOTAL_SHIFT * 4))
      : 0;

    // Lower is better, so a favourable matchup subtracts.
    const effective = p.rank - dvpShift - totalShift;

    rows.push({
      season, week, format: "ppr", gsis_id: gsis, player_name: p.name,
      position: p.position, team: p.team, opponent: o,
      ros_score: p.score, dvp_rank: dr,
      dvp_mult: Number(dvpShift.toFixed(2)),      // stored as a RANK SHIFT now
      implied_total: it, total_mult: Number(totalShift.toFixed(2)),
      week_score: Number(effective.toFixed(3)),   // lower = better
      rank: 0, pos_rank: 0,
    });
  }

  // The Formula board ships duplicate rows for a handful of rookies (250
  // rows, 246 distinct players) which collide on gsis_id and make Postgres
  // reject the whole batch with 21000. Keep the better rest-of-season rank.
  const byPlayer = new Map<string, any>();
  for (const r of rows) {
    const prev = byPlayer.get(r.gsis_id);
    if (!prev || Number(r.week_score) < Number(prev.week_score)) byPlayer.set(r.gsis_id, r);
  }
  const dupesDropped = rows.length - byPlayer.size;
  rows.length = 0;
  rows.push(...byPlayer.values());

  rows.sort((a, b) => a.week_score - b.week_score);
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
    ok: true, season, week, players: rows.length, duplicates_dropped: dupesDropped,
    player_index_size: players.length,
    dvp_season_used: dvpSeason,
    vegas_totals: totals.size,
    top10: rows.slice(0, 10).map(r =>
      `${r.rank}. ${r.player_name} ${r.position}${r.pos_rank} vs ${r.opponent} (dvp ${r.dvp_rank ?? "-"}, shift ${r.dvp_mult > 0 ? "+" : ""}${r.dvp_mult})`),
  }, null, 2), { headers: CORS });
});
