import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { HandBank, type P, type TrackedHand, GESTURE_LABEL } from '../services/hands/gestures';
import { openCamera, loadLandmarker, landmarkerReady, detect } from '../services/hands/tracker';
import JarvisCore from './JarvisCore';
import { speak, startRecording, transcribe, canTranscribe, type Speaking, type Recording } from '../services/assistant/voice';
import type { BriefScene } from '../services/assistant/dayBriefing';

// "Jarvis masası": kamerayla elinizi izler; uygulamadaki gerçek ekranlar (küreler) ve bugünün işleri (kartlar) havada durur.
// Çimdikle tutup sürüklersiniz, hızlı çimdikle açarsınız, savurursunuz. Fare de aynı şekilde çalışır (kamerası olmayanlar için).
// Hiçbir şey kendiliğinden yapılmaz: yalnızca ekran açılır. Silme/gönderme gibi işlem bu katmanda yoktur.

export interface DeskCard { id: string; kind: 'orb' | 'task'; title: string; sub?: string; hue: number; screen?: string; action?: 'briefing' | 'mic' }

interface RCard { c: DeskCard; x: number; y: number; w: number; h: number; vx: number; vy: number; scale: number; hover: number; heldBy: string | null; el: HTMLDivElement | null }
interface Ptr { dwellCard?: RCard | null; dwellSince?: number; dwellDone?: boolean; id: string; x: number; y: number; down: boolean; downAt: number; sx: number; sy: number; moved: number; hist: { x: number; y: number; t: number }[]; hand?: TrackedHand; pinch: number; seen: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; hue: number }

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const CSS = `
.holo-root{position:fixed;inset:0;z-index:2147483000;background:#02080f;color:#d7f3ff;font-family:'Inter','Segoe UI',system-ui,sans-serif;overflow:hidden;touch-action:none;cursor:none;user-select:none}
.holo-root video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);opacity:.32;filter:saturate(.6) contrast(1.1)}
.holo-scrim{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(2,18,32,.35),rgba(2,8,15,.82));pointer-events:none}
.holo-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(0,200,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,200,255,.06) 1px,transparent 1px);background-size:56px 56px;pointer-events:none}
.holo-card{position:absolute;left:0;top:0;will-change:transform;pointer-events:none;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;text-align:center;background:rgba(6,28,44,.58);border:1px solid hsla(var(--h),100%,62%,.55);box-shadow:0 0 18px hsla(var(--h),100%,55%,.22),inset 0 0 22px hsla(var(--h),100%,55%,.1);color:#e8fbff}
.holo-card.orb{border-radius:50%;align-items:center;padding:6px}
.holo-card.task{border-radius:12px;text-align:left;padding:10px 14px}
.holo-card.hover{border-color:hsla(var(--h),100%,75%,1);box-shadow:0 0 34px hsla(var(--h),100%,60%,.6),inset 0 0 26px hsla(var(--h),100%,60%,.22)}
.holo-card.held{box-shadow:0 0 52px hsla(var(--h),100%,65%,.85),inset 0 0 30px hsla(var(--h),100%,60%,.3)}
.holo-card .t{font-size:13px;font-weight:500;line-height:1.25;overflow-wrap:anywhere}
.holo-card .s{font-size:11px;opacity:.7;margin-top:2px}
.holo-card.orb .t{font-size:12px}
.holo-ui{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:12px 160px 12px 16px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7fdcff;pointer-events:none}
.holo-x.on{background:rgba(0,120,160,.7);border-color:#7fe6ff}.holo-x{pointer-events:auto;cursor:pointer;margin-left:auto;background:rgba(0,40,60,.6);border:1px solid rgba(0,200,255,.4);color:#bfeeff;border-radius:8px;padding:6px 9px;display:inline-flex}
.holo-root.briefing .holo-card{opacity:.1;transition:opacity .4s}.holo-card{transition:opacity .4s}.holo-brief{position:absolute;left:50%;top:62%;transform:translate(-50%,-50%);width:min(560px,86vw);padding:28px 34px;border-radius:18px;background:rgba(4,22,36,.82);border:1px solid rgba(0,200,255,.55);box-shadow:0 0 60px rgba(0,190,255,.28),inset 0 0 40px rgba(0,190,255,.1);backdrop-filter:blur(10px);text-align:center;pointer-events:none}
.holo-brief .bt{font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#7fdcff}
.holo-brief .big{font-size:88px;line-height:1.05;font-weight:500;color:#e8fbff;text-shadow:0 0 28px rgba(0,200,255,.8);margin:6px 0 0;font-variant-numeric:tabular-nums}
.holo-brief .lab{font-size:15px;color:#9fe3ff;margin-bottom:14px}
.holo-brief ul{list-style:none;margin:0;padding:0;text-align:left;display:flex;flex-direction:column;gap:7px}
.holo-brief li{font-size:14px;padding:7px 12px;border-radius:9px;background:rgba(0,170,255,.09);border-left:2px solid rgba(0,210,255,.7);overflow-wrap:anywhere}
.holo-brief .dots{display:flex;gap:7px;justify-content:center;margin-top:16px}
.holo-brief .dots i{width:7px;height:7px;border-radius:50%;background:rgba(0,200,255,.3)}
.holo-brief .dots i.on{background:#7fe6ff;box-shadow:0 0 10px #7fe6ff}
.holo-root.live{background:transparent;pointer-events:none;cursor:auto}.holo-root.live video{opacity:0;width:2px;height:2px}
.holo-root.live .holo-scrim,.holo-root.live .holo-grid,.holo-root.live .holo-card,.holo-root.live .holo-hint,.holo-root.live .holo-brief,.holo-root.live .holo-core{display:none}
.holo-dock{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:16px;background:rgba(4,22,36,.86);border:1px solid rgba(0,200,255,.5);box-shadow:0 0 30px rgba(0,190,255,.25);pointer-events:auto;max-width:96vw;overflow-x:auto}
.holo-dock button{cursor:pointer;background:rgba(0,120,170,.25);border:1px solid rgba(0,200,255,.4);color:#d7f3ff;border-radius:10px;padding:8px 12px;font-size:12px;white-space:nowrap;font-family:inherit}
.holo-dock button:hover{background:rgba(0,170,230,.45)}
.holo-hint{position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:12px;color:#7fb8cc;pointer-events:none;letter-spacing:.04em}
`;

