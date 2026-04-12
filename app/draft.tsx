import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../services/ai';
import { getCurrentTier } from '../services/purchases';
import { fetchBaseRankings, getCustomRankings, RankedPlayer } from '../services/rankingsData';
import { dark, F, palette, SP } from './constants/tokens';

type DraftType = 'snake' | 'linear';
type SetupStep = 'league' | 'config' | 'order' | 'drafting';

interface DraftPick {
  round: number;
  pick: number;
  overall: number;
  teamIndex: number;
  teamName: string;
  player: RankedPlayer | null;
}

interface LeagueOption {
  id: string;
  name: string;
  platform: string;
  format: string;
  teams: number;
}

const POS_COLORS: Record<string, { bg: string; color: string }> = {
  QB: { bg: 'rgba(167,139,250,0.15)', color: '#a78bfa' },
  RB: { bg: palette.green + '15', color: palette.green },
  WR: { bg: palette.aqua + '15', color: palette.aqua },
  TE: { bg: palette.amber + '15', color: palette.amber },
  K:  { bg: dark.textMuted + '15', color: dark.textMuted },
};

function PlayerPhoto({ playerId, size = 40 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!err && playerId) {
    const { Image } = require('react-native');
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, borderWidth: 1.5, borderColor: dark.border }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: dark.border }}>
      <Text style={{ fontSize: size * 0.35, fontFamily: F.bold, color: dark.textMuted }}>?</Text>
    </View>
  );
}

