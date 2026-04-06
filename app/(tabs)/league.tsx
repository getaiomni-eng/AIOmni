import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { askAI } from "../../services/ai";
import { findMyESPNTeam, formatESPNPosition, getESPNAllRosters, getESPNLeague, getESPNMatchups, getESPNStandings, getESPNTransactions, isESPNStarter, loadESPNCredentials } from '../../services/espn';
import { getMyYahooTeam, getValidYahooToken, getYahooAllRosters, getYahooMatchups, getYahooStandings, getYahooTransactions } from '../../services/yahoo';
import { C, F, R, SZ, BEVEL } from '../constants/tokens';

// ── Cream theme card constants ──────────────────────────────────────────────
const SURFACE     = 'rgba(255,255,255,0.88)';
const BORDER      = 'rgba(88,131,191,0.32)';
const DIM_BORDER  = 'rgba(88,131,191,0.14)';
const BEVEL_HI    = 'rgba(255,255,255,0.95)';
const BEVEL_LO    = 'rgba(88,131,191,0.28)';
const INNER_GLOW  = 'rgba(254,226,41,0.10)';

const POS_COLORS: Record<string, string> = {
  QB: '#7b5ea7', RB: '#1e8c42', WR: '#2a7aaa', TE: '#b85a1a',
  K: '#6b7491', DEF: '#7b5ea7', DST: '#7b5ea7', FLEX: '#b87820',
};

const SLOT_LABELS: Record<number, string> = {
  0:'QB', 1:'TQB', 2:'RB', 3:'RB/WR', 4:'WR', 5:'WR/TE',
  6:'TE', 7:'OP', 8:'DT', 9:'DE', 10:'LB', 11:'DL', 12:'CB',
  13:'S', 14:'DB', 15:'DP', 16:'DST', 17:'K', 18:'P', 19:'HC',
  20:'BE', 21:'IR', 22:'', 23:'FLEX', 24:'EDR',
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

type Player = {
  id: string; name: string; position: string; team: string;
  injuryStatus?: string; isStarter: boolean; slotLabel?: string;
};
type TeamStanding  = { rosterId: any; username: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; streak: string; };
type OtherRoster   = { rosterId: any; username: string; players: Player[]; };
type Transaction   = { type: string; adds: string[]; drops: string[]; trader: string; time: number; };

function PlayerAvatar({ player, posColor, active }: { player: Player; posColor: string; active: boolean }) {
  const [err, setErr] = useState(false);
  const uri = `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`;
  if (!err) {
    return (
      <View style={{ width: 44, height: 44, marginHorizontal: 6 }}>
        <Image
          source={{ uri }}
          style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: active ? posColor : BORDER }}
          onError={() => setErr(true)}
        />
        <View style={[styles.posBadge, { backgroundColor: posColor }]}>
          <Text style={styles.posBadgeText}>{player.position}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.diamondWrap}>
      <View style={[styles.diamond, { backgroundColor: active ? posColor : 'rgba(88,131,191,0.10)', borderColor: posColor, borderWidth: active ? 0 : 1 }]}>
        <Text style={[styles.diamondText, { color: active ? '#ffffff' : posColor }]}>{player.position}</Text>
      </View>
    </View>
  );
}