export default function HoloDesk({ cards, scenes, autoBrief, onNavigate, onAsk, onClose }: { cards: DeskCard[]; scenes: BriefScene[]; autoBrief?: boolean; onNavigate: (id: string) => void; onAsk: (text: string) => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardEls = useRef<(HTMLDivElement | null)[]>([]);
  const [status, setStatus] = useState('Kamera açılıyor…');
  const [camOk, setCamOk] = useState(false);
  // El çizimi (iskelet, iz) varsayılan kapalı: hem karışıklığı hem işlem yükünü azaltır
  const [skel, setSkel] = useState(() => { try { return localStorage.getItem('holo-skel') === '1'; } catch { return false; } });
  // Canlı mod: ekran açılınca masa kapanmaz; şeffaf katman olarak kalır, el gerçek uygulamada tıklar/kaydırır
  const [live, setLive] = useState(false);
  const liveRef = useRef(false); liveRef.current = live;
  const placeRef = useRef<() => void>(() => {});
  const goLive = () => { liveRef.current = true; setLive(true); setStatus('Canlı mod: çimdik = tıkla · çimdikle sürükle = kaydır · alttaki çubuk: ekranlar'); setTimeout(() => setStatus(s => (s.startsWith('Canlı mod') ? '' : s)), 6000); };
  const backDesk = () => { liveRef.current = false; setLive(false); placeRef.current(); };
  const skelRef = useRef(skel); skelRef.current = skel;
  const toggleSkel = () => { const v = !skelRef.current; setSkel(v); try { localStorage.setItem('holo-skel', v ? '1' : '0'); } catch { /* yoksay */ } };
  const cbRef = useRef({ onNavigate, onClose, onAsk }); cbRef.current = { onNavigate, onClose, onAsk };

  // ---- "Günümü anlat" sahneleri: ekranda gösterilir ve sesli okunur; dokunuş sonraki sahneye geçirir, okuma bitince kendiliğinden ilerler
  const [bi, setBi] = useState<number | null>(null);
  const [talking, setTalking] = useState(false); // sahne sesi çalıyor
  const biRef = useRef<number | null>(null);
  const scenesRef = useRef(scenes); scenesRef.current = scenes;
  const speakRef = useRef<Speaking | null>(null);
  const showScene = (i: number | null) => {
    speakRef.current?.stop(); speakRef.current = null; setTalking(false);
    biRef.current = i; setBi(i);
    const sc = i === null ? null : scenesRef.current[i];
    if (i === null || !sc) { biRef.current = null; setBi(null); return; }
    const sp = speak(sc.oku); speakRef.current = sp; setTalking(true);
    void sp.done.then(() => { if (speakRef.current === sp) setTalking(false); if (speakRef.current === sp && biRef.current === i) setTimeout(() => { if (biRef.current === i && speakRef.current === sp) nextScene(); }, 1100); });
  };
  const nextScene = () => { const i = biRef.current; if (i === null) return; showScene(i + 1 >= scenesRef.current.length ? null : i + 1); };

  // ---- bas-konuş: küreye dokun, konuş, tekrar dokun; söylediğiniz yazıya çevrilip Asistan'a gider
  const [mic, setMic] = useState<'idle' | 'rec' | 'busy'>('idle');
  const micRef = useRef<Recording | null>(null);
  const toggleMic = async () => {
    if (micRef.current) {
      setMic('busy'); setStatus('Yazıya çevriliyor…');
      try { const blob = await micRef.current.stop(); micRef.current = null; const text = await transcribe(blob); setStatus(''); setMic('idle'); cbRef.current.onAsk(text); }
      catch (e: any) { micRef.current = null; setMic('idle'); setStatus(String(e?.message || 'Ses işlenemedi.')); }
      return;
    }
    if (!canTranscribe()) { setStatus('Sesli komut için Ayarlar > AI Mentor bölümüne Gemini anahtarı gerekir.'); return; }
    try { micRef.current = await startRecording(); setMic('rec'); setStatus('Dinliyorum… bitince küreye tekrar dokunun.'); }
    catch { setStatus('Mikrofon izni verilmedi.'); }
  };
  const actRef = useRef({ showScene, nextScene, toggleMic }); actRef.current = { showScene, nextScene, toggleMic };
  useEffect(() => {
    if (autoBrief) actRef.current.showScene(0);
    return () => { speakRef.current?.stop(); try { micRef.current?.cancel(); } catch { /* yoksay */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = rootRef.current!, video = videoRef.current!, canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let W = 0, H = 0, raf = 0, alive = true, stream: MediaStream | null = null, lm: import('@mediapipe/tasks-vision').HandLandmarker | null = null;
    let lastDetect = 0, delegate = '', lastVideoTime = -1, fps = 0, lastT = performance.now(), frames = 0, fpsT = performance.now();
    const bank = new HandBank();
    const ptrs = new Map<string, Ptr>();
    const sparks: Spark[] = [];
    let fistSince = 0, peaceDone = false, scale2: { a: string; b: string; d0: number; s0: number; card: RCard } | null = null;

    // ---- yerleşim: küreler solda halka, bugünün işleri sağda sütun
    const rcards: RCard[] = cards.map((c, i) => ({ c, x: 0, y: 0, w: c.kind === 'orb' ? 112 : 250, h: c.kind === 'orb' ? 112 : 74, vx: 0, vy: 0, scale: 1, hover: 0, heldBy: null, el: cardEls.current[i] || null }));
    const place = () => {
      const orbs = rcards.filter(r => r.c.kind === 'orb'), tasks = rcards.filter(r => r.c.kind === 'task');
      const cx = W * (tasks.length ? 0.36 : 0.5), cy = H * 0.52, R = Math.min(W * (tasks.length ? 0.24 : 0.3), H * 0.34);
      orbs.forEach((r, i) => { const a = -Math.PI / 2 + (i / Math.max(1, orbs.length)) * Math.PI * 2; r.x = cx + Math.cos(a) * R; r.y = cy + Math.sin(a) * R; r.vx = r.vy = 0; r.scale = 1; });
      tasks.forEach((r, i) => { r.x = W * 0.78; r.y = H * 0.52 + (i - (tasks.length - 1) / 2) * 92; r.vx = r.vy = 0; r.scale = 1; });
    };
    const burst = (x: number, y: number, hue: number, n = 22) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 5; sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue }); } };
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = root.clientWidth; H = root.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      place();
    };
    placeRef.current = place;
    resize();
    window.addEventListener('resize', resize);

    // ---- hedef bulma
    const hit = (r: RCard, x: number, y: number) => r.c.kind === 'orb'
      ? Math.hypot(x - r.x, y - r.y) < (r.w / 2) * r.scale + 14
      : Math.abs(x - r.x) < (r.w / 2) * r.scale + 10 && Math.abs(y - r.y) < (r.h / 2) * r.scale + 10;
    const cardAt = (x: number, y: number): RCard | null => {
      let best: RCard | null = null, bd = Infinity;
      for (const r of rcards) if (hit(r, x, y)) { const dd = Math.hypot(x - r.x, y - r.y); if (dd < bd) { bd = dd; best = r; } }
      return best;
    };

    // ---- canlı mod: el, katmanın altındaki gerçek uygulamada çalışır (katman pointer-events:none olduğundan elementFromPoint onu atlar)
    const scrollerAt = (x: number, y: number): HTMLElement | null => {
      let el = document.elementFromPoint(x, y) as HTMLElement | null;
      while (el && el !== document.body) { const o = getComputedStyle(el).overflowY; if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el; el = el.parentElement; }
      return null;
    };
    const clickAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null; if (!el) return;
      burst(x, y, 190, 18);
      const t = (el.closest('button,a,input,textarea,select,summary,label,[role="button"],[role="tab"]') as HTMLElement | null) || el;
      try { if (t.matches('input,textarea,[contenteditable="true"]')) t.focus(); t.click(); } catch { /* yoksay */ }
    };

    // ---- işaretçi olayları (el ve fare aynı yoldan)
    const down = (p: Ptr, now: number) => {
      p.down = true; p.downAt = now; p.sx = p.x; p.sy = p.y; p.moved = 0; p.hist = [{ x: p.x, y: p.y, t: now }];
      if (liveRef.current) { (p as any).scroller = scrollerAt(p.x, p.y); (p as any).ly = p.y; return; }
      if (biRef.current !== null) return; // sahne gösterilirken kartlar tutulmaz
      const held = rcards.find(r => r.heldBy && r.heldBy !== p.id && r.heldBy);
      const target = cardAt(p.x, p.y);
      // İkinci çimdik, tutulan kartın üzerinde ya da herhangi bir yerde: iki elle büyüt/küçült
      if (held && !target?.heldBy) {
        const other = ptrs.get(held.heldBy!);
        if (other && other.down) scale2 = { a: other.id, b: p.id, d0: Math.max(40, Math.hypot(other.x - p.x, other.y - p.y)), s0: held.scale, card: held };
        return;
      }
      if (target && !target.heldBy) { target.heldBy = p.id; (target as any).dx = target.x - p.x; (target as any).dy = target.y - p.y; burst(target.x, target.y, target.c.hue, 8); }
    };
    const up = (p: Ptr, now: number) => {
      if (!p.down) return;
      p.down = false;
      if (liveRef.current) { if (now - p.downAt < 800 && p.moved < 40) clickAt(p.x, p.y); return; }
      if (biRef.current !== null) { if (now - p.downAt < 800 && p.moved < 110) actRef.current.nextScene(); return; }
      if (scale2 && (scale2.a === p.id || scale2.b === p.id)) scale2 = null;
      const r = rcards.find(c => c.heldBy === p.id);
      if (!r) return;
      r.heldBy = null;
      const quick = now - p.downAt < 800 && p.moved < 110;
      if (quick) { r.vx = r.vy = 0; burst(r.x, r.y, r.c.hue, 30); open(r); return; }
      const h = p.hist; if (h.length >= 2) {
        const a = h[Math.max(0, h.length - 5)], b = h[h.length - 1], dt = Math.max(16, b.t - a.t);
        const k = 16 * 0.8; r.vx = clamp(((b.x - a.x) / dt) * k, -34, 34); r.vy = clamp(((b.y - a.y) / dt) * k, -34, 34); // savurma hızı sınırlı: kart ekran dışına fırlamasın
      }
    };
    const open = (r: RCard) => {
      if (r.c.action === 'briefing') { actRef.current.showScene(0); return; }
      if (r.c.action === 'mic') { void actRef.current.toggleMic(); return; }
      if (r.c.kind === 'orb' && r.c.screen) cbRef.current.onNavigate(r.c.screen);
      else if (r.c.kind === 'task') cbRef.current.onNavigate('calendar');
      goLive();
    };

    // ---- fare
    const mouse: Ptr = { id: 'mouse', x: -999, y: -999, down: false, downAt: 0, sx: 0, sy: 0, moved: 0, hist: [], pinch: 0.1, seen: 0 };
    ptrs.set('mouse', mouse);
    const pm = (e: PointerEvent) => { const b = root.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; mouse.seen = performance.now(); };
    const pd = (e: PointerEvent) => { pm(e); if ((e.target as HTMLElement).closest('.holo-x')) return; down(mouse, performance.now()); };
    const pu = (e: PointerEvent) => { pm(e); up(mouse, performance.now()); };
    root.addEventListener('pointermove', pm); root.addEventListener('pointerdown', pd); root.addEventListener('pointerup', pu);
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (biRef.current !== null) actRef.current.showScene(null); else cbRef.current.onClose(); };
    window.addEventListener('keydown', key);

    // ---- kamera ve model
    (async () => {
      try {
        setStatus('Kamera açılıyor…');
        stream = await openCamera(video);
        if (!alive) return;
        if (!landmarkerReady()) setStatus('El takip modeli yükleniyor…');
        const r = await loadLandmarker();
        if (!alive) { r.lm.close(); return; }
        lm = r.lm; delegate = r.delegate; setCamOk(true); setStatus('');
      } catch (e: any) {
        const name = String(e?.name || '');
        setStatus(name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Kamera izni verilmedi. Fare ile de kullanabilirsiniz; el kontrolü için kamera iznini açın.'
          : name === 'NotFoundError' ? 'Kamera bulunamadı. Fare ile kullanabilirsiniz.' : `El takibi başlatılamadı (${e?.message || name}). Fare ile kullanabilirsiniz.`);
      }
    })();

    // ---- ana döngü
    const handHue = 190;
    const loop = (tms: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      frames++; if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; }

      // el algılama (yalnızca yeni video karesinde)
      if (lm && video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetect >= 30) {
        lastVideoTime = video.currentTime; lastDetect = now;
        let raws: P[][] = [];
        try { raws = detect(lm, video, now, W, H); } catch { raws = []; }
        const res = bank.update(raws, now, dt);
        const present = new Set<string>();
        for (const { hand, ev } of res) {
          const id = 'h' + hand.id; present.add(id);
          let p = ptrs.get(id);
          if (!p) { p = { id, x: 0, y: 0, down: false, downAt: 0, sx: 0, sy: 0, moved: 0, hist: [], pinch: 1, seen: now, hand }; ptrs.set(id, p); }
          const s = hand.shape, w = clamp((0.6 - s.pinch) / 0.3, 0, 1); // çimdiğe yaklaştıkça imleç uçtan tutma noktasına kayar
          p.x = s.tip.x * (1 - w) + s.pinchPt.x * w; p.y = s.tip.y * (1 - w) + s.pinchPt.y * w; p.pinch = s.pinch; p.seen = now; p.hand = hand;
          if (ev.pinchDown) down(p, now);
          if (ev.pinchUp) up(p, now);
          // yumruk: 1.2 sn tutulursa kapat. Barış işareti: 0.5 sn tutulursa yerleşimi sıfırla
          if (hand.gesture === 'zafer') { if (!peaceDone && now - hand.gestureSince > 500) { peaceDone = true; place(); burst(W / 2, H / 2, 190, 60); } } else peaceDone = false;
        }
        for (const [id, p] of ptrs) if (id !== 'mouse' && !present.has(id) && now - p.seen > 350) { up(p, now); ptrs.delete(id); }
      }
      // hareket ve tutma
      let anyFist: TrackedHand | null = null;
      for (const p of ptrs.values()) {
        if (p.id === 'mouse' && now - p.seen > 4000 && !p.down) { p.x = -999; p.y = -999; }
        p.hist.push({ x: p.x, y: p.y, t: now }); if (p.hist.length > 8) p.hist.shift();
        if (p.down) p.moved = Math.max(p.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
        if (p.down && liveRef.current) { const sc = (p as any).scroller as HTMLElement | null; if (sc && p.moved > 14) sc.scrollTop -= p.y - (p as any).ly; (p as any).ly = p.y; }
        if (p.hand && p.hand.gesture === 'yumruk' && !p.down) anyFist = p.hand;
      }
      // bekleyerek açma (yalnızca el): bir kartın üstünde ~0.9 sn durmak da açar; çimdik yapamayanlar için güvenilir yol
      for (const p of ptrs.values()) {
        if (!p.hand || p.down || biRef.current !== null || liveRef.current) { p.dwellCard = null; continue; }
        const c = cardAt(p.x, p.y);
        if (c !== p.dwellCard) { p.dwellCard = c; p.dwellSince = now; p.dwellDone = false; }
        else if (c && !p.dwellDone && !c.heldBy && now - (p.dwellSince || now) > 900) { p.dwellDone = true; burst(c.x, c.y, c.c.hue, 30); open(c); }
      }
      if (anyFist) { if (!fistSince) fistSince = now; if (now - fistSince > 1200) { if (biRef.current !== null) { actRef.current.showScene(null); fistSince = 0; } else { alive = false; cbRef.current.onClose(); return; } } } else fistSince = 0;

      for (const r of rcards) {
        const owner = r.heldBy ? ptrs.get(r.heldBy) : null;
        if (owner && owner.down) {
          r.x += (owner.x + ((r as any).dx || 0) - r.x) * 0.6; r.y += (owner.y + ((r as any).dy || 0) - r.y) * 0.6;
          r.scale += (1.12 - r.scale) * 0.2;
        } else {
          if (r.heldBy) r.heldBy = null;
          r.x += r.vx; r.y += r.vy; r.vx *= 0.93; r.vy *= 0.93;
          const mx = r.w / 2 * r.scale, my = r.h / 2 * r.scale;
          if (r.x < mx) { r.x = mx; r.vx = Math.abs(r.vx) * 0.6; } if (r.x > W - mx) { r.x = W - mx; r.vx = -Math.abs(r.vx) * 0.6; }
          if (r.y < my + 40) { r.y = my + 40; r.vy = Math.abs(r.vy) * 0.6; } if (r.y > H - my - 30) { r.y = H - my - 30; r.vy = -Math.abs(r.vy) * 0.6; }
          if (!scale2 || scale2.card !== r) r.scale += (1 - r.scale) * 0.12;
        }
        let hov = false;
        for (const p of ptrs.values()) if (!p.down && p.x > -500 && hit(r, p.x, p.y)) hov = true;
        r.hover += ((hov || r.heldBy ? 1 : 0) - r.hover) * 0.25;
      }
      if (scale2) {
        const a = ptrs.get(scale2.a), b = ptrs.get(scale2.b);
        if (a && b && a.down && b.down) scale2.card.scale = clamp(scale2.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / scale2.d0), 0.6, 2.4); else scale2 = null;
      }

      // kartları güncelle
      rcards.forEach((r, i) => {
        const el = cardEls.current[i]; if (!el) return;
        el.style.transform = `translate3d(${r.x - r.w / 2}px,${r.y - r.h / 2}px,0) scale(${r.scale * (1 + r.hover * 0.05)})`;
        el.classList.toggle('hover', r.hover > 0.5); el.classList.toggle('held', !!r.heldBy);
      });

      // ---- çizim
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      // el iskeleti
      if (skelRef.current) for (const h of bank.hands) {
        if (!h.shape || now - h.lastSeen > 120) continue;
        const hue = h.pinching ? 42 : handHue;
        ctx.strokeStyle = `hsla(${hue},100%,62%,.6)`; ctx.lineWidth = 2; ctx.shadowColor = `hsla(${hue},100%,60%,1)`; ctx.shadowBlur = 14;
        ctx.beginPath(); for (const [a, b] of BONES) { ctx.moveTo(h.pts[a].x, h.pts[a].y); ctx.lineTo(h.pts[b].x, h.pts[b].y); } ctx.stroke();
        ctx.fillStyle = `hsla(${hue},100%,75%,.9)`;
        for (let i = 0; i < 21; i++) { ctx.beginPath(); ctx.arc(h.pts[i].x, h.pts[i].y, i % 4 === 0 && i > 0 ? 4 : 2.2, 0, 7); ctx.fill(); }
        ctx.shadowBlur = 0;
        // küçük jest etiketi avucun üstünde
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(160,230,255,.8)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(GESTURE_LABEL[h.gesture], h.shape.palm.x, h.shape.palm.y + h.shape.size * 1.3);
        ctx.globalCompositeOperation = 'lighter';
        if (h.gesture === 'yumruk' && fistSince) { // kapatma halkası
          const pr = clamp((now - fistSince) / 1200, 0, 1);
          ctx.strokeStyle = 'rgba(255,90,90,.9)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(h.shape.palm.x, h.shape.palm.y, 34, -Math.PI / 2, -Math.PI / 2 + pr * Math.PI * 2); ctx.stroke();
        }
      }
      // imleçler: izler, halka, tutma
      for (const p of ptrs.values()) {
        if (p.x < -500) continue;
        const hue = p.down ? 42 : 190;
        if (skelRef.current && p.hist.length > 2) {
          for (let i = 1; i < p.hist.length; i++) { ctx.strokeStyle = `hsla(${hue},100%,65%,${(i / p.hist.length) * 0.5})`; ctx.lineWidth = 3 * (i / p.hist.length); ctx.beginPath(); ctx.moveTo(p.hist[i - 1].x, p.hist[i - 1].y); ctx.lineTo(p.hist[i].x, p.hist[i].y); ctx.stroke(); }
        }
        const rr = p.down ? 11 : 14 + clamp(p.pinch, 0, 0.8) * 34;
        ctx.strokeStyle = `hsla(${hue},100%,70%,.95)`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 7); ctx.stroke();
        if (p.dwellCard && !p.dwellDone && p.dwellSince) { ctx.strokeStyle = 'rgba(120,255,200,.95)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, rr + 8, -Math.PI / 2, -Math.PI / 2 + clamp((now - p.dwellSince) / 900, 0, 1) * Math.PI * 2); ctx.stroke(); }
        if (p.down) { ctx.fillStyle = `hsla(${hue},100%,70%,.55)`; ctx.beginPath(); ctx.arc(p.x, p.y, 7 + Math.sin(now / 90) * 1.5, 0, 7); ctx.fill(); }
        else { ctx.fillStyle = `hsla(${hue},100%,80%,.9)`; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, 7); ctx.fill(); }
      }
      // iki elle ölçekleme çizgisi
      if (scale2) { const a = ptrs.get(scale2.a), b = ptrs.get(scale2.b); if (a && b) { ctx.strokeStyle = 'rgba(255,200,80,.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); } }
      // kıvılcımlar
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.x += s.vx; s.y += s.vy; s.vx *= 0.94; s.vy *= 0.94; s.life -= 0.03;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.fillStyle = `hsla(${s.hue},100%,70%,${s.life})`; ctx.beginPath(); ctx.arc(s.x, s.y, 2.2 * s.life + 0.6, 0, 7); ctx.fill();
      }
      // HUD köşeleri
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(0,200,255,.45)'; ctx.lineWidth = 2; const m = 16, L = 26;
      ([[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const).forEach(([x, y, sx, sy]) => { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); });
      ctx.fillStyle = 'rgba(127,220,255,.7)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(`${lm ? `${delegate} · ` : ''}${fps} fps · ${bank.hands.filter(h => now - h.lastSeen < 200).length} el`, W - 22, 56);
      void tms;
    };
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false; cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize); window.removeEventListener('keydown', key);
      root.removeEventListener('pointermove', pm); root.removeEventListener('pointerdown', pd); root.removeEventListener('pointerup', pu);
      try { stream?.getTracks().forEach(t => t.stop()); } catch { /* yoksay */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={rootRef} className={`holo-root${bi !== null ? ' briefing' : ''}${live ? ' live' : ''}`} data-agent-ignore="1" role="dialog" aria-label="Jarvis masası">
      <style>{CSS}</style>
      <video ref={videoRef} />
      <div className="holo-scrim" />
      <div className="holo-grid" />
      <div className="holo-core" style={{ position: 'absolute', left: '50%', top: bi !== null ? '21%' : '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', transition: 'top .5s ease', opacity: bi !== null ? 0.95 : 0.75 }}>
        <JarvisCore size={bi !== null ? 170 : 250}
          state={mic === 'rec' ? 'listening' : mic === 'busy' ? 'thinking' : bi !== null && talking ? 'speaking' : 'idle'}
          level={() => (mic === 'rec' ? micRef.current?.level() ?? 0 : speakRef.current?.level ? speakRef.current.level() : undefined) as number} />
      </div>
      {cards.map((c, i) => (
        <div key={c.id} ref={el => { cardEls.current[i] = el; }} className={`holo-card ${c.kind}`}
          style={{ ['--h' as any]: c.hue, width: c.kind === 'orb' ? 112 : 250, height: c.kind === 'orb' ? 112 : 74 }}>
          <div className="t">{c.action === 'mic' && mic !== 'idle' ? (mic === 'rec' ? 'Dinliyorum…' : 'Çeviriyor…') : c.title}</div>
          {c.sub && <div className="s">{c.sub}</div>}
        </div>
      ))}
      {bi !== null && scenes[bi] && (
        <div className="holo-brief" role="status">
          <div className="bt">{scenes[bi].baslik}</div>
          <div className="big">{scenes[bi].buyuk}</div>
          <div className="lab">{scenes[bi].etiket}</div>
          <ul>{scenes[bi].satirlar.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="dots">{scenes.map((_, i) => <i key={i} className={i === bi ? 'on' : ''} />)}</div>
        </div>
      )}
      {live && (
        <div className="holo-dock" data-agent-ignore="1">
          <JarvisCore size={40} state={mic === 'rec' ? 'listening' : mic === 'busy' ? 'thinking' : 'idle'} />
          {cards.filter(c => c.kind === 'orb' && c.screen).map(c => <button key={c.id} type="button" onClick={() => cbRef.current.onNavigate(c.screen!)}>{c.title}</button>)}
          <button type="button" onClick={backDesk}>Masa</button>
        </div>
      )}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      <div className="holo-ui">
        <span>Jarvis · el kontrolü</span>
        {status && <span style={{ letterSpacing: 0, textTransform: 'none', color: camOk ? '#7fdcff' : '#ffd37f' }}>{status}</span>}
        <button type="button" className={`holo-x${skel ? ' on' : ''}`} style={{ marginLeft: 'auto', fontSize: 11, letterSpacing: 0, textTransform: 'none' }} onClick={toggleSkel} aria-pressed={skel}>El çizimi: {skel ? 'açık' : 'kapalı'}</button>
        <button type="button" className="holo-x" style={{ marginLeft: 0 }} onClick={() => (biRef.current !== null ? actRef.current.showScene(null) : cbRef.current.onClose())} aria-label="Kapat"><X size={15} /></button>
      </div>
      <div className="holo-hint">{bi !== null ? 'Dokun: sonraki sahne · Yumruk (1 sn) veya Esc: brifingi bitir' : 'Karta işaret edip bekle ya da hızlı çimdik: aç · Çimdik+sürükle: tut · Savur · İki el: büyüt · Barış işareti: sıfırla · Yumruk (1 sn): kapat · Esc'}</div>
    </div>
  );
}
