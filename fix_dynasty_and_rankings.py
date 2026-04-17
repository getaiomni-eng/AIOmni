#!/usr/bin/env python3
import os, sys

PROJECT_ROOT = os.getcwd()

def patch_file(rel_path, patches):
    path = os.path.join(PROJECT_ROOT, rel_path)
    if not os.path.exists(path):
        print(f"  SKIP (not found): {rel_path}")
        return
    with open(path, 'r') as f:
        content = f.read()
    original = content
    for name, find, replace in patches:
        if find in content:
            content = content.replace(find, replace)
            print(f"  ✓ {name}")
        else:
            print(f"  ✗ {name} (pattern not found — already applied?)")
    if content != original:
        with open(path, 'w') as f:
            f.write(content)
        print(f"  → wrote {rel_path}")
    else:
        print(f"  → no changes written")

RANKINGS_PATCHES = [
    (
        "Renumber ranks on move (cascades displacement)",
        """  const confirmMove = () => {
    if (!movePlayer) return;
    const target = parseInt(moveRank, 10);
    if (isNaN(target) || target < 1) { setMovePlayer(null); return; }
    const curIdx = myRanks.findIndex(p => p.id === movePlayer.id);
    if (curIdx === -1) { setMovePlayer(null); return; }
    const newIdx = Math.min(Math.max(target - 1, 0), myRanks.length - 1);
    const next = [...myRanks];
    const [moved] = next.splice(curIdx, 1);
    next.splice(newIdx, 0, moved);
    saveMyRanks(next);
    setMovePlayer(null);
  };""",
        """  const confirmMove = () => {
    if (!movePlayer) return;
    const target = parseInt(moveRank, 10);
    if (isNaN(target) || target < 1) { setMovePlayer(null); return; }
    const curIdx = myRanks.findIndex(p => p.id === movePlayer.id);
    if (curIdx === -1) { setMovePlayer(null); return; }
    const newIdx = Math.min(Math.max(target - 1, 0), myRanks.length - 1);
    const next = [...myRanks];
    const [moved] = next.splice(curIdx, 1);
    next.splice(newIdx, 0, moved);
    const renumbered = next.map((p, i) => ({ ...p, rank: i + 1 }));
    saveMyRanks(renumbered);
    setMovePlayer(null);
  };""",
    ),
    (
        "Preserve manual order in My Rankings (skip format re-sort)",
        """  const rawData = mode === 'mine' ? myRanks : communityData;
  const formatAdjusted = applyFormatAdjustments(rawData, format as ScoringFormat);""",
        """  const rawData = mode === 'mine' ? myRanks : communityData;
  const formatAdjusted = mode === 'mine' ? rawData : applyFormatAdjustments(rawData, format as ScoringFormat);""",
    ),
]

DRAFT_PATCHES = [
    (
        "Flag dynasty leagues from Sleeper settings",
        """                  onUpdate({
                      leagueId: lg.league_id,
                      leagueName: lg.name,
                      teamCount: lg.total_rosters || 12,
                      scoringFormat: (lg.scoring_settings?.rec === 1 ? 'ppr' : lg.scoring_settings?.rec === 0.5 ? 'half' : 'standard'),
                      rosterSlots: lg.roster_positions || ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
                      scoringSettings: lg.scoring_settings,
                    });""",
        """                  onUpdate({
                      leagueId: lg.league_id,
                      leagueName: lg.name,
                      teamCount: lg.total_rosters || 12,
                      scoringFormat: (lg.scoring_settings?.rec === 1 ? 'ppr' : lg.scoring_settings?.rec === 0.5 ? 'half' : 'standard'),
                      rosterSlots: lg.roster_positions || ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
                      scoringSettings: lg.scoring_settings,
                      isDynasty: lg.settings?.type === 2 || !!lg.previous_league_id,
                    } as any);""",
    ),
    (
        "Dynasty-aware draft mode + full league roster exclusion",
        """    // Load live ADP data (falls back to static DB if offline)
            // Auto-detect draft mode: only rookie if explicitly linear + 5 or fewer rounds + no starters
      // Only startup if 28+ roster slots (true dynasty startup, not just deep benches)
      const totalSlots = settings.rosterSlots?.length ?? 0;
      const draftMode: 'startup' | 'rookie' | 'redraft' =
        settings.draftType === 'linear' && settings.rounds <= 5 && totalSlots <= 6
          ? 'rookie'
          : totalSlots >= 28
            ? 'startup'
            : 'redraft';
      let liveDB = await loadLivePlayerDB(draftMode);
      // Exclude players already on user's roster in this league
      if (settings.platform === 'sleeper' && settings.leagueId && settings.leagueId !== 'offline') {
        try {
          const username = await AsyncStorage.getItem('sleeper_username');
          if (username) {
            const uRes = await fetch('https://api.sleeper.app/v1/user/' + username);
            const u = await uRes.json();
            const rostersRes = await fetch('https://api.sleeper.app/v1/league/' + settings.leagueId + '/rosters');
            const rosters = await rostersRes.json();
            const myRoster = rosters.find((r: any) => r.owner_id === u.user_id);
            if (myRoster?.players) {
              const rosterSet = new Set(myRoster.players.map(String));
              liveDB = liveDB.map(p => rosterSet.has(p.id) ? { ...p, isDrafted: true } : p);
            }
          }
        } catch (e) { console.log('roster filter error:', e); }
      }""",
        """    // Load live ADP data (falls back to static DB if offline)
      const isDynasty = (setupData as any).isDynasty === true;
      const draftMode: 'startup' | 'rookie' | 'redraft' =
        isDynasty && settings.rounds <= 6 ? 'rookie'
        : isDynasty && settings.rounds >= 15 ? 'startup'
        : settings.draftType === 'linear' && settings.rounds <= 5 ? 'rookie'
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
      }""",
    ),
]

if __name__ == '__main__':
    print("AIOmni Fix Patch — Dynasty Draft Pool + Rankings Reorder")
    print("=" * 60)
    if not os.path.exists(os.path.join(PROJECT_ROOT, 'app', '(tabs)')):
        print(f"ERROR: not in project root (no app/(tabs) here)")
        sys.exit(1)
    print("\n── rankings.tsx ──")
    patch_file('app/(tabs)/rankings.tsx', RANKINGS_PATCHES)
    print("\n── draft.tsx ──")
    patch_file('app/(tabs)/draft.tsx', DRAFT_PATCHES)
    print("\n✓ Done. Reload Expo.")
