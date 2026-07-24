import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Folder, FileText, CheckSquare, Hash, Zap, Send, Calendar, Clock, X, Sparkles } from 'lucide-react';
import { extractDateFromText, isGeminiConfigured } from '../services/geminiMentor';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
}

interface NoteFactoryViewProps {
  onProcessInput: (parsedData: ParsedInput) => void;
  folders: string[];
  notes: NoteItem[];
  tags: string[];
}

export interface ParsedInput {
  raw: string;
  cleanText: string;
  isTodo: boolean;
  folder: string | null;
  note: string | null;
  tags: string[];
}

// Helper to calculate caret coordinates inside a textarea
function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number
): { top: number; left: number } {
  const div = document.createElement('div');
  const style = window.getComputedStyle(element);
  
  const properties = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderWidth', 'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'lineHeight',
    'letterSpacing', 'wordSpacing', 'textTransform', 'whiteSpace', 'wordBreak', 'wordWrap'
  ];
  
  properties.forEach(prop => {
    (div.style as any)[prop] = (style as any)[prop];
  });
  
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.width = `${element.clientWidth}px`;
  
  const textBeforeCaret = element.value.substring(0, position);
  div.textContent = textBeforeCaret;
  
  const span = document.createElement('span');
  span.textContent = element.value.substring(position, position + 1) || '.';
  div.appendChild(span);
  
  document.body.appendChild(div);
  
  const lineHeightVal = parseInt(style.lineHeight || '');
  const finalLineHeight = isNaN(lineHeightVal) ? parseInt(style.fontSize || '14') * 1.25 : lineHeightVal;
  
  const coordinates = {
    top: span.offsetTop + finalLineHeight - element.scrollTop + element.offsetTop,
    left: span.offsetLeft - element.scrollLeft + element.offsetLeft
  };
  
  document.body.removeChild(div);
  return coordinates;
}

