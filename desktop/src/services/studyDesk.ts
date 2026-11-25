import { useSyncExternalStore } from 'react';

// Çalışma masası: uygulamanın her yerinden (not, kitap, dil metni, ezber destesi) seçilip masaya alınan en fazla 10 öğe.
// Hepsi altta bir not dosyasıdır (kitap = Kütüphane klasöründeki not, dil metni ve ezber kartı da notlardan okunur), bu yüzden
// yalnızca yol + tür saklanır: içerik her zaman güncel not metninden gelir, kopya tutulmaz.

export type DeskKind = 'note' | 'book' | 'lang' | 'cards';
export interface DeskItem { path: string; kind: DeskKind }
export const DESK_MAX = 10;
export const DESK_KIND_LABEL: Record<DeskKind, string> = { note: 'Not', book: 'Kitap', lang: 'Dil', cards: 'Ezber' };

const KEY = 'study-desk-v1';
const load = (): DeskItem[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x: any) => x && typeof x.path === 'string').map((x: any) => ({ path: x.path, kind: (x.kind in DESK_KIND_LABEL ? x.kind : 'note') as DeskKind })).slice(0, DESK_MAX) : [];
  } catch { return []; }
};

let items: DeskItem[] = load();
const subs = new Set<() => void>();
const set = (next: DeskItem[]) => { items = next; try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* yoksay */ } subs.forEach(f => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const getDesk = () => items;
export const onDesk = (path: string) => items.some(x => x.path === path);
/** Masaya ekler; masa doluysa false döner (çağıran kullanıcıya haber verir). Zaten varsa true. */
export const addToDesk = (path: string, kind: DeskKind = 'note'): boolean => {
  if (onDesk(path)) return true;
  if (items.length >= DESK_MAX) return false;
  set([...items, { path, kind }]); return true;
};
export const removeFromDesk = (path: string) => { if (onDesk(path)) set(items.filter(x => x.path !== path)); };
export const clearDesk = () => { if (items.length) set([]); };
/** Varsa çıkarır, yoksa ekler. Dönüş: işlemden sonra masada mı, dolu olduğu için eklenemedi mi. */
export const toggleDesk = (path: string, kind: DeskKind = 'note'): 'added' | 'removed' | 'full' => {
  if (onDesk(path)) { removeFromDesk(path); return 'removed'; }
  return addToDesk(path, kind) ? 'added' : 'full';
};
export const useDesk = (): DeskItem[] => useSyncExternalStore(subscribe, getDesk, getDesk);

// Masayı uzaya gitmeden açmak için: her yerden `openStudyDesk()` çağrılır, ana pencerede bir dinleyici masayı gösterir.
export const OPEN_DESK_EVENT = 'study-desk-open';
export const openStudyDesk = () => window.dispatchEvent(new Event(OPEN_DESK_EVENT));

// ---- Masadaki kum saati: masa kapansa da süre akmaya devam eder (uygulama açık kaldığı sürece), bitince hafif bir zil çalar.
export interface DeskTimer { total: number; endAt: number | null; left: number } // saniye; endAt doluysa çalışıyor, değilse duraklatılmış (left saniye kaldı)
const TKEY = 'study-desk-timer-v1';
const loadTimer = (): DeskTimer => {
  try {
    const v = JSON.parse(localStorage.getItem(TKEY) || 'null');
    if (v && Number.isFinite(v.total) && Number.isFinite(v.left)) return { total: v.total, endAt: Number.isFinite(v.endAt) ? v.endAt : null, left: v.left };
  } catch { /* yoksay */ }
  return { total: 25 * 60, endAt: null, left: 25 * 60 };
};
let timer: DeskTimer = loadTimer();
const tsubs = new Set<() => void>();
let chimed = false;
const setTimer = (t: DeskTimer) => { timer = t; try { localStorage.setItem(TKEY, JSON.stringify(t)); } catch { /* yoksay */ } tsubs.forEach(f => f()); };
const tsub = (f: () => void) => { tsubs.add(f); return () => { tsubs.delete(f); }; };
export const useDeskTimer = (): DeskTimer => useSyncExternalStore(tsub, () => timer, () => timer);
/** Kalan saniye (çalışıyorsa bitiş anından hesaplanır) */
export const timerLeft = (t: DeskTimer = timer, now = Date.now()) => (t.endAt ? Math.max(0, (t.endAt - now) / 1000) : t.left);
export const setTimerMinutes = (min: number) => { const s = Math.max(60, Math.min(180 * 60, Math.round(min * 60))); chimed = false; setTimer({ total: s, endAt: null, left: s }); };
export const startTimer = () => { const left = timerLeft(); if (timer.endAt) return; const l = left <= 0 ? timer.total : left; chimed = false; setTimer({ ...timer, endAt: Date.now() + l * 1000, left: l }); };
export const pauseTimer = () => { if (timer.endAt) setTimer({ ...timer, endAt: null, left: timerLeft() }); };
export const resetTimer = () => { chimed = false; setTimer({ ...timer, endAt: null, left: timer.total }); };
/** Süre dolduysa bir kez zil çalar ve durdurur; kum saati bileşeni her saniye çağırır. */
export const checkTimerDone = (): boolean => {
  if (timer.endAt && Date.now() >= timer.endAt) {
    setTimer({ ...timer, endAt: null, left: 0 });
    if (!chimed) { chimed = true; chime(); }
    return true;
  }
  return false;
};
const chime = () => {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    const ctx = new AC(); const t0 = ctx.currentTime;
    [659.25, 783.99, 987.77].forEach((f, i) => { // mi-sol-si: yumuşak, kısa çan
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.35); g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.35 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 1.6);
      o.connect(g).connect(ctx.destination); o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 1.7);
    });
    setTimeout(() => { try { void ctx.close(); } catch { /* yoksay */ } }, 4000);
  } catch { /* yoksay */ }
};

// ---- Masadaki radyo: müzik çalar durumu App'te durur; App onu buraya "köprü" olarak yazar, masa (uzaydan ya da ana pencereden açılsa da) okur.
export interface MusicBridge { title: string; playing: boolean; hasTracks: boolean; onPlayPause: () => void; onNext: () => void; onPrev: () => void }
let bridge: MusicBridge | null = null;
const bsubs = new Set<() => void>();
export const setMusicBridge = (b: MusicBridge | null) => { bridge = b; bsubs.forEach(f => f()); };
export const useMusicBridge = (): MusicBridge | null => useSyncExternalStore((f) => { bsubs.add(f); return () => { bsubs.delete(f); }; }, () => bridge, () => bridge);
