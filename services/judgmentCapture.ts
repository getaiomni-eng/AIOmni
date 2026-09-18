// services/judgmentCapture.ts
// ─────────────────────────────────────────────────────────────────────
// Write side of the AI-commissioner dataset (2026-09-09).
//
// ai_response_metadata has been filling since 2026-09-02 (claude-proxy
// writes it on every call). rule_interpretation_queries and trade_disputes
// were created in the same migration and never received a row — nothing
// wrote to them. These are those writers.
//
// CONTRACT: everything here is FIRE-AND-FORGET. Capture is telemetry. It
// must never delay an answer, never surface an error to the user, and never
// throw into a caller's try/catch — same rule as learnFromExchange in
// coach.tsx and the ai_response_metadata insert in claude-proxy. Every
// function below swallows its own failures on purpose.
//
// Writes go through SECURITY DEFINER RPCs, not table inserts: the tables
// have RLS on with no policies, and this is training data. A client that
// can INSERT directly is a client that can poison the dataset.

import { supabase } from './supabase';

export type RuleCategory = 'scoring' | 'waivers' | 'trade-rules' | 'playoffs' | 'other';

// ── Rules-question detection ──────────────────────────────────────────
// A rules question asks how the LEAGUE works. A start/sit question asks who
// to play. They share vocabulary — "should I claim Achane off waivers" is
// not a waiver-RULES question — so a bare topic keyword is not enough.
//
// Rule: an explicit rules word alone qualifies, OR a topic keyword paired
// with an intent marker ("how does", "is it allowed", "what happens if").
//
// KNOWN RECALL GAP: this is a keyword heuristic, not a classifier. It will
// miss rules questions phrased in ways not listed here, so the table holds a
// BIASED SAMPLE of real rules traffic, not a census. That is a deliberate
// trade: an empty table teaches nothing, and a biased one teaches something
// as long as whoever reads it knows which way it leans. Do not compute
// "share of questions that are about rules" from this table.
const EXPLICIT = /\b(bylaw|bylaws|collusion|veto|commissioner|league rule|the rules?|rulebook)\b/i;

