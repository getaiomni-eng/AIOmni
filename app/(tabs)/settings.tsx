import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  Alert, Dimensions, Image, Linking, Modal, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { getUser, signOut } from '../../services/auth';
import { loadESPNCredentials } from '../../services/espn';
import { clearYahooTokens, exchangeYahooCode, getValidYahooToken, getYahooAuthURL, getYahooLeagues, loadYahooTokens } from '../../services/yahoo';
import { Icon } from '../components/AIOmniIcons';
import { AIOmniLogo } from '../components/AIOmniLogo';
import { C, F, SP, SZ } from '../constants/tokens';
import { getRemainingPrompts } from '../utils/promptCounter';

WebBrowser.maybeCompleteAuthSession();

const SURFACE = 'rgba(255,255,255,0.90)';
const BORDER = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

const PLATFORM_LOGOS: Record<string, any> = {
  sleeper: require('../../assets/images/platforms/sleeper.png'),
  espn:    require('../../assets/images/platforms/espn.png'),
  yahoo:   require('../../assets/images/platforms/yahoo.png'),
};

const TIERS = [
  { key: 'rankings',      name: 'Rankings',      price: '$5.99/mo', yearly: '$49.99/yr', prompts: 'No AI Coach', color: '#6b7491' },
  { key: 'pro',           name: 'Pro',           price: '$9.99/mo', yearly: '$89.99/yr', prompts: '75 prompts/wk', color: C.blueDeep },
  { key: 'premium',       name: 'Premium',       price: '$14.99/mo', yearly: '$129.99/yr', prompts: '125 prompts/wk', color: '#fee229' },
  { key: 'dynasty_elite', name: 'Dynasty Elite', price: '$19.99/mo', yearly: '$179.99/yr', prompts: 'Unlimited', color: '#7b5ea7' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [remaining, setRemaining] = useState(25);
  const [espnConnected, setEspnConnected] = useState(false);
  const [espnLeagueName, setEspnLeagueName] = useState('');
  const [yahooConnected, setYahooConnected] = useState(false);
  const [yahooLeagueCount, setYahooLeagueCount] = useState(0);
  const [yahooLoading, setYahooLoading] = useState(false);
  const [sleeperModalVisible, setSleeperModalVisible] = useState(false);
  const [sleeperInput, setSleeperInput] = useState('');

  useEffect(() => {
    (async () => {
      const user = await getUser();
      if (user) setEmail(user.email);
      const stored = await AsyncStorage.getItem('sleeper_username');
      if (stored) setUsername(stored);
      setRemaining(await getRemainingPrompts());

      const espnCreds = await loadESPNCredentials();
      if (espnCreds) {
        setEspnConnected(true);
        const name = await AsyncStorage.getItem('espn_league_name');
        if (name) setEspnLeagueName(name);
      }

      const yahooTokens = await loadYahooTokens();
      if (yahooTokens) {
        setYahooConnected(true);
        try {
          const token = await getValidYahooToken();
          if (token) {
            const leagues = await getYahooLeagues(token);
            setYahooLeagueCount(leagues.length);
          }
        } catch {}
      }
    })();
  }, []);

  const handleConnectSleeper = async () => {
    const trimmed = sleeperInput.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`https://api.sleeper.app/v1/user/${trimmed}`);
      const user = await res.json();
      if (!user?.user_id) {
        Alert.alert('Not Found', `Could not find Sleeper user "${trimmed}". Check spelling.`);
        return;
      }
      await AsyncStorage.setItem('sleeper_username', trimmed);
      setUsername(trimmed);
      setSleeperModalVisible(false);
      setSleeperInput('');
      Alert.alert('Sleeper Connected!', `Linked @${trimmed}. Your leagues will appear on the Home tab.`);
    } catch {
      Alert.alert('Error', 'Could not verify Sleeper username. Check your connection.');
    }
  };

  const handleDisconnectSleeper = () => {
    Alert.alert('Disconnect Sleeper', `Remove @${username} from AIOmni?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        await AsyncStorage.removeItem('sleeper_username');
        setUsername('');
      }},
    ]);
  };

  const handleConnectYahoo = async () => {
    setYahooLoading(true);
    try {
      const authUrl = await getYahooAuthURL();
      const result = await WebBrowser.openAuthSessionAsync(authUrl, 'aiomnifantasy://oauth/yahoo');
      if (result.type === 'success' && result.url) {
        const parsed = new URL(result.url);
        const code = parsed.searchParams.get('code');
        if (code) {
          await exchangeYahooCode(code);
          const token = await getValidYahooToken();
          if (token) {
            const leagues = await getYahooLeagues(token);
            setYahooLeagueCount(leagues.length);
          }
          setYahooConnected(true);
          Alert.alert('Yahoo Connected!', 'Your Yahoo leagues will now appear on the Home tab.');
        }
      }
    } catch (err: any) {
      Alert.alert('Yahoo Error', err?.message ?? 'Could not complete Yahoo connection.');
    } finally {
      setYahooLoading(false);
    }
  };

  const handleDisconnectYahoo = async () => {
    Alert.alert('Disconnect Yahoo', 'Remove your Yahoo account from AIOmni?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        await clearYahooTokens();
        setYahooConnected(false);
        setYahooLeagueCount(0);
      }},
    ]);
  };

  const handleOpenESPN = () => {
    router.push('/espn-login');
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'This will sign you out and clear local league data.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        await signOut();
        await AsyncStorage.removeItem('sleeper_username');
        router.replace('/onboarding');
      }},
    ]);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <AIOmniLogo width={Dimensions.get('window').width * 0.55} />
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="chevron" size={20} color={C.blueDeep} />
              <Text style={styles.backText}>BACK</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.title}>SETTINGS</Text>
        </View>

        {/* ACCOUNT */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACCOUNT</Text>
          <View style={styles.card}>
            <View style={styles.cardShine} />
            <View style={styles.row}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="person" size={22} color={C.blueDeep} />
                <Text style={styles.rowLabel}>Email</Text>
              </View>
              <Text style={styles.rowValue}>{email || 'Not signed in'}</Text>
            </View>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="person" size={22} color={C.blueDeep} />
                <Text style={styles.rowLabel}>Username</Text>
              </View>
              <Text style={styles.rowValue}>{username ? `@${username}` : 'No Sleeper linked'}</Text>
            </View>
            <TouchableOpacity onPress={() => Alert.alert('Change Password', 'Use your email provider to change your password.')} style={styles.linkRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="key" size={18} color={C.gold} />
                <Text style={styles.linkText}>Change password</Text>
                <Icon name="chevron" size={20} color={C.dim2} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* CONNECTED PLATFORMS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CONNECTED PLATFORMS</Text>
          <View style={styles.card}>
            <View style={styles.cardShine} />

            {/* Sleeper */}
            <View style={styles.platformRow}>
              <Image source={PLATFORM_LOGOS.sleeper} style={styles.platformLogo} />
              <View style={{ flex: 1 }}>
                <Text style={styles.platformName}>Sleeper</Text>
                <Text style={styles.platformSub}>{username ? `@${username}` : 'Not connected'}</Text>
              </View>
              {username ? (
                <TouchableOpacity onPress={handleDisconnectSleeper} style={styles.disconnectBtnSmall}>
                  <Text style={styles.disconnectBtnSmallText}>DISCONNECT</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => setSleeperModalVisible(true)} style={styles.connectBtnSmall}>
                  <Text style={styles.connectBtnSmallText}>CONNECT</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ESPN */}
            <View style={styles.platformRow}>
              <Image source={PLATFORM_LOGOS.espn} style={styles.platformLogo} />
              <View style={{ flex: 1 }}>
                <Text style={styles.platformName}>ESPN</Text>
                <Text style={styles.platformSub}>{espnLeagueName || 'Auto-login via browser'}</Text>
              </View>
              {espnConnected ? (
                <Text style={[styles.statusText, { color: C.mint }]}>✓ CONNECTED</Text>
              ) : (
                <TouchableOpacity onPress={handleOpenESPN} style={styles.connectBtnSmall}>
                  <Text style={styles.connectBtnSmallText}>CONNECT</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Yahoo */}
            <View style={[styles.platformRow, { borderBottomWidth: 0 }]}>
              <Image source={PLATFORM_LOGOS.yahoo} style={styles.platformLogo} />
              <View style={{ flex: 1 }}>
                <Text style={styles.platformName}>Yahoo</Text>
                <Text style={styles.platformSub}>{yahooConnected ? `${yahooLeagueCount} leagues connected` : 'OAuth sign-in'}</Text>
              </View>
              {yahooConnected ? (
                <TouchableOpacity onPress={handleDisconnectYahoo} style={styles.disconnectBtnSmall}>
                  <Text style={styles.disconnectBtnSmallText}>DISCONNECT</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={handleConnectYahoo} style={styles.connectBtnSmall} disabled={yahooLoading}>
                  <Text style={styles.connectBtnSmallText}>{yahooLoading ? 'CONNECTING' : 'CONNECT'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* WEEKLY USAGE */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WEEKLY USAGE</Text>
          <View style={styles.card}>
            <View style={styles.cardShine} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Prompts remaining</Text>
              <Text style={[styles.rowValue, { color: C.blueDeep }]}>{remaining}/25</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.min(remaining, 25) * 4}%` }]} />
            </View>
            <Text style={styles.smallText}>Resets Sunday noon · Waivers run Wednesday</Text>
          </View>
        </View>

        {/* UPGRADE TIERS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>UPGRADE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
            {TIERS.map(t => (
              <TouchableOpacity key={t.key} onPress={() => router.push('/paywall')} style={[styles.tierCard, { borderColor: t.color + '60' }]}>
                <View style={[styles.tierDot, { backgroundColor: t.color }]} />
                <Text style={styles.tierName}>{t.name}</Text>
                <Text style={styles.tierPrice}>{t.price}</Text>
                <Text style={styles.tierYearly}>{t.yearly}</Text>
                <Text style={styles.tierPrompts}>{t.prompts}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* APP */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>APP</Text>
          <View style={styles.card}>
            <View style={styles.cardShine} />
            <View style={styles.row}><Text style={styles.rowLabel}>Version</Text><Text style={styles.rowValue}>1.0.0</Text></View>
            <View style={[styles.row, { borderBottomWidth: 0 }]}><Text style={styles.rowLabel}>Platforms</Text><Text style={styles.rowValue}>{`Sleeper${espnConnected ? ' · ESPN' : ''}${yahooConnected ? ' · Yahoo' : ''}`}</Text></View>
          </View>
        </View>

        {/* SUPPORT */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SUPPORT</Text>
          <View style={styles.card}>
            <View style={styles.cardShine} />
            <TouchableOpacity onPress={() => Linking.openURL('mailto:getaiomni@gmail.com')}>
              <Text style={styles.linkText}>Contact Support</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="lock" size={22} color={'#a83040'} />
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.footerText}>AIOmni · See everything. Know everyone. Win always.</Text>
      </ScrollView>

      {/* Sleeper Username Modal */}
      <Modal visible={sleeperModalVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSleeperModalVisible(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Connect Sleeper</Text>
            <Text style={styles.modalSub}>Enter your Sleeper username</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. PatrickTheGM"
              placeholderTextColor={C.dim2}
              value={sleeperInput}
              onChangeText={setSleeperInput}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setSleeperModalVisible(false)} style={[styles.modalBtn, { backgroundColor: 'rgba(88,131,191,0.08)' }]}>
                <Text style={[styles.modalBtnText, { color: C.dim }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleConnectSleeper} style={[styles.modalBtn, { backgroundColor: C.blueDeep, flex: 1 }]}>
                <Text style={[styles.modalBtnText, { color: '#ffffff' }]}>Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SP[3], paddingBottom: 40 },
  header: { paddingTop: 56, paddingBottom: 20 },
  backBtn: { marginBottom: 14 },
  backText: { fontFamily: F.mono, color: C.blueDeep, fontSize: 10, letterSpacing: 2 },
  title: { fontFamily: F.bold, fontSize: 36, color: C.ink, letterSpacing: 3 },

  section: { marginBottom: 22 },
  sectionTitle: { fontFamily: F.bold, color: C.dim2, fontSize: 13, letterSpacing: 2, marginBottom: 10 },
  card: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: BORDER,
    position: 'relative', overflow: 'hidden', shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 18, elevation: 4,
  },
  cardShine: { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: BEVEL_HI, zIndex: 6 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(88,131,191,0.12)' },
  rowLabel: { fontFamily: F.bold, color: C.dim2, fontSize: 16 },
  rowValue: { fontFamily: F.mono, color: C.ink, fontSize: 12 },

  linkRow: { marginTop: 14 },
  linkText: { fontFamily: F.bold, color: C.blueDeep, fontSize: SZ.sm, letterSpacing: 1.5 },

  platformRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(88,131,191,0.12)' },
  platformLogo: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(88,131,191,0.18)' },
  platformName: { fontFamily: F.outfit, color: C.ink, fontSize: SZ.base },
  platformSub: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.sm, marginTop: 2 },
  statusText: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.sm },
  connectBtnSmall: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.blueDeep },
  connectBtnSmallText: { fontFamily: F.mono, color: '#ffffff', fontSize: SZ.xs, letterSpacing: 2 },
  disconnectBtnSmall: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(168,48,64,0.12)' },
  disconnectBtnSmallText: { fontFamily: F.mono, color: '#a83040', fontSize: SZ.xs, letterSpacing: 2 },

  progressBar: { height: 4, backgroundColor: 'rgba(88,131,191,0.12)', borderRadius: 3, overflow: 'hidden', marginTop: 12, marginBottom: 10 },
  progressFill: { height: 4, backgroundColor: C.blueDeep },
  smallText: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, lineHeight: 16, marginBottom: 4 },

  tierCard: {
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1.5, padding: 16, width: 150, alignItems: 'center',
    shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  tierDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 8 },
  tierName: { fontFamily: F.bold, color: C.ink, fontSize: 15, letterSpacing: 1, marginBottom: 4 },
  tierPrice: { fontFamily: F.mono, color: C.blueDeep, fontSize: 14, marginBottom: 2 },
  tierYearly: { fontFamily: F.mono, color: C.dim2, fontSize: 10, marginBottom: 6 },
  tierPrompts: { fontFamily: F.mono, color: C.dim, fontSize: 10, letterSpacing: 0.5 },

  signOutBtn: { borderWidth: 1.5, borderColor: 'rgba(168,48,64,0.3)', borderRadius: 14, padding: 16, alignItems: 'center', marginVertical: 18, backgroundColor: 'rgba(168,48,64,0.05)' },
  signOutText: { fontFamily: F.mono, color: '#a83040', fontSize: SZ.sm, letterSpacing: 2 },
  footerText: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs, textAlign: 'center', letterSpacing: 1, marginBottom: 24 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, width: '85%' },
  modalTitle: { fontFamily: F.bold, color: C.ink, fontSize: 22, marginBottom: 4 },
  modalSub: { fontFamily: F.mono, color: C.dim2, fontSize: 12, marginBottom: 16 },
  modalInput: {
    backgroundColor: 'rgba(88,131,191,0.06)', borderRadius: 12, borderWidth: 1.5, borderColor: BORDER,
    padding: 14, fontFamily: F.mono, fontSize: 16, color: C.ink, marginBottom: 16,
  },
  modalBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center' },
  modalBtnText: { fontFamily: F.bold, fontSize: 14, letterSpacing: 1 },
});
