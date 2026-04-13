import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../../services/ai';
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { fetchAllLiveData, formatLiveDataForPrompt } from '../../services/liveData';
import { getCurrentTier } from '../../services/purchases';
import { getMemories, saveMemory } from '../../services/supabase';
import { getPlayerContext } from '../../services/playerIntelligence';
import { PositionPill } from '../components/Atoms';
import { AIOmniLogo } from '../components/AIOmniLogo';
import { C, F, R, SP, SZ } from '../constants/tokens';
import { getRemainingPrompts, getResetTime, incrementPrompt } from '../utils/promptCounter';

const WEEKLY_LIMIT = 25;
const BORDER   = '#1a3542';
const BEVEL_HI = '#12252e';

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
- Analyze matchups weekly: soft run D = start RBs, soft pass D = start WRs/TEs
- Target share and snap count are leading indicators
MULTI-LEAGUE MANAGEMENT:
- Each league is INDEPENDENT — never compare players across leagues
- In leagues you're winning: prioritize floor/safe plays
- In leagues you're losing: target high-upside boom/bust options
`;

const BASE_SYSTEM = `You are AIOmni's AI Coach — the world's most intelligent fantasy football assistant.
You ALWAYS read league settings first before giving any advice. Be direct, confident, and specific.
Format responses concisely — this is a mobile chat interface.
Never compare players across different leagues — each league is scored independently.`;

type LeagueContext = {
  name: string; platform: string; format: string;
  record: string; rank: string; roster: string[]; week: number; season: number;
};

function getPaywallMessage(resetStr: string): string {
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
    const state        = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
    const week         = state.leg || state.display_week || 17;
    let playerMap: Record<string, any> = {};
    const cached = await AsyncStorage.getItem('sleeper_players_cache');
    if (cached) {
      playerMap = JSON.parse(cached);
    } else {
      try {
        const res = await fetch('https://api.sleeper.app/v1/players/nfl');
        playerMap = await res.json();
        await AsyncStorage.setItem('sleeper_players_cache', JSON.stringify(playerMap));
      } catch { console.log('Failed to fetch Sleeper players'); }
    }
    return Promise.all(leagues.slice(0, 6).map(async (l: any): Promise<LeagueContext> => {
      const isPPR = l.scoring_settings?.rec > 0;
      const isSF  = (l.roster_positions || []).includes('SUPER_FLEX');
      const fmt   = `${isPPR ? (l.scoring_settings.rec >= 1 ? 'PPR' : '0.5 PPR') : 'STD'}${isSF ? ' · SuperFlex' : ''}`;
      try {
        const rosters = await fetch(`https://api.sleeper.app/v1/league/${l.league_id}/rosters`).then(r => r.json());
        const myRoster    = Array.isArray(rosters) ? rosters.find((r: any) => r.owner_id === user.user_id) : null;
        const wins        = myRoster?.settings?.wins   ?? 0;
        const losses      = myRoster?.settings?.losses ?? 0;
        const sorted      = Array.isArray(rosters) ? [...rosters].sort((a: any, b: any) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)) : [];
        const rankIdx     = sorted.findIndex((r: any) => r.roster_id === myRoster?.roster_id);
        const rosterNames = (myRoster?.players ?? []).slice(0, 15).map((id: string) => {
          const p = playerMap[id];
          return p ? `${p.first_name} ${p.last_name} (${p.position})` : id;
        });
        return { name: l.name, platform: 'Sleeper', format: fmt, record: `${wins}–${losses}`, rank: rankIdx >= 0 ? `${rankIdx + 1} of ${rosters.length}` : 'unknown', roster: rosterNames, week, season: parseInt(l.season) || 2025 };
      } catch {
        return { name: l.name, platform: 'Sleeper', format: fmt, record: '?', rank: '?', roster: [], week, season: parseInt(l.season) || 2025 };
      }
    }));
  } catch { return []; }
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
      const posMap: Record<number, string> = { 1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'DEF' };
      return `${player?.fullName ?? 'Unknown'} (${posMap[player?.defaultPositionId] ?? 'FLEX'})`;
    });
    return [{ name: leagueData.settings?.name ?? 'ESPN League', platform: 'ESPN', format: fmt, record: `${wins}–${losses}`, rank: rankIdx >= 0 ? `${rankIdx + 1} of ${teams.length}` : 'unknown', roster: rosterNames, week, season: 2025 }];
  } catch { return []; }
}

