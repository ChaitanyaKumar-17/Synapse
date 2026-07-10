import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';

export const AuthScreen = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const showMessage = (text: string, type: 'error' | 'success') => {
    setMessage({ text, type });
  };

  async function handleAuth() {
    setLoading(true);
    setMessage({ text: '', type: '' });
    
    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) showMessage('Invalid email or password.', 'error');
        else if (error.message.includes('Email not confirmed')) showMessage('Please verify your email address.', 'error');
        else showMessage(error.message, 'error');
      }
    } else {
      if (!username.trim()) {
        showMessage('Please enter a username.', 'error');
        setLoading(false);
        return;
      }
      const { error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          data: { username: username.trim() }
        }
      });
      if (error) {
        if (error.message.includes('already registered')) showMessage('Email already exists. Try signing in.', 'error');
        else if (error.message.includes('rate limit')) showMessage('Too many attempts. Please wait.', 'error');
        else showMessage(error.message, 'error');
      } else {
        showMessage('Success! Please check your email for the verification link.', 'success');
        setIsLogin(true);
      }
    }
    setLoading(false);
  }

  async function handleForgotPassword() {
    if (!email) {
      showMessage('Please enter your email to reset password.', 'error');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) showMessage(error.message, 'error');
    else showMessage('Password reset email sent!', 'success');
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>Synapse</Text>
        <Text style={styles.subtitle}>{isLogin ? 'Welcome back.' : 'Create an account.'}</Text>
        
        {message.text ? (
          <View style={[styles.messageBox, message.type === 'error' ? styles.errorBox : styles.successBox]}>
            <Text style={[styles.messageText, message.type === 'error' ? styles.errorText : styles.successText]}>
              {message.text}
            </Text>
          </View>
        ) : null}

        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={colors.textDisabled}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        )}
        
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textDisabled}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textDisabled}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {isLogin && (
          <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotPassword}>
            <Text style={[styles.linkText, { color: colors.actions.forgotPassword, fontWeight: '400' }]}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity 
          style={[styles.primaryButton, { backgroundColor: isLogin ? colors.actions.signIn : colors.actions.signUp }]} 
          onPress={handleAuth} 
          disabled={loading}
        >
          <Text style={styles.primaryButtonText}>{loading ? 'Wait...' : (isLogin ? 'Sign In' : 'Sign Up')}</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </Text>
          <TouchableOpacity onPress={() => { setIsLogin(!isLogin); setMessage({text:'', type:''}); }}>
            <Text style={styles.linkText}>{isLogin ? 'Sign up instead' : 'Sign in instead'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    padding: 32,
    borderRadius: 24,
    ...Platform.select({
      web: { boxShadow: '0px 10px 25px rgba(0,0,0,0.4)' as any },
      default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 25, elevation: 10 }
    }),
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 8,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  messageBox: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
  },
  errorBox: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)' },
  successBox: { backgroundColor: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.2)' },
  messageText: { fontSize: 14, fontWeight: '500' },
  errorText: { color: colors.actions.signOut },
  successText: { color: colors.actions.signIn },
  input: {
    backgroundColor: colors.background,
    color: colors.textPrimary,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  primaryButton: {
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(0,0,0,0.4)' as any },
      default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }
    }),
  },
  primaryButtonText: {
    color: '#FFFFFF', 
    fontWeight: 'bold',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  footerText: { color: colors.textSecondary, fontSize: 15 },
  linkText: { color: colors.accents.home, fontSize: 15, fontWeight: '600' },
});
