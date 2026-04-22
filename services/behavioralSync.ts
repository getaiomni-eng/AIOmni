// services/behavioralSync.ts
// ═══════════════════════════════════════════════════════════════════════════
// BEHAVIORAL DATA SYNC — Phase 1
// ═══════════════════════════════════════════════════════════════════════════
//
// Nightly-ish sync that pulls recent transactions, weekly lineups, and draft
// picks from Sleeper + Yahoo leagues the user has connected, then writes them
// to Supabase behavioral learning tables.
//
// ─── WHY SLEEPER + YAHOO ONLY ───────────────────────────────────────────────
// ESPN's unofficial API is cookie-authed scraping territory. Using ESPN data
// for the user's own personal UX (their roster, their lineup advice) is fine
// — that's their own data. But writing ESPN data into learning tables that
// feed back into community rankings is a ToS and privacy grey zone we don't
// need to touch when Sleeper alone covers ~60-70% of the engaged fantasy
// football population.
//
// The Supabase CHECK constraint on `platform` enforces this at the DB level
// too — even if this service tried to write ESPN data, Postgres would reject.
//
// ─── COLLECTION DISCIPLINE ──────────────────────────────────────────────────
// Phase 1 is collection-only. This service does NOT make any decisions, does
// NOT alter rankings, does NOT affect AI prompts. It accumulates raw data
// through the 2026 NFL season. Training on this data begins Phase 3 (2027
// offseason) after we have a full season in the can.
//
// ─── INVOCATION ─────────────────────────────────────────────────────────────
// syncUserBehavioralData(userId) — call on login + once daily when app opens
//
// Prefers incremental sync: reads sync_state for "last synced" timestamps and
// only fetches data newer than that. First sync of a league will paginate
// through the last 4 weeks of history (tunable) to get a starting baseline.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { getValidYahooToken, getYahooTransactions } from './yahoo';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── TYPES ──────────────────────────────────────────────────────────────────

type Platform = 'sleeper' | 'yahoo';

interface TransactionRow {
  user_id: string;
  league_id: string;
  platform: Platform;
  transaction_id: string;
  transaction_type: 'waiver' | 'free_agent' | 'trade' | 'commissioner';
  season: number;
  week: number | null;
  adds: Array<{ player_id: string; position?: string; team?: string }>;
  drops: Array<{ player_id: string; position?: string; team?: string }>;
  trade_partner_user: string | null;
  trade_partner_name: string | null;
  waiver_priority: number | null;
  faab_bid: number | null;
  transacted_at: string;
}

interface LineupRow {
  user_id: string;
  league_id: string;
  platform: Platform;
  season: number;
  week: number;
  starters: Array<{ player_id: string; position?: string; slot?: string; points?: number }>;
  bench: Array<{ player_id: string; position?: string; points?: number }>;
  points_scored: number | null;
  opponent_points: number | null;
  won: boolean | null;
  matchup_id: string | null;
  locked_at: string | null;
}

