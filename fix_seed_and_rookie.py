#!/usr/bin/env python3
import os, sys
PROJECT_ROOT = os.getcwd()

def patch_file(rel_path, patches):
    path = os.path.join(PROJECT_ROOT, rel_path)
    if not os.path.exists(path):
        print(f"  SKIP: {rel_path}"); return
    with open(path, 'r') as f: content = f.read()
    original = content
    for name, find, replace in patches:
        if find in content:
            content = content.replace(find, replace)
            print(f"  ✓ {name}")
        else:
            print(f"  ✗ {name} (not found)")
    if content != original:
        with open(path, 'w') as f: f.write(content)
        print(f"  → wrote {rel_path}")

DRAFT_PATCHES = [
    (
        "Tighten non-dynasty rookie detection",
        """      const isDynasty = (setupData as any).isDynasty === true;
      const draftMode: 'startup' | 'rookie' | 'redraft' =
        isDynasty && settings.rounds <= 6 ? 'rookie'
        : isDynasty && settings.rounds >= 15 ? 'startup'
        : settings.draftType === 'linear' && settings.rounds <= 5 ? 'rookie'
        : 'redraft';""",
        """      const isDynasty = (setupData as any).isDynasty === true;
      const totalSlots = settings.rosterSlots?.length ?? 0;
      const draftMode: 'startup' | 'rookie' | 'redraft' =
        isDynasty && settings.rounds <= 6 ? 'rookie'
        : isDynasty && settings.rounds >= 15 ? 'startup'
        : settings.draftType === 'linear' && settings.rounds <= 5 && totalSlots <= 8 ? 'rookie'
        : 'redraft';""",
    ),
]

RANKINGS_PATCHES = [
    (
        "Seed My Rankings from community (not SEED)",
        """  const loadSavedState = async () => {
    const base = await getSelectedBase();
    setSelectedBaseState(base);
    const custom = await getCustomRankings(format, selectedLeagueId);
    if (custom && custom.length > 0) {
      setMyRanks(custom);
    } else {
      // No saved rankings — initialize with SEED so drag-and-drop has something to work with
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };""",
        """  const loadSavedState = async () => {
    const base = await getSelectedBase();
    setSelectedBaseState(base);
    const custom = await getCustomRankings(format, selectedLeagueId);
    if (custom && custom.length > 0) {
      setMyRanks(custom);
      return;
    }
    try {
      const live = await fetchBlendedConsensus();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };""",
    ),
    (
        "League change: seed from community",
        """  const handleLeagueChange = async (leagueId: string, leagueName: string) => {
    setSelectedLeagueId(leagueId || undefined);
    setSelectedLeagueName(leagueName);
    // Reload custom rankings for this league
    const custom = await getCustomRankings(format, leagueId || undefined);
    if (custom && custom.length > 0) {
      setMyRanks(custom);
    } else {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, leagueId || undefined);
    }
  };""",
        """  const handleLeagueChange = async (leagueId: string, leagueName: string) => {
    setSelectedLeagueId(leagueId || undefined);
    setSelectedLeagueName(leagueName);
    const custom = await getCustomRankings(format, leagueId || undefined);
    if (custom && custom.length > 0) {
      setMyRanks(custom); return;
    }
    try {
      const live = await fetchBlendedConsensus();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, leagueId || undefined);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, leagueId || undefined);
    }
  };""",
    ),
    (
        "Reset: pull community, not SEED",
        """  const resetToConsensus = () => { setMyRanks([...SEED]); saveCustomRankings([...SEED], format, selectedLeagueId); };""",
        """  const resetToConsensus = async () => {
    try {
      const live = await fetchBlendedConsensus();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };""",
    ),
]

print("── draft.tsx ──")
patch_file('app/(tabs)/draft.tsx', DRAFT_PATCHES)
print("\n── rankings.tsx ──")
patch_file('app/(tabs)/rankings.tsx', RANKINGS_PATCHES)
print("\n✓ Done.")
