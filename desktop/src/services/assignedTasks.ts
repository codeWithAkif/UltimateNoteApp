// "Atanan işler": şirket proje yönetim uygulamasından (electron/taskSource.cjs) gelen ham veriyi (HTML tablosu ya da JSON) görevlere çevirir ve her ekip için
// bir proje notuna yazar. Yalnızca OKUNUR (şirket uygulamasına hiçbir şey yazılmaz). Saf işlevler (ağ/disk yok); ayar/durum küçük localStorage yardımcılarıyla.
//
// Görev satırı:  - [/] Başlık [project:ekip-adi] [kaynak:MT-90480] [kdurum:inprogress] [due:2026-11-20]
//  - kaynak: şirket uygulamasındaki görev numarası (aynı iş ikinci kez eklenmesin diye eşleşme anahtarı)
//  - kdurum: son çekmede kaynağın durumu. Yerel durum YALNIZCA kaynak durumu değişince güncellenir; kartı kendiniz taşıdıysanız, kaynak değişmedikçe bozulmaz.

export interface SourceResult { name: string; sourceIndex?: number; kind: 'json' | 'html'; json?: any; table?: { headers: string[]; rows: { cells: string[]; href: string }[] } }
export type RawRow = Record<string, string>;
export interface Mapping { id?: string; title?: string; status?: string; due?: string }
export type StatusKey = 'backlog' | 'inprogress' | 'review' | 'test' | 'park' | 'blocked' | 'done';
export interface AssignedTask { id: string; title: string; status: StatusKey; rawStatus: string; due?: string; href?: string }

// ---------------- ham veriyi satırlara çevirme ----------------
const norm = (s: unknown) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// .NET JSON tarihi "/Date(1795305600000)/" -> yerel gün "2026-11-20"
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const normalizeDue = (raw: string): string | undefined => {
  const s = norm(raw);
  if (!s) return undefined;
  let m = s.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  if (m) return ymdLocal(new Date(parseInt(m[1], 10)));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
};

const scalar = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') return '';
  return String(v);
};

// Bir kaydı düz anahtar/değer çiftlerine indirger: iç nesneler "Ad.Alt" olarak, listeler virgülle birleşik.
const flatten = (o: any): RawRow => {
  const out: RawRow = {};
  Object.keys(o || {}).forEach(k => {
    const v = o[k];
    if (Array.isArray(v)) {
      out[k] = v.map(x => (x && typeof x === 'object' ? scalar(x.Name ?? x.name ?? x.Title ?? x.title ?? x.Text ?? x.text ?? '') : scalar(x))).filter(Boolean).join(', ');
    } else if (v && typeof v === 'object') {
      Object.keys(v).forEach(k2 => { if (typeof v[k2] !== 'object') out[`${k}.${k2}`] = scalar(v[k2]); });
    } else out[k] = scalar(v);
  });
  return out;
};

// JSON içindeki "nesne listesi": kökün kendisi ya da en uzun nesne dizisi (en çok 3 düzey derinde).
export const findRecords = (json: any): any[] => {
  const isObjArray = (a: any) => Array.isArray(a) && a.length > 0 && a.every(x => x && typeof x === 'object' && !Array.isArray(x));
  if (isObjArray(json)) return json;
  let best: any[] = [];
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 3) return;
    if (Array.isArray(node)) { node.slice(0, 3).forEach(x => walk(x, depth + 1)); return; }
    Object.keys(node).forEach(k => {
      const v = node[k];
      if (isObjArray(v) && v.length > best.length) best = v;
      walk(v, depth + 1);
    });
  };
  walk(json, 0);
  return best;
};

export const rowsFromResult = (r: SourceResult): { fields: string[]; rows: RawRow[] } => {
  if (r.kind === 'html' && r.table) {
    const seen = new Map<string, number>();
    const fields = r.table.headers.map((h, i) => {
      let name = norm(h) || `Sütun ${i + 1}`;
      const n = (seen.get(name) || 0) + 1; seen.set(name, n);
      return n > 1 ? `${name} (${n})` : name;
    });
    const rows = r.table.rows.map(row => {
      const o: RawRow = {};
      fields.forEach((f, i) => { o[f] = norm(row.cells[i]); });
      if (row.href) o.__href = row.href;
      return o;
    });
    return { fields, rows };
  }
  const recs = findRecords(r.json).map(flatten);
  const fields = [...new Set(recs.flatMap(o => Object.keys(o)))];
  return { fields, rows: recs };
};

// Satır filtresi: örn. Atanan sütununda "MS" geçenler (başkalarının işleri de gelirse yalnızca sizinkiler alınsın).
export const applyFilter = (rows: RawRow[], f?: RowFilter): RawRow[] => {
  const needle = (f?.contains || '').trim().toLocaleLowerCase('tr');
  if (!f || !f.column || !needle) return rows;
  return rows.filter(r => String(r[f.column] || '').toLocaleLowerCase('tr').includes(needle));
};

// ---------------- alan eşleme tahmini ----------------
const pick = (fields: string[], exact: RegExp, loose: RegExp): string | undefined =>
  fields.find(f => exact.test(f)) || fields.find(f => loose.test(f));

