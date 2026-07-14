import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

const SUPPORTED_TEXT_EXT = ['.md', '.txt'];
const SUPPORTED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

function getExtension(filename: string) {
  const parts = filename.split('.');
  if (parts.length > 1) {
    return '.' + parts[parts.length - 1].toLowerCase();
  }
  return '';
}

function getFilenameFromUri(uri: string) {
  const decoded = decodeURIComponent(uri);
  const parts = decoded.split('/');
  return parts[parts.length - 1];
}

export async function importFolder(
  userId: string, 
  parentNotebookId: string, 
  onProgress?: (msg: string) => void
) {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) {
    throw new Error('Directory permissions denied');
  }

  const rootUri = permissions.directoryUri;
  const rootName = getFilenameFromUri(rootUri).split(':').pop() || 'Imported Folder';
  
  if (onProgress) onProgress(`Importing folder: ${rootName}`);

  // Create root notebook
  const { data: rootNotebook, error: nbError } = await supabase
    .from('notebooks')
    .insert([{ user_id: userId, parent_notebook_id: parentNotebookId, name: rootName }])
    .select()
    .single();

  if (nbError || !rootNotebook) {
    throw new Error(`Failed to create root folder: ${nbError?.message}`);
  }

  await processDirectory(rootUri, rootNotebook.id, userId, onProgress);
  if (onProgress) onProgress('Import complete!');
}

async function processDirectory(
  dirUri: string, 
  currentNotebookId: string, 
  userId: string,
  onProgress?: (msg: string) => void
) {
  const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(dirUri);

  for (const fileUri of files) {
    const filenameInfo = getFilenameFromUri(fileUri);
    // SAF usually appends the full path after a colon, let's just get the actual filename
    const filename = filenameInfo.split(':').pop() || 'Untitled';
    const ext = getExtension(filename);
    const isImage = SUPPORTED_IMAGE_EXT.includes(ext);
    const isText = SUPPORTED_TEXT_EXT.includes(ext);

    try {
      const info = await FileSystem.getInfoAsync(fileUri);
      
      if (info.isDirectory) {
        if (onProgress) onProgress(`Creating folder: ${filename}`);
        const { data: subNotebook, error: nbError } = await supabase
          .from('notebooks')
          .insert([{ user_id: userId, parent_notebook_id: currentNotebookId, name: filename }])
          .select()
          .single();
        
        if (subNotebook) {
          await processDirectory(fileUri, subNotebook.id, userId, onProgress);
        }
      } else if (isText) {
        if (onProgress) onProgress(`Importing note: ${filename}`);
        const content = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.UTF8 });
        
        const noteName = filename.replace(ext, '');
        const { data: note, error: noteError } = await supabase
          .from('notes')
          .insert([{ user_id: userId, notebook_id: currentNotebookId, title: noteName }])
          .select()
          .single();
          
        if (note) {
          await supabase.from('note_blocks').insert([{
            note_id: note.id,
            block_type: 'text',
            order_index: 0,
            text_content: content
          }]);
        }
      } else if (isImage) {
        if (onProgress) onProgress(`Importing image: ${filename}`);
        const noteName = filename.replace(ext, '');
        const { data: note, error: noteError } = await supabase
          .from('notes')
          .insert([{ user_id: userId, notebook_id: currentNotebookId, title: noteName }])
          .select()
          .single();
          
        if (note) {
          const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
          const storagePath = `${userId}/${Date.now()}_${filename.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
          const { decode } = require('base64-arraybuffer');
          
          await supabase.storage.from('attachments').upload(storagePath, decode(base64), {
            contentType: `image/${ext.replace('.', '')}`
          });
          
          await supabase.from('attachments').insert([{
            note_id: note.id,
            storage_path: storagePath,
            file_type: 'image',
            file_name: filename
          }]);
        }
      } else {
        console.log(`Skipping unsupported file: ${filename}`);
      }
    } catch (e) {
      console.log(`Error processing ${filename}:`, e);
    }
  }
}
