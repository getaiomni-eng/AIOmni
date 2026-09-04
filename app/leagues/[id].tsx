// Hosted league detail: members, standings, invite, my weekly lineups.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hostedStandings, myAppId, myHostedLeagues, setLeagueDuesUrl, type HostedLeague } from '../../services/hostedLeagues';
import { supabase } from '../../services/supabase';
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

  const load = useCallback(async () => {
    const all = await myHostedLeagues();
    const lg = all.find(l => l.id === id) ?? null;
    setLeague(lg);
    if (!lg) return;
    setRows(await hostedStandings(lg.id));
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
  useEffect(() => { load(); myAppId().then(setMeId); }, [load]);

  const invite = async () => {
    if (!league) return;
    const msg = `Join my AIOmni best ball league "${league.name}" — code ${league.invite_code}. Free in the AIOmni app: https://apps.apple.com/app/id6760617627`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(msg); } catch {}
      window.alert('Invite copied to clipboard.');
    } else {
      Share.share({ message: msg });
    }
  };

  if (!league) return (
    <View style={[s.container, { paddingTop: insets.top + 20, alignItems: 'center' }]}>
      <ActivityIndicator color={t.accentText} />
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
              <Text style={s.fine}>Drafting opens in the app this month — everyone who has joined will be in the room.</Text>
            </>
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
              if (res.error) { if (Platform.OS === 'web') window.alert(res.error); return; }
              setDuesDraft(''); load();
            }}>
              <Text style={s.ctaText}>Attach LeagueSafe link</Text>
            </TouchableOpacity>
            <Text style={s.fine}>No LeagueSafe pot yet? Create one at leaguesafe.com/createleague, then paste its link here.</Text>
          </View>
        ) : null}

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
  cta: { backgroundColor: t.accentText, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  ctaText: { color: '#0a1214', fontWeight: '700', fontSize: 13.5 },
  fine: { color: t.textMuted, fontSize: 11.5 },
  duesInput: { borderWidth: 1, borderColor: t.border, backgroundColor: t.inputBg, color: t.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  slot: { color: t.textSub, fontSize: 12.5 },
  slotPts: { color: t.textSub, fontSize: 12.5, fontVariant: ['tabular-nums'] },
});
