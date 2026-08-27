import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { askAI, askAIVision, describeAIError, hasAISession } from '../../services/ai';
import { hasAIConsent } from '../../services/aiConsent';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchAIOmniFormula, fetchKTCValues, fetchNFLInjuries, fetchSnapCounts, fetchVegasLines, type InjuryInfo, type RankedPlayer, type ScoringFormat } from '../../services/rankingsData';
import { getCurrentTier } from '../../services/purchases';
import { sanitizePromptInput } from '../../services/util/promptSafe';
import { consumePrompt, hasLinkedPlatform } from '../../services/promptQuota';
import { C, F, R, SP, SZ } from '../constants/tokens';
import { Icon } from '../components/AIOmniIcons';

type Format = 'redraft' | 'dynasty';
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
function resolveInitial(key: string, keys: Iterable<string>): string | null {
  const m = key.match(/^([a-z])\s+(.+)$/);
  if (!m) return null;
  const [, initial, last] = m;
  let found: string | null = null;
  for (const k of keys) {
    const sp = k.indexOf(' ');
    if (sp <= 0) continue;
    if (k[0] === initial && k.slice(sp + 1) === last) {
      if (found) return null; // ambiguous — refuse to guess
      found = k;
    }
  }
  return found;
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
function pickKey(tok: string): string | null {
  const m = tok.match(/(20\d\d)\D*(1st|2nd|3rd|4th|first|second|third|fourth)/i);
  if (!m) return null;
  const round = ROUND_WORD[m[2].toLowerCase()];
  return round ? `${m[1]} ${round}` : null;
}

function groundSide(
  raw: string,
  index: Map<string, RankedPlayer>,
  ktcByName: Map<string, number>,
  injuryByName: Map<string, string>,
  vegasByTeam: Map<string, number>,
  snapByName: Map<string, number>,
  pickValues: Map<string, number>,
): { lines: string; ktcTotal: number } {
  const tokens = raw.split(/[,\n+&/]|\band\b|\bplus\b/gi).map(s => s.trim()).filter(Boolean);
  if (!tokens.length) return { lines: '(nothing listed)', ktcTotal: 0 };
  let ktcTotal = 0;
  const lines = tokens.map(tok => {
    // Draft picks first — they carry their own KTC value, not a player rank.
    const pk = pickKey(tok);
    if (pk) {
      const [yr, rd] = pk.split(' ');
      const pv = pickValues.get(pk);
      if (pv) { ktcTotal += pv; return `- ${yr} Round ${rd} pick — market value ${pv} (KTC); a dynasty asset, weigh by your contention window`; }
      return `- ${yr} Round ${rd} pick (dynasty draft asset — value scales with your timeline)`;
    }
    let key = normName(tok);
    // "A. Jeanty" → "a jeanty" never exact-matches "ashton jeanty"; try the
    // unique-initial resolver against the board before giving up.
    if (!index.has(key) && !ktcByName.has(key)) {
      const resolved = resolveInitial(key, index.keys()) ?? resolveInitial(key, ktcByName.keys());
      if (resolved) key = resolved;
    }
    const p = index.get(key);
    const ktc = ktcByName.get(key);
    const inj = injuryByName.get(key);
    if (ktc) ktcTotal += ktc;
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
      return `- ${tok} (not on the AIOmni board — likely a pick or deep FA; weigh at your discretion)`;
    }
    return `- ${p?.name ?? tok} — ${bits.join(' · ')}`;
  }).join('\n');
  return { lines, ktcTotal };
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
  const router = useRouter();
  const [format, setFormat] = useState<Format>('redraft');
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
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setVerdict('Photo access is needed to read a screenshot.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const asset = res.assets[0];
    setExtracting(true);
    setVerdict(''); setAnalysis('');
    try {
      const out = await askAIVision(
        asset.base64!,
        asset.mimeType ?? 'image/jpeg',
        `This is a screenshot of a fantasy football trade proposal. Read BOTH sides exactly and return ONLY this JSON, nothing else:
{"giving":[everything the app's user SENDS AWAY],"getting":[everything the user RECEIVES]}
Each array item is a string. Capture EVERY asset on each side — do NOT skip anything:
- Players → full name, e.g. "Brian Thomas Jr.", "Nico Collins"
- Draft picks → keep year + round, e.g. "2027 1st", "2026 2nd Rd". DRAFT PICKS ARE CRITICAL — never omit them, even if shown in small text or with "via [name]".
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
        ? `\nMARKET MATH (KTC crowd values): you send ${givingGrounded.ktcTotal} ⇄ you receive ${gettingGrounded.ktcTotal} (${gettingGrounded.ktcTotal >= givingGrounded.ktcTotal ? '+' : ''}${(((gettingGrounded.ktcTotal - givingGrounded.ktcTotal) / givingGrounded.ktcTotal) * 100).toFixed(0)}% for you by market consensus)`
        : '';

      // ── Deterministic grading ─────────────────────────────────────
      // The LETTERS come from market math in code, not from the model.
      // Model-authored grades were non-deterministic (same trade, different
      // letters run to run) and sycophantic — "should I accept?" leans
      // accept, which produced smash-accept verdicts in BOTH directions on
      // the same trade. Now: same trade → same grades, and analyzing the
      // flip side produces the exact mirror. The model writes ONLY the
      // prose around the locked call.
      const hasMarketData = givingGrounded.ktcTotal > 0 && gettingGrounded.ktcTotal > 0;
      const netPct = hasMarketData
        ? ((gettingGrounded.ktcTotal - givingGrounded.ktcTotal) / givingGrounded.ktcTotal) * 100
        : 0;
      const gradeFromNet = (pct: number): Grade =>
        pct >= 30 ? 'A+' : pct >= 20 ? 'A' : pct >= 12 ? 'A-' :
        pct >= 7  ? 'B+' : pct >= 3  ? 'B' : pct > -3  ? 'B-' :
        pct > -7  ? 'C+' : pct > -12 ? 'C' : pct > -20 ? 'C-' :
        pct > -30 ? 'D+' : pct > -45 ? 'D' : 'F';
      // Mirror-symmetric: what you receive is graded by your net; what you
      // give up is graded by the OTHER side's net (their gain is your loss).
      const givePct = hasMarketData
        ? ((givingGrounded.ktcTotal - gettingGrounded.ktcTotal) / gettingGrounded.ktcTotal) * 100
        : 0;
      const lockedReceive: Grade = hasMarketData ? gradeFromNet(netPct) : 'B';
      const lockedGive: Grade    = hasMarketData ? gradeFromNet(givePct) : 'B';
      const lockedCall = !hasMarketData ? 'TOO CLOSE TO CALL — insufficient market data'
        : netPct >= 3 ? 'ACCEPT' : netPct <= -3 ? 'DECLINE' : 'TOSS-UP — value is even; let roster fit decide';

      const system = `You are The O — AIOmni's AI fantasy coach grading a trade. You're the sharpest, most confident voice in the room: the user's savvy fantasy buddy who's seen it all, not a corporate robot. You have STRONG opinions and you back them. Be decisive, a little cocky, occasionally funny. Talk like a real fantasy player — "smash accept", "hard pass", "that's a fleece", "buy-low", "ship it", "they're robbing you", "ascending", "RB dead zone". NEVER hedge into mush — pick a side and sell it.

Signals per player (use whichever are present): (1) AIOmni's PROPRIETARY rank — a calibrated projection engine, your primary anchor; (2) KTC market value — what the crowd thinks it's worth; (3) live injury status; (4) snap share — role security; (5) Vegas implied team total — offense environment. Your edge is the DISAGREEMENTS: when AIOmni likes a player more than the market, that's a buy-low to pounce on; when the market overprices someone our engine is out on, say so ("the crowd's still paying for last year"). Injuries change everything — flag them. If the user's roster is provided, factor FIT.

THE CALL IS ALREADY MADE. AIOmni's grading engine has computed the grades and the verdict direction from market math — they are FINAL and you MUST NOT contradict them. Your job is the WHY: write the verdict line and analysis that explain the locked call with your voice and the signals above. If roster fit cuts against the locked call, say so as a caveat ("value says accept, but…") — the letters don't move.

LOCKED BY THE ENGINE:
- You receive: ${lockedReceive}  |  You give up: ${lockedGive}
- Verdict direction: ${lockedCall}

Respond with ONLY a single valid JSON object — no markdown, no code fences, no preamble, and do NOT output a second or revised version:
{"youReceiveGrade":"${lockedReceive}","youGiveGrade":"${lockedGive}","verdict":"<ONE punchy line matching the locked verdict direction — e.g. 'Smash accept — this is a straight-up fleece' or 'Hard pass, they're robbing you blind'>","analysis":"<2-3 sentences with conviction: WHY the locked call is right (cite AIOmni ranks + market values), plus any roster-fit caveat>"}`;

      const prompt = `Format: ${format === 'dynasty' ? 'DYNASTY — value = age + multi-year production' : 'REDRAFT PPR — value = rest-of-season'}
AIOmni board used: ${engineFmt}

YOU ARE GIVING UP:
${givingGrounded.lines}

YOU ARE RECEIVING:
${gettingGrounded.lines}
${marketMath}${(() => {
        const sel = ctxChoice !== 'general' ? ctxOptions.find(o => o.key === ctxChoice) : undefined;
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
      })()}${engineGrounded ? '' : `\n\n⚠ HEADS UP: AIOmni's proprietary ranking engine is temporarily unavailable, so you're grading on KTC market values + general knowledge — NOT our calibrated projections. Stay decisive, but don't cite precise AIOmni ranks you don't have, and lean on market value + clear situational reads.`}`;
      const response = await askAI(prompt, { maxTokens: 600, system });
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
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
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
                  <Icon name="calendar" size={16} color={format === item ? '#ffffff' : C.blueDeep} />
                ) : (
                  <Icon name="crown" size={16} color={format === item ? '#ffffff' : C.gold} />
                )}
                <Text style={[styles.toggleTxt, format === item && styles.toggleTxtOn]}>
                  {item === 'redraft' ? 'REDRAFT' : 'DYNASTY'}
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
            ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={C.gold} size="small" /><Text style={styles.uploadTxt}>Reading screenshot…</Text></View>
            : <Text style={styles.uploadTxt}>📷  Upload trade screenshot</Text>}
        </TouchableOpacity>

        <View style={styles.inputCard}>
          <Text style={styles.fieldLbl}>YOU ARE GIVING</Text>
          <TextInput
            value={giving}
            onChangeText={text => setGiving(text)}
            placeholder="e.g. CeeDee Lamb"
            placeholderTextColor={C.dim2}
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
          <Text style={styles.fieldLbl}>YOU ARE RECEIVING</Text>
          <TextInput
            value={getting}
            onChangeText={text => setGetting(text)}
            placeholder="e.g. Saquon Barkley + T. Lockett"
            placeholderTextColor={C.dim2}
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
                <Text style={styles.gradeLbl}>YOU RECEIVE</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[youReceiveGrade] }]}>{youReceiveGrade}</Text>
              </View>
              <Text style={styles.vs}>VS</Text>
              <View style={[styles.gradeBox, { flex: 1 }]}> 
                <Text style={styles.gradeLbl}>YOU GIVE UP</Text>
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
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: C.blueDeep,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 2,
    marginBottom: 6,
  },
  headline: {
    color: '#f0f4f5',
    fontFamily: F.bold,
    fontSize: SZ['3xl'] - 2,
    lineHeight: 36,
    marginBottom: 22,
  },
  toggle: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#12252e',
    borderWidth: 1.5,
    borderColor: '#1a3542',
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleBtnOn: {
    backgroundColor: '#1a3542',
    shadowColor: '#1be7ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  toggleTxt: { fontFamily: 'Audiowide_400Regular',
    fontSize: SZ.xs,
    color: C.dim2,
  },
  toggleTxtOn: { fontFamily: 'Audiowide_400Regular',
    color: '#f0f4f5',
  },
  uploadBtn: {
    backgroundColor: '#12252e',
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
    color: C.gold,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 0.5,
  },
  inputCard: {
    backgroundColor: '#12252e',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    padding: 16,
    marginBottom: 12,
  },
  fieldLbl: {
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1,
    marginBottom: 10,
  },
  input: {
    minHeight: 110,
    color: '#f0f4f5',
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
    backgroundColor: '#12252e',
  },
  ctxChip: {
    borderWidth: 1,
    borderColor: C.glassBorder,
    backgroundColor: C.glass,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  ctxChipOn: {
    borderColor: C.gold + '88',
    backgroundColor: C.gold + '16',
  },
  ctxChipTxt: {
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 0.5,
  },
  ctxChipTxtOn: {
    color: C.gold,
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
    color: C.blueDeep,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1,
  },
  forTxt: {
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 1.5,
  },
  exLbl: {
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  exCard: {
    backgroundColor: '#12252e',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    marginRight: 8,
  },
  exTxt: {
    color: '#f0f4f5',
    fontFamily: F.mono,
    fontSize: SZ.sm,
  },
  analyzeBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.24)',
    backgroundColor: '#12252e',
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
    color: C.dim2,
    fontFamily: F.bold,
    fontSize: SZ.base,
  },
  analyzeTxtOn: {
    color: "#ffffff",
  },
  resultCard: {
    backgroundColor: '#12252e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    marginTop: 18,
  },
  resultCardShine: {
    position: 'absolute',
    top: 0,
    left: '10%',
    right: '10%',
    height: 2,
    backgroundColor: '#12252e',
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
    color: '#ffb800',
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
    backgroundColor: '#0f1c22',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  gradeLbl: {
    color: '#7a9eaa',
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
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    alignSelf: 'center',
  },
  analysis: {
    color: '#f0f4f5',
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
    color: '#ffb800',
    fontFamily: F.bold,
    fontSize: SZ.base,
    lineHeight: 22,
  },
  verdictEye: {
    color: C.dim2,
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  verdictTxt: {
    color: '#f0f4f5',
    fontFamily: F.outfit,
    fontSize: SZ.sm,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
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
