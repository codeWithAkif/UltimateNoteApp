import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Hem yerel hem uzak taraf, son bilinen ortak sürümden beri değişmişse ("gerçek" çakışma)
// önceden sessizce zaman damgasına göre otomatik seçim yapılıp yerel dosya .backup olarak
// yedekleniyordu. Artık aynı otomatik seçim/yedekleme YİNE yapılır (veri kaybı riski yok)
// ama çakışma ayrıca bu listede toplanıp arayüze bildirilir — kullanıcı isterse tek tıkla
// diğer sürümü seçebilir.
export interface SyncConflict {
  path: string;
  localContent: string;
  remoteContent: string;
  remoteUpdatedAt: string;
  autoChosenSide: 'local' | 'remote';
}

let supabase: SupabaseClient | null = null;
let currentVault = 'default';
let localPlatform: any = null;
let onRemoteChangeCallback: (() => void) | null = null;
let onStatusChangeCallback: ((status: SyncStatus, error?: string | null) => void) | null = null;
let onConflictsCallback: ((conflicts: SyncConflict[]) => void) | null = null;
let onDevPathsChangeCallback: ((data: Record<string, any>) => void) | null = null;
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

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Aynı cihazdan art arda açılışta gereksiz senkron" şikayetini çözmek için her
// cihaza kalıcı bir kimlik lazım. localStorage'da saklanır — bu, cihaz kimliğinin
// tam olarak senkron hash/damga önbellekleriyle (sync_hashes_*/sync_stamps_*) AYNI
// depoda yaşadığı, dolayısıyla biri temizlenirse (ör. uygulama verisi silinirse)
// diğerinin de temizleneceği anlamına gelir — bu yüzden aşağıdaki "aynı cihaz mı?"
// kısayolu, önbellek temizlenmiş bir cihazda otomatik olarak devre dışı kalır.
const DEVICE_ID_KEY = 'device_id';
const getDeviceId = (): string => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
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

// ============================================================================
// KLASÖR SENKRONİZASYONU
// ============================================================================
// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Notlar sekmesi damgası ile aynı desende ("bu yol daha önce senkronlandı mı?") ama
// klasörler için ayrı bir anahtar altında tutulur — böylece "uzakta aktif + yerelde
// hiç görülmemiş" ile "daha önce senkronluydu, şimdi yerelde yok" ayrımı notlardaki
// gibi netleşir.
const getFolderSyncStampsKey = (): string => {
  if (!supabase) return 'sync_folder_stamps_default';
  const url = (supabase as any).supabaseUrl || '';
  return `sync_folder_stamps_${getHash(url)}_${currentVault}`;
};

const getFolderSyncStamps = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(getFolderSyncStampsKey()) || '{}');
  } catch (e) {
    return {};
  }
};

const setFolderSyncStamps = (stamps: Record<string, string>) => {
  localStorage.setItem(getFolderSyncStampsKey(), JSON.stringify(stamps));
};

// ============================================================================
// MEDYA (resim/ses) SENKRONİZASYONU
// ============================================================================
// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Notlar tablosu yalnızca .md/.excalidraw/.drawio METNİNİ tutar — notlara eklenen resim/ses
// dosyaları önceden hiç senkronize edilmiyordu (bir cihazda eklenen medya diğer cihazda
// bozuk link olarak kalıyordu). Bu bölüm, DEFAULT_NOTES_DIR altındaki medya dosyalarını
// bir Supabase Storage bucket'ına ("media") yükler/indirir. Depolama yolu basitlik için
// düzleştirilmiştir: `${vault}/${encodeURIComponent(relativePath)}` — böylece iç içe
// klasörlerde bile TEK bir list() çağrısıyla tüm kasa medyası listelenebilir (Storage'ın
// klasörleri özyinelemeli listelemeyen list() API'siyle uğraşmaya gerek kalmaz).
// KURULUM GEREKSİNİMİ: Supabase projenizde "media" adında bir Storage bucket'ı (ve
// yükleme/indirme/silme için uygun RLS politikaları) olması gerekir; yoksa bu adım
// sessizce loglanıp atlanır, not senkronu etkilenmez.
const MEDIA_BUCKET = 'media';

