// services/newsFeed.ts
// ─────────────────────────────────────────────────────────
// Consolidated NFL news aggregator.
// Pulls 6 RSS sources + Sleeper league transactions,
// classifies each item into a tab (INJURIES / TRADES / NEWS / SLEEPER),
// dedupes by similar headlines, returns tagged items.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { textMentionsPlayer } from './util/playerNewsMatch';

export type NewsTab = 'SLEEPER' | 'NEWS' | 'INJURIES' | 'TRADES';

export interface NewsItem {
  id:        string;          // stable — hash of source+headline
  source:    string;
  sourceTag: string;          // short code for badge (PFR, RW, ESPN, etc.)
  color:     string;
  headline:  string;
  body?:     string;
  url?:      string;
  timestamp: number;          // unix ms, for sort
  age:       string;          // "2h ago"
  tab:       NewsTab;
  playerNames?: string[];     // extracted when possible
  teams?:      string[];
}

// ─── THEME COLORS ────────────────────────────────────────
const COLORS = {
  aqua:      '#1be7ff',
  green:     '#6eeb83',
  amber:     '#ffb800',
  flame:     '#ff5714',
  chartreuse:'#e4ff1a',
  sleeperBlue: '#52c0e0',
};

// ─── RSS SOURCES ─────────────────────────────────────────
// 2026-06-02: PFT moved off the old NBCSports subdomain — the old
// `profootballtalk.nbcsports.com/feed/` 301-redirects to an empty body, so
// it's pointed at the live `.rss` endpoint. FantasyPros' news RSS
// (`/nfl/rss/news.xml`) now 404s and the `.php` variant returns 0 items —
// the public feed appears discontinued, so it's dropped until a working
// replacement is verified.
const RSS_SOURCES = [
  { url: 'https://www.rotowire.com/rss/news.php?sport=NFL',       tag: 'ROTOWIRE',  color: COLORS.green,  label: 'Rotowire' },
  { url: 'https://www.profootballrumors.com/feed',                 tag: 'PFR',       color: COLORS.amber,  label: 'Pro Football Rumors' },
  { url: 'https://www.nbcsports.com/profootballtalk.rss',          tag: 'PFT',       color: COLORS.flame,  label: 'Pro Football Talk' },
  { url: 'https://www.espn.com/espn/rss/nfl/news',                 tag: 'ESPN',      color: '#d20a11',     label: 'ESPN' },
  { url: 'https://www.cbssports.com/rss/headlines/nfl/',           tag: 'CBS',       color: COLORS.aqua,   label: 'CBS Sports' },
];

// ─── CLASSIFICATION KEYWORDS ─────────────────────────────
// Priority: INJURIES > TRADES > NEWS (first match wins)
const INJURY_RX = /(injur|out|ruled out|questionable|doubtful|inactive|IR\b|PUP\b|reserve|concussion|MRI|surgery|ACL|MCL|hamstring|ankle|knee|shoulder|sprain|strain|fracture|broken|torn|hurt|carted|limping|sidelined|miss(ed|es) practice|did not practice|DNP|day-to-day|illness)/i;
const TRADE_RX  = /(traded|trade|acquired|dealt|sent to|shipped to|deal with|released|waived|claimed|cut by|signed|re-sign|extension|option (picked up|declined)|front-loaded|franchise tag|tender|brings back|agree(s|d) to terms)/i;

function classify(headline: string, body: string): NewsTab {
  const text = `${headline} ${body}`;
  if (INJURY_RX.test(text)) return 'INJURIES';
  if (TRADE_RX.test(text))  return 'TRADES';
  return 'NEWS';
}

// ─── RSS PARSING ─────────────────────────────────────────
function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function formatAge(ts: number): string {
  const ms = Date.now() - ts;
  const m  = Math.floor(ms / 60000);
  const h  = Math.floor(ms / 3600000);
  const d  = Math.floor(ms / 86400000);
  if (m < 60)  return `${Math.max(1, m)}m ago`;
  if (h < 24)  return `${h}h ago`;
  return `${d}d ago`;
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `${h}`;
}

function extractRotoPlayer(headline: string): { players: string[]; teams: string[] } {
  // Rotowire format: "Player Name (TEAM - POS): headline"
  const m = headline.match(/^(.+?)\s*\(([A-Z]+)\s*-\s*[A-Z]+\):\s*/);
  if (m) return { players: [m[1].trim()], teams: [m[2]] };
  return { players: [], teams: [] };
}

