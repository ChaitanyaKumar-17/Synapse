import 'react-native-url-polyfill/auto';
import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { RootNavigator, RootStackParamList } from './src/navigation/RootNavigator';
import * as Notifications from 'expo-notifications';
import { colors } from './src/theme/colors';
import { supabase } from './src/lib/supabase';
import { useAuthStore } from './src/store/authStore';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

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

    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.itemId && data?.itemType) {
        if (navigationRef.isReady()) {
          if (data.itemType === 'note') {
            navigationRef.navigate('Note', { noteId: data.itemId, title: '' });
          } else if (data.itemType === 'todo_list') {
            navigationRef.navigate('TodoList', { listId: data.itemId, title: '' });
          }
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      Notifications.removeNotificationSubscription(responseListener);
    };
  }, [setSession]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer theme={NavigationTheme} ref={navigationRef}>
        <RootNavigator />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
