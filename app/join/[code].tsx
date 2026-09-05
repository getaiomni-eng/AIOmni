// Invite landing: app.getaiomni.com/join/CODE (2026-09-05).
// The commissioner shares one link; friends land here, see the league,
// and join in two taps. Signed-out visitors get pointed at auth first.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { joinHostedLeague } from '../../services/hostedLeagues';
import { supabase } from '../../services/supabase';
import { Alert } from '../../services/util/crossAlert';
import { useTheme, type ThemeTokens } from '../constants/theme';

type Preview = { name: string; league_kind: string; team_count: number; joined: number; draft_status: string };

export default function JoinByLink() {
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [preview, setPreview] = useState<Preview | null | 'missing'>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSignedIn(!!session);
      const { data } = await supabase.rpc('hosted_league_preview', { p_code: code });
      const row = Array.isArray(data) ? data[0] : data;
      setPreview(row ?? 'missing');
    })();
  }, [code]);

  const onJoin = async () => {
    setBusy(true);
    const res = await joinHostedLeague(String(code), teamName.trim());
    setBusy(false);
    if ('error' in res) { Alert.alert('Could not join', res.error); return; }
    router.replace(('/leagues/' + res.leagueId) as any);
  };

  return (
    <View style={[s.container, { paddingTop: insets.top + 24 }]}>
      <Text style={s.brand}>AIOMNI LEAGUES</Text>
      {preview === null && <ActivityIndicator color={t.accentText} style={{ marginTop: 30 }} />}
      {preview === 'missing' && (
        <View style={s.card}><Text style={s.body}>No league found for code {String(code).toUpperCase()}.</Text></View>
      )}
      {preview !== null && preview !== 'missing' && (
        <View style={s.card}>
          <Text style={s.name}>{preview.name}</Text>
          <Text style={s.meta}>
            {preview.league_kind === 'weekly' ? 'Weekly run' : 'Season best ball'} · {preview.joined}/{preview.team_count} teams · {preview.draft_status === 'open' ? 'accepting teams' : preview.draft_status === 'drafting' ? 'draft in progress' : 'draft complete'}
          </Text>
          {preview.draft_status !== 'open' ? (
            <Text style={s.body}>This draft has already started — ask the commissioner for the next one.</Text>
          ) : signedIn === false ? (
            <>
              <Text style={s.body}>Sign in (free), then open this link again to claim your spot.</Text>
              <TouchableOpacity style={s.cta} onPress={() => router.push('/auth' as any)}>
                <Text style={s.ctaText}>Sign in / create account</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TextInput
                style={s.input} placeholder="Your team name" placeholderTextColor={t.textMuted}
                value={teamName} onChangeText={setTeamName} maxLength={30}
              />
              <TouchableOpacity style={s.cta} onPress={onJoin} disabled={busy}>
                <Text style={s.ctaText}>{busy ? '…' : 'Join this league'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg, paddingHorizontal: 20, gap: 16 },
  brand: { fontFamily: 'Audiowide_400Regular', fontSize: 15, color: t.text, letterSpacing: 2, textAlign: 'center' },
  card: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 16, padding: 18, gap: 12, maxWidth: 440, width: '100%', alignSelf: 'center' },
  name: { color: t.text, fontSize: 19, fontWeight: '800' },
  meta: { color: t.textSub, fontSize: 13.5 },
  body: { color: t.textSub, fontSize: 14, lineHeight: 20 },
  input: { borderWidth: 1, borderColor: t.border, backgroundColor: t.inputBg, color: t.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  cta: { backgroundColor: t.accentText, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  ctaText: { color: '#0a1214', fontWeight: '700', fontSize: 14.5 },
});
