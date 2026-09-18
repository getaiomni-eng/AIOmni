import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI, askAIVision, describeAIError, hasAISession } from '../../services/ai';
import { pickImageForVision } from '../../services/util/pickImage';
import { hasAIConsent } from '../../services/aiConsent';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CLASS_OF_2025_TEXT } from '../../services/seasonContext2026';
import { fetchAIOmniFormula, fetchKTCValues, fetchNFLInjuries, fetchSnapCounts, fetchVegasLines, type InjuryInfo, type RankedPlayer, type ScoringFormat } from '../../services/rankingsData';
import { getCurrentTier } from '../../services/purchases';
import { sanitizePromptInput } from '../../services/util/promptSafe';
import { consumePrompt, hasLinkedPlatform } from '../../services/promptQuota';
import { captureTradeGrade } from '../../services/judgmentCapture';
import { fetchLeagueTrades, isTradeListSupported, type LeagueTradeOption } from '../../services/leagueTrades';
import { C, F, R, SP, SZ } from '../constants/tokens';
import { useTheme, type ThemeTokens } from '../constants/theme';
import { Icon } from '../components/AIOmniIcons';
import { Alert } from '../../services/util/crossAlert';

type Format = 'redraft' | 'dynasty';

// Whose trade is being graded.
//
// 'mine'   — the original behavior. "Should I accept?" Factors the user's
//            own roster for positional fit, and the verdict is an
//            ACCEPT/DECLINE recommendation.
// 'league' — a trade between two OTHER teams in the league. There is no
//            "you" in it, so the grade must be neutral (who won) and the
//            user's roster must NOT leak into the reasoning. Grading a
//            leaguemate's trade against your own positional needs would be
//            actively wrong.
type Perspective = 'mine' | 'league';
type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'F';

type TradeResult = {
  receiveGrade: Grade;
  giveGrade: Grade;
  verdict: string;
  analysis: string;
  accept: boolean;
  tags: { label: string; color: string }[];
};

const GRADE_COLOR: Record<Grade, string> = {
  'A+': '#1e8c42',
  A: '#1e8c42',
  'A-': '#1e8c42',
  'B+': '#ffb800',
  B: '#ffb800',
  'B-': '#ffb800',
  'C+': '#b87820',
  C: '#b87820',
  'C-': '#b87820',
  'D+': '#a83040',
  D: '#a83040',
  F: '#a83040',
};

const EXAMPLES = [
  { give: 'CeeDee Lamb', get: 'Saquon Barkley + T. Lockett' },
  { give: 'Josh Allen + RB2', get: 'Lamar Jackson + WR2' },
  { give: 'Justin Jefferson', get: "Ja'Marr Chase + TE1" },
];

// Normalize a player name for matching against the AIOmni engine board.
const normName = (n: string) =>
  n.toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Resolve an abbreviated name ("A. Jeanty", "T. Henderson") against a set of
// normalized full-name keys ("ashton jeanty"). Screenshot extraction and most
// platform UIs abbreviate first names, and exact matching silently dropped
// those players off the board — the analyzer then graded a Jeanty trade with
// no rank or market value for Jeanty. Only resolves when the match is UNIQUE:
// an ambiguous initial (two J. Allens) stays unmatched, which the prompt
// handles honestly, rather than guessing the wrong player.
function resolveInitial(
  key: string,
  keys: Iterable<string>,
  accept?: (k: string) => boolean,
): string | null {
  const m = key.match(/^([a-z])\s+(.+)$/);
  if (!m) return null;
  const [, initial, last] = m;
  const hits: string[] = [];
  for (const k of keys) {
    const sp = k.indexOf(' ');
    if (sp <= 0) continue;
    if (k[0] === initial && k.slice(sp + 1) === last) hits.push(k);
  }
  // "B. Robinson" matches Bijan AND Brian. Refusing to guess was correct
  // but useless — it dropped the best player in the trade. Narrow with the
  // position/team the screenshot showed; only give up if still ambiguous.
  const narrowed = accept ? hits.filter(accept) : hits;
  const pool = narrowed.length ? narrowed : hits;
  return pool.length === 1 ? pool[0] : null;
}

// Screenshot extraction emits "Name (POS TEAM)" when the platform shows it.
// Split the hint off so the name still matches the board, and the hint can
// disambiguate players who share a surname.
function splitHints(tok: string): { name: string; pos?: string; team?: string } {
  const m = tok.match(/^(.*?)\s*[([]([^)\]]*)[)\]]\s*$/);
  if (!m) return { name: tok };
  const parts = m[2].split(/[,\s-]+/).map(h => h.trim().toUpperCase()).filter(Boolean);
  const pos = parts.find(h => /^(QB|RB|WR|TE|K|DEF|DST)$/.test(h));
  const team = parts.find(h => h !== pos && /^[A-Z]{2,3}$/.test(h));
  return { name: m[1].trim() || tok, pos, team };
}

// Split a free-text side ("CeeDee Lamb + 2026 1st") into candidate names and
// resolve each against the AIOmni board. Matched players carry their
// proprietary rank/tier PLUS market value (KTC) and live injury status, so the
// model grades off OUR engine + real context, not its own memory; unmatched
// tokens (picks, deep FAs) pass through with a note. Returns the formatted
// lines and the side's total KTC market value for the fleece-math comparison.
const ROUND_WORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
// Detect a draft pick token ("2027 1st", "2026 2nd Rd", "2027 first") and
// return its "<year> <round>" key, or null if it's not a pick.
// Parse a draft pick from free text. Handles the round-only form
// ("2026 1st") AND slot notation ("2026 1.01", "1:01", "Rd 1.01") — the
// latter previously fell through to the player-name path, so a trade for
// the 1.01 was graded as an unknown player with no value at all.
type ParsedPick = { year: string; round: number; slot?: number };

function parsePick(tok: string): ParsedPick | null {
  // Slot form first: optional year, optional "Rd", round . or : slot
  const slotM = tok.match(/(?:(20\d\d)\s*[-–]?\s*)?(?:rd\.?\s*)?\b([1-5])\s*[.:]\s*(\d{1,2})\b/i);
  if (slotM) {
    const slot = parseInt(slotM[3], 10);
    if (slot >= 1 && slot <= 32) {
      return {
        year: slotM[1] ?? String(new Date().getFullYear()),
        round: parseInt(slotM[2], 10),
        slot,
      };
    }
  }
  const m = tok.match(/(20\d\d)\D*(1st|2nd|3rd|4th|first|second|third|fourth)/i);
  if (!m) return null;
  const round = ROUND_WORD[m[2].toLowerCase()];
  return round ? { year: m[1], round } : null;
}

// KTC prices rookie picks as Early/Mid/Late tiers. With a known slot we can
// use the RIGHT tier instead of the blended average — the difference
// between the 1.01 and a generic first is the whole trade.
function pickTier(slot: number): 'early' | 'mid' | 'late' {
  if (slot <= 4) return 'early';
  if (slot <= 8) return 'mid';
  return 'late';
}

const pickLabel = (p: ParsedPick) =>
  p.slot ? `${p.year} ${p.round}.${String(p.slot).padStart(2, '0')}` : `${p.year} Round ${p.round}`;

// Rank-only fallback value, used SOLELY to keep a side's gradeValue from
// collapsing to zero when a player has an AIOmni rank but no KTC crowd
// price (2026-09-16). Deep/rookie/backfield names routinely miss KTC's
// published list while still being ranked on our own board -- N. Harris
// ("unranked" on OUR board too, so this never fires for him) vs. Dontayvion
// Wicks (WR83, Tier 5 -- IS ranked, but had no KTC entry) is exactly the
// case that broke a real trade grade to a flat B/B.
//
// A smooth exponential decay in the rough shape of a real dynasty value
// curve (top picks near 9999, fading toward the deep end) -- NOT a claim of
// precision, and NOT the AIOmni formula. It exists only so one unpriced
// player can't zero out an entire side's total when three other players on
// the same trade have real, decisive value data. Never shown to the user;
// internal to the grade-lock math only.
const rankValueFallback = (rank: number): number =>
  Math.round(9999 * Math.exp(-rank / 90));

