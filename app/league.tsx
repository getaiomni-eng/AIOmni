import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from "../services/ai";
import { Badge, SectionHeader } from './components/Atoms';
import { Player, PlayerRow } from './components/PlayerRow';
import { C, F, SP, SZ } from './constants/tokens';

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

const TABS = ['ROSTER','STANDINGS','MATCHUP','WAIVERS','ACTIVITY'] as const;
type Tab = typeof TABS[number];

const SLOT_MAP: Record<string,string> = { QB:'QB', RB:'RB', WR:'WR', TE:'TE', FLEX:'FLX', SUPER_FLEX:'SF', K:'K', DEF:'DEF', BN:'BN', IR:'IR' };
const SLEEPER_AVATAR = (id: string) => `https://sleepercdn.com/avatars/thumbs/${id}`;

const PlatformBadge = ({ platform }: { platform: string }) => {
  const isESPN  = platform === 'espn';
  const isYahoo = platform === 'yahoo';
  const color   = isESPN ? '#e03030' : isYahoo ? '#6001D2' : C.gold;
  return (
    <View style={{ width:36, height:36, borderRadius:18, alignItems:'center', justifyContent:'center', backgroundColor:color+'18', borderWidth:1.5, borderColor:color+'44' }}>
      <Text style={{ fontSize: isESPN || isYahoo ? 16 : 12, fontFamily:F.bold, color }}>{isESPN ? 'E' : isYahoo ? 'Y' : 'S'}</Text>
    </View>
  );
};

