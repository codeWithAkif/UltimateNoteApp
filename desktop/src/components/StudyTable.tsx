import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, Hand, ExternalLink, ChevronLeft, ChevronRight, ArrowLeft, ScanFace, MousePointer2 } from 'lucide-react';
import NoteText from './NoteText';
import { HandBank, OneEuro, type P } from '../services/hands/gestures';
import { openCamera, loadLandmarker, landmarkerReady, detect } from '../services/hands/tracker';
import { loadFaceLandmarker, faceReady, detectFace, calibrate, fitCal, mapFeat, mapParts, BlinkGate, fitBest, avgFeat, GAZE_NAME, type GazeSrc, type FaceFeat, type FaceCal, type CalPoint, type CalPhase } from '../services/hands/face';
import { fitRecorded, fitPursuit, loadTrain, saveTrain, clearTrain, trainCount, REG_COLS, type RecFrame, type RecMouse, type Sample, type FitResult } from '../services/hands/faceRec';
import { makeBallPath, type BallPath } from '../services/hands/ballPath';
import { titleOf, folderOf, noteTags, outline, excerpt, hueOf, resolveLinks, linkTargets, parseCards } from '../services/noteSpaceUtils';
import DeskObjects, { DESK_OBJECTS_CSS } from './DeskObjects';
import { removeFromDesk, DESK_KIND_LABEL, type DeskItem } from '../services/studyDesk';

// "Çalışma masası": rafa/masaya aldığınız (en çok 10) not, kitap, dil metni ve ezber destesi ayrı bir ekranda, üstten bakılan bir masaya serili büyük kartlar olarak durur ("keşif" kipi).
// Masanın üstünde saat, kum saati, ortam sesi kutusu ve radyo vardır (DeskObjects). Uzaya gitmeden de açılır (StudyDeskHost).
// Az ve büyük hedef olduğu için kaba işaretleme yeterlidir. Tüm girişler tek bir "işaretçi"den geçer: fare doğrudan tıklar; el ve baş gibi kaynaklar
// bir hedefte bekleyince tetikler (halka dolar): kart ~2 sn (baş) / 1 sn (el) → büyüyerek modal olarak açılır ("okuma" kipi).
// Okurken: yazının alt/üst kenarına bakınca kayar; modal dışına (arka masaya) ~1,5 sn bakınca kapanır ve keşif kipine dönülür.
// Not içerikleri yalnızca okunur.

type Mode = 'mouse' | 'hand' | 'head';
interface Ptr { x: number; y: number; active: boolean; src: Mode; key: string; since: number; done: boolean; seen: number; outSince: number }

const CLOSE_MS = 1500; // modal dışına bakınca kapanma süresi
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// Baş kipinde kart bekleyerek AÇILMAZ (yanlışlıkla açılmasın): başı hafifçe sağa eğmek açar. Düğmeler 1,5 sn bekleyince tetiklenir.
const dwellMs = (src: Mode, card: boolean) => (src === 'hand' ? 1000 : card ? Infinity : 1500);
// Uzun soru/cevap taşmasın: metin uzadıkça yazı küçülür (kaydırma yalnızca fareyle mümkün olduğundan önce sığdırılır)
const fitPx = (t: string) => (t.length < 50 ? 22 : t.length < 100 ? 19 : t.length < 170 ? 16 : t.length < 260 ? 14 : t.length < 400 ? 12.5 : 11);
const TILT_ON = 11, TILT_OFF = 5; // derece: sağa eğim eşiği ve yeniden kurulma eşiği (histerezis)
const TARGETS: [number, number][] = [[0.5, 0.5], [0.1, 0.18], [0.9, 0.18], [0.9, 0.86], [0.1, 0.86]];
const CAL_KEY = 'st-head-cal-v1', PTS_KEY = 'st-head-pts-v1';
const GRID_C = 5, GRID_R = 4; // kalibrasyon bantları: 5 dikey bant (bantlar arası = baş, bant içi = göz)
// Önerilen işaret noktaları: her bantta üst/orta/alt, sol-sağ dönüşümlü: bant içi yatay ve dikey göz aralığı ile bantlar arası baş aralığı birlikte örneklenir
const SUG: [number, number][] = Array.from({ length: GRID_C }, (_, b) => [0, 1, 2].map(j => [(b + ((b + j) % 2 ? 0.78 : 0.22)) / GRID_C, [0.12, 0.5, 0.88][j]] as [number, number])).flat();
const loadCal = (): FaceCal | null => { try { const v = JSON.parse(localStorage.getItem(CAL_KEY) || 'null'); return v && Array.isArray(v.ax) && Array.isArray(v.ay) ? v : null; } catch { return null; } };
// Elle işaretlenen noktalar ekran oranı olarak saklanır (pencere boyutu değişse de geçerli kalsın)
const loadPts = (W: number, H: number): CalPoint[] => { try { const v = JSON.parse(localStorage.getItem(PTS_KEY) || '[]'); return Array.isArray(v) ? v.filter((q: any) => q && q.f && Number.isFinite(q.xf) && Number.isFinite(q.yf)).map((q: any) => ({ f: { gx: 0.5, gy: 0.5, ...q.f }, x: q.xf * W, y: q.yf * H, ph: q.ph === 'h' || q.ph === 'e' ? q.ph : 'b' })) : []; } catch { return []; } };

