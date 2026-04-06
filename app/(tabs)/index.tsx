import { askAI } from "../../services/ai";
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image,
  Linking, Modal, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { getValidYahooToken } from '../../services/yahoo';
import { AIOmniLogo, AIOmniIris } from '../components/AIOmniLogo';
import { Badge, SectionHeader } from '../components/Atoms';
import { C, F, R, SP, SZ, BEVEL } from '../constants/tokens';
import { incrementPrompt } from '../utils/promptCounter';

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

function PlatformLogo({ platform, size = 64 }: { platform: Platform; avatar?: string; size?: number }) {
  const LOGOS: Record<string, any> = {
    sleeper: require('../../assets/images/platforms/sleeper.png'),
    espn:    require('../../assets/images/platforms/espn.png'),
    yahoo:   require('../../assets/images/platforms/yahoo.png'),
  };
  return (
    <Image
      source={LOGOS[platform] ?? LOGOS.sleeper}
      style={{ width: size, height: size, borderRadius: size * 0.18, borderWidth: 1.5, borderColor: 'rgba(254,226,41,0.3)' }}
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

// ── Bevel Card ────────────────────────────────────────────────
// Matches mockup: cream gradient, blue bevel edges, gold inner glow
const BevelCard: React.FC<{ style?: any; children: React.ReactNode; blue?: boolean }> = ({ style, children, blue }) => (
  <View style={[blue ? styles.bevelBlue : styles.bevelCard, style]}>
    <View style={styles.bevelShine} />
    {children}
  </View>
);

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
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['sleeper', 'espn', 'yahoo']);
  const [selectedSeason,    setSelectedSeason]    = useState('2025');
  const [aiCoachActive,     setAiCoachActive]     = useState(false);
  const [selectedLeague,    setSelectedLeague]    = useState<League | null>(null);
  const [aiCoachLoading,    setAiCoachLoading]    = useState(false);
  const [aiCoachInsight,    setAiCoachInsight]    = useState('');

  const scoreAnims = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;

  useEffect(() => { loadLeagues(); fetchNews(); }, [selectedSeason]);

  // ── ALL DATA LOADING LOGIC UNCHANGED ──────────────────────
  const loadSleeperLeagues = async (year: string = '2025'): Promise<League[]> => {
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

  const loadESPNLeagues = async (year: string = '2025'): Promise<League[]> => {
    try {
      const creds = await loadESPNCredentials();
      if (!creds?.leagueId) return [];
      const leagueData = await getESPNLeague(creds.leagueId, creds, parseInt(year));
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
    } catch (e) { return []; }
  };

  const loadYahooLeagues = async (year: string = '2025'): Promise<League[]> => {
    try {
      const token = await getValidYahooToken();
      if (!token) return [];
      const res = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl;seasons=${year}/leagues?format=json`,
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
                    const sortedTeams = [...Array.from({ length: teamCount }, (_, idx) => idx)].sort((a, b) => {
                      const aStats = teams[a]?.team?.[1]?.team_standings?.outcome_totals;
                      const bStats = teams[b]?.team?.[1]?.team_standings?.outcome_totals;
                      return (bStats?.wins ?? 0) - (aStats?.wins ?? 0);
                    });
                    const myRank = sortedTeams.indexOf(t) + 1;
                    rank = `${myRank}${ordinal(myRank)} of ${teamCount}`;
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
                  const teams   = matchup?.[0]?.teams;
                  if (teams) {
                    const teamCount = teams.count ?? 0;
                    for (let t = 0; t < teamCount; t++) {
                      const teamData = teams[t]?.team;
                      const teamInfo = teamData?.[0];
                      const managerArr = teamInfo?.find((x: any) => Array.isArray(x?.managers));
                      const isMe = managerArr?.managers?.[0]?.manager?.is_current_login === '1';
                      if (isMe) {
                        pts = parseFloat(teamData?.[1]?.team_points?.total ?? '0');
                        const oppIdx = t === 0 ? 1 : 0;
                        opp = parseFloat(teams[oppIdx]?.team?.[1]?.team_points?.total ?? '0');
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
      const [sleeper, espn, yahoo] = await Promise.allSettled([
        loadSleeperLeagues(selectedSeason),
        loadESPNLeagues(selectedSeason),
        loadYahooLeagues(selectedSeason),
      ]);
      const allLeagues: League[] = [];
      if (sleeper.status === 'fulfilled') allLeagues.push(...sleeper.value);
      if (espn.status    === 'fulfilled') allLeagues.push(...espn.value);
      if (yahoo.status   === 'fulfilled') allLeagues.push(...yahoo.value);
      setLeagues(allLeagues);
      const u = await AsyncStorage.getItem('sleeper_username');
      setUsername(u || '');
      if (allLeagues.length > 0) fetchAIInsights(allLeagues[0]);
    } catch (e) { console.error('Load leagues error:', e); }
    setLoading(false);
  }, [selectedSeason]);

  const fetchAIInsights = async (league: League) => {
    if (insightLoading) return;
    setInsightLoading(true);
    try {
      const prompt = `You are AIOmni, an elite fantasy football analyst. For this ${league.platform.toUpperCase()} league (${league.format}), provide 3 concise, actionable insights for Week ${league.week}. Focus on starting/sitting decisions, waiver wire adds, and matchup analysis. Format as JSON array with objects having: emoji, title, body, tag, color. Use colors: sage, gold, amber, rose, ocean, mauve. Keep each insight under 120 characters.`;
      const response = await askAI(prompt, 400);
      const insights = JSON.parse(response?.replace(/```json|```/g, '').trim() || '[]');
      if (Array.isArray(insights) && insights.length > 0) setAiInsights(insights);
    } catch (e) { console.error('AI insights error:', e); }
    setInsightLoading(false);
  };

  const fetchNews = async () => {
    try {
      const parseRSS = (xml: string, source: string, color: string): { source: string; headline: string; color: string; url?: string }[] => {
        const items: typeof FALLBACK_NEWS = [];
        const itemRegex = /<item>(.*?)<\/item>/gs;
        let match;
        while ((match = itemRegex.exec(xml)) !== null) {
          const itemXml = match[1];
          const titleMatch = itemXml.match(/<title>(.*?)<\/title>/);
          const linkMatch  = itemXml.match(/<link>(.*?)<\/link>/);
          if (titleMatch && items.length < 3) {
            items.push({ source, headline: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(), color });
          }
        }
        return items;
      };
      const [rotoRes, pfrRes, cbsRes] = await Promise.allSettled([
        fetch('https://www.rotowire.com/rss/current.xml').then(r => r.text()),
        fetch('https://www.pro-football-reference.com/rss.xml').then(r => r.text()),
        fetch('https://www.cbssports.com/rss/headlines/nfl/').then(r => r.text()),
      ]);
      const results: { source: string; headline: string; color: string; url?: string }[] = [];
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

  const openAiCoachModal = async (league: League) => {
    setSelectedLeague(league);
    setAiCoachLoading(true);
    setAiCoachInsight('');
    try {
      await incrementPrompt();
      const prompt = `You are AIOmni AI Coach. Analyze this matchup and give 1 actionable insight in 2 sentences max:\n\nLeague: ${league.name} (${league.platform}, ${league.format})\nWeek: ${league.week}\nYour Score: ${league.pts}\nOpponent Score: ${league.opp}\n\nWhat should I focus on this week?`;
      const insight = await askAI(prompt, 150);
      setAiCoachInsight(insight);
    } catch (e) {
      setAiCoachInsight('Could not generate insight at this time.');
    }
    setAiCoachLoading(false);
  };

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
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 4 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.gold} />}
      >
        {/* ── V26 Animated Logo ── */}
        <View style={styles.logoWrap}>
          <AIOmniLogo width={SCREEN_W * 0.72} />
        </View>

        {/* ── Header row ── */}
        <View style={styles.headerBar}>
          <View style={{ flex: 1 }} />
          {username ? (
            <View style={styles.handlePill}>
              <Text style={styles.handleTxt}>@{username}</Text>
            </View>
          ) : null}
          <TouchableOpacity onPress={() => router.push('/settings')} style={styles.gearBtn}>
            <Ionicons name="settings-sharp" size={20} color={C.dim2} />
          </TouchableOpacity>
        </View>

        {/* ── Live feed ── */}
        <View style={styles.newsHeaderRow}>
          <Text style={styles.newsEye}>📡  LIVE FEED</Text>
          <Text style={styles.newsHint}>← swipe →</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {news.map((n, i) => (
            <View key={i} style={[styles.newsChip, { borderColor: n.color + '30' }]}>
              <View style={[styles.newsDot, { backgroundColor: n.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.newsSource, { color: n.color }]}>{n.source}</Text>
                <Text style={styles.newsText} numberOfLines={2}>{n.headline}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Platform toggles and season selector */}
        <View style={styles.platformRow}>
          <View style={styles.platformToggles}>
            {(['sleeper', 'espn', 'yahoo'] as Platform[]).map(platform => {
              const isSelected = selectedPlatforms.includes(platform);
              return (
                <TouchableOpacity
                  key={platform}
                  onPress={() => {
                    setSelectedPlatforms(prev =>
                      isSelected
                        ? prev.filter(p => p !== platform)
                        : [...prev, platform]
                    );
                  }}
                  style={[styles.platformToggle, isSelected && { borderColor: PLAT_COLOR(platform), borderWidth: 2 }]}
                >
                  <Text style={[styles.platformToggleText, isSelected && styles.platformToggleTextOn]}>
                    {PLAT_LABEL(platform)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            onPress={() => {
              // Show season selector
              const options = ['2025', '2024', '2023', '2022'];
              Alert.alert(
                'Select Season',
                '',
                options.map(year => ({
                  text: year,
                  onPress: () => setSelectedSeason(year),
                })),
                { cancelable: true }
              );
            }}
            style={styles.seasonPill}
          >
            <Text style={styles.seasonPillText}>{selectedSeason} ▾</Text>
          </TouchableOpacity>
        </View>

        {/* ── Score cards ── */}
        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={C.blueDeep} size="large" />
            <Text style={styles.loadingTxt}>Loading your leagues...</Text>
          </View>
        ) : leagues.length > 0 ? (
          <>
            {(() => {
              const filteredLeagues = leagues.filter(lg => selectedPlatforms.includes(lg.platform));
              const gridLeagues = filteredLeagues.slice(0, 4); // 2x2 grid
              return (
                <View style={styles.scoreGrid}>
                  {gridLeagues.map((lg, i) => {
                    const winning      = (lg.pts ?? 0) > (lg.opp ?? 0);
                    const platColor    = PLAT_COLOR(lg.platform);
                    const isNonSleeper = lg.platform !== 'sleeper';
                    const ptsVal       = parseFloat((lg.pts ?? 0).toFixed(1));
                    return (
                      <BevelCard key={lg.id} style={[styles.scoreCardGrid, isNonSleeper && { borderColor: PLAT_BORDER(lg.platform) }]}>
                        <Text style={styles.scoreEyeGrid}>
                          {'⚡ WK '}{lg.week}
                        </Text>
                        <TouchableOpacity 
                          onPress={() => aiCoachActive ? openAiCoachModal(lg) : goToLeague(lg)} 
                          activeOpacity={0.8} 
                          style={styles.leagueBtnGrid}
                        >
                          <View style={styles.leagueTopGrid}>
                            <PlatformLogo platform={lg.platform} size={24} />
                            <View style={{ flex: 1, marginLeft: 8 }}>
                              <Text style={styles.leagueNameGrid} numberOfLines={1}>{lg.name}</Text>
                              <Text style={styles.leagueMetaGrid}>{lg.format}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={14} color={C.dim2} />
                          </View>
                          {lg.rank && <Text style={styles.leagueRankGrid}>{lg.rank}</Text>}
                        </TouchableOpacity>
                        <View style={styles.scoreRowGrid}>
                          <View style={styles.scoreBoxGrid}>
                            <Text style={styles.scoreLabelGrid}>YOU</Text>
                            <Text style={[styles.scoreNumGrid, styles.scoreYou]}>{ptsVal}</Text>
                          </View>
                          <Text style={styles.scoreVsGrid}>VS</Text>
                          <View style={styles.scoreBoxGrid}>
                            <Text style={styles.scoreLabelGrid}>OPP</Text>
                            <Text style={[styles.scoreNumGrid, styles.scoreOpp]}>{parseFloat((lg.opp ?? 0).toFixed(1))}</Text>
                          </View>
                        </View>
                      </BevelCard>
                    );
                  })}
                  {Array.from({ length: Math.max(0, 4 - gridLeagues.length) }, (_, i) => (
                    <View key={`empty-${i}`} style={styles.emptyScoreCard} />
                  ))}
                </View>
              );
            })()}
          </>
        ) : (
          <BevelCard style={styles.emptyCard}>
            <Text style={styles.emptyEye}>🏆  NO LEAGUES FOUND</Text>
            <Text style={styles.emptyTxt}>Connect your Sleeper, ESPN, or Yahoo account in Settings to see your leagues.</Text>
            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnTxt}>GO TO SETTINGS</Text>
            </TouchableOpacity>
          </BevelCard>
        )}

        {/* AI Coach Bar */}
        <TouchableOpacity
          style={[styles.aiCoachBar, aiCoachActive && styles.aiCoachBarActive]}
          onPress={() => setAiCoachActive(!aiCoachActive)}
          activeOpacity={0.8}
        >
          <View style={styles.aiCoachBarShine} />
          <View style={styles.aiCoachLeft}>
            <AIOmniIris width={32} />
          </View>
          <View style={styles.aiCoachCenter}>
            <Text style={styles.aiCoachLabel}>AI COACH</Text>
            <Text style={styles.aiCoachHint}>Tap to activate · then tap any score card</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.dim2} />
        </TouchableOpacity>

        {/* AI Insights */}
        <View style={styles.insightsHeader}>
          <Text style={styles.insightsEye}>🤖  AI INSIGHTS</Text>
          <Text style={styles.insightsHint}>← swipe →</Text>
        </View>
        <ScrollView
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          snapToInterval={INSIGHT_W + 10} decelerationRate="fast"
          contentContainerStyle={{ gap: 10 }}
          style={{ marginBottom: 4 }}
          onMomentumScrollEnd={e => setInsightIdx(Math.round(e.nativeEvent.contentOffset.x / (INSIGHT_W + 10)))}
        >
          {displayInsights.map((insight, i) => (
            <BevelCard key={i} style={[styles.insightCard, { width: INSIGHT_W }]}>
              <View style={styles.insightTop}>
                <Text style={styles.insightEmoji}>{insight.emoji}</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.insightTitle}>{insight.title}</Text>
                  <Text style={styles.insightBody}>{insight.body}</Text>
                </View>
              </View>
              <View style={[styles.insightTag, { backgroundColor: insight.color + '20', borderColor: insight.color + '40' }]}>
                <Text style={[styles.insightTagTxt, { color: insight.color }]}>{insight.tag}</Text>
              </View>
            </BevelCard>
          ))}
        </ScrollView>
        <View style={styles.insightDots}>
          {displayInsights.map((_, i) => (
            <View key={i} style={[styles.insightDot, i === insightIdx && styles.insightDotOn]} />
          ))}
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* AI Coach Modal */}
      <Modal visible={!!selectedLeague && aiCoachActive} transparent animationType="slide" onRequestClose={() => setSelectedLeague(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(26,31,46,0.55)', justifyContent: 'flex-end' }}>
          <View style={styles.aiCoachModal}>
            <View style={styles.aiCoachModalShine} />
            <TouchableOpacity onPress={() => setSelectedLeague(null)} hitSlop={12}>
              <Text style={styles.aiCoachModalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.aiCoachModalTitle}>{selectedLeague?.name}</Text>
            <View style={styles.aiCoachModalScores}>
              <View>
                <Text style={styles.aiCoachModalLabel}>YOU</Text>
                <Text style={styles.aiCoachModalScore}>{(selectedLeague?.pts ?? 0).toFixed(1)}</Text>
              </View>
              <Text style={styles.aiCoachModalVs}>VS</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.aiCoachModalLabel}>OPP</Text>
                <Text style={styles.aiCoachModalScore}>{(selectedLeague?.opp ?? 0).toFixed(1)}</Text>
              </View>
            </View>
            {aiCoachLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color={C.blueDeep} size="large" />
              </View>
            ) : (
              <Text style={styles.aiCoachModalInsight}>{aiCoachInsight}</Text>
            )}
            <TouchableOpacity style={styles.aiCoachModalBtn} onPress={() => setSelectedLeague(null)}>
              <Text style={styles.aiCoachModalBtnTxt}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: SP[3] },
  logoWrap: { alignItems: 'center', marginBottom: 16 },
  headerBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  handlePill: { backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  handleTxt: { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 0.5 },
  gearBtn: { padding: 8, marginLeft: 8 },
  newsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  newsEye: { fontSize: SZ.sm, fontFamily: F.mono, color: C.blueDeep, letterSpacing: 2 },
  newsHint: { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2 },
  newsChip: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 12, padding: 12, borderWidth: 1.5, minWidth: 240 },
  newsDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8, marginTop: 2 },
  newsSource: { fontSize: SZ.xs, fontFamily: F.mono, letterSpacing: 1, marginBottom: 2 },
  newsText: { fontSize: SZ.sm, color: C.ink, lineHeight: 18 },
  loadingCard: { ...BEVEL.card, padding: 40, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)' },
  loadingTxt: { fontSize: SZ.sm, color: C.dim2, marginTop: 12, fontFamily: F.mono },
  scoreCard: { ...BEVEL.card, padding: 18, backgroundColor: 'rgba(255,255,255,0.95)' },
  platformRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  seasonPill: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 16, borderWidth: 1.5, borderColor: C.goldBorder, paddingHorizontal: 12, paddingVertical: 6 },
  seasonPillText: { fontSize: SZ.sm, fontFamily: F.mono, color: C.ink, letterSpacing: 0.5 },
  platformToggles: { flexDirection: 'row', gap: 8, flex: 1, justifyContent: 'center' },
  platformToggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: C.sageG, backgroundColor: 'rgba(255,255,255,0.85)' },
  platformToggleOn: { borderColor: C.blueDeep, borderWidth: 2 },
  platformToggleText: { fontSize: SZ.sm, fontFamily: F.mono, color: C.blueDeep, letterSpacing: 0.5 },
  platformToggleTextOn: { color: C.blueDeep, fontFamily: F.bold },
  scoreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  scoreCardGrid: { width: (SCREEN_W - SP[3] * 2 - 8) / 2, aspectRatio: 1.2 },
  scoreEyeGrid: { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2, letterSpacing: 1.5, marginBottom: 8, textAlign: 'center' },
  leagueBtnGrid: { marginBottom: 8 },
  leagueTopGrid: { flexDirection: 'row', alignItems: 'center' },
  leagueNameGrid: { fontSize: SZ.sm, color: C.ink, fontFamily: F.bold },
  leagueMetaGrid: { fontSize: SZ.xs, color: C.dim2, fontFamily: F.mono, marginTop: 2 },
  leagueRankGrid: { fontSize: SZ.sm, color: C.blueDeep, fontFamily: F.mono, textAlign: 'center', marginBottom: 4 },
  scoreRowGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  scoreBoxGrid: { alignItems: 'center', flex: 1 },
  scoreLabelGrid: { fontSize: SZ.xs, color: C.dim2, fontFamily: F.mono, letterSpacing: 1, marginBottom: 2 },
  scoreNumGrid: { fontSize: SZ.xl, fontFamily: F.bold },
  scoreYou: { color: '#fee229' },
  scoreOpp: { color: '#5883bf' },
  scoreVsGrid: { fontSize: SZ.md, color: C.dim2, fontFamily: F.bold, marginHorizontal: 8 },
  emptyScoreCard: { width: (SCREEN_W - SP[3] * 2 - 8) / 2, aspectRatio: 1.2, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  emptyCard: { ...BEVEL.card, padding: 24, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)' },
  emptyEye: { fontSize: SZ.sm, fontFamily: F.mono, color: C.blueDeep, letterSpacing: 2, marginBottom: 8 },
  emptyTxt: { fontSize: SZ.sm, color: C.dim2, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  emptyBtn: { backgroundColor: C.blueDeep, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  emptyBtnTxt: { color: '#ffffff', fontSize: SZ.sm, fontFamily: F.bold, letterSpacing: 1 },
  insightsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  insightsEye: { fontSize: SZ.sm, fontFamily: F.mono, color: C.blueDeep, letterSpacing: 2 },
  insightsHint: { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2 },
  insightCard: { ...BEVEL.card, padding: 18, backgroundColor: 'rgba(255,255,255,0.95)' },
  insightTop: { flexDirection: 'row', marginBottom: 12 },
  insightEmoji: { fontSize: SZ.xl },
  insightTitle: { fontSize: SZ.base, color: C.ink, fontFamily: F.bold, marginBottom: 4 },
  insightBody: { fontSize: SZ.sm, color: C.dim, lineHeight: 18 },
  insightTag: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  insightTagTxt: { fontSize: SZ.xs, fontFamily: F.mono, letterSpacing: 0.5 },
  insightDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 20 },
  insightDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.dim2 },
  insightDotOn: { backgroundColor: C.blueDeep },
  aiCoachBar: { ...BEVEL.card, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, marginBottom: 16, position: 'relative', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.92)' },
  aiCoachBarActive: { backgroundColor: C.gold + '18', borderColor: C.gold + '40', shadowColor: C.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
  aiCoachBarShine: BEVEL.shine,
  aiCoachLeft: { width: 40, alignItems: 'center' },
  aiCoachOrb: { fontSize: SZ.xl, color: C.gold, fontFamily: F.bold },
  aiCoachCenter: { flex: 1 },
  aiCoachLabel: { fontSize: SZ.sm, fontFamily: F.bold, color: C.ink, marginBottom: 2 },
  aiCoachHint: { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2 },
  aiCoachModal: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, minHeight: 320, borderTopWidth: 1.5, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: 'rgba(88,131,191,0.18)', position: 'relative', overflow: 'hidden', shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 12 },
  aiCoachModalShine: BEVEL.shine,
  aiCoachModalClose: { fontSize: SZ.lg, fontFamily: F.bold, color: C.blueDeep, alignSelf: 'flex-end', marginBottom: 8 },
  aiCoachModalTitle: { fontSize: SZ.xl, fontFamily: F.bold, color: C.ink, marginBottom: 16 },
  aiCoachModalScores: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  aiCoachModalLabel: { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2, letterSpacing: 1 },
  aiCoachModalScore: { fontSize: SZ['2xl'], fontFamily: F.bold, color: C.blueDeep, marginTop: 4 },
  aiCoachModalVs: { fontSize: SZ.lg, fontFamily: F.bold, color: C.dim2 },
  aiCoachModalInsight: { fontSize: SZ.sm, fontFamily: F.outfit, color: C.dim, lineHeight: 20, marginBottom: 20 },
  aiCoachModalBtn: { backgroundColor: C.gold, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  aiCoachModalBtnTxt: { fontFamily: F.bold, color: C.ink, fontSize: SZ.base, letterSpacing: 2 },
  bevelCard: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(88,131,191,0.18)', position: 'relative', overflow: 'hidden' },
  bevelBlue: { backgroundColor: 'rgba(217,253,243,0.9)', borderColor: 'rgba(88,131,191,0.18)' },
  bevelShine: { position: 'absolute', top: 0, left: '10%', right: '10%', height: 2, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 1 },
});
