#!/usr/bin/env python3
"""
Fix services/platform/fleaflicker.ts — TypeScript error from getRosterById
not being part of the FantasyPlatform interface.

The method getRosterById() was added as a public method but FantasyPlatform
doesn't declare it. Two ways to fix:
  A. Add it to the interface (other platforms then need to implement it)
  B. Inline the logic into getMyRoster (only caller of getRosterById)

Option B is cleaner — getRosterById was only used by getMyRoster anyway.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_fleaflicker_roster.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "services" / "platform" / "fleaflicker.ts"

OLD = """  async getMyRoster(leagueId: string): Promise<Roster | null> {
    const creds = await getCreds();
    if (!creds) return null;
    return await this.getRosterById(leagueId, creds.teamId);
  },

  async getRosterById(leagueId: string, teamId: string): Promise<Roster | null> {
    const cacheKey = `roster:${leagueId}:${teamId}`;"""

NEW = """  async getMyRoster(leagueId: string): Promise<Roster | null> {
    const creds = await getCreds();
    if (!creds) return null;
    return await fetchRoster(leagueId, creds.teamId);
  },
"""

# Need to also rewrite the rest of getRosterById as a top-level helper
OLD_REST = """  async getRosterById(leagueId: string, teamId: string): Promise<Roster | null> {
    const cacheKey = `roster:${leagueId}:${teamId}`;
    const cached = hotGet<Roster>(cacheKey);
    if (cached) return cached;

    const data = await ff<any>('FetchRoster', { league_id: leagueId, team_id: teamId });
    const team = data?.team;
    const groups = data?.groups ?? [];
    if (!team) return null;

    const starters: RosterSlot[] = [];
    const bench: RosterSlot[] = [];
    const ir: RosterSlot[] = [];
    const taxi: RosterSlot[] = [];

    for (const group of groups) {
      for (const entry of (group?.slots ?? [])) {
        if (!entry?.leaguePlayer?.proPlayer && !entry?.proPlayer) continue;
        const lp = entry.leaguePlayer ?? entry;
        const slot = mapRosterSlot(lp);
        const groupLabel = String(group?.group ?? '').toUpperCase();
        if (groupLabel.includes('IR')) ir.push(slot);
        else if (groupLabel.includes('TAXI')) taxi.push(slot);
        else if (slot.isStarter) starters.push(slot);
        else bench.push(slot);
      }
    }

    const creds = await getCreds();
    const isMe = creds?.teamId === String(teamId);

    const roster: Roster = {
      userId:      String(team.owners?.[0]?.id ?? team.id),
      rosterId:    String(team.id),
      teamName:    team.name ?? 'Unnamed',
      record: {
        wins:   team.recordOverall?.wins ?? 0,
        losses: team.recordOverall?.losses ?? 0,
        ties:   team.recordOverall?.ties ?? 0,
      },
      pointsFor:     parseFloat(team.pointsFor?.formatted ?? '0'),
      pointsAgainst: parseFloat(team.pointsAgainst?.formatted ?? '0'),
      starters,
      bench,
      ir,
      isMe,
    };

    hotSet(cacheKey, roster);
    return roster;
  },"""

# We need to extract this as a module-level function (outside the platform object)
# and then call it from getMyRoster. The cleanest place to put it is right before
# the platform object definition, alongside the other helper functions.

NEW_HELPER = """// ─── roster fetch helper (used by getMyRoster) ────────────────────────────
async function fetchRoster(leagueId: string, teamId: string): Promise<Roster | null> {
  const cacheKey = `roster:${leagueId}:${teamId}`;
  const cached = hotGet<Roster>(cacheKey);
  if (cached) return cached;

  const data = await ff<any>('FetchRoster', { league_id: leagueId, team_id: teamId });
  const team = data?.team;
  const groups = data?.groups ?? [];
  if (!team) return null;

  const starters: RosterSlot[] = [];
  const bench: RosterSlot[] = [];
  const ir: RosterSlot[] = [];
  const taxi: RosterSlot[] = [];

  for (const group of groups) {
    for (const entry of (group?.slots ?? [])) {
      if (!entry?.leaguePlayer?.proPlayer && !entry?.proPlayer) continue;
      const lp = entry.leaguePlayer ?? entry;
      const slot = mapRosterSlot(lp);
      const groupLabel = String(group?.group ?? '').toUpperCase();
      if (groupLabel.includes('IR')) ir.push(slot);
      else if (groupLabel.includes('TAXI')) taxi.push(slot);
      else if (slot.isStarter) starters.push(slot);
      else bench.push(slot);
    }
  }

  const creds = await getCreds();
  const isMe = creds?.teamId === String(teamId);

  const roster: Roster = {
    userId:      String(team.owners?.[0]?.id ?? team.id),
    rosterId:    String(team.id),
    teamName:    team.name ?? 'Unnamed',
    record: {
      wins:   team.recordOverall?.wins ?? 0,
      losses: team.recordOverall?.losses ?? 0,
      ties:   team.recordOverall?.ties ?? 0,
    },
    pointsFor:     parseFloat(team.pointsFor?.formatted ?? '0'),
    pointsAgainst: parseFloat(team.pointsAgainst?.formatted ?? '0'),
    starters,
    bench,
    ir,
    isMe,
  };

  hotSet(cacheKey, roster);
  return roster;
}

"""

# Anchor for inserting the helper — right before the platform object
ANCHOR = """// ─── platform implementation ──────────────────────────────────────────────
export const fleaflickerPlatform: FantasyPlatform = {"""

ANCHOR_NEW = NEW_HELPER + """// ─── platform implementation ──────────────────────────────────────────────
export const fleaflickerPlatform: FantasyPlatform = {"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    s = TARGET.read_text()
    original = s

    if "async function fetchRoster" in s and "getRosterById" not in s:
        print("  [ALREADY]  fix already applied")
        return

    # Step 1: replace the getMyRoster body to use fetchRoster()
    bad_call = "return await this.getRosterById(leagueId, creds.teamId);"
    good_call = "return await fetchRoster(leagueId, creds.teamId);"
    if bad_call in s:
        s = s.replace(bad_call, good_call)
        print("  [APPLIED]  rewrote getMyRoster to use fetchRoster()")
    else:
        print("  [WARN]     could not find getRosterById call site")

    # Step 2: remove the getRosterById method block from the platform object
    if OLD_REST in s:
        s = s.replace(OLD_REST, "")
        print("  [APPLIED]  removed getRosterById method from platform object")
    else:
        print("  [MISSING]  could not find getRosterById method block")
        sys.exit(2)

    # Step 3: insert fetchRoster helper before the platform object
    if ANCHOR in s and "async function fetchRoster" not in s:
        s = s.replace(ANCHOR, ANCHOR_NEW)
        print("  [APPLIED]  inserted fetchRoster helper above platform object")
    elif "async function fetchRoster" in s:
        print("  [ALREADY]  fetchRoster helper present")
    else:
        print("  [MISSING]  could not find platform object anchor")
        sys.exit(2)

    if s != original:
        TARGET.write_text(s)
        print(f"\n✓ {TARGET.name} fixed")


if __name__ == "__main__":
    print("=" * 60)
    print("Fix fleaflicker.ts getRosterById TypeScript error")
    print("=" * 60)
    print()
    main()
    print()
    print("Next: npx tsc --noEmit")
