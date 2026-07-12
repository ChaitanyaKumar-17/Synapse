import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, TextInput } from 'react-native';
import { colors } from '../theme/colors';

export type CustomAlertProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: (inputValue?: string) => void;
  onCancel: () => void;
  showInput?: boolean;
  inputPlaceholder?: string;
  inputValue?: string;
  onInputChange?: (text: string) => void;
};

export const CustomAlert = ({
  visible,
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
  showInput = false,
  inputPlaceholder = 'Enter text...',
  inputValue = '',
  onInputChange
}: CustomAlertProps) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.alertBox}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {showInput && (
            <TextInput
              style={styles.input}
              placeholder={inputPlaceholder}
              placeholderTextColor={colors.textDisabled}
              value={inputValue}
              onChangeText={onInputChange}
              autoFocus
            />
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btn} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.btn, styles.confirmBtn, isDestructive && styles.destructiveBtn]} 
              onPress={() => {
                onConfirm(inputValue);
                onCancel(); // Auto close on confirm
              }}
            >
              <Text style={[styles.confirmText, isDestructive && styles.destructiveText]}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  alertBox: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    ...Platform.select({
      web: { boxShadow: '0px 8px 30px rgba(0,0,0,0.5)' as any },
      default: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, elevation: 10 }
    })
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 24,
  },
  input: {
    backgroundColor: colors.background,
    color: colors.textPrimary,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginLeft: 12,
  },
  confirmBtn: {
    backgroundColor: colors.textPrimary,
  },
  destructiveBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)', // subtle red background
  },
  cancelText: {
    color: colors.textSecondary,
    fontWeight: 'bold',
    fontSize: 16,
  },
  confirmText: {
    color: colors.background,
    fontWeight: 'bold',
    fontSize: 16,
  },
  destructiveText: {
    color: '#ef4444', // bright red text
  }
});