function parseRSS(xml: string, source: typeof RSS_SOURCES[0]): NewsItem[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  const out: NewsItem[] = [];
  for (const raw of items.slice(0, 20)) {
    const titleMatch = raw.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch  = raw.match(/<link>([\s\S]*?)<\/link>/)
                    ?? raw.match(/<guid[^>]*>(http[\s\S]*?)<\/guid>/);
    const descMatch  = raw.match(/<description>([\s\S]*?)<\/description>/);
    const dateMatch  = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

    if (!titleMatch) continue;
    const headline = decode(titleMatch[1]);
    const body     = descMatch ? decode(descMatch[1]).slice(0, 240) : '';
    const url      = linkMatch ? decode(linkMatch[1]) : undefined;
    const ts       = dateMatch ? new Date(decode(dateMatch[1])).getTime() : Date.now();
    if (!headline || isNaN(ts)) continue;

    const tab = classify(headline, body);
    const meta = source.tag === 'ROTOWIRE' ? extractRotoPlayer(headline) : { players: [], teams: [] };

    out.push({
      id:        hashId(`${source.tag}${headline}`),
      source:    source.label,
      sourceTag: source.tag,
      color:     source.color,
      headline,
      body,
      url,
      timestamp: ts,
      age:       formatAge(ts),
      tab,
      playerNames: meta.players,
      teams:       meta.teams,
    });
  }
  return out;
}

// ─── SLEEPER TRANSACTIONS ────────────────────────────────
interface SleeperTxn {
  type:        'trade' | 'waiver' | 'free_agent';
  adds:        Record<string, number> | null;
  drops:       Record<string, number> | null;
  creator:     string;
  status:      string;
  status_updated: number;
  transaction_id: string;
  roster_ids:  number[];
  leg:         number;
}

let sleeperPlayersCache: Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }> | null = null;
async function getSleeperPlayers() {
  if (sleeperPlayersCache) return sleeperPlayersCache;
  try {
    const cached = await AsyncStorage.getItem('sleeper_players_cache');
    if (cached) {
      sleeperPlayersCache = JSON.parse(cached);
      return sleeperPlayersCache!;
    }
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    const data = await res.json();
    sleeperPlayersCache = data;
    // Best-effort: setItem throws on web's ~5MB quota; the map stays usable.
    try { await AsyncStorage.setItem('sleeper_players_cache', JSON.stringify(data)); } catch { /* web quota */ }
    return data;
  } catch {
    return {};
  }
}

export async function fetchSleeperTransactions(limit: number = 15): Promise<NewsItem[]> {
  try {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return [];
    const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    if (!user?.user_id) return [];

    const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
    const currentSeason = state.season ?? new Date().getFullYear().toString();
    const currentWeek   = state.leg || state.week || 17;

    const leagues = await (await fetch(
      `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${currentSeason}`
    )).json();
    if (!Array.isArray(leagues)) return [];

    const players = await getSleeperPlayers();

    // Pull transactions from each league, recent weeks (5-17 covers most of season + offseason)
    const weeks = Array.from({ length: 5 }, (_, i) => Math.max(1, currentWeek - i));
    const allTxns: (SleeperTxn & { leagueName: string })[] = [];

    for (const league of leagues.slice(0, 6)) {
      for (const wk of weeks) {
        try {
          const txns = await (await fetch(
            `https://api.sleeper.app/v1/league/${league.league_id}/transactions/${wk}`
          )).json();
          if (Array.isArray(txns)) {
            for (const t of txns) {
              allTxns.push({ ...t, leagueName: league.name });
            }
          }
        } catch {}
      }
    }

    // Sort by status_updated desc
    allTxns.sort((a, b) => (b.status_updated ?? 0) - (a.status_updated ?? 0));

    // Format as NewsItems
    const out: NewsItem[] = [];
    for (const txn of allTxns.slice(0, limit)) {
      const addNames = Object.keys(txn.adds  ?? {}).map(id => {
        const p = players[id];
        return p ? `${p.first_name} ${p.last_name} (${p.position})` : id;
      });
      const dropNames = Object.keys(txn.drops ?? {}).map(id => {
        const p = players[id];
        return p ? `${p.first_name} ${p.last_name}` : id;
      });

      let headline = '';
      let tab: NewsTab = 'SLEEPER';
      if (txn.type === 'trade') {
        headline = `Trade in ${txn.leagueName}`;
      } else if (txn.type === 'waiver') {
        headline = addNames.length > 0
          ? `Waiver claim: ${addNames[0]}${dropNames.length > 0 ? ` (dropped ${dropNames[0]})` : ''}`
          : `Waiver claim in ${txn.leagueName}`;
      } else {
        headline = addNames.length > 0
          ? `Added ${addNames.join(', ')}${dropNames.length > 0 ? ` · dropped ${dropNames.join(', ')}` : ''}`
          : `Transaction in ${txn.leagueName}`;
      }

      out.push({
        id:        hashId(`sleeper-${txn.transaction_id}`),
        source:    txn.leagueName,
        sourceTag: 'SLEEPER',
        color:     COLORS.sleeperBlue,
        headline,
        body:      addNames.length > 0 || dropNames.length > 0
          ? [addNames.length > 0 ? `+ ${addNames.join(', ')}` : '',
             dropNames.length > 0 ? `− ${dropNames.join(', ')}` : ''].filter(Boolean).join(' · ')
          : '',
        timestamp: txn.status_updated ?? Date.now(),
        age:       formatAge(txn.status_updated ?? Date.now()),
        tab,
      });
    }
    return out;
  } catch (e) {
    console.log('fetchSleeperTransactions error:', e);
    return [];
  }
}

