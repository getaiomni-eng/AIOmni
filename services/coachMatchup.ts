// Grounded context for the Home-screen AI Coach.
//
// The old modal sent the AI four fields: league name, platform, week, and the
// two scores. With nothing to reason about it produced generic "check your
// lineup" advice that would read identically for any team in any league --
// and charged a prompt for it.
//
// These builders assemble what an actual answer needs: both lineups with
// per-player projections, the bench, injury designations, and weather for
// every outdoor game the roster touches. Everything here is fetched from the
// platform adapters and the live-data feeds; nothing is invented, and any
// piece that fails to load is omitted rather than guessed at.

import { getPlatform } from './platform';
import type { Roster, RosterSlot } from './platform/types';
import { fetchGameWeather, type WeatherReport } from './liveData';
import { nflWeek } from './util/nflCalendar';
import { logCaught } from './util/logCaught';

export type CoachAction = 'matchup' | 'startsit';

function slotLine(r: RosterSlot): string {
  const p = r.player;
  const proj = r.projected != null ? ` proj ${r.projected.toFixed(1)}` : '';
  const pts  = r.points    != null ? ` now ${r.points.toFixed(1)}`     : '';
  const inj  = p.injuryStatus ? ` [${p.injuryStatus}]` : '';
  return `${r.slot}: ${p.name} (${p.position} ${p.team})${proj}${pts}${inj}`;
}

function teamsOf(rosters: (Roster | null)[]): string[] {
  const out = new Set<string>();
  for (const r of rosters) {
    for (const s of [...(r?.starters ?? []), ...(r?.bench ?? [])]) {
      if (s.player.team) out.add(s.player.team);
    }
  }
  return [...out];
}

function weatherBlock(reports: WeatherReport[]): string {
  // Domes are omitted deliberately: "72F indoors" is noise in every prompt,
  // and listing them invites the model to treat a dome as a talking point.
  const outdoor = reports.filter(w => !w.isDome);
  if (!outdoor.length) return '';
  return '\n\nWEATHER (outdoor games only):\n' + outdoor
    .map(w => `- ${w.team}: ${Math.round(w.tempF)}F, wind ${Math.round(w.windMph)}mph, ${w.condition}${w.fantasyImpact ? ` — ${w.fantasyImpact}` : ''}`)
    .join('\n');
}

/** Both lineups with projections, plus weather. Returns null if the roster won't load. */
export async function buildMatchupContext(
  leagueId: string, platformId: string, week = nflWeek(),
): Promise<string | null> {
  try {
    const plat = getPlatform(platformId as any);
    if (!plat) return null;

    const [mine, all, matchups] = await Promise.all([
      plat.getMyRoster(leagueId).catch(() => null),
      plat.getAllRosters?.(leagueId).catch(() => [] as Roster[]) ?? Promise.resolve([] as Roster[]),
      plat.getMatchups?.(leagueId, week).catch(() => []) ?? Promise.resolve([]),
    ]);
    if (!mine) return null;

    // Find the opponent through this week's matchup, then resolve their roster.
    let opp: Roster | null = null;
    const mm = (matchups ?? []).find(m => m.home.isMe || m.away.isMe);
    const oppSide = mm ? (mm.home.isMe ? mm.away : mm.home) : null;
    if (oppSide) opp = (all ?? []).find(r => r.rosterId === oppSide.rosterId) ?? null;

    const weather = await fetchGameWeather(teamsOf([mine, opp])).catch(() => [] as WeatherReport[]);

    const projTotal = (r: Roster | null) =>
      (r?.starters ?? []).reduce((sum, s) => sum + (s.projected ?? 0), 0);

    let out = `WEEK ${week} MATCHUP\n\nYOUR TEAM: ${mine.teamName} (${mine.record.wins}-${mine.record.losses}${mine.record.ties ? '-' + mine.record.ties : ''})\n`;
    out += `Projected total: ${projTotal(mine).toFixed(1)}\n`;
    out += mine.starters.map(slotLine).join('\n');

    if (opp) {
      out += `\n\nOPPONENT: ${opp.teamName} (${opp.record.wins}-${opp.record.losses}${opp.record.ties ? '-' + opp.record.ties : ''})\n`;
      out += `Projected total: ${projTotal(opp).toFixed(1)}\n`;
      out += opp.starters.map(slotLine).join('\n');
    } else {
      out += `\n\nOPPONENT: lineup not available this week — do NOT invent their players or their score.`;
    }
    return out + weatherBlock(weather);
  } catch (e) {
    logCaught('coachMatchup.buildMatchupContext', e);
    return null;
  }
}

/** Starters AND bench with projections, plus weather. Returns null if the roster won't load. */
export async function buildStartSitContext(
  leagueId: string, platformId: string, week = nflWeek(),
): Promise<string | null> {
  try {
    const plat = getPlatform(platformId as any);
    if (!plat) return null;
    const mine = await plat.getMyRoster(leagueId).catch(() => null);
    if (!mine) return null;

    const weather = await fetchGameWeather(teamsOf([mine])).catch(() => [] as WeatherReport[]);

    let out = `WEEK ${week} LINEUP DECISION\n\nTEAM: ${mine.teamName}\n\nCURRENT STARTERS:\n`;
    out += mine.starters.map(slotLine).join('\n');
    out += `\n\nBENCH:\n` + (mine.bench.length ? mine.bench.map(slotLine).join('\n') : '(empty)');
    if (mine.ir?.length) out += `\n\nIR:\n` + mine.ir.map(slotLine).join('\n');
    return out + weatherBlock(weather);
  } catch (e) {
    logCaught('coachMatchup.buildStartSitContext', e);
    return null;
  }
}

export const COACH_PROMPTS: Record<CoachAction, (ctx: string) => string> = {
  matchup: ctx => `You are AIOmni AI Coach. Call this week's matchup.

${ctx}

Answer in this shape, under 130 words total:
1. Who is favored and roughly by how much, based on the projections above.
2. The two or three players who actually decide it, and why.
3. One thing that would flip the result.

Rules: use only the numbers above. If the opponent's lineup was unavailable, say so plainly and call it from your side alone. Never invent a projection, a stat, or an injury. Weather only matters if it is genuinely severe (wind over 15mph, heavy precipitation, or extreme cold) — otherwise do not mention it.`,

  startsit: ctx => `You are AIOmni AI Coach. Give a full start/sit recommendation.

${ctx}

Answer in this shape, under 180 words total:
1. Any change you would make, written as "Start X over Y" with the projection gap and the reason. If the lineup is already optimal, say that first and plainly.
2. The closest call on the roster and why you landed where you did.
3. Anyone whose weather or injury designation is worth watching before kickoff.

Rules: use only the players and numbers above. Never invent a projection, a stat, or an injury, and never suggest a player who is not on this roster. A projection gap under 1.5 points is a coin flip — say so rather than manufacturing a reason. Weather only matters if it is genuinely severe (wind over 15mph, heavy precipitation, or extreme cold).`,
};
