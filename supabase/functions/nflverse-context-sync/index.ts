// supabase/functions/nflverse-context-sync/index.ts
//
// Keeps the weekly models' context tables current from nflverse:
//
//   nfl_games           games.csv            lines, rest, roof, venue, kickoff weather
//   nfl_snap_counts     snap_counts_{season} offense snap share per game
//   nfl_injury_reports  injuries_{season}    official report, final game status
//   nfl_depth_weekly    depth_charts_{season} last pre-kickoff chart per team-week
//
// DEPTH CHARTS WITHOUT THE 53 MB FILE. depth_charts_{season}.csv is every
// twice-daily snapshot since March, ~53 MB by September -- too much to parse
// inside an edge function's CPU budget. The file is written newest-first, so a
// byte-range request for the first 1.5 MB returns the latest few snapshots for
// all 32 teams (verified 2026-09-24: three complete snapshots). Each run takes
// each team's newest snapshot and writes it as that team's chart for its NEXT
// game -- but only while that game has not kicked off. After kickoff the
// team-week is frozen, so the table always holds what was known beforehand.
//
// Body: { season?: number, parts?: ('games'|'snaps'|'injuries'|'depth')[] }
// Default: current season, all parts. Backfill a prior season's snaps and
// injuries with {"season": 2025, "parts": ["snaps","injuries"]}.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REL = 'https://github.com/nflverse/nflverse-data/releases/download';
const GAMES_CSV = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';
const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);
const DEPTH_HEAD_BYTES = 1_500_000;

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });
}

async function upsert(table: string, conflict: string, rows: unknown[]) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const r = await sb(`${table}?on_conflict=${conflict}`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    });
    if (!r.ok) throw new Error(`${table} write ${r.status}: ${(await r.text()).slice(0, 200)}`);
    written += slice.length;
  }
  return written;
}

// Quote-aware CSV. `partial` drops a trailing line cut off by a byte range.
function parseCSV(text: string, partial = false): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (!partial && (field || row.length)) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const h = rows[0];
  return rows.slice(1).filter(r => r.length === h.length)
    .map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

const s = (v?: string) => (v && v !== 'NA' ? v : null);
const n = (v?: string) => { const x = s(v); if (x == null) return null; const f = Number(x); return isFinite(f) ? f : null; };
const pos = (p?: string) => (p === 'FB' ? 'RB' : p ?? '');

async function csv(url: string, init?: RequestInit, partial = false) {
  const r = await fetch(url, { redirect: 'follow', ...init });
  if (!r.ok && r.status !== 206) throw new Error(`fetch ${r.status}: ${url}`);
  return parseCSV(await r.text(), partial);
}

// nflverse gametime is US/Eastern wall clock.
function kickoffUtc(gameday: string, gametime: string) {
  const [y, m, d] = gameday.split('-').map(Number);
  const [hh, mm] = (gametime || '13:00').split(':').map(Number);
  // DST ends the first Sunday of November.
  const nov1 = new Date(Date.UTC(y, 10, 1));
  const dstEnd = Date.UTC(y, 10, 1 + ((7 - nov1.getUTCDay()) % 7));
  const local = Date.UTC(y, m - 1, d, hh, mm);
  return local + (local < dstEnd ? 4 : 5) * 3600_000;
}

