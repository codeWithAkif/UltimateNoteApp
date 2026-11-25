// Baş işaretleme: MediaPipe Face Landmarker ile burun ucu ve baş dönüşü. Her şey bu cihazda çalışır (model uygulamayla gelir, kamera karesi hiçbir yere gitmez).
// Ekran konumu doğrudan dönüşten değil, kısa bir kalibrasyonla öğrenilen doğrusal eşlemeden gelir (bkz. calibrate/mapFeat): kameranın konumu, oturuş mesafesi ve
// ekran boyutu kişiden kişiye değiştiği için sabit bir katsayı güvenilmez.
import type { FaceLandmarker } from '@mediapipe/tasks-vision';

const asset = (p: string) => new URL(`mediapipe/${p}`, document.baseURI).href;

let cached: Promise<FaceLandmarker> | null = null;
let ready = false;
export const faceReady = () => ready;

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!cached) cached = once().then(r => { ready = true; return r; }, e => { cached = null; throw e; });
  return cached;
}

async function once(): Promise<FaceLandmarker> {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks(asset('wasm'));
  const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: asset('face_landmarker.task'), delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true, // modelin öğrendiği bakış yönü skorları (eyeLookIn/Out/Up/Down): ham iris geometrisinden çoğu zaman daha kararlı
    outputFacialTransformationMatrixes: false,
  });
  try { return await make('GPU'); }
  catch (e) { console.warn('[yüz] GPU açılamadı, CPU ile devam', e); return await make('CPU'); }
}

/** Ayna çevrilmiş (ekranda sağ = kullanıcının sağı) özellikler.
 *  nx/ny: burun ucu (0..1, video). yaw/pitch: burun ucunun göz ortasına göre kayması (göz arası mesafe biriminde): BAŞ dönüşü.
 *  gx/gy: irisin göz içindeki konumu (0..1; gx sağa baktıkça artar, gy aşağı baktıkça artar): GÖZ. İris noktaları modelde hazır gelir (478 nokta). */
export interface FaceFeat { nx: number; ny: number; yaw: number; pitch: number; gx: number; gy: number; /** göz açıklığı (göz arası mesafeye oranla): göz kırpmayı yakalamak için */ open?: number; /** baş yana eğimi (derece): kişinin kendi sağına eğince pozitif */ roll?: number;
  /** Aday göz sinyalleri (kalibrasyon hangisi bu kişide en iyi çalışıyorsa onu seçer): g2 = iris, göz çizgisi eksenine göre (baş eğimine dayanıklı), bx/by = modelin bakış skorları */
  g2x?: number; g2y?: number; bx?: number; by?: number }

