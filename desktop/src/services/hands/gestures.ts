// El kontrolü · jest tanıma. Saf fonksiyonlar: kamera ya da tarayıcı gerektirmez, sentetik el noktalarıyla test edilir.
// Noktalar EKRAN pikselinde gelir (ayna çevrilmiş). MediaPipe el noktaları:
//  0 bilek · başparmak 1-4 · işaret 5-8 · orta 9-12 · yüzük 13-16 · serçe 17-20 (kök, orta eklem, uç eklemi, uç)
// Yöntem (parmak uzunluk oranı, One Euro süzgeci, en yakın avuçla el kimliği) literatürde bilinen standart tekniklerdir;
// kod bu uygulama için sıfırdan yazıldı.

export interface P { x: number; y: number; z?: number }

export type Gesture = 'acik' | 'yumruk' | 'cimdik' | 'isaret' | 'zafer' | 'diger';

export const GESTURE_LABEL: Record<Gesture, string> = {
  acik: 'açık el', yumruk: 'yumruk', cimdik: 'çimdik', isaret: 'işaret', zafer: 'zafer', diger: '—',
};

export interface HandShape {
  /** Bilek ile orta parmak kökü arası uzaklık: elin ekrandaki büyüklüğü (px). Tüm oranlar buna göre. */
  size: number;
  palm: P;
  /** İşaret parmağı ucu: imleç */
  tip: P;
  /** Başparmak ve işaret uçlarının ortası: tutma noktası */
  pinchPt: P;
  /** Uçlar arası mesafe / el büyüklüğü (0 = birleşik) */
  pinch: number;
  /** [başparmak, işaret, orta, yüzük, serçe] açık mı */
  fingers: [boolean, boolean, boolean, boolean, boolean];
  gesture: Gesture;
}

const d = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Parmak açık mı: ucun bileğe uzaklığı orta ekleminkinden ve kökünden belirgin büyükse (elin dönüşünden bağımsız). */
const extended = (p: P[], mcp: number, pip: number, tip: number): boolean => {
  const w = p[0];
  return d(p[tip], w) > d(p[pip], w) * 1.1 && d(p[tip], w) > d(p[mcp], w) * 1.2;
};

export function analyze(p: P[]): HandShape {
  const size = Math.max(1, d(p[0], p[9]));
  const palm: P = {
    x: (p[0].x + p[5].x + p[9].x + p[13].x + p[17].x) / 5,
    y: (p[0].y + p[5].y + p[9].y + p[13].y + p[17].y) / 5,
  };
  const idx = extended(p, 5, 6, 8), midF = extended(p, 9, 10, 12), ring = extended(p, 13, 14, 16), pinky = extended(p, 17, 18, 20);
  const thumb = d(p[4], p[17]) > d(p[3], p[17]) * 1.08 && d(p[4], p[5]) > size * 0.42;
  const pinch = d(p[4], p[8]) / size;
  const fingers: HandShape['fingers'] = [thumb, idx, midF, ring, pinky];

  let gesture: Gesture = 'diger';
  // Çimdik: uçlar birleşik ve işaret ucu avuca kıvrılmamış (yumrukta başparmak işaretin üstüne yatar, bu çimdik sayılmaz)
  const pinching = pinch < 0.42 && d(p[8], p[0]) > size * 0.9;
  if (pinching) gesture = 'cimdik';
  else if (idx && midF && ring && pinky) gesture = 'acik';
  else if (idx && midF && !ring && !pinky) gesture = 'zafer';
  else if (idx && !midF && !ring && !pinky) gesture = 'isaret';
  else if (!idx && !midF && !ring && !pinky) gesture = 'yumruk';

  return { size, palm, tip: p[8], pinchPt: mid(p[4], p[8]), pinch, fingers, gesture };
}

// ------------------------------------------------------------------ One Euro süzgeci (Casiez ve ark.)
// Yavaş harekette titremeyi alır, hızlıda gecikme yapmaz: imleç "parmağa bağlı" hissi verir.

class LowPass { y: number | null = null; run(x: number, a: number) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; } }
const alpha = (cutoff: number, dt: number) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private minCutoff: number; private beta: number; private dCutoff: number;
  constructor(minCutoff = 1.4, beta = 0.012, dCutoff = 1.0) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; }
  filter(v: number, dt: number) {
    if (!(dt > 0)) dt = 1 / 60;
    const prev = this.x.y;
    const dv = prev === null ? 0 : (v - prev) / dt;
    const edv = this.dx.run(dv, alpha(this.dCutoff, dt));
    return this.x.run(v, alpha(this.minCutoff + this.beta * Math.abs(edv), dt));
  }
}

// ------------------------------------------------------------------ Takip edilen el

export interface HandEvents { pinchDown: boolean; pinchUp: boolean; gestureChanged: boolean }

// Çimdik girişi ve çıkışı farklı eşiklerde (histerezis): parmaklar eşikte titreşirken tutma sürekli kopmasın.
const PINCH_ON = 0.38, PINCH_OFF = 0.58;