Deno.serve(async (req) => {
  const started = Date.now();
  const out: Record<string, unknown> = {};
  try {
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const season: number = Number(body?.season) || (now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
    const parts: string[] = Array.isArray(body?.parts) ? body.parts : ['games', 'snaps', 'injuries', 'depth'];
    out.season = season;

    // Games are needed by depth (kickoffs) even when not being written.
    const gameRows = (await csv(GAMES_CSV))
      .filter(g => Number(g.season) === season && g.game_type === 'REG')
      .map(g => ({
        game_id: g.game_id, season, week: Number(g.week),
        gameday: g.gameday, gametime: g.gametime, weekday: g.weekday,
        away_team: g.away_team, home_team: g.home_team,
        away_score: n(g.away_score), home_score: n(g.home_score),
        location: s(g.location), away_rest: n(g.away_rest), home_rest: n(g.home_rest),
        spread_line: n(g.spread_line), total_line: n(g.total_line),
        div_game: g.div_game === '1', roof: s(g.roof), surface: s(g.surface),
        temp: n(g.temp), wind: n(g.wind), stadium_id: s(g.stadium_id), stadium: s(g.stadium),
        updated_at: new Date().toISOString(),
      }));
    if (parts.includes('games')) out.games = await upsert('nfl_games', 'game_id', gameRows);

    if (parts.includes('snaps')) {
      // pfr id -> gsis id from our own player table.
      const pfr = new Map<string, string>();
      for (let off = 0; off < 20000; off += 1000) {
        const r = await sb(`nfl_players?select=gsis_id,pfr_id&pfr_id=not.is.null&limit=1000&offset=${off}`);
        const page = r.ok ? await r.json() : [];
        for (const p of page) pfr.set(p.pfr_id, p.gsis_id);
        if (page.length < 1000) break;
      }
      const rows = (await csv(`${REL}/snap_counts/snap_counts_${season}.csv`))
        .filter(r => r.game_type === 'REG' && SKILL.has(r.position))
        .map(r => ({
          game_id: r.game_id, pfr_player_id: r.pfr_player_id, season, week: Number(r.week),
          gsis_id: pfr.get(r.pfr_player_id) ?? null, player_name: r.player, position: pos(r.position),
          team: r.team, opponent: r.opponent,
          offense_snaps: n(r.offense_snaps), offense_pct: n(r.offense_pct),
        }));
      out.snaps = await upsert('nfl_snap_counts', 'game_id,pfr_player_id', rows);
      out.snaps_unmapped = rows.filter(r => !r.gsis_id).length;
    }

    if (parts.includes('injuries')) {
      const rows = (await csv(`${REL}/injuries/injuries_${season}.csv`))
        .filter(r => r.game_type === 'REG' && SKILL.has(r.position) && r.gsis_id)
        .map(r => ({
          season, week: Number(r.week), gsis_id: r.gsis_id, team: r.team,
          player_name: r.full_name, position: pos(r.position),
          report_status: s(r.report_status), report_primary_injury: s(r.report_primary_injury),
          practice_status: s(r.practice_status),
        }));
      out.injuries = await upsert('nfl_injury_reports', 'season,week,gsis_id', rows);
    }

    if (parts.includes('depth')) {
      const head = await csv(`${REL}/depth_charts/depth_charts_${season}.csv`,
        { headers: { Range: `bytes=0-${DEPTH_HEAD_BYTES - 1}` } }, true);
      // Newest snapshot per team.
      const newest = new Map<string, string>();
      for (const r of head) if (!newest.has(r.team) || r.dt > newest.get(r.team)!) newest.set(r.team, r.dt);
      // Each team's next game that has not kicked off.
      const next = new Map<string, { week: number; kick: number }>();
      for (const g of gameRows) {
        const k = kickoffUtc(g.gameday, g.gametime);
        if (k <= now.getTime()) continue;
        for (const t of [g.home_team, g.away_team]) {
          const p = next.get(t);
          if (!p || k < p.kick) next.set(t, { week: g.week, kick: k });
        }
      }
      const rows: unknown[] = [];
      const teams: string[] = [];
      for (const [team, dt] of newest) {
        const nx = next.get(team);
        if (!nx || Date.parse(dt) >= nx.kick) continue;
        teams.push(`${team}:${nx.week}`);
        for (const r of head) {
          if (r.team !== team || r.dt !== dt || !SKILL.has(r.pos_abb)) continue;
          rows.push({
            season, week: nx.week, team, player_name: r.player_name, slot: r.pos_name,
            gsis_id: s(r.gsis_id), position: pos(r.pos_abb), slot_rank: Number(r.pos_rank), captured_at: dt,
          });
        }
      }
      // Replace each team-week wholesale: a player dropped from the chart must
      // disappear, which an upsert alone would never do.
      for (const tw of teams) {
        const [team, week] = tw.split(':');
        const d = await sb(`nfl_depth_weekly?season=eq.${season}&week=eq.${week}&team=eq.${team}`, { method: 'DELETE' });
        if (!d.ok) throw new Error(`depth delete ${d.status}`);
      }
      out.depth = await upsert('nfl_depth_weekly', 'season,week,team,player_name,slot', rows);
      out.depth_teams = teams.length;
      out.depth_snapshot = [...newest.values()].sort().pop() ?? null;
    }

    out.ok = true;
    out.duration_seconds = Math.round((Date.now() - started) / 1000);
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, ...out, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
