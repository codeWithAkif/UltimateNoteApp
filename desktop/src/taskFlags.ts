// Görev etiketleri (öncelikten bağımsız): Söz verildi, Sonra, Derin odak, Hafif. Görev satırında "[flag:...]" olarak durur
// (aynı [p:], [due:] gibi). Başında "Sonra:" yazan görevler etiketsiz de "Sonra" sayılır (kullanıcının kendi yazım alışkanlığı).

export type TaskFlag = 'promise' | 'later' | 'deep' | 'light';

export const TASK_FLAGS: { key: TaskFlag; emoji: string; label: string; title: string }[] = [
  { key: 'promise', emoji: '🤝', label: 'Söz verildi', title: 'Birine verdiğiniz taahhüt; geciktirmek güven kaybettirir (puanı artar)' },
  { key: 'later', emoji: '⏳', label: 'Sonra', title: 'Şimdi değil: günlük listelerde gizlenir; proje ve Kanban\'da görünür' },
  { key: 'deep', emoji: '🧠', label: 'Derin odak', title: 'Kesintisiz dikkat gerektiren iş' },
  { key: 'light', emoji: '🪫', label: 'Hafif', title: 'Düşük enerjiyle yapılabilen iş' }
];

const FLAG_RE = /\[flag:(promise|later|deep|light)\]/gi;
// "Sonra: ..." ya da "Sonra - ..." (yalnızca ayraçla yazılmışsa; "Sonra bakarız ..." gibi cümleler etiket sayılmaz).
const LATER_PREFIX = /^\s*sonra\s*[:\-–—]\s*/i;

// text: onay kutusundan SONRAKİ görev metni (ya da tüm satır; baştaki onay kutusu otomatik atlanır).
export const parseFlags = (text: string): TaskFlag[] => {
  const body = text.replace(/^\s*[*\-]\s+\[[ xX/]\]\s*/, '');
  const out = new Set<TaskFlag>();
  for (const m of body.matchAll(FLAG_RE)) out.add(m[1].toLowerCase() as TaskFlag);
  if (LATER_PREFIX.test(body)) out.add('later');
  return Array.from(out);
};

// Not editöründe [flag:...] ve [status:...] ham metin yerine ikonlu rozet (chip) olarak çizilir (bkz. NotesView.parseInlineStylesAndTags).
export const FLAG_COLORS: Record<TaskFlag, string> = { promise: '#f59e0b', later: '#94a3b8', deep: '#818cf8', light: '#2dd4bf' };

export interface ChipInfo { emoji: string; label: string; color: string; title: string }

export const flagChip = (flag: TaskFlag): ChipInfo => {
  const f = TASK_FLAGS.find(x => x.key === flag)!;
  return { emoji: f.emoji, label: f.label, color: FLAG_COLORS[flag], title: f.title };
};

const STATUS_CHIPS: Record<string, { emoji: string; label: string; color: string }> = {
  inprogress: { emoji: '⚙️', label: 'Devam ediyor', color: '#22d3ee' },
  test: { emoji: '🧪', label: 'Test', color: '#a855f7' },
  review: { emoji: '👀', label: 'İncelemede', color: '#eab308' },
  blocked: { emoji: '⛔', label: 'Bloklu', color: '#ef4444' },
  park: { emoji: '⏸️', label: 'Park', color: '#94a3b8' }
};

// Kanban durumu etiketi ([status:review]); bilinmeyen/özel sütun anahtarları da okunur bir rozete dönüşür.
export const statusChip = (key: string): ChipInfo => {
  const k = key.toLowerCase();
  const known = STATUS_CHIPS[k];
  if (known) return { ...known, title: 'Kanban durumu' };
  const label = k.replace(/[-_]+/g, ' ');
  return { emoji: '🏷️', label: label.charAt(0).toUpperCase() + label.slice(1), color: '#94a3b8', title: 'Kanban durumu' };
};

