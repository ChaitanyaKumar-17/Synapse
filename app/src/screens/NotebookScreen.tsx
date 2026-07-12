import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, ScrollView, Animated } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { CustomAlert } from '../components/CustomAlert';
import { ChatOverlay } from '../components/ChatOverlay';
import { exportNotebook } from '../lib/exportNotebook';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Notebook'>;
  route: RouteProp<RootStackParamList, 'Notebook'>;
};

type Item = {
  id: string;
  name: string;
  type: 'notebook' | 'note';
  created_at: string;
  is_pinned: boolean;
};

export const NotebookScreen = ({ navigation, route }: Props) => {
  const user = useAuthStore(state => state.user);
  const { notebookId, name } = route.params;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalConfig, setModalConfig] = useState<{ visible: boolean; type: 'notebook' | 'note' }>({ visible: false, type: 'notebook' });
  const [newItemName, setNewItemName] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [sortConfig, setSortConfig] = useState<{ field: 'date' | 'name', order: 'asc' | 'desc' }>({ field: 'date', order: 'asc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [allTags, setAllTags] = useState<{id: string, name: string, color: string}[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [noteTagMap, setNoteTagMap] = useState<Record<string, string[]>>({});
  
  const [alertConfig, setAlertConfig] = useState({
    visible: false, title: '', message: '', isDestructive: false, confirmText: 'OK', onConfirm: () => {}
  });

  const [actionMenu, setActionMenu] = useState<{ visible: boolean, item: Item | null }>({ visible: false, item: null });
  const [isChatVisible, setChatVisible] = useState(false);

  const [isFabExpanded, setIsFabExpanded] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  const toggleFab = () => {
    const toValue = isFabExpanded ? 0 : 1;
    Animated.spring(fabAnim, {
      toValue,
      useNativeDriver: true,
      friction: 6,
    }).start();
    setIsFabExpanded(!isFabExpanded);
  };

  const sortedItems = useMemo(() => {
    let copy = [...items];
    
    if (searchQuery.trim() !== '') {
       const q = searchQuery.toLowerCase();
       copy = copy.filter(item => item.name.toLowerCase().includes(q));
    }

    if (selectedTagIds.length > 0) {
       copy = copy.filter(item => {
          if (item.type === 'notebook') return false;
          const tagsForNote = noteTagMap[item.id] || [];
          return selectedTagIds.every(id => tagsForNote.includes(id));
       });
    }

    copy.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'notebook' ? -1 : 1;
      if (sortConfig.field === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return sortConfig.order === 'asc' ? cmp : -cmp;
      } else {
        const cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return sortConfig.order === 'asc' ? cmp : -cmp;
      }
    });

    // Chunk the items: Folders are grouped in pairs (2 per row), Notes take full row
    const rows: Item[][] = [];
    let currentFolderRow: Item[] = [];
    
    copy.forEach(item => {
      if (item.type === 'note') {
        if (currentFolderRow.length > 0) {
          rows.push(currentFolderRow);
          currentFolderRow = [];
        }
        rows.push([item]);
      } else {
        currentFolderRow.push(item);
        if (currentFolderRow.length === 2) {
          rows.push(currentFolderRow);
          currentFolderRow = [];
        }
      }
    });
    if (currentFolderRow.length > 0) rows.push(currentFolderRow);
    
    return rows;
  }, [items, sortConfig, searchQuery, selectedTagIds, noteTagMap]);

  const [exportProgress, setExportProgress] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      setExportProgress('Starting export...');
      await exportNotebook(user!.id, notebookId || null, name || 'global', (progress) => {
        setExportProgress(progress);
      });
    } catch (err: any) {
      setAlertConfig({ visible: true, title: 'Export Failed', message: err.message, isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({...prev, visible: false})) });
    } finally {
      setExportProgress(null);
    }
  };

  useEffect(() => {
    navigation.setOptions({ 
      title: name || 'Folder',
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.textPrimary,
      headerShadowVisible: false,
      headerRight: () => (
        <TouchableOpacity onPress={handleExport} style={{ padding: 8 }}>
          <Feather name="download" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      )
    });
    const unsubscribe = navigation.addListener('focus', () => {
      fetchData();
    });
    return unsubscribe;
  }, [navigation, notebookId, name, user]);

  const fetchData = async () => {
    const { data: nbData, error: nbError } = await supabase
      .from('notebooks')
      .select('id, name, created_at, is_pinned')
      .eq('parent_notebook_id', notebookId)
      .order('created_at', { ascending: true });
    
    const { data: nData, error: nError } = await supabase
      .from('notes')
      .select('id, title, created_at, is_pinned')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: true });

    // Fetch Tags
    const { data: tagsData } = await supabase.from('tags').select('*').eq('user_id', user?.id).order('name');
    if (tagsData) setAllTags(tagsData);

    const { data: ntData } = await supabase.from('note_tags').select('note_id, tag_id');
    if (ntData) {
      const map: Record<string, string[]> = {};
      ntData.forEach(nt => {
         if (!map[nt.note_id]) map[nt.note_id] = [];
         map[nt.note_id].push(nt.tag_id);
      });
      setNoteTagMap(map);
    }

    if (nbError || nError) {
      setAlertConfig({ visible: true, title: 'Error', message: (nbError?.message || '') + ' ' + (nError?.message || ''), isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })) });
    } else {
      const merged: Item[] = [
        ...(nbData || []).map(n => ({ id: n.id, name: n.name, type: 'notebook' as const, created_at: n.created_at, is_pinned: n.is_pinned })),
        ...(nData || []).map(n => ({ id: n.id, name: n.title, type: 'note' as const, created_at: n.created_at, is_pinned: n.is_pinned }))
      ];
      setItems(merged);
    }
    setLoading(false);
  };

  const handleCreateSubNotebook = async () => {
    if (!newItemName.trim()) { setModalConfig({ ...modalConfig, visible: false }); return; }
    const { error } = await supabase.from('notebooks').insert([{ name: newItemName.trim(), parent_notebook_id: notebookId, user_id: user?.id }]);
    if (error) setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })) });
    else { setNewItemName(''); setModalConfig({ ...modalConfig, visible: false }); fetchData(); }
  };

  const handleCreateNote = async () => {
    if (!newItemName.trim()) { setModalConfig({ ...modalConfig, visible: false }); return; }
    const { error } = await supabase.from('notes').insert([{ title: newItemName.trim(), notebook_id: notebookId, user_id: user?.id }]);
    if (error) setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })) });
    else { setNewItemName(''); setModalConfig({ ...modalConfig, visible: false }); fetchData(); }
  };

  const handleDeleteItem = (id: string, name: string, type: 'notebook' | 'note') => {
    setAlertConfig({
      visible: true,
      title: `Delete ${type === 'notebook' ? 'Folder' : 'Note'}`,
      message: `Are you sure you want to delete "${name}"?`,
      isDestructive: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        const table = type === 'notebook' ? 'notebooks' : 'notes';
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) {
          setTimeout(() => {
            setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })) });
          }, 500);
        } else {
          fetchData();
        }
      }
    });
  };

  const handleUpdateItem = async (id: string, type: 'notebook' | 'note') => {
    if (!editingName.trim()) { setEditingId(null); return; }
    const table = type === 'notebook' ? 'notebooks' : 'notes';
    const field = type === 'notebook' ? 'name' : 'title';
    const { error } = await supabase.from(table).update({ [field]: editingName.trim() }).eq('id', id);
    if (error) setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })) });
    else { setEditingId(null); fetchData(); }
  };

  const handleTogglePin = async (item: Item) => {
    const table = item.type === 'note' ? 'notes' : 'notebooks';
    const newPinned = !item.is_pinned;
    const pinned_at = newPinned ? new Date().toISOString() : null;
    const { error } = await supabase.from(table).update({ is_pinned: newPinned, pinned_at }).eq('id', item.id);
    if (error) setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })) });
    else fetchData();
  };

  const handleDirectUpload = async (type: 'image' | 'file') => {
    let result;
    if (type === 'image') {
       result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    } else {
       result = await DocumentPicker.getDocumentAsync({});
    }

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const fileName = type === 'image' ? (asset.fileName || `image_${Date.now()}.jpg`) : asset.name;
      
      setLoading(true);
      try {
        const { data: note, error: noteError } = await supabase.from('notes').insert({
          user_id: user?.id,
          notebook_id: notebookId,
          title: fileName,
        }).select().single();
        
        if (noteError) throw noteError;

        const ext = fileName.split('.').pop() || (type === 'image' ? 'jpg' : 'bin');
        const storagePath = `${user?.id}/${note.id}/${Date.now()}.${ext}`;
        
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
        
        const { error: uploadError } = await supabase.storage.from('attachments').upload(storagePath, decode(base64), { 
          contentType: type === 'image' ? `image/${ext}` : 'application/octet-stream' 
        });
        if (uploadError) throw uploadError;
        
        await supabase.from('attachments').insert({
          note_id: note.id,
          storage_path: storagePath,
          file_type: type,
          file_name: fileName
        });
        
        fetchData();
      } catch (err: any) {
        Alert.alert('Upload Error', err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginTop: 40 }} />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.searchContainer}>
             <Feather name="search" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
             <TextInput 
               style={styles.searchInput}
               placeholder="Search notes and folders..."
               placeholderTextColor={colors.textDisabled}
               value={searchQuery}
               onChangeText={setSearchQuery}
             />
          </View>

          {allTags.length > 0 && (
            <View style={styles.tagsFilterContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24 }}>
                {allTags.map(tag => {
                   const isSelected = selectedTagIds.includes(tag.id);
                   return (
                     <TouchableOpacity 
                       key={tag.id} 
                       style={[styles.tagChip, isSelected && { backgroundColor: tag.color, borderColor: tag.color }]}
                       onPress={() => {
                         if (isSelected) setSelectedTagIds(prev => prev.filter(id => id !== tag.id));
                         else setSelectedTagIds(prev => [...prev, tag.id]);
                       }}
                     >
                       {!isSelected && <View style={[styles.tagChipDot, { backgroundColor: tag.color }]} />}
                       <Text style={[styles.tagChipText, isSelected && { color: '#000' }]}>{tag.name}</Text>
                     </TouchableOpacity>
                   )
                })}
              </ScrollView>
            </View>
          )}

          <View style={styles.sortHeader}>
            <Text style={styles.sortLabel}>Sort by:</Text>
            <TouchableOpacity style={styles.sortPill} onPress={() => setSortConfig(prev => ({ ...prev, field: prev.field === 'name' ? 'date' : 'name' }))}>
              <Text style={styles.sortPillText}>{sortConfig.field === 'name' ? 'Name' : 'Date'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sortPill} onPress={() => setSortConfig(prev => ({ ...prev, order: prev.order === 'asc' ? 'desc' : 'asc' }))}>
              <Feather name={sortConfig.order === 'asc' ? "arrow-up" : "arrow-down"} size={16} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContainer}
          >
            {sortedItems.map((rowItems, rowIndex) => {
              if (rowItems[0].type === 'notebook') {
                return (
                  <View key={`row-${rowIndex}`} style={styles.rowWrapper}>
                    {rowItems.map((item) => (
                      <TouchableOpacity 
                        key={item.id}
                        style={styles.folderSquareItem}
                        activeOpacity={0.7}
                        onPress={() => navigation.push('Notebook', { notebookId: item.id, name: item.name })}
                        onLongPress={() => setActionMenu({ visible: true, item })}
                      >
                        <Ionicons name="folder" size={64} color="#FFCA28" style={{ marginBottom: 12 }} />
                        {editingId === item.id ? (
                          <TextInput
                            style={styles.folderEditInput}
                            value={editingName}
                            onChangeText={setEditingName}
                            autoFocus
                            onSubmitEditing={() => handleUpdateItem(item.id, item.type)}
                          />
                        ) : (
                          <Text style={styles.folderSquareTitle} numberOfLines={2}>{item.name}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                    {rowItems.length === 1 && <View style={styles.folderSquareItemPlaceholder} />}
                  </View>
                );
              }

              // It's a note
              const item = rowItems[0];
              const cardColor = colors.cardColors[rowIndex % colors.cardColors.length];
              return (
                <TouchableOpacity 
                  key={`row-${rowIndex}`}
                  style={[styles.card, { backgroundColor: cardColor }]}
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate('Note', { noteId: item.id, title: item.name })}
                  onLongPress={() => setActionMenu({ visible: true, item })}
                >
                  {editingId === item.id ? (
                    <View style={styles.editContainer}>
                      <TextInput
                        style={styles.editInput}
                        value={editingName}
                        onChangeText={setEditingName}
                        autoFocus
                        onSubmitEditing={() => handleUpdateItem(item.id, item.type)}
                      />
                    </View>
                  ) : (
                    <View style={styles.cardContent}>
                      <View style={styles.iconWrapper}>
                        <Text style={styles.icon}>✏️</Text>
                      </View>
                      <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
                      <View style={styles.cardBottomRow}>
                        <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                        {item.is_pinned && <Feather name="anchor" size={14} color="rgba(0,0,0,0.5)" />}
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Export Progress Modal */}
      <Modal visible={!!exportProgress} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginBottom: 16 }} />
            <Text style={styles.modalTitle}>Exporting Notebook</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 16, textAlign: 'center' }}>{exportProgress}</Text>
          </View>
        </View>
      </Modal>

      {/* Floating Action Buttons */}
      <View style={styles.fabContainer}>
        <Animated.View style={[styles.fabMenu, { 
          opacity: fabAnim,
          transform: [{ translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        }]} pointerEvents={isFabExpanded ? 'auto' : 'none'}>
          
          <TouchableOpacity style={styles.fabActionBtn} onPress={() => { toggleFab(); handleDirectUpload('image'); }} activeOpacity={0.8}>
            <Text style={styles.fabActionLabel}>Image</Text>
            <View style={[styles.fab, { backgroundColor: colors.surfaceLight }]}>
              <Feather name="image" size={24} color={colors.textPrimary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.fabActionBtn} onPress={() => { toggleFab(); handleDirectUpload('file'); }} activeOpacity={0.8}>
            <Text style={styles.fabActionLabel}>Document</Text>
            <View style={[styles.fab, { backgroundColor: colors.surfaceLight }]}>
              <Feather name="paperclip" size={24} color={colors.textPrimary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.fabActionBtn} onPress={() => { toggleFab(); setModalConfig({ visible: true, type: 'notebook' }); }} activeOpacity={0.8}>
            <Text style={styles.fabActionLabel}>Folder</Text>
            <View style={[styles.fab, { backgroundColor: colors.surfaceLight }]}>
              <Feather name="folder" size={24} color={colors.textPrimary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.fabActionBtn} onPress={() => { toggleFab(); setModalConfig({ visible: true, type: 'note' }); }} activeOpacity={0.8}>
            <Text style={styles.fabActionLabel}>Note</Text>
            <View style={[styles.fab, { backgroundColor: colors.surfaceLight }]}>
              <Text style={styles.fabIcon}>✏️</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity style={[styles.fab, styles.fabMain]} onPress={toggleFab} activeOpacity={0.8}>
          <Animated.View style={{ transform: [{ rotate: fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }}>
            <Feather name="plus" size={32} color={colors.background} />
          </Animated.View>
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

      {/* Action Menu (Context Menu) */}
      <Modal visible={actionMenu.visible} transparent animationType="fade" onRequestClose={() => setActionMenu({ visible: false, item: null })}>
        <TouchableOpacity style={styles.actionMenuOverlay} activeOpacity={1} onPress={() => setActionMenu({ visible: false, item: null })}>
          <View style={styles.actionMenuBox}>
            <Text style={styles.actionMenuTitle} numberOfLines={1}>{actionMenu.item?.name}</Text>
            
            <TouchableOpacity style={styles.actionMenuItem} onPress={() => {
              const item = actionMenu.item;
              setActionMenu({ visible: false, item: null });
              if (item) {
                setTimeout(() => {
                  setEditingId(item.id);
                  setEditingName(item.name);
                }, 350);
              }
            }}>
              <Feather name="edit-2" size={20} color={colors.textPrimary} style={styles.actionMenuIcon} />
              <Text style={styles.actionMenuItemText}>Rename</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionMenuItem} onPress={() => {
              if (actionMenu.item) handleTogglePin(actionMenu.item);
              setActionMenu({ visible: false, item: null });
            }}>
              <Feather name="anchor" size={20} color={colors.textPrimary} style={styles.actionMenuIcon} />
              <Text style={styles.actionMenuItemText}>{actionMenu.item?.is_pinned ? 'Unpin from Home' : 'Pin to Home'}</Text>
            </TouchableOpacity>

            {actionMenu.item?.type === 'note' && (
              <TouchableOpacity style={styles.actionMenuItem} onPress={() => {
                const item = actionMenu.item;
                setActionMenu({ visible: false, item: null });
                if (item) {
                  setTimeout(async () => {
                    setExportProgress('Starting export...');
                    try {
                      const { data: blocks } = await supabase.from('note_blocks').select('*').eq('note_id', item.id).order('order_index');
                      let md = `# ${item.name}\n\n`;
                      (blocks || []).forEach(b => { if (b.block_type === 'text') md += `${b.text_content || ''}\n\n`; });
                      
                      const safeName = item.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                      const fileUri = `${FileSystem.cacheDirectory}${safeName}.md`;
                      await FileSystem.writeAsStringAsync(fileUri, md);
                      await Sharing.shareAsync(fileUri);
                    } catch (e: any) {
                      setAlertConfig({ visible: true, title: 'Export Failed', message: e.message, isDestructive: false, confirmText: 'OK', onConfirm: () => setAlertConfig(prev => ({...prev, visible: false})) });
                    } finally {
                      setExportProgress(null);
                    }
                  }, 350);
                }
              }}>
                <Feather name="download" size={20} color={colors.textPrimary} style={styles.actionMenuIcon} />
                <Text style={styles.actionMenuItemText}>Export Note (.md)</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.actionMenuItem} onPress={() => {
              const item = actionMenu.item;
              setActionMenu({ visible: false, item: null });
              if (item) handleDeleteItem(item.id, item.name, item.type);
            }}>
              <Feather name="trash-2" size={20} color={colors.actions.signOut} style={styles.actionMenuIcon} />
              <Text style={[styles.actionMenuItemText, { color: colors.actions.signOut }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <CustomAlert 
        {...alertConfig} 
        onCancel={() => setAlertConfig(prev => ({ ...prev, visible: false }))} 
      />

      <TouchableOpacity 
        style={styles.chatFab}
        activeOpacity={0.8}
        onPress={() => setChatVisible(true)}
      >
        <Feather name="message-circle" size={28} color="#050505" />
      </TouchableOpacity>

      <ChatOverlay visible={isChatVisible} onClose={() => setChatVisible(false)} notebookId={notebookId} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContainer: { padding: 24, paddingTop: 8, paddingBottom: 120 },
  
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 24,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16, ...Platform.select({ web: { outlineStyle: 'none' } as any }) },
  
  tagsFilterContainer: { marginTop: 16 },
  tagChip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.surfaceLight, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginRight: 12 },
  tagChipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  tagChipText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },

  sortHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sortLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    marginRight: 12,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  sortPillText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  
  rowWrapper: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },

  folderSquareItem: {
    width: '48%',
    aspectRatio: 1,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  folderSquareItemPlaceholder: {
    width: '48%',
  },
  folderSquareIcon: { fontSize: 64, marginBottom: 12 },
  folderSquareTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  folderEditInput: { 
    width: '80%',
    alignSelf: 'center',
    fontSize: 18, 
    fontWeight: '700', 
    color: colors.textPrimary, 
    textAlign: 'center', 
    borderBottomWidth: 1, 
    borderColor: colors.textSecondary,
    // @ts-ignore
    outlineStyle: 'none',
  },

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

  editContainer: { flex: 1, justifyContent: 'center' },
  editInput: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000',
    borderBottomWidth: 2,
    borderColor: 'rgba(0,0,0,0.3)',
    // @ts-ignore
    outlineStyle: 'none',
  },

  fabContainer: { position: 'absolute', bottom: 32, right: 24, alignItems: 'flex-end' },
  fabMenu: { alignItems: 'flex-end', marginBottom: 16 },
  fabActionBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  fabActionLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginRight: 16, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, overflow: 'hidden' },
  fab: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  fabMain: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.textPrimary, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
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

  actionMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  actionMenuBox: { backgroundColor: colors.surface, borderRadius: 24, padding: 16, width: '100%', maxWidth: 300 },
  actionMenuTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textSecondary, marginBottom: 16, paddingHorizontal: 16, paddingTop: 8 },
  actionMenuItem: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  actionMenuIcon: { marginRight: 16 },
  actionMenuItemText: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
  chatFab: {
    position: 'absolute',
    bottom: 32,
    right: 104, // Next to the Add button
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accents.chat,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  }
});
