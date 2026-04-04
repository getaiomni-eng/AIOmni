import { Image, StyleSheet, View } from 'react-native';

type Props = {
  size?: 'small' | 'medium' | 'large';
  width?: number;
  height?: number;
};

export default function AIOmniLogo({ size = 'medium', width, height }: Props) {
  const preset = {
    small:  { width: 60,  height: 30  },
    medium: { width: 140, height: 70  },
    large:  { width: 240, height: 120 },
  };
  const s = { width: width ?? preset[size].width, height: height ?? preset[size].height };
  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/logo.png')}
        style={s}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
