import { fitCal, mapFeat, srcFeat, type CalPoint, type FaceCal, type FaceFeat, type GazeSrc } from './face';

// Kayıttan kalibrasyon. İki veri kaynağı vardır, ikisi de aynı motora girer:
//  (1) Top takibi: ekranda bilinen bir yolda giden topu gözle izlerken kare özellikleri kaydedilir (etiket = topun o anki konumu). En temiz veri.
//  (2) Fare: kullanıcı çalışırken fareyi bakışının peşinden sürer (etiket = fare konumu). Daha gürültülü.
// Kayıt kusurludur: göz hedefin biraz gerisinde kalır, kullanıcı ara ara başka yere bakar. Bu yüzden (a) gecikme verilerden seçilir, (b) en kötü uyan örnekler
// elenerek (kırpmalı uyum) yeniden uydurulur, (c) göz sinyali ve model boyutu BLOKLU çapraz doğrulamayla seçilir: ardışık kareler birbirine çok benzediği için
// sıradan (çift/tek) ayırma sonucu olduğundan iyi gösterirdi; bu yüzden zaman olarak bitişik 5 sn'lik bloklar bütünüyle sınama tarafına ayrılır.

export interface RecFrame { t: number; f: FaceFeat }
export interface RecMouse { t: number; x: number; y: number }
/** Eğitim örneği: yüz özellikleri + gerçek ekran konumu + grup (zaman bloğu; çapraz doğrulama grupları bölmez) */
export interface Sample { f: FaceFeat; x: number; y: number; g: number }
export interface FitResult {
  cal: FaceCal; src: GazeSrc; k: number; used: number; total: number;
  mean: number; // eğitim hatası (kırpmalı ortalama, px)
  cv: number; // yeni (hiç görmediği) zaman bloklarında tahmini hata (px): gerçek başarı ölçüsü
  region: (number | null)[]; // REG_ROWS×REG_COLS hata haritası (px, satır satır): hangi bölge zayıf
  lag: number; // hedef-bakış gecikmesi (ms)
}
export const REG_COLS = 5, REG_ROWS = 3;
const CHUNK_MS = 5000, FOLDS = 4;

const robustMean = (e: number[], keep = 0.75) => { if (!e.length) return Infinity; const s = [...e].sort((a, b) => a - b), n = Math.max(1, Math.floor(s.length * keep)); return s.slice(0, n).reduce((a, b) => a + b, 0) / n; };

/** Kareleri, (t − gecikme) anındaki hedef konumla eşler. posAt null dönerse kare atılır. Gecikme: göz hedefi biraz geriden izler. */
export function buildSamples(frames: RecFrame[], posAt: (t: number) => { x: number; y: number } | null, lag: number, maxN: number, t0: number, gBase = 0): Sample[] {
  const stride = Math.max(1, Math.ceil(frames.length / maxN)), out: Sample[] = [];
  for (let i = 0; i < frames.length; i += stride) {
    const p = posAt(frames[i].t - lag); if (!p) continue;
    out.push({ f: frames[i].f, x: p.x, y: p.y, g: gBase + Math.floor((frames[i].t - t0) / CHUNK_MS) });
  }
  return out;
}

/** Kırpmalı uyum: en kötü uyan %25 elenir, kalanla yeniden uydurulur (2 tur). */
function trimFit(pts: CalPoint[], W: number, H: number, k: number, src: GazeSrc, rounds = 2): { cal: FaceCal | null; kept: number; errs: number[] } {
  const q = pts.map(p => ({ ...p, f: srcFeat(src, p.f) }));
  let cur = q, r = fitCal(cur, W, H, k);
  for (let t = 0; t < rounds && r.cal; t++) {
    const e = q.map(p => { const m = mapFeat(r.cal!, p.f); return Math.hypot(m.x - p.x, m.y - p.y); });
    const thr = [...e].sort((a, b) => a - b)[Math.floor(e.length * 0.75)];
    cur = q.filter((_, i) => e[i] <= thr);
    const nr = fitCal(cur, W, H, k); if (!nr.cal) break; r = nr;
  }
  if (!r.cal) return { cal: null, kept: 0, errs: [] };
  const cal = r.cal;
  const errs = q.map(p => { const m = mapFeat(cal, p.f); return Math.hypot(m.x - p.x, m.y - p.y); });
  cal.src = src;
  return { cal, kept: cur.length, errs };
}

