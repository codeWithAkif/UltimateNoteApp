// Oturum izleyici: kullanıcının uygulamada yaptığı kaydetmelerden "bu oturumda ne yaptınız" özetini çıkarır ve onaylanan oturumu
// takvim bloğu olarak günlük nota yazar. Veri kaynağı dosya değişiklik saati DEĞİL (otomatik yazımlar onu bozuyor): ilk kayıt öncesi
// not içeriği (baseline) saklanır, oturum bitince baseline ile güncel içerik satır satır karşılaştırılır (net fark).
// Yapay zekâ yok: cümleler kural tabanlıdır. Tüm işlevler saftır (ağ/disk yok), yalnızca load/save yardımcıları localStorage kullanır.

import { PROJECT_TAG_REGEX } from './quickSlots';

export interface SessionState {
  id: string;
  start: number;
  lastActivity: number;
  baselines: Record<string, string | null>; // null = baseline çok büyüktü/bilinmiyor
  touched: Record<string, { first: number; last: number }>;
}

export type SessionArea = 'notlar' | 'takvim' | 'projeler';
export interface SessionItem { id: string; area: SessionArea; text: string; path: string; project?: string }
export interface SessionSummary {
  id: string;
  start: number;
  end: number;
  items: SessionItem[];
  suggestedTitle: string;
  suggestedProject: string | null;
}

export interface ProjectContext {
  projectByPath: Record<string, string>; // proje notu yolu -> proje adı
  projectBySlug: Record<string, string>; // [project:slug] -> proje adı
}

export const IDLE_MS = 30 * 60 * 1000; // bu kadar boşluktan sonra oturum biter
const BASELINE_NOTE_CAP = 200_000;
const BASELINE_TOTAL_CAP = 1_500_000;
const MIN_BLOCK_MS = 15 * 60 * 1000;

export const AREA_LABELS: Record<SessionArea, string> = { notlar: 'Notlar', takvim: 'Takvim', projeler: 'Projeler ve görevler' };

// Sistem/Asistan klasörleri, gizli klasörler ve metadata izlenmez (uygulamanın kendi yazdıkları, oturum kaydının kendisi).
export const shouldTrack = (path: string): boolean =>
  /\.md$/i.test(path) && !path.split('/').some(seg => seg.startsWith('.')) && !/^(Sistem|Asistan)\//i.test(path);

export const recordSave = (
  state: SessionState | null,
  path: string,
  before: string | undefined,
  after: string,
  now: number = Date.now()
): { state: SessionState | null; finalized: SessionState | null } => {
  if (!shouldTrack(path)) return { state, finalized: null };
  if (before !== undefined && before === after) return { state, finalized: null };
  let finalized: SessionState | null = null;
  let s = state;
  if (s && now - s.lastActivity > IDLE_MS) { finalized = s; s = null; }
  // Verilen durum değiştirilmez: yeni bir kopya döndürülür (baseline metinleri paylaşılır, kopyalanmaz).
  s = s ? { ...s, baselines: { ...s.baselines }, touched: { ...s.touched } } : { id: `s${now}`, start: now, lastActivity: now, baselines: {}, touched: {} };
  if (!(path in s.baselines)) {
    const base = before === undefined ? '' : before;
    const total = Object.values(s.baselines).reduce((a, b) => a + (b ? b.length : 0), 0);
    s.baselines[path] = base.length > BASELINE_NOTE_CAP || total + base.length > BASELINE_TOTAL_CAP ? null : base;
  }
  const t = s.touched[path];
  s.touched[path] = { first: t ? t.first : now, last: now };
  s.lastActivity = now;
  return { state: s, finalized };
};

export const isIdle = (state: SessionState | null, now: number = Date.now()): boolean => !!state && now - state.lastActivity > IDLE_MS;

