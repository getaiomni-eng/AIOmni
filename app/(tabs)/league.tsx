import AsyncStorage from '@react-native-async-storage/async-storage';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { askAI, describeAIError, hasAISession } from "../../services/ai";
import { hasAIConsent } from "../../services/aiConsent";
import { getCurrentTier } from '../../services/purchases';
import { syncRosteredPlayers, type RosteredPlayer } from '../../services/rosterSync';
import { consumePrompt } from '../../services/promptQuota';
import { findMyESPNTeam, formatESPNPosition, getESPNAllRosters, getESPNLeague, getESPNMatchups, getESPNStandings, getESPNTransactions, isESPNStarter, loadESPNCredentials } from '../../services/espn';
import { Icon } from '../components/AIOmniIcons';
import PlayerCardModal from '../components/PlayerCardModal';
import { HeatIcon } from '../components/HeatIcon';
import { computeHeatBatch } from '../../services/heat';
import { getHeatSignalsMap } from '../../services/heatData';
import { useHeatAccess } from '../hooks/useHeatAccess';
import { PlatformErrorCard, classifyPlatformError } from '../components/PlatformErrorCard';
import { getMyYahooTeam, getValidYahooToken, getYahooAllRosters, getYahooMatchups, getYahooStandings, getYahooTransactions } from '../../services/yahoo';
import { getActiveSleeperIds } from '../../services/nflPlayers';
import { C, F, R, SZ, BEVEL } from '../constants/tokens';
import { readableText, useTheme, type ThemeTokens } from '../constants/theme';
import { CLASS_OF_2025_TEXT } from '../../services/seasonContext2026';

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
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [err, setErr] = useState(false);
  const uri = `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`;
  if (!err) {
    return (
      <View style={{ width: 44, height: 44, marginHorizontal: 6 }}>
        <Image
          source={{ uri }}
          style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: active ? posColor : t.border }}
          onError={() => setErr(true)}
        />
        <View style={[s.posBadge, { backgroundColor: posColor }]}>
          <Text style={s.posBadgeText}>{player.position}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.diamondWrap}>
      <View style={[s.diamond, { backgroundColor: active ? posColor : 'rgba(88,131,191,0.10)', borderColor: posColor, borderWidth: active ? 0 : 1 }]}>
        <Text style={[s.diamondText, { color: active ? '#ffffff' : posColor }]}>{player.position}</Text>
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

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <SvgLinearGradient id="specLeague" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#ff5714" />
            <Stop offset="25%" stopColor="#ffb800" />
            <Stop offset="50%" stopColor="#e4ff1a" />
            <Stop offset="75%" stopColor="#6eeb83" />
            <Stop offset="100%" stopColor="#1be7ff" />
          </SvgLinearGradient>
        </Defs>
        <Circle cx="32" cy="32" r="22" fill="none" stroke="url(#specLeague)" strokeWidth={4} strokeLinecap="round" strokeDasharray="125 14" />
      </Svg>
    </View>
  );
}