function buildSystemPrompt(leagues: LeagueContext[], selectedLeague: LeagueContext | null, memories: string): string {
  const targets = selectedLeague ? [selectedLeague] : leagues;
  if (targets.length === 0) return `${BASE_SYSTEM}\n\nNo leagues loaded yet.`;
  const leagueBlocks = targets.map(l => `
League: ${l.name} (${l.platform} · ${l.format})
Record: ${l.record} · Rank: ${l.rank} · Season: ${l.season} · Week: ${l.week}
Roster: ${l.roster.length > 0 ? l.roster.join(', ') : 'Not loaded'}
`).join('\n---\n');
  const focusNote  = selectedLeague ? `\n\nThe user has focused on ONE league: ${selectedLeague.name}. All advice should be specific to this league's scoring format and roster.` : '';
  const memoryBlock = memories ? `\n\nPAST DECISIONS (use for context, don't repeat):\n${memories}` : '';
  return `${BASE_SYSTEM}\n\nYou have loaded ${targets.length} league${targets.length > 1 ? 's' : ''}:\n${leagueBlocks}\n${FF_KNOWLEDGE}${focusNote}${memoryBlock}`;
}

// ── Verdict card (blue) ─────────────────────────────────────
const VerdictCard: React.FC<{ text: string; color?: string }> = ({ text, color = C.mint }) => (
  <View style={[styles.verdict, { borderLeftColor: color, backgroundColor: color + '18' }]}>
    <Text style={[styles.verdictEye, { color }]}>VERDICT</Text>
    <Text style={styles.verdictTxt}>{text}</Text>
  </View>
);

// ── Recommendation card (blue bevel — matches mockup) ───────
const RecoCard: React.FC<{ emoji: string; title: string; body: string }> = ({ emoji, title, body }) => (
  <View style={styles.recoCard}>
    <View style={styles.bevelShine} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 }}>
      <Text style={{ fontSize: 14 }}>{emoji}</Text>
      <Text style={styles.recoTitle}>{title}</Text>
    </View>
    <Text style={styles.recoBody}>{body}</Text>
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
  Sleeper: C.gold, ESPN: '#e03030', Yahoo: '#6001D2',
};

type Message = { role: 'ai' | 'user'; text: string; isLoading?: boolean };
const QUICK_PROMPTS = ['Start/Sit', 'Best waiver', 'Trade value', 'Matchup'];

const renderAIText = (text: string) =>
  text.split('\n').map((line, i) => {
    if (line.startsWith('__verdict__')) return <VerdictCard key={i} text={line.replace('__verdict__', '')} />;
    if (line.startsWith('__reco__')) {
      const parts = line.replace('__reco__', '').split('|');
      return <RecoCard key={i} emoji={parts[0] ?? '⚡'} title={parts[1] ?? ''} body={parts[2] ?? ''} />;
    }
    if (line.startsWith('__add__')) {
      const [, pos, name, team, detail] = line.split('|');
      return <AddCard key={i} pos={pos ?? 'WR'} name={name ?? ''} team={team ?? ''} detail={detail ?? ''} />;
    }
    if (line.startsWith('__')) return <Text key={i} style={styles.aiBold}>{line.replace(/__[a-z]+__/g, '').replace(/__/g, '')}</Text>;
    if (line === '') return <View key={i} style={{ height: 6 }} />;
    return <Text key={i} style={styles.aiTxt}>{line}</Text>;
  });