const CSS = `
.st-root{position:absolute;inset:0;z-index:20;background:radial-gradient(ellipse at 50% 30%,#13283a 0%,#04090f 78%);color:#d7f3ff;font-family:'Inter','Segoe UI',system-ui,sans-serif;overflow:hidden;user-select:none}
.st-top{position:absolute;z-index:8;left:0;right:0;top:0;display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;padding:10px 160px 10px 14px;pointer-events:none;font-size:12px}
.st-top>*{pointer-events:auto}
.st-title{letter-spacing:.14em;text-transform:uppercase;color:#7fdcff;font-size:12px}
.st-btn{cursor:pointer;background:rgba(0,40,60,.75);border:1px solid rgba(0,200,255,.4);color:#bfeeff;border-radius:9px;padding:7px 12px;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-family:inherit}
.st-btn:hover{background:rgba(0,120,170,.55)}.st-btn.on{background:rgba(0,150,200,.6);border-color:#7fe6ff}.st-btn:disabled{opacity:.4;cursor:default}
.st-btn.aimed,.st-fchip.aimed{outline:2px solid #7fffd4;box-shadow:0 0 18px rgba(127,255,212,.6)}
/* Üstten bakılan masa: perspektifli bir sahne, içinde öne doğru yatık ahşap düzlem; kartlar düzlemin üstüne serilidir */
.st-stage{position:absolute;left:0;right:0;top:66px;bottom:150px;perspective:1250px;perspective-origin:50% 6%;z-index:2}
.st-plane{position:absolute;left:2%;right:2%;top:0;bottom:0;transform:rotateX(30deg);transform-origin:50% 100%;transform-style:preserve-3d;border-radius:20px;background:repeating-linear-gradient(92deg,rgba(0,0,0,.07) 0 3px,rgba(255,225,170,.035) 3px 9px),linear-gradient(180deg,#5b3a1f,#7a5028 45%,#4a2e16);border:1px solid rgba(255,214,150,.3);box-shadow:0 30px 60px rgba(0,0,0,.6),inset 0 0 70px rgba(0,0,0,.45)}
.st-grid{position:absolute;left:22px;right:22px;top:22px;bottom:22px;display:grid;gap:22px;justify-content:center;align-content:center;transform-style:preserve-3d}
.st-lines{position:absolute;left:22px;right:22px;top:22px;bottom:22px;pointer-events:none}
.st-ballwrap{position:absolute;inset:0;z-index:40;background:#02060a;cursor:none;overflow:hidden}
.st-ball{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:radial-gradient(circle,#fff 0 16%,#7fffd4 18% 38%,rgba(127,255,212,.22) 40% 100%);box-shadow:0 0 26px rgba(127,255,212,.85);will-change:transform}
.st-bhud{position:absolute;left:50%;transform:translateX(-50%);top:14px;max-width:min(860px,94vw);display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:10px 16px;border-radius:14px;background:rgba(4,22,36,.78);border:1px solid rgba(0,200,255,.4);cursor:default;pointer-events:auto}
.st-bhud .p{font-size:17px;font-weight:600;color:#7fffd4}.st-bhud .s{font-size:12px;color:#9fd3e6}
.st-bres{position:absolute;inset:0;z-index:41;background:rgba(1,6,12,.88);display:grid;place-items:center}
.st-bres>div{width:min(640px,94vw);padding:18px 22px;border-radius:16px;background:#041320;border:1px solid rgba(0,200,255,.5);box-shadow:0 0 50px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:10px;font-size:13.5px;color:#cfeeff;line-height:1.5}
.st-heat{display:grid;grid-template-columns:repeat(${REG_COLS},1fr);gap:4px}.st-heat span{padding:9px 4px;text-align:center;border-radius:7px;font-size:13px;font-weight:600;color:#06121c}
.st-rec{position:absolute;z-index:9;left:50%;transform:translateX(-50%);top:46px;max-width:min(880px,94vw);display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:9px 14px;border-radius:12px;background:rgba(40,8,12,.92);border:1px solid rgba(255,110,110,.7);box-shadow:0 0 30px rgba(0,0,0,.6);font-size:12.5px;color:#ffd7d7}
.st-rec i{width:10px;height:10px;border-radius:50%;background:#ff4d4d;animation:stblink 1s infinite}@keyframes stblink{50%{opacity:.25}}
.st-fc{position:relative;flex:1;min-height:120px;perspective:900px}
.st-fcin{position:absolute;inset:0;transform-style:preserve-3d;transition:transform .6s cubic-bezier(.3,.7,.2,1)}
.st-fcin.flip{transform:rotateY(180deg)}
.st-face{position:absolute;inset:0;box-sizing:border-box;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;justify-content:center;gap:8px;background:linear-gradient(160deg,hsla(var(--h),70%,22%,.95),rgba(6,22,36,.95));border:1px solid hsla(var(--h),100%,70%,.5);overflow:hidden}
.st-face.back{transform:rotateY(180deg);background:linear-gradient(160deg,rgba(16,70,50,.95),rgba(6,26,30,.95));border-color:rgba(127,255,212,.6)}
.st-fl{font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.7}
.st-fq{font-weight:600;line-height:1.3;color:#f1fdff;overflow:auto;min-height:0;word-break:break-word}
.st-fnav{margin-left:auto;display:inline-flex;gap:4px}.st-fnav button{cursor:pointer;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.25);color:#d7f3ff;border-radius:7px;padding:2px 12px;font:inherit;font-size:15px}
.st-x{position:absolute;right:46px;top:8px;cursor:pointer;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.25);color:#d7f3ff;border-radius:7px;padding:2px 6px;font-size:11px;font-family:inherit;opacity:0}
.st-card:hover .st-x{opacity:.85}.st-x:hover{background:rgba(200,50,50,.7)}
.st-kind{margin-left:6px;padding:1px 7px;border-radius:999px;border:1px solid hsla(var(--h),100%,70%,.6);font-size:10px;letter-spacing:.08em}
.st-card{position:relative;min-width:0;min-height:0;box-sizing:border-box;padding:16px 18px;border-radius:16px;background:rgba(8,30,46,.94);border:1px solid hsla(var(--h),100%,62%,.55);box-shadow:0 10px 18px rgba(0,0,0,.5),0 0 16px hsla(var(--h),100%,55%,.18);display:flex;flex-direction:column;gap:8px;overflow:hidden;cursor:pointer;transform:translateZ(2px) rotate(var(--r,0deg));transition:transform .18s ease,box-shadow .18s ease,border-color .18s}
.st-card:hover,.st-card.aimed{transform:translateZ(26px) rotate(0deg) scale(1.04);z-index:3;border-color:hsla(var(--h),100%,80%,1);box-shadow:0 0 40px hsla(var(--h),100%,60%,.6)}
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
.st-hint{position:absolute;z-index:4;left:24px;top:46px;font-size:11px;color:#6fa6bb;pointer-events:none}
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

export default function StudyTable({ files, items, onOpenInApp, onBack, onClose, backLabel = 'Uzaya dön' }: { files: Record<string, string>; items: DeskItem[]; onOpenInApp: (path: string) => void; onBack: () => void; onClose: () => void; backLabel?: string }) {
  const notes = useMemo(() => items.slice(0, 10).filter(it => files[it.path] !== undefined).map((it, i) => {
    const p = it.path, text = files[p] || '', folder = folderOf(p);
    return { path: p, kind: it.kind, cards: it.kind === 'cards' ? parseCards(text) : [], rot: ((i * 37) % 7 - 3) * 0.55, title: titleOf(p), folder, hue: hueOf(folder), tags: [...noteTags(text)].slice(0, 6), outline: outline(text), excerpt: excerpt(text, 340), words: text.split(/\s+/).filter(Boolean).length };
  }), [files, items]);
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
  const rollRef = useRef(0); // yumuşatılmış baş eğimi (derece)
  const ptr = useRef<Ptr>({ x: -999, y: -999, active: false, src: 'mouse', key: '', since: 0, done: false, seen: 0, outSince: 0 });
  // Geliştirme sırasında işaretçiyi elle sürmek için (kamerasız deneme); üretim derlemesinde yok
  if ((import.meta as any).env?.DEV) (window as any).__stPtr = ptr.current;
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  // Ezber destesi kartları masada gerçek soru kartı gibi durur: ön yüz soru, çevrilince arka yüz cevap
  const [fc, setFc] = useState<Record<string, { i: number; flip: boolean }>>({});
  // Tek hareketle ilerleme (mikro düğmeye bakmak zor): sağa eğ/tıkla = soru → cevap → sıradaki soru → … ; sola eğ = bir adım geri (cevaptan soruya, sorudan önceki soruya)
  const flipAt = (i: number) => { const x = notes[i]; if (x) setFc(m => { const c = m[x.path] || { i: 0, flip: false }; return { ...m, [x.path]: c.flip ? { i: (c.i + 1) % Math.max(1, x.cards.length), flip: false } : { ...c, flip: true } }; }); };
  const backAt = (i: number) => { const x = notes[i]; if (x && x.cards.length) setFc(m => { const c = m[x.path] || { i: 0, flip: false }; return { ...m, [x.path]: c.flip ? { ...c, flip: false } : { i: (c.i - 1 + x.cards.length) % x.cards.length, flip: false } }; }); };
  const nextAt = (i: number, d: number) => { const x = notes[i]; if (x && x.cards.length) setFc(m => { const c = m[x.path] || { i: 0, flip: false }; return { ...m, [x.path]: { i: (c.i + d + x.cards.length) % x.cards.length, flip: false } }; }); };
  const backRef = useRef(backAt); backRef.current = backAt;
  const openAt = (i: number) => { if (!notes[i]) return; if (notes[i].cards.length) { flipAt(i); return; } fromRect.current = cardEls.current[i]?.getBoundingClientRect() || null; setReader(notes[i].path); };
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
      const g = gridRef.current; if (!g) return;
      const c = cardEls.current.map(e => (e ? { x: e.offsetLeft + e.offsetWidth / 2, y: e.offsetTop + e.offsetHeight / 2 } : null)); // yerleşim koordinatı: eğik düzlemde de doğru
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
  const calMode = useRef<'auto' | 'manual' | 'rec' | 'ball' | null>(null);
  const calRun = useRef<{ idx: number; t0: number; acc: FaceFeat[]; pts: CalPoint[]; msg: string } | null>(null);
  const [calUi, setCalUi] = useState<{ mode: 'auto'; idx: number; prog: number; msg: string } | { mode: 'manual'; msg: string } | null>(null);
  const [marks, setMarks] = useState<{ x: number; y: number; err: number; ph: CalPhase }[]>([]);
  const [showDot, setShowDot] = useState(false); // canlı mavi halka bakışı etkiler (kişi halkayı kovalar): varsayılan kapalı
  const [phase, setPhase] = useState<CalPhase>('b'); // kalibrasyon aşaması: birlikte / yalnız baş / yalnız göz
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const [eyeInfo, setEyeInfo] = useState<{ src: GazeSrc; loo: Partial<Record<GazeSrc, number>> } | null>(null); // seçilen göz sinyali ve her adayın yeni noktalardaki hatası
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
    // Noktalar ham kullanılır: baş çevrilince göz ölçümü de kayar (göz köşelerinin perspektifi); model bu bağı ancak ham veriden öğrenir (aşamaya göre sabitleyince başı çevirince sapıyordu)
    const np = manualPts.current;
    const r = fitBest(np, window.innerWidth, window.innerHeight);
    setEyeInfo(r.cal ? { src: r.src, loo: r.loo } : null);
    if (r.cal) r.cal.eg = eyeGainRef.current;
    tmpCal.current = r.cal;
    const errs = np.map(q => { if (!r.cal) return 0; const m = mapFeat(r.cal, q.f); return Math.hypot(m.x - q.x, m.y - q.y); });
    setMarks(manualPts.current.map((q, i) => ({ x: q.x, y: q.y, err: errs[i], ph: q.ph || 'b' }))); setMeanErr(r.cal && errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null);
  };
  const startManual = () => {
    calRun.current = null; calMode.current = 'manual'; ptr.current.active = false;
    manualPts.current = loadPts(window.innerWidth, window.innerHeight); tmpCal.current = calRef.current;
    setCalUi({ mode: 'manual', msg: '' }); refit();
  };
  const startCal = () => { calMode.current = 'auto'; calRun.current = { idx: 0, t0: performance.now(), acc: [], pts: [], msg: '' }; setCalUi({ mode: 'auto', idx: 0, prog: 0, msg: '' }); ptr.current.active = false; };
  // ---- çalışarak kalibrasyon: masada çalışırken fare bakışın peşinden sürülür; kare özellikleri ve fare konumu kaydedilir, sonra kayıttan model çıkarılır (faceRec.ts)
  const REC_SEC = 120;
  const recRef = useRef<{ t0: number; frames: RecFrame[]; mouse: RecMouse[] } | null>(null);
  const [recUi, setRecUi] = useState<{ sec: number; n: number } | null>(null);
  const startRec = () => {
    calRun.current = null; tmpCal.current = null; calMode.current = 'rec'; ptr.current.active = false;
    recRef.current = { t0: performance.now(), frames: [], mouse: [] }; setCalUi(null); setRecUi({ sec: 0, n: 0 });
  };
  const cancelCal = () => { calRun.current = null; calMode.current = null; tmpCal.current = null; recRef.current = null; setRecUi(null); ballRef.current = null; setBallUi(null); setCalUi(null); };
  const finishRec = () => {
    const r = recRef.current; recRef.current = null; calMode.current = null; setRecUi(null);
    const say = (m: string, ms = 9000) => { setStatus(m); setTimeout(() => setStatus(x => (x === m ? '' : x)), ms); };
    if (!r) return;
    say('Kayıt hesaplanıyor…', 4000);
    setTimeout(() => {
      const W = window.innerWidth, H = window.innerHeight, { res, why } = fitRecorded(r.frames, r.mouse, W, H);
      if (!res) { say(why === 'yayilim' ? 'Fare ekranın yeterince geniş bölümüne gitmedi (ya da bakışla uyuşmadı). Fareyi bakışınızın peşinden ekranın her yerine sürerek tekrar kaydedin.' : 'Yeterli kayıt yok: yüzünüz görünmedi ya da fare çok az kullanıldı. En az ~1 dakika fareyi bakışınızın peşinden sürün.', 12000); return; }
      res.cal.eg = eyeGainRef.current; calRef.current = res.cal; setHasCal(true);
      try { localStorage.setItem(CAL_KEY, JSON.stringify(res.cal)); } catch { /* yoksay */ }
      say(`Kayıttan kalibrasyon kaydedildi: ${res.used}/${res.total} örnek · fare gecikmesi ${res.lag} ms · göz sinyali: ${GAZE_NAME[res.src]} · model ${res.k} katsayı · yeni zaman bloklarında tahmini sapma ~${Math.round(res.cv)} px`, 14000);
    }, 30);
  };
  const finishRecRef = useRef(finishRec); finishRecRef.current = finishRec;

  // ---- top takibi kalibrasyonu: ekranın her yerine/köşesine giden topu gözle izlersiniz, duruşunuzu zaman zaman değiştirirsiniz (yönergeler çıkar).
  // Topun konumu bilindiği için etiket kusursuzdur; 30 sn'de bir ara eğitim yapılıp tahmini doğruluk gösterilir. Sonuç onayınızla kaydedilir; veri biriktirilebilir.
  const POSTURES = ['Rahat ve doğal oturun', 'Başınızı sola çevirerek izleyin', 'Başınızı sağa çevirerek izleyin', 'Çenenizi biraz kaldırın', 'Çenenizi biraz indirin', 'Ekrana biraz yaklaşın', 'Biraz geri yaslanın', 'Başınızı hafifçe sola yatırın (kulak omza)', 'Başınızı hafifçe sağa yatırın', 'Başınız sabit, yalnızca gözlerinizle izleyin', 'Başınızı serbest bırakın, nasıl isterse hareket etsin'];
  const POSTURE_SEC = 25, BALL_M = 28;
  const ballRef = useRef<{ t0: number; dur: number; path: BallPath; frames: RecFrame[]; W: number; H: number; lastF: number; lastTrain: number; busy: boolean } | null>(null);
  const ballEl = useRef<HTMLDivElement>(null);
  const [ballUi, setBallUi] = useState<{ sec: number; dur: number; n: number; prompt: string; q: string; face: boolean } | null>(null);
  const [ballRes, setBallRes] = useState<{ res: FitResult; fresh: Sample[]; prior: Sample[]; W: number; H: number; withPrior: boolean } | null>(null);
  const ballPos = (b: { path: BallPath; W: number; H: number }) => (tm: number) => { const q = b.path.pos(tm); return { x: BALL_M + q.x * (b.W - 2 * BALL_M), y: BALL_M + q.y * (b.H - 2 * BALL_M) }; };
  const startBall = (min: number) => {
    const W = window.innerWidth, H = window.innerHeight, dur = min * 60000;
    calRun.current = null; tmpCal.current = null; calMode.current = 'ball'; ptr.current.active = false; setBallRes(null);
    ballRef.current = { t0: performance.now(), dur, path: makeBallPath(dur, Date.now() & 0xffffff), frames: [], W, H, lastF: 0, lastTrain: 0, busy: false };
    setCalUi(null); setBallUi({ sec: 0, dur: dur / 1000, n: 0, prompt: POSTURES[0], q: '', face: true });
  };
  const calcBall = (withPrior: boolean) => {
    const b = ballRef.current; if (!b) return;
    const prior = withPrior ? loadTrain(b.W, b.H) : [];
    const { res, samples, why } = fitPursuit(b.frames, ballPos(b), b.W, b.H, prior);
    if (!res) { const m = why === 'az' ? 'Yeterli kayıt yok: yüzünüz çoğu zaman görünmedi. Işığı ve kamera açısını kontrol edip tekrar deneyin.' : 'Kayıttan model kurulamadı (göz hareketi top ile uyuşmadı). Topu daha dikkatle izleyerek tekrar deneyin.'; setStatus(m); setTimeout(() => setStatus(x => (x === m ? '' : x)), 12000); ballRef.current = null; return; }
    setBallRes({ res, fresh: samples, prior, W: b.W, H: b.H, withPrior });
  };
  const finishBall = () => { const b = ballRef.current; calMode.current = null; setBallUi(null); if (!b) return; setStatus('Kayıt hesaplanıyor…'); setTimeout(() => { calcBall(true); setStatus(x => (x === 'Kayıt hesaplanıyor…' ? '' : x)); }, 30); };
  const finishBallRef = useRef(finishBall); finishBallRef.current = finishBall;
  const acceptBall = () => {
    const r = ballRes; if (!r) return;
    r.res.cal.eg = eyeGainRef.current; calRef.current = r.res.cal; setHasCal(true);
    try { localStorage.setItem(CAL_KEY, JSON.stringify(r.res.cal)); } catch { /* yoksay */ }
    saveTrain([...r.prior, ...r.fresh], r.W, r.H);
    const m = `Top takibi kalibrasyonu kaydedildi (tahmini sapma ~${Math.round(r.res.cv)} px). Eğitim verisi saklandı; sonraki oturum bununla birleşir.`; setStatus(m); setTimeout(() => setStatus(x => (x === m ? '' : x)), 9000);
    setBallRes(null); ballRef.current = null;
  };
  useEffect(() => {
    if (!ballUi) return;
    let raf = 0, alive = true, lastUi = 0;
    const loop = () => {
      if (!alive) return; raf = requestAnimationFrame(loop);
      const b = ballRef.current; if (!b) return;
      const now = performance.now(), el = now - b.t0, q = ballPos(b)(el);
      if (ballEl.current) ballEl.current.style.transform = `translate(${q.x}px,${q.y}px)`;
      if (el >= b.dur) { alive = false; finishBallRef.current(); return; }
      if (now - lastUi > 500) {
        lastUi = now;
        // ara eğitim: 30 sn'de bir (en az 60 sn veriden sonra) arka planda hesaplanır ve tahmini doğruluk gösterilir
        if (!b.busy && el > 60000 && now - b.lastTrain > 30000 && b.frames.length > 300) {
          b.busy = true; b.lastTrain = now;
          setTimeout(() => { const bb = ballRef.current; if (!bb) return; const r = fitPursuit(bb.frames.slice(), ballPos(bb), bb.W, bb.H).res; bb.busy = false; if (r) setBallUi(u => (u ? { ...u, q: `Ara eğitim: yeni zaman bloklarında tahmini sapma ~${Math.round(r.cv)} px (${r.total} örnek)` } : u)); }, 20);
        }
        setBallUi(u => (u ? { ...u, sec: el / 1000, n: b.frames.length, prompt: POSTURES[Math.floor(el / 1000 / POSTURE_SEC) % POSTURES.length], face: now - b.lastF < 800 } : u));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [!!ballUi]);
  useEffect(() => {
    if (!recUi) return;
    const mv = (e: PointerEvent) => { if (e.pointerType !== 'touch') recRef.current?.mouse.push({ t: performance.now(), x: e.clientX, y: e.clientY }); };
    window.addEventListener('pointermove', mv, true);
    const iv = setInterval(() => { const r = recRef.current; if (!r) return; const sec = (performance.now() - r.t0) / 1000; if (sec >= REC_SEC) finishRecRef.current(); else setRecUi({ sec, n: r.frames.length }); }, 500);
    return () => { window.removeEventListener('pointermove', mv, true); clearInterval(iv); };
  }, [!!recUi]);
  const markPoint = (x: number, y: number) => {
    const buf = featBuf.current;
    if (buf.length < 5 || performance.now() - lastFeatT.current > 600) { setCalUi({ mode: 'manual', msg: 'Yüzünüz görünmüyor, kameraya bakın ve tekrar işaretleyin.' }); return; }
    const last = buf.slice(-12), k = last.length; // son ~0,4 sn ortalaması: tek karelik titremeyi yutar
    const f = avgFeat(last); // tüm aday göz sinyalleri dahil
    manualPts.current.push({ f, x, y, ph: phaseRef.current }); refit(); setCalUi({ mode: 'manual', msg: '' });
  };
  const undoMark = () => { manualPts.current.pop(); refit(); };
  const clearMarks = () => { manualPts.current = []; tmpCal.current = null; setMarks([]); setMeanErr(null); };
  const finishManual = () => {
    const r = fitBest(manualPts.current, window.innerWidth, window.innerHeight);
    if (!r.cal) { setCalUi({ mode: 'manual', msg: 'En az 4 nokta işaretleyin ve ekranın geniş bölümüne yayın (köşeler ve orta).' }); return; }
    r.cal.eg = eyeGainRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    calRef.current = r.cal; setHasCal(true);
    try { localStorage.setItem(CAL_KEY, JSON.stringify(r.cal)); localStorage.setItem(PTS_KEY, JSON.stringify(manualPts.current.map(q => ({ f: q.f, xf: q.x / W, yf: q.y / H, ph: q.ph || 'b' })))); } catch { /* yoksay */ }
    calMode.current = null; tmpCal.current = null; setCalUi(null);
    const msg = `Kalibrasyon kaydedildi (${manualPts.current.length} nokta, ortalama sapma ~${Math.round(r.mean)} px).`; setStatus(msg); setTimeout(() => setStatus(x => (x === msg ? '' : x)), 3500);
  };
  const markRef = useRef(markPoint); markRef.current = markPoint;
  const startCalRef = useRef(startCal); startCalRef.current = startCal;
  const startManualRef = useRef(startManual); startManualRef.current = startManual;
  if ((import.meta as any).env?.DEV) (window as any).__stCal = { ball: (m: number) => startBall(m), start: () => startManualRef.current(), mark: (x: number, y: number) => markRef.current(x, y), feed: (f: FaceFeat) => { featBuf.current.push(f); if (featBuf.current.length > 14) featBuf.current.shift(); lastFeatT.current = performance.now(); } };

  // ---- işaretçi döngüsü: kaynağı (el/baş) bir hedefte bekleyince tetikler; okurken kenara bakınca kaydırır; modal dışına bakınca kapatır
  useEffect(() => {
    let raf = 0, alive = true, aimed: HTMLElement | null = null, tiltArmed = true, tiltSince = 0, tiltCard = -1, leftArmed = true;
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
        prog = key && !p.done && need !== Infinity ? clamp((now - p.since) / need, 0, 1) : 0;
        if (p.src === 'head' && !rd) { // eğerek açma: eğilmeden önce bakılan kart açılır (eğerken imleç kaysa da kart değişmesin)
          const r = rollRef.current;
          if (r < TILT_OFF && r > -TILT_OFF) { tiltArmed = true; tiltSince = 0; tiltCard = card ? Number(card.dataset.idx) : -1; }
          else if (tiltCard >= 0) prog = clamp((r - TILT_OFF) / (TILT_ON - TILT_OFF), 0, 1);
          if (r > -TILT_OFF) leftArmed = true; else if (r < -TILT_ON && leftArmed && tiltCard >= 0) { leftArmed = false; backRef.current(tiltCard); }
          if (r > TILT_ON && tiltCard >= 0) { if (!tiltSince) tiltSince = now; else if (tiltArmed && now - tiltSince > 180) { tiltArmed = false; openAtRef.current(tiltCard); } } else if (r <= TILT_ON) tiltSince = 0;
        }
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
      if (e.key === 'Escape') { e.stopPropagation(); if (calMode.current === 'rec') { if (readerRef.current) setReader(null); return; } if (calMode.current) cancelCal(); else if (readerRef.current) setReader(null); else cbRef.current.onBack(); return; }
      if (calMode.current === 'manual') { if (e.key === ' ') { e.preventDefault(); markRef.current(mousePos.current.x, mousePos.current.y); } return; }
      if (calMode.current && calMode.current !== 'rec') return;
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
        if (!frozen && f.roll !== undefined) rollRef.current = rollRef.current * 0.6 + f.roll * 0.4;
        if (!frozen) { featBuf.current.push(f); if (featBuf.current.length > 14) featBuf.current.shift(); }
        lastFeatT.current = now;
      }
      const W = window.innerWidth, H = window.innerHeight, run = calRun.current;
      if (calMode.current === 'ball') { const b = ballRef.current; if (b && f) { b.lastF = now; if (!frozen) b.frames.push({ t: now, f }); } return; } // top takibi: yalnız veri toplanır
      if (calMode.current === 'rec') { if (f && !frozen && recRef.current) recRef.current.frames.push({ t: now, f }); return; } // kayıt: imleç sürülmez, yalnız veri toplanır
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
      <style>{CSS}{DESK_OBJECTS_CSS}</style>
      <video ref={videoRef} muted playsInline style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }} />
      <div className="st-top">
        <span className="st-title">Çalışma masası · {n} öğe</span>
        {status && <span style={{ color: '#ffd37f' }}>{status}</span>}
        <button type="button" className="st-btn" onClick={() => cbRef.current.onBack()} aria-label={backLabel}><ArrowLeft size={14} /> {backLabel}</button>
        <button type="button" className={`st-btn${mode === 'mouse' ? ' on' : ''}`} onClick={() => chooseMode('mouse')} aria-pressed={mode === 'mouse'} aria-label="Fare ile kontrol"><MousePointer2 size={13} /> Fare</button>
        <button type="button" className={`st-btn${mode === 'hand' ? ' on' : ''}`} onClick={() => chooseMode('hand')} aria-pressed={mode === 'hand'} aria-label="El ile kontrol"><Hand size={13} /> El</button>
        <button type="button" className={`st-btn${mode === 'head' ? ' on' : ''}`} onClick={() => chooseMode('head')} aria-pressed={mode === 'head'} aria-label="Baş ile kontrol"><ScanFace size={14} /> Baş</button>
        {mode === 'head' && <button type="button" className="st-btn" onClick={() => startManual()} aria-label="Kalibre et">{hasCal ? 'Kalibrasyonu ayarla' : 'Kalibre et'}</button>}
        {mode === 'head' && !recUi && !ballUi && <button type="button" className="st-btn" onClick={() => startBall(5)} aria-label="Top takibiyle kalibre et">Top takibiyle kalibre et (5 dk)</button>}
        {mode === 'head' && !recUi && !ballUi && <button type="button" className="st-btn" onClick={() => startRec()} aria-label="Çalışarak kalibre et">Çalışarak kalibre et (2 dk)</button>}
        <button type="button" className="st-btn" onClick={() => cbRef.current.onClose()} aria-label="Kapat"><X size={14} /></button>
      </div>

      {n === 0 ? (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', color: '#7fb8cc' }}>Masa boş. Not, kitap, dil metni ya da ezber destesinde "Masaya al" düğmesine basın (Not uzayında "+ Raf").</div>
      ) : (
        <>
          <div className="st-stage"><div className="st-plane">
          <svg className="st-lines" width="100%" height="100%">
            {lines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(255,209,102,.8)" strokeWidth={2.4} strokeDasharray="6 5" />)}
          </svg>
          <div ref={gridRef} className="st-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${cw}px))`, gridTemplateRows: `repeat(${rows}, minmax(0, ${ch}px))` }}>
            {notes.map((x, i) => (
              <div key={x.path} ref={el => { cardEls.current[i] = el; }} className="st-card" data-idx={i} style={{ ['--h' as any]: x.hue, ['--r' as any]: `${x.rot}deg` }} onClick={() => openAt(i)}>
                <span className="st-num">{(i + 1) % 10}</span>
                {x.cards.length > 0 ? (() => { const st = fc[x.path] || { i: 0, flip: false }, k = st.i % x.cards.length, c = x.cards[k]; return (<>
                  <div className="st-fold">{x.title}<span className="st-kind">{DESK_KIND_LABEL[x.kind]}</span></div>
                  <div className="st-fc"><div className={`st-fcin${st.flip ? ' flip' : ''}`}>
                    <div className="st-face"><div className="st-fl">Soru</div><div className="st-fq" style={{ fontSize: fitPx(c.q) }}>{c.q}</div></div>
                    <div className="st-face back"><div className="st-fl">Cevap</div><div className="st-fq" style={{ fontSize: fitPx(c.a) }}>{c.a}</div></div>
                  </div></div>
                  <div className="st-ln" style={{ display: 'flex', alignItems: 'center' }}>{k + 1}/{x.cards.length} · Kutu {c.box} · {st.flip ? 'sağa eğ: sonraki' : 'sağa eğ: çevir'}<span className="st-fnav"><button type="button" aria-label="Önceki soru" onClick={(e) => { e.stopPropagation(); backAt(i); }}>‹</button><button type="button" aria-label="Sonraki soru" onClick={(e) => { e.stopPropagation(); nextAt(i, 1); }}>›</button></span></div>
                </>); })() : (<>
                <div className="st-fold">{x.folder}<span className="st-kind">{DESK_KIND_LABEL[x.kind]}</span></div>
                <div className="st-ct">{x.title}</div>
                {x.tags.length > 0 && <div className="st-tags">{x.tags.map(t => <span key={t}>#{t}</span>)}</div>}
                {x.outline.length > 0 && <ul className="st-ol">{x.outline.map((o, k) => <li key={k}>{o}</li>)}</ul>}
                <div className="st-ex">{x.excerpt || 'Bu notta metin yok.'}</div>
                <div className="st-ln">{x.words} kelime{linkCount[i] ? ` · ${linkCount[i]} bağlantı` : ''}</div>
                </>)}
                <button type="button" className="st-x" aria-label="Masadan kaldır" title="Masadan kaldır" onClick={(e) => { e.stopPropagation(); removeFromDesk(x.path); }}>✕</button>
              </div>
            ))}
          </div>
          </div></div>
          <div className="st-hint">Karta tıkla, işaret parmağınla 1 sn göster ya da karta bakıp başını hafifçe sağa eğ: büyüyerek açılır; ezber kartında sağa eğ = çevir, tekrar sağa eğ = sonraki soru, sola eğ = geri · 1-9,0: o kartı aç · Esc: uzaya dön</div>
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
          {SUG.map(([a, b]) => [a * window.innerWidth, b * window.innerHeight] as const).filter(([sx, sy]) => !marks.some(m => m.ph === phase && Math.hypot(m.x - sx, m.y - sy) < 90)).map(([sx, sy], i) => <span key={`s${i}`} className="st-sug" style={{ left: sx, top: sy }} />)}
          {marks.map((m, i) => <span key={i} className="st-mark" style={{ left: m.x, top: m.y, background: m.err < 80 ? '#46d68c' : m.err < 160 ? '#f5b942' : '#ef5a5a', borderColor: m.ph === 'h' ? '#ffb454' : m.ph === 'e' ? '#7fe6ff' : '#fff', borderRadius: m.ph === 'e' ? 4 : '50%' }} title={`${m.ph === 'h' ? 'Baş' : m.ph === 'e' ? 'Göz' : 'Birlikte'} · ~${Math.round(m.err)} px sapma`} />)}
          <div className="st-calp" style={panelTop ? undefined : { top: 'auto', bottom: 14 }}>
            <div style={{ fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 12, color: '#7fdcff' }}>Kalibrasyonu ayarla · {marks.length} nokta{meanErr !== null ? ` · ortalama sapma ~${Math.round(meanErr)} px` : ''}</div>
            {eyeInfo && <div style={{ fontSize: 12, color: '#a9ecff' }}>Göz sinyali: <b>{GAZE_NAME[eyeInfo.src]}</b> seçildi{(Object.entries(eyeInfo.loo) as [GazeSrc, number][]).length > 1 ? ' · yeni noktada tahmini sapma: ' + (Object.entries(eyeInfo.loo) as [GazeSrc, number][]).map(([k, v]) => `${GAZE_NAME[k].split(' (')[0]}${k === 'b' ? '' : k === 'i' ? ' (kapak)' : ' (eksen)'} ~${Math.round(v)} px`).join(' · ') : ''}</div>}
            <div className="row" style={{ gap: 6 }}>
              <span style={{ fontSize: 12, color: '#7fdcff' }}>Aşama:</span>
              <button type="button" className={`st-btn${phase === 'b' ? ' on' : ''}`} onClick={() => setPhase('b')}>Birlikte (doğal)</button>
              <button type="button" className={`st-btn${phase === 'h' ? ' on' : ''}`} onClick={() => setPhase('h')}>1 · Yalnız baş ({marks.filter(m => m.ph === 'h').length})</button>
              <button type="button" className={`st-btn${phase === 'e' ? ' on' : ''}`} onClick={() => setPhase('e')}>2 · Yalnız göz ({marks.filter(m => m.ph === 'e').length})</button>
            </div>
            {phase === 'h' && <div style={{ fontSize: 13, color: '#ffd9a0', lineHeight: 1.5 }}><b>Yalnız baş:</b> gözlerinizi başınıza göre sabit tutun (burnunuzla gösteriyormuş gibi), <b>başınızı çevirerek</b> halkaya bakın ve işaretleyin. En az 5 nokta; ekranın köşelerine ve ortasına dağıtın. Turuncu çerçeveli noktalar baş noktalarıdır.</div>}
            {phase === 'e' && <div style={{ fontSize: 13, color: '#a9ecff', lineHeight: 1.5 }}><b>Yalnız göz:</b> başınızı ekrana dönük ve <b>sabit</b> tutun, yalnızca <b>gözlerinizle</b> halkaya bakın ve işaretleyin. En az 5 nokta. Mavi çerçeveli kare noktalar göz noktalarıdır. Başınızı bir kez ortada, bir kez sağda, bir kez solda sabit tutarak da göz noktaları ekleyin: baş döndükçe göz ölçümünün nasıl kaydığını böyle öğrenir. İkisini bitirince "Bitti, kaydet".</div>}
            {phase === 'b' && <div style={{ fontSize: 13, color: '#bfe6f4', lineHeight: 1.5 }}>Ekranı 5 dikey banda böldüm. <b>Doğal bakın:</b> bir banttan ötekine geçerken başınızı çevirin, aynı bant içinde gezinirken yalnızca gözlerinizle bakın. Kesikli halkalara tek tek bakıp fareyi <b>tam üstüne</b> götürüp tıklayın (ya da Boşluk): her bantta üst, orta, alt. Sistem <b>bantlar arasında başın, bant içinde gözün</b> payını bu noktalardan öğrenir. Göz kırpma otomatik atlanır; kırparken tıkladıysanız noktayı tekrar işaretleyin. İsterseniz "Mavi halka" düğmesiyle sistemin sizi nerede sandığını gösteren canlı halkayı açabilirsiniz (varsayılan kapalı, bakışınızı etkilemesin). Nokta rengi: yeşil iyi, sarı orta, kırmızı kötü.{calUi.msg ? <span style={{ color: '#ffd37f' }}> {calUi.msg}</span> : null}</div>}
            <label className="row" style={{ fontSize: 12.5, color: '#bfe6f4' }}>Göz payı <input type="range" min={0} max={2} step={0.1} value={eyeGain} onChange={(e) => { const v = Number(e.target.value); eyeGainRef.current = v; setEyeGain(v); refit(); }} style={{ width: 160 }} /> <span style={{ width: 34 }}>{eyeGain.toFixed(1)}×</span> <span style={{ opacity: 0.6 }}>(0 = yalnız baş, 1 = öğrenilen, 2 = göze daha çok güven)</span></label>
            <div className="row">
              <button type="button" className="st-btn on" onClick={finishManual}>Bitti, kaydet</button>
              <button type="button" className="st-btn" onClick={undoMark} disabled={!marks.length}>Son noktayı sil</button>
              <button type="button" className="st-btn" onClick={clearMarks} disabled={!marks.length}>Temizle</button>
              <button type="button" className={`st-btn${showDot ? ' on' : ''}`} onClick={() => setShowDot(v => !v)}>Mavi halka: {showDot ? 'açık' : 'kapalı'}</button>
              <button type="button" className="st-btn" onClick={() => setPanelTop(v => !v)}>{panelTop ? 'Paneli aşağı taşı' : 'Paneli yukarı taşı'}</button>
              <button type="button" className="st-btn on" onClick={() => startBall(5)}>Top takibi (5 dk)</button>
              <button type="button" className="st-btn" onClick={() => startBall(10)}>Top takibi (10 dk)</button>
              <button type="button" className="st-btn" onClick={() => startRec()}>Çalışarak kalibre et (2 dk)</button>
              <button type="button" className="st-btn" onClick={() => startCal()}>Otomatik 5 nokta</button>
              <button type="button" className="st-btn" onClick={cancelCal}>İptal</button>
            </div>
          </div>
          {showDot && <div ref={calDotRef} className="st-caldot" />}
        </div>
      )}
      {ballUi && (
        <div className="st-ballwrap" data-agent-ignore="1">
          <div ref={ballEl} className="st-ball" />
          <div className="st-bhud">
            <div className="p">{ballUi.prompt}</div>
            <div className="s">Topu yalnızca gözlerinizle izleyin; başınız duruşa göre kendiliğinden dönebilir, sorun değil. Kalan {Math.floor(Math.max(0, ballUi.dur - ballUi.sec) / 60)}:{String(Math.floor(Math.max(0, ballUi.dur - ballUi.sec) % 60)).padStart(2, '0')} · {ballUi.n} kare{ballUi.face ? '' : ' · YÜZ GÖRÜNMÜYOR: kameraya bakın'}</div>
            {ballUi.q && <div className="s" style={{ color: '#ffd9a0' }}>{ballUi.q}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="st-btn on" onClick={() => finishBall()}>Bitir ve hesapla</button>
              <button type="button" className="st-btn" onClick={cancelCal}>İptal (Esc)</button>
            </div>
          </div>
        </div>
      )}
      {ballRes && (
        <div className="st-bres" data-agent-ignore="1">
          <div>
            <b style={{ fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase', color: '#7fdcff' }}>Top takibi sonucu</b>
            <div>Tahmini sapma (hiç görmediği zaman bloklarında): <b style={{ color: ballRes.res.cv < 80 ? '#7fffd4' : ballRes.res.cv < 140 ? '#ffd37f' : '#ff9d8a' }}>~{Math.round(ballRes.res.cv)} px</b> · eğitim sapması ~{Math.round(ballRes.res.mean)} px</div>
            <div>Göz sinyali: <b>{GAZE_NAME[ballRes.res.src]}</b> · model {ballRes.res.k} katsayı · hedef-bakış gecikmesi {ballRes.res.lag} ms · {ballRes.res.used}/{ballRes.res.total} örnek{ballRes.prior.length ? ` (önceki oturumlardan ${ballRes.prior.length} örnek dahil)` : ''}</div>
            <div style={{ fontSize: 12, color: '#9fd3e6' }}>Ekran bölgelerine göre sapma (px; küçük iyi). Zayıf bölgeler topun orada daha çok durmasıyla düzelir:</div>
            <div className="st-heat">{ballRes.res.region.map((v, i) => <span key={i} style={{ background: v === null ? '#33414d' : v < 60 ? '#46d68c' : v < 110 ? '#f5b942' : '#ef5a5a' }}>{v === null ? '–' : Math.round(v)}</span>)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="st-btn on" onClick={acceptBall}>Kullan ve kaydet</button>
              <button type="button" className="st-btn" onClick={() => { setBallRes(null); ballRef.current = null; }}>At</button>
              {ballRes.prior.length > 0 && <button type="button" className="st-btn" onClick={() => calcBall(false)}>Önceki verisiz hesapla</button>}
              {trainCount() > 0 && <button type="button" className="st-btn" onClick={() => { clearTrain(); setStatus('Saklanan eğitim verisi silindi.'); setTimeout(() => setStatus(x => (x === 'Saklanan eğitim verisi silindi.' ? '' : x)), 4000); }}>Saklanan eğitim verisini sil</button>}
            </div>
          </div>
        </div>
      )}
      {recUi && (
        <div className="st-rec" data-agent-ignore="1">
          <i /><b>Kayıt {Math.floor(recUi.sec / 60)}:{String(Math.floor(recUi.sec % 60)).padStart(2, '0')} / 2:00</b><span>{recUi.n} kare</span>
          <span>Normal çalışın: notları açıp okuyun. <b>Fareyi gözünüzle baktığınız yere götürün</b> (bakışınızın peşinden sürün); başınızı doğal kullanın. Fare durunca o an atlanır.</span>
          <button type="button" className="st-btn on" onClick={() => finishRec()}>Bitir ve hesapla</button>
          <button type="button" className="st-btn" onClick={cancelCal}>İptal</button>
        </div>
      )}
      <DeskObjects />
      <div ref={curRef} className="st-cur" />
    </div>
  );
}
