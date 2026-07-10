import 'react-native-url-polyfill/auto';
import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme/colors';
import { supabase } from './src/lib/supabase';
import { useAuthStore } from './src/store/authStore';

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
  const setSession = useAuthStore((state) => state.setSession);

  useEffect(() => {
    // Clear stale auth hash from URL on Web to prevent Supabase 403s on reload
    if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    // Initial fetch of session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [setSession]);

  return (
    <NavigationContainer theme={NavigationTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
}
