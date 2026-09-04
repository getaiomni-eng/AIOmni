import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchNewsFeed, FeedByTab, NewsTab, NewsItem as FeedNewsItem } from '../../services/newsFeed';
import { getNFLSeason, getAvailableSeasons } from '../../services/season';
import { logCaught, logEmpty } from '../../services/util/logCaught';
import { CoachMarks } from '../components/CoachMarks';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI, hasAISession } from "../../services/ai";
import { fetchAnalystBuzz, type BuzzLine } from '../../services/analystTakes';
import { normalizePlayerName } from '../../services/util/normalizeName';
import { ROOKIE_BOARD_2026_TEXT } from '../../services/seasonContext2026';
import { hasAIConsent } from "../../services/aiConsent";
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { getValidYahooToken } from '../../services/yahoo';
import { Icon } from '../components/AIOmniIcons';
import { AIOmniLogo, AIOmniWordmark } from '../components/AIOmniLogo';
import { readableText, useTheme, type ThemeTokens } from '../constants/theme';
import { dark, F, palette, SP, SZ } from '../constants/tokens';
import { consumePrompt } from '../../services/promptQuota';
import { Alert } from '../../services/util/crossAlert';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W    = SCREEN_W - SP[3] * 2;
const INSIGHT_W = CARD_W - 28;

type Platform = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker';
type League = {
  id: string; name: string; platform: Platform;
  format?: string; rec?: string; rank?: string;
  pts?: number; opp?: number; week?: number; avatar?: string;
};

type NewsItem = {
  source: string; headline: string; color: string; url?: string;
};

// Colors. Sleeper + ESPN + Yahoo + MFL mirror their settings.tsx swatches.
// Fleaflicker uses palette.flame (orange) instead of its settings cyan to
// stay distinguishable from Sleeper's aqua in the home pill row, since the
// two platforms otherwise read as the same hue at small pill sizes.
const PLAT_COLOR  = (p: Platform): string => {
  switch (p) {
    case 'sleeper':     return palette.aqua;
    case 'espn':        return '#e52534';
    case 'yahoo':       return '#7c3aed';
    case 'mfl':         return '#e4ff1a';
    case 'fleaflicker': return palette.flame;
    default:            return palette.aqua;
  }
};
// Map platform-abstraction's ScoringFormat / LeagueType to the home tab's
// short display string ("PPR", "0.5 PPR", "STD", "PPR · DYN", etc).
const formatLabel = (scoring: string | undefined, leagueType: string | undefined): string => {
  const base = scoring === 'ppr' ? 'PPR' : scoring === 'half' ? '0.5 PPR' : 'STD';
  return leagueType === 'dynasty' ? `${base} · DYN` : base;
};

const PLAT_LABEL  = (p: Platform): string => {
  switch (p) {
    case 'sleeper':     return 'SLEEPER';
    case 'espn':        return 'ESPN';
    case 'yahoo':       return 'YAHOO';
    case 'mfl':         return 'MFL';
    case 'fleaflicker': return 'FF';
    default:            return String(p).toUpperCase();
  }
};

const FALLBACK_NEWS: NewsItem[] = [
  { source: 'ROTOWIRE', headline: 'Jaxon Smith-Njigba: 5th-year option picked up by SEA', color: palette.green, url: 'https://www.rotowire.com/football/player/jaxon-smith-njigba-15164' },
  { source: 'PFR', headline: 'NFL Teams Higher On Their QBs Than Draft Pundits?', color: palette.amber, url: 'https://www.pro-football-reference.com' },
  { source: 'CBS SPORTS', headline: 'Fantasy waiver wire pickups to target this week', color: palette.aqua, url: 'https://www.cbssports.com/fantasy/football/news/fantasy-football-waiver-wire' },
  { source: 'SLEEPER', headline: 'Saquon Barkley approaches single-season rushing record', color: palette.chartreuse },
];

// Shown only until the model responds (or if it fails). Deliberately generic —
// never fabricated player calls, which read as real analysis and are stale the
// moment they're written.
const FALLBACK_INSIGHTS = [
  { icon: 'target',   title: 'Check your lineup', body: 'Confirm no starters are on bye or ruled out before kickoff.',        tag: 'LINEUP',  color: palette.aqua },
  { icon: 'alert',    title: 'Watch inactives',   body: 'Official actives post 90 minutes before each game starts.',          tag: 'MONITOR', color: palette.amber },
  { icon: 'trending', title: 'Scan the wire',     body: 'Snap-share risers usually hit waivers before the market reacts.',    tag: 'WAIVERS', color: palette.green },
];

// The model picks from these by name — never free-form. Colors get an alpha
// suffix appended at render time, so a raw value like "red" would produce the
// invalid "red25" and silently break the card.
const INSIGHT_ICONS = ['target', 'trending', 'fire', 'alert', 'lightning', 'star', 'crown', 'barchart'];
const INSIGHT_COLORS: Record<string, string> = {
  aqua:  palette.aqua,
  green: palette.green,
  amber: palette.amber,
  flame: palette.flame,
};

type Insight = { icon: string; title: string; body: string; tag: string; color: string };

// The model is not trusted to return well-formed rows: clamp every field and
// fall back per-field rather than dropping the whole payload.
// The insight cards get the same canonical rookie board + training-data ban
// the Coach uses, so they can't fall back on stale training-data players.
// Persona is trimmed — these are 120-character cards, not a chat.
const INSIGHTS_SYSTEM = `You are AIOmni's fantasy football analyst writing short insight cards.
Every claim must trace to the roster and analyst buzz provided in the user message. You have NO other
knowledge of the current season: no stats, no injuries, no depth charts, no transactions beyond what
is given. Never invent a number. If the data doesn't support a specific claim, write a general process
reminder instead.
${ROOKIE_BOARD_2026_TEXT}`;

// The user's rostered player names for the anchor league, via whichever
// platform owns it. Best-effort: an empty list makes the prompt say so
// rather than letting the model imagine a roster.
async function loadRosterNames(league: League): Promise<string[]> {
  try {
    const { getPlatform } = require('../../services/platform');
    const plat = getPlatform(league.platform);
    if (!plat?.getMyRoster) return [];
    const roster = await plat.getMyRoster(league.id);
    const slots = [...(roster?.starters ?? []), ...(roster?.bench ?? [])];
    return slots
      .map((s: any) => s?.player?.name)
      .filter((n: any): n is string => typeof n === 'string' && n.length > 0)
      .slice(0, 40);
  } catch {
    return [];
  }
}

