// AIOmni Custom Rankings Quiz — Phase 1 (8 questions) + Phase 2 (5 positions).
// On final step, computes dimensions, saves the result, and navigates to
// /quiz-reveal where the user confirms and triggers ranking generation.

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  GestureResponderEvent,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { computeDimensions, saveQuizResult } from '../services/quiz/engine';
import { QUESTIONS } from '../services/quiz/questionBank';
import type {
  Position,
  PositionRanking,
  QuizAnswer,
  QuizQuestion,
  QuizResult,
} from '../services/quiz/types';
import { getFormulaRankings } from '../services/rankings/aiomniEngineBridge';
import type { RankedPlayer } from '../services/rankingsData';
import PlayerPicker from './components/PlayerPicker';
import QuizSlot from './components/QuizSlot';
import { dark, F, palette } from './constants/tokens';

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K'];
const TOTAL_PHASE1 = QUESTIONS.length; // 8
const TOTAL_STEPS = TOTAL_PHASE1 + POSITIONS.length; // 13

// In Phase 2 we use the formula's full player list to render filled slots
// (so we can show name + team without re-querying for every selected id).
type PlayerLookup = Record<string, RankedPlayer>;

export default function QuizScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [positionRanks, setPositionRanks] = useState<Record<Position, string[]>>({
    QB: [], RB: [], WR: [], TE: [], K: [],
  });
  const [skippedPositions, setSkippedPositions] = useState<Record<Position, boolean>>({
    QB: false, RB: false, WR: false, TE: false, K: false,
  });

  const [playerLookup, setPlayerLookup] = useState<PlayerLookup>({});
  const [pickerVisible, setPickerVisible] = useState(false);

  // Load formula once so Phase 2 slots can resolve player ids → display data
  useEffect(() => {
    (async () => {
      try {
        const data = await getFormulaRankings('PPR', 'redraft');
        const lookup: PlayerLookup = {};
        for (const p of data ?? []) lookup[p.id] = p;
        setPlayerLookup(lookup);
      } catch {
        // Non-fatal — slots will show ids without metadata
      }
    })();
  }, []);

  const inPhase2 = currentStep >= TOTAL_PHASE1;
  const phase2Position: Position | null = inPhase2 ? POSITIONS[currentStep - TOTAL_PHASE1] : null;
  const currentQuestion: QuizQuestion | null = !inPhase2 ? QUESTIONS[currentStep] : null;

  // ─── Validation: can we advance? ─────────────────────────────────
  const canAdvance = useMemo(() => {
    if (currentQuestion) {
      const a = answers[currentQuestion.id];
      if (!a) return false;
      if (currentQuestion.type === 'rank') {
        const arr = a.value as string[];
        const need = currentQuestion.rankTopN ?? 3;
        return arr.length >= need;
      }
      return true;
    }
    if (phase2Position) {
      const ranks = positionRanks[phase2Position];
      return skippedPositions[phase2Position] || ranks.length >= 3;
    }
    return false;
  }, [currentQuestion, phase2Position, answers, positionRanks, skippedPositions]);

  // ─── Navigation ──────────────────────────────────────────────────
  const goBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };
  const goNext = async () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
      return;
    }
    // Final step → reveal
    await finishAndReveal();
  };

  const finishAndReveal = async () => {
    const flatAnswers: QuizAnswer[] = Object.values(answers);
    const dimensions = computeDimensions(flatAnswers);
    const positionRankList: PositionRanking[] = POSITIONS.map(pos => ({
      position: pos,
      rankedPlayerIds: skippedPositions[pos] ? [] : positionRanks[pos],
    }));
    const result: QuizResult = {
      userId: 'local',
      completedAt: new Date().toISOString(),
      answers: flatAnswers,
      positionRanks: positionRankList,
      dimensions,
      generatedRankings: [], // populated on the reveal screen after generation
    };
    await saveQuizResult(result);
    router.push('/quiz-reveal' as any);
  };

  // ─── Answer setters ──────────────────────────────────────────────
  const setBinary = (q: QuizQuestion, value: 'A' | 'B') => {
    setAnswers(prev => ({ ...prev, [q.id]: { questionId: q.id, value } }));
  };
  const setRank = (q: QuizQuestion, rankedIds: string[]) => {
    setAnswers(prev => ({ ...prev, [q.id]: { questionId: q.id, value: rankedIds } }));
  };
  const setSlider = (q: QuizQuestion, value: number) => {
    setAnswers(prev => ({ ...prev, [q.id]: { questionId: q.id, value } }));
  };

  // ─── Phase 2 actions ─────────────────────────────────────────────
  const openPicker = () => setPickerVisible(true);
  const closePicker = () => setPickerVisible(false);
  const onPickPlayer = (player: RankedPlayer) => {
    if (!phase2Position) return;
    setPositionRanks(prev => ({
      ...prev,
      [phase2Position]: [...prev[phase2Position], player.id],
    }));
    setPlayerLookup(prev => ({ ...prev, [player.id]: player }));
    setPickerVisible(false);
  };
  const removeAtSlot = (slotIdx: number) => {
    if (!phase2Position) return;
    setPositionRanks(prev => {
      const next = [...prev[phase2Position]];
      next.splice(slotIdx, 1);
      return { ...prev, [phase2Position]: next };
    });
  };
  const skipPosition = () => {
    if (!phase2Position) return;
    setSkippedPositions(prev => ({ ...prev, [phase2Position]: true }));
    setPositionRanks(prev => ({ ...prev, [phase2Position]: [] }));
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <View style={[s.container, { paddingTop: insets.top + 12 }]}>
      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${((currentStep + 1) / TOTAL_STEPS) * 100}%` }]} />
      </View>
      <Text style={s.progressLabel}>
        {currentStep + 1} OF {TOTAL_STEPS} · {inPhase2 ? `RANK YOUR ${phase2Position}S` : 'PREFERENCE'}
      </Text>

      <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: 40 }}>
        {currentQuestion && (
          <QuestionRenderer
            question={currentQuestion}
            answer={answers[currentQuestion.id]}
            onBinary={(v) => setBinary(currentQuestion, v)}
            onRank={(ids) => setRank(currentQuestion, ids)}
            onSlider={(v) => setSlider(currentQuestion, v)}
          />
        )}
        {phase2Position && (
          <PositionPhase
            position={phase2Position}
            slots={positionRanks[phase2Position]}
            skipped={skippedPositions[phase2Position]}
            playerLookup={playerLookup}
            onAdd={openPicker}
            onRemove={removeAtSlot}
            onSkip={skipPosition}
          />
        )}
      </ScrollView>

      {/* Bottom nav */}
      <View style={[s.navBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[s.navBtn, currentStep === 0 && s.navBtnDisabled]}
          onPress={goBack}
          disabled={currentStep === 0}
        >
          <Ionicons name="chevron-back" size={18} color={currentStep === 0 ? dark.textMuted : dark.text} />
          <Text style={[s.navBtnTxt, currentStep === 0 && { color: dark.textMuted }]}>BACK</Text>
        </TouchableOpacity>

        <Text style={s.stepCounter}>{currentStep + 1} / {TOTAL_STEPS}</Text>

        <TouchableOpacity
          style={[s.navBtnPrimary, !canAdvance && s.navBtnDisabled]}
          onPress={goNext}
          disabled={!canAdvance}
        >
          <Text style={[s.navBtnPrimaryTxt, !canAdvance && { color: dark.textMuted }]}>
            {currentStep === TOTAL_STEPS - 1 ? 'REVEAL' : 'NEXT'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={!canAdvance ? dark.textMuted : dark.bg} />
        </TouchableOpacity>
      </View>

      {phase2Position && (
        <PlayerPicker
          visible={pickerVisible}
          position={phase2Position}
          format="PPR"
          alreadySelectedIds={positionRanks[phase2Position]}
          onSelect={onPickPlayer}
          onClose={closePicker}
        />
      )}
    </View>
  );
}

// ═══ Sub-components ═══════════════════════════════════════════════

function QuestionRenderer({
  question, answer, onBinary, onRank, onSlider,
}: {
  question: QuizQuestion;
  answer?: QuizAnswer;
  onBinary: (v: 'A' | 'B') => void;
  onRank: (ids: string[]) => void;
  onSlider: (v: number) => void;
}) {
  return (
    <View>
      <Text style={s.prompt}>{question.prompt}</Text>
      {question.helpText && <Text style={s.helpText}>{question.helpText}</Text>}
      {question.type === 'binary' && (
        <BinaryChoices question={question} answer={answer} onBinary={onBinary} />
      )}
      {question.type === 'rank' && (
        <RankList question={question} answer={answer} onRank={onRank} />
      )}
      {question.type === 'slider' && (
        <Slider question={question} answer={answer} onSlider={onSlider} />
      )}
    </View>
  );
}

function BinaryChoices({
  question, answer, onBinary,
}: { question: QuizQuestion; answer?: QuizAnswer; onBinary: (v: 'A' | 'B') => void }) {
  const selected = answer?.value as 'A' | 'B' | undefined;
  return (
    <View style={{ marginTop: 12 }}>
      {(['A', 'B'] as const).map(key => {
        const opt = key === 'A' ? question.optionA : question.optionB;
        if (!opt) return null;
        const active = selected === key;
        return (
          <TouchableOpacity
            key={key}
            style={[s.choiceCard, active && s.choiceCardActive]}
            onPress={() => onBinary(key)}
            activeOpacity={0.8}
          >
            <Text style={[s.choiceLabel, active && s.choiceLabelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function RankList({
  question, answer, onRank,
}: { question: QuizQuestion; answer?: QuizAnswer; onRank: (ids: string[]) => void }) {
  const allIds = (question.rankOptions ?? []).map(o => o.id);
  const initial = (answer?.value as string[] | undefined) ?? allIds;
  const [order, setOrder] = useState<string[]>(initial);
  const topN = question.rankTopN ?? 3;

  // Keep local order in sync if the answer is reset elsewhere
  useEffect(() => {
    if (answer?.value) setOrder(answer.value as string[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target], next[idx]];
    setOrder(next);
    onRank(next);
  };

  const optsById = Object.fromEntries((question.rankOptions ?? []).map(o => [o.id, o]));

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.rankSectionLabel}>YOUR TOP {topN}</Text>
      {order.slice(0, topN).map((id, idx) => {
        const opt = optsById[id];
        return (
          <RankRow
            key={id}
            rank={idx + 1}
            label={opt?.label ?? id}
            sublabel={opt?.sublabel}
            inTop
            canUp={idx > 0}
            canDown={idx < order.length - 1}
            onUp={() => move(idx, -1)}
            onDown={() => move(idx, +1)}
          />
        );
      })}
      <View style={s.rankDivider} />
      <Text style={s.rankSectionLabel}>OTHERS</Text>
      {order.slice(topN).map((id, sIdx) => {
        const idx = topN + sIdx;
        const opt = optsById[id];
        return (
          <RankRow
            key={id}
            rank={idx + 1}
            label={opt?.label ?? id}
            sublabel={opt?.sublabel}
            inTop={false}
            canUp={idx > 0}
            canDown={idx < order.length - 1}
            onUp={() => move(idx, -1)}
            onDown={() => move(idx, +1)}
          />
        );
      })}
    </View>
  );
}

function RankRow({
  rank, label, sublabel, inTop, canUp, canDown, onUp, onDown,
}: {
  rank: number; label: string; sublabel?: string; inTop: boolean;
  canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void;
}) {
  return (
    <View style={[s.rankRow, inTop && s.rankRowTop]}>
      <Text style={[s.rankRowNum, inTop && s.rankRowNumTop]}>{rank}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.rankRowLabel} numberOfLines={1}>{label}</Text>
        {sublabel && <Text style={s.rankRowSub} numberOfLines={1}>{sublabel}</Text>}
      </View>
      <TouchableOpacity onPress={onUp} disabled={!canUp} style={s.arrowBtn}>
        <Ionicons name="chevron-up" size={20} color={canUp ? palette.aqua : dark.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onDown} disabled={!canDown} style={s.arrowBtn}>
        <Ionicons name="chevron-down" size={20} color={canDown ? palette.aqua : dark.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

function Slider({
  question, answer, onSlider,
}: { question: QuizQuestion; answer?: QuizAnswer; onSlider: (v: number) => void }) {
  const value = (answer?.value as number | undefined) ?? 50;
  const [trackWidth, setTrackWidth] = useState(0);
  const labels = question.sliderLabels ?? [];

  const updateFromTouch = (e: GestureResponderEvent) => {
    if (trackWidth <= 0) return;
    const x = Math.max(0, Math.min(trackWidth, e.nativeEvent.locationX));
    const v = Math.round((x / trackWidth) * 100);
    onSlider(v);
  };

  const thumbLeft = trackWidth > 0 ? (value / 100) * trackWidth : 0;

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.sliderValue}>{value}</Text>
      <View
        style={s.sliderTrack}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={updateFromTouch}
        onResponderMove={updateFromTouch}
      >
        <View style={[s.sliderFill, { width: thumbLeft }]} />
        {labels.map(t => (
          <View
            key={t.value}
            style={[s.sliderTick, { left: (t.value / 100) * trackWidth - 1 }]}
            pointerEvents="none"
          />
        ))}
        <View
          style={[s.sliderThumb, { left: thumbLeft - 12 }]}
          pointerEvents="none"
        />
      </View>
      <View style={s.sliderLabelsRow}>
        {labels.map(t => (
          <View key={t.value} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.sliderLabel}>{t.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PositionPhase({
  position, slots, skipped, playerLookup, onAdd, onRemove, onSkip,
}: {
  position: Position;
  slots: string[];
  skipped: boolean;
  playerLookup: PlayerLookup;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onSkip: () => void;
}) {
  const filledCount = slots.length;
  const remaining = Math.max(0, 10 - filledCount);
  const slotElements: React.ReactElement[] = [];
  slots.forEach((id, i) => {
    slotElements.push(
      <QuizSlot
        key={`f-${i}`}
        rank={i + 1}
        player={playerLookup[id] ?? null}
        onTap={() => onRemove(i)}
        onRemove={() => onRemove(i)}
      />,
    );
  });
  for (let i = 0; i < remaining; i++) {
    const rank = filledCount + i + 1;
    slotElements.push(
      <QuizSlot key={`e-${rank}`} rank={rank} player={null} onTap={onAdd} />,
    );
  }

  return (
    <View>
      <Text style={s.prompt}>Rank your top {position}s</Text>
      <Text style={s.helpText}>
        More ranks = sharper personalization. Three minimum, or skip the position.
      </Text>
      {skipped ? (
        <View style={s.skippedBox}>
          <Text style={s.skippedText}>Position skipped — algorithm will use base ranking for {position}.</Text>
        </View>
      ) : (
        <View style={{ marginTop: 12 }}>{slotElements}</View>
      )}
      {!skipped && (
        <TouchableOpacity style={s.skipBtn} onPress={onSkip}>
          <Text style={s.skipBtnText}>SKIP THIS POSITION</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg, paddingHorizontal: 20 },
  progressTrack: { height: 4, backgroundColor: dark.card, borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: 4, backgroundColor: palette.aqua },
  progressLabel: { fontFamily: F.bold, fontSize: 10, color: dark.textSub, letterSpacing: 2, marginTop: 8, marginBottom: 16 },
  body: { flex: 1 },
  prompt: { fontFamily: F.bold, fontSize: 18, color: dark.text, lineHeight: 26, marginTop: 4, letterSpacing: 0.5 },
  helpText: { fontFamily: F.body, fontSize: 12, color: dark.textSub, marginTop: 8, lineHeight: 18 },

  // Binary
  choiceCard: { backgroundColor: dark.card, borderRadius: 14, borderWidth: 1.5, borderColor: dark.border, padding: 16, marginTop: 10 },
  choiceCardActive: { borderColor: palette.aqua, backgroundColor: palette.aqua + '12' },
  choiceLabel: { fontFamily: F.body, fontSize: 14, color: dark.text, lineHeight: 20 },
  choiceLabelActive: { color: dark.text },

  // Rank
  rankSectionLabel: { fontFamily: F.bold, fontSize: 10, color: dark.textSub, letterSpacing: 2, marginTop: 8, marginBottom: 6 },
  rankDivider: { height: 1, backgroundColor: dark.border, marginVertical: 12 },
  rankRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: dark.card, borderRadius: 10,
    borderWidth: 1, borderColor: dark.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6,
  },
  rankRowTop: { borderColor: palette.aqua + '40' },
  rankRowNum: { fontFamily: F.bold, fontSize: 14, color: dark.textMuted, width: 24, textAlign: 'center' },
  rankRowNumTop: { color: palette.aqua },
  rankRowLabel: { fontFamily: F.bodyBold, fontSize: 13, color: dark.text },
  rankRowSub: { fontFamily: F.body, fontSize: 11, color: dark.textSub, marginTop: 2 },
  arrowBtn: { padding: 6 },

  // Slider
  sliderValue: { fontFamily: F.bold, fontSize: 22, color: palette.aqua, textAlign: 'center', marginBottom: 12 },
  sliderTrack: { height: 32, justifyContent: 'center' },
  sliderFill: { position: 'absolute', left: 0, top: 14, height: 4, backgroundColor: palette.aqua, borderRadius: 2 },
  sliderTick: { position: 'absolute', top: 12, width: 2, height: 8, backgroundColor: dark.border },
  sliderThumb: {
    position: 'absolute', top: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: palette.aqua, borderWidth: 2, borderColor: dark.bg,
  },
  sliderLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sliderLabel: { fontFamily: F.body, fontSize: 9, color: dark.textSub, letterSpacing: 1 },

  // Phase 2
  skippedBox: {
    backgroundColor: dark.card, borderRadius: 12, borderWidth: 1, borderColor: dark.border,
    padding: 16, marginTop: 16,
  },
  skippedText: { fontFamily: F.body, fontSize: 13, color: dark.textSub, lineHeight: 18 },
  skipBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  skipBtnText: { fontFamily: F.bold, fontSize: 11, color: dark.textMuted, letterSpacing: 2 },

  // Bottom nav
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 12, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: dark.border, backgroundColor: dark.bg,
  },
  navBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  navBtnTxt: { fontFamily: F.bold, fontSize: 12, color: dark.text, letterSpacing: 2, marginLeft: 4 },
  navBtnDisabled: { opacity: 0.5 },
  stepCounter: { fontFamily: F.bold, fontSize: 11, color: dark.textSub, letterSpacing: 2 },
  navBtnPrimary: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: palette.aqua, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10,
  },
  navBtnPrimaryTxt: { fontFamily: F.bold, fontSize: 12, color: dark.bg, letterSpacing: 2, marginRight: 4 },
});