const INTENT = /\b(how (do|does|is|are)|what happens|what'?s the rule|is (it|that|this) (legal|allowed|ok)|are we allowed|can (i|we|he|she|they) (still|legally)?|supposed to|does (it|that) count|when does|who decides)\b/i;

const TOPICS: Array<[RegExp, RuleCategory]> = [
  [/\b(ppr|half[- ]ppr|scoring|points? per|te premium|bonus|decimal|point per reception)\b/i, 'scoring'],
  [/\b(waiver|waivers|faab|blind bid|free agent budget|waiver (order|priority)|claim process)\b/i, 'waivers'],
  // Deliberately loose about word order — "process a trade", "trade after
  // the deadline" and "trade draft picks" are all the same question asked
  // three ways. Precision comes from the INTENT gate below, not from here,
  // so a broad topic match costs nothing: "Trade Chase for Jefferson?" has
  // no intent marker and stays out regardless.
  [/\b(trade deadline|deadline|veto|collusion|trade (limit|review|process|rules?)|process(?:ing)? (?:a |the )?trade|trade(?:s|d|ing)? (?:draft )?picks?|draft picks?)\b/i, 'trade-rules'],
  [/\b(playoff|playoffs|seeding|seed|tiebreak|tiebreaker|consolation|championship week)\b/i, 'playoffs'],
  [/\b(ir spot|ir eligib|roster limit|lineup lock|locks?|taxi squad|keeper|bench limit)\b/i, 'other'],
];

/**
 * Returns the rules category for a Coach question, or null when it does not
 * read as a rules question at all (the common case — most Coach traffic is
 * start/sit and waiver-target advice, which belongs in ai_response_metadata,
 * not here).
 */
export function classifyRuleQuestion(question: string): RuleCategory | null {
  const q = (question ?? '').trim();
  if (q.length < 8 || q.length > 2000) return null;

  const topic = TOPICS.find(([re]) => re.test(q));
  if (EXPLICIT.test(q)) return topic?.[1] ?? 'other';
  if (topic && INTENT.test(q)) return topic[1];
  return null;
}

/**
 * Log a Coach exchange IF it reads as a rules question. No-op otherwise.
 * Never awaited by callers, never throws.
 */
export function captureRuleQuery(opts: {
  question: string;
  answer: string;
  leagueRef?: string | null;
}): void {
  try {
    const category = classifyRuleQuestion(opts.question);
    if (!category) return;
    void supabase
      .rpc('log_rule_query', {
        p_league_ref: opts.leagueRef ?? null,
        p_category:   category,
        p_question:   opts.question.slice(0, 2000),
        p_answer:     (opts.answer ?? '').slice(0, 8000),
        // The Coach does not self-report confidence. Sending null rather
        // than deriving a number that would look measured and isn't.
        p_confidence: null,
      })
      .then(() => {}, () => {});
  } catch { /* capture never surfaces */ }
}

// ── Trade grading ─────────────────────────────────────────────────────

export type TradeCapture = {
  leagueRef?: string | null;
  // Free text as the user typed it (already through sanitizePromptInput).
  // Split into arrays below so the dataset can be queried by player rather
  // than by string match.
  giving:  string;
  getting: string;
  ktcGiving:  number;
  ktcGetting: number;
  netPct:     number | null;   // % swing toward the user, null without market data
  gradeReceive: string;
  gradeGive:    string;
  format:       string;        // 'dynasty' | 'redraft'
  engineFormat: string;
  engineGrounded: boolean;
  hasMarketData:  boolean;
  hasRosterContext: boolean;
  // 'mine' = the user's own trade, graded as an accept/decline against their
  // roster. 'league' = two other teams' deal, graded neutrally for who won,
  // with the user's roster deliberately excluded. Recorded because the two
  // are different questions and should never be pooled when this dataset is
  // eventually analyzed -- and because it answers whether league mode gets
  // used at all.
  perspective?: 'mine' | 'league';
  verdict?:  string;
  analysis?: string;
};

// A lopsided trade is the one a commissioner would actually get asked to
// look at, so that is what 'flag' means here.
//
// 35, raised from 25 on 2026-09-18, and the 25 was a guess. Measured against
// real ACCEPTED trades harvested into trade_corpus -- deals BOTH managers said
// yes to -- the gap distribution is:
//
//     min 2   p25 8   median 19   p75 31   p90 39   max 100
//
// At 25 this flagged 41% of mutually-agreed trades as a fleecing, which makes
// the label meaningless: it was describing ordinary trading. 35 sits between
// p75 and p90 and flags roughly the top 18%, which is much closer to "a
// commissioner would look at this".
//
// CAVEAT ON THE EVIDENCE: n=22, all from one social graph of dynasty leagues,
// priced at today's KTC. Strong enough to say 25 was wrong; not a precise
// number. Re-derive from trade_corpus once it spans more leagues and more
// seasons of properly-priced trades -- that is what the corpus is for.
const FLAG_THRESHOLD_PCT = 35;

/**
 * Record a graded trade. Never awaited, never throws.
 *
 * NOTE ON ai_ruling: the app GRADES trades, it does not veto them. We only
 * ever send 'approve' or 'flag' — never 'reject' — and the RPC discards
 * anything else, so the column can't fill up with rulings the product never
 * made. The raw numbers go in trade_payload so the derived call can always
 * be recomputed differently later.
 */
// The trade inputs are free text — one player per line, or comma-separated,
// depending on how the user typed it. Both are common, so split on either.
const splitSide = (s: string): string[] =>
  (s ?? '')
    .split(/[\n,]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 25);

export function captureTradeGrade(t: TradeCapture): void {
  try {
    const reasons: string[] = [];
    if (!t.hasMarketData)    reasons.push('no_market_data');
    if (!t.engineGrounded)   reasons.push('engine_unavailable');
    if (!t.hasRosterContext) reasons.push('no_roster_context');
    if (t.perspective === 'league') reasons.push('league_trade');

    const lopsided = t.netPct != null && Math.abs(t.netPct) >= FLAG_THRESHOLD_PCT;
    if (lopsided) reasons.push('lopsided');

    void supabase
      .rpc('log_trade_dispute', {
        p_league_ref: t.leagueRef ?? null,
        p_payload: {
          giving:  splitSide(t.giving),
          getting: splitSide(t.getting),
          ktc: { giving: t.ktcGiving, getting: t.ktcGetting, netPct: t.netPct },
          grades: { receive: t.gradeReceive, give: t.gradeGive },
          format: t.format,
          engineFormat: t.engineFormat,
          engineGrounded: t.engineGrounded,
          hasMarketData: t.hasMarketData,
          perspective: t.perspective ?? 'mine',
          verdict: (t.verdict ?? '').slice(0, 400),
        },
        p_reason_codes: reasons,
        // Only ever 'approve' or 'flag'. See the note above.
        p_ruling: t.hasMarketData ? (lopsided ? 'flag' : 'approve') : null,
        p_rationale: (t.analysis ?? '').slice(0, 4000),
      })
      .then(() => {}, () => {});
  } catch { /* capture never surfaces */ }
}