const sanitizeInsights = (raw: any): Insight[] =>
  (Array.isArray(raw) ? raw : [])
    .filter(o => o && typeof o.title === 'string' && typeof o.body === 'string')
    .slice(0, 3)
    .map(o => ({
      icon:  INSIGHT_ICONS.includes(o.icon) ? o.icon : 'target',
      title: String(o.title).trim().slice(0, 40),
      body:  String(o.body).trim().slice(0, 120),
      tag:   String(o.tag ?? 'INSIGHT').toUpperCase().trim().slice(0, 10),
      color: INSIGHT_COLORS[String(o.color).toLowerCase()] ?? palette.aqua,
    }));

const FlatCard: React.FC<{ s: any; style?: any; children: React.ReactNode }> = ({ s, style, children }) => (
  <View style={[s.flatCard, style]}>{children}</View>
);

export default function HomeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { t }   = useTheme();
  const s       = useMemo(() => makeStyles(t), [t]);

  const [leagues,        setLeagues]        = useState<League[]>([]);
  const seasonFallbackRef = useRef(false);
  const [username,       setUsername]       = useState('');
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [insightIdx,     setInsightIdx]     = useState(0);
  const [aiInsights,     setAiInsights]     = useState<Insight[]>([]);
  const [insightLoading, setInsightLoading] = useState(false);
  const [scoreIdx,       setScoreIdx]       = useState(0);
  const [feed, setFeed] = useState<FeedByTab>({ SLEEPER: [], NEWS: [], INJURIES: [], TRADES: [], all: [] });
  const [newsTab, setNewsTab] = useState<NewsTab>('NEWS');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker']);
  const [selectedSeason,    setSelectedSeason]    = useState(String(new Date().getFullYear()));
  const [aiCoachActive,     setAiCoachActive]     = useState(false);
  const [selectedLeague,    setSelectedLeague]    = useState<League | null>(null);
  const [aiCoachLoading,    setAiCoachLoading]    = useState(false);
  const [aiCoachInsight,    setAiCoachInsight]    = useState('');

  const scoreAnims = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;

  useEffect(() => { loadLeagues(); loadNewsFeed(); }, [selectedSeason]);

  // ── All data loading functions identical to v6 ──
  // ─── MFL + Fleaflicker leagues ────────────────────────────────────
  // Wired through the FantasyPlatform abstraction in services/platform.
  // Fetches league info via getLeagues(year) and parallels into
  // getStandings + getMatchups to populate rec / rank / pts / opp at
  // parity with ESPN + Yahoo. The platform classes already mark the
  // user's rows via `isMe`, so no franchise/team lookup is needed here.

  const buildPlatformLeague = async (
    plat: any,
    l: any,
    platformId: 'mfl' | 'fleaflicker',
  ): Promise<League> => {
    const week = l.currentWeek ?? 1;
    let rec: string | undefined;
    let rankStr: string | undefined;
    let pts = 0;
    let opp = 0;
    try {
      const [standings, matchups] = await Promise.all([
        plat.getStandings(l.id).catch(() => [] as any[]),
        plat.getMatchups(l.id, week).catch(() => [] as any[]),
      ]);
      const me = (standings as any[]).find(s => s.isMe);
      if (me) {
        rec = `${me.record.wins}–${me.record.losses}`;
        if (me.rank > 0) rankStr = `${me.rank}${ordinal(me.rank)} of ${standings.length}`;
      }
      for (const m of (matchups as any[])) {
        if (m.home?.isMe) { pts = m.home.points ?? 0; opp = m.away?.points ?? 0; break; }
        if (m.away?.isMe) { pts = m.away.points ?? 0; opp = m.home?.points ?? 0; break; }
      }
    } catch (e) {
      console.log(`${platformId} standings/matchups error:`, e);
    }
    return {
      id: String(l.id),
      name: l.name,
      platform: platformId as any,
      format: formatLabel(l.scoringFormat, l.leagueType),
      rec: rec ?? '0-0',
      rank: rankStr,
      pts,
      opp,
      week,
    };
  };

  const loadMflLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const { getPlatform } = require('../../services/platform');
      const plat = getPlatform('mfl');
      const platLeagues = await plat.getLeagues(year);
      if (!platLeagues?.length) return [];
      return Promise.all(platLeagues.map((l: any) => buildPlatformLeague(plat, l, 'mfl')));
    } catch (e) {
      console.log('loadMflLeagues error:', e);
      return [];
    }
  };

  const loadFleaflickerLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const { getPlatform } = require('../../services/platform');
      const plat = getPlatform('fleaflicker');
      const platLeagues = await plat.getLeagues(year);
      if (!platLeagues?.length) return [];
      return Promise.all(platLeagues.map((l: any) => buildPlatformLeague(plat, l, 'fleaflicker')));
    } catch (e) {
      console.log('loadFleaflickerLeagues error:', e);
      return [];
    }
  };

  const loadSleeperLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const u = await AsyncStorage.getItem('sleeper_username');
      if (!u) return [];
      const user = await (await fetch(`https://api.sleeper.app/v1/user/${u}`)).json();
      if (!user?.user_id) return [];
      const leaguesList = await (await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${year}`)).json();
      if (!Array.isArray(leaguesList)) return [];
      const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
      const week  = state.leg || state.display_week || state.week || 17;
      return Promise.all(leaguesList.map(async (l: any): Promise<League> => {
        const isPPR = l.scoring_settings?.rec > 0;
        const isSF  = (l.roster_positions || []).includes('SUPER_FLEX');
        const fmt   = `${isPPR ? (l.scoring_settings.rec >= 1 ? 'PPR' : '0.5 PPR') : 'STD'}${isSF ? ' · SF' : ''}`;
        try {
          const [rosters, matchups] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${l.league_id}/rosters`).then(r => r.json()),
            fetch(`https://api.sleeper.app/v1/league/${l.league_id}/matchups/${week}`).then(r => r.json()),
          ]);
          const myRoster   = Array.isArray(rosters)  ? rosters.find((r: any)  => r.owner_id  === user.user_id) : null;
          const myMatchup  = Array.isArray(matchups) ? matchups.find((m: any) => m.roster_id === myRoster?.roster_id) : null;
          const oppMatchup = myMatchup ? matchups.find((m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster?.roster_id) : null;
          const wins   = myRoster?.settings?.wins   ?? 0;
          const losses = myRoster?.settings?.losses ?? 0;
          const sorted = Array.isArray(rosters) ? [...rosters].sort((a: any, b: any) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)) : [];
          const rank   = sorted.findIndex((r: any) => r.roster_id === myRoster?.roster_id) + 1;
          return {
            id: l.league_id, name: l.name, platform: 'sleeper', format: fmt, avatar: l.avatar,
            rec: `${wins}–${losses}`,
            rank: rank > 0 ? `${rank}${ordinal(rank)} of ${rosters.length}` : undefined,
            pts: parseFloat((myMatchup?.points ?? 0).toFixed(1)), opp: oppMatchup?.points ?? 0, week,
          };
        } catch {
          return { id: l.league_id, name: l.name, platform: 'sleeper', format: fmt, avatar: l.avatar };
        }
      }));
    } catch (e) { return []; }
  };

  // Build a home-screen League row from one ESPN league payload.
  const buildESPNLeague = (leagueId: number, leagueData: any, swid: string): League => {
    const myTeam  = findMyESPNTeam(leagueData, swid);
    // ESPN keys scoring by statId in scoringSettings.scoringItems[] — there
    // is no `.REC` field, so this read was always undefined and every ESPN
    // league rendered as 'STD'. statId 53 = receptions.
    const recPts  = Number(
      (leagueData.settings?.scoringSettings?.scoringItems ?? [])
        .find((i: any) => Number(i?.statId) === 53)?.points ?? 0
    );
    const fmt     = recPts >= 1 ? 'PPR' : recPts >= 0.5 ? '0.5 PPR' : 'STD';
    const wins    = myTeam?.record?.overall?.wins   ?? 0;
    const losses  = myTeam?.record?.overall?.losses ?? 0;
    const teams   = leagueData.teams ?? [];
    const sorted  = [...teams].sort((a: any, b: any) => (b.record?.overall?.wins ?? 0) - (a.record?.overall?.wins ?? 0));
    const rankIdx = sorted.findIndex((t: any) => t.id === myTeam?.id);
    const rankStr = rankIdx >= 0 ? `${rankIdx + 1}${ordinal(rankIdx + 1)} of ${teams.length}` : undefined;
    const week    = leagueData.scoringPeriodId ?? 17;
    const matchupData = leagueData.schedule?.find((m: any) => m.matchupPeriodId === week && (m.home?.teamId === myTeam?.id || m.away?.teamId === myTeam?.id));
    const myScore  = matchupData?.home?.teamId === myTeam?.id ? matchupData?.home?.totalPoints : matchupData?.away?.totalPoints;
    const oppScore = matchupData?.home?.teamId === myTeam?.id ? matchupData?.away?.totalPoints : matchupData?.home?.totalPoints;
    return { id: String(leagueId), name: leagueData.settings?.name ?? 'ESPN League', platform: 'espn', format: fmt, rec: `${wins}–${losses}`, rank: rankStr, pts: myScore ?? 0, opp: oppScore ?? 0, week };
  };

  const loadESPNLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadESPNCredentials();
      // Not an anomaly: every user who simply hasn't connected ESPN lands here
      // on every Home load. Reporting it to Sentry flooded the project within
      // a day of shipping (first live event was a fresh install, not a bug).
      if (!creds) return [];
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const { discoverESPNLeagues } = require('../../services/espn');
      const yr = parseInt(year, 10);

      // Prefer the rich stored summaries (id/name/season/drafted). Fall
      // back to (re)discovery if they're missing or none match the
      // selected season — this also self-heals installs that connected
      // before summaries were stored.
      let summaries: any[] = [];
      try {
        const stored = await AsyncStorage.getItem('espn_leagues_v2');
        if (stored) summaries = JSON.parse(stored);
      } catch (e) { logCaught('espn:stored-summaries-parse', e); }

      let forYear = summaries.filter((s: any) => Number(s.season) === yr);
      if (forYear.length === 0) {
        try {
          const discovered = await discoverESPNLeagues(creds);
          if (discovered && discovered.length > 0) {
            await AsyncStorage.setItem('espn_leagues_v2', JSON.stringify(discovered));
            await AsyncStorage.setItem('espn_league_ids', JSON.stringify(discovered.map((l: any) => l.id)));
            forYear = discovered.filter((s: any) => Number(s.season) === yr);
            // The season filter is the prime suspect for "connected but no
            // leagues": if discovery returns leagues whose season doesn't
            // parse to the selected year, every one is dropped silently.
            if (forYear.length === 0) {
              logEmpty('espn:season-filter-dropped-all', {
                wantYear: yr,
                discoveredCount: discovered.length,
                seasonsSeen: [...new Set(discovered.map((d: any) => String(d?.season)))],
              });
            }
          } else {
            logEmpty('espn:discovery-returned-none', { year: yr });
          }
        } catch (e) { logCaught('espn:discovery', e, { year: yr }); }
      }
      if (forYear.length === 0) {
        logEmpty('espn:no-leagues-for-year', { year: yr, storedCount: summaries.length });
        return [];
      }

      // forYear is already active-first; Promise.all preserves order.
      const built = await Promise.all(forYear.map(async (s: any): Promise<League | null> => {
        try {
          const data = await getESPNLeague(Number(s.id), creds, yr);
          if (!data) { logEmpty('espn:league-fetch-empty', { leagueId: s.id, year: yr }); return null; }
          return buildESPNLeague(Number(s.id), data, creds.swid);
        } catch (e) { logCaught('espn:build-league', e, { leagueId: s.id, year: yr }); return null; }
      }));
      const ok = built.filter((l): l is League => l !== null);
      if (ok.length < forYear.length) {
        logEmpty('espn:partial-load', { wanted: forYear.length, got: ok.length, year: yr });
      }
      return ok;
    } catch (e) { logCaught('espn:load', e, { year }); return []; }
  };

  const loadYahooLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const token = await getValidYahooToken();
      // getValidYahooToken() returns null both when no tokens are stored AND
      // when the refresh silently failed (yahoo.ts `catch { return null }`).
      // Those are very different problems for the user, so say which.
      if (!token) { logEmpty('yahoo:no-valid-token', { year }); return []; }
      const res = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl;seasons=${year}/leagues?format=json`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        // Status alone never explained this. Yahoo puts the actual reason in
        // the body ("Please provide valid credentials", "token does not have
        // permission", "invalid resource"), so capture it — truncated, and it
        // contains no credentials since the token travels in the header.
        let detail = '';
        try { detail = (await res.text()).slice(0, 400); } catch { detail = '(body unreadable)'; }
        logEmpty('yahoo:leagues-http-error', {
          year,
          status: res.status,
          body: detail,
          wwwAuthenticate: res.headers.get('www-authenticate') ?? '(none)',
        });
        return [];
      }
      const data = await res.json();
      const gamesData = data?.fantasy_content?.users?.[0]?.user?.[1]?.games;
      // A user with zero Yahoo leagues for the year is legitimate (nothing
      // drafted yet). Still tag it, so "no leagues" and "parse broke" are
      // distinguishable in Sentry rather than both being an empty screen.
      if (!gamesData) { logEmpty('yahoo:no-games-for-season', { year }); return []; }
      const leagues: League[] = [];
      const gameCount = gamesData?.count ?? 0;
      for (let g = 0; g < gameCount; g++) {
        const game        = gamesData[g]?.game;
        const leaguesData = game?.[1]?.leagues;
        if (!leaguesData) continue;
        const leagueCount = leaguesData.count ?? 0;
        for (let i = 0; i < leagueCount; i++) {
          try {
            const lg         = leaguesData[i]?.league?.[0];
            const leagueKey  = lg?.league_key;
            const leagueName = lg?.name ?? 'Yahoo League';
            if (!leagueKey) continue;
            const [standingsRes, matchupRes] = await Promise.allSettled([
              fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/standings?format=json`, { headers: { Authorization: `Bearer ${token}` } }),
              fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/scoreboard?format=json`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            let rec = '?'; let rank: string | undefined;
            let pts = 0;   let opp = 0;
            if (standingsRes.status === 'fulfilled' && standingsRes.value.ok) {
              const sd     = await standingsRes.value.json();
              const stData = sd?.fantasy_content?.league;
              const teams  = stData?.[1]?.standings?.[0]?.teams;
              if (teams) {
                const teamCount = teams.count ?? 0;
                for (let t = 0; t < teamCount; t++) {
                  const teamData  = teams[t]?.team;
                  const teamInfo  = teamData?.[0];
                  const teamStats = teamData?.[1]?.team_standings;
                  const managerArr = teamInfo?.find((x: any) => Array.isArray(x?.managers));
                  const isMe = managerArr?.managers?.[0]?.manager?.is_current_login === '1';
                  if (isMe) {
                    const w = teamStats?.outcome_totals?.wins   ?? 0;
                    const l = teamStats?.outcome_totals?.losses ?? 0;
                    rec = `${w}–${l}`;
                    break;
                  }
                }
              }
            }
            if (matchupRes.status === 'fulfilled' && matchupRes.value.ok) {
              const md     = await matchupRes.value.json();
              const mtData = md?.fantasy_content?.league;
              const matchups = mtData?.[1]?.scoreboard?.[0]?.matchups;
              if (matchups) {
                const matchupCount = matchups.count ?? 0;
                for (let m = 0; m < matchupCount; m++) {
                  const matchup = matchups[m]?.matchup;
                  const mTeams  = matchup?.[0]?.teams;
                  if (mTeams) {
                    const teamCount = mTeams.count ?? 0;
                    for (let t = 0; t < teamCount; t++) {
                      const teamData = mTeams[t]?.team;
                      const teamInfo = teamData?.[0];
                      const managerArr = teamInfo?.find((x: any) => Array.isArray(x?.managers));
                      const isMe = managerArr?.managers?.[0]?.manager?.is_current_login === '1';
                      if (isMe) {
                        pts = parseFloat(teamData?.[1]?.team_points?.total ?? '0');
                        const oppIdx = t === 0 ? 1 : 0;
                        opp = parseFloat(mTeams[oppIdx]?.team?.[1]?.team_points?.total ?? '0');
                        break;
                      }
                    }
                  }
                }
              }
            }
            leagues.push({ id: leagueKey, name: leagueName, platform: 'yahoo', rec, rank, pts, opp });
          } catch {}
        }
      }
      return leagues;
    } catch (e) { return []; }
  };

  const loadLeagues = useCallback(async () => {
    setLoading(true);
    try {
      const [sleeper, espn, yahoo, mfl, fleaflicker] = await Promise.allSettled([
        loadSleeperLeagues(selectedSeason),
        loadESPNLeagues(selectedSeason),
        loadYahooLeagues(selectedSeason),
        loadMflLeagues(selectedSeason),
        loadFleaflickerLeagues(selectedSeason),
      ]);
      const allLeagues: League[] = [];
      if (sleeper.status     === 'fulfilled') allLeagues.push(...sleeper.value);
      if (espn.status        === 'fulfilled') allLeagues.push(...espn.value);
      if (yahoo.status       === 'fulfilled') allLeagues.push(...yahoo.value);
      if (mfl.status         === 'fulfilled') allLeagues.push(...mfl.value);
      if (fleaflicker.status === 'fulfilled') allLeagues.push(...fleaflicker.value);
      setLeagues(allLeagues);
      // Per-platform counts for Settings' honest connection status
      // ("Connected · 3 leagues" vs a red "Reconnect"): a stored credential
      // with zero leagues loading is a broken link, and until now Settings
      // showed the same green "Connected" for both.
      try {
        const counts: Record<string, number> = {};
        for (const lg of allLeagues) counts[lg.platform] = (counts[lg.platform] ?? 0) + 1;
        await AsyncStorage.setItem('league_counts_by_platform', JSON.stringify({ at: Date.now(), season: selectedSeason, counts }));
      } catch { /* display-only */ }
      // Season-filter blank fix (Sentry: espn:season-filter-dropped-all).
      // If a non-current season is selected and NOTHING loaded, snap back to
      // the current year instead of rendering an unexplained empty Home.
      if (allLeagues.length === 0 && selectedSeason !== String(new Date().getFullYear()) && !seasonFallbackRef.current) {
        seasonFallbackRef.current = true;
        setSelectedSeason(String(new Date().getFullYear()));
      }
      const u = await AsyncStorage.getItem('sleeper_username');
      setUsername(u || '');
    } catch (e) { console.error('Load leagues error:', e); }
    setLoading(false);
  }, [selectedSeason]);

  // Cached per league per day. This fires on home-screen load rather than on a
  // user action, so it deliberately does NOT call incrementPrompt() — it isn't
  // a question the user asked. The daily cache is what bounds the cost.
  const fetchAIInsights = async (league: League) => {
    if (insightLoading) return;
    const day = new Date().toISOString().slice(0, 10);
    // Cards are grounded in the roster now, so the cache has to notice when
    // the roster changes — otherwise a waiver add wouldn't show up in the
    // insights until tomorrow. Cheap order-independent fingerprint.
    const roster = await loadRosterNames(league).catch(() => [] as string[]);
    const rosterKey = roster.length
      ? String(roster.map(n => normalizePlayerName(n)).sort().join('|')
          .split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0))
      : 'noroster';
    const cacheKey = `insights:${league.id}:${day}:${rosterKey}`;
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed = sanitizeInsights(JSON.parse(cached));
        if (parsed.length > 0) { setAiInsights(parsed); return; }
      }
    } catch { /* cache miss or corrupt entry — fall through to a live fetch */ }

    setInsightLoading(true);
    try {
      // v2026-08-30: this call used to send ONLY platform + format + week.
      // With nothing injected the model could only answer from training
      // data — generic advice, the exact thing the product exists to beat,
      // and the setup that once recommended a third-string QB. Ground it in
      // the user's actual roster and the analyst-takes pipeline instead.
      const buzz = await fetchAnalystBuzz().catch(() => new Map<string, BuzzLine[]>());

      // Podcast/article takes about THIS user's players, best-first.
      const rosterKeys = new Set(roster.map(n => normalizePlayerName(n)));
      const myBuzz: BuzzLine[] = [];
      for (const key of rosterKeys) {
        for (const b of buzz.get(key) ?? []) myBuzz.push(b);
      }
      myBuzz.sort((a, b) => b.score - a.score);

      // Roster coverage is thin some weeks (the pipeline can't have takes on
      // everyone). Rather than dropping to generic process reminders, fall
      // back to the pipeline's BEST takes league-wide — real analyst
      // opinions about players the user doesn't own are still useful as
      // waiver/trade context, and they're what the content pipeline exists
      // to surface. Kept clearly separated so the model never implies the
      // user rosters these players.
      const MY_TARGET = 6;
      const leagueWide: BuzzLine[] = [];
      if (myBuzz.length < MY_TARGET) {
        for (const [key, lines] of buzz) {
          if (rosterKeys.has(key)) continue;   // already covered above
          for (const b of lines) leagueWide.push(b);
        }
        leagueWide.sort((a, b) => b.score - a.score);
      }

      const rosterBlock = roster.length
        ? `\nYOUR ROSTER (${roster.length}): ${roster.join(', ')}`
        : `\nROSTER: not available — do NOT reference specific players on the user's team.`;

      const myBuzzBlock = myBuzz.length
        ? `\n\nANALYST BUZZ about the user's OWN players (podcasts + columns, last 14 days — opinions, not facts):\n${myBuzz.slice(0, 8).map(b => `- ${b.line}`).join('\n')}`
        : '';
      const wideBuzzBlock = leagueWide.length
        ? `\n\nANALYST BUZZ from around the league — the user does NOT roster these players. Use them only as waiver targets, trade targets, or market context, and say so:\n${leagueWide.slice(0, Math.max(3, 8 - myBuzz.length)).map(b => `- ${b.line}`).join('\n')}`
        : '';
      const buzzBlock = `${myBuzzBlock}${wideBuzzBlock}${myBuzz.length || leagueWide.length ? '\n\nThese analyst takes are the ONLY analyst opinions you may cite.' : ''}`;

      const prompt = `You are AIOmni, an elite fantasy football analyst. Write 3 insight cards for the user's ${league.platform.toUpperCase()} league (${league.format}), Week ${league.week}.${rosterBlock}${buzzBlock}

Rules:
- Ground every card in the roster and analyst buzz above. Do not invent stats, projections, injuries or transactions.
- When a card comes from an analyst take, name the analyst in the body.
- Prefer cards built on the analyst buzz above, the user's own players first. If their own players are thin, use the around-the-league takes as waiver/trade/market cards — clearly framed as players they don't roster.
- Only fall back to a general process reminder (lineup checks, inactive timing, waiver timing) when there is no usable buzz left. Never invent player specifics to fill a card.

Respond with ONLY a JSON array of 3 objects, no prose and no code fences. Each object must have exactly these keys:
  "icon"  — one of: ${INSIGHT_ICONS.join(', ')}
  "title" — under 40 characters
  "body"  — under 120 characters
  "tag"   — a single uppercase word, e.g. START, MONITOR, WAIVERS, BUZZ
  "color" — one of: ${Object.keys(INSIGHT_COLORS).join(', ')}`;
      // INSIGHTS_SYSTEM carries the canonical 2026 rookie board + the
      // training-data ban that every other AI surface gets and this one
      // was missing entirely.
      const response = await askAI(prompt, { tier: 'fast', maxTokens: 400, system: INSIGHTS_SYSTEM });
      const insights = sanitizeInsights(
        JSON.parse(response?.replace(/```json|```/g, '').trim() || '[]')
      );
      if (insights.length > 0) {
        setAiInsights(insights);
        AsyncStorage.setItem(cacheKey, JSON.stringify(insights)).catch(() => {});
      }
    } catch (e) { console.error('AI insights error:', e); }
    setInsightLoading(false);
  };

  const loadNewsFeed = async (forceRefresh = false) => {
    try {
      const feed = await fetchNewsFeed(forceRefresh);
      setFeed(feed);
    } catch (e) {
      console.log('feed load error', e);
    }
  };

  const ordinal = (n: number) => { const s = ['th','st','nd','rd']; return s[(n % 100 > 3 && n % 100 < 21) ? 0 : Math.min(n % 10, 4)] || 'th'; };

  const openAiCoachModal = async (league: League) => {
    setSelectedLeague(league);
    setAiCoachLoading(true);
    setAiCoachInsight('');
    // 5.1.1(i): never charge a prompt for a call the consent gate will refuse.
    if (!(await hasAIConsent())) {
      setAiCoachInsight('AI features are turned off. To get matchup insights, enable “Share data with AI service” in Settings.');
      setAiCoachLoading(false);
      return;
    }
    // Guests can't reach the AI proxy — don't burn a lifetime prompt trying.
    if (!(await hasAISession())) {
      setAiCoachInsight('Sign in to use AI features — create a free account from Settings.');
      setAiCoachLoading(false);
      return;
    }
    // Honor the quota result like every other charged surface — over-cap
    // users go to the paywall instead of a doomed proxy call.
    const ok = await consumePrompt();
    if (!ok) {
      setAiCoachLoading(false);
      setSelectedLeague(null);
      router.push('/paywall?context=weekly_prompts_exhausted' as any);
      return;
    }
    try {
      const prompt = `You are AIOmni AI Coach. Analyze this matchup and give 1 actionable insight in 2 sentences max:\n\nLeague: ${league.name} (${league.platform}, ${league.format})\nWeek: ${league.week}\nYour Score: ${league.pts}\nOpponent Score: ${league.opp}\n\nWhat should I focus on this week?`;
      const insight = await askAI(prompt, { tier: 'fast', maxTokens: 150 });
      setAiCoachInsight(insight);
    } catch (e: any) {
      setAiCoachInsight(
        e?.message?.includes('ai_consent_required')
          ? 'AI features are turned off. Enable “Share data with AI service” in Settings.'
          : e?.message?.includes('not_authenticated')
          ? 'Sign in to use AI features — create a free account from Settings.'
          : 'Could not generate insight at this time.',
      );
    }
    setAiCoachLoading(false);
  };

  // fetchAIInsights had no caller at all — aiInsights stayed [] forever and the
  // card list always fell through to FALLBACK_INSIGHTS. Anchor on the first
  // league so the insights match whatever the user sees at the top of the page.
  useEffect(() => {
    if (leagues.length > 0 && aiInsights.length === 0) fetchAIInsights(leagues[0]);
  }, [leagues]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    scoreAnims.forEach(a => a.setValue(0));
    await loadLeagues();
    setRefreshing(false);
  }, [loadLeagues]);

  const goToLeague = (l: League) =>
    router.push({ pathname: '/league', params: { leagueId: l.id, leagueName: l.name, platform: l.platform, avatar: l.avatar ?? '' } });

  const displayInsights = aiInsights.length > 0 ? aiInsights : FALLBACK_INSIGHTS;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <CoachMarks />
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accentText} />}
      >
        {/* ── Header ── */}
        <View style={s.headerBar}>
          <AIOmniWordmark fontSize={22} color={t.text} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {username ? (
              <View style={s.handlePill}>
                <Text style={s.handleTxt}>@{username}</Text>
              </View>
            ) : null}
            <TouchableOpacity onPress={() => router.push('/(tabs)/settings' as any)} style={s.gearBtn}>
              <Ionicons name="settings-sharp" size={20} color={t.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Platform pills + season ── */}
        <View style={s.platformRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1, marginRight: 8 }}
            contentContainerStyle={s.platformToggles}
            keyboardShouldPersistTaps="handled"
          >
            {(['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker'] as Platform[]).map(platform => {
              const isSelected = selectedPlatforms.includes(platform);
              const color = PLAT_COLOR(platform);
              return (
                <TouchableOpacity
                  key={platform}
                  onPress={() => setSelectedPlatforms(prev => isSelected ? prev.filter(p => p !== platform) : [...prev, platform])}
                  style={[s.platformToggle, isSelected && { backgroundColor: color, borderColor: color }]}
                >
                  <Text style={[s.platformToggleText, isSelected && { color: dark.bg }]}>
                    {PLAT_LABEL(platform)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            onPress={() => { const seasons = getAvailableSeasons(); Alert.alert('Select Season', '', seasons.map(y => ({ text: y, onPress: () => setSelectedSeason(y) })), { cancelable: true }); }}
            style={s.seasonPill}
          >
            <Text style={s.seasonPillText}>{selectedSeason} ▾</Text>
          </TouchableOpacity>
        </View>

        {/* ── Live Feed ── */}
        <View style={s.sectionRow}>
          <Text style={s.sectionLabel}>LIVE FEED</Text>
          <TouchableOpacity onPress={() => loadNewsFeed(true)}>
            <Text style={s.sectionHint}>↻ refresh</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
          {/* `tab` not `t` — the theme token object is `t` in this scope. */}
          {(['SLEEPER','NEWS','INJURIES','TRADES'] as NewsTab[]).map(tab => {
            const count = feed[tab].length;
            const isActive = newsTab === tab;
            const tabColor = tab === 'SLEEPER' ? '#52c0e0' : tab === 'INJURIES' ? '#ff4d6a' : tab === 'TRADES' ? '#ffb800' : '#6eeb83';
            // Fill + border keep the electric hue; the label has to be
            // readable on it, which on a light ground means darkening.
            const tabInk = readableText(t, tabColor);
            return (
              <TouchableOpacity key={tab} onPress={() => setNewsTab(tab)}
                style={[s.feedTab, isActive && { backgroundColor: tabColor + '22', borderColor: tabColor }]}>
                <Text style={[s.feedTabText, isActive && { color: tabInk }]}>{tab}</Text>
                {count > 0 && <Text style={[s.feedTabCount, isActive && { color: tabInk }]}>{count}</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {feed[newsTab].length === 0 ? (
            <View style={s.feedEmpty}>
              <Text style={s.feedEmptyText}>No {newsTab.toLowerCase()} to show.</Text>
            </View>
          ) : feed[newsTab].map((n: FeedNewsItem) => (
            <TouchableOpacity key={n.id} activeOpacity={0.7} onPress={() => n.url ? Linking.openURL(n.url) : undefined}
              style={[s.newsChip, { borderColor: n.color + '35' }]}>
              <View style={[s.newsDot, { backgroundColor: n.color }]} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                  <Text style={[s.newsSource, { color: readableText(t, n.color) }]}>{n.sourceTag}</Text>
                  <Text style={s.newsAge}>{n.age}</Text>
                </View>
                <Text style={s.newsText} numberOfLines={3}>{n.headline}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Score cards ── */}
        {loading ? (
          <FlatCard s={s} style={s.loadingCard}>
            <ActivityIndicator color={t.accentText} size="large" />
            <Text style={s.loadingTxt}>Loading your leagues...</Text>
          </FlatCard>
        ) : leagues.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scoreScroll} style={{ marginBottom: 16 }}>
            {(() => {
              const filtered = leagues.filter(lg => selectedPlatforms.includes(lg.platform));
              const pairs: any[][] = [];
              for (let i = 0; i < filtered.length; i += 2) {
                pairs.push(filtered.slice(i, i + 2));
              }
              return pairs.map((pair, pi) => (
                <View key={pi} style={{ gap: 8 }}>
                  {pair.map((lg) => {
              const ptsVal = parseFloat((lg.pts ?? 0).toFixed(1));
              const oppVal = parseFloat((lg.opp ?? 0).toFixed(1));
              const winning = ptsVal > oppVal;
              return (
                <TouchableOpacity
                  key={lg.id}
                  onPress={() => aiCoachActive ? openAiCoachModal(lg) : goToLeague(lg)}
                  activeOpacity={0.8}
                  style={s.scoreCardGrid}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={s.leagueNameGrid} numberOfLines={1}>{lg.name}</Text>
                    <View style={[s.badge, { backgroundColor: PLAT_COLOR(lg.platform) + '18' }]}>
                      <Text style={[s.badgeText, { color: PLAT_COLOR(lg.platform) }]}>{PLAT_LABEL(lg.platform)}</Text>
                    </View>
                  </View>
                  <Text style={s.leagueMetaGrid}>{lg.format} · Wk {lg.week}</Text>
                  {/* Always render the rank line so every card is the same
                      height — pre-draft leagues (no standings yet) show a
                      placeholder instead of collapsing the row. */}
                  <Text style={s.leagueRankGrid}>{lg.rank ?? '—'}</Text>
                  <View style={s.scoreRowGrid}>
                    <View style={s.scoreBoxGrid}>
                      <Text style={s.scoreLabelGrid}>YOU</Text>
                      <Text style={[s.scoreNumGrid, { color: winning ? t.successText : t.text }]}>{ptsVal}</Text>
                    </View>
                    <Text style={s.scoreVsGrid}>vs</Text>
                    <View style={s.scoreBoxGrid}>
                      <Text style={s.scoreLabelGrid}>OPP</Text>
                      <Text style={[s.scoreNumGrid, { color: !winning ? t.dangerText : t.text }]}>{oppVal}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
                </View>
              ));
            })()}
          </ScrollView>
        ) : (
          <FlatCard s={s} style={s.emptyCard}>
            <Text style={s.emptyTitle}>No leagues found</Text>
            <Text style={s.emptyTxt}>Connect Sleeper, ESPN, Yahoo, MFL, or Fleaflicker in Settings.</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/settings' as any)} style={s.emptyBtn}>
              <Text style={s.emptyBtnTxt}>GO TO SETTINGS</Text>
            </TouchableOpacity>
          </FlatCard>
        )}

        {/* ── AI Coach Bar ── */}
        <TouchableOpacity
          style={[s.aiCoachBar, aiCoachActive && s.aiCoachBarActive]}
          onPress={() => setAiCoachActive(!aiCoachActive)}
          activeOpacity={0.8}
        >
          <AIOmniLogo size={28} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.aiCoachLabel}>AI COACH</Text>
            <Text style={s.aiCoachHint}>{aiCoachActive ? 'Active — tap any score card' : 'Tap to activate'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
        </TouchableOpacity>


        {/* ── AI Insights ── */}
        <View style={s.sectionRow}>
          <Text style={s.sectionLabel}>AI INSIGHTS</Text>
          <Text style={s.sectionHint}>swipe</Text>
        </View>
        <ScrollView
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          snapToInterval={INSIGHT_W + 10} decelerationRate="fast"
          contentContainerStyle={{ gap: 10 }}
          style={{ marginBottom: 4 }}
          onMomentumScrollEnd={e => setInsightIdx(Math.round(e.nativeEvent.contentOffset.x / (INSIGHT_W + 10)))}
        >
          {displayInsights.map((insight, i) => {
            // The card's accent is data-driven (the model picks it), so the
            // tint/border keep the electric hue while the icon and tag text
            // darken on a light ground — at 9px on a 15%-alpha tint of its
            // own color, the electric version measured 1:1.
            const accent = insight.color || palette.aqua;
            // 4.5 not 3: this ink lands on a 15%-alpha tint of the same
            // hue, not on the card ground.
            const accentInk = readableText(t, accent, 4.5) ?? accent;
            return (
            <View key={i} style={[s.insightCard, { width: INSIGHT_W, borderColor: accent + '25' }]}>
              <View style={s.insightTop}>
                <View style={[s.insightIconWrap, { backgroundColor: accent + '15' }]}>
                  <Icon name={insight.icon as any} size={18} color={accentInk} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.insightTitle}>{insight.title}</Text>
                  <Text style={s.insightBody}>{insight.body}</Text>
                </View>
              </View>
              <View style={[s.insightTag, { backgroundColor: accent + '15' }]}>
                <Text style={[s.insightTagTxt, { color: accentInk }]}>{insight.tag}</Text>
              </View>
            </View>
            );
          })}
        </ScrollView>
        <View style={s.insightDots}>
          {displayInsights.map((_, i) => (
            <View key={i} style={[s.insightDot, i === insightIdx && s.insightDotOn]} />
          ))}
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* ── AI Coach Modal ── */}
      <Modal visible={!!selectedLeague && aiCoachActive} transparent animationType="slide" onRequestClose={() => setSelectedLeague(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(10,18,20,0.7)', justifyContent: 'flex-end' }}>
          <View style={s.modalSheet}>
            <TouchableOpacity onPress={() => setSelectedLeague(null)} style={{ alignSelf: 'flex-end' }} hitSlop={12}>
              <Ionicons name="close" size={22} color={t.textMuted} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>{selectedLeague?.name}</Text>
            <View style={s.modalScores}>
              <View><Text style={s.modalLabel}>YOU</Text><Text style={s.modalScore}>{(selectedLeague?.pts ?? 0).toFixed(1)}</Text></View>
              <Text style={s.modalVs}>vs</Text>
              <View style={{ alignItems: 'flex-end' }}><Text style={s.modalLabel}>OPP</Text><Text style={s.modalScore}>{(selectedLeague?.opp ?? 0).toFixed(1)}</Text></View>
            </View>
            {aiCoachLoading ? (
              <ActivityIndicator color={t.accentText} size="large" style={{ paddingVertical: 24 }} />
            ) : (
              <Text style={s.modalInsight}>{aiCoachInsight}</Text>
            )}
            <TouchableOpacity style={s.modalBtn} onPress={() => setSelectedLeague(null)}>
              <Text style={s.modalBtnTxt}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  scroll: { paddingHorizontal: SP[3] },

  // Header
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  handlePill: { backgroundColor: t.surface, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: t.border },
  handleTxt: { fontSize: SZ.xs, fontFamily: F.mono, color: t.textSub },
  gearBtn: { padding: 6 },

  // Platform pills
  platformRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  platformToggles: { flexDirection: 'row', gap: 4 },
  platformToggle: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: t.border, backgroundColor: t.card },
  platformToggleText: { fontSize: 9, fontFamily: F.bold, color: t.textSub, letterSpacing: 0.2 },
  seasonPill: { backgroundColor: t.card, borderRadius: 8, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 6 },
  seasonPillText: { fontSize: 10, fontFamily: F.mono, color: t.textSub },

  // Section headers
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionLabel: { fontSize: 10, fontFamily: F.bold, color: t.accentText, letterSpacing: 1.5 },
  sectionHint: { fontSize: 9, fontFamily: F.mono, color: t.textMuted },

  // News feed
  newsChip: { backgroundColor: t.card, borderRadius: 12, padding: 12, borderWidth: 1, minWidth: 240, flexDirection: 'row', alignItems: 'flex-start' },
  newsDot: { width: 6, height: 6, borderRadius: 3, marginRight: 8, marginTop: 4 },
  newsSource: { fontSize: 9, fontFamily: F.monoBold, letterSpacing: 1, marginBottom: 2 },
  newsText: { fontSize: 12, color: t.textSub, lineHeight: 17, fontFamily: F.body },

  // Flat card base
  flatCard: { backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 16 },

  // Loading
  loadingCard: { alignItems: 'center', padding: 40 },
  loadingTxt: { fontSize: SZ.sm, color: t.textMuted, marginTop: 12, fontFamily: F.body },

  // Score grid
  scoreScroll: { gap: 10, paddingHorizontal: 2 },
  scoreCardGrid: {
    backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border,
    padding: 14, width: SCREEN_W * 0.65, flexShrink: 0,
  },
  leagueNameGrid: { fontSize: 11, color: t.text, fontFamily: F.bodyBold, flex: 1, marginRight: 6 },
  leagueMetaGrid: { fontSize: 9, color: t.textMuted, fontFamily: F.body, marginBottom: 4 },
  leagueRankGrid: { fontSize: 10, color: t.accentText, fontFamily: F.body, marginBottom: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 7, fontFamily: F.monoBold, letterSpacing: 1 },
  scoreRowGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  scoreBoxGrid: { alignItems: 'center', flex: 1 },
  scoreLabelGrid: { fontSize: 8, color: t.textMuted, fontFamily: F.mono, letterSpacing: 1, marginBottom: 2 },
  scoreNumGrid: { fontSize: 22, fontFamily: F.bold, color: t.text },
  scoreVsGrid: { fontSize: 11, color: t.textMuted, fontFamily: F.body, marginHorizontal: 6 },

  // Empty state
  emptyCard: { alignItems: 'center', padding: 28, marginBottom: 16 },
  emptyTitle: { fontSize: SZ.base, fontFamily: F.bold, color: t.text, marginBottom: 6 },
  emptyTxt: { fontSize: SZ.sm, color: t.textSub, textAlign: 'center', marginBottom: 16, fontFamily: F.body },
  emptyBtn: { backgroundColor: palette.aqua, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  emptyBtnTxt: { fontFamily: F.bold, color: dark.bg, fontSize: SZ.sm, letterSpacing: 1 },

  // AI Coach bar
  aiCoachBar: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 16, backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border },
  aiCoachBarActive: { borderColor: palette.aqua + '40', backgroundColor: palette.aqua + '08' },
  aiCoachLabel: { fontSize: 11, fontFamily: F.bold, color: t.text, letterSpacing: 1 },
  aiCoachHint: { fontSize: 9, fontFamily: F.body, color: t.textMuted, marginTop: 1 },

  // Insights
  insightCard: { backgroundColor: t.card, borderRadius: 14, borderWidth: 1, padding: 16 },
  insightTop: { flexDirection: 'row', marginBottom: 10, alignItems: 'center' },
  insightIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  insightTitle: { fontSize: SZ.base, color: t.text, fontFamily: F.bodyBold, marginBottom: 3 },
  insightBody: { fontSize: SZ.sm, color: t.textSub, lineHeight: 18, fontFamily: F.body },
  insightTag: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  insightTagTxt: { fontSize: 9, fontFamily: F.monoBold, letterSpacing: 1 },
  insightDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 20 },
  insightDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: t.textMuted },
  insightDotOn: { backgroundColor: palette.aqua },

  // Modal
  modalSheet: { backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, minHeight: 300, borderTopWidth: 1, borderColor: t.border },
  modalTitle: { fontSize: SZ.xl, fontFamily: F.bold, color: t.text, marginBottom: 16 },
  modalScores: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalLabel: { fontSize: 9, fontFamily: F.mono, color: t.textMuted, letterSpacing: 1 },
  modalScore: { fontSize: SZ['2xl'], fontFamily: F.bold, color: t.accentText, marginTop: 4 },
  modalVs: { fontSize: SZ.lg, fontFamily: F.body, color: t.textMuted },
  modalInsight: { fontSize: SZ.sm, fontFamily: F.body, color: t.textSub, lineHeight: 20, marginBottom: 20 },
  modalBtn: { backgroundColor: palette.aqua, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalBtnTxt: { fontFamily: F.bold, color: dark.bg, fontSize: SZ.base, letterSpacing: 1 },

  feedTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1, borderColor: t.border, backgroundColor: t.surface,
  },
  feedTabText: {
    fontFamily: F.mono, fontSize: 9, letterSpacing: 1.2, color: t.textSub, fontWeight: '700',
  },
  feedTabCount: {
    fontFamily: F.mono, fontSize: 9, color: t.textSub, opacity: 0.7,
  },
  feedEmpty: {
    width: 220, padding: 16, backgroundColor: t.surface, borderRadius: 10,
    borderWidth: 1, borderColor: t.border, alignItems: 'center',
  },
  feedEmptyText: {
    fontFamily: F.body, fontSize: 12, color: t.textSub,
  },
  newsAge: {
    fontFamily: F.mono, fontSize: 9, color: t.textSub,
  },
});