import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, Hand, ExternalLink, ChevronLeft, ChevronRight, ArrowLeft, ScanFace, MousePointer2 } from 'lucide-react';
import NoteText from './NoteText';
import { HandBank, OneEuro, type P } from '../services/hands/gestures';
import { openCamera, loadLandmarker, landmarkerReady, detect } from '../services/hands/tracker';
import { loadFaceLandmarker, faceReady, detectFace, calibrate, fitCal, mapFeat, mapParts, BlinkGate, type FaceFeat, type FaceCal, type CalPoint } from '../services/hands/face';
import { titleOf, folderOf, noteTags, outline, excerpt, hueOf, resolveLinks, linkTargets } from '../services/noteSpaceUtils';

// "Çalışma masası": Not uzayında rafa topladığınız (en çok 10) notlar ayrı bir ekranda, uzaydakinden büyük kartlar olarak durur ("keşif" kipi).
// Az ve büyük hedef olduğu için kaba işaretleme yeterlidir. Tüm girişler tek bir "işaretçi"den geçer: fare doğrudan tıklar; el ve baş gibi kaynaklar
// bir hedefte bekleyince tetikler (halka dolar): kart ~2 sn (baş) / 1 sn (el) → büyüyerek modal olarak açılır ("okuma" kipi).
// Okurken: yazının alt/üst kenarına bakınca kayar; modal dışına (arka masaya) ~1,5 sn bakınca kapanır ve keşif kipine dönülür.
// Not içerikleri yalnızca okunur.

type Mode = 'mouse' | 'hand' | 'head';
interface Ptr { x: number; y: number; active: boolean; src: Mode; key: string; since: number; done: boolean; seen: number; outSince: number }

const CLOSE_MS = 1500; // modal dışına bakınca kapanma süresi
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dwellMs = (src: Mode, card: boolean) => (src === 'hand' ? 1000 : card ? 2000 : 1500);
const TARGETS: [number, number][] = [[0.5, 0.5], [0.1, 0.18], [0.9, 0.18], [0.9, 0.86], [0.1, 0.86]];
const CAL_KEY = 'st-head-cal-v1', PTS_KEY = 'st-head-pts-v1';
const GRID_C = 5, GRID_R = 4; // kalibrasyon bantları: 5 dikey bant (bantlar arası = baş, bant içi = göz)
// Önerilen işaret noktaları: her bantta üst/orta/alt, sol-sağ dönüşümlü: bant içi yatay ve dikey göz aralığı ile bantlar arası baş aralığı birlikte örneklenir
const SUG: [number, number][] = Array.from({ length: GRID_C }, (_, b) => [0, 1, 2].map(j => [(b + ((b + j) % 2 ? 0.78 : 0.22)) / GRID_C, [0.12, 0.5, 0.88][j]] as [number, number])).flat();
const loadCal = (): FaceCal | null => { try { const v = JSON.parse(localStorage.getItem(CAL_KEY) || 'null'); return v && Array.isArray(v.ax) && Array.isArray(v.ay) ? v : null; } catch { return null; } };
// Elle işaretlenen noktalar ekran oranı olarak saklanır (pencere boyutu değişse de geçerli kalsın)
const loadPts = (W: number, H: number): CalPoint[] => { try { const v = JSON.parse(localStorage.getItem(PTS_KEY) || '[]'); return Array.isArray(v) ? v.filter((q: any) => q && q.f && Number.isFinite(q.xf) && Number.isFinite(q.yf)).map((q: any) => ({ f: { gx: 0.5, gy: 0.5, ...q.f }, x: q.xf * W, y: q.yf * H })) : []; } catch { return []; } };