interface DraftPickRow {
  user_id: string;
  league_id: string;
  platform: Platform;
  draft_id: string;
  draft_type: 'startup' | 'rookie' | 'redraft';
  season: number;
  round: number;
  pick_number: number;
  slot_in_round: number;
  player_id: string;
  player_position: string | null;
  player_team: string | null;
  picked_at: string | null;
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// How far back to fetch on first-ever sync of a league (weeks).
// Bounded so we don't drag all of 2019 history into Supabase for old leagues.
const INITIAL_SYNC_LOOKBACK_WEEKS = 4;

// NFL season currently in progress. In production this comes from the
// /v1/state/nfl endpoint; hardcoding as default for the 2026 launch.
const DEFAULT_SEASON = 2026;

// Log prefix for easy filtering in Sentry / console
const LOG = '[behavioralSync]';

// ─── PUBLIC ENTRY ───────────────────────────────────────────────────────────

/**
 * Sync behavioral data for the current user across all their connected
 * Sleeper and Yahoo leagues. Idempotent — safe to call multiple times.
 *
 * Called on:
 *   - App foreground (once per day max, gated by last_full_sync)
 *   - User manual refresh
 *   - After a user action that would produce new data (e.g., finishing a draft)
 */
export async function syncUserBehavioralData(userId: string): Promise<void> {
  if (!userId) return;

  // Gate: don't sync more than once per 6 hours (app foregrounds can be spammy)
  const lastSyncKey = `behavioral_last_sync_${userId}`;
  const lastSync = await AsyncStorage.getItem(lastSyncKey);
  if (lastSync) {
    const ageMs = Date.now() - parseInt(lastSync, 10);
    if (ageMs < 6 * 60 * 60 * 1000) {
      console.log(`${LOG} skip — last sync ${Math.round(ageMs / 1000 / 60)}min ago`);
      return;
    }
  }

  console.log(`${LOG} starting sync for user ${userId}`);

  try {
    await Promise.allSettled([
      syncSleeperLeagues(userId),
      syncYahooLeagues(userId),
    ]);
    await AsyncStorage.setItem(lastSyncKey, String(Date.now()));
    console.log(`${LOG} sync complete`);
  } catch (err) {
    console.error(`${LOG} sync failed:`, err);
    // Non-fatal — don't throw. Next foreground will retry.
  }
}

// ─── SLEEPER ────────────────────────────────────────────────────────────────

async function syncSleeperLeagues(userId: string): Promise<void> {
  const username = await AsyncStorage.getItem('sleeper_username');
  if (!username) return;

  try {
    const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
    if (!userRes.ok) return;
    const sleeperUser = await userRes.json();

    const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
    const season = state?.season ? parseInt(state.season, 10) : DEFAULT_SEASON;
    const currentWeek = state?.display_week ?? 1;

    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${sleeperUser.user_id}/leagues/nfl/${season}`
    );
    if (!leaguesRes.ok) return;
    const leagues = await leaguesRes.json();

    for (const league of leagues) {
      await syncSleeperLeague(userId, sleeperUser.user_id, league, season, currentWeek);
    }
  } catch (err) {
    console.error(`${LOG} sleeper sync error:`, err);
  }
}

async function syncSleeperLeague(
  userId: string,
  sleeperUserId: string,
  league: any,
  season: number,
  currentWeek: number,
): Promise<void> {
  const leagueId = league.league_id;

  const syncState = await getSyncState(userId, leagueId, 'sleeper');
  const startWeek = determineStartWeek(syncState.last_transaction_synced, currentWeek);

  try {
    // Find this user's roster id in the league (needed to filter transactions)
    const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
    if (!rostersRes.ok) return;
    const rosters = await rostersRes.json();
    const myRoster = rosters.find((r: any) => r.owner_id === sleeperUserId);
    if (!myRoster) return;
    const myRosterId = myRoster.roster_id;

    // ── Transactions ─────────────────────────────────────────────
    const txRows: TransactionRow[] = [];
    for (let wk = startWeek; wk <= currentWeek; wk++) {
      const txRes = await fetch(
        `https://api.sleeper.app/v1/league/${leagueId}/transactions/${wk}`
      );
      if (!txRes.ok) continue;
      const txs = await txRes.json();
      if (!Array.isArray(txs)) continue;

      for (const tx of txs) {
        const rosterIds: number[] = tx.roster_ids || [];
        if (!rosterIds.includes(myRosterId)) continue;

        const row = normalizeSleeperTransaction(tx, userId, leagueId, season, wk, myRosterId);
        if (row) txRows.push(row);
      }
    }
    if (txRows.length > 0) {
      await upsertTransactions(txRows);
    }

    // ── Weekly Lineups ───────────────────────────────────────────
    const lineupRows: LineupRow[] = [];
    for (let wk = startWeek; wk <= currentWeek; wk++) {
      const muRes = await fetch(
        `https://api.sleeper.app/v1/league/${leagueId}/matchups/${wk}`
      );
      if (!muRes.ok) continue;
      const matchups = await muRes.json();
      if (!Array.isArray(matchups)) continue;

      const myMatchup = matchups.find((m: any) => m.roster_id === myRosterId);
      if (!myMatchup) continue;
      const opp = matchups.find(
        (m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRosterId
      );

      const myPts = myMatchup.points ?? null;
      const oppPts = opp?.points ?? null;

      lineupRows.push({
        user_id: userId,
        league_id: leagueId,
        platform: 'sleeper',
        season,
        week: wk,
        starters: (myMatchup.starters || []).map((pid: string, idx: number) => ({
          player_id: pid,
          points: myMatchup.starters_points?.[idx] ?? 0,
        })),
        bench: (myMatchup.players || [])
          .filter((id: string) => !(myMatchup.starters || []).includes(id))
          .map((pid: string) => ({ player_id: pid })),
        points_scored: myPts,
        opponent_points: oppPts,
        won: myPts != null && oppPts != null ? myPts > oppPts : null,
        matchup_id: myMatchup.matchup_id != null ? String(myMatchup.matchup_id) : null,
        locked_at: null,
      });
    }
    if (lineupRows.length > 0) {
      await upsertLineups(lineupRows);
    }

    // ── Draft Picks (one-time per draft) ─────────────────────────
    if (!syncState.last_draft_synced) {
      try {
        const draftsRes = await fetch(
          `https://api.sleeper.app/v1/league/${leagueId}/drafts`
        );
        if (draftsRes.ok) {
          const drafts = await draftsRes.json();
          for (const draft of drafts || []) {
            if (draft.status !== 'complete') continue;
            const draftType = inferSleeperDraftType(draft, league);
            const picksRes = await fetch(
              `https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`
            );
            if (!picksRes.ok) continue;
            const picks = await picksRes.json();

            const mine: DraftPickRow[] = (picks || [])
              .filter((p: any) => p.picked_by === sleeperUserId)
              .map((p: any) => ({
                user_id: userId,
                league_id: leagueId,
                platform: 'sleeper' as Platform,
                draft_id: draft.draft_id,
                draft_type: draftType,
                season,
                round: p.round,
                pick_number: p.pick_no,
                slot_in_round: p.draft_slot,
                player_id: p.player_id,
                player_position: p.metadata?.position ?? null,
                player_team: p.metadata?.team ?? null,
                picked_at: p.created ? new Date(p.created).toISOString() : null,
              }));

            if (mine.length > 0) await upsertDraftPicks(mine);
          }
        }
      } catch (err) {
        console.error(`${LOG} sleeper draft sync error:`, err);
      }
    }

    await updateSyncState(userId, leagueId, 'sleeper', {
      last_transaction_synced: new Date().toISOString(),
      last_lineup_synced: new Date().toISOString(),
      last_draft_synced: syncState.last_draft_synced ?? new Date().toISOString(),
      last_full_sync: new Date().toISOString(),
      sync_error_count: 0,
      last_error: null,
    });
  } catch (err: any) {
    console.error(`${LOG} sleeper league ${leagueId} error:`, err);
    await updateSyncState(userId, leagueId, 'sleeper', {
      sync_error_count: (syncState.sync_error_count ?? 0) + 1,
      last_error: String(err?.message ?? err).slice(0, 500),
    });
  }
}

