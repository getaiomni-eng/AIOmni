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

// Roster-level absences. Not a week-1 lineup decision -- nobody is weighing
// whether to start a player on IR -- so these leave the board entirely.
// Sleeper's vocabulary, with ESPN's kept as aliases so either source works.
const ROSTER_OUT = new Set(["IR", "PUP", "Sus", "NA", "DNR", "COV",
  "Injured Reserve", "Physically Unable to Perform", "Non-Football Injury", "Suspension"]);

// Week-specific unavailability. These DO belong on the board, because the
// user is actively wondering about them -- but they must sort below every
// healthy player and be labelled, never quietly ranked mid-pack.
//
// "Doubtful" is in here on purpose. In NFL usage it means roughly a 25%
// chance to play, and standard practice is that you do not start a doubtful
// player. Treating it as a nudge was wrong: a shift applied to OVERALL rank
// barely moves a thin position group, so a doubtful Brock Bowers still landed
// TE8 -- a startable slot for someone expected to miss the game.
const WEEK_OUT = new Set(["Out", "Doubtful"]);

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
        const page = await j(`nfl_players?select=gsis_id,sleeper_id,full_name&limit=1000&offset=${off}`);
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
  const gsisToSleeper = new Map<string, string>();
  const sleeperToGsis = new Map<string, string>();
  for (const p of players) {
    if (p.full_name && p.gsis_id) nameToGsis.set(norm(p.full_name), p.gsis_id);
    // The headshot needs a Sleeper id; a gsis id 404s on their CDN.
    if (p.gsis_id && p.sleeper_id) {
      gsisToSleeper.set(p.gsis_id, String(p.sleeper_id));
      sleeperToGsis.set(String(p.sleeper_id), p.gsis_id);
    }
  }

  // opponent for each team this week; a team absent from the schedule is on bye
  const opp = new Map<string, string>();
  for (const g of sched) { opp.set(g.home_team, g.away_team); opp.set(g.away_team, g.home_team); }

  // Bounded so no matchup can outweigh talent by more than a tier or two.
  const MAX_DVP_SHIFT = 12;
  const MAX_TOTAL_SHIFT = 6;

  const dvpSeason = Math.max(...dvpRows.map((d: any) => d.season));
  const dvp = new Map<string, number>();
  for (const d of dvpRows) if (d.season === dvpSeason) dvp.set(`${d.team}:${d.position}`, d.rank_vs_pos);

  // ── market projections ────────────────────────────────────────────────
  // Sleeper publishes these at an endpoint the public v1 API does not mention.
  // We store them as the MARKET number and keep our rank as the opinion: the
  // interesting claim is the disagreement, not either figure alone.
  //
  // Ingestion starts before we have a model of our own on purpose. A
  // projection is only meaningful before the game, so history cannot be
  // back-filled -- by the time there is an AIOmni model there will be weeks of
  // baseline to beat.
  const proj = new Map<string, { ppr: number; half: number; std: number; name: string; pos: string; team: string }>();
  let projErr: string | null = null;
  try {
    const qs = ["QB","RB","WR","TE","K","DEF"].map(x => `position[]=${x}`).join("&");
    const r = await fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${qs}&order_by=pts_ppr`);
    if (!r.ok) throw new Error(`sleeper projections ${r.status}`);
    const rows = await r.json();
    for (const row of rows ?? []) {
      const id = row?.player_id != null ? String(row.player_id) : null;
      const st = row?.stats; const pl = row?.player ?? {};
      if (!id || !st) continue;
      proj.set(id, {
        ppr: Number(st.pts_ppr ?? 0), half: Number(st.pts_half_ppr ?? 0), std: Number(st.pts_std ?? 0),
        name: `${pl.first_name ?? ""} ${pl.last_name ?? ""}`.trim(),
        pos: pl.position ?? "", team: pl.team ?? pl.team_abbr ?? "",
      });
    }
  } catch (e) { projErr = String((e as any)?.message ?? e); }

  // Where the MARKET ranks each player within his position, so a row can show
  // "we have him WR6, the market has him WR43".
  const marketRank = new Map<string, number>();
  {
    // Only players the market actually expects to produce. Sleeper returns a
    // row for every player alive, most projected 0.0, and ranking those
    // produced "Tyreek Hill, market WR1016" -- which reads as the market
    // hating him when it means he is not expected to play at all. A 0.0
    // projection is information, but it is not a ranking.
    const byPos: Record<string, { id: string; pts: number }[]> = {};
    for (const [id, v] of proj) {
      if (!["QB","RB","WR","TE"].includes(v.pos)) continue;
      if (!(v.ppr > 0)) continue;
      (byPos[v.pos] ??= []).push({ id, pts: v.ppr });
    }
    for (const list of Object.values(byPos)) {
      list.sort((a, b) => b.pts - a.pts);
      list.forEach((x, i) => marketRank.set(x.id, i + 1));
    }
  }

  // ── injuries ──────────────────────────────────────────────────────────
  // ESPN's public injury feed, keyless. 800 players listed, with the weekly
  // designation the roster table does not carry (nfl_players.status has IR
  // and CUT but not Questionable/Doubtful).
  //
  // Out, IR and suspended players are EXCLUDED from the board rather than
  // demoted. A board that ranks an unavailable player 40th has given the
  // worst possible answer to "who should I start" -- worse than omitting him,
  // because it implies he is an option.
  const injury = new Map<string, string>();
  let injCount = 0, injErr: string | null = null;
  try {
    // Sleeper, not ESPN. ESPN's site.api returns 200 from a laptop and 403
    // from a Supabase edge function -- it blocks datacenter IPs -- so the
    // first version silently listed zero injuries and applied nothing.
    // Sleeper's player DB carries injury_status on every player, is reachable
    // from anywhere, and is already fetched elsewhere in this project.
    const r = await fetch("https://api.sleeper.app/v1/players/nfl");
    if (!r.ok) throw new Error(`sleeper players ${r.status}`);
    const db = await r.json();
    for (const pl of Object.values<any>(db)) {
      const st = pl?.injury_status;
      const nm = pl?.full_name ?? (pl?.first_name && pl?.last_name ? `${pl.first_name} ${pl.last_name}` : null);
      if (!nm || !st) continue;
      injury.set(norm(nm), st);
      injCount++;
    }
  } catch (e) { injErr = String((e as any)?.message ?? e); }

  // ── weather ───────────────────────────────────────────────────────────
  // Only outdoor stadiums, and only the conditions that actually move a game.
  // Wind is the one that reliably matters; temperature almost never does
  // until it is genuinely freezing, and light rain is mostly folklore.
  const WEATHER_KEY = Deno.env.get("WEATHER_API_KEY");
  const STADIUM: Record<string, { lat: number; lon: number }> = {
    BUF:{lat:42.774,lon:-78.787}, MIA:{lat:25.958,lon:-80.239}, NE:{lat:42.091,lon:-71.264},
    NYJ:{lat:40.814,lon:-74.074}, BAL:{lat:39.278,lon:-76.623}, CIN:{lat:39.095,lon:-84.516},
    CLE:{lat:41.506,lon:-81.699}, PIT:{lat:40.447,lon:-80.016}, DEN:{lat:39.744,lon:-105.020},
    KC:{lat:39.049,lon:-94.484},  CHI:{lat:41.862,lon:-87.617}, GB:{lat:44.501,lon:-88.062},
    PHI:{lat:39.901,lon:-75.168}, WAS:{lat:38.908,lon:-76.864}, NYG:{lat:40.814,lon:-74.074},
    TB:{lat:27.976,lon:-82.503},  CAR:{lat:35.226,lon:-80.853}, SEA:{lat:47.595,lon:-122.332},
    SF:{lat:37.403,lon:-121.970}, TEN:{lat:36.166,lon:-86.771}, JAX:{lat:30.324,lon:-81.637},
  };
  // Keyed by HOME team, since that is where the game is played.
  const wx = new Map<string, { wind: number; cond: string; temp: number }>();
  let wxCount = 0;
  if (WEATHER_KEY) {
    const homes = [...new Set(sched.map((g: any) => g.home_team))].filter(t => STADIUM[t]);
    await Promise.all(homes.map(async (t) => {
      try {
        const st = STADIUM[t];
        const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${st.lat}&lon=${st.lon}&units=imperial&appid=${WEATHER_KEY}`);
        if (!r.ok) return;
        const d = await r.json();
        wx.set(t, { wind: Math.round(d.wind?.speed ?? 0), cond: d.weather?.[0]?.main ?? "Clear", temp: Math.round(d.main?.temp ?? 60) });
        wxCount++;
      } catch { /* one stadium missing is not worth failing the board */ }
    }));
  }
  // Which home stadium is each team playing in this week?
  const venue = new Map<string, string>();
  for (const g of sched) { venue.set(g.home_team, g.home_team); venue.set(g.away_team, g.home_team); }

  // Vegas implied totals.
  //
  // The first version called external-api-proxy with the anon key. That proxy
  // requires a USER JWT (services/liveData.ts:proxyFetch reads
  // session.access_token), so it rejected every request and the failure was
  // swallowed into an empty map -- reported as "Vegas has no lines", which
  // was never true. Week 1 lines have been out for months.
  //
  // This runs server-side with the same project secrets, so call The Odds API
  // directly rather than round-tripping through a proxy built for clients.
  const ODDS_KEY = Deno.env.get("ODDS_API_KEY");
  const TEAM: Record<string, string> = {
    "Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF",
    "Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE",
    "Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB",
    "Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC",
    "Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LAR","Miami Dolphins":"MIA",
    "Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG",
    "New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF",
    "Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS",
  };
  const totals = new Map<string, number>();
  let oddsGames = 0, oddsErr: string | null = null;
  try {
    if (!ODDS_KEY) throw new Error("ODDS_API_KEY not set");
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${ODDS_KEY}&regions=us&markets=spreads,totals&oddsFormat=american`);
    if (!r.ok) throw new Error(`odds ${r.status}`);
    const games = await r.json();
    for (const g of games) {
      const bk = (g.bookmakers ?? [])[0];
      if (!bk) continue;
      const spreads = (bk.markets ?? []).find((m: any) => m.key === "spreads");
      const tot     = (bk.markets ?? []).find((m: any) => m.key === "totals");
      const line    = tot?.outcomes?.[0]?.point;
      if (!spreads || !line) continue;
      for (const o of spreads.outcomes ?? []) {
        const abbr = TEAM[o.name];
        // implied = total/2 - spread/2 ; a favourite's spread is negative,
        // so this correctly gives them the larger share of the total.
        if (abbr && typeof o.point === "number") totals.set(abbr, Number((line / 2 - o.point / 2).toFixed(2)));
      }
      oddsGames++;
    }
  } catch (e) { oddsErr = String((e as any)?.message ?? e); }

  const avgTotal = totals.size ? [...totals.values()].reduce((a, b) => a + b, 0) / totals.size : null;

  // ── adjust ────────────────────────────────────────────────────────────
  const rows: any[] = [];
  for (const p of board) {
    if (!["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    const gsis = nameToGsis.get(norm(p.name));
    if (!gsis || !p.team) continue;
    const o = opp.get(p.team);
    if (!o) continue;                      // bye week: not startable, so not ranked

    // Unavailable players are removed, not demoted. Ranking someone 40th who
    // cannot play is a worse answer than omitting him, because appearing on
    // the board implies he is an option.
    const inj = injury.get(norm(p.name)) ?? null;
    if (inj && ROSTER_OUT.has(inj)) continue;
    const weekOut = !!inj && WEEK_OUT.has(inj);

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

    // Questionable is a real cost but not a verdict -- plenty of questionable
    // players start and produce. Doubtful is close to unavailable without
    // being official, so it is pushed far enough down to be obvious.
    // Questionable is a real cost but not a verdict -- questionable players
    // start and produce every week.
    const injShift = inj === "Questionable" ? -5 : 0;

    // Weather, only where it genuinely moves a game. Wind is the reliable
    // signal: over 15mph the passing game suffers and the run game gains a
    // little. Cold is mostly overstated until it is freezing, and light rain
    // is folklore, so neither gets much weight.
    const w = wx.get(venue.get(p.team) ?? "");
    let wxShift = 0;
    if (w) {
      const passer = p.position === "QB" || p.position === "WR" || p.position === "TE";
      if (w.wind >= 20)      wxShift += passer ? -8 : 3;
      else if (w.wind >= 15) wxShift += passer ? -4 : 2;
      if (w.cond === "Snow") wxShift += passer ? -5 : 3;
      if (w.temp <= 20)      wxShift += passer ? -2 : 0;
    }

    // Lower is better, so a favourable factor subtracts.
    // Out and Doubtful sort below every healthy player rather than competing
    // with them. Their relative order among themselves is preserved so the
    // list still reads sensibly, but no adjustment can lift one back into a
    // startable slot.
    const effective = weekOut
      ? 10_000 + p.rank
      : p.rank - dvpShift - totalShift - injShift - wxShift;

    rows.push({
      season, week, format: "ppr", gsis_id: gsis,
      sleeper_id: gsisToSleeper.get(gsis) ?? null,
      // A 0.0 projection is stored as null: the app would render "0.0" as a
      // real forecast of zero, which is what made the Coach refuse to call a
      // matchup earlier in this same project.
      proj_pts: (() => {
        const sid = gsisToSleeper.get(gsis);
        const v = sid ? proj.get(sid)?.ppr : undefined;
        return v != null && v > 0 ? v : null;
      })(),
      market_pos_rank: (() => { const sid = gsisToSleeper.get(gsis); return sid ? (marketRank.get(sid) ?? null) : null; })(),
      player_name: p.name,
      position: p.position, team: p.team, opponent: o,
      ros_score: p.score, dvp_rank: dr,
      injury_status: inj, injury_shift: weekOut ? null : injShift,
      startable: !weekOut,
      weather_note: w ? `${w.wind}mph ${w.cond}` : null, weather_shift: wxShift,
      dvp_shift: Number(dvpShift.toFixed(2)),
      implied_total: it, total_shift: Number(totalShift.toFixed(2)),
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
  // Positional rank counts only startable players, so "TE5" always means the
  // fifth tight end you could actually play. An unavailable player carries a
  // pos_rank for ordering but it is not a recommendation.
  const seen: Record<string, number> = {};
  rows.forEach((r, i) => {
    r.rank = i + 1;
    if (r.startable) { seen[r.position] = (seen[r.position] ?? 0) + 1; r.pos_rank = seen[r.position]; }
    else { r.pos_rank = (seen[r.position] ?? 0) + 99; }
  });

  // Replace the week rather than merging into it. An upsert leaves behind
  // rows that are no longer on the board -- which is exactly how the Justin
  // Jefferson LINEBACKER survived after the season view stopped emitting him:
  // his row from an earlier run was never in the new batch, so nothing
  // removed it. A recomputed board should be the whole board.
  await sb(`nfl_weekly_board?season=eq.${season}&week=eq.${week}&format=eq.ppr`, { method: "DELETE" });

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
  await sb(`ranking_snapshots?season=eq.${season}&week=eq.${week}&source=eq.aiomni_weekly&format=eq.ppr`, { method: "DELETE" });
  await sb("ranking_snapshots?on_conflict=season,week,source,format,player_name", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows.map(r => ({
      season, week, source: "aiomni_weekly", kind: "weekly", format: "ppr",
      gsis_id: r.gsis_id, player_name: r.player_name, position: r.position,
      team: r.team, rank: r.rank, pos_rank: r.pos_rank,
    }))),
  });

  // Store the market projections themselves, keyed by source, so
  // score_projections() can grade them against actuals on Tuesday -- and so
  // an AIOmni model later lands in the same table and the same harness.
  if (proj.size) {
    const projRows = [...proj.entries()]
      .filter(([, v]) => v.name && ["QB","RB","WR","TE"].includes(v.pos))
      .map(([sid, v]) => ({
        season, week, source: "sleeper", sleeper_id: sid,
        gsis_id: sleeperToGsis.get(sid) ?? null,
        player_name: v.name, position: v.pos, team: v.team,
        pts_ppr: v.ppr, pts_half: v.half, pts_std: v.std,
      }));
    await sb(`nfl_projections?season=eq.${season}&week=eq.${week}&source=eq.sleeper`, { method: "DELETE" });
    for (let i = 0; i < projRows.length; i += 500) {
      await sb("nfl_projections?on_conflict=season,week,source,player_name", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(projRows.slice(i, i + 500)),
      });
    }
  }

  return new Response(JSON.stringify({
    ok: true, season, week, players: rows.length,
    market_projections: proj.size, projections_error: projErr, duplicates_dropped: dupesDropped,
    player_index_size: players.length,
    with_photo: rows.filter((r: any) => r.sleeper_id).length,
    dvp_season_used: dvpSeason,
    vegas_totals: totals.size, odds_games: oddsGames, odds_error: oddsErr,
    injuries_listed: injCount, injuries_error: injErr, stadiums_with_weather: wxCount,
    top10: rows.slice(0, 10).map(r =>
      `${r.rank}. ${r.player_name} ${r.position}${r.pos_rank} vs ${r.opponent} (dvp ${r.dvp_rank ?? "-"}, shift ${r.dvp_shift > 0 ? "+" : ""}${r.dvp_shift})`),
  }, null, 2), { headers: CORS });
});
