// Kanban sütunları: varsayılan liste + proje bazında özelleştirme. Ayar, "Sistem/Kanban.md" notunda saklanır
// (not senkronundan bedavaya telefona gider). Bir görevin sütunu satırındaki [status:<anahtar>] etiketiyle
// (ve checkbox ile: ' ' backlog, '/' devam, 'x' bitti) belirlenir.
//
// Renkler "#" OLMADAN saklanır (ör. "a855f7"): not içindeki "#a855f7" genel hashtag tarayıcısınca gerçek bir
// etiket sanılıp kenar çubuğunu kirletirdi. 'accent' özel değeri tema vurgu rengini temsil eder.

export type KanbanColumn = { key: string; title: string; color?: string };

export const KANBAN_CONFIG_PATH = 'Sistem/Kanban.md';

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { key: 'backlog', title: 'Backlog' },
  { key: 'inprogress', title: 'Devam Ediyor', color: 'accent' },
  { key: 'test', title: 'Test', color: 'a855f7' },
  { key: 'review', title: 'İncelemede', color: 'eab308' },
  { key: 'park', title: 'Park', color: '94a3b8' },
  { key: 'blocked', title: 'Bloklu', color: 'ef4444' },
  { key: 'done', title: 'Bitti', color: '4caf50' },
];

export const KANBAN_COLOR_CHOICES = ['accent', 'a855f7', 'eab308', '94a3b8', 'ef4444', '4caf50', '3b82f6', 'f97316', 'ec4899', '06b6d4'];

export const cssKanbanColor = (c?: string): string | undefined => {
  if (!c) return undefined;
  return c === 'accent' ? 'var(--accent-color)' : `#${c.replace(/^#/, '')}`;
};

// Sütun anahtarı: Türkçe karakterler sadeleştirilir, yalnızca [a-z0-9_-]. Etiket regex'iyle uyumludur.
export const slugifyKanbanKey = (title: string, taken: Set<string>): string => {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
  let base = title.toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, ch => map[ch] || ch)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) base = 'sutun';
  let key = base;
  let i = 2;
  while (taken.has(key) || key === 'done') key = `${base}-${i++}`;
  return key;
};

// Geçersiz/bozuk girdilere karşı: anahtarlar benzersiz ve geçerli, 'backlog' ilk, 'done' her zaman son.
export const normalizeKanbanColumns = (list: any): KanbanColumn[] => {
  const out: KanbanColumn[] = [];
  const seen = new Set<string>();
  let done: KanbanColumn | null = null;
  if (Array.isArray(list)) {
    for (const c of list) {
      if (!c || typeof c.key !== 'string' || typeof c.title !== 'string') continue;
      const key = c.key.toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(key) || seen.has(key)) continue;
      const title = c.title.trim().slice(0, 40) || key;
      const col: KanbanColumn = { key, title, ...(typeof c.color === 'string' && c.color ? { color: c.color.replace(/^#/, '') } : {}) };
      seen.add(key);
      if (key === 'done') done = col; else out.push(col);
    }
  }
  if (!out.some(c => c.key === 'backlog')) out.unshift({ key: 'backlog', title: 'Backlog' });
  else {
    const i = out.findIndex(c => c.key === 'backlog');
    if (i > 0) out.unshift(out.splice(i, 1)[0]);
  }
  out.push(done || { key: 'done', title: 'Bitti', color: '4caf50' });
  return out;
};

export interface KanbanConfig {
  varsayilan?: KanbanColumn[];
  projeler: Record<string, KanbanColumn[]>;
}

export const parseKanbanConfig = (content?: string): KanbanConfig => {
  const empty: KanbanConfig = { projeler: {} };
  if (!content) return empty;
  const m = content.match(/```json\s*([\s\S]*?)```/);
  if (!m) return empty;
  try {
    const raw = JSON.parse(m[1]);
    const cfg: KanbanConfig = { projeler: {} };
    if (raw && Array.isArray(raw.varsayilan)) cfg.varsayilan = normalizeKanbanColumns(raw.varsayilan);
    if (raw && raw.projeler && typeof raw.projeler === 'object') {
      Object.keys(raw.projeler).forEach(k => { cfg.projeler[k.toLowerCase()] = normalizeKanbanColumns(raw.projeler[k]); });
    }
    return cfg;
  } catch {
    return empty;
  }
};

export const serializeKanbanConfig = (cfg: KanbanConfig): string => {
  const json = JSON.stringify({ varsayilan: cfg.varsayilan, projeler: cfg.projeler }, null, 2);
  return `# Kanban Sütunları\n\nProje başına Kanban sütunları. Elle düzenlemeyin: Proje Yönetimi > Kanban > "Sütunları düzenle".\n\n\`\`\`json\n${json}\n\`\`\`\n`;
};

export const columnsForProject = (cfg: KanbanConfig, project: string | null): KanbanColumn[] => {
  if (project) {
    const own = cfg.projeler[project.toLowerCase()];
    if (own) return own;
  }
  return cfg.varsayilan || DEFAULT_KANBAN_COLUMNS;
};