export const guessMapping = (fields: string[]): Mapping => {
  const f = fields.filter(x => x !== '__href');
  return {
    id: pick(f, /^(taskkey|task ?key|key|task ?no|issue ?key|no|numara|iş ?no|kod|code|#)$/i, /(key|code|kod|numara|\bno\b)$/i) || pick(f, /^(id|taskid)$/i, /(^|[^a-z])id$/i),
    title: pick(f, /^(title|name|subject|summary|başlık|baslik|konu|görev|gorev|iş|task ?name|task ?title|taskname|tasktitle)$/i, /(title|başlık|baslik|subject|summary|name|konu|görev|gorev)/i),
    status: pick(f, /^(status|durum|state|aşama|asama|stage|column)$/i, /(status|durum|state|aşama|stage)/i),
    due: pick(f, /^(due ?date|duedate|deadline|bitiş|bitis|bitiş tarihi|termin|son tarih|end ?date)$/i, /(due|deadline|bitiş|bitis|termin|son ?tarih|end ?date|target)/i)
  };
};

// ---------------- durum eşleme ----------------
export const mapStatus = (text: string, override?: Record<string, StatusKey>): StatusKey => {
  const t = norm(text).toLocaleLowerCase('tr');
  if (override && override[t]) return override[t];
  if (!t) return 'backlog';
  if (/(done|tamam|bitti|bitir|kapa[tnl]|closed|resolved|complete|iptal|cancel)/.test(t)) return 'done';
  if (/(progress|devam|doing|çalış|calis|started|aktif|active)/.test(t)) return 'inprogress';
  if (/(hold|bekle|park|askı|aski|ertelen|waiting|paused)/.test(t)) return 'park';
  if (/(block|bloke|engel)/.test(t)) return 'blocked';
  if (/(review|incele)/.test(t)) return 'review';
  if (/(^|[^a-z])test/.test(t)) return 'test';
  return 'backlog'; // Backlog, To Do, Main Tasks, Yeni...
};

export const sanitizeId = (s: string): string => norm(s).replace(/[^A-Za-z0-9_.\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const hash = (s: string): string => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); };
const cleanTitle = (s: string): string => norm(s).replace(/\[/g, '(').replace(/\]/g, ')').slice(0, 200);

export const toTasks = (rows: RawRow[], m: Mapping, statusMap?: Record<string, StatusKey>): AssignedTask[] => {
  const out: AssignedTask[] = [];
  const seen = new Set<string>();
  rows.forEach(r => {
    const title = cleanTitle(m.title ? r[m.title] : '');
    if (!title) return;
    const rawId = sanitizeId(m.id ? r[m.id] : '') || sanitizeId((r.__href || '').split('/').slice(-2).join('-')) || `t${hash(title)}`;
    if (seen.has(rawId)) return;
    seen.add(rawId);
    const rawStatus = norm(m.status ? r[m.status] : '');
    out.push({ id: rawId, title, status: mapStatus(rawStatus, statusMap), rawStatus, due: m.due ? normalizeDue(r[m.due]) : undefined, href: r.__href });
  });
  return out;
};

// ---------------- notu güncelleme ----------------
export const slugOfName = (name: string): string => name.toLocaleLowerCase('tr').replace(/\s+/g, '-');
export const noteFileName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Ekip';
export const ASSIGNED_FOLDER = 'Atananlar';
export const notePathFor = (name: string): string => `${ASSIGNED_FOLDER}/${noteFileName(name)}.md`;

const boxFor = (s: StatusKey): string => (s === 'done' ? 'x' : s === 'backlog' ? ' ' : '/');
const statusTag = (s: StatusKey): string => (['review', 'test', 'park', 'blocked'].includes(s) ? ` [status:${s}]` : '');

const buildLine = (t: AssignedTask, slug: string): string =>
  `- [${boxFor(t.status)}] ${t.title} [project:${slug}] [kaynak:${t.id}] [kdurum:${t.status}]${t.due ? ` [due:${t.due}]` : ''}${statusTag(t.status)}`;

const LINE_RE = /^(\s*[-*]\s+\[)([ xX/])(\]\s*)(.*)$/;
const TAG_START = /\s\[[A-Za-zçğıöşüÇĞİÖŞÜ_-]+:/;

export interface ApplyStats { added: number; updated: number; completed: number }

export const applyTasksToNote = (existing: string | undefined, name: string, tasks: AssignedTask[]): { content: string; stats: ApplyStats } => {
  const slug = slugOfName(name);
  const stats: ApplyStats = { added: 0, updated: 0, completed: 0 };
  const base = existing && existing.trim() ? existing.replace(/\s+$/, '') : `# ${name}\n\n#proje #atananlar\n`;
  const lines = base.split('\n');
  const idx = new Map<string, number>();
  lines.forEach((l, i) => { const m = l.match(/\[kaynak:([^\]]+)\]/); if (m && LINE_RE.test(l) && !idx.has(m[1])) idx.set(m[1], i); });

  const added: string[] = [];
  tasks.forEach(t => {
    const i = idx.get(t.id);
    if (i === undefined) { added.push(buildLine(t, slug)); stats.added++; return; }
    const m = lines[i].match(LINE_RE)!;
    let box = m[2];
    let body = m[4];
    let changed = false;

    // Başlık: ilk etiketten önceki metin
    const cut = body.search(TAG_START);
    const titlePart = (cut === -1 ? body : body.slice(0, cut)).trim();
    if (titlePart !== t.title) { body = t.title + (cut === -1 ? '' : body.slice(cut)); changed = true; }

    // Durum: yalnızca kaynağın durumu son çekmeden beri değiştiyse yerele uygulanır
    const last = (body.match(/\[kdurum:([a-z]+)\]/) || [])[1];
    if (last !== t.status) {
      if (last !== undefined) {
        const wasDone = box.toLowerCase() === 'x';
        box = boxFor(t.status);
        body = body.replace(/\s*\[status:[a-z0-9_-]+\]/gi, '') + statusTag(t.status);
        if (t.status === 'done' && !wasDone) stats.completed++;
      }
      body = /\[kdurum:[a-z]+\]/.test(body) ? body.replace(/\[kdurum:[a-z]+\]/, `[kdurum:${t.status}]`) : `${body} [kdurum:${t.status}]`;
      changed = true;
    }
    if (t.due && !/\[due:/.test(body)) { body += ` [due:${t.due}]`; changed = true; }
    if (changed) { lines[i] = `${m[1]}${box}${m[3]}${body}`; stats.updated++; }
  });

  const content = (added.length ? [...lines, ...added] : lines).join('\n').replace(/\s+$/, '') + '\n';
  return { content, stats };
};

// ---------------- "cURL olarak kopyala" içe aktarma ----------------
// Tarayıcıda F12 > Network > istek > sağ tık > Copy as cURL ile alınan komuttan adres, yöntem ve gövde çıkarılır. Çerez/Authorization gibi gizli başlıklar ATILIR.
export interface CurlImport { url: string; method: 'GET' | 'POST'; body?: string; contentType?: string; dropped: string[] }

const tokenize = (src: string): string[] => {
  const s = src.replace(/\^\r?\n/g, ' ').replace(/\\\r?\n/g, ' ').replace(/\^"/g, '"').replace(/\^\^/g, '^');
  const out: string[] = [];
  let cur = '', q: string | null = null, has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) { q = null; continue; }
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
      cur += c; has = true; continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
};

export const parseCurl = (text: string): CurlImport | null => {
  const toks = tokenize(text.trim());
  if (toks.length === 0 || !/^curl(\.exe)?$/i.test(toks[0])) return null;
  let url = '', method = '', body: string | undefined, contentType: string | undefined;
  const dropped: string[] = [];
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-X' || t === '--request') method = (toks[++i] || '').toUpperCase();
    else if (t === '-H' || t === '--header') {
      const h = toks[++i] || '';
      const k = h.split(':')[0].trim().toLowerCase();
      if (['cookie', 'authorization', 'x-csrf-token', 'x-xsrf-token', 'requestverificationtoken', '__requestverificationtoken'].includes(k)) dropped.push(k);
      else if (k === 'content-type') contentType = h.slice(h.indexOf(':') + 1).trim();
    }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(t)) body = toks[++i];
    else if (t === '--url') url = toks[++i] || '';
    else if (t === '-b' || t === '--cookie') { dropped.push('cookie'); i++; }
    else if (t.startsWith('-')) { /* diğer bayraklar yok sayılır */ }
    else if (!url) url = t;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, method: method === 'POST' || (body !== undefined && method !== 'GET') ? 'POST' : 'GET', body, contentType, dropped: [...new Set(dropped)] };
};

// ---------------- ayar ve durum (bu cihaz) ----------------
export interface RowFilter { column: string; contains: string }
export interface SourceCfg { name: string; url: string; method?: 'GET' | 'POST'; body?: string; contentType?: string; cookies?: string; team?: string; filter?: RowFilter; mapping?: Mapping; statusMap?: Record<string, StatusKey> }
export interface AssignedCfg { enabled: boolean; loginUrl: string; allowHttp: boolean; intervalMin: number; sources: SourceCfg[] }
export interface AssignedState { lastSync?: number; lastCode?: string; lastError?: string; paused?: boolean; summary?: string }

const CFG_KEY = 'assigned_tasks_cfg_v1';
const STATE_KEY = 'assigned_tasks_state_v1';
export const defaultCfg = (): AssignedCfg => ({ enabled: false, loginUrl: '', allowHttp: false, intervalMin: 15, sources: [] });
export const loadCfg = (): AssignedCfg => {
  try { const o = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); return { ...defaultCfg(), ...o, sources: Array.isArray(o.sources) ? o.sources : [] }; } catch { return defaultCfg(); }
};
export const saveCfg = (c: AssignedCfg) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { /* yoksay */ } };
export const loadState = (): AssignedState => { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; } };
export const saveState = (s: AssignedState) => { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* yoksay */ } };