const testErrs = (cal: FaceCal, src: GazeSrc, test: Sample[]) => test.map(p => { const m = mapFeat({ ...cal, src: undefined }, srcFeat(src, p.f)); return Math.hypot(m.x - p.x, m.y - p.y); });

/** Örneklerden model çıkarır: göz sinyali (i/a/b) ve model boyutu (4/7/10 katsayı) bloklu çapraz doğrulamayla seçilir. */
export function fitSamples(samples: Sample[], W: number, H: number, lag = 0): FitResult | null {
  if (samples.length < 60) return null;
  const has = (s: GazeSrc) => s === 'i' || samples.every(p => (s === 'a' ? p.f.g2x !== undefined : p.f.bx !== undefined));
  const fold = (p: Sample) => ((p.g % FOLDS) + FOLDS) % FOLDS;
  let best: { src: GazeSrc; k: number; cv: number; errs: { p: Sample; e: number }[] } | null = null;
  for (const src of ['i', 'a', 'b'] as GazeSrc[]) {
    if (!has(src)) continue;
    for (const k of [4, 7, 10]) {
      const errs: { p: Sample; e: number }[] = [];
      for (let f = 0; f < FOLDS; f++) {
        const train = samples.filter(p => fold(p) !== f), test = samples.filter(p => fold(p) === f);
        if (train.length < 40 || test.length < 10) continue;
        const r = trimFit(train, W, H, k, src); if (!r.cal) continue;
        const e = testErrs(r.cal, src, test); test.forEach((p, i) => errs.push({ p, e: e[i] }));
      }
      if (errs.length < samples.length * 0.5) continue;
      const cv = robustMean(errs.map(x => x.e), 0.8);
      if (!best || cv < best.cv) best = { src, k, cv, errs };
    }
  }
  if (!best) return null;
  const fin = trimFit(samples, W, H, best.k, best.src);
  if (!fin.cal) return null;
  const sum = new Array(REG_COLS * REG_ROWS).fill(0).map(() => [] as number[]);
  for (const { p, e } of best.errs) { const c = Math.min(REG_COLS - 1, Math.max(0, Math.floor((p.x / W) * REG_COLS))), r = Math.min(REG_ROWS - 1, Math.max(0, Math.floor((p.y / H) * REG_ROWS))); sum[r * REG_COLS + c].push(e); }
  return { cal: fin.cal, src: best.src, k: best.k, used: fin.kept, total: samples.length, mean: robustMean(fin.errs), cv: best.cv, region: sum.map(a => (a.length >= 5 ? robustMean(a, 0.8) : null)), lag };
}

// ---------------------------------------------------------------- fare kaydı
const mousePos = (mouse: RecMouse[]) => (tm: number): { x: number; y: number } | null => {
  let lo = 0, hi = mouse.length - 1; if (hi < 0 || mouse[0].t > tm) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mouse[mid].t <= tm) lo = mid; else hi = mid - 1; }
  const a = mouse[lo], b = mouse[lo + 1];
  if (tm - a.t > 500) return null; // fare 0,5 sn'den uzun durmuşsa kullanıcı muhtemelen başka yere bakıyor: örnek atılır
  if (b && b.t - a.t < 150) { const u = (tm - a.t) / (b.t - a.t); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; }
  return { x: a.x, y: a.y };
};

/** Kayıttan kalibrasyon çıkarır. Başarısızsa neden: 'az' (az örnek) | 'yayilim' (hedef ekranın geniş bölümüne gitmedi / uyum kurulamadı) */
export function fitRecorded(frames: RecFrame[], mouse: RecMouse[], W: number, H: number): { res: FitResult | null; why?: 'az' | 'yayilim' } {
  if (!frames.length || !mouse.length) return { res: null, why: 'az' };
  const t0 = frames[0].t, pos = mousePos(mouse);
  const lag = pickLag(frames, pos, [0, 100, 200, 300, 400, 500], W, H, t0);
  if (lag === null) return { res: null, why: frames.length < 120 ? 'az' : 'yayilim' };
  const res = fitSamples(buildSamples(frames, pos, lag, 400, t0), W, H, lag);
  return res ? { res } : { res: null, why: 'yayilim' };
}

