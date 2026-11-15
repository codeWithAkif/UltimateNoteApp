// Dil Atölyesi'nde üretilen sesleri cihazda saklar (IndexedDB). Anahtar "<içerikId>|full" ya da "<içerikId>|s<cümleNo>".
// Not dosyası yerine burada tutulur: ses dosyaları büyük, not senkronunu yavaşlatırdı.
const DB_NAME = 'lang_lab_audio';
const STORE = 'clips';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export const getClip = async (key: string): Promise<Blob | null> => {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
};

export const putClip = async (key: string, blob: Blob): Promise<void> => {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    await done(tx);
    db.close();
  } catch { /* depolama yoksa ses yine çalar, sadece saklanmaz */ }
};

// Listede artık olmayan içeriklerin seslerini siler (bitti işaretlenen, silinen, serisiyle gidenler).
export const pruneClips = async (validTextIds: Set<string>): Promise<void> => {
  try {
    const db = await openDb();
    const keys = await new Promise<string[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
    const stale = keys.filter(k => !validTextIds.has(String(k).split('|')[0]));
    if (stale.length) {
      const tx = db.transaction(STORE, 'readwrite');
      stale.forEach(k => tx.objectStore(STORE).delete(k));
      await done(tx);
    }
    db.close();
  } catch { /* yoksay */ }
};
