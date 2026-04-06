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
import { askAI } from '../../services/ai';
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { fetchAllLiveData, formatLiveDataForPrompt } from '../../services/liveData';
import { getCurrentTier } from '../../services/purchases';
import { getMemories, saveMemory } from '../../services/supabase';
import { getPlayerContext } from '../../services/playerIntelligence';
import { OrbAvatar } from '../components/OrbAvatar';
import { Icon } from '../components/AIOmniIcons';
import { C, F, R, SP, SZ, BEVEL } from '../constants/tokens';
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
  leagueId: string; name: string; platform: string; format: string;
  record: string; rank: string; roster: string[]; week: number;
};

function getPaywallMessage(resetStr: string): string {
  return `You've used all ${WEEKLY_LIMIT} weekly prompts. Resets ${resetStr}.\n\n__verdict__Upgrade to Pro for 75 prompts per week → getaiomni.com`;
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
    const playerMapRaw = await AsyncStorage.getItem('sleeper_player_map');
    const playerMap    = playerMapRaw ? JSON.parse(playerMapRaw) : {};
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
        return { leagueId: l.league_id, name: l.name, platform: 'Sleeper', format: fmt, record: `${wins}–${losses}`, rank: rankIdx >= 0 ? `${rankIdx + 1} of ${rosters.length}` : 'unknown', roster: rosterNames, week };
      } catch {
        return { leagueId: l.league_id, name: l.name, platform: 'Sleeper', format: fmt, record: '?', rank: '?', roster: [], week };
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
    return [{ leagueId: String(creds.leagueId), name: leagueData.settings?.name ?? 'ESPN League', platform: 'ESPN', format: fmt, record: `${wins}–${losses}`, rank: rankIdx >= 0 ? `${rankIdx + 1} of ${teams.length}` : 'unknown', roster: rosterNames, week }];
  } catch { return []; }
}

