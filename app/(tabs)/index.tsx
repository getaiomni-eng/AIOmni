import { askAI } from "../../services/ai";
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated, Dimensions,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
Linking, } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { getValidYahooToken } from '../../services/yahoo';
import { Badge, SectionHeader } from '../components/Atoms';
import { GlassCard } from '../components/GlassCard';
import { OrbAvatar } from '../components/OrbAvatar';
import { C, F, R, SP, SZ, textShadow } from '../constants/tokens';

const LOGO = require('../../assets/images/logo.png');
const { width: SCREEN_W } = Dimensions.get('window');

const CARD_W    = SCREEN_W - SP[3] * 2;
const INSIGHT_W = CARD_W - 28;

const ESPN_RED            = '#d00';
const ESPN_RED_BORDER     = 'rgba(221,0,0,0.35)';
const YAHOO_PURPLE        = '#6001D2';
const YAHOO_PURPLE_BORDER = 'rgba(96,1,210,0.35)';

type Platform = 'sleeper' | 'espn' | 'yahoo';

type League = {
  id: string; name: string; platform: Platform;
  format?: string; rec?: string; rank?: string;
  pts?: number; opp?: number; week?: number; avatar?: string;
};

const PLAT_COLOR  = (p: Platform) => p === 'espn' ? ESPN_RED : p === 'yahoo' ? YAHOO_PURPLE : C.gold;
const PLAT_BORDER = (p: Platform) => p === 'espn' ? ESPN_RED_BORDER : p === 'yahoo' ? YAHOO_PURPLE_BORDER : 'transparent';
const PLAT_LABEL  = (p: Platform) => p === 'espn' ? 'ESPN' : p === 'yahoo' ? 'YAHOO' : 'SLEEPER';

const SLEEPER_LOGO = 'https://play-lh.googleusercontent.com/V_P59T3JQ9qEBSBSrABCqCz0lBBz2FRcJFBHbyrJqoIr_TKQAlT0A6ixJVEXPEpNLg';

function PlatformLogo({ platform, size = 64 }: { platform: Platform; avatar?: string; size?: number }) {
  const radius = size * 0.18;
  const LOGOS: Record<string, any> = {
    sleeper: require('../../assets/images/platforms/sleeper.png'),
    espn:    require('../../assets/images/platforms/espn.png'),
    yahoo:   require('../../assets/images/platforms/yahoo.png'),
  };
  return (
    <Image
      source={LOGOS[platform] ?? LOGOS.sleeper}
      style={{ width: size, height: size, borderRadius: radius, borderWidth: 1.5, borderColor: 'rgba(254,226,41,0.3)' }}
    />
  );
}
const FALLBACK_NEWS = [
  { source: 'ROTOWIRE',   headline: 'Jaxon Smith-Njigba: 5th-year option picked up by SEA', color: '#4ab8a0' },
  { source: 'PFR',        headline: 'NFL Teams Higher On Their QBs Than Draft Pundits?',    color: '#e8a84b' },
  { source: 'CBS SPORTS', headline: 'Fantasy waiver wire pickups to target this week',       color: '#0055a5' },
  { source: 'SLEEPER',    headline: 'Saquon Barkley approaches single-season rushing record', color: C.gold  },
];

const FALLBACK_INSIGHTS = [
  { emoji: '🎯', title: 'Start Barkley',  body: 'Dream matchup vs NYG — 32nd ranked run D. Ceiling 35+.',  tag: 'START',   color: C.sage },
  { emoji: '⚠️', title: 'Watch Achane',   body: 'Listed Q — check 11:30am reports. Pollard on standby.',  tag: 'MONITOR', color: '#e8a84b' },
  { emoji: '🔥', title: 'Add Shaheed',    body: '3 TDs in last 4 games. 78% target share with Drake.',    tag: 'HOT',     color: C.gold },
];

