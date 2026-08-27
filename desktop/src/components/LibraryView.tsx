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

export default function LibraryView({ notes, scannedContents, onOpenNote, onSaveNote, libraryFolder = 'Kütüphane' }: LibraryViewProps) {
  const [selectedBookName, setSelectedBookName] = useState<string | null>(null);
  const [selectedChapterPath, setSelectedChapterPath] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState<{ type: 'book' } | { type: 'chapter'; bookTitle: string } | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formTotalPages, setFormTotalPages] = useState('');
  const [formColor, setFormColor] = useState(BOOK_PALETTE[0]);

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

  // ============ KİTAPLIK (RAF) GÖRÜNÜMÜ ============
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        {bookNotes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '60px 0' }}>
            Henüz kitap eklenmedi. "Yeni Kitap" ile başla.
          </div>
        ) : (
          <div
            className="library-shelf"
            style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px',
              padding: '20px 20px 26px 20px', borderBottom: '6px solid rgba(140,110,80,0.35)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, rgba(140,110,80,0.08) 100%)',
              borderRadius: '8px'
            }}
          >
            {bookNotes.map(n => {
              const content = scannedContents[n.path] || '';
              const meta = parseBookMeta(n.name, content);
              const percent = meta.totalPages > 0 ? Math.min(100, Math.round((meta.currentPage / meta.totalPages) * 100)) : 0;
              // Sırt yüksekliği sayfa sayısına göre hafifçe değişir — gerçek bir raf hissi.
              const spineHeight = Math.max(160, Math.min(230, 150 + (meta.totalPages || 200) / 8));
              return (
                <div
                  key={n.path}
                  className="library-book-spine"
                  onClick={() => setSelectedBookName(meta.title)}
                  title={`${meta.title}${meta.author ? ' — ' + meta.author : ''}`}
                  style={{
                    width: '46px',
                    height: `${spineHeight}px`,
                    background: `linear-gradient(100deg, ${meta.color} 0%, rgba(${hexToRgbString(meta.color)},0.72) 100%)`,
                    borderRadius: '3px 6px 6px 3px',
                    boxShadow: `2px 4px 10px rgba(0,0,0,0.35), inset -2px 0 4px rgba(0,0,0,0.25)`,
                    cursor: 'pointer',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    paddingTop: '14px',
                    flexShrink: 0
                  }}
                >
                  <span style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    color: '#fff',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxHeight: `${spineHeight - 30}px`,
                    textShadow: '0 1px 3px rgba(0,0,0,0.4)'
                  }}>
                    {meta.title}
                  </span>
                  {percent > 0 && (
                    <div style={{ position: 'absolute', bottom: '6px', left: '4px', right: '4px', height: '3px', background: 'rgba(255,255,255,0.25)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percent}%`, background: '#fff' }} />
                    </div>
                  )}
                </div>
              );
            })}
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
