import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Animated, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { Feather } from '@expo/vector-icons';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Note'>;
  route: RouteProp<RootStackParamList, 'Note'>;
};

type ChecklistItem = {
  id: string;
  block_id: string;
  content: string;
  is_checked: boolean;
  order_index: number;
};

type NoteBlock = {
  id: string;
  note_id: string;
  block_type: 'text' | 'checklist';
  order_index: number;
  text_content?: string;
  checklist_items?: ChecklistItem[];
};

export const NoteScreen = ({ navigation, route }: Props) => {
  const { noteId } = route.params;
  const user = useAuthStore(state => state.user);

  const [title, setTitle] = useState(route.params.title || '');
  const [blocks, setBlocks] = useState<NoteBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);

  // Use refs for debouncing to avoid stale closures
  const saveTimeoutRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  // Basic history state for undo/redo (tracks latest saved states)
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoActive = useRef(false);

  // Toolbar Animation
  const slideAnim = useRef(new Animated.Value(0)).current;

  const expand = () => {
    setIsToolbarExpanded(true);
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  };
  
  const collapse = () => {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 8 }).start(() => {
      setIsToolbarExpanded(false);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -30) {
          expand();
        } else if (gestureState.dy > 30) {
          collapse();
        }
      }
    })
  ).current;

  useEffect(() => {
    fetchNote();
  }, [noteId]);

  const updateHeaderOptions = () => {
    navigation.setOptions({
      headerShown: false, // Completely hide the native header
    });
  };

  const pushToHistory = (newTitle: string, newBlocks: NoteBlock[]) => {
    if (isUndoRedoActive.current) return;
    const snapshot = JSON.stringify({ title: newTitle, blocks: newBlocks });
    
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      if (trimmed[trimmed.length - 1] === snapshot) return trimmed; // No change
      return [...trimmed, snapshot];
    });
    setHistoryIndex(prev => prev + 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      isUndoRedoActive.current = true;
      const prevSnapshot = JSON.parse(history[historyIndex - 1]);
      setTitle(prevSnapshot.title);
      setBlocks(prevSnapshot.blocks);
      setHistoryIndex(historyIndex - 1);
      setTimeout(() => { isUndoRedoActive.current = false; }, 100);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      isUndoRedoActive.current = true;
      const nextSnapshot = JSON.parse(history[historyIndex + 1]);
      setTitle(nextSnapshot.title);
      setBlocks(nextSnapshot.blocks);
      setHistoryIndex(historyIndex + 1);
      setTimeout(() => { isUndoRedoActive.current = false; }, 100);
    }
  };

  const fetchNote = async () => {
    updateHeaderOptions();

    // Fetch title
    let currentTitle = route.params.title || '';
    const { data: noteData } = await supabase.from('notes').select('title').eq('id', noteId).single();
    if (noteData) {
      currentTitle = noteData.title;
      setTitle(currentTitle);
    }

    // Fetch blocks
    const { data: blocksData, error: blocksError } = await supabase
      .from('note_blocks')
      .select('*')
      .eq('note_id', noteId)
      .order('order_index', { ascending: true });

    if (blocksError) {
      Alert.alert('Error', blocksError.message);
      return;
    }

    let currentBlocks: NoteBlock[] = [];
    if (!blocksData || blocksData.length === 0) {
      const { data } = await supabase.from('note_blocks').insert({
        note_id: noteId, block_type: 'text', order_index: 0, text_content: ''
      }).select().single();
      if (data) currentBlocks = [{ ...data, checklist_items: [] }];
    } else {
      const checklistBlockIds = blocksData.filter(b => b.block_type === 'checklist').map(b => b.id);
      let itemsData: ChecklistItem[] = [];
      if (checklistBlockIds.length > 0) {
        const { data: items } = await supabase
          .from('checklist_items')
          .select('*')
          .in('block_id', checklistBlockIds)
          .order('order_index', { ascending: true });
        if (items) itemsData = items;
      }

      currentBlocks = blocksData.map(b => ({
        ...b,
        checklist_items: b.block_type === 'checklist' ? itemsData.filter(i => i.block_id === b.id) : []
      }));
    }
    setBlocks(currentBlocks);
    pushToHistory(currentTitle, currentBlocks);
    setLoading(false);
  };

  const debouncedSaveTitle = useCallback((newTitle: string) => {
    if (saveTimeoutRef.current['title']) clearTimeout(saveTimeoutRef.current['title']);
    saveTimeoutRef.current['title'] = setTimeout(async () => {
      await supabase.from('notes').update({ title: newTitle.trim() || 'Untitled', updated_at: new Date().toISOString() }).eq('id', noteId);
      pushToHistory(newTitle, blocks);
    }, 1000);
  }, [noteId, blocks]);

  const handleTitleChange = (text: string) => {
    setTitle(text);
    debouncedSaveTitle(text);
  };

  const addBlock = async (type: 'text' | 'checklist', order: number) => {
    const { data, error } = await supabase.from('note_blocks').insert({
      note_id: noteId,
      block_type: type,
      order_index: order,
      text_content: ''
    }).select().single();

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      const newBlocks = [...blocks, { ...data, checklist_items: [] }];
      setBlocks(newBlocks);
      pushToHistory(title, newBlocks);
    }
  };

  const debouncedSaveTextBlock = useCallback((blockId: string, content: string, currentBlocks: NoteBlock[]) => {
    if (saveTimeoutRef.current[blockId]) clearTimeout(saveTimeoutRef.current[blockId]);
    saveTimeoutRef.current[blockId] = setTimeout(async () => {
      await supabase.from('note_blocks').update({ text_content: content }).eq('id', blockId);
      pushToHistory(title, currentBlocks);
    }, 1000);
  }, [title]);

  const handleTextBlockChange = (blockId: string, text: string) => {
    const newBlocks = blocks.map(b => b.id === blockId ? { ...b, text_content: text } : b);
    setBlocks(newBlocks);
    debouncedSaveTextBlock(blockId, text, newBlocks);
  };

  const addChecklistItem = async (blockId: string) => {
    const block = blocks.find(b => b.id === blockId);
    const order = block?.checklist_items?.length || 0;
    
    const { data, error } = await supabase.from('checklist_items').insert({
      block_id: blockId,
      content: '',
      order_index: order
    }).select().single();

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      const newBlocks = blocks.map(b => {
        if (b.id === blockId) return { ...b, checklist_items: [...(b.checklist_items || []), data] };
        return b;
      });
      setBlocks(newBlocks);
      pushToHistory(title, newBlocks);
    }
  };

  const debouncedSaveChecklistItem = useCallback((itemId: string, content: string, currentBlocks: NoteBlock[]) => {
    if (saveTimeoutRef.current[itemId]) clearTimeout(saveTimeoutRef.current[itemId]);
    saveTimeoutRef.current[itemId] = setTimeout(async () => {
      await supabase.from('checklist_items').update({ content }).eq('id', itemId);
      pushToHistory(title, currentBlocks);
    }, 1000);
  }, [title]);

  const handleChecklistItemChange = (blockId: string, itemId: string, text: string) => {
    const newBlocks = blocks.map(b => {
      if (b.id === blockId && b.checklist_items) {
        return { ...b, checklist_items: b.checklist_items.map(i => i.id === itemId ? { ...i, content: text } : i) };
      }
      return b;
    });
    setBlocks(newBlocks);
    debouncedSaveChecklistItem(itemId, text, newBlocks);
  };

  const toggleChecklistItem = async (blockId: string, itemId: string, currentStatus: boolean) => {
    const newBlocks = blocks.map(b => {
      if (b.id === blockId && b.checklist_items) {
        return { ...b, checklist_items: b.checklist_items.map(i => i.id === itemId ? { ...i, is_checked: !currentStatus } : i) };
      }
      return b;
    });
    setBlocks(newBlocks);
    await supabase.from('checklist_items').update({ is_checked: !currentStatus }).eq('id', itemId);
    pushToHistory(title, newBlocks);
  };

  const deleteBlock = async (blockId: string) => {
    const newBlocks = blocks.filter(b => b.id !== blockId);
    setBlocks(newBlocks);
    await supabase.from('note_blocks').delete().eq('id', blockId);
    pushToHistory(title, newBlocks);
  };

  const deleteChecklistItem = async (blockId: string, itemId: string) => {
    const newBlocks = blocks.map(b => {
      if (b.id === blockId && b.checklist_items) {
        return { ...b, checklist_items: b.checklist_items.filter(i => i.id !== itemId) };
      }
      return b;
    });
    setBlocks(newBlocks);
    await supabase.from('checklist_items').delete().eq('id', itemId);
    pushToHistory(title, newBlocks);
  };

  const handleDeleteNote = async () => {
    Alert.alert('Delete Note', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('notes').delete().eq('id', noteId);
        navigation.goBack();
      }}
    ]);
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.textPrimary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        {/* Custom Floating Header */}
        <View style={styles.customHeader}>
          <TouchableOpacity style={styles.circleBtn} onPress={() => navigation.goBack()}>
            <Feather name="chevron-left" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.rightHeaderActions}>
            <TouchableOpacity style={[styles.circleBtn, styles.circleBtnSmall]} onPress={handleUndo}>
              <Feather name="corner-up-left" size={20} color={colors.cardColors[4]} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, styles.circleBtnSmall]} onPress={handleRedo}>
              <Feather name="corner-up-right" size={20} color={colors.cardColors[3]} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, styles.circleBtnSmall]} onPress={() => navigation.goBack()}>
              <Feather name="check" size={20} color={colors.cardColors[2]} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={handleTitleChange}
          placeholder="Note Title..."
          placeholderTextColor={colors.textDisabled}
        />

        {blocks.map((block, index) => {
          const blockAccent = colors.cardColors[index % colors.cardColors.length];
          return (
            <View key={block.id} style={styles.blockContainer}>
              {block.block_type === 'text' ? (
                <TextInput
                  style={styles.textBlockInput}
                  multiline
                  value={block.text_content}
                  onChangeText={(text) => handleTextBlockChange(block.id, text)}
                  placeholder="Start typing..."
                  placeholderTextColor={colors.textDisabled}
                  scrollEnabled={false}
                />
              ) : (
                <View style={styles.checklistBlock}>
                  {block.checklist_items?.map((item) => (
                    <View key={item.id} style={styles.checklistItemRow}>
                      <TouchableOpacity onPress={() => toggleChecklistItem(block.id, item.id, item.is_checked)} style={[styles.checkbox, { borderColor: blockAccent }]}>
                        {item.is_checked && <View style={[styles.checkboxInner, { backgroundColor: blockAccent }]} />}
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.checklistItemInput, item.is_checked && styles.checklistItemInputDone]}
                        value={item.content}
                        onChangeText={(text) => handleChecklistItemChange(block.id, item.id, text)}
                        placeholder="List item..."
                        placeholderTextColor={colors.textDisabled}
                      />
                      <TouchableOpacity onPress={() => deleteChecklistItem(block.id, item.id)} style={styles.deleteBtn}>
                        <Feather name="x" size={20} color={colors.textDisabled} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => addChecklistItem(block.id)} style={styles.addChecklistBtn}>
                    <Feather name="plus" size={18} color={blockAccent} />
                    <Text style={[styles.addChecklistBtnText, { color: blockAccent }]}>Add Item</Text>
                  </TouchableOpacity>
                </View>
              )}
              
              <TouchableOpacity onPress={() => deleteBlock(block.id)} style={styles.deleteBlockBtn}>
                <Feather name="trash-2" size={20} color={colors.textDisabled} />
              </TouchableOpacity>
            </View>
          );
        })}

      </ScrollView>

      {/* Expandable Toolbar overlay */}
      <Animated.View 
        {...panResponder.panHandlers}
        style={[
          styles.toolbar,
          { 
            transform: [{ 
              translateY: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -320]
              }) 
            }] 
          }
        ]}
      >
        <View style={styles.grabberContainer}>
          <View style={styles.grabber} />
        </View>

        <View style={styles.toolbarCollapsedRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity style={styles.toolbarBtn} onPress={() => addBlock('text', blocks.length)}>
              <Feather name="type" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolbarBtn} onPress={() => addBlock('checklist', blocks.length)}>
              <Feather name="check-square" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => isToolbarExpanded ? collapse() : expand()} style={{ padding: 8 }}>
            <Feather name={isToolbarExpanded ? "chevron-down" : "more-horizontal"} size={26} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.toolbarExpandedContent}>
          {/* Color labels placeholder */}
          <View style={styles.colorRow}>
            {colors.cardColors.map(c => (
                <TouchableOpacity key={c} style={[styles.colorCircle, { backgroundColor: c }]} onPress={() => Alert.alert('Color applied!')} />
            ))}
          </View>

          {/* Menu Items */}
          <TouchableOpacity style={styles.menuItem} onPress={handleDeleteNote}>
            <Feather name="trash-2" size={22} color={colors.actions.signOut} style={styles.menuIcon} />
            <Text style={[styles.menuText, { color: colors.actions.signOut }]}>Delete note</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => Alert.alert('Copy', 'Copied to clipboard!')}>
            <Feather name="copy" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Make a copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => Alert.alert('Share', 'Share menu opened!')}>
            <Feather name="share-2" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { collapse(); Alert.alert('Labels', 'Labels coming in Phase 3!'); }}>
            <Feather name="tag" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Labels</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
      
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A1A1A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A1A' },
  scrollContent: { padding: 24, paddingTop: 16, paddingBottom: 250 },
  
  customHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  rightHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  circleBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 4px 10px rgba(0,0,0,0.2)' as any },
      default: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 }
    }),
  },
  circleBtnSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 12,
  },

  titleInput: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 24,
    lineHeight: 52,
    letterSpacing: -1,
    ...Platform.select({ web: { outlineStyle: 'none' } as any }),
  },

  blockContainer: {
    marginBottom: 24,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  
  textBlockInput: {
    flex: 1,
    fontSize: 20,
    color: '#E0E0E0',
    lineHeight: 32,
    minHeight: 120,
    ...Platform.select({ web: { outlineStyle: 'none' } as any }),
  },

  checklistBlock: {
    flex: 1,
    backgroundColor: '#252525',
    padding: 20,
    borderRadius: 24,
  },
  checklistItemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  checkbox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.accents.note, marginRight: 16, justifyContent: 'center', alignItems: 'center' },
  checkboxInner: { width: 14, height: 14, borderRadius: 4, backgroundColor: colors.accents.note },
  checklistItemInput: { flex: 1, fontSize: 18, color: '#FFFFFF', ...Platform.select({ web: { outlineStyle: 'none' } as any }) },
  checklistItemInputDone: { color: '#888888', textDecorationLine: 'line-through' },
  deleteBtn: { padding: 4 },
  
  addChecklistBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 8, padding: 8 },
  addChecklistBtnText: { color: colors.accents.note, fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
  
  deleteBlockBtn: { marginLeft: 12, padding: 8, opacity: 0.6 },

  toolbar: {
    position: 'absolute',
    bottom: -320, // total height 400 - 80 exposed
    left: 0, 
    right: 0,
    height: 400,
    backgroundColor: '#0A0A0A',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  grabberContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  grabber: {
    width: 40,
    height: 5,
    backgroundColor: '#444444',
    borderRadius: 3,
  },
  toolbarCollapsedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    height: 48,
  },
  toolbarBtn: { marginRight: 24, padding: 8 },
  
  toolbarExpandedContent: {
    flex: 1,
    marginTop: 16,
  },
  colorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  colorCircle: {
    width: 36, height: 36, borderRadius: 18,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
  },
  menuIcon: {
    marginRight: 16,
  },
  menuText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
