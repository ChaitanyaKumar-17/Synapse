import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: { id: string, title: string }[];
};

interface AuthState {
  session: Session | null;
  user: User | null;
  setSession: (session: Session | null) => void;
  chats: { notebook: ChatMessage[], global: ChatMessage[] };
  setChats: (chats: { notebook: ChatMessage[], global: ChatMessage[] } | ((prev: { notebook: ChatMessage[], global: ChatMessage[] }) => { notebook: ChatMessage[], global: ChatMessage[] })) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  setSession: (session) => set({ session, user: session?.user ?? null }),
  chats: { notebook: [], global: [] },
  setChats: (chats) => set((state) => ({ chats: typeof chats === 'function' ? chats(state.chats) : chats })),
}));
