#!/usr/bin/env python3
"""
Manually inject the stats fetch into the useEffect in PlayerCardModal.
The prior script failed to match the anchor; this one searches for the
common return-cleanup pattern instead.
"""
path = 'app/components/PlayerCardModal.tsx'
with open(path) as f: c = f.read()

# Find the effect's return cleanup and inject the stats fetch right before it
anchor = "    return () => { cancelled = true; };\n  }, [visible, player?.id, platform]);"

if anchor not in c:
    print(f"Anchor not found. Searching for alternative...")
    # Try a looser match on just the return line
    import re
    matches = re.findall(r"    return \(\) => \{ cancelled = true; \};", c)
    print(f"  Found {len(matches)} return() statements — need to handle more carefully")
    exit()

insertion = """    // Stats — season summary + last 5 games (via canonical gsis_id)
    setStatsLoading(true);
    setSeasonStats(null);
    setRecentGames([]);
    (async () => {
      try {
        const canonical = await getPlayerByPlatformId(platform, player.id);
        if (cancelled || !canonical?.gsis_id) {
          setStatsLoading(false);
          return;
        }
        const season = await getCurrentStatsSeason();
        const [ss, last5] = await Promise.all([
          getPlayerSeasonStats(canonical.gsis_id, season),
          getLastNGames(canonical.gsis_id, 5),
        ]);
        if (cancelled) return;
        setSeasonStats(ss);
        setRecentGames(last5);
      } catch (e) {
        console.log('player stats load failed', e);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, player?.id, platform]);"""

c = c.replace(anchor, insertion)

with open(path, 'w') as f: f.write(c)
print("Stats fetch injected into useEffect")
