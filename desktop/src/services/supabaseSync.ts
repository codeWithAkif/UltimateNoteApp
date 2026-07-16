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

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// EGRESS (indirme kotası) OPTİMİZASYONU: Her notun en son senkronize edilen
// uzak updated_at damgasını yerel olarak saklarız. Senkronda önce yalnızca
// metadata (yol + damga, not başına ~50 bayt) çekilir; bir notun içeriği
// SADECE uzak damgası değişmişse indirilir. Önceden her senkron tüm kasanın
// tam içeriğini indiriyordu — Supabase ücretsiz planındaki 5 GB/ay egress
// kotasının aşılmasının nedeni buydu.
const getSyncStampsKey = (): string => {
  if (!supabase) return 'sync_stamps_default';
  const url = (supabase as any).supabaseUrl || '';
  return `sync_stamps_${getHash(url)}_${currentVault}`;
};

const getSyncStamps = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(getSyncStampsKey()) || '{}');
  } catch (e) {
    return {};
  }
};

const updateSyncStamp = (path: string, stamp: string) => {
  const stamps = getSyncStamps();
  stamps[path] = stamp;
  localStorage.setItem(getSyncStampsKey(), JSON.stringify(stamps));
};

const removeSyncStamp = (path: string) => {
  const stamps = getSyncStamps();
  delete stamps[path];
  localStorage.setItem(getSyncStampsKey(), JSON.stringify(stamps));
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

    // 1. Fetch remote note METADATA only (path + damga + silinme durumu).
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // İçerik ('content') bilerek ÇEKİLMEZ — tam kasa indirmesi her senkronda
    // megabaytlarca egress tüketiyordu. İçerik yalnızca damgası değişen notlar
    // için aşağıda toplu ve hedefli olarak indirilir.
    const { data: remoteNotes, error } = await supabase
      .from('notes')
      .select('path, is_deleted, updated_at')
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
    const localNotes = localFileList.filter((f: any) => (f.type === 'note' || f.type === 'excalidraw' || f.type === 'drawio') && f.path !== 'metadata.json');
    const localNotesMap: Record<string, any> = {};
    localNotes.forEach((f: any) => {
      localNotesMap[f.path] = f;
    });

    // 3. 3-Way Reconciliation (ARTIMLI: içerik yalnızca değişen notlar için indirilir)
    const syncHashes = getSyncHashes();
    const newSyncHashes: Record<string, string> = { ...syncHashes };
    const syncStamps = getSyncStamps();
    const newSyncStamps: Record<string, string> = { ...syncStamps };

    // İçeriği indirilmesi gereken notlar (uzak damgası değişmiş / çakışma adayı)
    const contentNeeded: { path: string; localNote: any; localContent: string; localHash: string }[] = [];

    for (const localNote of localNotes) {
      const path = localNote.path;
      const remoteMeta = remoteNotesMap[path];

      let localContent = '';
      try {
        localContent = await localPlatform.readNote(path);
      } catch (e) {
        console.error(`[Supabase Sync] Error reading local note ${path}:`, e);
        continue;
      }

      const normalizedLocalContent = localContent.replace(/\r\n/g, '\n');
      const localHash = getHash(normalizedLocalContent);

      if (remoteMeta) {
        if (remoteMeta.is_deleted) {
          console.log(`[Supabase Sync] Remote deleted note: ${path}, removing locally...`);
          await localPlatform.deletePath(path);
          delete newSyncHashes[path];
          delete newSyncStamps[path];
          continue;
        }

        const lastHash = syncHashes[path];
        const localChanged = lastHash === undefined || localHash !== lastHash;
        const lastStamp = syncStamps[path];
        const remoteChanged = lastStamp === undefined || lastStamp !== remoteMeta.updated_at;

        if (!localChanged && !remoteChanged) {
          // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          // İki taraf da değişmemiş — bu not için TEK BAYT indirme/yükleme yok.
          // Tipik bir senkronda notların tamamına yakını bu daldan geçer;
          // egress tasarrufunun özü budur.
          continue;
        }

        if (localChanged && !remoteChanged) {
          console.log(`[Supabase Sync] Local modified: ${path}, uploading...`);
          const sentStamp = await uploadNoteDirect(path, normalizedLocalContent);
          newSyncHashes[path] = localHash;
          if (sentStamp) newSyncStamps[path] = sentStamp;
          continue;
        }

        // Uzak damga değişmiş (ya da ilk artımlı çalıştırma): içerik gerekli.
        contentNeeded.push({ path, localNote, localContent: normalizedLocalContent, localHash });
      } else {
        const lastHash = syncHashes[path];
        if (lastHash !== undefined) {
          console.log(`[Supabase Sync] Note was deleted on remote (hard-delete): ${path}, removing locally...`);
          await localPlatform.deletePath(path);
          delete newSyncHashes[path];
          delete newSyncStamps[path];
        } else {
          console.log(`[Supabase Sync] Note is missing on remote: ${path}, uploading...`);
          const sentStamp = await uploadNoteDirect(path, normalizedLocalContent);
          newSyncHashes[path] = localHash;
          if (sentStamp) newSyncStamps[path] = sentStamp;
        }
      }
    }

    // B. Uzakta olup yerelde olmayan notlar
    const remoteOnlyDownloads: string[] = [];
    for (const path in remoteNotesMap) {
      if (!localNotesMap[path]) {
        const remoteMeta = remoteNotesMap[path];
        if (syncHashes[path] !== undefined) {
          console.log(`[Supabase Sync] Note was deleted locally: ${path}, deleting on remote...`);
          await handleLocalDelete(path);
          delete newSyncHashes[path];
          delete newSyncStamps[path];
        } else if (!remoteMeta.is_deleted) {
          remoteOnlyDownloads.push(path);
        }
      }
    }

    // C. Gerekli içerikleri toplu (chunk'lı) tek tip sorguyla indir.
    const allPathsToFetch = [...contentNeeded.map(c => c.path), ...remoteOnlyDownloads];
    const fetchedRows: Record<string, any> = {};
    for (let ci = 0; ci < allPathsToFetch.length; ci += 100) {
      const chunk = allPathsToFetch.slice(ci, ci + 100);
      const { data: rows, error: contentErr } = await supabase
        .from('notes')
        .select('path, content, updated_at, is_deleted')
        .eq('vault', currentVault)
        .in('path', chunk);
      if (contentErr) throw contentErr;
      (rows || []).forEach((r: any) => { fetchedRows[r.path] = r; });
    }
    if (allPathsToFetch.length > 0) {
      console.log(`[Supabase Sync] Content downloaded for ${allPathsToFetch.length} changed note(s) only.`);
    }

    // D. İçerik karşılaştırmalı uzlaştırma (yalnızca değişen notlar için)
    for (const item of contentNeeded) {
      const remoteNote = fetchedRows[item.path];
      if (!remoteNote || remoteNote.is_deleted) continue; // Az önce silinmiş olabilir; sonraki senkron halleder.

      const normalizedRemoteContent = (remoteNote.content || '').replace(/\r\n/g, '\n');
      const remoteHash = getHash(normalizedRemoteContent);
      newSyncHashes[item.path] = remoteHash;
      newSyncStamps[item.path] = remoteNote.updated_at;

      if (item.localHash !== remoteHash) {
        const lastHash = syncHashes[item.path];
        const localChanged = lastHash !== undefined && item.localHash !== lastHash;
        const remoteChanged = lastHash !== undefined && remoteHash !== lastHash;

        if (localChanged && !remoteChanged) {
          console.log(`[Supabase Sync] Local modified: ${item.path}, uploading...`);
          const sentStamp = await uploadNoteDirect(item.path, item.localContent);
          newSyncHashes[item.path] = item.localHash;
          if (sentStamp) newSyncStamps[item.path] = sentStamp;
        } else if (!localChanged && remoteChanged) {
          console.log(`[Supabase Sync] Remote modified: ${item.path}, downloading...`);
          await localPlatform.writeNote(item.path, normalizedRemoteContent);
        } else {
          // Conflict / no history, compare timestamps with scale normalization
          const remoteTime = new Date(remoteNote.updated_at).getTime();
          let localTime = item.localNote.updatedAt || 0;
          if (localTime > 0 && localTime < 10000000000) {
            localTime = localTime * 1000;
          }

          if (localTime > 0 && localTime > remoteTime + 2000) {
            console.log(`[Supabase Sync] Conflict resolved (local newer): ${item.path}, uploading...`);
            const sentStamp = await uploadNoteDirect(item.path, item.localContent);
            newSyncHashes[item.path] = item.localHash;
            if (sentStamp) newSyncStamps[item.path] = sentStamp;
          } else {
            console.log(`[Supabase Sync] Conflict resolved (remote newer): ${item.path}, backing up local file and downloading remote...`);
            try {
              await localPlatform.writeNote(item.path + '.backup', item.localContent);
            } catch (bakErr) {
              console.error('[Supabase Sync] Backup file write failed:', bakErr);
            }
            await localPlatform.writeNote(item.path, normalizedRemoteContent);
          }
        }
      }
    }

    // E. Uzakta olup yerelde hiç olmayan notları indir
    for (const path of remoteOnlyDownloads) {
      const remoteNote = fetchedRows[path];
      if (!remoteNote || remoteNote.is_deleted) continue;
      console.log(`[Supabase Sync] Remote note is missing locally: ${path}, downloading...`);
      const normalizedRemoteContent = (remoteNote.content || '').replace(/\r\n/g, '\n');
      await localPlatform.writeNote(path, normalizedRemoteContent);
      newSyncHashes[path] = getHash(normalizedRemoteContent);
      newSyncStamps[path] = remoteNote.updated_at;
    }

    // Save updated hashes + stamps
    localStorage.setItem(getSyncHashesKey(), JSON.stringify(newSyncHashes));
    localStorage.setItem(getSyncStampsKey(), JSON.stringify(newSyncStamps));
    lastSyncTime = Date.now();

    console.log('[Supabase Sync] Reconciliation completed. Subscribing to realtime updates...');
    onStatusChangeCallback('synced', null);

    if (onRemoteChangeCallback) {
      onRemoteChangeCallback();
    }

    // 4. Set up Realtime WebSockets Channel
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // startSync() her not kaydından sonra ve pencere odaklandığında yeniden
    // çağrılabiliyor (triggerRemoteSync üzerinden). Önceden bu fonksiyon,
    // ZATEN ABONE OLMUŞ eski bir kanal varken bile doğrudan yeni bir
    // .channel(...).on(...).subscribe() zinciri kuruyordu — Supabase istemcisi
    // aynı isimli (topic) kanalı önbellekte tuttuğu için bu, "cannot add
    // postgres_changes callbacks after subscribe()" hatasına yol açıyordu.
    // Yeni bir kanal kurmadan önce eskisini (varsa) temizliyoruz.
    if (realtimeChannel) {
      try {
        supabase.removeChannel(realtimeChannel);
      } catch (e) {
        console.error('[Supabase Realtime] Error removing previous channel before resubscribe:', e);
      }
      realtimeChannel = null;
    }

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
              removeSyncStamp(path);
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
              // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
              // Damga her durumda güncellenir (içerik zaten eşit olsa bile) —
              // aksi halde bir sonraki senkron bu notu "değişmiş" sanıp
              // içeriğini gereksiz yere yeniden indirirdi.
              if (newRec.updated_at) {
                updateSyncStamp(path, newRec.updated_at);
              }
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
              removeSyncStamp(path);
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

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Başarılı yüklemede gönderilen updated_at damgasını döndürür ve yerel damga
// deposunu günceller — böylece bir sonraki senkron bu notu "uzaktan değişmiş"
// sanıp içeriğini geri İNDİRMEZ (kendi yazdığımızı geri indirmek egress israfıydı).
const uploadNoteDirect = async (path: string, content: string): Promise<string | null> => {
  if (!supabase) return null;
  try {
    isUploadingPaths[path] = true;
    const name = path.replace('.md', '').split('/').pop() || '';
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const sentStamp = new Date().toISOString();
    const { error } = await supabase
      .from('notes')
      .upsert(
        {
          vault: currentVault,
          path,
          name,
          content: normalizedContent,
          is_deleted: false,
          updated_at: sentStamp
        },
        { onConflict: 'vault,path' }
      );
    if (error) throw error;
    updateSyncHash(path, getHash(normalizedContent));
    updateSyncStamp(path, sentStamp);
    return sentStamp;
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
    removeSyncStamp(path);
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

