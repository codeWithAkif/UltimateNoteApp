import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';

let supabase: SupabaseClient | null = null;
let currentVault = 'default';
let localPlatform: any = null;
let onRemoteChangeCallback: (() => void) | null = null;
let onStatusChangeCallback: ((status: SyncStatus, error?: string | null) => void) | null = null;
let realtimeChannel: any = null;

const uploadDebounceTimers: Record<string, any> = {};
const isUploadingPaths: Record<string, boolean> = {};

const getHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
};

const getSyncHashesKey = (): string => {
  if (!supabase) return 'sync_hashes_default';
  const url = (supabase as any).supabaseUrl || '';
  return `sync_hashes_${getHash(url)}_${currentVault}`;
};

const getSyncHashes = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(getSyncHashesKey()) || '{}');
  } catch (e) {
    return {};
  }
};

const updateSyncHash = (path: string, hash: string) => {
  const hashes = getSyncHashes();
  hashes[path] = hash;
  localStorage.setItem(getSyncHashesKey(), JSON.stringify(hashes));
};

export const initSupabase = (
  url: string,
  key: string,
  vault: string,
  platform: any,
  onRemoteChange: () => void,
  onStatusChange: (status: SyncStatus, error?: string | null) => void
) => {
  if (realtimeChannel) {
    if (supabase) {
      try {
        supabase.removeChannel(realtimeChannel);
      } catch (e) {
        console.error('[Supabase Realtime] Error removing channel:', e);
        realtimeChannel.unsubscribe();
      }
    } else {
      realtimeChannel.unsubscribe();
    }
    realtimeChannel = null;
  }

  Object.keys(uploadDebounceTimers).forEach(path => {
    clearTimeout(uploadDebounceTimers[path]);
    delete uploadDebounceTimers[path];
  });

  if (!url || !key) {
    supabase = null;
    localPlatform = null;
    onStatusChange('offline', null);
    return;
  }

  try {
    supabase = createClient(url, key, {
      auth: {
        persistSession: false
      }
    });
    currentVault = vault || 'default';
    localPlatform = platform;
    onRemoteChangeCallback = onRemoteChange;
    onStatusChangeCallback = onStatusChange;
    
    onStatusChange('syncing', null);
    startSync();
  } catch (err: any) {
    console.error('[Supabase Sync] Initialization error:', err);
    onStatusChange('error', err.message || String(err));
  }
};

