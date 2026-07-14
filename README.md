# Synapse

Synapse is a sleek, highly performant, dark-themed Android-only notes application built with Expo (React Native) and Supabase. Designed as a modern alternative to Evernote, it features a deeply integrated **Retrieval-Augmented Generation (RAG) AI Assistant** powered by Gemini and Cohere, allowing you to converse directly with your notes rather than manually searching for information.

## ✨ Features

- **Dynamic Dark Theme:** A unified dark aesthetic with context-aware color accents for different screens (Notebooks, Editor, Chat, etc.).
- **Block-Based Editor:** Create text blocks and interactive checklist blocks within any note.
- **Nested Notebooks:** Organize your thoughts with infinite nesting capabilities and folder-level management.
- **RAG AI Assistant:** Ask questions about your notes globally or scoped to a specific notebook. The AI analyzes your embeddings and provides grounded answers with source citations.
- **Attachments:** Seamlessly attach images and documents to your notes.
- **Local Reminders:** Schedule push notifications using Android's native Alarm Manager.
- **Advanced Exporting:** Export single notes or entire nested folders directly to your device as `.zip` archives containing Markdown or PDF files using the Android Storage Access Framework (SAF).
- **Local Folder Import:** Import existing local folder trees from your device recursively into Synapse.
- **Offline & Performant:** Built with `FlatList` and virtualization for massive notebooks without dropping frames.

## 🛠 Tech Stack

### Frontend
- **Framework:** React Native (Expo Managed Workflow)
- **Language:** TypeScript
- **State Management:** Zustand (Global State) & React Hooks
- **Navigation:** React Navigation
- **Local Storage/Files:** `expo-file-system` (with Storage Access Framework for native Android file integration)
- **Print/Export:** `expo-print`, `marked`

### Backend
- **Platform:** Supabase (Auth, Postgres, Storage, Edge Functions)
- **Database:** PostgreSQL with `pgvector` for semantic search
- **AI Models:** Gemini API (for embedding text) & Cohere API (for conversational generation)

## 🚀 Getting Started

### Prerequisites
- Node.js & npm/yarn
- Expo CLI (`npm install -g expo-cli`)
- Supabase CLI (`npm install -g supabase`)
- EAS CLI (`npm install -g eas-cli`)

### Environment Setup

1. **Clone the repository**
2. **Install frontend dependencies:**
   ```bash
   cd app
   npm install
   ```
3. **Configure Environment Variables:**
   Ensure your `.env` variables contain the standard Supabase credentials. **Never expose your AI provider API keys in the client-side code.** They belong solely in your Supabase Edge Function secrets.

### Backend Setup (Supabase)

1. Ensure Docker is running if you are using Supabase locally.
2. Link your project:
   ```bash
   npx supabase link --project-ref your-project-id
   ```
3. Apply migrations (sets up tables, RLS policies, vector extension):
   ```bash
   npx supabase db push
   ```
4. Deploy the Edge Functions (handles AI and embeddings):
   ```bash
   npx supabase functions deploy embed-note
   npx supabase functions deploy rag-chat
   ```

### Running Locally

To start the Expo development server:
```bash
cd app
npx expo start
```
Scan the QR code with an Android device to test.

## 🔒 Security

All tables inside Synapse utilize strict **Row Level Security (RLS)** in PostgreSQL. Every operation is scoped to `user_id = auth.uid()`. Edge functions securely route AI calls so API keys are never exposed on the client.

## 📦 Building for Production

Synapse is configured for Android. To generate an APK or AAB:
```bash
cd app
eas build -p android --profile production
```

## 📝 License

This project is licensed under the MIT License.