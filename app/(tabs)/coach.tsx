import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, F, SZ, SP, R } from '../constants/tokens';
import { GlassCard } from '../components/GlassCard';
import { OrbAvatar } from '../components/OrbAvatar';
import { PositionPill, Badge } from '../components/Atoms';
import { loadESPNCredentials, getESPNLeague, findMyESPNTeam } from '../../services/espn';

// ── Claude API ─────────────────────────────────────────────────
const API_KEY = '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';

const FF_KNOWLEDGE = `
FANTASY FOOTBALL FUNDAMENTALS (apply to every answer):

SCORING FORMATS — always check league settings before advising:
- PPR (1pt per reception): elevates pass-catchers, WRs and pass-catching RBs/TEs worth more
- Half PPR (0.5pt): middle ground, still rewards volume receivers
- Standard (0pt): pure yardage/TD value, workhorse RBs most valuable
- 6pt passing TD leagues: QB value skyrockets vs 4pt leagues
- TE Premium: elevates TE value dramatically
- SuperFlex: 2nd QB is essential, QBs drafted earlier

IN-SEASON MANAGEMENT:
- Waiver wire is where championships are won — check every week
- Monitor injury reports: Wed/Thu/Fri practice designations
  - Out/IR: immediate replacement needed
  - Doubtful: treat as out
  - Questionable: check gameday inactives before lineup lock
- Analyze matchups weekly: soft run D = start RBs, soft pass D = start WRs/TEs
- Target share and snap count are leading indicators

MULTI-LEAGUE MANAGEMENT:
- Each league is INDEPENDENT — never compare players across leagues
- Valid cross-league insights: same injured player in multiple leagues, losing across multiple leagues, waiver target helping several rosters
- In leagues you're winning: prioritize floor/safe plays
- In leagues you're losing: target high-upside boom/bust options
`;

const BASE_SYSTEM = `You are AIOmni's AI Coach — the world's most intelligent fantasy football assistant.
You ALWAYS read league settings first before giving any advice. Be direct, confident, and specific.
Format responses concisely — this is a mobile chat interface.
Never compare players across different leagues — each league is scored independently.`;

// ── Types ──────────────────────────────────────────────────────
type LeagueContext = {
  name: string;
  platform: string;
  format: string;
  record: string;
  rank: string;
  roster: string[];
  week: number;
};

