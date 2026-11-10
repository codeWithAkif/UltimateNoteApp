// Hızlı slotlar: Alt+1 ... Alt+9 ile BELİRLİ bir hedefe gitme (şu proje şu görünümde, şu not, bugünün günlüğü, takvim).
// Mevcut Alt+harf kısayolları yalnızca sayfayı açar; slotlar sayfanın içindeki hedefi de seçer. Ayar cihaza özeldir (localStorage).

export type ProjectView = 'dashboard' | 'kanban' | 'clients';
export type CalendarViewMode = 'day' | 'threeDay' | 'week' | 'month';

export type SlotTarget =
  | { type: 'project'; project: string; view: ProjectView }
  | { type: 'note'; path: string }
  | { type: 'diary' }
  | { type: 'calendar'; view: CalendarViewMode };

export interface QuickSlot { target: SlotTarget | null }

export const SLOT_COUNT = 9;
const STORAGE_KEY = 'quick_slots_v1';

export const PROJECT_VIEW_LABELS: Record<ProjectView, string> = { dashboard: 'Genel Bakış', kanban: 'Kanban', clients: 'Müşteriler' };
export const CALENDAR_VIEW_LABELS: Record<CalendarViewMode, string> = { day: 'Günlük', threeDay: '3 Günlük', week: 'Haftalık', month: 'Aylık' };

// İlk kurulum: Alt+1 bugünün günlüğü, Alt+2 takvim (bugün, günlük görünüm); gerisi boş (Ayarlar > Kısayollar'dan atanır).
export const defaultSlots = (): QuickSlot[] =>
  Array.from({ length: SLOT_COUNT }, (_, i) => ({
    target: i === 0 ? { type: 'diary' } as SlotTarget : i === 1 ? { type: 'calendar', view: 'day' } as SlotTarget : null
  }));

const VIEWS: ProjectView[] = ['dashboard', 'kanban', 'clients'];
const CAL_VIEWS: CalendarViewMode[] = ['day', 'threeDay', 'week', 'month'];

// Bozuk/eksik kayıtlara karşı: her zaman SLOT_COUNT uzunlukta, geçerli hedeflerle.
export const normalizeSlots = (raw: any): QuickSlot[] => {
  const out = defaultSlots().map(() => ({ target: null as SlotTarget | null }));
  if (!Array.isArray(raw)) return defaultSlots();
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = raw[i]?.target;
    if (!t || typeof t !== 'object') continue;
    if (t.type === 'project' && typeof t.project === 'string' && t.project.trim()) {
      out[i].target = { type: 'project', project: t.project, view: VIEWS.includes(t.view) ? t.view : 'dashboard' };
    } else if (t.type === 'note' && typeof t.path === 'string' && t.path.trim()) {
      out[i].target = { type: 'note', path: t.path };
    } else if (t.type === 'diary') {
      out[i].target = { type: 'diary' };
    } else if (t.type === 'calendar') {
      out[i].target = { type: 'calendar', view: CAL_VIEWS.includes(t.view) ? t.view : 'day' };
    }
  }
  return out;
};

export const loadSlots = (): QuickSlot[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeSlots(JSON.parse(raw)) : defaultSlots();
  } catch { return defaultSlots(); }
};

export const saveSlots = (slots: QuickSlot[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(slots)); } catch { /* yoksay */ }
};

export const describeTarget = (t: SlotTarget | null): string => {
  if (!t) return 'Boş';
  switch (t.type) {
    case 'project': return `${t.project} · ${PROJECT_VIEW_LABELS[t.view]}`;
    case 'note': return t.path.replace(/\.md$/i, '').split('/').pop() || t.path;
    case 'diary': return 'Bugünün günlüğü';
    case 'calendar': return `Takvim · bugün · ${CALENDAR_VIEW_LABELS[t.view]}`;
  }
};

// Kasadaki proje adları (#proje etiketli notlar) — ProjectsView ile aynı kural ve aynı ad (".md" olmadan).
const PROJECT_TAG_REGEX = /(^|[\s,;(])#proje(?![0-9A-Za-zçğıöşüÇĞİÖŞÜ_-])/i;
export const projectNamesFrom = (notes: { name: string; path: string; type: string }[], contents: Record<string, string>): string[] =>
  notes
    .filter(n => n.type === 'note' && !n.path.split('/').some(seg => seg.startsWith('.')) && PROJECT_TAG_REGEX.test(contents[n.path] || ''))
    .map(n => n.name.replace('.md', ''))
    .sort((a, b) => a.localeCompare(b, 'tr'));

// Yönlendirme istekleri: ProjectsView/CalendarView bunu uygular, sonra App temizler (sayfaya sonradan dönüşte tekrar uygulanmasın).
export interface ProjectNavRequest { project: string; view: ProjectView; nonce: number }
export interface CalendarNavRequest { view: CalendarViewMode; nonce: number }

// Alt+rakam: "Digit1" ve "Numpad1" fiziksel tuşları (klavye düzeninden bağımsız); 1-9 -> 0-8, değilse -1.
export const slotIndexFromEvent = (e: { code?: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1;
  const m = (e.code || '').match(/^(?:Digit|Numpad)([1-9])$/);
  return m ? parseInt(m[1], 10) - 1 : -1;
};
