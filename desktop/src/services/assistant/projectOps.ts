// Asistanın Proje Yönetimi işlemleri için saf mantık: görev bulma, durum değiştirme satırı, yeni müşteri/proje dosyası.
// Burada ağ/arayüz yoktur; AppAssistant kartları bu fonksiyonları çağırır (test edilebilir).
// Görev durumu satırın kendisinde saklanır: kutu (' ' backlog, '/' devam, 'x' bitti) + gerekirse [status:anahtar] (bkz. kanbanColumns.ts).

export const foldTr = (x: string): string =>
  x.replace(/[İI]/g, 'i').replace(/ı/g, 'i').toLowerCase().replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/\s+/g, ' ').trim();

export const slugOf = (name: string): string => name.replace(/\.md$/i, '').toLocaleLowerCase('tr').replace(/\s+/g, '-');

export interface StatusCol { key: string; title: string }
export const DEFAULT_STATUS_COLS: StatusCol[] = [
  { key: 'backlog', title: 'Backlog' }, { key: 'inprogress', title: 'Devam Ediyor' }, { key: 'test', title: 'Test' },
  { key: 'review', title: 'İncelemede' }, { key: 'park', title: 'Park' }, { key: 'blocked', title: 'Bloklu' }, { key: 'done', title: 'Bitti' }
];

// Kullanıcının/modelin söylediği durum adını sütun anahtarına çevirir ("tamamlandı" → done). Bulamazsa ''.
const ALIAS: Record<string, string> = {
  bitti: 'done', bitir: 'done', tamamlandi: 'done', tamam: 'done', tamamla: 'done', yapildi: 'done', done: 'done',
  'devam ediyor': 'inprogress', devam: 'inprogress', yapiliyor: 'inprogress', inprogress: 'inprogress', 'in progress': 'inprogress',
  backlog: 'backlog', yapilacak: 'backlog', beklemede: 'backlog', todo: 'backlog',
  incelemede: 'review', inceleme: 'review', review: 'review',
  bloklu: 'blocked', engelli: 'blocked', blocked: 'blocked'
};
export const matchStatus = (v: string, cols: StatusCol[]): string => {
  const q = foldTr(v);
  if (!q) return '';
  const byKey = cols.find(c => c.key === q);
  if (byKey) return byKey.key;
  const byTitle = cols.find(c => foldTr(c.title) === q);
  if (byTitle) return byTitle.key;
  const al = ALIAS[q];
  return al && cols.some(c => c.key === al) ? al : '';
};

const CHECK_RE = /^(\s*[*\-]\s+\[)([ xX\/])(\]\s*)(.*)$/;

export const lineStatus = (line: string): string | null => {
  const m = CHECK_RE.exec(line.replace(/\r$/, ''));
  if (!m) return null;
  const tag = /\[status:([a-z0-9_-]+)\]/i.exec(m[4]);
  if (m[2] === 'x' || m[2] === 'X') return 'done';
  if (tag) return tag[1].toLowerCase();
  return m[2] === '/' ? 'inprogress' : 'backlog';
};

export const taskTitle = (line: string): string => {
  const m = CHECK_RE.exec(line.replace(/\r$/, ''));
  return (m ? m[4] : line).replace(/\[[^\]]*\]/g, ' ').replace(/#[\p{L}\p{N}_-]+/gu, ' ').replace(/\s+/g, ' ').trim();
};

// App.handleChangeTaskStatus ile aynı satır kuralı: kutu + (backlog/inprogress/done dışındaki) durumlar için [status:] etiketi.
export const applyStatusToLine = (line: string, key: string): string | null => {
  const cr = line.endsWith('\r') ? '\r' : '';
  const m = CHECK_RE.exec(line.replace(/\r$/, ''));
  if (!m) return null;
  const ch = key === 'done' ? 'x' : key === 'backlog' ? ' ' : '/';
  let rest = m[4].replace(/\s*\[status:[a-z0-9_-]+\]/gi, '');
  if (key !== 'backlog' && key !== 'inprogress' && key !== 'done') rest = `${rest} [status:${key}]`;
  return `${m[1]}${ch}${m[3]}${rest}${cr}`;
};

export interface TaskCand { path: string; lineIdx: number; title: string; durum: string; proje: string }

const STOP = new Set(['gorev', 'gorevi', 'gorevini', 'gorevleri', 'task', 'taski', 'taskini', 'tasklari', 'kart', 'karti', 'kartini', 'olan', 'adli', 'isimli', 'su', 'bu', 'o']);
const tokens = (s: string) => foldTr(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !STOP.has(t));

// Proje görevleri: proje notunun içindeki checklist satırları VE vault'ta [project:slug] etiketi taşıyan satırlar.
export const findTaskCandidates = (
  files: Record<string, string>,
  projects: Map<string, string>,              // proje adı → not yolu
  q: { baslik: string; proje?: string; mevcut?: string }
): TaskCand[] => {
  const qt = tokens(q.baslik);
  if (!qt.length) return [];
  const bySlug = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const [name, path] of projects) { bySlug.set(slugOf(name), name); byPath.set(path, name); }
  const out: TaskCand[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!/\.md$/i.test(path) || !content) continue;
    const own = byPath.get(path);
    if (!own && !content.includes('[project:')) continue;
    content.split('\n').forEach((raw, lineIdx) => {
      const line = raw.replace(/\r$/, '');
      if (!CHECK_RE.test(line)) return;
      const tag = /\[project:([^\]\s]+)\]/i.exec(line);
      const proje = tag ? bySlug.get(tag[1].toLowerCase()) : own;
      if (!proje) return;
      if (q.proje && proje !== q.proje) return;
      const durum = lineStatus(line) || 'backlog';
      if (q.mevcut && durum !== q.mevcut) return;
      const title = taskTitle(line);
      const ft = foldTr(title);
      if (!qt.every(t => ft.includes(t))) return;
      out.push({ path, lineIdx, title, durum, proje });
    });
  }
  const exact = foldTr(q.baslik);
  out.sort((a, b) => Number(foldTr(b.title) === exact) - Number(foldTr(a.title) === exact));
  return out.slice(0, 8);
};

export const sanitizeName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

// Müşteri notu: {clientsFolder}/{Ad}/{Ad}.md, içinde #müşteri etiketi (ProjectsView.handleCreateClient ile aynı).
export const newClientFile = (clientsFolder: string, name: string): { path: string; content: string } => {
  const n = sanitizeName(name);
  return { path: `${clientsFolder}/${n}/${n}.md`, content: `# ${n}\n\n#müşteri\n` };
};
// Proje notu: müşteri klasörünün altında Projeler/{Ad}.md, #proje + müşteri slug'ı (ProjectsView.handleCreateProject ile aynı).
export const newProjectFile = (clientName: string, clientPath: string | undefined, clientsFolder: string, ad: string): { path: string; content: string } => {
  const n = sanitizeName(ad);
  const dir = clientPath && clientPath.includes('/') ? clientPath.slice(0, clientPath.lastIndexOf('/')) : '';
  const clientDir = dir && dir.toLowerCase() !== clientsFolder.toLowerCase() ? dir : `${clientsFolder}/${clientName}`;
  return { path: `${clientDir}/Projeler/${n}.md`, content: `# ${n}\n\n#proje #${slugOf(clientName)}\n` };
};