// ── Load Sleeper context ────────────────────────────────────────
async function loadSleeperContext(): Promise<LeagueContext[]> {
  try {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return [];

    const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
    const user    = await userRes.json();
    if (!user?.user_id) return [];

    const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2025`);
    const leagues    = await leaguesRes.json();
    if (!Array.isArray(leagues)) return [];

    const stateRes = await fetch('https://api.sleeper.app/v1/state/nfl');
    const state    = await stateRes.json();
    const week     = state.leg || state.display_week || state.week || 17;

    const playerMapRaw = await AsyncStorage.getItem('sleeper_player_map');
    const playerMap    = playerMapRaw ? JSON.parse(playerMapRaw) : {};

    return Promise.all(leagues.slice(0, 6).map(async (l: any): Promise<LeagueContext> => {
      const isPPR = l.scoring_settings?.rec > 0;
      const isSF  = (l.roster_positions || []).includes('SUPER_FLEX');
      const fmt   = `${isPPR ? (l.scoring_settings.rec >= 1 ? 'PPR' : '0.5 PPR') : 'STD'}${isSF ? ' · SuperFlex' : ''}`;

      try {
        const [rosters, matchups] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${l.league_id}/rosters`).then(r => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${l.league_id}/matchups/${week}`).then(r => r.json()),
        ]);

        const myRoster  = Array.isArray(rosters) ? rosters.find((r: any) => r.owner_id === user.user_id) : null;
        const wins      = myRoster?.settings?.wins   ?? 0;
        const losses    = myRoster?.settings?.losses ?? 0;
        const sorted    = Array.isArray(rosters) ? [...rosters].sort((a: any, b: any) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)) : [];
        const rankIdx   = sorted.findIndex((r: any) => r.roster_id === myRoster?.roster_id);
        const rankStr   = rankIdx >= 0 ? `${rankIdx + 1} of ${rosters.length}` : 'unknown';

        // Build roster names
        const playerIds: string[] = myRoster?.players ?? [];
        const rosterNames = playerIds.slice(0, 15).map((id: string) => {
          const p = playerMap[id];
          return p ? `${p.first_name} ${p.last_name} (${p.position})` : id;
        });

        return {
          name: l.name,
          platform: 'Sleeper',
          format: fmt,
          record: `${wins}–${losses}`,
          rank: rankStr,
          roster: rosterNames,
          week,
        };
      } catch {
        return { name: l.name, platform: 'Sleeper', format: fmt, record: '?', rank: '?', roster: [], week };
      }
    }));
  } catch (e) {
    console.log('loadSleeperContext error:', e);
    return [];
  }
}

// ── Load ESPN context ───────────────────────────────────────────
async function loadESPNContext(): Promise<LeagueContext[]> {
  try {
    const creds = await loadESPNCredentials();
    if (!creds?.leagueId) return [];

    const leagueData = await getESPNLeague(creds.leagueId, creds.espnS2, creds.swid);
    if (!leagueData) return [];

    const myTeam = findMyESPNTeam(leagueData, creds.teamName || '');

    const settings = leagueData.settings?.scoringSettings;
    const recPts   = settings?.REC ?? 0;
    const fmt      = recPts >= 1 ? 'PPR' : recPts >= 0.5 ? '0.5 PPR' : 'STD';

    const wins   = myTeam?.record?.overall?.wins   ?? 0;
    const losses = myTeam?.record?.overall?.losses ?? 0;
    const teams  = leagueData.teams ?? [];
    const sorted = [...teams].sort((a: any, b: any) => (b.record?.overall?.wins ?? 0) - (a.record?.overall?.wins ?? 0));
    const rankIdx = sorted.findIndex((t: any) => t.id === myTeam?.id);
    const rankStr = rankIdx >= 0 ? `${rankIdx + 1} of ${teams.length}` : 'unknown';
    const week    = leagueData.scoringPeriodId ?? 17;

    // Build roster from ESPN roster entries
    const rosterEntries = myTeam?.roster?.entries ?? [];
    const rosterNames: string[] = rosterEntries.slice(0, 15).map((entry: any) => {
      const player = entry.playerPoolEntry?.playerPoolEntry?.player ?? entry.playerPoolEntry?.player;
      const name   = player?.fullName ?? 'Unknown';
      const pos    = player?.defaultPositionId;
      const posMap: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
      return `${name} (${posMap[pos] ?? 'FLEX'})`;
    });

    return [{
      name: leagueData.settings?.name ?? 'ESPN League',
      platform: 'ESPN',
      format: fmt,
      record: `${wins}–${losses}`,
      rank: rankStr,
      roster: rosterNames,
      week,
    }];
  } catch (e) {
    console.log('loadESPNContext error:', e);
    return [];
  }
}

// ── Build dynamic system prompt ────────────────────────────────
function buildSystemPrompt(leagues: LeagueContext[]): string {
  if (leagues.length === 0) {
    return `${BASE_SYSTEM}\n\nNo leagues loaded yet. Ask the user to connect their Sleeper username or ESPN account in Settings.`;
  }

  const leagueBlocks = leagues.map(l => `
League: ${l.name} (${l.platform} · ${l.format})
Record: ${l.record} · Rank: ${l.rank} · Week: ${l.week}
Roster: ${l.roster.length > 0 ? l.roster.join(', ') : 'Not loaded'}
`).join('\n---\n');

  return `${BASE_SYSTEM}

You have loaded ${leagues.length} league${leagues.length > 1 ? 's' : ''}:

${leagueBlocks}

${FF_KNOWLEDGE}

When giving advice, ALWAYS specify which league you're referring to. Never give generic advice — reference the specific scoring format of the league in question.`;
}

// ── Claude API call ────────────────────────────────────────────
async function askClaude(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system:     systemPrompt,
        messages,
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text ?? 'Sorry, I had trouble with that. Try again.';
  } catch {
    return 'Connection error. Check your network and try again.';
  }
}

// ── Sub-components ─────────────────────────────────────────────
const VerdictCard: React.FC<{ text: string; color?: string }> = ({ text, color = C.sage }) => (
  <View style={[styles.verdict, { borderLeftColor: color, backgroundColor: color + '18' }]}>
    <Text style={[styles.verdictEye, { color }]}>VERDICT</Text>
    <Text style={styles.verdictTxt}>{text}</Text>
  </View>
);

