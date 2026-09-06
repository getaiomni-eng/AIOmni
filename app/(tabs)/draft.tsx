// app/(tabs)/draft.tsx
// AIOmni The O — Draft Intelligence (V7 Dark Theme)
// Sleeper: auto-sync live picks | ESPN/Yahoo/Offline: companion mode

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNFLSeason } from '../../services/season';
import { normalizePlayerName } from '../../services/util/normalizeName';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, KeyboardAvoidingView, Modal, Platform as RNPlatform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI, describeAIError, hasAISession } from '../../services/ai';
import { hasAIConsent } from '../../services/aiConsent';
import { getCurrentTier } from '../../services/purchases';
import { consumePrompt } from '../../services/promptQuota';
import { useRouter } from 'expo-router';
import { applyEngineToDraftPool, draftSettingsToUIFormat } from '../../services/rankings/draftPool';
import { TheOLogo, ApertureO } from '../components/TheOLogo';
import { CLASS_OF_2025_TEXT } from '../../services/seasonContext2026';
import { readableText, useTheme, type ThemeTokens } from '../constants/theme';
import { Alert } from '../../services/util/crossAlert';
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
    refreshResumedPool,
    saveDraftState,
    undoLastPick
} from '../../services/draft';

// Draft-setup option lists.
//
// v2026-08-28: team count was capped at 16 while the position picker is
// generated from teamCount — so an 18-team league linked from a platform
// (MFL guillotine leagues are routinely 18-20) rendered position chips up
// to 18 with NO matching team chip, and tapping any team chip silently
// shrank the user's league. Large sizes are now first-class, and any
// non-standard count carried in from a platform is spliced in so the
// user's real league is always representable. Rounds start at 10 —
// shallow/guillotine formats draft fewer than 12.
const BASE_TEAM_OPTIONS = [8, 10, 12, 14, 16, 18, 20];
const BASE_ROUND_OPTIONS = [10, 12, 14, 15, 16, 18, 20];

const withCurrent = (base: number[], current?: number): number[] =>
  current && !base.includes(current)
    ? [...base, current].sort((a, b) => a - b)
    : base;

const teamOptions  = (current?: number) => withCurrent(BASE_TEAM_OPTIONS, current);
const roundOptions = (current?: number) => withCurrent(BASE_ROUND_OPTIONS, current);

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

// ─── LEAGUE-AWARE POSITION FILTERING ───────────────────────
// Each starting roster slot maps to the player positions it can hold. We use
// this to restrict the draftable pool to positions the league actually starts:
// it drops team D/ST in no-defense leagues AND non-fantasy positions (punters,
// OL, long snappers, etc.) that leak in from the live Sleeper player feed.
const SLOT_POSITION_MAP: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'],
  DEF: ['DEF'], DST: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  SF: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
  DL: ['DL'], LB: ['LB'], DB: ['DB'],
};
// Bench-type slots hold any startable position, so they don't widen the set.
const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI', 'RES']);

function normalizeSlot(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[\s/]/g, '');
}

// Canonical fantasy position for a pool player (sources spell these various
// ways: 'Def'/'DST'/'D/ST', 'PK' for kicker, 'FB' rosters as a RB).
function normalizePosition(pos?: string): string {
  const u = normalizeSlot(pos ?? '');
  if (u === 'DST' || u === 'DEF') return 'DEF';
  if (u === 'PK') return 'K';
  if (u === 'FB') return 'RB';
  return u;
}