export function detectFace(fl: FaceLandmarker, video: HTMLVideoElement, ts: number): FaceFeat | null {
  const r = fl.detectForVideo(video, ts);
  const lm = r.faceLandmarks?.[0];
  if (!lm) return null;
  const nose = lm[1], a = lm[33], b = lm[263]; // burun ucu, iki gözün dış köşeleri
  const eye = Math.hypot(a.x - b.x, a.y - b.y);
  if (eye < 0.02) return null; // yüz çok küçük/uzak: güvenilmez
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  // Göz: iris merkezi (468 sağ göz, 473 sol göz; kullanıcıya göre) göz köşelerine ve göz kapaklarına oranla. Göz kapalıysa (göz kırpma) kare atlanır.
  let gx = 0.5, gy = 0.5, open = 0.2, g2x: number | undefined, g2y: number | undefined, bx: number | undefined, by: number | undefined;
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  if (lm.length >= 478) {
    // Göz çizgisi eksenine göre iris: iris, göz köşelerini birleştiren doğruya izdüşürülür (yatay) ve doğrudan uzaklığına bakılır (dikey, göz genişliğine oranla). Kapak hareketine ve baş eğimine bağlı değildir.
    const axis = (p0: any, p1: any, ir: any) => { const ux = (p1.x - p0.x) * vw, uy = (p1.y - p0.y) * vh, dx = (ir.x - p0.x) * vw, dy = (ir.y - p0.y) * vh, l2 = ux * ux + uy * uy || 1; return { t: (dx * ux + dy * uy) / l2, s: (ux * dy - uy * dx) / l2 }; };
    const aR = axis(lm[33], lm[133], lm[468]), aL = axis(lm[362], lm[263], lm[473]);
    if ([aR.t, aL.t, aR.s, aL.s].every(Number.isFinite)) { g2x = 1 - (aR.t + aL.t) / 2; g2y = 0.5 + (aR.s + aL.s) / 2; }
    const bs = Object.fromEntries((r.faceBlendshapes?.[0]?.categories || []).map((c: any) => [c.categoryName, c.score]));
    if (bs.eyeLookInLeft !== undefined) { // kişinin sağına bakınca: sol göz içe (In), sağ göz dışa (Out)
      bx = 0.5 + ((bs.eyeLookInLeft - bs.eyeLookOutLeft) + (bs.eyeLookOutRight - bs.eyeLookInRight)) / 4;
      by = 0.5 + ((bs.eyeLookDownLeft + bs.eyeLookDownRight) - (bs.eyeLookUpLeft + bs.eyeLookUpRight)) / 4;
    }
    open = (Math.abs(lm[145].y - lm[159].y) + Math.abs(lm[374].y - lm[386].y)) / 2 / eye;
    const gxR = (lm[468].x - lm[33].x) / (lm[133].x - lm[33].x), gxL = (lm[473].x - lm[362].x) / (lm[263].x - lm[362].x);
    const gyR = (lm[468].y - lm[159].y) / (lm[145].y - lm[159].y), gyL = (lm[473].y - lm[386].y) / (lm[374].y - lm[386].y);
    if ([gxR, gxL, gyR, gyL].every(Number.isFinite)) { gx = 1 - (gxR + gxL) / 2; gy = (gyR + gyL) / 2; } // ayna: sağa bakınca artsın
  }
  // Eğim: göz çizgisinin açısı. Görüntü ayna değil ham olduğundan kişinin sağ gözü (33) görüntünün solundadır; sağa eğince o göz aşağı iner. En-boy oranı açıyı bozmasın diye piksel oranıyla hesaplanır.
  const roll = (Math.atan2((a.y - b.y) * vh, (b.x - a.x) * vw) * 180) / Math.PI;
  return { nx: 1 - nose.x, ny: nose.y, yaw: ((1 - nose.x) - (1 - mx)) / eye, pitch: (nose.y - my) / eye, gx, gy, open, roll, g2x, g2y, bx, by };
}

/** Kalibrasyon sonucu. x = ax·taban(f), y = ay·taban(f). Katsayı sayısı modeli belirler:
 *  3 = yalnız baş [1,a,b] · 4 = baş+göz [1,a,b,g] · 6 = eski baş ikinci derece · 7 = baş+göz+kareler · 10 = tam ikinci derece.
 *  m: veri ortalaması [nx,ny,yaw,pitch,gx,gy] (merkezleme, kararlılık). eg: "göz payı" çarpanı (1 = öğrenilen). */
export type GazeSrc = 'i' | 'a' | 'b'; // i: iris/göz kapakları · a: iris/göz ekseni · b: modelin bakış skorları
export const GAZE_NAME: Record<GazeSrc, string> = { i: 'iris (kapaklara göre)', a: 'iris (göz eksenine göre)', b: 'model bakış skoru' };
export interface FaceCal { ax: number[]; ay: number[]; m?: number[]; eg?: number; src?: GazeSrc }
/** Seçilen göz sinyalini gx/gy yerine koyar (kalibrasyon ve çalışma aynı sinyali kullansın) */
export const srcFeat = (src: GazeSrc | undefined, f: FaceFeat): FaceFeat => (src === 'a' && f.g2x !== undefined ? { ...f, gx: f.g2x, gy: f.g2y ?? f.gy } : src === 'b' && f.bx !== undefined ? { ...f, gx: f.bx, gy: f.by ?? f.gy } : f);

