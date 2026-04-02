import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  FlatList, Image, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, SP, SZ, textShadow } from '../constants/tokens';

type Format  = 'PPR' | 'HALF' | 'STD';
type Position = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
type Mode    = 'community' | 'mine';

interface Player {
  id:       string;
  name:     string;
  position: string;
  team:     string;
  rank:     number;
  bye?:     number;
  trend?:   'up' | 'down' | 'neutral';
  drafted?: boolean;
}

const POS_COLORS: Record<string, string> = {
  QB: '#b8a8e8', RB: '#82c494', WR: '#7ec8e8',
  TE: '#e8b078', K: 'rgba(255,255,255,0.55)', DST: '#a090d0',
};

// Sleeper player IDs for headshots via sleepercdn.com/content/nfl/players/thumb/{id}.jpg
const SEED_PLAYERS: Player[] = [
  { id: '4046',  name: 'Christian McCaffrey',   position: 'RB',  team: 'SF',  rank: 1  },
  { id: '6786',  name: 'CeeDee Lamb',            position: 'WR',  team: 'DAL', rank: 2  },
  { id: '7564',  name: 'Tyreek Hill',            position: 'WR',  team: 'MIA', rank: 3  },
  { id: '4866',  name: 'Justin Jefferson',        position: 'WR',  team: 'MIN', rank: 4  },
  { id: '6770',  name: 'Ja\'Marr Chase',          position: 'WR',  team: 'CIN', rank: 5  },
  { id: '4039',  name: 'Saquon Barkley',          position: 'RB',  team: 'PHI', rank: 6  },
  { id: '4034',  name: 'Davante Adams',           position: 'WR',  team: 'LV',  rank: 7  },
  { id: '4988',  name: 'Amon-Ra St. Brown',       position: 'WR',  team: 'DET', rank: 8  },
  { id: '2449',  name: 'Travis Kelce',            position: 'TE',  team: 'KC',  rank: 9  },
  { id: '7547',  name: 'Josh Allen',              position: 'QB',  team: 'BUF', rank: 10 },
  { id: '4136',  name: 'Derrick Henry',           position: 'RB',  team: 'TEN', rank: 11 },
  { id: '4035',  name: 'Stefon Diggs',            position: 'WR',  team: 'BUF', rank: 12 },
  { id: '4063',  name: 'DK Metcalf',              position: 'WR',  team: 'SEA', rank: 13 },
  { id: '6783',  name: 'Jonathan Taylor',         position: 'RB',  team: 'IND', rank: 14 },
  { id: '5123',  name: 'Lamar Jackson',           position: 'QB',  team: 'BAL', rank: 15 },
  { id: '7569',  name: 'Jalen Hurts',             position: 'QB',  team: 'PHI', rank: 16 },
  { id: '7543',  name: 'Davante Adams',           position: 'WR',  team: 'LV',  rank: 17 },
  { id: '4018',  name: 'Mike Evans',              position: 'WR',  team: 'TB',  rank: 18 },
  { id: '6797',  name: 'Tee Higgins',             position: 'WR',  team: 'CIN', rank: 19 },
  { id: '5849',  name: 'DeVonta Smith',           position: 'WR',  team: 'PHI', rank: 20 },
  { id: '6813',  name: 'Kyren Williams',          position: 'RB',  team: 'LAR', rank: 21 },
  { id: '4137',  name: 'Alvin Kamara',            position: 'RB',  team: 'NO',  rank: 22 },
  { id: '7576',  name: 'Puka Nacua',              position: 'WR',  team: 'LAR', rank: 23 },
  { id: '4984',  name: 'A.J. Brown',              position: 'WR',  team: 'PHI', rank: 24 },
  { id: '4958',  name: 'Cooper Kupp',             position: 'WR',  team: 'LAR', rank: 25 },
  { id: '7554',  name: 'Sam LaPorta',             position: 'TE',  team: 'DET', rank: 26 },
  { id: '6803',  name: 'Rachaad White',           position: 'RB',  team: 'TB',  rank: 27 },
  { id: '5012',  name: 'Tony Pollard',            position: 'RB',  team: 'TEN', rank: 28 },
  { id: '4137',  name: 'Josh Jacobs',             position: 'RB',  team: 'GB',  rank: 29 },
  { id: '5938',  name: 'Mark Andrews',            position: 'TE',  team: 'BAL', rank: 30 },
  { id: '6826',  name: 'Garrett Wilson',          position: 'WR',  team: 'NYJ', rank: 31 },
  { id: '5849',  name: 'Christian Kirk',          position: 'WR',  team: 'JAX', rank: 32 },
  { id: '4040',  name: 'Dalton Kincaid',          position: 'TE',  team: 'BUF', rank: 33 },
  { id: '6794',  name: 'Najee Harris',            position: 'RB',  team: 'PIT', rank: 34 },
  { id: '4217',  name: 'Patrick Mahomes',         position: 'QB',  team: 'KC',  rank: 35 },
  { id: '4024',  name: 'Jordan Love',             position: 'QB',  team: 'GB',  rank: 36 },
  { id: '6828',  name: 'Jahmyr Gibbs',            position: 'RB',  team: 'DET', rank: 37 },
  { id: '7571',  name: 'David Montgomery',        position: 'RB',  team: 'DET', rank: 38 },
  { id: '5850',  name: 'DeAndre Hopkins',         position: 'WR',  team: 'TEN', rank: 39 },
  { id: '4011',  name: 'Amari Cooper',            position: 'WR',  team: 'CLE', rank: 40 },
  { id: '6784',  name: 'Jaylen Waddle',           position: 'WR',  team: 'MIA', rank: 41 },
  { id: '7526',  name: 'Drake London',            position: 'WR',  team: 'ATL', rank: 42 },
  { id: '6159',  name: 'James Conner',            position: 'RB',  team: 'ARI', rank: 43 },
  { id: '7568',  name: 'Dak Prescott',            position: 'QB',  team: 'DAL', rank: 44 },
  { id: '4017',  name: 'Terry McLaurin',          position: 'WR',  team: 'WAS', rank: 45 },
  { id: '6828',  name: 'Bijan Robinson',          position: 'RB',  team: 'ATL', rank: 46 },
  { id: '4094',  name: 'Gus Edwards',             position: 'RB',  team: 'LAC', rank: 47 },
  { id: '5850',  name: 'Keenan Allen',            position: 'WR',  team: 'CHI', rank: 48 },
  { id: '5938',  name: 'Evan Engram',             position: 'TE',  team: 'JAX', rank: 49 },
  { id: '7553',  name: 'Jake Ferguson',           position: 'TE',  team: 'DAL', rank: 50 },
  { id: '6817',  name: 'Romeo Doubs',             position: 'WR',  team: 'GB',  rank: 51 },
  { id: '5124',  name: 'Tua Tagovailoa',          position: 'QB',  team: 'MIA', rank: 52 },
  { id: '6791',  name: 'Rashee Rice',             position: 'WR',  team: 'KC',  rank: 53 },
  { id: '5016',  name: 'Stefon Diggs',            position: 'WR',  team: 'HOU', rank: 54 },
  { id: '7567',  name: 'Jordan Addison',          position: 'WR',  team: 'MIN', rank: 55 },
  { id: '6800',  name: 'Michael Pittman Jr.',     position: 'WR',  team: 'IND', rank: 56 },
  { id: '5856',  name: 'Calvin Ridley',           position: 'WR',  team: 'TEN', rank: 57 },
  { id: '4047',  name: 'Austin Ekeler',           position: 'RB',  team: 'WAS', rank: 58 },
  { id: '5126',  name: 'Joe Mixon',               position: 'RB',  team: 'HOU', rank: 59 },
  { id: '6161',  name: 'Zack Moss',               position: 'RB',  team: 'CIN', rank: 60 },
  { id: '7551',  name: 'Dalton Schultz',          position: 'TE',  team: 'HOU', rank: 61 },
  { id: '5123',  name: 'C.J. Stroud',             position: 'QB',  team: 'HOU', rank: 62 },
  { id: '6808',  name: 'Treylon Burks',           position: 'WR',  team: 'TEN', rank: 63 },
  { id: '4020',  name: 'George Kittle',           position: 'TE',  team: 'SF',  rank: 64 },
  { id: '7525',  name: 'TreVeyon Henderson',      position: 'RB',  team: 'NE',  rank: 65 },
  { id: '5847',  name: 'Javonte Williams',        position: 'RB',  team: 'DEN', rank: 66 },
  { id: '5016',  name: 'Trey McBride',            position: 'TE',  team: 'ARI', rank: 67 },
  { id: '5118',  name: 'Rhamondre Stevenson',     position: 'RB',  team: 'NE',  rank: 68 },
  { id: '4028',  name: 'Tyler Lockett',           position: 'WR',  team: 'SEA', rank: 69 },
  { id: '6818',  name: 'Rashid Shaheed',          position: 'WR',  team: 'NO',  rank: 70 },
  { id: '4137',  name: 'Deebo Samuel',            position: 'WR',  team: 'SF',  rank: 71 },
  { id: '5849',  name: 'DJ Moore',                position: 'WR',  team: 'CHI', rank: 72 },
  { id: '6827',  name: 'Tank Dell',               position: 'WR',  team: 'HOU', rank: 73 },
  { id: '5016',  name: 'Isaiah Likely',           position: 'TE',  team: 'BAL', rank: 74 },
  { id: '4032',  name: 'Brandin Cooks',           position: 'WR',  team: 'DAL', rank: 75 },
].map(p => ({ ...p, trend: 'neutral' as const, drafted: false }));

