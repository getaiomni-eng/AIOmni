// supabase/functions/trade-corpus-harvest/index.ts
//
// Builds the training corpus behind the Trade Analyzer's calibration:
//   1. completed two-sided trades from every Sleeper league we know a user is in
//   2. a dated snapshot of KeepTradeCut market values
//
// Both halves exist to answer one question with data instead of a guess:
// what value gap do managers ACTUALLY accept? FLAG_THRESHOLD_PCT was 25, a
// hand-picked number; on 22 real accepted 2026 trades the median gap is 19%
// and 41% sat at or past 25, so the app was calling ordinary trading a
// fleecing four times in ten. Raised to 35 (between p75 and p90) on
// 2026-09-18 -- provisional, pending a bigger corpus.
//
// THE SNAPSHOT IS THE TIME-CRITICAL PART. KTC serves only today's market.
// A trade from 2023 cannot be priced now -- half its players have since
// busted or broken out -- and no API will ever hand back the prices that
// existed then. Every week we do not capture is permanently unpriceable.
//
// MODES
//   incremental (weekly cron) -- current-season leagues, recent weeks only.
//     Bounded and fast: it exists to pick up trades made since last run.
//   backfill (manual)         -- walks previous_league_id chains to the start
//     of each dynasty league. ~400 requests; run it by hand, once, not on a
//     schedule.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SLEEPER      = 'https://api.sleeper.app/v1';

type Asset = {
  kind: 'player' | 'pick';
  name: string;
  position?: string;
  team?: string;
  season?: string;
  round?: number;
};

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function j<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

/** Every Sleeper league id any user has touched. Union of the tables that
 *  record league activity -- none of them is complete on its own. */
async function knownSleeperLeagues(): Promise<string[]> {
  const ids = new Set<string>();
  for (const t of ['user_rostered_players', 'sync_state', 'weekly_lineups', 'league_transactions']) {
    const { data, error } = await sb.from(t).select('league_id, platform').eq('platform', 'sleeper');
    if (error) { console.log(`[corpus] read ${t} failed: ${error.message}`); continue; }
    for (const r of (data ?? [])) {
      const id = String((r as any).league_id ?? '');
      if (id && id !== '_unscoped') ids.add(id);
    }
  }
  return [...ids];
}

/** Walk previous_league_id back through prior seasons. */
async function withHistory(seedIds: string[], maxHops: number): Promise<string[]> {
  const out = new Set<string>();
  for (const seed of seedIds) {
    let id: string | null = seed;
    let hops = 0;
    while (id && hops <= maxHops && !out.has(id)) {
      out.add(id);
      const lg = await j<any>(`${SLEEPER}/league/${id}`);
      if (!lg?.league_id) break;
      id = lg.previous_league_id ?? null;
      hops++;
    }
  }
  return [...out];
}

function toAssets(
  tx: any,
  playersDb: Record<string, any>,
  rosterId: string,
): Asset[] {
  const out: Asset[] = [];
  for (const [pid, to] of Object.entries(tx.adds ?? {})) {
    if (String(to) !== rosterId) continue;
    const p = playersDb[pid];
    // An unresolved player id is noise, not a data point. Better a trade with
    // one fewer asset flagged unpriceable later than a corpus row asserting a
    // player named "Player 12345" was traded.
    if (!p?.first_name) continue;
    out.push({
      kind: 'player',
      name: `${p.first_name} ${p.last_name}`,
      position: p.position ?? undefined,
      team: p.team ?? undefined,
    });
  }
  for (const dp of (tx.draft_picks ?? [])) {
    if (String(dp?.owner_id ?? '') !== rosterId) continue;
    if (!dp?.season || !dp?.round) continue;
    out.push({ kind: 'pick', name: `${dp.season} Round ${dp.round}`, season: String(dp.season), round: Number(dp.round) });
  }
  return out;
}