const getMediaStampsKey = (): string => {
  if (!supabase) return 'sync_media_stamps_default';
  const url = (supabase as any).supabaseUrl || '';
  return `sync_media_stamps_${getHash(url)}_${currentVault}`;
};

const getMediaStamps = (): Record<string, { size: number; mtimeMs: number }> => {
  try {
    return JSON.parse(localStorage.getItem(getMediaStampsKey()) || '{}');
  } catch (e) {
    return {};
  }
};

const mediaStoragePath = (relativePath: string): string => `${currentVault}/${encodeURIComponent(relativePath)}`;

const dataUrlToBlob = (dataUrl: string): Blob => {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// Not senkronunu bekletmemek için startSync() sonunda ÇAĞRILIR AMA AWAIT EDİLMEZ
// (arka planda ilerler); hataları kendi içinde yakalar, ana senkronu asla bozmaz.
const syncMediaFiles = async () => {
  if (!supabase || !localPlatform || typeof localPlatform.listMediaFiles !== 'function') return;

  try {
    const localFiles: Array<{ path: string; size?: number; updatedAt: number }> = await localPlatform.listMediaFiles();

    const { data: remoteObjects, error: listErr } = await supabase.storage.from(MEDIA_BUCKET).list(currentVault, { limit: 1000 });
    if (listErr) {
      console.warn(`[Supabase Sync] Medya bucket'ı ("${MEDIA_BUCKET}") listelenemedi — bucket henüz oluşturulmamış olabilir. Not senkronu bundan etkilenmez. Detay:`, listErr.message);
      return;
    }

    const remoteMap: Record<string, any> = {};
    (remoteObjects || []).forEach(obj => {
      if (!obj.id) return; // id:null olan girdiler sahte "klasör" işaretçileridir, atlanır.
      try {
        remoteMap[decodeURIComponent(obj.name)] = obj;
      } catch (e) {
        // Bozuk kodlanmış isim — yoksay.
      }
    });

    const localMap: Record<string, boolean> = {};
    localFiles.forEach(f => { localMap[f.path] = true; });

    const stamps = getMediaStamps();
    const newStamps: Record<string, { size: number; mtimeMs: number }> = { ...stamps };
    let changed = false;

    // A. Yerelde yeni/değişmiş medyaları yükle
    for (const f of localFiles) {
      const stamp = stamps[f.path];
      const localChanged = !stamp || stamp.size !== (f.size || 0) || stamp.mtimeMs !== f.updatedAt;
      if (!localChanged && remoteMap[f.path]) continue;

      try {
        const dataUrl = await localPlatform.readMedia(f.path);
        if (!dataUrl) continue;
        const blob = dataUrlToBlob(dataUrl);
        const { error: upErr } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(mediaStoragePath(f.path), blob, { upsert: true, contentType: blob.type || undefined });
        if (upErr) {
          console.error(`[Supabase Sync] Medya yüklenemedi: ${f.path}`, upErr.message);
          continue;
        }
        newStamps[f.path] = { size: f.size || 0, mtimeMs: f.updatedAt };
        changed = true;
        console.log(`[Supabase Sync] Medya yüklendi: ${f.path}`);
      } catch (err) {
        console.error(`[Supabase Sync] Medya yükleme hatası: ${f.path}`, err);
      }
    }

    // B. Yerelde eksik olan uzak medyaları indir
    for (const remotePath in remoteMap) {
      if (localMap[remotePath]) continue;
      try {
        const { data: blob, error: dlErr } = await supabase.storage.from(MEDIA_BUCKET).download(mediaStoragePath(remotePath));
        if (dlErr || !blob) {
          console.error(`[Supabase Sync] Medya indirilemedi: ${remotePath}`, dlErr?.message);
          continue;
        }
        const dataUrl = await blobToDataUrl(blob);
        await localPlatform.writeNote(remotePath, dataUrl);
        newStamps[remotePath] = { size: blob.size, mtimeMs: Date.now() };
        changed = true;
        console.log(`[Supabase Sync] Medya indirildi: ${remotePath}`);
      } catch (err) {
        console.error(`[Supabase Sync] Medya indirme hatası: ${remotePath}`, err);
      }
    }

    if (changed) {
      localStorage.setItem(getMediaStampsKey(), JSON.stringify(newStamps));
      if (onRemoteChangeCallback) onRemoteChangeCallback();
    }
  } catch (err) {
    console.error('[Supabase Sync] Medya senkronu başarısız:', err);
  }
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// KLASÖR UZLAŞTIRMASI: syncMediaFiles gibi kendi içinde try/catch'li, bağımsız bir
// geçiş — "folders" tablosu henüz oluşturulmamışsa (migration çalıştırılmadıysa)
// burada sessizce uyarı basıp döner, not senkronunu ASLA bozmaz. startSync()'in not
// uzlaştırması bittikten SONRA çağrılır ve yerel dosya listesini burada TAZE olarak
// yeniden okur (startSync başındaki listeyi yeniden kullanmaz) — çünkü bu geçiş
// sırasındaki "klasör artık boş mu?" kontrolü, az önce not uzlaştırmasının indirdiği/
// sildiği notları da hesaba katmalı.
const syncFolders = async () => {
  if (!supabase || !localPlatform) return;

  let remoteFoldersMap: Record<string, any>;
  try {
    const { data: remoteFolders, error } = await supabase
      .from('folders')
      .select('path, is_deleted, updated_at')
      .eq('vault', currentVault);
    if (error) throw error;
    remoteFoldersMap = {};
    (remoteFolders || []).forEach((f: any) => { remoteFoldersMap[f.path] = f; });
  } catch (err) {
    console.warn('[Supabase Sync] Klasör senkronu atlandı — "folders" tablosu henüz yok gibi görünüyor (bkz. supabase/migrations/0001_create_folders_table.sql):', err);
    return;
  }

  try {
    const localFileList = await localPlatform.listFiles();
    const localFolderPaths = new Set<string>(
      localFileList.filter((f: any) => f.type === 'folder').map((f: any) => f.path)
    );
    const hasLocalDescendant = (path: string) =>
      localFileList.some((f: any) => f.path !== path && f.path.startsWith(path + '/'));

    const folderStamps = getFolderSyncStamps();
    const newFolderStamps: Record<string, string> = { ...folderStamps };

    // Aynı kitlesel-silme koruması (notlardaki ile aynı mantık, bkz. startSync B bölümü):
    // önceden bilinen klasörlerin yarısından fazlası aniden "yerelde yok" görünüyorsa
    // bunu gerçek bir silme değil, şüpheli bir yerel depolama arızası say.
    const candidateLocalFolderDeletes = Object.keys(remoteFoldersMap).filter(
      path => !localFolderPaths.has(path) && folderStamps[path] !== undefined && !remoteFoldersMap[path].is_deleted
    );
    const previouslyTrackedFolderCount = Object.keys(folderStamps).length;
    const suspiciousMassFolderDeletion =
      candidateLocalFolderDeletes.length >= 3 &&
      previouslyTrackedFolderCount > 0 &&
      candidateLocalFolderDeletes.length >= previouslyTrackedFolderCount * 0.5;

    if (suspiciousMassFolderDeletion) {
      console.warn(`[Supabase Sync] ${candidateLocalFolderDeletes.length}/${previouslyTrackedFolderCount} previously-synced folder(s) appear missing from local storage at once — treating as a local storage problem, NOT propagating deletion. Re-creating locally instead.`);
    }

    // A. Uzakta olup yerelde olmayan/durumu farklı olan klasörler
    for (const path in remoteFoldersMap) {
      const remoteMeta = remoteFoldersMap[path];
      const existsLocally = localFolderPaths.has(path);
      const previouslySynced = folderStamps[path] !== undefined;

      if (!remoteMeta.is_deleted) {
        if (existsLocally) {
          newFolderStamps[path] = remoteMeta.updated_at;
        } else if (previouslySynced && !suspiciousMassFolderDeletion) {
          // Bu cihaz bu klasörü daha önce görmüş, artık yerelde yok — kullanıcı
          // sildi say ve uzağa da yansıt (notlardaki "yerelde silinen" mantığının aynısı).
          console.log(`[Supabase Sync] Folder was deleted locally: ${path}, deleting on remote...`);
          await handleLocalFolderDelete(path);
          delete newFolderStamps[path];
        } else {
          // Hiç senkronlanmamış YA DA şüpheli kitlesel silme durumu — güvenli yön: indir.
          console.log(`[Supabase Sync] Remote folder missing locally: ${path}, creating...`);
          await localPlatform.createFolder(path);
          newFolderStamps[path] = remoteMeta.updated_at;
        }
      } else if (existsLocally) {
        if (hasLocalDescendant(path)) {
          // Uzakta silinmiş görünüyor ama yerelde hâlâ içeriği var — içerik kazanır,
          // eski tombstone'u geri alıp klasörü tekrar aktif olarak yükle.
          console.log(`[Supabase Sync] Remote folder tombstone conflicts with local content: ${path}, re-uploading...`);
          const sentStamp = await uploadFolderDirect(path);
          if (sentStamp) newFolderStamps[path] = sentStamp;
        } else {
          console.log(`[Supabase Sync] Remote deleted folder (now empty locally): ${path}, removing locally...`);
          await localPlatform.deletePath(path);
          delete newFolderStamps[path];
        }
      } else {
        delete newFolderStamps[path];
      }
    }

    // B. Yerelde olup uzakta hiç kaydı olmayan klasörler (hiç senkronlanmamış, yeni)
    for (const path of localFolderPaths) {
      if (remoteFoldersMap[path]) continue; // A'da zaten ele alındı.
      console.log(`[Supabase Sync] Local folder is missing on remote: ${path}, uploading...`);
      const sentStamp = await uploadFolderDirect(path);
      if (sentStamp) newFolderStamps[path] = sentStamp;
    }

    setFolderSyncStamps(newFolderStamps);
  } catch (err) {
    console.error('[Supabase Sync] Klasör uzlaştırması başarısız:', err);
  }
};

export const initSupabase = (
  url: string,
  key: string,
  vault: string,
  platform: any,
  onRemoteChange: () => void,
  onStatusChange: (status: SyncStatus, error?: string | null) => void,
  onConflicts?: (conflicts: SyncConflict[]) => void,
  onDevPathsChange?: (data: Record<string, any>) => void
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
    onConflictsCallback = onConflicts || null;
    onDevPathsChangeCallback = onDevPathsChange || null;

    // BUG DÜZELTMESİ: Burada eskiden koşulsuz "syncing" durumuna geçiliyordu —
    // bu da aynı-cihaz kısayolu (bkz. startSync başındaki kontrol) devreye
    // girecek olsa bile UI'da her açılışta kısa bir "Eşitleniyor..." ekranının
    // görünmesine yol açıyordu. Artık durum değişikliği startSync()'e bırakılıyor:
    // kısayol uygunsa doğrudan 'synced' olur (hiç "syncing" görünmez), gerçekten
    // tam uzlaştırma gerekiyorsa startSync() zaten kendi içinde 'syncing' bildirir.
    startSync();
  } catch (err: any) {
    console.error('[Supabase Sync] Initialization error:', err);
    onStatusChange('error', err.message || String(err));
  }
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// startSync() her not kaydından sonra ve pencere odaklandığında yeniden
// çağrılabiliyor (triggerRemoteSync üzerinden). Önceden bu fonksiyon,
// ZATEN ABONE OLMUŞ eski bir kanal varken bile doğrudan yeni bir
// .channel(...).on(...).subscribe() zinciri kuruyordu — Supabase istemcisi
// aynı isimli (topic) kanalı önbellekte tuttuğu için bu, "cannot add
// postgres_changes callbacks after subscribe()" hatasına yol açıyordu.
// Yeni bir kanal kurmadan önce eskisini (varsa) temizliyoruz. Ayrı bir fonksiyona
// çıkarıldı çünkü hem tam uzlaştırma yolundan HEM DE "aynı cihaz" kısayol yolundan
// (bkz. startSync başındaki kontrol) çağrılması gerekiyor — kısayol alınsa bile
// gerçek zamanlı güncellemelere abone olunmazsa bu oturum boyunca başka bir
// cihazın yaptığı değişiklikler hiç yansımaz.
const subscribeToRealtimeChanges = () => {
  if (!supabase) return;

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
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'folders',
        filter: `vault=eq.${currentVault}`
      },
      async (payload: any) => {
        const { eventType, new: newRec, old: oldRec } = payload;
        console.log(`[Supabase Realtime] Folder event: ${eventType}`, payload);

        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          const path = newRec.path;
          if (!path) return;
          if (newRec.is_deleted) {
            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            // Bir başka cihaz klasörü sildi. Ama bu cihazda o klasörün içinde hâlâ
            // not/alt klasör varsa (henüz kendi notu-sonu senkronuyla temizlenmediyse)
            // ZORLA (recursive) silmek veri kaybına yol açar — yalnızca gerçekten
            // boşsa siliyoruz; değilse bir sonraki tam senkron bunu tekrar değerlendirir.
            try {
              const currentFiles = await localPlatform.listFiles();
              const stillHasChildren = currentFiles.some((f: any) => f.path !== path && f.path.startsWith(path + '/'));
              if (!stillHasChildren) {
                await localPlatform.deletePath(path);
                const stamps = getFolderSyncStamps();
                delete stamps[path];
                setFolderSyncStamps(stamps);
                if (onRemoteChangeCallback) onRemoteChangeCallback();
              }
            } catch (e) {
              console.error(`[Supabase Realtime] Error checking folder emptiness for ${path}:`, e);
            }
          } else {
            await localPlatform.createFolder(path);
            const stamps = getFolderSyncStamps();
            stamps[path] = newRec.updated_at;
            setFolderSyncStamps(stamps);
            if (onRemoteChangeCallback) onRemoteChangeCallback();
          }
        } else if (eventType === 'DELETE') {
          const path = oldRec?.path;
          if (path) {
            try {
              const currentFiles = await localPlatform.listFiles();
              const stillHasChildren = currentFiles.some((f: any) => f.path !== path && f.path.startsWith(path + '/'));
              if (!stillHasChildren) {
                await localPlatform.deletePath(path);
              }
            } catch (e) {
              console.error(`[Supabase Realtime] Error checking folder emptiness for ${path}:`, e);
            }
            const stamps = getFolderSyncStamps();
            delete stamps[path];
            setFolderSyncStamps(stamps);
            if (onRemoteChangeCallback) onRemoteChangeCallback();
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'dev_paths',
        filter: `vault=eq.${currentVault}`
      },
      (payload: any) => {
        const newRec = payload.new;
        if (newRec && newRec.data && onDevPathsChangeCallback) {
          onDevPathsChangeCallback(newRec.data);
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
};

const startSync = async () => {
  if (!supabase || !localPlatform || !onStatusChangeCallback) return;

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ / İSTEK: "En son telefondan açmışsam ve şu an telefonla açıyorsam
  // eşitleme ile uğraşmasın." — bu cihaz, en son BAŞARIYLA tam senkron tamamlayan
  // cihazsa (bkz. bu fonksiyonun sonundaki "sync_devices" upsert'i), araya başka
  // bir cihaz girmemiş demektir; yerel durumumuz zaten en güncel halidir. Böyle bir
  // durumda her dosyayı yeniden okuyup hash'leyen ağır uzlaştırmayı tamamen atlayıp
  // doğrudan senkronlanmış say ve gerçek zamanlı aboneliği kur. "sync_devices"
  // tablosu henüz yoksa (migration çalıştırılmadıysa) bu kısayol sessizce devre
  // dışı kalır ve her zamanki tam uzlaştırma çalışır.
  try {
    const { data: deviceRow } = await supabase
      .from('sync_devices')
      .select('device_id')
      .eq('vault', currentVault)
      .maybeSingle();
    if (deviceRow && deviceRow.device_id === getDeviceId()) {
      console.log('[Supabase Sync] Last full sync was from this same device — skipping reconciliation.');
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Not/klasör uzlaştırması atlansa da dev_paths ayrı bir kanaldan (uploadDevPaths ile
      // her değişiklikte anında) yazılabildiği için "sync_devices" damgasını hiç tetiklemeden
      // güncellenmiş olabilir — bu ucuz tek satır fetch'i her zaman ayrıca yapıyoruz.
      if (onDevPathsChangeCallback) {
        const devPathsData = await fetchDevPaths();
        if (devPathsData) onDevPathsChangeCallback(devPathsData);
      }
      onStatusChangeCallback('synced', null);
      subscribeToRealtimeChanges();
      return;
    }
  } catch (e) {
    // "sync_devices" tablosu yok/erişilemiyor — normal tam senkrona devam.
  }

  try {
    onStatusChangeCallback('syncing', null);
    console.log('[Supabase Sync] Reconciling notes...');
    const conflictsThisRun: SyncConflict[] = [];

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
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // BUG DÜZELTMESİ (kitlesel veri kaybı): "uzakta var + daha önce senkronlanmış hash'i var
    // + şu an yerelde yok" durumu "kullanıcı yerelde sildi" varsayılıp uzakta da siliniyordu.
    // Ama bu koşul, depolama konumu değişikliği/izin hatası gibi nedenlerle yerel dosya
    // listelemesinin YANLIŞLIKLA boş/eksik dönmesiyle de birebir aynı görünüyor (nitekim
    // Android'de Directory.Documents -> Directory.Data geçişinde tam olarak buna yol açtı).
    // Bu yüzden önce adayları topluyoruz; yerel liste beklenmedik şekilde önceden bilinen
    // notların yarısından fazlasını "kayıp" gösteriyorsa bunu gerçek bir silme değil, şüpheli
    // bir yerel depolama arızası sayıp silmeyi uzağa YANSITMIYORUZ — bunun yerine notu
    // yereldeki (muhtemelen boşalmış) depoya geri indiriyoruz.
    const candidateLocalDeletePaths = Object.keys(remoteNotesMap).filter(
      path => !localNotesMap[path] && syncHashes[path] !== undefined
    );
    const previouslyTrackedCount = Object.keys(syncHashes).length;
    const suspiciousMassDeletion =
      candidateLocalDeletePaths.length >= 3 &&
      previouslyTrackedCount > 0 &&
      candidateLocalDeletePaths.length >= previouslyTrackedCount * 0.5;

    if (suspiciousMassDeletion) {
      console.warn(`[Supabase Sync] ${candidateLocalDeletePaths.length}/${previouslyTrackedCount} previously-synced note(s) appear missing from local storage at once — treating as a local storage problem, NOT propagating deletion. Re-downloading from remote instead.`);
    }

    const remoteOnlyDownloads: string[] = [];
    for (const path in remoteNotesMap) {
      if (!localNotesMap[path]) {
        const remoteMeta = remoteNotesMap[path];
        if (syncHashes[path] !== undefined && !suspiciousMassDeletion) {
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

          const autoChosenSide: 'local' | 'remote' = (localTime > 0 && localTime > remoteTime + 2000) ? 'local' : 'remote';

          if (autoChosenSide === 'local') {
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

          // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          // Otomatik seçim yukarıda zaten uygulandı (veri kaybı yok, .backup dosyası mevcut) —
          // burada yalnızca kullanıcının sonradan tersini seçebilmesi için çakışmayı kaydediyoruz.
          conflictsThisRun.push({
            path: item.path,
            localContent: item.localContent,
            remoteContent: normalizedRemoteContent,
            remoteUpdatedAt: remoteNote.updated_at,
            autoChosenSide
          });
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

    // Klasör uzlaştırması not uzlaştırması TAMAMLANDIKTAN SONRA çalışır (bkz. syncFolders
    // tanımındaki yorum) — kendi içinde try/catch'li, başarısız olursa not senkronunu bozmaz.
    await syncFolders();

    // Gelişim yolu (rütbe) verisini çek ve App.tsx'e ilet — kendi try/catch'i fetchDevPaths
    // içinde, tablo yoksa/erişilemezse sessizce null döner.
    if (onDevPathsChangeCallback) {
      const devPathsData = await fetchDevPaths();
      if (devPathsData) onDevPathsChangeCallback(devPathsData);
    }

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Bu cihazın tam uzlaştırmayı BAŞARIYLA tamamladığını kaydediyoruz — bir sonraki
    // startSync() çağrısı (uygulama açılışı/resume) bu kaydı kontrol edip, hâlâ AYNI
    // cihaz en son senkronlayansa (yani araya başka bir cihaz girmediyse) ağır
    // uzlaştırmayı tamamen atlayabilir (bkz. startSync başındaki kısayol kontrolü).
    // "sync_devices" tablosu henüz oluşturulmamışsa sessizce yoksayılır.
    try {
      await supabase
        .from('sync_devices')
        .upsert(
          { vault: currentVault, device_id: getDeviceId(), synced_at: new Date().toISOString() },
          { onConflict: 'vault' }
        );
    } catch (e) {
      // Tablo yoksa (migration çalıştırılmadıysa) bu sadece kısayol optimizasyonunun
      // devre dışı kalmasına yol açar — not senkronu bundan etkilenmez.
    }

    console.log('[Supabase Sync] Reconciliation completed. Subscribing to realtime updates...');
    onStatusChangeCallback('synced', null);

    if (onRemoteChangeCallback) {
      onRemoteChangeCallback();
    }

    if (conflictsThisRun.length > 0 && onConflictsCallback) {
      onConflictsCallback(conflictsThisRun);
    }

    // Medya senkronu not senkronunu bekletmeden arka planda çalışır (bkz. yukarıdaki tanım).
    syncMediaFiles();

    subscribeToRealtimeChanges();

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

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Kullanıcı, çakışma bildirimindeki otomatik seçimin TERSİNİ tercih ederse çağrılır.
// 'local': yerel (backup'taki) içeriği tekrar buluta yükler ve yerel dosyaya da yazar.
// 'remote': uzak içeriği yerel dosyaya geri yazar — otomatik seçim yerel olmuşsa bunu geri alır.
// Her iki durumda da veri kaybı yoktur; orijinal yerel içerik zaten .backup dosyasında durur.
export const resolveConflict = async (
  path: string,
  side: 'local' | 'remote',
  localContent: string,
  remoteContent: string,
  remoteUpdatedAt: string
): Promise<void> => {
  if (!localPlatform) return;
  if (side === 'local') {
    await localPlatform.writeNote(path, localContent);
    await uploadNoteDirect(path, localContent);
  } else {
    await localPlatform.writeNote(path, remoteContent);
    updateSyncHash(path, getHash(remoteContent));
    updateSyncStamp(path, remoteUpdatedAt);
  }
  if (onRemoteChangeCallback) {
    onRemoteChangeCallback();
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

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// uploadNoteDirect/handleLocalDelete'in klasör karşılığı — aynı vault+path upsert
// deseniyle "folders" tablosuna yazar. Bir klasörün içeriği yoktur, bu yüzden hash
// karşılaştırması gerekmez; yalnızca "var mı / silinmiş mi" bilgisi taşınır.
// App.tsx'teki klasör oluşturma/yeniden adlandırma/silme çağrılarından hemen sonra
// çağrılır (platform.createFolder/renamePath/deletePath çağrısını takiben) — böylece
// bir sonraki tam senkron döngüsünü beklemeden değişiklik anında uzağa yansır.
export const uploadFolderDirect = async (path: string): Promise<string | null> => {
  if (!supabase) return null;
  try {
    const sentStamp = new Date().toISOString();
    const { error } = await supabase
      .from('folders')
      .upsert(
        { vault: currentVault, path, is_deleted: false, updated_at: sentStamp },
        { onConflict: 'vault,path' }
      );
    if (error) throw error;
    const stamps = getFolderSyncStamps();
    stamps[path] = sentStamp;
    setFolderSyncStamps(stamps);
    return sentStamp;
  } catch (err) {
    // "folders" tablosu henüz oluşturulmamışsa (migration çalıştırılmadıysa) burada
    // sessizce başarısız olur — not senkronu bundan etkilenmez.
    console.warn(`[Supabase Sync] Folder upload failed for ${path} (has the folders table migration been run?):`, err);
    return null;
  }
};

export const handleLocalFolderDelete = async (path: string): Promise<void> => {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('folders')
      .upsert(
        { vault: currentVault, path, is_deleted: true, updated_at: new Date().toISOString() },
        { onConflict: 'vault,path' }
      );
    if (error) throw error;
    const stamps = getFolderSyncStamps();
    delete stamps[path];
    setFolderSyncStamps(stamps);
  } catch (err) {
    console.warn(`[Supabase Sync] Folder soft-delete failed for ${path} (has the folders table migration been run?):`, err);
  }
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Gelişim Yolu" (rütbe) verisi notlar/klasörler gibi dosya sistemine bağlı değildir —
// vault başına TEK bir küçük JSON blob'u olarak tutulur (bkz. dev_paths tablosu,
// 0003_create_dev_paths_table.sql). Bu yüzden per-path çok satırlı/tombstone'lu bir
// tasarım yerine tek satırlık upsert/fetch yeterli. Birleştirme (merge) mantığı
// App.tsx'te yapılır çünkü developmentPaths state'i orada yaşıyor; burası yalnızca
// ham veriyi taşır.
export const uploadDevPaths = async (data: Record<string, any>): Promise<void> => {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('dev_paths')
      .upsert(
        { vault: currentVault, data, updated_at: new Date().toISOString() },
        { onConflict: 'vault' }
      );
    if (error) throw error;
  } catch (err) {
    console.warn('[Supabase Sync] Dev path upload failed (has the dev_paths table migration been run?):', err);
  }
};

const fetchDevPaths = async (): Promise<Record<string, any> | null> => {
  if (!supabase) return null;
  try {
    const { data: row, error } = await supabase
      .from('dev_paths')
      .select('data')
      .eq('vault', currentVault)
      .maybeSingle();
    if (error) throw error;
    return row ? (row.data || {}) : null;
  } catch (err) {
    console.warn('[Supabase Sync] Dev path fetch failed (has the dev_paths table migration been run?):', err);
    return null;
  }
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// handleLocalDelete() sadece is_deleted/updated_at alanlarını güncellediği için (upsert
// diğer sütunlara dokunmaz), Supabase'deki content sütunu silinen notun SON hâlini hâlâ
// taşır. Bu fonksiyon, o "yumuşak silinmiş" notları çöp kutusu ekranında listelemek için çeker.
export const fetchDeletedNotes = async (): Promise<Array<{ path: string; name: string; content: string; updated_at: string }>> => {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('path, name, content, updated_at')
      .eq('vault', currentVault)
      .eq('is_deleted', true);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase Sync] Failed to fetch deleted notes:', err);
    return [];
  }
};

// Uzaktaki (yerelde artık kopyası olmayabilecek) bir notu is_deleted=false yaparak geri getirir.
// İçeriği çağıran taraf ayrıca yerel dosyaya yazmalıdır (bkz. App.tsx handleRestoreFromTrash).
export const restoreRemoteNote = async (path: string): Promise<{ success: boolean; error?: string }> => {
  if (!supabase) return { success: false, error: 'Supabase yapılandırılmamış' };
  try {
    const { error } = await supabase
      .from('notes')
      .update({ is_deleted: false, updated_at: new Date().toISOString() })
      .eq('vault', currentVault)
      .eq('path', path);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
};

// Çöp kutusundaki bir notu Supabase'den kalıcı olarak siler (satırı tamamen kaldırır).
export const permanentlyDeleteRemoteNote = async (path: string): Promise<{ success: boolean; error?: string }> => {
  if (!supabase) return { success: false, error: 'Supabase yapılandırılmamış' };
  try {
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('vault', currentVault)
      .eq('path', path);
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Veritabanı boyutunu, kullanıcının Supabase projesinde bir kez tanımladığı basit bir
// RPC fonksiyonu (get_db_size) üzerinden okur. Bilinçli olarak sadece anon key ile
// erişilebilen, hesap genelinde yetki gerektirmeyen bir bilgi — trafik/egress verisi
// Postgres içinde tutulmadığı için buradan okunamaz (Supabase Dashboard'da görülür).
export const fetchDatabaseSizeBytes = async (): Promise<number | null> => {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_db_size');
    if (error) throw error;
    return typeof data === 'number' ? data : Number(data);
  } catch (err) {
    console.error('[Supabase Sync] Failed to fetch database size:', err);
    return null;
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