const startSync = async () => {
  if (!supabase || !localPlatform || !onStatusChangeCallback) return;

  try {
    onStatusChangeCallback('syncing', null);
    console.log('[Supabase Sync] Reconciling notes...');

    // 1. Fetch remote notes
    const { data: remoteNotes, error } = await supabase
      .from('notes')
      .select('*')
      .eq('vault', currentVault);

    if (error) throw error;

    const remoteNotesMap: Record<string, any> = {};
    if (remoteNotes) {
      remoteNotes.forEach(note => {
        remoteNotesMap[note.path] = note;
      });
    }

    // 2. Fetch local notes
    const localFileList = await localPlatform.listFiles();
    const localNotes = localFileList.filter((f: any) => (f.type === 'note' || f.type === 'excalidraw') && f.path !== 'metadata.json');
    const localNotesMap: Record<string, any> = {};
    localNotes.forEach((f: any) => {
      localNotesMap[f.path] = f;
    });

    // 3. 3-Way Reconciliation
    const syncHashes = getSyncHashes();
    const newSyncHashes: Record<string, string> = { ...syncHashes };

    for (const localNote of localNotes) {
      const path = localNote.path;
      const remoteNote = remoteNotesMap[path];

      let localContent = '';
      try {
        localContent = await localPlatform.readNote(path);
      } catch (e) {
        console.error(`[Supabase Sync] Error reading local note ${path}:`, e);
        continue;
      }

      const normalizedLocalContent = localContent.replace(/\r\n/g, '\n');
      const localHash = getHash(normalizedLocalContent);

      if (remoteNote) {
        const normalizedRemoteContent = remoteNote.content.replace(/\r\n/g, '\n');
        const remoteHash = getHash(normalizedRemoteContent);
        newSyncHashes[path] = remoteHash; // Record latest synced remote hash

        if (remoteNote.is_deleted) {
          console.log(`[Supabase Sync] Remote deleted note: ${path}, removing locally...`);
          await localPlatform.deletePath(path);
          delete newSyncHashes[path];
        } else {
          if (localHash !== remoteHash) {
            const lastHash = syncHashes[path];
            const localChanged = lastHash !== undefined && localHash !== lastHash;
            const remoteChanged = lastHash !== undefined && remoteHash !== lastHash;

            if (localChanged && !remoteChanged) {
              console.log(`[Supabase Sync] Local modified: ${path}, uploading...`);
              await uploadNoteDirect(path, normalizedLocalContent);
              newSyncHashes[path] = localHash;
            } else if (!localChanged && remoteChanged) {
              console.log(`[Supabase Sync] Remote modified: ${path}, downloading...`);
              await localPlatform.writeNote(path, normalizedRemoteContent);
              newSyncHashes[path] = remoteHash;
            } else {
              // Conflict / no history, compare timestamps with scale normalization
              const remoteTime = new Date(remoteNote.updated_at).getTime();
              let localTime = localNote.updatedAt || 0;
              if (localTime > 0 && localTime < 10000000000) {
                localTime = localTime * 1000;
              }

              if (localTime > 0 && localTime > remoteTime + 2000) {
                console.log(`[Supabase Sync] Conflict resolved (local newer): ${path}, uploading...`);
                await uploadNoteDirect(path, normalizedLocalContent);
                newSyncHashes[path] = localHash;
              } else {
                console.log(`[Supabase Sync] Conflict resolved (remote newer): ${path}, backing up local file and downloading remote...`);
                try {
                  await localPlatform.writeNote(path + '.backup', localContent);
                } catch (bakErr) {
                  console.error('[Supabase Sync] Backup file write failed:', bakErr);
                }
                await localPlatform.writeNote(path, normalizedRemoteContent);
                newSyncHashes[path] = remoteHash;
              }
            }
          }
        }
      } else {
        const lastHash = syncHashes[path];
        if (lastHash !== undefined) {
          console.log(`[Supabase Sync] Note was deleted on remote (hard-delete): ${path}, removing locally...`);
          await localPlatform.deletePath(path);
          delete newSyncHashes[path];
        } else {
          console.log(`[Supabase Sync] Note is missing on remote: ${path}, uploading...`);
          await uploadNoteDirect(path, normalizedLocalContent);
          newSyncHashes[path] = localHash;
        }
      }
    }

    // B. Reconcile remaining remote notes (exists on DB but not on disk)
    for (const path in remoteNotesMap) {
      if (!localNotesMap[path]) {
        const remoteNote = remoteNotesMap[path];
        if (syncHashes[path] !== undefined) {
          console.log(`[Supabase Sync] Note was deleted locally: ${path}, deleting on remote...`);
          await handleLocalDelete(path);
          delete newSyncHashes[path];
        } else {
          if (!remoteNote.is_deleted) {
            console.log(`[Supabase Sync] Remote note is missing locally: ${path}, downloading...`);
            const normalizedRemoteContent = remoteNote.content.replace(/\r\n/g, '\n');
            await localPlatform.writeNote(path, normalizedRemoteContent);
            newSyncHashes[path] = getHash(normalizedRemoteContent);
          }
        }
      }
    }

    // Save updated hashes
    localStorage.setItem(getSyncHashesKey(), JSON.stringify(newSyncHashes));
    lastSyncTime = Date.now();

    console.log('[Supabase Sync] Reconciliation completed. Subscribing to realtime updates...');
    onStatusChangeCallback('synced', null);

    if (onRemoteChangeCallback) {
      onRemoteChangeCallback();
    }

    // 4. Set up Realtime WebSockets Channel
    realtimeChannel = supabase
      .channel('realtime-notes-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `vault=eq.${currentVault}`
        },
        async (payload: any) => {
          const { eventType, new: newRec, old: oldRec } = payload;
          console.log(`[Supabase Realtime] Event: ${eventType}`, payload);

          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            const path = newRec.path;
            if (isUploadingPaths[path]) return;

            if (newRec.is_deleted) {
              console.log(`[Supabase Realtime] Soft-delete event: ${path}`);
              await localPlatform.deletePath(path);
              const hashes = getSyncHashes();
              delete hashes[path];
              localStorage.setItem(getSyncHashesKey(), JSON.stringify(hashes));
              if (onRemoteChangeCallback) onRemoteChangeCallback();
            } else {
              let currentLocal = '';
              const exists = await localPlatform.fileExists(path);
              if (exists) {
                try {
                  currentLocal = await localPlatform.readNote(path);
                } catch (e) {
                  console.error(`[Supabase Realtime] Error reading local note ${path}:`, e);
                }
              }
              const normalizedLocal = currentLocal.replace(/\r\n/g, '\n');
              const normalizedRemote = newRec.content.replace(/\r\n/g, '\n');
              if (normalizedLocal !== normalizedRemote) {
                console.log(`[Supabase Realtime] Remote update event for: ${path}`);
                await localPlatform.writeNote(path, normalizedRemote);
                updateSyncHash(path, getHash(normalizedRemote));
                if (onRemoteChangeCallback) onRemoteChangeCallback();
              }
            }
          } else if (eventType === 'DELETE') {
            const path = oldRec.path;
            if (path) {
              console.log(`[Supabase Realtime] Hard-delete event: ${path}`);
              await localPlatform.deletePath(path);
              const hashes = getSyncHashes();
              delete hashes[path];
              localStorage.setItem(getSyncHashesKey(), JSON.stringify(hashes));
              if (onRemoteChangeCallback) onRemoteChangeCallback();
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('[Supabase Realtime] Subscription status:', status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (onStatusChangeCallback) {
            onStatusChangeCallback('error', 'WebSocket subscription connection lost.');
          }
        }
      });

  } catch (err: any) {
    console.error('[Supabase Sync] Sync failed:', err);
    if (onStatusChangeCallback) {
      onStatusChangeCallback('error', err.message || String(err));
    }
  }
};

