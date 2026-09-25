// supabase/functions/weekly-rankings/index.ts
//
// The rebuilt weekly rankings: four independent views, ensembled.
//
//   recency  last-5 / last-7 games, usage spikes checked against injuries and
//            depth-chart changes
//   matchup  current season only: what this defense allowed to the same ROLE
//            relative to each player's norm, plus Vegas, weather, depth chart
//   context  current season only: usage, production, opponent strength,
//            travel, weather
//   manual   the top 25 per position ranked by hand (manual_weekly_rankings)
//
// Nothing here reads the season engine. That was the point of the rebuild:
// the old weekly board was nfl_proprietary_rankings_v2 plus nudges, and it
// inherited a season-total base that sat ~0.10 Spearman behind the market.
//
// The models are pure functions in ../_shared/weekly, the same files the
// local backtest (scripts/weekly) grades. This function only loads data,
// adds the two live inputs a backtest cannot have (current Vegas lines and
// kickoff forecasts), runs them, and writes:
//
//   weekly_model_rankings  one row per model per player (inspect/grade each)
//   weekly_rankings        the ensemble
//
// SHADOW. The app still reads nfl_weekly_board. Switch only after this beats
// it on graded live weeks.
//
// Body / query: { season?, week?, dry_run?, refresh_status? }. Week defaults to the next
// unplayed week, derived the same way the board crons derive it.

import { assembleInput, positionRanks } from '../_shared/weekly/common.ts';
import { ensemble, overallRanks, type ManualRow } from '../_shared/weekly/ensemble.ts';
import { modelContext } from '../_shared/weekly/context.ts';
import { modelMatchup } from '../_shared/weekly/matchup.ts';
import { modelRecency } from '../_shared/weekly/recency.ts';
import { STADIUMS } from '../_shared/weekly/stadiums.ts';
import type { Forecast, GameRow, ModelRow, StatusOverride, WeeklyModel } from '../_shared/weekly/types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODELS: Record<string, WeeklyModel> = { recency: modelRecency, matchup: modelMatchup, context: modelContext };

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });
}

// PostgREST caps a page regardless of `limit`, so page explicitly.
async function all<T = any>(path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let off = 0; ; off += 1000) {
    const r = await sb(`${path}${sep}limit=1000&offset=${off}`);
    if (!r.ok) throw new Error(`read ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function write(table: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await sb(table, {
      method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error(`${table} write ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

// ── live Vegas ─────────────────────────────────────────────────────────────
// nfl_games carries nflverse's lines, refreshed daily. The Odds API is fresher
// on game day, so when it answers, its consensus replaces nflverse's for the
// target week. Either way the models see one spread_line/total_line per game.
const ODDS_TEAM: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LA', 'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

async function liveLines(games: GameRow[]) {
  const key = Deno.env.get('ODDS_API_KEY');
  if (!key) return { updated: 0, error: 'ODDS_API_KEY not set' };
  const r = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${key}&regions=us&markets=spreads,totals&oddsFormat=american`);
  if (!r.ok) return { updated: 0, error: `odds ${r.status}` };
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  let updated = 0;
  const now = Date.now();
  for (const ev of await r.json()) {
    // A game already under way comes back with IN-GAME lines, which move with
    // the score. Week 3's first run landed during TNF and read ATL's implied
    // total as 16.25 against a 19.5 pregame line, dropping Bijan to RB6 in
    // matchup. Started games keep nflverse's pregame closing line.
    if (Date.parse(ev.commence_time) <= now) continue;
    const home = ODDS_TEAM[ev.home_team], away = ODDS_TEAM[ev.away_team];
    const g = games.find(x => x.home_team === home && x.away_team === away);
    if (!g) continue;
    const spreads: number[] = [], totals: number[] = [];
    for (const bk of ev.bookmakers ?? []) {
      for (const m of bk.markets ?? []) {
        if (m.key === 'spreads') {
          const h = (m.outcomes ?? []).find((o: any) => o.name === ev.home_team);
          // Odds API: home favourite has a NEGATIVE point. nflverse: positive.
          if (typeof h?.point === 'number') spreads.push(-h.point);
        } else if (m.key === 'totals') {
          const o = (m.outcomes ?? [])[0];
          if (typeof o?.point === 'number') totals.push(o.point);
        }
      }
    }
    const sp = med(spreads), tt = med(totals);
    if (sp != null) g.spread_line = sp;
    if (tt != null) g.total_line = tt;
    if (sp != null || tt != null) updated++;
  }
  return { updated, error: null };
}

// ── kickoff forecasts ──────────────────────────────────────────────────────
// Open-air venues only; domes and retractables are weather-neutral. The 3-hour
// block nearest kickoff, and nothing past the 5-day window: a wrong block is
// worse than none (weekly-board learned that in week 2).
async function forecasts(games: GameRow[]) {
  const key = Deno.env.get('WEATHER_API_KEY');
  const out: Record<string, Forecast> = {};
  if (!key) return { out, error: 'WEATHER_API_KEY not set' };
  await Promise.all(games.map(async g => {
    const st = STADIUMS[g.stadium_id];
    if (!st || st.roof !== 'outdoors') return;
    const [y, m, d] = g.gameday.split('-').map(Number);
    const [hh, mm] = (g.gametime || '13:00').split(':').map(Number);
    const nov1 = new Date(Date.UTC(y, 10, 1));
    const dstEnd = Date.UTC(y, 10, 1 + ((7 - nov1.getUTCDay()) % 7));
    const local = Date.UTC(y, m - 1, d, hh, mm);
    const kick = local + (local < dstEnd ? 4 : 5) * 3600_000;
    try {
      const r = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${st.lat}&lon=${st.lon}&units=imperial&appid=${key}`);
      if (!r.ok) return;
      const blocks: any[] = (await r.json())?.list ?? [];
      let best: any = null, gap = Infinity;
      for (const b of blocks) {
        const d2 = Math.abs(Number(b.dt) * 1000 - kick);
        if (d2 < gap) { gap = d2; best = b; }
      }
      if (!best || gap > 6 * 3600_000) return;
      const main = String(best.weather?.[0]?.main ?? '');
      out[g.game_id] = {
        wind: Math.round(best.wind?.speed ?? 0),
        temp: Math.round(best.main?.temp ?? 60),
        precip: /Rain|Snow|Thunderstorm|Drizzle/.test(main),
      };
    } catch { /* one venue missing is not worth failing the run */ }
  }));
  return { out, error: null };
}

