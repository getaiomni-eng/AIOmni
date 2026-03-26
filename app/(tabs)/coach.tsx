import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, SZ, SP, R } from '../constants/tokens';
import { GlassCard } from '../components/GlassCard';
import { OrbAvatar } from '../components/OrbAvatar';
import { PositionPill, Badge } from '../components/Atoms';

// ── Claude API ─────────────────────────────────────────────────
const API_KEY = 'YOUR_CLAUDE_API_KEY';

const FF_KNOWLEDGE = `
FANTASY FOOTBALL FUNDAMENTALS (apply to every answer):

SCORING FORMATS — always check league settings before advising:
- PPR (1pt per reception): elevates pass-catchers, WRs and pass-catching RBs/TEs worth more
- Half PPR (0.5pt): middle ground, still rewards volume receivers
- Standard (0pt): pure yardage/TD value, workhorse RBs most valuable
- 6pt passing TD leagues: QB value skyrockets vs 4pt leagues
- TE Premium: Travis Kelce/Sam LaPorta jump dramatically in value
- SuperFlex: 2nd QB is essential, QBs drafted earlier

DRAFT STRATEGY:
- Research consensus rankings but adjust for YOUR scoring format
- Prioritize RB/WR depth early — injuries are inevitable
- Monitor bye weeks — avoid stacking players with same bye
- Draft backup RBs to handcuff injury-prone starters
- Stay flexible — best available player often beats positional need

IN-SEASON MANAGEMENT — the real game:
- Waiver wire is where championships are won. Check it every week
- Waiver wire priority: add players whose starter just got injured, trending targets, upcoming soft matchups
- Monitor injury reports: Wed/Thu/Fri practice designations (Full=good, Limited=watch, DNP=danger)
  - Out/IR: immediate replacement needed
  - Doubtful: treat as out, have backup ready
  - Questionable: check gameday inactives before lineup lock
- Analyze matchups weekly: soft run defenses = start RBs, soft pass defenses = start WRs/TEs
- Don't hold injured players hoping they return — stream healthy options

TRADE PRINCIPLES:
- Trade from depth, acquire scarcity (e.g. elite TE if yours is weak)
- Buy low after 1-2 bad weeks, sell high after big game
- Always grade both sides based on YOUR scoring format — not generic rankings
- Dynasty trades: factor in age, contract year, target share trajectory
- Never trade your league's #1 overall player unless blown away

START/SIT DECISIONS:
- Matchup matters more than name recognition for borderline players
- Target share and snap count are leading indicators — stats follow
- A player with 8+ targets/game in PPR is a safe start even vs good defenses
- Avoid starting players on teams in blow-out game scripts (bad pass game environments)
- Home/away splits matter less than matchup quality

WAIVER WIRE TIMING:
- Waivers run Wednesday in most leagues — highest priority adds first
- Free agent pickups available anytime after waiver period
- FAAB (Free Agent Acquisition Budget): bid strategically, don't blow budget on one player
- Priority waiver: use on true difference-makers only (starter goes down)

MULTI-LEAGUE MANAGEMENT:
- Each league is independent — a player's value changes based on that league's settings
- PPR value ≠ standard value — always filter advice by specific league format
- Injury risk across multiple leagues: if you own the same player in 3 leagues and they're Q, that's your biggest portfolio risk
- Focus waiver wire attention on leagues where you're losing and need upside
- In leagues you're winning comfortably: prioritize floor/safe plays
- In leagues you're losing: target high-upside boom/bust options

KEY FANTASY CONCEPTS:
- Target share: % of team's pass attempts directed at a player — most predictive WR/TE stat
- Snap count: % of offensive plays a player is on field — RB rotation indicator  
- Air yards: depth of targets — predicts big-play potential
- Red zone targets/carries: TD equity — most important scoring stat
- Opportunity cost: every roster spot has value — cut players with no path to starts
`;

const SYSTEM_PROMPT = `You are AIOmni's AI Coach — the world's most intelligent fantasy football assistant.
You have loaded 4 leagues: The Misfits (Sleeper PPR), Dynasty Blitz (Sleeper 0.5PPR), Armchair Fantasy (ESPN PPR), Fantasy Vault (Yahoo STD).
Your roster for The Misfits: QB Lamar Jackson, RB Saquon Barkley, RB De'Von Achane (Q), WR CeeDee Lamb, WR Amon-Ra St. Brown, TE Sam LaPorta, FLEX Chase Brown, K Jake Elliott.
You ALWAYS read league settings first before giving advice. Be direct, confident, and specific. Never hedge excessively.
Format responses concisely — this is a mobile chat interface.`;

