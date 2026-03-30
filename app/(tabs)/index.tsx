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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { Badge, SectionHeader } from '../components/Atoms';
import { GlassCard } from '../components/GlassCard';
import { OrbAvatar } from '../components/OrbAvatar';
import { C, F, R, SP, SZ, textShadow } from '../constants/tokens';

const LOGO = require('../../assets/images/logo.png');
const { width: SCREEN_W } = Dimensions.get('window');

type League = {
  id: string; name: string; platform: 'sleeper' | 'espn';
  format?: string; rec?: string; rank?: string;
  pts?: number; opp?: number; week?: number;
};

const FALLBACK_NEWS = [
  { source: 'ROTOWIRE', headline: 'Jaxon Smith-Njigba: 5th-year option picked up by SEA', color: '#4ab8a0' },
  { source: 'PFR',      headline: 'NFL Teams Higher On Their QBs Than Draft Pundits?',    color: '#e8a84b' },
  { source: 'ROTOWIRE', headline: 'CeeDee Lamb: No injury designation heading into WK 17', color: '#4ab8a0' },
  { source: 'SLEEPER',  headline: 'Saquon Barkley approaches single-season rushing record', color: C.gold },
];

const INSIGHTS = [
  { emoji: '🎯', title: 'Start Barkley',  body: 'Dream matchup vs NYG — 32nd ranked run D. Ceiling 35+.',  tag: 'START',   color: C.sage },
  { emoji: '⚠️', title: 'Watch Achane',   body: 'Listed Q — check 11:30am reports. Pollard on standby.',  tag: 'MONITOR', color: '#e8a84b' },
  { emoji: '🔥', title: 'Add Shaheed',    body: '3 TDs in last 4 games. 78% target share with Drake.',    tag: 'HOT',     color: C.gold },
];

