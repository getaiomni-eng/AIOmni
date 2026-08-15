// services/analystTakes.ts
// ───────────────────────────────────────────────────────────────────────
// Client read-side of the analyst-takes pipeline (v1.1 — see
// docs/analyst-takes-pipeline.md). The server crons keep `analyst_takes`
// fresh; this module pulls the recent window and shapes it into an
// "ANALYST BUZZ" map the Coach injects per-league for rostered players.
//
// Injection safety rule (mirrors the pipeline): only takes with a
// resolved sleeper_id are used — an ambiguous name match must never put
// another player's take under a rostered player's name.

import { supabase } from './supabase';
import { normalizePlayerName } from './util/normalizeName';

export type BuzzLine = { line: string; score: number };

const WINDOW_DAYS = 14;
const FETCH_CAP = 200;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Fetch recent resolved takes and return them keyed by normalized player
 * name. Values are pre-scored, formatted lines, best-first. One line per
 * (player, stance) — three articles saying "buy" collapse into the
 * strongest one with a "+N similar" suffix.
 */
export async function fetchAnalystBuzz(): Promise<Map<string, BuzzLine[]>> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('analyst_takes')
    .select('player_key, player_name, position, nfl_team, analyst, stance, claim, format_note, confidence, published_at, content_sources(name, weight)')
    .not('sleeper_id', 'is', null)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(FETCH_CAP);
  if (error || !data) return new Map();

  // Best take per (player, stance), counting the collapsed duplicates.
  const byPlayerStance = new Map<string, { row: any; score: number; extra: number }>();
  for (const row of data as any[]) {
    const ageDays = Math.max(0, (Date.now() - new Date(row.published_at).getTime()) / 86_400_000);
    const weight = Number(row.content_sources?.weight ?? 1);
    const score = (Number(row.confidence) || 0.5) * weight * Math.exp(-ageDays / 7);
    const key = `${row.player_key}|${row.stance}`;
    const cur = byPlayerStance.get(key);
    if (!cur) byPlayerStance.set(key, { row, score, extra: 0 });
    else if (score > cur.score) byPlayerStance.set(key, { row, score, extra: cur.extra + 1 });
    else cur.extra++;
  }

  const out = new Map<string, BuzzLine[]>();
  for (const { row, score, extra } of byPlayerStance.values()) {
    const d = new Date(row.published_at);
    const src = row.content_sources?.name ?? row.analyst ?? 'analyst';
    const when = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const fmt = row.format_note ? ` [${row.format_note}]` : '';
    const more = extra > 0 ? ` [+${extra} similar]` : '';
    const line = `${row.player_name}${row.position ? ` (${row.position}${row.nfl_team ? ` ${row.nfl_team}` : ''})` : ''}: ${String(row.stance).toUpperCase()} — "${row.claim}" (${src}, ${when})${fmt}${more}`;
    const key = normalizePlayerName(row.player_name);
    const arr = out.get(key) ?? [];
    arr.push({ line, score });
    out.set(key, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => b.score - a.score);
  return out;
}
