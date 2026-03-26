import { Image, StyleSheet, View } from 'react-native';

type Props = {
  size?: 'small' | 'medium' | 'large';
};

export default function AIOmniLogo({ size = 'medium' }: Props) {
  const sizes = {
    small:  { width: 60,  height: 60  },
    medium: { width: 100, height: 100 },
    large:  { width: 160, height: 160 },
  };

  const s = sizes[size];

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/logo.png')}
        style={{ width: s.width, height: s.height }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