// ---------------- satır çözümleme ----------------
const TASK_RE = /^(\s*)[*\-]\s+\[([ xX/])\]\s*(.*)$/;
const stripTags = (s: string) =>
  s.replace(/\[[A-Za-zçğıöşüÇĞİÖŞÜ]+:[^\]]*\]/g, '').replace(/\[\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]/g, '')
    .replace(/#[0-9A-Za-zçğıöşüÇĞİÖŞÜ_-]+/g, '').replace(/\s+/g, ' ').trim();

interface TaskLine { key: string; title: string; checked: boolean; status: string; project?: string; due?: string; time?: string }

const parseTask = (line: string): TaskLine | null => {
  const m = line.match(TASK_RE);
  if (!m) return null;
  // Derin girintili satırlar (planlayıcının seans satırları, bizim ayrıntı satırlarımız) görev sayılmaz.
  if (m[1].replace(/\t/g, '    ').length >= 4) return null;
  const raw = m[3];
  // Kalın/kod işaretleri cümlede gürültü olur ("**1. HEDEF**" -> "1. HEDEF").
  const title = stripTags(raw).replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const mark = m[2];
  const statusTag = (raw.match(/\[status:([a-z0-9_-]+)\]/i) || [])[1];
  const status = mark.toLowerCase() === 'x' ? 'done' : statusTag ? statusTag.toLowerCase() : mark === '/' ? 'inprogress' : 'backlog';
  return {
    key: title.toLocaleLowerCase('tr'),
    title: title.length > 90 ? title.slice(0, 87) + '…' : title,
    checked: mark.toLowerCase() === 'x',
    status,
    project: ((raw.match(/\[(?:project|proje):([^\]]+)\]/i) || [])[1] || '').trim().toLowerCase() || undefined,
    due: (raw.match(/\[due:(\d{4}-\d{2}-\d{2})/) || [])[1],
    time: (raw.match(/\[(?:plannedtime|time|window):(\d{2}:\d{2}-\d{2}:\d{2})\]/) || [])[1]
  };
};

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog', inprogress: 'Devam Ediyor', test: 'Test', review: 'İncelemede', park: 'Park', blocked: 'Bloklu', done: 'Bitti'
};
const statusLabel = (s: string) => STATUS_LABELS[s] || (s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]+/g, ' '));

const noteNameOf = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');

const projectOf = (path: string, slug: string | undefined, ctx: ProjectContext): string | undefined => {
  if (slug) return ctx.projectBySlug[slug] || slug;
  if (ctx.projectByPath[path]) return ctx.projectByPath[path];
  const m = path.match(/Müşteriler\/[^/]+\/Projeler\/([^/]+)\.md$/i);
  return m ? m[1] : undefined;
};

const when = (due?: string, time?: string) => [due, time].filter(Boolean).join(' ');

const textLinesOf = (content: string): string[] => {
  const out: string[] = [];
  for (const raw of content.split('\n')) {
    const t = raw.trim();
    if (!t || TASK_RE.test(raw) || /^[-*_]{3,}$/.test(t) || stripTags(t) === '') continue;
    out.push(t);
  }
  return out;
};

