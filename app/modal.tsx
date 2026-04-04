import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, SP, SZ } from './constants/tokens';

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

export default function ModalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <View style={styles.card}>
          <View style={styles.cardShine} />
          <Text style={styles.title}>AIOmni</Text>
          <Text style={styles.sub}>See everything. Know everyone. Win always.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnTxt}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, alignItems:'center', justifyContent:'center', padding:SP[4] },
  card: {
    backgroundColor:SURFACE, borderRadius:20, padding:32,
    borderWidth:1.5, borderColor:BORDER, alignItems:'center',
    position:'relative', overflow:'hidden', width:'100%',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:6}, shadowOpacity:0.12, shadowRadius:18, elevation:6,
  },
  cardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  title:  { fontFamily:F.bold, fontSize:SZ['3xl'], color:C.blueDeep, marginBottom:12 },
  sub:    { fontFamily:F.mono, fontSize:SZ.sm, color:C.dim2, letterSpacing:1.5, textAlign:'center', marginBottom:40 },
  btn:    { backgroundColor:C.gold, borderRadius:14, paddingHorizontal:28, paddingVertical:14 },
  btnTxt: { fontFamily:F.bold, color:C.ink, fontSize:SZ.base, letterSpacing:1 },
});