export default function LeagueScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  const [tab,          setTab]          = useState<Tab>('ROSTER');
  const [loading,      setLoading]      = useState(true);
  const [starters,     setStarters]     = useState<Player[]>([]);
  const [bench,        setBench]        = useState<Player[]>([]);
  const [waivers,      setWaivers]      = useState<Player[]>([]);
  const [standings,    setStandings]    = useState<any[]>([]);
  const [matchups,     setMatchups]     = useState<any[]>([]);
  const [myRec,        setMyRec]        = useState('');
  const [myScore,      setMyScore]      = useState(0);
  const [oppScore,     setOppScore]     = useState(0);
  const [week,         setWeek]         = useState(14);
  const [advicePlayer, setAdvicePlayer] = useState<Player | null>(null);
  const [advice,       setAdvice]       = useState('');
  const [adviceLoading,setAdviceLoading]= useState(false);

  const leagueName = (params.leagueName as string) ?? 'My League';
  const leagueId   = params.leagueId as string;
  const platform   = (params.platform as string) ?? 'sleeper';
  const avatarId   = (params.avatar as string) ?? '';

  const PLATFORM_COLOR = platform === 'espn' ? '#e03030' : platform === 'yahoo' ? '#6001D2' : C.gold;

  useEffect(() => { if (leagueId) loadData(); }, [leagueId]);

  const loadData = async () => {
    setLoading(true);
    let loaded = false;
    try { if (platform === 'sleeper') loaded = await loadSleeper(); } catch (e) { console.log('LeagueScreen error:', e); }
    if (!loaded) {
      const idx = (leagueId ? parseInt(leagueId.toString().slice(-1)) || 0 : 0) % 4;
      const ROSTERS: Player[][] = [
        [
          { slot:'QB',  pos:'QB', name:'Lamar Jackson',       team:'BAL', pts:34.2, proj:29.1 },
          { slot:'RB',  pos:'RB', name:'Saquon Barkley',      team:'PHI', pts:28.6, proj:22.4 },
          { slot:'RB',  pos:'RB', name:"De'Von Achane",       team:'MIA', pts:18.1, proj:14.2, injured:true },
          { slot:'WR',  pos:'WR', name:'CeeDee Lamb',         team:'DAL', pts:22.4, proj:24.0 },
          { slot:'WR',  pos:'WR', name:'A. St. Brown',        team:'DET', pts:19.8, proj:18.5 },
          { slot:'TE',  pos:'TE', name:'Sam LaPorta',         team:'DET', pts:11.2, proj:10.8 },
          { slot:'FLX', pos:'RB', name:'Chase Brown',         team:'CIN', pts:14.6, proj:12.1 },
          { slot:'K',   pos:'K',  name:'Jake Elliott',        team:'PHI', pts:9.0,  proj:7.5  },
        ],
        [
          { slot:'QB',  pos:'QB', name:'Josh Allen',          team:'BUF', pts:38.1, proj:32.0 },
          { slot:'RB',  pos:'RB', name:'Derrick Henry',       team:'BAL', pts:22.3, proj:19.5 },
          { slot:'RB',  pos:'RB', name:'Tony Pollard',        team:'TEN', pts:9.4,  proj:11.2 },
          { slot:'WR',  pos:'WR', name:'Tyreek Hill',         team:'MIA', pts:18.8, proj:21.0 },
          { slot:'WR',  pos:'WR', name:'Stefon Diggs',        team:'BUF', pts:14.2, proj:15.4 },
          { slot:'TE',  pos:'TE', name:'Travis Kelce',        team:'KC',  pts:16.4, proj:14.0 },
          { slot:'FLX', pos:'WR', name:'Keenan Allen',        team:'CHI', pts:8.2,  proj:9.0  },
          { slot:'K',   pos:'K',  name:'Harrison Butker',     team:'KC',  pts:11.0, proj:8.5  },
        ],
        [
          { slot:'QB',  pos:'QB', name:'Patrick Mahomes',     team:'KC',  pts:29.4, proj:27.0 },
          { slot:'RB',  pos:'RB', name:'Christian McCaffrey', team:'SF',  pts:31.2, proj:26.0 },
          { slot:'RB',  pos:'RB', name:'Jahmyr Gibbs',        team:'DET', pts:17.6, proj:16.0 },
          { slot:'WR',  pos:'WR', name:'Justin Jefferson',    team:'MIN', pts:24.8, proj:22.0 },
          { slot:'WR',  pos:'WR', name:'Davante Adams',       team:'LV',  pts:11.2, proj:13.0 },
          { slot:'TE',  pos:'TE', name:'Mark Andrews',        team:'BAL', pts:13.6, proj:12.0 },
          { slot:'FLX', pos:'RB', name:'Rachaad White',       team:'TB',  pts:12.0, proj:10.5 },
          { slot:'K',   pos:'K',  name:'Evan McPherson',      team:'CIN', pts:8.0,  proj:7.0  },
        ],
        [
          { slot:'QB',  pos:'QB', name:'Jalen Hurts',         team:'PHI', pts:26.8, proj:24.0 },
          { slot:'RB',  pos:'RB', name:'Breece Hall',         team:'NYJ', pts:19.4, proj:17.0 },
          { slot:'RB',  pos:'RB', name:'Aaron Jones',         team:'MIN', pts:11.2, proj:12.0 },
          { slot:'WR',  pos:'WR', name:"Ja'Marr Chase",       team:'CIN', pts:27.6, proj:23.0 },
          { slot:'WR',  pos:'WR', name:'Tee Higgins',         team:'CIN', pts:14.0, proj:13.5 },
          { slot:'TE',  pos:'TE', name:'Dalton Kincaid',      team:'BUF', pts:8.4,  proj:9.0  },
          { slot:'FLX', pos:'WR', name:'Rashee Rice',         team:'KC',  pts:16.2, proj:14.0 },
          { slot:'K',   pos:'K',  name:'Tyler Bass',          team:'BUF', pts:9.0,  proj:8.0  },
        ],
      ];
      const BENCHES: Player[][] = [
        [{ slot:'BN', pos:'QB', name:'Trevor Lawrence', team:'JAX', proj:18.0 }, { slot:'BN', pos:'RB', name:'Tony Pollard', team:'TEN', proj:9.4 }, { slot:'BN', pos:'WR', name:'Keenan Allen', team:'CHI', proj:8.2 }],
        [{ slot:'BN', pos:'QB', name:'Geno Smith',      team:'SEA', proj:16.0 }, { slot:'BN', pos:'RB', name:'Dameon Pierce', team:'HOU', proj:8.0 }, { slot:'BN', pos:'WR', name:'D.J. Moore', team:'CHI', proj:10.0 }],
        [{ slot:'BN', pos:'QB', name:'Tua Tagovailoa',  team:'MIA', proj:19.0 }, { slot:'BN', pos:'RB', name:'Miles Sanders', team:'CAR', proj:7.0 },  { slot:'BN', pos:'WR', name:'Curtis Samuel', team:'WAS', proj:8.5 }],
        [{ slot:'BN', pos:'QB', name:'Dak Prescott',    team:'DAL', proj:21.0 }, { slot:'BN', pos:'RB', name:'Zack Moss',     team:'IND', proj:8.0 },  { slot:'BN', pos:'WR', name:'Diontae Johnson', team:'PIT', proj:9.0 }],
      ];
      setStarters(ROSTERS[idx]); setBench(BENCHES[idx]);
      setMyRec(['8–5','6–7','9–4','5–8'][idx]);
      setMyScore([157.4, 102.1, 144.8, 98.3][idx]);
    }
    setLoading(false);
  };

  const loadSleeper = async (): Promise<boolean> => {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return false;
    const user       = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    const leagueInfo = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}`)).json();
    if (!leagueInfo?.settings) return false;
    const currentWeek = leagueInfo.settings?.leg ?? 14;
    setWeek(currentWeek);
    const rosters  = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json();
    if (!Array.isArray(rosters)) return false;
    const myRoster = rosters.find((r: any) => r.owner_id === user.user_id);
    if (!myRoster) return false;
    setMyRec(`${myRoster.settings?.wins ?? 0}–${myRoster.settings?.losses ?? 0}`);
    let playersDb: any = {};
    try {
      const cached = await AsyncStorage.getItem('sleeper_players_cache');
      if (cached) { playersDb = JSON.parse(cached); }
      else { playersDb = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json(); await AsyncStorage.setItem('sleeper_players_cache', JSON.stringify(playersDb)); }
    } catch {}
    const [matchupsData, weekStats, users] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${currentWeek}`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/stats/nfl/regular/2025/${currentWeek}`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
    ]);
    if (!Array.isArray(matchupsData)) return false;
    const myMatchup  = matchupsData.find((m: any) => m.roster_id === myRoster?.roster_id);
    const oppMatchup = myMatchup ? matchupsData.find((m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster?.roster_id) : null;
    setOppScore(oppMatchup?.points ?? 0);
    const playerPoints  = myMatchup?.players_points ?? {};
    const rosterPos     = leagueInfo.roster_positions ?? ['QB','RB','RB','WR','WR','TE','FLEX','K','BN','BN','BN','BN','BN','BN'];
    const starterSlots  = rosterPos.filter((p: string) => p !== 'BN' && p !== 'IR');
    const rawStarters   = myMatchup?.starters ?? myRoster.starters ?? [];
    const allPlayerIds: string[] = myRoster.players ?? [];
    const POS_ORDER: Record<string,number> = { QB:0, RB:1, WR:2, TE:3, K:4, DEF:5 };
    const starterIds = rawStarters.length > 0 ? rawStarters : allPlayerIds.sort((a: string, b: string) => (POS_ORDER[playersDb[a]?.position ?? 'Z'] ?? 9) - (POS_ORDER[playersDb[b]?.position ?? 'Z'] ?? 9)).slice(0, 9);
    const benchIds   = allPlayerIds.filter((id: string) => !starterIds.includes(id));
    const buildPlayer = (id: string, slot: string, isStarter: boolean): Player => {
      const stats = weekStats[id] ?? {};
      const p     = playersDb[id] ?? {};
      const pts   = playerPoints[id] ?? stats.pts_ppr ?? stats.pts_half_ppr ?? 0;
      return { slot, pos: p.position ?? stats.position ?? slot, name: p.full_name ?? (p.first_name ? `${p.first_name} ${p.last_name}` : null) ?? `Player ${id}`, team: p.team ?? stats.team ?? '—', pts: isStarter ? pts : undefined, proj: undefined, injured: p.injury_status === 'Out' || p.injury_status === 'IR' };
    };
    const starterPlayers = starterIds.map((id: string, i: number) => buildPlayer(id, SLOT_MAP[starterSlots[i]] ?? 'FLX', true));
    const benchPlayers   = benchIds.slice(0, 8).map((id: string) => buildPlayer(id, 'BN', false));
    setStarters(starterPlayers); setBench(benchPlayers);
    setMyScore(myMatchup?.points ?? starterPlayers.reduce((s: number, p: Player) => s + (p.pts ?? 0), 0));
    const userMap: any = {};
    (Array.isArray(users) ? users : []).forEach((u: any) => { userMap[u.user_id] = u.display_name; });
    const rosterOwnerMap: any = {};
    rosters.forEach((r: any) => { rosterOwnerMap[r.roster_id] = userMap[r.owner_id] ?? `Team ${r.roster_id}`; });
    const matchupPairs: any[] = [];
    const seen = new Set<number>();
    matchupsData.forEach((m: any) => {
      if (seen.has(m.matchup_id)) return;
      seen.add(m.matchup_id);
      const pair = matchupsData.filter((x: any) => x.matchup_id === m.matchup_id);
      if (pair.length === 2) matchupPairs.push({ home: rosterOwnerMap[pair[0].roster_id], homeScore: pair[0].points ?? 0, homeIsMe: pair[0].roster_id === myRoster.roster_id, away: rosterOwnerMap[pair[1].roster_id], awayScore: pair[1].points ?? 0, awayIsMe: pair[1].roster_id === myRoster.roster_id });
    });
    setMatchups(matchupPairs);
    const ownedIds = new Set(rosters.flatMap((r: any) => r.players ?? []));
    setWaivers(Object.entries(weekStats).filter(([id, s]: any) => !ownedIds.has(id) && (s.pts_ppr ?? 0) > 0).map(([id, s]: any) => ({ slot:'', pos:s.position ?? '?', name:s.player?.full_name ?? id, team:s.team ?? '—', lastWk:s.pts_ppr ?? 0, owned:'0%', trend:'→' } as Player)).sort((a: Player, b: Player) => (b.lastWk ?? 0) - (a.lastWk ?? 0)).slice(0, 30));
    setStandings(rosters.map((r: any) => ({ name:userMap[r.owner_id] ?? `Team ${r.roster_id}`, rec:`${r.settings?.wins ?? 0}–${r.settings?.losses ?? 0}`, pts:(r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100, me:r.owner_id === user.user_id, wins:r.settings?.wins ?? 0 })).sort((a: any, b: any) => b.wins - a.wins || b.pts - a.pts).map((r: any, i: number) => ({ ...r, rank: i+1 })));
    return true;
  };

  const handleAdvice = async (player: Player) => {
    setAdvicePlayer(player); setAdvice(''); setAdviceLoading(true);
    try {
      const text = await askAI(`Fantasy football advice for ${leagueName} (${platform}, WK ${week}).\nPlayer: ${player.name} | ${player.pos} | ${player.team}${player.injured ? ' | INJURED' : ''}\nShould I start this player? Be direct, under 80 words.`);
      setAdvice(text || 'Could not load advice.');
    } catch { setAdvice('Connection error. Try again.'); }
    setAdviceLoading(false);
  };

  const winning = myScore > oppScore;

  const LeagueAvatar = () => {
    if (platform === 'sleeper' && avatarId) return <Image source={{ uri: SLEEPER_AVATAR(avatarId) }} style={styles.avatar} />;
    return <PlatformBadge platform={platform} />;
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>

        {/* Header */}
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>← BACK</Text>
          </TouchableOpacity>
          <LeagueAvatar />
          <View style={{ flex: 1 }}>
            <Text style={styles.lName} numberOfLines={1}>{leagueName}</Text>
            <Text style={styles.lSub}>{platform.toUpperCase()}</Text>
          </View>
          <View style={[styles.platBadge, { backgroundColor: PLATFORM_COLOR + '18', borderColor: PLATFORM_COLOR + '44' }]}>
            <Text style={[styles.platBadgeTxt, { color: PLATFORM_COLOR }]}>{platform.toUpperCase()}</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {TABS.map(t => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && { borderBottomColor: PLATFORM_COLOR, borderBottomWidth: 2 }]} onPress={() => setTab(t)}>
              <Text style={[styles.tabTxt, tab === t && { color: C.blueDeep, fontFamily: F.bold }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
            <ActivityIndicator color={C.blueDeep} size="large" />
            <Text style={{ color:C.dim2, fontFamily:F.mono, fontSize:SZ.sm, marginTop:12, letterSpacing:2 }}>LOADING ROSTER...</Text>
          </View>
        ) : (
          <ScrollView style={{ flex:1 }} contentContainerStyle={{ paddingBottom:100, paddingHorizontal:4 }} showsVerticalScrollIndicator={false}>

            {tab === 'ROSTER' && (
              <View style={{ gap:6 }}>
                <SectionHeader label="STARTERS" barColor={C.gold} right={<Text style={{ fontSize:SZ.sm, fontFamily:F.bold, color:C.blueDeep }}>{starters.length}</Text>} />
                {starters.map((p, i) => <PlayerRow key={i} player={p} showScore showBar onPress={() => handleAdvice(p)} />)}
                <SectionHeader label="BENCH" barColor={C.dim2} right={<Text style={{ fontSize:SZ.sm, fontFamily:F.bold, color:C.dim2 }}>{bench.length}</Text>} />
                {bench.map((p, i) => <PlayerRow key={i} player={p} showScore={false} showBar={false} dimmed onPress={() => handleAdvice(p)} />)}
              </View>
            )}

            {tab === 'STANDINGS' && (
              <View>
                <SectionHeader label="STANDINGS" barColor={C.gold} />
                {standings.map((s, i) => (
                  <View key={i} style={[styles.standCard, s.me && { borderColor: C.mint + '55', borderWidth: 1.5 }]}>
                    <View style={styles.standCardShine} />
                    <View style={styles.standRow}>
                      <View style={{ width:26, alignItems:'center' }}>
                        <Text style={[styles.rankNum, i < 3 && { color:C.gold }]}>{s.rank}</Text>
                      </View>
                      <View style={{ flex:1 }}>
                        <View style={{ flexDirection:'row', alignItems:'center', gap:5 }}>
                          <Text style={[styles.standName, s.me && { color:C.mint }]}>{s.name}</Text>
                          {s.me && <Badge label="YOU" color={C.mint} />}
                        </View>
                        <Text style={styles.standPts}>{s.pts.toFixed(1)} pts</Text>
                      </View>
                      <Text style={styles.standRec}>{s.rec}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {tab === 'MATCHUP' && (
              <View>
                <View style={styles.matchupHeroCard}>
                  <View style={styles.matchupHeroShine} />
                  <Text style={styles.wkLbl}>WEEK {week} · YOUR MATCHUP</Text>
                  <View style={styles.scoreRow}>
                    <View>
                      <Text style={styles.teamLbl}>{leagueName.toUpperCase().slice(0,12)}</Text>
                      <Text style={[styles.scoreNum, { color: winning ? C.mint : '#a83040' }]}>{myScore.toFixed(2)}</Text>
                      <Text style={styles.youOpp}>YOU</Text>
                    </View>
                    <Text style={styles.vsLbl}>VS</Text>
                    <View style={{ alignItems:'flex-end' }}>
                      <Text style={styles.teamLbl}>Opponent</Text>
                      <Text style={[styles.scoreNum, { color: C.dim2 }]}>{oppScore.toFixed(2)}</Text>
                      <Text style={styles.youOpp}>OPP</Text>
                    </View>
                  </View>
                  <View style={[styles.winPill, { backgroundColor: winning ? C.mint+'15' : '#a83040'+'15', borderColor: winning ? C.mint+'40' : '#a83040'+'40' }]}>
                    <Text style={{ color: winning ? C.mint : '#a83040', fontFamily:F.bold, fontSize:SZ.base }}>
                      {winning ? 'WINNING ✓' : 'LOSING ✗'}
                    </Text>
                  </View>
                </View>
                <SectionHeader label="ALL MATCHUPS" barColor={C.gold} />
                {matchups.map((m, i) => (
                  <View key={i} style={[styles.matchupRow, (m.homeIsMe || m.awayIsMe) && { borderColor: PLATFORM_COLOR, borderWidth: 1.5 }]}>
                    <View style={styles.matchupRowShine} />
                    <View style={{ flex:1 }}>
                      <Text style={[styles.matchupName, m.homeIsMe && { color:C.mint }]}>{m.home}</Text>
                      <Text style={styles.matchupScore}>{m.homeScore.toFixed(2)}</Text>
                    </View>
                    <Text style={{ color:C.dim2, fontFamily:F.mono, fontSize:SZ.sm }}>vs</Text>
                    <View style={{ flex:1, alignItems:'flex-end' }}>
                      <Text style={[styles.matchupName, m.awayIsMe && { color:C.mint }]}>{m.away}</Text>
                      <Text style={styles.matchupScore}>{m.awayScore.toFixed(2)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {tab === 'WAIVERS' && (
              <View>
                <SectionHeader label="AVAILABLE" barColor={C.gold} />
                {waivers.map((p, i) => (
                  <View key={i} style={styles.waiverCard}>
                    <View style={styles.waiverCardShine} />
                    <PlayerRow player={p} showScore={false} showOwned showAdd />
                  </View>
                ))}
              </View>
            )}

            {tab === 'ACTIVITY' && (
              <View>
                <SectionHeader label="TRANSACTIONS" barColor={C.gold} />
                <Text style={{ color:C.dim2, fontFamily:F.mono, fontSize:SZ.sm, textAlign:'center', marginTop:24, letterSpacing:1 }}>Transaction history coming soon.</Text>
              </View>
            )}

          </ScrollView>
        )}
      </View>

      {/* Advice Modal */}
      <Modal visible={!!advicePlayer} transparent animationType="slide" onRequestClose={() => setAdvicePlayer(null)}>
        <View style={{ flex:1, backgroundColor:'rgba(26,31,46,0.55)', justifyContent:'flex-end' }}>
          <View style={styles.modalCard}>
            <View style={styles.modalShine} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalName}>{advicePlayer?.name}</Text>
              <TouchableOpacity onPress={() => setAdvicePlayer(null)} style={styles.modalClose}>
                <Text style={{ color:C.blueDeep, fontSize:14, fontFamily:F.bold }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalMeta}>{advicePlayer?.pos} · {advicePlayer?.team}{advicePlayer?.injured ? ' · ⚠️ INJURED' : ''}</Text>
            {adviceLoading ? (
              <View style={{ alignItems:'center', padding:20 }}>
                <ActivityIndicator color={C.blueDeep} size="large" />
                <Text style={{ color:C.blueDeep, fontFamily:F.mono, fontSize:SZ.xs, marginTop:12, letterSpacing:2 }}>ANALYZING...</Text>
              </View>
            ) : (
              <Text style={styles.modalAdvice}>{advice}</Text>
            )}
            <TouchableOpacity style={styles.modalBtn} onPress={() => setAdvicePlayer(null)}>
              <Text style={styles.modalBtnTxt}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flex:1, paddingHorizontal:SP[3] },

  hdr:         { flexDirection:'row', alignItems:'center', gap:10, marginBottom:10, paddingTop:4 },
  back:        { fontSize:SZ.sm, color:C.blueDeep, fontFamily:F.mono, letterSpacing:1 },
  avatar:      { width:36, height:36, borderRadius:18, borderWidth:1.5, borderColor:C.goldBorder },
  lName:       { fontSize:SZ.base, fontFamily:F.bold, color:C.ink },
  lSub:        { fontSize:SZ.xs, fontFamily:F.mono, color:C.dim2 },
  platBadge:   { borderRadius:8, paddingHorizontal:10, paddingVertical:4, borderWidth:1.5 },
  platBadgeTxt:{ fontSize:SZ.xs, fontFamily:F.mono, fontWeight:'700', letterSpacing:1 },

  // Tabs — underline style
  tabRow: { flexDirection:'row', borderBottomWidth:1, borderBottomColor:'rgba(88,131,191,0.15)', marginBottom:8 },
  tab:    { flex:1, paddingVertical:9, alignItems:'center', borderBottomWidth:2, borderBottomColor:'transparent' },
  tabTxt: { fontSize:SZ.xxs+1, fontFamily:F.mono, color:C.dim2, letterSpacing:0.5 },

  // Standings card
  standCard: {
    backgroundColor:SURFACE, borderRadius:12, padding:14, marginBottom:6,
    borderWidth:1.5, borderColor:BORDER, position:'relative', overflow:'hidden',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:2}, shadowOpacity:0.07, shadowRadius:6, elevation:2,
  },
  standCardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  standRow:  { flexDirection:'row', alignItems:'center', gap:9 },
  rankNum:   { fontSize:SZ.lg, fontFamily:F.bold, color:C.dim2 },
  standName: { fontSize:SZ.base, fontFamily:F.bold, color:C.ink },
  standPts:  { fontSize:SZ.sm, fontFamily:F.mono, color:C.dim2, marginTop:1 },
  standRec:  { fontSize:SZ.base, fontFamily:F.bold, color:C.ink },

  // Matchup hero
  matchupHeroCard: {
    backgroundColor:SURFACE, borderRadius:16, padding:20, marginBottom:12,
    borderWidth:1.5, borderColor:BORDER, position:'relative', overflow:'hidden',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:4}, shadowOpacity:0.10, shadowRadius:14, elevation:4,
  },
  matchupHeroShine:{ position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  wkLbl:    { fontSize:SZ.xs, fontFamily:F.mono, color:C.dim2, textAlign:'center', marginBottom:12, letterSpacing:1 },
  scoreRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  teamLbl:  { fontSize:SZ.xs, fontFamily:F.mono, color:C.dim2, marginBottom:2 },
  scoreNum: { fontSize:SZ['3xl']+4, fontFamily:F.bold, letterSpacing:-1.5, lineHeight:40 },
  youOpp:   { fontSize:SZ.xxs, fontFamily:F.mono, color:C.dim2, marginTop:2, letterSpacing:1 },
  vsLbl:    { fontFamily:F.bold, color:C.dim2, fontSize:SZ.lg },
  winPill:  { borderRadius:12, padding:12, alignItems:'center', marginTop:14, borderWidth:1 },

  // All matchups row
  matchupRow: {
    backgroundColor:SURFACE, borderRadius:12, padding:12, marginBottom:6,
    flexDirection:'row', alignItems:'center', gap:8,
    borderWidth:1.5, borderColor:BORDER, position:'relative', overflow:'hidden',
  },
  matchupRowShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  matchupName:  { fontSize:SZ.sm, fontFamily:F.bold, color:C.dim2 },
  matchupScore: { fontSize:SZ.lg, fontFamily:F.bold, color:C.ink, marginTop:2 },

  // Waiver card
  waiverCard: {
    backgroundColor:SURFACE, borderRadius:12, marginBottom:7,
    borderWidth:1.5, borderColor:BORDER, position:'relative', overflow:'hidden',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:4, elevation:2,
  },
  waiverCardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },

  // Advice modal
  modalCard: {
    backgroundColor:'#ffffff', borderTopLeftRadius:24, borderTopRightRadius:24,
    padding:24, minHeight:260, borderTopWidth:1.5, borderLeftWidth:1.5, borderRightWidth:1.5,
    borderColor:BORDER, position:'relative', overflow:'hidden',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:-4}, shadowOpacity:0.12, shadowRadius:20, elevation:12,
  },
  modalShine:  { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  modalHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:4 },
  modalName:   { fontFamily:F.bold, color:C.ink, fontSize:SZ['2xl'] },
  modalClose:  { width:32, height:32, borderRadius:8, borderWidth:1.5, borderColor:BORDER, alignItems:'center', justifyContent:'center', backgroundColor:C.sageS },
  modalMeta:   { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, marginBottom:16 },
  modalAdvice: { fontFamily:F.mono, color:C.ink, fontSize:SZ.md, lineHeight:24, marginBottom:20 },
  modalBtn:    { backgroundColor:C.gold, borderRadius:12, padding:14, alignItems:'center' },
  modalBtnTxt: { fontFamily:F.bold, color:C.ink, fontSize:SZ.base, letterSpacing:2 },
});