import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Modal } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Notebook'>;
  route: RouteProp<RootStackParamList, 'Notebook'>;
};

type Item = { id: string; name: string; type: 'notebook' | 'note'; created_at: string };

export const NotebookScreen = ({ navigation, route }: Props) => {
  const user = useAuthStore(state => state.user);
  const { notebookId, name } = route.params;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalConfig, setModalConfig] = useState<{ visible: boolean; type: 'notebook' | 'note' }>({ visible: false, type: 'notebook' });
  const [newItemName, setNewItemName] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    navigation.setOptions({ 
      title: name || 'Folder',
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.textPrimary,
      headerShadowVisible: false,
    });
    const unsubscribe = navigation.addListener('focus', () => {
      fetchData();
    });
    return unsubscribe;
  }, [navigation, notebookId, name]);

  const fetchData = async () => {
    const { data: nbData, error: nbError } = await supabase
      .from('notebooks')
      .select('id, name, created_at')
      .eq('parent_notebook_id', notebookId)
      .order('created_at', { ascending: false });
    
    const { data: nData, error: nError } = await supabase
      .from('notes')
      .select('id, title, created_at')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: false });

    if (nbError || nError) {
      Alert.alert('Error', (nbError?.message || '') + ' ' + (nError?.message || ''));
    } else {
      const merged: Item[] = [
        ...(nbData || []).map(n => ({ id: n.id, name: n.name, type: 'notebook' as const, created_at: n.created_at })),
        ...(nData || []).map(n => ({ id: n.id, name: n.title, type: 'note' as const, created_at: n.created_at }))
      ];
      // Keep folders first, then notes
      merged.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'notebook' ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setItems(merged);
    }
    setLoading(false);
  };

  const handleCreateSubNotebook = async () => {
    if (!newItemName.trim()) { setModalConfig({ ...modalConfig, visible: false }); return; }
    const { error } = await supabase.from('notebooks').insert([{ name: newItemName.trim(), parent_notebook_id: notebookId, user_id: user?.id }]);
    if (error) Alert.alert('Error', error.message);
    else { setNewItemName(''); setModalConfig({ ...modalConfig, visible: false }); fetchData(); }
  };

  const handleCreateNote = async () => {
    if (!newItemName.trim()) { setModalConfig({ ...modalConfig, visible: false }); return; }
    const { error } = await supabase.from('notes').insert([{ title: newItemName.trim(), notebook_id: notebookId, user_id: user?.id }]);
    if (error) Alert.alert('Error', error.message);
    else { setNewItemName(''); setModalConfig({ ...modalConfig, visible: false }); fetchData(); }
  };

  const handleDeleteItem = async (id: string, name: string, type: 'notebook' | 'note') => {
    Alert.alert('Delete', `Delete ${type} "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', style: 'destructive', 
        onPress: async () => {
          const table = type === 'notebook' ? 'notebooks' : 'notes';
          const { error } = await supabase.from(table).delete().eq('id', id);
          if (error) Alert.alert('Error', error.message);
          else fetchData();
        }
      }
    ]);
  };

  const handleUpdateItem = async (id: string, type: 'notebook' | 'note') => {
    if (!editingName.trim()) { setEditingId(null); return; }
    const table = type === 'notebook' ? 'notebooks' : 'notes';
    const field = type === 'notebook' ? 'name' : 'title';
    const { error } = await supabase.from(table).update({ [field]: editingName.trim() }).eq('id', id);
    if (error) Alert.alert('Error', error.message);
    else { setEditingId(null); fetchData(); }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item, index }) => {
            const isNote = item.type === 'note';
            
            // If it's a folder, render the simple folder icon
            if (!isNote) {
              return (
                <TouchableOpacity 
                  style={styles.folderRowItem}
                  activeOpacity={0.7}
                  onPress={() => navigation.push('Notebook', { notebookId: item.id, name: item.name })}
                  onLongPress={() => {
                    Alert.alert('Options', `"${item.name}"`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Rename', onPress: () => { setEditingId(item.id); setEditingName(item.name); } },
                      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteItem(item.id, item.name, item.type) }
                    ]);
                  }}
                >
                  <Text style={styles.folderRowIcon}>📁</Text>
                  {editingId === item.id ? (
                    <TextInput
                      style={styles.folderEditInput}
                      value={editingName}
                      onChangeText={setEditingName}
                      autoFocus
                      onBlur={() => setEditingId(null)}
                      onSubmitEditing={() => handleUpdateItem(item.id, item.type)}
                    />
                  ) : (
                    <Text style={styles.folderRowTitle} numberOfLines={1}>{item.name}</Text>
                  )}
                </TouchableOpacity>
              )
            }

            // If it's a note, render a wide vibrant card
            const cardColor = colors.cardColors[(index) % colors.cardColors.length];
            return (
              <TouchableOpacity 
                style={[styles.card, { backgroundColor: cardColor }]}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('Note', { noteId: item.id, title: item.name })}
                onLongPress={() => { setEditingId(item.id); setEditingName(item.name); }}
              >
                {editingId === item.id ? (
                  <View style={styles.editContainer}>
                    <TextInput
                      style={styles.editInput}
                      value={editingName}
                      onChangeText={setEditingName}
                      autoFocus
                      onBlur={() => setEditingId(null)}
                      onSubmitEditing={() => handleUpdateItem(item.id, item.type)}
                    />
                  </View>
                ) : (
                  <View style={styles.cardContent}>
                    <View>
                      <View style={styles.iconWrapper}><Text style={styles.icon}>✏️</Text></View>
                      <Text style={styles.cardTitle}>{item.name}</Text>
                    </View>
                    <View style={styles.cardBottomRow}>
                      <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                      <TouchableOpacity onPress={() => handleDeleteItem(item.id, item.name, item.type)} style={styles.deleteIcon}>
                        <Text style={styles.deleteIconText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Floating Action Buttons */}
      <View style={styles.fabContainer}>
        <TouchableOpacity style={[styles.fab, { backgroundColor: colors.surfaceLight }]} onPress={() => setModalConfig({ visible: true, type: 'notebook' })} activeOpacity={0.8}>
          <Text style={styles.fabIcon}>📁</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, styles.fabMain]} onPress={() => setModalConfig({ visible: true, type: 'note' })} activeOpacity={0.8}>
          <Text style={styles.fabIconMain}>✏️</Text>
        </TouchableOpacity>
      </View>

      {/* Creation Modal */}
      <Modal visible={modalConfig.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Text style={styles.modalTitle}>New {modalConfig.type === 'notebook' ? 'Folder' : 'Note'}</Text>
            <TextInput
              style={styles.modalInput}
              autoFocus
              placeholder="Enter name..."
              placeholderTextColor={colors.textDisabled}
              value={newItemName}
              onChangeText={setNewItemName}
              onSubmitEditing={modalConfig.type === 'notebook' ? handleCreateSubNotebook : handleCreateNote}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setModalConfig({ ...modalConfig, visible: false }); setNewItemName(''); }} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={modalConfig.type === 'notebook' ? handleCreateSubNotebook : handleCreateNote} 
                style={[styles.modalBtn, { backgroundColor: colors.textPrimary }]}
              >
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
  listContainer: { padding: 24, paddingBottom: 120 },
  
  folderRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  folderRowIcon: { fontSize: 24, marginRight: 16 },
  folderRowTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  folderEditInput: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, flex: 1, borderBottomWidth: 1, borderColor: colors.textPrimary },

  card: {
    width: '100%',
    minHeight: 140,
    borderRadius: 32,
    padding: 24,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardContent: { flex: 1, justifyContent: 'space-between' },
  iconWrapper: { backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'flex-start', padding: 10, borderRadius: 20, marginBottom: 12 },
  icon: { fontSize: 20 },
  cardTitle: { fontSize: 28, fontWeight: '800', color: '#111111', lineHeight: 32 },
  cardBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 },
  cardDate: { fontSize: 14, fontWeight: '600', color: 'rgba(0,0,0,0.5)' },
  deleteIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center' },
  deleteIconText: { color: '#000', fontSize: 14, fontWeight: 'bold' },

  editContainer: { flex: 1, justifyContent: 'center' },
  editInput: { fontSize: 28, fontWeight: '800', color: '#000', borderBottomWidth: 2, borderColor: 'rgba(0,0,0,0.3)' },

  fabContainer: { position: 'absolute', bottom: 32, right: 24, flexDirection: 'row', alignItems: 'center' },
  fab: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  fabMain: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.textPrimary, marginRight: 0, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  fabIcon: { fontSize: 24 },
  fabIconMain: { fontSize: 32 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24 },
  modalContainer: { backgroundColor: colors.surface, padding: 24, borderRadius: 32 },
  modalTitle: { fontSize: 24, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 20 },
  modalInput: { backgroundColor: colors.background, color: colors.textPrimary, borderRadius: 16, padding: 20, fontSize: 18, marginBottom: 24 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, marginLeft: 12 },
  modalBtnText: { color: colors.textSecondary, fontWeight: 'bold', fontSize: 16 },
  modalBtnTextPrimary: { color: colors.background, fontWeight: 'bold', fontSize: 16 },
});
