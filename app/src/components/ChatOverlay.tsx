import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/RootNavigator';

import { useAuthStore } from '../store/authStore';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: { id: string, title: string }[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  notebookId?: string; // If provided, limits RAG context to this notebook
};

export const ChatOverlay: React.FC<Props> = ({ visible, onClose, notebookId }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { chats, setChats } = useAuthStore();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<'notebook' | 'global'>(notebookId ? 'notebook' : 'global');
  const listRef = useRef<FlatList>(null);

  // When notebookId changes, reset scope
  useEffect(() => {
    if (notebookId) {
      setScope('notebook');
    } else {
      setScope('global');
    }
  }, [notebookId]);

  // Add initial greeting when opened
  useEffect(() => {
    if (visible) {
      setChats(prev => {
        const next = { ...prev };
        if (notebookId && next.notebook.length === 0) {
          next.notebook = [{ id: 'welcome-nb', role: 'assistant', content: "Hi! I'm Synapse AI. Ask me anything about this notebook." }];
        }
        if (next.global.length === 0) {
          next.global = [{ id: 'welcome-gl', role: 'assistant', content: "Hi! I'm Synapse AI. Ask me anything about all your notes." }];
        }
        return next;
      });
    }
  }, [visible, notebookId]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    };
    
    setChats(prev => ({
      ...prev,
      [scope]: [...prev[scope], userMessage]
    }));
    setInput('');
    setLoading(true);

    try {
      const session = useAuthStore.getState().session;
      const token = session?.access_token;
      
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

      // Extract previous messages to send as history
      // Only keep the most recent 10 to avoid payload bloat
      const currentScopeMessages = chats[scope];
      const historyToSend = currentScopeMessages
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const response = await fetch(`${supabaseUrl}/functions/v1/rag-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ 
          query: userMessage.content, 
          notebook_id: scope === 'notebook' ? notebookId : null,
          history: historyToSend
        })
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Status ${response.status}: ${responseText}`);
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || `Status ${response.status}`);
      }
      
      if (data?.error) throw new Error(data.error);

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.answer,
        sources: data.sources
      };
      
      setChats(prev => ({
        ...prev,
        [scope]: [...prev[scope], aiMessage]
      }));
    } catch (err: any) {
      setChats(prev => ({
        ...prev,
        [scope]: [...prev[scope], {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${err.message}`
        }]
      }));
    } finally {
      setLoading(false);
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
        <Text style={[styles.messageText, isUser && styles.userText]}>{item.content}</Text>
        {item.sources && item.sources.length > 0 && (
          <View style={styles.sourcesContainer}>
            <Text style={styles.sourcesLabel}>Sources:</Text>
            {item.sources.map(s => (
              <TouchableOpacity 
                key={s.id} 
                onPress={() => {
                  onClose();
                  navigation.navigate('Note', { noteId: s.id });
                }}
              >
                <Text style={styles.sourceItem}>• {s.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <KeyboardAvoidingView 
        style={styles.modalContainer} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.chatWrapper}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Synapse AI</Text>
            
            {notebookId && (
              <View style={styles.toggleContainer}>
                <TouchableOpacity 
                  style={[styles.toggleBtn, scope === 'notebook' && styles.toggleBtnActive]}
                  onPress={() => setScope('notebook')}
                >
                  <Text style={[styles.toggleText, scope === 'notebook' && styles.toggleTextActive]}>This Notebook</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.toggleBtn, scope === 'global' && styles.toggleBtnActive]}
                  onPress={() => setScope('global')}
                >
                  <Text style={[styles.toggleText, scope === 'global' && styles.toggleTextActive]}>All Notes</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Chat List */}
          <FlatList
            ref={listRef}
            data={chats[scope]}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />

          {/* Input Area */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Ask about your notes..."
              placeholderTextColor={colors.textDisabled}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
            />
            <TouchableOpacity 
              style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]} 
              onPress={handleSend}
              disabled={!input.trim() || loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Feather name="send" size={20} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  chatWrapper: {
    backgroundColor: colors.background,
    height: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceLight,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 2,
  },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: colors.surfaceLight,
  },
  toggleText: {
    color: colors.textDisabled,
    fontSize: 12,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: colors.textPrimary,
  },
  closeBtn: {
    padding: 4,
  },
  listContent: {
    padding: 24,
    paddingBottom: 40,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 16,
    borderRadius: 20,
    marginBottom: 16,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accents.home,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  userText: {
    color: '#FFF',
  },
  sourcesContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  sourcesLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  sourceItem: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceLight,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 16,
    maxHeight: 120,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accents.home,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  }
});
