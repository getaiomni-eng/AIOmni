import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, ActivityIndicator } from 'react-native';

export default function YahooCallback() {
  const { code } = useLocalSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (code) {
      // The auth code is exchanged via the WebBrowser return path in
      // Settings — persisting it here was a dead write of a credential
      // to unencrypted storage. Just route home.
      router.replace('/(tabs)');
    }
  }, [code]);
  return <View style={{flex:1,backgroundColor:'#0a1214',alignItems:'center',justifyContent:'center'}}><ActivityIndicator color="#1be7ff" size="large"/></View>;
}