type Basis = (f: FaceFeat, m: number[], k: number, eg: number) => number[];
const tab = (a: number, b: number, g: number, k: number): number[] => {
  switch (k) {
    case 3: return [1, a, b];
    case 4: return [1, a, b, g];
    case 6: return [1, a, b, a * a, a * b, b * b];
    case 7: return [1, a, b, g, a * a, b * b, g * g];
    default: return [1, a, b, g, a * a, b * b, g * g, a * b, a * g, b * g];
  }
};
const baseX: Basis = (f, m, k, eg) => tab(f.nx - m[0], f.yaw - m[2], (f.gx - (m[4] ?? 0)) * eg, k);
const baseY: Basis = (f, m, k, eg) => tab(f.ny - m[1], f.pitch - m[3], (f.gy - (m[5] ?? 0)) * eg, k);

// En küçük kareler. Sütunlar ölçeklenir (katsayılar binlerce, özellikler binde birler: ölçeksiz çözüm kararsız olur) ve neredeyse sabit sütunlar dışarıda bırakılır:
// kullanıcı başını ya da gözünü hiç oynatmadıysa o sütun yalnızca gürültüdür, ona katsayı uydurmak sonradan ekranı titretir. Dışarıda kalan terimin katsayısı 0'dır.
// Noktalar hiç bağımsız değilse null döner. lin: doğrusal terim sayısı (bias hariç).
const lsqN = (rows: number[][], ys: number[], ridge: number, lin: number): number[] | null => {
  const k = rows[0].length, n = rows.length;
  const sc = new Array(k).fill(1), use: number[] = [0];
  for (let i = 1; i < k; i++) {
    let q = 0; for (const r of rows) q += r[i] * r[i]; q = Math.sqrt(q / n); sc[i] = q;
    if (q > (i <= lin ? 2e-3 : 1e-5)) use.push(i);
  }
  const u = use.length;
  const M: number[][] = Array.from({ length: u }, () => new Array(u + 1).fill(0));
  rows.forEach((r, t) => { for (let i = 0; i < u; i++) { const ri = r[use[i]] / sc[use[i]]; M[i][u] += ri * ys[t]; for (let j = 0; j < u; j++) M[i][j] += ri * (r[use[j]] / sc[use[j]]); } });
  for (let i = 1; i < u; i++) M[i][i] += ridge * n; // ölçeklenmiş sütunlarda köşegen ~ n: ceza göreli
  for (let c = 0; c < u; c++) {
    let p = c; for (let r = c + 1; r < u; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < u; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= u; q++) M[r][q] -= f * M[c][q]; }
  }
  const out = new Array(k).fill(0);
  use.forEach((col, i) => { out[col] = M[i][u] / M[i][i] / sc[col]; });
  return out;
};

/** ph: noktanın hangi aşamada işaretlendiği. 'b' birlikte (doğal bakış) · 'h' yalnız baş (gözler başa göre sabit) · 'e' yalnız göz (baş sabit) */
export type CalPhase = 'b' | 'h' | 'e';
export interface CalPoint { f: FaceFeat; x: number; y: number; ph?: CalPhase }

/** Kare özelliklerinin ortalaması (tüm alanlar) */
export function avgFeat(fs: FaceFeat[]): FaceFeat {
  const o: any = {}, keys = ['nx', 'ny', 'yaw', 'pitch', 'gx', 'gy', 'g2x', 'g2y', 'bx', 'by', 'roll', 'open'] as const;
  for (const k of keys) { const v = fs.map(f => f[k]).filter((x): x is number => typeof x === 'number'); if (v.length === fs.length && v.length) o[k] = v.reduce((a, b) => a + b, 0) / v.length; }
  return o as FaceFeat;
}

// Taban terimlerinden hangileri GÖZ içerir (g'li): bunlar "göz payı"dır, diğerleri "baş payı"dır. Katsayı sayısına göre: 4: [g] · 7: [g,g²] · 10: [g,g²,a·g,b·g]
const eyeTerm = (k: number, i: number): boolean => (k === 4 ? i === 3 : k === 7 ? i === 3 || i === 6 : k === 10 ? i === 3 || i === 6 || i === 8 || i === 9 : false);

