import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, ExternalLink, Hand, Columns2, Trash2 } from 'lucide-react';
import { HandBank, type P } from '../services/hands/gestures';
import { openCamera, loadLandmarker, landmarkerReady, detect } from '../services/hands/tracker';

// "Not uzayı": tüm notlar derinlikte yüzen kartlar olarak önünüzde durur (klasör başına bir kümede).
// Tekerlek ileri/geri uçurur, sürükleme kaydırır, karta tıklamak sağ panelde açar, "+" ya da kartı alttaki rafa sürüklemek rafa toplar,
// raftakileri "Yan yana aç" ile birlikte okursunuz. El kontrolü isteğe bağlıdır (çimdik = tıkla/tut, iki elle aç-kapa = ileri/geri).
// Not içerikleri yalnızca okunur gösterilir; bu katman hiçbir notu değiştirmez.

interface N { path: string; title: string; folder: string; hue: number; snip: string; X: number; Y: number; Z: number; el: HTMLDivElement | null; match: boolean; vis: boolean; d: number; stamp: number; cls: number; op: string; zi: number }
interface Ptr { id: string; x: number; y: number; down: boolean; mode: 'card' | 'pan' | 'ui' | 'zoom' | 'none'; card: N | null; plus: boolean; sx: number; sy: number; lx: number; ly: number; t0: number; moved: number; scroller: HTMLElement | null; hand: boolean; seen: number; aim?: boolean; swipeAt?: number; latch?: string }

