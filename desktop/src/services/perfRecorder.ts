// Performans kaydı: kullanıcı "Başlat" der, uygulamayı normal kullanır, "Durdur ve kaydet" der; takılmalar
// (ana iş parçacığı kilitlenmeleri, yavaş girdi olayları, yavaş bileşen çizimleri, yavaş kasa taramaları)
// zaman damgalı bir Markdown raporuna yazılır. Kayıt kapalıyken hiçbir gözlemci/dinleyici çalışmaz ve
// span/renderDone çağrıları neredeyse bedavadır.

type Entry = {
  t: number;            // kayıt başlangıcından beri ms
  kind: string;
  ms: number;
  trigger: string;      // takılmadan hemen önceki son kullanıcı eylemi
  detail: string;
};

const TRIGGER_WINDOW_MS = 800;

let recording = false;
let startedAtPerf = 0;
let startedAtWall = 0;
let entries: Entry[] = [];
let meta: Record<string, string> = {};
let observers: PerformanceObserver[] = [];
let lastAction: { type: string; at: number } | null = null;
let actionListeners: Array<[string, EventListener]> = [];
let profilerStarted: Promise<boolean> | null = null;

const triggerFor = (eventTime: number): string => {
  if (!lastAction) return '-';
  const dt = eventTime - lastAction.at;
  if (dt < 0 || dt > TRIGGER_WINDOW_MS) return '-';
  return `${lastAction.type} (${Math.round(dt)} ms önce)`;
};

const push = (kind: string, atPerf: number, ms: number, detail: string) => {
  if (entries.length >= 3000) return;
  entries.push({
    t: Math.round(atPerf - startedAtPerf),
    kind,
    ms: Math.round(ms),
    trigger: triggerFor(atPerf),
    detail
  });
};

const observe = (type: string, opts: PerformanceObserverInit, cb: (e: any) => void) => {
  try {
    if (!(PerformanceObserver as any).supportedEntryTypes?.includes(type)) return;
    const o = new PerformanceObserver(list => list.getEntries().forEach(cb));
    o.observe({ type, ...opts } as any);
    observers.push(o);
  } catch { /* bu WebView'da desteklenmiyor */ }
};