function pickLag(frames: RecFrame[], pos: (t: number) => { x: number; y: number } | null, lags: number[], W: number, H: number, t0: number): number | null {
  let lag: number | null = null, bestE = Infinity;
  for (const l of lags) {
    const s = buildSamples(frames, pos, l, 300, t0); if (s.length < 80) continue;
    const r = trimFit(s, W, H, 4, 'i'); if (!r.cal) continue;
    const e = robustMean(r.errs); if (e < bestE) { bestE = e; lag = l; }
  }
  return lag;
}

// ---------------------------------------------------------------- top takibi
/** Top takibi kaydından model çıkarır; önceki oturumların örnekleri (prior) varsa onlarla birlikte uydurulur (farklı duruş/gün = daha dayanıklı model). */
export function fitPursuit(frames: RecFrame[], pos: (t: number) => { x: number; y: number }, W: number, H: number, prior: Sample[] = []): { res: FitResult | null; samples: Sample[]; why?: 'az' | 'yayilim' } {
  if (frames.length < 150) return { res: null, samples: [], why: 'az' };
  const t0 = frames[0].t;
  const lag = pickLag(frames, pos, [0, 50, 100, 150, 200, 250, 300, 400], W, H, t0);
  if (lag === null) return { res: null, samples: [], why: 'yayilim' };
  const gBase = prior.reduce((a, p) => Math.max(a, p.g), -1) + 1;
  const fresh = buildSamples(frames, (t) => pos(t), lag, 1200, t0, gBase);
  const res = fitSamples([...prior, ...fresh], W, H, lag);
  return res ? { res, samples: fresh } : { res: null, samples: fresh, why: 'yayilim' };
}

// ---------------------------------------------------------------- eğitim verisinin saklanması (cihazda; kare görüntüsü değil, yalnız sayısal özellikler)
const TRAIN_KEY = 'st-train-v1', TRAIN_MAX = 3000;
const FK = ['nx', 'ny', 'yaw', 'pitch', 'gx', 'gy', 'g2x', 'g2y', 'bx', 'by', 'roll', 'open'] as const;
export const loadTrain = (W: number, H: number): Sample[] => {
  try {
    const v = JSON.parse(localStorage.getItem(TRAIN_KEY) || 'null'); if (!v || v.v !== 1 || !Array.isArray(v.rows)) return [];
    return v.rows.map((r: number[]) => { const f: any = {}; FK.forEach((k, i) => { f[k] = r[i]; }); return { f: f as FaceFeat, x: r[12] * W, y: r[13] * H, g: r[14] }; });
  } catch { return []; }
};
/** Yalnız tüm aday göz sinyalleri tam olan örnekler saklanır; en yeni TRAIN_MAX tanesi tutulur. */
export const saveTrain = (samples: Sample[], W: number, H: number) => {
  try {
    const rows = samples.filter(p => FK.every(k => typeof p.f[k] === 'number')).slice(-TRAIN_MAX).map(p => [...FK.map(k => Math.round((p.f[k] as number) * 1e5) / 1e5), Math.round((p.x / W) * 1e4) / 1e4, Math.round((p.y / H) * 1e4) / 1e4, p.g]);
    localStorage.setItem(TRAIN_KEY, JSON.stringify({ v: 1, rows }));
  } catch { /* yoksay */ }
};
export const clearTrain = () => { try { localStorage.removeItem(TRAIN_KEY); } catch { /* yoksay */ } };
export const trainCount = (): number => { try { const v = JSON.parse(localStorage.getItem(TRAIN_KEY) || 'null'); return v && Array.isArray(v.rows) ? v.rows.length : 0; } catch { return 0; } };