/** Ekran konumunu baş ve göz payı olarak ayrı verir: baş = kaba bölge (yavaş, ağır yumuşatılır), göz = bölge içi ince konum (hızlı). Toplamları mapFeat'tir. */
export const mapParts = (c: FaceCal, f0: FaceFeat): { hx: number; hy: number; ex: number; ey: number } => {
  const f = srcFeat(c.src, f0);
  const m = c.m || [0, 0, 0, 0, 0, 0], eg = c.eg ?? 1;
  const bx = baseX(f, m, c.ax.length, eg), by = baseY(f, m, c.ay.length, eg);
  let hx = 0, ex = 0, hy = 0, ey = 0;
  c.ax.forEach((v, i) => { const t = v * bx[i]; if (eyeTerm(c.ax.length, i)) ex += t; else hx += t; });
  c.ay.forEach((v, i) => { const t = v * by[i]; if (eyeTerm(c.ay.length, i)) ey += t; else hy += t; });
  return { hx, hy, ex, ey };
};

export const mapFeat = (c: FaceCal, f: FaceFeat): { x: number; y: number } => { const q = mapParts(c, f); return { x: q.hx + q.ex, y: q.hy + q.ey }; };

/** Göz kırpma kapısı. Göz açıklığı kendi tepe değerine göre (yavaşça azalan) çok düşerse kırpma sayılır: imleç donar ve kırpmadan hemen önceki konuma döner.
 *  Kapanırken göz kapağı irisi kısmen örter, konum kayar: bu yüzden başlangıçtan ~160 ms önceki konum "son iyi konum" sayılır. Açıldıktan sonra 140 ms daha dondurulur.
 *  Aşağı bakmak da gözü biraz kapatır (~%25); eşik (%55) bunu kırpma saymayacak kadar derindir, açılışta %72 histerezisi vardır. */
export class BlinkGate {
  private base = 0;
  private on = false;
  private holdUntil = 0;
  private hist: { t: number; x: number; y: number }[] = [];
  /** Dondurulmuşken gösterilecek konum */
  held: { x: number; y: number } | null = null;
  /** open: göz açıklığı oranı. cur: şimdiki konum (geçmiş yoksa yedek). Dönüş: bu kare dondurulmalı mı. */
  step(open: number, now: number, cur: { x: number; y: number } | null): boolean {
    this.base = this.base ? Math.max(open, this.base * 0.9985) : open;
    const ratio = this.base > 0 ? open / this.base : 1;
    if (!this.on && ratio < 0.55) {
      this.on = true;
      const tt = now - 160, h = this.hist.find(e => e.t >= tt) || this.hist[0];
      this.held = h ? { x: h.x, y: h.y } : cur;
    } else if (this.on && ratio > 0.72) { this.on = false; this.holdUntil = now + 140; }
    return this.on || now < this.holdUntil;
  }
  /** Dondurulmamış karelerde konumu kaydeder (geri alma için son ~450 ms tutulur) */
  record(now: number, x: number, y: number) { this.hist.push({ t: now, x, y }); while (this.hist.length && now - this.hist[0].t > 450) this.hist.shift(); }
}

/** Noktalardan eşlemeyi çıkarır. Nokta sayısına göre model: <5 yalnız baş · 5–23 baş+göz (doğrusal) · 24+ +kareler.
 *  Göz ölçümü hiç değişmediyse (eski noktalar ya da göz hareketsiz) yalnız baş modeli kullanılır. errs: her noktanın sapması (px), mean: ortalaması.
 *  4 noktadan azsa ya da noktalar bağımsız değilse cal null. */
