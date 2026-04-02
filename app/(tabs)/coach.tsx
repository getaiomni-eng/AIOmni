import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callClaude } from '../../services/api';
import { getPromptLimit, getUserTier } from '../../services/auth';
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { fetchAllLiveData, formatLiveDataForPrompt } from '../../services/liveData';
import { formatMemoriesForPrompt, loadAllMemories, saveMemory } from '../../services/memory';
import { PositionPill } from '../components/Atoms';
import { GlassCard } from '../components/GlassCard';
import { OrbAvatar } from '../components/OrbAvatar';
import { C, F, SP, SZ, textShadow } from '../constants/tokens';
import { getRemainingPrompts, getResetTime, incrementPrompt } from '../utils/promptCounter';

const WEEKLY_LIMIT = 25;

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

type LeagueContext = {
  name: string; platform: string; format: string;
  record: string; rank: string; roster: string[]; week: number;
};

function getPaywallMessage(resetStr: string): string {
  const now  = new Date();
  const day  = now.getDay();
  const hour = now.getHours();
  if (day === 3)              return `⚡ Waivers just ran — find out who to grab next with Pro.\n\nYou've used all ${WEEKLY_LIMIT} weekly prompts. Resets ${resetStr}.\n\n__verdict__Upgrade to Pro for unlimited prompts → getaiomni.com`;
  if (day === 0 && hour >= 11) return `🏈 Late games starting soon — don't make your flex decision blind.\n\nYou've used all ${WEEKLY_LIMIT} weekly prompts. Resets ${resetStr}.\n\n__verdict__Upgrade to Pro for unlimited prompts → getaiomni.com`;
  return `You've used all ${WEEKLY_LIMIT} weekly prompts. Resets ${resetStr}.\n\n__verdict__Upgrade to Pro for unlimited prompts → getaiomni.com`;
}

