import React, { useState } from 'react';
import { BookOpen, Plus, X, ChevronLeft, Feather, Pencil, ScrollText, RotateCcw, CalendarPlus } from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  updatedAt: number;
}

interface LibraryViewProps {
  notes: NoteItem[];
  scannedContents: Record<string, string>;
  onOpenNote?: (path: string) => void;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  // İSTEK: "Proje Yönetimi gibi ama tamamen kitaba uyarlanmış, ayrı bir Kütüphane"
  // — #proje/[project:] yerine #kitap/[book:] kullanır, Proje Yönetimi ile HİÇ karışmaz.
  libraryFolder?: string;
}

// Bir kitap/bölüm notunun içeriğinden [renk:hex] okur — ProjectsView.tsx'teki müşteri
// renk mekanizmasıyla AYNI desen (bkz. oradaki CLIENT_COLOR_REGEX yorumu): "#" parantez
// içinde SAKLANMAZ ki genel #etiket tarayıcısı bunu hashtag sanmasın.
const BOOK_COLOR_REGEX = /\[renk:#?([0-9a-fA-F]{3,8})\]/;
const DEFAULT_BOOK_COLOR = '#8b5cf6';
const BOOK_PALETTE = ['#8b5cf6', '#6366f1', '#22c55e', '#f97316', '#3b82f6', '#eab308', '#ef4444', '#ec4899', '#06b6d4', '#84cc16', '#a855f7', '#f43f5e'];

const lastMatch = (content: string, regexSource: string): RegExpMatchArray | null => {
  const matches = Array.from(content.matchAll(new RegExp(regexSource, 'g')));
  return matches.length > 0 ? matches[matches.length - 1] : null;
};

interface BookMeta {
  title: string;
  author: string;
  totalPages: number;
  currentPage: number;
  color: string;
}

const parseBookMeta = (noteName: string, content: string): BookMeta => {
  const authorM = content.match(/\[yazar:([^\]]+)\]/i);
  const totalM = content.match(/\[toplam_sayfa:(\d+)\]/i);
  const curM = lastMatch(content, '\\[son_sayfa:(\\d+)\\]');
  const colorM = lastMatch(content, BOOK_COLOR_REGEX.source);
  return {
    title: noteName.replace(/\.md$/i, ''),
    author: authorM ? authorM[1].trim() : '',
    totalPages: totalM ? parseInt(totalM[1], 10) : 0,
    currentPage: curM ? parseInt(curM[1], 10) : 0,
    color: colorM ? `#${colorM[1]}` : DEFAULT_BOOK_COLOR
  };
};

// Bir bölüm notunun tepesindeki alim-usulü 3 adımlık metod checklist'inin (Mütalaa/
// Haşiye/Telhis) ilerlemesi — genel checklist tarama deseniyle aynı (bkz. App.tsx
// scanTasksFromAllNotes), burada sadece bu notun İÇİNDEKİ satırlar sayılır.
const getChapterMethodProgress = (content: string) => {
  const matches = content.match(/^\s*[*\-]\s+\[([ xX])\]/gm) || [];
  const done = matches.filter(m => /\[[xX]\]/.test(m)).length;
  return { total: matches.length, done };
};

const hexToRgbString = (hex: string): string => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  return `${r}, ${g}, ${b}`;
};

// ============================================================================
// KİTAPLIK GÖRÜNÜMÜ yardımcıları — İSTEK (kullanıcı: "kütüphane çok kötü durdu okunmuyor...
// hepsinde kategoriler var, onlara göre ayrım yapılabilir" + gerçek kitaplığının fotoğrafı:
// bölmeler, dik/yatay istif/yaslanmış kitaplar). Kategori = #kitap dışındaki ilk #etiket.
// ============================================================================
const capitalizeTr = (s: string) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

// #kitap dışındaki ilk etiket kitabın kategorisidir; etiket yoksa 'Diğer'.
const parseCategory = (content: string): string => {
  for (const m of content.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const tag = m[1].toLocaleLowerCase('tr');
    if (tag !== 'kitap') return capitalizeTr(tag);
  }
  return 'Diğer';
};

const hslToHex = (h: number, s: number, l: number): string => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
};

