import { Image } from 'react-native';

export default function TabIcon({ focused }: { focused: boolean }) {
  return (
    <Image
      source={require('../../assets/images/logo.png')}
      style={{ width: 26, height: 26, opacity: focused ? 1 : 0.5 }}
      resizeMode="contain"
    />
  );
}
