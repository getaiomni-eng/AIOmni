// Hosted league detail: members, standings, invite, my weekly lineups.
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteHostedLeague, hostedStandings, leaveHostedLeague, myAppId, myHostedLeagues, setLeagueDuesUrl, startHostedDraft, type HostedLeague } from '../../services/hostedLeagues';
import { supabase } from '../../services/supabase';
import { Alert } from '../../services/util/crossAlert';
import { useTheme, type ThemeTokens } from '../constants/theme';

type Row = { user_id: string; team_name: string; total: number; weeks: number };
type WeekScore = { week: number; points: number; lineup: { slot: string; name: string; pts: number }[] };

export default function LeagueDetail() {
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [league, setLeague] = useState<HostedLeague | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [myWeeks, setMyWeeks] = useState<WeekScore[]>([]);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [duesDraft, setDuesDraft] = useState('');
  const [recap, setRecap] = useState<{ week: number; content: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);   // sync twin — state alone leaves an async hole

  const load = useCallback(async () => {
    const all = await myHostedLeagues();
    const lg = all.find(l => l.id === id) ?? null;
    setLeague(lg);
    if (!lg) return;
    setRows(await hostedStandings(lg.id));
    const { data: rc } = await supabase.from('hosted_recaps')
      .select('week, content').eq('league_id', lg.id)
      .order('week', { ascending: false }).limit(1);
    setRecap((rc?.[0] as any) ?? null);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: me } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
      if (me) {
        const { data: ws } = await supabase.from('hosted_weekly_scores')
          .select('week, points, lineup').eq('league_id', lg.id).eq('user_id', me.id)
          .order('week', { ascending: false });
        setMyWeeks((ws ?? []).map((w: any) => ({ week: w.week, points: Number(w.points), lineup: w.lineup })));
      }
    }
  }, [id]);
  useEffect(() => { myAppId().then(setMeId); }, []);
  // Audit fix: state went stale after draft-room round trips and background
  // changes (a second phone never saw the draft start). Reload on focus.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const invite = async () => {
    if (!league) return;
    const msg = `Join my AIOmni best ball league "${league.name}" — tap https://app.getaiomni.com/join/${league.invite_code} (code ${league.invite_code}). Free, and the app is at https://apps.apple.com/app/id6760617627`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(msg); } catch {}
      window.alert('Invite copied to clipboard.');
    } else {
      Share.share({ message: msg });
    }
  };

  if (!league) return (
    <View style={[s.container, { paddingTop: insets.top + 20, alignItems: 'center', gap: 14 }]}>
      <ActivityIndicator color={t.accentText} />
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={{ color: t.textSub, fontSize: 14 }}>{'\u2039'} Back</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[s.container, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={{ color: t.textSub, fontSize: 15 }}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{league.name}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 14 }}>
        <View style={s.card}>
          <Text style={s.meta}>{league.team_count}-team best ball {'\u00b7'} {league.season} {'\u00b7'} {league.draft_status === 'complete' ? 'live, scoring weekly' : league.draft_status === 'drafting' ? 'draft in progress' : 'waiting on the draft'}</Text>
          {league.draft_status === 'open' && (
            <>
              <TouchableOpacity style={s.cta} onPress={invite}>
                <Text style={s.ctaText}>Share invite {'\u00b7'} code {league.invite_code}</Text>
              </TouchableOpacity>
              {meId === league.creator_id && (
                <TouchableOpacity
                  style={[s.cta, { backgroundColor: t.chartreuseText }, starting && { opacity: 0.5 }]}
                  disabled={starting}
                  onPress={async () => {
                    // The server serializes on SELECT ... FOR UPDATE, so a
                    // double tap used to raise 'draft already started' and put
                    // a red "Could not start the draft" alert in front of the
                    // commissioner for a draft that had, in fact, started.
                    if (starting || startingRef.current) return;
                    startingRef.current = true;
                    setStarting(true);
                    try {
                      const res = await startHostedDraft(league.id);
                      if (res.error) { Alert.alert('Could not start the draft', res.error); return; }
                      router.push(('/leagues/draft/' + league.id) as any);
                    } finally {
                      setStarting(false);
                      startingRef.current = false;
                    }
                  }}>
                  <Text style={s.ctaText}>{starting ? 'Starting…' : 'Start the draft'}</Text>
                </TouchableOpacity>
              )}
              <Text style={s.fine}>Snake order is randomized at start. Everyone who has joined drafts live from their own phone.</Text>
            </>
          )}
          {league.draft_status === 'drafting' && (
            <TouchableOpacity style={s.cta} onPress={() => router.push(('/leagues/draft/' + league.id) as any)}>
              <Text style={s.ctaText}>Enter the draft room</Text>
            </TouchableOpacity>
          )}
        </View>


        {/* Dues live at LeagueSafe — AIOmni never holds money. Creator pastes
            the pot link once; every member gets a pay button. */}
        {league.dues_url ? (
          <TouchableOpacity style={s.cta} onPress={() => Linking.openURL(league.dues_url!)}>
            <Text style={s.ctaText}>Pay dues on LeagueSafe</Text>
          </TouchableOpacity>
        ) : meId === league.creator_id ? (
          <View style={{ gap: 8 }}>
            <TextInput
              style={s.duesInput}
              placeholder="Paste your LeagueSafe league link"
              placeholderTextColor={t.textMuted}
              value={duesDraft} onChangeText={setDuesDraft} autoCapitalize="none"
            />
            <TouchableOpacity style={s.cta} onPress={async () => {
              const res = await setLeagueDuesUrl(league.id, duesDraft.trim());
              if (res.error) { Alert.alert('Could not attach link', res.error); return; }
              setDuesDraft(''); load();
              Alert.alert('Dues link attached', 'Members now see a Pay dues button.');
            }}>
              <Text style={s.ctaText}>Attach LeagueSafe link</Text>
            </TouchableOpacity>
            <Text style={s.fine}>No LeagueSafe pot yet? Create one at leaguesafe.com/createleague, then paste its link here.</Text>
          </View>
        ) : null}

        {recap && (
          <>
            <Text style={s.section}>THE COMMISSIONER · WEEK {recap.week}</Text>
            <View style={s.card}><Text style={[s.body, { color: t.text }]}>{recap.content}</Text></View>
          </>
        )}

        <Text style={s.section}>STANDINGS</Text>
        {rows === null && <ActivityIndicator color={t.accentText} />}
        {rows?.map((r, i) => (
          <View key={r.user_id} style={s.row}>
            <Text style={s.rank}>{i + 1}</Text>
            <Text style={s.team} numberOfLines={1}>{r.team_name}</Text>
            <Text style={s.pts}>{r.total.toFixed(1)}</Text>
          </View>
        ))}

        {myWeeks.length > 0 && <Text style={s.section}>MY WEEKS</Text>}
        {league.draft_status === 'open' && (
          meId === league.creator_id ? (
            <TouchableOpacity onPress={() => Alert.alert('Delete this league?', 'This removes the league and all members. It cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => {
                const res = await deleteHostedLeague(league.id);
                if (res.error) { Alert.alert('Could not delete', res.error); return; }
                router.back();
              } },
            ])}>
              <Text style={[s.fine, { color: t.dangerText, textAlign: 'center', marginTop: 8 }]}>Delete league</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => Alert.alert('Leave this league?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Leave', style: 'destructive', onPress: async () => {
                const res = await leaveHostedLeague(league.id);
                if (res.error) { Alert.alert('Could not leave', res.error); return; }
                router.back();
              } },
            ])}>
              <Text style={[s.fine, { color: t.dangerText, textAlign: 'center', marginTop: 8 }]}>Leave league</Text>
            </TouchableOpacity>
          )
        )}

        {myWeeks.map(w => (
          <TouchableOpacity key={w.week} style={s.card} onPress={() => setOpenWeek(openWeek === w.week ? null : w.week)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={s.team}>Week {w.week}</Text>
              <Text style={s.pts}>{w.points.toFixed(1)}</Text>
            </View>
            {openWeek === w.week && w.lineup?.map((p, j) => (
              <View key={j} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.slot}>{p.slot}  {p.name}</Text>
                <Text style={s.slotPts}>{Number(p.pts).toFixed(1)}</Text>
              </View>
            ))}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontFamily: 'Audiowide_400Regular', fontSize: 15, color: t.text, letterSpacing: 1, flex: 1 },
  section: { fontFamily: 'Audiowide_400Regular', fontSize: 11, color: t.textSub, letterSpacing: 1.2, marginTop: 6 },
  card: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 14, padding: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  rank: { fontFamily: 'Audiowide_400Regular', color: t.accentText, fontSize: 14, width: 22 },
  team: { color: t.text, fontSize: 14, fontWeight: '600', flex: 1 },
  pts: { color: t.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  meta: { color: t.textMuted, fontSize: 12.5 },
  body: { color: t.textSub, fontSize: 13.5, lineHeight: 20 },
  cta: { backgroundColor: t.accentText, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  ctaText: { color: '#0a1214', fontWeight: '700', fontSize: 13.5 },
  fine: { color: t.textMuted, fontSize: 11.5 },
  duesInput: { borderWidth: 1, borderColor: t.border, backgroundColor: t.inputBg, color: t.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  slot: { color: t.textSub, fontSize: 12.5 },
  slotPts: { color: t.textSub, fontSize: 12.5, fontVariant: ['tabular-nums'] },
});