Deno.serve(async (req) => {
  const started = Date.now();
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const season: number = Number(body?.season ?? url.searchParams.get('season'))
      || (now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
    let week: number = Number(body?.week ?? url.searchParams.get('week')) || 0;
    const dryRun = body?.dry_run === true || url.searchParams.get('dry_run') === '1';
    if (!week) {
      const r = await all<{ week: number }>(`nfl_weekly_stats?select=week&season=eq.${season}&season_type=eq.REG&order=week.desc`);
      week = (r[0]?.week ?? 0) + 1;
    }
    const prev = season - 1;

    // refresh_status: pull Sleeper's injury feed first, so a scratch announced
    // minutes ago is in this build. Used by the post-inactives crons and the
    // "Rebuild rankings now" button on the /rank injury desk.
    let statusRefresh: unknown = null;
    if (body?.refresh_status === true) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/player-status-sync`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: '{}',
      }).catch((e) => ({ ok: false, text: async () => String(e) } as any));
      statusRefresh = r.ok ? await r.json().catch(() => ({ ok: true })) : { ok: false, error: (await r.text()).slice(0, 200) };
    }

    const [stats, games, snaps, injuries, depth, status, players, manualRows, overrides] = await Promise.all([
      all(`weekly_model_stats?select=*&season=gte.${prev}`),
      all<GameRow>(`nfl_games?select=*&season=gte.${prev}`),
      all(`nfl_snap_counts?select=*&season=gte.${prev}`),
      all(`nfl_injury_reports?select=*&season=gte.${prev}`),
      all(`nfl_depth_weekly?select=*&season=gte.${prev}`),
      all(`nfl_player_status?select=sleeper_id,gsis_id,player_name,position,team,status,injury_status,practice_participation,depth_chart_order,depth_chart_position`),
      all(`nfl_players?select=gsis_id,draft_round,draft_pick,rookie_year,position&position=in.(QB,RB,WR,TE,FB)`),
      all<ManualRow & { season: number; week: number }>(`manual_weekly_rankings?select=position,rank,gsis_id&season=eq.${season}&week=eq.${week}`)
        .catch(() => []),
      all<StatusOverride>(`player_status_overrides?select=norm_name,position,season,week,injury_status`).catch(() => []),
    ]);

    const target = (games as GameRow[]).filter(g => g.season === season && g.week === week);
    if (target.length === 0) throw new Error(`no games for ${season} week ${week}`);
    const [vegas, wx] = await Promise.all([liveLines(target), forecasts(target)]);

    const draft: Record<string, { draft_round: number | null; draft_pick: number | null; rookie_season: number | null }> = {};
    for (const p of players as any[]) draft[p.gsis_id] = { draft_round: p.draft_round, draft_pick: p.draft_pick, rookie_season: p.rookie_year };

    const input = assembleInput({
      stats: stats as any, games: games as GameRow[], snaps: snaps as any, injuries: injuries as any,
      depth: depth as any, status: status as any, forecast: wx.out, draft, overrides,
    }, season, week);

    const outputs: Record<string, ModelRow[]> = {};
    const modelErrors: Record<string, string> = {};
    for (const [name, model] of Object.entries(MODELS)) {
      try { outputs[name] = model(input); }
      catch (e) { modelErrors[name] = String((e as Error)?.message ?? e); }
    }
    if (Object.keys(outputs).length === 0) throw new Error(`every model failed: ${JSON.stringify(modelErrors)}`);

    const ens = ensemble(input.pool, outputs, manualRows as ManualRow[]);
    const overall = overallRanks(ens);
    const byId = new Map(input.pool.map(p => [p.gsis_id, p]));
    const sleeperId = new Map((status as any[]).filter(s => s.gsis_id?.trim()).map(s => [s.gsis_id.trim(), s.sleeper_id]));
    const computed_at = new Date().toISOString();

    const modelRows: unknown[] = [];
    for (const [name, rows] of Object.entries(outputs)) {
      const ranks = positionRanks(rows.filter(r => byId.has(r.gsis_id)));
      for (const r of rows) {
        const p = byId.get(r.gsis_id);
        if (!p) continue;
        modelRows.push({
          season, week, model: name, gsis_id: r.gsis_id, player_name: p.player_name, position: p.position,
          team: p.team, opponent: p.opponent, proj: isFinite(r.proj) ? +r.proj.toFixed(2) : null,
          pos_rank: ranks.get(r.gsis_id) ?? null, notes: r.notes ?? [], detail: r.detail ?? {}, computed_at,
        });
      }
    }
    const ensRows = ens.map(e => {
      const p = byId.get(e.gsis_id)!;
      return {
        season, week, gsis_id: e.gsis_id, sleeper_id: sleeperId.get(e.gsis_id) ?? null,
        player_name: p.player_name, position: p.position, team: p.team, opponent: p.opponent,
        rank: overall.get(e.gsis_id) ?? null, pos_rank: e.pos_rank, ensemble_score: +e.score.toFixed(3),
        rank_recency: e.ranks.recency ?? null, rank_matchup: e.ranks.matchup ?? null,
        rank_context: e.ranks.context ?? null, rank_manual: e.ranks.manual ?? null,
        proj_pts: e.proj_pts == null ? null : +e.proj_pts.toFixed(2),
        injury_status: p.injury_status, notes: e.notes, computed_at,
      };
    });

    if (!dryRun) {
      // Replace the week wholesale: a player who dropped out of the pool
      // (ruled out, cut) must not linger from an earlier run.
      for (const t of ['weekly_model_rankings', 'weekly_rankings']) {
        const d = await sb(`${t}?season=eq.${season}&week=eq.${week}`, { method: 'DELETE' });
        if (!d.ok) throw new Error(`${t} delete ${d.status}`);
      }
      await write('weekly_model_rankings', modelRows);
      await write('weekly_rankings', ensRows);

      // The graded record: the first build of a week is frozen as
      // aiomni_ensemble in ranking_snapshots, exactly as weekly-board freezes
      // aiomni_weekly. Later builds refresh what users see and never touch the
      // record, so a Sunday-morning rebuild cannot grade itself on news that
      // broke after the prediction was made.
      const locked = await sb(
        `ranking_snapshots?season=eq.${season}&week=eq.${week}&source=eq.aiomni_ensemble&format=eq.ppr&select=player_name&limit=1`)
        .then(r => r.ok ? r.json() : []).catch(() => []);
      if (!(Array.isArray(locked) && locked.length > 0)) {
        const r = await sb('ranking_snapshots?on_conflict=season,week,source,format,player_name', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(ensRows.map(e => ({
            season, week, source: 'aiomni_ensemble', kind: 'weekly', format: 'ppr',
            gsis_id: e.gsis_id, player_name: e.player_name, position: e.position,
            team: e.team, rank: e.rank, pos_rank: e.pos_rank,
          }))),
        });
        if (!r.ok) console.log('[weekly-rankings] snapshot write failed:', r.status, (await r.text()).slice(0, 200));
      }
    }

    const top = (pos: string) => ensRows.filter(r => r.position === pos && r.pos_rank <= 5)
      .map(r => `${r.pos_rank}. ${r.player_name} (${r.rank_recency}/${r.rank_matchup}/${r.rank_context}/${r.rank_manual ?? '-'})`);
    return new Response(JSON.stringify({
      ok: true, season, week, dry_run: dryRun,
      pool: input.pool.length, models: Object.keys(outputs), model_errors: modelErrors,
      status_refresh: statusRefresh, overrides_loaded: (overrides as StatusOverride[]).length,
      manual_positions: [...new Set((manualRows as ManualRow[]).map(m => m.position))],
      vegas_live_games: vegas.updated, vegas_error: vegas.error,
      forecasts: Object.keys(wx.out).length, weather_error: wx.error,
      written: dryRun ? 0 : { models: modelRows.length, ensemble: ensRows.length },
      top5: { QB: top('QB'), RB: top('RB'), WR: top('WR'), TE: top('TE') },
      duration_seconds: Math.round((Date.now() - started) / 1000),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