const CSS = `
.st-root{position:absolute;inset:0;z-index:20;background:radial-gradient(ellipse at 50% 40%,#082a44 0%,#02080f 75%);color:#d7f3ff;font-family:'Inter','Segoe UI',system-ui,sans-serif;overflow:hidden;user-select:none}
.st-top{position:absolute;z-index:8;left:0;right:0;top:0;display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;padding:10px 160px 10px 14px;pointer-events:none;font-size:12px}
.st-top>*{pointer-events:auto}
.st-title{letter-spacing:.14em;text-transform:uppercase;color:#7fdcff;font-size:12px}
.st-btn{cursor:pointer;background:rgba(0,40,60,.75);border:1px solid rgba(0,200,255,.4);color:#bfeeff;border-radius:9px;padding:7px 12px;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-family:inherit}
.st-btn:hover{background:rgba(0,120,170,.55)}.st-btn.on{background:rgba(0,150,200,.6);border-color:#7fe6ff}.st-btn:disabled{opacity:.4;cursor:default}
.st-btn.aimed,.st-fchip.aimed{outline:2px solid #7fffd4;box-shadow:0 0 18px rgba(127,255,212,.6)}
.st-grid{position:absolute;left:24px;right:24px;top:62px;bottom:24px;display:grid;gap:22px;justify-content:center;align-content:center;z-index:2}
.st-lines{position:absolute;left:24px;right:24px;top:62px;bottom:24px;z-index:1;pointer-events:none}
.st-card{position:relative;min-width:0;min-height:0;box-sizing:border-box;padding:16px 18px;border-radius:16px;background:rgba(6,30,48,.88);border:1px solid hsla(var(--h),100%,62%,.55);box-shadow:0 0 20px hsla(var(--h),100%,55%,.2);display:flex;flex-direction:column;gap:8px;overflow:hidden;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s}
.st-card:hover,.st-card.aimed{transform:scale(1.03);z-index:3;border-color:hsla(var(--h),100%,80%,1);box-shadow:0 0 40px hsla(var(--h),100%,60%,.6)}
.st-card.aimed{outline:2px solid #7fffd4}
.st-num{position:absolute;right:12px;top:10px;font-size:11.5px;opacity:.55;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:1px 6px}
.st-fold{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:hsla(var(--h),100%,76%,.9)}
.st-ct{font-size:clamp(16px,1.6vw,22px);font-weight:600;color:#f1fdff;line-height:1.22;padding-right:30px}
.st-tags{display:flex;flex-wrap:wrap;gap:5px}.st-tags span{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,170,230,.16);border:1px solid rgba(0,200,255,.3);color:#9fe3ff}
.st-ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}.st-ol li{font-size:12px;color:#bfe6f4;border-left:2px solid hsla(var(--h),100%,65%,.7);padding-left:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-ex{font-size:13px;line-height:1.5;color:#a9d3e3;overflow:hidden;flex:1;min-height:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:7}
.st-ln{font-size:11px;color:#ffd166}
.st-backdrop{position:absolute;inset:0;z-index:5;background:rgba(1,6,12,.66)}
.st-mwrap{position:absolute;left:0;right:0;top:60px;bottom:20px;z-index:6;display:grid;place-items:center;pointer-events:none}
.st-modal{pointer-events:auto;width:min(980px,78vw);height:100%;max-height:780px;display:flex;flex-direction:column;background:#041320;border:1px solid rgba(0,200,255,.55);border-radius:18px;box-shadow:0 0 70px rgba(0,190,255,.28);overflow:hidden}
.st-rh{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(0,200,255,.25);flex-wrap:wrap}
.st-rt{flex:1;min-width:140px;font-size:19px;font-weight:600;color:#f1fdff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-rb{flex:1;overflow:auto;padding:16px 28px 40px;user-select:text}
.st-rl{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;border-top:1px solid rgba(0,200,255,.2);align-items:center;font-size:12px}
.st-rhint{padding:6px 16px 9px;font-size:11px;color:#6fa6bb;border-top:1px solid rgba(0,200,255,.12)}
.st-fchip{cursor:pointer;background:rgba(0,60,90,.5);border:1px solid rgba(0,200,255,.35);color:#cfefff;border-radius:999px;padding:5px 12px;font:inherit}.st-fchip:hover{background:rgba(0,150,200,.5)}
.st-cur{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #7fffd4;pointer-events:none;z-index:2147483300;display:none;box-shadow:0 0 12px rgba(0,255,200,.6)}
.st-hint{position:absolute;z-index:4;left:24px;bottom:4px;font-size:11px;color:#6fa6bb;pointer-events:none}
.st-cal{position:absolute;inset:0;z-index:30;background:rgba(1,6,12,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center}
.st-cal-t{letter-spacing:.14em;text-transform:uppercase;color:#7fdcff;font-size:13px}.st-cal-m{max-width:520px;font-size:14px;color:#bfe6f4;line-height:1.5}
.st-cal-dot{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:3px solid #7fffd4;display:grid;place-items:center;box-shadow:0 0 30px rgba(0,255,200,.6)}
.st-cal-dot i{width:14px;height:14px;border-radius:50%;background:#7fffd4}
.st-calm{background-color:rgba(1,6,12,.82);cursor:crosshair;justify-content:flex-start;background-image:linear-gradient(rgba(127,255,212,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(127,255,212,.2) 1px,transparent 1px);background-size:calc(100% / ${GRID_C}) calc(100% / ${GRID_R})}
.st-calp{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:min(760px,calc(100% - 340px));min-width:300px;padding:12px 16px;border-radius:14px;background:rgba(4,22,36,.96);border:1px solid rgba(0,200,255,.5);box-shadow:0 0 40px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:8px;cursor:default;text-align:left}
.st-calp .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.st-sug{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:2px dashed rgba(127,255,212,.6);pointer-events:none}
.st-mark{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid #fff;pointer-events:none}
.st-caldot{position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #5cc8ff;background:rgba(92,200,255,.18);box-shadow:0 0 22px rgba(92,200,255,.8);pointer-events:none;display:none;z-index:31}
`;

