import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Modal, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { CustomAlert } from '../components/CustomAlert';
import Sortable from 'react-native-sortables';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import DateTimePicker from '@react-native-community/datetimepicker';
import { scheduleReminder, cancelReminder } from '../lib/notifications';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TodoList'>;
  route: RouteProp<RootStackParamList, 'TodoList'>;
};

type Todo = {
  id: string;
  content: string;
  is_completed: boolean;
  order_index: number;
};

export const TodoListScreen = ({ navigation, route }: Props) => {
  const { listId, title } = route.params;
  const user = useAuthStore(state => state.user);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const { width: windowWidth } = useWindowDimensions();
  
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState('');
  
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [notesWithLists, setNotesWithLists] = useState<any[]>([]);
  
  const [alertConfig, setAlertConfig] = useState<any>({
    visible: false, title: '', message: '', isDestructive: false, confirmText: 'OK', onConfirm: () => {}
  });

  const [reminderAt, setReminderAt] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  const fetchListMeta = async () => {
    const { data } = await supabase.from('todo_lists').select('reminder_at').eq('id', listId).single();
    if (data?.reminder_at) setReminderAt(new Date(data.reminder_at));
  };

  useEffect(() => {
    fetchTodos();
    fetchListMeta();
  }, [listId]);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: title || 'To-do List',
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.textPrimary,
      headerShadowVisible: false,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
          <TouchableOpacity 
            style={{ marginRight: 20 }} 
            onPress={() => {
              if (reminderAt && new Date(reminderAt) > new Date()) {
                setAlertConfig({
                  visible: true,
                  title: 'Remove Reminder?',
                  message: 'Do you want to remove this reminder?',
                  isDestructive: true,
                  confirmText: 'Remove',
                  onConfirm: async () => {
                    setReminderAt(null);
                    await supabase.from('todo_lists').update({ reminder_at: null }).eq('id', listId);
                    await cancelReminder(listId);
                  }
                });
              } else {
                setTempDate(new Date());
                setShowDatePicker(true);
              }
            }}
          >
            <Feather name="bell" size={24} color={(reminderAt && new Date(reminderAt) > new Date()) ? colors.accents.home : colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setImportModalVisible(true)}>
            <Feather name="file-plus" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      )
    });
  }, [navigation, listId, title, reminderAt]);

  const fetchTodos = async () => {
    const { data } = await supabase.from('todos').select('*').eq('todo_list_id', listId).order('order_index', { ascending: true }).order('created_at', { ascending: true });
    if (data) setTodos(data);
    setLoading(false);
  };

  const handleAddTask = async () => {
    if (!newTaskText.trim()) return;
    const { error } = await supabase.from('todos').insert({
      todo_list_id: listId,
      user_id: user?.id,
      content: newTaskText.trim(),
      order_index: todos.length
    });
    if (!error) {
      setNewTaskText('');
      fetchTodos();
    }
  };

  const handleToggleTodo = async (todo: Todo) => {
    const { error } = await supabase.from('todos').update({ is_completed: !todo.is_completed }).eq('id', todo.id);
    if (!error) fetchTodos();
  };

  const handleDeleteTodo = async (id: string) => {
    const { error } = await supabase.from('todos').delete().eq('id', id);
    if (!error) fetchTodos();
  };

  const fetchNotesWithLists = async () => {
    const { data } = await supabase.from('note_blocks').select('note_id, notes(id, title)').eq('block_type', 'checklist');
    if (data) {
      const uniqueNotes = Array.from(new Map(data.filter(d => d.notes).map(d => [d.note_id, d.notes])).values());
      setNotesWithLists(uniqueNotes);
    }
  };

  const handleImportFromNote = async (noteId: string) => {
    setImportModalVisible(false);
    setLoading(true);
    const { data } = await supabase.from('checklist_items')
      .select('content, note_blocks!inner(note_id)')
      .eq('note_blocks.note_id', noteId)
      .order('order_index', { ascending: true });
      
    if (data && data.length > 0) {
      const newTodos = data.map((item: any, i: number) => ({
        todo_list_id: listId,
        user_id: user?.id,
        content: item.content,
        order_index: todos.length + i
      }));
      await supabase.from('todos').insert(newTodos);
      fetchTodos();
    } else {
      setLoading(false);
    }
  };

  const handleReorder = async (newOrder: Todo[]) => {
    setTodos(newOrder);
    
    // Update database
    const updates = newOrder.map((todo, index) => ({
      id: todo.id,
      todo_list_id: listId,
      user_id: user?.id,
      content: todo.content,
      is_completed: todo.is_completed,
      order_index: index,
    }));
    
    await supabase.from('todos').upsert(updates);
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
      await supabase.from('todo_lists').update({ reminder_at: selectedDate.toISOString() }).eq('id', listId);
      
      setAlertConfig({
        visible: true,
        title: 'Reminder Message',
        message: 'What would you like the notification to say?',
        showInput: true,
        inputValue: 'You have a scheduled reminder!',
        inputPlaceholder: 'e.g. Call John',
        onInputChange: (text: string) => setAlertConfig((prev: any) => ({ ...prev, inputValue: text })),
        confirmText: 'Set Reminder',
        onConfirm: async (msg?: string) => {
          await scheduleReminder(title || 'To-do List Reminder', msg || 'You have a scheduled reminder!', selectedDate, listId, 'todo_list');
        }
      });
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginTop: 40 }} />
        ) : (
          <Animated.ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false}>
            {todos.length === 0 && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No tasks yet. Add one below or tap the download icon above to import from a note.</Text>
              </View>
            )}
            <Sortable.Flex
              flexDirection="column"
              scrollableRef={scrollRef}
              onDragEnd={({ order }) => handleReorder(order(todos))}
            >
              {todos.map(todo => (
                <View key={todo.id} style={[styles.todoRow, { width: windowWidth - 48 }]}>
                  <TouchableOpacity style={[styles.checkbox, todo.is_completed && styles.checkboxCompleted]} onPress={() => handleToggleTodo(todo)}>
                    {todo.is_completed && <Feather name="check" size={16} color={colors.background} />}
                  </TouchableOpacity>
                  <Text style={[styles.todoText, todo.is_completed && styles.todoTextCompleted]}>{todo.content}</Text>
                  <TouchableOpacity onPress={() => handleDeleteTodo(todo.id)}>
                    <Feather name="x" size={20} color={colors.textDisabled} />
                  </TouchableOpacity>
                </View>
              ))}
            </Sortable.Flex>
          </Animated.ScrollView>
        )}
        
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Add a new task..."
            placeholderTextColor={colors.textDisabled}
            value={newTaskText}
            onChangeText={setNewTaskText}
            onSubmitEditing={handleAddTask}
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddTask}>
            <Feather name="arrow-up" size={24} color={colors.background} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={importModalVisible} transparent animationType="slide" onShow={fetchNotesWithLists}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import from Note</Text>
              <TouchableOpacity onPress={() => setImportModalVisible(false)}>
                <Feather name="x" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {notesWithLists.length === 0 ? (
                <Text style={styles.emptyText}>No notes with checklists found.</Text>
              ) : (
                notesWithLists.map(note => (
                  <TouchableOpacity key={note.id} style={styles.noteItem} onPress={() => handleImportFromNote(note.id)}>
                    <Feather name="file-text" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                    <Text style={styles.noteItemText}>{note.title}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

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

      <CustomAlert {...alertConfig} onCancel={() => setAlertConfig(prev => ({ ...prev, visible: false }))} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContainer: { padding: 24, paddingBottom: 100 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 40 },
  emptyText: { color: colors.textDisabled, textAlign: 'center', fontSize: 16, lineHeight: 24, paddingHorizontal: 20 },
  todoRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxCompleted: {
    backgroundColor: colors.textSecondary,
  },
  todoText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  todoTextCompleted: {
    color: colors.textDisabled,
    textDecorationLine: 'line-through',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.surface,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  input: {
    flex: 1,
    height: 50,
    backgroundColor: colors.surface,
    borderRadius: 25,
    paddingHorizontal: 20,
    color: colors.textPrimary,
    fontSize: 16,
    marginRight: 12,
  },
  addButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    height: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceLight,
  },
  noteItemText: {
    fontSize: 16,
    color: colors.textPrimary,
  }
});
