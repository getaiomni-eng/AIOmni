// app/components/PlayerCardModal.tsx
// Unified player card — opens on tap from Waivers/Roster rows.
// Shows bio data + live Rotowire news. "Ask AI" button fires existing AI flow.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { fetchRotoWireNFL, findNewsForPlayer, RotoWireItem } from '../../services/rotowire';
import { getPlayerByPlatformId, NFLPlayer, getPlayerSeasonStats, getLastNGames, getCurrentStatsSeason, PlayerSeason, WeeklyStat } from '../../services/nflPlayers';
import TabIcon from './TabIcon';

// ─── V7 THEME ───────────────────────────────────────────────
const C = {
  bg:      '#0a1214',
  card:    '#12252e',
  cardAlt: '#14282f',
  border:  '#1a3542',
  muted:   '#0f1c22',
  amber:   '#ffb800',
  aqua:    '#1be7ff',
  green:   '#6eeb83',
  text:    '#f0f4f5',
  textDim: '#7a9eaa',
  red:     '#ff4d6a',
};

const POS_COLORS: Record<string, string> = {
  QB:  '#ff6b9d',
  RB:  '#1be7ff',
  WR:  '#6eeb83',
  TE:  '#ffb800',
  K:   '#7a9eaa',
  DEF: '#c78dff',
  DST: '#c78dff',
};

const F = {
  heading: 'BebasNeue-Regular',
  body:    'Barlow-Regular',
  bodyB:   'Barlow-Bold',
  data:    'SpaceMono-Regular',
};

export interface PlayerCardPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  injuryStatus?: string;
}

interface Props {
  visible: boolean;
  player: PlayerCardPlayer | null;
  platform: 'sleeper' | 'espn' | 'yahoo';
  onClose: () => void;
  onAskAI: () => void;
}

function formatHeight(raw: string | number | null | undefined): string {
  if (raw == null) return '—';
  const num = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!isNaN(num) && num >= 60 && num <= 90) {
    const feet = Math.floor(num / 12);
    const inches = num % 12;
    return `${feet}'${inches}"`;
  }
  if (typeof raw === 'string' && raw.includes('-')) {
    const [f, i] = raw.split('-');
    return `${f}'${i}"`;
  }
  return String(raw);
}

