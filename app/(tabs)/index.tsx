import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNFLSeason, getAvailableSeasons } from '../../services/season';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions,
  Linking, Modal, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from "../../services/ai";
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { getValidYahooToken } from '../../services/yahoo';
import { Icon } from '../components/AIOmniIcons';
import { AIOmniLogo, AIOmniWordmark } from '../components/AIOmniLogo';
import { dark, F, palette, SP, SZ } from '../constants/tokens';
import { incrementPrompt } from '../utils/promptCounter';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W    = SCREEN_W - SP[3] * 2;
const INSIGHT_W = CARD_W - 28;

type Platform = 'sleeper' | 'espn' | 'yahoo';
type League = {
  id: string; name: string; platform: Platform;
  format?: string; rec?: string; rank?: string;
  pts?: number; opp?: number; week?: number; avatar?: string;
};

type NewsItem = {
  source: string; headline: string; color: string; url?: string;
};

const PLAT_COLOR  = (p: Platform) => p === 'espn' ? palette.flame : p === 'yahoo' ? '#a855f2' : palette.aqua;
const PLAT_LABEL  = (p: Platform) => p === 'espn' ? 'ESPN' : p === 'yahoo' ? 'YAHOO' : 'SLEEPER';

const FALLBACK_NEWS: NewsItem[] = [
  { source: 'ROTOWIRE', headline: 'Jaxon Smith-Njigba: 5th-year option picked up by SEA', color: palette.green, url: 'https://www.rotowire.com/football/player/jaxon-smith-njigba-15164' },
  { source: 'PFR', headline: 'NFL Teams Higher On Their QBs Than Draft Pundits?', color: palette.amber, url: 'https://www.pro-football-reference.com' },
  { source: 'CBS SPORTS', headline: 'Fantasy waiver wire pickups to target this week', color: palette.aqua, url: 'https://www.cbssports.com/fantasy/football/news/fantasy-football-waiver-wire' },
  { source: 'SLEEPER', headline: 'Saquon Barkley approaches single-season rushing record', color: palette.chartreuse },
];

const FALLBACK_INSIGHTS = [
  { icon: 'target', title: 'Start Barkley',  body: 'Dream matchup vs NYG — 32nd ranked run D. Ceiling 35+.',  tag: 'START',   color: palette.green },
  { icon: 'alert', title: 'Watch Achane',   body: 'Listed Q — check 11:30am reports. Pollard on standby.',  tag: 'MONITOR', color: palette.amber },
  { icon: 'fire',   title: 'Add Shaheed',    body: '3 TDs in last 4 games. 78% target share with Drake.',    tag: 'HOT',     color: palette.flame },
];

const FlatCard: React.FC<{ style?: any; children: React.ReactNode }> = ({ style, children }) => (
  <View style={[styles.flatCard, style]}>{children}</View>
);

