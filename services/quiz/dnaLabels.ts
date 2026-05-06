// DNA labels for the 8 quiz dimensions × 3 tiers (low / mid / high).
// Tier breakpoints: low = score < 35; high = score > 65; mid = otherwise.

import type { Dimension } from './types';

type Tier = 'low' | 'mid' | 'high';

export const DNA_LABELS: Record<Dimension, Record<Tier, { label: string; desc: string }>> = {
  floor_ceiling: {
    low:  { label: 'Floor Hunter',     desc: "You'd rather lock in a 90% chance of a top-12 finish than swing for top-3 outcomes. Reliable production wins championships." },
    mid:  { label: 'Balanced Drafter', desc: 'You weigh upside and floor case-by-case. No ideological commitment to either.' },
    high: { label: 'Ceiling Chaser',   desc: 'You bet on top-3 outcomes even when the floor scares you. League winners come from the tail.' },
  },
  established_ascending: {
    low:  { label: 'Veteran Trust',    desc: 'You stick with proven names. Track records over breakout narratives.' },
    mid:  { label: 'Pragmatic Mix',    desc: "You blend established and ascending — whichever's correctly priced." },
    high: { label: 'Breakout Hunter',  desc: 'You target young, ascending players. Names everyone knows are usually overpriced.' },
  },
  volume_efficiency: {
    low:  { label: 'Volume Believer',   desc: 'Workload is destiny. 300 touches > 5.5 YPC every time.' },
    mid:  { label: 'Context Reader',    desc: 'You adjust by player and situation. Volume and efficiency both matter.' },
    high: { label: 'Efficiency Hunter', desc: 'You bet on YPC, target share, and offense quality. Workload follows the talent.' },
  },
  pass_catching_rb: {
    low:  { label: 'Pure Rusher',     desc: 'You want backs who carry the ball, not backs who fake routes. Three-down workhorses.' },
    mid:  { label: 'Format Aware',    desc: 'You weigh receiving usage by format and scoring.' },
    high: { label: 'PPR Maximalist',  desc: "You'll start a 12-touch back if 8 of those touches are receptions. PPR points are PPR points." },
  },
  te_premium: {
    low:  { label: 'Late TE Streamer',     desc: 'You let the position come to you. TE is replaceable; round-2 talent is not.' },
    mid:  { label: 'TE Pragmatist',        desc: "You'll take elite TE if priced right but won't reach for one." },
    high: { label: 'TE-Premium Believer',  desc: 'Elite TE is a positional advantage worth a high pick. The drop-off after the top tier is real.' },
  },
  qb_urgency: {
    low:  { label: 'QB Streamer',     desc: 'QB is an interchangeable commodity. Take the matchup, not the brand name.' },
    mid:  { label: 'QB Consensus',    desc: "You take QB when the value's right — usually Rounds 6-9." },
    high: { label: 'QB First-Mover',  desc: "Elite QBs win weeks. You'll spend a Round 2-3 pick to lock the position." },
  },
  injury_discount: {
    low:  { label: 'Risk-Off',     desc: 'Injury history is signal. You discount aggressively — durability is a skill.' },
    mid:  { label: 'Case-by-Case', desc: 'You weigh injury context: recurring vs flukey, position vs player.' },
    high: { label: 'Pure Talent',  desc: "If they're healthy on draft day, you'll take the upside. Injuries are noise." },
  },
  rookie_aggression: {
    low:  { label: 'Rookie Skeptic',   desc: 'You wait for rookies to fall. Year-2 breakouts are cheaper and more reliable.' },
    mid:  { label: 'Selective Rookie', desc: 'You target specific rookies in landing spots, not the rookie class wholesale.' },
    high: { label: 'Rookie Reacher',   desc: "You'll draft rookies above ADP. The upside on Year-1 alpha is league-winning." },
  },
  rb_vs_wr_priority: {
    low:  { label: 'Zero RB',                desc: 'You start WRs-heavy in Rounds 1-3 and let RB value come to you. WR scarcity is the tighter constraint.' },
    mid:  { label: 'Best Player Available',  desc: 'You let value dictate picks. Position is secondary to ranking.' },
    high: { label: 'Robust RB',              desc: 'You lock in workhorse touches early. RB scarcity is real; WR depth is exploitable later.' },
  },
};

export function getDNALabel(dim: Dimension, score: number): { label: string; desc: string } {
  const tier: Tier = score < 35 ? 'low' : score > 65 ? 'high' : 'mid';
  return DNA_LABELS[dim][tier];
}