export function fitCal(pts: CalPoint[], W?: number, H?: number, forceK?: number): { cal: FaceCal | null; errs: number[]; mean: number } {
  const n = pts.length;
  if (n < 4) return { cal: null, errs: [], mean: 0 };
  // Ekran boyutu verildiyse noktalar ekranın en az %35'ine yatayda ve dikeyde yayılmalı: aynı satıra/sütuna toplanan noktalar bir ekseni hiç öğretmez (imleç o eksende takılı kalırdı)
  if (W && H) {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    if (Math.max(...xs) - Math.min(...xs) < 0.35 * W || Math.max(...ys) - Math.min(...ys) < 0.35 * H) return { cal: null, errs: [], mean: 0 };
  }
  const m = [0, 0, 0, 0, 0, 0];
  for (const p of pts) { m[0] += p.f.nx / n; m[1] += p.f.ny / n; m[2] += p.f.yaw / n; m[3] += p.f.pitch / n; m[4] += (p.f.gx ?? 0.5) / n; m[5] += (p.f.gy ?? 0.5) / n; }
  const vx = pts.reduce((a, p) => a + ((p.f.gx ?? 0.5) - m[4]) ** 2, 0) / n, vy = pts.reduce((a, p) => a + ((p.f.gy ?? 0.5) - m[5]) ** 2, 0) / n;
  const eyes = vx > 6e-5 && vy > 6e-5; // iris konumu gerçekten değişmediyse (std < ~0,008) göz modele alınmaz
  // Model boyutu: deneyle (bantlar arası baş + bant içi göz davranışı) doğrusal baş+göz modeli en iyi genelleyen oldu (yeni noktalarda ~10 px; yalnız baş ~95 px,
  // kareli modeller kalibrasyon dışına taşarken fazla esnediği için daha kötü). Kareli terimler yalnızca çok sayıda (24+) nokta olduğunda eklenir.
  const k = forceK ?? (eyes ? (n < 5 ? 3 : n < 24 ? 4 : 7) : (n < 9 ? 3 : 6));
  const ridge = k === 3 ? 1e-6 : k === 4 ? 1e-3 : 2e-3; // ölçeklenmiş sütunlarda göreli ceza
  const fx = pts.map(p => ({ ...p.f, gx: p.f.gx ?? 0.5, gy: p.f.gy ?? 0.5 }));
  const lin = k === 3 || k === 6 ? 2 : 3;
  const ax = lsqN(fx.map(f => baseX(f, m, k, 1)), pts.map(p => p.x), ridge, lin);
  const ay = lsqN(fx.map(f => baseY(f, m, k, 1)), pts.map(p => p.y), ridge, lin);
  if (!ax || !ay) return { cal: null, errs: [], mean: 0 };
  const cal: FaceCal = { ax, ay, m, eg: 1 };
  const errs = pts.map((p, i) => { const q = mapFeat(cal, fx[i]); return Math.hypot(q.x - p.x, q.y - p.y); });
  return { cal, errs, mean: errs.reduce((a, b) => a + b, 0) / n };
}

/** Otomatik 5 nokta için: uyum kötüyse (artık hata büyükse) null, kalibrasyon tekrarlanmalı. */
export function calibrate(pts: CalPoint[], W: number, H: number): FaceCal | null {
  const r = fitCal(pts, W, H);
  return r.cal && Math.max(...r.errs) < Math.hypot(W, H) * 0.22 ? r.cal : null;
}

/** Göz sinyalini kişiye göre seçer: her aday için model kurulur ve birini dışarıda bırakarak (LOO) sınanır; yeni noktalarda en az hata veren seçilir.
 *  Tüm noktalarda bulunmayan aday (ör. eski kayıtlı noktalar) elenir. Dönüş: seçilen modelin kalibrasyonu ve her adayın LOO hatası. */
export function fitBest(pts: CalPoint[], W?: number, H?: number): { cal: FaceCal | null; errs: number[]; mean: number; src: GazeSrc; loo: Partial<Record<GazeSrc, number>> } {
  const has = (s: GazeSrc) => s === 'i' || pts.every(p => (s === 'a' ? p.f.g2x !== undefined : p.f.bx !== undefined));
  const loo: Partial<Record<GazeSrc, number>> = {};
  let best: GazeSrc = 'i', bestE = Infinity;
  for (const s of ['i', 'a', 'b'] as GazeSrc[]) {
    if (!has(s)) continue;
    const q = pts.map(p => ({ ...p, f: srcFeat(s, p.f) }));
    if (!fitCal(q, W, H).cal) continue;
    let e = 0, k = 0;
    for (let i = 0; i < q.length; i++) { const r = fitCal(q.filter((_, j) => j !== i)); if (!r.cal) continue; const m = mapFeat(r.cal, q[i].f); e += Math.hypot(m.x - q[i].x, m.y - q[i].y); k++; }
    if (!k) continue;
    e /= k; loo[s] = e;
    if (e < bestE) { bestE = e; best = s; }
  }
  const q = pts.map(p => ({ ...p, f: srcFeat(best, p.f) }));
  const r = fitCal(q, W, H);
  if (r.cal) r.cal.src = best;
  return { ...r, src: best, loo };
}
