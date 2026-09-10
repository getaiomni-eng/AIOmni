// The weekly board — "who should I start", read from public_weekly_board.
//
// Distinct from the Pulse/Formula boards, which answer "who should I own".
// The season board deliberately averages schedule away; this one puts it
// back, adjusting each player's rest-of-season rank by the defence he faces
// and his team's Vegas implied total.
//
// The UI contract matters here as much as the data. A player who drops is
// NOT a bench recommendation: Bijan Robinson moving from RB1 to RB4 on a
// tough matchup is still a top-four running back and anyone reading that as
// "sit" has been misled. Callers must lead with the positional rank and
// treat the shift as context, never as a verdict.

import { supabase } from './supabase';
import { logCaught } from './util/logCaught';

export interface WeeklyPlayer {
  gsis_id: string;
  /** Sleeper id, for the headshot. Null for players not yet cross-mapped. */
  sleeperId?: string;
  name: string;
  position: string;
  team: string | null;
  opponent: string | null;
  rank: number;
  posRank: number;
  /** The market's point projection (Sleeper). Null when unavailable. */
  projPts?: number | null;
  /** Where the market ranks him within his position. */
  marketPosRank?: number | null;
}

export interface WeeklyBoard {
  season: number;
  week: number;
  players: WeeklyPlayer[];
}

export async function fetchWeeklyBoard(format = 'ppr'): Promise<WeeklyBoard | null> {
  try {
    // Newest week present, so the tab works before a fresh capture lands and
    // never shows an empty screen just because it is Wednesday.
    const { data: latest, error: e1 } = await supabase
      .from('public_weekly_board')
      .select('season, week')
      .eq('format', format)
      .order('season', { ascending: false })
      .order('week', { ascending: false })
      .limit(1);
    if (e1 || !latest?.length) return null;

    const { season, week } = latest[0] as any;
    const { data, error } = await supabase
      .from('public_weekly_board')
      .select('gsis_id, sleeper_id, player_name, position, team, opponent, rank, pos_rank, injury_status, weather_note, startable, proj_pts, market_pos_rank')
      .eq('format', format).eq('season', season).eq('week', week)
      .order('rank', { ascending: true })
      .limit(300);
    if (error || !data?.length) return null;

    return {
      season, week,
      players: data.map((r: any) => ({
        gsis_id: r.gsis_id, sleeperId: r.sleeper_id ?? undefined,
        name: r.player_name, position: r.position,
        team: r.team, opponent: r.opponent, rank: r.rank, posRank: r.pos_rank,
        projPts: r.proj_pts ?? null, marketPosRank: r.market_pos_rank ?? null,
      })),
    };
  } catch (e) {
    logCaught('weeklyBoard.fetch', e);
    return null;
  }
}