const AddCard: React.FC<{ pos: string; name: string; team: string; detail: string }> = ({ pos, name, team, detail }) => (
  <View style={styles.addCard}>
    <PositionPill pos={pos} />
    <View style={{ flex: 1 }}>
      <Text style={styles.addName}>{name}</Text>
      <Text style={styles.addSub}>{team} · {detail}</Text>
    </View>
    <TouchableOpacity style={styles.addBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
      <Text style={styles.addBtnTxt}>+ADD</Text>
    </TouchableOpacity>
  </View>
);

type Message = { role: 'ai' | 'user'; text: string; isLoading?: boolean };

const QUICK_PROMPTS = ['🎯 Start/Sit', '📈 Best waiver', '⇄ Trade value', '📊 Matchup'];

const renderAIText = (text: string) => {
  const parts = text.split('\n');
  return parts.map((line, i) => {
    if (line.startsWith('__verdict__')) {
      return <VerdictCard key={i} text={line.replace('__verdict__', '')} />;
    }
    if (line.startsWith('__add__')) {
      const [, pos, name, team, detail] = line.split('|');
      return <AddCard key={i} pos={pos ?? 'WR'} name={name ?? ''} team={team ?? ''} detail={detail ?? ''} />;
    }
    if (line.startsWith('__')) {
      const cleaned = line.replace(/__[a-z]+__/g, '').replace(/__/g, '');
      return <Text key={i} style={styles.aiBold}>{cleaned}</Text>;
    }
    if (line === '') return <View key={i} style={{ height: 6 }} />;
    return <Text key={i} style={styles.aiTxt}>{line}</Text>;
  });
};

// ── Screen ─────────────────────────────────────────────────────
export default function CoachScreen() {
  const insets = useSafeAreaInsets();
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [leagueCount,  setLeagueCount]  = useState(0);
  const systemPromptRef = useRef<string>(BASE_SYSTEM);
  const scrollRef       = useRef<ScrollView>(null);

  // ── Load all league context on mount ─────────────────────────
  useEffect(() => {
    (async () => {
      const [sleeperLeagues, espnLeagues] = await Promise.all([
        loadSleeperContext(),
        loadESPNContext(),
      ]);
      const allLeagues = [...sleeperLeagues, ...espnLeagues];
      systemPromptRef.current = buildSystemPrompt(allLeagues);
      setLeagueCount(allLeagues.length);
      setContextReady(true);

      const platforms = [...new Set(allLeagues.map(l => l.platform))].join(' + ');
      const greeting  = allLeagues.length > 0
        ? `Hey — ${allLeagues.length} league${allLeagues.length > 1 ? 's' : ''} loaded (${platforms}). What do you need?`
        : `Hey — connect your Sleeper username or ESPN account in Settings to get started.`;

      setMessages([{ role: 'ai', text: greeting }]);
    })();
  }, []);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userMsg:    Message = { role: 'user', text };
    const loadingMsg: Message = { role: 'ai',   text: '', isLoading: true };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    const history = [...messages, userMsg]
      .filter(m => !m.isLoading)
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

    const reply = await askClaude(history, systemPromptRef.current);
    setMessages(prev => [...prev.slice(0, -1), { role: 'ai', text: reply }]);
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>

          {/* Header */}
          <View style={styles.hdr}>
            <OrbAvatar size={36} mode="breathe" glow="rgba(200,168,75,0.6)" />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>AI Coach</Text>
              <Text style={styles.subtitle}>
                {contextReady
                  ? `${leagueCount} LEAGUE${leagueCount !== 1 ? 'S' : ''} · PERSONALIZED`
                  : 'LOADING LEAGUES...'}
              </Text>
            </View>
            <View style={styles.liveDot}>
              <View style={[styles.livePulse, !contextReady && { backgroundColor: C.gold }]} />
              <Text style={[styles.liveTxt, !contextReady && { color: C.gold }]}>
                {contextReady ? 'LIVE' : 'SYNC'}
              </Text>
            </View>
          </View>

          {/* Quick prompts */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.promptScroll} contentContainerStyle={{ gap: 5 }}>
            {QUICK_PROMPTS.map(p => (
              <TouchableOpacity key={p} style={styles.promptChip} onPress={() => send(p)}>
                <Text style={styles.promptTxt}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 8, gap: 9 }}
            showsVerticalScrollIndicator={false}
          >
            {!contextReady && messages.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
                <ActivityIndicator color={C.gold} size="large" />
                <Text style={{ color: C.dim, fontFamily: F.mono, fontSize: SZ.sm }}>Loading your leagues...</Text>
              </View>
            )}
            {messages.map((m, i) => (
              m.role === 'user' ? (
                <View key={i} style={styles.userRow}>
                  <View style={styles.userBubble}>
                    <Text style={styles.userTxt}>{m.text}</Text>
                  </View>
                </View>
              ) : (
                <View key={i} style={styles.aiRow}>
                  <OrbAvatar size={22} mode="pulse" glow="rgba(200,168,75,0.6)" style={{ flexShrink: 0 }} />
                  <GlassCard style={{ maxWidth: '85%', flex: 1 }} padding={10} radius={14}>
                    {m.isLoading
                      ? <ActivityIndicator color={C.gold} size="small" />
                      : renderAIText(m.text)}
                  </GlassCard>
                </View>
              )
            ))}
          </ScrollView>

          {/* Input */}
          <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 4 }]}>
            <View style={styles.inputRow}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask about your leagues…"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnOff]}
                onPress={() => send(input)}
                disabled={!input.trim() || loading}
              >
                <Text style={styles.sendArrow}>↑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap:         { flex:1, paddingHorizontal:SP[3] },
  hdr:          { flexDirection:'row', alignItems:'center', gap:9, marginBottom:10 },
  title:        { fontSize:SZ.lg, fontWeight:'700', color:C.ink, fontFamily:F.bold },
  subtitle:     { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.dim, letterSpacing:0.8 },
  liveDot:      { flexDirection:'row', alignItems:'center', gap:4, backgroundColor:'rgba(130,196,148,0.18)', borderWidth:1, borderColor:'rgba(130,196,148,0.30)', borderRadius:20, paddingHorizontal:8, paddingVertical:3 },
  livePulse:    { width:5, height:5, borderRadius:3, backgroundColor:C.sage },
  liveTxt:      { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.sage, letterSpacing:1 },
  promptScroll: { maxHeight:36, marginBottom:10 },
  promptChip:   { paddingHorizontal:11, paddingVertical:5, borderRadius:20, backgroundColor:C.goldS, borderWidth:1, borderColor:C.goldBorder },
  promptTxt:    { fontSize:SZ.sm, color:C.gold, fontFamily:F.mono },
  aiRow:        { flexDirection:'row', gap:7, alignItems:'flex-start' },
  userRow:      { flexDirection:'row', justifyContent:'flex-end' },
  userBubble:   { backgroundColor:C.goldS, borderWidth:1, borderColor:C.goldBorder, borderRadius:14, borderTopRightRadius:3, padding:10, maxWidth:'80%' },
  userTxt:      { fontSize:SZ.md, color:C.ink, lineHeight:16, fontFamily:F.outfit },
  aiTxt:        { fontSize:SZ.md, color:C.ink, lineHeight:16, fontFamily:F.outfit },
  aiBold:       { fontSize:SZ.md, fontWeight:'700', color:C.sage, lineHeight:16, fontFamily:F.bold },
  verdict:      { borderLeftWidth:2, borderRadius:9, padding:8, marginTop:7 },
  verdictEye:   { fontSize:SZ.xs-2, fontFamily:F.mono, letterSpacing:1, marginBottom:2 },
  verdictTxt:   { fontSize:SZ.sm+1, fontWeight:'600', color:C.ink, fontFamily:F.semibold },
  addCard:      { flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'rgba(255,255,255,0.10)', borderWidth:1, borderColor:'rgba(255,255,255,0.15)', borderRadius:10, padding:8, marginTop:7 },
  addName:      { fontSize:SZ.md, fontWeight:'600', color:C.ink, fontFamily:F.semibold },
  addSub:       { fontSize:SZ.sm, fontFamily:F.mono, color:C.dim },
  addBtn:       { backgroundColor:C.sageS, borderWidth:1, borderColor:'rgba(130,196,148,0.30)', borderRadius:7, paddingHorizontal:8, paddingVertical:4 },
  addBtnTxt:    { fontSize:SZ.sm, fontWeight:'700', color:C.sage, fontFamily:F.mono },
  inputWrap:    { backgroundColor:'transparent', paddingTop:8 },
  inputRow:     { flexDirection:'row', alignItems:'center', gap:7, backgroundColor:'rgba(255,255,255,0.12)', borderWidth:1, borderColor:'rgba(255,255,255,0.20)', borderRadius:18, paddingLeft:13, paddingRight:4, paddingVertical:4 },
  input:        { flex:1, fontSize:SZ.md, color:C.ink, paddingVertical:8, fontFamily:F.outfit },
  sendBtn:      { width:34, height:34, backgroundColor:C.gold, borderRadius:10, alignItems:'center', justifyContent:'center' },
  sendBtnOff:   { backgroundColor:'rgba(200,168,75,0.25)' },
  sendArrow:    { fontSize:14, fontWeight:'700', color:'#2a2010', fontFamily:F.bold },
});