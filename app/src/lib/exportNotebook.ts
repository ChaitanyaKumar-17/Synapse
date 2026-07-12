import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { supabase } from './supabase';
import { Platform } from 'react-native';

export const exportNotebook = async (
  userId: string,
  rootNotebookId: string | null,
  rootNotebookName: string,
  onProgress?: (progress: string) => void
) => {
  try {
    onProgress?.('Fetching metadata...');
    
    // 1. Fetch everything for the user to build the tree locally
    const [
      { data: allNotebooks },
      { data: allNotes },
      { data: allBlocks },
      { data: allChecklists },
      { data: allAttachments }
    ] = await Promise.all([
      supabase.from('notebooks').select('*').eq('user_id', userId),
      supabase.from('notes').select('*').eq('user_id', userId),
      supabase.from('note_blocks').select('id, note_id, block_type, order_index, text_content').in('note_id', (await supabase.from('notes').select('id').eq('user_id', userId)).data?.map(n => n.id) || []),
      supabase.from('checklist_items').select('*').in('block_id', (await supabase.from('note_blocks').select('id').in('note_id', (await supabase.from('notes').select('id').eq('user_id', userId)).data?.map(n => n.id) || [])).data?.map(b => b.id) || []),
      supabase.from('attachments').select('*').in('note_id', (await supabase.from('notes').select('id').eq('user_id', userId)).data?.map(n => n.id) || [])
    ]);

    // 2. Build notebook tree
    const targetNotebookIds = new Set<string>();
    
    const getDescendants = (parentId: string | null) => {
      if (parentId) targetNotebookIds.add(parentId);
      const children = allNotebooks?.filter(n => n.parent_notebook_id === parentId) || [];
      children.forEach(c => getDescendants(c.id));
    };

    if (rootNotebookId === null) {
      // Export all notebooks and global notes
      allNotebooks?.forEach(n => targetNotebookIds.add(n.id));
    } else {
      getDescendants(rootNotebookId);
    }

    // 3. Filter notes
    const targetNotes = (allNotes || []).filter(n => 
      rootNotebookId === null ? true : targetNotebookIds.has(n.notebook_id)
    );

    if (targetNotes.length === 0) {
      throw new Error("No notes found to export.");
    }

    const zip = new JSZip();
    let attachmentCount = 0;

    // 4. Process each note
    for (let i = 0; i < targetNotes.length; i++) {
      const note = targetNotes[i];
      onProgress?.(`Processing note ${i + 1}/${targetNotes.length}...`);
      
      // Determine folder path
      let folderPath = '';
      if (note.notebook_id) {
        // Trace back to root to build path
        const pathParts: string[] = [];
        let currNb = allNotebooks?.find(n => n.id === note.notebook_id);
        while (currNb) {
          pathParts.unshift(currNb.name);
          if (currNb.id === rootNotebookId || !currNb.parent_notebook_id) break;
          currNb = allNotebooks?.find(n => n.id === currNb?.parent_notebook_id);
        }
        // If rootNotebookId is specified, we can omit it from the internal path or keep it. Let's keep it.
        folderPath = pathParts.join('/') + '/';
      }

      // Build Markdown
      let md = `# ${note.title}\n\n`;
      
      const blocks = (allBlocks || []).filter(b => b.note_id === note.id).sort((a, b) => a.order_index - b.order_index);
      
      for (const block of blocks) {
        if (block.block_type === 'text') {
          md += `${block.text_content || ''}\n\n`;
        } else if (block.block_type === 'checklist') {
          const items = (allChecklists || []).filter(c => c.block_id === block.id).sort((a, b) => a.order_index - b.order_index);
          const parentItems = items.filter(i => !i.parent_item_id);
          
          const renderItems = (parentItem: any, indentLevel: number) => {
            const indent = '  '.repeat(indentLevel);
            md += `${indent}- [${parentItem.is_checked ? 'x' : ' '}] ${parentItem.content}\n`;
            const subItems = items.filter(i => i.parent_item_id === parentItem.id);
            subItems.forEach(sub => renderItems(sub, indentLevel + 1));
          };
          
          parentItems.forEach(pi => renderItems(pi, 0));
          md += '\n';
        }
      }

      // Attachments
      const noteAttachments = (allAttachments || []).filter(a => a.note_id === note.id);
      for (const att of noteAttachments) {
        onProgress?.(`Downloading attachment: ${att.file_name}`);
        const { data: signedData, error: signError } = await supabase.storage.from('attachments').createSignedUrl(att.storage_path, 60);
        
        if (signedData?.signedUrl && !signError) {
          const tempUri = `${FileSystem.cacheDirectory}temp_${Date.now()}_${att.file_name}`;
          await FileSystem.downloadAsync(signedData.signedUrl, tempUri);
          const base64 = await FileSystem.readAsStringAsync(tempUri, { encoding: 'base64' });
          
          const attFolderPath = `${folderPath}attachments/`;
          zip.file(`${attFolderPath}${att.file_name}`, base64, { base64: true });
          md += `\n![${att.file_name}](./attachments/${att.file_name})\n`;
          attachmentCount++;
        }
      }

      // Add MD to zip
      const safeTitle = note.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      zip.file(`${folderPath}${safeTitle}_${note.id.substring(0,6)}.md`, md);
    }

    onProgress?.('Generating ZIP file...');
    const zipBase64 = await zip.generateAsync({ type: 'base64' });
    
    const safeRootName = rootNotebookName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'export';
    const fileUri = `${FileSystem.cacheDirectory}${safeRootName}_${Date.now()}.zip`;
    
    await FileSystem.writeAsStringAsync(fileUri, zipBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    onProgress?.('Ready to share');
    
    if (Platform.OS === 'android') {
      try {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(permissions.directoryUri, `${safeRootName}`, 'application/zip');
          await FileSystem.writeAsStringAsync(destinationUri, zipBase64, { encoding: FileSystem.EncodingType.Base64 });
          return true;
        }
      } catch (e) {
        console.warn('Storage Access Error, falling back to share:', e);
      }
    }
    
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/zip',
        dialogTitle: `Export ${safeRootName}`
      });
    }

    return true;
  } catch (error: any) {
    console.error("Export error:", error);
    throw error;
  }
};