const uploadNoteDirect = async (path: string, content: string) => {
  if (!supabase) return;
  try {
    isUploadingPaths[path] = true;
    const name = path.replace('.md', '').split('/').pop() || '';
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const { error } = await supabase
      .from('notes')
      .upsert(
        {
          vault: currentVault,
          path,
          name,
          content: normalizedContent,
          is_deleted: false,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'vault,path' }
      );
    if (error) throw error;
    updateSyncHash(path, getHash(normalizedContent));
  } finally {
    setTimeout(() => {
      delete isUploadingPaths[path];
    }, 1000);
  }
};

export const handleLocalSave = (path: string, content: string) => {
  if (!supabase) return;

  if (uploadDebounceTimers[path]) {
    clearTimeout(uploadDebounceTimers[path]);
  }

  uploadDebounceTimers[path] = setTimeout(async () => {
    delete uploadDebounceTimers[path];
    console.log(`[Supabase Sync] Debounced upload for: ${path}`);
    if (onStatusChangeCallback) onStatusChangeCallback('syncing', null);
    try {
      const normalizedContent = content.replace(/\r\n/g, '\n');
      await uploadNoteDirect(path, normalizedContent);
      if (onStatusChangeCallback) onStatusChangeCallback('synced', null);
    } catch (err: any) {
      console.error(`[Supabase Sync] Upload failed for ${path}:`, err);
      if (onStatusChangeCallback) onStatusChangeCallback('error', err.message || String(err));
    }
  }, 500);
};

export const handleLocalDelete = async (path: string) => {
  if (!supabase) return;

  if (uploadDebounceTimers[path]) {
    clearTimeout(uploadDebounceTimers[path]);
    delete uploadDebounceTimers[path];
  }

  console.log(`[Supabase Sync] Soft-deleting on remote: ${path}`);
  if (onStatusChangeCallback) onStatusChangeCallback('syncing', null);
  try {
    isUploadingPaths[path] = true;
    const name = path.replace('.md', '').split('/').pop() || '';
    const { error } = await supabase
      .from('notes')
      .upsert(
        {
          vault: currentVault,
          path,
          name,
          is_deleted: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'vault,path' }
      );
    if (error) throw error;
    const hashes = getSyncHashes();
    delete hashes[path];
    localStorage.setItem(getSyncHashesKey(), JSON.stringify(hashes));
    if (onStatusChangeCallback) onStatusChangeCallback('synced', null);
  } catch (err: any) {
    console.error(`[Supabase Sync] Soft-delete failed for ${path}:`, err);
    if (onStatusChangeCallback) onStatusChangeCallback('error', err.message || String(err));
  } finally {
    setTimeout(() => {
      delete isUploadingPaths[path];
    }, 1000);
  }
};

let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 10000;

export const triggerRemoteSync = async (force: boolean = false) => {
  if (!supabase || !localPlatform || !onStatusChangeCallback) return;
  if (!force && Date.now() - lastSyncTime < SYNC_THROTTLE_MS) {
    console.log('[Supabase Sync] Sync throttled.');
    return;
  }
  await startSync();
};