function LeagueAvatar({ avatarId, size = 36 }: { avatarId: string; size?: number }) {
  const [err, setErr] = useState(false);
  const rot   = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (err || !avatarId) {
      Animated.loop(Animated.timing(rot, { toValue: 1, duration: 4000, useNativeDriver: true })).start();
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1,   duration: 1500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 1500, useNativeDriver: true }),
      ])).start();
    }
  }, [err, avatarId]);

  if (avatarId && !err) {
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/avatars/thumbs/${avatarId}` }}
        style={{ width: size, height: size, borderRadius: R.xs, borderWidth: 1.5, borderColor: C.goldBorder }}
        onError={() => setErr(true)}
      />
    );
  }

  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: C.goldS, borderWidth: 1.5, borderColor: C.goldBorder, borderRadius: R.xs }}>
      {[0.85, 0.6, 0.35].map((scale, i) => (
        <View key={i} style={{ position: 'absolute', width: size * scale, height: size * scale, borderRadius: size * scale / 2, borderWidth: 1, borderColor: `rgba(61,106,170,${0.18 - i * 0.04})` }} />
      ))}
      <View style={{ position: 'absolute', width: size * 0.7, height: 1, backgroundColor: C.goldBorder }} />
      <View style={{ position: 'absolute', width: 1, height: size * 0.7, backgroundColor: C.goldBorder }} />
      <Animated.View style={{ position: 'absolute', width: (size / 2) * 0.8, height: 1, backgroundColor: C.gold, left: size / 2, top: size / 2 - 0.5, transformOrigin: 'left center', transform: [{ rotate: spin }], opacity: 0.8 }} />
      <Animated.View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.gold, opacity: pulse }} />
    </View>
  );
}

export default function LeagueScreen() {
  const { leagueId, leagueName, platform, avatar } = useLocalSearchParams();
  const platformStr = (platform as string) || 'sleeper';
  const avatarId    = (avatar as string) || '';
  const router      = useRouter();

  const [starters,           setStarters]           = useState<Player[]>([]);
  const [bench,              setBench]              = useState<Player[]>([]);
  const [leagueSettings,     setLeagueSettings]     = useState<any>(null);
  const [loading,            setLoading]            = useState(true);
  const [selectedPlayer,     setSelectedPlayer]     = useState<Player | null>(null);
  const [advice,             setAdvice]             = useState('');
  const [adviceLoading,      setAdviceLoading]      = useState(false);
  const [modalVisible,       setModalVisible]       = useState(false);
  const [activeTab,          setActiveTab]          = useState<'roster'|'waivers'|'matchup'|'standings'|'activity'>('roster');
  const [waiverPlayers,      setWaiverPlayers]      = useState<Player[]>([]);
  const [waiverLoading,      setWaiverLoading]      = useState(false);
  const [selectedPosition,   setSelectedPosition]   = useState('ALL');
  const [matchup,            setMatchup]            = useState<any>(null);
  const [standings,          setStandings]          = useState<TeamStanding[]>([]);
  const [standingsLoading,   setStandingsLoading]   = useState(false);
  const [otherRosters,       setOtherRosters]       = useState<OtherRoster[]>([]);
  const [selectedRoster,     setSelectedRoster]     = useState<OtherRoster | null>(null);
  const [rosterModalVisible, setRosterModalVisible] = useState(false);
  const [transactions,       setTransactions]       = useState<Transaction[]>([]);
  const [activityLoading,    setActivityLoading]    = useState(false);
  const [playersDb,          setPlayersDb]          = useState<any>({});

  const PLATFORM_COLOR = platformStr === 'espn' ? '#e03030' : platformStr === 'yahoo' ? '#6001D2' : C.gold;

  useEffect(() => {
    if (leagueId) {
      setStandings([]); setOtherRosters([]); setMatchup(null);
      setWaiverPlayers([]); setTransactions([]); setActiveTab('roster');
      fetchRoster();
    }
  }, [leagueId]);

  useEffect(() => {
    if (activeTab === 'waivers'   && waiverPlayers.length === 0) fetchWaivers();
    if (activeTab === 'matchup'   && !matchup)                   fetchMatchup();
    if (activeTab === 'standings' && standings.length === 0)     fetchStandings();
    if (activeTab === 'activity'  && transactions.length === 0)  fetchActivity();
  }, [activeTab]);

  const getPlayersDb = async () => {
    if (Object.keys(playersDb).length > 0) return playersDb;
    const db = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
    setPlayersDb(db);
    return db;
  };

  const fetchSleeperRoster = async () => {
    const username = await AsyncStorage.getItem('sleeper_username'); if (!username) return;
    const user     = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    const settings = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}`)).json();
    setLeagueSettings(settings);
    const rosters  = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json();
    const myRoster = rosters.find((r: any) => r.owner_id === user.user_id); if (!myRoster) return;
    const pDb      = await getPlayersDb();
    const starterIds       = new Set(myRoster.starters || []);
    const rosterPositions: string[] = settings.roster_positions || [];
    const toPlayer = (id: string, isStarter: boolean, idx?: number): Player => {
      const p = pDb[id];
      return { id, name: p ? `${p.first_name} ${p.last_name}` : id, position: p?.position || '?', team: p?.team || 'FA', injuryStatus: p?.injury_status, isStarter, slotLabel: isStarter && idx !== undefined ? (rosterPositions[idx] || '') : 'BN' };
    };
    setStarters((myRoster.starters || []).map((id: string, i: number) => toPlayer(id, true, i)));
    setBench((myRoster.players || []).filter((id: string) => !starterIds.has(id)).map((id: string) => toPlayer(id, false)));
  };

  const fetchESPNRoster = async () => {
    const creds = await loadESPNCredentials(); if (!creds) return;
    const data  = await getESPNLeague(parseInt(leagueId as string), creds);
    setLeagueSettings(data);
    const myTeam = findMyESPNTeam(data, creds.swid); if (!myTeam) return;
    const roster = myTeam.roster?.entries || [];
    const toPlayer = (entry: any, isStarter: boolean): Player => {
      const p = entry.playerPoolEntry?.player;
      return { id: String(p?.id || ''), name: p?.fullName || 'Unknown', position: formatESPNPosition(p?.defaultPositionId) || '?', team: String(p?.proTeamId || 'FA'), injuryStatus: p?.injuryStatus, isStarter, slotLabel: SLOT_LABELS[entry.lineupSlotId] || '' };
    };
    setStarters(roster.filter((e: any) =>  isESPNStarter(e.lineupSlotId)).map((e: any) => toPlayer(e, true)));
    setBench   (roster.filter((e: any) => !isESPNStarter(e.lineupSlotId)).map((e: any) => toPlayer(e, false)));
  };

  const fetchYahooRoster = async () => {
    const token  = await getValidYahooToken(); if (!token) return;
    const result = await getMyYahooTeam(leagueId as string, token); if (!result) return;
    setLeagueSettings({ name: leagueId, team: result.team });
    const toPlayer = (p: any, isStarter: boolean): Player => ({ id: p.player_key, name: p.name?.full || 'Unknown', position: p.display_position || '?', team: p.editorial_team_abbr || 'FA', injuryStatus: p.status, isStarter, slotLabel: p.selected_position?.position || '' });
    setStarters(result.roster.starters.map((p: any) => toPlayer(p, true)));
    setBench   (result.roster.bench.map   ((p: any) => toPlayer(p, false)));
  };

  const fetchRoster = async () => {
    try {
      setLoading(true);
      if      (platformStr === 'espn')  await fetchESPNRoster();
      else if (platformStr === 'yahoo') await fetchYahooRoster();
      else                              await fetchSleeperRoster();
    } catch (err) { console.error('fetchRoster:', err); }
    finally { setLoading(false); }
  };

  const fetchStandings = async () => {
    setStandingsLoading(true);
    try {
      if (platformStr === 'espn') {
        const creds = await loadESPNCredentials(); if (!creds) return;
        setStandings((await getESPNStandings(parseInt(leagueId as string), creds)).map((t: any) => ({ rosterId: t.teamId, username: t.name, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgainst: t.pointsAgainst, streak: '' })));
        setOtherRosters(await getESPNAllRosters(parseInt(leagueId as string), creds));
      } else if (platformStr === 'yahoo') {
        const token = await getValidYahooToken(); if (!token) return;
        setStandings((await getYahooStandings(leagueId as string, token)).map((t: any) => ({ rosterId: t.teamKey, username: t.name, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgainst: t.pointsAgainst, streak: t.streak || '' })));
        setOtherRosters(await getYahooAllRosters(leagueId as string, token));
      } else {
        const [rostersRes, usersRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
        ]);
        const rosters = await rostersRes.json();
        const users   = await usersRes.json();
        const userMap: Record<string, any> = {};
        users.forEach((u: any) => { userMap[u.user_id] = u; });
        setStandings([...rosters].sort((a, b) => (b.settings?.wins || 0) - (a.settings?.wins || 0) || (b.settings?.fpts || 0) - (a.settings?.fpts || 0)).map((r: any) => {
          const u = userMap[r.owner_id];
          return { rosterId: r.roster_id, username: u?.display_name || u?.username || `Team ${r.roster_id}`, wins: r.settings?.wins || 0, losses: r.settings?.losses || 0, ties: r.settings?.ties || 0, pointsFor: parseFloat(r.settings?.fpts || 0), pointsAgainst: parseFloat(r.settings?.fpts_against || 0), streak: r.metadata?.streak || '' };
        }));
        const pDb      = await getPlayersDb();
        const username = await AsyncStorage.getItem('sleeper_username');
        const me       = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
        setOtherRosters(rosters.filter((r: any) => r.owner_id !== me.user_id).map((r: any) => {
          const u = userMap[r.owner_id];
          return { rosterId: r.roster_id, username: u?.display_name || u?.username || `Team ${r.roster_id}`, players: (r.players || []).map((id: string) => { const p = pDb[id]; return { id, name: p ? `${p.first_name} ${p.last_name}` : id, position: p?.position || '?', team: p?.team || 'FA', injuryStatus: p?.injury_status, isStarter: (r.starters || []).includes(id) }; }) };
        }));
      }
    } catch (err) { console.error(err); }
    finally { setStandingsLoading(false); }
  };

  const fetchMatchup = async () => {
    try {
      if (platformStr === 'espn') {
        const creds = await loadESPNCredentials(); if (!creds) return;
        setMatchup(await getESPNMatchups(parseInt(leagueId as string), creds));
      } else if (platformStr === 'yahoo') {
        const token = await getValidYahooToken(); if (!token) return;
        setMatchup(await getYahooMatchups(leagueId as string, token));
      } else {
        const username = await AsyncStorage.getItem('sleeper_username'); if (!username) return;
        const user  = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
        const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
        const week  = state.display_week || 1;
        const [matchupsRes, rostersRes, usersRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
        ]);
        const matchups = await matchupsRes.json();
        const rosters  = await rostersRes.json();
        const users    = await usersRes.json();
        const myRoster   = rosters.find((r: any) => r.owner_id === user.user_id); if (!myRoster) return;
        const myMatchup  = matchups.find((m: any) => m.roster_id === myRoster.roster_id);
        const opponent   = matchups.find((m: any) => m.matchup_id === myMatchup?.matchup_id && m.roster_id !== myRoster.roster_id);
        const getUsername = (rid: number) => { const r = rosters.find((r: any) => r.roster_id === rid); const u = users.find((u: any) => u.user_id === r?.owner_id); return u?.display_name || u?.username || 'Opponent'; };
        const allMatchups: any[] = [];
        const seen = new Set();
        matchups.forEach((m: any) => {
          if (seen.has(m.matchup_id)) return;
          seen.add(m.matchup_id);
          const opp = matchups.find((x: any) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id);
          allMatchups.push({ team1: getUsername(m.roster_id), team1Points: m.points || 0, team2: opp ? getUsername(opp.roster_id) : 'BYE', team2Points: opp?.points || 0, isMyMatchup: m.roster_id === myRoster.roster_id || opp?.roster_id === myRoster.roster_id });
        });
        setMatchup({ myTeam: getUsername(myRoster.roster_id), myPoints: myMatchup?.points || 0, opponentTeam: opponent ? getUsername(opponent.roster_id) : 'TBD', opponentPoints: opponent?.points || 0, week, allMatchups });
      }
    } catch (err) { console.error(err); }
  };

  const fetchActivity = async () => {
    setActivityLoading(true);
    try {
      if (platformStr === 'espn') {
        const creds = await loadESPNCredentials(); if (!creds) return;
        setTransactions(await getESPNTransactions(parseInt(leagueId as string), creds));
      } else if (platformStr === 'yahoo') {
        const token = await getValidYahooToken(); if (!token) return;
        setTransactions(await getYahooTransactions(leagueId as string, token));
      } else {
        const pDb   = await getPlayersDb();
        const users = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)).json();
        const userMap: Record<string, string> = {};
        users.forEach((u: any) => { userMap[u.user_id] = u.display_name || u.username || 'Unknown'; });
        const allTx: Transaction[] = [];
        for (let round = 1; round <= 5; round++) {
          try {
            const txData = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${round}`)).json();
            if (!Array.isArray(txData)) continue;
            txData.forEach((tx: any) => {
              if (['free_agent','waiver','trade'].includes(tx.type)) {
                allTx.push({ type: tx.type, adds: Object.keys(tx.adds||{}).map(id => { const p = pDb[id]; return p ? `${p.first_name} ${p.last_name}` : id; }), drops: Object.keys(tx.drops||{}).map(id => { const p = pDb[id]; return p ? `${p.first_name} ${p.last_name}` : id; }), trader: userMap[tx.creator] || 'Unknown', time: tx.created });
              }
            });
          } catch {}
        }
        setTransactions(allTx.sort((a, b) => b.time - a.time).slice(0, 50));
      }
    } catch (err) { console.error(err); }
    finally { setActivityLoading(false); }
  };

  const fetchWaivers = async () => {
    setWaiverLoading(true);
    try {
      if (platformStr === 'sleeper') {
        const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json();
        const taken   = new Set(rosters.flatMap((r: any) => r.players || []));
        const pDb     = await getPlayersDb();
        setWaiverPlayers(
          Object.values(pDb)
            .filter((p: any) => ['QB','RB','WR','TE','K'].includes(p.position) && p.team && !taken.has(p.player_id))
            .slice(0, 150)
            .map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false }))
        );
      } else if (platformStr === 'espn') {
        const creds = await loadESPNCredentials(); if (!creds) return;
        const data  = await getESPNLeague(parseInt(leagueId as string), creds);
        const filter = JSON.stringify({ players: { filterStatus: { value: ['FREEAGENT','WAIVERS'] }, filterSlotIds: { value: [0,2,4,6,16,17,23] }, limit: 100 } });
        const res = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/${leagueId}?view=kona_player_info&scoringPeriodId=${data.scoringPeriodId||1}`, { headers: { 'Content-Type': 'application/json', 'X-Fantasy-Filter': filter, Cookie: `espn_s2=${creds.espnS2}; SWID=${creds.swid}` } });
        setWaiverPlayers(((await res.json()).players || []).map((p: any) => { const pl = p.playerPoolEntry?.player; return { id: String(pl?.id || ''), name: pl?.fullName || 'Unknown', position: formatESPNPosition(pl?.defaultPositionId), team: String(pl?.proTeamId || 'FA'), injuryStatus: pl?.injuryStatus, isStarter: false }; }));
      } else if (platformStr === 'yahoo') {
        const token = await getValidYahooToken(); if (!token) return;
        const data  = await (await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueId}/players;status=FA;sort=OR;count=50?format=json`, { headers: { Authorization: `Bearer ${token}` } })).json();
        setWaiverPlayers(Object.values(data?.fantasy_content?.league?.[1]?.players || {}).filter((v: any) => typeof v === 'object' && v.player).map((v: any) => { const p = v.player[0]; return { id: p.player_key, name: p.name?.full || 'Unknown', position: p.display_position || '?', team: p.editorial_team_abbr || 'FA', injuryStatus: p.status, isStarter: false }; }));
      }
    } catch (err) { console.error(err); }
    finally { setWaiverLoading(false); }
  };

  const handleAdvice = async (player: Player, isWaiver = false) => {
    setSelectedPlayer(player);
    setAdvice('');
    setModalVisible(true);
    setAdviceLoading(true);
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 15000);
    try {
      const isPPR = leagueSettings?.scoring_settings?.rec > 0;
      const text  = await askAI(`You are AIOmni, expert fantasy football analyst.\nLeague: ${leagueName} (${platformStr.toUpperCase()}) | Scoring: ${isPPR ? 'PPR' : 'Standard'}\nPlayer: ${player.name} | ${player.position} | ${player.team}${player.injuryStatus ? ` | Injury: ${player.injuryStatus}` : ''}\n${isWaiver ? 'Should I add off waivers?' : 'Should I start or sit?'} Be sharp, direct, under 80 words. No intros.`);
      clearTimeout(timeout);
      setAdvice(text);
    } catch (e: any) {
      clearTimeout(timeout);
      setAdvice(e?.name === 'AbortError' ? 'Request timed out. Check your connection and try again.' : 'Could not load advice. Tap retry or try again in a moment.');
    } finally { setAdviceLoading(false); }
  };

  const filteredWaivers = waiverPlayers.filter(p => selectedPosition === 'ALL' || p.position === selectedPosition);

  const renderPlayer = (player: Player, isWaiver = false, index = 0) => {
    const posColor  = POS_COLORS[player.position] || C.dim2;
    const isInjured = !!player.injuryStatus;
    const slotLabel = player.slotLabel || player.position;
    const active    = player.isStarter || isWaiver;
    return (
      <TouchableOpacity
        key={`${player.id}-${index}`}
        style={[styles.playerCard, !active && styles.benchCard]}
        onPress={() => handleAdvice(player, isWaiver)}
        activeOpacity={0.8}
      >
        {/* bevel catchlight */}
        <View style={styles.playerCardShine} />
        <View style={[styles.playerAccentBar, { backgroundColor: active ? posColor : DIM_BORDER }]} />
        <Text style={styles.slotLabel}>{slotLabel}</Text>
        <PlayerAvatar player={player} posColor={posColor} active={active} />
        <View style={styles.playerInfoCol}>
          <Text style={[styles.playerName, !active && { color: C.dim2 }]} numberOfLines={1}>{player.name}</Text>
          <View style={styles.playerMeta}>
            <Text style={styles.playerTeam}>{player.team}</Text>
            {isInjured && (<><Text style={styles.metaDot}>·</Text><Text style={styles.injuryText}>{player.injuryStatus}</Text></>)}
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.random() * 60 + 20}%`, backgroundColor: active ? posColor : DIM_BORDER }]} />
          </View>
        </View>
        <View style={styles.aiTag}>
          <Text style={styles.aiTagText}>AI</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const TAB_DATA = [
    { key: 'roster',    label: 'ROSTER'    },
    { key: 'standings', label: 'STANDINGS' },
    { key: 'matchup',   label: 'MATCHUP'   },
    { key: 'waivers',   label: 'WAIVERS'   },
    { key: 'activity',  label: 'ACTIVITY'  },
  ] as const;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <LeagueAvatar avatarId={avatarId} size={36} />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.leagueName} numberOfLines={1}>{leagueName || 'MY LEAGUE'}</Text>
            <Text style={styles.leagueSub}>{platformStr.toUpperCase()}</Text>
          </View>
        </View>
        <View style={[styles.platformBadge, { backgroundColor: PLATFORM_COLOR }]}>
          <Text style={[styles.platformBadgeText, { color: platformStr === 'sleeper' ? '#1a1a1a' : '#fff' }]}>
            {platformStr.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* ── Tabs ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {TAB_DATA.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && { borderBottomColor: PLATFORM_COLOR, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && { color: C.blueDeep }]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.blueDeep} size="large" />
          <Text style={styles.loadingText}>LOADING ROSTER</Text>
        </View>

      ) : activeTab === 'roster' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionLabel}>STARTERS</Text>
            <View style={styles.sectionCount}><Text style={styles.sectionCountText}>{starters.length}</Text></View>
          </View>
          {starters.map((p, i) => renderPlayer(p, false, i))}
          <View style={[styles.sectionHeader, { marginTop: 20 }]}>
            <View style={[styles.sectionAccent, { backgroundColor: C.dim2 }]} />
            <Text style={[styles.sectionLabel, { color: C.dim2 }]}>BENCH</Text>
            <View style={[styles.sectionCount, { backgroundColor: 'rgba(26,31,46,0.06)' }]}>
              <Text style={[styles.sectionCountText, { color: C.dim2 }]}>{bench.length}</Text>
            </View>
          </View>
          {bench.map((p, i) => renderPlayer(p, false, i))}
          <View style={{ height: 40 }} />
        </ScrollView>

      ) : activeTab === 'standings' ? (
        standingsLoading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={C.blueDeep} /><Text style={styles.loadingText}>LOADING</Text></View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>STANDINGS · TAP TO SPY ROSTER</Text>
            {standings.map((team, i) => (
              <TouchableOpacity key={String(team.rosterId)} style={styles.standingRow} onPress={() => { const r = otherRosters.find(r => r.rosterId === team.rosterId); if (r) { setSelectedRoster(r); setRosterModalVisible(true); } }}>
                <Text style={[styles.standingRank, i < 3 && { color: C.gold, textShadowColor: 'rgba(61,106,170,0.3)', textShadowOffset:{width:0,height:1}, textShadowRadius:4 }]}>{i + 1}</Text>
                <View style={styles.standingInfo}>
                  <Text style={styles.standingName}>{team.username}</Text>
                  <Text style={styles.standingPts}>{team.pointsFor.toFixed(1)} PF · {team.pointsAgainst.toFixed(1)} PA</Text>
                </View>
                <View style={styles.standingRecord}>
                  <Text style={styles.standingRecordText}>{team.wins}–{team.losses}{team.ties > 0 ? `–${team.ties}` : ''}</Text>
                  {team.streak ? <Text style={[styles.standingStreak, { color: team.streak.startsWith('W') ? C.mint : '#a83040' }]}>{team.streak}</Text> : null}
                </View>
                <Text style={styles.standingArrow}>›</Text>
              </TouchableOpacity>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )

      ) : activeTab === 'matchup' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
          {matchup ? (
            <>
              <View style={styles.matchupCard}>
                <Text style={styles.matchupWeekLabel}>WEEK {matchup.week} · YOUR MATCHUP</Text>
                <View style={styles.matchupScoreRow}>
                  <View style={styles.matchupTeamCol}>
                    <Text style={styles.matchupTeamName} numberOfLines={1}>{matchup.myTeam}</Text>
                    <Text style={styles.matchupScore}>{matchup.myPoints?.toFixed(2)}</Text>
                    <Text style={styles.matchupLabel}>YOU</Text>
                  </View>
                  <Text style={styles.matchupVs}>VS</Text>
                  <View style={[styles.matchupTeamCol, { alignItems: 'flex-end' }]}>
                    <Text style={styles.matchupTeamName} numberOfLines={1}>{matchup.opponentTeam}</Text>
                    <Text style={styles.matchupScore}>{matchup.opponentPoints?.toFixed(2)}</Text>
                    <Text style={styles.matchupLabel}>OPP</Text>
                  </View>
                </View>
                <View style={[styles.matchupStatus, {
                  borderColor: matchup.myPoints >= matchup.opponentPoints ? 'rgba(30,140,66,0.3)' : 'rgba(168,48,64,0.3)',
                  backgroundColor: matchup.myPoints >= matchup.opponentPoints ? 'rgba(30,140,66,0.08)' : 'rgba(168,48,64,0.08)',
                }]}>
                  <Text style={[styles.matchupStatusText, { color: matchup.myPoints >= matchup.opponentPoints ? C.mint : '#a83040' }]}>
                    {matchup.myPoints > matchup.opponentPoints ? 'WINNING ✓' : matchup.myPoints < matchup.opponentPoints ? 'LOSING ✗' : 'TIED'}
                  </Text>
                </View>
              </View>
              {matchup.allMatchups?.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 24 }]}>ALL MATCHUPS</Text>
                  {matchup.allMatchups.map((m: any, i: number) => (
                    <View key={i} style={[styles.allMatchupRow, m.isMyMatchup && { borderColor: PLATFORM_COLOR, borderWidth: 1.5 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.allMatchupTeam} numberOfLines={1}>{m.team1}</Text>
                        <Text style={styles.allMatchupScore}>{m.team1Points?.toFixed(2)}</Text>
                      </View>
                      <Text style={styles.allMatchupVs}>vs</Text>
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={styles.allMatchupTeam} numberOfLines={1}>{m.team2}</Text>
                        <Text style={styles.allMatchupScore}>{m.team2Points?.toFixed(2)}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
              <View style={{ height: 40 }} />
            </>
          ) : (
            <View style={styles.loadingBox}><ActivityIndicator color={C.blueDeep} /><Text style={styles.loadingText}>LOADING</Text></View>
          )}
        </ScrollView>

      ) : activeTab === 'waivers' ? (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: 20 }}>
            {POSITIONS.map(pos => (
              <TouchableOpacity key={pos} style={[styles.filterBtn, selectedPosition === pos && { borderColor: C.blueDeep, backgroundColor: C.sageS }]} onPress={() => setSelectedPosition(pos)}>
                <Text style={[styles.filterText, selectedPosition === pos && { color: C.blueDeep }]}>{pos}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {waiverLoading ? (
            <View style={styles.loadingBox}><ActivityIndicator color={C.blueDeep} /><Text style={styles.loadingText}>LOADING</Text></View>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
              {filteredWaivers.map((p, i) => renderPlayer(p, true, i))}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>

      ) : activeTab === 'activity' ? (
        activityLoading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={C.blueDeep} /><Text style={styles.loadingText}>LOADING</Text></View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>RECENT TRANSACTIONS</Text>
            {transactions.length === 0 && <Text style={styles.emptyText}>No recent transactions found.</Text>}
            {transactions.map((tx, i) => (
              <View key={i} style={styles.txCard}>
                <View style={styles.txCardShine} />
                <View style={[styles.txAccent, { backgroundColor: tx.type === 'trade' ? C.gold : tx.type === 'waiver' ? C.mint : C.sage }]} />
                <View style={styles.txHeader}>
                  <Text style={[styles.txType, { color: tx.type === 'trade' ? C.blueDeep : C.blueDeep }]}>{tx.type === 'trade' ? '⇄ TRADE' : tx.type === 'waiver' ? '◎ WAIVER' : '+ FREE AGENT'}</Text>
                  <Text style={styles.txTrader}>{tx.trader}</Text>
                </View>
                {tx.adds.length  > 0 && <Text style={styles.txAdds}>+ {tx.adds.join(', ')}</Text>}
                {tx.drops.length > 0 && <Text style={styles.txDrops}>– {tx.drops.join(', ')}</Text>}
                <Text style={styles.txTime}>{new Date(tx.time).toLocaleDateString()}</Text>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )
      ) : null}

      {/* ── Advice Modal ── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalCardShine} />
            <View style={[styles.modalTopAccent, { backgroundColor: POS_COLORS[selectedPlayer?.position || ''] || C.gold }]} />
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalPlayerName}>{selectedPlayer?.name}</Text>
                <View style={[styles.modalPosBadge, { backgroundColor: POS_COLORS[selectedPlayer?.position || ''] || C.sageS }]}>
                  <Text style={styles.modalPosBadgeText}>{selectedPlayer?.position} · {selectedPlayer?.team}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {adviceLoading ? (
              <View style={styles.loadingAdvice}>
                <ActivityIndicator color={C.blueDeep} size="large" />
                <Text style={styles.loadingAdviceText}>ANALYZING...</Text>
              </View>
            ) : (
              <>
                <Text style={styles.adviceText}>{advice}</Text>
                {(advice.includes('try again') || advice.includes('timed out')) && (
                  <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: C.sageS, borderWidth:1, borderColor: BORDER, marginBottom: 8 }]} onPress={() => selectedPlayer && handleAdvice(selectedPlayer)}>
                    <Text style={[styles.gotItText, { color: C.blueDeep }]}>RETRY</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: C.gold }]} onPress={() => setModalVisible(false)}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Other Roster Modal ── */}
      <Modal visible={rosterModalVisible} transparent animationType="slide" onRequestClose={() => setRosterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <View style={styles.modalCardShine} />
            <View style={[styles.modalTopAccent, { backgroundColor: PLATFORM_COLOR }]} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalPlayerName}>{selectedRoster?.username}</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setRosterModalVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={styles.sectionLabel}>STARTERS</Text>
              {selectedRoster?.players.filter(p =>  p.isStarter).map((p, i) => renderPlayer(p, false, i))}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>BENCH</Text>
              {selectedRoster?.players.filter(p => !p.isStarter).map((p, i) => renderPlayer(p, false, i))}
              <View style={{ height: 20 }} />
            </ScrollView>
            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: PLATFORM_COLOR }]} onPress={() => setRosterModalVisible(false)}>
              <Text style={[styles.gotItText, { color: platformStr === 'sleeper' ? '#1a1a1a' : '#fff' }]}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header:            { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: DIM_BORDER, gap: 10, backgroundColor: 'rgba(255,255,237,0.85)' },
  backBtn:           { paddingRight: 4 },
  backText:          { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.xs, letterSpacing: 1.5 },
  headerCenter:      { flex: 1, flexDirection: 'row', alignItems: 'center' },
  leagueName:        { fontFamily: F.bold, color: C.ink, fontSize: SZ.lg, maxWidth: 180 },
  leagueSub:         { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 1.5, marginTop: 1 },
  platformBadge:     { borderRadius: R.xs, paddingHorizontal: 8, paddingVertical: 4 },
  platformBadgeText: { fontFamily: F.mono, fontSize: SZ.xs - 1, letterSpacing: 1.5, fontWeight: '700' },

  tabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: DIM_BORDER, backgroundColor: 'rgba(255,255,237,0.9)' },
  tabRow:    { paddingHorizontal: 8, flexDirection: 'row', gap: 8 },
  tabBtn:    { paddingVertical: 10, paddingHorizontal: 14, borderRadius: R.sm, borderWidth: 1.5, borderColor: C.glassBorder, borderTopColor: C.glassShine, borderLeftColor: C.surfShine, borderBottomColor: C.sageBorder, borderRightColor: C.sageBorder, backgroundColor: C.glass },
  tabText:   { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 1.5 },

  loadingBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.xs, letterSpacing: 3, opacity: 0.7 },

  scroll:    { flex: 1 },
  scrollPad: { paddingHorizontal: 16, paddingTop: 4 },

  sectionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 8 },
  sectionAccent:    { width: 3, height: 18, backgroundColor: C.gold, borderRadius: 2 },
  sectionLabel:     { fontFamily: F.bold, color: C.blueDeep, fontSize: SZ.base, letterSpacing: 2, flex: 1 },
  sectionCount:     { backgroundColor: C.goldS, paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.xs, borderWidth: 1, borderColor: C.goldBorder },
  sectionCountText: { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.xs, letterSpacing: 1 },
  emptyText:        { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.md },

  // Player card — cream glass with bevel
  playerCard: {
    ...BEVEL.card,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: R.sm, marginBottom: 6,
    overflow: 'hidden', minHeight: 68,
  },
  playerCardShine: { ...BEVEL.shine, height: 1 },
  benchCard:       { opacity: 0.55 },
  playerAccentBar: { width: 3, alignSelf: 'stretch' },
  slotLabel:       { fontFamily: F.mono, color: C.dim2, fontSize: 8, letterSpacing: 1, width: 26, textAlign: 'center' },

  posBadge:     { position: 'absolute', bottom: -2, right: -2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, minWidth: 22, alignItems: 'center' },
  posBadgeText: { fontFamily: F.mono, fontSize: 7, fontWeight: '700', color: '#ffffff', letterSpacing: 0.3 },

  diamondWrap: { width: 56, alignItems: 'center', justifyContent: 'center' },
  diamond:     { width: 30, height: 30, borderRadius: 4, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
  diamondText: { fontFamily: F.mono, fontSize: 7, fontWeight: '700', transform: [{ rotate: '-45deg' }], letterSpacing: 0.3 },

  playerInfoCol: { flex: 1, paddingVertical: 10, paddingRight: 8 },
  playerName:    { fontFamily: F.bold, color: C.ink, fontSize: SZ.base, letterSpacing: 0.3, lineHeight: 20 },
  playerMeta:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  playerTeam:    { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 0.5 },
  metaDot:       { color: C.dim2, fontSize: SZ.xs },
  injuryText:    { fontFamily: F.mono, color: C.amber, fontSize: SZ.xs - 1, letterSpacing: 0.5 },
  progressTrack: { height: 3, backgroundColor: DIM_BORDER, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  progressFill:  { height: 3, borderRadius: 2 },
  aiTag:         { width: 28, height: 28, borderRadius: R.xs, borderWidth: 1, borderColor: C.goldBorder, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: C.goldS },
  aiTagText:     { fontFamily: F.mono, color: C.blueDeep, fontSize: 8, letterSpacing: 1 },

  // Standings
  standingRow: {
    ...BEVEL.card,
    backgroundColor: SURFACE,
    borderRadius: R.sm, padding: 14, marginBottom: 6,
    flexDirection: 'row', alignItems: 'center',
  },
  standingRank:       { fontFamily: F.bold, color: C.dim2, fontSize: SZ['2xl'], width: 32 },
  standingInfo:       { flex: 1 },
  standingName:       { fontFamily: F.bold, color: C.ink, fontSize: SZ.md, marginBottom: 2 },
  standingPts:        { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 0.5 },
  standingRecord:     { alignItems: 'flex-end', marginRight: 8 },
  standingRecordText: { fontFamily: F.bold, color: C.ink, fontSize: SZ.lg },
  standingStreak:     { fontFamily: F.mono, fontSize: SZ.xs - 1, fontWeight: '700', marginTop: 2 },
  standingArrow:      { color: C.dim2, fontSize: SZ.xl },

  // Matchup
  matchupCard: {
    ...BEVEL.card,
    backgroundColor: SURFACE,
    borderRadius: R.sm, padding: 20, marginTop: 16,
  },
  matchupWeekLabel:  { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, letterSpacing: 2, marginBottom: 16, textAlign: 'center' },
  matchupScoreRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchupTeamCol:    { flex: 1 },
  matchupTeamName:   { fontFamily: F.outfit, color: C.dim, fontSize: SZ.sm, marginBottom: 4 },
  // ── Scores: gold fill + blue stroke — same treatment as mockup ──
  matchupScore: {
    fontFamily: F.mono, fontWeight: '700', fontSize: SZ['5xl'],
    color: '#fee229',
    // RN text stroke via text shadow layering (best available on iOS)
    textShadowColor: '#3d6aaa',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1,
    letterSpacing: -1.5, lineHeight: 44,
  },
  matchupLabel:    { fontFamily: F.mono, color: C.dim2, fontSize: 8, letterSpacing: 2, marginTop: 2 },
  matchupVs:       { fontFamily: F.bold, color: C.dim2, fontSize: SZ.lg, marginHorizontal: 10 },
  matchupStatus:   { borderRadius: R.xs, padding: 10, alignItems: 'center', marginTop: 16, borderWidth: 1 },
  matchupStatusText: { fontFamily: F.bold, fontSize: SZ.base, letterSpacing: 2 },
  allMatchupRow:   {
    ...BEVEL.card,
    backgroundColor: SURFACE, borderRadius: R.xs, padding: 12, marginBottom: 6,
    flexDirection: 'row', alignItems: 'center',
  },
  allMatchupTeam:  { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.md },
  allMatchupScore: { fontFamily: F.bold, color: C.ink, fontSize: SZ.lg, marginTop: 2 },
  allMatchupVs:    { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs, marginHorizontal: 8 },

  // Waivers
  filterRow: { flexGrow: 0, marginVertical: 10 },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: R.xs,
    borderWidth: 1.5, borderColor: BORDER, marginRight: 8,
    backgroundColor: SURFACE,
  },
  filterText: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs, letterSpacing: 1 },

  // Activity
  txCard: {
    ...BEVEL.card,
    backgroundColor: SURFACE, borderRadius: R.sm, padding: 14, marginBottom: 6,
    overflow: 'hidden',
  },
  txCardShine: { ...BEVEL.shine, height: 1 },
  txAccent:    { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  txHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  txType:      { fontFamily: F.mono, fontSize: SZ.xs, letterSpacing: 1 },
  txTrader:    { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.sm },
  txAdds:      { fontFamily: F.bold, color: C.mint, fontSize: SZ.md, marginBottom: 2 },
  txDrops:     { fontFamily: F.bold, color: '#a83040', fontSize: SZ.md, marginBottom: 4 },
  txTime:      { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, marginTop: 4 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(26,31,46,0.55)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: 24, minHeight: 280,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderRightWidth: 1.5,
    borderColor: BORDER, overflow: 'hidden',
    shadowColor: '#3d6aaa', shadowOffset:{width:0,height:-4}, shadowOpacity:0.12, shadowRadius:20, elevation:12,
  },
  modalCardShine:    { ...BEVEL.shine, zIndex: 6 },
  modalTopAccent:    { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  modalHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalPlayerName:   { fontFamily: F.bold, color: C.ink, fontSize: SZ['2xl'], letterSpacing: 0.5 },
  modalPosBadge:     { paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.xs, alignSelf: 'flex-start', marginTop: 6 },
  modalPosBadgeText: { fontFamily: F.mono, fontSize: SZ.xs - 1, color: '#ffffff', letterSpacing: 1 },
  closeBtn:          { width: 32, height: 32, borderRadius: R.xs, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sageS },
  closeBtnText:      { color: C.blueDeep, fontSize: 14, fontFamily: F.bold },
  loadingAdvice:     { alignItems: 'center', padding: 24, gap: 14 },
  loadingAdviceText: { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.xs, letterSpacing: 3, opacity: 0.7 },
  adviceText:        { fontFamily: F.outfit, color: C.ink, fontSize: SZ.md, lineHeight: 24, marginBottom: 20 },
  gotItBtn:          { borderRadius: R.sm, padding: 16, alignItems: 'center', marginTop: 8 },
  gotItText:         { fontFamily: F.bold, fontSize: SZ.lg, letterSpacing: 2, color: '#1a1f2e' },
});