// Positions the league can start, derived from its starting slots. Returns null
// when indeterminate (empty/unknown slots) so callers fail open rather than
// emptying the pool.
function allowedDraftPositions(rosterSlots: string[] = []): Set<string> | null {
  const allowed = new Set<string>();
  for (const raw of rosterSlots) {
    const s = normalizeSlot(raw);
    if (BENCH_SLOTS.has(s)) continue;
    const mapped = SLOT_POSITION_MAP[s];
    if (mapped) mapped.forEach(p => allowed.add(p));
  }
  return allowed.size > 0 ? allowed : null;
}

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
  const { t } = useTheme();
  const sty = useMemo(() => makeStyles(t), [t]);

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
  const [fleaflickerLeagues, setFleaflickerLeagues] = useState<any[]>([]);
  const [mflLeagues, setMflLeagues] = useState<any[]>([]);

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
            { text: 'Resume', onPress: () => {
              // Enter immediately on the saved board, then swap in a
              // refreshed pool. A resumed draft otherwise keeps whatever
              // player list it was created with — new/expanded pools
              // never reached drafts already in progress.
              setDraftState(saved);
              setPhase('draft');
              (async () => {
                const refreshed = await refreshResumedPool(saved);
                if (refreshed.availablePlayers.length !== saved.availablePlayers.length) {
                  setDraftState(refreshed);
                  void saveDraftState(refreshed);
                }
              })();
            } },
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
    } else if (setupData.platform === 'fleaflicker') {
      (async () => {
        try {
          const { getPlatform } = require('../../services/platform');
          const plat = getPlatform('fleaflicker');
          const leagues = await plat.getLeagues();
          setFleaflickerLeagues(leagues || []);
        } catch (e) {
          console.error('Failed to load Fleaflicker leagues:', e);
        }
      })();
    } else if (setupData.platform === 'mfl') {
      (async () => {
        try {
          const { getPlatform } = require('../../services/platform');
          const plat = getPlatform('mfl');
          const leagues = await plat.getLeagues();
          setMflLeagues(leagues || []);
        } catch (e) {
          console.error('Failed to load MFL leagues:', e);
        }
      })();
    }
  }, [setupData.platform]);


  const fetchSleeperPicks = async (leagueId: string, userId: string) => {
    try {
      const [rostersRes, tradedRes, draftsRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`),
      ]);
      const rosters = await rostersRes.json();
      const tradedPicks = await tradedRes.json();
      const drafts = await draftsRes.json();
      const myRoster = rosters.find((r: any) => r.owner_id === userId);
      if (!myRoster) return;

      const myRosterId = myRoster.roster_id;
      const season = await getNFLSeason();
      const totalRounds = setupData.rounds || 4;

      // v2026-08-09: prefer the league's REAL draft for slot + order.
      // draft_order maps user_id → slot and draft.type says snake/linear.
      // The standings-derived order below is only a fallback for rookie
      // drafts whose order isn't set yet — using it for a startup draft
      // put EVERY user at slot 1 (fresh leagues are all 0–0, so the
      // sort is arbitrary), and the preview showed "1.01 · 2.01 · …"
      // regardless of the user's actual slot.
      const liveDraft = Array.isArray(drafts)
        ? drafts.find((d: any) => d?.draft_order?.[userId] != null)
        : null;
      const mySlotFromDraft: number | null = liveDraft?.draft_order?.[userId] ?? null;
      const isSnake = (liveDraft?.type ?? 'snake') === 'snake';
      const draftTeams = liveDraft?.settings?.teams ?? rosters.length ?? 12;

      // Build draft order from standings (worst record = pick 1)
      const draftOrder = [...rosters].sort((a: any, b: any) => {
        const aW = a.settings?.wins ?? 0, bW = b.settings?.wins ?? 0;
        if (aW !== bW) return aW - bW;
        return (a.settings?.fpts ?? 0) - (b.settings?.fpts ?? 0);
      });
      const positionMap = new Map<number, number>();
      draftOrder.forEach((r: any, i: number) => positionMap.set(r.roster_id, i + 1));
      // The draft's slot_to_roster_id is authoritative when present —
      // overwrite the standings guess with real slots.
      if (liveDraft?.slot_to_roster_id) {
        for (const [slot, rid] of Object.entries(liveDraft.slot_to_roster_id)) {
          if (rid != null) positionMap.set(Number(rid), Number(slot));
        }
      }

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

      // Build final pick list with pick numbers (e.g. "4.10").
      // No `|| 1` fallback: if we can't determine the slot, showing no
      // preview beats confidently showing slot 1's picks.
      const myPosition = mySlotFromDraft ?? positionMap.get(myRosterId);
      if (!myPosition) { setSleeperPicks(null); return; }
      const picks: { round: number; pick: number; label: string }[] = [];

      // Own picks that weren't traded away. Snake drafts reverse even
      // rounds (slot 3 of 12 → 1.03, 2.10, 3.03 …); rookie drafts are
      // typically linear and keep the same slot every round.
      for (let rd = 1; rd <= totalRounds; rd++) {
        if (!lostRounds.has(rd)) {
          const slotThisRound = isSnake && rd % 2 === 0
            ? draftTeams - myPosition + 1
            : myPosition;
          const pickNum = String(slotThisRound).padStart(2, '0');
          picks.push({ round: rd, pick: slotThisRound, label: `${rd}.${pickNum}` });
        }
      }

      // Acquired picks with the original team's draft position. Unknown
      // origin slot → round-only label ("R3"), never a fabricated slot.
      for (const ap of acquiredPicks) {
        const fromPos = positionMap.get(ap.fromRosterId);
        if (!fromPos) {
          picks.push({ round: ap.round, pick: 99, label: `R${ap.round}` });
          continue;
        }
        const slotThisRound = isSnake && ap.round % 2 === 0
          ? draftTeams - fromPos + 1
          : fromPos;
        const pickNum = String(slotThisRound).padStart(2, '0');
        picks.push({ round: ap.round, pick: slotThisRound, label: `${ap.round}.${pickNum}` });
      }

      // Sort by round then pick
      picks.sort((a, b) => a.round !== b.round ? a.round - b.round : a.pick - b.pick);

      setSleeperPicks(picks.length > 0 ? picks.map(p => p.label) : null);
      // Reflect the real Sleeper slot (and draft type) in the manual
      // controls so the chips agree with the preview instead of sitting
      // on a stale selection the preview ignores.
      setSetupData(prev => ({
        ...prev,
        myDraftSlot: myPosition,
        ...(liveDraft?.type === 'linear' || liveDraft?.type === 'auction'
          ? { draftType: liveDraft.type as 'linear' | 'auction' }
          : {}),
      }));
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
      isDynasty: (setupData as any).isDynasty === true,
    };
    // Load live ADP data (falls back to static DB if offline)
      const isDynasty = (setupData as any).isDynasty === true;
      const totalSlots = settings.rosterSlots?.length ?? 0;
      // Conservative detection: rookie mode ONLY if league is known dynasty.
      // Non-dynasty leagues default to redraft regardless of draft format —
      // a short linear draft in a redraft league just means mock/snake drafts.
      const draftMode: 'startup' | 'rookie' | 'redraft' =
        isDynasty && settings.rounds <= 6 ? 'rookie'
        : isDynasty && settings.rounds >= 15 ? 'startup'
        : 'redraft';
      settings.draftMode = draftMode;   // surfaced to the Coach prompt
      let liveDB = await loadLivePlayerDB(draftMode);
      // Overlay AIOmni engine rankings + user overrides onto the base pool.
      // Skipped for rookie drafts (engine doesn't score 2026 prospects).
      if (draftMode !== 'rookie') {
        const uiFormat = draftSettingsToUIFormat({
          scoringFormat: settings.scoringFormat,
          rosterSlots: settings.rosterSlots,
          isDynasty,
        });
        const leagueIdForOverrides = settings.leagueId && settings.leagueId !== 'offline'
          ? settings.leagueId
          : null;
        liveDB = await applyEngineToDraftPool(liveDB, uiFormat, leagueIdForOverrides);
      }
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
      } else if ((settings.platform === 'fleaflicker' || settings.platform === 'mfl')
                 && settings.leagueId && settings.leagueId !== 'offline') {
        // FF/MFL don't share Sleeper's player IDs, so name-matching is the
        // only reliable join key. Two branches:
        //
        //   rookie/startup  → replace the top-200 NFL pool with the league's
        //     ACTUAL free-agent list from the platform abstraction (deeper
        //     bench guys never appear in a top-200 ADP but are real FAs in
        //     a 25-keeper dynasty). Merge those FAs after the prospect block
        //     so incoming rookies still lead. Then strip any leftover NFL
        //     entries from loadLivePlayerDB that happen to be rostered.
        //
        //   redraft       → just mark rostered players isDrafted=true so
        //     they show greyed out, same as the Sleeper branch.
        // Uses the shared pure-string normalize to avoid the Hermes
        // regex-during-GC crash that hit big rostered-player lists.
        const normalize = normalizePlayerName;
        try {
          const { getPlatform } = require('../../services/platform');
          const plat = getPlatform(settings.platform);

          if (draftMode === 'rookie' || draftMode === 'startup') {
            // Pull the real league FAs (paginates through FF's player
            // listing under the hood; default request now returns ~300).
            const fas: any[] = await plat.getAvailablePlayers(settings.leagueId, { limit: 300 }).catch(() => []);
            const existingKeys = new Set(liveDB.map(p => normalize(p.name)));
            const faPlayerInfos: PlayerInfo[] = fas
              .filter(p => p?.name && !existingKeys.has(normalize(p.name)))
              .map((p, i) => ({
                id:       String(p.id ?? `ff_fa_${i}`),
                name:     p.name,
                position: p.position || '?',
                team:     p.team || 'FA',
                adp:      liveDB.length + i + 1, // sort after prospects
                byeWeek:  0,
                tier:     undefined,
                rank:     liveDB.length + i + 1,
                isDrafted: false,
              }));
            liveDB = [...liveDB, ...faPlayerInfos];

            // Still need to strip the top-200 NFL entries that are rostered,
            // since those were merged in by loadLivePlayerDB.
            const rosters = await plat.getAllRosters(settings.leagueId).catch(() => []);
            const rosteredNames = new Set<string>();
            for (const r of rosters || []) {
              const slots = [...(r.starters || []), ...(r.bench || []), ...(r.ir || [])];
              for (const s of slots) {
                const nm = s?.player?.name;
                if (nm) rosteredNames.add(normalize(nm));
              }
            }
            if (rosteredNames.size > 0) {
              liveDB = liveDB.filter(p => !rosteredNames.has(normalize(p.name)));
            }
          } else {
            // Redraft: just mark rostered players as drafted.
            const rosters = await plat.getAllRosters(settings.leagueId).catch(() => []);
            const rosteredNames = new Set<string>();
            for (const r of rosters || []) {
              const slots = [...(r.starters || []), ...(r.bench || []), ...(r.ir || [])];
              for (const s of slots) {
                const nm = s?.player?.name;
                if (nm) rosteredNames.add(normalize(nm));
              }
            }
            liveDB = liveDB.map(p => rosteredNames.has(normalize(p.name)) ? { ...p, isDrafted: true } : p);
          }
        } catch (e) { console.log('FF/MFL pool build error:', e); }
      }
      // Restrict the draftable pool to positions the league actually starts:
      // drops team D/ST in no-defense leagues and non-fantasy positions
      // (punters, OL, etc.) that leak in from the live Sleeper player feed.
      // Players with an unknown/blank position are kept (fail open) so we never
      // silently drop a real FA whose position didn't come through.
      const allowedPositions = allowedDraftPositions(settings.rosterSlots);
      if (allowedPositions) {
        liveDB = liveDB.filter(p => {
          const pos = normalizePosition(p.position);
          return !pos || pos === '?' || allowedPositions.has(pos);
        });
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
          setSleeperPicks(null);
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
      <SafeAreaView style={[sty.container, { paddingBottom: insets.bottom }]}>
        <SetupWizard
          step={setupStep}
          data={setupData}
          sleeperLeagues={sleeperLeagues}
          sleeperPicks={sleeperPicks}
          fleaflickerLeagues={fleaflickerLeagues}
          mflLeagues={mflLeagues}
          onFetchPicks={(lid: string) => {
            (async () => {
              const username = await AsyncStorage.getItem('sleeper_username');
              if (username) {
                const u = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
                fetchSleeperPicks(lid, u.user_id);
              }
            })();
          }}
          onUpdate={(updates) => {
            // v2026-08-09: the Sleeper-derived pick list only stays valid
            // while the user is on the exact Sleeper league it came from.
            // Any manual change that contradicts it — different position,
            // different draft type, different platform/league (incl. the
            // offline flow) — clears it so the preview recomputes from
            // the controls. Before this, the stale list leaked across
            // flows: the offline draft showed the previous Sleeper
            // league's picks no matter what was selected.
            if (
              updates.myDraftSlot !== undefined ||
              updates.draftType !== undefined ||
              updates.teamCount !== undefined ||
              updates.platform !== undefined ||
              updates.leagueId !== undefined
            ) setSleeperPicks(null);
            setSetupData(prev => ({ ...prev, ...updates }));
          }}
          onNext={(platformOverride?: Platform) => {
            const steps: SetupStep[] = ['platform', 'league', 'position', 'confirm'];
            const idx = steps.indexOf(setupStep);
            // platformOverride lets the platform-step tiles auto-advance
            // without waiting for the setSetupData batch to flush; without
            // it, reading setupData.platform here would see the stale value.
            const effectivePlatform = platformOverride ?? setupData.platform;
            if (effectivePlatform === 'offline' && setupStep === 'platform') {
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
    <SafeAreaView style={[sty.container, { paddingBottom: insets.bottom }]}>
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
  step, data, sleeperLeagues, sleeperPicks, fleaflickerLeagues, mflLeagues, onFetchPicks, onUpdate, onNext, onBack, onStart,
}: {
  step: SetupStep;
  data: Partial<SetupData>;
  sleeperLeagues: any[];
  sleeperPicks: string[] | null;
  fleaflickerLeagues: any[];
  mflLeagues: any[];
  onFetchPicks: (leagueId: string) => void;
  onUpdate: (u: Partial<SetupData>) => void;
  onNext: (platformOverride?: Platform) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const { t } = useTheme();
  const sty = useMemo(() => makeStyles(t), [t]);

  return (
    <ScrollView style={sty.setupScroll} contentContainerStyle={sty.setupContent}>
      {/* Header */}
      <View style={sty.setupHeader}>
        <TheOLogo fontSize={36} color="#f0f4f5" />
        <Text style={sty.setupSub}>
          {step === 'platform' && (
            <>
              {'Runs alongside your real draft'}
              {'\n'}
              <Text style={{ color: '#7a9eaa' }}>{'Choose where your draft is happening'}</Text>
            </>
          )}
          {step === 'league' && 'Select your league'}
          {step === 'position' && 'Draft settings'}
          {step === 'confirm' && 'Ready to draft'}
        </Text>
        {/* Step indicator */}
        <View style={sty.stepRow}>
          {['platform', 'league', 'position', 'confirm'].map((s, i) => (
            <View key={s} style={[
              sty.stepDot,
              s === step && sty.stepDotActive,
              (['platform', 'league', 'position', 'confirm'].indexOf(step) > i) && sty.stepDotDone,
            ]} />
          ))}
        </View>
      </View>

      {/* ── PLATFORM ── */}
      {step === 'platform' && (
        <View style={sty.setupSection}>
          {([
            { key: 'sleeper', label: 'SLEEPER', desc: 'Live auto-sync — picks update automatically', color: '#00FFF9', live: true },
            { key: 'espn', label: 'ESPN', desc: 'Open ESPN to draft — tap picks here as they happen', color: '#e52534', live: false },
            { key: 'yahoo', label: 'YAHOO', desc: 'Open Yahoo to draft — tap picks here as they happen', color: '#7c3aed', live: false },
            { key: 'fleaflicker', label: 'FLEAFLICKER', desc: 'Open Fleaflicker to draft — tap picks here as they happen', color: '#ff7a00', live: false },
            { key: 'mfl', label: 'MFL', desc: 'Open MyFantasyLeague to draft — tap picks here as they happen', color: '#e4ff1a', live: false },
            { key: 'offline', label: 'OFFLINE / LIVE', desc: 'In-person draft — track picks on your phone', color: t.warnText, live: false },
          ] as const).map(p => (
            <TouchableOpacity
              key={p.key}
              style={[sty.platformCard, data.platform === p.key && { borderColor: p.color }]}
              onPress={() => {
                // Auto-advance: with 6 platform tiles the CONTINUE button gets
                // pushed below the fold on a 6.1" screen. One-tap-to-advance is
                // also the more intuitive UX. Pass the chosen platform directly
                // to onNext so the handler doesn't have to wait for state to
                // batch-flush before reading it.
                onUpdate({ platform: p.key as Platform });
                onNext(p.key as Platform);
              }}
            >
              <View style={sty.platformRow}>
                <View style={[sty.platformDot, { backgroundColor: p.color }]} />
                <Text style={sty.platformLabel}>{p.label}</Text>
                {p.live && <View style={sty.liveBadge}><Text style={sty.liveBadgeText}>LIVE SYNC</Text></View>}
              </View>
              <Text style={sty.platformDesc}>{p.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── LEAGUE ── */}
      {step === 'league' && (
        <View style={sty.setupSection}>
          {data.platform === 'sleeper' && sleeperLeagues.length > 0 ? (
            <>
              {sleeperLeagues.map((lg: any) => (
                <TouchableOpacity
                  key={lg.league_id}
                  style={[sty.leagueCard, data.leagueId === lg.league_id && { borderColor: t.accentText }]}
                  onPress={async () => {
                    onUpdate({
                      leagueId: lg.league_id,
                      leagueName: lg.name,
                      teamCount: lg.total_rosters || 12,
                      scoringFormat: (lg.scoring_settings?.rec === 1 ? 'ppr' : lg.scoring_settings?.rec === 0.5 ? 'half' : 'standard'),
                      rosterSlots: lg.roster_positions || ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
                      scoringSettings: lg.scoring_settings,
                      // Sleeper settings.type: 0=redraft, 1=keeper, 2=dynasty.
                      // Keeper (1) carries rosters over too, so it must count as
                      // dynasty-like or a short keeper draft falls into redraft
                      // mode and the kept players gut the board down to FAs.
                      isDynasty: lg.settings?.type === 2 || lg.settings?.type === 1 || !!lg.previous_league_id,
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
                  <Text style={sty.leagueName}>{lg.name}</Text>
                  <Text style={sty.leagueMeta}>{lg.total_rosters} teams · {lg.season} · {lg.scoring_settings?.rec === 1 ? 'PPR' : lg.scoring_settings?.rec === 0.5 ? 'Half PPR' : 'Standard'}</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : data.platform === 'sleeper' ? (
            <View style={sty.emptyState}>
              <Text style={sty.emptyText}>No Sleeper leagues found. Make sure your Sleeper username is set in Settings.</Text>
            </View>
          ) : data.platform === 'fleaflicker' && fleaflickerLeagues.length > 0 ? (
            <>
              {fleaflickerLeagues.map((lg: any) => (
                <TouchableOpacity
                  key={lg.id}
                  style={[sty.leagueCard, data.leagueId === lg.id && { borderColor: t.accentText }]}
                  onPress={async () => {
                    onUpdate({
                      leagueId:      lg.id,
                      leagueName:    lg.name,
                      teamCount:     lg.teamCount || 12,
                      scoringFormat: (lg.scoringFormat === 'ppr' ? 'ppr' : lg.scoringFormat === 'half' ? 'half' : 'standard'),
                      isDynasty:     lg.leagueType === 'dynasty',
                    } as any);
                    // Pull the actual draft schedule from Fleaflicker so the
                    // Ready-to-draft screen shows real rounds/type/slot
                    // instead of the hardcoded 15-round snake defaults.
                    try {
                      const { getPlatform } = require('../../services/platform');
                      const plat = getPlatform('fleaflicker');
                      const draft = await plat.getDraft(lg.id);
                      if (draft) {
                        onUpdate({
                          draftType:   draft.type,
                          rounds:      draft.rounds,
                          teamCount:   draft.teamCount,
                          myDraftSlot: draft.myDraftSlot ?? 1,
                        } as any);
                      }
                    } catch (e) { console.log('FF getDraft error:', e); }
                  }}
                >
                  <Text style={sty.leagueName}>{lg.name}</Text>
                  <Text style={sty.leagueMeta}>
                    {lg.teamCount} teams · {lg.season} · {lg.scoringFormat === 'ppr' ? 'PPR' : lg.scoringFormat === 'half' ? 'Half PPR' : 'Standard'}{lg.leagueType === 'dynasty' ? ' · Dynasty' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : data.platform === 'fleaflicker' ? (
            <View style={sty.emptyState}>
              <Text style={sty.emptyText}>No Fleaflicker leagues found. Connect Fleaflicker in Settings first.</Text>
            </View>
          ) : data.platform === 'mfl' && mflLeagues.length > 0 ? (
            <>
              {mflLeagues.map((lg: any) => (
                <TouchableOpacity
                  key={lg.id}
                  style={[sty.leagueCard, data.leagueId === lg.id && { borderColor: t.accentText }]}
                  onPress={() => onUpdate({
                    leagueId:      lg.id,
                    leagueName:    lg.name,
                    teamCount:     lg.teamCount || 12,
                    scoringFormat: (lg.scoringFormat === 'ppr' ? 'ppr' : lg.scoringFormat === 'half' ? 'half' : 'standard'),
                    isDynasty:     lg.leagueType === 'dynasty',
                  } as any)}
                >
                  <Text style={sty.leagueName}>{lg.name}</Text>
                  <Text style={sty.leagueMeta}>
                    {lg.teamCount} teams · {lg.season} · {lg.scoringFormat === 'ppr' ? 'PPR' : lg.scoringFormat === 'half' ? 'Half PPR' : 'Standard'}{lg.leagueType === 'dynasty' ? ' · Dynasty' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : data.platform === 'mfl' ? (
            <View style={sty.emptyState}>
              <Text style={sty.emptyText}>No MFL leagues found. Connect MFL in Settings first.</Text>
            </View>
          ) : (
            <View style={sty.manualLeague}>
              <Text style={sty.inputLabel}>League Name</Text>
              <TextInput
                style={sty.textInput}
                value={data.leagueName || ''}
                onChangeText={(t) => onUpdate({ leagueName: t })}
                placeholder="My Fantasy League"
                placeholderTextColor={t.textSub}
              />
              <Text style={sty.inputLabel}>Number of Teams</Text>
              <View style={sty.chipRow}>
                {teamOptions(data.teamCount).map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[sty.chip, data.teamCount === n && sty.chipActive]}
                    onPress={() => onUpdate({ teamCount: n })}
                  >
                    <Text style={[sty.chipText, data.teamCount === n && sty.chipTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={sty.inputLabel}>Scoring Format</Text>
              <View style={sty.chipRow}>
                {([['ppr', 'PPR'], ['half', 'HALF'], ['standard', 'STD']] as const).map(([val, label]) => (
                  <TouchableOpacity
                    key={val}
                    style={[sty.chip, data.scoringFormat === val && sty.chipActive]}
                    onPress={() => onUpdate({ scoringFormat: val })}
                  >
                    <Text style={[sty.chipText, data.scoringFormat === val && sty.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={sty.navRow}>
            <TouchableOpacity style={sty.backBtn} onPress={onBack}>
              <Text style={sty.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[sty.nextBtn, sty.nextBtnFlex, !data.leagueName && !data.leagueId && sty.nextBtnDisabled]}
              onPress={() => onNext()}
              disabled={!data.leagueName && !data.leagueId}
            >
              <Text style={sty.nextBtnText}>CONTINUE</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── POSITION / SETTINGS ── */}
      {step === 'position' && (
        <View style={sty.setupSection}>
          {/* v2026-08-09: team count was silently fixed at 12 — it drives
              the position chips AND every pick number in the preview, so
              10/14-team drafters got wrong math with no way to fix it.
              Platform-linked leagues prefill this from the league. */}
          <Text style={sty.inputLabel}>Teams</Text>
          <View style={sty.chipRow}>
            {teamOptions(data.teamCount).map(n => (
              <TouchableOpacity
                key={n}
                style={[sty.chip, (data.teamCount || 12) === n && sty.chipActive]}
                onPress={() => onUpdate({
                  teamCount: n,
                  // Keep the selected slot inside the new league size.
                  ...(data.myDraftSlot && data.myDraftSlot > n ? { myDraftSlot: n } : {}),
                })}
              >
                <Text style={[sty.chipText, (data.teamCount || 12) === n && sty.chipTextActive]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={sty.inputLabel}>My Draft Position</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sty.slotScroll}>
            <View style={sty.chipRow}>
              {Array.from({ length: data.teamCount || 12 }, (_, i) => i + 1).map(n => (
                <TouchableOpacity
                  key={n}
                  style={[sty.slotChip, data.myDraftSlot === n && sty.slotChipActive]}
                  onPress={() => onUpdate({ myDraftSlot: n })}
                >
                  <Text style={[sty.slotChipText, data.myDraftSlot === n && sty.slotChipTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={sty.inputLabel}>Draft Type</Text>
          <View style={sty.chipRow}>
            {([['snake', 'SNAKE'], ['linear', 'LINEAR'], ['auction', 'AUCTION']] as const).map(([val, label]) => (
              <TouchableOpacity
                key={val}
                style={[sty.chip, data.draftType === val && sty.chipActive]}
                onPress={() => onUpdate({ draftType: val })}
              >
                <Text style={[sty.chipText, data.draftType === val && sty.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={sty.inputLabel}>Rounds</Text>
          <View style={sty.chipRow}>
            {roundOptions(data.rounds).map(n => (
              <TouchableOpacity
                key={n}
                style={[sty.chip, data.rounds === n && sty.chipActive]}
                onPress={() => onUpdate({ rounds: n })}
              >
                <Text style={[sty.chipText, data.rounds === n && sty.chipTextActive]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {(data.myDraftSlot || sleeperPicks) && (
            <View style={sty.pickPreview}>
              <Text style={sty.pickPreviewTitle}>YOUR PICKS</Text>
              <Text style={sty.pickPreviewText}>
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

          <View style={sty.navRow}>
            <TouchableOpacity style={sty.backBtn} onPress={onBack}>
              <Text style={sty.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sty.nextBtn, sty.nextBtnFlex]} onPress={() => onNext()}>
              <Text style={sty.nextBtnText}>CONTINUE</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── CONFIRM ── */}
      {step === 'confirm' && (
        <View style={sty.setupSection}>
          <View style={sty.confirmCard}>
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

          <View style={sty.navRow}>
            <TouchableOpacity style={sty.backBtn} onPress={onBack}>
              <Text style={sty.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sty.startBtn, sty.nextBtnFlex]} onPress={onStart}>
              <Text style={sty.startBtnText}>START DRAFT</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function ConfirmRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const { t } = useTheme();
  const sty = useMemo(() => makeStyles(t), [t]);

  return (
    <View style={sty.confirmRow}>
      <Text style={sty.confirmLabel}>{label}</Text>
      <Text style={[sty.confirmValue, highlight && { color: t.accentText }]}>{value}</Text>
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
  const { t } = useTheme();
  const sty = useMemo(() => makeStyles(t), [t]);

  const router = useRouter();
  // Positions this league can actually start. Drives both the chip row and the
  // available-player list, so a league with no DEF/K slot shows neither the
  // chip nor those players — and resumed drafts get cleaned too.
  const allowedPositions = useMemo(
    () => allowedDraftPositions(state.settings.rosterSlots),
    [state.settings.rosterSlots],
  );
  const positionChips = useMemo(
    () => allowedPositions
      ? POSITIONS.filter(p => p === 'ALL' || allowedPositions.has(p))
      : POSITIONS,
    [allowedPositions],
  );
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
              const playerName = `${p.metadata.first_name} ${p.metadata.last_name}`.trim();
              const pos = p.metadata.position;
              // Resolve the Sleeper pick to OUR pool player's id before applying
              // it. Sleeper's player_id frequently differs from the ranking-pool
              // id (2026 rookies carry a `prospect-…` id, team D/ST use the team
              // abbreviation, etc.), so the id-only match in applyPick silently
              // leaves the drafted player sitting in the pool. Fall back to a
              // normalized name (+ position) match so the player actually clears.
              let resolvedId = p.player_id;
              const pool = s.availablePlayers;
              let match = pool.find(pl => pl.id === p.player_id && !pl.isDrafted);
              if (!match) {
                const key = normalizePlayerName(playerName);
                match =
                  pool.find(pl =>
                    !pl.isDrafted &&
                    normalizePlayerName(pl.name) === key &&
                    (!pos || normalizePosition(pl.position) === normalizePosition(pos))
                  ) ||
                  pool.find(pl => !pl.isDrafted && normalizePlayerName(pl.name) === key);
              }
              if (match) resolvedId = match.id;
              const normalized: DraftPick = {
                pickNo: p.pick_no,
                round: p.round,
                slot: p.draft_slot,
                rosterId: p.roster_id,
                playerId: resolvedId,
                playerName,
                position: pos,
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
    // Same normalized-name defense as buildDraftPrompt: if pick resolution
    // ever misses (rookie ids, name variants), the drafted player must not
    // appear tappable in the pool either.
    const draftedKeys = new Set(state.picks.map(p => normalizePlayerName(p.playerName)));
    let list = state.availablePlayers.filter(
      p => !p.isDrafted && !draftedKeys.has(normalizePlayerName(p.name))
    );
    // Safety net for drafts that started/synced before the pool was filtered:
    // hide players whose position the league can't start (D/ST, punters, etc.).
    if (allowedPositions) {
      list = list.filter(p => {
        const pos = normalizePosition(p.position);
        return !pos || pos === '?' || allowedPositions.has(pos);
      });
    }
    if (posFilter !== 'ALL') list = list.filter(p => normalizePosition(p.position) === posFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.adp - b.adp);
  }, [state.availablePlayers, state.picks, posFilter, search, allowedPositions]);

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
  // Synchronous re-entry guard. `aiLoading` was set here but never READ, and
  // the ASK button had no disabled state, so a second tap during a 50-90s Opus
  // call started a whole second charged request — and because both flows end in
  // an unsequenced setAiResponse, a slower first answer could land last and sit
  // under the newer question. Same async hole as coach.tsx send() (2026-09-06).
  const askingRef = useRef(false);
  const handleAskAI = useCallback(async (q?: string) => {
    if (aiLoading || askingRef.current) return;
    askingRef.current = true;
    setShowAI(true);
    setAiLoading(true);
    setAiResponse('');
    // 5.1.1(i): never charge a prompt for a call the consent gate will refuse.
    if (!(await hasAIConsent())) {
      setAiResponse('AI features are turned off. To use the Draft Copilot, enable “Share data with AI service” in Settings.');
      setAiLoading(false); askingRef.current = false;
      return;
    }
    // Guests can't reach the AI proxy — don't burn a lifetime prompt trying.
    if (!(await hasAISession())) {
      setAiResponse('Sign in to use AI features — create a free account from Settings.');
      setAiLoading(false); askingRef.current = false;
      return;
    }
    // Atomic charge — if over cap, close the AI sheet and send the user
    // to the paywall instead of silently hitting Claude.
    const ok = await consumePrompt();
    if (!ok) {
      const tier = await getCurrentTier();
      const ctx = tier === 'free' ? 'free_prompts_exhausted' : 'weekly_prompts_exhausted';
      setShowAI(false);
      setAiLoading(false); askingRef.current = false;
      router.push(`/paywall?context=${ctx}` as any);
      return;
    }
    try {
      const prompt = buildDraftPrompt(state, q || undefined);
      const res = await askAI(prompt, { system: CLASS_OF_2025_TEXT, feature: 'draft', timeoutMs: 90_000 });
      setAiResponse(res);
    } catch (e: any) {
      // Never surface raw internal errors to the sheet — build 197 lesson.
      const msg = e?.message?.includes('prompt_limit_reached')
        ? 'You’ve hit your weekly prompt limit.'
        : describeAIError(e, 'Couldn’t get advice right now. Try again in a moment.');
      setAiResponse(msg);
    } finally {
      setAiLoading(false);
      askingRef.current = false;
    }
  }, [state, router, aiLoading]);

  const isSleeperLive = state.settings.platform === 'sleeper' && !!state.settings.draftId;

  return (
    <View style={sty.draftContainer}>
      {/* ── TOP BAR ── */}
      <View style={sty.draftHeader}>
        <View style={sty.draftHeaderLeft}>
          <TheOLogo fontSize={22} color="#f0f4f5" />
          <Text style={sty.draftHeaderSub}>
            {state.settings.leagueName} · {state.settings.scoringFormat.toUpperCase()}
          </Text>
        </View>
        <View style={sty.draftHeaderRight}>
          {isSleeperLive && (
            <View style={sty.liveIndicator}>
              <View style={sty.livePulse} />
              <Text style={sty.liveText}>LIVE</Text>
            </View>
          )}
          <TouchableOpacity style={sty.headerBtn} onPress={onReset}>
            <Text style={sty.headerBtnText}>EXIT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── PICK STATUS BAR ── */}
      <View style={sty.pickStatusBar}>
        <View style={sty.pickStatusItem}>
          <Text style={sty.pickStatusLabel}>ROUND</Text>
          <Text style={sty.pickStatusValue}>{state.currentRound}/{state.settings.rounds}</Text>
        </View>
        <View style={sty.pickStatusDivider} />
        <View style={sty.pickStatusItem}>
          <Text style={sty.pickStatusLabel}>PICK</Text>
          <Text style={sty.pickStatusValue}>#{state.currentPick}</Text>
        </View>
        <View style={sty.pickStatusDivider} />
        <View style={sty.pickStatusItem}>
          <Text style={sty.pickStatusLabel}>NEXT MINE</Text>
          <Text style={[sty.pickStatusValue, state.isMyTurn && { color: t.warnText }]}>
            {state.isMyTurn ? 'NOW!' : `#${state.nextMyPick}`}
          </Text>
        </View>
        <View style={sty.pickStatusDivider} />
        <View style={sty.pickStatusItem}>
          <Text style={sty.pickStatusLabel}>MY PICKS</Text>
          <Text style={sty.pickStatusValue}>{state.myRoster.length}</Text>
        </View>
      </View>

      {/* ── MY TURN BANNER ── */}
      {state.isMyTurn && (
        <View style={sty.myTurnBanner}>
          <Text style={sty.myTurnText}>YOUR PICK — Round {state.currentRound}, Pick #{state.currentPick}</Text>
        </View>
      )}

      {/* ── POSITION FILTER ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sty.posScroll} contentContainerStyle={sty.posScrollContent}>
        {positionChips.map(pos => (
          <TouchableOpacity
            key={pos}
            style={[sty.posChip, posFilter === pos && { backgroundColor: POS_COLORS[pos] || t.accentText }]}
            onPress={() => setPosFilter(pos)}
          >
            <Text style={[sty.posChipText, posFilter === pos && { color: '#000' }]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── SEARCH ── */}
      <View style={sty.searchRow}>
        <TextInput
          style={sty.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search players..."
          placeholderTextColor={t.textSub}
        />
        <Text style={sty.availCount}>{filtered.length} avail</Text>
      </View>

      {/* ── PLAYER BOARD ── */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={sty.playerList}
        contentContainerStyle={{ paddingBottom: 160 }}
        renderItem={({ item }) => (
          <PlayerRow
            player={item}
            isMyTurn={state.isMyTurn}
            // Always show "DRAFTED (OTHER)" — even when a Sleeper draft
            // is auto-syncing picks. Sleeper polling is best-effort and
            // sometimes lags (mock drafts, paused drafts, network
            // hiccups); without a manual override the user can't log
            // other teams' picks at all. With both buttons present the
            // auto-sync still works on top.
            isCompanionMode={true}
            onDraftMe={() => handleDraftPlayer(item, true)}
            onDraftOther={() => handleDraftPlayer(item, false)}
          />
        )}
        initialNumToRender={20}
        maxToRenderPerBatch={15}
        windowSize={7}
      />

      {/* ── BOTTOM ACTION BAR ── */}
      <View style={[sty.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={sty.bottomBtn} onPress={() => setShowRoster(true)}>
          <Text style={sty.bottomBtnText}>MY TEAM ({state.myRoster.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={sty.bottomBtnAI} onPress={() => handleAskAI()}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={sty.bottomBtnAIText}>ASK THE </Text>
                <ApertureO size={18} color="#000" pupilColor="#000" />
              </View>
        </TouchableOpacity>
        <TouchableOpacity style={sty.bottomBtn} onPress={() => setShowPickLog(true)}>
          <Text style={sty.bottomBtnText}>LOG</Text>
        </TouchableOpacity>
        {!isSleeperLive && (
          <TouchableOpacity style={sty.bottomBtnUndo} onPress={handleUndo}>
            <Text style={sty.bottomBtnText}>UNDO</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── MY ROSTER MODAL ── */}
      <Modal visible={showRoster} transparent animationType="slide">
        <View style={sty.modalOverlay}>
          <View style={sty.modalContent}>
            <View style={sty.modalHeader}>
              <Text style={sty.modalTitle}>MY ROSTER</Text>
              <TouchableOpacity onPress={() => setShowRoster(false)}>
                <Text style={sty.modalClose}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {state.myRoster.length === 0 ? (
                <Text style={sty.emptyText}>No picks yet</Text>
              ) : (
                state.myRoster.map((pick, i) => (
                  <View key={pick.pickNo} style={sty.rosterRow}>
                    <View style={[sty.rosterPosBadge, { backgroundColor: POS_COLORS[pick.position] || t.textSub }]}>
                      <Text style={sty.rosterPosText}>{pick.position}</Text>
                    </View>
                    <View style={sty.rosterInfo}>
                      <Text style={sty.rosterName}>{pick.playerName}</Text>
                      <Text style={sty.rosterMeta}>{pick.team} · R{pick.round} Pick #{pick.pickNo}</Text>
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
          style={sty.modalOverlay}
        >
          <View style={sty.modalContent}>
            <View style={sty.modalHeader}>
              <TheOLogo fontSize={22} color="#f0f4f5" />
              <TouchableOpacity onPress={() => setShowAI(false)}>
                <Text style={sty.modalClose}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={sty.aiScroll}>
              {aiLoading ? (
                <View style={sty.aiLoadingWrap}>
                  <ActivityIndicator color={t.warnText} size="large" />
                  <Text style={sty.aiLoadingText}>The O is thinking...</Text>
                </View>
              ) : (
                <Text style={sty.aiResponseText}>{aiResponse}</Text>
              )}
            </ScrollView>
            <View style={sty.aiInputRow}>
              <TextInput
                style={sty.aiInput}
                value={aiQuestion}
                onChangeText={setAiQuestion}
                placeholder="Ask about specific players..."
                placeholderTextColor={t.textSub}
                editable={!aiLoading}
              />
              <TouchableOpacity
                style={[sty.aiSendBtn, (aiLoading || !aiQuestion.trim()) && { opacity: 0.4 }]}
                disabled={aiLoading || !aiQuestion.trim()}
                onPress={() => {
                  if (aiQuestion.trim()) {
                    handleAskAI(aiQuestion.trim());
                    setAiQuestion('');
                  }
                }}
              >
                <Text style={sty.aiSendText}>ASK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── PICK LOG MODAL ── */}
      <Modal visible={showPickLog} transparent animationType="slide">
        <View style={sty.modalOverlay}>
          <View style={sty.modalContent}>
            <View style={sty.modalHeader}>
              <Text style={sty.modalTitle}>PICK LOG</Text>
              <TouchableOpacity onPress={() => setShowPickLog(false)}>
                <Text style={sty.modalClose}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {state.picks.length === 0 ? (
                <Text style={sty.emptyText}>No picks yet</Text>
              ) : (
                [...state.picks].reverse().map(pick => (
                  <View key={pick.pickNo} style={[sty.logRow, pick.isMyPick && sty.logRowMine]}>
                    <Text style={sty.logPick}>#{pick.pickNo}</Text>
                    <View style={[sty.logPosBadge, { backgroundColor: POS_COLORS[pick.position] || t.textSub }]}>
                      <Text style={sty.logPosText}>{pick.position}</Text>
                    </View>
                    <Text style={sty.logName}>{pick.playerName}</Text>
                    <Text style={sty.logTeam}>{pick.team}</Text>
                    {pick.isMyPick && <Text style={sty.logMine}>YOU</Text>}
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
  const { t } = useTheme();
  const sty = useMemo(() => makeStyles(t), [t]);

  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={sty.playerRow}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={sty.playerMain}>
        <Text style={[sty.playerRank, { color: (player.tier ?? 99) <= 2 ? t.warnText : t.textSub }]}>
          {player.rank}
        </Text>
        <View style={[sty.playerPosBadge, { backgroundColor: POS_COLORS[player.position] || t.textSub }]}>
          <Text style={sty.playerPosText}>{player.position}</Text>
        </View>
        <View style={sty.playerInfo}>
          <Text style={sty.playerName}>{player.name}</Text>
          <Text style={sty.playerMeta}>{player.team} · BYE {player.byeWeek} · ADP {player.adp}</Text>
        </View>
        {player.tier === 1 && <Text style={sty.tierStar}>★</Text>}
      </View>

      {expanded && (
        <View style={sty.playerActions}>
          {isCompanionMode && (
            <TouchableOpacity style={sty.draftOtherBtn} onPress={onDraftOther}>
              <Text style={sty.draftOtherText}>DRAFTED (OTHER)</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[sty.draftMeBtn, isMyTurn && sty.draftMeBtnActive]}
            onPress={onDraftMe}
          >
            <Text style={[sty.draftMeText, isMyTurn && sty.draftMeTextActive]}>
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

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
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
    color: t.warnText,
    letterSpacing: 2,
  },
  setupSub: {
    fontFamily: F.body,
    fontSize: 15,
    color: t.textSub,
    marginTop: 4,
  },
  stepRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: t.border,
  },
  stepDotActive: { backgroundColor: t.warnText, width: 24 },
  stepDotDone: { backgroundColor: t.accentText },
  setupSection: { gap: 12 },

  // ── Platform cards ──
  platformCard: {
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: t.border,
  },
  platformRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  platformDot: { width: 10, height: 10, borderRadius: 5 },
  platformLabel: {
    fontFamily: F.bodyB,
    fontSize: 16,
    color: t.text,
    letterSpacing: 1,
  },
  platformDesc: {
    fontFamily: F.body,
    fontSize: 13,
    color: t.textSub,
  },
  liveBadge: {
    backgroundColor: t.accentText,
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
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: t.border,
  },
  leagueName: {
    fontFamily: F.bodyB,
    fontSize: 16,
    color: t.text,
    marginBottom: 4,
  },
  leagueMeta: {
    fontFamily: F.data,
    fontSize: 12,
    color: t.textSub,
  },

  // ── Manual league ──
  manualLeague: { gap: 12 },
  inputLabel: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.accentText,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  textInput: {
    backgroundColor: t.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    color: t.text,
    fontFamily: F.body,
    fontSize: 15,
  },

  // ── Chips ──
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    backgroundColor: t.card,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  chipActive: {
    backgroundColor: t.warnText,
    borderColor: t.warnText,
  },
  chipText: {
    fontFamily: F.data,
    fontSize: 13,
    color: t.textSub,
  },
  chipTextActive: { color: '#000' },
  slotScroll: { maxHeight: 55 },
  slotChip: {
    width: 42, height: 42,
    borderRadius: 21,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  slotChipActive: {
    backgroundColor: t.warnText,
    borderColor: t.warnText,
  },
  slotChipText: {
    fontFamily: F.data,
    fontSize: 14,
    color: t.textSub,
  },
  slotChipTextActive: { color: '#000', fontWeight: '700' },

  // ── Pick preview ──
  pickPreview: {
    backgroundColor: t.surface,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: t.border,
  },
  pickPreviewTitle: {
    fontFamily: F.data,
    fontSize: 10,
    color: t.accentText,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  pickPreviewText: {
    fontFamily: F.data,
    fontSize: 13,
    color: t.text,
    lineHeight: 22,
  },

  // ── Confirm ──
  confirmCard: {
    backgroundColor: t.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    overflow: 'hidden',
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  confirmLabel: {
    fontFamily: F.data,
    fontSize: 12,
    color: t.textSub,
    letterSpacing: 0.5,
  },
  confirmValue: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: t.text,
  },

  // ── Nav buttons ──
  navRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  nextBtn: {
    backgroundColor: t.warnText,
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
    backgroundColor: t.card,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: t.border,
  },
  backBtnText: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: t.textSub,
    letterSpacing: 1,
  },
  startBtn: {
    backgroundColor: t.accentText,
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
    color: t.textSub,
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
    borderBottomColor: t.border,
  },
  draftHeaderLeft: {},
  draftHeaderTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: t.warnText,
    letterSpacing: 1,
  },
  draftHeaderSub: {
    fontFamily: F.data,
    fontSize: 10,
    color: t.textSub,
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
    backgroundColor: t.accentText,
  },
  liveText: {
    fontFamily: F.data,
    fontSize: 10,
    color: t.accentText,
    letterSpacing: 1,
  },
  headerBtn: {
    backgroundColor: t.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.border,
  },
  headerBtnText: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
    letterSpacing: 1,
  },

  // ── Pick Status ──
  pickStatusBar: {
    flexDirection: 'row',
    backgroundColor: t.card,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  pickStatusItem: { flex: 1, alignItems: 'center' },
  pickStatusLabel: {
    fontFamily: F.data,
    fontSize: 9,
    color: t.textSub,
    letterSpacing: 1,
  },
  pickStatusValue: {
    fontFamily: F.heading,
    fontSize: 18,
    color: t.text,
    marginTop: 2,
  },
  pickStatusDivider: {
    width: 1,
    height: 28,
    backgroundColor: t.border,
  },

  // ── My Turn Banner ──
  myTurnBanner: {
    backgroundColor: t.warnText,
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
    backgroundColor: t.card,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: t.border,
  },
  posChipText: {
    fontFamily: F.data,
    fontSize: 12,
    color: t.textSub,
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
    backgroundColor: t.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: t.text,
    fontFamily: F.body,
    fontSize: 14,
  },
  availCount: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
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
    borderBottomColor: t.border,
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
    color: t.text,
  },
  playerMeta: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
    marginTop: 1,
  },
  tierStar: {
    fontFamily: F.heading,
    fontSize: 18,
    color: t.warnText,
  },
  playerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingLeft: 34,
  },
  draftOtherBtn: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  draftOtherText: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
    letterSpacing: 0.5,
  },
  draftMeBtn: {
    flex: 1,
    backgroundColor: t.card,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.accentText,
  },
  draftMeBtnActive: {
    backgroundColor: t.warnText,
    borderColor: t.warnText,
  },
  draftMeText: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.accentText,
    letterSpacing: 0.5,
  },
  draftMeTextActive: { color: '#000' },

  // ── Bottom Bar ──
  bottomBar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: t.bg,
    borderTopWidth: 1,
    borderTopColor: t.border,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bottomBtn: {
    backgroundColor: t.card,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  bottomBtnText: {
    fontFamily: F.data,
    fontSize: 10,
    color: t.textSub,
    letterSpacing: 0.5,
  },
  bottomBtnAI: {
    flex: 1,
    backgroundColor: t.warnText,
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
    backgroundColor: t.surface,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },

  // ── Modals ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10,18,20,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: t.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: t.warnText,
    letterSpacing: 1,
  },
  modalClose: {
    fontFamily: F.data,
    fontSize: 12,
    color: t.accentText,
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
    borderBottomColor: t.border,
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
    color: t.text,
  },
  rosterMeta: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
    marginTop: 1,
  },

  // ── AI modal ──
  aiScroll: { paddingHorizontal: 20, paddingVertical: 16, maxHeight: 350 },
  aiLoadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 16 },
  aiLoadingText: {
    fontFamily: F.body,
    fontSize: 14,
    color: t.textSub,
  },
  aiResponseText: {
    fontFamily: F.body,
    fontSize: 15,
    color: t.text,
    lineHeight: 24,
  },
  aiInputRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  aiInput: {
    flex: 1,
    backgroundColor: t.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: t.text,
    fontFamily: F.body,
    fontSize: 14,
    borderWidth: 1,
    borderColor: t.border,
  },
  aiSendBtn: {
    backgroundColor: t.warnText,
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
    borderBottomColor: t.border,
  },
  logRowMine: {
    backgroundColor: 'rgba(255,184,0,0.06)',
  },
  logPick: {
    fontFamily: F.data,
    fontSize: 12,
    color: t.textSub,
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
    color: t.text,
    flex: 1,
  },
  logTeam: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
  },
  logMine: {
    fontFamily: F.data,
    fontSize: 9,
    color: t.warnText,
    letterSpacing: 1,
    marginLeft: 4,
  },
});