export default function NoteFactoryView({ 
  onProcessInput, 
  folders,
  notes,
  tags
}: NoteFactoryViewProps) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // BUG DÜZELTMESİ: @ klasör listesi ".templates"/".versions"/".trash" gibi uygulamanın
  // kendi sistem klasörlerini de gösteriyordu — kullanıcı bunları asla göremez (Sidebar'da
  // da gizli), Hızlı Not Fabrikası'nda da görünmemeli. Yol içindeki HERHANGİ bir segment
  // "." ile başlıyorsa (ör. "Proje/.templates") o klasör tamamen filtrelenir.
  const visibleFolders = useMemo(
    () => folders.filter(f => !f.split('/').some(seg => seg.startsWith('.'))),
    [folders]
  );

  const [shortcuts, setShortcuts] = useState<Array<{ id: string; label: string; syntax: string }>>(() => {
    const cached = localStorage.getItem('note_factory_shortcuts');
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
    return [
      { id: '1', label: '🛒 Alışveriş Listesi', syntax: '@Kişisel !Alışveriş #todo' },
      { id: '2', label: '💡 Fikir Kutusu', syntax: '@Fikirler !Kutusu #todo' },
      { id: '3', label: '✍️ Günlük', syntax: '@Günlük !Defter #günlük' }
    ];
  });
  const [activeShortcutId, setActiveShortcutId] = useState<string | null>(null);
  const [showAddShortcutModal, setShowAddShortcutModal] = useState(false);
  const [newShortcutLabel, setNewShortcutLabel] = useState('');
  const [newShortcutSyntax, setNewShortcutSyntax] = useState('');

  const [inputVal, setInputVal] = useState('');
  const [parsed, setParsed] = useState<ParsedInput>({
    raw: '',
    cleanText: '',
    isTodo: false,
    folder: null,
    note: null,
    tags: []
  });
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlighterRef = useRef<HTMLDivElement>(null);
  const quickInsertToolbarRef = useRef<HTMLDivElement>(null);
  const mobilePopoverRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (highlighterRef.current) {
      highlighterRef.current.scrollTop = e.currentTarget.scrollTop;
      highlighterRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const renderHighlightedText = (text: string) => {
    if (!text) return null;
    
    // BUG DÜZELTMESİ: bkz. parseShortcutSyntax — emoji içeren klasör/not adları eski
    // Latin+Türkçe izin listesiyle vurgulanamıyordu, negatif karakter sınıfına geçildi.
    const regex = /(@(?:\[[^\]\r\n]+\]|[^\s\[\]@!#]+)|!(?:\[[^\]\r\n]+\]|[^\s\[\]@!#]+)|#(?:[a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)|\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]|\[due:\d{4}-\d{2}-\d{2}\]|\[time:\d{2}:\d{2}-\d{2}:\d{2}\])/g;
    const textToRender = text.endsWith('\n') ? text + ' ' : text;
    const parts = textToRender.split(regex);
    
    return parts.map((part, idx) => {
      if (part.startsWith('@')) {
        return (
          <span key={idx} className="rich-badge folder-rich-badge">
            {part}
          </span>
        );
      } else if (part.startsWith('!')) {
        return (
          <span key={idx} className="rich-badge note-rich-badge">
            {part}
          </span>
        );
      } else if (part.startsWith('#')) {
        return (
          <span key={idx} className="rich-badge tag-rich-badge">
            {part}
          </span>
        );
      } else if (part.startsWith('[p:')) {
        const pValue = part.slice(3, -1);
        const pColor = pValue === 'critical' ? '#f87171' : pValue === 'high' ? '#fb923c' : pValue === 'medium' ? '#fbbf24' : '#a1a1aa';
        const pBg = pValue === 'critical' ? 'rgba(239, 68, 68, 0.15)' : pValue === 'high' ? 'rgba(249, 115, 22, 0.15)' : pValue === 'medium' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(161, 161, 170, 0.15)';
        const pBorder = pValue === 'critical' ? 'rgba(239, 68, 68, 0.3)' : pValue === 'high' ? 'rgba(249, 115, 22, 0.3)' : pValue === 'medium' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(161, 161, 170, 0.3)';
        return (
          <span key={idx} className="rich-badge priority-rich-badge" style={{ background: pBg, color: pColor, border: `1px solid ${pBorder}` }}>
            {part}
          </span>
        );
      } else if (part.startsWith('[due:')) {
        return (
          <span key={idx} className="rich-badge due-rich-badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
            {part}
          </span>
        );
      } else if (part.startsWith('[time:')) {
        return (
          <span key={idx} className="rich-badge time-rich-badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const [caretPos, setCaretPos] = useState({ top: 0, left: 0 });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionTrigger, setSuggestionTrigger] = useState<'@' | '!' | '#' | null>(null);
  const [suggestionSearch, setSuggestionSearch] = useState('');
  const [triggerIndex, setTriggerIndex] = useState<number>(-1);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const [activePopover, setActivePopover] = useState<'@' | '!' | '#' | 'priority' | 'due' | 'time' | null>(null);

  // BUG DÜZELTMESİ: "dışına tıklayınca kapat" için tüm ekranı kaplayan görünmez bir
  // backdrop <div> kullanılıyordu. `.input-card` üzerindeki `backdrop-filter` kendi
  // stacking context'ini oluşturduğundan, popover'ın kendi z-index'i (20002) bu
  // context İÇİNDE hapsoluyor ve dışarıdaki backdrop (z-index 1999) tüm popover'ın
  // ÜZERİNDE render ediliyordu — popover görsel olarak görünse de üzerine tıklamalar
  // aslında görünmez backdrop'a gidiyor, popover'ı kapatmaktan başka bir şey yapmıyordu
  // (örn. "@Klasör" popover'ından bir klasöre tıklamak hiçbir şey eklemiyordu). Çözüm:
  // stacking context / z-index yarışına hiç girmeyen, gerçek document seviyesinde
  // "dışına tıklama" dinleyicisi kullanmak.
  useEffect(() => {
    if (activePopover === null) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideToolbar = quickInsertToolbarRef.current?.contains(target);
      const insideMobilePopover = mobilePopoverRef.current?.contains(target);
      if (!insideToolbar && !insideMobilePopover) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activePopover]);

  // AI tarih/saat algılama: metindeki "yarın öğlen" gibi doğal dil ifadelerini
  // [due:]/[time:] etiketine çevirir — kullanıcı elle tarih seçmek zorunda kalmaz.
  const [isDetectingDate, setIsDetectingDate] = useState(false);

  const handleDetectDate = async () => {
    if (!inputVal.trim() || isDetectingDate) return;
    setIsDetectingDate(true);
    try {
      const todayISO = new Date().toISOString().split('T')[0];
      const result = await extractDateFromText(inputVal, todayISO);
      if (result.found && result.date) {
        let tagsToAdd = `[due:${result.date}]`;
        if (result.time && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(result.time)) {
          tagsToAdd += ` [time:${result.time}]`;
        }
        insertTextAtCursor(tagsToAdd);
      }
    } catch (e) {
      console.error('Tarih algılanamadı:', e);
    } finally {
      setIsDetectingDate(false);
    }
  };

  const insertTextAtCursor = (textToInsert: string) => {
    const el = textareaRef.current;
    if (!el) {
      setInputVal(prev => {
        const spacing = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
        return `${prev}${spacing}${textToInsert}`;
      });
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = el.value;

    const needsLeadingSpace = start > 0 && currentVal[start - 1] !== ' ';
    const formattedText = needsLeadingSpace ? ` ${textToInsert}` : textToInsert;

    const newVal = currentVal.substring(0, start) + formattedText + currentVal.substring(end);
    setInputVal(newVal);

    // Restore focus and cursor position after insertion
    setTimeout(() => {
      el.focus();
      const newPos = start + formattedText.length;
      el.setSelectionRange(newPos, newPos);
    }, 50);
  };

  const getToolbarButtonStyle = (isActive: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '20px',
    border: '1px solid',
    borderColor: isActive ? 'var(--accent-color)' : 'var(--border-color)',
    background: isActive ? 'var(--accent-glow)' : 'var(--bg-secondary)',
    color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)',
    fontSize: '11.5px',
    fontWeight: isActive ? '600' : '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: isActive ? '0 0 10px rgba(99, 102, 241, 0.2)' : 'none'
  });

  const renderFolderPopover = () => {
    return (
      <div className="factory-dropdown-popover" onClick={(e) => e.stopPropagation()}>
        <div className="popover-header-row">
          <span>Klasör Seçin</span>
          <button type="button" onClick={() => setActivePopover(null)} className="popover-close-btn"><X size={14} /></button>
        </div>
        {visibleFolders.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>Mevcut klasör yok.</div>
        ) : (
          visibleFolders.map(f => (
            <div
              key={f}
              onClick={() => {
                insertTextAtCursor(`@${f.includes(' ') ? `[${f}]` : f}`);
                setActivePopover(null);
              }}
              className="autocomplete-item"
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Folder size={11} className="text-accent" style={{ color: '#818cf8' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
            </div>
          ))
        )}
      </div>
    );
  };

  const renderNotePopover = () => {
    // BUG DÜZELTMESİ: kullanıcı önce bir klasör (@) girmişse, hedef not (!) listesi
    // SADECE o klasörün notlarını göstermeli — aksi halde alakasız yüzlerce not arasından
    // arama yapmak zorunda kalıyordu. Klasör henüz seçilmemişse tüm notlar gösterilir.
    const noteItems = notes.filter(n => {
      if (n.type !== 'note') return false;
      if (parsed.folder) {
        return n.path.startsWith(`${parsed.folder}/`);
      }
      return true;
    });
    return (
      <div className="factory-dropdown-popover" onClick={(e) => e.stopPropagation()}>
        <div className="popover-header-row">
          <span>Hedef Not Seçin</span>
          <button type="button" onClick={() => setActivePopover(null)} className="popover-close-btn"><X size={14} /></button>
        </div>
        {noteItems.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>Mevcut not yok.</div>
        ) : (
          noteItems.map(n => (
            <div
              key={n.path}
              onClick={() => {
                const noteVal = `!${n.name.includes(' ') ? `[${n.name}]` : n.name}`;
                if (n.path.includes('/')) {
                  const parentFolder = n.path.substring(0, n.path.lastIndexOf('/'));
                  const formattedFolder = parentFolder.includes(' ') ? `[${parentFolder}]` : parentFolder;
                  const folderVal = `@${formattedFolder}`;
                  
                  // Check if folder tag is already present in text, if not, append it!
                  if (!inputVal.includes(folderVal)) {
                    insertTextAtCursor(`${noteVal} ${folderVal}`);
                  } else {
                    insertTextAtCursor(noteVal);
                  }
                } else {
                  insertTextAtCursor(noteVal);
                }
                setActivePopover(null);
              }}
              className="autocomplete-item"
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--text-primary)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '2px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileText size={11} className="text-warning" style={{ color: '#fbbf24' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>{n.name}</span>
              </div>
              {n.path.includes('/') ? (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '17px', opacity: 0.8 }}>
                  📂 {n.path.substring(0, n.path.lastIndexOf('/'))}
                </span>
              ) : (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '17px', opacity: 0.8 }}>
                  📂 Kök Dizin
                </span>
              )}
            </div>
          ))
        )}
      </div>
    );
  };

  const renderTagPopover = () => {
    return (
      <div className="factory-dropdown-popover" onClick={(e) => e.stopPropagation()}>
        <div className="popover-header-row">
          <span>Etiket Seçin</span>
          <button type="button" onClick={() => setActivePopover(null)} className="popover-close-btn"><X size={14} /></button>
        </div>
        {tags.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>Mevcut etiket yok.</div>
        ) : (
          tags.map(t => (
            <div
              key={t}
              onClick={() => {
                insertTextAtCursor(`#${t}`);
                setActivePopover(null);
              }}
              className="autocomplete-item"
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Hash size={11} className="text-success" style={{ color: '#34d399' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
            </div>
          ))
        )}
      </div>
    );
  };

  const renderPriorityPopover = () => {
    const priorities = [
      { key: 'critical', label: '🔴 Kritik (Critical)', color: 'var(--danger-color)' },
      { key: 'high', label: '🟠 Yüksek (High)', color: 'var(--warning-color)' },
      { key: 'medium', label: '🟡 Orta (Medium)', color: 'var(--accent-color)' },
      { key: 'low', label: '🟢 Düşük (Low)', color: 'var(--text-muted)' }
    ];
    return (
      <div className="factory-dropdown-popover" onClick={(e) => e.stopPropagation()}>
        <div className="popover-header-row">
          <span>Öncelik Seçin</span>
          <button type="button" onClick={() => setActivePopover(null)} className="popover-close-btn"><X size={14} /></button>
        </div>
        {priorities.map(p => (
          <div
            key={p.key}
            onClick={() => {
              insertTextAtCursor(`[p:${p.key}]`);
              setActivePopover(null);
            }}
            className="autocomplete-item"
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{p.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderDuePopover = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    return (
      <div className="factory-dropdown-popover wide-popover" onClick={(e) => e.stopPropagation()}>
        <div className="popover-header-row">
          <span>Bitiş Tarihi Seçin</span>
          <button type="button" onClick={() => setActivePopover(null)} className="popover-close-btn"><X size={14} /></button>
        </div>

        <div
          onClick={() => {
            insertTextAtCursor(`[due:${todayStr}]`);
            setActivePopover(null);
          }}
          className="autocomplete-item"
          style={{ padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}
        >
          📅 Bugün ({todayStr})
        </div>
        <div
          onClick={() => {
            insertTextAtCursor(`[due:${tomorrowStr}]`);
            setActivePopover(null);
          }}
          className="autocomplete-item"
          style={{ padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}
        >
          🌅 Yarın ({tomorrowStr})
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '6px 0' }} />

        <div style={{ padding: '4px 6px' }}>
          <label style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Özel Tarih:</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="date"
              id="popover-date-input"
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
                padding: '6px',
                outline: 'none',
                cursor: 'pointer',
                colorScheme: 'dark'
              }}
            />
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('popover-date-input') as HTMLInputElement;
                if (el && el.value) {
                  insertTextAtCursor(`[due:${el.value}]`);
                  setActivePopover(null);
                }
              }}
              style={{
                background: 'var(--accent-color)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Ekle
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTimePopover = () => {
    const quickSlots = [
      '09:00-10:00',
      '10:00-11:00',
      '11:00-12:00',
      '13:00-14:00',
      '14:00-15:00',
      '15:00-16:00',
      '16:00-17:00'
    ];

    return (
      <div className="factory-dropdown-popover wide-popover" onClick={(e) => e.stopPropagation()}>
        <div className="popover-header-row">
          <span>Saat Aralığı Seçin</span>
          <button type="button" onClick={() => setActivePopover(null)} className="popover-close-btn"><X size={14} /></button>
        </div>

        <div className="slots-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', maxHeight: '120px', overflowY: 'auto', marginBottom: '8px' }}>
          {quickSlots.map(slot => (
            <div
              key={slot}
              onClick={() => {
                insertTextAtCursor(`[time:${slot}]`);
                setActivePopover(null);
              }}
              className="autocomplete-item"
              style={{ padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '11.5px', color: 'var(--text-primary)', textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}
            >
              ⏰ {slot}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '6px 0' }} />

        <div style={{ padding: '4px 6px' }}>
          <label style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Özel Saat:</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              id="popover-time-input"
              placeholder="Örn: 09:30-10:45"
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
                padding: '6px',
                outline: 'none'
              }}
            />
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('popover-time-input') as HTMLInputElement;
                if (el) {
                  const val = el.value.trim();
                  if (/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(val)) {
                    insertTextAtCursor(`[time:${val}]`);
                    setActivePopover(null);
                  } else {
                    alert('Lütfen geçerli formatta yazın! Örn: 09:00-10:00');
                  }
                }
              }}
              style={{
                background: 'var(--accent-color)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Ekle
            </button>
          </div>
        </div>
      </div>
    );
  };


  const parseShortcutSyntax = (syntax: string) => {
    const tagRegex = /#([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)/g;
    const tagsList: string[] = [];
    let match;
    while ((match = tagRegex.exec(syntax)) !== null) {
      const tag = match[1].toLowerCase();
      if (tag !== 'todo') {
        tagsList.push(tag);
      }
    }
    const isTodo = syntax.toLowerCase().includes('#todo') || syntax.includes('[ ]');
    // BUG DÜZELTMESİ: eski regex yalnızca Latin+Türkçe harfleri kabul eden bir izin
    // listesi kullanıyordu — klasör/not adı emoji içerdiğinde (ör. "🚀 Başlangıç",
    // "👋 Hoş Geldin") hiç eşleşmiyor, parsed.folder/note null kalıyor ve klasöre
    // özel not listesi sessizce TÜM notları gösteriyordu. Artık izin listesi yerine
    // ayraç olmayan HER karakteri kabul eden bir negatif karakter sınıfı kullanılıyor.
    const folderRegex = /@(\[[^\]\r\n]+\]|[^\s\[\]@!#]+)/g;
    let folder: string | null = null;
    const folderMatch = folderRegex.exec(syntax);
    if (folderMatch) {
      folder = folderMatch[1].startsWith('[') ? folderMatch[1].slice(1, -1) : folderMatch[1];
    }
    const noteRegex = /!(\[[^\]\r\n]+\]|[^\s\[\]@!#]+)/g;
    let note: string | null = null;
    const noteMatch = noteRegex.exec(syntax);
    if (noteMatch) {
      note = noteMatch[1].startsWith('[') ? noteMatch[1].slice(1, -1) : noteMatch[1];
    }
    return { folder, note, isTodo, tags: tagsList };
  };

  // Real-time Parser Logic
  useEffect(() => {
    const raw = inputVal;
    
    const tagRegex = /#([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)/g;
    const allTags: string[] = [];
    let match;
    while ((match = tagRegex.exec(raw)) !== null) {
      const tag = match[1].toLowerCase();
      if (tag !== 'todo') {
        allTags.push(tag);
      }
    }

    const isTodo = raw.toLowerCase().includes('#todo') || raw.includes('[ ]');

    // BUG DÜZELTMESİ: bkz. parseShortcutSyntax üzerindeki not — emoji içeren klasör/not
    // adları (ör. "🚀 Başlangıç") eski Latin+Türkçe izin listesiyle hiç eşleşmiyordu.
    const folderRegex = /@(\[[^\]\r\n]+\]|[^\s\[\]@!#]+)/g;
    let folder: string | null = null;
    const folderMatch = folderRegex.exec(raw);
    if (folderMatch) {
      folder = folderMatch[1].startsWith('[')
        ? folderMatch[1].slice(1, -1)
        : folderMatch[1];
    }

    const noteRegex = /!(\[[^\]\r\n]+\]|[^\s\[\]@!#]+)/g;
    let note: string | null = null;
    const noteMatch = noteRegex.exec(raw);
    if (noteMatch) {
      note = noteMatch[1].startsWith('[')
        ? noteMatch[1].slice(1, -1)
        : noteMatch[1];
    }

    let mergedFolder = folder;
    let mergedNote = note;
    let mergedIsTodo = isTodo;
    const mergedTags = [...allTags];

    if (activeShortcutId) {
      const active = shortcuts.find(s => s.id === activeShortcutId);
      if (active) {
        const sParsed = parseShortcutSyntax(active.syntax);
        if (!mergedFolder) mergedFolder = sParsed.folder;
        if (!mergedNote) mergedNote = sParsed.note;
        if (sParsed.isTodo) mergedIsTodo = true;
        sParsed.tags.forEach(t => {
          if (!mergedTags.includes(t)) {
            mergedTags.push(t);
          }
        });
      }
    }

    let cleanText = raw
      .replace(/#todo/gi, '')
      .replace(/\[\s*\]/g, '')
      .replace(folderRegex, '')
      .replace(noteRegex, '')
      .replace(tagRegex, '')
      .replace(/\s+/g, ' ')
      .trim();

    setParsed({
      raw,
      cleanText: cleanText || '(Boş metin)',
      isTodo: mergedIsTodo,
      folder: mergedFolder,
      note: mergedNote,
      tags: mergedTags
    });
  }, [inputVal, activeShortcutId, shortcuts]);

  const handleTypeToggle = (targetIsTodo: boolean) => {
    let newVal = inputVal;
    if (targetIsTodo) {
      if (!newVal.toLowerCase().includes('#todo') && !newVal.includes('[ ]')) {
        newVal = `${newVal.trim()} #todo`;
      }
    } else {
      newVal = newVal
        .replace(/#todo/gi, '')
        .replace(/\[\s*\]/g, '')
        .trim();
    }
    setInputVal(newVal);
  };

  const handleTagToggle = (tag: string) => {
    let newVal = inputVal;
    const tagRegex = new RegExp(`#${tag}\\b`, 'gi');
    if (parsed.tags.includes(tag.toLowerCase())) {
      newVal = newVal.replace(tagRegex, '').trim();
    } else {
      newVal = `${newVal.trim()} #${tag}`;
    }
    setInputVal(newVal);
  };

  const getSuggestions = () => {
    if (!suggestionTrigger) return [];
    const search = suggestionSearch.toLowerCase();
    
    if (suggestionTrigger === '@') {
      return visibleFolders.filter(f => f.toLowerCase().includes(search));
    }
    if (suggestionTrigger === '!') {
      return notes
        .filter(n => n.type === 'note' && (!parsed.folder || n.path.startsWith(`${parsed.folder}/`)))
        .map(n => n.name)
        .filter(name => name.toLowerCase().includes(search));
    }
    if (suggestionTrigger === '#') {
      return tags.filter(t => t.toLowerCase().includes(search));
    }
    return [];
  };
  
  const filteredOptions = getSuggestions();

  const selectSuggestion = (option: string) => {
    if (suggestionTrigger === null || triggerIndex === -1) return;
    
    const formattedOption = (suggestionTrigger === '@' || suggestionTrigger === '!') && option.includes(' ') 
      ? `[${option}]` 
      : option;
      
    const beforeTrigger = inputVal.slice(0, triggerIndex);
    const afterSearch = inputVal.slice(triggerIndex + suggestionTrigger.length + suggestionSearch.length);
    
    const newVal = `${beforeTrigger}${suggestionTrigger}${formattedOption} ${afterSearch}`;
    setInputVal(newVal);
    setShowSuggestions(false);
    setSuggestionTrigger(null);
    setSuggestionSearch('');
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = beforeTrigger.length + suggestionTrigger.length + formattedOption.length + 2;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputVal(val);
    
    const selectionStart = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, selectionStart);
    const lastWordMatch = textBeforeCursor.match(/([@!#])([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ/-]*)$/);
    
    if (lastWordMatch) {
      const trigger = lastWordMatch[1] as '@' | '!' | '#';
      const search = lastWordMatch[2];
      const index = textBeforeCursor.lastIndexOf(trigger);
      
      setSuggestionTrigger(trigger);
      setSuggestionSearch(search);
      setTriggerIndex(index);
      setShowSuggestions(true);
      setActiveSuggestionIndex(0);

      if (textareaRef.current) {
        const coords = getCaretCoordinates(textareaRef.current, index);
        setCaretPos(coords);
      }
    } else {
      setShowSuggestions(false);
      setSuggestionTrigger(null);
      setSuggestionSearch('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;

    onProcessInput(parsed);
    setInputVal('');
    setShowSuggestions(false);
    setSuggestionTrigger(null);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && filteredOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev + 1) % filteredOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion(filteredOptions[activeSuggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="inbox-container animate-fade">
      <div className="inbox-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)' }}>
          <Zap size={22} className="text-accent animate-pulse-slow" style={{ color: 'var(--accent-color)' }} />
          Hızlı Not Fabrikası
        </h1>
        <p className="subtitle">Not al, etiketle, sistem otomatik yerleştirsin.</p>
      </div>

      <form onSubmit={handleSubmit} className="inbox-form">
        <div className="input-card">
          {/* Hızlı Kısayol Şablonları */}
          <div className="factory-shortcuts-container" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            padding: '12px 14px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(255, 255, 255, 0.01)',
            borderTopLeftRadius: '16px',
            borderTopRightRadius: '16px'
          }}>
            <span style={{
              fontSize: '11px',
              fontWeight: '700',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              🎯 Kısayollar:
            </span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {shortcuts.map(s => {
                const isActive = activeShortcutId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveShortcutId(isActive ? null : s.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '5px 12px',
                      borderRadius: '20px',
                      borderColor: isActive ? 'var(--accent-color)' : 'var(--border-color)',
                      background: isActive ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                      color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)',
                      fontSize: '12px',
                      fontWeight: isActive ? '600' : '400',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 0 10px rgba(99, 102, 241, 0.2)' : 'none'
                    }}
                    title={s.syntax}
                  >
                    <span>{isActive ? '🔒' : '🔓'}</span>
                    <span>{s.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowAddShortcutModal(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  border: '1px dashed rgba(255, 255, 255, 0.15)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <span>+ Kısayol Ekle</span>
              </button>
            </div>
            {activeShortcutId && (
              <div style={{
                marginLeft: 'auto',
                fontSize: '11px',
                color: 'var(--accent-color, #818cf8)',
                background: 'rgba(99, 102, 241, 0.08)',
                padding: '4px 8px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span>🔒 Aktif Kilit:</span>
                <code style={{ fontSize: '10px', background: 'rgba(0,0,0,0.2)', padding: '2px 4px', borderRadius: '4px' }}>
                  {shortcuts.find(s => s.id === activeShortcutId)?.syntax}
                </code>
              </div>
            )}
          </div>
          
          {/* Top Row: Segmented control & Quick Insert Toolbar */}
          <div className="inbox-top-row">
            <div className="segmented-control-container">
              <div 
                className="segmented-slider-bg" 
                style={{ 
                  transform: parsed.isTodo ? 'translateX(100%)' : 'translateX(0%)'
                }} 
              />
              <button
                type="button"
                className={`segmented-btn ${!parsed.isTodo ? 'active' : ''}`}
                onClick={() => handleTypeToggle(false)}
              >
                <FileText size={13} />
                <span>Not Ekle</span>
              </button>
              <button
                type="button"
                className={`segmented-btn ${parsed.isTodo ? 'active' : ''}`}
                onClick={() => handleTypeToggle(true)}
              >
                <CheckSquare size={13} />
                <span>Görev Ekle</span>
              </button>
            </div>

            {/* Quick Insert Symbol Buttons Toolbar - Swipeable on mobile */}
            <div className="inbox-quick-insert-toolbar" ref={quickInsertToolbarRef}>
              <span className="toolbar-label">
                EKLE:
              </span>

              <div className="toolbar-scrollable-wrapper">
                {/* Folder Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`quick-tag-pill ${activePopover === '@' ? 'active' : ''}`}
                    onClick={() => setActivePopover(activePopover === '@' ? null : '@')}
                    style={getToolbarButtonStyle(activePopover === '@')}
                    title="Klasör Etiketi Ekle (@)"
                  >
                    <Folder size={12} style={{ color: '#818cf8' }} />
                    <span>@ Klasör</span>
                  </button>
                  {!isMobile && activePopover === '@' && renderFolderPopover()}
                </div>

                {/* Note Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`quick-tag-pill ${activePopover === '!' ? 'active' : ''}`}
                    onClick={() => setActivePopover(activePopover === '!' ? null : '!')}
                    style={getToolbarButtonStyle(activePopover === '!')}
                    title="Hedef Not Ekle (!)"
                  >
                    <FileText size={12} style={{ color: '#fbbf24' }} />
                    <span>! Not</span>
                  </button>
                  {!isMobile && activePopover === '!' && renderNotePopover()}
                </div>

                {/* Tag Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`quick-tag-pill ${activePopover === '#' ? 'active' : ''}`}
                    onClick={() => setActivePopover(activePopover === '#' ? null : '#')}
                    style={getToolbarButtonStyle(activePopover === '#')}
                    title="Etiket Ekle (#)"
                  >
                    <Hash size={12} style={{ color: '#34d399' }} />
                    <span># Etiket</span>
                  </button>
                  {!isMobile && activePopover === '#' && renderTagPopover()}
                </div>

                {/* Priority Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`quick-tag-pill ${activePopover === 'priority' ? 'active' : ''}`}
                    onClick={() => setActivePopover(activePopover === 'priority' ? null : 'priority')}
                    style={getToolbarButtonStyle(activePopover === 'priority')}
                    title="Öncelik Seviyesi Ekle [p:]"
                  >
                    <Zap size={12} style={{ color: '#fb923c' }} />
                    <span>⚡ Öncelik</span>
                  </button>
                  {!isMobile && activePopover === 'priority' && renderPriorityPopover()}
                </div>

                {/* Due Date Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`quick-tag-pill ${activePopover === 'due' ? 'active' : ''}`}
                    onClick={() => setActivePopover(activePopover === 'due' ? null : 'due')}
                    style={getToolbarButtonStyle(activePopover === 'due')}
                    title="Bitiş Tarihi Ekle [due:]"
                  >
                    <Calendar size={12} style={{ color: '#818cf8' }} />
                    <span>📅 Bitiş</span>
                  </button>
                  {!isMobile && activePopover === 'due' && renderDuePopover()}
                </div>

                {/* Time Slot Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`quick-tag-pill ${activePopover === 'time' ? 'active' : ''}`}
                    onClick={() => setActivePopover(activePopover === 'time' ? null : 'time')}
                    style={getToolbarButtonStyle(activePopover === 'time')}
                    title="Saat Dilimi Ekle [time:]"
                  >
                    <Clock size={12} style={{ color: '#fbbf24' }} />
                    <span>⏰ Saat</span>
                  </button>
                  {!isMobile && activePopover === 'time' && renderTimePopover()}
                </div>

                {/* AI Date Detection Button */}
                {isGeminiConfigured() && (
                  <button
                    type="button"
                    onClick={handleDetectDate}
                    disabled={!inputVal.trim() || isDetectingDate}
                    style={getToolbarButtonStyle(false)}
                    title="Metindeki tarih/saat ifadesini AI ile algıla (ör. 'yarın öğlen')"
                  >
                    <Sparkles size={12} style={{ color: '#c084fc' }} />
                    <span>{isDetectingDate ? 'Algılanıyor...' : '✨ Tarihi Algıla'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Text Input Area */}
          <div className="rich-input-wrapper">
            <div
              ref={highlighterRef}
              className="inbox-highlighter-bg"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                padding: '12px',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                color: 'var(--text-primary)',
                pointerEvents: 'none',
                overflow: 'auto',
                boxSizing: 'border-box',
                fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
                fontSize: '14px',
                lineHeight: '1.6',
                margin: 0,
                border: 'none',
                zIndex: 1
              }}
            >
              {renderHighlightedText(inputVal)}
            </div>
            <textarea
              ref={textareaRef}
              className="inbox-textarea rich-textarea"
              placeholder="Aklındakileri buraya dök... Örn: @Borusan !Rapor #planlama"
              value={inputVal}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              autoFocus
              spellCheck={false}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: '12px',
                color: 'transparent',
                fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
                fontSize: '14px',
                lineHeight: '1.6',
                resize: 'none',
                boxSizing: 'border-box',
                zIndex: 2,
                margin: 0,
                overflowY: 'auto'
              }}
            />

            {/* Suggestions Autocomplete Popup */}
            {showSuggestions && filteredOptions.length > 0 && (
              <div 
                className="autocomplete-dropdown animate-pop inline-suggestion-popup"
                style={{
                  position: 'absolute',
                  top: `${caretPos.top + 8}px`,
                  left: `${Math.min(Math.max(10, caretPos.left), textareaRef.current ? textareaRef.current.clientWidth - 240 : caretPos.left)}px`,
                  right: 'auto',
                  width: '230px',
                  zIndex: 1000,
                  background: 'rgba(20, 20, 25, 0.95)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                  backdropFilter: 'blur(12px)',
                  maxHeight: '180px',
                  overflowY: 'auto'
                }}
              >
                {filteredOptions.map((opt, i) => (
                  <div 
                    key={opt}
                    className={`autocomplete-item ${i === activeSuggestionIndex ? 'active' : ''}`}
                    onClick={() => selectSuggestion(opt)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      fontSize: '12px',
                      color: i === activeSuggestionIndex ? '#fff' : 'var(--text-secondary)',
                      background: i === activeSuggestionIndex ? 'var(--accent-color)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.1s'
                    }}
                  >
                    {suggestionTrigger === '@' && <Folder size={12} />}
                    {suggestionTrigger === '!' && <FileText size={12} />}
                    {suggestionTrigger === '#' && <Hash size={12} />}
                    <span>{opt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Insert Overlay backdrop for closing popovers on click outside */}


          {/* Quick Tags Choices */}
          {tags.length > 0 && (
            <div className="inbox-quick-controls" style={{ marginTop: '12px' }}>
              <div className="inbox-tags-selector">
                <label className="quick-control-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  <Hash size={12} />
                  <span>Hızlı Etiket Ekle (#)</span>
                </label>
                <div className="quick-tags-scroller" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {tags.map(tag => {
                    const isActive = parsed.tags.includes(tag.toLowerCase());
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`quick-tag-pill ${isActive ? 'active' : ''}`}
                        onClick={() => handleTagToggle(tag)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          border: '1px solid',
                          borderColor: isActive ? 'var(--accent-color)' : 'var(--border-color)',
                          background: isActive ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                          color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)',
                          fontSize: '11.5px',
                          fontWeight: isActive ? '600' : '400',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.2s'
                        }}
                      >
                        #{tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Real-time Parser Feedback - Cleaned preview on mobile and hidden if empty */}
          {parsed.cleanText && parsed.cleanText !== '(Boş metin)' && (
            <div className="parser-feedback">
              <div className="feedback-section clean-text" style={{ marginBottom: '8px' }}>
                <span className="section-label">Metin Önizleme:</span>
                <p className="text-preview">{parsed.cleanText}</p>
              </div>

              <div className="feedback-chips">
                {parsed.isTodo && (
                  <span className="chip todo-chip">
                    <CheckSquare size={12} />
                    Görev (Task)
                  </span>
                )}

                {parsed.folder && (
                  <span className="chip folder-chip">
                    <Folder size={12} />
                    Klasör: {parsed.folder}
                  </span>
                )}

                {parsed.note && (
                  <span className="chip note-chip">
                    <FileText size={12} />
                    Not: {parsed.note}
                  </span>
                )}

                {parsed.tags.map((tag) => (
                  <span key={tag} className="chip tag-chip">
                    <Hash size={12} />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="input-actions-row">
            <div className="shortcuts-info">
              <span><b>[Enter]</b> Gönder</span>
              <span><b>[Shift+Enter]</b> Yeni satır</span>
            </div>
            <button 
              type="submit" 
              className="btn-send-modern"
              disabled={!inputVal.trim()}
            >
              <Send size={14} />
              <span>Sisteme Yerleştir</span>
            </button>
          </div>
        </div>
      </form>

      {/* Render mobile popover sheet modals at root level (escapes container overflows and backdrop-filters) */}
      <div ref={mobilePopoverRef}>
        {isMobile && activePopover === '@' && renderFolderPopover()}
        {isMobile && activePopover === '!' && renderNotePopover()}
        {isMobile && activePopover === '#' && renderTagPopover()}
        {isMobile && activePopover === 'priority' && renderPriorityPopover()}
        {isMobile && activePopover === 'due' && renderDuePopover()}
        {isMobile && activePopover === 'time' && renderTimePopover()}
      </div>

      {/* Add Shortcut Custom Modal */}
      {showAddShortcutModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            padding: '24px',
            borderRadius: '16px',
            width: '340px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)' }}>Yeni Kısayol Ekle</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Kısayol İsmi:</label>
              <input
                type="text"
                placeholder="Örn: 🛒 Alışveriş"
                value={newShortcutLabel}
                onChange={(e) => setNewShortcutLabel(e.target.value)}
                style={{
                  padding: '10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Format/Şablon Kodu:</label>
              <input
                type="text"
                placeholder="Örn: @Kişisel !Alışveriş #todo"
                value={newShortcutSyntax}
                onChange={(e) => setNewShortcutSyntax(e.target.value)}
                style={{
                  padding: '10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Gireceğiniz değerler otomatik kilitlenecektir.
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowAddShortcutModal(false);
                  setNewShortcutLabel('');
                  setNewShortcutSyntax('');
                }}
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newShortcutLabel.trim() && newShortcutSyntax.trim()) {
                    const newS = {
                      id: Math.random().toString(36).substr(2, 9),
                      label: newShortcutLabel.trim(),
                      syntax: newShortcutSyntax.trim()
                    };
                    const updated = [...shortcuts, newS];
                    setShortcuts(updated);
                    localStorage.setItem('note_factory_shortcuts', JSON.stringify(updated));
                    setShowAddShortcutModal(false);
                    setNewShortcutLabel('');
                    setNewShortcutSyntax('');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent-color, #818cf8)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '13px'
                }}
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
