#!/usr/bin/env python3
"""
Upgrade PlayerCardModal to show:
  - SEASON strip (games, PPG, ceiling, games 20+)
  - LAST 5 GAMES section (week, opponent, PPR points)
Pulled from nfl_weekly_stats via services/nflPlayers.ts helpers.
"""
path = 'app/components/PlayerCardModal.tsx'
with open(path) as f: content = f.read()

# ── 1. Extend imports ──
if "PlayerSeason" not in content or "WeeklyStat" not in content:
    old = "import { getPlayerByPlatformId, NFLPlayer } from '../../services/nflPlayers';"
    new = "import { getPlayerByPlatformId, NFLPlayer, getPlayerSeasonStats, getLastNGames, getCurrentStatsSeason, PlayerSeason, WeeklyStat } from '../../services/nflPlayers';"
    if old in content:
        content = content.replace(old, new)
        print("OK  Extended nflPlayers import")

# ── 2. Add state for stats + last games ──
if "const [seasonStats" not in content:
    anchor = "  const [news, setNews] = useState<RotoWireItem[]>([]);"
    insertion = """  const [seasonStats, setSeasonStats] = useState<PlayerSeason | null>(null);
  const [recentGames, setRecentGames] = useState<WeeklyStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
"""
    if anchor in content:
        content = content.replace(anchor, insertion + anchor)
        print("OK  Added stats state")

# ── 3. Add stats fetch to useEffect ──
# We need to piggyback on the existing effect that fetches bio + news.
# The effect ends with "return () => { cancelled = true; };"
# Add the stats fetch right before that return.
anchor_effect = """    return () => { cancelled = true; };
  }, [visible, player?.id, platform]);"""

stats_fetch = """    // Stats — season summary + last 5 games (via canonical gsis_id)
    setStatsLoading(true);
    setSeasonStats(null);
    setRecentGames([]);
    (async () => {
      try {
        const canonical = await getPlayerByPlatformId(platform, player.id);
        if (cancelled || !canonical?.gsis_id) { setStatsLoading(false); return; }
        const season = await getCurrentStatsSeason();
        const [season_stats, last5] = await Promise.all([
          getPlayerSeasonStats(canonical.gsis_id, season),
          getLastNGames(canonical.gsis_id, 5),
        ]);
        if (cancelled) return;
        setSeasonStats(season_stats);
        setRecentGames(last5);
      } catch (e) {
        console.log('player stats load failed', e);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, player?.id, platform]);"""

if "getCurrentStatsSeason" not in content and anchor_effect in content:
    content = content.replace(anchor_effect, stats_fetch)
    print("OK  Added stats fetch to useEffect")

# ── 4. Inject the SEASON strip + LAST 5 GAMES sections ──
# Goes between bio strip and news section.
news_anchor = """          {/* ── NEWS ── */}"""

stats_ui = """          {/* ── STATS (Session 2) ── */}
          {seasonStats && (
            <View style={s.seasonBlock}>
              <Text style={s.sectionLabel}>{seasonStats.season} SEASON · PPR</Text>
              <View style={s.seasonStrip}>
                <SeasonCell label="GMS" value={String(seasonStats.games_played)} />
                <SeasonCell label="PPG" value={seasonStats.avg_ppr.toFixed(1)} />
                <SeasonCell label="CEILING" value={seasonStats.ceiling.toFixed(1)} />
                <SeasonCell label="20+ GMS" value={String(seasonStats.games_20plus)} />
              </View>
              <View style={s.seasonTotalsRow}>
                {seasonStats.total_rush_yds > 0 && (
                  <Text style={s.seasonTotal}>{seasonStats.total_rush_yds} rush yds · {seasonStats.total_rush_tds} TD</Text>
                )}
                {seasonStats.total_rec > 0 && (
                  <Text style={s.seasonTotal}>{seasonStats.total_rec} rec · {seasonStats.total_rec_yds} yds · {seasonStats.total_rec_tds} TD</Text>
                )}
                {seasonStats.total_pass_yds > 0 && (
                  <Text style={s.seasonTotal}>{seasonStats.total_pass_yds} pass yds · {seasonStats.total_pass_tds} TD</Text>
                )}
              </View>
            </View>
          )}

          {recentGames.length > 0 && (
            <View style={{ marginBottom: 12 }}>
              <Text style={s.sectionLabel}>LAST {recentGames.length} GAMES</Text>
              {recentGames.map((w, idx) => {
                const pts = w.fantasy_pts_ppr ?? 0;
                const isHigh = pts >= 20;
                const isLow  = pts < 5;
                return (
                  <View key={idx} style={s.gameRow}>
                    <Text style={s.gameWeek}>W{w.week}</Text>
                    <Text style={s.gameOpp}>{w.opponent ? 'vs ' + w.opponent : '—'}</Text>
                    <Text style={[s.gamePts, isHigh && { color: C.green }, isLow && { color: C.textDim }]}>
                      {pts.toFixed(1)}
                    </Text>
                    {isHigh && <Text style={s.gameStar}>★</Text>}
                  </View>
                );
              })}
            </View>
          )}

          {/* ── NEWS ── */}"""

if "{/* ── STATS (Session 2) ── */}" not in content and news_anchor in content:
    content = content.replace(news_anchor, stats_ui)
    print("OK  Injected stats UI")

# ── 5. Add SeasonCell subcomponent and new styles ──
if "function SeasonCell" not in content:
    # Insert after the existing BioCell function
    anchor_cell = """function BioCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.bioCell}>
      <Text style={s.bioLabel}>{label}</Text>
      <Text style={s.bioValue}>{value}</Text>
    </View>
  );
}"""

    new_cell = anchor_cell + """

function SeasonCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.seasonCell}>
      <Text style={s.seasonLabel}>{label}</Text>
      <Text style={s.seasonValue}>{value}</Text>
    </View>
  );
}"""

    if anchor_cell in content:
        content = content.replace(anchor_cell, new_cell)
        print("OK  Added SeasonCell subcomponent")

# ── 6. Add new styles before the closing of StyleSheet.create ──
style_additions = """
  // Season stats
  seasonBlock: {
    backgroundColor: C.muted,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  seasonStrip: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  seasonCell: {
    flex: 1,
    alignItems: 'center',
  },
  seasonLabel: {
    fontFamily: F.data,
    fontSize: 9,
    color: C.textDim,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  seasonValue: {
    fontFamily: F.bodyB,
    fontSize: 16,
    color: C.aqua,
  },
  seasonTotalsRow: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
    gap: 3,
  },
  seasonTotal: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.textDim,
    letterSpacing: 0.4,
  },

  // Recent games
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: C.muted,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  gameWeek: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    letterSpacing: 0.5,
    width: 40,
  },
  gameOpp: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.text,
    flex: 1,
  },
  gamePts: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: C.amber,
    marginRight: 6,
  },
  gameStar: {
    fontFamily: F.bodyB,
    fontSize: 12,
    color: C.amber,
    width: 14,
  },
"""

# Find closing });  of StyleSheet.create — the very last closing brace in the file
# We'll inject before "});" that closes StyleSheet.create
if "seasonBlock:" not in content:
    # Find the last "});" in the file
    last_close = content.rfind('});')
    if last_close > 0:
        content = content[:last_close] + style_additions + '\n' + content[last_close:]
        print("OK  Added new styles")

with open(path, 'w') as f: f.write(content)
print("\nDone")
