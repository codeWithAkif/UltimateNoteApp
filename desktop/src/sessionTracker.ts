// Oturum izleyici: kullanıcının uygulamada yaptığı kaydetmelerden "ne yaptınız" özetini çıkarır, etkinlik kaydındaki seanslarla (activityLog)
// eşleştirip takvim bloğu taslakları üretir ve onaylanan bloğu günlük nota yazar. Veri kaynağı dosya değişiklik saati DEĞİL (otomatik
// yazımlar onu bozuyor): ilk kayıt öncesi not içeriği (baseline) saklanır, oturum bitince baseline ile güncel içerik karşılaştırılır.
// Yapay zekâ yok: cümleler kural tabanlıdır. Tüm işlevler saftır (ağ/disk yok), yalnızca load/save yardımcıları localStorage kullanır.

import { PROJECT_TAG_REGEX } from './quickSlots';
import { PROJECT_KICKOFF_CHECKLIST } from './projectTemplate';
import { MINUTE, MIN_ACTIVE_ONLY_MIN, type Run } from './activityLog';

export interface SessionState {
  id: string;
  start: number;
  lastActivity: number;
  baselines: Record<string, string | null>; // null = baseline çok büyüktü/bilinmiyor
  touched: Record<string, { first: number; last: number; mins?: number[] }>; // mins: kaydetme dakikaları (seans eşleştirmesi için)
}

export type SessionArea = 'notlar' | 'takvim' | 'projeler';
export interface SessionItem {
  id: string; area: SessionArea; text: string; path: string; project?: string;
  title?: string; // görev başlığı (gruplu gösterimde)
  group?: string; // aynı türden öğelerin ortak etiketi ("Son kontrol → Bitti")
}
export interface SessionSummary {
  id: string;
  start: number;
  end: number;
  items: SessionItem[];
  suggestedTitle: string;
  suggestedProject: string | null;
  kind?: 'calisma' | 'toplanti';
  minutes?: number; // net aktif dakika
  ref?: string;     // toplantı taslağında takvim etkinliği anahtarı
}

export interface ProjectContext {
  projectByPath: Record<string, string>; // proje notu yolu -> proje adı
  projectBySlug: Record<string, string>; // [project:slug] -> proje adı
}

export const IDLE_MS = 30 * 60 * 1000; // bu kadar kaydetme boşluğundan sonra oturum biter
const BASELINE_NOTE_CAP = 200_000;
const BASELINE_TOTAL_CAP = 1_500_000;
export const MIN_BLOCK_MS = 15 * 60 * 1000;
const MINS_CAP = 400;

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
  const minute = Math.floor(now / MINUTE);
  const prevMins = t?.mins || [];
  const mins = prevMins.length && prevMins[prevMins.length - 1] === minute ? prevMins : [...prevMins, minute].slice(-MINS_CAP);
  s.touched[path] = { first: t ? t.first : now, last: now, mins };
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

const TITLE_CAP = 160;
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
    title: title.length > TITLE_CAP ? title.slice(0, TITLE_CAP - 1) + '…' : title,
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

// İki başlık arasındaki benzerlik (bigram Dice, 0..1): yazım düzeltmesini "yeni görev" saymamak için.
const dice = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let inter = 0;
  A.forEach((v, k) => { inter += Math.min(v, B.get(k) || 0); });
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
};

// ---------------- proje eşleştirme ----------------
const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü]/g, '');

// Klasör/dosya adı ile proje adını gevşek eşleştirir ("Datahub" klasörü -> "Zorlu DataHub" projesi).
export const matchProjectName = (seg: string, names: string[]): string | undefined => {
  const n = norm(seg);
  if (!n) return undefined;
  let best: string | undefined, bestLen = -1;
  for (const name of names) {
    const m = norm(name);
    if (!m) continue;
    if (m === n) return name;
    if (n.length >= 4 && m.length >= 4 && (m.includes(n) || n.includes(m))) {
      const len = Math.min(m.length, n.length);
      if (len > bestLen) { best = name; bestLen = len; }
    }
  }
  return best;
};