// ---- Diğer satır içi etiketler: ham [etiket:değer] yerine okunur rozet (ya da iç kimlikse gizlenir) ----
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const fmtDay = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1] || ''}`.trim() : iso;
};
// "2026-07-02T09:00-18:00" -> "2 Tem 09:00-18:00"; saat yoksa yalnızca gün
const fmtSlot = (v: string): string => {
  const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}-\d{2}:\d{2}))?$/);
  return m ? `${fmtDay(m[1])}${m[2] ? ' ' + m[2] : ''}` : v;
};

const DURUM_CHIPS: Record<string, { emoji: string; label: string; color: string }> = {
  aktif: { emoji: '🟢', label: 'Aktif', color: '#22c55e' },
  beklemede: { emoji: '⏸️', label: 'Beklemede', color: '#eab308' },
  tamamlandi: { emoji: '✅', label: 'Tamamlandı', color: '#4caf50' },
  arsiv: { emoji: '📦', label: 'Arşiv', color: '#94a3b8' }
};

// Bu adlardaki etiketler rozete çevrilir; 'hidden' = kullanıcıya anlamsız iç kimlik, hiç gösterilmez.
export const INLINE_TAG_NAMES = ['type', 'session', 'plan', 'hours', 'gcal', 'gcalh', 'exid', 'srs', 'durum'] as const;

export const inlineTagChip = (name: string, rawValue: string): ChipInfo | 'hidden' | null => {
  const n = name.toLowerCase();
  const v = rawValue.trim();
  switch (n) {
    case 'type': {
      const t = v.toLowerCase();
      if (t === 'bug') return { emoji: '🐞', label: 'Hata', color: '#ef4444', title: 'Görev türü' };
      if (t === 'feature') return { emoji: '✨', label: 'Özellik', color: '#818cf8', title: 'Görev türü' };
      if (t === 'chore') return { emoji: '🧹', label: 'Bakım', color: '#94a3b8', title: 'Görev türü' };
      return null;
    }
    case 'session': return { emoji: '🗓️', label: `Oturum: ${fmtSlot(v)}`, color: '#38bdf8', title: 'Çalışma oturumu' };
    case 'plan': return { emoji: '📌', label: `Plan: ${fmtSlot(v)}`, color: '#38bdf8', title: 'Planlanan zaman' };
    case 'hours': return { emoji: '⏱️', label: `${v.replace('.', ',')} sa`, color: '#94a3b8', title: 'Harcanan/planlanan süre' };
    case 'gcal': return { emoji: '📅', label: 'Takvimde', color: '#60a5fa', title: 'Google Takvim ile eşitlendi' };
    case 'gcalh': case 'exid': return 'hidden';
    case 'srs': {
      const box = v.match(/box\s*(\d+)/i);
      const day = v.match(/\d{4}-\d{2}-\d{2}/);
      return { emoji: '🔁', label: `Ezber${box ? `: Kutu ${box[1]}` : ''}${day ? ` · ${fmtDay(day[0])}` : ''}`, color: '#a78bfa', title: 'Aralıklı tekrar (SRS)' };
    }
    case 'durum': {
      const d = DURUM_CHIPS[v.toLowerCase()];
      return d ? { ...d, title: 'Proje durumu' } : null;
    }
    default: return null;
  }
};

export const stripFlagTags = (text: string): string => text.replace(/\s*\[flag:(?:promise|later|deep|light)\]/gi, '');

// Puan katkısı: söz verilen iş daha öne çıkar.
export const flagScoreBonus = (flags: TaskFlag[]): number => (flags.includes('promise') ? 4 : 0);

// Bir satırda etiketi açar/kapatır. Derin odak ile Hafif birbirini dışlar. "Sonra:" yazısıyla otomatik sayılan bir görevde
// "Sonra" kapatılırsa baştaki "Sonra:" ifadesi kaldırılır (aksi hâlde yine Sonra sayılırdı).
export const toggleFlagInLine = (line: string, flag: TaskFlag): string => {
  const m = line.match(/^(\s*[*\-]\s+\[[ xX/]\]\s*)(.*)$/);
  if (!m) return line;
  let body = m[2];
  const drop = (b: string, f: TaskFlag) => b.replace(new RegExp(`\\s*\\[flag:${f}\\]`, 'gi'), '');
  if (parseFlags(body).includes(flag)) {
    body = drop(body, flag);
    if (flag === 'later') body = body.replace(LATER_PREFIX, '');
  } else {
    if (flag === 'deep') body = drop(body, 'light');
    if (flag === 'light') body = drop(body, 'deep');
    body = `${body.trimEnd()} [flag:${flag}]`;
  }
  return m[1] + body;
};