export default function PlayerCardModal({ visible, player, platform, onClose, onAskAI }: Props) {
  const [bio, setBio] = useState<NFLPlayer | null>(null);
  const [bioLoading, setBioLoading] = useState(false);
  const [seasonStats, setSeasonStats] = useState<PlayerSeason | null>(null);
  const [recentGames, setRecentGames] = useState<WeeklyStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [news, setNews] = useState<RotoWireItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);

  // Load bio + news when modal opens
  useEffect(() => {
    if (!visible || !player) return;

    let cancelled = false;

    // Bio — from canonical nfl_players table (by Sleeper/ESPN/Yahoo id)
    setBioLoading(true);
    getPlayerByPlatformId(platform, player.id)
      .then(result => { if (!cancelled) setBio(result); })
      .catch(() => { if (!cancelled) setBio(null); })
      .finally(() => { if (!cancelled) setBioLoading(false); });

    // News — Rotowire RSS, filtered to this player
    setNewsLoading(true);
    fetchRotoWireNFL()
      .then(items => {
        if (cancelled) return;
        // Find up to 3 items mentioning this player
        const matches: RotoWireItem[] = [];
        const lowerName = player.name.toLowerCase();
        const lastName = player.name.split(' ').pop()?.toLowerCase() ?? '';
        for (const item of items) {
          const itemPlayer = item.player.toLowerCase();
          if (
            itemPlayer === lowerName ||
            (lastName && itemPlayer.endsWith(lastName)) ||
            (item.headline.toLowerCase().includes(lowerName))
          ) {
            matches.push(item);
            if (matches.length >= 3) break;
          }
        }
        setNews(matches);
      })
      .catch(() => { if (!cancelled) setNews([]); })
      .finally(() => { if (!cancelled) setNewsLoading(false); });

    // Stats — season summary + last 5 games (via canonical gsis_id)
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
  }, [visible, player?.id, platform]);

  if (!player) return null;

  const posColor = POS_COLORS[player.position] ?? C.textDim;
  const photoUrl = `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          {/* ── HERO ── */}
          <View style={s.hero}>
            <PlayerPhoto url={photoUrl} size={80} borderColor={posColor} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.name}>{player.name}</Text>
              <View style={s.metaRow}>
                <View style={[s.posBadge, { backgroundColor: posColor }]}>
                  <Text style={s.posText}>{player.position}</Text>
                </View>
                <Text style={s.teamText}>{player.team}</Text>
                {bio?.jersey_number ? (
                  <Text style={s.jerseyText}>#{bio.jersey_number}</Text>
                ) : null}
              </View>
              {player.injuryStatus ? (
                <View style={s.injuryPill}>
                  <Text style={s.injuryText}>⚠ {player.injuryStatus}</Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ── BIO STRIP ── */}
          {bio && (
            <View style={s.bioStrip}>
              <BioCell label="AGE" value={bio.age != null ? String(bio.age) : '—'} />
              <BioCell label="EXP" value={bio.years_exp != null ? `${bio.years_exp} yr` : '—'} />
              <BioCell label="HEIGHT" value={formatHeight(bio.height)} />
              <BioCell label="WEIGHT" value={bio.weight ? `${bio.weight}` : '—'} />
            </View>
          )}
          {bio?.college ? (
            <Text style={s.college}>From {bio.college}</Text>
          ) : null}

          {/* ── STATS (Session 2) ── */}
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

          {/* ── NEWS ── */}
          <ScrollView style={s.newsScroll} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={s.sectionLabel}>PLAYER NEWS</Text>
            {newsLoading ? (
              <View style={s.newsLoading}>
                <ActivityIndicator color={C.aqua} size="small" />
              </View>
            ) : news.length === 0 ? (
              <View style={s.newsEmpty}>
                <Text style={s.newsEmptyText}>No recent headlines.</Text>
              </View>
            ) : (
              news.map((item, idx) => (
                <View key={idx} style={s.newsCard}>
                  <View style={s.newsHeader}>
                    <View style={s.newsSourceDot} />
                    <Text style={s.newsSource}>ROTOWIRE</Text>
                    <Text style={s.newsAge}>{item.age}</Text>
                  </View>
                  <Text style={s.newsHeadline}>{item.headline}</Text>
                  {item.body ? (
                    <Text style={s.newsBody} numberOfLines={3}>{item.body}</Text>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>

          {/* ── ASK AI BUTTON ── */}
          <TouchableOpacity style={s.askAIBtn} onPress={onAskAI} activeOpacity={0.85}>
            <View style={s.askAIIconTile}>
              <TabIcon name="coach" focused={true} size={30} />
            </View>
            <Text style={s.askAIText}>ASK AI COACH ABOUT {player.name.split(' ').pop()?.toUpperCase()}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── SUBCOMPONENTS ─────────────────────────────────────────

function PlayerPhoto({ url, size, borderColor }: { url: string; size: number; borderColor: string }) {
  const [err, setErr] = useState(false);
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: C.muted,
    borderWidth: 2,
    borderColor,
  };
  if (!err) {
    return (
      <Image
        source={{ uri: url }}
        style={style}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: size * 0.35, color: C.textDim, fontFamily: F.bodyB }}>?</Text>
    </View>
  );
}

function BioCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.bioCell}>
      <Text style={s.bioLabel}>{label}</Text>
      <Text style={s.bioValue}>{value}</Text>
    </View>
  );
}

function SeasonCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.seasonCell}>
      <Text style={s.seasonLabel}>{label}</Text>
      <Text style={s.seasonValue}>{value}</Text>
    </View>
  );
}

// ─── STYLES ─────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,18,20,0.85)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 26,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 12,
  },

  // Hero
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  name: {
    fontFamily: F.bodyB,
    fontSize: 22,
    color: C.text,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  posBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  posText: {
    fontFamily: F.data,
    fontSize: 10,
    color: '#000',
    fontWeight: '700',
  },
  teamText: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.textDim,
    letterSpacing: 1,
  },
  jerseyText: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.amber,
  },
  injuryPill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,77,106,0.12)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  injuryText: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.red,
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: C.muted,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: C.textDim,
  },

  // Bio strip
  bioStrip: {
    flexDirection: 'row',
    backgroundColor: C.muted,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  bioCell: {
    flex: 1,
    alignItems: 'center',
  },
  bioLabel: {
    fontFamily: F.data,
    fontSize: 9,
    color: C.textDim,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  bioValue: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: C.text,
  },
  college: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    marginBottom: 14,
    paddingHorizontal: 4,
  },

  // News
  newsScroll: {
    maxHeight: 280,
    marginBottom: 14,
  },
  sectionLabel: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.aqua,
    letterSpacing: 2,
    marginBottom: 8,
    marginTop: 4,
  },
  newsLoading: {
    padding: 24,
    alignItems: 'center',
  },
  newsEmpty: {
    padding: 14,
    backgroundColor: C.muted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  newsEmptyText: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.textDim,
    textAlign: 'center',
  },
  newsCard: {
    backgroundColor: C.muted,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  newsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  newsSourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.green,
    marginRight: 6,
  },
  newsSource: {
    fontFamily: F.data,
    fontSize: 9,
    color: C.green,
    letterSpacing: 1.5,
    flex: 1,
  },
  newsAge: {
    fontFamily: F.data,
    fontSize: 9,
    color: C.textDim,
  },
  newsHeadline: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: C.text,
    marginBottom: 4,
    lineHeight: 19,
  },
  newsBody: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.textDim,
    lineHeight: 17,
  },

  // Ask AI
  askAIBtn: {
    backgroundColor: C.muted,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#ff5714',
    shadowColor: '#ff5714',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  askAIIconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,87,20,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,87,20,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  askAIText: {
    fontFamily: F.bodyB,
    fontSize: 13,
    color: '#ff5714',
    letterSpacing: 1.2,
    flexShrink: 1,
    flex: 1,
    textAlign: 'center',
  },

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

});
