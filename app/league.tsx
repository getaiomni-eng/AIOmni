import { useRouter, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, F, SZ, SP } from './constants/tokens';
import { GlassCard, SurfaceCard } from './components/GlassCard';
import { OrbAvatar } from './components/OrbAvatar';
import { PlayerRow, Player } from './components/PlayerRow';
import { Badge, SectionHeader } from './components/Atoms';

const TABS = ['ROSTER','WAIVERS','STANDINGS','ACTIVITY'] as const;
type Tab = typeof TABS[number];
const SLOT_MAP: Record<string,string> = { QB:'QB', RB:'RB', WR:'WR', TE:'TE', FLEX:'FLX', SUPER_FLEX:'SF', K:'K', DEF:'DEF', BN:'BN', IR:'IR' };

export default function LeagueScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('ROSTER');
  const [loading, setLoading] = useState(true);
  const [starters, setStarters] = useState<Player[]>([]);
  const [bench, setBench] = useState<Player[]>([]);
  const [waivers, setWaivers] = useState<Player[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [myRec, setMyRec] = useState('');
  const [myScore, setMyScore] = useState(0);
  const [week, setWeek] = useState(14);
  const [advicePlayer, setAdvicePlayer] = useState<Player | null>(null);
  const [advice, setAdvice] = useState('');
  const [adviceLoading, setAdviceLoading] = useState(false);

  const leagueName = (params.leagueName as string) ?? 'My League';
  const leagueId   = params.leagueId as string;
  const platform   = (params.platform as string) ?? 'sleeper';

  useEffect(() => { if (leagueId) loadData(); }, [leagueId]);

  const loadData = async () => {
    setLoading(true);
    let realDataLoaded = false;
    try {
      if (platform === 'sleeper') {
        realDataLoaded = await loadSleeper();
        console.log('loadSleeper result:', realDataLoaded, 'leagueId:', leagueId);
      }
    }
    catch (e) { console.log('LeagueScreen error:', e); }
    // Only show demo if real data failed
    if (!realDataLoaded) {
      const seed = leagueId ? parseInt(leagueId.toString().slice(-1)) || 0 : 0;
      const ROSTERS: Player[][] = [
        [
          { slot:'QB',  pos:'QB', name:'Lamar Jackson',    team:'BAL', pts:34.2, proj:29.1 },
          { slot:'RB',  pos:'RB', name:'Saquon Barkley',   team:'PHI', pts:28.6, proj:22.4 },
          { slot:'RB',  pos:'RB', name:"De'Von Achane",    team:'MIA', pts:18.1, proj:14.2, injured:true },
          { slot:'WR',  pos:'WR', name:'CeeDee Lamb',      team:'DAL', pts:22.4, proj:24.0 },
          { slot:'WR',  pos:'WR', name:'A. St. Brown',     team:'DET', pts:19.8, proj:18.5 },
          { slot:'TE',  pos:'TE', name:'Sam LaPorta',      team:'DET', pts:11.2, proj:10.8 },
          { slot:'FLX', pos:'RB', name:'Chase Brown',      team:'CIN', pts:14.6, proj:12.1 },
          { slot:'K',   pos:'K',  name:'Jake Elliott',     team:'PHI', pts:9.0,  proj:7.5  },
        ],
        [
          { slot:'QB',  pos:'QB', name:'Josh Allen',       team:'BUF', pts:38.1, proj:32.0 },
          { slot:'RB',  pos:'RB', name:'Derrick Henry',    team:'BAL', pts:22.3, proj:19.5 },
          { slot:'RB',  pos:'RB', name:'Tony Pollard',     team:'TEN', pts:9.4,  proj:11.2 },
          { slot:'WR',  pos:'WR', name:'Tyreek Hill',      team:'MIA', pts:18.8, proj:21.0 },
          { slot:'WR',  pos:'WR', name:'Stefon Diggs',     team:'BUF', pts:14.2, proj:15.4 },
          { slot:'TE',  pos:'TE', name:'Travis Kelce',     team:'KC',  pts:16.4, proj:14.0 },
          { slot:'FLX', pos:'WR', name:'Keenan Allen',     team:'CHI', pts:8.2,  proj:9.0  },
          { slot:'K',   pos:'K',  name:'Harrison Butker',  team:'KC',  pts:11.0, proj:8.5  },
        ],
        [
          { slot:'QB',  pos:'QB', name:'Patrick Mahomes',  team:'KC',  pts:29.4, proj:27.0 },
          { slot:'RB',  pos:'RB', name:'Christian McCaffrey', team:'SF', pts:31.2, proj:26.0 },
          { slot:'RB',  pos:'RB', name:'Jahmyr Gibbs',     team:'DET', pts:17.6, proj:16.0 },
          { slot:'WR',  pos:'WR', name:'Justin Jefferson', team:'MIN', pts:24.8, proj:22.0 },
          { slot:'WR',  pos:'WR', name:'Davante Adams',    team:'LV',  pts:11.2, proj:13.0 },
          { slot:'TE',  pos:'TE', name:'Mark Andrews',     team:'BAL', pts:13.6, proj:12.0 },
          { slot:'FLX', pos:'RB', name:'Rachaad White',    team:'TB',  pts:12.0, proj:10.5 },
          { slot:'K',   pos:'K',  name:'Evan McPherson',   team:'CIN', pts:8.0,  proj:7.0  },
        ],
        [
          { slot:'QB',  pos:'QB', name:'Jalen Hurts',      team:'PHI', pts:26.8, proj:24.0 },
          { slot:'RB',  pos:'RB', name:'Breece Hall',      team:'NYJ', pts:19.4, proj:17.0 },
          { slot:'RB',  pos:'RB', name:'Aaron Jones',      team:'MIN', pts:11.2, proj:12.0 },
          { slot:'WR',  pos:'WR', name:"Ja'Marr Chase",   team:'CIN', pts:27.6, proj:23.0 },
          { slot:'WR',  pos:'WR', name:'Tee Higgins',      team:'CIN', pts:14.0, proj:13.5 },
          { slot:'TE',  pos:'TE', name:'Dalton Kincaid',   team:'BUF', pts:8.4,  proj:9.0  },
          { slot:'FLX', pos:'WR', name:'Rashee Rice',      team:'KC',  pts:16.2, proj:14.0 },
          { slot:'K',   pos:'K',  name:'Tyler Bass',       team:'BUF', pts:9.0,  proj:8.0  },
        ],
      ];
      const BENCHES: Player[][] = [
        [
          { slot:'BN', pos:'QB', name:'Trevor Lawrence', team:'JAX', proj:18.0 },
          { slot:'BN', pos:'RB', name:'Tony Pollard',    team:'TEN', proj:9.4  },
          { slot:'BN', pos:'WR', name:'Keenan Allen',    team:'CHI', proj:8.2  },
        ],
        [
          { slot:'BN', pos:'QB', name:'Geno Smith',      team:'SEA', proj:16.0 },
          { slot:'BN', pos:'RB', name:'Dameon Pierce',   team:'HOU', proj:8.0  },
          { slot:'BN', pos:'WR', name:'D.J. Moore',      team:'CHI', proj:10.0 },
        ],
        [
          { slot:'BN', pos:'QB', name:'Tua Tagovailoa',  team:'MIA', proj:19.0 },
          { slot:'BN', pos:'RB', name:'Miles Sanders',   team:'CAR', proj:7.0  },
          { slot:'BN', pos:'WR', name:'Curtis Samuel',   team:'WAS', proj:8.5  },
        ],
        [
          { slot:'BN', pos:'QB', name:'Dak Prescott',    team:'DAL', proj:21.0 },
          { slot:'BN', pos:'RB', name:'Zack Moss',       team:'IND', proj:8.0  },
          { slot:'BN', pos:'WR', name:'Diontae Johnson', team:'PIT', proj:9.0  },
        ],
      ];
      const idx = seed % 4;
      setStarters(ROSTERS[idx]);
      setBench(BENCHES[idx]);
      const recArr = ['8–5','6–7','9–4','5–8'];
      const scoreArr = [157.4, 102.1, 144.8, 98.3];
      setMyRec(recArr[idx]);
      setMyScore(scoreArr[idx]);
    }
    setLoading(false);
  };

  const loadSleeper = async (): Promise<boolean> => {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return false;
    const user       = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    const leagueInfo = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}`)).json();
    if (!leagueInfo || !leagueInfo.settings) return false;
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
      else {
        playersDb = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
        await AsyncStorage.setItem('sleeper_players_cache', JSON.stringify(playersDb));
      }
    } catch {}

    const [matchups, weekStats, users] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${currentWeek}`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/stats/nfl/regular/2025/${currentWeek}`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
    ]);

    if (!Array.isArray(matchups)) return false;
    const myMatchup    = matchups.find((m: any) => m.roster_id === myRoster?.roster_id);
    const playerPoints = myMatchup?.players_points ?? {};
    const rosterPos    = leagueInfo.roster_positions ?? ['QB','RB','RB','WR','WR','TE','FLEX','K','BN','BN','BN','BN','BN','BN'];
    const starterSlots = rosterPos.filter((p: string) => p !== 'BN' && p !== 'IR');
    // Offseason fallback: if no starters, sort all players by position
    const rawStarters = myMatchup?.starters ?? myRoster.starters ?? [];
    const allPlayerIds: string[] = myRoster.players ?? [];
    const POS_ORDER: Record<string,number> = { QB:0, RB:1, WR:2, TE:3, K:4, DEF:5 };
    const starterIds = rawStarters.length > 0 ? rawStarters
      : allPlayerIds.sort((a: string, b: string) => {
          const pa = (playersDb[a]?.position ?? 'Z');
          const pb = (playersDb[b]?.position ?? 'Z');
          return (POS_ORDER[pa] ?? 9) - (POS_ORDER[pb] ?? 9);
        }).slice(0, 9);
    const benchIds = allPlayerIds.filter((id: string) => !starterIds.includes(id));

    const buildPlayer = (id: string, slot: string, isStarter: boolean): Player => {
      const stats = weekStats[id] ?? {};
      const p     = playersDb[id] ?? {};
      const pts   = playerPoints[id] ?? stats.pts_ppr ?? stats.pts_half_ppr ?? 0;
      const name  = p.full_name ?? (p.first_name ? `${p.first_name} ${p.last_name}` : null) ?? `Player ${id}`;
      return { slot, pos: p.position ?? stats.position ?? slot, name, team: p.team ?? stats.team ?? '—', pts: isStarter ? pts : undefined, proj: undefined, injured: p.injury_status === 'Out' || p.injury_status === 'IR' };
    };

    const starterPlayers = starterIds.map((id: string, i: number) => buildPlayer(id, SLOT_MAP[starterSlots[i]] ?? 'FLX', true));
    const benchPlayers   = benchIds.slice(0, 8).map((id: string) => buildPlayer(id, 'BN', false));
    setStarters(starterPlayers);
    setBench(benchPlayers);
    setMyScore(myMatchup?.points ?? starterPlayers.reduce((s: number, p: Player) => s + (p.pts ?? 0), 0));

    const ownedIds = new Set(rosters.flatMap((r: any) => r.players ?? []));
    setWaivers(Object.entries(weekStats)
      .filter(([id, s]: any) => !ownedIds.has(id) && (s.pts_ppr ?? 0) > 0)
      .map(([id, s]: any) => ({ slot: '', pos: s.position ?? '?', name: s.player?.full_name ?? id, team: s.team ?? '—', lastWk: s.pts_ppr ?? 0, owned: '0%', trend: '→' } as Player))
      .sort((a: Player, b: Player) => (b.lastWk ?? 0) - (a.lastWk ?? 0))
      .slice(0, 30));

    const userMap: any = {};
    users.forEach((u: any) => { userMap[u.user_id] = u.display_name; });
    setStandings(rosters
      .map((r: any) => ({ name: userMap[r.owner_id] ?? `Team ${r.roster_id}`, rec: `${r.settings?.wins ?? 0}–${r.settings?.losses ?? 0}`, pts: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100, me: r.owner_id === user.user_id, wins: r.settings?.wins ?? 0 }))
      .sort((a: any, b: any) => b.wins - a.wins || b.pts - a.pts)
      .map((r: any, i: number) => ({ ...r, rank: i + 1 })));
    return true;
  };

  const handleAdvice = async (player: Player) => {
    setAdvicePlayer(player); setAdvice(''); setAdviceLoading(true);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': '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', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, messages: [{ role: 'user', content: `Fantasy football advice for ${leagueName} (${platform}, WK ${week}).\nPlayer: ${player.name} | ${player.pos} | ${player.team}${player.injured ? ' | INJURED' : ''}\nShould I start this player? Be direct, under 80 words.` }] }),
      });
      const data = await res.json();
      setAdvice(data.content?.[0]?.text ?? 'Could not load advice.');
    } catch { setAdvice('Connection error. Try again.'); }
    setAdviceLoading(false);
  };

  const total = myScore;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
        <View style={styles.hdr}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <OrbAvatar size={24} />
          <View style={{ flex: 1 }}>
            <Text style={styles.lName}>{leagueName}</Text>
            <Text style={styles.lSub}>{platform.toUpperCase()} · WK {week}</Text>
          </View>
          <Text style={styles.record}>{myRec}</Text>
        </View>

        <GlassCard style={styles.mb8} padding={11}>
          <Text style={styles.wkLbl}>WEEK {week} · LIVE</Text>
          <View style={styles.scoreRow}>
            <View>
              <Text style={styles.teamLbl}>{leagueName.toUpperCase().slice(0,10)}</Text>
              <Text style={styles.scoreWin}>{total.toFixed(1)}</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(45,122,94,0.20)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(45,122,94,0.35)' }}>
              <Text style={styles.winBadge}>↑ WINNING</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.teamLbl}>OPP</Text>
              <Text style={styles.scoreLose}>—</Text>
            </View>
          </View>
          <View style={styles.prog}><View style={[styles.progFill, { width: '60%' as any }]} /></View>
        </GlassCard>

        <View style={styles.tabRow}>
          {TABS.map(t => (
            <TouchableOpacity key={t} style={[styles.tab, tab===t && styles.tabOn]} onPress={() => setTab(t)}>
              <Text style={[styles.tabTxt, tab===t && styles.tabTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.sage} size="large" />
            <Text style={{ color: C.dim, fontFamily: F.mono, fontSize: SZ.sm, marginTop: 12 }}>Loading roster...</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            {tab === 'ROSTER' && (
              <View style={{ gap: 6 }}>
                <SurfaceCard radius={16}>
                  <SectionHeader label="STARTERS" barColor={C.sage} right={<Text style={{ fontSize: SZ.sm, fontWeight:'700', color:C.sage, fontFamily:F.bold }}>{total.toFixed(1)}</Text>} />
                  {starters.map((p, i) => <PlayerRow key={i} player={p} showScore showBar onPress={() => handleAdvice(p)} />)}
                </SurfaceCard>
                <SurfaceCard radius={16} style={{ opacity: 0.7 }}>
                  <SectionHeader label="BENCH" barColor={C.dim} />
                  {bench.map((p, i) => <PlayerRow key={i} player={p} showScore={false} showBar={false} dimmed onPress={() => handleAdvice(p)} />)}
                </SurfaceCard>
              </View>
            )}
            {tab === 'WAIVERS' && (
              <View>
                <SectionHeader label="AVAILABLE" barColor={C.mint} />
                {waivers.map((p, i) => (
                  <GlassCard key={i} style={{ marginBottom: 7 }} padding={11}>
                    <PlayerRow player={p} showScore={false} showOwned showAdd lastWk={p.lastWk} />
                  </GlassCard>
                ))}
              </View>
            )}
            {tab === 'STANDINGS' && (
              <View>
                <SectionHeader label="STANDINGS" barColor={C.gold} />
                {standings.map((t, i) => (
                  <SurfaceCard key={i} style={[{ marginBottom: 5 }, t.me && styles.meCard]}>
                    <View style={styles.standRow}>
                      <View style={{ width: 26, alignItems: 'center' }}>
                        {i < 3 ? <OrbAvatar size={22} /> : <Text style={styles.rankNum}>{t.rank}</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection:'row', alignItems:'center', gap:5 }}>
                          <Text style={[styles.standName, t.me && { color: C.sage }]}>{t.name}</Text>
                          {t.me && <Badge label="YOU" color={C.sage} />}
                        </View>
                        <Text style={styles.standPts}>{t.pts.toFixed(1)} pts</Text>
                      </View>
                      <Text style={styles.standRec}>{t.rec}</Text>
                    </View>
                  </SurfaceCard>
                ))}
              </View>
            )}
            {tab === 'ACTIVITY' && (
              <View>
                <SectionHeader label="TRANSACTIONS" barColor={C.gold} />
                <Text style={{ color: C.dim, fontFamily: F.mono, fontSize: SZ.sm, textAlign: 'center', marginTop: 20 }}>Transaction history coming soon.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>

      <Modal visible={!!advicePlayer} transparent animationType="slide" onRequestClose={() => setAdvicePlayer(null)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#111', borderTopLeftRadius:24, borderTopRightRadius:24, padding:24, minHeight:260 }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <Text style={{ color:'#fff', fontSize:18, fontWeight:'700', fontFamily:'Outfit-Bold' }}>{advicePlayer?.name}</Text>
              <TouchableOpacity onPress={() => setAdvicePlayer(null)}><Text style={{ color:'#888', fontSize:20 }}>✕</Text></TouchableOpacity>
            </View>
            <Text style={{ color:'#888', fontFamily:'DMMono-Medium', fontSize:12, marginBottom:16 }}>{advicePlayer?.pos} · {advicePlayer?.team}{advicePlayer?.injured ? ' · ⚠️ INJURED' : ''}</Text>
            {adviceLoading ? (
              <View style={{ alignItems:'center', padding:20 }}>
                <ActivityIndicator color={C.sage} size="large" />
                <Text style={{ color:C.gold, fontFamily:'DMMono-Medium', fontSize:13, marginTop:12 }}>AIOmni analyzing...</Text>
              </View>
            ) : (
              <Text style={{ color:'#ccc', fontSize:15, lineHeight:24, marginBottom:20 }}>{advice}</Text>
            )}
            <TouchableOpacity style={{ backgroundColor:C.sage, borderRadius:12, padding:14, alignItems:'center' }} onPress={() => setAdvicePlayer(null)}>
              <Text style={{ color:'#fff', fontWeight:'700', fontFamily:'Outfit-Bold', fontSize:16 }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  wrap:      { flex: 1, paddingHorizontal: SP[3] },
  hdr:       { flexDirection:'row', alignItems:'center', gap:8, marginBottom:9 },
  back:      { fontSize:18, color:C.gold, fontFamily:F.bold },
  lName:     { fontSize:SZ.base, fontWeight:'700', color:C.ink, fontFamily:F.bold },
  lSub:      { fontSize:SZ.xs, fontFamily:F.mono, color:C.dim },
  record:    { fontSize:SZ.base, fontWeight:'700', color:C.sage, fontFamily:F.bold },
  mb8:       { marginBottom: 8 },
  wkLbl:     { fontSize:SZ.xs, fontFamily:F.mono, color:C.dim, textAlign:'center', marginBottom:8 },
  scoreRow:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  teamLbl:   { fontSize:SZ.xs, fontFamily:F.mono, color:'#ffffff', fontWeight:'700', marginBottom:2 },
  scoreWin:  { fontSize:SZ['3xl']+4, fontWeight:'900', color:'#2d7a5e', letterSpacing:-1.5, fontFamily:F.bold },
  scoreLose: { fontSize:SZ['3xl']+4, fontWeight:'900', color:'#7a1f2e', letterSpacing:-1.5, fontFamily:F.bold },
  winBadge:  { fontSize:SZ.sm, fontWeight:'700', color:C.sage, fontFamily:F.bold },
  prog:      { height:3, backgroundColor:'#7a1f2e', borderRadius:2, overflow:'hidden', marginTop:9 },
  progFill:  { height:3, backgroundColor:C.sage, borderRadius:2 },
  tabRow:    { flexDirection:'row', padding:3, borderRadius:13, backgroundColor:'rgba(255,255,255,0.10)', borderWidth:1, borderColor:'rgba(255,255,255,0.15)', marginBottom:8 },
  tab:       { flex:1, paddingVertical:6, borderRadius:10, alignItems:'center' },
  tabOn:     { backgroundColor:'rgba(255,255,255,0.18)' },
  tabTxt:    { fontSize:SZ.xs, fontFamily:F.mono, color:C.dim },
  tabTxtOn:  { color:C.ink, fontWeight:'700' },
  meCard:    { borderWidth:1, borderColor:'rgba(45,122,94,0.30)' },
  standRow:  { flexDirection:'row', alignItems:'center', gap:9 },
  rankNum:   { fontSize:SZ.lg, fontWeight:'700', color:C.dim, fontFamily:F.bold },
  standName: { fontSize:SZ.base, fontWeight:'600', color:C.ink, fontFamily:F.bold },
  standPts:  { fontSize:SZ.sm, fontFamily:F.mono, color:C.dim, marginTop:1 },
  standRec:  { fontSize:SZ.base, fontWeight:'700', color:C.ink, fontFamily:F.bold },
});
