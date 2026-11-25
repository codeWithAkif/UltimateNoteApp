// Top takibi kalibrasyonu için top yolu: ekranın her köşesine/kenarına ve içine, değişen hızlarda gider, ara ara durur.
// Yol, zamanın saf bir fonksiyonudur (pos(t)): kayıt sırasında top çizilir, aynı fonksiyon sonradan "o an gözün nerede olması gerektiği"ni verir.
// Konumlar ekran oranıdır (0..1); piksele çevirme ekran tarafında yapılır.

export interface BallPath { pos(t: number): { x: number; y: number }; total: number }

const rng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u); // yumuşak kalkış/duruş: gözün pürüzsüz takip edebileceği hareket

interface Seg { t0: number; t1: number; tp: number; ax: number; ay: number; bx: number; by: number }

export function makeBallPath(durationMs: number, seed = 12345): BallPath {
  const r = rng(seed), segs: Seg[] = [];
  const M = [0.03, 0.5, 0.97]; // köşeler ve kenar ortaları (ekranın en uç bölgeleri en zor olanlardır, bilerek çok ziyaret edilir)
  const anchors = M.flatMap(x => M.map(y => [x, y] as const)).filter(([x, y]) => !(x === 0.5 && y === 0.5));
  let t = 0, cx = 0.5, cy = 0.5;
  while (t < durationMs) {
    const edge = r() < 0.4;
    const [bx, by] = edge ? anchors[Math.floor(r() * anchors.length)] : [0.05 + r() * 0.9, 0.06 + r() * 0.88];
    const dist = Math.hypot((bx - cx) * 1600, (by - cy) * 900), speed = 350 + r() * 650; // px/sn: yavaş (kolay takip) ... hızlı
    const dur = Math.max(700, (dist / speed) * 1000), pause = r() < 0.15 ? 1100 : r() * 450; // bazen uzun sabit bakış
    segs.push({ t0: t, t1: t + dur, tp: t + dur + pause, ax: cx, ay: cy, bx, by });
    t += dur + pause; cx = bx; cy = by;
  }
  let k = 0;
  return {
    total: t,
    pos(tt: number) {
      if (tt <= 0) return { x: 0.5, y: 0.5 };
      if (k >= segs.length || segs[k].t0 > tt) k = 0;
      while (k + 1 < segs.length && segs[k].tp <= tt) k++;
      const s = segs[k]; if (tt >= s.t1) return { x: s.bx, y: s.by };
      const u = ease((tt - s.t0) / (s.t1 - s.t0)); return { x: s.ax + (s.bx - s.ax) * u, y: s.ay + (s.by - s.ay) * u };
    },
  };
}
