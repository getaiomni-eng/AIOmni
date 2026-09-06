// app/components/PlayerCardModal.tsx
// Unified player card — opens on tap from Waivers/Roster rows.
// Shows bio data + live Rotowire news. "Ask AI" button fires existing AI flow.

import React, { useEffect, useMemo, useState } from 'react';
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
import { findNewsForPlayer, NewsItem as FeedNewsItem } from '../../services/newsFeed';
import { getPlayerByPlatformId, NFLPlayer, getPlayerSeasonStats, getLastNGames, getCurrentStatsSeason, PlayerSeason, WeeklyStat } from '../../services/nflPlayers';
import { readableText, useTheme, type ThemeTokens } from '../constants/theme';
import TabIcon from './TabIcon';

// ─── V7 THEME ───────────────────────────────────────────────
// Neutrals/accents now come from useTheme(); these two stay literal:
// the news dot is a FILL, and this red is a local hue with no token.
const ACCENT = {
  green:   '#6eeb83',
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
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [bio, setBio] = useState<NFLPlayer | null>(null);
  const [bioLoading, setBioLoading] = useState(false);
  const [seasonStats, setSeasonStats] = useState<PlayerSeason | null>(null);
  const [recentGames, setRecentGames] = useState<WeeklyStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [news, setNews] = useState<FeedNewsItem[]>([]);
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

    // News — pulls from all 6 RSS sources via consolidated news feed
    setNewsLoading(true);
    findNewsForPlayer(player.name, 3, player.team)
      .then(items => { if (!cancelled) setNews(items); })
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

  // Fallback is a position color (badge FILL + photo border) — stays literal.
  const posColor = readableText(t, POS_COLORS[player.position], 4.5) ?? t.textSub;
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
                    <Text style={[s.gamePts, isHigh && { color: t.successText }, isLow && { color: t.textSub }]}>
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
                <ActivityIndicator color={t.accentText} size="small" />
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
                    <Text style={s.newsSource}>{item.sourceTag}</Text>
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
  const { t } = useTheme();
  const [err, setErr] = useState(false);
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: t.surface,
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
      <Text style={{ fontSize: size * 0.35, color: t.textSub, fontFamily: F.bodyB }}>?</Text>
    </View>
  );
}

function BioCell({ label, value }: { label: string; value: string }) {
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  return (
    <View style={s.bioCell}>
      <Text style={s.bioLabel}>{label}</Text>
      <Text style={s.bioValue}>{value}</Text>
    </View>
  );
}

function SeasonCell({ label, value }: { label: string; value: string }) {
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  return (
    <View style={s.seasonCell}>
      <Text style={s.seasonLabel}>{label}</Text>
      <Text style={s.seasonValue}>{value}</Text>
    </View>
  );
}

// ─── STYLES ─────────────────────────────────────────────────

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,18,20,0.85)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 26,
    borderTopWidth: 1,
    borderColor: t.border,
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.border,
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
    color: t.text,
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
    color: t.textSub,
    letterSpacing: 1,
  },
  jerseyText: {
    fontFamily: F.data,
    fontSize: 12,
    color: t.warnText,
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
    color: ACCENT.red,
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: t.textSub,
  },

  // Bio strip
  bioStrip: {
    flexDirection: 'row',
    backgroundColor: t.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  bioCell: {
    flex: 1,
    alignItems: 'center',
  },
  bioLabel: {
    fontFamily: F.data,
    fontSize: 9,
    color: t.textSub,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  bioValue: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: t.text,
  },
  college: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
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
    color: t.accentText,
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
    backgroundColor: t.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
  },
  newsEmptyText: {
    fontFamily: F.body,
    fontSize: 13,
    color: t.textSub,
    textAlign: 'center',
  },
  newsCard: {
    backgroundColor: t.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.border,
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
    backgroundColor: ACCENT.green,
    marginRight: 6,
  },
  newsSource: {
    fontFamily: F.data,
    fontSize: 9,
    color: t.successText,
    letterSpacing: 1.5,
    flex: 1,
  },
  newsAge: {
    fontFamily: F.data,
    fontSize: 9,
    color: t.textSub,
  },
  newsHeadline: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: t.text,
    marginBottom: 4,
    lineHeight: 19,
  },
  newsBody: {
    fontFamily: F.body,
    fontSize: 12,
    color: t.textSub,
    lineHeight: 17,
  },

  // Ask AI
  askAIBtn: {
    backgroundColor: t.surface,
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
    color: t.dangerText,
    letterSpacing: 1.2,
    flexShrink: 1,
    flex: 1,
    textAlign: 'center',
  },

  // Season stats
  seasonBlock: {
    backgroundColor: t.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.border,
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
    color: t.textSub,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  seasonValue: {
    fontFamily: F.bodyB,
    fontSize: 16,
    color: t.accentText,
  },
  seasonTotalsRow: {
    borderTopWidth: 1,
    borderTopColor: t.border,
    paddingTop: 8,
    gap: 3,
  },
  seasonTotal: {
    fontFamily: F.data,
    fontSize: 10,
    color: t.textSub,
    letterSpacing: 0.4,
  },

  // Recent games
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: t.surface,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: t.border,
  },
  gameWeek: {
    fontFamily: F.data,
    fontSize: 11,
    color: t.textSub,
    letterSpacing: 0.5,
    width: 40,
  },
  gameOpp: {
    fontFamily: F.data,
    fontSize: 12,
    color: t.text,
    flex: 1,
  },
  gamePts: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: t.warnText,
    marginRight: 6,
  },
  gameStar: {
    fontFamily: F.bodyB,
    fontSize: 12,
    color: t.warnText,
    width: 14,
  },

});