export default function StudyTable({ files, paths, onOpenInApp, onBack, onClose }: { files: Record<string, string>; paths: string[]; onOpenInApp: (path: string) => void; onBack: () => void; onClose: () => void }) {
  const notes = useMemo(() => paths.slice(0, 10).filter(p => files[p] !== undefined).map(p => {
    const text = files[p] || '', folder = folderOf(p);
    return { path: p, title: titleOf(p), folder, hue: hueOf(folder), tags: [...noteTags(text)].slice(0, 6), outline: outline(text), excerpt: excerpt(text, 340), words: text.split(/\s+/).filter(Boolean).length };
  }), [files, paths]);
  const n = notes.length;
  const cols = n <= 1 ? 1 : n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = n <= 2 ? 460 : n <= 4 ? 380 : 300, ch = n <= 3 ? 380 : n <= 6 ? 330 : 290; // kartlar uzaydakinden büyük ama ekranı doldurmaz

  const [reader, setReader] = useState<string | null>(null);
  const readerRef = useRef(reader); readerRef.current = reader;
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<Mode>(() => { try { const v = localStorage.getItem('st-input-v1'); if (v === 'mouse' || v === 'hand' || v === 'head') return v; } catch { /* yoksay */ } return window.innerWidth >= 900 ? 'head' : 'mouse'; });
  const modeRef = useRef(mode); modeRef.current = mode;
  const chooseMode = (m: Mode) => { setMode(m); try { localStorage.setItem('st-input-v1', m); } catch { /* yoksay */ } };
  const cbRef = useRef({ onBack, onClose, onOpenInApp }); cbRef.current = { onBack, onClose, onOpenInApp };

  const gridRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef<(HTMLDivElement | null)[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fromRect = useRef<DOMRect | null>(null);
  const ptr = useRef<Ptr>({ x: -999, y: -999, active: false, src: 'mouse', key: '', since: 0, done: false, seen: 0, outSince: 0 });
  // Geliştirme sırasında işaretçiyi elle sürmek için (kamerasız deneme); üretim derlemesinde yok
  if ((import.meta as any).env?.DEV) (window as any).__stPtr = ptr.current;
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  const openAt = (i: number) => { if (!notes[i]) return; fromRect.current = cardEls.current[i]?.getBoundingClientRect() || null; setReader(notes[i].path); };
  const step = (d: number) => { const i = notes.findIndex(x => x.path === readerRef.current); if (i >= 0 && n) { fromRect.current = null; setReader(notes[(i + d + n) % n].path); } };
  const stepRef = useRef(step); stepRef.current = step;
  const openAtRef = useRef(openAt); openAtRef.current = openAt;

  // Seçili notlar arasındaki bağlantılar: kartların merkezleri arasında çizgi
  const pairs = useMemo(() => {
    const byTitle = new Map<string, number>(); notes.forEach((x, i) => byTitle.set(x.title.toLowerCase(), i));
    const out: [number, number][] = [], seen = new Set<string>();
    notes.forEach((x, i) => { for (const t of linkTargets(files[x.path] || '')) { const j = byTitle.get(t); if (j !== undefined && j !== i) { const k = i < j ? `${i}-${j}` : `${j}-${i}`; if (!seen.has(k)) { seen.add(k); out.push([i, j]); } } } });
    return out;
  }, [notes, files]);
  const linkCount = useMemo(() => notes.map((_, i) => pairs.filter(([a, b]) => a === i || b === i).length), [notes, pairs]);
  useLayoutEffect(() => {
    const measure = () => {
      const g = gridRef.current; if (!g) return; const gb = g.getBoundingClientRect();
      const c = cardEls.current.map(e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left - gb.left + b.width / 2, y: b.top - gb.top + b.height / 2 }; });
      setLines(pairs.flatMap(([a, b]) => (c[a] && c[b] ? [{ x1: c[a]!.x, y1: c[a]!.y, x2: c[b]!.x, y2: c[b]!.y }] : [])));
    };
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pairs, cols, rows, n]);

  // Modal büyüyerek açılır: kartın bulunduğu yerden son boyuna (kartla açıldıysa); bağlantıdan geçişte hafif belirir
  useLayoutEffect(() => {
    const m = modalRef.current; if (!m || !reader) return;
    const fr = fromRect.current; fromRect.current = null;
    if (fr) {
      const r = m.getBoundingClientRect();
      m.animate([{ transform: `translate(${fr.left + fr.width / 2 - (r.left + r.width / 2)}px,${fr.top + fr.height / 2 - (r.top + r.height / 2)}px) scale(${fr.width / r.width},${fr.height / r.height})`, opacity: 0.25 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } else m.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180 });
    bodyRef.current?.scrollTo({ top: 0 });
  }, [reader]);

  // ---- kalibrasyon (baş). İki yol:
  // (1) ELLE işaretleme [önerilen]: ekranda ızgara görünür; bir noktaya bakıp fareyi tam o noktaya götürüp tıklarsınız (ya da Boşluk): o andaki baş/burun ölçümü o noktayla
  //     eşlenir. Her işaretten sonra mavi halka "sizi nerede sandığını" anında gösterir; sapmayı görüp istediğiniz kadar nokta eklersiniz (9+ noktada eşleme esner, kenarlar düzelir).
  // (2) otomatik 5 nokta (hızlı başlangıç). Elle işaretlenen noktalar saklanır, sonraki kalibrasyonda üzerine eklenebilir.
  const calRef = useRef<FaceCal | null>(loadCal());
  const [hasCal, setHasCal] = useState(!!calRef.current);
  const calMode = useRef<'auto' | 'manual' | null>(null);
  const calRun = useRef<{ idx: number; t0: number; acc: FaceFeat[]; pts: CalPoint[]; msg: string } | null>(null);
  const [calUi, setCalUi] = useState<{ mode: 'auto'; idx: number; prog: number; msg: string } | { mode: 'manual'; msg: string } | null>(null);
  const [marks, setMarks] = useState<{ x: number; y: number; err: number }[]>([]);
  const [meanErr, setMeanErr] = useState<number | null>(null);
  const [panelTop, setPanelTop] = useState(true); // açıklama paneli üstte ya da altta (altındaki halkaları örtmesin)
  const manualPts = useRef<CalPoint[]>([]);
  const tmpCal = useRef<FaceCal | null>(null);
  const featBuf = useRef<FaceFeat[]>([]);
  const calDotRef = useRef<HTMLDivElement>(null);
  const mousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  // Göz payı: öğrenilen göz katkısının çarpanı (1 = öğrenilen). Göz etkisi zayıf/aşırı geliyorsa kaydırıcıyla ayarlanır.
  const [eyeGain, setEyeGain] = useState<number>(() => calRef.current?.eg ?? 1);
  const eyeGainRef = useRef(eyeGain); eyeGainRef.current = eyeGain;
  const lastFeatT = useRef(0);
  const refit = () => {
    const r = fitCal(manualPts.current, window.innerWidth, window.innerHeight);
    if (r.cal) r.cal.eg = eyeGainRef.current;
    tmpCal.current = r.cal;
    const errs = manualPts.current.map(q => { if (!r.cal) return 0; const m = mapFeat(r.cal, q.f); return Math.hypot(m.x - q.x, m.y - q.y); });
    setMarks(manualPts.current.map((q, i) => ({ x: q.x, y: q.y, err: errs[i] }))); setMeanErr(r.cal && errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null);
  };
  const startManual = () => {
    calRun.current = null; calMode.current = 'manual'; ptr.current.active = false;
    manualPts.current = loadPts(window.innerWidth, window.innerHeight); tmpCal.current = calRef.current;
    setCalUi({ mode: 'manual', msg: '' }); refit();
  };
  const startCal = () => { calMode.current = 'auto'; calRun.current = { idx: 0, t0: performance.now(), acc: [], pts: [], msg: '' }; setCalUi({ mode: 'auto', idx: 0, prog: 0, msg: '' }); ptr.current.active = false; };
  const cancelCal = () => { calRun.current = null; calMode.current = null; tmpCal.current = null; setCalUi(null); };
  const markPoint = (x: number, y: number) => {
    const buf = featBuf.current;
    if (buf.length < 5 || performance.now() - lastFeatT.current > 600) { setCalUi({ mode: 'manual', msg: 'Yüzünüz görünmüyor, kameraya bakın ve tekrar işaretleyin.' }); return; }
    const last = buf.slice(-12), k = last.length; // son ~0,4 sn ortalaması: tek karelik titremeyi yutar
    const f = last.reduce((a, q) => ({ nx: a.nx + q.nx / k, ny: a.ny + q.ny / k, yaw: a.yaw + q.yaw / k, pitch: a.pitch + q.pitch / k, gx: a.gx + q.gx / k, gy: a.gy + q.gy / k }), { nx: 0, ny: 0, yaw: 0, pitch: 0, gx: 0, gy: 0 });
    manualPts.current.push({ f, x, y }); refit(); setCalUi({ mode: 'manual', msg: '' });
  };
  const undoMark = () => { manualPts.current.pop(); refit(); };
  const clearMarks = () => { manualPts.current = []; tmpCal.current = null; setMarks([]); setMeanErr(null); };
  const finishManual = () => {
    const r = fitCal(manualPts.current, window.innerWidth, window.innerHeight);
    if (!r.cal) { setCalUi({ mode: 'manual', msg: 'En az 4 nokta işaretleyin ve ekranın geniş bölümüne yayın (köşeler ve orta).' }); return; }
    r.cal.eg = eyeGainRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    calRef.current = r.cal; setHasCal(true);
    try { localStorage.setItem(CAL_KEY, JSON.stringify(r.cal)); localStorage.setItem(PTS_KEY, JSON.stringify(manualPts.current.map(q => ({ f: q.f, xf: q.x / W, yf: q.y / H })))); } catch { /* yoksay */ }
    calMode.current = null; tmpCal.current = null; setCalUi(null);
    const msg = `Kalibrasyon kaydedildi (${manualPts.current.length} nokta, ortalama sapma ~${Math.round(r.mean)} px).`; setStatus(msg); setTimeout(() => setStatus(x => (x === msg ? '' : x)), 3500);
  };
  const markRef = useRef(markPoint); markRef.current = markPoint;
  const startCalRef = useRef(startCal); startCalRef.current = startCal;
  const startManualRef = useRef(startManual); startManualRef.current = startManual;
  if ((import.meta as any).env?.DEV) (window as any).__stCal = { start: () => startManualRef.current(), mark: (x: number, y: number) => markRef.current(x, y), feed: (f: FaceFeat) => { featBuf.current.push(f); if (featBuf.current.length > 14) featBuf.current.shift(); lastFeatT.current = performance.now(); } };

  // ---- işaretçi döngüsü: kaynağı (el/baş) bir hedefte bekleyince tetikler; okurken kenara bakınca kaydırır; modal dışına bakınca kapatır
  useEffect(() => {
    let raf = 0, alive = true, aimed: HTMLElement | null = null;
    const loop = () => {
      if (!alive) return; raf = requestAnimationFrame(loop);
      const p = ptr.current, cur = curRef.current, now = performance.now();
      if (p.src !== 'mouse' && p.active && now - p.seen > 400) p.active = false; // kaynak kayboldu
      if (!cur) return;
      let target: HTMLElement | null = null, key = '', closing = 0, prog = 0;
      if (p.src !== 'mouse' && p.active && !calMode.current) {
        cur.style.display = 'block'; cur.style.transform = `translate(${p.x}px,${p.y}px)`;
        const rd = readerRef.current;
        const el = document.elementFromPoint(p.x, p.y);
        const card = !rd ? (el?.closest('.st-card') as HTMLElement | null) : null, btn = el?.closest('button') as HTMLElement | null;
        if (rd) {
          const m = modalRef.current?.getBoundingClientRect(), b = bodyRef.current?.getBoundingClientRect();
          if (m) {
            const inside = p.x >= m.left - 24 && p.x <= m.right + 24 && p.y >= m.top - 24 && p.y <= m.bottom + 24;
            if (inside) {
              p.outSince = 0;
              if (b && bodyRef.current && p.x >= b.left && p.x <= b.right) { // yazının alt kenarına bakınca aşağı, üst kenarına bakınca yukarı kayar (kenara yaklaştıkça hızlanır)
                const rel = (p.y - b.top) / b.height;
                if (rel > 0.78 && rel <= 1.05) bodyRef.current.scrollTop += ((clamp(rel, 0.78, 1) - 0.78) / 0.22) * 7;
                else if (rel < 0.22 && rel >= -0.05) bodyRef.current.scrollTop -= ((0.22 - clamp(rel, 0, 0.22)) / 0.22) * 7;
              }
            } else {
              if (!p.outSince) p.outSince = now;
              closing = clamp((now - p.outSince) / CLOSE_MS, 0, 1);
              if (closing >= 1) { p.outSince = 0; p.key = ''; setReader(null); closing = 0; }
            }
          }
        } else p.outSince = 0;
        if (card) { target = card; key = 'c' + card.dataset.idx; } else if (btn) { target = btn; key = 'b:' + (btn.getAttribute('aria-label') || btn.textContent || ''); }
        if (key !== p.key) { p.key = key; p.since = now; p.done = false; }
        const need = dwellMs(p.src, !!card);
        prog = key && !p.done ? clamp((now - p.since) / need, 0, 1) : 0;
        if (key && !p.done && now - p.since > need) {
          p.done = true;
          if (card) openAtRef.current(Number(card.dataset.idx)); else btn?.click();
        }
        cur.style.background = closing > 0 ? `conic-gradient(rgba(255,120,120,.8) ${Math.round(closing * 360)}deg, rgba(0,0,0,.15) 0)` : prog > 0 ? `conic-gradient(rgba(120,255,200,.75) ${Math.round(prog * 360)}deg, rgba(0,0,0,.15) 0)` : '';
        cur.style.borderColor = closing > 0 ? '#ff7a7a' : '#7fffd4';
      } else { cur.style.display = 'none'; p.key = ''; p.outSince = 0; }
      if (aimed !== target) { aimed?.classList.remove('aimed'); target?.classList.add('aimed'); aimed = target; }
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); aimed?.classList.remove('aimed'); };
  }, []);

  // ---- klavye: Esc = (kalibrasyon) iptal · okumadan masaya · masadan uzaya · 1-9,0 = o kartı aç · ←/→ = okurken önceki/sonraki
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (calMode.current) cancelCal(); else if (readerRef.current) setReader(null); else cbRef.current.onBack(); return; }
      if (calMode.current === 'manual') { if (e.key === ' ') { e.preventDefault(); markRef.current(mousePos.current.x, mousePos.current.y); } return; }
      if (calMode.current) return;
      if (readerRef.current) { if (e.key === 'ArrowRight') stepRef.current(1); else if (e.key === 'ArrowLeft') stepRef.current(-1); return; }
      const d = '1234567890'.indexOf(e.key); if (d >= 0) openAtRef.current(d);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  // ---- baş kontrolü: burun ucu imleç olur (kalibrasyonla ekrana eşlenir)
  useEffect(() => {
    if (mode !== 'head') { if (ptr.current.src === 'head') ptr.current.active = false; return; }
    let alive = true, raf = 0, stream: MediaStream | null = null, fl: import('@mediapipe/tasks-vision').FaceLandmarker | null = null, lastVT = -1, lastDet = 0, lastT = performance.now();
    // Baş (kaba bölge) ağır, göz (bölge içi ince konum) hızlı yumuşatılır: bölge içinde gözün hareketi gecikmesin, bölgeler arası geçişte başın titremesi ekrana yansımasın
    const fhx = new OneEuro(0.5, 0.003, 1), fhy = new OneEuro(0.5, 0.003, 1), fex = new OneEuro(1.4, 0.012, 1), fey = new OneEuro(1.4, 0.012, 1);
    const smooth = (c: FaceCal, f: FaceFeat, dt: number, W: number, H: number) => { const q = mapParts(c, f); return { x: clamp(fhx.filter(q.hx, dt) + fex.filter(q.ex, dt), 0, W), y: clamp(fhy.filter(q.hy, dt) + fey.filter(q.ey, dt), 0, H) }; };
    const gate = new BlinkGate();
    const video = videoRef.current!;
    (async () => {
      try {
        setStatus('Kamera açılıyor…'); stream = await openCamera(video); if (!alive) return;
        if (!faceReady()) setStatus('Yüz takip modeli yükleniyor…');
        fl = await loadFaceLandmarker(); if (!alive) return; setStatus('');
        if (!calRef.current) startManualRef.current();
      } catch (e: any) { setStatus(String(e?.name) === 'NotAllowedError' ? 'Kamera izni verilmedi.' : `Baş takibi başlatılamadı (${e?.message || e?.name}).`); setMode('mouse'); }
    })();
    const loop = () => {
      if (!alive) return; raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (!fl || video.readyState < 2 || video.currentTime === lastVT || now - lastDet < 25) return;
      lastVT = video.currentTime; lastDet = now;
      let f: FaceFeat | null = null; try { f = detectFace(fl, video, now); } catch { f = null; }
      let frozen = false; // göz kırpma: imleç donar, kalibrasyon ölçümüne de kırpma karesi girmez
      if (f) {
        frozen = gate.step(f.open ?? 0.2, now, ptr.current.active ? { x: ptr.current.x, y: ptr.current.y } : null);
        if (!frozen) { featBuf.current.push(f); if (featBuf.current.length > 14) featBuf.current.shift(); }
        lastFeatT.current = now;
      }
      const W = window.innerWidth, H = window.innerHeight, run = calRun.current;
      if (calMode.current === 'manual') { // canlı halka: sistemin şu anki eşlemeyle sizi nerede sandığı
        const el = calDotRef.current;
        if (el) { const c = tmpCal.current; if (f && c) { if (!frozen) { const q = smooth(c, f, dt, W, H); el.style.display = 'block'; el.style.transform = `translate(${q.x}px,${q.y}px)`; } } else el.style.display = 'none'; }
        return;
      }
      if (run) {
        const el = now - run.t0;
        if (!f) { run.t0 = now; run.acc = []; run.msg = 'Yüzünüz görünmüyor.'; }
        else {
          if (el >= 1200 && el < 2600) { run.acc.push(f); run.msg = ''; }
          if (el >= 2600) {
            if (run.acc.length < 8) { run.t0 = now; run.acc = []; run.msg = 'Sabit bakın, tekrar.'; }
            else {
              const m = run.acc.reduce((a, q) => ({ nx: a.nx + q.nx, ny: a.ny + q.ny, yaw: a.yaw + q.yaw, pitch: a.pitch + q.pitch, gx: a.gx + q.gx, gy: a.gy + q.gy }), { nx: 0, ny: 0, yaw: 0, pitch: 0, gx: 0, gy: 0 }), k = run.acc.length;
              run.pts.push({ f: { nx: m.nx / k, ny: m.ny / k, yaw: m.yaw / k, pitch: m.pitch / k, gx: m.gx / k, gy: m.gy / k }, x: TARGETS[run.idx][0] * W, y: TARGETS[run.idx][1] * H });
              run.idx++; run.t0 = now; run.acc = []; run.msg = '';
              if (run.idx >= TARGETS.length) {
                const cal = calibrate(run.pts, W, H);
                if (cal) { calRef.current = cal; try { localStorage.setItem(CAL_KEY, JSON.stringify(cal)); } catch { /* yoksay */ } setHasCal(true); calRun.current = null; calMode.current = null; setCalUi(null); setStatus('Kalibrasyon tamam.'); setTimeout(() => setStatus(s => (s === 'Kalibrasyon tamam.' ? '' : s)), 2000); }
                else { run.idx = 0; run.pts = []; run.msg = 'Kalibrasyon tutarsız çıktı, baştan başlıyoruz. Başınızı noktalara doğru belirgin çevirin.'; }
              }
            }
          }
        }
        if (calRun.current) setCalUi({ mode: 'auto', idx: calRun.current.idx, prog: clamp((now - calRun.current.t0) / 2600, 0, 1), msg: calRun.current.msg });
        return;
      }
      const cal = calRef.current, p = ptr.current;
      if (!f || !cal) { if (p.src === 'head' && now - p.seen > 500) p.active = false; return; }
      if (frozen) { if (p.active && gate.held) { p.x = gate.held.x; p.y = gate.held.y; p.seen = now; } return; } // göz kırpma: son iyi konumda bekle
      const q = smooth(cal, f, dt, W, H);
      p.x = q.x; p.y = q.y; p.active = true; p.src = 'head'; p.seen = now; gate.record(now, q.x, q.y);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); try { stream?.getTracks().forEach(t => t.stop()); } catch { /* yoksay */ } if (ptr.current.src === 'head') ptr.current.active = false; };
  }, [mode]);

  // ---- el kontrolü: işaret parmağı = imleç (1 sn bekleyince açar) · yumruk = okurken kaydır · barış işareti = uzaya dön
  useEffect(() => {
    if (mode !== 'hand') { if (ptr.current.src === 'hand') ptr.current.active = false; return; }
    let alive = true, raf = 0, stream: MediaStream | null = null, lm: import('@mediapipe/tasks-vision').HandLandmarker | null = null, lastVT = -1, lastDet = 0, lastT = performance.now();
    let fistSince = 0, fistLy = 0, peaceSince = 0, peaceDone = false;
    const bank = new HandBank(); const video = videoRef.current!;
    (async () => {
      try {
        setStatus('Kamera açılıyor…'); stream = await openCamera(video); if (!alive) return;
        if (!landmarkerReady()) setStatus('El takip modeli yükleniyor…');
        const r = await loadLandmarker(); if (!alive) return; lm = r.lm; setStatus('');
      } catch (e: any) { setStatus(String(e?.name) === 'NotAllowedError' ? 'Kamera izni verilmedi.' : `El takibi başlatılamadı (${e?.message || e?.name}).`); setMode('mouse'); }
    })();
    const loop = () => {
      if (!alive) return; raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (!lm || video.readyState < 2 || video.currentTime === lastVT || now - lastDet < 30) return;
      lastVT = video.currentTime; lastDet = now;
      let raws: P[][] = []; try { raws = detect(lm, video, now, window.innerWidth, window.innerHeight); } catch { raws = []; }
      let pointing = false;
      for (const { hand } of bank.update(raws, now, dt)) {
        const s = hand.shape, f = s.fingers;
        if (f[1] && !f[2] && !f[3] && !f[4]) { pointing = true; const p = ptr.current; p.x = s.tip.x; p.y = s.tip.y; p.active = true; p.src = 'hand'; p.seen = now; }
        const fist = !f[1] && !f[2] && !f[3] && !f[4];
        if (fist && bodyRef.current) {
          if (!fistSince) { fistSince = now; fistLy = s.palm.y; } else if (now - fistSince > 250) { bodyRef.current.scrollTop -= (s.palm.y - fistLy) * 2.4; fistLy = s.palm.y; }
        } else fistSince = 0;
        if (hand.gesture === 'zafer') { if (!peaceSince) peaceSince = now; else if (!peaceDone && now - peaceSince > 700) { peaceDone = true; cbRef.current.onBack(); } } else { peaceSince = 0; peaceDone = false; }
      }
      if (!pointing && ptr.current.src === 'hand' && now - ptr.current.seen > 300) ptr.current.active = false;
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); try { stream?.getTracks().forEach(t => t.stop()); } catch { /* yoksay */ } if (ptr.current.src === 'hand') ptr.current.active = false; };
  }, [mode]);

  const cur = notes.find(x => x.path === reader) || (reader ? { path: reader, title: titleOf(reader), folder: folderOf(reader), hue: hueOf(folderOf(reader)), tags: [], outline: [], excerpt: '', words: 0 } : null);
  const rl = useMemo(() => (reader ? resolveLinks(files, reader) : { out: [], back: [] }), [files, reader]);
  const ci = calUi && calUi.mode === 'auto' ? Math.min(calUi.idx, TARGETS.length - 1) : 0;

  return (
    <div className="st-root" data-agent-ignore="1" role="dialog" aria-label="Çalışma masası"
      onPointerMove={(e) => { if (e.pointerType === 'mouse' && modeRef.current === 'mouse') { ptr.current.src = 'mouse'; ptr.current.active = false; } }}>
      <style>{CSS}</style>
      <video ref={videoRef} muted playsInline style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }} />
      <div className="st-top">
        <span className="st-title">Çalışma masası · {n} not</span>
        {status && <span style={{ color: '#ffd37f' }}>{status}</span>}
        <button type="button" className="st-btn" onClick={() => cbRef.current.onBack()} aria-label="Uzaya dön"><ArrowLeft size={14} /> Uzaya dön</button>
        <button type="button" className={`st-btn${mode === 'mouse' ? ' on' : ''}`} onClick={() => chooseMode('mouse')} aria-pressed={mode === 'mouse'} aria-label="Fare ile kontrol"><MousePointer2 size={13} /> Fare</button>
        <button type="button" className={`st-btn${mode === 'hand' ? ' on' : ''}`} onClick={() => chooseMode('hand')} aria-pressed={mode === 'hand'} aria-label="El ile kontrol"><Hand size={13} /> El</button>
        <button type="button" className={`st-btn${mode === 'head' ? ' on' : ''}`} onClick={() => chooseMode('head')} aria-pressed={mode === 'head'} aria-label="Baş ile kontrol"><ScanFace size={14} /> Baş</button>
        {mode === 'head' && <button type="button" className="st-btn" onClick={() => startManual()} aria-label="Kalibre et">{hasCal ? 'Kalibrasyonu ayarla' : 'Kalibre et'}</button>}
        <button type="button" className="st-btn" onClick={() => cbRef.current.onClose()} aria-label="Kapat"><X size={14} /></button>
      </div>

      {n === 0 ? (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', color: '#7fb8cc' }}>Rafta not yok. Uzayda kartlara "+" ile rafa not toplayın.</div>
      ) : (
        <>
          <svg className="st-lines" width="100%" height="100%">
            {lines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(255,209,102,.65)" strokeWidth={2.2} strokeDasharray="6 5" />)}
          </svg>
          <div ref={gridRef} className="st-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${cw}px))`, gridTemplateRows: `repeat(${rows}, minmax(0, ${ch}px))` }}>
            {notes.map((x, i) => (
              <div key={x.path} ref={el => { cardEls.current[i] = el; }} className="st-card" data-idx={i} style={{ ['--h' as any]: x.hue }} onClick={() => openAt(i)}>
                <span className="st-num">{(i + 1) % 10}</span>
                {x.folder && <div className="st-fold">{x.folder}</div>}
                <div className="st-ct">{x.title}</div>
                {x.tags.length > 0 && <div className="st-tags">{x.tags.map(t => <span key={t}>#{t}</span>)}</div>}
                {x.outline.length > 0 && <ul className="st-ol">{x.outline.map((o, k) => <li key={k}>{o}</li>)}</ul>}
                <div className="st-ex">{x.excerpt || 'Bu notta metin yok.'}</div>
                <div className="st-ln">{x.words} kelime{linkCount[i] ? ` · ${linkCount[i]} bağlantı` : ''}</div>
              </div>
            ))}
          </div>
          <div className="st-hint">Karta tıkla ya da burnunla/işaret parmağınla ~2 sn bak: büyüyerek açılır · 1-9,0: o kartı aç · Esc: uzaya dön</div>
        </>
      )}

      {cur && (
        <>
          <div className="st-backdrop" onClick={() => setReader(null)} />
          <div className="st-mwrap">
            <div className="st-modal" ref={modalRef} role="dialog" aria-label={cur.title}>
              <div className="st-rh">
                <button type="button" className="st-btn" onClick={() => setReader(null)} aria-label="Masaya dön"><ArrowLeft size={14} /> Masaya dön</button>
                <button type="button" className="st-btn" onClick={() => step(-1)} aria-label="Önceki not" disabled={!notes.some(x => x.path === cur.path)}><ChevronLeft size={16} /> Önceki</button>
                <button type="button" className="st-btn" onClick={() => step(1)} aria-label="Sonraki not" disabled={!notes.some(x => x.path === cur.path)}>Sonraki <ChevronRight size={16} /></button>
                <div className="st-rt" title={cur.path}>{cur.title}</div>
                <button type="button" className="st-btn" onClick={() => cbRef.current.onOpenInApp(cur.path)} aria-label="Notlar ekranında aç ve düzenle"><ExternalLink size={13} /> Düzenle</button>
              </div>
              <div className="st-rb" ref={bodyRef}><NoteText text={files[cur.path] || ''} big /></div>
              {(rl.out.length > 0 || rl.back.length > 0) && (
                <div className="st-rl">
                  {rl.out.length > 0 && <><span style={{ opacity: 0.6 }}>Verdiği bağlantılar:</span>{rl.out.slice(0, 8).map(q => <button key={q} type="button" className="st-fchip" onClick={() => { fromRect.current = null; setReader(q); }}>{titleOf(q)}</button>)}</>}
                  {rl.back.length > 0 && <><span style={{ opacity: 0.6, marginLeft: 8 }}>Ona bağlananlar:</span>{rl.back.slice(0, 8).map(q => <button key={q} type="button" className="st-fchip" onClick={() => { fromRect.current = null; setReader(q); }}>{titleOf(q)}</button>)}</>}
                </div>
              )}
              <div className="st-rhint">Yazının alt kenarına bakınca aşağı, üst kenarına bakınca yukarı kayar · Modal dışına (arka masaya) 1,5 sn bakınca kapanır · Esc: kapat</div>
            </div>
          </div>
        </>
      )}

      {calUi && calUi.mode === 'auto' && (
        <div className="st-cal" data-agent-ignore="1">
          <div className="st-cal-t">Otomatik kalibrasyon {ci + 1}/{TARGETS.length}</div>
          <div className="st-cal-m">Başınızı hafifçe çevirip burnunuzla yeşil noktayı gösterin ve sabit tutun. Her nokta yaklaşık 2,5 saniye sürer.{calUi.msg ? ` ${calUi.msg}` : ''}</div>
          <div className="st-cal-dot" style={{ left: `${TARGETS[ci][0] * 100}%`, top: `${TARGETS[ci][1] * 100}%`, background: `conic-gradient(rgba(127,255,212,.45) ${Math.round(calUi.prog * 360)}deg, transparent 0)` }}><i /></div>
          <button type="button" className="st-btn" style={{ marginTop: 18 }} onClick={cancelCal}>İptal</button>
        </div>
      )}
      {calUi && calUi.mode === 'manual' && (
        <div className="st-cal st-calm" data-agent-ignore="1"
          onPointerMove={(e) => { mousePos.current = { x: e.clientX, y: e.clientY }; }}
          onPointerDown={(e) => { if (e.button !== 0 || (e.target as HTMLElement).closest('.st-calp')) return; mousePos.current = { x: e.clientX, y: e.clientY }; markPoint(e.clientX, e.clientY); }}>
          {SUG.map(([a, b]) => [a * window.innerWidth, b * window.innerHeight] as const).filter(([sx, sy]) => !marks.some(m => Math.hypot(m.x - sx, m.y - sy) < 90)).map(([sx, sy], i) => <span key={`s${i}`} className="st-sug" style={{ left: sx, top: sy }} />)}
          {marks.map((m, i) => <span key={i} className="st-mark" style={{ left: m.x, top: m.y, background: m.err < 80 ? '#46d68c' : m.err < 160 ? '#f5b942' : '#ef5a5a' }} title={`~${Math.round(m.err)} px sapma`} />)}
          <div className="st-calp" style={panelTop ? undefined : { top: 'auto', bottom: 14 }}>
            <div style={{ fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 12, color: '#7fdcff' }}>Kalibrasyonu ayarla · {marks.length} nokta{meanErr !== null ? ` · ortalama sapma ~${Math.round(meanErr)} px` : ''}</div>
            <div style={{ fontSize: 13, color: '#bfe6f4', lineHeight: 1.5 }}>Ekranı 5 dikey banda böldüm. <b>Doğal bakın:</b> bir banttan ötekine geçerken başınızı çevirin, aynı bant içinde gezinirken yalnızca gözlerinizle bakın. Kesikli halkalara tek tek bakıp fareyi <b>tam üstüne</b> götürüp tıklayın (ya da Boşluk): her bantta üst, orta, alt. Sistem <b>bantlar arasında başın, bant içinde gözün</b> payını bu noktalardan öğrenir. Göz kırpma otomatik atlanır; kırparken tıkladıysanız noktayı tekrar işaretleyin. <span style={{ color: '#5cc8ff' }}>Mavi halka</span> sistemin sizi nerede sandığını gösterir. Nokta rengi: yeşil iyi, sarı orta, kırmızı kötü.{calUi.msg ? <span style={{ color: '#ffd37f' }}> {calUi.msg}</span> : null}</div>
            <label className="row" style={{ fontSize: 12.5, color: '#bfe6f4' }}>Göz payı <input type="range" min={0} max={2} step={0.1} value={eyeGain} onChange={(e) => { const v = Number(e.target.value); eyeGainRef.current = v; setEyeGain(v); refit(); }} style={{ width: 160 }} /> <span style={{ width: 34 }}>{eyeGain.toFixed(1)}×</span> <span style={{ opacity: 0.6 }}>(0 = yalnız baş, 1 = öğrenilen, 2 = göze daha çok güven)</span></label>
            <div className="row">
              <button type="button" className="st-btn on" onClick={finishManual}>Bitti, kaydet</button>
              <button type="button" className="st-btn" onClick={undoMark} disabled={!marks.length}>Son noktayı sil</button>
              <button type="button" className="st-btn" onClick={clearMarks} disabled={!marks.length}>Temizle</button>
              <button type="button" className="st-btn" onClick={() => setPanelTop(v => !v)}>{panelTop ? 'Paneli aşağı taşı' : 'Paneli yukarı taşı'}</button>
              <button type="button" className="st-btn" onClick={() => startCal()}>Otomatik 5 nokta</button>
              <button type="button" className="st-btn" onClick={cancelCal}>İptal</button>
            </div>
          </div>
          <div ref={calDotRef} className="st-caldot" />
        </div>
      )}
      <div ref={curRef} className="st-cur" />
    </div>
  );
}
