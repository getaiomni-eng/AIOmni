import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadESPNCredentials, getESPNLeague, findMyESPNTeam, isESPNStarter, formatESPNPosition, getESPNStandings, getESPNMatchups, getESPNTransactions, getESPNAllRosters } from '../../services/espn';
import { getValidYahooToken, getMyYahooTeam, getYahooStandings, getYahooMatchups, getYahooTransactions, getYahooAllRosters } from '../../services/yahoo';

// ── Colors ───────────────────────────────────────────────────────────────────
const BG = '#080d08';
const LIME = '#D4FF00';
const SURFACE = 'rgba(15,22,15,0.95)';
const BORDER = 'rgba(212,255,0,0.1)';

const POS_COLORS: Record<string, string> = {
  QB: '#cc77ff', RB: '#00ffaa', WR: '#33ddff', TE: '#D4FF00',
  K: '#ff88bb', DEF: '#aabbcc', DST: '#aabbcc', FLEX: '#D4FF00',
};
const SLOT_LABELS: Record<number, string> = {
  0:'QB', 1:'TQB', 2:'RB', 3:'RB/WR', 4:'WR', 5:'WR/TE',
  6:'TE', 7:'OP', 8:'DT', 9:'DE', 10:'LB', 11:'DL', 12:'CB',
  13:'S', 14:'DB', 15:'DP', 16:'DST', 17:'K', 18:'P', 19:'HC',
  20:'BE', 21:'IR', 22:'', 23:'FLEX', 24:'EDR',
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];
const API_KEY = 'YOUR_CLAUDE_API_KEY';
const TABS = ['roster', 'standings', 'matchup', 'waivers', 'activity'] as const;

type Player = { id: string; name: string; position: string; team: string; injuryStatus?: string; isStarter: boolean; slotLabel?: string; };
type TeamStanding = { rosterId: any; username: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; streak: string; };
type OtherRoster = { rosterId: any; username: string; players: Player[]; };
type Transaction = { type: string; adds: string[]; drops: string[]; trader: string; time: number; };

// ── Radar Logo Component ──────────────────────────────────────────────────────
function RadarLogo({ size = 48 }: { size?: number }) {
  const rot = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(rot, { toValue: 1, duration: 4000, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.6, duration: 1500, useNativeDriver: true }),
    ])).start();
  }, []);
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const r = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(212,255,0,0.06)', borderWidth: 1, borderColor: 'rgba(212,255,0,0.2)', borderRadius: 4 }}>
      {/* Rings */}
      {[0.85, 0.6, 0.35].map((scale, i) => (
        <View key={i} style={{ position: 'absolute', width: size * scale, height: size * scale, borderRadius: size * scale / 2, borderWidth: 1, borderColor: `rgba(212,255,0,${0.15 - i * 0.04})` }} />
      ))}
      {/* Crosshairs */}
      <View style={{ position: 'absolute', width: size * 0.7, height: 1, backgroundColor: 'rgba(212,255,0,0.15)' }} />
      <View style={{ position: 'absolute', width: 1, height: size * 0.7, backgroundColor: 'rgba(212,255,0,0.15)' }} />
      {/* Spinning sweep arm */}
      <Animated.View style={{ position: 'absolute', width: r * 0.8, height: 1, backgroundColor: LIME, left: r, top: r - 0.5, transformOrigin: 'left center', transform: [{ rotate: spin }], opacity: 0.7 }} />
      {/* Center dot */}
      <Animated.View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: LIME, opacity: pulse }} />
    </View>
  );
}