function PlayerPhoto({ playerId, size = 48 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  const posStyle = { width: size, height: size, borderRadius: size / 2 };

  if (!err) {
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }}
        style={[posStyle, { backgroundColor: 'rgba(255,255,255,0.08)' }]}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[posStyle, { backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: size * 0.35, color: C.dim2 }}>?</Text>
    </View>
  );
}

export default function RankingsScreen() {
  const insets = useSafeAreaInsets();

  const [mode,      setMode]      = useState<Mode>('community');
  const [format,    setFormat]    = useState<Format>('PPR');
  const [position,  setPosition]  = useState<Position>('ALL');
  const [search,    setSearch]    = useState('');
  const [players,   setPlayers]   = useState<Player[]>(SEED_PLAYERS);
  const [myRanks,   setMyRanks]   = useState<Player[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [showPlatformPrompt, setShowPlatformPrompt] = useState(false);

  const POSITIONS: Position[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

  useEffect(() => {
    AsyncStorage.getItem('custom_rankings').then(saved => {
      if (saved) {
        setMyRanks(JSON.parse(saved));
      } else {
        // First time — prompt user for base platform
        setShowPlatformPrompt(true);
        setMyRanks([...SEED_PLAYERS]);
      }
    });
  }, []);

  const initFromPlatform = async (platform: string) => {
    setShowPlatformPrompt(false);
    // All platforms start from AIOmni consensus for now
    // When connected to Sleeper/ESPN/Yahoo we pull their ADP
    const base = [...SEED_PLAYERS];
    saveMyRanks(base);
    setMode('mine');
  };

  const saveMyRanks = (ranks: Player[]) => {
    setMyRanks(ranks);
    AsyncStorage.setItem('custom_rankings', JSON.stringify(ranks));
  };

  const activeList = mode === 'mine' ? myRanks : players;

  const filtered = activeList.filter(p => {
    const matchPos = position === 'ALL' || p.position === position;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase());
    return matchPos && matchSearch;
  });

  // Move player up in custom rankings
  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const list = [...myRanks];
    const globalIdx = myRanks.findIndex(p => p.id === filtered[idx].id && p.name === filtered[idx].name);
    const prevIdx   = myRanks.findIndex(p => p.id === filtered[idx - 1].id && p.name === filtered[idx - 1].name);
    if (globalIdx < 0 || prevIdx < 0) return;
    [list[globalIdx], list[prevIdx]] = [list[prevIdx], list[globalIdx]];
    list.forEach((p, i) => { p.rank = i + 1; });
    saveMyRanks(list);
  };

  const moveDown = (idx: number) => {
    if (idx >= filtered.length - 1) return;
    const list = [...myRanks];
    const globalIdx = myRanks.findIndex(p => p.id === filtered[idx].id && p.name === filtered[idx].name);
    const nextIdx   = myRanks.findIndex(p => p.id === filtered[idx + 1].id && p.name === filtered[idx + 1].name);
    if (globalIdx < 0 || nextIdx < 0) return;
    [list[globalIdx], list[nextIdx]] = [list[nextIdx], list[globalIdx]];
    list.forEach((p, i) => { p.rank = i + 1; });
    saveMyRanks(list);
  };

  const toggleDrafted = (player: Player) => {
    const list = myRanks.map(p =>
      p.id === player.id && p.name === player.name ? { ...p, drafted: !p.drafted } : p
    );
    saveMyRanks(list);
  };

  const resetMyRanks = () => {
    const reset = SEED_PLAYERS.map(p => ({ ...p, drafted: false }));
    saveMyRanks(reset);
  };

  const renderPlayer = ({ item, index, drag, isActive }: RenderItemParams<Player> & { index: number }) => {
    const posColor   = POS_COLORS[item.position] || C.dim2;
    const isDrafted  = item.drafted;
    const trendIcon  = item.trend === 'up' ? '▲' : item.trend === 'down' ? '▼' : '';
    const trendColor = item.trend === 'up' ? C.sage : item.trend === 'down' ? '#e05555' : C.dim2;

    return (
      <ScaleDecorator>
        <View style={[
          styles.playerRow,
          isDrafted && styles.playerRowDrafted,
          isActive && { backgroundColor: 'rgba(254,226,41,0.12)', borderColor: 'rgba(254,226,41,0.4)' },
        ]}>
          {/* Rank number */}
          <View style={styles.rankWrap}>
            <Text style={[styles.rankNum, isDrafted && { color: C.dim2 }]}>{(index ?? 0) + 1}</Text>
            {trendIcon ? <Text style={[styles.trendIcon, { color: trendColor }]}>{trendIcon}</Text> : null}
          </View>

          {/* Photo */}
          <View style={{ opacity: isDrafted ? 0.4 : 1 }}>
            <PlayerPhoto playerId={item.id} size={46} />
            <View style={[styles.posBadge, { backgroundColor: posColor }]}>
              <Text style={styles.posBadgeText}>{item.position}</Text>
            </View>
          </View>

          {/* Info */}
          <View style={[styles.playerInfo, isDrafted && { opacity: 0.5 }, { flex: 1 }]}>
            <Text style={[styles.playerName, isDrafted && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.playerTeam}>{item.team}{item.bye ? ` · BYE ${item.bye}` : ''}</Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            {draftMode && mode === 'mine' ? (
              <TouchableOpacity style={[styles.draftBtn, isDrafted && styles.draftBtnOn]} onPress={() => toggleDrafted(item)}>
                <Text style={[styles.draftBtnTxt, isDrafted && { color: C.gold }]}>{isDrafted ? '✓' : '○'}</Text>
              </TouchableOpacity>
            ) : mode === 'mine' ? (
              <TouchableOpacity onLongPress={drag} delayLongPress={150} style={styles.dragHandle}>
                <Text style={styles.dragIcon}>⠿</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>

        {/* ── Platform Prompt Modal ── */}
        {showPlatformPrompt && (
          <View style={styles.platformOverlay}>
            <View style={styles.platformSheet}>
              <Text style={styles.platformTitle}>START YOUR RANKINGS</Text>
              <Text style={styles.platformSub}>Choose a base to start your custom rankings from. You can reorder them however you want.</Text>
              {[
                { label: 'AIOmni Consensus', sub: 'Our community-weighted rankings', color: C.gold, platform: 'aiomni' },
                { label: 'Sleeper ADP',       sub: 'Based on Sleeper draft trends',   color: C.sage,  platform: 'sleeper' },
                { label: 'ESPN ADP',           sub: 'Based on ESPN draft trends',      color: '#FF4444', platform: 'espn' },
                { label: 'Yahoo ADP',          sub: 'Based on Yahoo draft trends',     color: '#6001D2', platform: 'yahoo' },
              ].map(opt => (
                <TouchableOpacity key={opt.platform} style={[styles.platformOption, { borderColor: opt.color + '40' }]} onPress={() => initFromPlatform(opt.platform)}>
                  <View style={[styles.platformDot, { backgroundColor: opt.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.platformOptLabel, { color: opt.color }]}>{opt.label}</Text>
                    <Text style={styles.platformOptSub}>{opt.sub}</Text>
                  </View>
                  <Text style={{ color: C.dim2, fontSize: 18 }}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>RANKINGS</Text>
            <Text style={styles.headline}>
              {mode === 'community' ? 'Community Consensus' : 'My Custom Rankings'}
            </Text>
          </View>
          {mode === 'mine' && (
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={[styles.draftModeBtn, draftMode && styles.draftModeBtnOn]}
                onPress={() => setDraftMode(d => !d)}
              >
                <Text style={[styles.draftModeTxt, draftMode && { color: C.gold }]}>
                  {draftMode ? '✓ DRAFT' : '⊙ DRAFT'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.resetBtn} onPress={resetMyRanks}>
                <Text style={styles.resetTxt}>RESET</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Mode toggle ── */}
        <View style={styles.modeToggle}>
          {(['community', 'mine'] as Mode[]).map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.modeBtn, mode === m && styles.modeBtnOn]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.modeTxt, mode === m && styles.modeTxtOn]}>
                {m === 'community' ? '👥 COMMUNITY' : '⭐ MINE'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Format + Position filters ── */}
        <View style={styles.filtersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(['PPR', 'HALF', 'STD'] as Format[]).map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, format === f && { backgroundColor: C.goldS, borderColor: C.goldBorder }]}
                onPress={() => setFormat(f)}
              >
                <Text style={[styles.filterChipTxt, format === f && { color: C.gold }]}>
                  {f === 'HALF' ? '0.5 PPR' : f}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.filterSep} />
            {POSITIONS.map(pos => (
              <TouchableOpacity
                key={pos}
                style={[styles.filterChip, position === pos && { backgroundColor: (POS_COLORS[pos] ?? C.gold) + '22', borderColor: (POS_COLORS[pos] ?? C.gold) + '66' }]}
                onPress={() => setPosition(pos)}
              >
                <Text style={[styles.filterChipTxt, position === pos && { color: POS_COLORS[pos] ?? C.gold }]}>{pos}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Search ── */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search players..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Community label ── */}
        {mode === 'community' && (
          <View style={styles.communityBanner}>
            <Text style={styles.communityTxt}>📊 Community consensus · {format} scoring · Updated daily</Text>
          </View>
        )}
        {mode === 'mine' && !draftMode && (
          <View style={styles.communityBanner}>
            <Text style={styles.communityTxt}>⭐ Your rankings · Hold ⠿ to drag and reorder · Switch to Draft mode to check off picks</Text>
          </View>
        )}
        {draftMode && mode === 'mine' && (
          <View style={[styles.communityBanner, { borderColor: C.goldBorder, backgroundColor: C.goldS }]}>
            <Text style={[styles.communityTxt, { color: C.gold }]}>⊙ Draft mode — tap ○ to mark as drafted</Text>
          </View>
        )}

        {/* ── Player list ── */}
        {mode === 'mine' ? (
          <DraggableFlatList
            data={filtered}
            keyExtractor={(item, i) => `${item.id}-${i}`}
            renderItem={renderPlayer}
            onDragEnd={({ data }) => saveMyRanks(data)}
            contentContainerStyle={{ paddingBottom: 100, paddingTop: 4 }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item, i) => `${item.id}-${item.name}-${i}`}
            renderItem={({ item, index }) => renderPlayer({ item, index, drag: () => {}, isActive: false })}
            contentContainerStyle={{ paddingBottom: 100, paddingTop: 4 }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          />
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: SP[3] },

  header:        { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  eyebrow:       { fontSize: SZ.xs, fontFamily: F.mono, color: C.gold, letterSpacing: 2, marginBottom: 2 },
  headline:      { fontSize: SZ.xl, fontWeight: '700', color: C.ink, fontFamily: F.bold, ...textShadow.body },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  draftModeBtn:   { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  draftModeBtnOn: { borderColor: C.goldBorder, backgroundColor: C.goldS },
  draftModeTxt:   { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs, letterSpacing: 1 },
  resetBtn:       { borderWidth: 1, borderColor: 'rgba(200,120,120,0.4)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  resetTxt:       { fontFamily: F.mono, color: '#c87878', fontSize: SZ.xs, letterSpacing: 1 },

  modeToggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 3, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  modeBtn:    { flex: 1, paddingVertical: 7, borderRadius: 9, alignItems: 'center' },
  modeBtnOn:  { backgroundColor: 'rgba(255,255,255,0.15)' },
  modeTxt:    { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs, letterSpacing: 1 },
  modeTxtOn:  { color: C.ink, fontWeight: '700' },

  filtersRow:    { marginBottom: 8 },
  filterChip:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.07)' },
  filterChipTxt: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 0.8 },
  filterSep:     { width: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 2 },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8, gap: 7 },
  searchIcon:  { fontSize: 14 },
  searchInput: { flex: 1, fontFamily: F.outfit, color: C.ink, fontSize: SZ.sm },
  searchClear: { color: C.dim2, fontSize: 14, padding: 2 },

  communityBanner: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  communityTxt:    { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 0.5 },

  playerRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 10 },
  playerRowDrafted: { opacity: 0.5, backgroundColor: 'rgba(255,255,255,0.05)' },

  rankWrap:  { width: 28, alignItems: 'center' },
  rankNum:   { fontFamily: F.bold, color: C.ink, fontSize: SZ.base, lineHeight: 18 },
  trendIcon: { fontSize: 8, marginTop: 1 },

  posBadge:     { position: 'absolute', bottom: -2, right: -2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, minWidth: 22, alignItems: 'center' },
  posBadgeText: { fontFamily: F.mono, fontSize: 7, fontWeight: '700', color: '#1a1a1a' },

  playerInfo: { flex: 1 },
  playerName: { fontFamily: F.bold, color: C.ink, fontSize: SZ.base, ...textShadow.body },
  playerTeam: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, marginTop: 1, letterSpacing: 0.4 },

  actions:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dragHandle:  { padding: 10, justifyContent: 'center', alignItems: 'center' },
  dragIcon:    { fontSize: 20, color: C.dim2, letterSpacing: -1 },

  draftBtn:    { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  draftBtnOn:  { borderColor: C.goldBorder, backgroundColor: C.goldS },
  draftBtnTxt: { fontSize: 16, color: C.dim2 },

  platformOverlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100, justifyContent: 'center', padding: SP[3] },
  platformSheet:     { backgroundColor: '#1e2e2e', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  platformTitle:     { fontFamily: F.mono, color: C.gold, fontSize: SZ.sm, letterSpacing: 2, marginBottom: 8 },
  platformSub:       { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.sm, lineHeight: 18, marginBottom: 20 },
  platformOption:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  platformDot:       { width: 10, height: 10, borderRadius: 5 },
  platformOptLabel:  { fontFamily: F.bold, fontSize: SZ.base, marginBottom: 2 },
  platformOptSub:    { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 0.3 },
});