function buildSystemPrompt(leagues: LeagueContext[], selectedLeague: LeagueContext | null, memories: string): string {
  const targets = selectedLeague ? [selectedLeague] : leagues;
  if (targets.length === 0) return `${BASE_SYSTEM}\n\nNo leagues loaded yet.`;
  const leagueBlocks = targets.map(l => `
League: ${l.name} (${l.platform} · ${l.format})
Record: ${l.record} · Rank: ${l.rank} · Week: ${l.week}
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

const POS_COLORS: Record<string, string> = {
  QB: '#7b5ea7', RB: '#1e8c42', WR: '#2a7aaa',
  TE: '#b85a1a', K: '#6b7491',
};

const PositionPill: React.FC<{ pos: string }> = ({ pos }) => (
  <View style={[styles.posPill, { backgroundColor: POS_COLORS[pos] || C.dim2 }]}>
    <Text style={styles.posPillTxt}>{pos}</Text>
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
const QUICK_PROMPTS = ['Start/Sit', 'Best Waiver', 'Trade Value', 'Matchup'];

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

      const limit   = currentTier === 'dynasty_elite' ? 999 : currentTier === 'premium' ? 125 : currentTier === 'pro' ? 75 : 25;
      const greeting = all.length > 0
        ? `Hey — ${all.length} league${all.length > 1 ? 's' : ''} loaded. ${rem} of ${limit} prompts remaining this week. What do you need?`
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

      console.log('SENDING PROMPT:', fullPrompt);
      try {
        const reply = await askAI(fullPrompt, 1000);
        console.log('RAW RESULT:', reply, 'TYPE:', typeof reply);
        console.log('RAW AI RESULT:', reply);

        if (!reply) {
          const debugMsg: Message = { role:'ai', text: 'Connection issue. Check your network and try again.' };
          setMessages(prev => [...prev.slice(0, -1), debugMsg]);
        } else {
          const messageObject: Message = { role:'ai', text: reply || "Sorry, couldn't get a response. Try again." };
          console.log('MESSAGE OBJECT BEING SET:', messageObject);
          setMessages(prev => [...prev.slice(0, -1), messageObject]);

          if (['pro','premium','dynasty_elite'].includes(tier) && selectedLeague) {
            try {
              await saveMemory({
                leagueId: selectedLeague.leagueId,
                platform: selectedLeague.platform,
                content: `Q: ${text}\nA: ${reply.slice(0, 200)}...`,
              });
            } catch {}
          }
        }
      } catch (aiError: any) {
        const errorMsg: Message = { role:'ai', text: 'Connection issue. Check your network and try again.' };
        setMessages(prev => [...prev.slice(0, -1), errorMsg]);
      }
    } catch (e: any) {
      setMessages(prev => [...prev.slice(0, -1), { role:'ai', text: 'Sorry, I encountered an error. Please try again.' }]);
    }
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const quickSend = (prompt: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    send(prompt);
  };

  const clearChat = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMessages([]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <Text style={styles.title}>AI COACH</Text>
          <TouchableOpacity onPress={clearChat} style={styles.clearBtn}>
            <Icon name="trash" size={20} color={C.rose} />
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((msg, i) => {
            console.log('RENDERING MESSAGE:', msg);
            return (
            <View key={i} style={[styles.msg, msg.role === 'user' && styles.userMsg]}>
              {msg.isLoading ? (
                <ActivityIndicator color={C.blueDeep} size="small" />
              ) : msg.role === 'ai' ? (
                <View style={styles.aiMsg}>
                  <View style={styles.aiHeader}>
                    <OrbAvatar size={32} />
                    <Text style={styles.aiLabel}>AI Coach</Text>
                  </View>
                  {renderAIText(msg.text)}
                </View>
              ) : (
                <Text style={styles.userTxt}>{msg.text}</Text>
              )}
            </View>
            );
          })}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.quickRow}>
            {QUICK_PROMPTS.map(prompt => (
              <TouchableOpacity key={prompt} onPress={() => quickSend(prompt)} style={styles.quickBtn} disabled={loading}>
                <View style={styles.quickContent}>
                  {prompt === 'Start/Sit' && <Icon name="target" size={16} color={C.blueDeep} />}
                  {prompt === 'Best Waiver' && <Icon name="trending" size={16} color={C.blueDeep} />}
                  {prompt === 'Trade Value' && <Icon name="swap" size={16} color={C.blueDeep} />}
                  {prompt === 'Matchup' && <Icon name="barchart" size={16} color={C.blueDeep} />}
                  <Text style={styles.quickTxt}>{prompt}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask anything about your leagues..."
              placeholderTextColor={C.dim2}
              multiline
              returnKeyType="send"
              onSubmitEditing={() => send(input)}
              editable={!loading}
            />
            <TouchableOpacity
              onPress={() => send(input)}
              style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
              disabled={!input.trim() || loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Icon name="send" size={20} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>

          <Text style={[styles.remaining, { color: remaining > 10 ? C.mint : remaining > 5 ? C.amber : C.rose }]}>
            {remaining} prompts remaining this week
          </Text>
        </View>

        <Modal visible={pickerVisible} transparent animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} onPress={() => setPickerVisible(false)}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Focus on League</Text>
              <TouchableOpacity onPress={() => selectLeague(null)} style={styles.leagueOption}>
                <Text style={styles.leagueTxt}>All Leagues ({allLeagues.length})</Text>
              </TouchableOpacity>
              {allLeagues.map((l, i) => (
                <TouchableOpacity key={i} onPress={() => selectLeague(l)} style={styles.leagueOption}>
                  <Text style={[styles.leagueTxt, { color: PLATFORM_COLOR[l.platform] ?? C.dim }]}>
                    {l.name} ({l.platform})
                  </Text>
                  <Text style={styles.leagueSub}>{l.record} · {l.rank}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP[3],
    paddingTop: 50,
    paddingBottom: 10,
  },
  title: {
    fontSize: 28,
    fontFamily: F.bold,
    color: '#ffffff',
    letterSpacing: 3,
  },
  clearBtn: {
    padding: 8,
  },
  chatScroll: {
    flex: 1,
    paddingHorizontal: SP[3],
  },
  msg: {
    marginBottom: 16,
    maxWidth: '80%',
  },
  userMsg: {
    alignSelf: 'flex-end',
  },
  aiMsg: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: C.blueDeep,
    borderTopLeftRadius: 4,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  aiLabel: {
    fontSize: 11,
    fontFamily: F.mono,
    color: C.dim2,
    marginLeft: 8,
    letterSpacing: 1.5,
  },
  userTxt: {
    backgroundColor: '#fee229',
    color: C.ink,
    borderRadius: 16,
    borderTopRightRadius: 4,
    padding: 14,
    fontFamily: F.outfit,
    fontSize: 16,
    lineHeight: 24,
  },
  aiTxt: {
    fontSize: 16,
    color: C.ink,
    lineHeight: 24,
    fontFamily: F.outfit,
  },
  aiBold: {
    fontSize: 16,
    color: C.ink,
    fontFamily: F.bold,
    lineHeight: 24,
  },
  verdict: {
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
  },
  verdictEye: {
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  verdictTxt: {
    fontSize: 16,
    fontFamily: F.bold,
    color: C.ink,
  },
  recoCard: {
    ...BEVEL.card,
    backgroundColor: 'rgba(217,253,243,0.9)',
    padding: 14,
    marginVertical: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  bevelShine: {
    ...BEVEL.shine,
    left: '10%',
    right: '10%',
    height: 2,
    borderRadius: 1,
  },
  recoTitle: {
    fontSize: SZ.base,
    fontFamily: F.bold,
    color: C.ink,
  },
  recoBody: {
    fontSize: 16,
    color: C.dim,
    lineHeight: 24,
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(88,131,191,0.24)',
  },
  addName: {
    fontSize: SZ.sm,
    fontFamily: F.bold,
    color: C.ink,
  },
  addSub: {
    fontSize: SZ.xs,
    color: C.dim2,
    fontFamily: F.mono,
  },
  addBtn: {
    backgroundColor: C.blueDeep,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBtnTxt: {
    color: '#ffffff',
    fontSize: SZ.xs,
    fontFamily: F.bold,
  },
  inputBar: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(88,131,191,0.18)',
    paddingHorizontal: SP[3],
    paddingTop: 12,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  quickBtn: {
    flex: 1,
    backgroundColor: 'rgba(88,131,191,0.08)',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  quickTxt: {
    fontSize: 12,
    fontFamily: F.mono,
    color: C.dim,
  },
  quickContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(88,131,191,0.06)',
    borderRadius: 16,
    padding: 12,
    fontSize: 15,
    color: C.ink,
    fontFamily: F.mono,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: C.blueDeep,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  remaining: {
    fontSize: SZ.xs,
    color: C.dim,
    textAlign: 'center',
    marginTop: 8,
    fontFamily: F.mono,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '80%',
    maxHeight: '60%',
  },
  modalTitle: {
    fontSize: SZ.lg,
    fontFamily: F.bold,
    color: C.ink,
    marginBottom: 16,
    textAlign: 'center',
  },
  leagueOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(88,131,191,0.12)',
  },
  leagueTxt: {
    fontSize: SZ.sm,
    fontFamily: F.bold,
    color: C.ink,
  },
  leagueSub: {
    fontSize: SZ.xs,
    color: C.dim2,
    fontFamily: F.mono,
    marginTop: 2,
  },
  posPill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  posPillTxt: {
    fontSize: SZ.xs,
    fontFamily: F.bold,
    color: '#ffffff',
  },
});
