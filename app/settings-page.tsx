import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from '../services/auth';
import { clearESPNCredentials } from '../services/espn';
import { dark, F, palette, SP } from './constants/tokens';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [espnLinked, setEspnLinked] = useState(false);
  const [yahooLinked, setYahooLinked] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const u = await AsyncStorage.getItem('sleeper_username');
    if (u) setUsername(u);
    const e = await AsyncStorage.getItem('user_email');
    if (e) setEmail(e);
    const espn = await AsyncStorage.getItem('espn_s2');
    setEspnLinked(!!espn);
    const yahoo = await AsyncStorage.getItem('yahoo_tokens');
    setYahooLinked(!!yahoo);
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await signOut();
          await AsyncStorage.multiRemove(['sleeper_username', 'user_email']);
          router.replace('/onboarding');
        }
      },
    ]);
  };

  const handleDisconnectESPN = () => {
    Alert.alert('Disconnect ESPN', 'Remove ESPN credentials?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => { await clearESPNCredentials(); setEspnLinked(false); } },
    ]);
  };

  const handleDisconnectYahoo = () => {
    Alert.alert('Disconnect Yahoo', 'Remove Yahoo connection?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => { const { clearYahooTokens } = require('../services/yahoo'); await clearYahooTokens(); setYahooLinked(false); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingTop: insets.top + 16, paddingBottom: 100 }}>
        
        <Text style={s.title}>SETTINGS</Text>

        {/* Account */}
        <Text style={s.sectionTitle}>ACCOUNT</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Ionicons name="mail-outline" size={20} color={palette.aqua} />
            <Text style={s.rowLabel}>Email</Text>
            <Text style={s.rowValue}>{email || 'Not set'}</Text>
          </View>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="lock-closed-outline" size={20} color={palette.aqua} />
            <Text style={s.rowLabel}>Password</Text>
            <Text style={s.rowValue}>••••••••</Text>
          </View>
        </View>

        {/* Platforms */}
        <Text style={s.sectionTitle}>MY PLATFORMS</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={() => {
            Alert.prompt(
              'Sleeper Username',
              'Enter your Sleeper username (without @)',
              async (text) => {
                if (text && text.trim()) {
                  const clean = text.trim().replace('@', '');
                  try {
                    const res = await fetch('https://api.sleeper.app/v1/user/' + clean);
                    const data = await res.json();
                    if (data && data.user_id) {
                      await AsyncStorage.setItem('sleeper_username', clean);
                      setUsername(clean);
                      Alert.alert('Connected', 'Sleeper account @' + clean + ' linked successfully.');
                    } else {
                      Alert.alert('Not Found', 'No Sleeper user found with that username.');
                    }
                  } catch {
                    Alert.alert('Error', 'Could not verify username. Try again.');
                  }
                }
              },
              'plain-text',
              username || ''
            );
          }}>
            <View style={[s.dot, { backgroundColor: '#00FFF9' }]} />
            <Text style={s.rowLabel}>Sleeper</Text>
            <Text style={[s.rowValue, { color: username ? palette.green : palette.amber }]}>{username ? '@' + username : 'Connect →'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={espnLinked ? handleDisconnectESPN : () => router.push('/espn-login' as any)}>
            <View style={[s.dot, { backgroundColor: '#e52534' }]} />
            <Text style={s.rowLabel}>ESPN</Text>
            <Text style={[s.rowValue, { color: espnLinked ? palette.green : palette.amber }]}>{espnLinked ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={yahooLinked ? handleDisconnectYahoo : async () => {
              try {
                const { getYahooAuthURL, exchangeYahooCode } = require('../services/yahoo');
                const WebBrowser = require('expo-web-browser');
                const authUrl = await getYahooAuthURL();
                const result = await WebBrowser.openAuthSessionAsync(authUrl, 'aiomnifantasy://oauth/yahoo');
                if (result.type === 'success' && result.url) {
                  const parsed = new URL(result.url);
                  const code = parsed.searchParams.get('code');
                  if (code) {
                    await exchangeYahooCode(code);
                    setYahooLinked(true);
                    Alert.alert('Yahoo Connected!', 'Your Yahoo leagues will appear on the Home tab.');
                  }
                }
              } catch (err: any) { Alert.alert('Yahoo Error', err.message || 'Failed to connect'); }
            }}>
            <View style={[s.dot, { backgroundColor: '#7c3aed' }]} />
            <Text style={s.rowLabel}>Yahoo</Text>
            <Text style={[s.rowValue, { color: yahooLinked ? palette.green : palette.amber }]}>{yahooLinked ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>
        </View>

        {/* Appearance */}
        <Text style={s.sectionTitle}>APPEARANCE</Text>
        <View style={s.card}>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="moon-outline" size={20} color={palette.aqua} />
            <Text style={s.rowLabel}>Dark Mode</Text>
            <Switch
              value={darkMode}
              onValueChange={setDarkMode}
              trackColor={{ false: dark.border, true: palette.aqua }}
              thumbColor={darkMode ? dark.text : dark.textMuted}
            />
          </View>
        </View>

        {/* Notifications */}
        <Text style={s.sectionTitle}>NOTIFICATIONS</Text>
        <View style={s.card}>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="notifications-outline" size={20} color={palette.aqua} />
            <Text style={s.rowLabel}>Push Notifications</Text>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: dark.border, true: palette.aqua }}
              thumbColor={notifications ? dark.text : dark.textMuted}
            />
          </View>
        </View>

        {/* App */}
        <Text style={s.sectionTitle}>APP</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={() => router.push('/paywall' as any)}>
            <Ionicons name="star-outline" size={20} color={palette.amber} />
            <Text style={s.rowLabel}>Upgrade Plan</Text>
            <Text style={[s.rowValue, { color: palette.amber }]}>Free →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL('mailto:aiomni@getaiomni.com')}>
            <Ionicons name="chatbubble-outline" size={20} color={palette.aqua} />
            <Text style={s.rowLabel}>Send Feedback</Text>
            <Ionicons name="chevron-forward" size={16} color={dark.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL('https://getaiomni.com')}>
            <Ionicons name="globe-outline" size={20} color={palette.aqua} />
            <Text style={s.rowLabel}>Website</Text>
            <Ionicons name="chevron-forward" size={16} color={dark.textMuted} />
          </TouchableOpacity>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="information-circle-outline" size={20} color={palette.aqua} />
            <Text style={s.rowLabel}>Version</Text>
            <Text style={s.rowValue}>1.0.0 (beta)</Text>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutTxt}>SIGN OUT</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  title:        { fontFamily: F.bold, fontSize: 32, color: dark.text, letterSpacing: 2, marginBottom: 24 },
  sectionTitle: { fontFamily: F.bold, fontSize: 11, letterSpacing: 2, color: dark.textMuted, marginBottom: 8, marginTop: 16 },
  card:         { backgroundColor: dark.card, borderRadius: 14, borderWidth: 1, borderColor: dark.border, marginBottom: 8, overflow: 'hidden' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: dark.border },
  rowLabel:     { flex: 1, fontFamily: F.body, fontSize: 14, color: dark.text },
  rowValue:     { fontFamily: F.body, fontSize: 13, color: dark.textMuted },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  signOutBtn:   { backgroundColor: palette.flame + '15', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 24, borderWidth: 1, borderColor: palette.flame + '30' },
  signOutTxt:   { fontFamily: F.bold, fontSize: 14, color: palette.flame, letterSpacing: 2 },
});