function groundSide(
  raw: string,
  index: Map<string, RankedPlayer>,
  ktcByName: Map<string, number>,
  injuryByName: Map<string, string>,
  vegasByTeam: Map<string, number>,
  snapByName: Map<string, number>,
  pickValues: Map<string, number>,
): { lines: string; ktcTotal: number; gradeValue: number } {
  const tokens = raw.split(/[,\n+&/]|\band\b|\bplus\b/gi).map(s => s.trim()).filter(Boolean);
  if (!tokens.length) return { lines: '(nothing listed)', ktcTotal: 0, gradeValue: 0 };
  let ktcTotal = 0;
  // gradeValue mirrors ktcTotal (same KTC dollars for anything KTC prices)
  // but ALSO counts AIOmni-ranked players with no KTC entry, via the
  // fallback curve above. ktcTotal stays pure KTC -- it still drives the
  // "MARKET MATH (KTC crowd values)" line shown to the model, and that
  // label must stay honest. gradeValue is what the deterministic grade
  // lock (hasMarketData / netPct / givePct) actually reads.
  let gradeValue = 0;
  const lines = tokens.map(tok => {
    // Draft picks first — they carry their own KTC value, not a player rank.
    const pk = parsePick(tok);
    if (pk) {
      // Prefer the slot-specific tier value; fall back to the round average.
      const tierKey = pk.slot ? `${pk.year} ${pk.round} ${pickTier(pk.slot)}` : '';
      const pv = (tierKey && pickValues.get(tierKey)) || pickValues.get(`${pk.year} ${pk.round}`);
      const label = pickLabel(pk);
      if (pv) {
        ktcTotal += pv;
        gradeValue += pv;
        const slotNote = pk.slot
          ? `${pickTier(pk.slot)}-round-${pk.round} slot${pk.slot === 1 && pk.round === 1 ? ' — the 1.01, the most valuable pick on the board' : ''}`
          : 'slot unknown, priced as the round average';
        return `- ${label} pick — market value ${pv} (KTC, ${slotNote})`;
      }
      return `- ${label} pick (dynasty draft asset — value scales with your timeline)`;
    }
    const hint = splitHints(tok);
    let key = normName(hint.name);
    // "A. Jeanty" → "a jeanty" never exact-matches "ashton jeanty"; try the
    // initial resolver, narrowed by any position/team the screenshot gave.
    if (!index.has(key) && !ktcByName.has(key)) {
      const accept = (k: string) => {
        const cand = index.get(k);
        if (!cand) return true;            // KTC-only entry — nothing to check
        if (hint.pos && cand.position && cand.position.toUpperCase() !== hint.pos) return false;
        if (hint.team && cand.team && cand.team.toUpperCase() !== hint.team) return false;
        return true;
      };
      const resolved = resolveInitial(key, index.keys(), accept)
        ?? resolveInitial(key, ktcByName.keys());
      if (resolved) key = resolved;
    }
    const p = index.get(key);
    const ktc = ktcByName.get(key);
    const inj = injuryByName.get(key);
    if (ktc) { ktcTotal += ktc; gradeValue += ktc; }
    else if (p) { gradeValue += rankValueFallback(p.rank); }
    const bits: string[] = [];
    if (p) {
      const pr = p.posRank ? `${p.position}${p.posRank}` : p.position;
      bits.push(`AIOmni ${pr}, overall #${p.rank}, Tier ${p.tier}`);
    }
    if (ktc) bits.push(`market value ${ktc} (KTC)`);
    const snap = snapByName.get(key);
    if (snap) bits.push(`${snap}% snap share (latest data — role indicator)`);
    const implied = p?.team ? vegasByTeam.get(p.team.toUpperCase()) : undefined;
    if (implied) bits.push(`team implied ~${implied} pts this week (Vegas)`);
    if (inj) bits.push(`INJURY: ${inj}`);
    if (!p && !ktc) {
      // Phrased as a data note, not a crisis — the model was opening entire
      // answers with "I'm flying half-blind" off the back of this line.
      return `- ${hint.name} (no ranking or market value on file — judge on situation and role, don't cite numbers)`;
    }
    return `- ${p?.name ?? hint.name} — ${bits.join(' · ')}`;
  }).join('\n');
  return { lines, ktcTotal, gradeValue };
}

// Roster-fit context for a USER-SELECTED league. The old loader silently
// auto-picked "the first Sleeper league matching the format", so the same
// trade analyzed twice could be graded against different rosters — the
// user saw contradictory fit takes with no way to know which league was
// speaking. The league is now an explicit choice (or GENERAL = no roster
// bias, pure asset value).
async function loadSleeperRoster(leagueId: string, board: RankedPlayer[]): Promise<string[]> {
  try {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return [];
    const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    if (!user?.user_id) return [];
    const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json();
    const mine = Array.isArray(rosters) ? rosters.find((r: any) => r.owner_id === user.user_id) : null;
    if (!mine?.players) return [];
    const bySleeperId = new Map<string, string>();
    for (const p of board) if ((p as any).sleeperId) bySleeperId.set((p as any).sleeperId, p.name);
    return (mine.players as string[]).map(id => bySleeperId.get(id)).filter(Boolean) as string[];
  } catch { return []; }
}

async function loadEspnRoster(leagueId: string): Promise<string[]> {
  try {
    const { loadESPNCredentials, getESPNLeague, findMyESPNTeam } = require('../../services/espn');
    const creds = await loadESPNCredentials();
    if (!creds) return [];
    const data = await getESPNLeague(parseInt(leagueId, 10), creds);
    const me = data ? findMyESPNTeam(data, creds.swid) : null;
    return (me?.roster?.entries ?? [])
      .map((e: any) => e.playerPoolEntry?.player?.fullName)
      .filter(Boolean);
  } catch { return []; }
}

