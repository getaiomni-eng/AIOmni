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
import { askAI } from '../../../services/ai';
import { buyAICredit, getAICreditPrice } from '../../../services/purchases';
import { consumePrompt, getAICreditBalance } from '../../../services/promptQuota';
import { CLASS_OF_2025_TEXT } from '../../../services/seasonContext2026';
import { supabase } from '../../../services/supabase';
import { Alert } from '../../../services/util/crossAlert';
import { useTheme, type ThemeTokens } from '../../constants/theme';

type PoolPlayer = { sleeperId: string; gsis?: string; name: string; pos: string; team: string; rank: number };

const POS = ['ALL', 'QB', 'RB', 'WR', 'TE'];

// h/m above an hour, m:ss below — an 8h clock rendered as "28800s" tells
// nobody anything.
function fmtClock(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

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
  // Ask The O: AI pick advice built from the LIVE draft state.
  const [oAnswer, setOAnswer] = useState<string | null>(null);
  const [oAsking, setOAsking] = useState(false);
  const [creditOffer, setCreditOffer] = useState<string | null>(null); // price string when shown
  const oAskingRef = useRef(false); // sync guard — state alone leaves an async hole before consumePrompt resolves

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
        // Unmapped players (mostly 2026 rookies with no sleeper_id link yet)
        // are rejected by make_hosted_pick as 'unknown or undraftable player'
        // — visible on the board, impossible to draft, on the clock. Drop
        // them. Guarded on a non-empty map: if the lookup itself failed,
        // showing the full board beats showing an empty one.
        const mappedCount = gsisBySleeper.current.size;
        setPool(p => (
          p && mappedCount > 0
            ? p.filter(r => gsisBySleeper.current.has(r.sleeperId))
            : (p ? [...p] : p)
        ));
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

  // The pick deadline existed in the DB from day one and was never rendered,
  // so a stalled draft looked identical to a broken one: no timer, no push,
  // no explanation for eleven other people.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (league?.draft_status !== 'drafting') return;
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [league?.draft_status]);
  const secsLeft = useMemo(() => {
    if (league?.draft_status !== 'drafting' || !league?.pick_deadline) return null;
    return Math.max(0, Math.round((new Date(league.pick_deadline).getTime() - nowMs) / 1000));
  }, [league?.draft_status, league?.pick_deadline, nowMs]);

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

  const askTheO = async () => {
    if (oAsking || oAskingRef.current) return;
    oAskingRef.current = true;
    // Quota gate first — this is also where the 99-cent moment lives. A
    // drafter on the clock with no prompts left is the single highest-intent
    // purchase moment in the app, so the offer appears HERE, inline, not on
    // a paywall three screens away.
    const ok = await consumePrompt();
    if (!ok) {
      const price = await getAICreditPrice();
      setCreditOffer(price ?? '$0.99');
      oAskingRef.current = false;
      return;
    }
    setOAsking(true); setOAnswer(null); setCreditOffer(null);
    try {
      const myPicks = picks.filter(pk => pk.user_id === meId)
        .map(pk => (pool ?? []).find(pl => gsisBySleeper.current.get(pl.sleeperId) === pk.gsis_id))
        .filter(Boolean).map(pl => `${pl!.name} (${pl!.pos})`);
      const avail = (pool ?? [])
        .filter(pl => !taken.has(gsisBySleeper.current.get(pl.sleeperId) ?? '§'))
        .slice(0, 14).map(pl => `${pl.rank}. ${pl.name} (${pl.pos} ${pl.team})`);
      const prompt = [
        `LIVE BEST BALL DRAFT — "${league?.name}". ${teams} teams, ${league?.rounds} rounds, PPR, starts QB/2RB/3WR/TE/FLEX weekly-best automatic (no lineups ever).`,
        `Pick ${overall} of ${total} (round ${round}). ${myTurn ? 'I AM ON THE CLOCK.' : 'Not my pick yet — help me plan.'}`,
        `MY ROSTER SO FAR: ${myPicks.length ? myPicks.join(', ') : '(none yet)'}`,
        `BEST AVAILABLE (market order): ${avail.join(' · ')}`,
        `Who should I take and why? Name ONE pick, one sentence of why, one alternate. Under 90 words — I'm on a clock.`,
      ].join('\n');
      const reply = await askAI(prompt, { maxTokens: 400, system: CLASS_OF_2025_TEXT, feature: 'draft', timeoutMs: 90_000 });
      setOAnswer(reply);
    } catch (e: any) {
      setOAnswer(e?.message === 'prompt_limit_reached'
        ? 'Out of prompts this week.'
        : 'The O could not answer — try again.');
    } finally { setOAsking(false); oAskingRef.current = false; }
  };

  const buyCreditInline = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Buy in the app', 'AI credits are purchased in the iOS app — or upgrade to Pro for 50 prompts a week.');
      return;
    }
    const res = await buyAICredit();
    if (!res.success) {
      if (!('cancelled' in res && res.cancelled)) Alert.alert('Purchase failed', 'Nothing was charged.');
      return;
    }
    // Webhook grants the credit within a few seconds — wait for it, then
    // answer the question they were trying to ask.
    setCreditOffer(null); setOAsking(true);
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 1500));
      if ((await getAICreditBalance()) > 0) break;
    }
    setOAsking(false);
    askTheO();
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
          {secsLeft !== null && (
            <Text style={[s.bannerClock, { color: myTurn ? '#0a1214' : t.textMuted }]}>
              {secsLeft > 0
                ? (myTurn ? 'Autopick in ' : 'Autopicks in ') + fmtClock(secsLeft)
                : 'Autopicking now…'}
            </Text>
          )}
        </View>
      )}

      {oAnswer !== null && (
        <View style={[s.oPanel, { backgroundColor: t.card, borderColor: t.accentText }]}>
          <Text style={[s.oPanelTitle, { color: t.accentText }]}>THE O SAYS</Text>
          <Text style={{ color: t.text, fontSize: 13.5, lineHeight: 19 }}>{oAnswer}</Text>
          <TouchableOpacity onPress={() => setOAnswer(null)}>
            <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 6 }}>dismiss</Text>
          </TouchableOpacity>
        </View>
      )}
      {creditOffer !== null && (
        <View style={[s.oPanel, { backgroundColor: t.card, borderColor: t.warnText }]}>
          <Text style={[s.oPanelTitle, { color: t.warnText }]}>OUT OF PROMPTS</Text>
          <Text style={{ color: t.textSub, fontSize: 13, lineHeight: 18 }}>
            One AI Credit gets you this answer right now — no subscription.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TouchableOpacity style={[s.oBuyBtn, { backgroundColor: t.warnText }]} onPress={buyCreditInline}>
              <Text style={{ color: '#0a1214', fontWeight: '800', fontSize: 13 }}>AI Credit · {creditOffer}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.oBuyAlt} onPress={() => { setCreditOffer(null); router.push('/paywall?context=weekly_prompts_exhausted' as any); }}>
              <Text style={{ color: t.textSub, fontSize: 12.5 }}>or upgrade</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={s.controls}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={[s.search, { flex: 1 }]} placeholder="Search players" placeholderTextColor={t.textMuted} value={q} onChangeText={setQ} />
          <TouchableOpacity
            style={[s.askOBtn, { backgroundColor: t.chartreuseText }, oAsking && { opacity: 0.5 }]}
            onPress={askTheO} disabled={oAsking}
          >
            <Text style={{ color: '#0a1214', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>{oAsking ? 'THINKING…' : 'ASK THE O'}</Text>
          </TouchableOpacity>
        </View>
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
  bannerClock: { fontSize: 12, fontWeight: '600', marginTop: 3, letterSpacing: 0.3 },
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
  askOBtn: { borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  oPanel: { marginHorizontal: 14, marginBottom: 8, borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 4 },
  oPanelTitle: { fontFamily: 'Audiowide_400Regular', fontSize: 11, letterSpacing: 1 },
  oBuyBtn: { borderRadius: 9, paddingHorizontal: 14, paddingVertical: 9 },
  oBuyAlt: { justifyContent: 'center' },
});
