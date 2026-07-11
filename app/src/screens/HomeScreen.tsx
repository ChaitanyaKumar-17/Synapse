import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, useWindowDimensions, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { CustomAlert } from '../components/CustomAlert';
import { Feather } from '@expo/vector-icons';
import Sortable from 'react-native-sortables';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

type Item = {
  id: string;
  name: string;
  type: 'notebook' | 'folder' | 'note' | 'todo_list';
  created_at: string;
  is_pinned: boolean;
  pinned_at?: string;
};

type EmptyItem = {
  id: string;
  type: 'empty';
};

type DisplayItem = Item | EmptyItem;

type Tab = 'Home' | 'Notebooks' | 'To-do';

export const HomeScreen = ({ navigation }: Props) => {
  const { width } = useWindowDimensions();
  const contentWidth = width - 32; // 16px padding on each side
  const halfWidth = (contentWidth - 16) / 2; // 16px gap

  const user = useAuthStore(state => state.user);
  const username = user?.user_metadata?.username || user?.email?.split('@')[0] || 'ME';
  
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  const [allNotebooks, setAllNotebooks] = useState<any[]>([]);
  const [allNotes, setAllNotes] = useState<any[]>([]);
  const [allTodoLists, setAllTodoLists] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{field: 'date'|'name', order: 'asc'|'desc'}>({field: 'date', order: 'asc'});

  const [isModalVisible, setModalVisible] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingType, setEditingType] = useState<'notebook' | 'note' | 'todo_list' | null>(null);

  const [actionMenu, setActionMenu] = useState<{ visible: boolean, item: Item | null }>({ visible: false, item: null });

  const [dashboardLayout, setDashboardLayout] = useState<string[]>([]);
  const [layoutLoaded, setLayoutLoaded] = useState(false);

  const [alertConfig, setAlertConfig] = useState({
    visible: false, title: '', message: '', isDestructive: false, confirmText: 'OK', onConfirm: () => {}
  });

  const fetchData = async () => {
    const { data: nbData } = await supabase.from('notebooks').select('id, name, created_at, is_pinned, parent_notebook_id, pinned_at').order('created_at', { ascending: true });
    const { data: nData } = await supabase.from('notes').select('id, title, created_at, is_pinned, pinned_at').order('created_at', { ascending: true });
    const { data: tlData } = await supabase.from('todo_lists').select('*').order('created_at', { ascending: true });
    
    setAllNotebooks(nbData || []);
    setAllNotes(nData || []);
    setAllTodoLists(tlData || []);
    setLoading(false);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchData();
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (user?.id) {
      AsyncStorage.getItem(`dashboard_layout_${user.id}`).then(str => {
        if (str) {
          setDashboardLayout(JSON.parse(str));
        }
        setLayoutLoaded(true);
      });
    } else {
      setLayoutLoaded(true);
    }
  }, [user?.id]);

  useEffect(() => {
    if (activeTab === 'Home' && layoutLoaded && user?.id) {
       const pinnedNotebooks = allNotebooks.filter(nb => nb.is_pinned).map(n => n.id);
       const pinnedNotes = allNotes.filter(n => n.is_pinned).map(n => n.id);
       const pinnedTodoLists = allTodoLists.filter(t => t.is_pinned).map(t => t.id);
       const allPinnedIds = [...pinnedNotebooks, ...pinnedNotes, ...pinnedTodoLists];

       let newLayout = [...dashboardLayout];
       let changed = false;

       while (newLayout.length > 0 && newLayout[newLayout.length - 1].startsWith('empty-')) {
         newLayout.pop();
         changed = true;
       }

       const beforeLen = newLayout.length;
       newLayout = newLayout.filter(id => id.startsWith('empty-') || allPinnedIds.includes(id));
       if (newLayout.length !== beforeLen) changed = true;

       const unplacedIds = allPinnedIds.filter(id => !newLayout.includes(id));
       if (unplacedIds.length > 0) {
          const unplacedItems = [...allNotebooks, ...allNotes, ...allTodoLists].filter(i => unplacedIds.includes(i.id));
          unplacedItems.sort((a, b) => new Date(a.pinned_at || 0).getTime() - new Date(b.pinned_at || 0).getTime());
          newLayout = [...newLayout, ...unplacedItems.map(i => i.id)];
          changed = true;
       }

       if (changed) {
          setDashboardLayout(newLayout);
          AsyncStorage.setItem(`dashboard_layout_${user.id}`, JSON.stringify(newLayout));
       }
    }
  }, [activeTab, layoutLoaded, user?.id, allNotebooks, allNotes, allTodoLists, dashboardLayout]);

  const displayedItems = useMemo(() => {
    let items: DisplayItem[] = [];
    if (!layoutLoaded) return [];
    
    if (activeTab === 'Home') {
      const pinnedNotebooks = allNotebooks.filter(nb => nb.is_pinned).map(n => ({ id: n.id, name: n.name, type: (n.parent_notebook_id ? 'folder' : 'notebook') as const, created_at: n.created_at, is_pinned: n.is_pinned, pinned_at: n.pinned_at }));
      const pinnedNotes = allNotes.filter(n => n.is_pinned).map(n => ({ id: n.id, name: n.title, type: 'note' as const, created_at: n.created_at, is_pinned: n.is_pinned, pinned_at: n.pinned_at }));
      const pinnedTodoLists = allTodoLists.filter(t => t.is_pinned).map(t => ({ id: t.id, name: t.title, type: 'todo_list' as const, created_at: t.created_at, is_pinned: t.is_pinned, pinned_at: t.pinned_at }));
      const allPinned = [...pinnedNotebooks, ...pinnedNotes, ...pinnedTodoLists];

      let layoutIds = [...dashboardLayout];
      
      // Ensure we have enough empty slots for free placement (minimum 12, always at least 4 free)
      const minSlots = Math.max(12, layoutIds.length + 4);
      let emptyIdx = 0;
      while (layoutIds.length < minSlots) {
         while(layoutIds.includes(`empty-${emptyIdx}`)) emptyIdx++;
         layoutIds.push(`empty-${emptyIdx}`);
         emptyIdx++;
      }
      
      items = layoutIds.map(id => {
         if (id.startsWith('empty-')) return { id, type: 'empty' as const };
         return allPinned.find(p => p.id === id);
      }).filter(Boolean) as DisplayItem[];

      if (searchQuery.trim()) {
        items = items.filter(i => i.type === 'empty' || (i as Item).name.toLowerCase().includes(searchQuery.toLowerCase()));
      }
    } else if (activeTab === 'Notebooks') {
      items = allNotebooks.filter(nb => nb.parent_notebook_id === null).map(n => ({ id: n.id, name: n.name, type: 'notebook' as const, created_at: n.created_at, is_pinned: n.is_pinned, pinned_at: n.pinned_at }));
      if (searchQuery.trim()) items = items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()));
    } else if (activeTab === 'To-do') {
      items = allTodoLists.map(t => ({ id: t.id, name: t.title, type: 'todo_list' as const, created_at: t.created_at, is_pinned: t.is_pinned, pinned_at: t.pinned_at }));
      if (searchQuery.trim()) items = items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    if (activeTab !== 'Home') {
      items.sort((a, b) => {
        const itemA = a as Item;
        const itemB = b as Item;
        if (sortConfig.field === 'name') {
           return sortConfig.order === 'asc' ? itemA.name.localeCompare(itemB.name) : itemB.name.localeCompare(itemA.name);
        } else {
           return sortConfig.order === 'asc' ? new Date(itemA.created_at).getTime() - new Date(itemB.created_at).getTime() : new Date(itemB.created_at).getTime() - new Date(itemA.created_at).getTime();
        }
      });
    }

    return items;
  }, [activeTab, allNotebooks, allNotes, allTodoLists, searchQuery, sortConfig, user?.id, dashboardLayout, layoutLoaded]);

  const groupedData = useMemo(() => {
    const groups = [];
    let i = 0;
    while (i < displayedItems.length) {
      if (displayedItems[i].type === 'empty') {
        i += 1;
        continue;
      }
      const type = displayedItems[i].type;
      if (type === 'notebook' || type === 'folder' || type === 'todo_list') {
        const pair = [{ item: displayedItems[i] as Item, index: i }];
        if (i + 1 < displayedItems.length && (displayedItems[i+1].type === 'notebook' || displayedItems[i+1].type === 'folder' || displayedItems[i+1].type === 'todo_list')) {
          pair.push({ item: displayedItems[i+1] as Item, index: i+1 });
          i += 2;
        } else {
          i += 1;
        }
        groups.push({ type: 'row', items: pair });
      } else {
        groups.push({ type: 'single', items: [{ item: displayedItems[i] as Item, index: i }] });
        i += 1;
      }
    }
    return groups;
  }, [displayedItems]);

  const handleCreateNotebook = async () => {
    if (!newNotebookName.trim()) { setModalVisible(false); return; }
    const table = activeTab === 'To-do' ? 'todo_lists' : 'notebooks';
    const field = activeTab === 'To-do' ? 'title' : 'name';
    const { error } = await supabase.from(table).insert([{ [field]: newNotebookName.trim(), user_id: user?.id }]);
    if (error) setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => {} });
    else { setNewNotebookName(''); setModalVisible(false); fetchData(); }
  };

  const handleUpdateItem = async (id: string, type: 'notebook'|'note'|'todo_list') => {
    if (!editingName.trim()) { setEditingId(null); return; }
    const table = type === 'todo_list' ? 'todo_lists' : type === 'notebook' ? 'notebooks' : 'notes';
    const field = type === 'notebook' ? 'name' : 'title';
    const { error } = await supabase.from(table).update({ [field]: editingName.trim() }).eq('id', id);
    if (error) setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => {} });
    else { setEditingId(null); fetchData(); }
  };

  const handleDeleteItem = async (id: string, name: string, type: 'notebook'|'note'|'todo_list') => {
    setAlertConfig({
      visible: true,
      title: `Delete ${type === 'notebook' ? 'Notebook' : type === 'note' ? 'Note' : 'To-do List'}`,
      message: `Are you sure you want to delete "${name}"?`,
      isDestructive: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        const table = type === 'todo_list' ? 'todo_lists' : type === 'notebook' ? 'notebooks' : 'notes';
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) {
          setTimeout(() => setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => {} }), 500);
        } else fetchData();
      }
    });
  };

  const handleTogglePin = async (item: Item) => {
    const table = item.type === 'todo_list' ? 'todo_lists' : item.type === 'note' ? 'notes' : 'notebooks';
    const newPinned = !item.is_pinned;
    const pinned_at = newPinned ? new Date().toISOString() : null;
    const { error } = await supabase.from(table).update({ is_pinned: newPinned, pinned_at }).eq('id', item.id);
    if (error) setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => {} });
    else fetchData();
  };

  const handleSaveReorder = async (newData: DisplayItem[]) => {
    if (user?.id) {
      const layoutIds = newData.map(item => item.id);
      while (layoutIds.length > 0 && layoutIds[layoutIds.length - 1].startsWith('empty-')) {
        layoutIds.pop();
      }
      setDashboardLayout(layoutIds);
      await AsyncStorage.setItem(`dashboard_layout_${user.id}`, JSON.stringify(layoutIds));
    }
    
    // We no longer need to update pinned_at just for ordering on Home, 
    // because AsyncStorage dashboard_layout is now the absolute truth for Home layout.
  };

  const renderCardContent = (item: DisplayItem, index: number) => {
    if (item.type === 'empty') {
      return <View key={item.id} style={{ width: halfWidth, height: halfWidth, backgroundColor: 'transparent' }} />;
    }

    const cardColor = colors.cardColors[index % colors.cardColors.length];
    
    if (editingId === item.id) {
      if (item.type === 'folder') {
        return (
          <View key={item.id} style={[styles.folderSquareItem, { width: halfWidth, height: halfWidth }]}>
            <Text style={styles.folderSquareIcon}>📁</Text>
            <View style={styles.editContainer}>
              <TextInput
                style={styles.folderEditInput}
                value={editingName}
                onChangeText={setEditingName}
                autoFocus
                onSubmitEditing={() => handleUpdateItem(item.id, item.type === 'note' ? 'note' : item.type === 'todo_list' ? 'todo_list' : 'notebook')}
              />
            </View>
          </View>
        );
      } else {
        const isHalf = item.type === 'notebook';
        return (
          <View key={item.id} style={[styles.card, { backgroundColor: cardColor, width: isHalf ? halfWidth : contentWidth, height: isHalf ? halfWidth : 140 }]}>
            <View style={styles.editContainer}>
              <TextInput
                style={styles.editInput}
                value={editingName}
                onChangeText={setEditingName}
                autoFocus
                onSubmitEditing={() => handleUpdateItem(item.id, item.type === 'note' ? 'note' : item.type === 'todo_list' ? 'todo_list' : 'notebook')}
              />
            </View>
          </View>
        );
      }
    }

    if (item.type === 'folder' || item.type === 'todo_list') {
      const isFolder = item.type === 'folder';
      return (
        <TouchableOpacity 
          key={item.id}
          style={[styles.folderSquareItem, { width: halfWidth, height: halfWidth }]}
          activeOpacity={0.7}
          onPress={() => {
            if (isFolder) navigation.navigate('Notebook', { notebookId: item.id, name: item.name });
            else navigation.navigate('TodoList', { listId: item.id, title: item.name });
          }}
          onLongPress={() => setActionMenu({ visible: true, item })}
        >
          <Text style={styles.folderSquareIcon}>{isFolder ? '📁' : '🗒️'}</Text>
          <Text style={styles.folderSquareTitle} numberOfLines={2}>{item.name}</Text>
          {item.is_pinned && activeTab !== 'Home' && <Feather name="anchor" size={14} color="rgba(255,255,255,0.5)" style={{ marginTop: 4 }} />}
        </TouchableOpacity>
      );
    }

    const isHalf = item.type === 'notebook';
    const isNote = item.type === 'note';
    
    return (
      <TouchableOpacity 
        key={item.id}
        style={[styles.card, { backgroundColor: cardColor, width: isHalf ? halfWidth : contentWidth, height: isHalf ? halfWidth : 140 }]}
        activeOpacity={0.9}
        onPress={() => {
          if (item.type === 'notebook') navigation.navigate('Notebook', { notebookId: item.id, name: item.name });
          else navigation.navigate('Note', { noteId: item.id, title: item.name });
        }}
        onLongPress={() => setActionMenu({ visible: true, item })}
      >
        <View style={styles.cardContent}>
          <View style={{ flex: 1, flexDirection: isNote ? 'row' : 'column', alignItems: isNote ? 'center' : 'flex-start' }}>
            {isNote && (
              <View style={[styles.iconWrapper, { marginBottom: 0, marginRight: 16 }]}>
                <Text style={styles.icon}>✏️</Text>
              </View>
            )}
            <Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={isNote ? 1 : 2}>{item.name}</Text>
          </View>
          <View style={styles.cardBottomRow}>
            <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()} {isNote && '• NOTE'}</Text>
            {item.is_pinned && activeTab !== 'Home' && <Feather name="anchor" size={14} color="rgba(0,0,0,0.5)" />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>My{'\n'}Notes</Text>
          <TouchableOpacity 
            onPress={() => {
              setAlertConfig({
                visible: true, title: 'Sign Out', message: 'Are you sure you want to sign out?', isDestructive: true, confirmText: 'Sign Out',
                onConfirm: () => supabase.auth.signOut()
              });
            }} 
            style={styles.profileBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.profileInitials}>{username.substring(0, 2).toUpperCase()}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.pillsContainer}>
          {(['Home', 'Notebooks', 'To-do'] as Tab[]).map(tab => (
            <TouchableOpacity 
              key={tab} 
              style={[styles.pill, activeTab === tab && styles.pillActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={activeTab === tab ? styles.pillTextActive : styles.pillText}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab !== 'Home' && (
          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <Feather name="search" size={20} color={colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder={activeTab === 'To-do' ? "Search to-dos..." : "Search notebooks..."}
                placeholderTextColor={colors.textDisabled}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <TouchableOpacity 
              style={styles.sortBtn}
              onPress={() => setSortConfig(prev => {
                if (prev.field === 'date' && prev.order === 'asc') return { field: 'date', order: 'desc' };
                if (prev.field === 'date' && prev.order === 'desc') return { field: 'name', order: 'asc' };
                if (prev.field === 'name' && prev.order === 'asc') return { field: 'name', order: 'desc' };
                return { field: 'date', order: 'asc' };
              })}
            >
              <Text style={styles.sortBtnText}>Sort by: <Text style={{ color: colors.textPrimary }}>{sortConfig.field === 'date' ? 'Date' : 'Name'}</Text></Text>
              <Feather name={sortConfig.order === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} color={colors.textPrimary} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginTop: 40 }} />
      ) : (activeTab === 'Home' && displayedItems.filter(i => i.type !== 'empty').length === 0) ? (
        <View style={styles.emptyContainer}>
           <Text style={styles.emptyText}>
             Nothing pinned yet. Long press a notebook or note to pin it here.
           </Text>
        </View>
      ) : displayedItems.length === 0 ? (
        <View style={styles.emptyContainer}>
           <Text style={styles.emptyText}>
             {activeTab === 'To-do' ? "No to-dos found. Add a checklist block to a note." : "No items found."}
           </Text>
        </View>
      ) : activeTab === 'Home' ? (
        <Animated.ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          <Sortable.Flex
            scrollableRef={scrollRef}
            flexDirection="row"
            flexWrap="wrap"
            justifyContent="space-between"
            paddingHorizontal={16}
            rowGap={16}
            onDragEnd={({ order }) => handleSaveReorder(order(displayedItems))}
          >
            {displayedItems.map((item, index) => renderCardContent(item, index))}
          </Sortable.Flex>
        </Animated.ScrollView>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContainer}
        >
          {groupedData.map((item, index) => {
            if (item.type === 'row') {
              return (
                <View key={`row-${index}`} style={styles.rowWrapper}>
                  {item.items.map((col: any) => (
                    <React.Fragment key={col.item.id}>
                      {renderCardContent(col.item, col.index)}
                    </React.Fragment>
                  ))}
                  {item.items.length === 1 && <View style={styles.folderSquareItemPlaceholder} />}
                </View>
              );
            } else {
              const col = item.items[0];
              return (
                <React.Fragment key={`single-${index}`}>
                  {renderCardContent(col.item, col.index)}
                </React.Fragment>
              );
            }
          })}
        </ScrollView>
      )}

      {/* Floating Action Button */}
      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Creation Modal */}
      <Modal visible={isModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Text style={styles.modalTitle}>{activeTab === 'To-do' ? 'New To-do List' : 'New Notebook'}</Text>
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
                  setEditingType(item.type);
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
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    marginTop: 8,
  },
  profileInitials: {
    color: colors.textPrimary,
    fontSize: 22,
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

  searchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24 },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 16, marginRight: 12,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16, marginLeft: 12 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16 },
  sortBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { color: colors.textSecondary, fontSize: 18, textAlign: 'center', lineHeight: 28 },

  listContainer: { paddingHorizontal: 16, paddingBottom: 100 },
  
  rowWrapper: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },

  folderSquareItem: { width: '48%', aspectRatio: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
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
  folderSquareItemPlaceholder: { width: '48%' },

  card: {
    borderRadius: 32,
    padding: 24,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardFull: {
    width: '100%',
    height: 140,
  },
  cardHalf: {
    width: '48%',
    aspectRatio: 1,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111111',
    lineHeight: 32,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardDate: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.5)',
  },

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
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  icon: { fontSize: 16 },

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
});