export default function HomeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const [leagues,        setLeagues]        = useState<League[]>([]);
  const [username,       setUsername]       = useState('');
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [insightIdx,     setInsightIdx]     = useState(0);
  const [aiInsights,     setAiInsights]     = useState<{title:string;body:string;tag:string;color:string;emoji:string}[]>([]);
  const [insightLoading, setInsightLoading] = useState(false);
  const [scoreIdx,       setScoreIdx]       = useState(0);
  const [news,           setNews]           = useState(FALLBACK_NEWS);

  const scoreAnims = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;

  useEffect(() => { loadLeagues(); fetchNews(); }, []);

  const loadSleeperLeagues = async (): Promise<League[]> => {
    try {
      const u = await AsyncStorage.getItem('sleeper_username');
      if (!u) return [];
      const user = await (await fetch(`https://api.sleeper.app/v1/user/${u}`)).json();
      if (!user?.user_id) return [];
      const leaguesList = await (await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2025`)).json();
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
    } catch (e) { console.log('loadSleeperLeagues:', e); return []; }
  };

  const loadESPNLeagues = async (): Promise<League[]> => {
    try {
      const creds = await loadESPNCredentials();
      if (!creds?.leagueId) return [];
      const leagueData = await getESPNLeague(creds.leagueId, creds);
      if (!leagueData) return [];
      const myTeam  = findMyESPNTeam(leagueData, creds.teamName || '');
      const recPts  = leagueData.settings?.scoringSettings?.REC ?? 0;
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
      return [{ id: String(creds.leagueId), name: leagueData.settings?.name ?? 'ESPN League', platform: 'espn', format: fmt, rec: `${wins}–${losses}`, rank: rankStr, pts: myScore ?? 0, opp: oppScore ?? 0, week }];
    } catch (e) { console.log('loadESPNLeagues:', e); return []; }
  };

  const loadYahooLeagues = async (): Promise<League[]> => {
    try {
      const token = await getValidYahooToken();
      if (!token) return [];

      const res = await fetch(
        'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl/leagues?format=json',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return [];
      const data = await res.json();

      const gamesData = data?.fantasy_content?.users?.[0]?.user?.[1]?.games;
      if (!gamesData) return [];

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
            let pts = 0;   let opp = 0; let fmt = 'PPR';

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
                    rec  = `${w}–${l}`;
                    rank = `${teamStats?.rank ?? '?'} of ${teamCount}`;
                    break;
                  }
                }
              }
            }

            if (matchupRes.status === 'fulfilled' && matchupRes.value.ok) {
              const md     = await matchupRes.value.json();
              const sbData = md?.fantasy_content?.league?.[1]?.scoreboard?.[0]?.matchups;
              if (sbData) {
                const mCount = sbData.count ?? 0;
                for (let m = 0; m < mCount; m++) {
                  const matchup = sbData[m]?.matchup;
                  const teams   = matchup?.[0]?.teams;
                  if (!teams) continue;
                  const t0     = teams[0]?.team;
                  const t1     = teams[1]?.team;
                  const t0IsMe = t0?.[0]?.find?.((x: any) => Array.isArray(x?.managers))?.managers?.[0]?.manager?.is_current_login === '1';
                  const t1IsMe = t1?.[0]?.find?.((x: any) => Array.isArray(x?.managers))?.managers?.[0]?.manager?.is_current_login === '1';
                  if (t0IsMe) { pts = parseFloat(t0?.[1]?.team_points?.total ?? 0); opp = parseFloat(t1?.[1]?.team_points?.total ?? 0); break; }
                  if (t1IsMe) { pts = parseFloat(t1?.[1]?.team_points?.total ?? 0); opp = parseFloat(t0?.[1]?.team_points?.total ?? 0); break; }
                }
              }
            }

            leagues.push({ id: leagueKey, name: leagueName, platform: 'yahoo', format: fmt, rec, rank, pts, opp });
          } catch (e) { console.log('Yahoo league parse error:', e); }
        }
      }
      return leagues;
    } catch (e) { console.log('loadYahooLeagues:', e); return []; }
  };

  const loadLeagues = async () => {
    setLoading(true);
    const u = await AsyncStorage.getItem('sleeper_username');
    if (u) setUsername(u);
    const [sleeperLeagues, espnLeagues, yahooLeagues] = await Promise.all([
      loadSleeperLeagues(), loadESPNLeagues(), loadYahooLeagues(),
    ]);
    const all = [...sleeperLeagues, ...espnLeagues, ...yahooLeagues];
    setLeagues(all);
    setLoading(false);
    if (all.length > 0) fetchAIInsights(all);
    all.forEach((lg, i) => {
      if (i < scoreAnims.length && lg.pts) {
        Animated.timing(scoreAnims[i], { toValue: lg.pts, duration: 1400 + i * 120, useNativeDriver: false }).start();
      }
    });
  };

  const fetchAIInsights = async (leagueList: League[]) => {
    setInsightLoading(true);
    try {
      const results: {title:string;body:string;tag:string;color:string;emoji:string}[] = [];
      const colorMap: Record<string, string> = { sage: C.sage, gold: C.gold, red: '#c87878' };
      const leagueContext = leagueList.map(l => `${l.name} (${l.platform.toUpperCase()} · ${l.format}): Record ${l.rec ?? '?'}, Rank ${l.rank ?? '?'}, Score ${l.pts?.toFixed(1) ?? '?'} vs ${l.opp?.toFixed(1) ?? '?'} (${(l.pts ?? 0) > (l.opp ?? 0) ? 'WINNING' : 'LOSING'})`).join('\n');

      const safeParseInsight = (text: string) => {
        try {
          const cleaned = text.replace(/```json|```/g, '').trim();
          // Find JSON object even if surrounded by extra text
          const match = cleaned.match(/\{[\s\S]*\}/);
          return match ? JSON.parse(match[0]) : {};
        } catch { return {}; }
      };

      const crossRes    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'MOVED_TO_SERVICES', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: `You are AIOmni. Fantasy manager has ${leagueList.length} leagues:\n${leagueContext}\n\nRespond with ONLY valid JSON, no other text:\n{"emoji":"🎯","title":"Short title under 5 words","body":"One specific actionable insight under 20 words referencing a real player or matchup","tag":"RISK","color":"sage"}` }] }) });
      const crossText   = (await crossRes.json()).content?.[0]?.text ?? '';
      const crossParsed = safeParseInsight(crossText);
      const crossBody   = crossParsed.body && crossParsed.body.length > 5 ? crossParsed.body : `${leagueList[0]?.name ?? 'Your league'} — check the waiver wire before Wednesday.`;
      results.push({ emoji: crossParsed.emoji ?? '🎯', title: crossParsed.title ?? 'Cross-League Insight', body: crossBody, tag: crossParsed.tag ?? 'INSIGHT', color: colorMap[crossParsed.color] ?? C.sage });

      await Promise.allSettled(leagueList.map(async (lg) => {
        const res    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'MOVED_TO_SERVICES', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: `You are AIOmni. Fantasy league: ${lg.name} (${lg.format}, ${lg.platform.toUpperCase()}). Record: ${lg.rec}, Rank: ${lg.rank}, Score: ${lg.pts?.toFixed(1)} vs ${lg.opp?.toFixed(1)} (${(lg.pts ?? 0) > (lg.opp ?? 0) ? 'WINNING' : 'LOSING'}).\n\nRespond with ONLY valid JSON, no other text:\n{"emoji":"🏈","title":"Short title under 5 words","body":"One specific actionable insight under 20 words with player or matchup name","tag":"START","color":"gold"}` }] }) });
        const parsed  = safeParseInsight((await res.json()).content?.[0]?.text ?? '');
        const body    = parsed.body && parsed.body.length > 5 ? parsed.body : `Check your waiver wire — ${(lg.pts ?? 0) > (lg.opp ?? 0) ? 'protect the lead' : 'need an upside play'}.`;
        results.push({ emoji: parsed.emoji ?? '🏈', title: `${lg.name}: ${parsed.title ?? 'Insight'}`, body, tag: parsed.tag ?? 'INSIGHT', color: colorMap[parsed.color] ?? C.gold });
      }));

      setAiInsights(results);
    } catch (e) { console.log('AI insight error:', e); setAiInsights(FALLBACK_INSIGHTS); }
    setInsightLoading(false);
  };

  const fetchNews = async () => {
    const parseRSS = (xml: string, source: string, color: string) => {
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
      return items.slice(0, 6).flatMap(item => {
        const m   = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ?? item.match(/<title>(.*?)<\/title>/);
        const raw = (m?.[1] ?? '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code))).replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/<[^>]+>/g,'').trim();
        const lnk = item.match(/<link>(.*?)<\/link>/);
        const url = (lnk?.[1] ?? '').trim();
        return raw ? [{ source, headline: raw, color, url }] : [];
      });
    };
    try {
      const [rotoRes, pfrRes, cbsRes] = await Promise.allSettled([
        fetch('https://www.rotowire.com/rss/news.php?sport=NFL').then(r => r.text()),
        fetch('https://www.profootballrumors.com/feed').then(r => r.text()),
        fetch('https://www.cbssports.com/rss/headlines/nfl/').then(r => r.text()),
      ]);
      const results: { source: string; headline: string; color: string }[] = [];
      if (rotoRes.status === 'fulfilled') results.push(...parseRSS(rotoRes.value, 'ROTOWIRE',   '#4ab8a0'));
      if (pfrRes.status  === 'fulfilled') results.push(...parseRSS(pfrRes.value,  'PFR',        '#e8a84b'));
      if (cbsRes.status  === 'fulfilled') results.push(...parseRSS(cbsRes.value,  'CBS SPORTS', '#0055a5'));
      const roto = results.filter(n => n.source === 'ROTOWIRE');
      const pfr  = results.filter(n => n.source === 'PFR');
      const cbs  = results.filter(n => n.source === 'CBS SPORTS');
      const interleaved: typeof results = [];
      for (let i = 0; i < Math.max(roto.length, pfr.length, cbs.length); i++) {
        if (roto[i]) interleaved.push(roto[i]);
        if (pfr[i])  interleaved.push(pfr[i]);
        if (cbs[i])  interleaved.push(cbs[i]);
      }
      if (interleaved.length > 0) setNews(interleaved);
    } catch {}
  };

  const ordinal = (n: number) => { const s = ['th','st','nd','rd']; return s[(n % 100 > 3 && n % 100 < 21) ? 0 : Math.min(n % 10, 4)] || 'th'; };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    scoreAnims.forEach(a => a.setValue(0));
    await loadLeagues();
    setRefreshing(false);
  }, []);

  const goToLeague = (l: League) =>
    router.push({ pathname: '/league', params: { leagueId: l.id, leagueName: l.name, platform: l.platform, avatar: l.avatar ?? '' } });

  const displayInsights = aiInsights.length > 0 ? aiInsights : FALLBACK_INSIGHTS;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.gold} />}
      >
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />

        <View style={styles.headerBar}>
          <View style={{ flex: 1 }} />
          {username ? <View style={styles.handlePill}><Text style={styles.handleTxt}>@{username}</Text></View> : null}
          <TouchableOpacity onPress={() => router.push('/settings')} style={styles.gearBtn}>
            <Ionicons name="settings-sharp" size={22} color={C.dim2} />
          </TouchableOpacity>
        </View>

        <View style={styles.newsHeaderRow}>
          <Text style={styles.newsEye}>📡  LIVE FEED</Text>
          <Text style={styles.newsHint}>← swipe →</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {news.map((n, i) => (
            <TouchableOpacity key={i} onPress={() => n.url ? Linking.openURL(n.url) : null} activeOpacity={0.7} style={[styles.newsChip, { borderColor: n.color + '40' }]}>
              <View style={[styles.newsDot, { backgroundColor: n.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.newsSource, { color: n.color }]}>{n.source}</Text>
                <Text style={styles.newsText} numberOfLines={2}>{n.headline}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingCard}><ActivityIndicator color={C.gold} size="large" /><Text style={styles.loadingTxt}>Loading your leagues...</Text></View>
        ) : leagues.length > 0 ? (
          <>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} snapToInterval={CARD_W + 10} decelerationRate="fast" contentContainerStyle={{ gap: 10 }} style={{ marginBottom: 4 }} onMomentumScrollEnd={e => setScoreIdx(Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 10)))}>
              {leagues.map((lg, i) => {
                const winning       = (lg.pts ?? 0) > (lg.opp ?? 0);
                const platColor     = PLAT_COLOR(lg.platform);
                const isNonSleeper  = lg.platform !== 'sleeper';
                const ptsVal        = parseFloat((lg.pts ?? 0).toFixed(1));
                return (
                  <GlassCard key={lg.id} style={[styles.scoreCard, { width: CARD_W }, isNonSleeper && { borderColor: PLAT_BORDER(lg.platform) }]}>
                    <Text style={styles.scoreEye}>{'⚡  LIVE · WK '}{lg.week}{'  '}<Text style={{ color: platColor }}>{PLAT_LABEL(lg.platform)}</Text>{'  ·  '}{lg.format}</Text>
                    <View style={styles.matchRow}>
                      <View>
                        <Text style={styles.teamLbl} numberOfLines={1}>{lg.name.toUpperCase()}</Text>
                        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.scoreNum, { color: winning ? "#82c494" : C.ink }]}>{ptsVal.toFixed(1)}</Text>
                      </View>
                      <View style={[styles.winPill, !winning && styles.losePill]}>
                        <Text style={[styles.winTxt, !winning && styles.loseTxt]}>{winning ? '↑ WINNING' : '↓ LOSING'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.teamLbl}>OPPONENT</Text>
                        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.scoreNum, { color: '#e05555' }]}>{(lg.opp ?? 0).toFixed(1)}</Text>
                      </View>
                    </View>
                    <View style={styles.progBg}>
                      <View style={[styles.progFill, { width: `${((lg.pts ?? 0) / Math.max((lg.pts ?? 0) + (lg.opp ?? 0), 1) * 100).toFixed(0)}%` as any, backgroundColor: winning ? '#82c494' : '#e05555' }]} />
                    </View>
                    {isNonSleeper && (
                      <View style={[styles.platBadge, { backgroundColor: platColor }]}>
                        <Text style={styles.platBadgeTxt}>{PLAT_LABEL(lg.platform)}</Text>
                      </View>
                    )}
                  </GlassCard>
                );
              })}
            </ScrollView>
            <View style={styles.dotsRow}>{leagues.map((_, i) => <View key={i} style={[styles.dot, i === scoreIdx && styles.dotActive]} />)}</View>
          </>
        ) : null}

        <GlassCard style={{ marginBottom: 10 }}>
          <View style={styles.insightHdr}>
            <OrbAvatar size={9} />
            <Text style={styles.insightEye}>AI INSIGHT · {leagues.length > 0 ? `${leagues.length} LEAGUES` : 'LIVE'}</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {displayInsights.map((_, i) => <View key={i} style={[styles.dotInsight, i === insightIdx && styles.dotInsightActive]} />)}
            </View>
          </View>
          {insightLoading ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 4 }}>
              <ActivityIndicator size="small" color={C.gold} /><Text style={styles.loadingTxt}>Scanning {leagues.length} leagues...</Text>
            </View>
          ) : (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} snapToInterval={INSIGHT_W} decelerationRate="fast" onMomentumScrollEnd={e => { if (INSIGHT_W > 0) setInsightIdx(Math.round(e.nativeEvent.contentOffset.x / INSIGHT_W)); }}>
              {displayInsights.map((item, i) => (
                <View key={i} style={{ width: INSIGHT_W, flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
                  <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4, flexWrap: 'wrap' }}>
                      <Text style={styles.insightTitle}>{item.title}</Text>
                      <Badge label={item.tag} color={item.color} />
                    </View>
                    <Text style={styles.insightText}>{item.body}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </GlassCard>

        <SectionHeader label="MY LEAGUES" barColor={C.gold} />
        {!loading && leagues.map(lg => {
          const [w, l]   = (lg.rec ?? '0–0').split('–').map(Number);
          const platColor = PLAT_COLOR(lg.platform);
          const isYahoo  = lg.platform === 'yahoo';
          const isESPN   = lg.platform === 'espn';
          return (
            <TouchableOpacity key={lg.id} onPress={() => goToLeague(lg)} activeOpacity={0.8}>
              <GlassCard style={[{ marginBottom: 8 }, isESPN && { borderColor: ESPN_RED_BORDER }, isYahoo && { borderColor: YAHOO_PURPLE_BORDER }]} padding={0}>
                <View style={styles.leagueRow}>
                  <PlatformLogo platform={lg.platform} avatar={lg.avatar} size={64} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.leagueName}>{lg.name}</Text>
                    <Text style={styles.leagueSub}>
                      <Text style={{ color: platColor, fontWeight: '700' }}>{PLAT_LABEL(lg.platform)}</Text>
                      {lg.format ? ` · ${lg.format}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', marginRight: 6 }}>
                    {lg.rec  && <Text style={[styles.leagueRec, { color: w >= l ? C.sage : '#c87878' }]}>{lg.rec}</Text>}
                    {lg.rank && <Text style={styles.leagueRank}>{lg.rank}</Text>}
                  </View>
                  {(isESPN || isYahoo) && (
                    <View style={[styles.leaguePlatBadge, { backgroundColor: platColor }]}>
                      <Text style={styles.leaguePlatBadgeTxt}>{isESPN ? 'E' : 'Y'}</Text>
                    </View>
                  )}
                  <Text style={styles.chevron}>›</Text>
                </View>
              </GlassCard>
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: SP[3], paddingBottom: 110 },
  logo:   { width: SCREEN_W, height: 180, marginLeft: -SP[3], marginBottom: 2 },

  headerBar:  { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 12 },
  handlePill: { backgroundColor: C.glass, borderRadius: R.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.glassBorder },
  handleTxt:  { fontSize: SZ.sm, color: C.dim, fontFamily: F.mono, ...textShadow.subtle },
  gearBtn:    { padding: 6 },

  newsHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  newsEye:       { fontSize: SZ.xs, fontFamily: F.mono, color: C.gold, letterSpacing: 1.4, ...textShadow.gold },
  newsHint:      { marginLeft: 'auto' as any, fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, opacity: 0.5, ...textShadow.subtle },
  newsChip:      { width: 240, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  newsDot:       { width: 6, height: 6, borderRadius: 3, marginTop: 3, flexShrink: 0 },
  newsSource:    { fontSize: SZ.xs, fontFamily: F.mono, letterSpacing: 1, marginBottom: 3, fontWeight: '700', ...textShadow.subtle },
  newsText:      { fontSize: SZ.sm, fontFamily: F.outfit, color: '#ffffff', lineHeight: 18, ...textShadow.body },

  loadingCard: { alignItems: 'center', padding: 40, gap: 12 },
  loadingTxt:  { color: C.dim, fontFamily: F.mono, fontSize: SZ.sm, ...textShadow.subtle },

  scoreCard: { padding: 14 },
  scoreEye:  { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 1.2, marginBottom: 8, ...textShadow.subtle },
  matchRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamLbl:   { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, marginBottom: 2, ...textShadow.subtle },
  scoreNum:  { fontSize: SZ['2xl'], fontWeight: '900', color: '#ffffff', letterSpacing: -1, lineHeight: 32, fontFamily: F.bold, ...textShadow.hero },
  winPill:   { backgroundColor: 'rgba(82,196,148,0.35)', borderRadius: R.full, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderColor: 'rgba(82,196,148,0.65)' },
  losePill:  { backgroundColor: 'rgba(224,85,85,0.18)', borderColor: 'rgba(224,85,85,0.45)' },
  winTxt:    { fontSize: SZ.sm, fontWeight: '700', color: '#82c494', fontFamily: F.bold, letterSpacing: 0.5, ...textShadow.body },
  loseTxt:   { color: '#e05555' },
  progBg:    { height: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginTop: 10 },
  progFill:  { height: 6, borderRadius: 3 },

  platBadge:    { position: 'absolute', top: 10, right: 10, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  platBadgeTxt: { fontSize: 9, fontWeight: '900', color: '#fff', fontFamily: F.mono, letterSpacing: 1 },

  leaguePlatBadge:    { width: 20, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  leaguePlatBadgeTxt: { fontSize: 10, fontWeight: '900', color: '#fff', fontFamily: F.mono },

  dotsRow:  { flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 10 },
  dot:      { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  dotActive:{ backgroundColor: C.gold, width: 14, borderRadius: 3 },

  insightHdr:       { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 9 },
  insightEye:       { fontSize: SZ.xs, fontFamily: F.mono, color: C.gold, letterSpacing: 1.4, flex: 1, ...textShadow.gold },
  dotInsight:       { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(254,226,41,0.25)' },
  dotInsightActive: { width: 12, backgroundColor: C.gold },
  insightTitle:     { fontSize: SZ.base, fontWeight: '700', color: C.ink, fontFamily: F.bold, ...textShadow.body },
  insightText:      { fontSize: SZ.md, color: C.ink2, lineHeight: 18, fontFamily: F.outfit, ...textShadow.body },

  leagueRow:  { flexDirection: 'row', alignItems: 'center', padding: 14 },
  leagueName: { fontSize: SZ.base, fontWeight: '700', color: C.ink, fontFamily: F.bold, ...textShadow.body },
  leagueSub:  { fontSize: SZ.sm, fontFamily: F.mono, color: 'rgba(255,255,255,0.75)', marginTop: 2, ...textShadow.subtle },
  leagueRec:  { fontSize: SZ.base, fontWeight: '700', fontFamily: F.bold, ...textShadow.body },
  leagueRank: { fontSize: SZ.xs, fontFamily: F.mono, color: 'rgba(254,226,41,0.9)', marginTop: 3, ...textShadow.gold },
  chevron:    { color: C.dim2, fontSize: SZ.xl, ...textShadow.body },
});