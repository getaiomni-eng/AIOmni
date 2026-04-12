import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, ActivityIndicator } from 'react-native';

export default function YahooCallback() {
  const { code } = useLocalSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (code) {
      AsyncStorage.setItem('yahoo_auth_code', code as string).then(() => {
        router.replace('/(tabs)');
      });
    }
  }, [code]);
  return <View style={{flex:1,backgroundColor:'#0a1214',alignItems:'center',justifyContent:'center'}}><ActivityIndicator color="#1be7ff" size="large"/></View>;
}
