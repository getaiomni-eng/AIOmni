#!/usr/bin/env python3
"""
Wire services/waivers.ts and services/draft.ts to use the canonical
nfl_players Supabase table as the source of truth for "is this player
actually active in the NFL?"

After this patch:
- Waiver wire filters out anyone NOT in the canonical active roster
- Draft free agent pool filters the same way
- Retired guys Sleeper still lists (Roethlisberger, Bell, etc) get dropped

Safe to run multiple times — idempotent checks for each replacement.
"""
import os, sys

PROJECT_ROOT = os.getcwd()

def patch_file(rel_path, patches):
    path = os.path.join(PROJECT_ROOT, rel_path)
    if not os.path.exists(path):
        print(f"SKIP: {rel_path}")
        return
    with open(path) as f: content = f.read()
    original = content
    for name, find, replace in patches:
        if find in content:
            content = content.replace(find, replace)
            print(f"  OK {name}")
        else:
            print(f"  -- {name} (pattern not found / already applied)")
    if content != original:
        with open(path, 'w') as f: f.write(content)


# ═══════════════════════════════════════════════════════════
# 1. waivers.ts — filter free agents against canonical active list
# ═══════════════════════════════════════════════════════════

WAIVERS_PATCHES = [
    # Add import at top
    (
        "Import getActiveSleeperIds",
        """import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadESPNCredentials, getESPNFreeAgents, ESPNFreeAgent } from './espn';
import { getValidYahooToken, getYahooFreeAgents, YahooPlayer } from './yahoo';""",
        """import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadESPNCredentials, getESPNFreeAgents, ESPNFreeAgent } from './espn';
import { getValidYahooToken, getYahooFreeAgents, YahooPlayer } from './yahoo';
import { getActiveSleeperIds, getActiveESPNIds } from './nflPlayers';""",
    ),

    # Sleeper FA function — replace isLive heuristic with canonical ID check
    (
        "Sleeper FA filter uses canonical active list",
        """    const isLive = (p: any): boolean => {
      if (!p) return false;
      if (p.active === false) return false;
      // Sleeper never sets status='Retired' — retired guys show as 'Active' forever.
      // Real signals: search_rank >= 9999999 is Sleeper's "don't show" sentinel.
      if (p.search_rank && p.search_rank >= 9999999) return false;
      // Age cutoff by position — retired vets keep their team/status but age up.
      const age = p.age;
      if (age && typeof age === 'number') {
        if (p.position === 'QB' && age >= 40) return false;
        if ((p.position === 'RB') && age >= 33) return false;
        if ((p.position === 'WR' || p.position === 'TE') && age >= 36) return false;
      }
      // Require reasonable relevance — anyone who's never been drafted gets filtered
      if (p.search_rank && p.search_rank > 800 && !p.injury_status) {
        // Allow kickers/backup QBs who are low-rank but still play
        if (p.position !== 'K' && p.position !== 'DEF') return false;
      }
      if (p.position !== 'DEF' && !p.team) return false;
      return true;
    };""",
        """    // Canonical active list from Supabase nfl_players — source of truth
    const activeIds = await getActiveSleeperIds();
    const isLive = (pid: string, p: any): boolean => {
      if (!p) return false;
      // Primary filter: must be in canonical NFL active roster
      if (p.position === 'DEF') return true; // DEFs aren't in nflverse rosters
      if (activeIds.size > 0) {
        return activeIds.has(pid);
      }
      // Fallback if canonical data hasn't loaded — use best-effort heuristics
      if (p.active === false) return false;
      if (p.search_rank && p.search_rank >= 9999999) return false;
      if (p.position !== 'DEF' && !p.team) return false;
      return true;
    };""",
    ),

    # Update callers — isLive now takes (pid, p) not just (p)
    (
        "Pass 1 isLive call signature",
        """      if (!['QB','RB','WR','TE','K','DEF'].includes(p.position)) continue;
      if (!isLive(p)) continue;
      results.push(normalizeSleeperPlayer(t.player_id, p, t.count));""",
        """      if (!['QB','RB','WR','TE','K','DEF'].includes(p.position)) continue;
      if (!isLive(t.player_id, p)) continue;
      results.push(normalizeSleeperPlayer(t.player_id, p, t.count));""",
    ),
    (
        "Pass 2 isLive call signature",
        """          ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
          isLive(p) &&
          p.search_rank && p.search_rank < 500""",
        """          ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
          isLive(pid, p) &&
          p.search_rank && p.search_rank < 500""",
    ),
]

print("── services/waivers.ts ──")
patch_file('services/waivers.ts', WAIVERS_PATCHES)


# ═══════════════════════════════════════════════════════════
# 2. rankingsData.ts — filter ADP results against canonical active
# ═══════════════════════════════════════════════════════════

RANKINGS_PATCHES = [
    (
        "Import getActiveSleeperIds in rankingsData",
        """import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { syncRankingsToCloud, loadRankingsFromCloud } from './userSync';""",
        """import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { syncRankingsToCloud, loadRankingsFromCloud } from './userSync';
import { getActiveSleeperIds } from './nflPlayers';""",
    ),

    # fetchSleeperADP — filter to canonical active players
    (
        "fetchSleeperADP uses canonical active list",
        """export async function fetchSleeperADP(): Promise<RankedPlayer[]> {
  try {
    const players = await getSleeperPlayers();

    const eligible = Object.entries(players)
      .filter(([_, p]: any) =>
        p.active && p.search_rank && p.search_rank < 500 &&
        ['QB', 'RB', 'WR', 'TE', 'K'].includes(p.position) && p.team
      )""",
        """export async function fetchSleeperADP(): Promise<RankedPlayer[]> {
  try {
    const [players, activeIds] = await Promise.all([
      getSleeperPlayers(),
      getActiveSleeperIds().catch(() => new Set<string>()),
    ]);

    const eligible = Object.entries(players)
      .filter(([pid, p]: any) => {
        if (!p.search_rank || p.search_rank >= 500) return false;
        if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(p.position)) return false;
        if (!p.team) return false;
        // If canonical list loaded, require player to be in it
        if (activeIds.size > 0) return activeIds.has(pid);
        // Fallback to Sleeper's own active flag
        return p.active !== false;
      })""",
    ),
]

print("\n── services/rankingsData.ts ──")
patch_file('services/rankingsData.ts', RANKINGS_PATCHES)


print("\nDone. Run `npx tsc --noEmit` to verify.")