const ESPN_RED = '#d00';
const ESPN_RED_BORDER = 'rgba(221,0,0,0.35)';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [leagues, setLeagues]       = useState<League[]>([]);
  const [username, setUsername]     = useState('');
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [insightIdx, setInsightIdx] = useState(0);
  const [aiInsight, setAiInsight]   = useState<{title:string;body:string;tag:string;color:string;emoji:string}|null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [scoreIdx, setScoreIdx]     = useState(0);
  const [news, setNews]             = useState(FALLBACK_NEWS);

  const scoreAnims = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;
  const CARD_W = SCREEN_W - SP[3] * 2;

  useEffect(() => {
    loadLeagues();
    const t = setInterval(() => setInsightIdx(i => (i + 1) % INSIGHTS.length), 4000);
    fetchNews();
    return () => clearInterval(t);
  }, []);

  const loadSleeperLeagues = async (): Promise<League[]> => {
    try {
      const u = await AsyncStorage.getItem('sleeper_username');
      if (!u) return [];
      const user = await (await fetch(`https://api.sleeper.app/v1/user/${u}`)).json();
      if (!user?.user_id) return [];
      const slRes  = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2025`);
      const leagues = await slRes.json();
      if (!Array.isArray(leagues)) return [];
      const stateRes = await fetch('https://api.sleeper.app/v1/state/nfl');
      const state    = await stateRes.json();
      const week     = state.leg || state.display_week || state.week || 17;

      return Promise.all(leagues.map(async (l: any): Promise<League> => {
        const isPPR = l.scoring_settings?.rec > 0;
        const isSF  = (l.roster_positions || []).includes('SUPER_FLEX');
        const fmt   = `${isPPR ? (l.scoring_settings.rec >= 1 ? 'PPR' : '0.5 PPR') : 'STD'}${isSF ? ' · SF' : ''}`;
        try {
          const [rosters, matchups] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${l.league_id}/rosters`).then(r => r.json()),
            fetch(`https://api.sleeper.app/v1/league/${l.league_id}/matchups/${week}`).then(r => r.json()),
          ]);
          const myRoster   = Array.isArray(rosters)  ? rosters.find((r: any) => r.owner_id === user.user_id) : null;
          const myMatchup  = Array.isArray(matchups) ? matchups.find((m: any) => m.roster_id === myRoster?.roster_id) : null;
          const oppMatchup = myMatchup ? matchups.find((m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster?.roster_id) : null;
          const wins   = myRoster?.settings?.wins   ?? 0;
          const losses = myRoster?.settings?.losses ?? 0;
          const sorted = Array.isArray(rosters) ? [...rosters].sort((a: any, b: any) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)) : [];
          const rank   = sorted.findIndex((r: any) => r.roster_id === myRoster?.roster_id) + 1;
          return {
            id: l.league_id, name: l.name, platform: 'sleeper', format: fmt,
            rec: `${wins}–${losses}`,
            rank: rank > 0 ? `${rank}${ordinal(rank)} of ${rosters.length}` : undefined,
            pts: myMatchup?.points ?? 0, opp: oppMatchup?.points ?? 0, week,
          };
        } catch {
          return { id: l.league_id, name: l.name, platform: 'sleeper', format: fmt };
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
      const myTeam = findMyESPNTeam(leagueData, creds.teamName || '');
      const settings = leagueData.settings?.scoringSettings;
      const recPts   = settings?.REC ?? 0;
      const fmt      = recPts >= 1 ? 'PPR' : recPts >= 0.5 ? '0.5 PPR' : 'STD';
      const wins   = myTeam?.record?.overall?.wins   ?? 0;
      const losses = myTeam?.record?.overall?.losses ?? 0;
      const teams      = leagueData.teams ?? [];
      const sorted     = [...teams].sort((a: any, b: any) => (b.record?.overall?.wins ?? 0) - (a.record?.overall?.wins ?? 0));
      const rankIdx    = sorted.findIndex((t: any) => t.id === myTeam?.id);
      const rankStr    = rankIdx >= 0 ? `${rankIdx + 1}${ordinal(rankIdx + 1)} of ${teams.length}` : undefined;
      const week        = leagueData.scoringPeriodId ?? 17;
      const matchupData = leagueData.schedule?.find(
        (m: any) => m.matchupPeriodId === week &&
          (m.home?.teamId === myTeam?.id || m.away?.teamId === myTeam?.id)
      );
      const myScore  = matchupData?.home?.teamId === myTeam?.id ? matchupData?.home?.totalPoints : matchupData?.away?.totalPoints;
      const oppScore = matchupData?.home?.teamId === myTeam?.id ? matchupData?.away?.totalPoints : matchupData?.home?.totalPoints;
      return [{ id: String(creds.leagueId), name: leagueData.settings?.name ?? 'ESPN League', platform: 'espn', format: fmt, rec: `${wins}–${losses}`, rank: rankStr, pts: myScore ?? 0, opp: oppScore ?? 0, week }];
    } catch (e) { console.log('loadESPNLeagues:', e); return []; }
  };

  const loadLeagues = async () => {
    setLoading(true);
    const u = await AsyncStorage.getItem('sleeper_username');
    if (u) setUsername(u);
    const [sleeperLeagues, espnLeagues] = await Promise.all([loadSleeperLeagues(), loadESPNLeagues()]);
    const all = [...sleeperLeagues, ...espnLeagues];
    setLeagues(all);
    setLoading(false);
    if (all.length > 0) fetchAIInsight(all);
    all.forEach((lg, i) => {
      if (i < scoreAnims.length && lg.pts) {
        Animated.timing(scoreAnims[i], { toValue: lg.pts, duration: 1400 + i * 120, useNativeDriver: false }).start();
      }
    });
  };

  const fetchAIInsight = async (leagueList: League[]) => {
    setInsightLoading(true);
    try {
      const leagueContext = leagueList.map(l =>
        `${l.name} (${l.platform.toUpperCase()} · ${l.format}): Record ${l.rec ?? '?'}, Rank ${l.rank ?? '?'}, Score ${l.pts?.toFixed(1) ?? '?'} vs ${l.opp?.toFixed(1) ?? '?'} (${(l.pts ?? 0) > (l.opp ?? 0) ? 'WINNING' : 'LOSING'})`
      ).join('\n');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': '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', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 120,
          messages: [{ role: 'user', content: `You are AIOmni. A manager has ${leagueList.length} fantasy football leagues this week:\n${leagueContext}\n\nGive ONE cross-league insight that is ONLY relevant if it affects multiple leagues simultaneously. Good examples: same injured player owned in multiple leagues, losing in multiple leagues needing upside, a waiver target that helps several rosters. BAD examples: comparing QBs across leagues (each league is independent). Focus on portfolio-level risk or opportunity. Under 20 words. JSON only, no markdown:\n{"emoji":"🎯","title":"Short title (5 words max)","body":"Under 20 words","tag":"RISK|WAIVER|URGENT|TRADE","color":"sage|gold|red"}` }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text ?? '';
      const cleaned = text.replace(/```json|```/g, '').trim();
      const parsed  = JSON.parse(cleaned);
      const colorMap: Record<string, string> = { sage: '#2d7a5e', gold: '#c8a84b', red: '#c87878' };
      setAiInsight({ emoji: parsed.emoji ?? '🎯', title: parsed.title ?? 'AI Insight', body: parsed.body ?? '', tag: parsed.tag ?? 'INSIGHT', color: colorMap[parsed.color] ?? '#2d7a5e' });
    } catch (e) { console.log('AI insight error:', e); }
    setInsightLoading(false);
  };

  const fetchNews = async () => {
    const parseRSS = (xml: string, source: string, color: string) => {
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
      return items.slice(0, 6).flatMap(item => {
        const m = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ?? item.match(/<title>(.*?)<\/title>/);
        const raw = (m?.[1] ?? '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/<[^>]+>/g,'').trim();
        return raw ? [{ source, headline: raw, color }] : [];
      });
    };
    try {
      const [rotoRes, pfrRes] = await Promise.allSettled([
        fetch('https://www.rotowire.com/rss/news.php?sport=NFL').then(r => r.text()),
        fetch('https://www.profootballrumors.com/feed').then(r => r.text()),
      ]);
      const results: { source: string; headline: string; color: string }[] = [];
      if (rotoRes.status === 'fulfilled') results.push(...parseRSS(rotoRes.value, 'ROTOWIRE', '#4ab8a0'));
      if (pfrRes.status  === 'fulfilled') results.push(...parseRSS(pfrRes.value,  'PFR',      '#e8a84b'));
      const roto = results.filter(n => n.source === 'ROTOWIRE');
      const pfr  = results.filter(n => n.source === 'PFR');
      const interleaved: typeof results = [];
      for (let i = 0; i < Math.max(roto.length, pfr.length); i++) {
        if (roto[i]) interleaved.push(roto[i]);
        if (pfr[i])  interleaved.push(pfr[i]);
      }
      if (interleaved.length > 0) setNews(interleaved);
    } catch {}
  };

  const ordinal = (n: number) => {
    const s = ['th','st','nd','rd'];
    return s[(n % 100 > 3 && n % 100 < 21) ? 0 : Math.min(n % 10, 4)] || 'th';
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    scoreAnims.forEach(a => a.setValue(0));
    await loadLeagues();
    setRefreshing(false);
  }, []);

  const goToLeague = (l: League) =>
    router.push({ pathname: '/league', params: { leagueId: l.id, leagueName: l.name, platform: l.platform } });

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.gold} />}
      >
        {/* Header — 3x bigger logo + settings gear */}
        <View style={styles.header}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <View style={styles.headerRight}>
            {username ? (
              <View style={styles.handlePill}>
                <Text style={styles.handleTxt}>@{username}</Text>
              </View>
            ) : null}
            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.gearBtn}>
              <Ionicons name="settings-sharp" size={22} color={C.dim2} />
            </TouchableOpacity>
          </View>
        </View>

        {/* News feed */}
        <View style={styles.newsHeaderRow}>
          <Text style={styles.newsEye}>📡  LIVE FEED</Text>
          <Text style={styles.newsHint}>← swipe →</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {news.map((n, i) => (
            <View key={i} style={[styles.newsChip, { borderColor: n.color + '40' }]}>
              <View style={[styles.newsDot, { backgroundColor: n.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.newsSource, { color: n.color }]}>{n.source}</Text>
                <Text style={styles.newsText} numberOfLines={2}>{n.headline}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Score cards */}
        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={C.gold} size="large" />
            <Text style={styles.loadingTxt}>Loading your leagues...</Text>
          </View>
        ) : leagues.length > 0 ? (
          <>
            <ScrollView
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              snapToInterval={CARD_W + 10} decelerationRate="fast"
              contentContainerStyle={{ gap: 10 }} style={{ marginBottom: 4 }}
              onMomentumScrollEnd={e => setScoreIdx(Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 10)))}
            >
              {leagues.map((lg, i) => {
                const winning    = (lg.pts ?? 0) > (lg.opp ?? 0);
                const isESPN     = lg.platform === 'espn';
                const platColor  = isESPN ? ESPN_RED : C.gold;
                const platLabel  = isESPN ? 'ESPN' : 'SLEEPER';
                const scoreStr   = scoreAnims[i].interpolate({
                  inputRange:  [0, Math.max(lg.pts ?? 1, 1)],
                  outputRange: ['0.0', (lg.pts ?? 0).toFixed(1)],
                });
                return (
                  <GlassCard key={lg.id} style={[styles.scoreCard, { width: CARD_W }, isESPN && styles.espnCard]}>
                    <Text style={styles.scoreEye}>
                      {'⚡  LIVE · WK '}{lg.week}{'  '}
                      <Text style={{ color: platColor }}>{platLabel}</Text>
                      {'  ·  '}{lg.format}
                    </Text>
                    <View style={styles.matchRow}>
                      <View>
                        <Text style={styles.teamLbl}>{lg.name.toUpperCase().slice(0, 12)}</Text>
                        <Animated.Text style={[styles.scoreWin, !winning && { color: C.ink }]}>{scoreStr}</Animated.Text>
                      </View>
                      <View style={[styles.winPill, !winning && styles.losePill]}>
                        <Text style={[styles.winTxt, !winning && { color: '#e87878' }]}>
                          {winning ? '↑ WINNING' : '↓ LOSING'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.teamLbl}>OPPONENT</Text>
                        <Text style={[styles.scoreWin, { color: '#7a3040' }]}>{(lg.opp ?? 0).toFixed(1)}</Text>
                      </View>
                    </View>
                    <View style={styles.progBg}>
                      <View style={[styles.progFill, {
                        width: `${((lg.pts ?? 0) / Math.max((lg.pts ?? 0) + (lg.opp ?? 0), 1) * 100).toFixed(0)}%` as any,
                        backgroundColor: winning ? C.sage : 'rgba(200,120,120,0.7)',
                      }]} />
                    </View>
                    {isESPN && (
                      <View style={styles.espnBadge}>
                        <Text style={styles.espnBadgeTxt}>ESPN</Text>
                      </View>
                    )}
                  </GlassCard>
                );
              })}
            </ScrollView>
            <View style={styles.dotsRow}>
              {leagues.map((_, i) => (
                <View key={i} style={[styles.dot, i === scoreIdx && styles.dotActive]} />
              ))}
            </View>
          </>
        ) : null}

        {/* AI Insight */}
        <GlassCard style={{ marginBottom: 10 }}>
          <View style={styles.insightHdr}>
            <OrbAvatar size={9} />
            <Text style={styles.insightEye}>
              AI INSIGHT · {leagues.length > 0 ? `${leagues.length} LEAGUES` : 'LIVE'}
            </Text>
            {!aiInsight && (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {INSIGHTS.map((_, i) => (
                  <TouchableOpacity key={i} onPress={() => setInsightIdx(i)}>
                    <View style={[styles.dotInsight, i === insightIdx && styles.dotInsightActive]} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          {insightLoading ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 4 }}>
              <ActivityIndicator size="small" color={C.gold} />
              <Text style={[styles.loadingSub, textShadow.subtle]}>Scanning {leagues.length} leagues...</Text>
            </View>
          ) : (
            <ScrollView
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={e => {
                const allItems = aiInsight ? [aiInsight, ...INSIGHTS] : INSIGHTS;
                const w = e.nativeEvent.layoutMeasurement.width;
                if (w > 0) setInsightIdx(Math.round(e.nativeEvent.contentOffset.x / w));
              }}
            >
              {(aiInsight ? [aiInsight, ...INSIGHTS] : INSIGHTS).map((item, i) => (
                <View key={i} style={{ width: '100%', flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
                  <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
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

        {/* League list */}
        <SectionHeader label="MY LEAGUES" barColor={C.gold} />
        {loading ? null : leagues.map(lg => {
          const [w, l] = (lg.rec ?? '0–0').split('–').map(Number);
          const isESPN    = lg.platform === 'espn';
          const platColor = isESPN ? ESPN_RED : C.gold;
          return (
            <TouchableOpacity key={lg.id} onPress={() => goToLeague(lg)} activeOpacity={0.8}>
              <GlassCard style={[styles.leagueRow, isESPN && { borderColor: ESPN_RED_BORDER }]}>
                <OrbAvatar size={28} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.leagueName}>{lg.name}</Text>
                  <Text style={styles.leagueSub}>
                    <Text style={{ color: platColor, fontWeight: '700' }}>{isESPN ? 'ESPN' : 'SLEEPER'}</Text>
                    {lg.format ? ` · ${lg.format}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginRight: 6 }}>
                  {lg.rec && <Text style={[styles.leagueRec, { color: w >= l ? C.sage : '#c87878' }]}>{lg.rec}</Text>}
                  {lg.rank && <Text style={styles.leagueRank}>{lg.rank}</Text>}
                </View>
                <Text style={styles.chevron}>›</Text>
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
  scroll:         { paddingHorizontal: SP[3], paddingBottom: 110 },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  logo:           { height: 100, width: 340 },
  headerRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  handlePill:     { backgroundColor: C.glass, borderRadius: R.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.glassBorder },
  handleTxt:      { fontSize: SZ.sm, color: C.dim, fontFamily: F.mono, ...textShadow.subtle },
  gearBtn:        { padding: 6 },

  newsHeaderRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  newsEye:        { fontSize: SZ.xs, fontFamily: F.mono, color: C.gold, letterSpacing: 1.4, ...textShadow.gold },
  newsHint:       { marginLeft: 'auto' as any, fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, opacity: 0.5, ...textShadow.subtle },
  newsChip:       { width: 240, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  newsDot:        { width: 6, height: 6, borderRadius: 3, marginTop: 3, flexShrink: 0 },
  newsSource:     { fontSize: SZ.xs, fontFamily: F.mono, letterSpacing: 1, marginBottom: 3, fontWeight: '700', ...textShadow.subtle },
  newsText:       { fontSize: SZ.sm, fontFamily: F.outfit, color: '#ffffff', lineHeight: 18, ...textShadow.body },

  loadingCard:    { alignItems: 'center', padding: 40, gap: 12 },
  loadingTxt:     { color: C.dim, fontFamily: F.mono, fontSize: SZ.sm, ...textShadow.subtle },
  loadingSub:     { color: C.dim, fontFamily: F.mono, fontSize: SZ.sm },

  scoreCard:      { padding: 14 },
  espnCard:       { borderColor: ESPN_RED_BORDER },
  scoreEye:       { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 1.2, marginBottom: 8, ...textShadow.subtle },
  matchRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamLbl:        { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, marginBottom: 2, ...textShadow.subtle },
  scoreWin:       { fontSize: SZ['4xl'], fontWeight: '900', color: C.sage, letterSpacing: -1.5, lineHeight: 40, fontFamily: F.bold, ...textShadow.hero },
  winPill:        { backgroundColor: 'rgba(45,122,94,0.18)', borderRadius: R.full, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1.5, borderColor: 'rgba(45,122,94,0.40)' },
  losePill:       { backgroundColor: 'rgba(200,120,120,0.15)', borderColor: 'rgba(200,120,120,0.35)' },
  winTxt:         { fontSize: SZ.sm, fontWeight: '700', color: C.sage, fontFamily: F.bold, letterSpacing: 0.5, ...textShadow.body },
  progBg:         { height: 3, backgroundColor: '#7a1f2e', borderRadius: 2, overflow: 'hidden', marginTop: 10 },
  progFill:       { height: 3, borderRadius: 2 },

  espnBadge:      { position: 'absolute', top: 10, right: 10, backgroundColor: ESPN_RED, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  espnBadgeTxt:   { fontSize: 9, fontWeight: '900', color: '#fff', fontFamily: F.mono, letterSpacing: 1 },

  dotsRow:        { flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 10 },
  dot:            { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  dotActive:      { backgroundColor: C.gold, width: 14, borderRadius: 3 },

  insightHdr:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 9 },
  insightEye:     { fontSize: SZ.xs, fontFamily: F.mono, color: C.gold, letterSpacing: 1.4, flex: 1, ...textShadow.gold },
  dotInsight:     { width: 4, height: 3, borderRadius: 2, backgroundColor: 'rgba(200,168,75,0.25)' },
  dotInsightActive: { width: 12, backgroundColor: C.gold },
  insightTitle:   { fontSize: SZ.base, fontWeight: '700', color: C.ink, fontFamily: F.bold, ...textShadow.body },
  insightText:    { fontSize: SZ.md, color: C.ink2, lineHeight: 18, fontFamily: F.outfit, ...textShadow.body },

  leagueRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 8, padding: 14 },
  leagueName:     { fontSize: SZ.base, fontWeight: '700', color: C.ink, fontFamily: F.bold, ...textShadow.body },
  leagueSub:      { fontSize: SZ.sm, fontFamily: F.mono, color: 'rgba(255,255,255,0.75)', marginTop: 2, ...textShadow.subtle },
  leagueRec:      { fontSize: SZ.base, fontWeight: '700', fontFamily: F.bold, ...textShadow.body },
  leagueRank:     { fontSize: SZ.xs, fontFamily: F.mono, color: 'rgba(200,168,75,0.9)', marginTop: 3, ...textShadow.gold },
  chevron:        { color: C.dim2, fontSize: SZ.xl, ...textShadow.body },
});