export default function LeagueScreen() {
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
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
  const [cardVisible,        setCardVisible]        = useState(false);
  const [activeTab,          setActiveTab]          = useState<'roster'|'waivers'|'matchup'|'standings'|'activity'>('roster');
  const [waiverPlayers,      setWaiverPlayers]      = useState<Player[]>([]);
  const [waiverLoading,      setWaiverLoading]      = useState(false);
  const [selectedPosition,   setSelectedPosition]   = useState('ALL');
  const [matchup,            setMatchup]            = useState<any>(null);
  const [expandedMatchup, setExpandedMatchup] = useState<number | null>(null);
  const [standings,          setStandings]          = useState<TeamStanding[]>([]);
  const [standingsLoading,   setStandingsLoading]   = useState(false);
  const [otherRosters,       setOtherRosters]       = useState<OtherRoster[]>([]);
  const [selectedRoster,     setSelectedRoster]     = useState<OtherRoster | null>(null);
  const [rosterModalVisible, setRosterModalVisible] = useState(false);
  const [transactions,       setTransactions]       = useState<Transaction[]>([]);
  const [activityLoading,    setActivityLoading]    = useState(false);
  const [playersDb,          setPlayersDb]          = useState<any>({});
  const heatAccess = useHeatAccess();
  const [sortByHeat, setSortByHeat] = useState(false);
  const [heatUpgradeVisible, setHeatUpgradeVisible] = useState(false);
  const [rosterError, setRosterError] = useState<any>(null);
  const [waiverError, setWaiverError] = useState<any>(null);

  const PLATFORM_COLOR = platformStr === 'espn' ? '#e03030' : platformStr === 'yahoo' ? '#6001D2' : C.gold;

  useEffect(() => {
    if (leagueId) {
      setStandings([]); setOtherRosters([]); setMatchup(null);
      setWaiverPlayers([]); setTransactions([]); setActiveTab('roster');
      fetchRoster();
    }
  }, [leagueId]);

  // Whenever starters/bench finish loading, push the rostered names up to
  // public.user_rostered_players so server-side notification jobs can match
  // news against this user's rosters without holding platform creds. The
  // sync helper coalesces (1h cooldown per user) so this is safe to fire
  // every time a roster loads.
  useEffect(() => {
    if (starters.length === 0 && bench.length === 0) return;
    const toRP = (p: Player, isStarter: boolean): RosteredPlayer => ({
      name:      p.name,
      position:  p.position,
      team:      p.team,
      leagueId:  String(leagueId ?? ''),
      platform:  platformStr,
      isStarter,
    });
    syncRosteredPlayers([
      ...starters.map(p => toRP(p, true)),
      ...bench.map(p   => toRP(p, false)),
    ]).catch(e => console.log('roster sync skipped:', e?.message));
  }, [starters, bench, leagueId, platformStr]);

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


  const resolvePlayerName = (id: string): { name: string; pos: string } => {
    const p = playersDb[id];
    if (p) return { name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(), pos: p.position || '' };
    return { name: id, pos: '' };
  };

  const StarterBreakdown = ({ starters, points, label }: { starters: string[]; points: number[]; label: string }) => {
    if (!starters || starters.length === 0) return null;
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 9, color: t.textMuted, letterSpacing: 1.5, marginBottom: 6 }}>{label}</Text>
        {starters.map((id: string, idx: number) => {
          const { name, pos } = resolvePlayerName(id);
          const pts = points[idx] ?? 0;
          return (
            <View key={id + idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: t.border }}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: t.textMuted, width: 28 }}>{pos}</Text>
              <Text style={{ fontFamily: F.body, fontSize: 12, color: t.text, flex: 1 }} numberOfLines={1}>{name}</Text>
              <Text style={{ fontFamily: F.bold, fontSize: 12, color: pts > 15 ? t.successText : pts > 8 ? t.text : t.textSub }}>{pts.toFixed(1)}</Text>
            </View>
          );
        })}
      </View>
    );
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

  // Fleaflicker + MFL both implement the FantasyPlatform abstraction, so
  // one helper handles both. The Sleeper/ESPN/Yahoo branches use inline
  // platform-specific code for historical reasons; routing them through
  // the abstraction is a future cleanup. Without this helper the league
  // screen falls into fetchSleeperRoster for any non-{espn,yahoo} platform
  // and crashes with "Cannot read property 'find' of null" because the
  // Sleeper API returns 404 for a Fleaflicker league_id.
  const fetchAbstractRoster = async (platformId: 'fleaflicker' | 'mfl') => {
    const { getPlatform } = require('../../services/platform');
    const plat = getPlatform(platformId);
    const roster = await plat.getMyRoster(leagueId as string);
    if (!roster) return;
    setLeagueSettings({ name: leagueId, team: roster.teamName });
    const toPlayer = (s: any, isStarter: boolean): Player => ({
      id:           String(s.player?.id ?? ''),
      name:         s.player?.name || 'Unknown',
      position:     s.player?.position || '?',
      team:         s.player?.team || 'FA',
      injuryStatus: s.player?.injuryStatus ?? undefined,
      isStarter,
      slotLabel:    s.slot || (isStarter ? '' : 'BN'),
    });
    setStarters((roster.starters || []).map((s: any) => toPlayer(s, true)));
    setBench((roster.bench || []).map((s: any) => toPlayer(s, false)));
  };

  const fetchRoster = async () => {
    try {
      setLoading(true);
      setRosterError(null);
      if      (platformStr === 'espn')        await fetchESPNRoster();
      else if (platformStr === 'yahoo')       await fetchYahooRoster();
      else if (platformStr === 'fleaflicker') await fetchAbstractRoster('fleaflicker');
      else if (platformStr === 'mfl')         await fetchAbstractRoster('mfl');
      else                                    await fetchSleeperRoster();
    } catch (err) {
      console.error('fetchRoster:', err);
      setRosterError(err);
    }
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
      } else if (platformStr === 'fleaflicker' || platformStr === 'mfl') {
        const { getPlatform } = require('../../services/platform');
        const plat = getPlatform(platformStr);
        const [stds, allRosters] = await Promise.all([
          plat.getStandings(leagueId as string).catch(() => []),
          plat.getAllRosters(leagueId as string).catch(() => []),
        ]);
        setStandings(stds.map((s: any) => ({
          rosterId:      s.rosterId,
          username:      s.teamName,
          wins:          s.record?.wins   ?? 0,
          losses:        s.record?.losses ?? 0,
          ties:          s.record?.ties   ?? 0,
          pointsFor:     s.pointsFor      ?? 0,
          pointsAgainst: s.pointsAgainst  ?? 0,
          streak:        s.streak         ?? '',
        })));
        setOtherRosters(allRosters.filter((r: any) => !r.isMe).map((r: any) => ({
          rosterId: r.rosterId,
          username: r.teamName,
          players: [...(r.starters || []), ...(r.bench || [])].map((s: any) => ({
            id:           String(s.player?.id ?? ''),
            name:         s.player?.name || 'Unknown',
            position:     s.player?.position || '?',
            team:         s.player?.team || 'FA',
            injuryStatus: s.player?.injuryStatus ?? undefined,
            isStarter:    !!s.isStarter,
          })),
        })));
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
      } else if (platformStr === 'fleaflicker' || platformStr === 'mfl') {
        const { getPlatform } = require('../../services/platform');
        const plat = getPlatform(platformStr);
        const leaguesArr = await plat.getLeagues().catch(() => []);
        const week = leaguesArr?.[0]?.currentWeek ?? 1;
        const matchups = await plat.getMatchups(leagueId as string, week).catch(() => []);
        const mine = (matchups as any[]).find(m => m.home?.isMe || m.away?.isMe);
        const myIsHome = !!mine?.home?.isMe;
        const me   = mine ? (myIsHome ? mine.home : mine.away) : null;
        const opp  = mine ? (myIsHome ? mine.away : mine.home) : null;
        setMatchup({
          myTeam:           me?.teamName  ?? 'You',
          myPoints:         me?.points    ?? 0,
          myStarters:       [],
          myStarterPoints:  [],
          opponentTeam:     opp?.teamName ?? 'TBD',
          opponentPoints:   opp?.points   ?? 0,
          oppStarters:      [],
          oppStarterPoints: [],
          week,
          allMatchups: (matchups as any[]).map(m => ({
            team1:              m.home?.teamName ?? '',
            team1Points:        m.home?.points   ?? 0,
            team1Starters:      [],
            team1StarterPoints: [],
            team2:              m.away?.teamName ?? '',
            team2Points:        m.away?.points   ?? 0,
            team2Starters:      [],
            team2StarterPoints: [],
            isMyMatchup:        !!(m.home?.isMe || m.away?.isMe),
          })),
        });
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
          allMatchups.push({
            team1: getUsername(m.roster_id), team1Points: m.points || 0,
            team1Starters: m.starters || [], team1StarterPoints: m.starters_points || [],
            team2: opp ? getUsername(opp.roster_id) : 'BYE', team2Points: opp?.points || 0,
            team2Starters: opp?.starters || [], team2StarterPoints: opp?.starters_points || [],
            isMyMatchup: m.roster_id === myRoster.roster_id || opp?.roster_id === myRoster.roster_id,
          });
        });
        setMatchup({
          myTeam: getUsername(myRoster.roster_id), myPoints: myMatchup?.points || 0,
          myStarters: myMatchup?.starters || [], myStarterPoints: myMatchup?.starters_points || [],
          opponentTeam: opponent ? getUsername(opponent.roster_id) : 'TBD', opponentPoints: opponent?.points || 0,
          oppStarters: opponent?.starters || [], oppStarterPoints: opponent?.starters_points || [],
          week, allMatchups,
        });
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
      } else if (platformStr === 'fleaflicker' || platformStr === 'mfl') {
        const { getPlatform } = require('../../services/platform');
        const plat = getPlatform(platformStr);
        const txs = await plat.getTransactions(leagueId as string, 50).catch(() => []);
        setTransactions((txs as any[]).map(t => ({
          // UI's Transaction.type uses Sleeper's vocabulary (free_agent /
          // waiver / trade) for the badge labels; remap our cleaner
          // abstraction values to match.
          type:   t.type === 'add' ? 'free_agent' : t.type,
          adds:   (t.adds  || []).map((a: any) => a.player?.name).filter(Boolean),
          drops:  (t.drops || []).map((d: any) => d.player?.name).filter(Boolean),
          trader: '',
          time:   t.timestamp, // already in ms from the abstraction
        })));
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

  // Keep the top N available players PER POSITION (input order preserved,
  // so each platform's own ranking decides who makes the cut). A single
  // overall top-100 starves thin positions — K/TE/DEF barely chart on
  // ownership-sorted lists, leaving their filter chips nearly empty.
  const topPerPosition = (list: any[], n = 25): any[] => {
    const counts: Record<string, number> = {};
    return list.filter(p => {
      const k = p.position || '?';
      counts[k] = (counts[k] ?? 0) + 1;
      return counts[k] <= n;
    });
  };

  const fetchWaivers = async () => {
    setWaiverLoading(true);
    setWaiverError(null);
    try {
      if (platformStr === 'sleeper') {
        const [rosters, pDb, activeIds] = await Promise.all([
          (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json(),
          getPlayersDb(),
          getActiveSleeperIds().catch(() => new Set<string>()),
        ]);
        const taken = new Set(rosters.flatMap((r: any) => r.players || []));
        setWaiverPlayers(topPerPosition(
          Object.values(pDb)
            .filter((p: any) =>
              (() => {
                const rosterPositions = (leagueSettings?.roster_positions || ['QB','RB','WR','TE','K','DEF']) as string[];
                const activePositions = new Set(rosterPositions.flatMap((pos: string) => {
                  if (pos === 'FLEX') return ['RB','WR','TE'];
                  if (pos === 'SUPER_FLEX') return ['QB','RB','WR','TE'];
                  if (pos === 'REC_FLEX') return ['WR','TE'];
                  if (pos === 'WRRB_FLEX') return ['RB','WR'];
                  if (['BN','IR','TAXI'].includes(pos)) return [];
                  return [pos];
                }));
                return activePositions.has(p.position);
              })() &&
              (p.team || p.position === 'DEF' || p.search_rank == null) &&
              !taken.has(p.player_id) &&
              (p.search_rank == null || p.search_rank < 1000) &&
              // Canonical active check — filters Sleeper's lingering retirees (Roethlisberger, Bell, etc.)
              // Rookie escape: 2026 rookies in nfl_players have null sleeper_id
              // until the cross-platform-id backfill runs, so they fail the
              // activeIds check above. Allow Y0 + age ≤ 24 + active + on team
              // through so post-draft rookies (Jeremiyah Love, Carnell Tate,
              // Mendoza, etc.) appear in waivers immediately, not days later.
              (p.position === 'DEF'
                || activeIds.size === 0
                || activeIds.has(p.player_id)
                || (
                  (p.years_exp === 0 || p.years_exp == null)
                  && (p.age == null || p.age <= 24)
                  && p.active !== false
                  && p.team
                )
              )
            )
            .sort((a: any, b: any) => (a.search_rank ?? 100) - (b.search_rank ?? 100))
            .map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false }))
        , 25));
        // Attach Sleeper trending velocity → Heat score.
        try {
          const heatMap = await getHeatSignalsMap();
          setWaiverPlayers(prev => computeHeatBatch(
            prev.map(p => ({ ...p, heatSignals: heatMap.get(p.id) })) as any
          ) as any);
        } catch (e) { console.log('waiver heat merge:', e); }
      } else if (platformStr === 'espn') {
        const creds = await loadESPNCredentials(); if (!creds) return;
        // getESPNFreeAgents resolves the active season dynamically and maps
        // proTeamId → team abbrev. The old inline fetch hardcoded
        // /seasons/2025/, which returned an empty list for 2026 leagues.
        const { getESPNFreeAgents } = require('../../services/espn');
        // 250-deep pool (ownership-sorted) so thin positions still field a
        // full top-25 after the per-position cut.
        const fas = await getESPNFreeAgents(parseInt(leagueId as string), creds, 250);
        setWaiverPlayers(topPerPosition(fas.map((p: any) => ({ id: p.id, name: p.name, position: p.position, team: p.team, injuryStatus: p.injuryStatus, isStarter: false })), 25));
      } else if (platformStr === 'yahoo') {
        const token = await getValidYahooToken(); if (!token) return;
        // Yahoo caps count at 25 per request, so one overall-sorted call
        // can't cover every position — fetch the top 25 PER POSITION in
        // parallel instead. Yahoo's player[0] is an ARRAY of single-key
        // attribute objects ({player_key}, {name:{full}}, …), not one
        // object — resolve attributes with find(), like yahoo.ts does.
        const YAHOO_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
        const perPos = await Promise.all(YAHOO_POS.map(async (pos) => {
          try {
            const data = await (await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueId}/players;status=FA;position=${pos};sort=OR;count=25?format=json`, { headers: { Authorization: `Bearer ${token}` } })).json();
            return Object.values(data?.fantasy_content?.league?.[1]?.players || {}).filter((v: any) => typeof v === 'object' && v.player).map((v: any) => {
              const attrs: any[] = Array.isArray(v.player[0]) ? v.player[0] : [];
              const attr = (k: string) => attrs.find((x: any) => x && typeof x === 'object' && k in x)?.[k];
              return {
                id: attr('player_key') || '',
                name: attr('name')?.full || 'Unknown',
                position: attr('display_position') || pos,
                team: attr('editorial_team_abbr') || 'FA',
                injuryStatus: attr('status'),
                isStarter: false,
              };
            });
          } catch { return []; }
        }));
        setWaiverPlayers(perPos.flat());
      } else if (platformStr === 'fleaflicker' || platformStr === 'mfl') {
        const { getPlatform } = require('../../services/platform');
        const plat = getPlatform(platformStr);
        // 250-deep pool so the per-position cut can field a full top 25
        // even for K/TE/DEF, which barely chart on overall-sorted lists.
        const players = await plat.getAvailablePlayers(leagueId as string, { limit: 250 }).catch(() => []);
        setWaiverPlayers(topPerPosition((players as any[]).map(p => ({
          id:           String(p.id ?? ''),
          name:         p.name || 'Unknown',
          position:     p.position || '?',
          team:         p.team || 'FA',
          injuryStatus: p.injuryStatus ?? undefined,
          isStarter:    false,
        })), 25));
      }
    } catch (err) {
      console.error(err);
      setWaiverError(err);
    }
    finally { setWaiverLoading(false); }
  };

  const handleAdvice = async (player: Player, isWaiver = false) => {
    setSelectedPlayer(player);
    setAdvice('');
    setModalVisible(true);
    setAdviceLoading(true);
    // 5.1.1(i): never charge a prompt for a call the consent gate will refuse.
    if (!(await hasAIConsent())) {
      setAdvice('AI features are turned off. To get player advice, enable “Share data with AI service” in Settings.');
      setAdviceLoading(false);
      return;
    }
    // Guests can't reach the AI proxy — don't burn a lifetime prompt trying.
    if (!(await hasAISession())) {
      setAdvice('Sign in to use AI features — create a free account from Settings.');
      setAdviceLoading(false);
      return;
    }
    // Atomic check-and-charge — if over cap, route to paywall instead of
    // calling Claude. consumePrompt() avoids the TOCTOU window the older
    // canSend+increment pair had.
    const ok = await consumePrompt();
    if (!ok) {
      const tier = await getCurrentTier();
      const ctx = tier === 'free' ? 'free_prompts_exhausted' : 'weekly_prompts_exhausted';
      setModalVisible(false);
      setAdviceLoading(false);
      router.push(`/paywall?context=${ctx}` as any);
      return;
    }
    // (askAI carries its own 50s timeout + 'ai_timeout' error — the old
    // local AbortController here aborted nothing since askAI takes no
    // signal, so its 15s "deadline" was dead code.)
    try {
      const isPPR = leagueSettings?.scoring_settings?.rec > 0;
      const text  = await askAI(`You are AIOmni, expert fantasy football analyst.\nLeague: ${leagueName} (${platformStr.toUpperCase()}) | Scoring: ${isPPR ? 'PPR' : 'Standard'}\nPlayer: ${player.name} | ${player.position} | ${player.team}${player.injuryStatus ? ` | Injury: ${player.injuryStatus}` : ''}\n${isWaiver ? 'Should I add off waivers?' : 'Should I start or sit?'} Be sharp, direct, under 80 words. No intros.`, { tier: 'fast', maxTokens: 256, system: CLASS_OF_2025_TEXT });
      setAdvice(text);
    } catch (e: any) {
      const message = e?.message === 'prompt_limit_reached'
          ? 'You have reached your weekly prompts. Upgrade to Pro for 50 prompts per week.'
          : describeAIError(e, 'Could not load advice. Tap retry or try again in a moment.');
      setAdvice(message);
    } finally { setAdviceLoading(false); }
  };

  const filteredWaivers = (() => {
    const base = waiverPlayers.filter(p => selectedPosition === 'ALL' || p.position === selectedPosition);
    if (sortByHeat && heatAccess.canSortByHeat) {
      return [...base].sort((a, b) => (((b as any).heatScore ?? 0) - ((a as any).heatScore ?? 0)));
    }
    return base;
  })();

  const renderPlayer = (player: Player, isWaiver = false, index = 0) => {
    const posColor  = readableText(t, POS_COLORS[player.position], 4.5) || t.textMuted;
    const isInjured = !!player.injuryStatus;
    const slotLabel = player.slotLabel || player.position;
    const active    = player.isStarter || isWaiver;
    return (
      <TouchableOpacity
        key={`${player.id}-${index}`}
        style={[s.playerCard, !active && s.benchCard]}
        onPress={() => { setSelectedPlayer(player); setCardVisible(true); }}
        activeOpacity={0.8}
      >
        {/* bevel catchlight */}
        <View style={s.playerCardShine} />
        <View style={[s.playerAccentBar, { backgroundColor: active ? posColor : t.borderLight }]} />
        <Text style={s.slotLabel}>{slotLabel}</Text>
        <PlayerAvatar player={player} posColor={posColor} active={active} />
        <View style={s.playerInfoCol}>
          <Text style={[s.playerName, !active && { color: t.textMuted }]} numberOfLines={1}>{player.name}</Text>
          <View style={s.playerMeta}>
            <Text style={s.playerTeam}>{player.team}</Text>
            {isInjured && (<><Text style={s.metaDot}>·</Text><Text style={s.injuryText}>{player.injuryStatus}</Text></>)}
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.random() * 60 + 20}%`, backgroundColor: active ? posColor : t.borderLight }]} />
          </View>
        </View>
        {heatAccess.showIcon && (((player as any).heatScore ?? 0) >= heatAccess.iconThreshold) && (
          <View style={{ marginRight: 6 }}>
            <HeatIcon
              score={(player as any).heatScore ?? 0}
              direction={(player as any).heatDirection ?? 'flat'}
              size={28}
              showScore={heatAccess.showScore}
              compact
            />
          </View>
        )}
        <View style={s.aiTag}>
          <Text style={s.aiTagText}>AI</Text>
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
    <View style={{ flex: 1, backgroundColor: t.bg }}>

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← BACK</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <LeagueAvatar avatarId={avatarId} size={36} />
          <View style={{ marginLeft: 10 }}>
            <Text style={s.leagueName} numberOfLines={1}>{leagueName || 'MY LEAGUE'}</Text>
            <Text style={s.leagueSub}>{platformStr.toUpperCase()}</Text>
          </View>
        </View>
        <View style={[s.platformBadge, { backgroundColor: PLATFORM_COLOR }]}>
          <Text style={[s.platformBadgeText, { color: platformStr === 'sleeper' ? '#1a1a1a' : '#fff' }]}>
            {platformStr.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* ── Tabs ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll} contentContainerStyle={s.tabRow}>
        {TAB_DATA.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[s.tabBtn, activeTab === tab.key && { borderBottomColor: PLATFORM_COLOR, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[s.tabText, activeTab === tab.key && { color: t.accentText }]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Content ── */}
      {loading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator color={t.accentText} size="large" />
          <Text style={s.loadingText}>LOADING ROSTER</Text>
        </View>

      ) : activeTab === 'roster' ? (
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
          {rosterError ? (() => {
            const c = classifyPlatformError(rosterError);
            return (
              <PlatformErrorCard
                kind={c.kind}
                platform={c.platform ?? (platformStr as any)}
                message={c.message}
                onRetry={fetchRoster}
              />
            );
          })() : null}
          <View style={s.sectionHeader}>
            <View style={s.sectionAccent} />
            <Text style={s.sectionLabel}>STARTERS</Text>
            <View style={s.sectionCount}><Text style={s.sectionCountText}>{starters.length}</Text></View>
          </View>
          {starters.map((p, i) => renderPlayer(p, false, i))}
          <View style={[s.sectionHeader, { marginTop: 20 }]}>
            <View style={[s.sectionAccent, { backgroundColor: t.textMuted }]} />
            <Text style={[s.sectionLabel, { color: t.textMuted }]}>BENCH</Text>
            <View style={[s.sectionCount, { backgroundColor: 'rgba(26,31,46,0.06)' }]}>
              <Text style={[s.sectionCountText, { color: t.textMuted }]}>{bench.length}</Text>
            </View>
          </View>
          {bench.map((p, i) => renderPlayer(p, false, i))}
          <View style={{ height: 40 }} />
        </ScrollView>

      ) : activeTab === 'standings' ? (
        standingsLoading ? (
          <View style={s.loadingBox}><ActivityIndicator color={t.accentText} /><Text style={s.loadingText}>LOADING</Text></View>
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
            <Text style={s.sectionLabel}>STANDINGS · TAP TO SPY ROSTER</Text>
            {standings.map((team, i) => (
              <TouchableOpacity key={String(team.rosterId)} style={s.standingRow} onPress={() => { const r = otherRosters.find(r => r.rosterId === team.rosterId); if (r) { setSelectedRoster(r); setRosterModalVisible(true); } }}>
                <Text style={[s.standingRank, i < 3 && { color: t.accentText, textShadowColor: 'rgba(61,106,170,0.3)', textShadowOffset:{width:0,height:1}, textShadowRadius:4 }]}>{i + 1}</Text>
                <View style={s.standingInfo}>
                  <Text style={s.standingName}>{team.username}</Text>
                  <Text style={s.standingPts}>{team.pointsFor.toFixed(1)} PF · {team.pointsAgainst.toFixed(1)} PA</Text>
                </View>
                <View style={s.standingRecord}>
                  <Text style={s.standingRecordText}>{team.wins}–{team.losses}{team.ties > 0 ? `–${team.ties}` : ''}</Text>
                  {team.streak ? <Text style={[s.standingStreak, { color: team.streak.startsWith('W') ? t.successText : '#a83040' }]}>{team.streak}</Text> : null}
                </View>
                <Text style={s.standingArrow}>›</Text>
              </TouchableOpacity>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )

      ) : activeTab === 'matchup' ? (
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
          {matchup ? (
            <>
              <View style={s.matchupCard}>
                <Text style={s.matchupWeekLabel}>WEEK {matchup.week} · YOUR MATCHUP</Text>
                <View style={s.matchupScoreRow}>
                  <View style={s.matchupTeamCol}>
                    <Text style={s.matchupTeamName} numberOfLines={1}>{matchup.myTeam}</Text>
                    <Text style={s.matchupScore}>{matchup.myPoints?.toFixed(2)}</Text>
                    <Text style={s.matchupLabel}>YOU</Text>
                  </View>
                  <Text style={s.matchupVs}>VS</Text>
                  <View style={[s.matchupTeamCol, { alignItems: 'flex-end' }]}>
                    <Text style={s.matchupTeamName} numberOfLines={1}>{matchup.opponentTeam}</Text>
                    <Text style={s.matchupScore}>{matchup.opponentPoints?.toFixed(2)}</Text>
                    <Text style={s.matchupLabel}>OPP</Text>
                  </View>
                </View>
                <View style={[s.matchupStatus, {
                  borderColor: matchup.myPoints >= matchup.opponentPoints ? 'rgba(30,140,66,0.3)' : 'rgba(168,48,64,0.3)',
                  backgroundColor: matchup.myPoints >= matchup.opponentPoints ? 'rgba(30,140,66,0.08)' : 'rgba(168,48,64,0.08)',
                }]}>
                  <Text style={[s.matchupStatusText, { color: matchup.myPoints >= matchup.opponentPoints ? t.successText : '#a83040' }]}>
                    {matchup.myPoints > matchup.opponentPoints ? 'WINNING ✓' : matchup.myPoints < matchup.opponentPoints ? 'LOSING ✗' : 'TIED'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <StarterBreakdown starters={matchup.myStarters} points={matchup.myStarterPoints} label="YOUR STARTERS" />
                  </View>
                  <View style={{ width: 1, backgroundColor: t.border }} />
                  <View style={{ flex: 1 }}>
                    <StarterBreakdown starters={matchup.oppStarters} points={matchup.oppStarterPoints} label="OPP STARTERS" />
                  </View>
                </View>
              </View>
              {matchup.allMatchups?.length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { marginTop: 24 }]}>ALL MATCHUPS</Text>
                  {matchup.allMatchups.map((m: any, i: number) => (
                    <View key={i}>
                      <TouchableOpacity activeOpacity={0.7} onPress={() => { getPlayersDb(); setExpandedMatchup(expandedMatchup === i ? null : i); }} style={[s.allMatchupRow, m.isMyMatchup && { borderColor: PLATFORM_COLOR, borderWidth: 1.5 }, expandedMatchup === i && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, marginBottom: 0 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.allMatchupTeam} numberOfLines={1}>{m.team1}</Text>
                          <Text style={s.allMatchupScore}>{m.team1Points?.toFixed(2)}</Text>
                        </View>
                        <Text style={s.allMatchupVs}>{expandedMatchup === i ? '▾' : 'vs'}</Text>
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <Text style={s.allMatchupTeam} numberOfLines={1}>{m.team2}</Text>
                          <Text style={s.allMatchupScore}>{m.team2Points?.toFixed(2)}</Text>
                        </View>
                      </TouchableOpacity>
                      {expandedMatchup === i && (
                        <View style={{ backgroundColor: t.surface, borderWidth: 1, borderTopWidth: 0, borderColor: t.border, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, paddingHorizontal: 12, paddingBottom: 12, marginBottom: 10 }}>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                              <StarterBreakdown starters={m.team1Starters} points={m.team1StarterPoints} label={m.team1} />
                            </View>
                            <View style={{ width: 1, backgroundColor: t.border }} />
                            <View style={{ flex: 1 }}>
                              <StarterBreakdown starters={m.team2Starters} points={m.team2StarterPoints} label={m.team2} />
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
              <View style={{ height: 40 }} />
            </>
          ) : (
            <View style={s.loadingBox}><ActivityIndicator color={t.accentText} /><Text style={s.loadingText}>LOADING</Text></View>
          )}
        </ScrollView>

      ) : activeTab === 'waivers' ? (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={{ paddingHorizontal: 20 }}>
            {POSITIONS.map(pos => (
              <TouchableOpacity key={pos} style={[s.filterBtn, selectedPosition === pos && { borderColor: C.blueDeep, backgroundColor: t.greenTint }]} onPress={() => setSelectedPosition(pos)}>
                <Text style={[s.filterText, selectedPosition === pos && { color: t.accentText }]}>{pos}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.filterBtn, sortByHeat && heatAccess.canSortByHeat && { borderColor: '#ff5714', backgroundColor: 'rgba(255,87,20,0.12)' }]}
              onPress={() => {
                if (heatAccess.canSortByHeat) setSortByHeat(v => !v);
                else setHeatUpgradeVisible(true);
              }}
            >
              <Text style={[s.filterText, sortByHeat && heatAccess.canSortByHeat && { color: t.dangerText }]}>
                {sortByHeat && heatAccess.canSortByHeat ? '🔥 HEAT' : 'SORT: HEAT'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
          {waiverLoading ? (
            <View style={s.loadingBox}><ActivityIndicator color={t.accentText} /><Text style={s.loadingText}>LOADING</Text></View>
          ) : (
            <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
              {waiverError ? (() => {
                const c = classifyPlatformError(waiverError);
                return (
                  <PlatformErrorCard
                    kind={c.kind}
                    platform={c.platform ?? (platformStr as any)}
                    message={c.message}
                    onRetry={fetchWaivers}
                  />
                );
              })() : null}
              {filteredWaivers.map((p, i) => renderPlayer(p, true, i))}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>

      ) : activeTab === 'activity' ? (
        activityLoading ? (
          <View style={s.loadingBox}><ActivityIndicator color={t.accentText} /><Text style={s.loadingText}>LOADING</Text></View>
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
            <Text style={s.sectionLabel}>RECENT TRANSACTIONS</Text>
            {transactions.length === 0 && <Text style={s.emptyText}>No recent transactions found.</Text>}
            {transactions.map((tx, i) => (
              <View key={i} style={s.txCard}>
                <View style={s.txCardShine} />
                <View style={[s.txAccent, { backgroundColor: tx.type === 'trade' ? C.gold : tx.type === 'waiver' ? C.mint : C.sage }]} />
                <View style={s.txHeader}>
                  <Text style={[s.txType, { color: tx.type === 'trade' ? t.accentText : t.accentText }]}>{tx.type === 'trade' ? '⇄ TRADE' : tx.type === 'waiver' ? '◎ WAIVER' : '+ FREE AGENT'}</Text>
                  <Text style={s.txTrader}>{tx.trader}</Text>
                </View>
                {tx.adds.length  > 0 && <Text style={s.txAdds}>+ {tx.adds.join(', ')}</Text>}
                {tx.drops.length > 0 && <Text style={s.txDrops}>– {tx.drops.join(', ')}</Text>}
                <Text style={s.txTime}>{new Date(tx.time).toLocaleDateString()}</Text>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )
      ) : null}

      {/* ── Advice Modal ── */}
      <PlayerCardModal
        visible={cardVisible}
        player={selectedPlayer}
        platform={platformStr as 'sleeper' | 'espn' | 'yahoo'}
        onClose={() => setCardVisible(false)}
        onAskAI={() => {
          setCardVisible(false);
          // Slight delay so close animation doesn't conflict with open
          setTimeout(() => {
            if (selectedPlayer) handleAdvice(selectedPlayer, activeTab === 'waivers');
          }, 150);
        }}
      />

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalCardShine} />
            <View style={[s.modalTopAccent, { backgroundColor: POS_COLORS[selectedPlayer?.position || ''] || C.gold }]} />
            <View style={s.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalPlayerName}>{selectedPlayer?.name}</Text>
                <View style={[s.modalPosBadge, { backgroundColor: POS_COLORS[selectedPlayer?.position || ''] || t.greenTint }]}>
                  <Text style={s.modalPosBadgeText}>{selectedPlayer?.position} · {selectedPlayer?.team}</Text>
                </View>
              </View>
              <TouchableOpacity style={s.closeBtn} onPress={() => setModalVisible(false)}>
                <Icon name="x" size={16} color={t.accentText} />
              </TouchableOpacity>
            </View>
            {adviceLoading ? (
              <View style={s.loadingAdvice}>
                <ActivityIndicator color={t.accentText} size="large" />
                <Text style={s.loadingAdviceText}>ANALYZING...</Text>
              </View>
            ) : (
              <>
                <Text style={s.adviceText}>{advice}</Text>
                {(advice.includes('try again') || advice.includes('timed out')) && (
                  <TouchableOpacity style={[s.gotItBtn, { backgroundColor: t.greenTint, borderWidth:1, borderColor: t.border, marginBottom: 8 }]} onPress={() => selectedPlayer && handleAdvice(selectedPlayer)}>
                    <Text style={[s.gotItText, { color: t.accentText }]}>RETRY</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            <TouchableOpacity style={[s.gotItBtn, { backgroundColor: C.gold }]} onPress={() => setModalVisible(false)}>
              <Text style={s.gotItText}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Other Roster Modal ── */}
      <Modal visible={rosterModalVisible} transparent animationType="slide" onRequestClose={() => setRosterModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { maxHeight: '85%' }]}>
            <View style={s.modalCardShine} />
            <View style={[s.modalTopAccent, { backgroundColor: PLATFORM_COLOR }]} />
            <View style={s.modalHeader}>
              <Text style={s.modalPlayerName}>{selectedRoster?.username}</Text>
              <TouchableOpacity style={s.closeBtn} onPress={() => setRosterModalVisible(false)}>
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={s.sectionLabel}>STARTERS</Text>
              {selectedRoster?.players.filter(p =>  p.isStarter).map((p, i) => renderPlayer(p, false, i))}
              <Text style={[s.sectionLabel, { marginTop: 16 }]}>BENCH</Text>
              {selectedRoster?.players.filter(p => !p.isStarter).map((p, i) => renderPlayer(p, false, i))}
              <View style={{ height: 20 }} />
            </ScrollView>
            <TouchableOpacity style={[s.gotItBtn, { backgroundColor: PLATFORM_COLOR }]} onPress={() => setRosterModalVisible(false)}>
              <Text style={[s.gotItText, { color: platformStr === 'sleeper' ? '#1a1a1a' : '#fff' }]}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Heat sort upgrade modal — Pro tier only */}
      <Modal visible={heatUpgradeVisible} transparent animationType="fade" onRequestClose={() => setHeatUpgradeVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { minHeight: 240 }]}>
            <View style={[s.modalTopAccent, { backgroundColor: '#ff5714' }]} />
            <Text style={[s.modalPlayerName, { marginBottom: 12 }]}>🔥 SORT BY HEAT</Text>
            <Text style={s.adviceText}>
              Heat sort is a Pro feature. Surface the fastest-rising waiver targets across all of fantasy — before your leaguemates see them.
            </Text>
            <TouchableOpacity style={[s.gotItBtn, { backgroundColor: '#ff5714', marginBottom: 8 }]} onPress={() => { setHeatUpgradeVisible(false); router.push('/paywall' as any); }}>
              <Text style={[s.gotItText, { color: '#fff' }]}>UPGRADE TO PRO</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.gotItBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border }]} onPress={() => setHeatUpgradeVisible(false)}>
              <Text style={[s.gotItText, { color: t.textSub }]}>NOT NOW</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  header:            { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: t.borderLight, gap: 10, backgroundColor: t.bg },
  backBtn:           { paddingRight: 4 },
  backText:          { fontFamily: F.mono, color: t.accentText, fontSize: SZ.xs, letterSpacing: 1.5 },
  headerCenter:      { flex: 1, flexDirection: 'row', alignItems: 'center' },
  leagueName:        { fontFamily: F.bold, color: t.text, fontSize: SZ.lg, maxWidth: 180 },
  leagueSub:         { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs - 1, letterSpacing: 1.5, marginTop: 1 },
  platformBadge:     { borderRadius: R.xs, paddingHorizontal: 8, paddingVertical: 4 },
  platformBadgeText: { fontFamily: F.mono, fontSize: SZ.xs - 1, letterSpacing: 1.5, fontWeight: '700' },

  tabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: t.borderLight, backgroundColor: t.bg },
  tabRow:    { paddingHorizontal: 8, flexDirection: 'row', gap: 8 },
  tabBtn:    { paddingVertical: 10, paddingHorizontal: 14, borderRadius: R.sm, borderWidth: 1.5, borderColor: t.border, borderTopColor: t.borderLight, borderLeftColor: t.borderLight, borderBottomColor: C.sageBorder, borderRightColor: C.sageBorder, backgroundColor: t.card },
  tabText:   { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs - 1, letterSpacing: 1.5 },

  loadingBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontFamily: F.mono, color: t.accentText, fontSize: SZ.xs, letterSpacing: 3, opacity: 0.7 },

  scroll:    { flex: 1 },
  scrollPad: { paddingHorizontal: 16, paddingTop: 4 },

  sectionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 8 },
  sectionAccent:    { width: 3, height: 18, backgroundColor: C.gold, borderRadius: 2 },
  sectionLabel:     { fontFamily: F.bold, color: t.accentText, fontSize: SZ.base, letterSpacing: 2, flex: 1 },
  sectionCount:     { backgroundColor: C.goldS, paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.xs, borderWidth: 1, borderColor: C.goldBorder },
  sectionCountText: { fontFamily: F.mono, color: t.accentText, fontSize: SZ.xs, letterSpacing: 1 },
  emptyText:        { fontFamily: F.outfit, color: t.textMuted, fontSize: SZ.md },

  // Player card — cream glass with bevel
  playerCard: {
    ...BEVEL.card,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.card, borderColor: t.border,
    borderRadius: R.sm, marginBottom: 6,
    overflow: 'hidden', minHeight: 68,
  },
  playerCardShine: { ...BEVEL.shine, height: 1 },
  benchCard:       { opacity: 0.55 },
  playerAccentBar: { width: 3, alignSelf: 'stretch' },
  slotLabel:       { fontFamily: F.mono, color: t.textMuted, fontSize: 8, letterSpacing: 1, width: 26, textAlign: 'center' },

  posBadge:     { position: 'absolute', bottom: -2, right: -2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, minWidth: 22, alignItems: 'center' },
  posBadgeText: { fontFamily: F.mono, fontSize: 7, fontWeight: '700', color: '#ffffff', letterSpacing: 0.3 },

  diamondWrap: { width: 56, alignItems: 'center', justifyContent: 'center' },
  diamond:     { width: 30, height: 30, borderRadius: 4, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
  diamondText: { fontFamily: F.mono, fontSize: 7, fontWeight: '700', transform: [{ rotate: '-45deg' }], letterSpacing: 0.3 },

  playerInfoCol: { flex: 1, paddingVertical: 10, paddingRight: 8 },
  playerName:    { fontFamily: F.bold, color: t.text, fontSize: SZ.base, letterSpacing: 0.3, lineHeight: 20 },
  playerMeta:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  playerTeam:    { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs - 1, letterSpacing: 0.5 },
  metaDot:       { color: t.textMuted, fontSize: SZ.xs },
  injuryText:    { fontFamily: F.mono, color: t.warnText, fontSize: SZ.xs - 1, letterSpacing: 0.5 },
  progressTrack: { height: 3, backgroundColor: t.borderLight, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  progressFill:  { height: 3, borderRadius: 2 },
  aiTag:         { width: 28, height: 28, borderRadius: R.xs, borderWidth: 1, borderColor: C.goldBorder, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: C.goldS },
  aiTagText:     { fontFamily: F.mono, color: t.accentText, fontSize: 8, letterSpacing: 1 },

  // Standings
  standingRow: {
    ...BEVEL.card,
    backgroundColor: t.card, borderColor: t.border,
    borderRadius: R.sm, padding: 14, marginBottom: 6,
    flexDirection: 'row', alignItems: 'center',
  },
  standingRank:       { fontFamily: F.bold, color: t.textMuted, fontSize: SZ['2xl'], width: 32 },
  standingInfo:       { flex: 1 },
  standingName:       { fontFamily: F.bold, color: t.text, fontSize: SZ.md, marginBottom: 2 },
  standingPts:        { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs - 1, letterSpacing: 0.5 },
  standingRecord:     { alignItems: 'flex-end', marginRight: 8 },
  standingRecordText: { fontFamily: F.bold, color: t.text, fontSize: SZ.lg },
  standingStreak:     { fontFamily: F.mono, fontSize: SZ.xs - 1, fontWeight: '700', marginTop: 2 },
  standingArrow:      { color: t.textMuted, fontSize: SZ.xl },

  // Matchup
  matchupCard: {
    ...BEVEL.card,
    backgroundColor: t.card, borderColor: t.border,
    borderRadius: R.sm, padding: 20, marginTop: 16,
  },
  matchupWeekLabel:  { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs - 1, letterSpacing: 2, marginBottom: 16, textAlign: 'center' },
  matchupScoreRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchupTeamCol:    { flex: 1 },
  matchupTeamName:   { fontFamily: F.outfit, color: t.textSub, fontSize: SZ.sm, marginBottom: 4 },
  // ── Scores: gold fill + blue stroke — same treatment as mockup ──
  matchupScore: {
    fontFamily: F.mono, fontWeight: '700', fontSize: SZ['5xl'],
    color: t.warnText,
    // RN text stroke via text shadow layering (best available on iOS)
    textShadowColor: '#1be7ff',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1,
    letterSpacing: -1.5, lineHeight: 44,
  },
  matchupLabel:    { fontFamily: F.mono, color: t.textMuted, fontSize: 8, letterSpacing: 2, marginTop: 2 },
  matchupVs:       { fontFamily: F.bold, color: t.textMuted, fontSize: SZ.lg, marginHorizontal: 10 },
  matchupStatus:   { borderRadius: R.xs, padding: 10, alignItems: 'center', marginTop: 16, borderWidth: 1 },
  matchupStatusText: { fontFamily: F.bold, fontSize: SZ.base, letterSpacing: 2 },
  allMatchupRow:   {
    ...BEVEL.card,
    backgroundColor: t.card, borderColor: t.border, borderRadius: R.xs, padding: 12, marginBottom: 6,
    flexDirection: 'row', alignItems: 'center',
  },
  allMatchupTeam:  { fontFamily: F.outfit, color: t.textMuted, fontSize: SZ.md },
  allMatchupScore: { fontFamily: F.bold, color: t.text, fontSize: SZ.lg, marginTop: 2 },
  allMatchupVs:    { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs, marginHorizontal: 8 },

  // Waivers
  filterRow: { flexGrow: 0, marginVertical: 10 },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: R.xs,
    borderWidth: 1.5, borderColor: t.border, marginRight: 8,
    backgroundColor: t.card,
  },
  filterText: { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs, letterSpacing: 1 },

  // Activity
  txCard: {
    ...BEVEL.card,
    backgroundColor: t.card, borderColor: t.border, borderRadius: R.sm, padding: 14, marginBottom: 6,
    overflow: 'hidden',
  },
  txCardShine: { ...BEVEL.shine, height: 1 },
  txAccent:    { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  txHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  txType:      { fontFamily: F.mono, fontSize: SZ.xs, letterSpacing: 1 },
  txTrader:    { fontFamily: F.outfit, color: t.textMuted, fontSize: SZ.sm },
  txAdds:      { fontFamily: F.bold, color: t.successText, fontSize: SZ.md, marginBottom: 2 },
  txDrops:     { fontFamily: F.bold, color: '#a83040', fontSize: SZ.md, marginBottom: 4 },
  txTime:      { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs - 1, marginTop: 4 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(26,31,46,0.55)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: t.card,
    borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: 24, minHeight: 280,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderRightWidth: 1.5,
    borderColor: t.border, overflow: 'hidden',
    shadowColor: '#1be7ff', shadowOffset:{width:0,height:-4}, shadowOpacity:0.12, shadowRadius:20, elevation:12,
  },
  modalCardShine:    { ...BEVEL.shine, zIndex: 6 },
  modalTopAccent:    { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  modalHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalPlayerName:   { fontFamily: F.bold, color: t.text, fontSize: SZ['2xl'], letterSpacing: 0.5 },
  modalPosBadge:     { paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.xs, alignSelf: 'flex-start', marginTop: 6 },
  modalPosBadgeText: { fontFamily: F.mono, fontSize: SZ.xs - 1, color: '#ffffff', letterSpacing: 1 },
  closeBtn:          { width: 32, height: 32, borderRadius: R.xs, borderWidth: 1.5, borderColor: t.border, alignItems: 'center', justifyContent: 'center', backgroundColor: t.greenTint },
  closeBtnText:      { color: t.accentText, fontSize: 14, fontFamily: F.bold },
  loadingAdvice:     { alignItems: 'center', padding: 24, gap: 14 },
  loadingAdviceText: { fontFamily: F.mono, color: t.accentText, fontSize: SZ.xs, letterSpacing: 3, opacity: 0.7 },
  adviceText:        { fontFamily: F.outfit, color: t.text, fontSize: SZ.md, lineHeight: 24, marginBottom: 20 },
  gotItBtn:          { borderRadius: R.sm, padding: 16, alignItems: 'center', marginTop: 8 },
  gotItText:         { fontFamily: F.bold, fontSize: SZ.lg, letterSpacing: 2, color: '#1a1f2e' },
});