// app/(tabs)/draft.tsx
// AIOmni Draft Copilot — V7 Dark Theme
// Sleeper: auto-sync live picks | ESPN/Yahoo/Offline: companion mode

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNFLSeason } from '../../services/season';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform as RNPlatform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../../services/ai';
import {
    DEFAULT_PLAYER_DB,
    loadLivePlayerDB,
    DraftPick,
    DraftSettings, DraftState,
    DraftType,
    Platform,
    PlayerInfo,
    applyPick,
    buildDraftPrompt,
    clearDraftState,
    createInitialDraftState,
    findActiveDraft,
    getAllPicksForSlot,
    getSleeperDraft,
    getSleeperDraftPicks,
    loadDraftState,
    saveDraftState,
    undoLastPick
} from '../../services/draft';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── V7 THEME ───────────────────────────────────────────────
const C = {
  bg:       '#0a1214',
  card:     '#12252e',
  cardAlt:  '#14282f',
  border:   '#1a3542',
  muted:    '#0f1c22',
  amber:    '#ffb800',
  aqua:     '#1be7ff',
  text:     '#f0f4f5',
  textDim:  '#7a9eaa',
  red:      '#ff4d6a',
  green:    '#00e676',
  shadow:   '#000',
};

const POS_COLORS: Record<string, string> = {
  QB:   '#ff6b9d',
  RB:   '#1be7ff',
  WR:   '#00e676',
  TE:   '#ffb800',
  K:    '#7a9eaa',
  DEF:  '#c78dff',
  FLEX: '#ff8c42',
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// ─── FONTS (match V7) ──────────────────────────────────────
const F = {
  heading: 'BebasNeue-Regular',
  body:    'Barlow-Regular',
  bodyB:   'Barlow-Bold',
  data:    'SpaceMono-Regular',
};

// ─── SETUP PHASE ────────────────────────────────────────────
type SetupStep = 'platform' | 'league' | 'position' | 'confirm';

interface SetupData {
  platform: Platform;
  leagueId: string;
  leagueName: string;
  draftId?: string;
  draftType: DraftType;
  rounds: number;
  teamCount: number;
  myDraftSlot: number;
  scoringFormat: 'ppr' | 'half' | 'standard';
  rosterSlots: string[];
  scoringSettings?: Record<string, number>;
}

// ─── MAIN COMPONENT ────────────────────────────────────────

export default function DraftCopilotScreen() {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'setup' | 'draft' | 'loading'>('setup');
  const [setupStep, setSetupStep] = useState<SetupStep>('platform');
  const [setupData, setSetupData] = useState<Partial<SetupData>>({
    draftType: 'snake',
    rounds: 15,
    teamCount: 12,
    myDraftSlot: 1,
    scoringFormat: 'ppr',
    rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  });
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [sleeperLeagues, setSleeperLeagues] = useState<any[]>([]);
  const [sleeperPicks, setSleeperPicks] = useState<string[] | null>(null);
  const [espnLeagues, setEspnLeagues] = useState<any[]>([]);
  const [yahooLeagues, setYahooLeagues] = useState<any[]>([]);

  // Check for saved draft state on mount
  useEffect(() => {
    (async () => {
      const saved = await loadDraftState();
      if (saved && saved.status !== 'complete') {
        Alert.alert(
          'Resume Draft?',
          `You have a draft in progress for ${saved.settings.leagueName}. Resume it?`,
          [
            { text: 'New Draft', style: 'destructive', onPress: () => clearDraftState() },
            { text: 'Resume', onPress: () => { setDraftState(saved); setPhase('draft'); } },
          ]
        );
      }
    })();
  }, []);

  // Load leagues from storage when platform is selected
  useEffect(() => {
    if (setupData.platform === 'sleeper') {
      (async () => {
        const username = await AsyncStorage.getItem('sleeper_username');
        if (!username) return;
        try {
          const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
          const user = await userRes.json();
          const draftSeason = await getNFLSeason();
          const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${draftSeason}`);
          const leagues = await leaguesRes.json();
          setSleeperLeagues(leagues || []);
        } catch (e) {
          console.error('Failed to load Sleeper leagues:', e);
        }
        setSleeperPicks(null);
      })();
    }
  }, [setupData.platform]);


  const fetchSleeperPicks = async (leagueId: string, userId: string) => {
    try {
      const [rostersRes, tradedRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
      ]);
      const rosters = await rostersRes.json();
      const tradedPicks = await tradedRes.json();
      const myRoster = rosters.find((r: any) => r.owner_id === userId);
      if (!myRoster) return;

      const myRosterId = myRoster.roster_id;
      const season = await getNFLSeason();
      const totalRounds = setupData.rounds || 4;

      // Build draft order from standings (worst record = pick 1)
      const draftOrder = [...rosters].sort((a: any, b: any) => {
        const aW = a.settings?.wins ?? 0, bW = b.settings?.wins ?? 0;
        if (aW !== bW) return aW - bW;
        return (a.settings?.fpts ?? 0) - (b.settings?.fpts ?? 0);
      });
      const positionMap = new Map<number, number>();
      draftOrder.forEach((r: any, i: number) => positionMap.set(r.roster_id, i + 1));

      // Track traded picks for this season
      const lostRounds = new Set<number>();
      const acquiredPicks: { round: number; fromRosterId: number }[] = [];

      for (const tp of tradedPicks) {
        if (String(tp.season) !== season) continue;
        if (tp.roster_id === myRosterId && tp.owner_id !== myRosterId) {
          lostRounds.add(tp.round);
        }
        if (tp.owner_id === myRosterId) {
          acquiredPicks.push({ round: tp.round, fromRosterId: tp.roster_id });
        }
      }

      // Build final pick list with pick numbers (e.g. "4.10")
      const myPosition = positionMap.get(myRosterId) || 1;
      const picks: { round: number; pick: number; label: string }[] = [];

      // Own picks that weren't traded away
      for (let rd = 1; rd <= totalRounds; rd++) {
        if (!lostRounds.has(rd)) {
          const pickNum = String(myPosition).padStart(2, '0');
          picks.push({ round: rd, pick: myPosition, label: `${rd}.${pickNum}` });
        }
      }

      // Acquired picks with the original team's draft position
      for (const ap of acquiredPicks) {
        const fromPos = positionMap.get(ap.fromRosterId) || 1;
        const pickNum = String(fromPos).padStart(2, '0');
        picks.push({ round: ap.round, pick: fromPos, label: `${ap.round}.${pickNum}` });
      }

      // Sort by round then pick
      picks.sort((a, b) => a.round !== b.round ? a.round - b.round : a.pick - b.pick);

      setSleeperPicks(picks.length > 0 ? picks.map(p => p.label) : null);
    } catch (e) {
      console.log('fetchSleeperPicks error:', e);
      setSleeperPicks(null);
    }
  };

  const handleStartDraft = useCallback(async () => {
    const settings: DraftSettings = {
      platform: setupData.platform!,
      leagueId: setupData.leagueId || 'offline',
      leagueName: setupData.leagueName || 'My Draft',
      draftId: setupData.draftId,
      draftType: setupData.draftType!,
      rounds: setupData.rounds!,
      teamCount: setupData.teamCount!,
      myDraftSlot: setupData.myDraftSlot!,
      pickTimer: 0,
      scoringFormat: setupData.scoringFormat!,
      rosterSlots: setupData.rosterSlots!,
      scoringSettings: setupData.scoringSettings,
    };
    // Load live ADP data (falls back to static DB if offline)
      const isDynasty = (setupData as any).isDynasty === true;
      const totalSlots = settings.rosterSlots?.length ?? 0;
      const draftMode: 'startup' | 'rookie' | 'redraft' =
        isDynasty && settings.rounds <= 6 ? 'rookie'
        : isDynasty && settings.rounds >= 15 ? 'startup'
        : settings.draftType === 'linear' && settings.rounds <= 5 && totalSlots <= 8 ? 'rookie'
        : 'redraft';
      let liveDB = await loadLivePlayerDB(draftMode);
      if (settings.platform === 'sleeper' && settings.leagueId && settings.leagueId !== 'offline') {
        try {
          const rostersRes = await fetch('https://api.sleeper.app/v1/league/' + settings.leagueId + '/rosters');
          const rosters = await rostersRes.json();
          const allRostered = new Set<string>();
          for (const r of rosters || []) {
            if (Array.isArray(r?.players)) {
              for (const pid of r.players) allRostered.add(String(pid));
            }
          }
          if (allRostered.size > 0) {
            if (draftMode === 'rookie' || draftMode === 'startup') {
              liveDB = liveDB.filter(p => !allRostered.has(p.id));
            } else {
              liveDB = liveDB.map(p => allRostered.has(p.id) ? { ...p, isDrafted: true } : p);
            }
          }
        } catch (e) { console.log('roster filter error:', e); }
      }
      const state = createInitialDraftState(settings, liveDB);
    state.status = 'drafting';
    setDraftState(state);
    setPhase('draft');
    saveDraftState(state);
  }, [setupData]);

  const handleResetDraft = useCallback(() => {
    Alert.alert('Reset Draft?', 'This will clear all picks and start over.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset', style: 'destructive',
        onPress: () => {
          clearDraftState();
          setDraftState(null);
          setPhase('setup');
          setSetupStep('platform');
          setSetupData({
            draftType: 'snake', rounds: 15, teamCount: 12, myDraftSlot: 1,
            scoringFormat: 'ppr',
            rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
          });
        },
      },
    ]);
  }, []);

  if (phase === 'setup') {
    return (
      <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]}>
        <SetupWizard
          step={setupStep}
          data={setupData}
          sleeperLeagues={sleeperLeagues}
          sleeperPicks={sleeperPicks}
          onFetchPicks={(lid: string) => {
            (async () => {
              const username = await AsyncStorage.getItem('sleeper_username');
              if (username) {
                const u = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
                fetchSleeperPicks(lid, u.user_id);
              }
            })();
          }}
          onUpdate={(updates) => setSetupData(prev => ({ ...prev, ...updates }))}
          onNext={() => {
            const steps: SetupStep[] = ['platform', 'league', 'position', 'confirm'];
            const idx = steps.indexOf(setupStep);
            if (setupData.platform === 'offline' && setupStep === 'platform') {
              setSetupData(prev => ({ ...prev, leagueName: 'Offline Draft' }));
              setSetupStep('position');
            } else if (idx < steps.length - 1) {
              setSetupStep(steps[idx + 1]);
            }
          }}
          onBack={() => {
            const steps: SetupStep[] = ['platform', 'league', 'position', 'confirm'];
            const idx = steps.indexOf(setupStep);
            if (setupData.platform === 'offline' && setupStep === 'position') {
              setSetupStep('platform');
            } else if (idx > 0) {
              setSetupStep(steps[idx - 1]);
            }
          }}
          onStart={handleStartDraft}
        />
      </SafeAreaView>
    );
  }

  if (!draftState) return null;

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]}>
      <DraftBoard
        state={draftState}
        onStateChange={(s) => { setDraftState(s); saveDraftState(s); }}
        onReset={handleResetDraft}
      />
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════
// SETUP WIZARD
// ═══════════════════════════════════════════════════════════

function SetupWizard({
  step, data, sleeperLeagues, sleeperPicks, onFetchPicks, onUpdate, onNext, onBack, onStart,
}: {
  step: SetupStep;
  data: Partial<SetupData>;
  sleeperLeagues: any[];
  sleeperPicks: string[] | null;
  onFetchPicks: (leagueId: string) => void;
  onUpdate: (u: Partial<SetupData>) => void;
  onNext: () => void;
  onBack: () => void;
  onStart: () => void;
}) {
  return (
    <ScrollView style={styles.setupScroll} contentContainerStyle={styles.setupContent}>
      {/* Header */}
      <View style={styles.setupHeader}>
        <Text style={styles.setupTitle}>DRAFT COPILOT</Text>
        <Text style={styles.setupSub}>
          {step === 'platform' && 'Choose your platform'}
          {step === 'league' && 'Select your league'}
          {step === 'position' && 'Draft settings'}
          {step === 'confirm' && 'Ready to draft'}
        </Text>
        {/* Step indicator */}
        <View style={styles.stepRow}>
          {['platform', 'league', 'position', 'confirm'].map((s, i) => (
            <View key={s} style={[
              styles.stepDot,
              s === step && styles.stepDotActive,
              (['platform', 'league', 'position', 'confirm'].indexOf(step) > i) && styles.stepDotDone,
            ]} />
          ))}
        </View>
      </View>

      {/* ── PLATFORM ── */}
      {step === 'platform' && (
        <View style={styles.setupSection}>
          {([
            { key: 'sleeper', label: 'SLEEPER', desc: 'Live auto-sync — picks update automatically', color: '#00FFF9', live: true },
            { key: 'espn', label: 'ESPN', desc: 'Companion mode — mark picks as they happen', color: '#e52534', live: false },
            { key: 'yahoo', label: 'YAHOO', desc: 'Companion mode — mark picks as they happen', color: '#7c3aed', live: false },
            { key: 'offline', label: 'OFFLINE / LIVE', desc: 'In-person draft — track picks on your phone', color: C.amber, live: false },
          ] as const).map(p => (
            <TouchableOpacity
              key={p.key}
              style={[styles.platformCard, data.platform === p.key && { borderColor: p.color }]}
              onPress={() => onUpdate({ platform: p.key as Platform })}
            >
              <View style={styles.platformRow}>
                <View style={[styles.platformDot, { backgroundColor: p.color }]} />
                <Text style={styles.platformLabel}>{p.label}</Text>
                {p.live && <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE SYNC</Text></View>}
              </View>
              <Text style={styles.platformDesc}>{p.desc}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.nextBtn, !data.platform && styles.nextBtnDisabled]}
            onPress={onNext}
            disabled={!data.platform}
          >
            <Text style={styles.nextBtnText}>CONTINUE</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── LEAGUE ── */}
      {step === 'league' && (
        <View style={styles.setupSection}>
          {data.platform === 'sleeper' && sleeperLeagues.length > 0 ? (
            <>
              {sleeperLeagues.map((lg: any) => (
                <TouchableOpacity
                  key={lg.league_id}
                  style={[styles.leagueCard, data.leagueId === lg.league_id && { borderColor: C.aqua }]}
                  onPress={async () => {
                    onUpdate({
                      leagueId: lg.league_id,
                      leagueName: lg.name,
                      teamCount: lg.total_rosters || 12,
                      scoringFormat: (lg.scoring_settings?.rec === 1 ? 'ppr' : lg.scoring_settings?.rec === 0.5 ? 'half' : 'standard'),
                      rosterSlots: lg.roster_positions || ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
                      scoringSettings: lg.scoring_settings,
                      isDynasty: lg.settings?.type === 2 || !!lg.previous_league_id,
                    } as any);
                    // Try to find an active draft
                    try {
                      const draft = await findActiveDraft(lg.league_id);
                      if (draft) {
                        const draftUpdates: any = {
                          draftId: draft.draft_id,
                          draftType: draft.type as DraftType,
                          rounds: draft.settings?.rounds || 15,
                          teamCount: draft.settings?.teams || lg.total_rosters || 12,
                        };
                        if (draft.draft_order) {
                          const username = await AsyncStorage.getItem('sleeper_username');
                          if (username) {
                            try {
                              const uRes = await fetch('https://api.sleeper.app/v1/user/' + username);
                              const u = await uRes.json();
                              const slot = draft.draft_order[u.user_id];
                              if (slot) draftUpdates.myDraftSlot = slot;
                            } catch {}
                          }
                        }
                        onUpdate(draftUpdates);
                      }
                    } catch {}
                    onFetchPicks(lg.league_id);
                  }}
                >
                  <Text style={styles.leagueName}>{lg.name}</Text>
                  <Text style={styles.leagueMeta}>{lg.total_rosters} teams · {lg.season} · {lg.scoring_settings?.rec === 1 ? 'PPR' : lg.scoring_settings?.rec === 0.5 ? 'Half PPR' : 'Standard'}</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : data.platform === 'sleeper' ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No Sleeper leagues found. Make sure your Sleeper username is set in Settings.</Text>
            </View>
          ) : (
            <View style={styles.manualLeague}>
              <Text style={styles.inputLabel}>League Name</Text>
              <TextInput
                style={styles.textInput}
                value={data.leagueName || ''}
                onChangeText={(t) => onUpdate({ leagueName: t })}
                placeholder="My Fantasy League"
                placeholderTextColor={C.textDim}
              />
              <Text style={styles.inputLabel}>Number of Teams</Text>
              <View style={styles.chipRow}>
                {[8, 10, 12, 14, 16].map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.chip, data.teamCount === n && styles.chipActive]}
                    onPress={() => onUpdate({ teamCount: n })}
                  >
                    <Text style={[styles.chipText, data.teamCount === n && styles.chipTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.inputLabel}>Scoring Format</Text>
              <View style={styles.chipRow}>
                {([['ppr', 'PPR'], ['half', 'HALF'], ['standard', 'STD']] as const).map(([val, label]) => (
                  <TouchableOpacity
                    key={val}
                    style={[styles.chip, data.scoringFormat === val && styles.chipActive]}
                    onPress={() => onUpdate({ scoringFormat: val })}
                  >
                    <Text style={[styles.chipText, data.scoringFormat === val && styles.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.navRow}>
            <TouchableOpacity style={styles.backBtn} onPress={onBack}>
              <Text style={styles.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextBtn, styles.nextBtnFlex, !data.leagueName && !data.leagueId && styles.nextBtnDisabled]}
              onPress={onNext}
              disabled={!data.leagueName && !data.leagueId}
            >
              <Text style={styles.nextBtnText}>CONTINUE</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── POSITION / SETTINGS ── */}
      {step === 'position' && (
        <View style={styles.setupSection}>
          <Text style={styles.inputLabel}>My Draft Position</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotScroll}>
            <View style={styles.chipRow}>
              {Array.from({ length: data.teamCount || 12 }, (_, i) => i + 1).map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.slotChip, data.myDraftSlot === n && styles.slotChipActive]}
                  onPress={() => onUpdate({ myDraftSlot: n })}
                >
                  <Text style={[styles.slotChipText, data.myDraftSlot === n && styles.slotChipTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={styles.inputLabel}>Draft Type</Text>
          <View style={styles.chipRow}>
            {([['snake', 'SNAKE'], ['linear', 'LINEAR'], ['auction', 'AUCTION']] as const).map(([val, label]) => (
              <TouchableOpacity
                key={val}
                style={[styles.chip, data.draftType === val && styles.chipActive]}
                onPress={() => onUpdate({ draftType: val })}
              >
                <Text style={[styles.chipText, data.draftType === val && styles.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.inputLabel}>Rounds</Text>
          <View style={styles.chipRow}>
            {[12, 14, 15, 16, 18, 20].map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.chip, data.rounds === n && styles.chipActive]}
                onPress={() => onUpdate({ rounds: n })}
              >
                <Text style={[styles.chipText, data.rounds === n && styles.chipTextActive]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {(data.myDraftSlot || sleeperPicks) && (
            <View style={styles.pickPreview}>
              <Text style={styles.pickPreviewTitle}>YOUR PICKS</Text>
              <Text style={styles.pickPreviewText}>
                {sleeperPicks
                  ? sleeperPicks.join('  ·  ')
                  : getAllPicksForSlot(
                      data.myDraftSlot || 1,
                      Math.min(data.rounds || 15, 6),
                      data.teamCount || 12,
                      data.draftType || 'snake'
                    ).map((p, i) => `R${i + 1}: #${p}`).join('  ·  ') + ((data.rounds || 15) > 6 ? '  ...' : '')
                }
              </Text>
            </View>
          )}

          <View style={styles.navRow}>
            <TouchableOpacity style={styles.backBtn} onPress={onBack}>
              <Text style={styles.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex]} onPress={onNext}>
              <Text style={styles.nextBtnText}>CONTINUE</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── CONFIRM ── */}
      {step === 'confirm' && (
        <View style={styles.setupSection}>
          <View style={styles.confirmCard}>
            <ConfirmRow label="Platform" value={(data.platform || '').toUpperCase()} />
            <ConfirmRow label="League" value={data.leagueName || '—'} />
            <ConfirmRow label="Teams" value={String(data.teamCount || 12)} />
            <ConfirmRow label="Format" value={(data.scoringFormat || 'ppr').toUpperCase()} />
            <ConfirmRow label="Draft Type" value={(data.draftType || 'snake').toUpperCase()} />
            <ConfirmRow label="Rounds" value={String(data.rounds || 15)} />
            <ConfirmRow label="My Pick" value={`#${data.myDraftSlot || 1}`} />
            {data.platform === 'sleeper' && data.draftId && (
              <ConfirmRow label="Sleeper Draft" value="Live Sync Active" highlight />
            )}
          </View>

          <View style={styles.navRow}>
            <TouchableOpacity style={styles.backBtn} onPress={onBack}>
              <Text style={styles.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.startBtn, styles.nextBtnFlex]} onPress={onStart}>
              <Text style={styles.startBtnText}>START DRAFT</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function ConfirmRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.confirmRow}>
      <Text style={styles.confirmLabel}>{label}</Text>
      <Text style={[styles.confirmValue, highlight && { color: C.aqua }]}>{value}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// DRAFT BOARD (main draft phase)
// ═══════════════════════════════════════════════════════════

function DraftBoard({
  state, onStateChange, onReset,
}: {
  state: DraftState;
  onStateChange: (s: DraftState) => void;
  onReset: () => void;
}) {
  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showRoster, setShowRoster] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [showPickLog, setShowPickLog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const insets = useSafeAreaInsets();

  // ── Sleeper live polling ──
  useEffect(() => {
    if (state.settings.platform === 'sleeper' && state.settings.draftId && state.status === 'drafting') {
      const poll = async () => {
        try {
          const [draft, picks] = await Promise.all([
            getSleeperDraft(state.settings.draftId!),
            getSleeperDraftPicks(state.settings.draftId!),
          ]);

          if (picks.length > state.picks.length) {
            // Find my roster_id from slot mapping
            const slotToRoster = draft.slot_to_roster_id || {};
            const myRosterId = slotToRoster[String(state.settings.myDraftSlot)] || -1;
            const newPicks = picks.slice(state.picks.length);
            let s = { ...state };
            for (const p of newPicks) {
              const normalized: DraftPick = {
                pickNo: p.pick_no,
                round: p.round,
                slot: p.draft_slot,
                rosterId: p.roster_id,
                playerId: p.player_id,
                playerName: `${p.metadata.first_name} ${p.metadata.last_name}`,
                position: p.metadata.position,
                team: p.metadata.team || '?',
                isMyPick: p.roster_id === myRosterId,
              };
              s = applyPick(s, normalized);
            }
            onStateChange(s);
          }

          if (draft.status === 'complete' && state.status !== 'complete') {
            onStateChange({ ...state, status: 'complete' });
          }
        } catch (e) {
          console.error('Sleeper poll error:', e);
        }
      };
      poll();
      pollRef.current = setInterval(poll, 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [state.settings.draftId, state.picks.length, state.status]);

  // ── Filter available players ──
  const filtered = useMemo(() => {
    let list = state.availablePlayers.filter(p => !p.isDrafted);
    if (posFilter !== 'ALL') list = list.filter(p => p.position === posFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.adp - b.adp);
  }, [state.availablePlayers, posFilter, search]);

  // ── Mark player as drafted (companion mode) ──
  const handleDraftPlayer = useCallback((player: PlayerInfo, isMe: boolean) => {
    const pick: DraftPick = {
      pickNo: state.currentPick,
      round: state.currentRound,
      slot: isMe ? state.settings.myDraftSlot : ((state.currentPick - 1) % state.settings.teamCount) + 1,
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      team: player.team,
      isMyPick: isMe,
    };
    onStateChange(applyPick(state, pick));
  }, [state, onStateChange]);

  // ── Undo ──
  const handleUndo = useCallback(() => {
    if (state.settings.platform === 'sleeper' && state.settings.draftId) {
      Alert.alert('Cannot Undo', 'Sleeper live drafts are synced automatically.');
      return;
    }
    onStateChange(undoLastPick(state));
  }, [state, onStateChange]);

  // ── AI Advice ──
  const handleAskAI = useCallback(async (q?: string) => {
    setShowAI(true);
    setAiLoading(true);
    setAiResponse('');
    try {
      const prompt = buildDraftPrompt(state, q || undefined);
      const res = await askAI(prompt);
      setAiResponse(res);
    } catch (e: any) {
      setAiResponse(`Error: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }, [state]);

  const isSleeperLive = state.settings.platform === 'sleeper' && !!state.settings.draftId;

  return (
    <View style={styles.draftContainer}>
      {/* ── TOP BAR ── */}
      <View style={styles.draftHeader}>
        <View style={styles.draftHeaderLeft}>
          <Text style={styles.draftHeaderTitle}>DRAFT COPILOT</Text>
          <Text style={styles.draftHeaderSub}>
            {state.settings.leagueName} · {state.settings.scoringFormat.toUpperCase()}
          </Text>
        </View>
        <View style={styles.draftHeaderRight}>
          {isSleeperLive && (
            <View style={styles.liveIndicator}>
              <View style={styles.livePulse} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
          <TouchableOpacity style={styles.headerBtn} onPress={onReset}>
            <Text style={styles.headerBtnText}>EXIT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── PICK STATUS BAR ── */}
      <View style={styles.pickStatusBar}>
        <View style={styles.pickStatusItem}>
          <Text style={styles.pickStatusLabel}>ROUND</Text>
          <Text style={styles.pickStatusValue}>{state.currentRound}/{state.settings.rounds}</Text>
        </View>
        <View style={styles.pickStatusDivider} />
        <View style={styles.pickStatusItem}>
          <Text style={styles.pickStatusLabel}>PICK</Text>
          <Text style={styles.pickStatusValue}>#{state.currentPick}</Text>
        </View>
        <View style={styles.pickStatusDivider} />
        <View style={styles.pickStatusItem}>
          <Text style={styles.pickStatusLabel}>NEXT MINE</Text>
          <Text style={[styles.pickStatusValue, state.isMyTurn && { color: C.amber }]}>
            {state.isMyTurn ? 'NOW!' : `#${state.nextMyPick}`}
          </Text>
        </View>
        <View style={styles.pickStatusDivider} />
        <View style={styles.pickStatusItem}>
          <Text style={styles.pickStatusLabel}>MY PICKS</Text>
          <Text style={styles.pickStatusValue}>{state.myRoster.length}</Text>
        </View>
      </View>

      {/* ── MY TURN BANNER ── */}
      {state.isMyTurn && (
        <View style={styles.myTurnBanner}>
          <Text style={styles.myTurnText}>YOUR PICK — Round {state.currentRound}, Pick #{state.currentPick}</Text>
        </View>
      )}

      {/* ── POSITION FILTER ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.posScroll} contentContainerStyle={styles.posScrollContent}>
        {POSITIONS.map(pos => (
          <TouchableOpacity
            key={pos}
            style={[styles.posChip, posFilter === pos && { backgroundColor: POS_COLORS[pos] || C.aqua }]}
            onPress={() => setPosFilter(pos)}
          >
            <Text style={[styles.posChipText, posFilter === pos && { color: '#000' }]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── SEARCH ── */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search players..."
          placeholderTextColor={C.textDim}
        />
        <Text style={styles.availCount}>{filtered.length} avail</Text>
      </View>

      {/* ── PLAYER BOARD ── */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={styles.playerList}
        contentContainerStyle={{ paddingBottom: 160 }}
        renderItem={({ item }) => (
          <PlayerRow
            player={item}
            isMyTurn={state.isMyTurn}
            isCompanionMode={!isSleeperLive}
            onDraftMe={() => handleDraftPlayer(item, true)}
            onDraftOther={() => handleDraftPlayer(item, false)}
          />
        )}
        initialNumToRender={20}
        maxToRenderPerBatch={15}
        windowSize={7}
      />

      {/* ── BOTTOM ACTION BAR ── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={styles.bottomBtn} onPress={() => setShowRoster(true)}>
          <Text style={styles.bottomBtnText}>MY TEAM ({state.myRoster.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomBtnAI} onPress={() => handleAskAI()}>
          <Text style={styles.bottomBtnAIText}>WHO SHOULD I PICK?</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomBtn} onPress={() => setShowPickLog(true)}>
          <Text style={styles.bottomBtnText}>LOG</Text>
        </TouchableOpacity>
        {!isSleeperLive && (
          <TouchableOpacity style={styles.bottomBtnUndo} onPress={handleUndo}>
            <Text style={styles.bottomBtnText}>UNDO</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── MY ROSTER MODAL ── */}
      <Modal visible={showRoster} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>MY ROSTER</Text>
              <TouchableOpacity onPress={() => setShowRoster(false)}>
                <Text style={styles.modalClose}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {state.myRoster.length === 0 ? (
                <Text style={styles.emptyText}>No picks yet</Text>
              ) : (
                state.myRoster.map((pick, i) => (
                  <View key={pick.pickNo} style={styles.rosterRow}>
                    <View style={[styles.rosterPosBadge, { backgroundColor: POS_COLORS[pick.position] || C.textDim }]}>
                      <Text style={styles.rosterPosText}>{pick.position}</Text>
                    </View>
                    <View style={styles.rosterInfo}>
                      <Text style={styles.rosterName}>{pick.playerName}</Text>
                      <Text style={styles.rosterMeta}>{pick.team} · R{pick.round} Pick #{pick.pickNo}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── AI ADVICE MODAL ── */}
      <Modal visible={showAI} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={RNPlatform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>AI DRAFT ADVICE</Text>
              <TouchableOpacity onPress={() => setShowAI(false)}>
                <Text style={styles.modalClose}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.aiScroll}>
              {aiLoading ? (
                <View style={styles.aiLoadingWrap}>
                  <ActivityIndicator color={C.amber} size="large" />
                  <Text style={styles.aiLoadingText}>Analyzing your draft...</Text>
                </View>
              ) : (
                <Text style={styles.aiResponseText}>{aiResponse}</Text>
              )}
            </ScrollView>
            <View style={styles.aiInputRow}>
              <TextInput
                style={styles.aiInput}
                value={aiQuestion}
                onChangeText={setAiQuestion}
                placeholder="Ask about specific players..."
                placeholderTextColor={C.textDim}
              />
              <TouchableOpacity
                style={styles.aiSendBtn}
                onPress={() => {
                  if (aiQuestion.trim()) {
                    handleAskAI(aiQuestion.trim());
                    setAiQuestion('');
                  }
                }}
              >
                <Text style={styles.aiSendText}>ASK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── PICK LOG MODAL ── */}
      <Modal visible={showPickLog} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>PICK LOG</Text>
              <TouchableOpacity onPress={() => setShowPickLog(false)}>
                <Text style={styles.modalClose}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {state.picks.length === 0 ? (
                <Text style={styles.emptyText}>No picks yet</Text>
              ) : (
                [...state.picks].reverse().map(pick => (
                  <View key={pick.pickNo} style={[styles.logRow, pick.isMyPick && styles.logRowMine]}>
                    <Text style={styles.logPick}>#{pick.pickNo}</Text>
                    <View style={[styles.logPosBadge, { backgroundColor: POS_COLORS[pick.position] || C.textDim }]}>
                      <Text style={styles.logPosText}>{pick.position}</Text>
                    </View>
                    <Text style={styles.logName}>{pick.playerName}</Text>
                    <Text style={styles.logTeam}>{pick.team}</Text>
                    {pick.isMyPick && <Text style={styles.logMine}>YOU</Text>}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// PLAYER ROW
// ═══════════════════════════════════════════════════════════

function PlayerRow({
  player, isMyTurn, isCompanionMode, onDraftMe, onDraftOther,
}: {
  player: PlayerInfo;
  isMyTurn: boolean;
  isCompanionMode: boolean;
  onDraftMe: () => void;
  onDraftOther: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={styles.playerRow}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.playerMain}>
        <Text style={[styles.playerRank, { color: player.tier <= 2 ? C.amber : C.textDim }]}>
          {player.rank}
        </Text>
        <View style={[styles.playerPosBadge, { backgroundColor: POS_COLORS[player.position] || C.textDim }]}>
          <Text style={styles.playerPosText}>{player.position}</Text>
        </View>
        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>{player.name}</Text>
          <Text style={styles.playerMeta}>{player.team} · BYE {player.byeWeek} · ADP {player.adp}</Text>
        </View>
        {player.tier === 1 && <Text style={styles.tierStar}>★</Text>}
      </View>

      {expanded && (
        <View style={styles.playerActions}>
          {isCompanionMode && (
            <TouchableOpacity style={styles.draftOtherBtn} onPress={onDraftOther}>
              <Text style={styles.draftOtherText}>DRAFTED (OTHER)</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.draftMeBtn, isMyTurn && styles.draftMeBtnActive]}
            onPress={onDraftMe}
          >
            <Text style={[styles.draftMeText, isMyTurn && styles.draftMeTextActive]}>
              {isMyTurn ? 'DRAFT THIS PLAYER' : 'I PICKED THIS'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  draftContainer: {
    flex: 1,
  },

  // ── Setup ──
  setupScroll: { flex: 1 },
  setupContent: { padding: 20, paddingBottom: 60 },
  setupHeader: { alignItems: 'center', marginBottom: 32, marginTop: 12 },
  setupTitle: {
    fontFamily: F.heading,
    fontSize: 36,
    color: C.amber,
    letterSpacing: 2,
  },
  setupSub: {
    fontFamily: F.body,
    fontSize: 15,
    color: C.textDim,
    marginTop: 4,
  },
  stepRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: C.border,
  },
  stepDotActive: { backgroundColor: C.amber, width: 24 },
  stepDotDone: { backgroundColor: C.aqua },
  setupSection: { gap: 12 },

  // ── Platform cards ──
  platformCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: C.border,
  },
  platformRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  platformDot: { width: 10, height: 10, borderRadius: 5 },
  platformLabel: {
    fontFamily: F.bodyB,
    fontSize: 16,
    color: C.text,
    letterSpacing: 1,
  },
  platformDesc: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.textDim,
  },
  liveBadge: {
    backgroundColor: C.aqua,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  liveBadgeText: {
    fontFamily: F.data,
    fontSize: 9,
    color: '#000',
    letterSpacing: 1,
  },

  // ── League cards ──
  leagueCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: C.border,
  },
  leagueName: {
    fontFamily: F.bodyB,
    fontSize: 16,
    color: C.text,
    marginBottom: 4,
  },
  leagueMeta: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.textDim,
  },

  // ── Manual league ──
  manualLeague: { gap: 12 },
  inputLabel: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.aqua,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  textInput: {
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    color: C.text,
    fontFamily: F.body,
    fontSize: 15,
  },

  // ── Chips ──
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipActive: {
    backgroundColor: C.amber,
    borderColor: C.amber,
  },
  chipText: {
    fontFamily: F.data,
    fontSize: 13,
    color: C.textDim,
  },
  chipTextActive: { color: '#000' },
  slotScroll: { maxHeight: 55 },
  slotChip: {
    width: 42, height: 42,
    borderRadius: 21,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  slotChipActive: {
    backgroundColor: C.amber,
    borderColor: C.amber,
  },
  slotChipText: {
    fontFamily: F.data,
    fontSize: 14,
    color: C.textDim,
  },
  slotChipTextActive: { color: '#000', fontWeight: '700' },

  // ── Pick preview ──
  pickPreview: {
    backgroundColor: C.muted,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  pickPreviewTitle: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.aqua,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  pickPreviewText: {
    fontFamily: F.data,
    fontSize: 13,
    color: C.text,
    lineHeight: 22,
  },

  // ── Confirm ──
  confirmCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  confirmLabel: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.textDim,
    letterSpacing: 0.5,
  },
  confirmValue: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: C.text,
  },

  // ── Nav buttons ──
  navRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  nextBtn: {
    backgroundColor: C.amber,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextBtnFlex: { flex: 1 },
  nextBtnDisabled: { opacity: 0.35 },
  nextBtnText: {
    fontFamily: F.bodyB,
    fontSize: 16,
    color: '#000',
    letterSpacing: 1,
  },
  backBtn: {
    backgroundColor: C.card,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: C.border,
  },
  backBtnText: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: C.textDim,
    letterSpacing: 1,
  },
  startBtn: {
    backgroundColor: C.aqua,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: {
    fontFamily: F.bodyB,
    fontSize: 18,
    color: '#000',
    letterSpacing: 2,
  },

  // ── Empty state ──
  emptyState: { padding: 24, alignItems: 'center' },
  emptyText: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.textDim,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // ── Draft Header ──
  draftHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  draftHeaderLeft: {},
  draftHeaderTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: C.amber,
    letterSpacing: 1,
  },
  draftHeaderSub: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.textDim,
    letterSpacing: 0.5,
  },
  draftHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(27,231,255,0.12)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  livePulse: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.aqua,
  },
  liveText: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.aqua,
    letterSpacing: 1,
  },
  headerBtn: {
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  headerBtnText: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    letterSpacing: 1,
  },

  // ── Pick Status ──
  pickStatusBar: {
    flexDirection: 'row',
    backgroundColor: C.card,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  pickStatusItem: { flex: 1, alignItems: 'center' },
  pickStatusLabel: {
    fontFamily: F.data,
    fontSize: 9,
    color: C.textDim,
    letterSpacing: 1,
  },
  pickStatusValue: {
    fontFamily: F.heading,
    fontSize: 18,
    color: C.text,
    marginTop: 2,
  },
  pickStatusDivider: {
    width: 1,
    height: 28,
    backgroundColor: C.border,
  },

  // ── My Turn Banner ──
  myTurnBanner: {
    backgroundColor: C.amber,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  myTurnText: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: '#000',
    letterSpacing: 1,
  },

  // ── Position filter ──
  posScroll: { marginTop: 10, maxHeight: 40 },
  posScrollContent: { paddingHorizontal: 12, gap: 6, flexDirection: 'row' },
  posChip: {
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
  },
  posChipText: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.textDim,
    letterSpacing: 1,
  },

  // ── Search ──
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginTop: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.text,
    fontFamily: F.body,
    fontSize: 14,
  },
  availCount: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
  },

  // ── Player List ──
  playerList: {
    flex: 1,
    marginTop: 6,
  },
  playerRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  playerMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerRank: {
    fontFamily: F.data,
    fontSize: 12,
    width: 26,
    textAlign: 'right',
  },
  playerPosBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 30,
    alignItems: 'center',
  },
  playerPosText: {
    fontFamily: F.data,
    fontSize: 10,
    color: '#000',
    fontWeight: '700',
  },
  playerInfo: { flex: 1 },
  playerName: {
    fontFamily: F.bodyB,
    fontSize: 15,
    color: C.text,
  },
  playerMeta: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    marginTop: 1,
  },
  tierStar: {
    fontFamily: F.heading,
    fontSize: 18,
    color: C.amber,
  },
  playerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingLeft: 34,
  },
  draftOtherBtn: {
    flex: 1,
    backgroundColor: C.muted,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  draftOtherText: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    letterSpacing: 0.5,
  },
  draftMeBtn: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.aqua,
  },
  draftMeBtnActive: {
    backgroundColor: C.amber,
    borderColor: C.amber,
  },
  draftMeText: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.aqua,
    letterSpacing: 0.5,
  },
  draftMeTextActive: { color: '#000' },

  // ── Bottom Bar ──
  bottomBar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bottomBtn: {
    backgroundColor: C.card,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  bottomBtnText: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.textDim,
    letterSpacing: 0.5,
  },
  bottomBtnAI: {
    flex: 1,
    backgroundColor: C.amber,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  bottomBtnAIText: {
    fontFamily: F.bodyB,
    fontSize: 13,
    color: '#000',
    letterSpacing: 1,
  },
  bottomBtnUndo: {
    backgroundColor: C.muted,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },

  // ── Modals ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10,18,20,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: C.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: C.amber,
    letterSpacing: 1,
  },
  modalClose: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.aqua,
    letterSpacing: 1,
  },

  // ── Roster rows ──
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rosterPosBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 36,
    alignItems: 'center',
  },
  rosterPosText: {
    fontFamily: F.data,
    fontSize: 10,
    color: '#000',
    fontWeight: '700',
  },
  rosterInfo: { flex: 1 },
  rosterName: {
    fontFamily: F.bodyB,
    fontSize: 15,
    color: C.text,
  },
  rosterMeta: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    marginTop: 1,
  },

  // ── AI modal ──
  aiScroll: { paddingHorizontal: 20, paddingVertical: 16, maxHeight: 350 },
  aiLoadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 16 },
  aiLoadingText: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.textDim,
  },
  aiResponseText: {
    fontFamily: F.body,
    fontSize: 15,
    color: C.text,
    lineHeight: 24,
  },
  aiInputRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  aiInput: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.text,
    fontFamily: F.body,
    fontSize: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  aiSendBtn: {
    backgroundColor: C.amber,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  aiSendText: {
    fontFamily: F.bodyB,
    fontSize: 13,
    color: '#000',
    letterSpacing: 1,
  },

  // ── Pick log ──
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  logRowMine: {
    backgroundColor: 'rgba(255,184,0,0.06)',
  },
  logPick: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.textDim,
    width: 30,
  },
  logPosBadge: {
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 28,
    alignItems: 'center',
  },
  logPosText: {
    fontFamily: F.data,
    fontSize: 9,
    color: '#000',
    fontWeight: '700',
  },
  logName: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  logTeam: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
  },
  logMine: {
    fontFamily: F.data,
    fontSize: 9,
    color: C.amber,
    letterSpacing: 1,
    marginLeft: 4,
  },
});