function normalizeSleeperTransaction(
  tx: any,
  userId: string,
  leagueId: string,
  season: number,
  week: number,
  myRosterId: number,
): TransactionRow | null {
  if (tx.status !== 'complete') return null;

  // Figure out which adds/drops are MINE (trades involve multiple rosters)
  const addsMap = tx.adds || {};
  const dropsMap = tx.drops || {};

  const myAdds: TransactionRow['adds'] = [];
  const myDrops: TransactionRow['drops'] = [];

  for (const [playerId, rosterId] of Object.entries(addsMap)) {
    if (rosterId === myRosterId) myAdds.push({ player_id: playerId });
  }
  for (const [playerId, rosterId] of Object.entries(dropsMap)) {
    if (rosterId === myRosterId) myDrops.push({ player_id: playerId });
  }

  // Skip transactions that didn't actually affect this user
  if (myAdds.length === 0 && myDrops.length === 0) return null;

  const type: TransactionRow['transaction_type'] =
    tx.type === 'trade' ? 'trade'
    : tx.type === 'waiver' ? 'waiver'
    : tx.type === 'commissioner' ? 'commissioner'
    : 'free_agent';

  const waiverBudget = (tx.waiver_budget || []).find((wb: any) => wb.sender === myRosterId || wb.receiver === myRosterId);

  return {
    user_id: userId,
    league_id: leagueId,
    platform: 'sleeper',
    transaction_id: String(tx.transaction_id),
    transaction_type: type,
    season,
    week,
    adds: myAdds,
    drops: myDrops,
    trade_partner_user: null,
    trade_partner_name: null,
    waiver_priority: tx.settings?.waiver_bid == null ? tx.settings?.seq ?? null : null,
    faab_bid: waiverBudget?.amount ?? tx.settings?.waiver_bid ?? null,
    transacted_at: tx.status_updated
      ? new Date(tx.status_updated).toISOString()
      : new Date().toISOString(),
  };
}

function inferSleeperDraftType(draft: any, league: any): 'startup' | 'rookie' | 'redraft' {
  const isDynasty = league?.settings?.type === 2;
  const rounds = draft?.settings?.rounds ?? 0;
  if (!isDynasty) return 'redraft';
  if (rounds <= 6) return 'rookie';
  return 'startup';
}

// ─── YAHOO ──────────────────────────────────────────────────────────────────

async function syncYahooLeagues(userId: string): Promise<void> {
  const token = await getValidYahooToken();
  if (!token) return;

  try {
    // Yahoo league list comes from cached league IDs on device (user already
    // selected them during onboarding — we don't re-crawl the Yahoo game tree)
    const cachedLeagues = await AsyncStorage.getItem('yahoo_league_ids');
    const leagueIds: string[] = cachedLeagues ? JSON.parse(cachedLeagues) : [];

    for (const leagueId of leagueIds) {
      await syncYahooLeague(userId, leagueId, token);
    }
  } catch (err) {
    console.error(`${LOG} yahoo sync error:`, err);
  }
}

