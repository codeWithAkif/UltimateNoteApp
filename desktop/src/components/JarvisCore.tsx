import React, { useEffect, useRef } from 'react';

// Asistanın "çekirdeği": ne yaptığını görsel olarak gösteren canlı HUD animasyonu.
//  boşta      → yavaş dönen halkalar, nefes alan çekirdek
//  dinliyor   → ses seviyesiyle genişleyen halka ve dışa yayılan dalgalar
//  düşünüyor  → hızlı dönen tarama yayları, yörüngede noktalar
//  konuşuyor  → çevresinde ses çubukları (seviye çalan sesten ya da yapay zarf)
//  işlem yapıyor → tarama çizgisi, dönen kilit köşeleri (sayfadaki düğmelere basarken)
export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting';

const HUE: Record<CoreState, number> = { idle: 195, listening: 162, thinking: 268, speaking: 48, acting: 22 };
const LABEL: Record<CoreState, string> = { idle: 'Hazır', listening: 'Dinliyor', thinking: 'Düşünüyor', speaking: 'Konuşuyor', acting: 'İşlem yapıyor' };

export default function JarvisCore({ state, size = 120, level }: { state: CoreState; size?: number; level?: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const levelRef = useRef(level); levelRef.current = level;

  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2, R = size / 2;
    let raf = 0, hue = HUE[stateRef.current], lv = 0, a1 = 0, a2 = 0, a3 = 0, sweep = 0, lastRipple = 0;
    const ripples: { r: number; a: number }[] = [];
    const start = performance.now();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = (now - start) / 1000, st = stateRef.current;
      // renk yumuşakça yeni duruma geçer
      const th = HUE[st]; let dh = th - hue; if (dh > 180) dh -= 360; if (dh < -180) dh += 360; hue += dh * 0.08;
      // seviye: gerçek (mikrofon/ses) varsa o, yoksa duruma uygun yapay zarf
      let target = 0.1 + 0.05 * Math.sin(t * 1.6);
      const real = levelRef.current?.();
      if (real !== undefined && real !== null && (st === 'listening' || st === 'speaking')) target = Math.max(0.05, real);
      else if (st === 'speaking') target = Math.max(0.08, 0.42 + 0.3 * Math.sin(t * 7.1) + 0.18 * Math.sin(t * 13.3 + 1) + 0.1 * Math.sin(t * 23));
      else if (st === 'listening') target = 0.18 + 0.1 * Math.sin(t * 2.4);
      else if (st === 'thinking') target = 0.3 + 0.08 * Math.sin(t * 5);
      else if (st === 'acting') target = 0.35 + 0.1 * Math.sin(t * 6);
      lv += (target - lv) * 0.25;
      const spd = reduce ? 0.2 : st === 'thinking' ? 2.4 : st === 'acting' ? 1.6 : st === 'speaking' ? 1 : 0.5;
      a1 += 0.012 * spd; a2 -= 0.018 * spd; a3 += 0.007 * spd; sweep += 0.07 * (st === 'thinking' ? 1 : 0.35);

      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'lighter';
      const col = (l: number, a: number) => `hsla(${hue},100%,${l}%,${a})`;

      // dış parıltı ve çekirdek
      const g = ctx.createRadialGradient(c, c, 0, c, c, R * 0.7);
      g.addColorStop(0, col(70, 0.55 + lv * 0.4)); g.addColorStop(0.45, col(55, 0.18 + lv * 0.18)); g.addColorStop(1, col(50, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, R * 0.7, 0, 7); ctx.fill();
      ctx.fillStyle = col(85, 0.9); ctx.beginPath(); ctx.arc(c, c, R * (0.13 + lv * 0.09), 0, 7); ctx.fill();

      // dışa yayılan dalgalar (dinlerken ses yükseldikçe)
      if (st === 'listening' && lv > 0.22 && now - lastRipple > 330) { ripples.push({ r: R * 0.3, a: 0.6 }); lastRipple = now; }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]; rp.r += R * 0.018; rp.a -= 0.012;
        if (rp.a <= 0 || rp.r > R * 0.98) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = col(65, rp.a); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c, c, rp.r, 0, 7); ctx.stroke();
      }

      // halka A: kesik çizgili, ses seviyesiyle nefes alır
      ctx.lineWidth = Math.max(1, size / 70); ctx.strokeStyle = col(68, 0.85);
      ctx.setLineDash([R * 0.09, R * 0.06]); ctx.lineDashOffset = -a1 * R;
      ctx.beginPath(); ctx.arc(c, c, R * (0.4 + (st === 'listening' ? lv * 0.14 : 0)), a1, a1 + 7); ctx.stroke(); ctx.setLineDash([]);
      // halka B: üç yay, ters yönde
      ctx.strokeStyle = col(62, 0.75); ctx.lineWidth = Math.max(1.4, size / 52);
      for (let i = 0; i < 3; i++) { const s = a2 + (i * Math.PI * 2) / 3; ctx.beginPath(); ctx.arc(c, c, R * 0.56, s, s + Math.PI * 0.42); ctx.stroke(); }
      // halka C: ince çember ve gösterge çentikleri
      ctx.strokeStyle = col(60, 0.28); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c, c, R * 0.76, 0, 7); ctx.stroke();
      ctx.strokeStyle = col(70, 0.5);
      for (let i = 0; i < 36; i++) { const a = a3 + (i * Math.PI) / 18, long = i % 3 === 0, r0 = R * 0.76, r1 = R * (long ? 0.84 : 0.8); ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); ctx.stroke(); }

      if (st === 'thinking') {
        // tarama yayı + yörünge noktaları
        for (let k = 0; k < 24; k++) { const a = sweep - k * 0.045; ctx.strokeStyle = col(70, 0.55 * (1 - k / 24)); ctx.lineWidth = Math.max(1.5, size / 40); ctx.beginPath(); ctx.arc(c, c, R * 0.66, a - 0.05, a); ctx.stroke(); }
        for (let i = 0; i < 6; i++) { const a = -sweep * 1.3 + (i * Math.PI * 2) / 6, rr = R * (0.5 + 0.06 * Math.sin(t * 3 + i)); ctx.fillStyle = col(80, 0.9); ctx.beginPath(); ctx.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, Math.max(1.2, size / 70), 0, 7); ctx.fill(); }
      }
      if (st === 'speaking') {
        // çevrede ses çubukları
        const N = 56;
        ctx.lineWidth = Math.max(1.5, size / 60); ctx.lineCap = 'round';
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 - Math.PI / 2;
          const n = 0.5 + 0.5 * Math.sin(t * 9 + i * 0.9) * Math.sin(t * 5.3 + i * 0.37);
          const len = R * (0.04 + 0.2 * lv * (0.35 + n));
          const r0 = R * 0.62; ctx.strokeStyle = col(66, 0.85);
          ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); ctx.lineTo(c + Math.cos(a) * (r0 + len), c + Math.sin(a) * (r0 + len)); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      if (st === 'acting') {
        // yatay tarama çizgisi (daire içinde) + dönen kilit köşeleri
        const y = c + Math.sin(t * 2.6) * R * 0.52, half = Math.sqrt(Math.max(0, (R * 0.52) ** 2 - (y - c) ** 2));
        ctx.strokeStyle = col(75, 0.95); ctx.lineWidth = Math.max(1.5, size / 60); ctx.beginPath(); ctx.moveTo(c - half, y); ctx.lineTo(c + half, y); ctx.stroke();
        ctx.strokeStyle = col(70, 0.9); ctx.lineWidth = Math.max(1.5, size / 50);
        const ba = t * 1.1;
        for (let i = 0; i < 4; i++) { const a = ba + (i * Math.PI) / 2, rr = R * 0.9, w = 0.17; ctx.beginPath(); ctx.arc(c, c, rr, a - w, a + w); ctx.stroke(); }
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <span role="img" aria-label={`Asistan: ${LABEL[state]}`} style={{ display: 'inline-block', width: size, height: size, lineHeight: 0, flex: 'none' }}>
      <canvas ref={ref} aria-hidden="true" style={{ width: size, height: size }} />
    </span>
  );
}
