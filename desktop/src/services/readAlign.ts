// "Tümünü dinle" sırasında okunan cümleyi renklendirmek için: TEK parça ses kaydında her cümlenin başladığı anı bulur.
// TTS bize cümle zamanlarını vermiyor; bu yüzden (1) metin uzunluğundan beklenen sınırlar tahmin edilir, (2) bu tahminler sesteki gerçek
// sessizlik boşluklarına (cümle/konuşmacı değişimlerinde oluşan duraklar) yaslanır. Saf işlevler, ağ ve ses API'si yok.

export interface AlignResult { starts: number[]; ends: number[]; duration: number } // saniye

// Bir cümlenin konuşulma süresiyle orantılı ağırlığı: harfler + noktalama duraklamaları.
export const turnWeight = (t: string): number => {
  const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  const strong = (t.match(/[.!?…。！？]/g) || []).length;
  const soft = (t.match(/[,;:、，；：]/g) || []).length;
  return Math.max(1, letters + strong * 4 + soft * 1.5);
};

// Ses çözülemezse: yalnızca metin ağırlıklarına göre orantılı başlangıçlar.
export const proportionalStarts = (texts: string[], duration: number): AlignResult => {
  const w = texts.map(turnWeight);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const starts: number[] = [];
  let acc = 0;
  w.forEach(x => { starts.push((acc / total) * duration); acc += x; });
  const ends = starts.map((_, i) => (i + 1 < starts.length ? starts[i + 1] : duration));
  return { starts, ends, duration };
};

interface Silence { start: number; end: number; mid: number; dur: number }

export const alignTurns = (samples: Float32Array, sampleRate: number, texts: string[]): AlignResult => {
  const duration = samples.length / sampleRate;
  const n = texts.length;
  if (n <= 1 || samples.length < sampleRate * 0.2) return proportionalStarts(texts, duration);

  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  const frames = Math.floor(samples.length / frame);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const o = f * frame;
    for (let i = 0; i < frame; i++) { const v = samples[o + i]; s += v * v; }
    rms[f] = Math.sqrt(s / frame);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 0;
  if (peak < 1e-4) return proportionalStarts(texts, duration);
  const thr = peak * 0.1;
  const fs = frame / sampleRate;

  let first = 0, last = frames - 1;
  while (first < frames && rms[first] < thr) first++;
  while (last > first && rms[last] < thr) last--;
  const activeStart = first * fs;
  const activeEnd = (last + 1) * fs;
  const D = Math.max(0.01, activeEnd - activeStart);

  // İç sessizlikler (en az 120 ms).
  const minRun = 6;
  const sil: Silence[] = [];
  let runStart = -1;
  for (let f = first; f <= last + 1; f++) {
    const quiet = f <= last && rms[f] < thr;
    if (quiet && runStart < 0) runStart = f;
    if (!quiet && runStart >= 0) {
      if (f - runStart >= minRun) { const s = runStart * fs, e = f * fs; sil.push({ start: s, end: e, mid: (s + e) / 2, dur: e - s }); }
      runStart = -1;
    }
  }

  const w = texts.map(turnWeight);
  const W = w.reduce((a, b) => a + b, 0) || 1;
  const win = Math.max(0.35, 0.45 * (D / n));
  const starts: number[] = [0];
  let acc = 0;
  let prev = activeStart;
  for (let k = 1; k < n; k++) {
    acc += w[k - 1];
    const expected = activeStart + D * (acc / W);
    let best: Silence | null = null, bestScore = -Infinity;
    for (const s of sil) {
      if (s.mid <= prev + 0.15 || Math.abs(s.mid - expected) > win) continue;
      const score = s.dur - 0.6 * Math.abs(s.mid - expected);
      if (score > bestScore) { best = s; bestScore = score; }
    }
    let b = best ? best.mid : expected;
    b = Math.min(Math.max(b, prev + 0.15), Math.max(activeEnd - 0.05 * (n - k), prev + 0.15));
    starts.push(b);
    prev = b;
  }
  const ends = starts.map((_, i) => (i + 1 < n ? starts[i + 1] : duration));
  return { starts, ends, duration };
};

// Çalma anına karşılık gelen cümle (çalmadan önce/sonrası için -1).
export const sentenceAt = (starts: number[], t: number): number => {
  if (starts.length === 0 || t < 0) return -1;
  let lo = 0, hi = starts.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
};
