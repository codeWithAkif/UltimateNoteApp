import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

// Environment Detection
export const isElectron = !!(window && window.electron);
export const isCapacitor = !!(window && (window as any).Capacitor) && !isElectron;
export const isBrowser = !isElectron && !isCapacitor;

// Platform Filesystem Interface
export interface PlatformAPI {
  getNotesPath: () => Promise<string>;
  listFiles: () => Promise<Array<{
    name: string;
    path: string;
    type: 'note' | 'folder' | 'excalidraw' | 'drawio';
    createdAt: number;
    updatedAt: number;
  }>>;
  readNote: (relativePath: string) => Promise<string>;
  readMedia: (relativePath: string) => Promise<string>;
  writeNote: (relativePath: string, content: string) => Promise<{ success: boolean }>;
  deletePath: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  createFolder: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  renamePath: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
  getSyncStatus: () => Promise<'synced' | 'syncing' | 'offline' | 'error'>;
  getLastSyncError: () => Promise<string | null>;
  onSyncStatusChanged: (callback: (status: 'synced' | 'syncing' | 'offline' | 'error') => void) => () => void;
  searchOnlineMusic: (query: string) => Promise<any[]>;
  resolveArchiveTrack: (identifier: string) => Promise<string>;
  resolveYoutubePlaylist: (playlistId: string) => Promise<any[]>;
  fileExists: (relativePath: string) => Promise<boolean>;
  downloadMedia?: (relativePath: string, url: string) => Promise<{ success: boolean; error?: string }>;
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // listFiles() yalnızca .md/.excalidraw/.drawio döndürür; bu, notlara eklenen resim/ses
  // gibi medya eklerini AYRI olarak bulmak için kullanılır (bkz. supabaseSync.ts medya senkronu).
  listMediaFiles: () => Promise<Array<{ path: string; size?: number; updatedAt: number }>>;
}

