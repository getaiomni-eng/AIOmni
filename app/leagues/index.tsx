// AIOmni Leagues (BETA) hub — hosted best ball, P1 (2026-09-04).
// Create a league, join by code, see yours. Engine + RPCs shipped and
// verified 2026-09-04; the draft room wires in next increment, so an
// 'open' league honestly says drafting is about to arrive.
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, Share, StyleSheet, Text, TextInput,
  TouchableOpacity, View, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createHostedLeague, joinHostedLeague, myHostedLeagues, type HostedLeague,
} from '../../services/hostedLeagues';
import { supabase } from '../../services/supabase';
import { Alert } from '../../services/util/crossAlert';
import { useTheme, type ThemeTokens } from '../constants/theme';

export default function LeaguesHub() {
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [leagues, setLeagues] = useState<HostedLeague[] | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'season' | 'weekly'>('season');

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSignedIn(!!session);
    if (session) setLeagues(await myHostedLeagues());
  }, []);
  useEffect(() => { load(); }, [load]);

  const onCreate = async () => {
    if (!name.trim()) { Alert.alert('Name your league', 'Give it a name first.'); return; }
    setBusy(true);
    const res = await createHostedLeague(name.trim(), 12, kind);
    setBusy(false);
    if ('error' in res) { Alert.alert('Could not create league', res.error); return; }
    setName('');
    await load();
    Alert.alert('League created', `Invite code: ${res.inviteCode}\n\nShare it with your league — they join in seconds.`);
  };

  const onJoin = async () => {
    if (code.trim().length < 4) { Alert.alert('Enter a code', 'Invite codes are 6 characters.'); return; }
    setBusy(true);
    const res = await joinHostedLeague(code.trim(), teamName.trim());
    setBusy(false);
    if ('error' in res) { Alert.alert('Could not join', res.error); return; }
    setCode(''); setTeamName('');
    await load();
    router.push(`/leagues/${res.leagueId}` as any);
  };

  return (
    <View style={[s.container, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[s.back, { color: t.textSub }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>AIOMNI LEAGUES</Text>
        <Text style={s.beta}>NEW</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 14 }}>
        <Text style={s.tagline}>
          Best ball, run by the AI. No commissioner, no lineups, no waivers —
          draft your team and the best score sets itself every week.
        </Text>

        {signedIn === false && (
          <View style={s.card}><Text style={s.body}>Sign in to create or join a league.</Text></View>
        )}

        {signedIn && (
          <>
            <Text style={s.section}>MY LEAGUES</Text>
            {leagues === null && <ActivityIndicator color={t.accentText} />}
            {leagues?.length === 0 && (
              <View style={s.card}><Text style={s.body}>No leagues yet — create one below or join with a code.</Text></View>
            )}
            {leagues?.map(l => (
              <TouchableOpacity key={l.id} style={s.card} onPress={() => router.push(`/leagues/${l.id}` as any)}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={s.leagueName}>{l.name}</Text>
                  <Text style={[s.status, { color: l.draft_status === 'complete' ? t.successText : t.warnText }]}>
                    {l.draft_status === 'complete' ? 'LIVE' : l.draft_status === 'drafting' ? 'DRAFTING' : 'PRE-DRAFT'}
                  </Text>
                </View>
                <Text style={s.meta}>{l.team_count}-team best ball · {l.season} · code {l.invite_code}</Text>
              </TouchableOpacity>
            ))}

            <Text style={s.section}>CREATE A LEAGUE</Text>
            <View style={s.card}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[s.kindChip, kind === 'season' && { backgroundColor: t.accentText }]} onPress={() => setKind('season')}>
                  <Text style={[s.kindText, kind === 'season' && { color: '#0a1214' }]}>SEASON</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.kindChip, kind === 'weekly' && { backgroundColor: t.accentText }]} onPress={() => setKind('weekly')}>
                  <Text style={[s.kindText, kind === 'weekly' && { color: '#0a1214' }]}>WEEKLY RUN</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={s.input} placeholder="League name" placeholderTextColor={t.textMuted}
                value={name} onChangeText={setName} maxLength={40}
              />
              <TouchableOpacity style={s.cta} onPress={onCreate} disabled={busy}>
                <Text style={s.ctaText}>{busy ? '…' : 'Create a league — free'}</Text>
              </TouchableOpacity>
              <Text style={s.fine}>Season: 18 rounds, weeks 1-18. Weekly run: 9 rounds, one week, done. PPR · live snake draft · free while new</Text>
            </View>

            <Text style={s.section}>JOIN WITH A CODE</Text>
            <View style={s.card}>
              <TextInput
                style={s.input} placeholder="Invite code" placeholderTextColor={t.textMuted}
                value={code} onChangeText={c => setCode(c.toUpperCase())} autoCapitalize="characters" maxLength={6}
              />
              <TextInput
                style={s.input} placeholder="Your team name" placeholderTextColor={t.textMuted}
                value={teamName} onChangeText={setTeamName} maxLength={30}
              />
              <TouchableOpacity style={s.cta} onPress={onJoin} disabled={busy}>
                <Text style={s.ctaText}>{busy ? '…' : 'Join league'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  back: { fontSize: 15 },
  title: { fontFamily: 'Audiowide_400Regular', fontSize: 16, color: t.text, letterSpacing: 1.5, flex: 1 },
  beta: { fontFamily: 'Audiowide_400Regular', fontSize: 10, color: t.chartreuseText, letterSpacing: 1 },
  tagline: { color: t.textSub, fontSize: 13.5, lineHeight: 19 },
  section: { fontFamily: 'Audiowide_400Regular', fontSize: 11, color: t.textSub, letterSpacing: 1.2, marginTop: 6 },
  card: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 14, padding: 14, gap: 10 },
  body: { color: t.textSub, fontSize: 13.5 },
  leagueName: { color: t.text, fontSize: 15, fontWeight: '700' },
  status: { fontFamily: 'Audiowide_400Regular', fontSize: 10, letterSpacing: 1 },
  meta: { color: t.textMuted, fontSize: 12 },
  input: { borderWidth: 1, borderColor: t.border, backgroundColor: t.inputBg, color: t.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  cta: { backgroundColor: t.accentText, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  ctaText: { color: '#0a1214', fontWeight: '700', fontSize: 14 },
  fine: { color: t.textMuted, fontSize: 11.5 },
  kindChip: { borderWidth: 1, borderColor: t.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: t.inputBg },
  kindText: { color: t.textSub, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
