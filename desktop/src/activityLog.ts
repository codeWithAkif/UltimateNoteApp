// Etkinlik kaydı: uygulama kullanılırken dakikada bir "buradaydım" işareti, o an açık olan sayfanın projesiyle birlikte tutulur.
// Yalnızca dakika ve proje adı saklanır (içerik, tuş bilgisi yok), veri bu cihazda kalır ve 14 gün sonra silinir.
// Dakikalardan "seans"lar çıkarılır: 20 dakikadan uzun hareketsizlik moladır ve hiçbir seansa yapıştırılmaz; seansın başlangıcı ilk
// dakikadır, bitişi son dakika + 3 dakikadır. Tüm hesaplar saftır; yalnızca load/save yardımcıları localStorage kullanır.

export const MINUTE = 60_000;
export const GAP_MIN = 20;   // bu kadar dakikadan uzun hareketsizlik = mola
export const TAIL_MIN = 3;   // seans bitişine eklenen kuyruk
export const MIN_ACTIVE_ONLY_MIN = 10; // not değişikliği olmayan seans için en az aktif dakika
const KEEP_DAYS = 14;

// gün (YYYY-MM-DD) -> proje adı ('' = projeye bağlanmayan) -> artan dakikalar (epoch / 60000)
export type ActivityLog = Record<string, Record<string, number[]>>;

const pad = (n: number) => String(n).padStart(2, '0');
export const ymdOfMs = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Veriyi yerinde günceller (dakikada bir çağrıldığı için kopyalamak gereksiz); değişti ise true.
export const addMinute = (log: ActivityLog, project: string, ms: number): boolean => {
  const m = Math.floor(ms / MINUTE);
  const day = ymdOfMs(ms);
  const d = log[day] || (log[day] = {});
  const arr = d[project] || (d[project] = []);
  const last = arr.length ? arr[arr.length - 1] : -1;
  if (m > last) { arr.push(m); return true; }
  if (m === last) return false;
  // Sıra dışı gelen dakika (ör. kaydetme gecikmesi): sıralı yere ekle.
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < m) lo = mid + 1; else hi = mid; }
  if (arr[lo] === m) return false;
  arr.splice(lo, 0, m);
  return true;
};

export const pruneLog = (log: ActivityLog, nowMs: number, days: number = KEEP_DAYS): ActivityLog => {
  const cutoff = ymdOfMs(nowMs - days * 24 * 60 * MINUTE);
  Object.keys(log).forEach(day => { if (day < cutoff) delete log[day]; });
  return log;
};

export interface Run { project: string; start: number; end: number; minutes: number } // ms

// [fromMs, toMs] arasındaki tüm dakikalardan, birbirini kesmeyen seanslar üretir. Her dakika tek bir projeye aittir; bir proje
// 20 dakikadan uzun ara verirse ya da araya başka bir proje girerse yeni seans başlar. Başka projenin 4 dakikadan kısa araya girmesi
// (A-b-A) gürültü sayılıp A'ya katılır; böylece hızlı geçişlerde parçalı bloklar oluşmaz.
export const buildRuns = (log: ActivityLog, fromMs: number, toMs: number): Run[] => {
  const events: { m: number; p: string }[] = [];
  const fromMin = Math.floor(fromMs / MINUTE), toMin = Math.floor(toMs / MINUTE);
  // Gün gün (öğlen 12:00 çapasıyla, yaz/kış saati kaymasına dayanıklı) ilgili günlerin dakikalarını topla.
  const dayCur = new Date(fromMs); dayCur.setHours(12, 0, 0, 0);
  while (dayCur.getTime() - 12 * 60 * MINUTE <= toMs) {
    const d = log[ymdOfMs(dayCur.getTime())];
    if (d) Object.keys(d).forEach(p => d[p].forEach(m => { if (m >= fromMin && m <= toMin) events.push({ m, p }); }));
    dayCur.setDate(dayCur.getDate() + 1);
  }
  // Aynı (dakika, proje) çiftini tekilleştir.
  events.sort((a, b) => a.m - b.m || a.p.localeCompare(b.p));
  const uniq = events.filter((e, i) => i === 0 || e.m !== events[i - 1].m || e.p !== events[i - 1].p);

  type R = { p: string; first: number; last: number; n: number };
  const runs: R[] = [];
  let cur: R | null = null;
  for (const e of uniq) {
    if (cur && e.p === cur.p && e.m - cur.last <= GAP_MIN) { if (e.m > cur.last) { cur.last = e.m; cur.n++; } continue; }
    cur = { p: e.p, first: e.m, last: e.m, n: 1 };
    runs.push(cur);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < runs.length - 1; i++) {
      const a = runs[i], b = runs[i + 1];
      if (a.p === b.p && b.first - a.last <= GAP_MIN) { a.last = Math.max(a.last, b.last); a.n += b.n; runs.splice(i + 1, 1); changed = true; break; }
    }
    if (changed) continue;
    for (let i = 1; i < runs.length - 1; i++) {
      const a = runs[i - 1], b = runs[i], c = runs[i + 1];
      if (a.p === c.p && a.p !== b.p && b.n <= 4 && c.first - a.last <= GAP_MIN) {
        a.last = Math.max(a.last, c.last); a.n += b.n + c.n; runs.splice(i, 2); changed = true; break;
      }
    }
  }

  return runs.map((r, i) => {
    const start = r.first * MINUTE;
    let end = (r.last + TAIL_MIN) * MINUTE;
    const next = runs[i + 1];
    if (next && next.first * MINUTE < end) end = Math.max(start + MINUTE, next.first * MINUTE);
    return { project: r.p, start, end, minutes: r.n };
  });
};

// ---------------- boşluklar ----------------
export interface Interval { start: number; end: number }

export const mergeIntervals = (list: Interval[]): Interval[] => {
  const sorted = list.filter(i => i.end > i.start).map(i => ({ ...i })).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end); else out.push(i);
  }
  return out;
};

export const workWindow = (ymd: string): Interval => {
  const [y, m, d] = ymd.split('-').map(Number);
  return { start: new Date(y, m - 1, d, 8, 0, 0).getTime(), end: new Date(y, m - 1, d, 20, 0, 0).getTime() };
};

// Meşgul aralıkların (hareket, işlenmiş bloklar, toplantılar, bekleyen taslaklar) ARASINDAKİ boşlukları bulur. Yalnızca günün ilk ve
// son meşgul anı arasına bakılır (öncesi/sonrası bilinmez, "çalışmıyordu" olabilir) ve 08:00–20:00 ile şu an sınırlar.
export const findGaps = (busy: Interval[], ymd: string, nowMs: number, minGapMin: number = GAP_MIN): Interval[] => {
  const merged = mergeIntervals(busy);
  if (merged.length < 2) return [];
  const win = workWindow(ymd);
  const out: Interval[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const start = Math.max(merged[i].end, win.start);
    const end = Math.min(merged[i + 1].start, win.end, nowMs);
    if (end - start >= minGapMin * MINUTE) out.push({ start, end });
  }
  return out;
};

// ---------------- kalıcılık ----------------
const KEY = 'session_activity_v1';
export const loadActivity = (nowMs: number = Date.now()): ActivityLog => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return pruneLog(parsed && typeof parsed === 'object' ? parsed : {}, nowMs);
  } catch { return {}; }
};
export const saveActivity = (log: ActivityLog) => {
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* depolama dolu olabilir; bellekte sürer */ }
};
