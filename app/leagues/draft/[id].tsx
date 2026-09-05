// Hosted draft room (2026-09-04): N phones, one snake draft, realtime.
// Server owns all rules (make_hosted_pick validates turn/availability under
// a row lock); this screen renders state and asks. Pool = Sleeper player DB
// sorted by search_rank, QB/RB/WR/TE only (classic best ball: no K/DEF).
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  draftRoomState, forceHostedPick, friendlyDraftError, makeHostedPick, snakeSlot, subscribeDraft,
  type DraftMember, type DraftPickRow, type HostedLeague,
} from '../../../services/hostedLeagues';
import { supabase } from '../../../services/supabase';
import { Alert } from '../../../services/util/crossAlert';
import { useTheme, type ThemeTokens } from '../../constants/theme';

type PoolPlayer = { sleeperId: string; gsis?: string; name: string; pos: string; team: string; rank: number };

const POS = ['ALL', 'QB', 'RB', 'WR', 'TE'];

export default function HostedDraftRoom() {
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [league, setLeague] = useState<HostedLeague | null>(null);
  const [members, setMembers] = useState<DraftMember[]>([]);
  const [picks, setPicks] = useState<DraftPickRow[]>([]);
  const [pool, setPool] = useState<PoolPlayer[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const gsisBySleeper = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    const st = await draftRoomState(id!);
    setLeague(st.league); setMembers(st.members); setPicks(st.picks);
  }, [id]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: me } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
        setMeId(me?.id ?? null);
      }
      await refresh();
      // Pool: Sleeper live DB by search_rank; gsis mapping via nfl_players
      // (batched) so taken-player greying works against hosted_picks rows.
      try {
        // Audit fix: this fetched ~15MB on EVERY mount. Reuse the same cache
        // the Coach maintains; refetch only when absent (cache write is
        // best-effort — web quota).
        let db: any = null;
        try {
          const cached = await (await import('@react-native-async-storage/async-storage')).default.getItem('sleeper_players_cache');
          if (cached) db = JSON.parse(cached);
        } catch {}
        if (!db) {
          const res = await fetch('https://api.sleeper.app/v1/players/nfl');
          db = await res.json();
          try {
            const AS = (await import('@react-native-async-storage/async-storage')).default;
            await AS.setItem('sleeper_players_cache', JSON.stringify(db));
            await AS.setItem('sleeper_players_cache_at', String(Date.now()));
          } catch { /* web quota */ }
        }
        const rows: PoolPlayer[] = [];
        for (const [sid, p] of Object.entries<any>(db)) {
          if (!p?.search_rank || p.search_rank > 400) continue;
          if (!['QB', 'RB', 'WR', 'TE'].includes(p.position)) continue;
          if (!p.team) continue;
          rows.push({ sleeperId: sid, name: `${p.first_name} ${p.last_name}`, pos: p.position, team: p.team, rank: p.search_rank });
        }
        rows.sort((a, b) => a.rank - b.rank);
        setPool(rows);
        const sids = rows.map(r => r.sleeperId);
        for (let i = 0; i < sids.length; i += 200) {
          const { data } = await supabase.from('nfl_players').select('gsis_id, sleeper_id').in('sleeper_id', sids.slice(i, i + 200));
          for (const r of data ?? []) gsisBySleeper.current.set(r.sleeper_id, r.gsis_id);
        }
        setPool(p => (p ? [...p] : p));
      } catch {
        setPool([]);
        Alert.alert('Player pool failed to load', 'Check your connection and reopen the draft room.');
      }
    })();
    const un = subscribeDraft(id!, refresh);
    // Realtime belt-and-suspenders: poll every 5s in case the socket drops.
    const iv = setInterval(refresh, 5000);
    return () => { un(); clearInterval(iv); };
  }, [id, refresh]);

  const taken = useMemo(() => new Set(picks.map(p => p.gsis_id)), [picks]);
  const teams = league?.team_count ?? 0;
  const overall = picks.length + 1;
  const total = (league?.rounds ?? 0) * teams;
  const onClockSlot = teams ? snakeSlot(overall, teams) : 0;
  const mySlot = members.find(m => m.user_id === meId)?.draft_slot ?? null;
  const onClock = members.find(m => m.draft_slot === onClockSlot);
  const myTurn = league?.draft_status === 'drafting' && mySlot === onClockSlot;
  const round = Math.floor((overall - 1) / Math.max(teams, 1)) + 1;

  const nameByUser = useMemo(() => new Map(members.map(m => [m.user_id, m.team_name])), [members]);

  const iAmCreator = meId != null && league?.creator_id === meId;
  const draftPlayer = (p: PoolPlayer) => {
    if (busy) return;                                  // stacked-confirm guard
    const forcing = !myTurn && iAmCreator;
    const title = forcing ? `Force-pick ${p.name} for ${onClock?.team_name ?? 'the team on the clock'}?` : `Draft ${p.name}?`;
    Alert.alert(title, `${p.pos} · ${p.team} · pick ${overall} (round ${round})`, [
      { text: 'Cancel', style: 'cancel' },
      { text: forcing ? 'Force pick' : 'Draft', onPress: async () => {
        if (busy) return;
        setBusy(true);
        const res = forcing ? await forceHostedPick(id!, p.sleeperId) : await makeHostedPick(id!, p.sleeperId);
        setBusy(false);
        if ('error' in res) { Alert.alert('Pick failed', friendlyDraftError(res.error)); refresh(); return; }
        refresh();
        if (res.complete) Alert.alert('Draft complete!', 'Rosters are locked — scoring runs automatically every week.');
      } },
    ]);
  };

  if (!league) return (
    <View style={[s.container, { paddingTop: insets.top + 24, alignItems: 'center', gap: 14 }]}>
      <ActivityIndicator color={t.accentText} />
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={{ color: t.textSub, fontSize: 14 }}>{'\u2039'} Back</Text>
      </TouchableOpacity>
    </View>
  );

  const filtered = (pool ?? []).filter(p =>
    !taken.has(gsisBySleeper.current.get(p.sleeperId) ?? '§none') &&
    (pos === 'ALL' || p.pos === pos) &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase()))
  ).slice(0, 60);

  return (
    <View style={[s.container, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={{ color: t.textSub, fontSize: 15 }}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{league.name}</Text>
        <Text style={s.pickCounter}>{league.draft_status === 'complete' ? 'DONE' : `${overall}/${total}`}</Text>
      </View>

      {league.draft_status === 'complete' ? (
        <View style={[s.banner, { backgroundColor: t.card, borderColor: t.successText }]}>
          <Text style={[s.bannerText, { color: t.successText }]}>Draft complete — rosters locked, weekly scoring is automatic.</Text>
        </View>
      ) : (
        <View style={[s.banner, { backgroundColor: myTurn ? t.accentText : t.card, borderColor: myTurn ? t.accentText : t.border }]}>
          <Text style={[s.bannerText, { color: myTurn ? '#0a1214' : t.text }]}>
            {myTurn ? "YOU'RE ON THE CLOCK — round " + round : 'On the clock: ' + (onClock?.team_name ?? '…') + ' (round ' + round + ')'}
          </Text>
        </View>
      )}

      <View style={s.controls}>
        <TextInput style={s.search} placeholder="Search players" placeholderTextColor={t.textMuted} value={q} onChangeText={setQ} />
        <View style={s.chips}>
          {POS.map(p => (
            <TouchableOpacity key={p} style={[s.chip, pos === p && { backgroundColor: t.accentText }]} onPress={() => setPos(p)}>
              <Text style={[s.chipText, pos === p && { color: '#0a1214' }]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {pool === null ? <ActivityIndicator color={t.accentText} style={{ marginTop: 20 }} /> : (
        <FlatList
          data={filtered}
          keyExtractor={p => p.sleeperId}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 30 }}
          renderItem={({ item: p }) => (
            <View style={s.row}>
              <Text style={s.rank}>{p.rank}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.pname}>{p.name}</Text>
                <Text style={s.pmeta}>{p.pos} · {p.team}</Text>
              </View>
              <TouchableOpacity
                style={[s.draftBtn, (!(myTurn || (iAmCreator && league?.draft_status === 'drafting')) || busy) && { opacity: 0.35 }]}
                disabled={!(myTurn || (iAmCreator && league?.draft_status === 'drafting')) || busy}
                onPress={() => draftPlayer(p)}
              >
                <Text style={s.draftBtnText}>{myTurn ? 'DRAFT' : iAmCreator ? 'FORCE' : 'DRAFT'}</Text>
              </TouchableOpacity>
            </View>
          )}
          ListHeaderComponent={picks.length > 0 ? (
            <View style={{ paddingVertical: 8 }}>
              <Text style={s.lastPick}>
                Last: #{picks[picks.length - 1].overall} {nameByUser.get(picks[picks.length - 1].user_id) ?? ''} — {(pool ?? []).find(pl => gsisBySleeper.current.get(pl.sleeperId) === picks[picks.length - 1].gsis_id)?.name ?? ''}
              </Text>
            </View>
          ) : null}
        />
      )}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontFamily: 'Audiowide_400Regular', fontSize: 14, color: t.text, letterSpacing: 1, flex: 1 },
  pickCounter: { fontFamily: 'Audiowide_400Regular', fontSize: 12, color: t.accentText },
  banner: { marginHorizontal: 14, borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 8 },
  bannerText: { fontFamily: 'Audiowide_400Regular', fontSize: 12, letterSpacing: 0.5, textAlign: 'center' },
  controls: { paddingHorizontal: 14, gap: 8, marginBottom: 6 },
  search: { borderWidth: 1, borderColor: t.border, backgroundColor: t.inputBg, color: t.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: t.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: t.card },
  chipText: { color: t.textSub, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 10, marginBottom: 8 },
  rank: { fontFamily: 'Audiowide_400Regular', color: t.textMuted, fontSize: 12, width: 34, textAlign: 'center' },
  pname: { color: t.text, fontSize: 14.5, fontWeight: '600' },
  pmeta: { color: t.textMuted, fontSize: 12 },
  draftBtn: { backgroundColor: t.accentText, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 9 },
  draftBtnText: { color: '#0a1214', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  lastPick: { color: t.textSub, fontSize: 12.5 },
});