export default function TradesScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const [format, setFormat] = useState<Format>('redraft');
  const [perspective, setPerspective] = useState<Perspective>('mine');
  const [leagueTrades, setLeagueTrades] = useState<LeagueTradeOption[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  // Labels swap wholesale between the two modes. Kept in one place so the
  // inputs, the grade boxes, the prompt and the share text can never drift
  // into disagreeing about which side is which.
  const isLeague = perspective === 'league';
  // Input fields. `giving` is side A's outgoing players, `getting` is side
  // B's outgoing players -- unchanged from 'mine' mode, so all the parsing,
  // grounding and grade math below works identically.
  const sideALbl = isLeague ? 'TEAM A SENDS' : 'YOU ARE GIVING';
  const sideBLbl = isLeague ? 'TEAM B SENDS' : 'YOU ARE RECEIVING';
  // Grade boxes, and the pairing is easy to get backwards:
  //   box 1 renders lockedReceive = the graded value of `getting`
  //                                = what B sent = A's haul  -> TEAM A GETS
  //   box 2 renders lockedGive    = the graded value of `giving`
  //                                = what A sent = B's haul  -> TEAM B GETS
  const gradeALbl = isLeague ? 'TEAM A GETS' : 'YOU RECEIVE';
  const gradeBLbl = isLeague ? 'TEAM B GETS' : 'YOU GIVE UP';
  const [giving, setGiving] = useState('');
  const [getting, setGetting] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [youReceiveGrade, setYouReceiveGrade] = useState<Grade>('B+');
  const [youGiveGrade, setYouGiveGrade] = useState<Grade>('C+');
  const [verdict, setVerdict] = useState('');
  const [analysis, setAnalysis] = useState('');
  // True when the proprietary engine board failed to load and the grade is
  // running on market values + model knowledge alone — surfaced to the user
  // so an ungrounded grade isn't mistaken for an engine-backed one.
  const [degraded, setDegraded] = useState(false);

  // League context for roster-fit grading. 'general' = no roster bias.
  // Options come from ALL connected platforms and carry the league's
  // scoring/type metadata so a roster-less league (pre-draft) can still
  // be graded against its RULES. The last choice persists.
  type TradeCtxOpt = {
    key: string; label: string;
    platform: 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker';
    id: string;
    fmt?: string;                       // 'PPR' | '0.5 PPR' | 'STD' (+' · SF')
    ltype?: 'dynasty' | 'redraft';
  };
  const [ctxOptions, setCtxOptions] = useState<TradeCtxOpt[]>([]);
  const [ctxChoice, setCtxChoice]   = useState<string>('general');
  useEffect(() => {
    (async () => {
      const opts: TradeCtxOpt[] = [];
      try {
        const username = await AsyncStorage.getItem('sleeper_username');
        if (username) {
          const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
          if (user?.user_id) {
            const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
            const season = state?.season ?? String(new Date().getFullYear());
            const leagues = await (await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`)).json();
            for (const l of Array.isArray(leagues) ? leagues : []) {
              const rec = l?.scoring_settings?.rec;
              const sf  = (l?.roster_positions ?? []).includes('SUPER_FLEX');
              const fmt = (rec >= 1 ? 'PPR' : rec >= 0.5 ? '0.5 PPR' : 'STD') + (sf ? ' · SF' : '');
              const ltype = (l?.settings?.type === 2 || !!l?.previous_league_id) ? 'dynasty' as const : 'redraft' as const;
              opts.push({ key: `sleeper:${l.league_id}`, label: l.name, platform: 'sleeper', id: String(l.league_id), fmt, ltype });
            }
          }
        }
      } catch { /* sleeper unavailable — chips just won't show it */ }
      try {
        const raw = await AsyncStorage.getItem('espn_leagues_v2');
        for (const s of raw ? JSON.parse(raw) : []) {
          // Drafted ESPN leagues have rosters; pre-draft ones still get a
          // chip so their RULES can drive a roster-less grade.
          if (s?.id) opts.push({ key: `espn:${s.id}`, label: s.name, platform: 'espn', id: String(s.id) });
        }
      } catch { /* espn unavailable */ }
      try {
        const { getValidYahooToken, getYahooLeagues } = require('../../services/yahoo');
        const token = await getValidYahooToken();
        if (token) {
          const yls = await getYahooLeagues(token, String(new Date().getFullYear()));
          for (const l of Array.isArray(yls) ? yls : []) {
            const key = l?.league_key ?? l?.league_id;
            if (key) opts.push({ key: `yahoo:${key}`, label: l?.name ?? `Yahoo ${key}`, platform: 'yahoo', id: String(key) });
          }
        }
      } catch { /* yahoo unavailable */ }
      for (const pid of ['mfl', 'fleaflicker'] as const) {
        try {
          const { getPlatform } = require('../../services/platform');
          const plat = getPlatform(pid);
          const ls = await plat.getLeagues(String(new Date().getFullYear())).catch(() => []);
          for (const l of ls as any[]) {
            const fmt = l.scoringFormat === 'ppr' ? 'PPR' : l.scoringFormat === 'half' ? '0.5 PPR' : l.scoringFormat === 'std' ? 'STD' : undefined;
            opts.push({ key: `${pid}:${l.id}`, label: l.name, platform: pid, id: String(l.id), fmt, ltype: l.leagueType === 'dynasty' ? 'dynasty' : 'redraft' });
          }
        } catch { /* platform unavailable */ }
      }
      setCtxOptions(opts);
      try {
        const saved = await AsyncStorage.getItem('trade_ctx_choice');
        if (saved && (saved === 'general' || opts.some(o => o.key === saved))) setCtxChoice(saved);
      } catch { /* keep default */ }
    })();
  }, []);
  const pickCtx = (key: string) => {
    setCtxChoice(key);
    // Stale grades were computed against a different roster context.
    setVerdict('');
    setAnalysis('');
    // A league's type is a fact — picking a dynasty league flips the
    // format toggle so the grade uses the right value framework.
    const sel = ctxOptions.find(o => o.key === key);
    if (sel?.ltype) setFormat(sel.ltype);
    AsyncStorage.setItem('trade_ctx_choice', key).catch(() => {});
  };

  // v2026-06-10: read a trade-proposal screenshot → auto-fill both sides; the
  // normal engine-grounded grader then runs on the extracted players.
  const extractFromScreenshot = async () => {
    if (extracting || loading) return;
    const picked = await pickImageForVision();
    if (picked.status === 'canceled') return;
    if (picked.status === 'no_permission') { setVerdict('Photo access is needed to read a screenshot.'); return; }
    if (picked.status === 'failed') { setVerdict("Couldn't open that image. Try another screenshot."); return; }
    const asset = { base64: picked.image.base64, mimeType: picked.image.mimeType };
    setExtracting(true);
    setVerdict(''); setAnalysis('');
    try {
      const out = await askAIVision(
        asset.base64!,
        asset.mimeType ?? 'image/jpeg',
        `This is a screenshot of a fantasy football trade proposal. Read BOTH sides exactly and return ONLY this JSON, nothing else:
{"giving":[everything the app's user SENDS AWAY],"getting":[everything the user RECEIVES]}
Each array item is a string. Capture EVERY asset on each side — do NOT skip anything:
- Players → full name, and APPEND the position and NFL team in parentheses
  whenever the screenshot shows them: "Bijan Robinson (RB ATL)",
  "B. Robinson (RB ATL)". This matters: platforms abbreviate first names,
  and "B. Robinson" alone is ambiguous between Bijan Robinson and Brian
  Robinson — the position and team are what tell them apart. If the shot
  shows only a surname, still include whatever position/team is visible.
- Draft picks → DRAFT PICKS ARE CRITICAL. Never omit them, even in small text or with "via [name]".
  PRESERVE THE PICK SLOT EXACTLY WHEN IT IS SHOWN. Sleeper and MFL display
  picks as "2026 - Rd 1.01" or "1.01" — that trailing number is the slot and
  it is the single most important detail on the pick: the 1.01 is worth
  multiples of a late first. Output slot picks as "YEAR R.SS", e.g.
  "2026 - Rd 1.01" → "2026 1.01"; "Rd 2.07" → "2026 2.07".
  ONLY when no slot is visible, fall back to year + round: "2027 1st".
Decide which side is the user's by on-screen labels ("You give"/"You receive"/"You get"/"They get"/"Sends"/"Receives"). If a side shows "Receives", those are the items the user GETS.`,
        { tier: 'fast', maxTokens: 400 },
      );
      const clean = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
      const parsed = JSON.parse(clean);
      const g = Array.isArray(parsed.giving) ? parsed.giving.join(', ') : '';
      const r = Array.isArray(parsed.getting) ? parsed.getting.join(', ') : '';
      setGiving(g); setGetting(r);
      if (!g && !r) setVerdict("Couldn't read players from that image — type them instead.");
    } catch (e: any) {
      if (e?.message?.includes('ai_consent_required')) {
        setVerdict('AI features are turned off.');
        setAnalysis('To read screenshots, enable “Share data with AI service” in Settings.');
      } else if (e?.message?.includes('not_authenticated')) {
        setVerdict('Sign in to use AI features.');
        setAnalysis('Create a free account (Settings → Sign in) to use the screenshot reader.');
      } else {
        setVerdict("Couldn't read that screenshot — type the players instead.");
      }
    } finally {
      setExtracting(false);
    }
  };

  const analyzeTrade = async () => {
    // Free prompts unlock only after a platform is linked (activation gate,
    // mirrors the coach) — otherwise a fresh install could burn all 10 free
    // prompts on manual trade text without ever connecting a league.
    const tierNow = await getCurrentTier();
    if (tierNow === 'free' && !(await hasLinkedPlatform())) {
      Alert.alert(
        'Connect a league first',
        'Your 10 free AI prompts unlock once you link a fantasy platform (Sleeper, ESPN, Yahoo, MFL, or Fleaflicker) in Settings.',
      );
      return;
    }
    // 5.1.1(i): never charge a prompt for a call the consent gate will refuse.
    if (!(await hasAIConsent())) {
      setVerdict('AI features are turned off.');
      setAnalysis('To analyze trades, enable “Share data with AI service” in Settings.');
      return;
    }
    // Guests can't reach the AI proxy — don't burn a lifetime prompt trying.
    if (!(await hasAISession())) {
      setVerdict('Sign in to use AI features.');
      setAnalysis('Create a free account (Settings → Sign in) to analyze trades.');
      return;
    }
    // Charge a prompt up front; if over cap, route to paywall and bail.
    const ok = await consumePrompt();
    if (!ok) {
      const tier = await getCurrentTier();
      const ctx = tier === 'free' ? 'free_prompts_exhausted' : 'weekly_prompts_exhausted';
      router.push(`/paywall?context=${ctx}` as any);
      return;
    }
    try {
      // Sanitize raw user input before interpolating into the prompt
      // (highest-risk surface for prompt injection — both fields are
      // free-text and go straight into the model context).
      const safeGiving  = sanitizePromptInput(giving);
      const safeGetting = sanitizePromptInput(getting);

      // Ground the grades in AIOmni's proprietary engine board (format-matched),
      // KTC market values, and live injury status — not the model's own memory.
      const engineFmt: ScoringFormat = format === 'dynasty' ? 'DYN' : 'PPR';
      const index = new Map<string, RankedPlayer>();
      const ktcByName = new Map<string, number>();
      const injuryByName = new Map<string, string>();
      const vegasByTeam = new Map<string, number>();
      const snapByName = new Map<string, number>();
      const pickValues = new Map<string, number>();
      let myRoster: string[] = [];
      try {
        const [board, ktc, injuries, vegas, snaps] = await Promise.all([
          fetchAIOmniFormula(engineFmt),
          fetchKTCValues().catch(() => null),
          fetchNFLInjuries().catch(() => [] as InjuryInfo[]),
          fetchVegasLines().catch(() => new Map<string, number>()),
          fetchSnapCounts().catch(() => new Map<string, number>()),
        ]);
        for (const p of board) index.set(normName(p.name), p);
        if (ktc) {
          const table = format === 'dynasty' ? ktc.dynasty : ktc.redraft;
          // Pick values average the early/mid/late tiers for each year+round,
          // since a traded pick rarely specifies its slot.
          const pickBuckets = new Map<string, number[]>();
          for (const [name, v] of Object.entries(table)) {
            if (v.pos === 'RDP') {
              const m = name.match(/(20\d\d)\D*(1st|2nd|3rd|4th)/i);
              const rd = m ? ROUND_WORD[m[2].toLowerCase()] : 0;
              if (m && rd && v.oneQB > 0) {
                const k = `${m[1]} ${rd}`;
                (pickBuckets.get(k) ?? pickBuckets.set(k, []).get(k)!).push(v.oneQB);
                // Also index the Early/Mid/Late tier on its own so a known
                // slot can be priced exactly rather than averaged away.
                const tier = /early/i.test(name) ? 'early' : /mid/i.test(name) ? 'mid' : /late/i.test(name) ? 'late' : '';
                if (tier) pickValues.set(`${m[1]} ${rd} ${tier}`, v.oneQB);
              }
              continue;
            }
            if (v.oneQB > 0) ktcByName.set(normName(name), v.oneQB);
          }
          for (const [k, vals] of pickBuckets) {
            pickValues.set(k, Math.round(vals.reduce((s, x) => s + x, 0) / vals.length));
          }
        }
        for (const inj of injuries) {
          if (inj.name && inj.status) injuryByName.set(normName(inj.name), `${inj.status}${inj.detail ? ` — ${inj.detail}` : ''}`);
        }
        for (const [team, implied] of vegas) vegasByTeam.set(team, implied);
        for (const [name, pct] of snaps) snapByName.set(normName(name), pct);
        // Roster fit — only for the league the USER selected; GENERAL skips
        // roster context entirely so grades are pure asset value.
        if (ctxChoice !== 'general') {
          const sel = ctxOptions.find(o => o.key === ctxChoice);
          if (sel) {
            switch (sel.platform) {
              case 'sleeper':
                myRoster = await loadSleeperRoster(sel.id, board).catch(() => []);
                break;
              case 'espn':
                myRoster = await loadEspnRoster(sel.id).catch(() => []);
                break;
              case 'yahoo': {
                const { getValidYahooToken, getMyYahooTeam } = require('../../services/yahoo');
                const token = await getValidYahooToken();
                const mine = token ? await getMyYahooTeam(sel.id, token).catch(() => null) : null;
                myRoster = (mine?.roster?.players ?? [])
                  .map((p: any) => p?.name?.full)
                  .filter(Boolean);
                break;
              }
              case 'mfl':
              case 'fleaflicker': {
                const { getPlatform } = require('../../services/platform');
                const roster = await getPlatform(sel.platform).getMyRoster(sel.id).catch(() => null);
                myRoster = [...(roster?.starters ?? []), ...(roster?.bench ?? [])]
                  .map((s: any) => s?.player?.name)
                  .filter(Boolean);
                break;
              }
            }
          }
        }
      } catch { /* fall through: model grades unanchored if data is down */ }
      // If the proprietary board never loaded, every player fell through as
      // "not on the AIOmni board" and the grade is leaning on KTC market value
      // + model knowledge, not our calibrated projections. Flag it both to the
      // user (banner) and to the model (so it grades more cautiously).
      const engineGrounded = index.size > 0;
      setDegraded(!engineGrounded);
      const givingGrounded  = groundSide(safeGiving, index, ktcByName, injuryByName, vegasByTeam, snapByName, pickValues);
      const gettingGrounded = groundSide(safeGetting, index, ktcByName, injuryByName, vegasByTeam, snapByName, pickValues);
      // Market math: total KTC value on each side → instant fleece detection.
      const marketMath = (givingGrounded.ktcTotal > 0 && gettingGrounded.ktcTotal > 0)
        ? (isLeague
            ? `\nMARKET MATH (KTC crowd values): Team A sends ${givingGrounded.ktcTotal} ⇄ Team B sends ${gettingGrounded.ktcTotal} (${gettingGrounded.ktcTotal >= givingGrounded.ktcTotal ? '+' : ''}${(((gettingGrounded.ktcTotal - givingGrounded.ktcTotal) / givingGrounded.ktcTotal) * 100).toFixed(0)}% toward Team A by market consensus)`
            : `\nMARKET MATH (KTC crowd values): you send ${givingGrounded.ktcTotal} ⇄ you receive ${gettingGrounded.ktcTotal} (${gettingGrounded.ktcTotal >= givingGrounded.ktcTotal ? '+' : ''}${(((gettingGrounded.ktcTotal - givingGrounded.ktcTotal) / givingGrounded.ktcTotal) * 100).toFixed(0)}% for you by market consensus)`)
        : '';

      // ── Deterministic grading ─────────────────────────────────────
      // The LETTERS come from market math in code, not from the model.
      // Model-authored grades were non-deterministic (same trade, different
      // letters run to run) and sycophantic — "should I accept?" leans
      // accept, which produced smash-accept verdicts in BOTH directions on
      // the same trade. Now: same trade → same grades, and analyzing the
      // flip side produces the exact mirror. The model writes ONLY the
      // prose around the locked call.
      //
      // Reads gradeValue, not ktcTotal (2026-09-16). ktcTotal is pure KTC
      // and requires EVERY player on a side to have a crowd price, so one
      // deep/unranked name (a backfield RB, a rookie off KTC's list) zeroed
      // the whole side and forced a flat B/B "too close to call" even when
      // the other three players on the trade had decisive real data --
      // Lamar Jackson (QB7 #25) + Nico Collins (WR13 #39) for Wicks (WR83)
      // + an unranked RB + a 2029 first came back B/B despite the model's
      // own analysis calling it a "hard pass." gradeValue blends in
      // AIOmni-ranked players with no KTC entry via a fallback curve, so a
      // side only reads as truly data-free when NOTHING on it is priced or
      // ranked at all -- the honest case for "too close to call."
      const hasMarketData = givingGrounded.gradeValue > 0 && gettingGrounded.gradeValue > 0;
      const netPct = hasMarketData
        ? ((gettingGrounded.gradeValue - givingGrounded.gradeValue) / givingGrounded.gradeValue) * 100
        : 0;
      const gradeFromNet = (pct: number): Grade =>
        pct >= 30 ? 'A+' : pct >= 20 ? 'A' : pct >= 12 ? 'A-' :
        pct >= 7  ? 'B+' : pct >= 3  ? 'B' : pct > -3  ? 'B-' :
        pct > -7  ? 'C+' : pct > -12 ? 'C' : pct > -20 ? 'C-' :
        pct > -30 ? 'D+' : pct > -45 ? 'D' : 'F';
      // Mirror-symmetric: what you receive is graded by your net; what you
      // give up is graded by the OTHER side's net (their gain is your loss).
      const givePct = hasMarketData
        ? ((givingGrounded.gradeValue - gettingGrounded.gradeValue) / gettingGrounded.gradeValue) * 100
        : 0;
      const lockedReceive: Grade = hasMarketData ? gradeFromNet(netPct) : 'B';
      const lockedGive: Grade    = hasMarketData ? gradeFromNet(givePct) : 'B';
      // ACCEPT/DECLINE is a recommendation and only makes sense when the
      // trade is the user's. For a leaguemate's deal the same math answers a
      // different question -- who won -- so the locked direction is phrased
      // as a winner. netPct > 0 means side B's outgoing package (what Team A
      // receives) is worth more, so Team A won.
      const lockedCall = !hasMarketData
        ? 'TOO CLOSE TO CALL — insufficient market data'
        : isLeague
          ? (netPct >= 3 ? 'TEAM A WON' : netPct <= -3 ? 'TEAM B WON' : 'EVEN — neither side clearly won on value')
          : (netPct >= 3 ? 'ACCEPT' : netPct <= -3 ? 'DECLINE' : 'TOSS-UP — value is even; let roster fit decide');

      // ── VERDICT VOICE, SCALED TO THE ACTUAL GAP ────────────────────────
      // Every trade used to be handed the same vocabulary. The prompt seeded
      // "straight-up fleece" and "robbing you blind" as the examples and then
      // told the model to be punchy, so a 5% edge got the same language as a
      // 50% one. A real B+/C trade in testing came back "Team A fleeced Team
      // B" -- on a modest edge where nobody was fleeced.
      //
      // Cutoffs are percentiles of trade_corpus: the gap distribution on
      // trades two managers actually ACCEPTED (p25 8, median 19, p75 31).
      // So "fleece" is reserved for the top sliver of lopsidedness that real
      // managers still agree to -- not for the median trade.
      //
      // The top cutoff is 35, not p75's 31, to match FLAG_THRESHOLD_PCT in
      // judgmentCapture. Two thresholds that both mean "this one is lopsided"
      // should be the same number, or the app says "fleece" on a trade its own
      // dataset filed as fine. Move them together.
      //
      // The GRADES are untouched. A 19% gap is still A-/C-, because that is
      // what the value math says. Only the prose scales.
      const gapAbs = hasMarketData ? Math.abs(netPct) : -1;
      const band =
        gapAbs < 0  ? 'unknown' :
        gapAbs < 8  ? 'even'    :
        gapAbs < 19 ? 'slight'  :
        gapAbs < 35 ? 'clear'   : 'lopsided';
      const BAND_VOICE: Record<string, string> = {
        even:     'GAP: under 8% — inside the noise. Say it is EVEN. Words like fleece, robbed, heist, smash are FORBIDDEN here; using one is a wrong answer. "Dead even", "coin flip on value", "pick em" are all correct verdicts.',
        slight:   'GAP: 8-19% — a real but ordinary edge, around the median trade people accept. Say "slight edge" or "modest win". Do NOT say fleece, robbed or heist.',
        clear:    'GAP: 19-35% — one side clearly did better. "Got the better end", "clear win", "won this comfortably". Still NOT a fleecing; do not use fleece or robbed.',
        lopsided: 'GAP: 35%+ — the genuinely lopsided tail. Fleecing language is EARNED here: fleece, robbed blind, heist, highway robbery all fit.',
        unknown:  'GAP: unknown — no market data. Grade on football reasoning and keep the language measured.',
      };
      const system = `You are The O — AIOmni's AI fantasy coach grading a trade. You're the sharpest, most confident voice in the room: the user's savvy fantasy buddy who's seen it all, not a corporate robot. You have STRONG opinions and you back them. Be decisive, a little cocky, occasionally funny. Talk like a real fantasy player — "smash accept", "hard pass", "that's a fleece", "buy-low", "ship it", "they're robbing you", "ascending", "RB dead zone". NEVER hedge into mush — pick a side and sell it.

Signals per player (use whichever are present): (1) AIOmni's PROPRIETARY rank — a calibrated projection engine, your primary anchor; (2) KTC market value — what the crowd thinks it's worth; (3) live injury status; (4) snap share — role security; (5) Vegas implied team total — offense environment. Your edge is the DISAGREEMENTS: when AIOmni likes a player more than the market, that's a buy-low to pounce on; when the market overprices someone our engine is out on, say so ("the crowd's still paying for last year"). Injuries change everything — flag them. If the user's roster is provided, factor FIT.

THE CALL IS ALREADY MADE. AIOmni's grading engine has computed the grades and the verdict direction from market math — they are FINAL and you MUST NOT contradict them. Your job is the WHY: write the verdict line and analysis that explain the locked call with your voice and the signals above. If roster fit cuts against the locked call, say so as a caveat ("value says accept, but…") — the letters don't move.

LOCKED BY THE ENGINE:
${isLeague
  ? `- Team A gets: ${lockedReceive}  |  Team B gets: ${lockedGive}`
  : `- You receive: ${lockedReceive}  |  You give up: ${lockedGive}`}
- Verdict direction: ${lockedCall}
- ${BAND_VOICE[band]}

Respond with ONLY a single valid JSON object — no markdown, no code fences, no preamble, and do NOT output a second or revised version:
${isLeague
  ? `{"youReceiveGrade":"${lockedReceive}","youGiveGrade":"${lockedGive}","verdict":"<ONE punchy line matching the locked verdict direction AND the gap band above. Never address the user as a participant and never say accept or decline>","analysis":"<2-3 sentences with conviction: WHY the locked call is right (cite AIOmni ranks + market values). Talk about Team A and Team B, never about the user's roster or needs>"}`
  : `{"youReceiveGrade":"${lockedReceive}","youGiveGrade":"${lockedGive}","verdict":"<ONE punchy line matching the locked verdict direction AND the gap band above>","analysis":"<2-3 sentences with conviction: WHY the locked call is right (cite AIOmni ranks + market values), plus any roster-fit caveat>"}`}

NUMBERS — non-negotiable:
- Every rank, tier and market value you cite must be copied VERBATIM from
  the player lines above, attached to the player it was listed under.
  Never carry a number from one player to another, never average, never
  infer a rank you were not given. If a player's line has no rank, say he
  has no rank rather than reusing a neighbour's.

VOICE — non-negotiable:
- OPEN WITH THE CALL. Never open with what you don't know. A verdict that
  starts by discussing your own data ("I'm flying half-blind", "the board has
  no read", "I won't pretend otherwise") is a failed answer, even when true.
- Missing ranks are not an excuse to withhold judgment. You still know
  football: role, target/touch competition, offensive context, age, timeline.
  Grade on that and say so plainly.
- If data is genuinely thin, ONE short clause at the END of the analysis —
  "market values aren't loaded for these three, so this is a situational
  read" — never the headline, never the verdict line.
- Do not hedge into mush — EXCEPT when the gap band above says the trade is
  EVEN. On an even trade "dead even" IS the decisive answer, and manufacturing
  a winner to sound sharp is the app being confidently wrong. Outside that
  band, pick the side the reasoning supports and name the condition that would
  flip it (contending vs rebuilding, for instance).`;

      const prompt = `Format: ${format === 'dynasty' ? 'DYNASTY — value = age + multi-year production' : 'REDRAFT PPR — value = rest-of-season'}
AIOmni board used: ${engineFmt}

${isLeague ? 'TEAM A SENDS (Team B receives these):' : 'YOU ARE GIVING UP:'}
${givingGrounded.lines}

${isLeague ? 'TEAM B SENDS (Team A receives these):' : 'YOU ARE RECEIVING:'}
${gettingGrounded.lines}
${marketMath}${(() => {
        const sel = ctxChoice !== 'general' ? ctxOptions.find(o => o.key === ctxChoice) : undefined;
        // League mode: this is somebody else's trade. The user's roster is
        // irrelevant and actively misleading here -- grading a leaguemate's
        // deal against YOUR positional needs is just wrong. Rules still
        // matter (superflex changes QB value for everyone), so those are
        // passed when a league is selected; the roster never is.
        if (isLeague) {
          const rules = sel ? ([sel.fmt, sel.ltype].filter(Boolean).join(' · ') || `${format} (per user toggle)`) : null;
          return `\n\nTHIS IS NOT THE USER'S TRADE. It is a deal between two other teams in the league, and the user is a spectator judging who won. There is no "you" in this trade.${rules ? ` League rules: ${rules} — factor how these rules shift asset value (full PPR lifts target-earning RBs/WRs; superflex/2QB makes QBs premium; dynasty weights age and picks).` : ''} Do NOT reference the user's roster, needs, or timeline. Do NOT recommend accepting or declining — neither side is the user's to accept. Name which team won and by how much.`;
        }
        if (myRoster.length) {
          return `\n\nYOUR CURRENT ROSTER (${sel?.label ?? 'selected league'} — ranked players; judge positional fit):\n${myRoster.join(', ')}`;
        }
        if (sel) {
          // League chosen but no roster came back (pre-draft, or fetch
          // failed): grade against the league's RULES instead of guessing.
          const rules = [sel.fmt, sel.ltype].filter(Boolean).join(' · ') || `${format} (per user toggle)`;
          return `\n\nROSTER DATA UNAVAILABLE for "${sel.label}" (likely pre-draft). League rules: ${rules}. Anchor the grade in how THESE RULES shift asset value — full PPR lifts target-earning RBs/WRs a tier; STD favors TD-and-volume runners; superflex/2QB makes QBs premium; dynasty weights age and picks, redraft weights this season only. Do NOT invent roster needs or claim to know the user's team.`;
        }
        return `\n\nNO ROSTER CONTEXT (user chose General) — grade pure asset value. Do NOT invent roster-fit arguments or claim to know what the user needs.`;
      })()}${engineGrounded ? '' : `\n\n⚠ INTERNAL NOTE (do NOT open your answer with this): AIOmni's ranking engine didn't load, so you're grading on KTC market values + situational reads rather than calibrated projections. Stay fully decisive and lead with the call. Don't cite precise AIOmni ranks you don't have. Mention the limitation at most once, in a short clause at the end.`}`;
      // Sonnet 5, not the 'smart' default: the grades and verdict direction
      // are LOCKED by the engine before this call, so the model is writing
      // prose around a decision it doesn't make — the judgment Opus buys
      // isn't being exercised. Verified side-by-side on a real trade: Sonnet
      // cited MORE of the available signals (both snap shares + the Vegas
      // total, which Opus skipped), produced valid JSON with the locked
      // grades intact, and returned 28% faster at 40% of the cost.
      const response = await askAI(prompt, { maxTokens: 600, system: `${system}\n\n${CLASS_OF_2025_TEXT}`, tier: 'mid', feature: 'trade' });
      console.log('Raw AI response:', response);
      // The model is told to return one JSON object, but sometimes emits a
      // preamble, code fences, or even a second "revised" object with prose
      // in between (e.g. "Wait — let me sell this straight."). The old
      // first-{ to last-} slice then spanned BOTH objects plus the prose,
      // producing invalid JSON. Instead, scan out every balanced top-level
      // {...} block (string-aware, so braces inside values don't confuse
      // it) and take the LAST one that parses and carries grades — the
      // model's final answer.
      const stripped = response.replace(/```json|```/g, '');
      const blocks: string[] = [];
      let depth = 0, start = -1, inStr = false, esc = false;
      for (let i = 0; i < stripped.length; i++) {
        const ch = stripped[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') { if (depth === 0) start = i; depth++; }
        else if (ch === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { blocks.push(stripped.slice(start, i + 1)); start = -1; } }
      }
      let parsed: any = null;
      for (let i = blocks.length - 1; i >= 0; i--) {
        try {
          const p = JSON.parse(blocks[i]);
          if (p && (p.youReceiveGrade || p.youGiveGrade)) { parsed = p; break; }
        } catch { /* not valid JSON — try the next-earlier block */ }
      }
      if (parsed) {
        // Grades come from the deterministic engine, NOT the model — set
        // them from the locked values regardless of what the model echoed.
        // Only the prose (verdict line + analysis) is model-authored.
        setYouReceiveGrade(lockedReceive);
        setYouGiveGrade(lockedGive);
        setVerdict(parsed.verdict ?? '');
        setAnalysis(parsed.analysis ?? '');

        // Judgment capture. Only on a successful parse: a trade we failed to
        // grade is not a graded trade, and logging it would put rows in the
        // dataset whose ruling never reached the user. Fire-and-forget.
        (() => {
          const capSel = ctxChoice !== 'general'
            ? ctxOptions.find(o => o.key === ctxChoice) : undefined;
          captureTradeGrade({
            leagueRef: capSel ? `${capSel.platform}:${capSel.id}` : null,
            giving:    safeGiving,
            getting:   safeGetting,
            ktcGiving:  givingGrounded.ktcTotal,
            ktcGetting: gettingGrounded.ktcTotal,
            // netPct is 0 (not null) when market data is missing — passing
            // that through would read as "dead even" instead of "unknown".
            netPct: hasMarketData ? netPct : null,
            gradeReceive: lockedReceive,
            gradeGive:    lockedGive,
            format,
            engineFormat: engineFmt,
            engineGrounded,
            hasMarketData,
            // League mode deliberately withholds the roster from the prompt,
            // so it was NOT part of this grade even when one was fetched.
            // Reporting it as present would poison the captured dataset.
            hasRosterContext: !isLeague && myRoster.length > 0,
            perspective,
            verdict:  parsed.verdict ?? '',
            analysis: parsed.analysis ?? '',
          });
        })();
      } else {
        console.log('Parse error: no valid grade JSON found in response');
        setVerdict('Could not parse response. Try again.');
        setAnalysis(response.slice(0, 300));
      }
    } catch (error: any) {
      if (error?.message?.includes('ai_consent_required')) {
        // 5.1.1(i): consent declined — name the real cause, not a timeout.
        setVerdict('AI features are turned off.');
        setAnalysis('To analyze trades, enable “Share data with AI service” in Settings.');
      } else if (error?.message?.includes('not_authenticated')) {
        setVerdict('Sign in to use AI features.');
        setAnalysis('Create a free account (Settings → Sign in) to analyze trades.');
      } else {
        setVerdict('Analysis failed.');
        setAnalysis(describeAIError(error, 'Unable to complete analysis. Tap Analyze Again to retry.'));
      }
    }
  };

  // Growth lever: the app had exactly one Share.share() call anywhere,
  // buried inside AIOmni-hosted leagues (a handful of leagues, a handful of
  // people). A graded trade is the best moment nothing was using -- it is
  // naturally shareable (a verdict, a receipt), and the other side of the
  // trade is the highest-intent install target there is: someone already
  // deep in a real league, looking at this exact trade, this week.
  const shareGrade = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const give = giving.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).join(', ');
    const get = getting.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).join(', ');
    // League mode has no "me" in it, so the first-person framing would be a
    // lie. Share the verdict on somebody else's deal instead -- which is
    // arguably the more shareable of the two, since league-chat arguments
    // about a lopsided trade are exactly where this gets pasted.
    const msg = isLeague
      ? `${give} for ${get} — AIOmni graded it ${youReceiveGrade} / ${youGiveGrade}.\n\n${verdict}\n\nGrade any trade in your league free: https://apps.apple.com/app/id6760617627`
      : `Traded ${give} for ${get} — AIOmni graded it ${youReceiveGrade} for me.\n\n${verdict}\n\nGrade your own trades free: https://apps.apple.com/app/id6760617627`;
    Share.share({ message: msg }).catch(() => {});
  };

  // Load real league trades when the user is in LEAGUE mode with a real
  // league selected. Only fires for platforms whose transaction feed can
  // actually be reconstructed into two sides (Sleeper) -- see
  // services/leagueTrades.ts for why the others cannot.
  useEffect(() => {
    const sel = ctxChoice !== 'general' ? ctxOptions.find(o => o.key === ctxChoice) : undefined;
    if (!isLeague || !sel || !isTradeListSupported(sel.platform)) {
      setLeagueTrades([]);
      return;
    }
    let alive = true;
    setLoadingTrades(true);
    fetchLeagueTrades(sel.platform, sel.id)
      .then(list => { if (alive) setLeagueTrades(list); })
      .catch(() => { if (alive) setLeagueTrades([]); })
      .finally(() => { if (alive) setLoadingTrades(false); });
    return () => { alive = false; };
  }, [isLeague, ctxChoice, ctxOptions]);

  // Tapping a real trade prefills both sides. Deliberately a PREFILL, not
  // an auto-grade: the text lands in the visible inputs so the user can see
  // exactly what was read (and fix it) before spending a prompt on it.
  const useLeagueTrade = (tr: LeagueTradeOption) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setGiving(tr.aSends);
    setGetting(tr.bSends);
    setVerdict('');
    setAnalysis('');
  };

  const canAnalyze = giving.trim().length > 0 && getting.trim().length > 0;

  const analyze = async () => {
    if (!canAnalyze || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setVerdict('');
    setAnalysis('');
    setDegraded(false);
    await analyzeTrade();
    setLoading(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: SP[3], paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>TRADE ANALYZER</Text>
        <Text style={styles.headline}>A–F grade for every trade.</Text>

        <View style={styles.toggle}>
          {(['redraft', 'dynasty'] as Format[]).map(item => (
            <TouchableOpacity
              key={item}
              style={[styles.toggleBtn, format === item && styles.toggleBtnOn]}
              onPress={() => setFormat(item)}
            >
              <View style={{flexDirection:'row', alignItems:'center', gap:4}}>
                {item === 'redraft' ? (
                  <Icon name="calendar" size={16} color={format === item ? '#ffffff' : t.accentText} />
                ) : (
                  <Icon name="crown" size={16} color={format === item ? '#ffffff' : t.accentText} />
                )}
                <Text style={[styles.toggleTxt, format === item && styles.toggleTxtOn]}>
                  {item === 'redraft' ? 'REDRAFT' : 'DYNASTY'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Whose trade this is. 'MY TRADE' recommends accept/decline against
            your roster; 'LEAGUE TRADE' grades a deal between two other
            teams neutrally and deliberately ignores your roster. */}
        <View style={styles.toggle}>
          {(['mine', 'league'] as Perspective[]).map(item => (
            <TouchableOpacity
              key={item}
              style={[styles.toggleBtn, perspective === item && styles.toggleBtnOn]}
              onPress={() => {
                setPerspective(item);
                // A grade computed under the other framing is no longer
                // valid -- the roster context and the verdict direction
                // both change. Clear it rather than leave a stale letter
                // sitting under new labels.
                setVerdict('');
                setAnalysis('');
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name={item === 'mine' ? 'person' : 'trophy'} size={16} color={perspective === item ? '#ffffff' : t.accentText} />
                <Text style={[styles.toggleTxt, perspective === item && styles.toggleTxtOn]}>
                  {item === 'mine' ? 'MY TRADE' : 'LEAGUE TRADE'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* League context picker — the roster the grade judges fit against.
            GENERAL grades pure value with no roster bias. */}
        {ctxOptions.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
            <TouchableOpacity
              style={[styles.ctxChip, ctxChoice === 'general' && styles.ctxChipOn]}
              onPress={() => pickCtx('general')}
            >
              <Text style={[styles.ctxChipTxt, ctxChoice === 'general' && styles.ctxChipTxtOn]}>GENERAL · NO LEAGUE</Text>
            </TouchableOpacity>
            {ctxOptions.map(o => (
              <TouchableOpacity
                key={o.key}
                style={[styles.ctxChip, ctxChoice === o.key && styles.ctxChipOn]}
                onPress={() => pickCtx(o.key)}
              >
                <Text style={[styles.ctxChipTxt, ctxChoice === o.key && styles.ctxChipTxtOn]} numberOfLines={1}>
                  {o.label.length > 22 ? o.label.slice(0, 21) + '…' : o.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={extractFromScreenshot}
          disabled={extracting || loading}
          activeOpacity={0.85}
        >
          {extracting
            ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={t.accentText} size="small" /><Text style={styles.uploadTxt}>Reading screenshot…</Text></View>
            : <Text style={styles.uploadTxt}>📷  Upload trade screenshot</Text>}
        </TouchableOpacity>

        {/* Real trades from the league, tappable to prefill. Only rendered
            in LEAGUE mode with a supported league selected. Absent is the
            normal state for ESPN/MFL/Fleaflicker and for GENERAL — manual
            entry still works everywhere. */}
        {isLeague && (loadingTrades || leagueTrades.length > 0) && (
          <View style={styles.tradeListCard}>
            <Text style={styles.fieldLbl}>TRADES IN THIS LEAGUE</Text>
            {loadingTrades ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}>
                <ActivityIndicator color={t.accentText} size="small" />
                <Text style={styles.tradeListHint}>Reading the league…</Text>
              </View>
            ) : (
              <>
                {leagueTrades.map(tr => (
                  <TouchableOpacity key={tr.id} style={styles.tradeRow} onPress={() => useLeagueTrade(tr)} activeOpacity={0.7}>
                    <View style={styles.tradeRowTop}>
                      <Text
                        style={[styles.tradeTeams, tr.involvesMe && styles.tradeTeamsMine]}
                        numberOfLines={1}
                      >
                        {tr.teamA}  ⇄  {tr.teamB}
                      </Text>
                      {tr.pending && <Text style={styles.tradePill}>PROPOSED</Text>}
                    </View>
                    <Text style={styles.tradeDetail} numberOfLines={2}>
                      {tr.aSends}  →  {tr.bSends}
                    </Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.tradeListHint}>
                  Tap one to load it. Check the players before grading.
                </Text>
              </>
            )}
          </View>
        )}

        <View style={styles.inputCard}>
          <Text style={styles.fieldLbl}>{sideALbl}</Text>
          <TextInput
            value={giving}
            onChangeText={text => setGiving(text)}
            placeholder="e.g. CeeDee Lamb"
            placeholderTextColor={t.textMuted}
            style={styles.input}
            multiline
          />
        </View>

        <View style={styles.forRow}>
          <View style={styles.divLine} />
          <Text style={styles.forTxt}>FOR</Text>
          {/* One-tap side swap — screenshot extraction can't always tell
              which side of an offer is the user's, so flipping beats
              retyping both fields. Clears any stale verdict so old grades
              don't mislabel the swapped sides. */}
          <TouchableOpacity
            style={styles.swapBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              const g = giving;
              setGiving(getting);
              setGetting(g);
              setVerdict('');
              setAnalysis('');
            }}
          >
            <Text style={styles.swapTxt}>⇅ SWAP</Text>
          </TouchableOpacity>
          <View style={styles.divLine} />
        </View>

        <View style={[styles.inputCard, { marginBottom: 12 }]}> 
          <Text style={styles.fieldLbl}>{sideBLbl}</Text>
          <TextInput
            value={getting}
            onChangeText={text => setGetting(text)}
            placeholder="e.g. Saquon Barkley + T. Lockett"
            placeholderTextColor={t.textMuted}
            style={styles.input}
            multiline
          />
        </View>

        {!verdict && (
          <View style={{ marginBottom: 14 }}>
            <Text style={styles.exLbl}>QUICK EXAMPLES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {EXAMPLES.map((example, idx) => (
                <TouchableOpacity key={idx} onPress={() => {
                  setGiving(example.give);
                  setGetting(example.get);
                }}>
                  <View style={styles.exCard}>
                    <Text style={styles.exTxt}>{example.give} → {example.get}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <TouchableOpacity
          style={[styles.analyzeBtn, canAnalyze && styles.analyzeBtnOn]}
          onPress={analyze}
          disabled={!canAnalyze || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={C.ink} />
          ) : (
            <Text style={[styles.analyzeTxt, canAnalyze && styles.analyzeTxtOn]}>
              {verdict ? 'ANALYZE AGAIN' : 'ANALYZE THIS TRADE'}
            </Text>
          )}
        </TouchableOpacity>

        {verdict && !loading && (
          <View style={styles.resultCard}>
            <View style={styles.resultCardShine} />
            {degraded && (
              <View style={styles.degradedBanner}>
                <Text style={styles.degradedTxt}>
                  ⚠  AIOmni engine unavailable — graded on market values + general knowledge, not our proprietary rankings. Treat as a rougher estimate.
                </Text>
              </View>
            )}
            <View style={styles.gradeRow}>
              <View style={[styles.gradeBox, { flex: 1 }]}> 
                <Text style={styles.gradeLbl}>{gradeALbl}</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[youReceiveGrade] }]}>{youReceiveGrade}</Text>
              </View>
              <Text style={styles.vs}>VS</Text>
              <View style={[styles.gradeBox, { flex: 1 }]}> 
                <Text style={styles.gradeLbl}>{gradeBLbl}</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[youGiveGrade] }]}>{youGiveGrade}</Text>
              </View>
            </View>
            <Text style={styles.analysis}>{analysis}</Text>
            <Text style={styles.verdict}>{verdict}</Text>
            {/* One ACCEPT + one DECLINE, always. The old per-letter
                conditions overlapped (e.g. receive C / give A matched both
                the A/B rule and the C rule → ACCEPT · ACCEPT · DECLINE).
                Recommend by comparing sides: receiving the better grade →
                accept; otherwise decline. The non-recommended action dims. */}
            {(() => {
              const GRADE_ORDER: Grade[] = ['F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
              const recommendAccept = GRADE_ORDER.indexOf(youReceiveGrade) >= GRADE_ORDER.indexOf(youGiveGrade);
              // League mode: ACCEPT/DECLINE is a recommendation, and there is
              // nothing for the user to accept in someone else's trade.
              // Same comparison, reframed as the winner.
              if (isLeague) {
                const even = youReceiveGrade === youGiveGrade;
                return (
                  <View style={styles.ctaRow}>
                    <TouchableOpacity style={[styles.ctaBtn, styles.acceptBtn, (!recommendAccept || even) && { opacity: 0.4 }]} disabled>
                      <Text style={styles.ctaTxt}>TEAM A WON</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.ctaBtn, styles.acceptBtn, (recommendAccept || even) && { opacity: 0.4 }]} disabled>
                      <Text style={styles.ctaTxt}>TEAM B WON</Text>
                    </TouchableOpacity>
                  </View>
                );
              }
              return (
                <View style={styles.ctaRow}>
                  <TouchableOpacity style={[styles.ctaBtn, styles.acceptBtn, !recommendAccept && { opacity: 0.4 }]}>
                    <Text style={styles.ctaTxt}>ACCEPT</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.ctaBtn, styles.declineBtn, recommendAccept && { opacity: 0.4 }]}>
                    <Text style={styles.ctaTxt}>DECLINE</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}
            <TouchableOpacity style={styles.shareBtn} onPress={shareGrade} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="send" size={14} color={t.textMuted} />
              <Text style={styles.shareTxt}>Share this grade</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  eyebrow: {
    color: t.accentText,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 2,
    marginBottom: 6,
  },
  headline: {
    color: t.text,
    fontFamily: F.bold,
    fontSize: SZ['3xl'] - 2,
    lineHeight: 36,
    marginBottom: 22,
  },
  toggle: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    backgroundColor: t.card,
    borderWidth: 1.5,
    borderColor: t.border,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleBtnOn: {
    backgroundColor: t.border,
    shadowColor: '#1be7ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  toggleTxt: { fontFamily: 'Audiowide_400Regular',
    fontSize: SZ.xs,
    color: t.textMuted,
  },
  toggleTxtOn: { fontFamily: 'Audiowide_400Regular',
    color: t.text,
  },
  uploadBtn: {
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.gold,
    borderStyle: 'dashed',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  uploadTxt: {
    color: t.accentText,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 0.5,
  },
  inputCard: {
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: t.border,
    padding: 16,
    marginBottom: 12,
  },
  tradeListCard: {
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: t.border,
    padding: 16,
    marginBottom: 12,
  },
  tradeRow: {
    borderTopWidth: 1,
    borderTopColor: t.border,
    paddingVertical: 11,
  },
  tradeRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // PROPOSED marks a trade that has not been accepted yet. It is the row
  // most worth grading -- the decision is still open -- so it is the only
  // thing in this list that gets colour.
  tradePill: {
    color: t.accentText,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 0.6,
    borderWidth: 1,
    borderColor: t.accentText,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  tradeTeamsMine: {
    color: t.accentText,
  },
  tradeTeams: {
    color: t.text,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 0.3,
    marginBottom: 3,
    flexShrink: 1,
  },
  tradeDetail: {
    color: t.textMuted,
    fontSize: SZ.sm,
    lineHeight: 18,
  },
  tradeListHint: {
    color: t.textMuted,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    marginTop: 10,
  },
  fieldLbl: {
    color: t.textMuted,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1,
    marginBottom: 10,
  },
  input: {
    minHeight: 110,
    color: t.text,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    lineHeight: 20,
  },
  forRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 10,
  },
  divLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.card,
  },
  ctxChip: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  ctxChipOn: {
    borderColor: C.gold + '88',
    backgroundColor: C.gold + '16',
  },
  ctxChipTxt: {
    color: t.textMuted,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 0.5,
  },
  ctxChipTxtOn: {
    color: t.accentText,
  },
  swapBtn: {
    borderWidth: 1,
    borderColor: C.blueDeep + '55',
    backgroundColor: C.blueDeep + '12',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginHorizontal: 8,
  },
  swapTxt: {
    color: t.accentText,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1,
  },
  forTxt: {
    color: t.textMuted,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 1.5,
  },
  exLbl: {
    color: t.textMuted,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  exCard: {
    backgroundColor: t.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: t.border,
    marginRight: 8,
  },
  exTxt: {
    color: t.text,
    fontFamily: F.mono,
    fontSize: SZ.sm,
  },
  analyzeBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.24)',
    backgroundColor: t.card,
  },
  analyzeBtnOn: {
    backgroundColor: C.blueDeep,
    borderColor: C.blueDeep,
  },
  analyzeText: {
    fontFamily: F.mono,
    fontSize: SZ.sm,
  },
  analyzeTextOn: {
    color: '#ffffff',
    fontFamily: F.mono,
  },
  analyzeTxt: {
    color: t.textMuted,
    fontFamily: F.bold,
    fontSize: SZ.base,
  },
  analyzeTxtOn: {
    color: "#ffffff",
  },
  resultCard: {
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: t.border,
    marginTop: 18,
  },
  resultCardShine: {
    position: 'absolute',
    top: 0,
    left: '10%',
    right: '10%',
    height: 2,
    backgroundColor: t.card,
    borderRadius: 2,
  },
  degradedBanner: {
    backgroundColor: 'rgba(255,184,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,184,0,0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  degradedTxt: {
    color: t.warnText,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    lineHeight: 18,
  },
  gradeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  gradeBox: {
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  gradeLbl: {
    color: t.textSub,
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  grade: {
    fontSize: 48,
    fontFamily: F.bold,
  },
  vs: {
    color: t.textMuted,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    alignSelf: 'center',
  },
  analysis: {
    color: t.text,
    fontSize: SZ.sm,
    lineHeight: 22,
    marginBottom: 12,
    fontFamily: F.outfit,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tag: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  tagTxt: {
    fontFamily: F.mono,
    fontSize: SZ.xs,
  },
  verdict: {
    borderLeftWidth: 4,
    borderLeftColor: '#ffb800',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    color: t.warnText,
    fontFamily: F.bold,
    fontSize: SZ.base,
    lineHeight: 22,
  },
  verdictEye: {
    color: t.textMuted,
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  verdictTxt: {
    color: t.text,
    fontFamily: F.outfit,
    fontSize: SZ.sm,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
  },
  shareTxt: {
    color: t.textMuted,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 0.5,
  },
  ctaBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  acceptBtn: {
    backgroundColor: C.blueDeep,
  },
  declineBtn: {
    backgroundColor: '#a83040',
  },
  ctaTxt: {
    color: "#ffffff",
    fontFamily: F.mono,
    fontSize: SZ.base,
    letterSpacing: 1,
  },
});
