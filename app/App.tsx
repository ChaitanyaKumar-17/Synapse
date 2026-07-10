import 'react-native-url-polyfill/auto';
import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme/colors';

const NavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.textPrimary,
    border: colors.surface,
    primary: colors.accents.home,
  },
};

export default function App() {
  return (
    <NavigationContainer theme={NavigationTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
}
