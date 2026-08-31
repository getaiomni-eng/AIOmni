// services/leagueActivity.ts
//
// Recent roster movement across EVERY connected platform, formatted for
// the Coach prompt.
//
// v2026-08-30: the Coach only ever saw SLEEPER transactions
// (fetchSleeperTransactions in newsFeed.ts), even though all five
// adapters implement getTransactions and none of them are stubs. An MFL
// or ESPN user got a Coach with no idea who'd been added, dropped or
// traded in their league — which is most of what "know my league" means
// during the season. This routes every platform through the shared
// FantasyPlatform interface instead.

import { getPlatform } from './platform';
import type { Transaction } from './platform/types';

export type ActivityLine = { line: string; ts: number };

type PlatformId = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker';

const LABEL: Record<PlatformId, string> = {
  sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MFL', fleaflicker: 'Fleaflicker',
};

function ageLabel(ts: number): string {
  if (!ts) return 'recent';
  const ms = Date.now() - (ts < 1e12 ? ts * 1000 : ts);   // sec vs ms epochs
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function describe(t: Transaction, leagueName: string, platform: string): ActivityLine | null {
  const adds = t.adds?.map(a => a.player?.name).filter(Boolean) ?? [];
  const drops = t.drops?.map(d => d.player?.name).filter(Boolean) ?? [];
  if (!adds.length && !drops.length) return null;

  const ts = t.timestamp < 1e12 ? t.timestamp * 1000 : t.timestamp;
  let body: string;
  if (t.type === 'trade') {
    body = `TRADE — ${[...adds, ...drops].join(', ')}`;
  } else if (adds.length && drops.length) {
    body = `added ${adds.join(', ')}, dropped ${drops.join(', ')}`;
  } else if (adds.length) {
    body = `added ${adds.join(', ')}`;
  } else {
    body = `dropped ${drops.join(', ')}`;
  }
  const faab = t.faabBid ? ` ($${t.faabBid} FAAB)` : '';
  return { line: `[${ageLabel(t.timestamp)}] ${leagueName} (${platform}): ${body}${faab}`, ts };
}

/**
 * Pull recent transactions from every connected platform, newest first.
 * Entirely best-effort: a platform that isn't connected, errors, or has
 * no activity simply contributes nothing.
 */
export async function fetchAllLeagueActivity(limit = 18): Promise<ActivityLine[]> {
  const platforms: PlatformId[] = ['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker'];

  const perPlatform = await Promise.all(platforms.map(async (id) => {
    try {
      const plat = getPlatform(id);
      if (!plat?.getTransactions || !(await plat.isAuthenticated().catch(() => false))) return [];
      const leagues = await plat.getLeagues().catch(() => []);
      if (!leagues?.length) return [];

      // Cap leagues per platform — a user with 6 leagues on 5 platforms
      // would otherwise fire 30 transaction calls on every Coach load.
      const picked = leagues.slice(0, 3);
      const nested = await Promise.all(picked.map(async (l: any) => {
        try {
          const txns = await plat.getTransactions(l.id, 12);
          return (txns ?? [])
            .map(t => describe(t, l.name ?? 'League', LABEL[id]))
            .filter((x): x is ActivityLine => x !== null);
        } catch { return []; }
      }));
      return nested.flat();
    } catch { return []; }
  }));

  return perPlatform.flat().sort((a, b) => b.ts - a.ts).slice(0, limit);
}