// Tek bir notun baseline -> güncel farkı.
export const diffNote = (path: string, before: string | null, after: string, ctx: ProjectContext): SessionItem[] => {
  const items: SessionItem[] = [];
  const name = noteNameOf(path);
  let n = 0;
  const push = (area: SessionArea, text: string, project?: string) => items.push({ id: `${path}#${n++}`, area, text, path, project });

  if (before === null) {
    push('notlar', `“${name}” notunda değişiklik yaptınız`, projectOf(path, undefined, ctx));
    return items;
  }

  const taskMap = (content: string) => {
    const m = new Map<string, TaskLine[]>();
    content.split('\n').forEach(l => { const t = parseTask(l); if (t) { const a = m.get(t.key); if (a) a.push(t); else m.set(t.key, [t]); } });
    return m;
  };
  const bt = taskMap(before), at = taskMap(after);
  at.forEach((afters, key) => {
    const befores = bt.get(key) || [];
    afters.forEach((a, i) => {
      const b = befores[i];
      const project = projectOf(path, a.project, ctx);
      if (!b) {
        if (a.due || a.time) push('takvim', `Takvime “${a.title}” işini eklediniz (${when(a.due, a.time)})`, project);
        else push('projeler', `“${a.title}” görevini eklediniz`, project);
        return;
      }
      if (!b.checked && a.checked) push('projeler', `“${a.title}” görevini tamamladınız`, project);
      else if (b.checked && !a.checked) push('projeler', `“${a.title}” görevini yeniden açtınız`, project);
      else if (b.status !== a.status) push('projeler', `“${a.title}” kartını ${statusLabel(a.status)} sütununa taşıdınız`, project);
      if ((b.due !== a.due || b.time !== a.time) && (a.due || a.time)) push('takvim', `“${a.title}” işinin takvim zamanını değiştirdiniz (${when(a.due, a.time)})`, project);
    });
  });

  // Görev olmayan satırlar: eklenen satır sayısı (çoklu küme farkı)
  const beforeCount = new Map<string, number>();
  textLinesOf(before).forEach(l => beforeCount.set(l, (beforeCount.get(l) || 0) + 1));
  const added: string[] = [];
  textLinesOf(after).forEach(l => {
    const c = beforeCount.get(l) || 0;
    if (c > 0) beforeCount.set(l, c - 1); else added.push(l);
  });
  if (added.length > 0) {
    const sample = stripTags(added[0].replace(/^[#>\-*\s\d.]+/, '')).slice(0, 60);
    if (before.trim() === '') push('notlar', `“${name}” notunu oluşturdunuz (${added.length} satır)${sample ? ` — “${sample}…”` : ''}`, projectOf(path, undefined, ctx));
    else push('notlar', `“${name}” notuna ${added.length} satır eklediniz${sample ? ` — “${sample}…”` : ''}`, projectOf(path, undefined, ctx));
  }
  return items;
};

export const summarizeSession = (
  s: SessionState,
  currentContents: Record<string, string | undefined>,
  ctx: ProjectContext
): SessionSummary | null => {
  const items: SessionItem[] = [];
  let first = Infinity, last = 0;
  const touchCount: Record<string, number> = {};
  Object.keys(s.touched).forEach(path => {
    const cur = currentContents[path];
    if (cur === undefined) return; // silinmiş not
    const base = s.baselines[path];
    if (base !== undefined && base !== null && base === cur) return; // net değişiklik yok (yazıp geri aldı)
    first = Math.min(first, s.touched[path].first);
    last = Math.max(last, s.touched[path].last);
    const found = diffNote(path, base === undefined ? null : base, cur, ctx);
    found.forEach(i => { touchCount[i.project || `not:${noteNameOf(path)}`] = (touchCount[i.project || `not:${noteNameOf(path)}`] || 0) + 1; });
    items.push(...found);
  });
  if (items.length === 0) return null;
  const order: Record<SessionArea, number> = { notlar: 0, takvim: 1, projeler: 2 };
  items.sort((a, b) => order[a.area] - order[b.area]);
  const projects = Object.keys(touchCount).filter(k => !k.startsWith('not:')).sort((a, b) => touchCount[b] - touchCount[a]);
  const noteTop = Object.keys(touchCount).filter(k => k.startsWith('not:')).sort((a, b) => touchCount[b] - touchCount[a])[0];
  const suggestedProject = projects[0] || null;
  const start = first === Infinity ? s.start : first;
  const end = Math.max(last, start + MIN_BLOCK_MS);
  return {
    id: s.id, start, end, items,
    suggestedProject,
    suggestedTitle: suggestedProject ? `${suggestedProject} çalışması` : noteTop ? `${noteTop.slice(4).replace(/_/g, ' ')} çalışması` : 'Çalışma oturumu'
  };
};

// ---------------- takvim bloğu / günlük / kayıt yazımı ----------------
const WEEKDAY_FULL = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const MONTH_FULL = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const pad = (n: number) => String(n).padStart(2, '0');

export const ymdOf = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const hmOf = (ms: number): string => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayPathOf = (ymd: string) => `Günlükler/${ymd}.md`;
// DiaryView'in kullandığı başlık biçimi: "# Salı, 10 Kasım"
export const dayHeaderOf = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `# ${WEEKDAY_FULL[(dt.getDay() + 6) % 7]}, ${d} ${MONTH_FULL[m - 1]}`;
};

const clean = (s: string) => s.replace(/[\[\]]/g, m => (m === '[' ? '(' : ')')).replace(/\s+/g, ' ').trim();
const slugOf = (name: string) => name.toLocaleLowerCase('tr').replace(/\s+/g, '-');

export interface BlockInput {
  title: string;
  project?: string; // görünen proje adı
  date: string;     // YYYY-MM-DD
  start: string;    // HH:mm
  end: string;      // HH:mm
  details: string[];
}

// Takvim bloğu: tamamlanmış (başlangıç/bitiş damgalı) bir görev satırı + girintili, onay kutusuz ayrıntı maddeleri.
// Tamamlanmış satırlar takvimin "geçmiş görevi planlanmamışlara geri çekme" kuralına takılmaz.
export const buildBlockLines = (b: BlockInput): string[] => {
  const startISO = new Date(`${b.date}T${b.start}:00`).toISOString();
  const endISO = new Date(`${b.date}T${b.end}:00`).toISOString();
  const head = `- [x] ${clean(b.title) || 'Çalışma oturumu'}${b.project ? ` [project:${slugOf(b.project)}]` : ''} [due:${b.date}] [plannedtime:${b.start}-${b.end}] [started:${startISO}] [completed:${endISO}]`;
  const details = b.details.map(clean).filter(Boolean).map(t => `    - ${t}`);
  return [head, ...details];
};

export const appendBlock = (dayContent: string | undefined, header: string, lines: string[]): string => {
  const base = (dayContent === undefined || dayContent.trim() === '' ? `${header}\n\n` : dayContent).replace(/\s+$/, '');
  const lastLine = base.split('\n').pop() || '';
  const sep = TASK_RE.test(lastLine) ? '\n' : '\n\n';
  return `${base}${sep}${lines.join('\n')}\n`;
};

export const logPathOf = (ymd: string, device: string) => `Sistem/Oturumlar/${ymd}-${device}.md`;

export const buildLogEntry = (o: { start: string; end: string; title: string; project?: string; status: string; items: string[] }): string =>
  `## ${o.start}-${o.end} · ${clean(o.title)} (${o.status})\n${o.project ? `Proje: ${o.project}\n` : ''}${o.items.map(t => `- ${clean(t)}`).join('\n')}\n`;

export const appendLog = (existing: string | undefined, ymd: string, entry: string): string => {
  const base = existing && existing.trim() ? existing.replace(/\s+$/, '') : `# Oturum kaydı ${ymd}`;
  return `${base}\n\n${entry}`;
};

// ---------------- kalıcılık (yalnızca bu cihaz) ----------------
const STATE_KEY = 'session_tracker_v1';
const PENDING_KEY = 'session_pending_v1';

export const loadState = (): SessionState | null => {
  try { const raw = localStorage.getItem(STATE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
export const saveState = (s: SessionState | null) => {
  try { if (s) localStorage.setItem(STATE_KEY, JSON.stringify(s)); else localStorage.removeItem(STATE_KEY); } catch { /* depolama dolu olabilir; oturum bellekte sürer */ }
};
export const loadPending = (): SessionSummary[] => {
  try { const raw = localStorage.getItem(PENDING_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch { return []; }
};
export const savePending = (p: SessionSummary[]) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p.slice(-20))); } catch { /* yoksay */ }
};

// Kasadaki proje notlarından bağlam (#proje etiketli notlar): yol -> ad ve [project:slug] -> ad.
export const projectContextFrom = (notes: { name: string; path: string; type: string }[], contents: Record<string, string | undefined>): ProjectContext => {
  const projectByPath: Record<string, string> = {};
  const projectBySlug: Record<string, string> = {};
  notes.forEach(n => {
    if (n.type !== 'note' || n.path.split('/').some(seg => seg.startsWith('.'))) return;
    if (!PROJECT_TAG_REGEX.test(contents[n.path] || '')) return;
    const name = n.name.replace(/\.md$/i, '');
    projectByPath[n.path] = name;
    projectBySlug[name.toLocaleLowerCase('tr').replace(/\s+/g, '-')] = name;
  });
  return { projectByPath, projectBySlug };
};