export default function CoachScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [contextReady,   setContextReady]   = useState(false);
  const [allLeagues,     setAllLeagues]     = useState<LeagueContext[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<LeagueContext | null>(null);
  const [pickerVisible,  setPickerVisible]  = useState(false);
  const [remaining,      setRemaining]      = useState(WEEKLY_LIMIT);
  const [tier,           setTier]           = useState('free');

  const systemPromptRef = useRef<string>(BASE_SYSTEM);
  const liveDataRef     = useRef<string>('');
  const memoriesRef     = useRef<string>('');
  const scrollRef       = useRef<ScrollView>(null);

  useEffect(() => {
    (async () => {
      const [currentTier, rem] = await Promise.all([getCurrentTier(), getRemainingPrompts()]);
      setTier(currentTier);
      setRemaining(rem);

      const [sleeperLeagues, espnLeagues, liveData] = await Promise.all([
        loadSleeperContext(), loadESPNContext(), fetchAllLiveData(),
      ]);
      const all = [...sleeperLeagues, ...espnLeagues];

      try {
        const leagueId = all[0]?.name ?? 'general';
        const mems = await getMemories(leagueId, 10);
        if (mems.length > 0) {
          memoriesRef.current = mems.map((m: any) => `[${m.tagged_date}] ${m.content}`).join('\n');
        }
      } catch {}

      liveDataRef.current     = formatLiveDataForPrompt(liveData);
      systemPromptRef.current = buildSystemPrompt(all, null, memoriesRef.current) + liveDataRef.current;
      setAllLeagues(all);
      setContextReady(true);

      const limitNum = currentTier === 'dynasty_elite' ? Infinity : currentTier === 'premium' ? 125 : currentTier === 'pro' ? 75 : 25;
      const limit = limitNum;
      const greeting = all.length > 0
        ? `Hey — ${all.length} league${all.length > 1 ? 's' : ''} loaded. ${limitNum === Infinity ? '∞' : rem + ' of ' + limitNum} prompts remaining this week. What do you need?`
        : `Hey — connect your Sleeper username or ESPN account in Settings to get started.`;
      setMessages([{ role: 'ai', text: greeting }]);
    })();
  }, []);

  useEffect(() => {
    if (allLeagues.length > 0) {
      systemPromptRef.current = buildSystemPrompt(allLeagues, selectedLeague, memoriesRef.current) + liveDataRef.current;
    }
  }, [selectedLeague, allLeagues]);

  const selectLeague = (league: LeagueContext | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLeague(league);
    setPickerVisible(false);
    const label = league ? `${league.name} (${league.platform} · ${league.format})` : `all ${allLeagues.length} leagues`;
    setMessages(prev => [...prev, { role: 'ai', text: `Got it — focused on ${label}. What do you need?` }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const rem = await getRemainingPrompts();
    if (rem <= 0) {
      const resetTime = await getResetTime();
      const resetStr  = resetTime
        ? resetTime.toLocaleString('en-US', { weekday:'short', hour:'numeric', minute:'2-digit' })
        : 'Sunday noon';
      setMessages(prev => [...prev, { role:'ai', text: getPaywallMessage(resetStr) }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await incrementPrompt();
    setRemaining(r => Math.max(0, r - 1));

    const userMsg:    Message = { role:'user', text };
    const loadingMsg: Message = { role:'ai',   text:'', isLoading:true };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const history = [...messages, userMsg]
        .filter(m => !m.isLoading)
        .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

      // ── Player Intelligence injection ────────────────────
      let playerContext = '';
      try { playerContext = await getPlayerContext(text); } catch {}

      const fullPrompt = [
        systemPromptRef.current,
        playerContext ? `\nPLAYER INTELLIGENCE FROM DATABASE:\n${playerContext}` : '',
        `\nConversation history:\n${history.slice(-6).map(h => `${h.role}: ${h.content}`).join('\n')}`,
        `\nuser: ${text}`,
      ].filter(Boolean).join('\n');

      const reply = await askAI(fullPrompt, 1000);
      setMessages(prev => [...prev.slice(0, -1), { role:'ai', text: reply }]);

      if (['pro','premium','dynasty_elite'].includes(tier) && selectedLeague) {
        try {
          await saveMemory({
            leagueId: selectedLeague.name,
            platform: selectedLeague.platform,
            content:  `Q: ${text.slice(0, 100)} | A: ${reply.slice(0, 200)}`,
          });
        } catch {}
      }
    } catch (e: any) {
      const errMsg = e?.message?.includes('prompt_limit_reached')
        ? "You've hit your weekly prompt limit. Upgrade to Pro for unlimited prompts."
        : 'Connection error. Try again.';
      setMessages(prev => [...prev.slice(0, -1), { role:'ai', text: errMsg }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const promptColor   = remaining <= 5 ? '#a83040' : remaining <= 10 ? C.amber : C.mint;
  const selectorLabel = selectedLeague ? selectedLeague.name : 'All Leagues';
  const selectorSub   = selectedLeague
    ? `${selectedLeague.platform} · ${selectedLeague.format}`
    : `${allLeagues.length} LEAGUE${allLeagues.length !== 1 ? 'S' : ''} · PERSONALIZED`;
  const selectorColor = selectedLeague ? (PLATFORM_COLOR[selectedLeague.platform] ?? C.gold) : C.gold;

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>

          {/* ── Header — matches mockup ── */}
          <View style={styles.hdr}>
            {/* Mini logo avatar */}
            <View style={styles.logoAvatar}>
              <AIOmniLogo width={48} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>AI Coach</Text>
              <Text style={styles.subtitle}>{contextReady ? selectorSub : 'LOADING LEAGUES...'}</Text>
            </View>
            <View style={styles.rightHdr}>
              <View style={[styles.promptCounter, { borderColor: promptColor + '55', backgroundColor: promptColor + '12' }]}>
                <Text style={[styles.promptCountNum, { color: promptColor }]}>{remaining > 900 ? '∞' : remaining}</Text>
                <Text style={[styles.promptCountLbl, { color: promptColor }]}>{remaining > 900 ? '' : '/' + WEEKLY_LIMIT}</Text>
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

          {/* ── League selector ── */}
          {contextReady && allLeagues.length > 0 && (
            <TouchableOpacity
              style={[styles.leaguePicker, { borderColor: selectorColor + '55', backgroundColor: selectorColor + '12' }]}
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.75}
            >
              <View style={[styles.leaguePickerDot, { backgroundColor: selectorColor }]} />
              <Text style={[styles.leaguePickerLabel, { color: selectorColor }]} numberOfLines={1}>{selectorLabel}</Text>
              <Ionicons name="chevron-down" size={14} color={selectorColor} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          )}

          {/* ── Quick prompts ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.promptScroll} contentContainerStyle={{ gap: 5 }}>
            {QUICK_PROMPTS.map(p => (
              <TouchableOpacity key={p} style={styles.promptChip} onPress={() => send(p)}>
                <Text style={styles.promptTxt}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Messages ── */}
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8, gap: 10 }} showsVerticalScrollIndicator={false}>
            {!contextReady && messages.length === 0 && (
              <View style={{ alignItems:'center', paddingVertical:40, gap:10 }}>
                <ActivityIndicator color={C.blueDeep} size="large" />
                <Text style={styles.loadingSub}>Loading your leagues...</Text>
              </View>
            )}
            {messages.map((m, i) => (
              m.role === 'user' ? (
                // User bubble — gold card (matches mockup)
                <View key={i} style={styles.userRow}>
                  <View style={styles.userBubble}>
                    <View style={styles.userBubbleShine} />
                    <Text style={styles.userTxt}>{m.text}</Text>
                  </View>
                </View>
              ) : (
                // AI bubble — cream bevel card (matches mockup)
                <View key={i} style={styles.aiRow}>
                  <View style={styles.aiBubbleAvatar}>
                    <Text style={{ fontSize: 12 }}>◎</Text>
                  </View>
                  <View style={[styles.aiBubble, { maxWidth: '85%' }]}>
                    <View style={styles.bevelShine} />
                    {m.isLoading ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 4 }}>
                        <ActivityIndicator color={C.blueDeep} size="small" />
                        <Text style={[styles.aiTxt, { color: C.dim2 }]}>Analyzing...</Text>
                      </View>
                    ) : renderAIText(m.text)}
                  </View>
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
                placeholderTextColor={C.dim2}
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
            <View style={styles.pickerShineBar} />
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>FOCUS ON A LEAGUE</Text>
            <Text style={styles.pickerSub}>AI advice will be tailored to the selected league's roster and scoring format.</Text>

            <TouchableOpacity style={[styles.pickerRow, !selectedLeague && styles.pickerRowActive]} onPress={() => selectLeague(null)}>
              <View style={[styles.pickerDot, { backgroundColor: C.gold }]} />
              <View style={{ flex:1 }}>
                <Text style={[styles.pickerRowLabel, !selectedLeague && { color: C.gold }]}>All Leagues</Text>
                <Text style={styles.pickerRowSub}>{allLeagues.length} leagues · Cross-league insights</Text>
              </View>
              {!selectedLeague && <Ionicons name="checkmark" size={18} color={C.gold} />}
            </TouchableOpacity>

            <View style={styles.pickerDivider} />

            {allLeagues.map((lg, i) => {
              const isActive = selectedLeague?.name === lg.name && selectedLeague?.platform === lg.platform;
              const color    = PLATFORM_COLOR[lg.platform] ?? C.gold;
              return (
                <TouchableOpacity key={i} style={[styles.pickerRow, isActive && styles.pickerRowActive]} onPress={() => selectLeague(lg)}>
                  <View style={[styles.pickerDot, { backgroundColor: color }]} />
                  <View style={{ flex:1 }}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { flex:1, paddingHorizontal: SP[3] },

  // Header
  hdr:      { flexDirection:'row', alignItems:'center', gap:10, marginBottom:10 },
  logoAvatar: { width:44, height:44, borderRadius:12, backgroundColor: C.goldS, borderWidth:1.5, borderColor: C.goldBorder, alignItems:'center', justifyContent:'center', overflow:'hidden' },
  title:    { fontSize:SZ.xl, fontFamily:F.bold, color:'#f0f4f5' },
  subtitle: { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.dim2, letterSpacing:0.8 },
  rightHdr: { flexDirection:'row', alignItems:'center', gap:6 },
  gearBtn:  { padding:4 },

  promptCounter:  { flexDirection:'row', alignItems:'baseline', borderRadius:20, paddingHorizontal:8, paddingVertical:3, borderWidth:1.5 },
  promptCountNum: { fontSize:SZ.sm, fontFamily:F.bold },
  promptCountLbl: { fontSize:SZ.xs-1, fontFamily:F.mono, opacity:0.7 },
  liveDot:  { flexDirection:'row', alignItems:'center', gap:4, backgroundColor:'rgba(30,140,66,0.12)', borderWidth:1, borderColor:'rgba(30,140,66,0.3)', borderRadius:20, paddingHorizontal:8, paddingVertical:3 },
  livePulse:{ width:5, height:5, borderRadius:3, backgroundColor:C.mint },
  liveTxt:  { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.mint, letterSpacing:1 },

  leaguePicker:     { flexDirection:'row', alignItems:'center', alignSelf:'flex-start', gap:6, borderWidth:1.5, borderRadius:20, paddingHorizontal:12, paddingVertical:6, marginBottom:10, maxWidth:'70%' },
  leaguePickerDot:  { width:6, height:6, borderRadius:3 },
  leaguePickerLabel:{ fontFamily:F.mono, fontSize:SZ.xs, letterSpacing:0.8, fontWeight:'700', flex:1 },

  promptScroll: { maxHeight:36, marginBottom:10 },
  promptChip:   { paddingHorizontal:11, paddingVertical:5, borderRadius:20, backgroundColor:C.goldS, borderWidth:1.5, borderColor:C.goldBorder },
  promptTxt:    { fontSize:SZ.sm, color:C.blueDeep, fontFamily:F.mono },

  loadingSub: { color:C.dim2, fontFamily:F.mono, fontSize:SZ.sm },

  // AI bubble — cream bevel (matches mockup card system)
  aiRow:   { flexDirection:'row', gap:8, alignItems:'flex-start' },
  aiBubbleAvatar: {
    width:30, height:30, borderRadius:9,
    backgroundColor: C.goldS, borderWidth:1.5, borderColor: C.goldBorder,
    alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2,
  },
  aiBubble: {
    backgroundColor: '#12252e',
    borderWidth: 1.5,
    borderColor: '#1a3542',
    borderTopColor: '#12252e',
    
    
    
    borderRadius: 14,
    borderTopLeftRadius: 4,
    padding: 11,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#1be7ff',
    shadowOffset: { width:0, height:2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  bevelShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },

  // User bubble — gold card (matches mockup)
  userRow:    { flexDirection:'row', justifyContent:'flex-end' },
  userBubble: {
    backgroundColor: '#ffb800',
    borderWidth: 1,
    borderColor: 'rgba(255,184,0,0.4)',
    borderTopColor: '#12252e',
    borderLeftColor: 'rgba(255,255,255,0.7)',
    borderBottomColor: '#1a3542',
    borderRightColor: '#1a3542',
    borderRadius: 14,
    borderTopRightRadius: 4,
    padding: 11,
    maxWidth: '80%',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width:0, height:3 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  userBubbleShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:'#1a3542', zIndex:6 },
  userTxt:    { fontSize:SZ.md, color:'#0a1214', lineHeight:20, fontFamily:F.body },

  aiTxt:    { fontSize:SZ.md, color:'#f0f4f5', lineHeight:20, fontFamily:F.outfit },
  aiBold:   { fontSize:SZ.md, fontFamily:F.semibold, color:'#1be7ff', lineHeight:20 },

  // Verdict card
  verdict:    { borderLeftWidth:2, borderRadius:9, padding:9, marginTop:7 },
  verdictEye: { fontSize:SZ.xs-2, fontFamily:F.mono, letterSpacing:1, marginBottom:2 },
  verdictTxt: { fontSize:SZ.sm+1, fontFamily:F.semibold, color:'#f0f4f5' },

  // Recommendation card — blue (matches mockup)
  recoCard: {
    backgroundColor: '#0f1c22',
    borderRadius: 12,
    borderTopLeftRadius: 4,
    padding: 11,
    marginTop: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    borderTopColor: '#0f1c22',
    borderBottomColor: 'rgba(20,45,100,0.5)',
    shadowColor: '#1be7ff',
    shadowOffset: { width:0, height:4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  recoTitle: { fontSize:SZ.sm, fontFamily:F.bold, color:'#ffb800', letterSpacing:0.5 },
  recoBody:  { fontSize:SZ.sm, fontFamily:F.outfit, color:'#7a9eaa', lineHeight:18, marginTop:2 },

  // Add player card
  addCard:   { flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#12252e', borderWidth:1.5, borderColor:BORDER, borderRadius:10, padding:8, marginTop:7 },
  addName:   { fontSize:SZ.md, fontFamily:F.bold, color:'#f0f4f5' },
  addSub:    { fontSize:SZ.sm, fontFamily:F.mono, color:C.dim2 },
  addBtn:    { backgroundColor:C.sageS, borderWidth:1.5, borderColor:C.sageBorder, borderRadius:7, paddingHorizontal:8, paddingVertical:4 },
  addBtnTxt: { fontSize:SZ.sm, fontFamily:F.mono, color:C.blueDeep, fontWeight:'700' },

  // Input
  inputWrap: { paddingTop:8 },
  inputRow:  { flexDirection:'row', alignItems:'center', gap:7, backgroundColor:'#12252e', borderWidth:1.5, borderColor:BORDER, borderTopColor:'#12252e', borderRadius:18, paddingLeft:13, paddingRight:4, paddingVertical:4 },
  input:     { flex:1, fontSize:SZ.md, color:'#f0f4f5', paddingVertical:8, fontFamily:F.outfit },
  sendBtn:   { width:34, height:34, backgroundColor:C.gold, borderRadius:10, alignItems:'center', justifyContent:'center' },
  sendBtnOff:{ backgroundColor:C.goldS },
  sendArrow: { fontSize:14, fontFamily:F.bold, color:'#f0f4f5' },

  // Picker modal — cream theme
  pickerOverlay:  { flex:1, backgroundColor:'rgba(10,18,20,0.7)', justifyContent:'flex-end' },
  pickerSheet: {
    backgroundColor:'#12252e',
    borderTopLeftRadius:20, borderTopRightRadius:20,
    paddingTop:12, paddingBottom:32, paddingHorizontal:20,
    borderTopWidth:1.5, borderLeftWidth:1.5, borderRightWidth:1.5,
    borderColor:BORDER, overflow:'hidden', position:'relative',
  },
  pickerShineBar: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  pickerHandle:   { width:36, height:4, borderRadius:2, backgroundColor:BORDER, alignSelf:'center', marginBottom:20 },
  pickerTitle:    { fontFamily:F.bold, color:C.blueDeep, fontSize:SZ.sm, letterSpacing:2, marginBottom:6 },
  pickerSub:      { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, lineHeight:18, marginBottom:16 },
  pickerDivider:  { height:1, backgroundColor:BORDER, marginVertical:8 },
  pickerRow:      { flexDirection:'row', alignItems:'center', gap:10, paddingVertical:13, paddingHorizontal:12, borderRadius:12, marginBottom:4 },
  pickerRowActive:{ backgroundColor:'#0f1c22' },
  pickerDot:      { width:8, height:8, borderRadius:4, flexShrink:0 },
  pickerRowLabel: { fontFamily:F.bold, color:'#f0f4f5', fontSize:SZ.base },
  pickerRowSub:   { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs-1, marginTop:2, letterSpacing:0.4 },
  pickerClose:    { marginTop:12, alignItems:'center', paddingVertical:14, borderRadius:12, borderWidth:1.5, borderColor:BORDER },
  pickerCloseTxt: { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, letterSpacing:1.5 },
});
