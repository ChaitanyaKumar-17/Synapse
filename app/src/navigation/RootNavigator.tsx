import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

// Placeholder screens for Phase 0
const HomeScreen = () => (
  <View style={[styles.container, { borderColor: colors.accents.home, borderWidth: 4 }]}>
    <Text style={styles.text}>Home (Notebooks List)</Text>
  </View>
);

const NotebookScreen = () => (
  <View style={[styles.container, { borderColor: colors.accents.notebook, borderWidth: 4 }]}>
    <Text style={styles.text}>Notebook View (Notes List)</Text>
  </View>
);

const NoteScreen = () => (
  <View style={[styles.container, { borderColor: colors.accents.note, borderWidth: 4 }]}>
    <Text style={styles.text}>Note Editor</Text>
  </View>
);

const ChatScreen = () => (
  <View style={[styles.container, { borderColor: colors.accents.chat, borderWidth: 4 }]}>
    <Text style={styles.text}>RAG Chat</Text>
  </View>
);

export type RootStackParamList = {
  Home: undefined;
  Notebook: { notebookId: string };
  Note: { noteId: string };
  Chat: { notebookId?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  return (
    <Stack.Navigator 
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background }
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Notebook" component={NotebookScreen} />
      <Stack.Screen name="Note" component={NoteScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
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