async function loadSleeperContext(): Promise<LeagueContext[]> {
  try {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return [];
    const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    if (!user?.user_id) return [];
    const leagues = await (await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2025`)).json();
    if (!Array.isArray(leagues)) return [];
    const state         = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
    const week          = state.leg || state.display_week || state.week || 17;
    const playerMapRaw  = await AsyncStorage.getItem('sleeper_player_map');
    const playerMap     = playerMapRaw ? JSON.parse(playerMapRaw) : {};
    return Promise.all(leagues.slice(0, 6).map(async (l: any): Promise<LeagueContext> => {
      const isPPR = l.scoring_settings?.rec > 0;
      const isSF  = (l.roster_positions || []).includes('SUPER_FLEX');
      const fmt   = `${isPPR ? (l.scoring_settings.rec >= 1 ? 'PPR' : '0.5 PPR') : 'STD'}${isSF ? ' · SuperFlex' : ''}`;
      try {
        const [rosters, matchups] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${l.league_id}/rosters`).then(r => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${l.league_id}/matchups/${week}`).then(r => r.json()),
        ]);
        const myRoster    = Array.isArray(rosters) ? rosters.find((r: any) => r.owner_id === user.user_id) : null;
        const wins        = myRoster?.settings?.wins   ?? 0;
        const losses      = myRoster?.settings?.losses ?? 0;
        const sorted      = Array.isArray(rosters) ? [...rosters].sort((a: any, b: any) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)) : [];
        const rankIdx     = sorted.findIndex((r: any) => r.roster_id === myRoster?.roster_id);
        const rosterNames = (myRoster?.players ?? []).slice(0, 15).map((id: string) => {
          const p = playerMap[id];
          return p ? `${p.first_name} ${p.last_name} (${p.position})` : id;
        });
        return { name: l.name, platform: 'Sleeper', format: fmt, record: `${wins}–${losses}`, rank: rankIdx >= 0 ? `${rankIdx + 1} of ${rosters.length}` : 'unknown', roster: rosterNames, week };
      } catch {
        return { name: l.name, platform: 'Sleeper', format: fmt, record: '?', rank: '?', roster: [], week };
      }
    }));
  } catch (e) { console.log('loadSleeperContext error:', e); return []; }
}

async function loadESPNContext(): Promise<LeagueContext[]> {
  try {
    const creds = await loadESPNCredentials();
    if (!creds?.leagueId) return [];
    const leagueData = await getESPNLeague(creds.leagueId, creds);
    if (!leagueData) return [];
    const myTeam   = findMyESPNTeam(leagueData, creds.teamName || '');
    const settings = leagueData.settings?.scoringSettings;
    const recPts   = settings?.REC ?? 0;
    const fmt      = recPts >= 1 ? 'PPR' : recPts >= 0.5 ? '0.5 PPR' : 'STD';
    const wins     = myTeam?.record?.overall?.wins   ?? 0;
    const losses   = myTeam?.record?.overall?.losses ?? 0;
    const teams    = leagueData.teams ?? [];
    const sorted   = [...teams].sort((a: any, b: any) => (b.record?.overall?.wins ?? 0) - (a.record?.overall?.wins ?? 0));
    const rankIdx  = sorted.findIndex((t: any) => t.id === myTeam?.id);
    const week     = leagueData.scoringPeriodId ?? 17;
    const rosterNames: string[] = (myTeam?.roster?.entries ?? []).slice(0, 15).map((entry: any) => {
      const player = entry.playerPoolEntry?.player;
      const posMap: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
      return `${player?.fullName ?? 'Unknown'} (${posMap[player?.defaultPositionId] ?? 'FLEX'})`;
    });
    return [{ name: leagueData.settings?.name ?? 'ESPN League', platform: 'ESPN', format: fmt, record: `${wins}–${losses}`, rank: rankIdx >= 0 ? `${rankIdx + 1} of ${teams.length}` : 'unknown', roster: rosterNames, week }];
  } catch (e) { console.log('loadESPNContext error:', e); return []; }
}

// Build system prompt — single league when one is selected, all leagues otherwise
function buildSystemPrompt(leagues: LeagueContext[], selectedLeague: LeagueContext | null): string {
  const targets = selectedLeague ? [selectedLeague] : leagues;
  if (targets.length === 0) return `${BASE_SYSTEM}\n\nNo leagues loaded yet. Ask the user to connect their Sleeper username or ESPN account in Settings.`;
  const leagueBlocks = targets.map(l => `
League: ${l.name} (${l.platform} · ${l.format})
Record: ${l.record} · Rank: ${l.rank} · Week: ${l.week}
Roster: ${l.roster.length > 0 ? l.roster.join(', ') : 'Not loaded'}
`).join('\n---\n');
  const focusNote = selectedLeague
    ? `\n\nThe user has focused on ONE league: ${selectedLeague.name}. All advice should be specific to this league's scoring format and roster.`
    : '';
  return `${BASE_SYSTEM}\n\nYou have loaded ${targets.length} league${targets.length > 1 ? 's' : ''}:\n${leagueBlocks}\n${FF_KNOWLEDGE}${focusNote}\n\nWhen giving advice, ALWAYS specify which league you're referring to. Never give generic advice — reference the specific scoring format of the league in question.`;
}

async function askClaude(messages: { role: string; content: string }[], systemPrompt: string): Promise<string> {
  return callClaude({ messages, system: systemPrompt, max_tokens: 1000 });
}

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

const PLATFORM_COLOR: Record<string, string> = {
  Sleeper: C.gold,
  ESPN:    '#FF4444',
  Yahoo:   '#6001D2',
};

type Message = { role: 'ai' | 'user'; text: string; isLoading?: boolean };
const QUICK_PROMPTS = ['🎯 Start/Sit', '📈 Best waiver', '⇄ Trade value', '📊 Matchup'];

const renderAIText = (text: string) => {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('__verdict__')) return <VerdictCard key={i} text={line.replace('__verdict__', '')} />;
    if (line.startsWith('__add__')) {
      const [, pos, name, team, detail] = line.split('|');
      return <AddCard key={i} pos={pos ?? 'WR'} name={name ?? ''} team={team ?? ''} detail={detail ?? ''} />;
    }
    if (line.startsWith('__')) return <Text key={i} style={styles.aiBold}>{line.replace(/__[a-z]+__/g, '').replace(/__/g, '')}</Text>;
    if (line === '') return <View key={i} style={{ height: 6 }} />;
    return <Text key={i} style={styles.aiTxt}>{line}</Text>;
  });
};

