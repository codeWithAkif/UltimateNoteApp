import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, ExternalLink, Hand, Columns2, Trash2, Filter, LayoutGrid } from 'lucide-react';
import NoteText from './NoteText';
import StudyTable from './StudyTable';
import { noteTags, folderOf } from '../services/noteSpaceUtils';
import { HandBank, type P } from '../services/hands/gestures';
import { openCamera, loadLandmarker, landmarkerReady, detect } from '../services/hands/tracker';

// "Not uzayı": tüm notlar derinlikte yüzen kartlar olarak önünüzde durur (klasör başına bir kümede).
// Tekerlek ileri/geri uçurur, sürükleme kaydırır, karta tıklamak sağ panelde açar, "+" ya da kartı alttaki rafa sürüklemek rafa toplar,
// raftakileri "Yan yana aç" ile birlikte okursunuz. El kontrolü isteğe bağlıdır (çimdik = tıkla/tut, iki elle aç-kapa = ileri/geri).
// Not içerikleri yalnızca okunur gösterilir; bu katman hiçbir notu değiştirmez.

interface N { path: string; title: string; folder: string; hue: number; snip: string; X: number; Y: number; Z: number; el: HTMLDivElement | null; match: boolean; vis: boolean; d: number; stamp: number; cls: number; op: string; zi: number; sx: number; sy: number; fd: number }
interface Ptr { id: string; x: number; y: number; down: boolean; mode: 'card' | 'pan' | 'ui' | 'zoom' | 'none'; card: N | null; plus: boolean; sx: number; sy: number; lx: number; ly: number; t0: number; moved: number; scroller: HTMLElement | null; hand: boolean; seen: number; aim?: boolean; latch?: string; fistSince?: number; fistLost?: number; pointing?: boolean; dwellKey?: string; dwellSince?: number; dwellDone?: boolean; dwellP?: number; aimEl?: HTMLElement | null; grab?: { lx: number; ly: number; s0: number; z0: number; n: number; rs: number } | null }

const F = 600, CW = 184, CH = 76, MAXD = 4200, MAXV = 110, NEAR = -280; // NEAR: kamera düzleminin önüne kadar (kart ~1,9 kat büyür) görünür, yakın kart solmaz // aynı anda en çok MAXV kart çizilir: yüzlerce kart her karede yazılınca kasıyordu
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
      out.push({ path: p, title: base, folder, hue, snip, X: cx + Math.cos(a) * rr * 1.4, Y: cy + Math.sin(a) * rr, Z: cz + (r() - 0.5) * Math.min(R * 0.9, 650), el: null, match: true, vis: false, d: 0, stamp: 0, cls: -1, op: '', zi: 0, sx: 0, sy: 0, fd: 0 });
    });
  });
  return out;
}