export const perfRecorder = {
  isRecording: () => recording,

  start(info: Record<string, string> = {}) {
    if (recording) return;
    recording = true;
    entries = [];
    meta = info;
    startedAtPerf = performance.now();
    startedAtWall = Date.now();
    lastAction = null;

    // Masaüstünde (Electron) fonksiyon bazlı CPU profilini de başlat: "hangi fonksiyon kilitledi" sorusunu yanıtlar.
    try {
      const el = (window as any).electron;
      profilerStarted = el?.perfProfilerStart
        ? el.perfProfilerStart().then((r: any) => !!r?.success).catch(() => false)
        : null;
    } catch { profilerStarted = null; }

    // Son kullanıcı eylemini izle (hangi eylemden sonra takılma olduğunu eşleştirmek için)
    const mark = (type: string) => () => { lastAction = { type, at: performance.now() }; };
    const bind = (name: string, label: string) => {
      const fn = mark(label) as EventListener;
      window.addEventListener(name, fn, { capture: true, passive: true });
      actionListeners.push([name, fn]);
    };
    bind('keydown', 'tuş');
    bind('paste', 'yapıştır');
    bind('scroll', 'kaydırma');
    bind('wheel', 'kaydırma');
    bind('pointerdown', 'tıklama');

    observe('longtask', {}, e => {
      if (e.duration < 50) return;
      push('Ana iş parçacığı kilitlendi', e.startTime, e.duration, '');
    });
    observe('long-animation-frame', {}, e => {
      if (e.duration < 100) return;
      const scripts = (e.scripts || []).slice(0, 4).map((s: any) =>
        `${Math.round(s.duration)}ms ${s.invoker || s.sourceFunctionName || ''} ${String(s.sourceURL || '').split('/').pop()}:${s.sourceCharPosition ?? ''}` +
        (s.forcedStyleAndLayoutDuration > 20 ? ` (zorunlu yerleşim ${Math.round(s.forcedStyleAndLayoutDuration)}ms)` : '')
      ).join(' ; ');
      push('Yavaş kare', e.startTime, e.duration, scripts);
    });
    observe('event', { durationThreshold: 80 } as any, e => {
      const tgt = e.target ? `${(e.target as Element).tagName || ''}` : '';
      push('Yavaş girdi olayı', e.startTime, e.duration,
        `${e.name} → ${tgt}; işlenmeden önce bekleme ${Math.round(e.processingStart - e.startTime)}ms`);
    });
  },

  // Bir kod bölümünün süresini kaydet (async fonksiyonlarda bekleme dahil duvar-saati süresi).
  span(label: string, thresholdMs = 100) {
    if (!recording) return () => {};
    const s = performance.now();
    return (detail = '') => {
      const d = performance.now() - s;
      if (recording && d >= thresholdMs) push(`Yavaş iş: ${label}`, s, d, detail);
    };
  },

  // Bir bileşenin render+commit süresi (render başında alınan performance.now() ile, layout efektinde çağrılır).
  renderDone(label: string, renderStartedAt: number, detail = '', thresholdMs = 30) {
    if (!recording) return;
    const d = performance.now() - renderStartedAt;
    if (d >= thresholdMs) push(`Yavaş çizim: ${label}`, renderStartedAt, d, detail);
  },

  async stop(): Promise<string> {
    if (!recording) return '';
    recording = false;
    observers.forEach(o => { try { o.disconnect(); } catch { /* yoksay */ } });
    observers = [];
    actionListeners.forEach(([n, f]) => window.removeEventListener(n, f, { capture: true } as EventListenerOptions));
    actionListeners = [];

    // Profili topla (varsa)
    let profile: any = null;
    let profileNote = '';
    try {
      const el = (window as any).electron;
      if (profilerStarted && el?.perfProfilerStop) {
        const ok = await profilerStarted;
        if (ok) {
          profile = await Promise.race([
            el.perfProfilerStop(),
            new Promise(res => setTimeout(() => res({ success: false, error: 'profil zaman aşımı' }), 20000))
          ]);
          if (!profile?.success) { profileNote = `Profil alınamadı: ${profile?.error || '?'}`; profile = null; }
        } else {
          profileNote = 'Profilleyici başlatılamadı.';
        }
      }
    } catch (e) { profileNote = `Profil hatası: ${String(e)}`; }
    profilerStarted = null;

    const durSec = Math.round((performance.now() - startedAtPerf) / 1000);
    const blocked = entries.filter(e => e.kind.startsWith('Ana iş')).reduce((a, e) => a + e.ms, 0);
    const worst = (prefix: string) => entries.filter(e => e.kind.startsWith(prefix)).sort((a, b) => b.ms - a.ms)[0];
    const count = (prefix: string) => entries.filter(e => e.kind.startsWith(prefix)).length;

    const byTrigger: Record<string, { n: number; ms: number }> = {};
    entries.filter(e => e.kind.startsWith('Ana iş')).forEach(e => {
      const k = e.trigger === '-' ? 'eylem yok (arka plan işi)' : e.trigger.split(' (')[0];
      byTrigger[k] = byTrigger[k] || { n: 0, ms: 0 };
      byTrigger[k].n++; byTrigger[k].ms += e.ms;
    });

    const fmtWorst = (e?: Entry) => e ? `${e.ms} ms (${e.kind}${e.detail ? ' — ' + e.detail : ''})` : 'yok';
    const L: string[] = [];
    L.push('# Performans kaydı');
    L.push('');
    L.push(`- Başlangıç: ${new Date(startedAtWall).toLocaleString('tr-TR')}`);
    L.push(`- Süre: ${durSec} sn`);
    Object.entries(meta).forEach(([k, v]) => L.push(`- ${k}: ${v}`));
    L.push(`- Tarayıcı: ${navigator.userAgent}`);
    L.push('');
    L.push('## Özet');
    L.push(`- Ana iş parçacığı kilitlenmesi: ${count('Ana iş')} kez, toplam ${blocked} ms; en kötüsü ${fmtWorst(worst('Ana iş'))}`);
    L.push(`- Yavaş girdi olayı (tuş/tıklama/yapıştırma): ${count('Yavaş girdi')} kez; en kötüsü ${fmtWorst(worst('Yavaş girdi'))}`);
    L.push(`- Yavaş çizim: ${count('Yavaş çizim')} kez; en kötüsü ${fmtWorst(worst('Yavaş çizim'))}`);
    L.push(`- Yavaş iş (tarama/kayıt): ${count('Yavaş iş')} kez; en kötüsü ${fmtWorst(worst('Yavaş iş'))}`);
    L.push('');
    L.push('## Kilitlenmeler hangi eylemden sonra oldu');
    const rows = Object.entries(byTrigger).sort((a, b) => b[1].ms - a[1].ms);
    if (rows.length === 0) L.push('- (kilitlenme kaydı yok)');
    rows.forEach(([k, v]) => L.push(`- ${k}: ${v.n} kez, toplam ${v.ms} ms`));
    L.push('');
    if (profile) {
      L.push(`## CPU profili (Electron) — toplam ${profile.totalMs} ms örneklendi, ${profile.idleMs} ms boşta`);
      L.push('');
      L.push('### Fonksiyon toplam süresi (kendisi + çağırdıkları) — en çok vakit alan iş burada görünür');
      (profile.incl || []).forEach((f: any) => L.push(`- ${f.ms} ms — ${f.name}`));
      L.push('');
      L.push('### Fonksiyonun kendi süresi (çağırdıkları hariç)');
      (profile.self || []).forEach((f: any) => L.push(`- ${f.ms} ms — ${f.name}`));
      L.push('');
    } else if (profileNote) {
      L.push(`## CPU profili`);
      L.push(`- ${profileNote}`);
      L.push('');
    }
    L.push('## Zaman çizelgesi');
    L.push('');
    L.push('| sn | tür | ms | önceki eylem | ayrıntı |');
    L.push('|---:|---|---:|---|---|');
    entries.sort((a, b) => a.t - b.t).slice(0, 400).forEach(e => {
      L.push(`| ${(e.t / 1000).toFixed(1)} | ${e.kind} | ${e.ms} | ${e.trigger} | ${String(e.detail).replace(/\|/g, '/').slice(0, 220)} |`);
    });
    if (entries.length > 400) L.push(`\n(${entries.length - 400} kayıt daha var, kısaltıldı)`);
    L.push('');
    return L.join('\n');
  }
};