// Bir notun hangi projeye ait olduğu: proje notunun kendisi, ya da Müşteriler/<müşteri>/Projeler/<proje>[.md|/...] altındaki herhangi bir not.
export const projectForPath = (path: string, ctx: ProjectContext): string | undefined => {
  if (ctx.projectByPath[path]) return ctx.projectByPath[path];
  const m = path.match(/^(Müşteriler\/[^/]+)\/Projeler\/([^/]+)/i);
  if (!m) return undefined;
  const seg = m[2].replace(/\.md$/i, '');
  const entries = Object.entries(ctx.projectByPath);
  const sameClient = entries.filter(([p]) => p.toLocaleLowerCase('tr').startsWith(m[1].toLocaleLowerCase('tr') + '/')).map(([, name]) => name);
  return matchProjectName(seg, sameClient) || matchProjectName(seg, entries.map(([, name]) => name)) || seg;
};

const projectOf = (path: string, slug: string | undefined, ctx: ProjectContext): string | undefined => {
  if (slug) return ctx.projectBySlug[slug] || slug;
  return projectForPath(path, ctx);
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
  const push = (area: SessionArea, text: string, project?: string, extra?: { title?: string; group?: string }) =>
    items.push({ id: `${path}#${n++}`, area, text, path, project, ...extra });

  if (before === null) {
    push('notlar', `“${name}” notunda değişiklik yaptınız`, projectForPath(path, ctx));
    return items;
  }

  const taskMap = (content: string) => {
    const m = new Map<string, TaskLine[]>();
    content.split('\n').forEach(l => { const t = parseTask(l); if (t) { const a = m.get(t.key); if (a) a.push(t); else m.set(t.key, [t]); } });
    return m;
  };
  const bt = taskMap(before), at = taskMap(after);

  // Oturumda yeni oluşturulan not (baseline boş): toplu gelen görevleri tek cümlede topla. Kural yapısaldır, anlam çıkarmaz:
  // - Başlangıç kontrol listesi satırları (ortak şablondan) en az 4 ise yalnızca onlar birleşir; sizin ayrıca eklediğiniz görevler tek tek kalır.
  // - Şablon yoksa ve notta en az 4 görev varsa hepsi birleşir.
  // Cümle görev sayısını ve notun ### başlıklarını söyler.
  let collapsed = false;
  const collapsedKeys = new Set<string>();
  if (before.trim() === '') {
    const tplKeys = new Set<string>();
    PROJECT_KICKOFF_CHECKLIST.split('\n').forEach(l => { const t = parseTask(l); if (t) tplKeys.add(t.key); });
    const allKeys: string[] = [];
    at.forEach((arr, k) => arr.forEach(() => allKeys.push(k)));
    const tplCount = allKeys.filter(k => tplKeys.has(k)).length;
    let group: string[] | null = null;
    if (tplCount >= 4) group = allKeys.filter(k => tplKeys.has(k));
    else if (allKeys.length >= 4) group = allKeys;
    if (group) {
      collapsed = true;
      group.forEach(k => collapsedKeys.add(k));
      const heads = after.split('\n').map(l => l.match(/^#{2,6}\s+(.+?)\s*$/)).filter((m): m is RegExpMatchArray => !!m)
        .map(m => m[1].replace(/\p{Extended_Pictographic}️?/gu, '').trim()).filter(h => h && !/Kontrol Listesi$/i.test(h));
      const headText = heads.length >= 2 ? `, ${heads.length} başlık: ${heads.slice(0, 4).join(', ')}${heads.length > 4 ? '…' : ''}` : '';
      const isProject = PROJECT_TAG_REGEX.test(after);
      push(isProject ? 'projeler' : 'notlar', `“${name}” ${isProject ? 'projesini' : 'notunu'} oluşturdunuz (${group.length} görev${headText})`, projectForPath(path, ctx) || (isProject ? name : undefined));
    }
  }

  // Eşleşmeyen eski görevler: başlığı değiştirilmiş (yazım düzeltmesi) bir görev "yeni görev" sayılmasın.
  const pool: TaskLine[] = [];
  bt.forEach((befores, key) => { const afters = at.get(key) || []; for (let i = afters.length; i < befores.length; i++) pool.push(befores[i]); });
  const takeRenamed = (a: TaskLine): TaskLine | undefined => {
    let bi = -1, best = 0;
    pool.forEach((r, i) => { const s = dice(r.key, a.key); if (s >= 0.8 && s > best) { best = s; bi = i; } });
    return bi >= 0 ? pool.splice(bi, 1)[0] : undefined;
  };

  at.forEach((afters, key) => {
    const befores = bt.get(key) || [];
    afters.forEach((a, i) => {
      let b: TaskLine | undefined = befores[i];
      if (!b) {
        if (collapsed && collapsedKeys.has(key)) return;
        b = takeRenamed(a);
      }
      const project = projectOf(path, a.project, ctx);
      const base = { title: a.title };
      if (!b) {
        if (a.checked) push('projeler', `“${a.title}” görevi eklendi ve tamamlandı`, project, { ...base, group: 'Eklendi ve tamamlandı' });
        else if (a.due || a.time) push('takvim', `Takvime “${a.title}” işini eklediniz (${when(a.due, a.time)})`, project, { ...base, group: 'Takvime eklenenler' });
        else push('projeler', `“${a.title}” görevini eklediniz`, project, { ...base, group: 'Eklenen görevler' });
        return;
      }
      // Nereden nereye: baseline'daki ve güncel sütun birlikte yazılır (arada birden çok taşıma olduysa yalnızca net sonuç).
      if (!b.checked && a.checked) {
        const from = statusLabel(b.status);
        if (b.status === 'test') push('projeler', `“${a.title}” görevi test edildi ve tamamlandı (Test → Bitti)`, project, { ...base, group: 'Test edildi ve tamamlandı (Test → Bitti)' });
        else if (b.status === 'review') push('projeler', `“${a.title}” görevi incelendi ve tamamlandı (İncelemede → Bitti)`, project, { ...base, group: 'İncelendi ve tamamlandı (İncelemede → Bitti)' });
        else if (b.status === 'backlog') push('projeler', `“${a.title}” görevini tamamladınız`, project, { ...base, group: 'Tamamlanan görevler' });
        else push('projeler', `“${a.title}” görevini ${from} aşamasından tamamladınız (${from} → Bitti)`, project, { ...base, group: `${from} → Bitti` });
      } else if (b.checked && !a.checked) {
        push('projeler', `“${a.title}” görevini yeniden açtınız (Bitti → ${statusLabel(a.status)})`, project, { ...base, group: `Yeniden açıldı (Bitti → ${statusLabel(a.status)})` });
      } else if (b.status !== a.status) {
        push('projeler', `“${a.title}” kartını ${statusLabel(b.status)} sütunundan ${statusLabel(a.status)} sütununa taşıdınız`, project, { ...base, group: `${statusLabel(b.status)} → ${statusLabel(a.status)} sütununa taşındı` });
      }
      // Tamamlanmış bir bloğun/işin saatini sonradan düzeltmek (ör. oturum bloğunu uzatmak) iş sayılmaz.
      if ((b.due !== a.due || b.time !== a.time) && (a.due || a.time) && !(b.checked && a.checked)) {
        push('takvim', `“${a.title}” işinin takvim zamanını değiştirdiniz (${when(a.due, a.time)})`, project, { ...base, group: 'Takvim zamanı değişti' });
      }
    });
  });

  // Görev olmayan satırlar: eklenen satır sayısı (çoklu küme farkı). Günlük notlar kişisel yazıdır, oturum blokları da oraya yazılır: sayılmaz.
  if (!/^Günlükler\//i.test(path)) {
    const beforeCount = new Map<string, number>();
    textLinesOf(before).forEach(l => beforeCount.set(l, (beforeCount.get(l) || 0) + 1));
    const added: string[] = [];
    textLinesOf(after).forEach(l => {
      const c = beforeCount.get(l) || 0;
      if (c > 0) beforeCount.set(l, c - 1); else added.push(l);
    });
    if (added.length > 0 && !collapsed) {
      const sample = stripTags(added[0].replace(/^[#>\-*\s\d.]+/, '')).slice(0, 60);
      if (before.trim() === '') push('notlar', `“${name}” notunu oluşturdunuz (${added.length} satır)${sample ? ` — “${sample}…”` : ''}`, projectForPath(path, ctx));
      else push('notlar', `“${name}” notuna ${added.length} satır eklediniz${sample ? ` — “${sample}…”` : ''}`, projectForPath(path, ctx));
    }
  }
  return items;
};

// Oturumdaki tüm notların net farkı.
export const diffSession = (s: SessionState, currentContents: Record<string, string | undefined>, ctx: ProjectContext): SessionItem[] => {
  const items: SessionItem[] = [];
  Object.keys(s.touched).forEach(path => {
    const cur = currentContents[path];
    if (cur === undefined) return; // silinmiş not
    const base = s.baselines[path];
    if (base !== undefined && base !== null && base === cur) return; // net değişiklik yok (yazıp geri aldı)
    items.push(...diffNote(path, base === undefined ? null : base, cur, ctx));
  });
  return items;
};

const AREA_ORDER: Record<SessionArea, number> = { notlar: 0, takvim: 1, projeler: 2 };

// Bloğun altına yazılacak ayrıntı satırları: aynı türden öğeler tek başlık + alt maddeler olur ("Son kontrol → Bitti (7 görev)").
// Alt maddeler iki boşlukla başlar (buildBlockLines bunu iç içe madde yapar).
export const buildDetails = (items: SessionItem[]): string[] => {
  const out: string[] = [];
  const groups = new Map<string, SessionItem[]>();
  const order: (SessionItem | string)[] = [];
  items.forEach(i => {
    if (i.group) {
      const g = groups.get(i.group);
      if (g) g.push(i); else { groups.set(i.group, [i]); order.push(i.group); }
    } else order.push(i);
  });
  order.forEach(o => {
    if (typeof o === 'string') {
      const g = groups.get(o)!;
      if (g.length >= 2) { out.push(`${o} (${g.length} görev)`); g.forEach(i => out.push(`  ${i.title || i.text}`)); }
      else out.push(g[0].text);
    } else out.push(o.text);
  });
  return out;
};

// ---------------- taslaklar ----------------
// Diff öğelerini ve etkinlik seanslarını birleştirir: her (proje × seans) bir takvim bloğu taslağı olur. Öğe, kaydedildiği
// dakikalara en çok denk gelen seansa atanır. Notta değişiklik olmayan seans en az 10 aktif dakika ise (okuma/gezinme) yine taslak olur.
export const buildDrafts = (
  items: SessionItem[],
  touched: SessionState['touched'],
  runs: Run[],
  opt: { includeProjectless: boolean; idPrefix: string }
): SessionSummary[] => {
  const keep = (p?: string) => !!p || opt.includeProjectless;
  const its = items.filter(i => keep(i.project));
  const assigned = new Map<Run, SessionItem[]>();
  const orphans: SessionItem[] = [];

  for (const it of its) {
    const p = it.project || '';
    const rs = runs.filter(r => r.project === p);
    if (rs.length === 0) { orphans.push(it); continue; }
    const t = touched[it.path];
    const mins = t?.mins || [];
    let best = rs[0], bestScore = -Infinity;
    for (const r of rs) {
      const a = Math.floor(r.start / MINUTE), b = Math.ceil(r.end / MINUTE);
      let score = mins.filter(m => m >= a && m <= b).length;
      if (score === 0 && t) score = -Math.min(Math.abs(t.last - r.start), Math.abs(t.last - r.end)) / 1e12;
      if (score > bestScore) { best = r; bestScore = score; }
    }
    const list = assigned.get(best);
    if (list) list.push(it); else assigned.set(best, [it]);
  }

  const sortItems = (a: SessionItem[]) => a.slice().sort((x, y) => AREA_ORDER[x.area] - AREA_ORDER[y.area]);
  const titleFor = (project: string, list: SessionItem[]) => {
    if (project) return `${project} çalışması`;
    const top = list[0] ? noteNameOf(list[0].path).replace(/_/g, ' ') : '';
    return top ? `${top} çalışması` : 'Çalışma oturumu';
  };
  const mk = (project: string, start: number, end: number, list: SessionItem[], minutes: number): SessionSummary => ({
    id: `${opt.idPrefix}:${project || '_'}:${start}`,
    start,
    end: Math.max(end, start + MIN_BLOCK_MS),
    items: sortItems(list),
    suggestedProject: project || null,
    suggestedTitle: titleFor(project, list),
    kind: 'calisma',
    minutes
  });

  const drafts: SessionSummary[] = [];
  runs.forEach(r => {
    if (!keep(r.project)) return;
    const list = assigned.get(r) || [];
    if (list.length === 0 && r.minutes < MIN_ACTIVE_ONLY_MIN) return;
    drafts.push(mk(r.project, r.start, r.end, list, r.minutes));
  });

  // Etkinlik kaydı olmayan projelerin öğeleri (eski durum / hareket işareti alınamadı): dokunulan notların ilk-son anından blok.
  const byProject = new Map<string, SessionItem[]>();
  orphans.forEach(i => { const k = i.project || ''; const a = byProject.get(k); if (a) a.push(i); else byProject.set(k, [i]); });
  byProject.forEach((list, project) => {
    let first = Infinity, last = 0;
    list.forEach(i => { const t = touched[i.path]; if (t) { first = Math.min(first, t.first); last = Math.max(last, t.last); } });
    if (first === Infinity) { first = Date.now() - MIN_BLOCK_MS; last = Date.now(); }
    drafts.push(mk(project, first, last, list, 0));
  });

  return drafts.sort((a, b) => a.start - b.start);
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
  details: string[]; // iki boşlukla başlayan satır alt madde olur
}

// Takvim bloğu: tamamlanmış (başlangıç/bitiş damgalı) bir görev satırı + girintili, onay kutusuz ayrıntı maddeleri.
// Tamamlanmış satırlar takvimin "geçmiş görevi planlanmamışlara geri çekme" kuralına takılmaz.
export const buildBlockLines = (b: BlockInput): string[] => {
  const startISO = new Date(`${b.date}T${b.start}:00`).toISOString();
  const endISO = new Date(`${b.date}T${b.end}:00`).toISOString();
  const head = `- [x] ${clean(b.title) || 'Çalışma oturumu'}${b.project ? ` [project:${slugOf(b.project)}]` : ''} [due:${b.date}] [plannedtime:${b.start}-${b.end}] [started:${startISO}] [completed:${endISO}]`;
  const details = b.details
    .filter(t => clean(t) !== '')
    .map(t => `${/^\s{2,}/.test(t) ? '        ' : '    '}- ${clean(t)}`);
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
  `## ${o.start}-${o.end} · ${clean(o.title)} (${o.status})\n${o.project ? `Proje: ${o.project}\n` : ''}${o.items.filter(t => clean(t) !== '').map(t => `${/^\s{2,}/.test(t) ? '  ' : ''}- ${clean(t)}`).join('\n')}\n`;

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
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p.slice(-40))); } catch { /* yoksay */ }
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