// --------------------------------------------------------------------------
// 1. CAPACITOR MOBILE FILE SYSTEM IMPLEMENTATION
// --------------------------------------------------------------------------
// Güvenlik: Mobil (Capacitor) tarafında dosya yolları düz string olarak
// "UltimateNotes/..." şeklinde birleştirildiği için "../" ile kök dizinin
// dışına çıkma (path traversal) denemelerini engeller. Özellikle Supabase
// senkronizasyonuyla gelen uzak "path" alanı da bu kontrolden geçmelidir.
const assertSafeRelPath = (relativePath: string): string => {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Invalid path');
  }
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Unsafe absolute path blocked: ${relativePath}`);
  }
  if (normalized.split('/').some(seg => seg === '..')) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return relativePath;
};

const ensureMobileRoot = async () => {
  try {
    await Filesystem.mkdir({
      path: 'UltimateNotes',
      directory: Directory.Documents,
      recursive: true
    });
  } catch (e) {
    // Root already exists or other mkdir error
  }
};

const listMobileFilesRecursively = async (dirRelPath: string = ''): Promise<any[]> => {
  try {
    await ensureMobileRoot();
    const targetPath = dirRelPath ? `UltimateNotes/${dirRelPath}` : 'UltimateNotes';
    
    const result = await Filesystem.readdir({
      path: targetPath,
      directory: Directory.Documents
    });

    const fileList: any[] = [];
    for (const file of result.files) {
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // BUG DÜZELTMESİ: "." ile başlayan HER ŞEY atlanıyordu; bu uygulamanın kendi
      // varsayılan şablon klasörünü (".templates") de görünmez kılıp App.tsx'in onu
      // sonsuz döngüde yeniden oluşturmasına yol açıyordu (bkz. main.cjs'teki eşleniği).
      // Yalnızca gerçek sistem klasörü olan ".git" gizlenir.
      if (file.name === '.git') {
        continue;
      }
      const fileRelPath = dirRelPath ? `${dirRelPath}/${file.name}` : file.name;
      
      // Get real file modification time from filesystem stat
      let mtime = 0;
      try {
        const statResult = await Filesystem.stat({
          path: `UltimateNotes/${fileRelPath}`,
          directory: Directory.Documents
        });
        mtime = statResult.mtime || 0;
      } catch (_e) {
        // If stat fails, default to 0 so remote always wins during reconciliation
        mtime = 0;
      }

      if (file.type === 'directory') {
        fileList.push({
          name: file.name,
          path: fileRelPath,
          type: 'folder',
          createdAt: mtime,
          updatedAt: mtime
        });
        const subFiles = await listMobileFilesRecursively(fileRelPath);
        fileList.push(...subFiles);
      } else if (file.name.endsWith('.md') || file.name.endsWith('.excalidraw') || file.name.endsWith('.drawio')) {
        // .drawio: draw.io (diagrams.net) diyagram dosyaları da not listesine dahil edilir.
        const isExcalidraw = file.name.endsWith('.excalidraw');
        const isDrawio = file.name.endsWith('.drawio');
        fileList.push({
          name: file.name.replace(/\.(md|excalidraw|drawio)$/, ''),
          path: fileRelPath,
          type: isExcalidraw ? 'excalidraw' : (isDrawio ? 'drawio' : 'note'),
          createdAt: mtime,
          updatedAt: mtime
        });
      }
    }
    return fileList;
  } catch (err) {
    console.error('Error listing mobile files:', err);
    return [];
  }
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// main.cjs'teki MEDIA_EXTENSIONS ile aynı liste — mobilde de medya eklerini (notlardan
// ayrı olarak) bulup Supabase Storage'a senkronize edebilmek için kullanılır.
const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.mp3', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.opus', '.aac', '.mp4'
]);

const listMobileMediaRecursively = async (dirRelPath: string = ''): Promise<Array<{ path: string; size?: number; updatedAt: number }>> => {
  try {
    await ensureMobileRoot();
    const targetPath = dirRelPath ? `UltimateNotes/${dirRelPath}` : 'UltimateNotes';
    const result = await Filesystem.readdir({ path: targetPath, directory: Directory.Documents });

    const fileList: Array<{ path: string; size?: number; updatedAt: number }> = [];
    for (const file of result.files) {
      if (file.name === '.git') continue;
      const fileRelPath = dirRelPath ? `${dirRelPath}/${file.name}` : file.name;

      if (file.type === 'directory') {
        const subFiles = await listMobileMediaRecursively(fileRelPath);
        fileList.push(...subFiles);
        continue;
      }

      const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
      if (!MEDIA_EXTENSIONS.has(ext)) continue;

      let mtime = 0;
      let size: number | undefined;
      try {
        const statResult = await Filesystem.stat({ path: `UltimateNotes/${fileRelPath}`, directory: Directory.Documents });
        mtime = statResult.mtime || 0;
        size = statResult.size;
      } catch (_e) {
        mtime = 0;
      }
      fileList.push({ path: fileRelPath, size, updatedAt: mtime });
    }
    return fileList;
  } catch (err) {
    console.error('Error listing mobile media files:', err);
    return [];
  }
};

import {
  triggerMobileGitSync,
  getMobileSyncStatus, 
  getMobileSyncError,
  onMobileSyncStatusChanged 
} from './mobileGit';

const mobilePlatform: PlatformAPI = {
  getNotesPath: async () => 'UltimateNotes',
  listFiles: async () => {
    return await listMobileFilesRecursively();
  },
  readNote: async (relativePath) => {
    assertSafeRelPath(relativePath);
    await ensureMobileRoot();
    const res = await Filesystem.readFile({
      path: `UltimateNotes/${relativePath}`,
      directory: Directory.Documents,
      encoding: Encoding.UTF8
    });
    return res.data as string;
  },
  readMedia: async (relativePath) => {
    assertSafeRelPath(relativePath);
    await ensureMobileRoot();
    const res = await Filesystem.readFile({
      path: `UltimateNotes/${relativePath}`,
      directory: Directory.Documents
    });
    // Convert to base64 Data URL
    const ext = relativePath.split('.').pop()?.toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === 'png') mimeType = 'image/png';
    else if (ext === 'webm') mimeType = 'audio/webm';
    else if (ext === 'wav') mimeType = 'audio/wav';
    else if (ext === 'mp3') mimeType = 'audio/mpeg';
    else if (ext === 'm4a') mimeType = 'audio/x-m4a';
    
    return `data:${mimeType};base64,${res.data}`;
  },
  writeNote: async (relativePath, content) => {
    assertSafeRelPath(relativePath);
    await ensureMobileRoot();
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      const parentDir = parts.slice(0, -1).join('/');
      try {
        await Filesystem.mkdir({
          path: `UltimateNotes/${parentDir}`,
          directory: Directory.Documents,
          recursive: true
        });
      } catch (e) {}
    }

    if (content.startsWith('data:')) {
      const base64Data = content.split(';base64,').pop() || '';
      await Filesystem.writeFile({
        path: `UltimateNotes/${relativePath}`,
        directory: Directory.Documents,
        data: base64Data
      });
    } else {
      await Filesystem.writeFile({
        path: `UltimateNotes/${relativePath}`,
        directory: Directory.Documents,
        data: content,
        encoding: Encoding.UTF8
      });
    }

    triggerMobileGitSync();
    return { success: true };
  },
  deletePath: async (relativePath) => {
    assertSafeRelPath(relativePath);
    await ensureMobileRoot();
    try {
      await Filesystem.deleteFile({
        path: `UltimateNotes/${relativePath}`,
        directory: Directory.Documents
      });
    } catch (e) {
      // If it fails, try deleting as a folder
      try {
        await Filesystem.rmdir({
          path: `UltimateNotes/${relativePath}`,
          directory: Directory.Documents,
          recursive: true
        });
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
    triggerMobileGitSync();
    return { success: true };
  },
  createFolder: async (relativePath) => {
    assertSafeRelPath(relativePath);
    await ensureMobileRoot();
    try {
      await Filesystem.mkdir({
        path: `UltimateNotes/${relativePath}`,
        directory: Directory.Documents,
        recursive: true
      });
      triggerMobileGitSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
  renamePath: async (oldPath, newPath) => {
    assertSafeRelPath(oldPath);
    assertSafeRelPath(newPath);
    await ensureMobileRoot();
    try {
      await Filesystem.rename({
        from: `UltimateNotes/${oldPath}`,
        to: `UltimateNotes/${newPath}`,
        directory: Directory.Documents
      });
      triggerMobileGitSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
  getSyncStatus: async () => getMobileSyncStatus(),
  getLastSyncError: async () => getMobileSyncError(),
  onSyncStatusChanged: (callback) => onMobileSyncStatusChanged(callback),
  searchOnlineMusic: async (query) => {
    try {
      const res = await fetch(`https://archive.org/advancedsearch.php?q=collection:(opensource_audio)+AND+(title:${encodeURIComponent(query)}+OR+creator:${encodeURIComponent(query)})&fl[]=identifier,title,creator,downloads&sort[]=downloads+desc&output=json&rows=15`);
      const data = await res.json();
      const docs = data.response?.docs || [];
      return docs.map((doc: any) => ({
        id: doc.identifier,
        title: doc.title || 'Bilinmeyen Şarkı',
        artist: doc.creator || 'Archive.org',
        stream_url: `ARCHIVE:${doc.identifier}`,
        thumb: `https://archive.org/services/img/${doc.identifier}`,
        duration: '0'
      }));
    } catch (e) {
      return [];
    }
  },
  resolveArchiveTrack: async (identifier) => {
    try {
      const res = await fetch(`https://archive.org/metadata/${identifier}`);
      const data = await res.json();
      const files = data.files || [];
      const mp3 = files.find((f: any) => f.name.endsWith('.mp3'));
      return mp3 ? `https://archive.org/download/${identifier}/${encodeURIComponent(mp3.name)}` : '';
    } catch (e) {
      return '';
    }
  },
  resolveYoutubePlaylist: async (playlistId) => {
    try {
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`);
      const text = await res.text();
      const entries: any[] = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;
      while ((match = entryRegex.exec(text)) !== null) {
        const entryContent = match[1];
        const titleMatch = entryContent.match(/<title>([\s\S]*?)<\/title>/);
        const ytVideoIdMatch = entryContent.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
        if (titleMatch && ytVideoIdMatch) {
          let title = titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
          entries.push({
            title,
            videoId: ytVideoIdMatch[1]
          });
        }
      }
      return entries;
    } catch (e) {
      return [];
    }
  },
  fileExists: async (relativePath) => {
    try {
      assertSafeRelPath(relativePath);
      await Filesystem.stat({
        path: `UltimateNotes/${relativePath}`,
        directory: Directory.Documents
      });
      return true;
    } catch (e) {
      return false;
    }
  },
  downloadMedia: async (relativePath, url) => {
    assertSafeRelPath(relativePath);
    await ensureMobileRoot();
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      const parentDir = parts.slice(0, -1).join('/');
      try {
        await Filesystem.mkdir({
          path: `UltimateNotes/${parentDir}`,
          directory: Directory.Documents,
          recursive: true
        });
      } catch (e) {}
    }
    try {
      await Filesystem.downloadFile({
        url,
        path: `UltimateNotes/${relativePath}`,
        directory: Directory.Documents
      });
      triggerMobileGitSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
  listMediaFiles: async () => {
    return await listMobileMediaRecursively();
  }
};

// --------------------------------------------------------------------------
// 2. ELECTRON DESKTOP FILE SYSTEM DELEGATION
// --------------------------------------------------------------------------
const desktopPlatform: PlatformAPI = {
  getNotesPath: () => window.electron.getNotesPath(),
  listFiles: () => window.electron.listFiles(),
  listMediaFiles: () => window.electron.listMediaFiles(),
  readNote: (relativePath) => window.electron.readNote(relativePath),
  readMedia: (relativePath) => window.electron.readMedia(relativePath),
  writeNote: (relativePath, content) => window.electron.writeNote(relativePath, content),
  deletePath: (relativePath) => window.electron.deletePath(relativePath),
  createFolder: (relativePath) => window.electron.createFolder(relativePath),
  renamePath: (oldPath, newPath) => window.electron.renamePath(oldPath, newPath),
  getSyncStatus: () => window.electron.getSyncStatus(),
  getLastSyncError: () => window.electron.getLastSyncError(),
  onSyncStatusChanged: (callback) => window.electron.onSyncStatusChanged(callback),
  searchOnlineMusic: (query) => window.electron.searchOnlineMusic(query),
  resolveArchiveTrack: (identifier) => window.electron.resolveArchiveTrack(identifier),
  resolveYoutubePlaylist: (playlistId) => window.electron.resolveYoutubePlaylist(playlistId),
  fileExists: (relativePath) => window.electron.fileExists(relativePath)
};

// --------------------------------------------------------------------------
// 3. WEB BROWSER LOCALSTORAGE MOCK FALLBACK (Existing Web Mock)
// --------------------------------------------------------------------------
const webPlatform: PlatformAPI = {
  getNotesPath: async () => 'UltimateNotes (Web Mock)',
  listFiles: async () => {
    try {
      const raw = localStorage.getItem('notes_db');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },
  readNote: async (relativePath) => {
    return localStorage.getItem(`mock_note_${relativePath}`) || '';
  },
  readMedia: async (relativePath) => {
    return localStorage.getItem(`mock_note_${relativePath}`) || '';
  },
  writeNote: async (relativePath, content) => {
    localStorage.setItem(`mock_note_${relativePath}`, content);
    return { success: true };
  },
  deletePath: async (relativePath) => {
    localStorage.removeItem(`mock_note_${relativePath}`);
    return { success: true };
  },
  createFolder: async () => {
    return { success: true };
  },
  renamePath: async (oldPath, newPath) => {
    try {
      const raw = localStorage.getItem('notes_db');
      if (raw) {
        let notesDb = JSON.parse(raw);
        notesDb = notesDb.map((n: any) => {
          if (n.path === oldPath) {
            return { ...n, path: newPath, name: newPath.split('/').pop()!.replace('.md', '') };
          }
          if (n.path.startsWith(oldPath + '/')) {
            const relSub = n.path.substring(oldPath.length);
            return { ...n, path: newPath + relSub };
          }
          return n;
        });
        localStorage.setItem('notes_db', JSON.stringify(notesDb));
      }
      
      const content = localStorage.getItem(`mock_note_${oldPath}`);
      if (content !== null) {
        localStorage.setItem(`mock_note_${newPath}`, content);
        localStorage.removeItem(`mock_note_${oldPath}`);
      }
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`mock_note_${oldPath}/`)) {
          const subContent = localStorage.getItem(key);
          const relSub = key.substring(`mock_note_${oldPath}`.length);
          localStorage.setItem(`mock_note_${newPath}${relSub}`, subContent || '');
          localStorage.removeItem(key);
        }
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  getSyncStatus: async () => 'offline',
  getLastSyncError: async () => null,
  onSyncStatusChanged: () => {
    return () => {};
  },
  searchOnlineMusic: async (query) => {
    try {
      const res = await fetch(`https://archive.org/advancedsearch.php?q=collection:(opensource_audio)+AND+(title:${encodeURIComponent(query)}+OR+creator:${encodeURIComponent(query)})&fl[]=identifier,title,creator,downloads&sort[]=downloads+desc&output=json&rows=15`);
      const data = await res.json();
      const docs = data.response?.docs || [];
      return docs.map((doc: any) => ({
        id: doc.identifier,
        title: doc.title || 'Bilinmeyen Şarkı',
        artist: doc.creator || 'Archive.org',
        stream_url: `ARCHIVE:${doc.identifier}`,
        thumb: `https://archive.org/services/img/${doc.identifier}`,
        duration: '0'
      }));
    } catch (e) {
      return [];
    }
  },
  resolveArchiveTrack: async (identifier) => {
    try {
      const res = await fetch(`https://archive.org/metadata/${identifier}`);
      const data = await res.json();
      const files = data.files || [];
      const mp3 = files.find((f: any) => f.name.endsWith('.mp3'));
      return mp3 ? `https://archive.org/download/${identifier}/${encodeURIComponent(mp3.name)}` : '';
    } catch (e) {
      return '';
    }
  },
  fileExists: async (relativePath) => {
    // Web mock doesn't support physical files, so we check in mock notes list
    try {
      const raw = localStorage.getItem('notes_db');
      if (!raw) return false;
      const files = JSON.parse(raw);
      return files.some((f: any) => f.path === relativePath);
    } catch (e) {
      return false;
    }
  },
  resolveYoutubePlaylist: async () => [],
  listMediaFiles: async () => []
};

// --------------------------------------------------------------------------
// EXPORT ACTIVE PLATFORM DELEGATE
// --------------------------------------------------------------------------
export const platform: PlatformAPI = isElectron 
  ? desktopPlatform 
  : (isCapacitor ? mobilePlatform : webPlatform);