async function syncYahooLeague(userId: string, leagueId: string, token: string): Promise<void> {
  const syncState = await getSyncState(userId, leagueId, 'yahoo');

  try {
    const txs = await getYahooTransactions(leagueId, token);
    if (!Array.isArray(txs) || txs.length === 0) {
      await updateSyncState(userId, leagueId, 'yahoo', {
        last_transaction_synced: new Date().toISOString(),
        last_full_sync: new Date().toISOString(),
        sync_error_count: 0,
      });
      return;
    }

    // Yahoo transactions format is different per platform-service — we write
    // what we can and flesh out shape during Phase 2 when we test with real
    // Yahoo leagues. For now, store raw transaction ids so we don't double-sync.
    const rows: TransactionRow[] = txs
      .filter((tx: any) => tx.transaction_key || tx.id)
      .map((tx: any) => ({
        user_id: userId,
        league_id: leagueId,
        platform: 'yahoo' as Platform,
        transaction_id: String(tx.transaction_key ?? tx.id),
        transaction_type: (tx.type === 'trade' ? 'trade'
          : tx.type === 'waiver' ? 'waiver'
          : 'free_agent') as TransactionRow['transaction_type'],
        season: DEFAULT_SEASON,
        week: tx.week ?? null,
        adds: (tx.adds || []).map((p: any) => ({
          player_id: p.player_key ?? p.id,
          position: p.position,
          team: p.team,
        })),
        drops: (tx.drops || []).map((p: any) => ({
          player_id: p.player_key ?? p.id,
          position: p.position,
          team: p.team,
        })),
        trade_partner_user: null,
        trade_partner_name: tx.trader_name ?? null,
        waiver_priority: tx.waiver_priority ?? null,
        faab_bid: tx.faab_bid ?? null,
        transacted_at: tx.timestamp
          ? new Date(tx.timestamp * 1000).toISOString()
          : new Date().toISOString(),
      }));

    if (rows.length > 0) await upsertTransactions(rows);

    await updateSyncState(userId, leagueId, 'yahoo', {
      last_transaction_synced: new Date().toISOString(),
      last_full_sync: new Date().toISOString(),
      sync_error_count: 0,
      last_error: null,
    });
  } catch (err: any) {
    console.error(`${LOG} yahoo league ${leagueId} error:`, err);
    await updateSyncState(userId, leagueId, 'yahoo', {
      sync_error_count: (syncState.sync_error_count ?? 0) + 1,
      last_error: String(err?.message ?? err).slice(0, 500),
    });
  }
}

// ─── SYNC STATE HELPERS ─────────────────────────────────────────────────────

async function getSyncState(
  userId: string,
  leagueId: string,
  platform: Platform,
): Promise<{
  last_transaction_synced: string | null;
  last_lineup_synced: string | null;
  last_draft_synced: string | null;
  sync_error_count: number;
}> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('last_transaction_synced, last_lineup_synced, last_draft_synced, sync_error_count')
    .eq('user_id', userId)
    .eq('league_id', leagueId)
    .eq('platform', platform)
    .maybeSingle();

  if (error || !data) {
    return {
      last_transaction_synced: null,
      last_lineup_synced: null,
      last_draft_synced: null,
      sync_error_count: 0,
    };
  }
  return data;
}

async function updateSyncState(
  userId: string,
  leagueId: string,
  platform: Platform,
  patch: Record<string, any>,
): Promise<void> {
  await supabase
    .from('sync_state')
    .upsert(
      {
        user_id: userId,
        league_id: leagueId,
        platform,
        ...patch,
      },
      { onConflict: 'user_id,league_id,platform' },
    );
}

function determineStartWeek(lastSynced: string | null, currentWeek: number): number {
  if (!lastSynced) {
    return Math.max(1, currentWeek - INITIAL_SYNC_LOOKBACK_WEEKS);
  }
  // Incremental sync — always re-pull current week to catch late transactions
  return Math.max(1, currentWeek - 1);
}

// ─── UPSERTS ────────────────────────────────────────────────────────────────

async function upsertTransactions(rows: TransactionRow[]): Promise<void> {
  const { error } = await supabase
    .from('league_transactions')
    .upsert(rows, { onConflict: 'platform,transaction_id', ignoreDuplicates: true });
  if (error) console.error(`${LOG} upsert tx error:`, error);
}

async function upsertLineups(rows: LineupRow[]): Promise<void> {
  const { error } = await supabase
    .from('weekly_lineups')
    .upsert(rows, { onConflict: 'user_id,league_id,season,week' });
  if (error) console.error(`${LOG} upsert lineup error:`, error);
}

async function upsertDraftPicks(rows: DraftPickRow[]): Promise<void> {
  const { error } = await supabase
    .from('draft_picks')
    .upsert(rows, { onConflict: 'platform,draft_id,pick_number', ignoreDuplicates: true });
  if (error) console.error(`${LOG} upsert pick error:`, error);
}