export default function CoachScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [contextReady,   setContextReady]   = useState(false);
  const [allLeagues,     setAllLeagues]     = useState<LeagueContext[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<LeagueContext | null>(null); // null = all leagues
  const [pickerVisible,  setPickerVisible]  = useState(false);
  const [remaining,      setRemaining]      = useState(WEEKLY_LIMIT);

  const systemPromptRef = useRef<string>(BASE_SYSTEM);
  const liveDataRef     = useRef<string>('');
  const scrollRef       = useRef<ScrollView>(null);

  useEffect(() => {
    (async () => {
      // Get tier-based prompt limit
      const tier      = await getUserTier();
      const limit     = getPromptLimit(tier);
      const rem       = await getRemainingPrompts();
      setRemaining(Math.min(rem, limit));

      const [sleeperLeagues, espnLeagues] = await Promise.all([loadSleeperContext(), loadESPNContext()]);
      const all      = [...sleeperLeagues, ...espnLeagues];
      const liveData = await fetchAllLiveData();

      // Load memories and inject into prompt
      const memories     = await loadAllMemories(tier);
      const memoryPrompt = formatMemoriesForPrompt(memories);

      liveDataRef.current     = formatLiveDataForPrompt(liveData);
      systemPromptRef.current = buildSystemPrompt(all, null) + liveDataRef.current + memoryPrompt;
      setAllLeagues(all);
      setContextReady(true);
      const platforms = [...new Set(all.map(l => l.platform))].join(' + ');
      const greeting  = all.length > 0
        ? `Hey — ${all.length} league${all.length > 1 ? 's' : ''} loaded (${platforms}). ${rem} of ${limit} prompts remaining this week. What do you need?`
        : `Hey — connect your Sleeper username or ESPN account in Settings to get started.`;
      setMessages([{ role: 'ai', text: greeting }]);
    })();
  }, []);

  // Rebuild system prompt whenever selected league changes
  useEffect(() => {
    if (allLeagues.length > 0) {
      systemPromptRef.current = buildSystemPrompt(allLeagues, selectedLeague) + liveDataRef.current;
    }
  }, [selectedLeague, allLeagues]);

  const selectLeague = (league: LeagueContext | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLeague(league);
    setPickerVisible(false);
    // Post a context switch message in the chat
    const label = league ? `${league.name} (${league.platform} · ${league.format})` : `all ${allLeagues.length} leagues`;
    setMessages(prev => [
      ...prev,
      { role: 'ai', text: `Got it — I'm now focused on ${label}. What do you need?` },
    ]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const rem = await getRemainingPrompts();
    if (rem <= 0) {
      const resetTime = await getResetTime();
      const resetStr  = resetTime ? resetTime.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Sunday noon';
      setMessages(prev => [...prev, { role: 'ai', text: getPaywallMessage(resetStr) }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await incrementPrompt();
    setRemaining(r => Math.max(0, r - 1));
    const userMsg:    Message = { role: 'user', text };
    const loadingMsg: Message = { role: 'ai',   text: '', isLoading: true };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    const history = [...messages, userMsg].filter(m => !m.isLoading).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
    const reply   = await askClaude(history, systemPromptRef.current);
    setMessages(prev => [...prev.slice(0, -1), { role: 'ai', text: reply }]);
    setLoading(false);

    // Save memory entry for Pro/Premium users
    const tier = await getUserTier();
    if (['pro','premium','dynasty_elite'].includes(tier) && selectedLeague) {
      const state = await fetch('https://api.sleeper.app/v1/state/nfl').then(r => r.json()).catch(() => ({}));
      saveMemory({
        leagueId:        selectedLeague.name,
        platform:        selectedLeague.platform,
        week:            state.display_week ?? 1,
        season:          2025,
        decisionType:    'start_sit',
        decisionSummary: text.slice(0, 120),
        outcome:         undefined,
      }).catch(() => {});
    }

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const promptColor    = remaining <= 5 ? '#c87878' : remaining <= 10 ? '#e8a84b' : '#82c494';
  const selectorLabel  = selectedLeague ? selectedLeague.name : `All Leagues`;
  const selectorSub    = selectedLeague ? `${selectedLeague.platform} · ${selectedLeague.format}` : `${allLeagues.length} LEAGUE${allLeagues.length !== 1 ? 'S' : ''} · PERSONALIZED`;
  const selectorColor  = selectedLeague ? (PLATFORM_COLOR[selectedLeague.platform] ?? C.gold) : C.gold;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>

          {/* ── Header ── */}
          <View style={styles.hdr}>
            <OrbAvatar size={36} mode="breathe" glow="rgba(254,226,41,0.6)" />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>AI Coach</Text>
              <Text style={styles.subtitle}>
                {contextReady ? selectorSub : 'LOADING LEAGUES...'}
              </Text>
            </View>
            <View style={styles.rightHdr}>
              <View style={[styles.promptCounter, { borderColor: promptColor + '40', backgroundColor: promptColor + '15' }]}>
                <Text style={[styles.promptCountNum, { color: promptColor }]}>{remaining}</Text>
                <Text style={[styles.promptCountLbl, { color: promptColor }]}>/{WEEKLY_LIMIT}</Text>
              </View>
              <View style={styles.liveDot}>
                <View style={[styles.livePulse, !contextReady && { backgroundColor: C.gold }]} />
                <Text style={[styles.liveTxt, !contextReady && { color: C.gold }]}>{contextReady ? 'LIVE' : 'SYNC'}</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/settings')} style={styles.gearBtn}>
                <Ionicons name="settings-sharp" size={20} color={C.dim2} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── League Selector ── */}
          {contextReady && allLeagues.length > 0 && (
            <TouchableOpacity
              style={[styles.leaguePicker, { borderColor: selectorColor + '40', backgroundColor: selectorColor + '12' }]}
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.75}
            >
              <View style={[styles.leaguePickerDot, { backgroundColor: selectorColor }]} />
              <Text style={[styles.leaguePickerLabel, { color: selectorColor }]} numberOfLines={1}>
                {selectorLabel}
              </Text>
              <Ionicons name="chevron-down" size={14} color={selectorColor} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          )}

          {/* ── Quick Prompts ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.promptScroll} contentContainerStyle={{ gap: 5 }}>
            {QUICK_PROMPTS.map(p => (
              <TouchableOpacity key={p} style={styles.promptChip} onPress={() => send(p)}>
                <Text style={styles.promptTxt}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Messages ── */}
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8, gap: 9 }} showsVerticalScrollIndicator={false}>
            {!contextReady && messages.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
                <ActivityIndicator color={C.gold} size="large" />
                <Text style={styles.loadingSub}>Loading your leagues...</Text>
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
                  <OrbAvatar size={22} mode="pulse" glow="rgba(254,226,41,0.6)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <GlassCard style={{ maxWidth: '85%' }} padding={10} radius={14}>
                    {m.isLoading
                      ? <ActivityIndicator color={C.gold} size="small" />
                      : renderAIText(m.text)
                    }
                  </GlassCard>
                </View>
              )
            ))}
          </ScrollView>

          {/* ── Input ── */}
          <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 4 }]}>
            <View style={styles.inputRow}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={remaining > 0 ? 'Ask about your leagues…' : 'Upgrade to Pro for unlimited prompts'}
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                editable={remaining > 0}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!input.trim() || loading || remaining <= 0) && styles.sendBtnOff]}
                onPress={() => send(input)}
                disabled={!input.trim() || loading || remaining <= 0}
              >
                <Text style={styles.sendArrow}>↑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ── League Picker Modal ── */}
      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setPickerVisible(false)}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>FOCUS ON A LEAGUE</Text>
            <Text style={styles.pickerSub}>AI advice will be tailored to the selected league's roster and scoring format.</Text>

            {/* All Leagues option */}
            <TouchableOpacity
              style={[styles.pickerRow, !selectedLeague && styles.pickerRowActive]}
              onPress={() => selectLeague(null)}
            >
              <View style={[styles.pickerDot, { backgroundColor: C.gold }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickerRowLabel, !selectedLeague && { color: C.gold }]}>All Leagues</Text>
                <Text style={styles.pickerRowSub}>{allLeagues.length} leagues · Cross-league insights</Text>
              </View>
              {!selectedLeague && <Ionicons name="checkmark" size={18} color={C.gold} />}
            </TouchableOpacity>

            <View style={styles.pickerDivider} />

            {/* Individual leagues */}
            {allLeagues.map((lg, i) => {
              const isActive = selectedLeague?.name === lg.name && selectedLeague?.platform === lg.platform;
              const color    = PLATFORM_COLOR[lg.platform] ?? C.gold;
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.pickerRow, isActive && styles.pickerRowActive]}
                  onPress={() => selectLeague(lg)}
                >
                  <View style={[styles.pickerDot, { backgroundColor: color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pickerRowLabel, isActive && { color }]} numberOfLines={1}>{lg.name}</Text>
                    <Text style={styles.pickerRowSub}>{lg.platform} · {lg.format} · {lg.record} · Rank {lg.rank}</Text>
                  </View>
                  {isActive && <Ionicons name="checkmark" size={18} color={color} />}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={styles.pickerClose} onPress={() => setPickerVisible(false)}>
              <Text style={styles.pickerCloseTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap:  { flex: 1, paddingHorizontal: SP[3] },
  hdr:   { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  title: { fontSize: SZ.xl, fontWeight: '700', color: C.ink, fontFamily: F.bold, ...textShadow.hero },
  subtitle: { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, letterSpacing: 0.8, ...textShadow.subtle },
  rightHdr: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gearBtn:  { padding: 4 },

  promptCounter:  { flexDirection: 'row', alignItems: 'baseline', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  promptCountNum: { fontSize: SZ.sm, fontWeight: '700', fontFamily: F.bold, ...textShadow.body },
  promptCountLbl: { fontSize: SZ.xs - 1, fontFamily: F.mono, opacity: 0.7, ...textShadow.subtle },
  liveDot:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(130,196,148,0.18)', borderWidth: 1, borderColor: 'rgba(130,196,148,0.30)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  livePulse:      { width: 5, height: 5, borderRadius: 3, backgroundColor: C.sage },
  liveTxt:        { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.sage, letterSpacing: 1, ...textShadow.subtle },

  leaguePicker:      { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10, maxWidth: '70%' },
  leaguePickerDot:   { width: 6, height: 6, borderRadius: 3 },
  leaguePickerLabel: { fontFamily: F.mono, fontSize: SZ.xs, letterSpacing: 0.8, fontWeight: '700', flex: 1 },

  promptScroll: { maxHeight: 36, marginBottom: 10 },
  promptChip:   { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, backgroundColor: C.goldS, borderWidth: 1, borderColor: C.goldBorder },
  promptTxt:    { fontSize: SZ.sm, color: C.gold, fontFamily: F.mono, ...textShadow.gold },

  loadingSub:  { color: C.dim, fontFamily: F.mono, fontSize: SZ.sm, ...textShadow.subtle },
  aiRow:       { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  userRow:     { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble:  { backgroundColor: C.goldS, borderWidth: 1, borderColor: C.goldBorder, borderRadius: 14, borderTopRightRadius: 3, padding: 10, maxWidth: '80%' },
  userTxt:     { fontSize: SZ.md, color: C.ink, lineHeight: 20, fontFamily: F.outfit, ...textShadow.body },
  aiTxt:       { fontSize: SZ.md, color: C.ink, lineHeight: 20, fontFamily: F.outfit, ...textShadow.body },
  aiBold:      { fontSize: SZ.md, fontWeight: '700', color: C.sage, lineHeight: 20, fontFamily: F.bold, ...textShadow.body },

  verdict:    { borderLeftWidth: 2, borderRadius: 9, padding: 8, marginTop: 7 },
  verdictEye: { fontSize: SZ.xs - 2, fontFamily: F.mono, letterSpacing: 1, marginBottom: 2, ...textShadow.subtle },
  verdictTxt: { fontSize: SZ.sm + 1, fontWeight: '600', color: C.ink, fontFamily: F.semibold, ...textShadow.body },

  addCard:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: 8, marginTop: 7 },
  addName:   { fontSize: SZ.md, fontWeight: '600', color: C.ink, fontFamily: F.semibold, ...textShadow.body },
  addSub:    { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, ...textShadow.subtle },
  addBtn:    { backgroundColor: C.sageS, borderWidth: 1, borderColor: 'rgba(130,196,148,0.30)', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  addBtnTxt: { fontSize: SZ.sm, fontWeight: '700', color: C.sage, fontFamily: F.mono, ...textShadow.subtle },

  inputWrap: { backgroundColor: 'transparent', paddingTop: 8 },
  inputRow:  { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)', borderRadius: 18, paddingLeft: 13, paddingRight: 4, paddingVertical: 4 },
  input:     { flex: 1, fontSize: SZ.md, color: C.ink, paddingVertical: 8, fontFamily: F.outfit, ...textShadow.body },
  sendBtn:   { width: 34, height: 34, backgroundColor: C.gold, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff:{ backgroundColor: 'rgba(254,226,41,0.25)' },
  sendArrow: { fontSize: 14, fontWeight: '700', color: '#2a2010', fontFamily: F.bold },

  pickerOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerSheet:     { backgroundColor: '#243030', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingBottom: 32, paddingHorizontal: 20, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  pickerHandle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 20 },
  pickerTitle:     { fontFamily: F.mono, color: C.gold, fontSize: SZ.sm, letterSpacing: 2, marginBottom: 6 },
  pickerSub:       { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.sm, lineHeight: 18, marginBottom: 16 },
  pickerDivider:   { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 8 },
  pickerRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4 },
  pickerRowActive: { backgroundColor: 'rgba(255,255,255,0.07)' },
  pickerDot:       { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  pickerRowLabel:  { fontFamily: F.bold, color: C.ink, fontSize: SZ.base },
  pickerRowSub:    { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, marginTop: 2, letterSpacing: 0.4 },
  pickerClose:     { marginTop: 12, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  pickerCloseTxt:  { fontFamily: F.mono, color: C.dim2, fontSize: SZ.sm, letterSpacing: 1.5 },
});