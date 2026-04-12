import React from 'react';
import { Text } from 'react-native';
import { F } from "../constants/tokens";

export const GlowText = ({ children, fontSize = 16, color = "#f0f4f5", style, ...props }: any) => (
  <Text style={[{ fontSize, color, fontFamily: F.bold }, style]} {...props}>{children}</Text>
);
export const GoldScore = ({ children, fontSize = 22, ...props }: any) => (
  <Text style={{ fontSize, color: "#ffb800", fontFamily: F.bold }} {...props}>{children}</Text>
);
export const BlueScore = ({ children, fontSize = 22, ...props }: any) => (
  <Text style={{ fontSize, color: "#1be7ff", fontFamily: F.bold }} {...props}>{children}</Text>
);
export const CardScore = ({ children, fontSize = 22, ...props }: any) => (
  <Text style={{ fontSize, color: "#f0f4f5", fontFamily: F.bold }} {...props}>{children}</Text>
);