export default function HomeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const [leagues,        setLeagues]        = useState<League[]>([]);
  const [username,       setUsername]       = useState('');
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [insightIdx,     setInsightIdx]     = useState(0);
  const [aiInsights,     setAiInsights]     = useState<{title:string;body:string;tag:string;color:string;icon:string}[]>([]);
  const [insightLoading, setInsightLoading] = useState(false);
  const [scoreIdx,       setScoreIdx]       = useState(0);
  const [news,           setNews]           = useState<NewsItem[]>(FALLBACK_NEWS);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['sleeper', 'espn', 'yahoo']);
  const [selectedSeason,    setSelectedSeason]    = useState(String(new Date().getFullYear()));
  const [aiCoachActive,     setAiCoachActive]     = useState(false);
  const [selectedLeague,    setSelectedLeague]    = useState<League | null>(null);
  const [aiCoachLoading,    setAiCoachLoading]    = useState(false);
  const [aiCoachInsight,    setAiCoachInsight]    = useState('');

  const scoreAnims = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;

  useEffect(() => { loadLeagues(); fetchNews(); }, [selectedSeason]);

  // ── All data loading functions identical to v6 ──
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

  const loadESPNLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadESPNCredentials();
      if (!creds?.leagueId) {
        // Try to discover leagues
        try {
          const { getESPNLeagues } = require('../../services/espn');
          const leagues = await getESPNLeagues(creds);
          if (leagues && leagues.length > 0) {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default;
            await AsyncStorage.setItem('espn_league_ids', JSON.stringify([leagues[0].id]));
            creds.leagueId = leagues[0].id;
          } else {
            return [];
          }
        } catch {
          return [];
        }
      }
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

  const loadYahooLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {
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
    } catch (e) { console.error('Load leagues error:', e); }
    setLoading(false);
  }, [selectedSeason]);

  const fetchAIInsights = async (league: League) => {
    if (insightLoading) return;
    setInsightLoading(true);
    try {
      const prompt = `You are AIOmni, an elite fantasy football analyst. For this ${league.platform.toUpperCase()} league (${league.format}), provide 3 concise, actionable insights for Week ${league.week}. Focus on starting/sitting decisions, waiver wire adds, and matchup analysis. Format as JSON array with objects having: emoji, title, body, tag, color. Keep each insight under 120 characters.`;
      const response = await askAI(prompt, 400);
      const insights = JSON.parse(response?.replace(/```json|```/g, '').trim() || '[]');
      if (Array.isArray(insights) && insights.length > 0) setAiInsights(insights);
    } catch (e) { console.error('AI insights error:', e); }
    setInsightLoading(false);
  };

  const fetchNews = async () => {
    try {
      const parseRSS = (xml: string, source: string, color: string): NewsItem[] => {
        const items: NewsItem[] = [];
        const itemRegex = /<item>(.*?)<\/item>/gs;
        let match;
        while ((match = itemRegex.exec(xml)) !== null) {
          const itemXml = match[1];
          const titleMatch = itemXml.match(/<title>(.*?)<\/title>/);
          const linkMatch = itemXml.match(/<link>(.*?)<\/link>/) || itemXml.match(/<guid[^>]*>(http[^<]*)<\/guid>/);
          if (titleMatch && items.length < 3) {
            items.push({ source, headline: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(), color, url: linkMatch?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() });
          }
        }
        return items;
      };
      const [rotoRes, pfrRes, cbsRes] = await Promise.allSettled([
        fetch('https://www.rotowire.com/rss/current.xml').then(r => r.text()),
        fetch('https://www.pro-football-reference.com/rss.xml').then(r => r.text()),
        fetch('https://www.cbssports.com/rss/headlines/nfl/').then(r => r.text()),
      ]);
      const results: NewsItem[] = [];
      if (rotoRes.status === 'fulfilled') results.push(...parseRSS(rotoRes.value, 'ROTOWIRE', palette.green));
      if (pfrRes.status  === 'fulfilled') results.push(...parseRSS(pfrRes.value, 'PFR', palette.amber));
      if (cbsRes.status  === 'fulfilled') results.push(...parseRSS(cbsRes.value, 'CBS SPORTS', palette.aqua));
      const roto = results.filter(n => n.source === 'ROTOWIRE');
      const pfr  = results.filter(n => n.source === 'PFR');
      const cbs  = results.filter(n => n.source === 'CBS SPORTS');
      const interleaved: NewsItem[] = [];
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
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.aqua} />}
      >
        {/* ── Header ── */}
        <View style={styles.headerBar}>
          <AIOmniWordmark fontSize={22} color={dark.text} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {username ? (
              <View style={styles.handlePill}>
                <Text style={styles.handleTxt}>@{username}</Text>
              </View>
            ) : null}
            <TouchableOpacity onPress={() => router.push('/settings-page' as any)} style={styles.gearBtn}>
              <Ionicons name="settings-sharp" size={20} color={dark.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Platform pills + season ── */}
        <View style={styles.platformRow}>
          <View style={styles.platformToggles}>
            {(['sleeper', 'espn', 'yahoo'] as Platform[]).map(platform => {
              const isSelected = selectedPlatforms.includes(platform);
              const color = PLAT_COLOR(platform);
              return (
                <TouchableOpacity
                  key={platform}
                  onPress={() => setSelectedPlatforms(prev => isSelected ? prev.filter(p => p !== platform) : [...prev, platform])}
                  style={[styles.platformToggle, isSelected && { backgroundColor: color, borderColor: color }]}
                >
                  <Text style={[styles.platformToggleText, isSelected && { color: dark.bg }]}>
                    {PLAT_LABEL(platform)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            onPress={() => { const seasons = getAvailableSeasons(); Alert.alert('Select Season', '', seasons.map(y => ({ text: y, onPress: () => setSelectedSeason(y) })), { cancelable: true }); }}
            style={styles.seasonPill}
          >
            <Text style={styles.seasonPillText}>{selectedSeason} ▾</Text>
          </TouchableOpacity>
        </View>

        {/* ── Live Feed ── */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>LIVE FEED</Text>
          <Text style={styles.sectionHint}>← swipe →</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {news.map((n, i) => (
            <TouchableOpacity key={i} activeOpacity={0.7} onPress={() => n.url ? Linking.openURL(n.url) : undefined}
              style={[styles.newsChip, { borderColor: n.color + '25' }]}>
              <View style={[styles.newsDot, { backgroundColor: n.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.newsSource, { color: n.color }]}>{n.source}</Text>
                <Text style={styles.newsText} numberOfLines={2}>{n.headline}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Score cards ── */}
        {loading ? (
          <FlatCard style={styles.loadingCard}>
            <ActivityIndicator color={palette.aqua} size="large" />
            <Text style={styles.loadingTxt}>Loading your leagues...</Text>
          </FlatCard>
        ) : leagues.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scoreScroll} style={{ marginBottom: 16 }}>
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
                  style={styles.scoreCardGrid}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={styles.leagueNameGrid} numberOfLines={1}>{lg.name}</Text>
                    <View style={[styles.badge, { backgroundColor: PLAT_COLOR(lg.platform) + '18' }]}>
                      <Text style={[styles.badgeText, { color: PLAT_COLOR(lg.platform) }]}>{PLAT_LABEL(lg.platform)}</Text>
                    </View>
                  </View>
                  <Text style={styles.leagueMetaGrid}>{lg.format} · Wk {lg.week}</Text>
                  {lg.rank && <Text style={styles.leagueRankGrid}>{lg.rank}</Text>}
                  <View style={styles.scoreRowGrid}>
                    <View style={styles.scoreBoxGrid}>
                      <Text style={styles.scoreLabelGrid}>YOU</Text>
                      <Text style={[styles.scoreNumGrid, { color: winning ? palette.green : dark.text }]}>{ptsVal}</Text>
                    </View>
                    <Text style={styles.scoreVsGrid}>vs</Text>
                    <View style={styles.scoreBoxGrid}>
                      <Text style={styles.scoreLabelGrid}>OPP</Text>
                      <Text style={[styles.scoreNumGrid, { color: !winning ? palette.flame : dark.text }]}>{oppVal}</Text>
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
          <FlatCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No leagues found</Text>
            <Text style={styles.emptyTxt}>Connect Sleeper, ESPN, or Yahoo in Settings.</Text>
            <TouchableOpacity onPress={() => router.push('/settings-page' as any)} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnTxt}>GO TO SETTINGS</Text>
            </TouchableOpacity>
          </FlatCard>
        )}

        {/* ── AI Coach Bar ── */}
        <TouchableOpacity
          style={[styles.aiCoachBar, aiCoachActive && styles.aiCoachBarActive]}
          onPress={() => setAiCoachActive(!aiCoachActive)}
          activeOpacity={0.8}
        >
          <AIOmniLogo size={28} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.aiCoachLabel}>AI COACH</Text>
            <Text style={styles.aiCoachHint}>{aiCoachActive ? 'Active — tap any score card' : 'Tap to activate'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={dark.textMuted} />
        </TouchableOpacity>


        {/* ── AI Insights ── */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>AI INSIGHTS</Text>
          <Text style={styles.sectionHint}>swipe</Text>
        </View>
        <ScrollView
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          snapToInterval={INSIGHT_W + 10} decelerationRate="fast"
          contentContainerStyle={{ gap: 10 }}
          style={{ marginBottom: 4 }}
          onMomentumScrollEnd={e => setInsightIdx(Math.round(e.nativeEvent.contentOffset.x / (INSIGHT_W + 10)))}
        >
          {displayInsights.map((insight, i) => (
            <View key={i} style={[styles.insightCard, { width: INSIGHT_W, borderColor: (insight.color || palette.aqua) + '25' }]}>
              <View style={styles.insightTop}>
                <View style={[styles.insightIconWrap, { backgroundColor: (insight.color || palette.aqua) + '15' }]}>
                  <Icon name={insight.icon as any} size={18} color={insight.color || palette.aqua} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.insightTitle}>{insight.title}</Text>
                  <Text style={styles.insightBody}>{insight.body}</Text>
                </View>
              </View>
              <View style={[styles.insightTag, { backgroundColor: (insight.color || palette.aqua) + '15' }]}>
                <Text style={[styles.insightTagTxt, { color: insight.color || palette.aqua }]}>{insight.tag}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={styles.insightDots}>
          {displayInsights.map((_, i) => (
            <View key={i} style={[styles.insightDot, i === insightIdx && styles.insightDotOn]} />
          ))}
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* ── AI Coach Modal ── */}
      <Modal visible={!!selectedLeague && aiCoachActive} transparent animationType="slide" onRequestClose={() => setSelectedLeague(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(10,18,20,0.7)', justifyContent: 'flex-end' }}>
          <View style={styles.modalSheet}>
            <TouchableOpacity onPress={() => setSelectedLeague(null)} style={{ alignSelf: 'flex-end' }} hitSlop={12}>
              <Ionicons name="close" size={22} color={dark.textMuted} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{selectedLeague?.name}</Text>
            <View style={styles.modalScores}>
              <View><Text style={styles.modalLabel}>YOU</Text><Text style={styles.modalScore}>{(selectedLeague?.pts ?? 0).toFixed(1)}</Text></View>
              <Text style={styles.modalVs}>vs</Text>
              <View style={{ alignItems: 'flex-end' }}><Text style={styles.modalLabel}>OPP</Text><Text style={styles.modalScore}>{(selectedLeague?.opp ?? 0).toFixed(1)}</Text></View>
            </View>
            {aiCoachLoading ? (
              <ActivityIndicator color={palette.aqua} size="large" style={{ paddingVertical: 24 }} />
            ) : (
              <Text style={styles.modalInsight}>{aiCoachInsight}</Text>
            )}
            <TouchableOpacity style={styles.modalBtn} onPress={() => setSelectedLeague(null)}>
              <Text style={styles.modalBtnTxt}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: SP[3] },

  // Header
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  handlePill: { backgroundColor: dark.surface, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: dark.border },
  handleTxt: { fontSize: SZ.xs, fontFamily: F.mono, color: dark.textSub },
  gearBtn: { padding: 6 },

  // Platform pills
  platformRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  platformToggles: { flexDirection: 'row', gap: 6 },
  platformToggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: dark.border, backgroundColor: dark.card },
  platformToggleText: { fontSize: 10, fontFamily: F.bold, color: dark.textSub, letterSpacing: 0.5 },
  seasonPill: { backgroundColor: dark.card, borderRadius: 8, borderWidth: 1, borderColor: dark.border, paddingHorizontal: 12, paddingVertical: 6 },
  seasonPillText: { fontSize: 10, fontFamily: F.mono, color: dark.textSub },

  // Section headers
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionLabel: { fontSize: 10, fontFamily: F.bold, color: palette.aqua, letterSpacing: 1.5 },
  sectionHint: { fontSize: 9, fontFamily: F.mono, color: dark.textMuted },

  // News feed
  newsChip: { backgroundColor: dark.card, borderRadius: 12, padding: 12, borderWidth: 1, minWidth: 240, flexDirection: 'row', alignItems: 'flex-start' },
  newsDot: { width: 6, height: 6, borderRadius: 3, marginRight: 8, marginTop: 4 },
  newsSource: { fontSize: 9, fontFamily: F.monoBold, letterSpacing: 1, marginBottom: 2 },
  newsText: { fontSize: 12, color: dark.textSub, lineHeight: 17, fontFamily: F.body },

  // Flat card base
  flatCard: { backgroundColor: dark.card, borderRadius: 14, borderWidth: 1, borderColor: dark.border, padding: 16 },

  // Loading
  loadingCard: { alignItems: 'center', padding: 40 },
  loadingTxt: { fontSize: SZ.sm, color: dark.textMuted, marginTop: 12, fontFamily: F.body },

  // Score grid
  scoreScroll: { gap: 10, paddingHorizontal: 2 },
  scoreCardGrid: {
    backgroundColor: dark.card, borderRadius: 14, borderWidth: 1, borderColor: dark.border,
    padding: 14, width: SCREEN_W * 0.65, flexShrink: 0,
  },
  leagueNameGrid: { fontSize: 11, color: dark.text, fontFamily: F.bodyBold, flex: 1, marginRight: 6 },
  leagueMetaGrid: { fontSize: 9, color: dark.textMuted, fontFamily: F.body, marginBottom: 4 },
  leagueRankGrid: { fontSize: 10, color: palette.aqua, fontFamily: F.body, marginBottom: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 7, fontFamily: F.monoBold, letterSpacing: 1 },
  scoreRowGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  scoreBoxGrid: { alignItems: 'center', flex: 1 },
  scoreLabelGrid: { fontSize: 8, color: dark.textMuted, fontFamily: F.mono, letterSpacing: 1, marginBottom: 2 },
  scoreNumGrid: { fontSize: 22, fontFamily: F.bold, color: dark.text },
  scoreVsGrid: { fontSize: 11, color: dark.textMuted, fontFamily: F.body, marginHorizontal: 6 },

  // Empty state
  emptyCard: { alignItems: 'center', padding: 28, marginBottom: 16 },
  emptyTitle: { fontSize: SZ.base, fontFamily: F.bold, color: dark.text, marginBottom: 6 },
  emptyTxt: { fontSize: SZ.sm, color: dark.textSub, textAlign: 'center', marginBottom: 16, fontFamily: F.body },
  emptyBtn: { backgroundColor: palette.aqua, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  emptyBtnTxt: { fontFamily: F.bold, color: dark.bg, fontSize: SZ.sm, letterSpacing: 1 },

  // AI Coach bar
  aiCoachBar: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 16, backgroundColor: dark.card, borderRadius: 14, borderWidth: 1, borderColor: dark.border },
  aiCoachBarActive: { borderColor: palette.aqua + '40', backgroundColor: palette.aqua + '08' },
  aiCoachLabel: { fontSize: 11, fontFamily: F.bold, color: dark.text, letterSpacing: 1 },
  aiCoachHint: { fontSize: 9, fontFamily: F.body, color: dark.textMuted, marginTop: 1 },

  // Insights
  insightCard: { backgroundColor: dark.card, borderRadius: 14, borderWidth: 1, padding: 16 },
  insightTop: { flexDirection: 'row', marginBottom: 10, alignItems: 'center' },
  insightIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  insightTitle: { fontSize: SZ.base, color: dark.text, fontFamily: F.bodyBold, marginBottom: 3 },
  insightBody: { fontSize: SZ.sm, color: dark.textSub, lineHeight: 18, fontFamily: F.body },
  insightTag: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  insightTagTxt: { fontSize: 9, fontFamily: F.monoBold, letterSpacing: 1 },
  insightDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 20 },
  insightDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: dark.textMuted },
  insightDotOn: { backgroundColor: palette.aqua },

  // Modal
  modalSheet: { backgroundColor: dark.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, minHeight: 300, borderTopWidth: 1, borderColor: dark.border },
  modalTitle: { fontSize: SZ.xl, fontFamily: F.bold, color: dark.text, marginBottom: 16 },
  modalScores: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalLabel: { fontSize: 9, fontFamily: F.mono, color: dark.textMuted, letterSpacing: 1 },
  modalScore: { fontSize: SZ['2xl'], fontFamily: F.bold, color: palette.aqua, marginTop: 4 },
  modalVs: { fontSize: SZ.lg, fontFamily: F.body, color: dark.textMuted },
  modalInsight: { fontSize: SZ.sm, fontFamily: F.body, color: dark.textSub, lineHeight: 20, marginBottom: 20 },
  modalBtn: { backgroundColor: palette.aqua, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalBtnTxt: { fontFamily: F.bold, color: dark.bg, fontSize: SZ.base, letterSpacing: 1 },
});