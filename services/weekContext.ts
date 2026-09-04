// Per-player weekly matchup context for the fast advice surfaces (2026-09-04).
//
// The start/sit and waiver prompts in league.tsx sent Haiku a name, a
// position, and an injury tag — no opponent, no matchup, nothing a person
// answering the same question would look at first. Everything needed was
// already fetchable; this pulls it into one line:
//   "Wk1 vs SEA (implied 21.5) · SEA 28th vs WR in 2025 · 91% snaps"
// Costs ~40 extra Haiku tokens per call. Every source degrades to '' —
// advice must never fail because context was unavailable.
import { fetchSnapCounts, fetchVegasLines } from './rankingsData';
import { getNFLWeek } from './season';
import { supabase } from './supabase';
import { normalizePlayerName } from './util/normalizeName';

// Platform team-code drift: ESPN/Yahoo/nflverse disagree on a handful.
const TEAM_ALIAS: Record<string, string> = {
  JAC: 'JAX', WSH: 'WAS', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR',
};
const norm = (t?: string | null) => TEAM_ALIAS[(t ?? '').toUpperCase()] ?? (t ?? '').toUpperCase();

type Caches = {
  at: number;
  week: number;
  opp: Map<string, string>;        // team -> opponent ("vs SEA" / "@ NE")
  vegas: Map<string, number>;      // team -> implied total
  dvp: Map<string, number>;        // `${team}|${pos}` -> rank allowed vs pos
  dvpSeason: number | null;
  snaps: Map<string, number>;      // normalized name -> snap %
};
let cache: Caches | null = null;
const TTL = 30 * 60 * 1000;

async function load(): Promise<Caches> {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const week = await getNFLWeek().catch(() => 1);
  const season = new Date().getFullYear();

  const [schedRes, dvpRes, vegas, snaps] = await Promise.all([
    supabase.from('nfl_schedule').select('home_team, away_team').eq('season', season).eq('week', week),
    supabase.from('nfl_dvp').select('team, position, rank_vs_pos, season').order('season', { ascending: false }).limit(200),
    fetchVegasLines().catch(() => new Map<string, number>()),
    fetchSnapCounts().catch(() => new Map<string, number>()),
  ]);

  const opp = new Map<string, string>();
  for (const g of schedRes.data ?? []) {
    const h = norm(g.home_team), a = norm(g.away_team);
    opp.set(h, `vs ${a}`);
    opp.set(a, `@ ${h}`);
  }
  const dvp = new Map<string, number>();
  let dvpSeason: number | null = null;
  for (const r of dvpRes.data ?? []) {
    dvpSeason = dvpSeason ?? r.season;
    if (r.season !== dvpSeason) continue;       // newest season only
    dvp.set(`${norm(r.team)}|${r.position}`, r.rank_vs_pos);
  }
  const snapByName = new Map<string, number>();
  for (const [name, pct] of snaps) snapByName.set(normalizePlayerName(name), pct);

  cache = { at: Date.now(), week, opp, vegas, dvp, dvpSeason, snaps: snapByName };
  return cache;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export async function getPlayerWeekContext(name: string, position?: string, team?: string): Promise<string> {
  try {
    const c = await load();
    const tm = norm(team);
    const bits: string[] = [];
    const oppStr = c.opp.get(tm);
    if (oppStr) {
      const oppTeam = norm(oppStr.replace(/^(vs |@ )/, ''));
      const implied = c.vegas.get(tm);
      bits.push(`Wk${c.week} ${oppStr}${implied ? ` (implied ${implied})` : ''}`);
      const rank = position ? c.dvp.get(`${oppTeam}|${position.toUpperCase()}`) : undefined;
      if (rank && c.dvpSeason) bits.push(`${oppTeam} ${ordinal(rank)} vs ${position!.toUpperCase()} in ${c.dvpSeason}`);
    }
    const snap = c.snaps.get(normalizePlayerName(name));
    if (snap) bits.push(`${Math.round(snap)}% snaps`);
    return bits.length ? `Matchup: ${bits.join(' · ')}` : '';
  } catch { return ''; }
}