const F = 600, CW = 184, CH = 76, MAXD = 4200, MAXV = 110; // aynı anda en çok MAXV kart çizilir: yüzlerce kart her karede yazılınca kasıyordu
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function buildNodes(files: Record<string, string>): N[] {
  const paths = Object.keys(files).filter(p => p.endsWith('.md') && !p.split('/').some(s => s.startsWith('.'))).slice(0, 900);
  const groups = new Map<string, string[]>();
  for (const p of paths) { const i = p.indexOf('/'); const f = i < 0 ? '' : p.slice(0, i); (groups.get(f) || groups.set(f, []).get(f)!).push(p); }
  const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const out: N[] = [];
  order.forEach(([folder, ps], gi) => {
    const hue = folder ? hash(folder) % 360 : 200;
    // küme merkezi: altın açıyla sarmal; her küme biraz daha derinde
    const ang = gi * 2.399, rad = gi === 0 ? 0 : 420 * Math.sqrt(gi);
    const cx = Math.cos(ang) * rad * 1.5, cy = Math.sin(ang) * rad, cz = 250 + gi * (2600 / Math.max(1, order.length));
    const R = 90 + 62 * Math.sqrt(ps.length);
    ps.forEach(p => {
      const r = rng(hash(p));
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * R;
      const text = files[p] || '';
      const snip = text.replace(/^---[\s\S]*?---\s*/, '').replace(/[#*`>\[\]_]|- \[[ xX]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const base = p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');
      out.push({ path: p, title: base, folder, hue, snip, X: cx + Math.cos(a) * rr * 1.4, Y: cy + Math.sin(a) * rr, Z: cz + (r() - 0.5) * Math.min(R * 0.9, 650), el: null, match: true, vis: false, d: 0, stamp: 0, cls: -1, op: '', zi: 0 });
    });
  });
  return out;
}

// Panelde gösterilen not metni: yalnızca okunur; başlık, madde ve görev işaretleri hafifçe biçimlenir
function NoteText({ text }: { text: string }) {
  const body = text.replace(/^---[\s\S]*?---\s*/, '');
  return (
    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
      {body.split(/\r?\n/).map((ln, i) => {
        const h = /^(#{1,6})\s+(.*)/.exec(ln);
        if (h) return <div key={i} style={{ fontWeight: 600, fontSize: h[1].length === 1 ? 18 : h[1].length === 2 ? 15.5 : 14, margin: '10px 0 4px', color: '#e8fbff' }}>{h[2]}</div>;
        const t = /^(\s*)- \[([ xX])\]\s*(.*)/.exec(ln);
        if (t) return <div key={i} style={{ paddingLeft: t[1].length * 6, display: 'flex', gap: 7, opacity: t[2] === ' ' ? 1 : 0.55 }}><span>{t[2] === ' ' ? '☐' : '☑'}</span><span style={{ textDecoration: t[2] === ' ' ? 'none' : 'line-through' }}>{t[3]}</span></div>;
        const b = /^(\s*)[-*]\s+(.*)/.exec(ln);
        if (b) return <div key={i} style={{ paddingLeft: b[1].length * 6 + 4, display: 'flex', gap: 7 }}><span style={{ opacity: 0.6 }}>•</span><span>{b[2]}</span></div>;
        return <div key={i} style={{ minHeight: ln.trim() ? undefined : 8, overflowWrap: 'anywhere' }}>{ln}</div>;
      })}
    </div>
  );
}

const CSS = `
.ns-root{position:fixed;inset:0;z-index:2147483000;background:radial-gradient(ellipse at 40% 45%,#06223a 0%,#02080f 70%);color:#d7f3ff;font-family:'Inter','Segoe UI',system-ui,sans-serif;overflow:hidden;user-select:none}
.ns-space{position:absolute;inset:0;z-index:0;touch-action:none;cursor:grab;background-image:linear-gradient(rgba(0,200,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(0,200,255,.045) 1px,transparent 1px);background-size:64px 64px}
.ns-space:active{cursor:grabbing}
.ns-card{position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;box-sizing:border-box;padding:8px 10px;border-radius:10px;background:rgba(6,28,44,.86);border:1px solid hsla(var(--h),100%,62%,.5);overflow:hidden;cursor:pointer;will-change:transform,opacity;contain:layout paint style}
.ns-card:hover{border-color:hsla(var(--h),100%,78%,1);box-shadow:0 0 22px hsla(var(--h),100%,60%,.6)}
.ns-card .t{font-size:12.5px;font-weight:600;line-height:1.25;color:#eafcff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:18px}
.ns-card .f{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:hsla(var(--h),100%,75%,.85);margin-bottom:2px}
.ns-card .s{font-size:10.5px;line-height:1.3;color:#9fc7d8;margin-top:3px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ns-card.far .s,.ns-card.far .f{display:none}
.ns-card.sel{border-color:#fff;box-shadow:0 0 34px rgba(255,255,255,.7)}
.ns-card.col{border-color:#ffd166;box-shadow:0 0 24px rgba(255,200,90,.65)}
.ns-plus{position:absolute;right:5px;top:4px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:13px;line-height:1;background:rgba(0,170,230,.25);color:#bfeeff;opacity:0}
.ns-card:hover .ns-plus,.ns-card.col .ns-plus{opacity:1}.ns-card.col .ns-plus{background:#ffd166;color:#241800}
.ns-top{position:absolute;z-index:5;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:10px 14px;pointer-events:none;font-size:12px}
.ns-top>*{pointer-events:auto}
.ns-title{letter-spacing:.14em;text-transform:uppercase;color:#7fdcff;font-size:12px}
.ns-search{display:flex;align-items:center;gap:6px;background:rgba(0,40,60,.7);border:1px solid rgba(0,200,255,.4);border-radius:9px;padding:5px 9px;min-width:220px}
.ns-search input{background:none;border:none;outline:none;color:#e8fbff;font-size:12.5px;width:100%;font-family:inherit;user-select:text}
.ns-btn{cursor:pointer;background:rgba(0,40,60,.7);border:1px solid rgba(0,200,255,.4);color:#bfeeff;border-radius:9px;padding:6px 10px;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-family:inherit}
.ns-btn:hover{background:rgba(0,120,170,.55)}.ns-btn.on{background:rgba(0,150,200,.6);border-color:#7fe6ff}.ns-btn:disabled{opacity:.4;cursor:default}
.ns-tray{position:absolute;z-index:4;left:14px;bottom:14px;max-width:calc(100% - 28px);display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border-radius:14px;background:rgba(4,22,36,.88);border:1px solid rgba(255,200,90,.45);box-shadow:0 0 26px rgba(255,190,70,.14)}
.ns-tray.drop{border-color:#ffd166;box-shadow:0 0 40px rgba(255,200,90,.6)}
.ns-chip{display:inline-flex;align-items:center;gap:6px;max-width:170px;padding:4px 8px;border-radius:8px;background:rgba(255,200,90,.14);border:1px solid rgba(255,200,90,.4);font-size:11.5px;color:#ffe9b8}
.ns-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ns-chip b{cursor:pointer;font-weight:400;opacity:.7}
.ns-panels{position:absolute;z-index:3;right:0;top:0;bottom:0;display:flex;background:rgba(3,16,28,.94);border-left:1px solid rgba(0,200,255,.45);box-shadow:-10px 0 40px rgba(0,0,0,.5)}
.ns-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;border-right:1px solid rgba(0,200,255,.18)}.ns-col:last-child{border-right:none}
.ns-col header{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(0,200,255,.22);margin-top:46px}
.ns-col header .n{flex:1;min-width:0;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ns-col .body{flex:1;overflow:auto;padding:12px 14px 70px;user-select:text}
.ns-ghost{position:fixed;left:0;top:0;pointer-events:none;z-index:2147483200;padding:6px 10px;border-radius:9px;background:rgba(255,200,90,.9);color:#241800;font-size:12px;font-weight:600;display:none;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ns-cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid rgba(120,230,255,.95);pointer-events:none;z-index:2147483300;display:none;box-shadow:0 0 12px rgba(0,200,255,.8)}
.ns-cur.idle{opacity:.35}.ns-cur.down{background:rgba(255,200,90,.55);border-color:#ffd166;width:16px;height:16px;margin:-8px 0 0 -8px}
.ns-hint{position:absolute;right:16px;bottom:8px;font-size:11px;color:#6fa6bb;pointer-events:none;text-align:right}
`;

export default function NoteSpace({ files, onOpenInApp, onClose }: { files: Record<string, string>; onOpenInApp: (path: string) => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const spaceRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const curRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const filesRef = useRef(files); filesRef.current = files;
  const cbRef = useRef({ onOpenInApp, onClose }); cbRef.current = { onOpenInApp, onClose };

  const nodes = useMemo(() => buildNodes(files), [files]);
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const [shelf, setShelf] = useState<string[]>([]);
  const [drop, setDrop] = useState(false);
  const [handsOn, setHandsOn] = useState(() => { try { return localStorage.getItem('ns-hands') === '1'; } catch { return false; } });
  const [status, setStatus] = useState('');
  const openRef = useRef(open); openRef.current = open;
  const shelfRef = useRef(shelf); shelfRef.current = shelf;
  const dirty = useRef(true);
  const cam = useRef({ x: 0, y: 0, z: -140 }), tgt = useRef({ x: 0, y: 0, z: -140 });
  const panelW = useRef(0);
  const act = useRef<{ pdown: (p: Ptr) => void; pmove: (p: Ptr) => void; pup: (p: Ptr) => void; zoomBy: (dz: number) => void }>({ pdown: () => {}, pmove: () => {}, pup: () => {}, zoomBy: () => {} });

  const maxZ = useMemo(() => nodes.reduce((m, n) => Math.max(m, n.Z), 0), [nodes]);
  const maxZRef = useRef(maxZ); maxZRef.current = maxZ;

  const fly = (n: N) => { tgt.current = { x: n.X, y: n.Y, z: n.Z - 480 }; dirty.current = true; };
  const openNotes = (paths: string[]) => { setOpen(paths.slice(0, 4)); const w = Math.min(window.innerWidth * 0.94, Math.min(paths.length, 4) * 430, window.innerWidth * 0.8); panelW.current = paths.length ? w : 0; dirty.current = true; };
  const toggleShelf = (path: string) => setShelf(s => (s.includes(path) ? s.filter(x => x !== path) : [...s, path]));

  // arama: eşleşmeyenler soluklaşır
  useEffect(() => {
    const k = q.trim().toLowerCase();
    for (const n of nodes) n.match = !k || n.title.toLowerCase().includes(k) || (filesRef.current[n.path] || '').toLowerCase().includes(k);
    dirty.current = true;
  }, [q, nodes]);

  useEffect(() => { dirty.current = true; }, [open, shelf]);

  // ---- ana döngü: kamera yumuşakça hedefe gider, yalnızca değişince çizilir
  useEffect(() => {
    const space = spaceRef.current!, root = rootRef.current!;
    let raf = 0, alive = true;
    let frame = 0;
    const render = () => {
      frame++;
      const W = root.clientWidth, H = root.clientHeight, cxs = (W - panelW.current) / 2, cys = H / 2 - 18, c = cam.current;
      const op = new Set(openRef.current), sh = new Set(shelfRef.current);
      // 1) görüş alanındaki adaylar; çok olursa en yakın MAXV tanesi çizilir
      const cand: N[] = [];
      for (const n of nodesRef.current) {
        const d = n.Z - c.z; n.d = d;
        if (d > 30 && d < MAXD) { const s = F / (F + d); const sx = cxs + (n.X - c.x) * s, sy = cys + (n.Y - c.y) * s; if (s > 0.17 && sx > -CW * s && sx < W + CW * s && sy > -CH * s && sy < H + CH * s) cand.push(n); }
      }
      if (cand.length > MAXV) { cand.sort((a, b) => a.d - b.d); cand.length = MAXV; }
      for (const n of cand) {
        const el = n.el; if (!el) continue;
        n.stamp = frame;
        const d = n.d, s = F / (F + d), sx = cxs + (n.X - c.x) * s, sy = cys + (n.Y - c.y) * s;
        if (!n.vis) { el.style.display = ''; n.vis = true; n.cls = -1; n.op = ''; n.zi = 0; }
        el.style.transform = `translate3d(${(sx - CW / 2).toFixed(1)}px,${(sy - CH / 2).toFixed(1)}px,0) scale(${s.toFixed(3)})`;
        const fade = clamp((d - 30) / 120, 0, 1) * clamp(1 - (d - 1700) / 2400, 0.12, 1);
        const o = (n.match ? fade : fade * 0.12).toFixed(2);
        if (o !== n.op) { el.style.opacity = o; n.op = o; }
        const zi = Math.round(100000 - d); if (zi !== n.zi) { el.style.zIndex = String(zi); n.zi = zi; }
        const cls = (s < 0.36 ? 1 : 0) | (op.has(n.path) ? 2 : 0) | (sh.has(n.path) ? 4 : 0) | (n.match ? 8 : 0);
        if (cls !== n.cls) { el.classList.toggle('far', !!(cls & 1)); el.classList.toggle('sel', !!(cls & 2)); el.classList.toggle('col', !!(cls & 4)); el.style.pointerEvents = cls & 8 ? 'auto' : 'none'; n.cls = cls; }
      }
      // 2) bu karede çizilmeyenleri gizle
      for (const n of nodesRef.current) if (n.vis && n.stamp !== frame && n.el) { n.el.style.display = 'none'; n.vis = false; }
    };
    const loop = () => {
      if (!alive) return; raf = requestAnimationFrame(loop);
      const c = cam.current, t = tgt.current;
      const dx = t.x - c.x, dy = t.y - c.y, dz = t.z - c.z;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.4) { c.x += dx * 0.13; c.y += dy * 0.13; c.z += dz * 0.13; dirty.current = true; }
      if (dirty.current) { dirty.current = false; render(); }
    };
    raf = requestAnimationFrame(loop);

    // ---- işaretçi (fare ve el aynı yoldan)
    const cardOf = (el: Element | null): N | null => { const e = el?.closest('.ns-card') as HTMLElement | null; return e ? nodesRef.current.find(n => n.el === e) || null : null; };
    const scrollerAt = (x: number, y: number): HTMLElement | null => {
      let el = document.elementFromPoint(x, y) as HTMLElement | null;
      while (el && el !== document.body) { const o = getComputedStyle(el).overflowY; if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el; el = el.parentElement; }
      return null;
    };
    const ghost = ghostRef.current!;
    const overTray = (x: number, y: number) => !!(document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.ns-tray');
    act.current.pdown = (p) => {
      p.down = true; p.sx = p.lx = p.x; p.sy = p.ly = p.y; p.t0 = performance.now(); p.moved = 0; p.card = null; p.plus = false; p.scroller = null;
      const el = document.elementFromPoint(p.x, p.y);
      if (el && space.contains(el)) { const n = cardOf(el); if (n) { p.mode = 'card'; p.card = n; p.plus = !!el.closest('.ns-plus'); } else p.mode = 'pan'; }
      else { p.mode = 'ui'; p.scroller = scrollerAt(p.x, p.y); }
    };
    act.current.pmove = (p) => {
      if (!p.down) return;
      const mx = p.x - p.lx, my = p.y - p.ly; p.lx = p.x; p.ly = p.y;
      p.moved = Math.max(p.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
      if (p.mode === 'pan') { tgt.current.x -= mx; tgt.current.y -= my; cam.current.x -= mx; cam.current.y -= my; dirty.current = true; }
      else if (p.mode === 'ui' && p.scroller && p.moved > 14) p.scroller.scrollTop -= my;
      else if (p.mode === 'card' && p.card && p.moved > 16) {
        ghost.style.display = 'block'; ghost.textContent = p.card.title; ghost.style.transform = `translate(${p.x + 14}px,${p.y + 10}px)`; setDrop(overTray(p.x, p.y));
      }
    };
    act.current.pup = (p) => {
      if (!p.down) return; p.down = false; ghost.style.display = 'none'; setDrop(false);
      const quick = performance.now() - p.t0 < 900 && p.moved < (p.hand ? 40 : 6);
      if (p.mode === 'card' && p.card) {
        if (p.moved > 16 && overTray(p.x, p.y)) setShelf(s => (s.includes(p.card!.path) ? s : [...s, p.card!.path]));
        else if (quick) { if (p.plus) toggleShelf(p.card.path); else { openNotes([p.card.path]); fly(p.card); } }
      } else if (p.mode === 'ui' && quick) {
        const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
        const t = el?.closest('button,input,a,[role="button"]') as HTMLElement | null;
        if (t) { if (t.tagName === 'INPUT') t.focus(); else t.click(); }
      }
      p.mode = 'none';
    };
    act.current.zoomBy = (dz) => { tgt.current.z = clamp(tgt.current.z + dz, -700, maxZRef.current + 200); dirty.current = true; };

    const mouse: Ptr = { id: 'mouse', x: 0, y: 0, down: false, mode: 'none', card: null, plus: false, sx: 0, sy: 0, lx: 0, ly: 0, t0: 0, moved: 0, scroller: null, hand: false, seen: 0 };
    const mp = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const pd = (e: PointerEvent) => { if (e.button !== 0) return; mp(e); if ((e.ctrlKey || e.shiftKey) && cardOf(e.target as Element)) { toggleShelf(cardOf(e.target as Element)!.path); return; } act.current.pdown(mouse); };
    const pm = (e: PointerEvent) => { mp(e); act.current.pmove(mouse); };
    const pu = (e: PointerEvent) => { mp(e); act.current.pmove(mouse); act.current.pup(mouse); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); act.current.zoomBy(-e.deltaY * 1.1); };
    space.addEventListener('pointerdown', pd); window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu);
    space.addEventListener('wheel', wheel, { passive: false });
    const key = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') { cbRef.current.onClose(); return; }
      if (inInput) { if (e.key === 'Enter') { const m = nodesRef.current.filter(n => n.match); if (m.length && m.length < nodesRef.current.length) { const c = cam.current; m.sort((a, b) => Math.hypot(a.X - c.x, a.Y - c.y, a.Z - c.z) - Math.hypot(b.X - c.x, b.Y - c.y, b.Z - c.z)); fly(m[0]); } } return; }
      if (e.key === 'ArrowUp' || e.key === 'w') act.current.zoomBy(180);
      else if (e.key === 'ArrowDown' || e.key === 's') act.current.zoomBy(-180);
      else if (e.key === 'ArrowLeft' || e.key === 'a') { tgt.current.x -= 160; dirty.current = true; }
      else if (e.key === 'ArrowRight' || e.key === 'd') { tgt.current.x += 160; dirty.current = true; }
    };
    window.addEventListener('keydown', key);
    const rs = () => { dirty.current = true; };
    window.addEventListener('resize', rs);
    return () => {
      alive = false; cancelAnimationFrame(raf);
      space.removeEventListener('pointerdown', pd); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu);
      space.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key); window.removeEventListener('resize', rs);
    };
  }, []);

  // ---- el kontrolü (isteğe bağlı): çimdik = tıkla / tut-sürükle, iki elle aç-kapa = ileri/geri
  useEffect(() => {
    try { localStorage.setItem('ns-hands', handsOn ? '1' : '0'); } catch { /* yoksay */ }
    if (!handsOn) { curRefs.current.forEach(c => { if (c) c.style.display = 'none'; }); return; }
    let alive = true, raf = 0, stream: MediaStream | null = null, lm: import('@mediapipe/tasks-vision').HandLandmarker | null = null, lastVT = -1, lastDet = 0, lastT = performance.now(), prevDist = 0;
    const bank = new HandBank(); const ptrs = new Map<string, Ptr>();
    const video = videoRef.current!;
    (async () => {
      try {
        setStatus('Kamera açılıyor…'); stream = await openCamera(video); if (!alive) return;
        if (!landmarkerReady()) setStatus('El takip modeli yükleniyor…');
        const r = await loadLandmarker(); if (!alive) return; lm = r.lm; setStatus('');
      } catch (e: any) { setStatus(String(e?.name) === 'NotAllowedError' ? 'Kamera izni verilmedi.' : `El takibi başlatılamadı (${e?.message || e?.name}).`); setHandsOn(false); }
    })();
    const loop = () => {
      if (!alive) return; raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (!lm || video.readyState < 2 || video.currentTime === lastVT || now - lastDet < 30) return;
      lastVT = video.currentTime; lastDet = now;
      const W = window.innerWidth, H = window.innerHeight;
      let raws: P[][] = []; try { raws = detect(lm, video, now, W, H); } catch { raws = []; }
      const present = new Set<string>();
      for (const { hand, ev } of bank.update(raws, now, dt)) {
        const id = 'h' + hand.id; present.add(id);
        let p = ptrs.get(id);
        if (!p) { p = { id, x: 0, y: 0, down: false, mode: 'none', card: null, plus: false, sx: 0, sy: 0, lx: 0, ly: 0, t0: 0, moved: 0, scroller: null, hand: true, seen: now }; ptrs.set(id, p); }
        const s = hand.shape, w = clamp((0.6 - s.pinch) / 0.3, 0, 1);
        p.x = s.tip.x * (1 - w) + s.pinchPt.x * w; p.y = s.tip.y * (1 - w) + s.pinchPt.y * w; p.seen = now;
        // Tıklama için el açık olmamalı: orta/yüzük/serçeden en çok biri açık (tam açık elde çimdik tıklama sayılmaz, yanlış tıklamayı önler)
        const f = s.fingers; p.aim = [f[2], f[3], f[4]].filter(Boolean).length <= 1;
        if (p.down && !p.aim && p.mode !== 'zoom') { p.t0 = 0; act.current.pup(p); } // tutarken el açıldı: bırak, tıklama sayma
        if (ev.pinchDown) {
          // ikinci elin çimdiği duruştan bağımsız: iki elle ileri-geri uçmak için
          const other = [...ptrs.values()].find(o => o !== p && o.down && (o.mode === 'pan' || o.mode === 'zoom'));
          if (other) { p.down = true; p.mode = 'zoom'; p.card = null; other.mode = 'zoom'; prevDist = Math.hypot(other.x - p.x, other.y - p.y); }
          else if (p.aim) act.current.pdown(p);
        } else if (p.down) act.current.pmove(p);
        // el hareketleri: açık elle süpürme = kaydır · barış işareti = başa dön · yumruk = panelleri kapat
        const flash = (m: string) => { setStatus(m); setTimeout(() => setStatus(x => (x === m ? '' : x)), 900); };
        const g = hand.gesture, v = hand.vel;
        if (!p.down && g === 'acik' && now - (p.swipeAt || 0) > 500 && Math.max(Math.abs(v.x), Math.abs(v.y)) > 1000) {
          p.swipeAt = now;
          if (Math.abs(v.x) >= Math.abs(v.y)) { tgt.current.x += clamp(-v.x * 0.3, -900, 900); flash(v.x < 0 ? '◀ süpürme' : 'süpürme ▶'); }
          else { tgt.current.y += clamp(-v.y * 0.3, -700, 700); flash(v.y < 0 ? '▲ süpürme' : '▼ süpürme'); }
          dirty.current = true;
        }
        if (g === 'zafer' && now - hand.gestureSince > 600) { if (p.latch !== 'z') { p.latch = 'z'; tgt.current = { x: 0, y: 0, z: -140 }; dirty.current = true; flash('Başa dönüldü'); } }
        else if (g === 'yumruk' && now - hand.gestureSince > 900) { if (p.latch !== 'y') { p.latch = 'y'; if (openRef.current.length) { openNotes([]); flash('Paneller kapandı'); } } }
        else if (g !== 'zafer' && g !== 'yumruk') p.latch = '';
        if (ev.pinchUp) act.current.pup(p);
      }
      for (const [id, p] of ptrs) if (!present.has(id) && now - p.seen > 350) { act.current.pup(p); ptrs.delete(id); }
      // iki elle: eller açılırsa ileri, kapanırsa geri
      const z = [...ptrs.values()].filter(o => o.down && o.mode === 'zoom');
      if (z.length === 2) { const d = Math.hypot(z[0].x - z[1].x, z[0].y - z[1].y); act.current.zoomBy((d - prevDist) * 3.2); prevDist = d; }
      let i = 0;
      for (const p of ptrs.values()) { const c = curRefs.current[i++]; if (!c) continue; c.style.display = 'block'; c.style.transform = `translate(${p.x}px,${p.y}px)`; c.classList.toggle('down', p.down); c.classList.toggle('idle', !p.aim); }
      for (; i < 2; i++) { const c = curRefs.current[i]; if (c) c.style.display = 'none'; }
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); try { stream?.getTracks().forEach(t => t.stop()); } catch { /* yoksay */ } for (const p of ptrs.values()) act.current.pup(p); curRefs.current.forEach(c => { if (c) c.style.display = 'none'; }); };
  }, [handsOn]);

  const cards = useMemo(() => nodes.map(n => (
    <div key={n.path} className="ns-card" ref={el => { n.el = el; }} data-path={n.path} style={{ ['--h' as any]: n.hue, display: 'none' }}>
      <span className="ns-plus">+</span>
      {n.folder && <div className="f">{n.folder}</div>}
      <div className="t">{n.title}</div>
      <div className="s">{n.snip}</div>
    </div>
  )), [nodes]);
  const titleOf = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');

  return (
    <div ref={rootRef} className="ns-root" data-agent-ignore="1" role="dialog" aria-label="Not uzayı">
      <style>{CSS}</style>
      <video ref={videoRef} muted playsInline style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }} />
      <div ref={spaceRef} className="ns-space">{cards}</div>
      <div className="ns-top">
        <span className="ns-title">Not uzayı · {nodes.length} not</span>
        <label className="ns-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Ara (Enter: en yakına uç)" /></label>
        {status && <span style={{ color: '#ffd37f' }}>{status}</span>}
        <button type="button" className={`ns-btn${handsOn ? ' on' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => setHandsOn(v => !v)} aria-pressed={handsOn}><Hand size={13} /> El kontrolü: {handsOn ? 'açık' : 'kapalı'}</button>
        <button type="button" className="ns-btn" onClick={() => cbRef.current.onClose()} aria-label="Kapat"><X size={14} /></button>
      </div>

      {open.length > 0 && (
        <div className="ns-panels" style={{ width: `min(${Math.min(open.length, 4) * 430}px, 94vw, 80vw)` }}>
          {open.map(p => (
            <section key={p} className="ns-col">
              <header>
                <div className="n" title={p}>{titleOf(p)}</div>
                <button type="button" className="ns-btn" style={{ padding: '4px 7px' }} onClick={() => cbRef.current.onOpenInApp(p)} title="Notlar ekranında aç ve düzenle"><ExternalLink size={12} /></button>
                <button type="button" className="ns-btn" style={{ padding: '4px 7px' }} onClick={() => setOpen(o => { const r = o.filter(x => x !== p); openNotes(r); return r; })} aria-label="Paneli kapat"><X size={12} /></button>
              </header>
              <div className="body"><NoteText text={files[p] || ''} /></div>
            </section>
          ))}
        </div>
      )}

      <div ref={trayRef} className={`ns-tray${drop ? ' drop' : ''}`} style={{ maxWidth: open.length ? `calc(100% - ${Math.round(panelW.current) + 28}px)` : undefined }}>
        <span style={{ fontSize: 11.5, color: '#ffd9a0', letterSpacing: '.08em', textTransform: 'uppercase' }}>Raf · {shelf.length}</span>
        {shelf.length === 0 && <span style={{ fontSize: 11.5, color: '#9a8a66' }}>Kartın + işaretine bas ya da kartı buraya sürükle</span>}
        {shelf.map(p => <span key={p} className="ns-chip"><span title={p}>{titleOf(p)}</span><b onClick={() => toggleShelf(p)}>×</b></span>)}
        {shelf.length > 0 && <>
          <button type="button" className="ns-btn" onClick={() => openNotes(shelf)}><Columns2 size={13} /> Yan yana aç ({Math.min(shelf.length, 4)})</button>
          <button type="button" className="ns-btn" onClick={() => setShelf([])} aria-label="Rafı boşalt"><Trash2 size={13} /></button>
        </>}
      </div>
      <div ref={ghostRef} className="ns-ghost" />
      <div ref={el => { curRefs.current[0] = el; }} className="ns-cur" /><div ref={el => { curRefs.current[1] = el; }} className="ns-cur" />
      <div className="ns-hint">El: çimdik = tıkla/tut · açık elle süpür = kaydır · iki el = ileri-geri · barış işareti = başa dön · yumruk = paneller kapansın · Tekerlek / ↑↓: ileri-geri · Sürükle: kaydır · Tıkla: aç · Ctrl+tık: rafa al · Esc: kapat</div>
    </div>
  );
}