// Notlar arası bağlantılar: [[Not adı]], [[Not adı|takma ad]], [[Not adı#başlık]]. Ad eşleşmesi klasörsüz ve büyük/küçük harfsiz yapılır.
interface Edge { a: N; b: N }
function buildEdges(nodes: N[], files: Record<string, string>): { edges: Edge[]; adj: Map<string, string[]> } {
  const byTitle = new Map<string, N>();
  for (const n of nodes) { const k = n.title.toLowerCase(); if (!byTitle.has(k)) byTitle.set(k, n); }
  const seen = new Set<string>(), edges: Edge[] = [], adj = new Map<string, string[]>();
  const add = (x: string, y: string) => { (adj.get(x) || adj.set(x, []).get(x)!).push(y); };
  for (const n of nodes) {
    const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g; let m: RegExpExecArray | null;
    const text = files[n.path] || '';
    while ((m = re.exec(text)) && edges.length < 4000) {
      const t = byTitle.get(m[1].trim().replace(/^.*\//, '').replace(/\.md$/i, '').toLowerCase());
      if (!t || t === n) continue;
      const key = n.path < t.path ? n.path + '::' + t.path : t.path + '::' + n.path;
      if (seen.has(key)) continue; seen.add(key);
      edges.push({ a: n, b: t }); add(n.path, t.path); add(t.path, n.path);
    }
  }
  return { edges, adj };
}

// Yerleşim: bağlantılı notlar birbirine yaklaşır, kartlar üst üste binmez. Klasör kümelerinden başlar (aynı klasör yakın kalır), sonra
// yay (bağlantı çeker) + çarpışma (üst üste binmeyi iter) + klasör merkezine hafif çekim ile gevşetilir. Rastgelelik yok: aynı notlar hep aynı yere oturur.
function layout(nodes: N[], edges: Edge[]) {
  const n = nodes.length; if (n < 2) return;
  const idx = new Map<N, number>(); nodes.forEach((x, i) => idx.set(x, i));
  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
  const fx = new Float32Array(n), fy = new Float32Array(n), fz = new Float32Array(n);
  nodes.forEach((x, i) => { X[i] = x.X; Y[i] = x.Y; Z[i] = x.Z; });
  const E = edges.map(e => [idx.get(e.a)!, idx.get(e.b)!] as const);
  // klasör merkezi: başlangıç ortalaması (kümeler dağılıp birbirine karışmasın)
  const cen = new Map<string, [number, number, number, number]>();
  nodes.forEach((x, i) => { const c = cen.get(x.folder) || [0, 0, 0, 0]; c[0] += X[i]; c[1] += Y[i]; c[2] += Z[i]; c[3]++; cen.set(x.folder, c); });
  const cx = nodes.map(x => { const c = cen.get(x.folder)!; return c[0] / c[3]; }), cy = nodes.map(x => { const c = cen.get(x.folder)!; return c[1] / c[3]; }), cz = nodes.map(x => { const c = cen.get(x.folder)!; return c[2] / c[3]; });
  const iters = n <= 250 ? 220 : n <= 500 ? 150 : 100, CELL = 380, REST = 250;
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters;
    fx.fill(0); fy.fill(0); fz.fill(0);
    // bağlantı yayı: çok uzaksa çeker, çok yakınsa (üst üste) iter
    for (const [a, b] of E) {
      const dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a], d = Math.hypot(dx, dy, dz) + 0.01;
      const f = d > REST ? (d - REST) * 0.03 : (d - REST) * 0.012;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f; fz[a] += (dz / d) * f; fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f; fz[b] -= (dz / d) * f;
    }
    // klasör merkezine hafif çekim
    for (let i = 0; i < n; i++) { fx[i] += (cx[i] - X[i]) * 0.004; fy[i] += (cy[i] - Y[i]) * 0.004; fz[i] += (cz[i] - Z[i]) * 0.004; }
    // çarpışma ve yumuşak itme: ızgarayla yalnızca komşu hücreler
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) { const k = `${Math.floor(X[i] / CELL)},${Math.floor(Y[i] / CELL)},${Math.floor(Z[i] / CELL)}`; (grid.get(k) || grid.set(k, []).get(k)!).push(i); }
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(X[i] / CELL), gy = Math.floor(Y[i] / CELL), gz = Math.floor(Z[i] / CELL);
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) for (let az = -1; az <= 1; az++) {
        const cell = grid.get(`${gx + ax},${gy + ay},${gz + az}`); if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          let dx = X[j] - X[i], dy = Y[j] - Y[i]; const dz = Z[j] - Z[i];
          if (dx === 0 && dy === 0) { dx = ((i * 7 + j) % 5) - 2.1; dy = ((i + j * 3) % 5) - 2.1; }
          const ox = CW + 30 - Math.abs(dx), oy = CH + 22 - Math.abs(dy), oz = 1000 - Math.abs(dz);
          if (ox > 0 && oy > 0 && oz > 0) { // ekranda çakışıyor (derinlik farkı küçüldükçe daha güçlü): en az girişim yönünde it, bir de derinlikte ayır
            const w = Math.min(1, oz / 600);
            if (ox < oy) { const p = ox * 0.35 * w * Math.sign(dx || 1); fx[i] -= p; fx[j] += p; } else { const p = oy * 0.35 * w * Math.sign(dy || 1); fy[i] -= p; fy[j] += p; }
            const q = Math.max(0, 340 - Math.abs(dz)) * 0.06 * Math.sign(dz || 1); fz[i] -= q; fz[j] += q;
          }
          const r = Math.hypot(dx, dy, dz * 0.6) + 0.01;
          if (r < 330) { const f = (330 - r) * 0.012; fx[i] -= (dx / r) * f; fy[i] -= (dy / r) * f; fz[i] -= (dz / r) * f * 0.6; fx[j] += (dx / r) * f; fy[j] += (dy / r) * f; fz[j] += (dz / r) * f * 0.6; }
        }
      }
    }
    const step = 0.55 * (0.35 + 0.65 * cool), cap = 38 * (0.3 + 0.7 * cool);
    for (let i = 0; i < n; i++) {
      X[i] += Math.max(-cap, Math.min(cap, fx[i] * step)); Y[i] += Math.max(-cap, Math.min(cap, fy[i] * step)); Z[i] += Math.max(-cap, Math.min(cap, fz[i] * step * 0.7));
    }
  }
  // Son aşama: üst üste binenleri doğrudan ayır (konum düzeltme). Yay gevşemesi bağlantıları yakınlaştırırken bazı kartları hâlâ çakıştırabilir.
  const GX = CW + 26, GY = CH + 20;
  for (let it = 0; it < 90; it++) {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) { const k = `${Math.floor(X[i] / 300)},${Math.floor(Y[i] / 300)},${Math.floor(Z[i] / 300)}`; (grid.get(k) || grid.set(k, []).get(k)!).push(i); }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(X[i] / 300), gy = Math.floor(Y[i] / 300), gz = Math.floor(Z[i] / 300);
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) for (let az = -2; az <= 2; az++) {
        const cell = grid.get(`${gx + ax},${gy + ay},${gz + az}`); if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          let dx = X[j] - X[i], dy = Y[j] - Y[i]; const dz = Z[j] - Z[i];
          if (Math.abs(dz) > 520) continue;
          if (dx === 0 && dy === 0) { dx = ((i * 7 + j) % 5) - 2.1; dy = ((i + j * 3) % 5) - 2.1; }
          const ox = GX - Math.abs(dx), oy = GY - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          moved++;
          if (ox < oy) { const m = ox * 0.5 * Math.sign(dx); X[i] -= m; X[j] += m; } else { const m = oy * 0.5 * Math.sign(dy); Y[i] -= m; Y[j] += m; }
        }
      }
    }
    if (!moved) break;
  }
  nodes.forEach((x, i) => { x.X = X[i]; x.Y = Y[i]; x.Z = Z[i]; });
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
.ns-card.lnk{border-color:#ffd166;box-shadow:0 0 16px rgba(255,209,102,.35)}
.ns-card.col{border-color:#ffd166;box-shadow:0 0 24px rgba(255,200,90,.65)}
.ns-plus{position:absolute;right:5px;top:4px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:13px;line-height:1;background:rgba(0,170,230,.25);color:#bfeeff;opacity:0}
.ns-card:hover .ns-plus,.ns-card.col .ns-plus{opacity:1}.ns-card.col .ns-plus{background:#ffd166;color:#241800}
.ns-top{position:absolute;z-index:5;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:10px 160px 10px 14px;pointer-events:none;font-size:12px}
.ns-top>*{pointer-events:auto}
.ns-filter{position:absolute;z-index:6;left:14px;top:52px;width:min(560px,calc(100% - 28px));max-height:62vh;overflow:auto;padding:12px;border-radius:14px;background:rgba(4,22,36,.96);border:1px solid rgba(0,200,255,.45);box-shadow:0 10px 40px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:8px;font-size:12px}
.ns-fh{letter-spacing:.08em;text-transform:uppercase;color:#7fdcff;font-size:11px}.ns-fh span{opacity:.6;text-transform:none;letter-spacing:0}
.ns-chips{display:flex;flex-wrap:wrap;gap:6px}
.ns-fchip{cursor:pointer;background:rgba(0,60,90,.5);border:1px solid rgba(0,200,255,.35);color:#cfefff;border-radius:999px;padding:4px 10px;font:inherit}.ns-fchip i{font-style:normal;opacity:.55;margin-left:4px}.ns-fchip.on{background:rgba(0,170,230,.55);border-color:#7fe6ff;color:#fff}
.ns-ftag{background:rgba(0,40,60,.7);border:1px solid rgba(0,200,255,.35);border-radius:8px;padding:5px 8px;color:#e8fbff;font:inherit;outline:none;user-select:text}
.ns-fa{display:flex;gap:8px;align-items:center}.ns-fa span{margin-left:auto;opacity:.7}
.ns-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#7fb8cc;pointer-events:none;z-index:2}
.ns-title{letter-spacing:.14em;text-transform:uppercase;color:#7fdcff;font-size:12px}
.ns-search{display:flex;align-items:center;gap:6px;background:rgba(0,40,60,.7);border:1px solid rgba(0,200,255,.4);border-radius:9px;padding:5px 9px;min-width:220px}
.ns-search input{background:none;border:none;outline:none;color:#e8fbff;font-size:12.5px;width:100%;font-family:inherit;user-select:text}
.ns-btn{cursor:pointer;background:rgba(0,40,60,.7);border:1px solid rgba(0,200,255,.4);color:#bfeeff;border-radius:9px;padding:6px 10px;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-family:inherit}
.ns-btn:hover{background:rgba(0,120,170,.55)}.ns-btn.on{background:rgba(0,150,200,.6);border-color:#7fe6ff}.ns-btn:disabled{opacity:.4;cursor:default}
.ns-tray{position:absolute;z-index:4;left:14px;bottom:14px;max-width:calc(100% - 28px);display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border-radius:14px;background:rgba(4,22,36,.88);border:1px solid rgba(255,200,90,.45);box-shadow:0 0 26px rgba(255,190,70,.14)}
.ns-card.held{filter:brightness(1.7);outline:2px solid #ffd166}
.ns-tray.carry{border-color:#ffd166;animation:ns-pulse .9s ease-in-out infinite alternate}
@keyframes ns-pulse{from{box-shadow:0 0 14px rgba(255,200,90,.25)}to{box-shadow:0 0 42px rgba(255,200,90,.85)}}
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
.ns-cur.idle{opacity:.35}.ns-cur.point{border-color:#7fffd4;width:34px;height:34px;margin:-17px 0 0 -17px}
.ns-card.aimed{outline:2px solid #7fffd4;box-shadow:0 0 28px rgba(127,255,212,.7)}.ns-cur.grab{background:rgba(255,200,90,.45);border-color:#ffd166;width:36px;height:36px;margin:-18px 0 0 -18px}.ns-cur.down{background:rgba(255,200,90,.55);border-color:#ffd166;width:16px;height:16px;margin:-8px 0 0 -8px}
.ns-hint{position:absolute;right:16px;bottom:8px;max-width:46%;line-height:1.35;font-size:10.5px;color:#6fa6bb;pointer-events:none;text-align:right}
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

  // Yerleşim hesabı pahalı: yalnızca not listesi ya da bağlantılar değişince yapılır; içerik düzenlemeleri aynı konumları kullanır
  // Filtre: klasörler (herhangi biri) ve etiketler (hepsi). Düğümler süzülmüş kümeden kurulur; kalan notlar baştan, sıkı yerleşir
  const [study, setStudy] = useState<string[] | null>(null); // Çalışma masası açıkken uzay duraklar
  const studyRef = useRef(false); studyRef.current = !!study;
  const [selFolders, setSelFolders] = useState<string[]>([]);
  const [selTags, setSelTags] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tagQ, setTagQ] = useState('');
  const meta = useMemo(() => {
    const folders = new Map<string, number>(), tags = new Map<string, number>(), per = new Map<string, Set<string>>();
    for (const p of Object.keys(files)) {
      if (!p.endsWith('.md') || p.split('/').some(x => x.startsWith('.'))) continue;
      const f = folderOf(p); folders.set(f, (folders.get(f) || 0) + 1);
      const t = noteTags(files[p] || ''); per.set(p, t);
      for (const x of t) tags.set(x, (tags.get(x) || 0) + 1);
    }
    return { folders, tags, per, total: per.size };
  }, [files]);
  const filteredFiles = useMemo(() => {
    if (!selFolders.length && !selTags.length) return files;
    const out: Record<string, string> = {};
    for (const [p, t] of meta.per) {
      if (selFolders.length && !selFolders.includes(folderOf(p))) continue;
      if (selTags.length && !selTags.every(x => t.has(x))) continue;
      out[p] = files[p];
    }
    return out;
  }, [files, meta, selFolders, selTags]);
  const layoutCache = useRef<{ sig: string; pos: Map<string, [number, number, number]> } | null>(null);
  const { nodes, links } = useMemo(() => {
    const nds = buildNodes(filteredFiles), lk = buildEdges(nds, filteredFiles);
    const sig = `${nds.length}:${lk.edges.map(e => `${e.a.path}>${e.b.path}`).join('|')}:${nds.map(x => x.path).join('|')}`;
    if (layoutCache.current && layoutCache.current.sig === sig) { for (const x of nds) { const q = layoutCache.current.pos.get(x.path); if (q) { x.X = q[0]; x.Y = q[1]; x.Z = q[2]; } } }
    else { layout(nds, lk.edges); layoutCache.current = { sig, pos: new Map(nds.map(x => [x.path, [x.X, x.Y, x.Z] as [number, number, number]])) }; }
    return { nodes: nds, links: lk };
  }, [filteredFiles]);
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const linksRef = useRef(links); linksRef.current = links;
  const linkRef = useRef<HTMLCanvasElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const [shelf, setShelf] = useState<string[]>([]);
  const [drop, setDrop] = useState(false);
  const [carry, setCarry] = useState(false); // bir kart elde taşınıyor: raf parlar, "buraya bırak" olduğu anlaşılsın
  const [handsOn, setHandsOn] = useState(() => { try { return window.innerWidth >= 900 && localStorage.getItem('ns-hands-off') !== '1'; } catch { return window.innerWidth >= 900; } });
  const handsActive = handsOn && !study;
  const toggleHands = () => setHandsOn(v => { try { localStorage.setItem('ns-hands-off', v ? '1' : '0'); } catch { /* yoksay */ } return !v; });
  const [status, setStatus] = useState('');
  const openRef = useRef(open); openRef.current = open;
  const shelfRef = useRef(shelf); shelfRef.current = shelf;
  const dirty = useRef(true);
  const cam = useRef({ x: 0, y: 0, z: -140 }), tgt = useRef({ x: 0, y: 0, z: -140 });
  const panelW = useRef(0);
  const act = useRef<{ pdown: (p: Ptr) => void; pmove: (p: Ptr) => void; pup: (p: Ptr) => void; zoomBy: (dz: number) => void }>({ pdown: () => {}, pmove: () => {}, pup: () => {}, zoomBy: () => {} });

  // Filtre değişince düğümler yeniden yerleşir: kamera başa döner (eski konum artık boş bir yer olabilir)
  const filterKey = `${selFolders.join('|')}#${selTags.join('|')}`;
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) { firstFilter.current = false; return; }
    tgt.current = { x: 0, y: 0, z: -140 }; cam.current = { x: 0, y: 0, z: -140 }; dirty.current = true;
  }, [filterKey]);
  const maxZ = useMemo(() => nodes.reduce((m, n) => Math.max(m, n.Z), 0), [nodes]);
  const maxZRef = useRef(maxZ); maxZRef.current = maxZ;

  const fly = (n: N) => { const d = n.Z - cam.current.z; tgt.current = { x: n.X, y: n.Y, z: d < 480 ? tgt.current.z : n.Z - 480 }; dirty.current = true; }; // zaten yakınsa mesafe korunur: not açılınca kamera geri çekilmez
  const openNotes = (paths: string[]) => { setOpen(paths.slice(0, 4)); const w = Math.min(window.innerWidth * 0.94, Math.min(paths.length, 4) * 430, window.innerWidth * 0.8); panelW.current = paths.length ? w : 0; dirty.current = true; };
  // Raf en çok 10 not alır: Çalışma masasında büyük kartlar için
  const SHELF_MAX = 10;
  const toggleShelf = (path: string) => setShelf(s => { if (s.includes(path)) return s.filter(x => x !== path); if (s.length >= SHELF_MAX) { setStatus(`Raf dolu (en fazla ${SHELF_MAX} not)`); setTimeout(() => setStatus(x => (x.startsWith('Raf dolu') ? '' : x)), 1800); return s; } return [...s, path]; });

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
      const lnk = new Set<string>(); for (const pth of op) for (const q of linksRef.current.adj.get(pth) || []) lnk.add(q);
      // 1) görüş alanındaki adaylar; çok olursa en yakın MAXV tanesi çizilir
      const cand: N[] = [];
      for (const n of nodesRef.current) {
        const d = n.Z - c.z; n.d = d;
        if (d > NEAR && d < MAXD) { const s = F / (F + d); const sx = cxs + (n.X - c.x) * s, sy = cys + (n.Y - c.y) * s; if (s > 0.17 && sx > -CW * s && sx < W + CW * s && sy > -CH * s && sy < H + CH * s) cand.push(n); }
      }
      if (cand.length > MAXV) { cand.sort((a, b) => a.d - b.d); cand.length = MAXV; }
      for (const n of cand) {
        const el = n.el; if (!el) continue;
        n.stamp = frame;
        const d = n.d, s = F / (F + d), sx = cxs + (n.X - c.x) * s, sy = cys + (n.Y - c.y) * s;
        if (!n.vis) { el.style.display = ''; n.vis = true; n.cls = -1; n.op = ''; n.zi = 0; }
        el.style.transform = `translate3d(${(sx - CW / 2).toFixed(1)}px,${(sy - CH / 2).toFixed(1)}px,0) scale(${s.toFixed(3)})`;
        const fade = clamp((d - NEAR) / 90, 0, 1) * clamp(1 - (d - 2200) / 2600, 0.3, 1); // yalnızca kameranın hemen yanında kısa sönme; uzakta hafif soluklaşma
        const o = (n.match ? fade : fade * 0.12).toFixed(2); n.sx = sx; n.sy = sy; n.fd = Number(o);
        if (o !== n.op) { el.style.opacity = o; n.op = o; }
        const zi = Math.round(100000 - d); if (zi !== n.zi) { el.style.zIndex = String(zi); n.zi = zi; }
        const cls = (s < 0.36 ? 1 : 0) | (op.has(n.path) ? 2 : 0) | (sh.has(n.path) ? 4 : 0) | (n.match ? 8 : 0) | (lnk.has(n.path) ? 16 : 0);
        if (cls !== n.cls) { el.classList.toggle('far', !!(cls & 1)); el.classList.toggle('sel', !!(cls & 2)); el.classList.toggle('col', !!(cls & 4)); el.classList.toggle('lnk', !!(cls & 16)); el.style.pointerEvents = cls & 8 ? 'auto' : 'none'; n.cls = cls; }
      }
      // 1b) bağlantı çizgileri: yalnızca ikisi de görünen kartlar arasında; açık notun bağlantıları sarı ve kalın
      const lc = linkRef.current;
      if (lc) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (lc.width !== Math.round(W * dpr) || lc.height !== Math.round(H * dpr)) { lc.width = Math.round(W * dpr); lc.height = Math.round(H * dpr); }
        const g = lc.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
        for (const e of linksRef.current.edges) {
          if (e.a.stamp !== frame || e.b.stamp !== frame) continue;
          const hot = op.has(e.a.path) || op.has(e.b.path), al = Math.min(e.a.fd, e.b.fd);
          if (al < 0.05) continue;
          g.strokeStyle = hot ? `rgba(255,209,102,${(al * 0.95).toFixed(2)})` : `rgba(110,220,255,${(al * 0.3).toFixed(2)})`; g.lineWidth = hot ? 2.2 : 1;
          g.beginPath(); g.moveTo(e.a.sx, e.a.sy); g.lineTo(e.b.sx, e.b.sy); g.stroke();
        }
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
      if (el && space.contains(el)) { const n = cardOf(el); if (n) { p.mode = 'card'; p.card = n; p.plus = !!el.closest('.ns-plus'); if (p.hand && !p.plus) { n.el?.classList.add('held'); ghost.style.display = 'block'; ghost.textContent = '⬇ ' + n.title; ghost.style.transform = `translate(${p.x + 14}px,${p.y + 10}px)`; setCarry(true); } } else p.mode = 'pan'; }
      else { p.mode = 'ui'; p.scroller = scrollerAt(p.x, p.y); }
    };
    act.current.pmove = (p) => {
      if (!p.down) return;
      const mx = p.x - p.lx, my = p.y - p.ly; p.lx = p.x; p.ly = p.y;
      p.moved = Math.max(p.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
      if (p.mode === 'pan') { tgt.current.x -= mx; tgt.current.y -= my; cam.current.x -= mx; cam.current.y -= my; dirty.current = true; }
      else if (p.mode === 'ui' && p.scroller && p.moved > 14) p.scroller.scrollTop -= my;
      else if (p.mode === 'card' && p.card && !p.plus && (p.hand || p.moved > 16)) {
        if (!p.hand) { p.card.el?.classList.add('held'); setCarry(true); }
        ghost.style.display = 'block'; ghost.textContent = '⬇ ' + p.card.title; ghost.style.transform = `translate(${p.x + 14}px,${p.y + 10}px)`; setDrop(overTray(p.x, p.y));
      }
    };
    act.current.pup = (p) => {
      if (!p.down) return; p.down = false; ghost.style.display = 'none'; setDrop(false); setCarry(false); p.card?.el?.classList.remove('held');
      const quick = performance.now() - p.t0 < 900 && p.moved < (p.hand ? 40 : 6);
      if (p.mode === 'card' && p.card) {
        if (p.moved > 16 && overTray(p.x, p.y)) setShelf(s => (s.includes(p.card!.path) || s.length >= 10 ? s : [...s, p.card!.path]));
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
      if (studyRef.current) return; // Çalışma masası kendi tuşlarını yönetir
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
    if (!handsActive) { curRefs.current.forEach(c => { if (c) c.style.display = 'none'; }); return; }
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
        // El çimdiği (pinch) kullanılmaz: yumrukla karışıp kartı takılı bırakıyordu. Etkileşim: işaret = aç, yumruk = tut, barış = başa dön.
        p.aim = false;
        // El hareketleri: yumruk = uzayı tut (sürükle = kaydır, kameraya yaklaştır/uzaklaştır = ileri-geri) · barış işareti = başa dön.
        // Hıza dayalı süpürme yerine sürekli "tut ve sürükle": eşik yok, kazara tetiklenmez, her kamerada okunur.
        const flash = (m: string) => { setStatus(m); setTimeout(() => setStatus(x => (x === m ? '' : x)), 1800); };
        const g = hand.gesture;
        const fg = s.fingers;
        const fistNow = !fg[1] && !fg[2] && !fg[3] && !fg[4]; // 'çimdik' etiketine bakmadan: dört parmak da kapalı
        if (fistNow) { p.fistLost = 0; if (!p.fistSince) p.fistSince = now; } else { if (!p.fistLost) p.fistLost = now; if (now - p.fistLost > 220) p.fistSince = 0; }
        const fistOn = fistNow ? now - (p.fistSince || now) > 250 : !!p.grab && now - (p.fistLost || now) < 220; // 0,25 sn sabit yumruk başlatır; 0,22 sn'ye kadar bozulma (titreme) tutmayı koparmaz
        if (fistOn) {
          const pl = s.palm;
          if (!p.grab) { p.grab = { lx: pl.x, ly: pl.y, s0: s.size, z0: tgt.current.z, n: 1, rs: 1 }; flash('✊ Tutuyorum: sürükle = kaydır · kameraya yaklaştır = ileri, uzaklaştır = geri'); }
          else if (fistNow) {
            // Yumruk açılırken/kapanırken (fistNow false) hiçbir şey güncellenmez: el biçimi değişince ölçülen büyüklük de değişir, bunu ileri-geri sanıp uçmasın
            const gx = (pl.x - p.grab.lx) * 1.6, gy = (pl.y - p.grab.ly) * 1.6; p.grab.lx = pl.x; p.grab.ly = pl.y;
            tgt.current.x -= gx; cam.current.x -= gx; tgt.current.y -= gy; cam.current.y -= gy;
            if (p.grab.n < 8) { p.grab.s0 = (p.grab.s0 * p.grab.n + s.size) / (p.grab.n + 1); p.grab.n++; p.grab.z0 = tgt.current.z; } // ilk 8 karede başlangıç büyüklüğü ortalanır, ileri-geri etkisiz
            else {
              p.grab.rs += (s.size / p.grab.s0 - p.grab.rs) * 0.2; // yumuşatılmış oran
              const r = p.grab.rs, dead = 0.15; // elin büyüklüğü başlangıca göre: büyüdüyse yaklaştı (ileri), küçüldüyse uzaklaştı (geri); ±%15 ölü bölge
              const dz = Math.abs(r - 1) < dead ? 0 : (r - 1 - Math.sign(r - 1) * dead) * 2200;
              tgt.current.z = clamp(p.grab.z0 + dz, -700, maxZRef.current + 200);
            }
            dirty.current = true;
          }
          p.x = pl.x; p.y = pl.y;
        } else p.grab = null;
        if (g === 'zafer' && now - hand.gestureSince > 600) { if (p.latch !== 'z') { p.latch = 'z'; tgt.current = { x: 0, y: 0, z: -140 }; dirty.current = true; flash('Başa dönüldü'); } }
        else if (g !== 'zafer') p.latch = '';
        // İşaret: işaret parmağı açık, diğerleri kapalı. Bir nota/düğmeye doğrultup ~1 sn sabit tutunca açılır (çimdik gerekmez); dolan halka bunu gösterir.
        const pointing = fg[1] && !fg[2] && !fg[3] && !fg[4] && !p.grab;
        p.pointing = pointing;
        let aimEl: HTMLElement | null = null;
        if (pointing) {
          p.x = s.tip.x; p.y = s.tip.y;
          const hit = document.elementFromPoint(p.x, p.y);
          const cardEl = hit?.closest('.ns-card') as HTMLElement | null, btn = hit?.closest('button') as HTMLElement | null;
          const key = cardEl ? (cardEl.dataset.path || '') : btn ? 'b:' + (btn.getAttribute('aria-label') || btn.textContent || '') : '';
          if (key) {
            aimEl = (cardEl || btn) as HTMLElement;
            if (p.dwellKey !== key) { p.dwellKey = key; p.dwellSince = now; p.dwellDone = false; }
            else if (!p.dwellDone && now - (p.dwellSince || now) > 1000) {
              p.dwellDone = true;
              if (cardEl) { const n = nodesRef.current.find(x => x.el === cardEl); if (n) { openNotes([n.path]); fly(n); } }
              else btn?.click();
            }
            p.dwellP = p.dwellDone ? 1 : clamp((now - (p.dwellSince || now)) / 1000, 0, 1);
          } else { p.dwellKey = ''; p.dwellP = 0; }
        } else { p.dwellKey = ''; p.dwellP = 0; }
        if (p.aimEl !== aimEl) { p.aimEl?.classList.remove('aimed'); aimEl?.classList.add('aimed'); p.aimEl = aimEl; }
        if (ev.pinchUp) act.current.pup(p);
      }
      for (const [id, p] of ptrs) if (!present.has(id) && now - p.seen > 350) { act.current.pup(p); ptrs.delete(id); }
      // iki elle: eller açılırsa ileri, kapanırsa geri
      const z = [...ptrs.values()].filter(o => o.down && o.mode === 'zoom');
      if (z.length === 2) { const d = Math.hypot(z[0].x - z[1].x, z[0].y - z[1].y); act.current.zoomBy((d - prevDist) * 3.2); prevDist = d; }
      let i = 0;
      for (const p of ptrs.values()) { const c = curRefs.current[i++]; if (!c) continue; c.style.display = 'block'; c.style.transform = `translate(${p.x}px,${p.y}px)`; c.classList.toggle('down', p.down); c.classList.toggle('idle', !p.pointing && !p.grab && !p.down); c.classList.toggle('grab', !!p.grab); c.classList.toggle('point', !!p.pointing); c.style.background = p.pointing && p.dwellP ? `conic-gradient(rgba(120,255,200,.75) ${Math.round(p.dwellP * 360)}deg, rgba(0,0,0,.15) 0)` : ''; }
      for (; i < 2; i++) { const c = curRefs.current[i]; if (c) c.style.display = 'none'; }
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); try { stream?.getTracks().forEach(t => t.stop()); } catch { /* yoksay */ } for (const p of ptrs.values()) act.current.pup(p); curRefs.current.forEach(c => { if (c) c.style.display = 'none'; }); };
  }, [handsActive]);

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
      <div ref={spaceRef} className="ns-space"><canvas ref={linkRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} />{cards}</div>
      <div className="ns-top">
        <span className="ns-title">Not uzayı · {nodes.length}{selFolders.length + selTags.length ? ` / ${meta.total}` : ''} not</span>
        <label className="ns-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Ara (Enter: en yakına uç)" /></label>
        <button type="button" className={`ns-btn${filterOpen || selFolders.length + selTags.length ? ' on' : ''}`} onClick={() => setFilterOpen(v => !v)} aria-pressed={filterOpen}><Filter size={13} /> Filtre{selFolders.length + selTags.length ? ` (${selFolders.length + selTags.length})` : ''}</button>
        {status && <span style={{ color: '#ffd37f' }}>{status}</span>}
        <button type="button" className={`ns-btn${handsOn ? ' on' : ''}`} onClick={toggleHands} aria-pressed={handsOn}><Hand size={13} /> El kontrolü: {handsOn ? 'açık' : 'kapalı'}</button>
        <button type="button" className="ns-btn" onClick={() => cbRef.current.onClose()} aria-label="Kapat"><X size={14} /></button>
      </div>

      {filterOpen && (
        <div className="ns-filter" data-agent-ignore="1">
          <div className="ns-fh">Klasörler <span>(seçilenlerden herhangi biri)</span></div>
          <div className="ns-chips">
            {[...meta.folders.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => (
              <button key={f || '_kok'} type="button" className={`ns-fchip${selFolders.includes(f) ? ' on' : ''}`} onClick={() => setSelFolders(x => (x.includes(f) ? x.filter(y => y !== f) : [...x, f]))}>{f || '(Kök)'}<i>{c}</i></button>
            ))}
          </div>
          <div className="ns-fh">Etiketler <span>(seçilenlerin hepsini içeren)</span></div>
          <input className="ns-ftag" value={tagQ} onChange={e => setTagQ(e.target.value)} placeholder="Etiket ara…" />
          <div className="ns-chips">
            {[...selTags, ...[...meta.tags.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).filter(t => !selTags.includes(t) && (!tagQ.trim() || t.includes(tagQ.trim().toLowerCase().replace(/^#/, '')))).slice(0, 60)].map(t => (
              <button key={t} type="button" className={`ns-fchip${selTags.includes(t) ? ' on' : ''}`} onClick={() => setSelTags(x => (x.includes(t) ? x.filter(y => y !== t) : [...x, t]))}>#{t}<i>{meta.tags.get(t) || 0}</i></button>
            ))}
            {meta.tags.size === 0 && <span style={{ opacity: 0.6 }}>Notlarda #etiket bulunamadı.</span>}
          </div>
          <div className="ns-fa">
            <button type="button" className="ns-btn" disabled={!selFolders.length && !selTags.length} onClick={() => { setSelFolders([]); setSelTags([]); }}>Filtreyi temizle</button>
            <span>{nodes.length} / {meta.total} not</span>
            <button type="button" className="ns-btn" onClick={() => setFilterOpen(false)}>Kapat</button>
          </div>
        </div>
      )}
      {nodes.length === 0 && <div className="ns-empty">Filtreye uyan not yok. Filtreyi gevşetin ya da temizleyin.</div>}
      {open.length > 0 && (
        <div className="ns-panels" style={{ width: `min(${Math.min(open.length, 4) * 430}px, 94vw, 80vw)` }}>
          {open.map(p => (
            <section key={p} className="ns-col">
              <header>
                <div className="n" title={p}>{titleOf(p)}</div>
                <button type="button" className="ns-btn" style={{ padding: '4px 8px' }} onClick={() => toggleShelf(p)} aria-label="Rafa al ya da çıkar">{shelf.includes(p) ? 'Rafta ✓' : '+ Raf'}</button>
                <button type="button" className="ns-btn" style={{ padding: '4px 7px' }} onClick={() => cbRef.current.onOpenInApp(p)} title="Notlar ekranında aç ve düzenle"><ExternalLink size={12} /></button>
                <button type="button" className="ns-btn" style={{ padding: '4px 7px' }} onClick={() => setOpen(o => { const r = o.filter(x => x !== p); openNotes(r); return r; })} aria-label="Paneli kapat"><X size={12} /></button>
              </header>
              <div className="body">
                {(links.adj.get(p) || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(0,200,255,.18)' }}>
                    <span style={{ fontSize: 11, opacity: 0.6, alignSelf: 'center' }}>Bağlantılar:</span>
                    {(links.adj.get(p) || []).slice(0, 14).map(q => <button key={q} type="button" className="ns-btn" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => { const n = nodesRef.current.find(x => x.path === q); if (n) { openNotes([q]); fly(n); } }}>{titleOf(q)}</button>)}
                  </div>
                )}
                <NoteText text={files[p] || ''} />
              </div>
            </section>
          ))}
        </div>
      )}

      <div ref={trayRef} className={`ns-tray${drop ? ' drop' : ''}${carry ? ' carry' : ''}`} style={{ maxWidth: open.length ? `calc(100% - ${Math.round(panelW.current) + 28}px)` : undefined }}>
        <span style={{ fontSize: 11.5, color: '#ffd9a0', letterSpacing: '.08em', textTransform: 'uppercase' }}>Raf · {shelf.length}</span>
        {shelf.length === 0 && <span style={{ fontSize: 11.5, color: '#9a8a66' }}>Kartın + işaretine bas ya da kartı buraya sürükle</span>}
        {shelf.map(p => <span key={p} className="ns-chip"><span title={p}>{titleOf(p)}</span><b onClick={() => toggleShelf(p)}>×</b></span>)}
        {shelf.length > 0 && <>
          <button type="button" className="ns-btn" onClick={() => openNotes(shelf)}><Columns2 size={13} /> Yan yana aç ({Math.min(shelf.length, 4)})</button>
          <button type="button" className="ns-btn on" onClick={() => setStudy(shelf.slice(0, SHELF_MAX))}><LayoutGrid size={13} /> Çalışma masası ({Math.min(shelf.length, SHELF_MAX)})</button>
          <button type="button" className="ns-btn" onClick={() => setShelf([])} aria-label="Rafı boşalt"><Trash2 size={13} /></button>
        </>}
      </div>
      {study && <StudyTable files={files} paths={study} onOpenInApp={(p) => cbRef.current.onOpenInApp(p)} onBack={() => setStudy(null)} onClose={() => cbRef.current.onClose()} />}
      <div ref={ghostRef} className="ns-ghost" />
      <div ref={el => { curRefs.current[0] = el; }} className="ns-cur" /><div ref={el => { curRefs.current[1] = el; }} className="ns-cur" />
      <div className="ns-hint">El: işaret parmağın açık, diğerleri kapalıyken nota doğrult = aç (halka dolunca) · yumruk = uzayı tut (sürükle = kaydır, yaklaştır/uzaklaştır = ileri-geri) · barış işareti = başa dön · Tekerlek / ↑↓: ileri-geri · Sürükle: kaydır · Tıkla: aç · Ctrl+tık: rafa al · Esc: kapat</div>
    </div>
  );
}
