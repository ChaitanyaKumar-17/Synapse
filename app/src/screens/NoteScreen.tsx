import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Animated, PanResponder, Modal, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { CustomAlert } from '../components/CustomAlert';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import DateTimePicker from '@react-native-community/datetimepicker';
import { scheduleReminder, cancelReminder } from '../lib/notifications';

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

type Attachment = {
  id: string;
  storage_path: string;
  file_type: 'image' | 'file';
  file_name: string;
  created_at?: string;
  publicUrl?: string;
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);
  const [fullImage, setFullImage] = useState<string | null>(null);

  // Tags State
  const [tagsModalVisible, setTagsModalVisible] = useState(false);
  const [allTags, setAllTags] = useState<{id: string, name: string, color: string}[]>([]);
  const [noteTagIds, setNoteTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(colors.cardColors[0]);
  
  const [noteColor, setNoteColor] = useState<string | null>(null);
  const notebookIdRef = useRef<string | null>(null);

  const [alertConfig, setAlertConfig] = useState({
    visible: false, title: '', message: '', isDestructive: false, confirmText: 'OK', onConfirm: () => {}
  });

  const [reminderAt, setReminderAt] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  // Use refs for debouncing to avoid stale closures
  const saveTimeoutRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  // Basic history state for undo/redo (tracks latest saved states)
  const historyRef = useRef<{ list: string[], index: number }>({ list: [], index: -1 });
  const isUndoRedoActive = useRef(false);

  // Toolbar Animation
  const slideAnim = useRef(new Animated.Value(0)).current;

  const expand = () => {
    setIsToolbarExpanded(true);
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  };
  
  const collapse = () => {
    setIsToolbarExpanded(false);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
  };

  const handlersRef = useRef({ expand, collapse });
  handlersRef.current = { expand, collapse };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -30) {
          handlersRef.current.expand();
        } else if (gestureState.dy > 30) {
          handlersRef.current.collapse();
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
    
    const { list, index } = historyRef.current;
    const trimmed = list.slice(0, index + 1);
    
    if (trimmed.length > 0 && trimmed[trimmed.length - 1] === snapshot) return;
    
    historyRef.current = {
      list: [...trimmed, snapshot],
      index: index + 1
    };
  };

  const saveStateToSupabase = async (newTitle: string, newBlocks: NoteBlock[]) => {
    await supabase.from('notes').update({ title: newTitle.trim() || 'Untitled' }).eq('id', noteId);
    
    let textForEmbedding = '';
    
    for (const block of newBlocks) {
      if (block.block_type === 'text') {
        await supabase.from('note_blocks').update({ text_content: block.text_content }).eq('id', block.id);
        if (block.text_content) textForEmbedding += block.text_content + '\n';
      } else if (block.block_type === 'checklist' && block.checklist_items) {
        for (const item of block.checklist_items) {
          await supabase.from('checklist_items').update({ content: item.content, is_checked: item.is_checked }).eq('id', item.id);
          if (item.content) textForEmbedding += `- [${item.is_checked ? 'x' : ' '}] ${item.content}\n`;
        }
      }
    }

    if (textForEmbedding.trim().length === 0) {
      textForEmbedding = newTitle.trim() || 'Untitled';
    }

    if (textForEmbedding.trim().length > 0) {
      // Call embed-note edge function via Supabase client to ensure auth headers are correct
      // We don't await this so it happens in the background without blocking the UI
      supabase.functions.invoke('embed-note', {
        body: {
          note_id: noteId,
          notebook_id: notebookIdRef.current,
          title: newTitle.trim() || 'Untitled',
          text_content: textForEmbedding
        }
      }).catch(err => console.log('Background embedding error:', err));
    }
  };

  const handleUndo = () => {
    const { list, index } = historyRef.current;
    if (index > 0) {
      isUndoRedoActive.current = true;
      historyRef.current.index = index - 1;
      const prevSnapshot = JSON.parse(list[historyRef.current.index]);
      
      setTitle(prevSnapshot.title);
      setBlocks(prevSnapshot.blocks);
      
      saveStateToSupabase(prevSnapshot.title, prevSnapshot.blocks);
      setTimeout(() => { isUndoRedoActive.current = false; }, 100);
    }
  };

  const handleRedo = () => {
    const { list, index } = historyRef.current;
    if (index < list.length - 1) {
      isUndoRedoActive.current = true;
      historyRef.current.index = index + 1;
      const nextSnapshot = JSON.parse(list[historyRef.current.index]);
      
      setTitle(nextSnapshot.title);
      setBlocks(nextSnapshot.blocks);
      
      saveStateToSupabase(nextSnapshot.title, nextSnapshot.blocks);
      setTimeout(() => { isUndoRedoActive.current = false; }, 100);
    }
  };

  const fetchNote = async () => {
    updateHeaderOptions();

    // Fetch title, color, notebookId
    let currentTitle = route.params.title || '';
    const { data: noteData } = await supabase.from('notes').select('title, notebook_id, color, reminder_at').eq('id', noteId).single();
    if (noteData) {
      currentTitle = noteData.title;
      setTitle(currentTitle);
      notebookIdRef.current = noteData.notebook_id;
      if (noteData.color) setNoteColor(noteData.color);
      if (noteData.reminder_at) setReminderAt(new Date(noteData.reminder_at));
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
    
    // Fetch Attachments
    const { data: attachData } = await supabase.from('attachments').select('*').eq('note_id', noteId).order('created_at', { ascending: true });
    if (attachData) {
      const parsedAttachments = await Promise.all(attachData.map(async (a) => {
        if (a.file_type === 'image') {
           const { data } = await supabase.storage.from('attachments').createSignedUrl(a.storage_path, 3600);
           return { ...a, publicUrl: data?.signedUrl };
        }
        return a;
      }));
      setAttachments(parsedAttachments);
    }
    
    pushToHistory(currentTitle, currentBlocks);
    setLoading(false);
  };

  const fetchTags = async () => {
    const { data: tagsData } = await supabase.from('tags').select('*').eq('user_id', user?.id).order('name');
    if (tagsData) setAllTags(tagsData);

    const { data: noteTagsData } = await supabase.from('note_tags').select('tag_id').eq('note_id', noteId);
    if (noteTagsData) setNoteTagIds(noteTagsData.map(nt => nt.tag_id));
  };

  const handleOpenTags = () => {
    setIsToolbarExpanded(false);
    // Use Animated.timing with 0 duration to properly force the native thread to reset
    Animated.timing(slideAnim, { toValue: 0, duration: 0, useNativeDriver: true }).start(() => {
      fetchTags();
      setTagsModalVisible(true);
    });
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const { data, error } = await supabase.from('tags').insert({
      user_id: user?.id,
      name: newTagName.trim(),
      color: newTagColor
    }).select().single();
    if (error) { Alert.alert('Error', error.message); return; }
    setAllTags([...allTags, data]);
    setNewTagName('');
  };

  const handleToggleNoteTag = async (tagId: string) => {
    if (noteTagIds.includes(tagId)) {
      setNoteTagIds(noteTagIds.filter(id => id !== tagId));
      await supabase.from('note_tags').delete().match({ note_id: noteId, tag_id: tagId });
    } else {
      setNoteTagIds([...noteTagIds, tagId]);
      await supabase.from('note_tags').insert({ note_id: noteId, tag_id: tagId });
    }
  };

  const handleDeleteTagGlobal = async (tagId: string) => {
    setAlertConfig({
      visible: true,
      title: 'Delete Label',
      message: 'This will remove the label from all notes. Are you sure?',
      isDestructive: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        setAllTags(allTags.filter(t => t.id !== tagId));
        setNoteTagIds(noteTagIds.filter(id => id !== tagId));
        await supabase.from('tags').delete().eq('id', tagId);
      }
    });
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

  const handleChecklistItemChange = (blockId: string, itemId: string, newText: string) => {
    setBlocks(prev => prev.map(b => b.id === blockId ? {
      ...b,
      checklist_items: b.checklist_items?.map(i => i.id === itemId ? { ...i, content: newText } : i)
    } : b));
    if (saveTimeoutRef.current[`item-${itemId}`]) clearTimeout(saveTimeoutRef.current[`item-${itemId}`]);
    saveTimeoutRef.current[`item-${itemId}`] = setTimeout(async () => {
      await supabase.from('checklist_items').update({ content: newText }).eq('id', itemId);
      pushToHistory(title, blocks); // Warning: closure capture might be stale without refs, but acceptable for now
    }, 1000);
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
    const doDelete = async () => {
      const { error } = await supabase.from('notes').delete().eq('id', noteId);
      if (error) {
        setTimeout(() => {
          setAlertConfig({ visible: true, title: 'Error', message: error.message, isDestructive: false, confirmText: 'OK', onConfirm: () => {} });
        }, 500);
      } else {
        navigation.goBack();
      }
    };

    setAlertConfig({
      visible: true,
      title: 'Delete Note',
      message: 'Are you sure you want to delete this note?',
      isDestructive: true,
      confirmText: 'Delete',
      onConfirm: doDelete
    });
  };

  const handleMakeCopy = async () => {
    if (!notebookIdRef.current) return;
    
    // Immediately close the menu to provide feedback
    collapse();
    
    const { data: newNote } = await supabase.from('notes').insert({
      user_id: user?.id,
      notebook_id: notebookIdRef.current,
      title: `${title} (Copy)`,
      color: noteColor
    }).select().single();
    
    if (newNote) {
      // Copy all blocks
      for (const block of blocks) {
        const { data: newBlock } = await supabase.from('note_blocks').insert({
          note_id: newNote.id,
          block_type: block.block_type,
          order_index: block.order_index,
          text_content: block.text_content
        }).select().single();
        
        if (newBlock && block.block_type === 'checklist' && block.checklist_items && block.checklist_items.length > 0) {
           const itemsToInsert = block.checklist_items.map(item => ({
             block_id: newBlock.id,
             content: item.content,
             is_checked: item.is_checked,
             order_index: item.order_index
           }));
           await supabase.from('checklist_items').insert(itemsToInsert);
        }
      }
      
      // Copy all tags
      if (noteTagIds.length > 0) {
        await supabase.from('note_tags').insert(noteTagIds.map(tId => ({ note_id: newNote.id, tag_id: tId })));
      }
      
      setAlertConfig({
        visible: true,
        title: 'Success',
        message: 'Note duplicated!',
        isDestructive: false,
        confirmText: 'OK',
        onConfirm: () => navigation.replace('Note', { noteId: newNote.id, title: newNote.title })
      });
    }
  };

  const uploadAttachment = async (uri: string, type: 'image' | 'file', fileName: string) => {
    setLoading(true);
    try {
      const ext = fileName.split('.').pop() || (type === 'image' ? 'jpg' : 'bin');
      const storagePath = `${user?.id}/${noteId}/${Date.now()}.${ext}`;
      
      const response = await fetch(uri);
      const blob = await response.blob();
      
      const { error: uploadError } = await supabase.storage.from('attachments').upload(storagePath, blob);
      if (uploadError) throw uploadError;
      
      const { data: dbData, error: dbError } = await supabase.from('attachments').insert({
        note_id: noteId,
        storage_path: storagePath,
        file_type: type,
        file_name: fileName
      }).select().single();
      
      if (dbError) throw dbError;
      
      if (type === 'image') {
        const { data: signedData } = await supabase.storage.from('attachments').createSignedUrl(storagePath, 3600);
        setAttachments(prev => [...prev, { ...dbData, publicUrl: signedData?.signedUrl }]);
      } else {
        setAttachments(prev => [...prev, dbData]);
      }
    } catch (err: any) {
      Alert.alert('Upload Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      uploadAttachment(result.assets[0].uri, 'image', result.assets[0].fileName || `image_${Date.now()}.jpg`);
    }
  };

  const handleAddFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({});
    if (!result.canceled && result.assets && result.assets.length > 0) {
      uploadAttachment(result.assets[0].uri, 'file', result.assets[0].name);
    }
  };

  const handleOpenFile = async (attachment: Attachment) => {
    if (attachment.file_type === 'image' && attachment.publicUrl) return; // Images show inline
    
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from('attachments').createSignedUrl(attachment.storage_path, 60);
      if (error || !data) throw error || new Error('Could not get download URL');
      
      if (Platform.OS === 'web') {
        window.open(data.signedUrl, '_blank');
      } else if (Platform.OS === 'android') {
        const localUri = `${FileSystem.documentDirectory}${attachment.file_name}`;
        const { uri } = await FileSystem.downloadAsync(data.signedUrl, localUri);
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1,
        });
      } else {
        const localUri = `${FileSystem.documentDirectory}${attachment.file_name}`;
        const { uri } = await FileSystem.downloadAsync(data.signedUrl, localUri);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          Alert.alert('Cannot open', 'Sharing is not available on this device');
        }
      }
    } catch (err: any) {
      Alert.alert('Download Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAttachment = async (attachment: Attachment) => {
    Alert.alert('Delete Attachment', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setAttachments(prev => prev.filter(a => a.id !== attachment.id));
        await supabase.from('attachments').delete().eq('id', attachment.id);
        await supabase.storage.from('attachments').remove([attachment.storage_path]);
      }}
    ]);
  };

  const handleChangeColor = async (color: string) => {
    setNoteColor(color);
    await supabase.from('notes').update({ color }).eq('id', noteId);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate && event.type === 'set') {
      setTempDate(selectedDate);
      if (Platform.OS === 'android') {
        setShowTimePicker(true);
      }
    }
  };

  const onTimeChange = async (event: any, selectedDate?: Date) => {
    setShowTimePicker(false);
    if (selectedDate && event.type === 'set') {
      setReminderAt(selectedDate);
      await supabase.from('notes').update({ reminder_at: selectedDate.toISOString() }).eq('id', noteId);
      await scheduleReminder(title || 'Note Reminder', 'You have a scheduled reminder!', selectedDate, noteId, 'note');
    }
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
            <TouchableOpacity style={[styles.circleBtn, styles.circleBtnSmall]} onPress={() => {
              if (reminderAt) {
                setAlertConfig({
                  visible: true,
                  title: 'Remove Reminder?',
                  message: 'Do you want to remove this reminder?',
                  isDestructive: true,
                  confirmText: 'Remove',
                  onConfirm: async () => {
                    setReminderAt(null);
                    await supabase.from('notes').update({ reminder_at: null }).eq('id', noteId);
                    await cancelReminder(noteId);
                  }
                });
              } else {
                setTempDate(new Date());
                setShowDatePicker(true);
              }
            }}>
              <Feather name="bell" size={20} color={reminderAt ? colors.accents.home : "#FFF"} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, styles.circleBtnSmall]} onPress={handleUndo}>
              <Feather name="corner-up-left" size={20} color={colors.cardColors[4]} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, styles.circleBtnSmall]} onPress={handleRedo}>
              <Feather name="corner-up-right" size={20} color={colors.cardColors[3]} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, styles.circleBtnSmall]} onPress={() => {
              // Ensure we save the final state and trigger the embedding edge function silently
              saveStateToSupabase(title, blocks);
              navigation.goBack();
            }}>
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

        {attachments.length > 0 && (
          <View style={styles.attachmentsContainer}>
            {attachments.map(att => (
              <View key={att.id} style={styles.attachmentWrapper}>
                {att.file_type === 'image' && att.publicUrl ? (
                  <View style={styles.imageContainer}>
                    <TouchableOpacity onPress={() => setFullImage(att.publicUrl!)}>
                      <Image source={{ uri: att.publicUrl }} style={styles.inlineImage} resizeMode="cover" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.attachmentDeleteBtn} onPress={() => handleDeleteAttachment(att)}>
                      <Feather name="x" size={16} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.fileCard} onPress={() => handleOpenFile(att)}>
                    <Feather name="file" size={24} color={noteColor || colors.accents.note} style={{ marginRight: 12 }} />
                    <Text style={styles.fileNameText} numberOfLines={1}>{att.file_name}</Text>
                    <TouchableOpacity style={{ padding: 8 }} onPress={() => handleDeleteAttachment(att)}>
                      <Feather name="trash-2" size={18} color={colors.textDisabled} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {blocks.map((block, index) => {
          // If noteColor is set, everything takes that color. Otherwise, use rainbow accents.
          const blockAccent = noteColor || colors.cardColors[index % colors.cardColors.length];
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
                outputRange: [440, 0]
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
          {/* Color labels */}
          <View style={styles.colorRow}>
            {colors.cardColors.map(c => (
                <TouchableOpacity 
                  key={c} 
                  style={[styles.colorCircle, { backgroundColor: c }, noteColor === c && { borderWidth: 3, borderColor: '#FFFFFF' }]} 
                  onPress={() => handleChangeColor(c)} 
                />
            ))}
          </View>

          {/* Menu Items */}
          <TouchableOpacity style={styles.menuItem} onPress={handleAddImage}>
            <Feather name="image" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Attach Image</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleAddFile}>
            <Feather name="paperclip" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Attach File</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleOpenTags}>
            <Feather name="tag" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Labels</Text>
          </TouchableOpacity>
          
          <View style={styles.menuDivider} />

          <TouchableOpacity style={styles.menuItem} onPress={handleMakeCopy}>
            <Feather name="copy" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Make a copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => Alert.alert('Share', 'Share menu opened!')}>
            <Feather name="share-2" size={22} color={colors.textPrimary} style={styles.menuIcon} />
            <Text style={styles.menuText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleDeleteNote}>
            <Feather name="trash-2" size={22} color={colors.actions.signOut} style={styles.menuIcon} />
            <Text style={[styles.menuText, { color: colors.actions.signOut }]}>Delete note</Text>
          </TouchableOpacity>
        </View>

        {/* Overscroll safe area block to prevent any bottom white strips */}
        <View style={{ position: 'absolute', top: 520, left: 0, right: 0, height: 400, backgroundColor: '#0A0A0A' }} />
      </Animated.View>
      
      {/* Tags Modal */}
      <Modal visible={tagsModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTagsModalVisible(false)}>
        <KeyboardAvoidingView style={styles.tagsModalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.tagsModalHeader}>
            <Text style={styles.tagsModalTitle}>Manage Labels</Text>
            <TouchableOpacity onPress={() => setTagsModalVisible(false)}>
              <Feather name="x" size={28} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.createTagSection}>
            <TextInput
              style={styles.createTagInput}
              placeholder="New label name..."
              placeholderTextColor={colors.textDisabled}
              value={newTagName}
              onChangeText={setNewTagName}
            />
            <View style={styles.tagColorPickerRow}>
              {colors.cardColors.map(c => (
                <TouchableOpacity 
                  key={c} 
                  style={[styles.tagColorCircle, { backgroundColor: c }, newTagColor === c && styles.tagColorCircleSelected]} 
                  onPress={() => setNewTagColor(c)} 
                />
              ))}
            </View>
            <TouchableOpacity style={styles.createTagBtn} onPress={handleCreateTag}>
              <Text style={styles.createTagBtnText}>+ Create Label</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.tagsList}>
            {allTags.map(tag => {
              const isAttached = noteTagIds.includes(tag.id);
              return (
                <View key={tag.id} style={styles.tagRow}>
                  <TouchableOpacity style={styles.tagRowMain} onPress={() => handleToggleNoteTag(tag.id)}>
                    <View style={[styles.tagCheckbox, isAttached && { backgroundColor: tag.color, borderColor: tag.color }]}>
                      {isAttached && <Feather name="check" size={16} color="#000" />}
                    </View>
                    <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
                    <Text style={styles.tagRowText}>{tag.name}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.tagDeleteBtn} onPress={() => handleDeleteTagGlobal(tag.id)}>
                    <Feather name="trash-2" size={20} color={colors.actions.signOut} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Full Image Viewer Modal */}
      <Modal visible={!!fullImage} transparent={true} animationType="fade" onRequestClose={() => setFullImage(null)}>
        <View style={styles.fullImageContainer}>
          <TouchableOpacity style={styles.fullImageCloseBtn} onPress={() => setFullImage(null)}>
            <Feather name="x" size={32} color="#FFF" />
          </TouchableOpacity>
          {fullImage && <Image source={{ uri: fullImage }} style={styles.fullImage} resizeMode="contain" />}
        </View>
      </Modal>

      <CustomAlert 
        {...alertConfig} 
        onCancel={() => setAlertConfig(prev => ({ ...prev, visible: false }))} 
      />

      {showDatePicker && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={onDateChange}
          minimumDate={new Date()}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={tempDate}
          mode="time"
          display="default"
          onChange={onTimeChange}
        />
      )}
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
  
  attachmentsContainer: { marginBottom: 24 },
  attachmentWrapper: { marginBottom: 12 },
  imageContainer: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface, position: 'relative' },
  inlineImage: { width: '100%', height: 200 },
  attachmentDeleteBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 16 },
  fileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, padding: 16, borderRadius: 16 },
  fileNameText: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '500' },

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
    bottom: 0, 
    left: 0, 
    right: 0,
    height: 520,
    backgroundColor: '#0A0A0A',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 12,
    // On Web, ensure it stays fixed to the viewport if absolute positioning breaks
    ...Platform.select({ web: { position: 'fixed' as any } })
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

  // Tags Modal Styles
  tagsModalContainer: { flex: 1, backgroundColor: colors.background },
  tagsModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 24 },
  tagsModalTitle: { fontSize: 28, fontWeight: 'bold', color: colors.textPrimary },
  createTagSection: { paddingHorizontal: 24, paddingBottom: 24, borderBottomWidth: 1, borderColor: colors.surfaceLight },
  createTagInput: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: 16, padding: 16, fontSize: 18, marginBottom: 16 },
  tagColorPickerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  tagColorCircle: { width: 40, height: 40, borderRadius: 20, opacity: 0.5 },
  tagColorCircleSelected: { opacity: 1, borderWidth: 3, borderColor: '#FFFFFF' },
  createTagBtn: { backgroundColor: colors.surfaceLight, padding: 16, borderRadius: 16, alignItems: 'center' },
  createTagBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: 'bold' },
  tagsList: { flex: 1, padding: 24 },
  tagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  tagRowMain: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  tagCheckbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.textSecondary, marginRight: 16, justifyContent: 'center', alignItems: 'center' },
  tagDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  tagRowText: { color: colors.textPrimary, fontSize: 18, fontWeight: '500' },
  tagDeleteBtn: { padding: 8, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12 },

  fullImageContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fullImageCloseBtn: { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 30, right: 24, zIndex: 10, padding: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 24 },
  fullImage: { width: '100%', height: '100%' },
});