// ─── DEDUPLICATION ───────────────────────────────────────
function dedupeByHeadline(items: NewsItem[]): NewsItem[] {
  const seen: { head: string; item: NewsItem }[] = [];
  const out: NewsItem[] = [];
  for (const item of items) {
    const normalized = item.headline.toLowerCase().slice(0, 60);
    const dupe = seen.find(s =>
      s.head.startsWith(normalized.slice(0, 35)) ||
      normalized.startsWith(s.head.slice(0, 35))
    );
    if (!dupe) {
      seen.push({ head: normalized, item });
      out.push(item);
    }
    // If duped, keep the first one we saw (higher-priority source if we sorted)
  }
  return out;
}

// ─── MAIN FETCH ──────────────────────────────────────────
export interface FeedByTab {
  SLEEPER:  NewsItem[];
  NEWS:     NewsItem[];
  INJURIES: NewsItem[];
  TRADES:   NewsItem[];
  all:      NewsItem[];
}

let feedCache: { data: FeedByTab; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchNewsFeed(forceRefresh: boolean = false): Promise<FeedByTab> {
  const now = Date.now();
  if (!forceRefresh && feedCache && (now - feedCache.at) < CACHE_TTL_MS) {
    return feedCache.data;
  }

  // Pull everything in parallel
  const rssPromises = RSS_SOURCES.map(src =>
    fetch(src.url).then(r => r.text()).then(xml => parseRSS(xml, src)).catch(() => [] as NewsItem[])
  );
  const [sleeperItems, ...rssItems] = await Promise.all([
    fetchSleeperTransactions(15),
    ...rssPromises,
  ]);

  let all: NewsItem[] = rssItems.flat();

  // Sort by timestamp desc, then dedupe
  all.sort((a, b) => b.timestamp - a.timestamp);
  all = dedupeByHeadline(all);

  // Split by tab
  const result: FeedByTab = {
    SLEEPER:  sleeperItems,
    NEWS:     all.filter(i => i.tab === 'NEWS').slice(0, 15),
    INJURIES: all.filter(i => i.tab === 'INJURIES').slice(0, 15),
    TRADES:   all.filter(i => i.tab === 'TRADES').slice(0, 15),
    all:      [...sleeperItems, ...all],
  };

  feedCache = { data: result, at: now };
  return result;
}

/**
 * Find news items mentioning a given player.
 * Used by PlayerCardModal to populate the PLAYER NEWS section.
 */
export async function findNewsForPlayer(playerName: string, limit: number = 3, team?: string | null): Promise<NewsItem[]> {
  const feed = await fetchNewsFeed();
  const lower = playerName.toLowerCase();
  const matches: NewsItem[] = [];

  for (const item of feed.all) {
    if (matches.length >= limit) break;
    // Audit 2026-09-05: the old substring matcher put Cleveland BROWNS news
    // on Amon-Ra St. BROWN's card and a Quinnen Williams article on Caleb's.
    // textMentionsPlayer requires the full name, a distinctive multi-token
    // surname, or a whole-word surname corroborated by first name or team.
    const hay = item.headline + ' ' + (item.body ?? '');
    if (item.playerNames?.some(n => n.toLowerCase() === lower)) {
      matches.push(item);
    } else if (textMentionsPlayer(hay, playerName, team)) {
      matches.push(item);
    }
  }
  return matches;
}

export function invalidateNewsCache() { feedCache = null; }
