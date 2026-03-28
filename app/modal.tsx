import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, SP, SZ } from './constants/tokens';

export default function ModalScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.title}>AIOmni</Text>
        <Text style={styles.sub}>See everything. Know everyone. Win always.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnTxt}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP[4] },
  title:     { fontFamily: F.bold, fontSize: SZ['3xl'], color: C.gold, marginBottom: 12 },
  sub:       { fontFamily: F.mono, fontSize: SZ.sm, color: C.dim, letterSpacing: 1.5, textAlign: 'center', marginBottom: 40 },
  btn:       { backgroundColor: C.goldS, borderWidth: 1, borderColor: C.goldBorder, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  btnTxt:    { fontFamily: F.bold, color: C.gold, fontSize: SZ.base, letterSpacing: 1 },
});