export class TrackedHand {
  pts: P[] = [];
  shape!: HandShape;
  /** Kararlı jest: yeni jest birkaç kare üst üste görülünce değişir */
  gesture: Gesture = 'diger';
  gestureSince = 0;
  pinching = false;
  pinchSince = 0;
  /** Çimdik başladığındaki avuç konumu: "hızlı dokunuş mu, sürükleme mi" ayrımı için */
  pinchStartPalm: P = { x: 0, y: 0 };
  vel: P = { x: 0, y: 0 };
  lastSeen = 0;
  /** Son birkaç imleç konumu (iz çizimi için) */
  trail: P[] = [];
  private cand: Gesture = 'diger';
  private candN = 0;
  private offN = 0;
  private filters: OneEuro[] = [];
  private prevPalm: P | null = null;
  id: number;
  constructor(id: number) { this.id = id; }

  update(raw: P[], now: number, dt: number): HandEvents {
    if (!this.filters.length) this.filters = Array.from({ length: raw.length * 2 }, () => new OneEuro());
    this.pts = raw.map((q, i) => ({ x: this.filters[i * 2].filter(q.x, dt), y: this.filters[i * 2 + 1].filter(q.y, dt), z: q.z }));
    this.shape = analyze(this.pts);
    const pp = this.shape.palm;
    if (this.prevPalm && dt > 0) {
      const k = 0.35;
      this.vel = { x: this.vel.x * (1 - k) + ((pp.x - this.prevPalm.x) / dt) * k, y: this.vel.y * (1 - k) + ((pp.y - this.prevPalm.y) / dt) * k };
    }
    this.prevPalm = pp;
    this.lastSeen = now;
    this.trail.push({ x: this.shape.tip.x, y: this.shape.tip.y });
    if (this.trail.length > 14) this.trail.shift();

    const ev: HandEvents = { pinchDown: false, pinchUp: false, gestureChanged: false };
    // Çimdik: kapanırken hemen (2 kare), açılırken 2 kare üst üste eşik aşılırsa bırak
    if (!this.pinching) {
      if (this.shape.pinch < PINCH_ON && this.shape.gesture === 'cimdik') { this.offN++; if (this.offN >= 1) { this.pinching = true; this.pinchSince = now; this.pinchStartPalm = { ...pp }; this.offN = 0; ev.pinchDown = true; } }
      else this.offN = 0;
    } else if (this.shape.pinch > PINCH_OFF) { this.offN++; if (this.offN >= 2) { this.pinching = false; this.offN = 0; ev.pinchUp = true; } }
    else this.offN = 0;

    const g = this.shape.gesture;
    if (g === this.cand) this.candN++; else { this.cand = g; this.candN = 1; }
    if (this.cand !== this.gesture && this.candN >= (this.gesture === 'diger' ? 2 : 3)) {
      this.gesture = this.cand; this.gestureSince = now; ev.gestureChanged = true;
    }
    return ev;
  }
}

/** En çok 2 el. MediaPipe'ın el sırası kareler arasında değişebilir; her algılama, avucu en yakın olan eski ele bağlanır. */
export class HandBank {
  hands: TrackedHand[] = [];
  private nextId = 1;
  private maxJump: number; private lostMs: number;
  constructor(maxJump = 260, lostMs = 300) { this.maxJump = maxJump; this.lostMs = lostMs; }

  update(rawHands: P[][], now: number, dt: number): { hand: TrackedHand; ev: HandEvents }[] {
    const palmOf = (pts: P[]): P => ({ x: (pts[0].x + pts[9].x) / 2, y: (pts[0].y + pts[9].y) / 2 });
    const used = new Array(rawHands.length).fill(false);
    const out: { hand: TrackedHand; ev: HandEvents }[] = [];
    for (const h of this.hands) {
      let best = -1, bd = Infinity;
      const last = h.shape ? h.shape.palm : { x: 0, y: 0 };
      rawHands.forEach((r, i) => { if (used[i]) return; const dd = d(palmOf(r), last); if (dd < bd) { bd = dd; best = i; } });
      if (best >= 0 && bd < this.maxJump) { used[best] = true; out.push({ hand: h, ev: h.update(rawHands[best], now, dt) }); }
    }
    rawHands.forEach((r, i) => {
      if (used[i] || this.hands.length + out.filter(o => !this.hands.includes(o.hand)).length >= 2) return;
      const h = new TrackedHand(this.nextId++);
      out.push({ hand: h, ev: h.update(r, now, dt) });
    });
    // Bu karede görünmeyenler kısa süre tutulur (tek kare kaybı el durumunu sıfırlamasın), sonra bırakılır
    const alive = new Set(out.map(o => o.hand));
    this.hands = [...this.hands.filter(h => alive.has(h) || now - h.lastSeen < this.lostMs), ...out.map(o => o.hand).filter(h => !this.hands.includes(h))];
    return out;
  }
}