export default function LeagueScreen() {
  const { leagueId, leagueName, platform } = useLocalSearchParams();
  const platformStr = (platform as string) || 'sleeper';
  const router = useRouter();

  const [starters, setStarters] = useState<Player[]>([]);
  const [bench, setBench] = useState<Player[]>([]);
  const [leagueSettings, setLeagueSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [advice, setAdvice] = useState('');
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'roster' | 'waivers' | 'matchup' | 'standings' | 'activity'>('roster');
  const [waiverPlayers, setWaiverPlayers] = useState<Player[]>([]);
  const [waiverLoading, setWaiverLoading] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState('ALL');
  const [matchup, setMatchup] = useState<any>(null);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [otherRosters, setOtherRosters] = useState<OtherRoster[]>([]);
  const [selectedRoster, setSelectedRoster] = useState<OtherRoster | null>(null);
  const [rosterModalVisible, setRosterModalVisible] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [playersDb, setPlayersDb] = useState<any>({});

  const PLATFORM_COLOR = platformStr === 'espn' ? '#FF4444' : platformStr === 'yahoo' ? '#6001D2' : LIME;

  useEffect(() => {
    if (leagueId) { setStandings([]); setOtherRosters([]); setMatchup(null); setWaiverPlayers([]); setTransactions([]); setActiveTab('roster'); fetchRoster(); }
  }, [leagueId]);

  useEffect(() => {
    if (activeTab === 'waivers' && waiverPlayers.length === 0) fetchWaivers();
    if (activeTab === 'matchup' && !matchup) fetchMatchup();
    if (activeTab === 'standings' && standings.length === 0) fetchStandings();
    if (activeTab === 'activity' && transactions.length === 0) fetchActivity();
  }, [activeTab]);

  const getPlayersDb = async () => {
    if (Object.keys(playersDb).length > 0) return playersDb;
    const db = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
    setPlayersDb(db);
    return db;
  };

  const fetchSleeperRoster = async () => {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return;
    const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    const settings = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}`)).json();
    setLeagueSettings(settings);
    const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json();
    const myRoster = rosters.find((r: any) => r.owner_id === user.user_id);
    if (!myRoster) return;
    const pDb = await getPlayersDb();
    const starterIds = new Set(myRoster.starters || []);
    const rosterPositions: string[] = settings.roster_positions || [];
    const toPlayer = (id: string, isStarter: boolean, idx?: number): Player => {
      const p = pDb[id];
      const slotLabel = (isStarter && idx !== undefined) ? (rosterPositions[idx] || '') : 'BN';
      return { id, name: p ? `${p.first_name} ${p.last_name}` : id, position: p?.position || '?', team: p?.team || 'FA', injuryStatus: p?.injury_status, isStarter, slotLabel };
    };
    setStarters((myRoster.starters || []).map((id: string, i: number) => toPlayer(id, true, i)));
    setBench((myRoster.players || []).filter((id: string) => !starterIds.has(id)).map((id: string) => toPlayer(id, false)));
  };

  const fetchESPNRoster = async () => {
    const creds = await loadESPNCredentials(); if (!creds) return;
    const data = await getESPNLeague(parseInt(leagueId as string), creds);
    setLeagueSettings(data);
    const myTeam = findMyESPNTeam(data, creds.swid); if (!myTeam) return;
    const roster = myTeam.roster?.entries || [];
    const toPlayer = (entry: any, isStarter: boolean): Player => {
      const p = entry.playerPoolEntry?.player;
      return { id: String(p?.id || ''), name: p?.fullName || 'Unknown', position: formatESPNPosition(p?.defaultPositionId) || '?', team: String(p?.proTeamId || 'FA'), injuryStatus: p?.injuryStatus, isStarter, slotLabel: SLOT_LABELS[entry.lineupSlotId] || '' };
    };
    setStarters(roster.filter((e: any) => isESPNStarter(e.lineupSlotId)).map((e: any) => toPlayer(e, true)));
    setBench(roster.filter((e: any) => !isESPNStarter(e.lineupSlotId)).map((e: any) => toPlayer(e, false)));
  };

  const fetchYahooRoster = async () => {
    const token = await getValidYahooToken(); if (!token) return;
    const result = await getMyYahooTeam(leagueId as string, token); if (!result) return;
    setLeagueSettings({ name: leagueId, team: result.team });
    const toPlayer = (p: any, isStarter: boolean): Player => ({ id: p.player_key, name: p.name?.full || 'Unknown', position: p.display_position || '?', team: p.editorial_team_abbr || 'FA', injuryStatus: p.status, isStarter, slotLabel: p.selected_position?.position || '' });
    setStarters(result.roster.starters.map((p: any) => toPlayer(p, true)));
    setBench(result.roster.bench.map((p: any) => toPlayer(p, false)));
  };

  const fetchRoster = async () => {
    try { setLoading(true); if (platformStr === 'espn') await fetchESPNRoster(); else if (platformStr === 'yahoo') await fetchYahooRoster(); else await fetchSleeperRoster(); }
    catch (err) { console.error('fetchRoster:', err); } finally { setLoading(false); }
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
        const [rostersRes, usersRes] = await Promise.all([fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`), fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)]);
        const rosters = await rostersRes.json(); const users = await usersRes.json();
        const userMap: Record<string, any> = {}; users.forEach((u: any) => { userMap[u.user_id] = u; });
        setStandings([...rosters].sort((a, b) => (b.settings?.wins || 0) - (a.settings?.wins || 0) || (b.settings?.fpts || 0) - (a.settings?.fpts || 0)).map((r: any) => { const u = userMap[r.owner_id]; return { rosterId: r.roster_id, username: u?.display_name || u?.username || `Team ${r.roster_id}`, wins: r.settings?.wins || 0, losses: r.settings?.losses || 0, ties: r.settings?.ties || 0, pointsFor: parseFloat(r.settings?.fpts || 0), pointsAgainst: parseFloat(r.settings?.fpts_against || 0), streak: r.metadata?.streak || '' }; }));
        const pDb = await getPlayersDb();
        const username = await AsyncStorage.getItem('sleeper_username');
        const me = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
        setOtherRosters(rosters.filter((r: any) => r.owner_id !== me.user_id).map((r: any) => { const u = userMap[r.owner_id]; return { rosterId: r.roster_id, username: u?.display_name || u?.username || `Team ${r.roster_id}`, players: (r.players || []).map((id: string) => { const p = pDb[id]; return { id, name: p ? `${p.first_name} ${p.last_name}` : id, position: p?.position || '?', team: p?.team || 'FA', injuryStatus: p?.injury_status, isStarter: (r.starters || []).includes(id) }; }) }; }));
      }
    } catch (err) { console.error(err); } finally { setStandingsLoading(false); }
  };

  const fetchMatchup = async () => {
    try {
      if (platformStr === 'espn') { const creds = await loadESPNCredentials(); if (!creds) return; setMatchup(await getESPNMatchups(parseInt(leagueId as string), creds)); }
      else if (platformStr === 'yahoo') { const token = await getValidYahooToken(); if (!token) return; setMatchup(await getYahooMatchups(leagueId as string, token)); }
      else {
        const username = await AsyncStorage.getItem('sleeper_username'); if (!username) return;
        const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
        const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
        const week = state.display_week || 1;
        const [matchupsRes, rostersRes, usersRes] = await Promise.all([fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`), fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`), fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)]);
        const matchups = await matchupsRes.json(); const rosters = await rostersRes.json(); const users = await usersRes.json();
        const myRoster = rosters.find((r: any) => r.owner_id === user.user_id); if (!myRoster) return;
        const myMatchup = matchups.find((m: any) => m.roster_id === myRoster.roster_id);
        const opponent = matchups.find((m: any) => m.matchup_id === myMatchup?.matchup_id && m.roster_id !== myRoster.roster_id);
        const getUsername = (rid: number) => { const r = rosters.find((r: any) => r.roster_id === rid); const u = users.find((u: any) => u.user_id === r?.owner_id); return u?.display_name || u?.username || 'Opponent'; };
        const allMatchups: any[] = []; const seen = new Set();
        matchups.forEach((m: any) => { if (seen.has(m.matchup_id)) return; seen.add(m.matchup_id); const opp = matchups.find((x: any) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id); allMatchups.push({ team1: getUsername(m.roster_id), team1Points: m.points || 0, team2: opp ? getUsername(opp.roster_id) : 'BYE', team2Points: opp?.points || 0, isMyMatchup: m.roster_id === myRoster.roster_id || opp?.roster_id === myRoster.roster_id }); });
        setMatchup({ myTeam: getUsername(myRoster.roster_id), myPoints: myMatchup?.points || 0, opponentTeam: opponent ? getUsername(opponent.roster_id) : 'TBD', opponentPoints: opponent?.points || 0, week, allMatchups });
      }
    } catch (err) { console.error(err); }
  };

  const fetchActivity = async () => {
    setActivityLoading(true);
    try {
      if (platformStr === 'espn') { const creds = await loadESPNCredentials(); if (!creds) return; setTransactions(await getESPNTransactions(parseInt(leagueId as string), creds)); }
      else if (platformStr === 'yahoo') { const token = await getValidYahooToken(); if (!token) return; setTransactions(await getYahooTransactions(leagueId as string, token)); }
      else {
        const pDb = await getPlayersDb();
        const users = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)).json();
        const userMap: Record<string, string> = {}; users.forEach((u: any) => { userMap[u.user_id] = u.display_name || u.username || 'Unknown'; });
        const allTx: Transaction[] = [];
        for (let round = 1; round <= 5; round++) { try { const txData = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${round}`)).json(); if (!Array.isArray(txData)) continue; txData.forEach((tx: any) => { if (['free_agent','waiver','trade'].includes(tx.type)) { allTx.push({ type: tx.type, adds: Object.keys(tx.adds||{}).map(id=>{const p=pDb[id];return p?`${p.first_name} ${p.last_name}`:id;}), drops: Object.keys(tx.drops||{}).map(id=>{const p=pDb[id];return p?`${p.first_name} ${p.last_name}`:id;}), trader: userMap[tx.creator]||'Unknown', time: tx.created }); } }); } catch {} }
        setTransactions(allTx.sort((a,b)=>b.time-a.time).slice(0,50));
      }
    } catch (err) { console.error(err); } finally { setActivityLoading(false); }
  };

  const fetchWaivers = async () => {
    setWaiverLoading(true);
    try {
      if (platformStr === 'sleeper') {
        const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json();
        const taken = new Set(rosters.flatMap((r: any) => r.players || []));
        const pDb = await getPlayersDb();
        setWaiverPlayers(Object.values(pDb).filter((p: any) => ['QB','RB','WR','TE','K'].includes(p.position) && p.team && !taken.has(p.player_id)).slice(0,150).map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false })));
      } else if (platformStr === 'espn') {
        const creds = await loadESPNCredentials(); if (!creds) return;
        const data = await getESPNLeague(parseInt(leagueId as string), creds);
        const filter = JSON.stringify({ players: { filterStatus: { value: ['FREEAGENT','WAIVERS'] }, filterSlotIds: { value: [0,2,4,6,16,17,23] }, limit: 100 } });
        const res = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/${leagueId}?view=kona_player_info&scoringPeriodId=${data.scoringPeriodId||1}`, { headers: { 'Content-Type': 'application/json', 'X-Fantasy-Filter': filter, Cookie: `espn_s2=${creds.espnS2}; SWID=${creds.swid}` } });
        setWaiverPlayers(((await res.json()).players||[]).map((p: any) => { const pl=p.playerPoolEntry?.player; return { id: String(pl?.id||''), name: pl?.fullName||'Unknown', position: formatESPNPosition(pl?.defaultPositionId), team: String(pl?.proTeamId||'FA'), injuryStatus: pl?.injuryStatus, isStarter: false }; }));
      } else if (platformStr === 'yahoo') {
        const token = await getValidYahooToken(); if (!token) return;
        const data = await (await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueId}/players;status=FA;sort=OR;count=50?format=json`, { headers: { Authorization: `Bearer ${token}` } })).json();
        setWaiverPlayers(Object.values(data?.fantasy_content?.league?.[1]?.players || {}).filter((v: any) => typeof v==='object'&&v.player).map((v: any) => { const p=v.player[0]; return { id: p.player_key, name: p.name?.full||'Unknown', position: p.display_position||'?', team: p.editorial_team_abbr||'FA', injuryStatus: p.status, isStarter: false }; }));
      }
    } catch (err) { console.error(err); } finally { setWaiverLoading(false); }
  };

  const handleAdvice = async (player: Player, isWaiver = false) => {
    setSelectedPlayer(player); setAdvice(''); setModalVisible(true); setAdviceLoading(true);
    const isPPR = leagueSettings?.scoring_settings?.rec > 0;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: `You are AIOmni, expert fantasy football analyst.\nLeague: ${leagueName} (${platformStr.toUpperCase()}) | Scoring: ${isPPR ? 'PPR' : 'Standard'}\nPlayer: ${player.name} | ${player.position} | ${player.team}${player.injuryStatus ? ` | Injury: ${player.injuryStatus}` : ''}\n${isWaiver ? 'Should I add off waivers?' : 'Should I start?'} Sharp, direct, under 80 words.` }] }) });
      setAdvice(((await res.json()).content[0].text));
    } catch { setAdvice('Could not load advice. Try again.'); } finally { setAdviceLoading(false); }
  };

  const filteredWaivers = waiverPlayers.filter(p => selectedPosition === 'ALL' || p.position === selectedPosition);

  // ── Player Card ─────────────────────────────────────────────────────────────
  const renderPlayer = (player: Player, isWaiver = false, index = 0) => {
    const posColor = POS_COLORS[player.position] || '#888';
    const isInjured = !!player.injuryStatus;
    const slotLabel = player.slotLabel || player.position;
    return (
      <TouchableOpacity key={`${player.id}-${index}`} style={[styles.playerCard, !player.isStarter && !isWaiver && styles.benchCard]} onPress={() => handleAdvice(player, isWaiver)} activeOpacity={0.8}>
        {/* Left accent bar */}
        <View style={[styles.playerAccentBar, { backgroundColor: player.isStarter || isWaiver ? posColor : '#333' }]} />

        {/* Slot label */}
        <Text style={styles.slotLabel}>{slotLabel}</Text>

        {/* Diamond position tag */}
        <View style={styles.diamondWrap}>
          <View style={[styles.diamond, { backgroundColor: player.isStarter || isWaiver ? posColor : '#1a2a1a', borderColor: posColor, borderWidth: player.isStarter || isWaiver ? 0 : 1 }]}>
            <Text style={[styles.diamondText, { color: player.isStarter || isWaiver ? '#000' : posColor }]}>{player.position}</Text>
          </View>
        </View>

        {/* Player info */}
        <View style={styles.playerInfoCol}>
          <Text style={[styles.playerName, !player.isStarter && !isWaiver && { color: '#aabbaa' }]} numberOfLines={1}>{player.name}</Text>
          <View style={styles.playerMeta}>
            <Text style={styles.playerTeam}>{player.team}</Text>
            {isInjured && <><Text style={styles.metaDot}>·</Text><Text style={styles.injuryText}>{player.injuryStatus}</Text></>}
          </View>
          {/* Progress bar placeholder */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.random() * 60 + 20}%`, backgroundColor: posColor }]} />
          </View>
        </View>

        {/* AI button */}
        <View style={styles.aiTag}>
          <Text style={styles.aiTagText}>AI</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const TAB_DATA = [
    { key: 'roster', label: 'ROSTER' },
    { key: 'standings', label: 'STANDINGS' },
    { key: 'matchup', label: 'MATCHUP' },
    { key: 'waivers', label: 'WAIVERS' },
    { key: 'activity', label: 'ACTIVITY' },
  ] as const;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <RadarLogo size={36} />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.leagueName} numberOfLines={1}>{leagueName || 'MY LEAGUE'}</Text>
            <Text style={styles.leagueSub}>{platformStr.toUpperCase()}</Text>
          </View>
        </View>
        <View style={[styles.platformBadge, { backgroundColor: PLATFORM_COLOR }]}>
          <Text style={[styles.platformBadgeText, { color: platformStr === 'sleeper' ? '#000' : '#fff' }]}>{platformStr.toUpperCase()}</Text>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {TAB_DATA.map(tab => (
          <TouchableOpacity key={tab.key} style={[styles.tabBtn, activeTab === tab.key && { borderBottomColor: PLATFORM_COLOR, borderBottomWidth: 2 }]} onPress={() => setActiveTab(tab.key)}>
            <Text style={[styles.tabText, activeTab === tab.key && { color: PLATFORM_COLOR }]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator color={LIME} size="large" /><Text style={styles.loadingText}>LOADING ROSTER</Text></View>

      ) : activeTab === 'roster' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
          {/* Starters section */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionLabel}>STARTERS</Text>
            <View style={styles.sectionCount}><Text style={styles.sectionCountText}>{starters.length}</Text></View>
          </View>
          {starters.map((p, i) => renderPlayer(p, false, i))}

          {/* Bench section */}
          <View style={[styles.sectionHeader, { marginTop: 20 }]}>
            <View style={[styles.sectionAccent, { backgroundColor: '#444' }]} />
            <Text style={[styles.sectionLabel, { color: '#aabbaa' }]}>BENCH</Text>
            <View style={[styles.sectionCount, { backgroundColor: '#1a2a1a' }]}><Text style={[styles.sectionCountText, { color: '#aabbaa' }]}>{bench.length}</Text></View>
          </View>
          {bench.map((p, i) => renderPlayer(p, false, i))}
          <View style={{ height: 40 }} />
        </ScrollView>

      ) : activeTab === 'standings' ? (
        standingsLoading ? <View style={styles.loadingBox}><ActivityIndicator color={LIME} /><Text style={styles.loadingText}>LOADING</Text></View> : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>STANDINGS · TAP TO SPY ROSTER</Text>
            {standings.map((team, i) => (
              <TouchableOpacity key={String(team.rosterId)} style={styles.standingRow} onPress={() => { const r = otherRosters.find(r => r.rosterId === team.rosterId); if (r) { setSelectedRoster(r); setRosterModalVisible(true); } }}>
                <Text style={[styles.standingRank, i < 3 && { color: LIME }]}>{i + 1}</Text>
                <View style={styles.standingInfo}>
                  <Text style={styles.standingName}>{team.username}</Text>
                  <Text style={styles.standingPts}>{team.pointsFor.toFixed(1)} PF · {team.pointsAgainst.toFixed(1)} PA</Text>
                </View>
                <View style={styles.standingRecord}>
                  <Text style={styles.standingRecordText}>{team.wins}–{team.losses}{team.ties > 0 ? `–${team.ties}` : ''}</Text>
                  {team.streak ? <Text style={[styles.standingStreak, { color: team.streak.startsWith('W') ? '#00ffaa' : '#ff2255' }]}>{team.streak}</Text> : null}
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
                    <Text style={[styles.matchupScore, { color: matchup.myPoints >= matchup.opponentPoints ? LIME : '#fff' }]}>{matchup.myPoints?.toFixed(2)}</Text>
                    <Text style={styles.matchupLabel}>YOU</Text>
                  </View>
                  <Text style={styles.matchupVs}>VS</Text>
                  <View style={[styles.matchupTeamCol, { alignItems: 'flex-end' }]}>
                    <Text style={styles.matchupTeamName} numberOfLines={1}>{matchup.opponentTeam}</Text>
                    <Text style={[styles.matchupScore, { color: matchup.opponentPoints > matchup.myPoints ? '#ff2255' : '#888' }]}>{matchup.opponentPoints?.toFixed(2)}</Text>
                    <Text style={styles.matchupLabel}>OPP</Text>
                  </View>
                </View>
                <View style={[styles.matchupStatus, { borderColor: matchup.myPoints >= matchup.opponentPoints ? LIME : '#ff2255', backgroundColor: matchup.myPoints >= matchup.opponentPoints ? 'rgba(212,255,0,0.06)' : 'rgba(255,34,85,0.06)' }]}>
                  <Text style={[styles.matchupStatusText, { color: matchup.myPoints >= matchup.opponentPoints ? LIME : '#ff2255' }]}>{matchup.myPoints > matchup.opponentPoints ? 'WINNING ✓' : matchup.myPoints < matchup.opponentPoints ? 'LOSING ✗' : 'TIED'}</Text>
                </View>
              </View>
              {matchup.allMatchups?.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 24 }]}>ALL MATCHUPS</Text>
                  {matchup.allMatchups.map((m: any, i: number) => (
                    <View key={i} style={[styles.allMatchupRow, m.isMyMatchup && { borderColor: PLATFORM_COLOR }]}>
                      <View style={{ flex: 1 }}><Text style={[styles.allMatchupTeam, m.isMyMatchup && { color: '#fff' }]} numberOfLines={1}>{m.team1}</Text><Text style={styles.allMatchupScore}>{m.team1Points?.toFixed(2)}</Text></View>
                      <Text style={styles.allMatchupVs}>vs</Text>
                      <View style={{ flex: 1, alignItems: 'flex-end' }}><Text style={[styles.allMatchupTeam, m.isMyMatchup && { color: '#fff' }]} numberOfLines={1}>{m.team2}</Text><Text style={styles.allMatchupScore}>{m.team2Points?.toFixed(2)}</Text></View>
                    </View>
                  ))}
                </>
              )}
              <View style={{ height: 40 }} />
            </>
          ) : <View style={styles.loadingBox}><ActivityIndicator color={LIME} /><Text style={styles.loadingText}>LOADING</Text></View>}
        </ScrollView>

      ) : activeTab === 'waivers' ? (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: 20 }}>
            {POSITIONS.map(pos => (
              <TouchableOpacity key={pos} style={[styles.filterBtn, selectedPosition === pos && { borderColor: LIME, backgroundColor: 'rgba(212,255,0,0.08)' }]} onPress={() => setSelectedPosition(pos)}>
                <Text style={[styles.filterText, selectedPosition === pos && { color: LIME }]}>{pos}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {waiverLoading ? <View style={styles.loadingBox}><ActivityIndicator color={LIME} /><Text style={styles.loadingText}>LOADING</Text></View>
            : <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>{filteredWaivers.map((p, i) => renderPlayer(p, true, i))}<View style={{ height: 40 }} /></ScrollView>}
        </View>

      ) : activeTab === 'activity' ? (
        activityLoading ? <View style={styles.loadingBox}><ActivityIndicator color={LIME} /><Text style={styles.loadingText}>LOADING</Text></View> : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>RECENT TRANSACTIONS</Text>
            {transactions.length === 0 && <Text style={styles.emptyText}>No recent transactions found.</Text>}
            {transactions.map((tx, i) => (
              <View key={i} style={styles.txCard}>
                <View style={[styles.txAccent, { backgroundColor: tx.type === 'trade' ? '#ffaa00' : tx.type === 'waiver' ? LIME : '#00ffaa' }]} />
                <View style={styles.txHeader}>
                  <Text style={[styles.txType, { color: tx.type === 'trade' ? '#ffaa00' : PLATFORM_COLOR }]}>{tx.type === 'trade' ? '⇄ TRADE' : tx.type === 'waiver' ? '◎ WAIVER' : '+ FREE AGENT'}</Text>
                  <Text style={styles.txTrader}>{tx.trader}</Text>
                </View>
                {tx.adds.length > 0 && <Text style={styles.txAdds}>+ {tx.adds.join(', ')}</Text>}
                {tx.drops.length > 0 && <Text style={styles.txDrops}>– {tx.drops.join(', ')}</Text>}
                <Text style={styles.txTime}>{new Date(tx.time).toLocaleDateString()}</Text>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )
      ) : null}

      {/* Advice Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={[styles.modalTopAccent, { backgroundColor: POS_COLORS[selectedPlayer?.position || ''] || LIME }]} />
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalPlayerName}>{selectedPlayer?.name}</Text>
                <View style={[styles.modalPosBadge, { backgroundColor: POS_COLORS[selectedPlayer?.position || ''] || '#444' }]}>
                  <Text style={styles.modalPosBadgeText}>{selectedPlayer?.position} · {selectedPlayer?.team}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
            </View>
            {adviceLoading ? <View style={styles.loadingAdvice}><ActivityIndicator color={LIME} size="large" /><Text style={styles.loadingAdviceText}>ANALYZING...</Text></View>
              : <Text style={styles.adviceText}>{advice}</Text>}
            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: POS_COLORS[selectedPlayer?.position || ''] || LIME }]} onPress={() => setModalVisible(false)}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Other Roster Modal */}
      <Modal visible={rosterModalVisible} transparent animationType="slide" onRequestClose={() => setRosterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <View style={[styles.modalTopAccent, { backgroundColor: PLATFORM_COLOR }]} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalPlayerName}>{selectedRoster?.username}</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setRosterModalVisible(false)}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={styles.sectionLabel}>STARTERS</Text>
              {selectedRoster?.players.filter(p => p.isStarter).map((p, i) => renderPlayer(p, false, i))}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>BENCH</Text>
              {selectedRoster?.players.filter(p => !p.isStarter).map((p, i) => renderPlayer(p, false, i))}
              <View style={{ height: 20 }} />
            </ScrollView>
            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: PLATFORM_COLOR }]} onPress={() => setRosterModalVisible(false)}>
              <Text style={[styles.gotItText, { color: platformStr === 'sleeper' ? '#000' : '#fff' }]}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Header
  header: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  backBtn: { paddingRight: 4 },
  backText: { fontFamily: 'SpaceMono_400Regular', color: LIME, fontSize: 10, letterSpacing: 1.5 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  leagueName: { fontFamily: 'BebasNeue_400Regular', color: '#fff', fontSize: 18, letterSpacing: 2, maxWidth: 180 },
  leagueSub: { fontFamily: 'SpaceMono_400Regular', color: '#aabbaa', fontSize: 9, letterSpacing: 1.5, marginTop: 1 },
  platformBadge: { borderRadius: 2, paddingHorizontal: 8, paddingVertical: 4 },
  platformBadgeText: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, letterSpacing: 1.5, fontWeight: '700' },

  // Tabs
  tabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: BORDER },
  tabRow: { paddingHorizontal: 8 },
  tabBtn: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontFamily: 'SpaceMono_400Regular', color: '#667766', fontSize: 9, letterSpacing: 1.5 },

  // Loading
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontFamily: 'SpaceMono_400Regular', color: LIME, fontSize: 10, letterSpacing: 3, opacity: 0.6 },

  // Scroll
  scroll: { flex: 1 },
  scrollPad: { paddingHorizontal: 16, paddingTop: 4 },

  // Section header
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 8 },
  sectionAccent: { width: 3, height: 18, backgroundColor: LIME, borderRadius: 2 },
  sectionLabel: { fontFamily: 'BebasNeue_400Regular', color: LIME, fontSize: 16, letterSpacing: 3, flex: 1 },
  sectionCount: { backgroundColor: 'rgba(212,255,0,0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 2 },
  sectionCountText: { fontFamily: 'SpaceMono_400Regular', color: LIME, fontSize: 10, letterSpacing: 1 },
  emptyText: { fontFamily: 'Barlow_400Regular', color: '#aabbaa', fontSize: 14 },

  // Player card — matches the mockup exactly
  playerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 4, marginBottom: 6, overflow: 'hidden', minHeight: 64 },
  benchCard: { opacity: 0.5 },
  playerAccentBar: { width: 3, alignSelf: 'stretch' },
  slotLabel: { fontFamily: 'SpaceMono_400Regular', color: '#667766', fontSize: 8, letterSpacing: 1, width: 28, textAlign: 'center' },
  diamondWrap: { width: 40, alignItems: 'center', justifyContent: 'center' },
  diamond: { width: 30, height: 30, borderRadius: 4, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
  diamondText: { fontFamily: 'SpaceMono_400Regular', fontSize: 7, fontWeight: '700', transform: [{ rotate: '-45deg' }], letterSpacing: 0.3 },
  playerInfoCol: { flex: 1, paddingVertical: 10, paddingRight: 8 },
  playerName: { fontFamily: 'BebasNeue_400Regular', color: LIME, fontSize: 18, letterSpacing: 1, lineHeight: 20 },
  playerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  playerTeam: { fontFamily: 'SpaceMono_400Regular', color: '#aabbaa', fontSize: 9, letterSpacing: 0.5 },
  metaDot: { color: '#667766', fontSize: 9 },
  injuryText: { fontFamily: 'SpaceMono_400Regular', color: '#ffaa00', fontSize: 9, letterSpacing: 0.5 },
  progressTrack: { height: 2, backgroundColor: 'rgba(212,255,0,0.1)', borderRadius: 1, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 2, borderRadius: 1 },
  aiTag: { width: 28, height: 28, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(212,255,0,0.25)', alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: 'rgba(212,255,0,0.05)' },
  aiTagText: { fontFamily: 'SpaceMono_400Regular', color: LIME, fontSize: 8, letterSpacing: 1 },

  // Standings
  standingRow: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 14, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  standingRank: { fontFamily: 'BebasNeue_400Regular', color: '#667766', fontSize: 22, width: 32, letterSpacing: 1 },
  standingInfo: { flex: 1 },
  standingName: { fontFamily: 'Barlow_600SemiBold', color: '#ccc', fontSize: 15, marginBottom: 2 },
  standingPts: { fontFamily: 'SpaceMono_400Regular', color: '#667766', fontSize: 9, letterSpacing: 0.5 },
  standingRecord: { alignItems: 'flex-end', marginRight: 8 },
  standingRecordText: { fontFamily: 'BebasNeue_400Regular', color: '#fff', fontSize: 18, letterSpacing: 1 },
  standingStreak: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, fontWeight: '700', marginTop: 2 },
  standingArrow: { color: '#667766', fontSize: 20 },

  // Matchup
  matchupCard: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 20, marginTop: 16 },
  matchupWeekLabel: { fontFamily: 'SpaceMono_400Regular', color: '#667766', fontSize: 9, letterSpacing: 2, marginBottom: 16, textAlign: 'center' },
  matchupScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchupTeamCol: { flex: 1 },
  matchupTeamName: { fontFamily: 'Barlow_400Regular', color: '#aabbaa', fontSize: 12, marginBottom: 4 },
  matchupScore: { fontFamily: 'BebasNeue_400Regular', fontSize: 44, letterSpacing: 2 },
  matchupLabel: { fontFamily: 'SpaceMono_400Regular', color: '#667766', fontSize: 8, letterSpacing: 2, marginTop: 2 },
  matchupVs: { fontFamily: 'BebasNeue_400Regular', color: '#2a3a2a', fontSize: 18, letterSpacing: 2, marginHorizontal: 10 },
  matchupStatus: { borderRadius: 2, padding: 10, alignItems: 'center', marginTop: 16, borderWidth: 1 },
  matchupStatusText: { fontFamily: 'BebasNeue_400Regular', fontSize: 16, letterSpacing: 3 },
  allMatchupRow: { backgroundColor: SURFACE, borderRadius: 2, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  allMatchupTeam: { fontFamily: 'Barlow_400Regular', color: '#aabbaa', fontSize: 13 },
  allMatchupScore: { fontFamily: 'BebasNeue_400Regular', color: '#fff', fontSize: 18, letterSpacing: 1, marginTop: 2 },
  allMatchupVs: { fontFamily: 'SpaceMono_400Regular', color: '#2a3a2a', fontSize: 10, marginHorizontal: 8 },

  // Waivers
  filterRow: { flexGrow: 0, marginVertical: 10 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 2, borderWidth: 1, borderColor: '#1a2a1a', marginRight: 8 },
  filterText: { fontFamily: 'SpaceMono_400Regular', color: '#667766', fontSize: 10, letterSpacing: 1 },

  // Activity
  txCard: { backgroundColor: SURFACE, borderRadius: 4, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  txAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  txHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  txType: { fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 1 },
  txTrader: { fontFamily: 'Barlow_400Regular', color: '#aabbaa', fontSize: 12 },
  txAdds: { fontFamily: 'Barlow_600SemiBold', color: '#00ffaa', fontSize: 13, marginBottom: 2 },
  txDrops: { fontFamily: 'Barlow_600SemiBold', color: '#ff2255', fontSize: 13, marginBottom: 4 },
  txTime: { fontFamily: 'SpaceMono_400Regular', color: '#667766', fontSize: 9, marginTop: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#060f06', borderTopLeftRadius: 4, borderTopRightRadius: 4, padding: 24, minHeight: 280, borderTopWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  modalTopAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalPlayerName: { fontFamily: 'BebasNeue_400Regular', color: '#fff', fontSize: 28, letterSpacing: 2 },
  modalPosBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 2, alignSelf: 'flex-start', marginTop: 6 },
  modalPosBadgeText: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, color: '#000', letterSpacing: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 2, borderWidth: 1, borderColor: '#1a2a1a', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#aabbaa', fontSize: 14 },
  loadingAdvice: { alignItems: 'center', padding: 24, gap: 14 },
  loadingAdviceText: { fontFamily: 'SpaceMono_400Regular', color: LIME, fontSize: 10, letterSpacing: 3, opacity: 0.7 },
  adviceText: { fontFamily: 'Barlow_400Regular', color: '#aabbaa', fontSize: 15, lineHeight: 24, marginBottom: 20 },
  gotItBtn: { borderRadius: 2, padding: 16, alignItems: 'center', marginTop: 8 },
  gotItText: { fontFamily: 'BebasNeue_400Regular', fontSize: 18, letterSpacing: 3, color: '#000' },
});