export default function DraftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Setup state
  const [step, setStep] = useState<SetupStep>('league');
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<LeagueOption | null>(null);
  const [numTeams, setNumTeams] = useState(12);
  const [myPick, setMyPick] = useState(1);
  const [draftType, setDraftType] = useState<DraftType>('snake');
  const [numRounds, setNumRounds] = useState(15);
  const [teamNames, setTeamNames] = useState<string[]>([]);

  // Draft state
  const [players, setPlayers] = useState<RankedPlayer[]>([]);
  const [draftedIds, setDraftedIds] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [currentPick, setCurrentPick] = useState(0);
  const [myRoster, setMyRoster] = useState<RankedPlayer[]>([]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [aiAdvice, setAiAdvice] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftModalPlayer, setDraftModalPlayer] = useState<RankedPlayer | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadLeagues();
  }, []);

  const loadLeagues = async () => {
    try {
      const username = await AsyncStorage.getItem('sleeper_username');
      if (!username) return;
      const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
      const sleeperLeagues = await (await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2025`)).json();
      if (Array.isArray(sleeperLeagues)) {
        setLeagues(sleeperLeagues.map((l: any) => ({
          id: l.league_id,
          name: l.name,
          platform: 'sleeper',
          format: l.scoring_settings?.rec >= 1 ? 'PPR' : l.scoring_settings?.rec > 0 ? '0.5 PPR' : 'Standard',
          teams: l.total_rosters ?? 12,
        })));
      }
    } catch {}
  };

  const handleSelectLeague = (league: LeagueOption) => {
    setSelectedLeague(league);
    setNumTeams(league.teams);
    const names = Array.from({ length: league.teams }, (_, i) => i === 0 ? 'My Team' : `Team ${i + 1}`);
    setTeamNames(names);
    setStep('config');
  };

  const handleStartDraft = async () => {
    setLoading(true);

    // Load rankings
    let rankData = await getCustomRankings();
    if (!rankData || rankData.length === 0) {
      rankData = await fetchBaseRankings('sleeper');
    }
    setPlayers(rankData);

    // Generate draft order
    const allPicks: DraftPick[] = [];
    for (let round = 1; round <= numRounds; round++) {
      for (let pick = 1; pick <= numTeams; pick++) {
        const teamIndex = draftType === 'snake' && round % 2 === 0
          ? numTeams - pick
          : pick - 1;
        allPicks.push({
          round,
          pick,
          overall: allPicks.length + 1,
          teamIndex,
          teamName: teamNames[teamIndex] || `Team ${teamIndex + 1}`,
          player: null,
        });
      }
    }
    setPicks(allPicks);
    setCurrentPick(0);
    setDraftedIds(new Set());
    setMyRoster([]);
    setStep('drafting');
    setLoading(false);
  };

  const isMyPick = picks.length > 0 && currentPick < picks.length && picks[currentPick].teamIndex === (myPick - 1);

  const handleDraftPlayer = (player: RankedPlayer) => {
    if (draftedIds.has(player.id)) return;
    setDraftModalPlayer(player);
    setShowDraftModal(true);
  };

  const confirmDraft = (teamIndex?: number) => {
    if (!draftModalPlayer || currentPick >= picks.length) return;
    
    const newDrafted = new Set(draftedIds);
    newDrafted.add(draftModalPlayer.id);
    setDraftedIds(newDrafted);

    const newPicks = [...picks];
    newPicks[currentPick] = { ...newPicks[currentPick], player: draftModalPlayer };
    setPicks(newPicks);

    // If it's my pick, add to roster
    const pickTeam = teamIndex ?? newPicks[currentPick].teamIndex;
    if (pickTeam === myPick - 1) {
      setMyRoster(prev => [...prev, draftModalPlayer]);
    }

    setCurrentPick(prev => prev + 1);
    setShowDraftModal(false);
    setDraftModalPlayer(null);
  };

  const handleAskAI = async () => {
    const tier = await getCurrentTier();
    if (tier === 'free' || tier === 'rankings') {
      Alert.alert('Pro Feature', 'Live AI draft advice requires Pro or higher. The draft board is free — upgrade for AI picks.', [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Upgrade', onPress: () => router.push('/paywall' as any) },
      ]);
      return;
    }
    setAiLoading(true);
    setShowAiModal(true);
    setAiAdvice('');

    const available = players.filter(p => !draftedIds.has(p.id)).slice(0, 20);
    const rosterSummary = myRoster.map(p => `${p.name} (${p.position})`).join(', ') || 'Empty';
    const posNeeds = getPositionNeeds();

    const prompt = `Fantasy draft advice. ${selectedLeague?.format ?? 'PPR'} league, ${numTeams} teams.

My pick position: ${myPick} of ${numTeams} (${draftType} draft)
Current overall pick: ${currentPick + 1} of ${numTeams * numRounds}
Round: ${Math.floor(currentPick / numTeams) + 1}

My current roster: ${rosterSummary}
Position needs: ${posNeeds}

Top 20 available players:
${available.map((p, i) => `${i + 1}. ${p.name} (${p.position}, ${p.team}) - ADP ${p.adp}`).join('\n')}

${isMyPick ? "IT'S MY PICK NOW. " : ""}Who should I target? Consider value over ADP, position scarcity, and my roster needs. Be direct, under 100 words. Name your top 3 picks and why.`;

    try {
      const text = await askAI(prompt, 400);
      setAiAdvice(text || 'Could not get advice.');
    } catch {
      setAiAdvice('Connection error. Try again.');
    }
    setAiLoading(false);
  };

  const getPositionNeeds = () => {
    const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0 };
    myRoster.forEach(p => { if (counts[p.position] !== undefined) counts[p.position]++; });
    const needs: string[] = [];
    if (counts.QB < 1) needs.push('QB');
    if (counts.RB < 2) needs.push(`RB (need ${2 - counts.RB})`);
    if (counts.WR < 2) needs.push(`WR (need ${2 - counts.WR})`);
    if (counts.TE < 1) needs.push('TE');
    if (counts.K < 1) needs.push('K');
    return needs.length > 0 ? needs.join(', ') : 'Roster looks complete';
  };

  const undoLastPick = () => {
    if (currentPick === 0) return;
    const prevPick = currentPick - 1;
    const prevPlayer = picks[prevPick].player;
    if (prevPlayer) {
      const newDrafted = new Set(draftedIds);
      newDrafted.delete(prevPlayer.id);
      setDraftedIds(newDrafted);
      if (picks[prevPick].teamIndex === myPick - 1) {
        setMyRoster(prev => prev.filter(p => p.id !== prevPlayer.id));
      }
    }
    const newPicks = [...picks];
    newPicks[prevPick] = { ...newPicks[prevPick], player: null };
    setPicks(newPicks);
    setCurrentPick(prevPick);
  };

  const availablePlayers = players.filter(p =>
    !draftedIds.has(p.id) &&
    (posFilter === 'ALL' || p.position === posFilter) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  // ── SETUP SCREENS ──────────────────────────────────────────
  if (step === 'league') {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, paddingTop: insets.top + 16 }}>
        <View style={{ paddingHorizontal: SP[3] }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: F.body, color: palette.aqua, fontSize: 14 }}>← BACK</Text>
          </TouchableOpacity>
          <Text style={s.setupTitle}>DRAFT COPILOT</Text>
          <Text style={s.setupSub}>Select a league to draft for</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: SP[3], gap: 8 }}>
          {leagues.map(lg => (
            <TouchableOpacity key={lg.id} style={s.leagueCard} onPress={() => handleSelectLeague(lg)}>
              <View style={[s.platformDot, { backgroundColor: lg.platform === 'espn' ? '#e52534' : lg.platform === 'yahoo' ? '#7c3aed' : '#00FFF9' }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.leagueName}>{lg.name}</Text>
                <Text style={s.leagueMeta}>{lg.platform.toUpperCase()} · {lg.format} · {lg.teams} teams</Text>
              </View>
              <Text style={{ color: palette.green, fontFamily: F.bold }}>→</Text>
            </TouchableOpacity>
          ))}
          {leagues.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text style={{ color: dark.textMuted, fontFamily: F.body }}>No leagues found. Connect in Settings.</Text>
            </View>
          )}
          <TouchableOpacity style={s.skipLeagueBtn} onPress={() => { setSelectedLeague(null); setStep('config'); }}>
            <Text style={{ color: palette.aqua, fontFamily: F.bold, fontSize: 12, letterSpacing: 1 }}>DRAFT WITHOUT LEAGUE →</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (step === 'config') {
    return (
      <View style={{ flex: 1, backgroundColor: dark.bg, paddingTop: insets.top + 16 }}>
        <ScrollView contentContainerStyle={{ padding: SP[3] }}>
          <TouchableOpacity onPress={() => setStep('league')} style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: F.body, color: palette.aqua, fontSize: 14 }}>← BACK</Text>
          </TouchableOpacity>
          <Text style={s.setupTitle}>DRAFT SETTINGS</Text>
          {selectedLeague && <Text style={s.setupSub}>{selectedLeague.name} · {selectedLeague.format}</Text>}

          <Text style={s.configLabel}>NUMBER OF TEAMS</Text>
          <View style={s.stepper}>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setNumTeams(Math.max(4, numTeams - 1))}><Text style={s.stepperTxt}>−</Text></TouchableOpacity>
            <Text style={s.stepperValue}>{numTeams}</Text>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setNumTeams(Math.min(16, numTeams + 1))}><Text style={s.stepperTxt}>+</Text></TouchableOpacity>
          </View>

          <Text style={s.configLabel}>MY DRAFT POSITION</Text>
          <View style={s.stepper}>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setMyPick(Math.max(1, myPick - 1))}><Text style={s.stepperTxt}>−</Text></TouchableOpacity>
            <Text style={s.stepperValue}>{myPick}</Text>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setMyPick(Math.min(numTeams, myPick + 1))}><Text style={s.stepperTxt}>+</Text></TouchableOpacity>
          </View>

          <Text style={s.configLabel}>DRAFT TYPE</Text>
          <View style={s.toggleRow}>
            <TouchableOpacity style={[s.toggleBtn, draftType === 'snake' && s.toggleBtnOn]} onPress={() => setDraftType('snake')}>
              <Text style={[s.toggleTxt, draftType === 'snake' && s.toggleTxtOn]}>SNAKE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.toggleBtn, draftType === 'linear' && s.toggleBtnOn]} onPress={() => setDraftType('linear')}>
              <Text style={[s.toggleTxt, draftType === 'linear' && s.toggleTxtOn]}>LINEAR</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.configLabel}>ROUNDS</Text>
          <View style={s.stepper}>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setNumRounds(Math.max(5, numRounds - 1))}><Text style={s.stepperTxt}>−</Text></TouchableOpacity>
            <Text style={s.stepperValue}>{numRounds}</Text>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setNumRounds(Math.min(20, numRounds + 1))}><Text style={s.stepperTxt}>+</Text></TouchableOpacity>
          </View>

          <TouchableOpacity style={s.startBtn} onPress={handleStartDraft}>
            {loading ? <ActivityIndicator color={dark.bg} /> : <Text style={s.startBtnTxt}>START DRAFT →</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── DRAFTING SCREEN ────────────────────────────────────────
  const currentRound = Math.floor(currentPick / numTeams) + 1;
  const draftComplete = currentPick >= picks.length;
  const currentPickInfo = !draftComplete ? picks[currentPick] : null;

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      {/* Header */}
      <View style={[s.draftHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => Alert.alert('Exit Draft', 'Your draft progress will be lost.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exit', style: 'destructive', onPress: () => router.back() },
        ])}>
          <Text style={{ fontFamily: F.body, color: palette.flame, fontSize: 12 }}>EXIT</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={s.draftRound}>ROUND {currentRound}</Text>
          <Text style={s.draftPick}>Pick {currentPick + 1} of {picks.length}</Text>
        </View>
        <TouchableOpacity onPress={undoLastPick}>
          <Text style={{ fontFamily: F.body, color: palette.amber, fontSize: 12 }}>UNDO</Text>
        </TouchableOpacity>
      </View>

      {/* On the clock */}
      {!draftComplete && currentPickInfo && (
        <View style={[s.clockBar, isMyPick && { backgroundColor: palette.green + '15', borderColor: palette.green + '30' }]}>
          <Text style={[s.clockText, isMyPick && { color: palette.green }]}>
            {isMyPick ? 'YOUR PICK' : `${currentPickInfo.teamName.toUpperCase()} IS ON THE CLOCK`}
          </Text>
        </View>
      )}

      {draftComplete && (
        <View style={[s.clockBar, { backgroundColor: palette.amber + '15', borderColor: palette.amber + '30' }]}>
          <Text style={[s.clockText, { color: palette.amber }]}>DRAFT COMPLETE</Text>
        </View>
      )}

      {/* My roster summary */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.rosterStrip} contentContainerStyle={{ gap: 6, paddingHorizontal: SP[3] }}>
        {['QB', 'RB', 'WR', 'TE', 'K'].map(pos => {
          const count = myRoster.filter(p => p.position === pos).length;
          const posStyle = POS_COLORS[pos] || POS_COLORS.K;
          return (
            <View key={pos} style={[s.rosterPill, { borderColor: posStyle.color + '30' }]}>
              <Text style={[s.rosterPillPos, { color: posStyle.color }]}>{pos}</Text>
              <Text style={s.rosterPillCount}>{count}</Text>
            </View>
          );
        })}
        <View style={s.rosterPill}>
          <Text style={s.rosterPillPos}>TOT</Text>
          <Text style={s.rosterPillCount}>{myRoster.length}</Text>
        </View>
      </ScrollView>

      {/* AI Advice button */}
      <TouchableOpacity style={s.aiBtn} onPress={handleAskAI}>
        <Text style={s.aiBtnTxt}>WHO SHOULD I DRAFT?</Text>
      </TouchableOpacity>

      {/* Position filter + search */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: SP[3] }}>
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'K'].map(pos => (
            <TouchableOpacity key={pos} style={[s.filterPill, posFilter === pos && s.filterPillOn]} onPress={() => setPosFilter(pos)}>
              <Text style={[s.filterTxt, posFilter === pos && s.filterTxtOn]}>{pos}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.searchRow}>
        <TextInput style={s.searchInput} placeholder="SEARCH" placeholderTextColor={dark.textMuted} value={search} onChangeText={setSearch} />
        <Text style={s.availCount}>{availablePlayers.length} available</Text>
      </View>

      {/* Player list */}
      <FlatList
        data={availablePlayers}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }}
        renderItem={({ item, index }) => {
          const posStyle = POS_COLORS[item.position] || POS_COLORS.K;
          const drafted = draftedIds.has(item.id);
          return (
            <TouchableOpacity
              style={[s.playerCard, drafted && { opacity: 0.3 }]}
              onPress={() => !drafted && handleDraftPlayer(item)}
              disabled={drafted || draftComplete}
            >
              <Text style={[s.playerRank, index < 3 && { color: palette.amber }]}>{index + 1}</Text>
              <PlayerPhoto playerId={item.id} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={s.playerName}>{item.name.toUpperCase()}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.playerTeam}>{item.team}</Text>
                  <View style={[s.posBadge, { backgroundColor: posStyle.bg }]}>
                    <Text style={[s.posText, { color: posStyle.color }]}>{item.position}</Text>
                  </View>
                </View>
              </View>
              <Text style={s.playerAdp}>ADP {item.adp}</Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Draft confirmation modal */}
      <Modal visible={showDraftModal} transparent animationType="fade" onRequestClose={() => setShowDraftModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>DRAFT {draftModalPlayer?.name?.toUpperCase()}?</Text>
            <Text style={s.modalSub}>{draftModalPlayer?.position} · {draftModalPlayer?.team} · ADP {draftModalPlayer?.adp}</Text>
            <Text style={s.modalPick}>
              Round {currentRound}, Pick {(currentPick % numTeams) + 1} — {currentPickInfo?.teamName}
            </Text>
            <TouchableOpacity style={s.confirmBtn} onPress={() => confirmDraft()}>
              <Text style={s.confirmTxt}>CONFIRM PICK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setShowDraftModal(false)}>
              <Text style={s.cancelTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI advice modal */}
      <Modal visible={showAiModal} transparent animationType="slide" onRequestClose={() => setShowAiModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { maxHeight: '70%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={s.modalTitle}>AI DRAFT ADVICE</Text>
              <TouchableOpacity onPress={() => setShowAiModal(false)}>
                <Ionicons name="close" size={22} color={dark.textMuted} />
              </TouchableOpacity>
            </View>
            {aiLoading ? (
              <View style={{ alignItems: 'center', padding: 30 }}>
                <ActivityIndicator color={palette.aqua} size="large" />
                <Text style={{ color: dark.textMuted, fontFamily: F.body, marginTop: 12 }}>ANALYZING BOARD...</Text>
              </View>
            ) : (
              <ScrollView>
                <Text style={s.aiText}>{aiAdvice}</Text>
              </ScrollView>
            )}
            <TouchableOpacity style={[s.confirmBtn, { marginTop: 16 }]} onPress={() => setShowAiModal(false)}>
              <Text style={s.confirmTxt}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  // Setup
  setupTitle:  { fontFamily: F.bold, fontSize: 32, color: dark.text, letterSpacing: 2, marginBottom: 4 },
  setupSub:    { fontFamily: F.body, fontSize: 14, color: dark.textMuted, marginBottom: 20 },
  leagueCard:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: dark.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: dark.border },
  platformDot: { width: 10, height: 10, borderRadius: 5 },
  leagueName:  { fontFamily: F.bold, fontSize: 15, color: dark.text, letterSpacing: 0.5 },
  leagueMeta:  { fontFamily: F.body, fontSize: 11, color: dark.textMuted, marginTop: 2 },
  skipLeagueBtn: { alignItems: 'center', paddingVertical: 20 },

  configLabel: { fontFamily: F.bold, fontSize: 11, letterSpacing: 2, color: dark.textMuted, marginTop: 20, marginBottom: 8 },
  stepper:     { flexDirection: 'row', alignItems: 'center', backgroundColor: dark.card, borderRadius: 12, borderWidth: 1, borderColor: dark.border, overflow: 'hidden' },
  stepperBtn:  { width: 50, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: dark.surface },
  stepperTxt:  { fontFamily: F.bold, fontSize: 20, color: palette.aqua },
  stepperValue:{ flex: 1, textAlign: 'center', fontFamily: F.bold, fontSize: 24, color: dark.text },
  toggleRow:   { flexDirection: 'row', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: dark.border },
  toggleBtn:   { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: dark.card },
  toggleBtnOn: { backgroundColor: palette.aqua },
  toggleTxt:   { fontFamily: F.bold, fontSize: 13, letterSpacing: 2, color: dark.textMuted },
  toggleTxtOn: { color: dark.bg },
  startBtn:    { backgroundColor: palette.amber, borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 32 },
  startBtnTxt: { fontFamily: F.bold, fontSize: 16, color: dark.bg, letterSpacing: 2 },

  // Draft header
  draftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SP[3], paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: dark.border },
  draftRound:  { fontFamily: F.bold, fontSize: 14, color: dark.text, letterSpacing: 2 },
  draftPick:   { fontFamily: F.body, fontSize: 10, color: dark.textMuted },

  // Clock bar
  clockBar:    { marginHorizontal: SP[3], marginTop: 8, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: palette.aqua + '10', borderWidth: 1, borderColor: palette.aqua + '20' },
  clockText:   { fontFamily: F.bold, fontSize: 12, letterSpacing: 2, color: palette.aqua },

  // Roster strip
  rosterStrip: { marginTop: 8, maxHeight: 36 },
  rosterPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: dark.border, backgroundColor: dark.card },
  rosterPillPos:  { fontFamily: F.bold, fontSize: 9, letterSpacing: 1, color: dark.textMuted },
  rosterPillCount:{ fontFamily: F.bold, fontSize: 12, color: dark.text },

  // AI button
  aiBtn:       { marginHorizontal: SP[3], marginTop: 10, backgroundColor: palette.green + '15', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: palette.green + '30' },
  aiBtnTxt:    { fontFamily: F.bold, fontSize: 13, letterSpacing: 2, color: palette.green },

  // Filters
  filterRow:   { marginTop: 10 },
  filterPill:  { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: dark.border },
  filterPillOn:{ backgroundColor: palette.amber, borderColor: palette.amber },
  filterTxt:   { fontFamily: F.bold, fontSize: 12, letterSpacing: 1, color: dark.textMuted },
  filterTxtOn: { color: dark.bg },
  searchRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP[3], marginTop: 8, marginBottom: 6, gap: 8 },
  searchInput: { flex: 1, backgroundColor: dark.card, borderRadius: 10, borderWidth: 1, borderColor: dark.border, paddingHorizontal: 12, paddingVertical: 8, fontFamily: F.body, fontSize: 11, color: dark.text, letterSpacing: 1 },
  availCount:  { fontFamily: F.body, fontSize: 10, color: dark.textMuted },

  // Player card
  playerCard:  { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: dark.card, borderRadius: 14, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: dark.border },
  playerRank:  { fontFamily: F.bold, fontSize: 20, color: palette.aqua, width: 28, textAlign: 'center' },
  playerName:  { fontFamily: F.bold, fontSize: 14, color: dark.text, letterSpacing: 0.5 },
  playerTeam:  { fontFamily: F.body, fontSize: 10, color: dark.textMuted },
  posBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  posText:     { fontFamily: F.body, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  playerAdp:   { fontFamily: F.body, fontSize: 10, color: dark.textMuted },

  // Modals
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(10,18,20,0.8)', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: dark.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1, borderColor: dark.border },
  modalTitle:    { fontFamily: F.bold, fontSize: 16, color: dark.text, letterSpacing: 1 },
  modalSub:      { fontFamily: F.body, fontSize: 13, color: dark.textMuted, marginTop: 4 },
  modalPick:     { fontFamily: F.body, fontSize: 12, color: palette.aqua, marginTop: 8, marginBottom: 20 },
  confirmBtn:    { backgroundColor: palette.amber, borderRadius: 12, padding: 16, alignItems: 'center' },
  confirmTxt:    { fontFamily: F.bold, fontSize: 14, color: dark.bg, letterSpacing: 2 },
  cancelBtn:     { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: dark.border },
  cancelTxt:     { fontFamily: F.body, fontSize: 13, color: dark.textMuted, letterSpacing: 1 },
  aiText:        { fontFamily: F.body, fontSize: 14, color: dark.text, lineHeight: 22 },
});