const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
// Sabit tohumlu rastgelelik: her kitap her açılışta AYNI biçimde durur.
const seededRng = (seed: number) => {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const categoryColor = (cat: string): string => cat === 'Diğer' ? '#8a8578' : hslToHex(hashStr(cat) % 360, 48, 52);

// Kitabın rengi: kullanıcı elle renk seçtiyse o, yoksa (varsayılan mor dahil) kategori rengi.
const bookBaseColor = (meta: BookMeta, cat: string): string =>
  meta.color.toLowerCase() === DEFAULT_BOOK_COLOR ? categoryColor(cat) : meta.color;

// Rengin hafif sapmış tonu; bazen nötr (krem/koyu) cilt — gerçek bir kitaplık gibi.
const tintColor = (hex: string, r: () => number): { bg: string; fg: string } => {
  const roll = r();
  if (roll < 0.12) return { bg: '#e9e2d0', fg: '#3a352a' };
  if (roll < 0.2) return { bg: '#2b2b30', fg: '#fff' };
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const n = parseInt(full.slice(0, 6), 16) || 0;
  const k = 0.72 + r() * 0.5;
  const ch = (v: number) => Math.min(255, Math.round(v * k));
  return { bg: `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`, fg: '#fff' };
};

interface ShelfBook { title: string; author: string; pct: number; pages: number; color: string; }
type ShelfItem =
  | { type: 'up' | 'lean'; b: ShelfBook; bg: string; fg: string; w: number; h: number; deg: number; gap: number }
  | { type: 'stack'; grp: { b: ShelfBook; bg: string; fg: string; h: number; dx: number }[]; w: number };

const buildShelfItems = (books: ShelfBook[]): ShelfItem[] => {
  const items: ShelfItem[] = [];
  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const r = seededRng(hashStr(b.title));
    const kind = r();
    const { bg, fg } = tintColor(b.color, r);
    const h = Math.max(168, Math.min(246, 150 + (b.pages || 240) / 6 + r() * 18));
    if (kind < 0.2 && i + 1 < books.length) { // yatay istif: 2-3 kitap üst üste
      const n = Math.min(books.length - i, 2 + (r() < 0.45 ? 1 : 0));
      const grp = [];
      for (let k = 0; k < n; k++) {
        const bk = books[i + k];
        const rr = seededRng(hashStr(bk.title + 'f'));
        const t = tintColor(bk.color, rr);
        grp.push({ b: bk, bg: t.bg, fg: t.fg, h: 24 + Math.round(rr() * 10), dx: Math.round((rr() - 0.5) * 12) });
      }
      items.push({ type: 'stack', grp, w: 166 });
      i += n - 1;
    } else if (kind < 0.38) { // yaslanmış kitap
      const deg = 9 + Math.round(r() * 7);
      items.push({ type: 'lean', b, bg, fg, w: 26 + Math.round(r() * 12), h, deg, gap: Math.round(h * Math.sin(deg * Math.PI / 180) * 0.55) });
    } else {
      items.push({ type: 'up', b, bg, fg, w: 24 + Math.round(r() * 20), h, deg: 0, gap: 0 });
    }
  }
  return items;
};

const packShelfRows = (items: ShelfItem[], cellW: number): ShelfItem[][] => {
  const rows: ShelfItem[][] = [[]];
  let used = 0;
  items.forEach(it => {
    const w = (it.type === 'lean' ? it.w + it.gap : it.w) + 4;
    if (used + w > cellW && rows[rows.length - 1].length) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(it);
    used += w;
  });
  return rows;
};

type LibraryViewMode = 'shelf' | 'cards' | 'list';
const LIBRARY_VIEW_KEY = 'library_view_mode';