async function harvestTrades(mode: 'incremental' | 'backfill') {
  const seeds = await knownSleeperLeagues();
  const leagues = mode === 'backfill' ? await withHistory(seeds, 5) : seeds;

  const playersDb = await j<Record<string, any>>(`${SLEEPER}/players/nfl`);
  if (!playersDb) return { leagues: leagues.length, rows: 0, error: 'players db unavailable' };

  // Incremental only needs weeks that could plausibly have changed. Backfill
  // takes the whole season.
  const nflWeek = Math.max(1, Math.min(18,
    Math.floor((Date.now() - Date.UTC(2026, 8, 9)) / (7 * 864e5)) + 1));
  const weeks = mode === 'backfill'
    ? Array.from({ length: 18 }, (_, i) => i + 1)
    : [nflWeek - 2, nflWeek - 1, nflWeek, nflWeek + 1].filter(w => w >= 1 && w <= 18);

  const rows: any[] = [];
  let skippedMultiTeam = 0, skippedEmpty = 0;

  for (const leagueId of leagues) {
    const lg = await j<any>(`${SLEEPER}/league/${leagueId}`);
    const season = lg?.season ? Number(lg.season) : null;
    for (const w of weeks) {
      const txs = await j<any[]>(`${SLEEPER}/league/${leagueId}/transactions/${w}`);
      if (!Array.isArray(txs)) continue;
      for (const tx of txs) {
        if (tx?.type !== 'trade' || tx?.status !== 'complete') continue;
        const rids = (tx.roster_ids ?? []).map(String);
        // Three-team trades are real but cannot be modelled as A-for-B, and
        // silently flattening one would corrupt the very distribution this
        // corpus exists to measure.
        if (rids.length !== 2) { skippedMultiTeam++; continue; }
        const [a, b] = rids;
        const sideA = toAssets(tx, playersDb, b);   // what A GAVE ends up on B
        const sideB = toAssets(tx, playersDb, a);
        if (sideA.length === 0 || sideB.length === 0) { skippedEmpty++; continue; }
        rows.push({
          platform: 'sleeper',
          league_id: leagueId,
          transaction_id: String(tx.transaction_id),
          season, week: w,
          accepted_at: new Date((tx.status_updated ?? tx.created ?? Date.now())).toISOString(),
          roster_a: a, roster_b: b,
          side_a: sideA, side_b: sideB,
          has_picks: (tx.draft_picks ?? []).length > 0,
        });
      }
    }
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await sb.from('trade_corpus')
      .upsert(chunk, { onConflict: 'platform,league_id,transaction_id' });
    if (error) console.log('[corpus] upsert error:', error.message);
    else written += chunk.length;
  }
  return { mode, leagues: leagues.length, weeks: weeks.length, found: rows.length, written, skippedMultiTeam, skippedEmpty };
}

async function snapshotKtc() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ktc-values`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: '{}',
  });
  if (!res.ok) return { error: `ktc-values ${res.status}` };
  const data = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  const rows: any[] = [];
  for (const fmt of ['dynasty', 'redraft'] as const) {
    const map = data?.[fmt];
    if (!map) continue;
    for (const [name, v] of Object.entries<any>(map)) {
      rows.push({
        captured_on: today, format: fmt, asset_name: name,
        one_qb: v?.oneQB ?? null, superflex: v?.sf ?? null,
        position: v?.pos ?? null, team: v?.team ?? null,
      });
    }
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from('ktc_value_snapshots')
      .upsert(chunk, { onConflict: 'captured_on,format,asset_name' });
    if (error) console.log('[corpus] ktc upsert error:', error.message);
    else written += chunk.length;
  }
  return { captured_on: today, assets: rows.length, written };
}

Deno.serve(async (req) => {
  const started = Date.now();
  let mode: 'incremental' | 'backfill' = 'incremental';
  let doTrades = true, doKtc = true;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === 'backfill') mode = 'backfill';
    if (body?.trades === false) doTrades = false;
    if (body?.ktc === false) doKtc = false;
  } catch { /* defaults */ }

  const out: any = { ok: true, mode };
  try {
    // KTC first, always. It is the half that cannot be recovered later, so a
    // trade harvest that runs long must never be what costs us a snapshot.
    if (doKtc)    out.ktc    = await snapshotKtc();
    if (doTrades) out.trades = await harvestTrades(mode);
  } catch (e) {
    out.ok = false;
    out.error = String((e as Error)?.message ?? e);
  }
  out.duration_seconds = Math.round((Date.now() - started) / 1000);
  return new Response(JSON.stringify(out), {
    status: out.ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
});
