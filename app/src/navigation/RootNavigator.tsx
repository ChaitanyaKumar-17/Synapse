import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { useAuthStore } from '../store/authStore';
import { AuthScreen } from '../screens/AuthScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { NotebookScreen } from '../screens/NotebookScreen';
import { NoteScreen } from '../screens/NoteScreen';
import { TodoListScreen } from '../screens/TodoListScreen';

// Placeholders for remaining screens
const ChatScreen = () => (
  <View style={[styles.container, { borderColor: colors.accents.chat, borderWidth: 4 }]}>
    <Text style={styles.text}>RAG Chat (Coming in Phase 7)</Text>
  </View>
);

export type RootStackParamList = {
  Auth: undefined;
  Home: undefined;
  Notebook: { notebookId: string; name?: string };
  Note: { noteId: string; title?: string };
  TodoList: { listId: string; title?: string };
  Chat: { notebookId?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  const session = useAuthStore((state) => state.session);

  return (
    <Stack.Navigator 
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
        headerBackTitleVisible: false,
      }}
    >
      {session ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Notebook" component={NotebookScreen} />
          <Stack.Screen name="Note" component={NoteScreen} options={{ title: '' }} />
          <Stack.Screen name="TodoList" component={TodoListScreen} options={{ title: '' }} />
          <Stack.Screen name="Chat" component={ChatScreen} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: colors.textPrimary,
    fontSize: 18,
  },
});