export default function LibraryView({ notes, scannedContents, onOpenNote, onSaveNote, libraryFolder = 'Kütüphane' }: LibraryViewProps) {
  const [viewMode, setViewMode] = useState<LibraryViewMode>(() => {
    try {
      const v = localStorage.getItem(LIBRARY_VIEW_KEY);
      return v === 'cards' || v === 'list' || v === 'shelf' ? v : 'shelf';
    } catch { return 'shelf'; }
  });
  const [libSearch, setLibSearch] = useState('');
  const [libSort, setLibSort] = useState<'name' | 'progress' | 'author'>('name');
  const [libCat, setLibCat] = useState('Tümü');
  const [shelfWidth, setShelfWidth] = useState(900);
  const shelfRef = React.useRef<HTMLDivElement | null>(null);
  const [selectedBookName, setSelectedBookName] = useState<string | null>(null);
  const [selectedChapterPath, setSelectedChapterPath] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState<{ type: 'book' } | { type: 'chapter'; bookTitle: string } | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formTotalPages, setFormTotalPages] = useState('');
  const [formColor, setFormColor] = useState(BOOK_PALETTE[0]);

  // Kitaplık bölmelerinin genişliği (kaç bölme yan yana, bir rafa kaç kitap sığar) ekrana göre
  // hesaplanır; pencere boyu değişince yeniden ölçülür.
  React.useEffect(() => {
    const el = shelfRef.current;
    if (!el) return;
    const measure = () => setShelfWidth(el.clientWidth || 900);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, selectedBookName]);

  // #kitap etiketli, DOĞRUDAN {libraryFolder}/ altında (alt klasörde değil) duran notlar —
  // bunlar kitabın KENDİ notu; {libraryFolder}/{KitapAdı}/... altındakiler bölümleridir.
  const bookNotes = notes.filter(n => {
    if (!n.path.startsWith(`${libraryFolder}/`)) return false;
    const rest = n.path.slice(libraryFolder.length + 1);
    if (rest.includes('/')) return false;
    const c = scannedContents[n.path] || '';
    return /#kitap\b/i.test(c);
  });

  const getBookChapters = (bookTitle: string) => {
    const prefix = `${libraryFolder}/${bookTitle}/`;
    return notes
      .filter(n => n.path.startsWith(prefix) && !n.path.slice(prefix.length).includes('/') && n.name.toLowerCase() !== 'fihrist.md')
      .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }));
  };

  const getFihristNote = (bookTitle: string) => notes.find(n => n.path === `${libraryFolder}/${bookTitle}/Fihrist.md`);

  const slugify = (s: string) => s.trim().toLocaleLowerCase('tr').replace(/\s+/g, '-').replace(/[^a-z0-9\-ğüşıöç]/gi, '');

  const handleCreateBook = async () => {
    if (!onSaveNote || !formTitle.trim()) return;
    const title = formTitle.trim();
    const path = `${libraryFolder}/${title}.md`;
    if (notes.some(n => n.path.toLowerCase() === path.toLowerCase())) {
      alert(`"${title}" adında bir kitap zaten var.`);
      return;
    }
    const content = `# ${title}\n\n#kitap\n[yazar:${formAuthor.trim()}]\n[toplam_sayfa:${parseInt(formTotalPages, 10) || 0}]\n[son_sayfa:0]\n[renk:${formColor.replace('#', '')}]\n\n## Neden Okuyorum\n\n\n## Fihrist\nKonu bazlı indeks için bu kitabın altına "Fihrist" adıyla bir bölüm ekleyebilirsin.\n`;
    await onSaveNote(path, content);
    setCreateModal(null);
    setFormTitle(''); setFormAuthor(''); setFormTotalPages(''); setFormColor(BOOK_PALETTE[0]);
    setSelectedBookName(title);
  };

  const handleCreateChapter = async (bookTitle: string) => {
    if (!onSaveNote || !formTitle.trim()) return;
    const chapterTitle = formTitle.trim();
    const path = `${libraryFolder}/${bookTitle}/${chapterTitle}.md`;
    if (notes.some(n => n.path.toLowerCase() === path.toLowerCase())) {
      alert(`"${chapterTitle}" adında bir bölüm zaten var.`);
      return;
    }
    const slug = slugify(bookTitle);
    // Alim usulü çalışma metodu — her bölüm bu 3 adımı barındırır: Mütalaa (dikkatli
    // okuma), Haşiye (kenar notu/itiraz), Telhis (kısa özet). İlk madde [book:slug]
    // etiketi taşır — Calendar'daki session/plan (çok-günlü devam) mekanizması, tıpkı
    // proje görevlerinde olduğu gibi bunu otomatik tanır (bkz. CalendarView.tsx
    // projectBracketRegex'in book/kitap'ı da kapsayacak şekilde genişletilmesi).
    const content = `# ${chapterTitle}\n\n- [ ] Mütalaa (dikkatli okuma) yapıldı [book:${slug}]\n- [ ] Haşiye (kenar notları/itirazlarım) düşüldü\n- [ ] Telhis (kısa özet) yazıldı\n\n## Mütalaa — Özet\n\n\n## Haşiye — Notlarım / Sorularım\n\n\n## Telhis — Kısa Özet\n\n`;
    await onSaveNote(path, content);
    setCreateModal(null);
    setFormTitle('');
    setSelectedChapterPath(path);
  };

  const handleCreateFihrist = async (bookTitle: string) => {
    if (!onSaveNote) return;
    const path = `${libraryFolder}/${bookTitle}/Fihrist.md`;
    if (notes.some(n => n.path.toLowerCase() === path.toLowerCase())) return;
    await onSaveNote(path, `# Fihrist — ${bookTitle}\n\nKonu bazlı indeks. Her satır bir konunun hangi bölümde geçtiğini gösterir.\n\n- Örnek Konu → [[1 - Giriş]]\n`);
  };

  const handleUpdateCurrentPage = async (bookNote: NoteItem, content: string, newPage: number) => {
    if (!onSaveNote) return;
    const stripped = content.replace(/\[son_sayfa:\d+\]/gi, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    await onSaveNote(bookNote.path, `${stripped}\n[son_sayfa:${Math.max(0, newPage)}]`);
  };

  const handleSetBookColor = async (bookNote: NoteItem, content: string, color: string) => {
    if (!onSaveNote) return;
    const stripped = content.replace(new RegExp(BOOK_COLOR_REGEX.source, 'gi'), '').replace(/\n{3,}/g, '\n\n').trimEnd();
    await onSaveNote(bookNote.path, `${stripped}\n[renk:${color.replace('#', '')}]`);
  };

  // İSTEK ("kütüphaneye de takvime ekle koy"): Calendar'daki sağ-tık "Kitap Oku" akışının
  // Kütüphane tarafındaki karşılığı — bir bölümün "Mütalaa" (okuma) görevini doğrudan
  // BUGÜNE, şu anki saatten sonraki ilk 15dk'lık çizgiye yuvarlayarak 1 saatlik planlar. Var
  // olan [due:]/[plannedtime:] varsa (zaten planlıysa) üzerine yazılır — yeniden planlamak
  // için de kullanılabilir.
  const handleScheduleChapterToday = async (chapter: NoteItem, content: string) => {
    if (!onSaveNote) return;
    const lines = content.split('\n');
    const lineIdx = lines.findIndex(l => /^\s*[*\-]\s+\[[ xX\/]\]\s*Mütalaa/i.test(l));
    if (lineIdx === -1) {
      alert('Bu bölümde bir "Mütalaa" görevi bulunamadı.');
      return;
    }
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    let startH = now.getHours();
    let startM = Math.ceil(now.getMinutes() / 15) * 15;
    if (startM === 60) { startM = 0; startH = (startH + 1) % 24; }
    const endH = (startH + 1) % 24;
    const timeSlot = `${pad(startH)}:${pad(startM)}-${pad(endH)}:${pad(startM)}`;

    const newLine = lines[lineIdx]
      .replace(/\s*\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
      .replace(/\s*\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
      + ` [due:${todayStr}] [plannedtime:${timeSlot}]`;
    lines[lineIdx] = newLine;
    await onSaveNote(chapter.path, lines.join('\n'));
  };

  // ============ DETAY GÖRÜNÜMÜ ============
  if (selectedBookName) {
    const bookNote = bookNotes.find(n => n.name.replace(/\.md$/i, '') === selectedBookName);
    if (!bookNote) {
      setSelectedBookName(null);
      return null;
    }
    const content = scannedContents[bookNote.path] || '';
    const meta = parseBookMeta(bookNote.name, content);
    const percent = meta.totalPages > 0 ? Math.min(100, Math.round((meta.currentPage / meta.totalPages) * 100)) : 0;
    const chapters = getBookChapters(selectedBookName);
    const fihrist = getFihristNote(selectedBookName);
    const activeChapter = selectedChapterPath ? notes.find(n => n.path === selectedChapterPath) : null;
    const activeChapterContent = activeChapter ? (scannedContents[activeChapter.path] || '') : '';
    const rgb = hexToRgbString(meta.color);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={() => { setSelectedBookName(null); setSelectedChapterPath(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 10px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '12.5px' }}
          >
            <ChevronLeft size={14} /> Kitaplığa Dön
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Sol: Kapak + ilerleme + bölüm listesi */}
          <div style={{ width: '300px', borderRight: '1px solid var(--border-color)', overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
              borderRadius: '10px', padding: '24px 16px', minHeight: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
              background: `linear-gradient(150deg, ${meta.color} 0%, rgba(${rgb},0.55) 100%)`,
              boxShadow: `0 10px 30px rgba(${rgb},0.35)`, color: '#fff'
            }}>
              <div style={{ fontSize: '10px', opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>📖 Kitap</div>
              <div style={{ fontSize: '16px', fontWeight: 800, lineHeight: 1.25 }}>{meta.title}</div>
              {meta.author && <div style={{ fontSize: '12px', opacity: 0.9, marginTop: '4px' }}>{meta.author}</div>}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {BOOK_PALETTE.map(c => (
                <button key={c} type="button" onClick={() => handleSetBookColor(bookNote, content, c)}
                  style={{ width: '18px', height: '18px', borderRadius: '50%', background: c, border: meta.color.toLowerCase() === c.toLowerCase() ? '2px solid var(--text-primary)' : '2px solid transparent', cursor: 'pointer' }} />
              ))}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                <span>İlerleme</span>
                <span>{meta.currentPage}/{meta.totalPages || '?'} sayfa · %{percent}</span>
              </div>
              <div style={{ height: '7px', background: 'var(--bg-hover)', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
                <div style={{ height: '100%', width: `${percent}%`, background: percent >= 100 ? '#4caf50' : meta.color, transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={() => handleUpdateCurrentPage(bookNote, content, meta.currentPage - 10)}
                  style={{ flex: 1, fontSize: '11px', padding: '5px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>-10</button>
                <input
                  type="number"
                  value={meta.currentPage}
                  onChange={(e) => handleUpdateCurrentPage(bookNote, content, parseInt(e.target.value, 10) || 0)}
                  style={{ width: '60px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                />
                <button type="button" onClick={() => handleUpdateCurrentPage(bookNote, content, meta.currentPage + 10)}
                  style={{ flex: 1, fontSize: '11px', padding: '5px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>+10</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Bölümler ({chapters.length})</h4>
              {onSaveNote && (
                <button type="button" onClick={() => { setFormTitle(''); setCreateModal({ type: 'chapter', bookTitle: selectedBookName }); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: meta.color, cursor: 'pointer', fontSize: '11px', fontWeight: 700, padding: '3px 8px' }}>
                  <Plus size={11} /> Bölüm
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {fihrist && (
                <div
                  onClick={() => onOpenNote?.(fihrist.path)}
                  style={{ fontSize: '12.5px', padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}
                >
                  <ScrollText size={13} /> Fihrist (konu indeksi)
                </div>
              )}
              {!fihrist && onSaveNote && (
                <div onClick={() => handleCreateFihrist(selectedBookName)}
                  style={{ fontSize: '11.5px', padding: '6px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)', cursor: 'pointer', color: 'var(--text-muted)', textAlign: 'center' }}>
                  + Fihrist oluştur
                </div>
              )}
              {chapters.map(ch => {
                const chContent = scannedContents[ch.path] || '';
                const prog = getChapterMethodProgress(chContent);
                const isActive = ch.path === selectedChapterPath;
                return (
                  <div
                    key={ch.path}
                    onClick={() => setSelectedChapterPath(ch.path)}
                    style={{
                      fontSize: '12.5px', padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
                      background: isActive ? `rgba(${rgb},0.18)` : 'transparent',
                      border: isActive ? `1px solid ${meta.color}` : '1px solid transparent',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{ch.name.replace(/\.md$/i, '')}</span>
                      {onSaveNote && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleScheduleChapterToday(ch, chContent); }}
                          title="Bugün için takvime ekle"
                          style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                        >
                          <CalendarPlus size={13} />
                        </button>
                      )}
                      {prog.total > 0 && (
                        <span style={{ fontSize: '10px', color: prog.done === prog.total ? '#4caf50' : 'var(--text-muted)', flexShrink: 0 }}>
                          {prog.done}/{prog.total}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {chapters.length === 0 && (
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
                  Henüz bölüm eklenmedi.
                </div>
              )}
            </div>
          </div>

          {/* Sağ: bölüm önizleme + sayfa çevirme animasyonu */}
          <div style={{ flex: 1, overflow: 'hidden', padding: '24px', perspective: '1800px' }}>
            {activeChapter ? (
              <div
                key={activeChapter.path}
                className="library-page-flip"
                style={{
                  height: '100%', overflowY: 'auto', background: 'var(--bg-secondary)', borderRadius: '12px',
                  border: '1px solid var(--border-color)', padding: '24px', transformOrigin: 'left center'
                }}
                onDoubleClick={() => onOpenNote?.(activeChapter.path)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <h2 style={{ margin: 0, fontSize: '18px' }}>{activeChapter.name.replace(/\.md$/i, '')}</h2>
                  <button
                    type="button"
                    onClick={() => onOpenNote?.(activeChapter.path)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    <Pencil size={11} /> Notu Aç
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '14px', marginBottom: '16px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Feather size={12} /> Mütalaa</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Pencil size={12} /> Haşiye</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><ScrollText size={12} /> Telhis</span>
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '13px', lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}>
                  {activeChapterContent.replace(/^#[^\n]*\n/, '').trim() || 'Bu bölüm henüz boş — çift tıklayıp not olarak açabilirsin.'}
                </pre>
              </div>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', flexDirection: 'column', gap: '10px' }}>
                <BookOpen size={32} style={{ opacity: 0.4 }} />
                Soldan bir bölüm seç, ya da yeni bir bölüm ekle.
              </div>
            )}
          </div>
        </div>

        {createModal && createModal.type === 'chapter' && (
          <CreateModal
            title={`"${createModal.bookTitle}" için Yeni Bölüm`}
            placeholder="Bölüm adı (örn: 1 - Giriş)"
            value={formTitle}
            onChange={setFormTitle}
            onCancel={() => setCreateModal(null)}
            onSubmit={() => handleCreateChapter(createModal.bookTitle)}
          />
        )}
      </div>
    );
  }

  // ============ KİTAPLIK GÖRÜNÜMÜ (kitaplık / kapak kartı / liste) ============
  const libBooks = bookNotes.map(n => {
    const content = scannedContents[n.path] || '';
    const meta = parseBookMeta(n.name, content);
    const cat = parseCategory(content);
    const pct = meta.totalPages > 0 ? Math.min(100, Math.round((meta.currentPage / meta.totalPages) * 100)) : 0;
    return { path: n.path, meta, cat, pct, color: bookBaseColor(meta, cat) };
  });
  const catCounts: Record<string, number> = {};
  libBooks.forEach(b => { catCounts[b.cat] = (catCounts[b.cat] || 0) + 1; });
  const catList = Object.keys(catCounts).sort((a, b) => a === 'Diğer' ? 1 : b === 'Diğer' ? -1 : a.localeCompare(b, 'tr'));
  const q = libSearch.toLocaleLowerCase('tr');
  const shownBooks = libBooks
    .filter(b => (libCat === 'Tümü' || b.cat === libCat) && `${b.meta.title} ${b.meta.author}`.toLocaleLowerCase('tr').includes(q))
    .sort((a, b) =>
      libSort === 'progress' ? (b.pct - a.pct) || a.meta.title.localeCompare(b.meta.title, 'tr')
      : libSort === 'author' ? (a.meta.author || '~').localeCompare(b.meta.author || '~', 'tr') || a.meta.title.localeCompare(b.meta.title, 'tr')
      : a.meta.title.localeCompare(b.meta.title, 'tr'));
  const shelfCols = Math.max(1, Math.min(3, Math.floor(shelfWidth / 400)));
  const shelfCellW = (shelfWidth - 18 - (shelfCols - 1) * 9) / shelfCols - 16;
  const changeViewMode = (m: LibraryViewMode) => {
    setViewMode(m);
    try { localStorage.setItem(LIBRARY_VIEW_KEY, m); } catch { /* yoksay */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px' }}>
            <BookOpen size={24} color="var(--accent-color)" />
            Kütüphane
          </h2>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            #kitap etiketi içeren notlar otomatik olarak burada listelenir — alim usulü çalışma metoduna (Mütalaa → Haşiye → Telhis) göre yapılandırılmıştır.
          </p>
        </div>
        {onSaveNote && (
          <button
            type="button"
            onClick={() => { setFormTitle(''); setFormAuthor(''); setFormTotalPages(''); setFormColor(BOOK_PALETTE[Math.floor(Math.random() * BOOK_PALETTE.length)]); setCreateModal({ type: 'book' }); }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
          >
            <Plus size={15} /> Yeni Kitap
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {bookNotes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '60px 0' }}>
            Henüz kitap eklenmedi. "Yeni Kitap" ile başla.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Arama + sıralama + görünüm anahtarı */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
              <input
                type="search" value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Kitap veya yazar ara…"
                style={{ flex: 1, minWidth: '160px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text-primary, #fff)', fontSize: '13px', outline: 'none' }}
              />
              <select
                value={libSort} onChange={e => setLibSort(e.target.value as 'name' | 'progress' | 'author')}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '9px 10px', color: 'var(--text-primary, #fff)', fontSize: '12.5px' }}
              >
                <option value="name">Ada göre</option>
                <option value="progress">İlerlemeye göre</option>
                <option value="author">Yazara göre</option>
              </select>
              <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                {([['shelf', 'Kitaplık'], ['cards', 'Kapak kartları'], ['list', 'Liste']] as [LibraryViewMode, string][]).map(([m, label]) => (
                  <button
                    key={m} type="button" onClick={() => changeViewMode(m)}
                    style={{ border: 'none', padding: '9px 13px', fontSize: '12.5px', cursor: 'pointer', background: viewMode === m ? 'var(--accent-color)' : 'var(--bg-secondary)', color: viewMode === m ? '#fff' : 'var(--text-muted)', fontWeight: viewMode === m ? 700 : 500 }}
                  >{label}</button>
                ))}
              </div>
            </div>

            {/* Kategori çipleri */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {['Tümü', ...catList].map(c => {
                const active = libCat === c;
                const count = c === 'Tümü' ? libBooks.length : catCounts[c];
                return (
                  <button
                    key={c} type="button" onClick={() => setLibCat(c)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '999px', padding: '5px 11px', fontSize: '12px', cursor: 'pointer', background: active ? 'rgba(255,255,255,0.08)' : 'transparent', border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`, color: active ? 'var(--text-primary, #fff)' : 'var(--text-muted)' }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c === 'Tümü' ? '#8f8b84' : categoryColor(c) }} />
                    {c} <span style={{ opacity: 0.7 }}>{count}</span>
                  </button>
                );
              })}
            </div>

            {shownBooks.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0', fontSize: '13px' }}>Eşleşen kitap yok.</div>
            ) : viewMode === 'shelf' ? (
              // ---- KİTAPLIK: siyah çerçeve, kategori başına bir bölme ----
              <div ref={shelfRef} style={{ width: '100%' }}>
                <div style={{ display: 'grid', gap: '9px', background: '#0a0a0b', padding: '9px', borderRadius: '4px', boxShadow: '0 0 0 1px #000, 0 10px 30px rgba(0,0,0,0.5)', gridTemplateColumns: `repeat(${shelfCols}, minmax(0, 1fr))` }}>
                  {catList.filter(c => shownBooks.some(b => b.cat === c)).map(c => {
                    const books: ShelfBook[] = shownBooks.filter(b => b.cat === c).map(b => ({ title: b.meta.title, author: b.meta.author, pct: b.pct, pages: b.meta.totalPages, color: b.color }));
                    const rows = packShelfRows(buildShelfItems(books), shelfCellW);
                    const tip = (b: ShelfBook) => `${b.title}${b.author ? ' — ' + b.author : ''}${b.pct ? ` · %${b.pct}` : ''}`;
                    return (
                      <div key={c} style={{ background: '#17171a', backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.35), transparent 40%)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <div style={{ alignSelf: 'flex-start', margin: '8px 0 0 10px', fontSize: '10.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#cbbd9d', background: '#26231c', border: '1px solid #4a4332', borderRadius: '2px', padding: '2px 8px' }}>
                          {c}<span style={{ opacity: 0.6, marginLeft: '6px' }}>{books.length}</span>
                        </div>
                        {rows.map((row, ri) => (
                          <div key={ri} style={{ display: 'flex', alignItems: 'flex-end', height: '262px', padding: '0 8px', borderBottom: '8px solid #2a2a30', boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset' }}>
                            {row.map((it, ii) => {
                              if (it.type === 'stack') {
                                return (
                                  <div key={ii} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', margin: '0 6px 0 4px', width: '158px', flexShrink: 0 }}>
                                    {it.grp.slice().reverse().map(g => (
                                      <div
                                        key={g.b.title} className="library-book-spine" onClick={() => setSelectedBookName(g.b.title)} title={tip(g.b)}
                                        style={{ height: `${g.h}px`, marginLeft: `${g.dx}px`, background: `linear-gradient(180deg, ${g.bg}, rgba(0,0,0,0.25)), ${g.bg}`, color: g.fg, borderRadius: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 10px', fontWeight: 700, fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px rgba(0,0,0,0.5)', boxShadow: 'inset 0 -2px 3px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.15), 0 1px 2px rgba(0,0,0,0.5)' }}
                                      >{g.b.title}</div>
                                    ))}
                                  </div>
                                );
                              }
                              const lean = it.type === 'lean';
                              return (
                                <div
                                  key={ii} className="library-book-spine" onClick={() => setSelectedBookName(it.b.title)} title={tip(it.b)}
                                  style={{
                                    position: 'relative', flexShrink: 0, width: `${it.w}px`, height: `${it.h}px`, marginRight: lean ? `${it.gap}px` : '2px',
                                    background: `linear-gradient(90deg, ${it.bg}, ${it.bg} 60%, rgba(0,0,0,0.18))`, color: it.fg, borderRadius: '2px 2px 0 0', cursor: 'pointer',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0',
                                    boxShadow: 'inset -2px 0 3px rgba(0,0,0,0.35), inset 1px 0 1px rgba(255,255,255,0.12), 1px 0 2px rgba(0,0,0,0.5)',
                                    ...(lean ? { transformOrigin: '100% 100%', transform: `rotate(${it.deg}deg)` } : {})
                                  }}
                                >
                                  <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.3)' }} />
                                  <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 700, fontSize: '12px', lineHeight: 1.1, overflow: 'hidden', flex: 1, margin: '8px 0', textShadow: '0 1px 2px rgba(0,0,0,0.5)', maxHeight: '100%' }}>{it.b.title}</div>
                                  <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.3)' }} />
                                  {it.b.pct > 0 && (
                                    <div style={{ position: 'absolute', left: '3px', right: '3px', bottom: '3px', height: '3px', background: 'rgba(255,255,255,0.25)', borderRadius: '2px', overflow: 'hidden' }}>
                                      <div style={{ height: '100%', width: `${it.b.pct}%`, background: '#fff' }} />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : viewMode === 'cards' ? (
              // ---- KAPAK KARTLARI ----
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px' }}>
                {shownBooks.map(b => (
                  <div
                    key={b.path} onClick={() => setSelectedBookName(b.meta.title)}
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                  >
                    <div style={{ aspectRatio: '3 / 4', maxWidth: '100%', padding: '14px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff', background: `linear-gradient(160deg, ${b.color}, ${b.color}77)` }}>
                      <div style={{ fontWeight: 700, fontSize: '15px', lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{b.meta.title}</div>
                      <div style={{ fontSize: '11px', opacity: 0.85 }}>{b.meta.author || '—'}</div>
                    </div>
                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{b.cat}</div>
                      <div style={{ height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${b.pct}%`, background: 'var(--accent-color)' }} />
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{b.meta.totalPages > 0 ? `${b.meta.currentPage}/${b.meta.totalPages} sayfa · ` : ''}%{b.pct}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // ---- LİSTE ----
              <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden' }}>
                {shownBooks.map(b => (
                  <div
                    key={b.path} onClick={() => setSelectedBookName(b.meta.title)}
                    style={{ display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr) auto 52px', gap: '12px', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                  >
                    <div style={{ width: '10px', height: '28px', borderRadius: '3px', background: b.color }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13.5px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.meta.title}</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{b.meta.author || '—'}</div>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '999px', padding: '2px 9px' }}>{b.cat}</span>
                    <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--text-muted)' }}>%{b.pct}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {createModal && createModal.type === 'book' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCreateModal(null)}>
          <div style={{ width: '360px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: '#fff' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '15px', fontWeight: 700 }}>Yeni Kitap</h3>
            <form onSubmit={(e) => { e.preventDefault(); handleCreateBook(); }} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="text" autoFocus value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Kitap adı..." style={modalInputStyle} />
              <input type="text" value={formAuthor} onChange={(e) => setFormAuthor(e.target.value)} placeholder="Yazar (opsiyonel)" style={modalInputStyle} />
              <input type="number" value={formTotalPages} onChange={(e) => setFormTotalPages(e.target.value)} placeholder="Toplam sayfa (opsiyonel)" style={modalInputStyle} />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {BOOK_PALETTE.map(c => (
                  <button key={c} type="button" onClick={() => setFormColor(c)}
                    style={{ width: '22px', height: '22px', borderRadius: '50%', background: c, border: formColor === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button type="button" onClick={() => setCreateModal(null)} style={{ flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-secondary)', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>İptal</button>
                <button type="submit" disabled={!formTitle.trim()} style={{ flex: 1, background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: '#fff', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: formTitle.trim() ? 'pointer' : 'not-allowed', opacity: formTitle.trim() ? 1 : 0.5 }}>Oluştur</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const modalInputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: '13px',
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
};

function CreateModal({ title, placeholder, value, onChange, onCancel, onSubmit }: {
  title: string; placeholder: string; value: string; onChange: (v: string) => void; onCancel: () => void; onSubmit: () => void;
}) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ width: '340px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: '15px', fontWeight: 700 }}>{title}</h3>
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(); }}>
          <input type="text" autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...modalInputStyle, marginBottom: '16px' }} />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-secondary)', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>İptal</button>
            <button type="submit" disabled={!value.trim()} style={{ flex: 1, background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: '#fff', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: value.trim() ? 'pointer' : 'not-allowed', opacity: value.trim() ? 1 : 0.5 }}>Oluştur</button>
          </div>
        </form>
      </div>
    </div>
  );
}
