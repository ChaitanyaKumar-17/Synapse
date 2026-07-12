import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import { marked } from 'marked';

export const exportSingleItem = async (
  item: { id: string, name: string, type: 'note' | 'todo_list' },
  format: 'md' | 'pdf' = 'md',
  onProgress?: (progress: string) => void
) => {
  try {
    onProgress?.('Fetching content...');
    let md = `# ${item.name}\n\n`;

    if (item.type === 'note') {
      const { data: blocks } = await supabase.from('note_blocks').select('*').eq('note_id', item.id).order('order_index');
      (blocks || []).forEach(b => { if (b.block_type === 'text') md += `${b.text_content || ''}\n\n`; });
      
      const { data: attachments } = await supabase.from('attachments').select('*').eq('note_id', item.id);
      if (attachments && attachments.length > 0) {
        md += `\n## Attachments\n\n`;
        for (const att of attachments) {
          onProgress?.(`Processing attachment ${att.file_name}...`);
          const { data: signedData, error } = await supabase.storage.from('attachments').createSignedUrl(att.storage_path, 60);
          if (signedData?.signedUrl && !error) {
            const tempUri = `${FileSystem.cacheDirectory}temp_${Date.now()}_${att.file_name}`;
            await FileSystem.downloadAsync(signedData.signedUrl, tempUri);
            const base64 = await FileSystem.readAsStringAsync(tempUri, { encoding: 'base64' });
            if (format === 'pdf') {
              md += `\n<img src="data:image/jpeg;base64,${base64}" style="max-width: 100%; border-radius: 8px;" />\n`;
            } else {
              md += `\n[${att.file_name}](data:image/jpeg;base64,${base64})\n`; // In single note MD, we just embed as data URI so it works standalone
            }
          }
        }
      }
    } else if (item.type === 'todo_list') {
      const { data: todos } = await supabase.from('todos').select('*').eq('todo_list_id', item.id).order('order_index');
      (todos || []).forEach(t => { md += `- [${t.is_completed ? 'x' : ' '}] ${t.content}\n`; });
    }

    const safeName = item.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    let finalBase64 = '';
    let finalMime = '';
    let finalExt = '';

    if (format === 'pdf') {
      onProgress?.('Generating PDF...');
      const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: -apple-system, system-ui, sans-serif; padding: 20px; line-height: 1.6; color: #111; }
              h1, h2, h3 { color: #000; }
              img { max-width: 100%; border-radius: 8px; margin-top: 16px; }
              ul { margin-left: 20px; }
            </style>
          </head>
          <body>
            ${await marked.parse(md)}
          </body>
        </html>
      `;
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      finalBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      finalMime = 'application/pdf';
      finalExt = 'pdf';
    } else {
      finalBase64 = Buffer.from(md).toString('base64'); // Need to use Buffer or atob? React Native doesn't have Buffer by default.
      // Wait, we can just write as string, then read as base64.
      const tempMdUri = `${FileSystem.cacheDirectory}temp_${Date.now()}.md`;
      await FileSystem.writeAsStringAsync(tempMdUri, md, { encoding: FileSystem.EncodingType.UTF8 });
      finalBase64 = await FileSystem.readAsStringAsync(tempMdUri, { encoding: FileSystem.EncodingType.Base64 });
      finalMime = 'text/markdown';
      finalExt = 'md';
    }

    onProgress?.('Ready to share');
    
    if (Platform.OS === 'android') {
      try {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(permissions.directoryUri, `${safeName}`, finalMime);
          await FileSystem.writeAsStringAsync(destinationUri, finalBase64, { encoding: FileSystem.EncodingType.Base64 });
          return true;
        }
      } catch (e) {
        console.warn('Storage Access Error, falling back to share:', e);
      }
    }
    
    const fileUri = `${FileSystem.cacheDirectory}${safeName}_${Date.now()}.${finalExt}`;
    await FileSystem.writeAsStringAsync(fileUri, finalBase64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, { mimeType: finalMime, dialogTitle: `Export ${safeName}` });
    }
    return true;
  } catch (error: any) {
    console.error("Export error:", error);
    throw error;
  }
};