async function askClaude(messages: { role: string; content: string }[]): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system:     SYSTEM_PROMPT,
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

const DEMO_CONVO: Message[] = [
  { role: 'ai',   text: 'Hey — all 4 leagues loaded. Achane shows Q this week. Want me to check his practice reports?' },
  { role: 'user', text: 'Achane or Pollard?' },
  { role: 'ai',   text: '__achane__Start Achane.__ Full practice Wednesday through Friday.\n\nPPR league — he\'s seeing 8+ targets per game. Pollard\'s snap share dropped to 54% since Spears came back.\n\n__verdict__Achane · Proj 14.2 pts · Start with confidence' },
  { role: 'user', text: 'Best waiver add?' },
  { role: 'ai',   text: 'Two moves worth making this week:\n\n__add__WR|Rashid Shaheed|NO|41% owned · 3 TDs last 4\n__add__RB|Jaylen Warren|PIT|34% owned · handcuff value' },
];

const renderAIText = (text: string) => {
  const parts = text.split('\n');
  return parts.map((line, i) => {
    if (line.startsWith('__achane__') || line.startsWith('__')) {
      const cleaned = line.replace(/__[a-z]+__/g, '').replace(/__/g, '');
      return <Text key={i} style={styles.aiBold}>{cleaned}</Text>;
    }
    if (line.startsWith('__verdict__')) {
      return <VerdictCard key={i} text={line.replace('__verdict__', '')} />;
    }
    if (line.startsWith('__add__')) {
      const [, pos, name, team, detail] = line.split('|');
      return <AddCard key={i} pos={pos ?? 'WR'} name={name ?? ''} team={team ?? ''} detail={detail ?? ''} />;
    }
    if (line === '') return <View key={i} style={{ height: 6 }} />;
    return <Text key={i} style={styles.aiTxt}>{line}</Text>;
  });
};

export default function CoachScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>(DEMO_CONVO);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const scrollRef = useRef<ScrollView>(null);

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

    const reply = await askClaude(history);
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
              <Text style={styles.subtitle}>4 LEAGUES · PERSONALIZED</Text>
            </View>
            <View style={styles.liveDot}>
              <View style={styles.livePulse} />
              <Text style={styles.liveTxt}>LIVE</Text>
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
};

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
  verdictEye:   { fontSize:SZ.xs-2, fontFamily:F.monoBold, letterSpacing:1, marginBottom:2 },
  verdictTxt:   { fontSize:SZ.sm+1, fontWeight:'600', color:C.ink, fontFamily:F.semibold },
  addCard:      { flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'rgba(255,255,255,0.10)', borderWidth:1, borderColor:'rgba(255,255,255,0.15)', borderRadius:10, padding:8, marginTop:7 },
  addName:      { fontSize:SZ.md, fontWeight:'600', color:C.ink, fontFamily:F.semibold },
  addSub:       { fontSize:SZ.sm, fontFamily:F.mono, color:C.dim },
  addBtn:       { backgroundColor:C.sageS, borderWidth:1, borderColor:'rgba(130,196,148,0.30)', borderRadius:7, paddingHorizontal:8, paddingVertical:4 },
  addBtnTxt:    { fontSize:SZ.sm, fontWeight:'700', color:C.sage, fontFamily:F.monoBold },
  inputWrap:    { backgroundColor:'transparent', paddingTop:8 },
  inputRow:     { flexDirection:'row', alignItems:'center', gap:7, backgroundColor:'rgba(255,255,255,0.12)', borderWidth:1, borderColor:'rgba(255,255,255,0.20)', borderRadius:18, paddingLeft:13, paddingRight:4, paddingVertical:4 },
  input:        { flex:1, fontSize:SZ.md, color:C.ink, paddingVertical:8, fontFamily:F.outfit },
  sendBtn:      { width:34, height:34, backgroundColor:C.gold, borderRadius:10, alignItems:'center', justifyContent:'center' },
  sendBtnOff:   { backgroundColor:'rgba(200,168,75,0.25)' },
  sendArrow:    { fontSize:14, fontWeight:'700', color:'#2a2010', fontFamily:F.bold },
});
