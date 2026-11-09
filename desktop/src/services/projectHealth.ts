// Proje sağlık radarı: her proje için görev etkinliğine bakıp "çeki düzen" önerileri üretir (yapay zekâ yok, ağ yok).
// Not değişiklik zamanına (mtime) GÜVENİLMEZ: otomatik damgalar/senkron birçok notu "yeni değişmiş" gösterir. Bu yüzden
// etkinlik, görevlerdeki [completed:] zamanından ölçülür; mtime yalnızca "görevsiz ve uzun süredir dokunulmamış" kontrolünde,
// ve eksik uyarı verme yönünde (güvenli) kullanılır.

export type ProjectStatus = 'aktif' | 'beklemede' | 'tamamlandi' | 'arsiv';
export type HealthRule = 'gecikmis' | 'bloklu' | 'sessiz' | 'bitti' | 'bos';
export type HealthAction = 'arsiv' | 'tamamlandi' | 'beklemede';

export interface HealthProject { name: string; path: string; updatedAt: number; status: ProjectStatus }
export interface HealthItem {
  rule: HealthRule;
  name: string;
  path: string;
  text: string;
  actions: HealthAction[];
  severity: 1 | 2 | 3; // 1 en acil
}

interface Line { checked: boolean; due?: string; completedAt?: number; blocked: boolean }

const DAY = 24 * 3600 * 1000;
const CHECKLIST = /^(\s*)[*\-]\s+\[([ xX\/])\]\s*(.*)$/;

const slugOf = (name: string) => name.toLocaleLowerCase('tr').replace(/\s+/g, '-');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const collectProjectLines = (
  projects: HealthProject[],
  fileContents: Record<string, string>
): Map<string, Line[]> => {
  const out = new Map<string, Line[]>();
  const bySlug = new Map<string, string>();
  const byPath = new Map<string, string>();
  projects.forEach(p => { out.set(p.path, []); bySlug.set(slugOf(p.name.replace(/\.md$/i, '')), p.path); byPath.set(p.path, p.path); });

  Object.keys(fileContents).forEach(path => {
    if (!/\.md$/i.test(path) || path.split('/').some(seg => seg.startsWith('.'))) return;
    const own = byPath.get(path);
    (fileContents[path] || '').split('\n').forEach(raw => {
      const m = raw.match(CHECKLIST);
      if (!m) return;
      // Derin girintili satırlar (planlayıcının seans satırları) iş sayılmaz.
      const indent = m[1].replace(/\t/g, '    ').length;
      if (indent >= 4) return;
      const tag = (raw.match(/\[project:([^\]]+)\]/i) || [])[1];
      const target = own || (tag ? bySlug.get(tag.toLowerCase().trim()) : undefined);
      if (!target) return;
      const completed = (raw.match(/\[completed:([^\]]+)\]/) || [])[1];
      const due = (raw.match(/\[due:(\d{4}-\d{2}-\d{2})/) || [])[1];
      let completedAt = completed ? Date.parse(completed) : undefined;
      // Kullanıcı kuralı: unutulup sonradan kapatılan ya da ertesi gün girilen görevler HATALI zaman verisidir, etkinlik
      // hesabına katılmaz. Son tarihinden bir günden fazla sonra "tamamlandı" damgası alan görev bu sayılır.
      if (completedAt !== undefined && due && completedAt > Date.parse(`${due}T23:59:59`) + DAY) completedAt = undefined;
      out.get(target)!.push({
        checked: m[2].toLowerCase() === 'x',
        due,
        completedAt,
        blocked: /\[status:blocked\]/i.test(raw)
      });
    });
  });
  return out;
};

export const computeProjectHealth = (
  projects: HealthProject[],
  fileContents: Record<string, string>,
  now: Date = new Date()
): HealthItem[] => {
  const lines = collectProjectLines(projects, fileContents);
  const today = ymd(now);
  const items: HealthItem[] = [];

  projects.forEach(p => {
    if (p.status === 'tamamlandi' || p.status === 'arsiv') return;
    const ls = lines.get(p.path) || [];
    const total = ls.length;
    const open = ls.filter(l => !l.checked);
    const overdue = open.filter(l => l.due && l.due < today);
    const blocked = open.filter(l => l.blocked);
    const lastDone = Math.max(0, ...ls.filter(l => l.completedAt && !isNaN(l.completedAt)).map(l => l.completedAt!));
    const idleDays = lastDone ? Math.floor((now.getTime() - lastDone) / DAY) : Infinity;
    const noteIdleDays = Math.floor((now.getTime() - p.updatedAt) / DAY);
    const base = { name: p.name.replace(/\.md$/i, ''), path: p.path };

    if (overdue.length > 0) {
      items.push({ ...base, rule: 'gecikmis', severity: 1, actions: [], text: `${overdue.length} gecikmiş görev var (son tarihi geçmiş).` });
    }
    if (blocked.length > 0) {
      items.push({ ...base, rule: 'bloklu', severity: 1, actions: [], text: `${blocked.length} görev bloklu durumda.` });
    }
    // Hiç görev bitmemişse (yeni proje olabilir) notun da 30+ gündür değişmemiş olması şart; yoksa yanlış alarm olur.
    const quiet = lastDone ? idleDays >= 30 : noteIdleDays >= 30;
    if (open.length > 0 && quiet) {
      items.push({
        ...base, rule: 'sessiz', severity: 2, actions: ['beklemede'],
        text: `${open.length} açık görev var ama ${idleDays === Infinity ? 'hiçbiri bitmemiş' : `${idleDays} gündür hiçbiri bitmedi`}. Beklemeye almak ister misiniz?`
      });
    }
    if (total > 0 && open.length === 0) {
      items.push({ ...base, rule: 'bitti', severity: 3, actions: ['tamamlandi', 'arsiv'], text: 'Tüm görevler bitti.' });
    }
    if (total === 0 && noteIdleDays >= 30) {
      items.push({ ...base, rule: 'bos', severity: 3, actions: ['arsiv', 'beklemede'], text: 'Hiç görevi yok ve notu uzun süredir değişmemiş.' });
    }
  });

  return items.sort((a, b) => a.severity - b.severity || a.name.localeCompare(b.name, 'tr'));
};
