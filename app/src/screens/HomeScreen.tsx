import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Modal } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

type Notebook = {
  id: string;
  name: string;
  created_at: string;
};

export const HomeScreen = ({ navigation }: Props) => {
  const user = useAuthStore(state => state.user);
  const username = user?.user_metadata?.username || user?.email?.split('@')[0] || 'ME';
  
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalVisible, setModalVisible] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const fetchNotebooks = async () => {
    const { data, error } = await supabase
      .from('notebooks')
      .select('id, name, created_at')
      .is('parent_notebook_id', null)
      .order('created_at', { ascending: false });

    if (error) Alert.alert('Error', error.message);
    else setNotebooks(data || []);
    setLoading(false);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchNotebooks();
    });
    return unsubscribe;
  }, [navigation]);

  const handleCreateNotebook = async () => {
    if (!newNotebookName.trim()) {
      setModalVisible(false);
      return;
    }
    const { error } = await supabase.from('notebooks').insert([{ name: newNotebookName.trim(), user_id: user?.id }]);
    if (error) Alert.alert('Error', error.message);
    else {
      setNewNotebookName('');
      setModalVisible(false);
      fetchNotebooks();
    }
  };

  const handleUpdateNotebook = async (id: string) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    const { error } = await supabase.from('notebooks').update({ name: editingName.trim() }).eq('id', id);
    if (error) Alert.alert('Error', error.message);
    else {
      setEditingId(null);
      fetchNotebooks();
    }
  };

  const handleDeleteNotebook = async (id: string, name: string) => {
    Alert.alert('Delete', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive', 
        onPress: async () => {
          const { error } = await supabase.from('notebooks').delete().eq('id', id);
          if (error) Alert.alert('Error', error.message);
          else fetchNotebooks();
        }
      }
    ]);
  };

  // Group items into pairs or singles to simulate the masonry widget layout
  // Pattern: 2 half-width, 1 full-width, 2 half-width, 1 full-width
  const groupedData = [];
  let i = 0;
  while (i < notebooks.length) {
    if (groupedData.length % 2 === 0) {
      // push a pair
      const pair = [notebooks[i]];
      if (i + 1 < notebooks.length) pair.push(notebooks[i+1]);
      groupedData.push({ type: 'pair', items: pair });
      i += 2;
    } else {
      // push a single full width
      groupedData.push({ type: 'single', items: [notebooks[i]] });
      i += 1;
    }
  }

  return (
    <View style={styles.container}>
      
      {/* Header matching Ref 1 */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>My{'\n'}Notes</Text>
          <TouchableOpacity 
            onPress={() => supabase.auth.signOut()} 
            style={styles.profileBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.profileInitials}>{username.substring(0, 2).toUpperCase()}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.pillsContainer}>
          <TouchableOpacity style={[styles.pill, styles.pillActive]}>
            <Text style={styles.pillTextActive}>All <Text style={styles.pillBadge}>{notebooks.length}</Text></Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pill}><Text style={styles.pillText}>Important</Text></TouchableOpacity>
          <TouchableOpacity style={styles.pill}><Text style={styles.pillText}>To-do</Text></TouchableOpacity>
        </View>
      </View>

      {/* Widget Grid */}
      {loading ? (
        <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={groupedData}
          keyExtractor={(_, index) => `row-${index}`}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item, index }) => {
            if (item.type === 'pair') {
              return (
                <View style={styles.rowWrapper}>
                  {item.items.map((notebook, idx) => {
                    // Stable color index based on actual position
                    let absoluteIndex = 0;
                    for(let r=0; r<index; r++) absoluteIndex += groupedData[r].items.length;
                    absoluteIndex += idx;
                    
                    const cardColor = colors.cardColors[absoluteIndex % colors.cardColors.length];
                    
                    return (
                      <TouchableOpacity 
                        key={notebook.id}
                        style={[styles.card, styles.cardHalf, { backgroundColor: cardColor }]}
                        activeOpacity={0.9}
                        onPress={() => {
                          if (editingId !== notebook.id) {
                            navigation.navigate('Notebook', { notebookId: notebook.id, name: notebook.name });
                          }
                        }}
                        onLongPress={() => {
                          setEditingId(notebook.id);
                          setEditingName(notebook.name);
                        }}
                      >
                        {editingId === notebook.id ? (
                          <View style={styles.editContainer}>
                            <TextInput
                              style={styles.editInput}
                              value={editingName}
                              onChangeText={setEditingName}
                              autoFocus
                              onBlur={() => setEditingId(null)}
                              onSubmitEditing={() => handleUpdateNotebook(notebook.id)}
                            />
                          </View>
                        ) : (
                          <View style={styles.cardContent}>
                            <Text style={styles.cardTitle}>{notebook.name}</Text>
                            <View style={styles.cardBottomRow}>
                              <Text style={styles.cardDate}>{new Date(notebook.created_at).toLocaleDateString()}</Text>
                              <TouchableOpacity onPress={() => handleDeleteNotebook(notebook.id, notebook.name)} style={styles.deleteIcon}>
                                <Text style={styles.deleteIconText}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  {item.items.length === 1 && <View style={styles.cardHalf} />}
                </View>
              );
            } else {
              // Single full width
              const notebook = item.items[0];
              let absoluteIndex = 0;
              for(let r=0; r<index; r++) absoluteIndex += groupedData[r].items.length;
              const cardColor = colors.cardColors[absoluteIndex % colors.cardColors.length];

              return (
                <TouchableOpacity 
                  style={[styles.card, styles.cardFull, { backgroundColor: cardColor }]}
                  activeOpacity={0.9}
                  onPress={() => {
                    if (editingId !== notebook.id) {
                      navigation.navigate('Notebook', { notebookId: notebook.id, name: notebook.name });
                    }
                  }}
                  onLongPress={() => {
                    setEditingId(notebook.id);
                    setEditingName(notebook.name);
                  }}
                >
                  {editingId === notebook.id ? (
                    <View style={styles.editContainer}>
                      <TextInput
                        style={[styles.editInput, { textAlign: 'center' }]}
                        value={editingName}
                        onChangeText={setEditingName}
                        autoFocus
                        onBlur={() => setEditingId(null)}
                        onSubmitEditing={() => handleUpdateNotebook(notebook.id)}
                      />
                    </View>
                  ) : (
                    <View style={[styles.cardContent, { flexDirection: 'row', alignItems: 'center' }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardDateFull}>{new Date(notebook.created_at).toLocaleDateString()}</Text>
                        <Text style={styles.cardTitleFull}>{notebook.name}</Text>
                      </View>
                      <TouchableOpacity onPress={() => handleDeleteNotebook(notebook.id, notebook.name)} style={styles.deleteIcon}>
                        <Text style={styles.deleteIconText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              )
            }
          }}
        />
      )}

      {/* Floating Action Button */}
      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Creation Modal */}
      <Modal visible={isModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Text style={styles.modalTitle}>New Widget</Text>
            <TextInput
              style={styles.modalInput}
              autoFocus
              placeholder="Enter name..."
              placeholderTextColor={colors.textDisabled}
              value={newNotebookName}
              onChangeText={setNewNotebookName}
              onSubmitEditing={handleCreateNotebook}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setModalVisible(false); setNewNotebookName(''); }} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateNotebook} style={[styles.modalBtn, { backgroundColor: colors.textPrimary }]}>
                <Text style={styles.modalBtnTextPrimary}>Create</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 32,
  },
  title: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 52,
    letterSpacing: -1,
  },
  profileBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInitials: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  
  pillsContainer: { flexDirection: 'row', alignItems: 'center' },
  pill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
    marginRight: 12,
  },
  pillActive: {
    backgroundColor: 'transparent',
    borderColor: colors.textPrimary,
  },
  pillText: { color: colors.textSecondary, fontWeight: '600' },
  pillTextActive: { color: colors.textPrimary, fontWeight: 'bold' },
  pillBadge: { color: colors.textSecondary, fontWeight: 'normal' },

  listContainer: { paddingHorizontal: 16, paddingBottom: 100 },
  
  rowWrapper: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  
  card: {
    borderRadius: 32,
    padding: 24,
    overflow: 'hidden',
  },
  cardHalf: {
    width: '48%',
    aspectRatio: 0.85,
  },
  cardFull: {
    width: '100%',
    height: 120,
    marginBottom: 16,
    borderRadius: 40, // More pill-shaped for full width
  },

  cardContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111111',
    lineHeight: 28,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardDate: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.5)',
  },
  cardTitleFull: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111111',
  },
  cardDateFull: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.5)',
    marginBottom: 4,
  },

  deleteIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  deleteIconText: { color: '#000', fontSize: 12, fontWeight: 'bold' },

  editContainer: { flex: 1, justifyContent: 'center' },
  editInput: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000',
    borderBottomWidth: 2,
    borderColor: 'rgba(0,0,0,0.3)',
  },

  fab: {
    position: 'absolute',
    bottom: 32,
    right: 32,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabText: { fontSize: 32, color: colors.background, fontWeight: '300', marginTop: -4 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24,
  },
  modalContainer: {
    backgroundColor: colors.surface, padding: 24, borderRadius: 32,
  },
  modalTitle: { fontSize: 24, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 20 },
  modalInput: {
    backgroundColor: colors.background, color: colors.textPrimary, borderRadius: 16, padding: 20, fontSize: 18, marginBottom: 24,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, marginLeft: 12 },
  modalBtnText: { color: colors.textSecondary, fontWeight: 'bold', fontSize: 16 },
  modalBtnTextPrimary: { color: colors.background, fontWeight: 'bold', fontSize: 16 },
});
