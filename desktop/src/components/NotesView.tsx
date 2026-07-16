import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { 
  Plus, Trash2, FileText, Folder, ArrowLeft, Clock, Calendar, ChevronDown, ChevronUp, Star, 
  RefreshCw, EyeOff, CheckSquare, List, ListOrdered, Bold, Italic, Code, ChevronRight, Eye, 
  BookOpen, Info, Lightbulb, AlertCircle, AlertTriangle, ShieldAlert, FileCode, Play, Pause, 
  RotateCcw, Volume2, Mic, Square, Check, Copy, Table, HelpCircle, Activity, Heart, Sparkles, 
  Pin, Music, X, Globe, PenTool, Database, Inbox,
  Briefcase, Coffee, Rocket, Smile, Columns, Heading1, Heading2, Heading3, Quote, Minus, Image, Tag, Infinity,
  DollarSign, PiggyBank, TrendingUp, MicOff, Maximize2, Minimize2, Type, Network, Layout, Palette, ZoomIn, ZoomOut, Video, Link2, History, GitBranch
} from 'lucide-react';
import { platform, isElectron, isBrowser } from '../services/platform';
import { handleLocalSave as syncMediaToSupabase } from '../services/supabaseSync';
import { Preferences } from '@capacitor/preferences';
import MindmapView from './MindmapView';

const iconMap: Record<string, React.ComponentType<any>> = {
  Folder,
  Briefcase,
  Code,
  Heart,
  Star,
  BookOpen,
  Database,
  Inbox,
  Calendar,
  Sparkles,
  Coffee,
  Rocket,
  Smile
};

const debugLogs: string[] = [];
const addDebugLog = (msg: string) => {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${msg}`;
  console.log(logLine);
  debugLogs.push(logLine);
  if (debugLogs.length > 200) debugLogs.shift();
  platform.writeNote('excalidraw_debug.txt', debugLogs.join('\n')).catch(err => {
    console.error('Failed to write debug log:', err);
  });
};

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

interface NotesViewProps {
  selectedFolder: string | null;
  selectedTag: string | null;
  fileContents: Record<string, string>;
  notes: NoteItem[];
  activeNotePath: string | null;
  setActiveNotePath: (path: string | null) => void;
  onSaveNote: (path: string, content: string) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
  onCreateNote: (name: string, folder: string | null, isExcalidraw?: boolean | 'drawio', initialContent?: string, switchActiveNote?: boolean) => Promise<void>;
  templatesFolder: string;
  mindmapLayouts: Record<string, { coords: any; customs: any[] }>;
  onSaveMindmapLayout: (path: string, coords: any, customs: any[]) => Promise<void>;
  readNoteContent: (path: string) => Promise<string>;
  onRenameNote: (oldPath: string, newPath: string) => Promise<void>;
  onNoteContextMenu?: (e: React.MouseEvent, notePath: string) => void;
  onSearchWeb?: (query: string) => void;
  folderCustomizations?: Record<string, { icon?: string; color?: string }>;
  hideSidebar?: boolean;
  onSplitWorkspace?: () => void;
  onClosePane?: () => void;
  onShowProperties?: (path: string) => void;
  pinnedWidgetLists?: string[];
  pinnedWidgetList?: string | null;
  onUpdatePinnedWidgets?: (newLists: string[], newActive: string | null) => Promise<void>;
  isFlowEffectsEnabled?: boolean;
  lineHeight?: number;
  lineMargin?: number;
}

interface HistoryEntry {
  content: string;
  focusedLineIdx: number | null;
  caretPos: { lineIdx: number; charIdx: number } | null;
}

interface AutoResizingTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyUp?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  className: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  style?: React.CSSProperties;
}

const AutoResizingTextarea: React.FC<AutoResizingTextareaProps> = ({
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  onKeyUp,
  onSelect,
  className,
  placeholder = '',
  autoFocus = false,
  inputRef,
  style
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  return (
    <textarea
      ref={(el) => {
        textareaRef.current = el;
        inputRef(el);
      }}
      value={value}
      onChange={(e) => {
        onChange(e);
        adjustHeight();
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyUp={onKeyUp}
      onSelect={onSelect}
      className={className}
      placeholder={placeholder}
      rows={1}
      style={{
        resize: 'none',
        overflow: 'hidden',
        width: '100%',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        lineHeight: 'inherit',
        padding: '0',
        margin: '0',
        display: 'block',
        fieldSizing: 'content' as any,
        ...style
      }}
    />
  );
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Markdown notlarının içine gömülen çizimlerin (Excalidraw) satır içi (inline) olarak
// görüntülenebilmesini ve doğrudan notun içinden düzenlenebilmesini sağlayan alt bileşen.
// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// draw.io (diagrams.net) tam ekran diyagram editörü. Resmî embed protokolünü
// kullanır: iframe https://embed.diagrams.net adresinden yüklenir ve JSON
// string'leri postMessage ile karşılıklı konuşulur — 'init' gelince XML
// yüklenir, kullanıcı çizdikçe 'autosave' olayındaki XML debounce ile kasadaki
// .drawio dosyasına yazılır. Excalidraw'daki akışın (yükle → çiz → otomatik
// kaydet → çıkışta flush) birebir karşılığıdır. İnternet gerektirir; editör
// makul sürede hazır olmazsa kullanıcıya çevrimdışı uyarısı gösterilir.
const DRAWIO_EMBED_ORIGIN = 'https://embed.diagrams.net';

interface DrawioFullEditorProps {
  notePath: string;
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
}

const DrawioFullEditor: React.FC<DrawioFullEditorProps> = ({ notePath, readNoteContent, onSaveNote }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const lastSavedXmlRef = useRef<string>('');
  const isDirtyRef = useRef<boolean>(false);

  const isLightTheme = typeof document !== 'undefined' && document.documentElement.classList.contains('light-theme');
  const embedUrl = `${DRAWIO_EMBED_ORIGIN}/?embed=1&proto=json&spin=1&libraries=1&noSaveBtn=1&noExitBtn=1&saveAndExit=0${isLightTheme ? '' : '&dark=1'}`;

  useEffect(() => {
    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;

    const persistXml = (xml: string, immediate: boolean) => {
      if (typeof xml !== 'string' || xml === lastSavedXmlRef.current) return;
      lastSavedXmlRef.current = xml;
      isDirtyRef.current = true;
      clearTimeout(saveTimeout);
      const doSave = async () => {
        try {
          await onSaveNote(notePath, xml);
          isDirtyRef.current = false;
        } catch (err) {
          console.error('[Drawio] Kaydetme hatası:', err);
        }
      };
      if (immediate) {
        doSave();
      } else {
        saveTimeout = setTimeout(doSave, 800);
      }
    };

    const handleMessage = async (e: MessageEvent) => {
      if (e.origin !== DRAWIO_EMBED_ORIGIN) return;
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (typeof e.data !== 'string' || !e.data.length) return;

      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.event === 'init') {
        clearTimeout(readyTimeout);
        try {
          const xml = await readNoteContent(notePath);
          lastSavedXmlRef.current = xml || '';
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ action: 'load', autosave: 1, xml: xml || '' }),
            DRAWIO_EMBED_ORIGIN
          );
          setIsReady(true);
          setLoadTimedOut(false);
        } catch (err) {
          console.error('[Drawio] Diyagram yüklenemedi:', err);
        }
      } else if (msg.event === 'autosave') {
        persistXml(msg.xml, false);
      } else if (msg.event === 'save') {
        persistXml(msg.xml, true);
        // Editöre "değişiklikler kaydedildi" durumunu bildir (kirli bayrağını temizler).
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ action: 'status', message: '', modified: false }),
          DRAWIO_EMBED_ORIGIN
        );
      }
    };

    window.addEventListener('message', handleMessage);
    // Editör 12 sn içinde hazır olmazsa büyük ihtimalle internet yok.
    readyTimeout = setTimeout(() => setLoadTimedOut(true), 12000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(saveTimeout);
      clearTimeout(readyTimeout);
      // Bekleyen (debounce'lanmış) son değişiklikleri kaybetmemek için çıkışta anında yaz.
      if (isDirtyRef.current && lastSavedXmlRef.current) {
        onSaveNote(notePath, lastSavedXmlRef.current).catch(err => {
          console.error('[Drawio] Çıkışta kaydetme hatası:', err);
        });
      }
    };
  }, [notePath, readNoteContent, onSaveNote]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '8px', margin: '0 8px 8px 8px', border: '1px solid rgba(242, 148, 0, 0.25)', background: 'var(--bg-tertiary)', position: 'relative' }}>
      <iframe
        key={notePath}
        ref={iframeRef}
        src={embedUrl}
        style={{ width: '100%', flex: 1, border: 'none', borderRadius: '8px' }}
        title="draw.io Diyagram Editörü"
      />
      {!isReady && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          background: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
          fontSize: '13px',
          textAlign: 'center',
          padding: '20px'
        }}>
          {loadTimedOut ? (
            <>
              <AlertTriangle size={22} style={{ color: '#f59e0b' }} />
              <span>Diyagram editörü yüklenemedi.</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                draw.io editörü internet bağlantısı gerektirir. Bağlantınızı kontrol edip notu yeniden açın.
              </span>
            </>
          ) : (
            <span>Diyagram editörü yükleniyor…</span>
          )}
        </div>
      )}
    </div>
  );
};

interface InlineExcalidrawEditorProps {
  notePath: string;
  noteName: string;
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
  onOpenFullScreen?: (path: string) => void;
}

const InlineExcalidrawEditor: React.FC<InlineExcalidrawEditorProps> = ({
  notePath,
  noteName,
  readNoteContent,
  onSaveNote,
  onOpenFullScreen
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const lastSavedJsonRef = useRef<string>('');
  const ignoreSaveUntilRef = useRef<number>(0);
  const isDirtyRef = useRef<boolean>(false);

  useEffect(() => {
    let saveTimeout: any;

    const handleMessage = async (e: MessageEvent) => {
      if (!iframeRef.current || !iframeRef.current.contentWindow || e.source !== iframeRef.current.contentWindow) return;
      if (!e.data || typeof e.data !== 'object') return;

      if (e.data.type === 'EXCALIDRAW_READY') {
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Excalidraw iframe'i ilk açıldığında henüz verilerimiz yüklenmeden boş sahneyle ('[]')
        // SAVE_DATA tetikler. Bu boş verinin diskteki dolu çizimi sıfırlamasını önlemek için
        // hazır olduktan sonraki ilk 1500ms boyunca kaydetme komutlarını yoksayıyoruz.
        ignoreSaveUntilRef.current = Date.now() + 1500;
        try {
          const content = await readNoteContent(notePath);
          lastSavedJsonRef.current = content;
          const parsed = JSON.parse(content || '{}');
          
          iframeRef.current.contentWindow.postMessage({
            type: 'LOAD_DATA',
            elements: parsed.elements || [],
            appState: parsed.appState || {},
            path: notePath
          }, '*');
          setIsLoaded(true);
        } catch (err) {
          console.error('[Inline Excalidraw] Failed to load data:', err);
        }
      }

      if (e.data.type === 'SAVE_DATA') {
        if (Date.now() < ignoreSaveUntilRef.current) {
          return;
        }
        // Iframe'den gelen çizim verilerini alıp JSON formatında kaydederiz
        const saveJson = JSON.stringify({
          elements: e.data.elements || [],
          appState: e.data.appState || {}
        }, null, 2);

        if (saveJson !== lastSavedJsonRef.current) {
          lastSavedJsonRef.current = saveJson;
          isDirtyRef.current = true;
          
          // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          // Kullanıcı çizmeye devam ederken disk yazma işlemlerinin ve veri yüklemelerinin CPU'yu
          // kilitlememesi için disk kaydetmesini 500ms debounce (erteleme) ediyoruz.
          clearTimeout(saveTimeout);
          saveTimeout = setTimeout(async () => {
            await onSaveNote(notePath, saveJson);
            isDirtyRef.current = false;
          }, 500);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(saveTimeout);
      
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Gömülü çizim tahtası unmount edildiğinde (örneğin sekme veya sayfa değiştirildiğinde),
      // henüz diske yazılmamış (debounced) son çizim hareketleri varsa bunları kaybolmaması için anında diske kaydederiz.
      if (isDirtyRef.current && lastSavedJsonRef.current) {
        onSaveNote(notePath, lastSavedJsonRef.current).catch(err => {
          console.error('[Inline Excalidraw] Error saving on unmount:', err);
        });
      }
    };
  }, [notePath, readNoteContent, onSaveNote]);

  const handleZoomIn = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'ZOOM_IN' }, '*');
    }
  };

  const handleZoomOut = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'ZOOM_OUT' }, '*');
    }
  };

  const handleResetZoom = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'RESET_ZOOM' }, '*');
    }
  };

  return (
    <div className="inline-excalidraw-container" style={{
      margin: '16px 0',
      background: '#121214',
      border: '1px solid rgba(139, 92, 246, 0.25)',
      borderRadius: '10px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)'
    }}>
      <div className="inline-excalidraw-header" style={{
        padding: '8px 12px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
          <Palette size={14} style={{ color: '#a78bfa' }} />
          <span style={{ fontSize: '12px', fontWeight: '600' }}>{noteName.replace('.excalidraw', '')}</span>
          <span style={{ fontSize: '10px', color: '#64748b' }}>(Gömülü Çizim)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button 
            type="button"
            onClick={handleZoomIn}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4px',
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            title="Yakınlaştır"
          >
            <ZoomIn size={13} />
          </button>
          <button 
            type="button"
            onClick={handleZoomOut}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4px',
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            title="Uzaklaştır"
          >
            <ZoomOut size={13} />
          </button>
          <button 
            type="button"
            onClick={handleResetZoom}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4px',
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            title="Yakınlaştırmayı Sıfırla (%100)"
          >
            <RotateCcw size={12} />
          </button>
          
          <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.1)', margin: '0 4px' }} />

          {onOpenFullScreen && (
            <button 
              type="button"
              onClick={() => onOpenFullScreen(notePath)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '4px',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              title="Tam ekran düzenle"
            >
              <Maximize2 size={13} />
            </button>
          )}
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', height: '420px', background: '#121212' }}>
        <iframe
          ref={iframeRef}
          src={isElectron ? `./excalidraw-embed.html?v=3` : `/excalidraw-embed.html?v=3`}
          style={{ width: '100%', height: '100%', border: 'none' }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
          title={`Inline Excalidraw ${noteName}`}
        />
        {!isLoaded && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#121212',
            color: '#94a3b8',
            fontSize: '12px',
            gap: '8px'
          }}>
            <span>Çizim tahtası yükleniyor...</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper to calculate caret coordinates inside a textarea
// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Modül seviyesinde tek bir aynalama (mirror) elemanı önbelleğe alınır; eskiden
// her çağrıda yeni <div>/<span> oluşturup DOM'a ekleyip siliyorduk, bu da
// (örn. "[[" ile wiki-link yazarken) her tuş vuruşunda zorunlu bir senkron
// reflow'a (forced layout) yol açıp donmaya sebep oluyordu.
let caretMirrorEls: { div: HTMLDivElement; span: HTMLSpanElement } | null = null;

function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number
): { top: number; left: number } {
  if (!caretMirrorEls) {
    const div = document.createElement('div');
    const span = document.createElement('span');
    div.style.position = 'fixed';
    div.style.visibility = 'hidden';
    div.style.top = '0';
    div.style.left = '0';
    div.style.pointerEvents = 'none';
    div.appendChild(span);
    document.body.appendChild(div);
    caretMirrorEls = { div, span };
  }
  const { div, span } = caretMirrorEls;
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
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.width = `${element.clientWidth}px`;

  const textBeforeCaret = element.value.substring(0, position);
  div.textContent = '';
  div.appendChild(document.createTextNode(textBeforeCaret));
  span.textContent = element.value.substring(position, position + 1) || '.';
  div.appendChild(span);

  const lineHeightVal = parseInt(style.lineHeight || '');
  const finalLineHeight = isNaN(lineHeightVal) ? parseInt(style.fontSize || '14') * 1.25 : lineHeightVal;

  // Tek zorunlu layout okuması burada gerçekleşir.
  const coordinates = {
    top: span.offsetTop + finalLineHeight - element.scrollTop + element.offsetTop,
    left: span.offsetLeft - element.scrollLeft + element.offsetLeft
  };

  return coordinates;
}

const getCleanFilename = (title: string): string => {
  return title
    .trim()
    .replace(/[\\/:*?\"<>|]/g, '') // remove illegal characters
    .replace(/\s+/g, '_'); // spaces to underscores
};

const getLineIndentPx = (text: string): number => {
  const match = text.match(/^(\s*)/);
  if (!match) return 0;
  const spaces = match[1].replace(/\t/g, '  ').length; // convert tabs to 2 spaces
  return spaces * 12; // 24px per 2 spaces indent level (12px per space)
};

const isTimestampOnlyLine = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed === '') return false;

  // Strip markdown formatting to check if line consists solely of a timestamp
  const clean = trimmed
    .replace(/^(?:\s*[-*+]\s+\[[ xX]\]\s*)/, '') // checklist prefix
    .replace(/^(?:\s*[-*+]\s*)/, '')            // bullet prefix
    .replace(/^(?:\s*\d+\.\s*)/, '')            // ordered list prefix
    .replace(/^(?:\s*#{1,6}\s*)/, '')           // heading prefix
    .replace(/^>\s*/, '')                       // blockquote prefix
    .trim();
  
  // Match [YYYY-MM-DD] or [YYYY-MM-DD HH:mm]
  return /^\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]$/.test(clean);
};

const isTagsOnlyLine = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  
  // Check if there is at least one tag
  const hasTags = /#[a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_-]+/i.test(trimmed);
  if (!hasTags) return false;
  
  // Remove all tags and see if only whitespace is left
  const clean = trimmed.replace(/#[a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_-]+/gi, '').trim();
  return clean === '';
};

interface CopyHelperWidgetProps {
  text: string;
}

const CopyHelperWidget: React.FC<CopyHelperWidgetProps> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="copy-helper-widget" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <span className="copy-helper-text">{text}</span>
      <button className={`copy-helper-btn ${copied ? 'copied' : ''}`} onClick={handleCopy} onMouseDown={(e) => e.stopPropagation()}>
        {copied ? <Check size={12} className="success-text" /> : <Copy size={12} />}
        <span>{copied ? 'Kopyalandı!' : 'Kopyala'}</span>
      </button>
    </div>
  );
};

interface TimerWidgetProps {
  lineIdx: number;
  durationMin: number;
  activeTimers: Record<number, { remaining: number; isRunning: boolean; duration: number }>;
  setActiveTimers: React.Dispatch<React.SetStateAction<Record<number, { remaining: number; isRunning: boolean; duration: number }>>>;
  timerIntervalsRef: React.MutableRefObject<Record<number, any>>;
  playBeepSound: () => void;
  onTimerComplete?: () => void;
}

const TimerWidget: React.FC<TimerWidgetProps> = ({
  lineIdx,
  durationMin,
  activeTimers,
  setActiveTimers,
  timerIntervalsRef,
  playBeepSound,
  onTimerComplete
}) => {
  const state = activeTimers[lineIdx] || { remaining: durationMin * 60, isRunning: false, duration: durationMin * 60 };
  
  const startTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state.isRunning) return;
    
    // Tarayıcı bildirim iznini ilk oynat tuşuna basıldığında talep et (JIT)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    
    if (timerIntervalsRef.current[lineIdx]) {
      clearInterval(timerIntervalsRef.current[lineIdx]);
    }
    
    setActiveTimers(prev => ({
      ...prev,
      [lineIdx]: { ...state, isRunning: true }
    }));
    
    const interval = setInterval(() => {
      setActiveTimers(prev => {
        const t = prev[lineIdx];
        if (!t || t.remaining <= 1) {
          clearInterval(timerIntervalsRef.current[lineIdx]);
          delete timerIntervalsRef.current[lineIdx];
          
          playBeepSound();
          
          if (onTimerComplete) {
            onTimerComplete();
          }
          
          return {
            ...prev,
            [lineIdx]: { remaining: durationMin * 60, isRunning: false, duration: durationMin * 60 }
          };
        }
        return {
          ...prev,
          [lineIdx]: { ...t, remaining: t.remaining - 1 }
        };
      });
    }, 1000);
    
    timerIntervalsRef.current[lineIdx] = interval;
  };
  
  const pauseTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerIntervalsRef.current[lineIdx]) {
      clearInterval(timerIntervalsRef.current[lineIdx]);
      delete timerIntervalsRef.current[lineIdx];
    }
    setActiveTimers(prev => ({
      ...prev,
      [lineIdx]: { ...state, isRunning: false }
    }));
  };
  
  const resetTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerIntervalsRef.current[lineIdx]) {
      clearInterval(timerIntervalsRef.current[lineIdx]);
      delete timerIntervalsRef.current[lineIdx];
    }
    setActiveTimers(prev => ({
      ...prev,
      [lineIdx]: { remaining: durationMin * 60, isRunning: false, duration: durationMin * 60 }
    }));
  };
  
  useEffect(() => {
    return () => {
      if (timerIntervalsRef.current[lineIdx]) {
        clearInterval(timerIntervalsRef.current[lineIdx]);
        delete timerIntervalsRef.current[lineIdx];
      }
    };
  }, [lineIdx]);

  useEffect(() => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Bu kanca, kullanıcı not içindeki sayaç süresini değiştirdiğinde (örn: timer 25 -> timer 1)
    // sayacın durumunu yeni süreye senkronize etmek için eklenmiştir.
    setActiveTimers(prev => {
      const t = prev[lineIdx];
      if (t && t.duration !== durationMin * 60) {
        if (timerIntervalsRef.current[lineIdx]) {
          clearInterval(timerIntervalsRef.current[lineIdx]);
          delete timerIntervalsRef.current[lineIdx];
        }
        return {
          ...prev,
          [lineIdx]: { remaining: durationMin * 60, isRunning: false, duration: durationMin * 60 }
        };
      }
      return prev;
    });
  }, [durationMin, lineIdx, setActiveTimers]);
  
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  
  const progressPercent = ((state.duration - state.remaining) / state.duration) * 100;
  
  return (
    <div className="timer-widget-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="timer-progress-ring">
        <svg className="progress-ring-svg" width="46" height="46">
          <circle className="progress-ring-bg" stroke="rgba(255,255,255,0.06)" strokeWidth="3.5" fill="transparent" r="19" cx="23" cy="23" />
          <circle 
            className="progress-ring-bar" 
            stroke="var(--accent-color)" 
            strokeWidth="3.5" 
            fill="transparent" 
            r="19" cx="23" cy="23" 
            strokeDasharray="119.38"
            strokeDashoffset={119.38 - (119.38 * progressPercent) / 100}
            strokeLinecap="round"
          />
        </svg>
        <span className="timer-time-display">{formatTime(state.remaining)}</span>
      </div>
      <div className="timer-controls">
        {state.isRunning ? (
          <button className="timer-ctrl-btn pause" onClick={pauseTimer} onMouseDown={(e) => e.stopPropagation()}><Pause size={10} /></button>
        ) : (
          <button className="timer-ctrl-btn play" onClick={startTimer} onMouseDown={(e) => e.stopPropagation()}><Play size={10} /></button>
        )}
        <button className="timer-ctrl-btn reset" onClick={resetTimer} onMouseDown={(e) => e.stopPropagation()}><RotateCcw size={10} /></button>
      </div>
      <span className="timer-label">⏰ {durationMin} dk Sayaç</span>
    </div>
  );
};

/* ==========================================
   ChartWidget: Dinamik Grafik Görünümü
   Bu bileşen, markdown tablolarındaki verileri alıp saf React + SVG kullanarak
   sütun veya çizgi grafiği halinde render eder (bağımlılık gerektirmez).
   ========================================== */
interface ChartWidgetProps {
  chartType: 'bar' | 'line';
  headers: string[];
  rows: string[][];
}

const ChartWidget: React.FC<ChartWidgetProps> = ({ chartType, headers, rows }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  
  // İlk sütun etiketler, ikinci sütun ise nümerik değerlerdir.
  const labels = rows.map(r => r[0] || '');
  const values = rows.map(r => {
    const val = parseFloat(r[1] || '0');
    return isNaN(val) ? 0 : val;
  });
  
  const maxVal = Math.max(...values, 10);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal;
  
  const width = 320;
  const height = 180;
  const paddingLeft = 35;
  const paddingBottom = 25;
  const paddingRight = 15;
  const paddingTop = 15;
  
  const graphWidth = width - paddingLeft - paddingRight;
  const graphHeight = height - paddingTop - paddingBottom;
  
  const points = values.map((val, idx) => {
    const x = paddingLeft + (idx / Math.max(values.length - 1, 1)) * graphWidth;
    const ratio = range === 0 ? 0.5 : (val - minVal) / range;
    const y = paddingTop + graphHeight - ratio * graphHeight;
    return { x, y, value: val, label: labels[idx] };
  });
  
  return (
    <div className="chart-widget-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="chart-header">
        <div className="chart-title">
          <TrendingUp size={14} className="accent-text" />
          <span>Grafik ({chartType === 'bar' ? 'Sütun Grafiği' : 'Çizgi Grafiği'})</span>
        </div>
      </div>
      <div className="chart-svg-container" style={{ position: 'relative' }}>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {/* Y-Ekseni kılavuz çizgileri */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = paddingTop + graphHeight - ratio * graphHeight;
            const gridVal = minVal + ratio * range;
            return (
              <g key={i}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
                <text x={paddingLeft - 5} y={y + 3} fill="var(--text-muted)" fontSize="8" textAnchor="end">{gridVal.toFixed(0)}</text>
              </g>
            );
          })}
          
          {/* X-Ekseni etiketleri */}
          {labels.map((lbl, idx) => {
            const x = paddingLeft + (idx / Math.max(values.length - 1, 1)) * graphWidth;
            return (
              <text key={idx} x={x} y={height - 8} fill="var(--text-muted)" fontSize="8" textAnchor="middle">
                {lbl.length > 5 ? lbl.substring(0, 4) + '..' : lbl}
              </text>
            );
          })}
          
          {/* Sütun (Bar) Grafiği Çizimi */}
          {chartType === 'bar' && points.map((p, idx) => {
            const barWidth = Math.max((graphWidth / values.length) * 0.6, 6);
            const x = p.x - barWidth / 2;
            const yZero = paddingTop + graphHeight - (range === 0 ? 0.5 : (0 - minVal) / range) * graphHeight;
            const y = Math.min(p.y, yZero);
            const barHeight = Math.max(Math.abs(p.y - yZero), 2);
            const isHovered = hoveredIdx === idx;
            
            return (
              <g key={idx}>
                {/* Etkileşim alanı (Hover kolaylığı için görünmez geniş kutular) */}
                <rect
                  x={p.x - (graphWidth / values.length) / 2}
                  y={paddingTop}
                  width={graphWidth / values.length}
                  height={graphHeight}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    setHoveredIdx(idx);
                    const rect = e.currentTarget.getBoundingClientRect();
                    const parentRect = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                    if (parentRect) {
                      setTooltipPos({
                        x: rect.left - parentRect.left + rect.width / 2,
                        y: rect.top - parentRect.top
                      });
                    }
                  }}
                  onMouseLeave={() => {
                    setHoveredIdx(null);
                    setTooltipPos(null);
                  }}
                />
                
                {/* Görsel Sütun Dikdörtgeni */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="2"
                  fill={isHovered ? 'var(--accent-color)' : 'rgba(99, 102, 241, 0.7)'}
                  style={{ transition: 'fill 0.15s ease, height 0.3s ease' }}
                />
              </g>
            );
          })}
          
          {/* Çizgi (Line) Grafiği Çizimi */}
          {chartType === 'line' && (
            <>
              {/* Çizginin Altındaki Degrade Alanı */}
              {points.length > 1 && (
                <path
                  d={`
                    M ${points[0].x} ${paddingTop + graphHeight}
                    ${points.map(p => `L ${p.x} ${p.y}`).join(' ')}
                    L ${points[points.length - 1].x} ${paddingTop + graphHeight}
                    Z
                  `}
                  fill="url(#chart-area-grad)"
                />
              )}
              
              {/* Ana Çizgi */}
              {points.length > 1 && (
                <path
                  d={points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                  fill="none"
                  stroke="var(--accent-color)"
                  strokeWidth="2"
                />
              )}
              
              {/* Degrade Tanımı */}
              <defs>
                <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-color)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--accent-color)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              
              {/* Çizgi Noktaları */}
              {points.map((p, idx) => {
                const isHovered = hoveredIdx === idx;
                return (
                  <g key={idx}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={isHovered ? 5 : 3}
                      fill="var(--bg-primary)"
                      stroke="var(--accent-color)"
                      strokeWidth="2"
                      style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                      onMouseEnter={(e) => {
                        setHoveredIdx(idx);
                        const rect = e.currentTarget.getBoundingClientRect();
                        const parentRect = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                        if (parentRect) {
                          setTooltipPos({
                            x: rect.left - parentRect.left + rect.width / 2,
                            y: rect.top - parentRect.top
                          });
                        }
                      }}
                      onMouseLeave={() => {
                        setHoveredIdx(null);
                        setTooltipPos(null);
                      }}
                    />
                  </g>
                );
              })}
            </>
          )}
        </svg>
        
        {/* Hover Tooltip Balonu */}
        {tooltipPos && hoveredIdx !== null && (
          <div
            className="chart-tooltip animate-fade-in"
            style={{
              position: 'absolute',
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y}px`
            }}
          >
            <strong>{labels[hoveredIdx]}</strong>: {values[hoveredIdx].toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
};

/* ==========================================
   QueryWidget: Dinamik Not Sorgulama Bileşeni
   Bu bileşen, not içindeki [query: #etiket due:today] gibi aramaları yorumlayarak
   diğer tüm not dosyalarının içinden eşleşen satırları/görevleri canlı olarak listeler.
   ========================================== */
interface QueryWidgetProps {
  queryString: string;
  fileContents: Record<string, string>;
  notes: any[];
  setActiveNotePath: (path: string | null) => void;
}

const QueryWidget: React.FC<QueryWidgetProps> = ({ queryString, fileContents, notes, setActiveNotePath }) => {
  // Arama filtrelerini ayrıştır
  const tags: string[] = [];
  const dueFilters: string[] = [];
  const words: string[] = [];
  
  const tokens = queryString.split(/\s+/);
  tokens.forEach(tok => {
    if (tok.startsWith('#')) {
      tags.push(tok.toLowerCase());
    } else if (tok.startsWith('due:')) {
      dueFilters.push(tok.substring(4).toLowerCase());
    } else {
      words.push(tok.toLowerCase());
    }
  });
  
  // Tüm notları dolaşarak sorguya uyan satırları bul
  const results: Array<{ notePath: string; noteName: string; lineText: string; lineIdx: number }> = [];
  
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  const tom = new Date();
  tom.setDate(now.getDate() + 1);
  const tomStr = `${tom.getFullYear()}-${String(tom.getMonth() + 1).padStart(2, '0')}-${String(tom.getDate()).padStart(2, '0')}`;
  
  Object.entries(fileContents).forEach(([path, content]) => {
    // Şablon dosyalarını arama sonuçlarına dahil etmiyoruz
    const lowerPath = path.toLowerCase();
    const isTemplate = lowerPath.startsWith('templates/') || lowerPath.includes('/templates/') ||
                       lowerPath.startsWith('şablonlar/') || lowerPath.includes('/şablonlar/') ||
                       lowerPath.startsWith('sablonlar/') || lowerPath.includes('/sablonlar/');
    if (isTemplate) return;
    
    const note = notes.find(n => n.path === path);
    const noteName = note ? note.name : path.split('/').pop() || '';
    
    const lines = content.split('\n');
    lines.forEach((lText, lIdx) => {
      const trimmed = lText.trim();
      if (trimmed === '') return;
      if (trimmed.startsWith('[query:')) return; // Sonsuz döngüleri önlemek için sorgu satırını es geç
      
      const lowerLine = trimmed.toLowerCase();
      
      // Etiketleri karşılaştır
      const matchesTags = tags.every(t => lowerLine.includes(t));
      if (!matchesTags) return;
      
      // Anahtar kelimeleri karşılaştır
      const matchesWords = words.every(w => lowerLine.includes(w));
      if (!matchesWords) return;
      
      // Teslim tarihlerini karşılaştır
      let matchesDue = true;
      if (dueFilters.length > 0) {
        const dueMatch = trimmed.match(/\[due:(\d{4}-\d{2}-\d{2})\]/);
        const lineDue = dueMatch ? dueMatch[1] : null;
        
        matchesDue = dueFilters.every(filter => {
          if (filter === 'today' || filter === 'bugün' || filter === 'bugun') {
            return lineDue === todayStr;
          }
          if (filter === 'tomorrow' || filter === 'yarın' || filter === 'yarin') {
            return lineDue === tomStr;
          }
          if (filter === 'overdue' || filter === 'geçmiş' || filter === 'gecmis') {
            const isCompleted = trimmed.toLowerCase().startsWith('- [x]');
            return lineDue && lineDue < todayStr && !isCompleted;
          }
          if (filter === 'none' || filter === 'yok') {
            return !lineDue;
          }
          return lineDue === filter;
        });
      }
      
      if (!matchesDue) return;
      
      results.push({
        notePath: path,
        noteName,
        lineText: trimmed,
        lineIdx: lIdx
      });
    });
  });
  
  return (
    <div className="query-widget-container" style={{
      background: 'rgba(20, 20, 25, 0.45)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '8px',
      padding: '12px',
      margin: '8px 0',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
    }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
        <span style={{ color: 'var(--accent-color)', fontWeight: 'bold', fontSize: '11px' }}>🔍 SORGU SONUÇLARI:</span>
        <code style={{ fontSize: '10px', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px', color: '#fff' }}>{queryString}</code>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>{results.length} Eşleşme</span>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
        {results.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px' }}>
            Eşleşen not veya görev bulunamadı.
          </div>
        ) : (
          results.map((res, rIdx) => {
            const cleanText = res.lineText
              .replace(/^[-*+]\s+\[[ xX]\]\s+/, '') // Görev listesi ön ekini kaldır
              .replace(/^[-*+]\s+/, '')             // Liste işaretini kaldır
              .replace(/\[due:[^\]]+\]/g, '')       // Tarih damgasını temizle
              .replace(/\[p:[^\]]+\]/g, '')         // Öncelik etiketini temizle
              .trim();
              
            return (
              <div 
                key={rIdx} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: '6px 8px', 
                  background: 'rgba(255,255,255,0.01)', 
                  border: '1px solid rgba(255,255,255,0.03)', 
                  borderRadius: '4px',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.01)'}
                onClick={() => setActiveNotePath(res.notePath)}
              >
                <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                  {cleanText}
                </span>
                <span style={{ 
                  fontSize: '9.5px', 
                  background: 'rgba(99, 102, 241, 0.12)', 
                  border: '1px solid rgba(99, 102, 241, 0.25)', 
                  color: 'var(--accent-color)', 
                  padding: '2px 6px', 
                  borderRadius: '4px',
                  maxWidth: '25%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  📁 {res.noteName}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

interface AlarmWidgetProps {
  lineIdx: number;
  alarmTime: string;
  currentTime: string;
  dismissedAlarms: Record<number, boolean>;
  setDismissedAlarms: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  playBeepSound: () => void;
}

const AlarmWidget: React.FC<AlarmWidgetProps> = ({
  lineIdx,
  alarmTime,
  currentTime,
  dismissedAlarms,
  setDismissedAlarms,
  playBeepSound
}) => {
  const isTriggered = currentTime === alarmTime && !dismissedAlarms[lineIdx];
  
  const dismissAlarm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedAlarms(prev => ({ ...prev, [lineIdx]: true }));
  };
  
  useEffect(() => {
    if (isTriggered) {
      const beepInterval = setInterval(() => {
        if (!dismissedAlarms[lineIdx]) {
          playBeepSound();
        }
      }, 1500);
      return () => clearInterval(beepInterval);
    }
  }, [isTriggered, dismissedAlarms, lineIdx]);
  
  return (
    <div className={`alarm-widget-container ${isTriggered ? 'alarm-ringing animate-pulse-glow' : ''}`} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="alarm-header-row">
        <Clock size={13} className={isTriggered ? 'alarm-icon-ringing' : 'alarm-icon'} />
        <span className="alarm-time-text">Alarm: {alarmTime}</span>
        {isTriggered && (
          <button className="alarm-dismiss-btn" onClick={dismissAlarm} onMouseDown={(e) => e.stopPropagation()}>
            <Volume2 size={11} style={{ marginRight: '4px' }} /> Kapat
          </button>
        )}
      </div>
      {isTriggered && <span className="alarm-ringing-text">🔔 SÜRE DOLDU!</span>}
    </div>
  );
};

interface VoiceRecorderWidgetProps {
  lineIdx: number;
  initialPath: string;
  activeNotePath: string;
  onSaveRecording: (path: string, transcript?: string) => void;
  voiceRecordersRef: React.MutableRefObject<Record<number, MediaRecorder>>;
  voiceChunksRef: React.MutableRefObject<Record<number, Blob[]>>;
}

const VoiceRecorderWidget: React.FC<VoiceRecorderWidgetProps> = ({
  lineIdx,
  initialPath,
  activeNotePath,
  onSaveRecording,
  voiceRecordersRef,
  voiceChunksRef
}) => {
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const transcriptRef = useRef('');
  const recognitionRef = useRef<any>(null);
  
  useEffect(() => {
    if (initialPath) {
      setLoading(true);
      platform.readMedia(initialPath).then(dataUrl => {
        let finalUrl = dataUrl;
        if (dataUrl && dataUrl.startsWith('data:')) {
          const parts = dataUrl.split(';base64,');
          if (parts[1]) {
            try {
              const decoded = atob(parts[1]);
              if (decoded.startsWith('data:') && decoded.includes(';base64,')) {
                finalUrl = decoded;
              }
            } catch (e) {
              // Keep original if decoding fails or is not double-encoded
            }
          }
        }
        setAudioUrl(finalUrl);
        setLoading(false);
      }).catch(err => {
        console.error('Error reading voice recording:', err);
        setLoading(false);
      });
    } else {
      setAudioUrl('');
    }
  }, [initialPath]);
  
  const startRecording = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      voiceRecordersRef.current[lineIdx] = mediaRecorder;
      voiceChunksRef.current[lineIdx] = [];
      
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Mikrofon kaydı başladığında konuşmaları eşzamanlı olarak Türkçe metne dönüştürmek için
      // tarayıcının yerel SpeechRecognition API'sini başlatıyoruz.
      setLiveTranscript('');
      transcriptRef.current = '';
      const isDesktopElectron = !!(window && (window as any).electron);
      const SpeechRecognitionClass = !isDesktopElectron 
        ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) 
        : null;
      if (SpeechRecognitionClass) {
        try {
          const recognition = new (SpeechRecognitionClass as any)();
          recognition.lang = 'tr-TR';
          recognition.continuous = true;
          recognition.interimResults = true;
          
          let finalTranscript = '';
          recognition.onresult = (event: any) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript + ' ';
              } else {
                interimTranscript += event.results[i][0].transcript;
              }
            }
            const currentText = (finalTranscript + interimTranscript).trim();
            transcriptRef.current = currentText;
            setLiveTranscript(currentText);
          };
          
          recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
          };
          
          recognition.start();
          recognitionRef.current = recognition;
        } catch (recognitionErr) {
          console.error('Speech recognition failed to start:', recognitionErr);
        }
      }
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current[lineIdx].push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(voiceChunksRef.current[lineIdx], { type: 'audio/webm' });
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Data = reader.result as string;
          const fileName = `media/voice_${Date.now()}.webm`;
          
          setLoading(true);
          await platform.writeNote(fileName, base64Data);
          syncMediaToSupabase(fileName, base64Data);
          onSaveRecording(fileName, transcriptRef.current);
          setLoading(false);
        };
        
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error starting audio recording:', err);
      alert('Mikrofon erişimi reddedildi veya bulunamadı.');
    }
  };
  
  const stopRecording = (e: React.MouseEvent) => {
    e.stopPropagation();
    const recorder = voiceRecordersRef.current[lineIdx];
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setIsRecording(false);
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };
  
  if (loading) {
    return <div className="voice-recorder-widget loading" onMouseDown={(e) => e.stopPropagation()}>🎙️ Ses yükleniyor...</div>;
  }
  
  if (audioUrl) {
    return (
      <div className="voice-recorder-widget player" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="player-meta">
          <Music size={13} className="accent-text" />
          <span>Ses Kaydı: {initialPath.split('/').pop()}</span>
        </div>
        <audio className="custom-audio-element" src={audioUrl} controls style={{ width: '100%', marginTop: '6px' }} onMouseDown={(e) => e.stopPropagation()} />
      </div>
    );
  }
  
  return (
    <div className={`voice-recorder-widget recorder ${isRecording ? 'recording' : ''}`} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      {isRecording ? (
        <button className="recorder-btn stop animate-pulse-glow" onClick={stopRecording} onMouseDown={(e) => e.stopPropagation()}>
          <Square size={10} fill="#ef4444" stroke="none" />
          <span>Kaydı Durdur...</span>
        </button>
      ) : (
        <button className="recorder-btn start" onClick={startRecording} onMouseDown={(e) => e.stopPropagation()}>
          <Mic size={11} />
          <span>🎙️ Ses Kaydet</span>
        </button>
      )}
      {isRecording && liveTranscript && (
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', marginTop: '4px', maxWidth: '100%', lineHeight: '1.4' }}>
          🎙️ Canlı Deşifre: "{liveTranscript}"
        </div>
      )}
    </div>
  );
};

interface VideoRecorderWidgetProps {
  lineIdx: number;
  initialPath: string;
  activeNotePath: string;
  onSaveVideo: (path: string) => void;
}

const VideoRecorderWidget: React.FC<VideoRecorderWidgetProps> = ({
  lineIdx,
  initialPath,
  activeNotePath,
  onSaveVideo
}) => {
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (initialPath) {
      setLoading(true);
      platform.readMedia(initialPath).then(dataUrl => {
        let finalUrl = dataUrl;
        if (dataUrl && dataUrl.startsWith('data:')) {
          // Force video mimetype in case the old main process returns audio/webm
          if (dataUrl.includes('audio/webm')) {
            finalUrl = dataUrl.replace('audio/webm', 'video/webm');
          }
          const parts = finalUrl.split(';base64,');
          if (parts[1]) {
            try {
              const decoded = atob(parts[1]);
              if (decoded.startsWith('data:') && decoded.includes(';base64,')) {
                let decodedUrl = decoded;
                if (decodedUrl.includes('audio/webm')) {
                  decodedUrl = decodedUrl.replace('audio/webm', 'video/webm');
                }
                finalUrl = decodedUrl;
              }
            } catch (e) {}
          }
        }
        setVideoUrl(finalUrl);
        setLoading(false);
      }).catch(err => {
        console.error('Error reading video recording:', err);
        setLoading(false);
      });
    } else {
      setVideoUrl('');
    }
  }, [initialPath]);

  // Connect stream to video element once it is mounted on the DOM using a callback ref
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    videoPreviewRef.current = node;
    if (node && stream) {
      if (node.srcObject !== stream) {
        node.srcObject = stream;
        node.play().catch(err => {
          console.error('Video preview play error:', err);
        });
      }
    }
  }, [stream]);

  const startRecording = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(mediaStream);
      setIsRecording(true);

      const mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const videoBlob = new Blob(chunksRef.current, { type: 'video/webm' });
        
        const reader = new FileReader();
        reader.readAsDataURL(videoBlob);
        reader.onloadend = async () => {
          const base64Data = reader.result as string;
          const fileName = `media/video_${Date.now()}.webm`;
          
          setLoading(true);
          await platform.writeNote(fileName, base64Data);
          syncMediaToSupabase(fileName, base64Data);
          onSaveVideo(fileName);
          setLoading(false);
        };
        
        mediaStream.getTracks().forEach(track => track.stop());
        setStream(null);
      };

      mediaRecorder.start();
    } catch (err) {
      console.error('Error starting video recording:', err);
      alert('Kamera veya mikrofon erişimi reddedildi veya bulunamadı.');
    }
  };

  const stopRecording = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  if (loading) {
    return <div className="video-recorder-widget loading" onMouseDown={(e) => e.stopPropagation()}>📹 Video yükleniyor...</div>;
  }

  if (videoUrl) {
    return (
      <div className="video-recorder-widget player" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ background: 'rgba(20, 20, 25, 0.5)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '12px', display: 'inline-flex', flexDirection: 'column', width: '320px', margin: '6px 0' }}>
        <div className="player-meta" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <Music size={13} className="accent-text" />
          <span>Video Kaydı: {initialPath.split('/').pop()}</span>
        </div>
        <video 
          className="custom-video-element" 
          src={videoUrl} 
          controls 
          style={{ width: '100%', borderRadius: '6px', background: '#000', maxHeight: '220px' }} 
          onMouseDown={(e) => e.stopPropagation()} 
        />
      </div>
    );
  }

  return (
    <div className={`video-recorder-widget recorder ${isRecording ? 'recording' : ''}`} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ background: 'rgba(20, 20, 25, 0.5)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '12px', display: 'inline-flex', flexDirection: 'column', gap: '10px', width: '320px', margin: '6px 0' }}>
      {isRecording && (
        <video 
          ref={videoRef} 
          muted 
          autoPlay
          playsInline
          style={{ width: '100%', borderRadius: '6px', background: '#000', maxHeight: '180px', transform: 'scaleX(-1)' }} 
        />
      )}
      
      {isRecording ? (
        <button 
          className="recorder-btn stop animate-pulse-glow" 
          onClick={stopRecording} 
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px', width: '100%' }}
        >
          <Square size={10} fill="#ef4444" stroke="none" />
          <span>Kaydı Durdur...</span>
        </button>
      ) : (
        <button 
          className="recorder-btn start" 
          onClick={startRecording} 
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.18)', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px', width: '100%' }}
        >
          <Mic size={11} />
          <span>📹 Video Kaydet</span>
        </button>
      )}
    </div>
  );
};

interface SketchpadWidgetProps {
  lineIdx: number;
  initialPath: string;
  activeNotePath: string;
  onSaveSketch: (path: string) => void;
}

const SketchpadWidget: React.FC<SketchpadWidgetProps> = ({
  lineIdx,
  initialPath,
  activeNotePath,
  onSaveSketch
}) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPaintingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [lineWidth, setLineWidth] = useState(3);
  
  useEffect(() => {
    if (initialPath) {
      setLoading(true);
      platform.readMedia(initialPath).then(dataUrl => {
        let finalUrl = dataUrl;
        if (dataUrl && dataUrl.startsWith('data:')) {
          const parts = dataUrl.split(';base64,');
          if (parts[1]) {
            try {
              const decoded = atob(parts[1]);
              if (decoded.startsWith('data:') && decoded.includes(';base64,')) {
                finalUrl = decoded;
              }
            } catch (e) {
              // Keep original if decoding fails or is not double-encoded
            }
          }
        }
        setImageUrl(finalUrl);
        setLoading(false);
      }).catch(err => {
        console.error('Error reading sketch:', err);
        setLoading(false);
      });
    } else {
      setImageUrl('');
    }
  }, [initialPath]);
  
  useEffect(() => {
    if (isDrawing && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = lineWidth;
        ctx.fillStyle = '#141419';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [isDrawing]);
  
  const startPaint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    isPaintingRef.current = true;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    lastXRef.current = (e.clientX - rect.left) * scaleX;
    lastYRef.current = (e.clientY - rect.top) * scaleY;
  };
  
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (!isPaintingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;
    
    ctx.beginPath();
    ctx.moveTo(lastXRef.current, lastYRef.current);
    ctx.lineTo(currentX, currentY);
    
    if (tool === 'eraser') {
      ctx.strokeStyle = '#141419';
      ctx.lineWidth = 20;
    } else {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = lineWidth;
    }
    ctx.stroke();
    
    lastXRef.current = currentX;
    lastYRef.current = currentY;
  };
  
  const stopPaint = (e: React.MouseEvent) => {
    e.stopPropagation();
    isPaintingRef.current = false;
  };
  
  const clearCanvas = (e: React.MouseEvent) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#141419';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  
  const saveDrawing = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const dataUrl = canvas.toDataURL('image/png');
    const fileName = `media/sketch_${Date.now()}.png`;
    
    setLoading(true);
    await platform.writeNote(fileName, dataUrl);
    syncMediaToSupabase(fileName, dataUrl);
    onSaveSketch(fileName);
    setIsDrawing(false);
    setLoading(false);
  };
  
  if (loading) {
    return <div className="nfactory-sketchpad-widget loading" onMouseDown={(e) => e.stopPropagation()}>🎨 Çizim paneli yükleniyor...</div>;
  }
  
  if (imageUrl && !isDrawing) {
    return (
      <div className="nfactory-sketchpad-widget viewer" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <img className="nfactory-sketch-rendered-img" src={imageUrl} alt="Sketch Drawing" style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'block' }} onMouseDown={(e) => e.stopPropagation()} />
        <button className="nfactory-sketch-edit-btn" onClick={(e) => { e.stopPropagation(); setIsDrawing(true); }} onMouseDown={(e) => e.stopPropagation()}>
          🎨 Çizimi Düzenle
        </button>
      </div>
    );
  }
  
  return (
    <div className="nfactory-sketchpad-widget editor" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="nfactory-sketchpad-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <button className={`nfactory-toolbar-btn ${tool === 'pen' ? 'active' : ''}`} onClick={() => setTool('pen')} onMouseDown={(e) => e.stopPropagation()}>🖊️ Kalem</button>
        <button className={`nfactory-toolbar-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')} onMouseDown={(e) => e.stopPropagation()}>🧽 Silgi</button>
        <input className="pen-width-slider" type="range" min="1" max="15" value={lineWidth} onChange={(e) => setLineWidth(parseInt(e.target.value))} onMouseDown={(e) => e.stopPropagation()} />
        <button className="nfactory-toolbar-btn clear" onClick={clearCanvas} onMouseDown={(e) => e.stopPropagation()}>Temizle</button>
        <button className="nfactory-toolbar-btn save" onClick={saveDrawing} onMouseDown={(e) => e.stopPropagation()}>💾 Kaydet</button>
        <button className="nfactory-toolbar-btn cancel" onClick={() => setIsDrawing(false)} onMouseDown={(e) => e.stopPropagation()}>İptal</button>
      </div>
      <canvas 
        ref={canvasRef}
        className="nfactory-sketch-canvas"
        width="400"
        height="220"
        onMouseDown={startPaint}
        onMouseMove={draw}
        onMouseUp={stopPaint}
        onMouseLeave={stopPaint}
        style={{
          background: '#141419',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          cursor: tool === 'pen' ? 'crosshair' : 'cell',
          touchAction: 'none'
        }}
      />
    </div>
  );
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Şu anda odakta olan satırın (focusedIdx) bir kod bloğu (``` ile başlayan ve biten) aralığında olup olmadığını bulur.
// Eğer kullanıcı bir kod bloğu içinde ise, o bloğun satır aralığını { start, end } olarak döner.
const getActiveCodeBlockRange = (lines: string[], focusedIdx: number | null): { start: number, end: number } | null => {
  if (focusedIdx === null) return null;
  
  let inBlock = false;
  let blockStart = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const isDelim = lines[i].trim().startsWith('```');
    if (isDelim) {
      if (inBlock) {
        const blockEnd = i;
        if (focusedIdx >= blockStart && focusedIdx <= blockEnd) {
          return { start: blockStart, end: blockEnd };
        }
        inBlock = false;
        blockStart = -1;
      } else {
        inBlock = true;
        blockStart = i;
      }
    }
  }
  
  if (inBlock && focusedIdx >= blockStart) {
    return { start: blockStart, end: lines.length - 1 };
  }
  
  return null;
};



// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Blok Gönderme (Block Transclusion) özelliğinde, hedef notun içinden sadece istenilen başlık altındaki bölümü kesip almak için kullanılan yardımcı fonksiyon.
const extractSectionContent = (content: string, headerName: string): string => {
  const lines = content.split('\n');
  let startIdx = -1;
  let targetLevel = -1;
  const cleanHeader = headerName.trim().toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#')) {
      const match = line.match(/^(#+)\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const title = match[2].trim().toLowerCase();
        if (title === cleanHeader) {
          startIdx = i;
          targetLevel = level;
          break;
        }
      }
    }
  }

  if (startIdx === -1) return '';

  const sectionLines: string[] = [];
  sectionLines.push(lines[startIdx]);

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^(#+)\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        if (level <= targetLevel) {
          break;
        }
      }
    }
    sectionLines.push(line);
  }

  return sectionLines.join('\n');
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Not içindeki ```mermaid kod bloklarını yakalayıp, Mermaid.js kütüphanesini dinamik olarak yükleyerek SVG formatında şık diyagramlar çizen görsel bileşen.
const MermaidViewer: React.FC<{ code: string }> = ({ code }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const containerId = useRef(`mermaid-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    let active = true;
    const renderDiagram = async () => {
      try {
        if (!(window as any).mermaid) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Mermaid kütüphanesi yüklenemedi.'));
            document.head.appendChild(script);
          });
        }

        const mermaid = (window as any).mermaid;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose'
        });

        const cleanCode = code.trim();
        if (!cleanCode) return;

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Kullanıcı yazmaya devam ederken geçersiz kod durumunda çökmesini engellemek için önce parse kontrolü yapıyoruz.
        try {
          await mermaid.parse(cleanCode);
        } catch (parseError) {
          if (active) {
            setError('Diyagram kodu yazılıyor... (Lütfen geçerli bir Mermaid şeması kodu girin)');
          }
          return;
        }

        const { svg: renderedSvg } = await mermaid.render(containerId.current, cleanCode);
        if (active) {
          setSvg(renderedSvg);
          setError('');
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || 'Mermaid şeması çizilirken hata oluştu.');
        }
      }
    };

    renderDiagram();
    return () => {
      active = false;
    };
  }, [code]);

  if (error) {
    return (
      <div style={{ color: '#ff4a5a', padding: '12px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '6px' }}>
        ⚠ Mermaid Şema Hatası: {error}
      </div>
    );
  }

  if (!svg) {
    return <div style={{ color: 'var(--text-muted)', padding: '12px', fontSize: '12px' }}>Mermaid şeması çiziliyor...</div>;
  }

  return (
    <div 
      className="mermaid-svg-container"
      style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        padding: '16px', 
        background: '#0d0e12', 
        border: '1px solid rgba(255,255,255,0.06)', 
        borderRadius: '6px',
        overflowX: 'auto'
      }} 
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// PERFORMANS: renderSingleLine() ~1500 satırlık, notun HER satırı için her
// render'da (yani her tuş vuruşunda) yeniden çalışan devasa bir fonksiyondu —
// büyük notlarda yazma deneyimini yavaşlatan asıl mimari darboğaz buydu.
// İçini yeniden yazmak (1500 satır, onlarca iç içe özel duruma sahip) çok
// yüksek riskli olacağından, çağrı noktasını dokunmadan React.memo ile
// sarıyoruz: bu bileşen yalnızca "cacheKey" değiştiğinde gerçekten yeniden
// render olur (özel karşılaştırma fonksiyonu sayesinde `renderFn`'in her
// seferinde yeni bir closure olması önemsizleşir). Böylece bir satırı
// düzenlerken, DEĞİŞMEYEN yüzlerce/binlerce diğer satır React tarafından
// atlanır — renderSingleLine'ın gövdesi onlar için hiç çalışmaz.
const EditorLine = React.memo(
  function EditorLine({ renderFn }: { cacheKey: string; renderFn: () => React.ReactNode }) {
    return <>{renderFn()}</>;
  },
  (prevProps, nextProps) => prevProps.cacheKey === nextProps.cacheKey
);

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// SANALLAŞTIRMA (Virtualization): Obsidian/Notion hızının asıl sırrı, notun
// TAMAMINI değil yalnızca ekranda görünen (ve yakınındaki) satırları gerçek
// DOM'a koymalarıdır. VirtBlock, bir satır bloğunu (tek satır, tablo veya
// sütun grubu) sarar: blok görünür alandaysa (IntersectionObserver, ±1200px
// ön-yükleme payıyla) gerçek içeriğini render eder; değilse yalnızca ölçülmüş
// (veya tahmini) yüksekliğe sahip boş bir yer tutucu div bırakır. Böylece
// 1000 satırlık bir not açıldığında yalnızca ~40-60 satırın pahalı render'ı
// çalışır; kaydırdıkça bloklar görünür alana yaklaşırken sessizce mount edilir.
type VirtBlockProps = {
  forced: boolean;
  initialVisible: boolean;
  estHeight: number;
  cacheKey: string;
  heightCache: Map<string, number>;
  getObserver: () => IntersectionObserver;
  registry: Map<Element, (visible: boolean, height: number) => void>;
  children: () => React.ReactNode;
};

const VirtBlock = ({ forced, initialVisible, estHeight, cacheKey, heightCache, getObserver, registry, children }: VirtBlockProps) => {
  const [visible, setVisible] = useState(initialVisible);
  const elRef = useRef<HTMLDivElement | null>(null);
  // Observer callback'inin her zaman güncel duruma erişebilmesi için ref'te tutulur.
  const stateRef = useRef({ visible, cacheKey });
  stateRef.current = { visible, cacheKey };

  const refCb = useCallback((el: HTMLDivElement | null) => {
    const prev = elRef.current;
    if (prev && prev !== el) {
      try { getObserver().unobserve(prev); } catch { /* yoksay */ }
      registry.delete(prev);
    }
    elRef.current = el;
    if (el) {
      registry.set(el, (v, h) => {
        const s = stateRef.current;
        // Görünür alandan çıkarken gerçek yüksekliği önbelleğe al — yer tutucu
        // bu değeri kullanır, böylece kaydırma çubuğu zıplamaz.
        if (!v && s.visible && h > 0) heightCache.set(s.cacheKey, h);
        setVisible(prevV => (prevV === v ? prevV : v));
      });
      getObserver().observe(el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // İlk mount'ta, IntersectionObserver'ın asenkron ilk raporunu beklemeden
  // (bir karelik boşluk titremesini önlemek için) senkron geometri kontrolü.
  useLayoutEffect(() => {
    if (stateRef.current.visible) return;
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    if (r.bottom > -1200 && r.top < vh + 1200) setVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // flexShrink: 0 şart — .live-editor-lines bir flex sütunu olduğundan,
  // sabit yükseklikli boş yer tutucular aksi halde 0'a ezilir.
  if (forced || visible) {
    return <div ref={refCb} className="virt-block" style={{ flexShrink: 0 }}>{children()}</div>;
  }
  return (
    <div
      ref={refCb}
      className="virt-block virt-block-spacer"
      style={{ height: Math.max(8, heightCache.get(cacheKey) ?? estHeight), flexShrink: 0 }}
    />
  );
};

export default function NotesView({
  selectedFolder,
  selectedTag,
  fileContents,
  notes,
  activeNotePath,
  setActiveNotePath,
  onSaveNote,
  onDeletePath,
  onCreateNote,
  templatesFolder,
  mindmapLayouts,
  onSaveMindmapLayout,
  readNoteContent,
  onRenameNote,
  onNoteContextMenu,
  onSearchWeb,
  folderCustomizations = {},
  hideSidebar = false,
  onSplitWorkspace,
  onClosePane,
  onShowProperties,
  pinnedWidgetLists = [],
  pinnedWidgetList = null,
  onUpdatePinnedWidgets,
  isFlowEffectsEnabled = true,
  lineHeight = 1.6,
  lineMargin = 8
}: NotesViewProps) {
  const [editorContent, setEditorContent] = useState<string>(() => {
    if (activeNotePath) {
      return localStorage.getItem(`active_note_draft_${activeNotePath}`) || '';
    }
    return '';
  });
  const [newNoteName, setNewNoteName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creatingType, setCreatingType] = useState<'note' | 'excalidraw' | 'rfc' | 'drawio'>('note');
  
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Seçilen şablonun dosya yolunu ve mevcut şablon listesini filtreleyen state/memo.
  const [selectedTemplatePath, setSelectedTemplatePath] = useState<string>('default-rfc');
  const creatorTemplates = useMemo(() => {
    const prefix = templatesFolder + '/';
    return notes.filter(n => n.type === 'note' && n.path.startsWith(prefix));
  }, [notes, templatesFolder]);
  const [syncStatus, setSyncStatus] = useState<'saved' | 'saving'>('saved');
  const [expandedTaskIdx, setExpandedTaskIdx] = useState<number | null>(null);
  const [isPropertiesExpanded, setIsPropertiesExpanded] = useState(isElectron);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Zen Focus modu ve Daktilo modu için gerekli state ve ref tanımlamalarını yapıyoruz.
  const [isZenMode, setIsZenMode] = useState(false);
  const [isTypewriterMode, setIsTypewriterMode] = useState(false);
  const [isMindmapMode, setIsMindmapMode] = useState(false);

  const isZenModeRef = useRef(isZenMode);
  const isTypewriterModeRef = useRef(isTypewriterMode);
  
  useEffect(() => {
    isZenModeRef.current = isZenMode;
    isTypewriterModeRef.current = isTypewriterMode;
  }, [isZenMode, isTypewriterMode]);

  useEffect(() => {
    document.body.classList.toggle('zen-mode', isZenMode);
    return () => {
      document.body.classList.remove('zen-mode');
    };
  }, [isZenMode]);

  // Mobilde klasör değişince not listesini göster
  useEffect(() => {
    if (window.innerWidth <= 768) {
      setActiveNotePath(null);
    }
  }, [selectedFolder]);

  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuLineIdx, setSlashMenuLineIdx] = useState<number | null>(null);
  const [slashMenuFilter, setSlashMenuFilter] = useState('');
  const [activeSlashOptionIdx, setActiveSlashOptionIdx] = useState(0);
  const [flowEditModes, setFlowEditModes] = useState<Record<number, boolean>>({});
  
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Blok gömme (Block Transclusion) sihirbazında seçilen not, arama filtresi ve satır bilgilerini tutan durum değişkenleri.
  // Sürüm Geçmişi (Version History) modalının durumu: notun önceki içerik
  // anlık görüntülerini listeler ve seçilen bir sürümü geri yükleme imkanı sağlar.
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [versionHistory, setVersionHistory] = useState<{ timestamp: number; content: string }[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<{ timestamp: number; content: string } | null>(null);

  const [isTransclusionModalOpen, setIsTransclusionModalOpen] = useState(false);
  const [transclusionSearch, setTransclusionSearch] = useState('');
  const [selectedTransclusionNote, setSelectedTransclusionNote] = useState<any | null>(null);
  const [transclusionLineIdx, setTransclusionLineIdx] = useState<number | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptLocation, setReceiptLocation] = useState('');
  // Fiş modalı için taksit seçeneğini saklayan durum (varsayılan: 1 yani tek çekim)
  const [receiptInstallment, setReceiptInstallment] = useState('1');
  const [receiptItemPrices, setReceiptItemPrices] = useState<Record<number, string>>({});

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // notes prop'u içinden Templates/ veya Şablonlar/ klasöründe bulunan şablon dosyalarını ayıklıyoruz.
  // Bu dosyalar / menüsünde dinamik şablon olarak listelenecektir.
  const templateNotes = useMemo(() => {
    return notes.filter(n => 
      n.type === 'note' && 
      (
        n.path.toLowerCase().startsWith('templates/') || 
        n.path.toLowerCase().includes('/templates/') ||
        n.path.toLowerCase().startsWith('şablonlar/') || 
        n.path.toLowerCase().includes('/şablonlar/') ||
        n.path.toLowerCase().startsWith('sablonlar/') || 
        n.path.toLowerCase().includes('/sablonlar/')
      )
    );
  }, [notes]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Slash (/) komut menüsü seçeneklerini dinamik hale getiriyoruz. Özel şablon dosyalarını
  // (Templates/) bu listeye ekleyerek kullanıcının not içine hızlıca uygulayabilmesini sağlıyoruz.
  const slashOptions = useMemo(() => {
    const baseOptions = [
      { id: 'todo', label: 'To-do List', icon: CheckSquare, desc: 'Görev listesi ekler' },
      { id: 'bullet', label: 'Bullet List', icon: List, desc: 'Madde işaretli liste ekler' },
      { id: 'numbered', label: 'Numbered List', icon: ListOrdered, desc: 'Numaralı liste ekler' },
      { id: 'h1', label: 'Heading 1', icon: Heading1, desc: 'En büyük başlığı ekler' },
      { id: 'h2', label: 'Heading 2', icon: Heading2, desc: 'Orta büyüklükte başlık ekler' },
      { id: 'h3', label: 'Heading 3', icon: Heading3, desc: 'En küçük başlığı ekler' },
      { id: 'quote', label: 'Quote', icon: Quote, desc: 'Alıntı bloğu ekler' },
      { id: 'divider', label: 'Divider', icon: Minus, desc: 'Yatay ayırıcı çizgi ekler' },
      { id: 'code', label: 'Code Block', icon: Code, desc: 'Kod bloğu ekler' },
      { id: 'callout', label: 'Callout', icon: Info, desc: 'Açıklama/uyarı paneli ekler' },
      { id: 'link-note', label: 'Link to Note', icon: FileText, desc: 'Başka bir nota bağlantı verir' },
      { id: 'web-link', label: 'Web Link', icon: Globe, desc: 'İnternet adresi bağlantısı ekler' },
      { id: 'image', label: 'Image', icon: Image, desc: 'Resim veya görsel bağlantısı ekler' },
      { id: 'flow', label: 'Flow', icon: Infinity, desc: 'Başka bir notu buraya canlı gömer (Flow)' },
      { id: 'embed', label: 'Embed Existing Context', icon: Columns, desc: 'Mevcut notu içine yerleştirir' },
      { id: 'table', label: 'New Table', icon: Table, desc: 'Etkileşimli Excel tablosu ekler' },
      { id: 'board', label: 'New Board', icon: Columns, desc: 'Kanban Pano görünümü ekler' },
      { id: 'harcama', label: 'Harcama Ekle', icon: DollarSign, desc: 'Satıra harcama tutarı ekler' },
      { id: 'gelir', label: 'Gelir Ekle', icon: TrendingUp, desc: 'Satıra gelir tutarı ekler' },
      { id: 'yatirim', label: 'Yatırım Ekle', icon: Sparkles, desc: 'Satıra yatırım tutarı ekler' },
      { id: 'tasarruf', label: 'Tasarruf Ekle', icon: PiggyBank, desc: 'Satıra tasarruf tutarı ekler' },
      { id: 'tag', label: 'Tag', icon: Tag, desc: 'Etiket işareti (#) ekler' },
      { id: 'drawing', label: 'Embedded Drawing', icon: Palette, desc: 'Gömülü etkileşimli çizim ekler (draw.io / Excalidraw)' },
      { id: 'habit', label: 'Alışkanlık Zinciri', icon: Activity, desc: 'Aylık alışkanlık takip zinciri ekler (örn: [habit: Kitap Okuma])' },
      { id: 'voice', label: 'Ses Kaydet (Mikrofon)', icon: Mic, desc: 'Satıra yeni bir ses kaydı paneli yerleştirir' },
      { id: 'video', label: 'Video Kaydet (Kamera)', icon: Video, desc: 'Satıra yeni bir video kaydı paneli yerleştirir' },
      { id: 'toc', label: 'İçindekiler Tablosu (TOC)', icon: BookOpen, desc: 'Not başlıklarından otomatik İçindekiler Tablosu üretir' },
      { id: 'query', label: 'Dinamik Sorgu Widget\'ı', icon: Database, desc: 'Notlar arasında dinamik sorgu yapar (örn: [query: due:today])' },
      { id: 'chart', label: 'Dinamik Grafik (Chart)', icon: TrendingUp, desc: 'Dinamik çizgi veya bar grafiği ekler (örn: [chart: bar])' },
      { id: 'youtube', label: 'YouTube Video Göm', icon: Play, desc: 'Yazılan satıra etkileşimli YouTube video oynatıcı yerleştirir' },
      { id: 'kolon2', label: '2 Kolonlu Bölüm', icon: Columns, desc: 'Yan yana 2 kolonlu not alanı oluşturur' },
      { id: 'kolon3', label: '3 Kolonlu Bölüm', icon: Columns, desc: 'Yan yana 3 kolonlu not alanı oluşturur' },
      { id: 'row', label: 'Yeni Grid Satırı', icon: List, desc: '<<<row>>> satır ayırıcı ekler' },
      { id: 'col', label: 'Yeni Grid Sütunu', icon: Columns, desc: '<<<col>>> sütun ayırıcı ekler' }
    ];

    const templateOptions = templateNotes.map(note => ({
      id: `template:${note.path}`,
      label: `Şablon: ${note.name}`,
      icon: Sparkles,
      desc: `"${note.name}" şablonunu buraya uygular`
    }));

    return [...baseOptions, ...templateOptions];
  }, [templateNotes]);

  const smartSuggestions = useMemo(() => {
    const stopWords = new Set([
      'bir', 've', 'veya', 'ile', 'da', 'de', 'icin', 'için', 'olan', 'bu', 'su', 'şu', 'o', 'ne', 'kadar', 'gibi', 'mi', 'mu', 'mü', 'mi', 'sonra', 'once', 'önce', 'daha', 'cok', 'çok', 'en', 'her', 'hiç', 'hic', 'ama', 'fakat', 'ancak', 'lakin', 'yani', 'ise', 
      'the', 'and', 'for', 'with', 'that', 'this', 'your', 'from', 'about', 'with', 'here', 'there', 'they', 'them', 'these', 'those'
    ]);

    if (!activeNotePath || !notes || notes.length <= 1) return [];
    const activeContent = fileContents[activeNotePath] || '';
    if (!activeContent.trim()) return [];

    const activeNoteNameClean = notes.find(n => n.path === activeNotePath)?.name.replace(/\.md$/, '').toLowerCase() || '';

    const activeWords = new Set(
      activeContent.toLowerCase()
        .split(/[^a-z0-9ğüşıöç]/)
        .filter(w => w.length > 4 && !stopWords.has(w))
    );

    const suggestions: { note: any; score: number }[] = [];

    notes.forEach(note => {
      if (note.path === activeNotePath) return;

      const otherNoteNameClean = note.name.replace(/\.md$/, '').toLowerCase();
      
      if (activeContent.toLowerCase().includes(otherNoteNameClean) && otherNoteNameClean.length > 2) {
        suggestions.push({ note, score: 10 });
        return;
      }

      const otherContent = fileContents[note.path] || '';
      if (!otherContent.trim()) return;

      const otherWords = new Set(
        otherContent.toLowerCase()
          .split(/[^a-z0-9ğüşıöç]/)
          .filter(w => w.length > 4 && !stopWords.has(w))
      );

      let overlapCount = 0;
      activeWords.forEach(w => {
        if (otherWords.has(w)) overlapCount++;
      });

      if (overlapCount >= 2) {
        suggestions.push({ note, score: overlapCount });
      }
    });

    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(s => s.note);
  }, [activeNotePath, fileContents, notes]);

  // Backlink'ler: [[Not Adı]] sözdizimiyle aktif nota referans veren diğer
  // notları bulur (GraphView'daki çözümleme mantığıyla aynı).
  const backlinks = useMemo(() => {
    if (!activeNotePath || !notes || notes.length === 0) return [];

    const activeNote = notes.find(n => n.path === activeNotePath);
    if (!activeNote) return [];

    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const results: { note: any; snippet: string }[] = [];

    notes.forEach(note => {
      if (note.path === activeNotePath) return;
      const content = fileContents[note.path] || '';
      if (!content.includes('[[')) return;

      linkRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(content)) !== null) {
        const linkTarget = match[1].trim().toLowerCase();
        const nameLower = activeNote.name.toLowerCase();
        const pathLower = activeNote.path.toLowerCase().replace('.md', '').replace('.excalidraw', '');
        const isMatch = nameLower === linkTarget || pathLower === linkTarget || pathLower.endsWith('/' + linkTarget);

        if (isMatch) {
          // Bağlantının geçtiği satırı kısa bir önizleme olarak al
          const lineStart = content.lastIndexOf('\n', match.index) + 1;
          const lineEnd = content.indexOf('\n', match.index);
          const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd).trim();
          results.push({ note, snippet: line.length > 120 ? line.slice(0, 120) + '…' : line });
          break; // Aynı not için tek bir referans yeterli
        }
      }
    });

    return results;
  }, [activeNotePath, fileContents, notes]);

  // Sürüm Geçmişini Aç: notun kaydedilmiş önceki içerik anlık görüntülerini
  // `.versions/<notPath>.json` dosyasından okuyup en yeniden en eskiye sıralar.
  const openVersionHistory = async () => {
    if (!activeNotePath) return;
    setIsLoadingHistory(true);
    setPreviewVersion(null);
    try {
      const raw = await readNoteContent(`.versions/${activeNotePath}.json`);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      setVersionHistory([...list].sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
      setVersionHistory([]);
    } finally {
      setIsLoadingHistory(false);
      setIsHistoryModalOpen(true);
    }
  };

  // Seçilen sürümü geri yükler: editör içeriğini anında günceller ve kalıcı
  // olarak kaydeder (bu kayıt işlemi, geri yüklemeden önceki hâli de otomatik
  // olarak yeni bir sürüm anlık görüntüsü olarak saklar).
  const handleRestoreVersion = async (version: { timestamp: number; content: string }) => {
    if (!activeNotePath) return;
    setEditorContent(version.content);
    previousContentRef.current = version.content;
    localStorage.removeItem(`active_note_draft_${activeNotePath}`);
    await onSaveNote(activeNotePath, version.content);
    setIsHistoryModalOpen(false);
    setPreviewVersion(null);
  };

  const handleInsertSmartLink = (noteName: string) => {
    const linesArr = editorContent.split('\n');
    const targetIdx = focusedLineIdx !== null ? focusedLineIdx : linesArr.length - 1;
    const currentLine = linesArr[targetIdx] || '';
    const divider = currentLine.trim() === '' ? '' : ' ';
    linesArr[targetIdx] = currentLine + divider + `[[${noteName.replace(/\.md$/, '')}]]`;
    setEditorContent(linesArr.join('\n'));
    setCaretPos({ lineIdx: targetIdx, charIdx: linesArr[targetIdx].length });
  };

  const executeSlashCommand = (opt: any, lineIdx: number) => {
    const currentLine = lines[lineIdx];
    const caret = caretPos ? caretPos.charIdx : currentLine.length;
    const beforeCaret = currentLine.substring(0, caret);
    const lastSlashIdx = beforeCaret.lastIndexOf('/');
    
    if (lastSlashIdx !== -1) {
      const prefixText = currentLine.substring(0, lastSlashIdx);
      const afterCaret = currentLine.substring(caret);
      
      let newLineText = '';
      if (opt.id.startsWith('template:')) {
        const templatePath = opt.id.substring(9);
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Kullanıcı slash menüden özel bir şablon seçtiğinde içeriğini yükleyip
        // {{date}} gibi tarih değişkenlerini çözdükten sonra araya yerleştiriyoruz.
        readNoteContent(templatePath).then(templateContent => {
          const now = new Date();
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const dateStr = `${yyyy}-${mm}-${dd}`;
          
          const parsed = templateContent
            .replace(/\{\{date\}\}/g, dateStr)
            .replace(/\{\{bugün\}\}/g, dateStr)
            .replace(/\{\{bugun\}\}/g, dateStr);
            
          const linesArr = [...lines];
          const templateLines = parsed.split('\n');
          linesArr.splice(lineIdx, 1, ...templateLines);
          setEditorContent(linesArr.join('\n'));
        }).catch(err => {
          console.error("Şablon yükleme hatası:", err);
        });
        setShowSlashMenu(false);
        return;
      }
      
      if (opt.id === 'todo') {
        newLineText = prefixText + '- [ ] ' + afterCaret;
      } else if (opt.id === 'bullet') {
        newLineText = prefixText + '- ' + afterCaret;
      } else if (opt.id === 'numbered') {
        newLineText = prefixText + '1. ' + afterCaret;
      } else if (opt.id === 'h1') {
        newLineText = prefixText + '# ' + afterCaret;
      } else if (opt.id === 'h2') {
        newLineText = prefixText + '## ' + afterCaret;
      } else if (opt.id === 'h3') {
        newLineText = prefixText + '### ' + afterCaret;
      } else if (opt.id === 'quote') {
        newLineText = prefixText + '> ' + afterCaret;
      } else if (opt.id === 'divider') {
        newLineText = prefixText + '---\n' + afterCaret;
      } else if (opt.id === 'code') {
        newLineText = prefixText + '```\n\n```' + afterCaret;
      } else if (opt.id === 'callout') {
        newLineText = prefixText + '> [!NOTE]\n> ' + afterCaret;
      } else if (opt.id === 'link-note') {
        newLineText = prefixText + '[[' + afterCaret;
      } else if (opt.id === 'web-link') {
        newLineText = prefixText + '[]()' + afterCaret;
      } else if (opt.id === 'image') {
        newLineText = prefixText + '![caption]()' + afterCaret;
      } else if (opt.id === 'flow' || opt.id === 'embed') {
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Kullanıcı slash menüden Blok Gömme seçtiğinde otomatik metin eklemek yerine görsel seçim sihirbazını (modal) açar.
        setTransclusionLineIdx(lineIdx);
        setTransclusionSearch('');
        setSelectedTransclusionNote(null);
        setIsTransclusionModalOpen(true);
        setShowSlashMenu(false);
        return;
      } else if (opt.id === 'table') {
        newLineText = prefixText + 'tablo: Kolon 1, Kolon 2\n- Hücre 1 Sütun 1, Hücre 1 Sütun 2' + afterCaret;
      } else if (opt.id === 'board') {
        newLineText = prefixText + 'pano: Yapılacak, Yapılıyor, Tamamlandı\n- Yapılacak: Yeni Kart 1\n- Yapılıyor: Kart 2' + afterCaret;
      } else if (opt.id === 'harcama') {
        newLineText = prefixText + '[harcama: 100]' + afterCaret;
      } else if (opt.id === 'gelir') {
        newLineText = prefixText + '[gelir: 1000]' + afterCaret;
      } else if (opt.id === 'yatirim') {
        newLineText = prefixText + '[yatırım: 1000]' + afterCaret;
      } else if (opt.id === 'tasarruf') {
        newLineText = prefixText + '[tasarruf: 100]' + afterCaret;
      } else if (opt.id === 'tag') {
        newLineText = prefixText + '#' + afterCaret;
      } else if (opt.id === 'habit') {
        newLineText = prefixText + '[habit: Yeni Alışkanlık] [stats:---]' + afterCaret;
      } else if (opt.id === 'voice') {
        newLineText = prefixText + 'record' + afterCaret;
      } else if (opt.id === 'video') {
        newLineText = prefixText + 'video' + afterCaret;
      } else if (opt.id === 'toc') {
        newLineText = prefixText + '[toc]' + afterCaret;
      } else if (opt.id === 'query') {
        newLineText = prefixText + '[query: due:today]' + afterCaret;
      } else if (opt.id === 'chart') {
        newLineText = prefixText + '[chart: bar]' + afterCaret;
      } else if (opt.id === 'youtube') {
        newLineText = prefixText + 'https://www.youtube.com/watch?v=' + afterCaret;
      } else if (opt.id === 'kolon2') {
        newLineText = prefixText + '<<<row>>>\n<<<col>>>\nSol Kolon Metni...\n<<<col>>>\nSağ Kolon Metni...\n<<<row-end>>>' + afterCaret;
      } else if (opt.id === 'kolon3') {
        newLineText = prefixText + '<<<row>>>\n<<<col>>>\nSol Kolon Metni...\n<<<col>>>\nOrta Kolon Metni...\n<<<col>>>\nSağ Kolon Metni...\n<<<row-end>>>' + afterCaret;
      } else if (opt.id === 'row') {
        newLineText = prefixText + '<<<row>>>\n' + afterCaret;
      } else if (opt.id === 'col') {
        newLineText = prefixText + '<<<col>>>\n' + afterCaret;
      } else if (opt.id === 'drawing') {
        const timestamp = Date.now();
        const drawingName = `cizim_${timestamp}`;
        
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Çizimin oluşturulacağı hedef klasörü aktif notun klasörü olarak belirliyoruz.
        // Böylece çizimler gelişi güzel farklı klasörlere (örn. Projeler) gitmemiş olur.
        const activeNoteFolder = activeNotePath ? activeNotePath.split('/').slice(0, -1).join('/') : null;
        const targetFolder = activeNoteFolder || selectedFolder;

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // name olarak doğrudan uzantısız 'cizim_timestamp' ismini geçiyoruz çünkü onCreateNote
        // bu uzantıyı (.excalidraw) kendisi otomatik ekliyor. Markdown'a ise ![[cizim_timestamp]] ekliyoruz.
        onCreateNote(drawingName, targetFolder, true, '{}', false).then(() => {
          const linesArr = [...lines];
          linesArr[lineIdx] = prefixText + `![[${drawingName}]]` + afterCaret;
          setEditorContent(linesArr.join('\n'));
        }).catch(err => {
          console.error("Gömülü çizim dosyası oluşturulurken hata:", err);
        });
        
        setShowSlashMenu(false);
        return;
      } else {
        newLineText = prefixText + afterCaret;
      }
      
      const newLines = [...lines];
      newLines[lineIdx] = newLineText;
      setEditorContent(newLines.join('\n'));
      
      let newCaret = lastSlashIdx;
      if (['todo', 'bullet', 'numbered', 'h1', 'h2', 'h3', 'quote'].includes(opt.id)) {
        newCaret = (prefixText + (opt.id === 'todo' ? '- [ ] ' : opt.id === 'bullet' ? '- ' : opt.id === 'numbered' ? '1. ' : opt.id === 'h1' ? '# ' : opt.id === 'h2' ? '## ' : opt.id === 'h3' ? '### ' : '> ')).length;
      } else if (opt.id === 'code') {
        newCaret = lastSlashIdx + 3;
      } else if (opt.id === 'callout') {
        newCaret = lastSlashIdx + 11;
      } else if (opt.id === 'link-note') {
        newCaret = lastSlashIdx + 2;
      } else if (opt.id === 'web-link') {
        newCaret = lastSlashIdx + 1;
      } else if (opt.id === 'image') {
        newCaret = lastSlashIdx + 2;
      } else if (opt.id === 'flow' || opt.id === 'embed') {
        newCaret = lastSlashIdx + 6;
      } else if (opt.id === 'table') {
        newCaret = lastSlashIdx + 7;
      } else if (opt.id === 'board') {
        newCaret = lastSlashIdx + 6;
      } else if (opt.id === 'harcama') {
        newCaret = lastSlashIdx + 10;
      } else if (opt.id === 'gelir') {
        newCaret = lastSlashIdx + 8;
      } else if (opt.id === 'yatirim') {
        newCaret = lastSlashIdx + 9;
      } else if (opt.id === 'tasarruf') {
        newCaret = lastSlashIdx + 10;
      } else if (opt.id === 'tag') {
        newCaret = lastSlashIdx + 1;
      } else if (opt.id === 'habit') {
        newCaret = lastSlashIdx + 8;
      } else if (opt.id === 'voice') {
        newCaret = lastSlashIdx + 6;
      } else if (opt.id === 'video') {
        newCaret = lastSlashIdx + 5;
      } else if (opt.id === 'toc') {
        newCaret = lastSlashIdx + 5;
      } else if (opt.id === 'query') {
        newCaret = lastSlashIdx + 8;
      } else if (opt.id === 'chart') {
        newCaret = lastSlashIdx + 8;
      } else if (opt.id === 'youtube') {
        newCaret = lastSlashIdx + 30;
      }
      
      setCaretPos({ lineIdx, charIdx: newCaret });
      setFocusedLineIdx(lineIdx);
    }
    
    setShowSlashMenu(false);
  };

  const handleTogglePinToWidget = async () => {
    if (!activeNotePath || !onUpdatePinnedWidgets) return;
    const isCurrentlyPinned = pinnedWidgetLists.includes(activeNotePath);
    let updatedLists = [...pinnedWidgetLists];
    if (isCurrentlyPinned) {
      updatedLists = updatedLists.filter(p => p !== activeNotePath);
    } else {
      updatedLists.push(activeNotePath);
    }

    let newActivePath = pinnedWidgetList;
    if (updatedLists.length === 0) {
      newActivePath = null;
    } else if (!isCurrentlyPinned) {
      newActivePath = activeNotePath;
    } else if (isCurrentlyPinned && pinnedWidgetList === activeNotePath) {
      newActivePath = updatedLists[updatedLists.length - 1];
    }

    await onUpdatePinnedWidgets(updatedLists, newActivePath);
  };



  const parseHeadingColor = (text: string) => {
    let colorClass = '';
    let cleanText = text;
    
    const colorMatch = text.match(/(.*?)\s*\[color:(red|blue|green|purple|amber|pink|orange|cyan|indigo)\]/i);
    const gradMatch = text.match(/(.*?)\s*\[gradient:(sunset|ocean|neon|forest|fiery|cosmic|purple-glow)\]/i);
    
    if (colorMatch) {
      cleanText = colorMatch[1];
      colorClass = `heading-color-${colorMatch[2].toLowerCase()}`;
    } else if (gradMatch) {
      cleanText = gradMatch[1];
      colorClass = `heading-gradient-${gradMatch[2].toLowerCase()}`;
    }
    
    return { cleanText, colorClass };
  };

  // Line-by-Line Live Editor states
  const [focusedLineIdx, setFocusedLineIdx] = useState<number | null>(() => {
    if (activeNotePath) {
      const val = localStorage.getItem(`active_note_focused_line_${activeNotePath}`);
      return val !== null ? parseInt(val, 10) : null;
    }
    return null;
  });
  const [caretPos, setCaretPos] = useState<{ lineIdx: number; charIdx: number } | null>(() => {
    if (activeNotePath) {
      const lineVal = localStorage.getItem(`active_note_focused_line_${activeNotePath}`);
      const charVal = localStorage.getItem(`active_note_caret_char_${activeNotePath}`);
      if (lineVal !== null && charVal !== null) {
        return { lineIdx: parseInt(lineVal, 10), charIdx: parseInt(charVal, 10) };
      }
    }
    return null;
  });
  const lineRefs = useRef<{ [key: number]: HTMLTextAreaElement | null }>({});

  const lastLoadedContentRef = useRef<string>('');
  const lastLoadedPathRef = useRef<string>('');
  const mouseDownCoordsRef = useRef<{ x: number; y: number } | null>(null);

  // Undo/Redo History Refs
  const historyRef = useRef<HistoryEntry[]>([]);
  const redoHistoryRef = useRef<HistoryEntry[]>([]);
  const isUndoRedoRef = useRef<boolean>(false);
  const typingTimerRef = useRef<any>(null);
  const previousContentRef = useRef<string>('');

  // Refs to avoid stale closures in window event listener
  const handleUndoRef = useRef<(() => void) | null>(null);
  const handleRedoRef = useRef<(() => void) | null>(null);
  const isSourceModeRef = useRef<boolean>(false);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // `lines` her render'da yeniden `split` edilirse (memoize edilmezse) referansı
  // her seferinde değişir; bu da içerik hiç değişmese bile (ör. 1 saniyelik saat
  // tick'i, WPM/combo güncellemeleri gibi ilgisiz render'larda) [lines]'a bağlı
  // ağır useMemo/useEffect'lerin (kod bloğu taraması vb.) gereksiz yere tekrar
  // çalışmasına yol açar. useMemo ile yalnızca editorContent gerçekten
  // değiştiğinde yeniden hesaplanmasını sağlıyoruz.
  const lines = useMemo(() => editorContent.split('\n'), [editorContent]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Eğer kullanıcı bir kod bloğunu düzenliyorsa, o kod bloğunun sınırlarını belirler.
  const activeCodeBlockRange = useMemo(() => {
    return getActiveCodeBlockRange(lines, focusedLineIdx);
  }, [lines, focusedLineIdx]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Belgedeki gerçek açılış kod bloğu sınırlarını (```) bulur. Kapanış tırnaklarının açılış gibi algılanmasını önler.
  const openingCodeBlockIndices = useMemo(() => {
    const indices = new Set<number>();
    let inBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('```')) {
        if (inBlock) {
          inBlock = false;
        } else {
          let hasClosing = false;
          for (let k = i + 1; k < lines.length; k++) {
            if (lines[k].trim().startsWith('```')) {
              hasClosing = true;
              break;
            }
          }
          if (hasClosing) {
            indices.add(i);
            inBlock = true;
          }
        }
      }
    }
    return indices;
  }, [lines]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Dinamik Klavye Hızı Efektleri (Flow-State Typing / Power Mode) için kullanılan durum değişkenleri ve Canvas referansları.
  const [comboCount, setComboCount] = useState(0);
  const [currentWpm, setCurrentWpm] = useState(0);
  const [lastTypeTime, setLastTypeTime] = useState(0);
  const [keystrokes, setKeystrokes] = useState<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    alpha: number;
    color: string;
    size: number;
    decay: number;
  }>>([]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Yazma hızı istatistikleri (toplam süre/karakter/en yüksek WPM) önceden her
  // tuş vuruşunda senkron localStorage.setItem ile yazılıyordu; bu, ana thread'i
  // bloke ederek kıvılcım efektiyle birlikte donmaya yol açıyordu. Artık bu
  // değerler yalnızca bellekteki bu ref'te biriktirilir ve periyodik olarak
  // (2 saniyede bir) veya not değişiminde/unmount'ta diske yazılır.
  const typingStatsRef = useRef<{ totalTimeMs: number; totalChars: number; maxWpm: number; dirty: boolean }>({
    totalTimeMs: Number(localStorage.getItem('typing_total_time_ms') || '0'),
    totalChars: Number(localStorage.getItem('typing_total_chars') || '0'),
    maxWpm: Number(localStorage.getItem('typing_max_wpm') || '0'),
    dirty: false
  });

  useEffect(() => {
    const flushTypingStats = () => {
      const s = typingStatsRef.current;
      if (!s.dirty) return;
      localStorage.setItem('typing_total_time_ms', String(s.totalTimeMs));
      localStorage.setItem('typing_total_chars', String(s.totalChars));
      localStorage.setItem('typing_max_wpm', String(s.maxWpm));
      s.dirty = false;
    };
    const interval = setInterval(flushTypingStats, 2000);
    window.addEventListener('beforeunload', flushTypingStats);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', flushTypingStats);
      flushTypingStats();
    };
  }, []);

  // Obsidian-Style Premium States
  // Obsidian-Style Premium States
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const speechRecognitionRef = useRef<any>(null);
  const [collapsedHeadings, setCollapsedHeadings] = useState<Record<number, boolean>>({});
  const [dragSelectStartIdx, setDragSelectStartIdx] = useState<number | null>(null);
  const [dragSelectEndIdx, setDragSelectEndIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Ultimate Note Factory Widget states
  const [activeTimers, setActiveTimers] = useState<Record<number, { remaining: number; isRunning: boolean; duration: number }>>({});
  const [sketchingLines, setSketchingLines] = useState<Record<number, boolean>>({});
  const [voiceRecorderLines, setVoiceRecorderLines] = useState<Record<number, { isRecording: boolean }>>({});
  const voiceChunksRef = useRef<Record<number, Blob[]>>({});
  const voiceRecordersRef = useRef<Record<number, MediaRecorder>>({});
  const [currencyRates, setCurrencyRates] = useState<Record<string, number>>({ usd: 34.25, eur: 37.12, gbp: 43.55 });
  const [dismissedAlarms, setDismissedAlarms] = useState<Record<number, boolean>>({});
  const [loadedMediaCache, setLoadedMediaCache] = useState<Record<string, string>>({});
  const timerIntervalsRef = useRef<Record<number, any>>({});

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İmleç koordinatlarında parıldayan Doktor Strange portal kıvılcımı şeklinde piksel parçacıkları oluşturan yardımcı fonksiyon.
  // Bu kıvılcımlar yukarı uçmak yerine yerçekimiyle aşağıya dökülür ve alev rengini taşır.
  const spawnParticles = (x: number, y: number) => {
    const count = Math.min(12, Math.max(3, Math.floor(comboCount / 5) + 3));
    
    for (let i = 0; i < count; i++) {
      // Aşağıya doğru yelpaze şeklinde fırlatma açısı (Math.PI / 2 dikey aşağı yöndür)
      const angle = Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const speed = 2.0 + Math.random() * 4.0;
      
      // Doktor Strange portal kıvılcımı gibi altın, turuncu, sarı alev tonları (HSL 20-50 arası)
      const hue = 25 + Math.floor(Math.random() * 25);
      
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 0.4,
        vy: Math.sin(angle) * speed + 0.8, // Aşağı fırlatma ivmesi
        alpha: 1.0,
        color: `hsla(${hue}, 100%, ${55 + Math.floor(Math.random() * 20)}%, `, // Çok parlak ve canlı alev rengi
        size: 1.5 + Math.random() * 2.0, // İnce kıvılcım çizgileri
        decay: 0.03 + Math.random() * 0.04 // Hızlı sönme
      });
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Parçacıkları yön vektörlerine göre çizgisel kıvılcım şeklinde çizen requestAnimationFrame animasyon döngüsü.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    
    let animationId: number;
    
    const updateParticles = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        
        // Çizgisel kıvılcım efekti için önceki konumu saklıyoruz
        const prevX = p.x;
        const prevY = p.y;
        
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22; // Daha güçlü yerçekimi ile dökülme hissi
        p.alpha -= p.decay;
        
        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }
        
        // Kıvılcımları parlayan alev çizgileri olarak çiziyoruz
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color + '0.8)';
        ctx.strokeStyle = p.color + '1)';
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }
      
      animationId = requestAnimationFrame(updateParticles);
    };
    
    updateParticles();
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
    };
  }, [isFlowEffectsEnabled]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Kullanıcı yazmayı bıraktığında combo sayacının kademeli olarak düşmesini sağlayan zamanlayıcı.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - lastTypeTime > 1500) {
        setComboCount(prev => Math.max(0, Math.floor(prev * 0.7) - 1));
        setCurrentWpm(0);
      }
    }, 400);
    return () => clearInterval(timer);
  }, [lastTypeTime]);

  // Excalidraw refs and helper hooks
  const excalidrawIframeRef = useRef<HTMLIFrameElement | null>(null);
  const excalidrawReadyRef = useRef<boolean>(false);
  const excalidrawSentLoadRef = useRef<string | null>(null);
  const excalidrawIgnoreSaveUntilRef = useRef<number>(0);
  const isExcalidrawInternalChangeRef = useRef<boolean>(false);
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;

  const sendExcalidrawLoadData = (content: string, path: string) => {
    addDebugLog('sendExcalidrawLoadData called for path: ' + path + ' content length: ' + (content?.length || 0));
    if (!excalidrawIframeRef.current || !excalidrawIframeRef.current.contentWindow) {
      addDebugLog('sendExcalidrawLoadData aborted: iframe ref or contentWindow is null');
      return;
    }
    if (!excalidrawReadyRef.current) {
      addDebugLog('sendExcalidrawLoadData aborted: excalidrawReadyRef is false');
      return;
    }
    if (excalidrawSentLoadRef.current === path) {
      addDebugLog('sendExcalidrawLoadData: already sent load data for path: ' + path);
      return;
    }
    
    try {
      const parsed = JSON.parse(content || '{}');
      addDebugLog('Posting LOAD_DATA to iframe for path: ' + path);
      excalidrawIframeRef.current.contentWindow.postMessage({
        type: 'LOAD_DATA',
        elements: parsed.elements || [],
        appState: parsed.appState || {},
        path: path
      }, '*');
      excalidrawSentLoadRef.current = path;
    } catch (e) {
      addDebugLog('Error parsing Excalidraw content, sending empty data: ' + String(e));
      excalidrawIframeRef.current.contentWindow.postMessage({
        type: 'LOAD_DATA',
        elements: [],
        appState: {},
        path: path
      }, '*');
      excalidrawSentLoadRef.current = path;
    }
  };

  useEffect(() => {
    addDebugLog('activeNotePath changed. Resetting excalidrawReadyRef and excalidrawSentLoadRef for path: ' + activeNotePath);
    excalidrawReadyRef.current = false;
    excalidrawSentLoadRef.current = null;
    excalidrawIgnoreSaveUntilRef.current = 0;
  }, [activeNotePath]);

  // Excalidraw Message Handler - simplified, no e.source check (Electron iframe quirk)
  useEffect(() => {
    const activeNote = notes.find(n => n.path === activeNotePath);
    if (!activeNote || activeNote.type !== 'excalidraw' && activeNote.type !== 'drawio') return;

    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      
      addDebugLog('NotesView handleMessage received type: ' + e.data.type + ' from origin: ' + e.origin);

      if (e.data.type === 'EXCALIDRAW_READY') {
        addDebugLog('EXCALIDRAW_READY received. Setting excalidrawReadyRef = true');
        excalidrawReadyRef.current = true;
        excalidrawSentLoadRef.current = null;
        // Block SAVE_DATA for 1500ms after ready — iframe sends empty data on init before we load our data
        excalidrawIgnoreSaveUntilRef.current = Date.now() + 1500;
        addDebugLog('Blocking SAVE_DATA until: ' + new Date(excalidrawIgnoreSaveUntilRef.current).toISOString());
        // Small delay to ensure API is fully ready
        setTimeout(() => {
          if (activeNotePath && lastLoadedPathRef.current === activeNotePath) {
            addDebugLog('Sending load data on ready for path: ' + activeNotePath);
            sendExcalidrawLoadData(editorContentRef.current, activeNotePath);
          } else {
            addDebugLog('Cannot send load data on ready because path mismatch: ' + activeNotePath + ' vs lastLoaded: ' + lastLoadedPathRef.current);
          }
        }, 100);
      }
      
      if (e.data.type === 'SAVE_DATA') {
        // Ignore early SAVE_DATA that arrives before we've loaded our data into the iframe
        if (Date.now() < excalidrawIgnoreSaveUntilRef.current) {
          addDebugLog('SAVE_DATA ignored (within init window). elements: ' + (e.data.elements?.length || 0));
          return;
        }
        addDebugLog('SAVE_DATA received with elements count: ' + (e.data.elements?.length || 0));
        const saveJson = JSON.stringify({
          elements: e.data.elements || [],
          appState: e.data.appState || {}
        }, null, 2);
        
        if (saveJson !== editorContentRef.current) {
          addDebugLog('Content changed. Calling setEditorContent. saveJson len: ' + saveJson.length + ' vs editorContentRef len: ' + (editorContentRef.current?.length || 0));
          isExcalidrawInternalChangeRef.current = true;
          setEditorContent(saveJson);
        } else {
          addDebugLog('Content is identical. Skipping setEditorContent.');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [activeNotePath, notes]);

  // Load Excalidraw data when content finishes loading
  useEffect(() => {
    const activeNote = notes.find(n => n.path === activeNotePath);
    if (activeNote && activeNote.type === 'excalidraw' && activeNotePath) {
      if (lastLoadedPathRef.current === activeNotePath) {
        if (isExcalidrawInternalChangeRef.current) {
          addDebugLog('editorContent updated internally from Excalidraw. Skipping LOAD_DATA to avoid infinite loop.');
          isExcalidrawInternalChangeRef.current = false;
          return;
        }
        addDebugLog('editorContent or activeNotePath updated and matches lastLoaded. Loading Excalidraw data.');
        sendExcalidrawLoadData(editorContent, activeNotePath);
      }
    }
  }, [editorContent, activeNotePath, notes]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Obsidian tarzı "Ctrl + üzerine gel" not önizlemesi: [[Wiki Bağlantısı]] üzerine
  // Ctrl (veya Cmd, Mac) tuşu basılıyken gelince, hedef notun içeriğini fare yanında
  // küçük bir kartta gösterir — nota gitmeden hızlıca göz atmayı sağlar. Ctrl tuşu
  // fare zaten bağlantının üzerindeyken sonradan basılırsa da çalışması için Ctrl
  // durumu ve "üzerinde gelinen bağlantı" durumu ayrı ayrı izlenip birleştirilir.
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [hoveredWikiLink, setHoveredWikiLink] = useState<{ targetName: string; exists: boolean; x: number; y: number } | null>(null);
  const [linkPreview, setLinkPreview] = useState<{ targetName: string; exists: boolean; x: number; y: number; content: string; loading: boolean } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false);
    };
    const handleBlur = () => setCtrlHeld(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ: Önceden popup yalnızca Ctrl basılıyken açık kalıyordu. Ancak tarayıcıda/
  // Electron'da Ctrl+Fare Tekerleği, sayfa YAKINLAŞTIRMA (zoom) kısayolu olduğu için kullanıcı
  // popup içinde kaydırmaya çalıştığında (Ctrl hâlâ basılıyken) kaydırma popup'a değil zoom'a
  // gidiyor, "içeride scroll yapamıyorum" hissi yaratıyordu. Çözüm: Ctrl+üzerine gelme yalnızca
  // popup'ı İLK AÇMAK için gerekli; bir kez açıldıktan sonra fare link veya popup'ın üzerindeyken
  // (Ctrl bırakılsa bile) açık kalır — böylece kullanıcı Ctrl'ü bırakıp normal fare tekerleğiyle
  // rahatça kaydırabilir. Yalnızca fare hem bağlantıdan hem popup'tan tamamen ayrılınca kapanır.
  const shownForTargetRef = useRef<string | null>(null);
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bağlantı ile popup arasında birkaç piksellik boşluk olduğu için fare o boşluktan
  // geçerken anlık "mouseleave" popup'ı erken kapatabiliyordu. Kapatmayı küçük bir
  // gecikmeyle planlayıp, fare bağlantıya ya da popup'a tekrar girerse iptal ediyoruz.
  const hidePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHideWikiPreview = () => {
    if (hidePreviewTimerRef.current) {
      clearTimeout(hidePreviewTimerRef.current);
      hidePreviewTimerRef.current = null;
    }
  };
  const scheduleHideWikiPreview = () => {
    cancelHideWikiPreview();
    hidePreviewTimerRef.current = setTimeout(() => {
      setHoveredWikiLink(null);
    }, 200);
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ: React'in JSX onWheel prop'u tarayıcı performansı için varsayılan
  // olarak "passive" dinleyici olarak eklenir — bu modda e.preventDefault() ÇALIŞMAZ
  // (sessizce yoksayılır). Ctrl+Fare Tekerleği tarayıcıda/Electron'da sayfa yakınlaştırma
  // (zoom) kısayolu olduğundan, popup içinde JSX onWheel ile preventDefault denemek zoom'u
  // engelleyemiyordu. Çözüm: native (passive:false) bir "wheel" dinleyicisi ekleyip hem
  // varsayılan davranışı (zoom) engelliyor hem de kaydırmayı popup içinde elle uyguluyoruz.
  const linkPreviewElRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = linkPreviewElRef.current;
    if (!el || !linkPreview) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [linkPreview !== null]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Önizleme kartında ham markdown metni yerine BASİT bir biçimlendirilmiş görünüm
  // (başlık/madde/checklist/kalın/italik/kod) gösterir — tam editör satır render'ı
  // (renderSingleLine) bu notun state'ine bağlı olduğundan burada yeniden kullanılamaz.
  const renderInlinePreviewMd = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g).filter(p => p !== '');
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        return <code key={i} style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px', fontSize: '11px' }}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 1) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
  };

  const renderPreviewLine = (line: string, idx: number): React.ReactNode => {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      return (
        <div key={idx} style={{ fontWeight: 700, fontSize: level === 1 ? '14px' : level === 2 ? '13px' : '12.5px', margin: '6px 0 3px' }}>
          {renderInlinePreviewMd(heading[2])}
        </div>
      );
    }
    const checklist = getChecklistInfo(line);
    if (checklist) {
      const checked = checklist.status.toLowerCase() === 'x';
      return (
        <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', margin: '2px 0' }}>
          <span style={{ opacity: 0.7 }}>{checked ? '☑' : '☐'}</span>
          <span style={{ textDecoration: checked ? 'line-through' : 'none', opacity: checked ? 0.6 : 1 }}>{renderInlinePreviewMd(checklist.content)}</span>
        </div>
      );
    }
    const bullet = getBulletInfo(line);
    if (bullet) {
      return (
        <div key={idx} style={{ display: 'flex', gap: '6px', margin: '2px 0' }}>
          <span style={{ opacity: 0.6 }}>•</span>
          <span>{renderInlinePreviewMd(bullet.content)}</span>
        </div>
      );
    }
    const ordered = getOrderedListInfo(line);
    if (ordered) {
      return (
        <div key={idx} style={{ display: 'flex', gap: '6px', margin: '2px 0' }}>
          <span style={{ opacity: 0.6 }}>{ordered.number}.</span>
          <span>{renderInlinePreviewMd(ordered.content)}</span>
        </div>
      );
    }
    if (line.trim() === '') return <div key={idx} style={{ height: '6px' }} />;
    return <div key={idx} style={{ margin: '2px 0' }}>{renderInlinePreviewMd(line)}</div>;
  };

  useEffect(() => {
    if (!hoveredWikiLink) {
      shownForTargetRef.current = null;
      setLinkPreview(null);
      return;
    }

    const alreadyShownForThis = shownForTargetRef.current === hoveredWikiLink.targetName;
    if (!ctrlHeld && !alreadyShownForThis) {
      // Ctrl basılı değil ve bu bağlantı için henüz açılmamış — bekle, gösterme.
      return;
    }
    if (alreadyShownForThis) {
      // Zaten açık/yükleniyor — Ctrl bırakılıp tekrar basılsa bile gereksiz yeniden yüklemeyi önle.
      return;
    }

    shownForTargetRef.current = hoveredWikiLink.targetName;
    let cancelled = false;
    const { targetName, exists, x, y } = hoveredWikiLink;
    setLinkPreview({ targetName, exists, x, y, content: '', loading: true });
    (async () => {
      try {
        let content = '';
        if (exists) {
          const targetNote = notes.find(n => n.name.toLowerCase() === targetName.toLowerCase());
          content = targetNote ? await readNoteContent(targetNote.path) : '';
        }
        if (!cancelled) {
          setLinkPreview(prev => (prev && prev.targetName === targetName) ? { ...prev, content, loading: false } : prev);
        }
      } catch (err) {
        if (!cancelled) {
          setLinkPreview(prev => (prev && prev.targetName === targetName) ? { ...prev, content: '_Not yüklenemedi._', loading: false } : prev);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ctrlHeld, hoveredWikiLink, notes, readNoteContent]);

  // Wiki-link autocomplete states
  const [showWikiSuggestions, setShowWikiSuggestions] = useState(false);
  const [wikiSearch, setWikiSearch] = useState('');
  const [wikiTriggerIndex, setWikiTriggerIndex] = useState<number>(-1);
  const [activeWikiSuggestionIndex, setActiveWikiSuggestionIndex] = useState(0);
  const [wikiCaretCoords, setWikiCaretCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Contextual Selection Toolbar state
  const [selectionInfo, setSelectionInfo] = useState<{
    lineIdx: number;
    start: number;
    end: number;
    top: number;
    left: number;
  } | null>(null);

  // Helpers for Heading Folding, Callouts, and Selections
  const getHiddenLineIndices = (): Set<number> => {
    const hidden = new Set<number>();
    
    // 1. Folded Headings
    Object.keys(collapsedHeadings).forEach((key) => {
      const startIdx = parseInt(key, 10);
      if (!collapsedHeadings[startIdx]) return;
      
      const startLine = lines[startIdx];
      if (!startLine) return;
      
      const startMatch = startLine.match(/^(#{1,6})\s+/);
      if (!startMatch) return;
      
      const startLevel = startMatch[1].length;
      
      for (let i = startIdx + 1; i < lines.length; i++) {
        const currentLine = lines[i];
        const headingMatch = currentLine.match(/^(#{1,6})\s+/);
        if (headingMatch) {
          const currentLevel = headingMatch[1].length;
          if (currentLevel <= startLevel) {
            break;
          }
        }
        hidden.add(i);
      }
    });

    // 2. Table Rows (hide unless parent or row has focus)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.toLowerCase().startsWith('tablo:')) {
        const rowIndices: number[] = [];
        let nextIdx = i + 1;
        while (nextIdx < lines.length) {
          const nextLine = lines[nextIdx].trim();
          if (nextLine === '' || nextLine.startsWith('#') || nextLine.startsWith('---') || nextLine.startsWith('tablo:')) {
            break;
          }
          const cleanRow = nextLine.replace(/^[-*+]\s+/, '').trim();
          rowIndices.push(nextIdx);
          nextIdx++;
        }
        
        // Hide sub-rows from the editor lines list entirely, unless a specific sub-row itself has direct focus
        rowIndices.forEach(idx => {
          if (focusedLineIdx !== idx) {
            hidden.add(idx);
          }
        });
      }
    }

    // 3. Toggle Detail Lines (hide unless parent or detail line has focus)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const toggleMatch = line.match(/^toggle:\s*(.*)$/i);
      if (toggleMatch) {
        const detailIndices: number[] = [];
        let nextIdx = i + 1;
        while (nextIdx < lines.length) {
          const nextLine = lines[nextIdx];
          if (nextLine.trim() !== '' && !nextLine.startsWith('  ') && !nextLine.startsWith('\t')) {
            break;
          }
          detailIndices.push(nextIdx);
          nextIdx++;
        }
        
        // If toggle parent or detail line is focused, show them; otherwise, hide them!
        const isToggleFocused = focusedLineIdx === i || (focusedLineIdx !== null && detailIndices.includes(focusedLineIdx));
        if (!isToggleFocused) {
          detailIndices.forEach(idx => hidden.add(idx));
        }
      }
    }
    // 4. Metadata / Creation Date / Timestamp-only / Tag-only lines
    for (let i = 0; i < lines.length; i++) {
      if (focusedLineIdx === i) continue; // Never hide the active line that the user is currently editing/typing!
      
      const line = lines[i];
      if (line.trim().startsWith('Oluşturuldu:') || line.trim().startsWith('Oluşturulma Tarihi:')) {
        hidden.add(i);
      } else if (isTimestampOnlyLine(line)) {
        hidden.add(i);
      } else if (isTagsOnlyLine(line)) {
        hidden.add(i);
      }
    }
    
    return hidden;
  };

  const getFootnoteDefinitions = (): Record<string, { content: string; index: number }> => {
    const defs: Record<string, { content: string; index: number }> = {};
    let currentIndex = 1;
    lines.forEach((line) => {
      const match = line.match(/^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/);
      if (match) {
        const label = match[1];
        const content = match[2];
        if (!defs[label]) {
          defs[label] = { content, index: currentIndex++ };
        }
      }
    });
    return defs;
  };

  interface FootnoteDef {
    label: string;
    content: string;
    index: number;
    lineIdx: number;
  }

  const getDetailedFootnotes = () => {
    const list: FootnoteDef[] = [];
    const map: Record<string, FootnoteDef> = {};
    let currentIndex = 1;
    lines.forEach((line, idx) => {
      const match = line.match(/^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/);
      if (match) {
        const label = match[1];
        const content = match[2];
        const fn = { label, content, index: currentIndex++, lineIdx: idx };
        list.push(fn);
        if (!map[label]) {
          map[label] = fn;
        }
      }
    });
    return { list, map };
  };

  const getFootnoteInfo = (text: string) => {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/);
    if (match) {
      return {
        label: match[1],
        content: match[2]
      };
    }
    return null;
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Satır sanallaştırması (VirtBlock) altyapısı: ölçülen blok yükseklikleri
  // önbelleği, element→callback kaydı ve paylaşılan tek IntersectionObserver.
  // rootMargin 1200px: kullanıcı bir bloğa 1200px yaklaştığında blok gerçek
  // içeriğiyle mount edilir — normal kaydırma hızında boşluk hiç görünmez.
  const virtHeightCacheRef = useRef<Map<string, number>>(new Map());
  const virtRegistryRef = useRef<Map<Element, (visible: boolean, height: number) => void>>(new Map());
  const virtObserverRef = useRef<IntersectionObserver | null>(null);
  // Satıra atlama (başlık ağacı, dipnot, arama) hedefi henüz mount edilmemişse
  // o satırı zorla mount etmek için "sabitlenen" satırlar.
  const virtPinnedRef = useRef<Set<number>>(new Set());
  const [, setVirtPinVersion] = useState(0);

  const getVirtObserver = useCallback(() => {
    if (!virtObserverRef.current) {
      virtObserverRef.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const handler = virtRegistryRef.current.get(entry.target);
          if (handler) handler(entry.isIntersecting, entry.boundingClientRect.height);
        }
      }, { rootMargin: '1200px 0px 1200px 0px' });
    }
    return virtObserverRef.current;
  }, []);

  useEffect(() => () => { virtObserverRef.current?.disconnect(); }, []);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // IntersectionObserver'a ek scroll-tabanlı YEDEK: bazı WebView/arka plan
  // durumlarında IO bildirimleri gecikebilir veya askıya alınabilir. Kaydırma
  // olduğunda (throttle ~120ms) kayıtlı tüm blokların konumunu elle kontrol
  // edip aynı görünürlük callback'lerini çağırırız — IO çalışıyorsa bu kontrol
  // zaten aynı sonucu üretir (setVisible aynı değerle çağrılınca render olmaz).
  useEffect(() => {
    let lastRun = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;

    const checkAll = () => {
      const vh = window.innerHeight || 800;
      virtRegistryRef.current.forEach((handler, el) => {
        const r = el.getBoundingClientRect();
        const inRange = r.bottom > -1200 && r.top < vh + 1200;
        handler(inRange, r.height);
      });
    };

    const onScroll = () => {
      const now = Date.now();
      if (now - lastRun >= 120) {
        lastRun = now;
        checkAll();
      } else if (!trailing) {
        trailing = setTimeout(() => {
          trailing = null;
          lastRun = Date.now();
          checkAll();
        }, 140);
      }
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      if (trailing) clearTimeout(trailing);
    };
  }, []);

  useEffect(() => {
    // Not değişince önceki nota ait sabitlemeler anlamını yitirir.
    virtPinnedRef.current.clear();
  }, [activeNotePath]);

  const scrollToElement = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('glow-highlight');
      setTimeout(() => el.classList.remove('glow-highlight'), 2000);
      return;
    }
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Hedef satır sanallaştırma nedeniyle henüz DOM'da olmayabilir: satırı
    // sabitle (zorla mount ettir), render sonrası tekrar dene.
    const m = id.match(/^editor-line-(\d+)$/);
    if (m) {
      virtPinnedRef.current.add(parseInt(m[1], 10));
      setVirtPinVersion(v => v + 1);
      setTimeout(() => {
        const el2 = document.getElementById(id);
        if (el2) {
          el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el2.classList.add('glow-highlight');
          setTimeout(() => el2.classList.remove('glow-highlight'), 2000);
        }
      }, 80);
    }
  };

  const handleWikiLinkClick = async (targetName: string, exists: boolean) => {
    if (exists) {
      const targetNote = notes.find(n => n.name.toLowerCase() === targetName.toLowerCase());
      if (targetNote) {
        setActiveNotePath(targetNote.path);
      }
    } else {
      if (confirm(`"${targetName}" adında bir not bulunamadı. Yeni bir not oluşturmak ister misiniz?`)) {
        try {
          await onCreateNote(targetName, selectedFolder);
        } catch (err) {
          console.error('Wiki-link not oluşturma hatası:', err);
        }
      }
    }
  };

  const getWikiSuggestions = () => {
    const search = wikiSearch.toLowerCase().trim();
    const existingMatches = notes
      .filter(n => n.type === 'note')
      .map(n => n.name)
      .filter(name => name.toLowerCase().includes(search));

    // If search is not empty and not an exact match to any existing note, add a virtual suggestion
    const exactMatch = existingMatches.some(name => name.toLowerCase() === search);
    if (search && !exactMatch) {
      existingMatches.push(wikiSearch.trim());
    }
    return existingMatches;
  };

  const filteredWikiOptions = getWikiSuggestions();

  const selectWikiSuggestion = (option: string) => {
    if (focusedLineIdx === null || wikiTriggerIndex === -1) return;

    const textarea = lineRefs.current[focusedLineIdx];
    if (!textarea) return;

    const val = textarea.value;
    const beforeTrigger = val.slice(0, wikiTriggerIndex);
    let afterSearch = val.slice(wikiTriggerIndex + 2 + wikiSearch.length);

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Obsidian stili otomatik parantez kapatma ([[ -> ]]) sebebiyle caret sonrasında kalan
    // mükerrer kapanış parantezlerini (]]) temizleyerek çift parantez oluşmasını engelliyoruz.
    if (afterSearch.startsWith(']]')) {
      afterSearch = afterSearch.substring(2);
    }

    const newVal = `${beforeTrigger}[[${option}]]${afterSearch}`;

    const fullLine = lines[focusedLineIdx];
    const isChecklist = getChecklistInfo(fullLine);
    const isBullet = getBulletInfo(fullLine);
    const isOrdered = getOrderedListInfo(fullLine);

    let newFullLine = newVal;
    if (isChecklist) {
      newFullLine = `${isChecklist.prefix}${isChecklist.status}${isChecklist.spacer}${newVal}`;
    } else if (isBullet) {
      newFullLine = `${isBullet.prefix}${newVal}`;
    } else if (isOrdered) {
      newFullLine = `${isOrdered.prefix}${newVal}`;
    }

    const newLines = [...lines];
    newLines[focusedLineIdx] = newFullLine;
    setEditorContent(newLines.join('\n'));
    setShowWikiSuggestions(false);
    setWikiSearch('');
    setWikiTriggerIndex(-1);

    setTimeout(() => {
      const targetEl = lineRefs.current[focusedLineIdx!];
      if (targetEl) {
        targetEl.focus();
        const newCursorPos = beforeTrigger.length + option.length + 4;
        targetEl.setSelectionRange(newCursorPos, newCursorPos);
        setCaretPos({ lineIdx: focusedLineIdx!, charIdx: newCursorPos });
      }
    }, 50);
  };

  const checkWikiTrigger = (textarea: HTMLTextAreaElement) => {
    const val = textarea.value;
    const selectionStartVal = textarea.selectionStart;
    const textBeforeCursor = val.slice(0, selectionStartVal);
    const lastTriggerMatch = textBeforeCursor.match(/\[\[([a-zA-Z0-9_ ğüşıöçĞÜŞİÖÇ\/-]*)$/);

    if (lastTriggerMatch) {
      const search = lastTriggerMatch[1];
      const triggerIdx = textBeforeCursor.lastIndexOf('[[');
      setWikiTriggerIndex(triggerIdx);
      setWikiSearch(search);
      setShowWikiSuggestions(true);
      setActiveWikiSuggestionIndex(0);

      const coords = getCaretCoordinates(textarea, triggerIdx);
      setWikiCaretCoords(coords);
    } else {
      setShowWikiSuggestions(false);
      setWikiSearch('');
      setWikiTriggerIndex(-1);
    }
  };

  const renderWikiSuggestions = (idx: number) => {
    if (focusedLineIdx !== idx || !showWikiSuggestions || filteredWikiOptions.length === 0) return null;

    return (
      <div 
        className="autocomplete-dropdown animate-pop inline-suggestion-popup"
        style={{
          position: 'absolute',
          top: `${wikiCaretCoords.top + 8}px`,
          left: `${Math.min(Math.max(10, wikiCaretCoords.left), 400)}px`,
          right: 'auto',
          width: '240px',
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
        {filteredWikiOptions.map((opt, i) => {
          const exists = notes.some(n => n.type === 'note' && n.name.toLowerCase() === opt.toLowerCase());
          return (
            <div 
              key={opt}
              className={`autocomplete-item ${i === activeWikiSuggestionIndex ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                selectWikiSuggestion(opt);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '8px 12px',
                fontSize: '12px',
                color: i === activeWikiSuggestionIndex ? '#fff' : 'var(--text-secondary)',
                background: i === activeWikiSuggestionIndex ? 'var(--accent-color)' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.1s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <FileText size={12} style={{ flexShrink: 0, opacity: exists ? 0.8 : 0.4 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt}</span>
              </div>
              {!exists && (
                <span style={{ 
                  fontSize: '9px', 
                  padding: '2px 6px', 
                  borderRadius: '10px', 
                  background: i === activeWikiSuggestionIndex ? 'rgba(255, 255, 255, 0.2)' : 'rgba(99, 102, 241, 0.15)',
                  color: i === activeWikiSuggestionIndex ? '#fff' : 'var(--accent-color)',
                  fontWeight: 600,
                  flexShrink: 0
                }}>
                  Yeni Not
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const getCalloutInfo = (text: string) => {
    if (!text || typeof text !== 'string') return null;
    const headerMatch = text.match(/^>\s*\[!(note|tip|important|warning|caution)\]\s*(.*)$/i);
    if (headerMatch) {
      return {
        isHeader: true,
        type: headerMatch[1].toLowerCase(),
        title: headerMatch[2] || headerMatch[1].toUpperCase(),
        content: ''
      };
    }
    const contentMatch = text.match(/^>\s*(.*)$/);
    if (contentMatch) {
      return {
        isHeader: false,
        type: '',
        title: '',
        content: contentMatch[1]
      };
    }
    return null;
  };

  const getCalloutTypeUpwards = (startIdx: number): string => {
    for (let i = startIdx; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('>')) break;
      const info = getCalloutInfo(line);
      if (info && info.isHeader) {
        return info.type;
      }
    }
    return 'note';
  };

  const renderCalloutIcon = (type: string) => {
    switch (type) {
      case 'tip':
        return <Lightbulb size={16} />;
      case 'important':
        return <AlertCircle size={16} />;
      case 'warning':
        return <AlertTriangle size={16} />;
      case 'caution':
        return <ShieldAlert size={16} />;
      case 'note':
      default:
        return <Info size={16} />;
    }
  };

  const getCalloutWeldStyle = (idx: number) => {
    const prevIsCallout = idx > 0 && lines[idx - 1].startsWith('>');
    const nextIsCallout = idx < lines.length - 1 && lines[idx + 1].startsWith('>');
    
    const style: React.CSSProperties = {};
    if (prevIsCallout) {
      style.marginTop = '0';
      style.borderTop = 'none';
      style.borderTopLeftRadius = '0';
      style.borderTopRightRadius = '0';
      style.paddingTop = '6px';
    }
    if (nextIsCallout) {
      style.marginBottom = '0';
      style.borderBottomLeftRadius = '0';
      style.borderBottomRightRadius = '0';
      style.paddingBottom = '6px';
    }
    return style;
  };

  const getSelectedRange = () => {
    if (dragSelectStartIdx === null || dragSelectEndIdx === null) return null;
    if (dragSelectStartIdx === dragSelectEndIdx) return null;
    const start = Math.min(dragSelectStartIdx, dragSelectEndIdx);
    const end = Math.max(dragSelectStartIdx, dragSelectEndIdx);
    return { start, end };
  };

  const deleteSelectedLines = (range: { start: number; end: number }) => {
    const newLines = [...lines];
    const deleteCount = range.end - range.start + 1;
    newLines.splice(range.start, deleteCount, '');
    
    setEditorContent(newLines.join('\n'));
    setDragSelectStartIdx(null);
    setDragSelectEndIdx(null);
    
    setFocusedLineIdx(range.start);
    setCaretPos({ lineIdx: range.start, charIdx: 0 });
  };

  const replaceSelectedLines = (range: { start: number; end: number }, char: string) => {
    const newLines = [...lines];
    const deleteCount = range.end - range.start + 1;
    newLines.splice(range.start, deleteCount, char);
    
    setEditorContent(newLines.join('\n'));
    setDragSelectStartIdx(null);
    setDragSelectEndIdx(null);
    
    setFocusedLineIdx(range.start);
    setCaretPos({ lineIdx: range.start, charIdx: 1 });
  };
  // Custom debounced Undo/Redo logic
  const pushToHistory = useCallback((content: string) => {
    const lastEntry = historyRef.current[historyRef.current.length - 1];
    addDebugLog(`pushToHistory: contentLen=${content.length} lastEntryLen=${lastEntry ? lastEntry.content.length : 'none'}`);
    if (lastEntry && content === lastEntry.content) {
      addDebugLog('pushToHistory: content identical, ignoring');
      return;
    }

    if (historyRef.current.length >= 50) {
      historyRef.current.shift();
    }
    historyRef.current.push({
      content,
      focusedLineIdx,
      caretPos
    });
    addDebugLog(`pushToHistory: pushed. New history size: ${historyRef.current.length}`);
    redoHistoryRef.current = [];
  }, [focusedLineIdx, caretPos]);

  const handleUndo = useCallback(() => {
    addDebugLog(`handleUndo: called. ContentLength=${editorContent.length} previousLen=${previousContentRef.current.length} historySize=${historyRef.current.length}`);
    // If there is pending typing/pasting that hasn't been committed to history yet, commit it now
    if (editorContent !== previousContentRef.current) {
      addDebugLog('handleUndo: pending typing/pasting found. Committing before undo.');
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      pushToHistory(previousContentRef.current);
      previousContentRef.current = editorContent;
    }

    if (historyRef.current.length === 0) {
      addDebugLog('handleUndo: aborted. History stack is empty.');
      return;
    }
    
    const currentEntry: HistoryEntry = {
      content: editorContent,
      focusedLineIdx,
      caretPos
    };
    redoHistoryRef.current.push(currentEntry);

    const prev = historyRef.current.pop()!;
    addDebugLog(`handleUndo: popping state. Restoring content len=${prev.content.length}`);
    
    isUndoRedoRef.current = true;
    setEditorContent(prev.content);
    setFocusedLineIdx(prev.focusedLineIdx);
    setCaretPos(prev.caretPos);
    previousContentRef.current = prev.content;
    
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 50);
  }, [editorContent, focusedLineIdx, caretPos, pushToHistory]);

  const handleRedo = useCallback(() => {
    if (redoHistoryRef.current.length === 0) return;

    const currentEntry: HistoryEntry = {
      content: editorContent,
      focusedLineIdx,
      caretPos
    };
    historyRef.current.push(currentEntry);

    const next = redoHistoryRef.current.pop()!;

    isUndoRedoRef.current = true;
    setEditorContent(next.content);
    setFocusedLineIdx(next.focusedLineIdx);
    setCaretPos(next.caretPos);
    previousContentRef.current = next.content;
    
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 50);
  }, [editorContent, focusedLineIdx, caretPos]);

  // Typing debouncer for Undo history snapshots
  useEffect(() => {
    if (isUndoRedoRef.current) return;
    if (!activeNotePath) return;

    // If the content hasn't actually changed since the last snapshot, do nothing
    if (editorContent === previousContentRef.current) return;

    if (previousContentRef.current === '') {
      previousContentRef.current = editorContent;
      return;
    }

    const lastChar = editorContent[editorContent.length - 1];
    const isWordBoundary = lastChar === ' ' || lastChar === '\n' || editorContent.length < previousContentRef.current.length;
    
    if (isWordBoundary) {
      pushToHistory(previousContentRef.current);
      previousContentRef.current = editorContent;
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        pushToHistory(previousContentRef.current);
        previousContentRef.current = editorContent;
      }, 800);
    }
  }, [editorContent, activeNotePath, pushToHistory]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  // Update refs on every render to prevent stale closures in window event listener
  useEffect(() => {
    handleUndoRef.current = handleUndo;
    handleRedoRef.current = handleRedo;
    isSourceModeRef.current = isSourceMode;
  });

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Alt+Z kısayol tuşu ile Zen Focus modunun klavyeden açılıp kapatılabilmesini sağlıyoruz.
      const isZenKey = (e.key && e.key.toLowerCase() === 'z') || e.code === 'KeyZ';
      if (e.altKey && isZenKey) {
        e.preventDefault();
        setIsZenMode(!isZenModeRef.current);
        return;
      }

      if (isSourceModeRef.current) return;

      const activeEl = document.activeElement;
      const isEditorTextarea = activeEl && (
        activeEl.classList.contains('line-textarea') || 
        activeEl.closest('.live-editor-container') !== null
      );
      if (!isEditorTextarea) return;

      if (e.ctrlKey) {
        addDebugLog(`Ctrl keydown: code=${e.code} key=${e.key} shift=${e.shiftKey}`);
      }

      // Check both e.key and e.code for absolute keyboard layout independence (Q vs F layouts)
      const isKeyZ = (e.key && e.key.toLowerCase() === 'z') || e.code === 'KeyZ';
      const isKeyY = (e.key && e.key.toLowerCase() === 'y') || e.code === 'KeyY';

      if (e.ctrlKey && isKeyZ) {
        if (e.shiftKey) {
          e.preventDefault();
          addDebugLog('Ctrl+Shift+Z recognized, triggering Redo');
          if (handleRedoRef.current) handleRedoRef.current();
        } else {
          e.preventDefault();
          addDebugLog('Ctrl+Z recognized, triggering Undo');
          if (handleUndoRef.current) handleUndoRef.current();
        }
      } else if (e.ctrlKey && isKeyY) {
        e.preventDefault();
        addDebugLog('Ctrl+Y recognized, triggering Redo');
        if (handleRedoRef.current) handleRedoRef.current();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, []);
  const handleLineMouseDown = (e: React.MouseEvent, idx: number) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    mouseDownCoordsRef.current = { x: e.clientX, y: e.clientY };
    setDragSelectStartIdx(idx);
    setDragSelectEndIdx(idx);
    setIsDragging(true);
  };

  const getEditorStats = () => {
    const text = editorContent;
    const charCount = text.length;
    const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const lineCount = lines.length;
    
    const readingTimeMin = Math.ceil(wordCount / 200);
    const readingTimeStr = readingTimeMin <= 1 ? '1 dk okuma' : `${readingTimeMin} dk okuma`;
    
    return {
      charCount,
      wordCount,
      lineCount,
      readingTimeStr
    };
  };

  // Global mouse and keyboard listeners for drag selection
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (KeyboardEvent: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      if (KeyboardEvent.ctrlKey && KeyboardEvent.key.toLowerCase() === 'a') {
        if (isSourceMode) return;
        KeyboardEvent.preventDefault();
        setDragSelectStartIdx(0);
        setDragSelectEndIdx(lines.length - 1);
        setFocusedLineIdx(null);
        return;
      }
      
      const range = getSelectedRange();
      if (!range) return;
      
      if (KeyboardEvent.key === 'Escape') {
        setDragSelectStartIdx(null);
        setDragSelectEndIdx(null);
        return;
      }
      
      if (KeyboardEvent.key === 'Delete' || KeyboardEvent.key === 'Backspace') {
        KeyboardEvent.preventDefault();
        deleteSelectedLines(range);
        return;
      }
      
      if (KeyboardEvent.ctrlKey && KeyboardEvent.key.toLowerCase() === 'c') {
        KeyboardEvent.preventDefault();
        const selectedText = lines.slice(range.start, range.end + 1).join('\n');
        navigator.clipboard.writeText(selectedText);
        return;
      }
      
      if (KeyboardEvent.ctrlKey && KeyboardEvent.key.toLowerCase() === 'x') {
        KeyboardEvent.preventDefault();
        const selectedText = lines.slice(range.start, range.end + 1).join('\n');
        navigator.clipboard.writeText(selectedText);
        deleteSelectedLines(range);
        return;
      }
      
      if (KeyboardEvent.key.length === 1 && !KeyboardEvent.ctrlKey && !KeyboardEvent.altKey && !KeyboardEvent.metaKey) {
        KeyboardEvent.preventDefault();
        replaceSelectedLines(range, KeyboardEvent.key);
      }
    };
    
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [dragSelectStartIdx, dragSelectEndIdx, lines, isSourceMode]);

  // Filter notes based on selected folder and selected tag
  const filteredNotes = notes.filter((item) => {
    if (item.type !== 'note' && item.type !== 'excalidraw' && item.type !== 'drawio') return false;
    
    if (selectedFolder) {
      const noteFolder = item.path.split('/').slice(0, -1).join('/');
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Alt klasörlerdeki notların ana klasörde mükerrer olarak listelenip silinme kafa karışıklığı
      // yaratmasını önlemek amacıyla filtrelemeyi tam eşleşme (exact match) yapıyoruz.
      const isMatch = noteFolder === selectedFolder;
      if (!isMatch) return false;
    }
    
    if (selectedTag) {
      const content = fileContents[item.path] || '';
      if (!content.toLowerCase().includes('#' + selectedTag.toLowerCase())) {
        return false;
      }
    }
    
    return true;
  });

  // Fetch active note content when activeNotePath changes
  useEffect(() => {
    if (activeNotePath) {
      const cachedDraft = localStorage.getItem(`active_note_draft_${activeNotePath}`);
      readNoteContent(activeNotePath).then((content) => {
        lastLoadedContentRef.current = content;
        lastLoadedPathRef.current = activeNotePath;
        
        // Use cached draft if it exists to prevent losing last second of typed text
        if (cachedDraft !== null) {
          setEditorContent(cachedDraft);
        } else {
          setEditorContent(content);
        }

        // Reset undo/redo history for the new note
        historyRef.current = [];
        redoHistoryRef.current = [];
        previousContentRef.current = cachedDraft !== null ? cachedDraft : content;
        
        setSyncStatus('saved');
        
        // Restore focus and caret position if previously stored for this note path
        const savedFocusStr = localStorage.getItem(`active_note_focused_line_${activeNotePath}`);
        if (savedFocusStr !== null) {
          const savedFocus = parseInt(savedFocusStr, 10);
          setFocusedLineIdx(savedFocus);
          
          const savedCaretStr = localStorage.getItem(`active_note_caret_char_${activeNotePath}`);
          if (savedCaretStr !== null) {
            setCaretPos({ lineIdx: savedFocus, charIdx: parseInt(savedCaretStr, 10) });
          }
        } else {
          setFocusedLineIdx(null);
          setCaretPos(null);
        }
        
        setExpandedTaskIdx(null);
        setIsSourceMode(false);
        setIsMindmapMode(false);
        setCollapsedHeadings({});
        setDragSelectStartIdx(null);
        setDragSelectEndIdx(null);
        setIsDragging(false);
      });
    } else {
      setEditorContent('');
      setFocusedLineIdx(null);
      setCaretPos(null);
      setExpandedTaskIdx(null);
      setIsSourceMode(false);
      setIsMindmapMode(false);
      setCollapsedHeadings({});
      setDragSelectStartIdx(null);
      setDragSelectEndIdx(null);
      setIsDragging(false);
    }
  }, [activeNotePath]);
  
  // Listen for external file changes (e.g. pulled from background sync) to refresh editor in real-time
  useEffect(() => {
    if (activeNotePath && fileContents[activeNotePath] !== undefined) {
      const externalContent = fileContents[activeNotePath];
      const cachedDraft = localStorage.getItem(`active_note_draft_${activeNotePath}`);
      if (externalContent !== lastLoadedContentRef.current && cachedDraft === null) {
        lastLoadedContentRef.current = externalContent;
        setEditorContent(externalContent);
      }
    }
  }, [activeNotePath, fileContents]);

  // Fetch exchange rates on mount
  useEffect(() => {
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(res => res.json())
      .then(data => {
        if (data && data.rates && data.rates.TRY) {
          const tryRate = data.rates.TRY;
          const eurRate = data.rates.EUR;
          const gbpRate = data.rates.GBP;
          
          setCurrencyRates({
            usd: tryRate,
            eur: tryRate / (eurRate || 0.92),
            gbp: tryRate / (gbpRate || 0.79)
          });
        }
      })
      .catch(err => console.log('Currency API offline, using fallback TRY rates:', err));
  }, []);

  // Alarm checker clock loop
  const [currentTime, setCurrentTime] = useState<string>('');
  useEffect(() => {
    const clock = setInterval(() => {
      const d = new Date();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      setCurrentTime(`${h}:${m}`);
    }, 1000);
    return () => clearInterval(clock);
  }, []);

  // Synchronize editorContent draft to localStorage
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // localStorage.setItem senkron bir işlemdir ve önceden her tuş vuruşunda
  // (debounce'suz) çağrılıyordu; büyük notlarda bu, yazarken hissedilen
  // donmaya katkıda bulunuyordu. 200ms'lik kısa bir debounce ile ana thread'i
  // bloke eden bu yazmaları tuş vuruşlarından ayırıyoruz (taslak kaybı riski yok,
  // gecikme çok kısa).
  useEffect(() => {
    if (!(activeNotePath && activeNotePath === lastLoadedPathRef.current)) return;
    const timer = setTimeout(() => {
      if (editorContent) {
        localStorage.setItem(`active_note_draft_${activeNotePath}`, editorContent);
      } else {
        localStorage.removeItem(`active_note_draft_${activeNotePath}`);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [editorContent, activeNotePath]);

  // Synchronize focusedLineIdx to localStorage
  useEffect(() => {
    if (activeNotePath && activeNotePath === lastLoadedPathRef.current) {
      if (focusedLineIdx !== null) {
        localStorage.setItem(`active_note_focused_line_${activeNotePath}`, focusedLineIdx.toString());
      } else {
        localStorage.removeItem(`active_note_focused_line_${activeNotePath}`);
      }
    }
  }, [focusedLineIdx, activeNotePath]);

  // Synchronize caretPos to localStorage
  useEffect(() => {
    if (activeNotePath && activeNotePath === lastLoadedPathRef.current) {
      if (caretPos && caretPos.lineIdx === focusedLineIdx) {
        localStorage.setItem(`active_note_caret_char_${activeNotePath}`, caretPos.charIdx.toString());
      } else {
        localStorage.removeItem(`active_note_caret_char_${activeNotePath}`);
      }
    }
  }, [caretPos, focusedLineIdx, activeNotePath]);

  // Real-time caret position updater
  const updateCaretPosition = (el: HTMLTextAreaElement, lineIdx: number) => {
    const charIdx = el.selectionStart;
    setCaretPos({ lineIdx, charIdx });
  };

  // Helper for tracking text selection range and coordinates
  const checkSelection = (el: HTMLTextAreaElement, lineIdx: number) => {
    if (el.selectionStart !== el.selectionEnd) {
      const startCoords = getCaretCoordinates(el, el.selectionStart);
      const endCoords = getCaretCoordinates(el, el.selectionEnd);
      
      const avgLeft = (startCoords.left + endCoords.left) / 2;
      const top = startCoords.top;
      
      setSelectionInfo({
        lineIdx,
        start: el.selectionStart,
        end: el.selectionEnd,
        top,
        left: avgLeft
      });
    } else {
      setSelectionInfo(null);
    }
  };

  // Helper for tracking wiki trigger and updating caret position in real-time
  const handleTextareaInteract = (el: HTMLTextAreaElement, idx: number) => {
    checkWikiTrigger(el);
    updateCaretPosition(el, idx);
    checkSelection(el, idx);

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Daktilo modu aktifken, kullanıcı yazmaya devam ettikçe aktif satırı ekranın dikey ortasında tutar.
    if (isTypewriterModeRef.current && el) {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // KRİTİK HATA DÜZELTMESİ: Bu effect'in bağımlılık dizisi [editorContent, activeNotePath]
  // olduğundan, önceki hâlde her tuş vuruşunda (editorContent her değiştiğinde) React
  // ÖNCE bir önceki effect çalıştırmasının cleanup fonksiyonunu çağırıyordu. O cleanup,
  // "not değişti/kapandı" sanıp BİR TUŞ GERİSİNDEKİ (bayat) içeriği diske yazıyordu —
  // yani hızlı yazarken pratikte her karakterde gerçek bir disk yazma + tüm kasayı yeniden
  // okuma (loadAllData) tetikleniyordu. Bu hem donmaya hem de (yazma sırasında eski/bayat
  // içerik geç dönüp üzerine yazdığı için) az önce silinen kelimelerin geri gelmesi gibi
  // yarış durumlarına yol açıyordu. Çözüm: "her tuşta zamanlayıcı kur" ile "not gerçekten
  // değişince/kapanınca bekleyen içeriği kaydet" mantığını birbirinden ayırdık.
  const latestEditorContentRef = useRef(editorContent);
  useEffect(() => {
    latestEditorContentRef.current = editorContent;
  }, [editorContent]);

  // Effect A: Sadece debounce zamanlayıcısını kurar. Her tuş vuruşunda yeniden kurulur
  // ama cleanup'ı YALNIZCA eski zamanlayıcıyı iptal eder — asla kendi başına kaydetmez.
  useEffect(() => {
    if (!activeNotePath) return;
    if (activeNotePath !== lastLoadedPathRef.current) {
      addDebugLog('Auto-save hook: Path changed but content not loaded yet. Skipping save. Path: ' + activeNotePath);
      return;
    }
    if (editorContent === lastLoadedContentRef.current) {
      setSyncStatus('saved');
      return;
    }

    setSyncStatus('saving');
    const timer = setTimeout(async () => {
      try {
        addDebugLog('Auto-save timer fired. Saving note to path: ' + activeNotePath);
        await onSaveNote(activeNotePath, editorContent);
        lastLoadedContentRef.current = editorContent;
        lastLoadedPathRef.current = activeNotePath;
        setSyncStatus('saved');
        localStorage.removeItem(`active_note_draft_${activeNotePath}`);
      } catch (error) {
        addDebugLog('Otomatik kaydetme hatası: ' + String(error));
      }
    }, 2500); // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // 2.5 sn yazma sessizliği sonrası otomatik kaydet. 1 sn'lik önceki değer,
    // kullanıcının doğal düşünme molalarında bile kayıt zincirini (disk yazma +
    // sürüm geçmişi + senkron) tetikleyip yazmaya dönüşte takılma yaratıyordu.
    // Not değiştirme/kapatma anında ayrıca anında flush eden Effect B var —
    // veri kaybı riski yok.

    return () => clearTimeout(timer);
  }, [editorContent, activeNotePath]);

  // Effect B: Yalnızca activeNotePath GERÇEKTEN değiştiğinde (ya da bileşen unmount
  // olduğunda) tetiklenir. Cleanup'ı, ayrılınan nota ait en güncel içeriği (ref üzerinden)
  // henüz diske yazılmamışsa anında kaydeder. Her tuş vuruşunda ÇALIŞMAZ.
  useEffect(() => {
    const pathBeingLeft = activeNotePath;
    return () => {
      if (!pathBeingLeft) return;
      const latest = latestEditorContentRef.current;
      if (latest !== lastLoadedContentRef.current) {
        addDebugLog('Note switch/unmount flush: Saving dirty content for path: ' + pathBeingLeft);
        onSaveNote(pathBeingLeft, latest).then(() => {
          lastLoadedContentRef.current = latest;
        }).catch(error => {
          console.error('Error saving on note switch/unmount:', error);
        });
      }
    };
  }, [activeNotePath]);

  // Focus and Caret restore hook
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ: Bu efekt önceden useEffect'ti — DOM commit edildikten SONRA,
  // tarayıcı boyamadan önce ama asenkron olarak (bir sonraki tick'e yakın) çalışır.
  // Backspace tuşuna basılı tutup hızlı art arda satır birleştirirken (OS'in tuş
  // tekrarı ~30-50ms aralıkla yeni keydown olayları üretir), yeni bir keydown, bu
  // efekt henüz doğru textarea'ya focus/imleç konumunu uygulamadan ARAYA girebiliyordu
  // — o anda hedef textarea'nın imleci tarayıcının varsayılanı olan 0. konumdaydı,
  // bu da "imleç satırın başına atlıyor" hatasına yol açıyordu. useLayoutEffect, DOM
  // commit edilir edilmez SENKRON çalışır (boyamadan ve sıradaki olay işlenmeden
  // önce) — bu yarış penceresini kapatır.
  useLayoutEffect(() => {
    if (focusedLineIdx !== null) {
      const focusTextarea = () => {
        const el = lineRefs.current[focusedLineIdx];
        if (el) {
          if (document.activeElement !== el) {
            el.focus();
          }
          if (caretPos && caretPos.lineIdx === focusedLineIdx) {
            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            // Kullanıcının AKTİF BİR SEÇİMİ varsa (start !== end) imleci asla
            // programatik taşıma — yoksa her seçim denemesi anında tek noktaya
            // çöker ve metin seçmek imkânsız hale gelir. Ayrıca imleç zaten
            // hedef konumdaysa gereksiz setSelectionRange çağrısı yapma.
            if (el.selectionStart !== el.selectionEnd) return;
            if (el.selectionStart !== caretPos.charIdx) {
              el.setSelectionRange(caretPos.charIdx, caretPos.charIdx);
            }
          }
        }
      };

      focusTextarea();

      const timer = setTimeout(focusTextarea, 20);
      return () => clearTimeout(timer);
    }
    // caretPos bilerek bağımlılıklara eklendi: bir satırın türü yazarken değişince
    // (ör. "-" "-" "-" yazıp paragraftan yatay çizgiye dönüşünce, ya da "- " yazıp
    // paragraftan madde işaretine dönüşünce) React o satır için FARKLI bir JSX dalına
    // geçer ve textarea'yı yeniden bağlar (yeni DOM düğümü). O yeni düğümdeki
    // `autoFocus` imleci varsayılan olarak 0'a atar. focusedLineIdx DEĞİŞMEDİĞİ için
    // bu efekt önceden tekrar tetiklenmiyordu; caretPos her tuş vuruşunda güncellendiği
    // için artık bu durumda da doğru imleç konumu hemen yeniden uygulanıyor.
  }, [focusedLineIdx, caretPos]);

  // Helper functions for parsing list/checklist structures
  const getChecklistInfo = (text: string) => {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s+)(.*)$/);
    if (match) {
      return {
        prefix: match[1],
        status: match[2],
        spacer: match[3],
        content: match[4]
      };
    }
    // Match empty checklist items e.g., "- [ ] " or "- [ ]"
    const emptyMatch = text.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*)$/);
    if (emptyMatch) {
      return {
        prefix: emptyMatch[1],
        status: emptyMatch[2],
        spacer: emptyMatch[3],
        content: ''
      };
    }
    return null;
  };

  const getBulletInfo = (text: string) => {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/^(\s*[*\-+]\s+)(.*)$/);
    if (match) {
      return {
        prefix: match[1],
        content: match[2]
      };
    }
    return null;
  };

  const getOrderedListInfo = (text: string) => {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/^(\s*(\d+)\.\s+)(.*)$/);
    if (match) {
      return {
        prefix: match[1],
        number: match[2],
        content: match[3]
      };
    }
    const emptyMatch = text.match(/^(\s*(\d+)\.\s*)$/);
    if (emptyMatch) {
      return {
        prefix: emptyMatch[1],
        number: emptyMatch[2],
        content: ''
      };
    }
    return null;
  };

  const getLineTypeAndOffset = (text: string) => {
    const isChecklist = getChecklistInfo(text);
    if (isChecklist) {
      const prefixLen = isChecklist.prefix.length + isChecklist.status.length + isChecklist.spacer.length;
      return { type: 'checklist', prefixLen };
    }
    const isBullet = getBulletInfo(text);
    if (isBullet) {
      return { type: 'bullet', prefixLen: isBullet.prefix.length };
    }
    const isOrdered = getOrderedListInfo(text);
    if (isOrdered) {
      return { type: 'ordered', prefixLen: isOrdered.prefix.length };
    }
    return { type: 'paragraph', prefixLen: 0 };
  };


  const handleToggleCheckboxInEditor = async (lineIdx: number) => {
    const linesArr = editorContent.split('\n');
    if (lineIdx < 0 || lineIdx >= linesArr.length) return;

    const line = linesArr[lineIdx];
    const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
    if (!checklistMatch) return;

    const prefix = checklistMatch[1];
    const currentStatus = checklistMatch[2];
    const suffix = checklistMatch[3];

    const newStatus = currentStatus.toLowerCase() === 'x' ? ' ' : 'x';
    linesArr[lineIdx] = `${prefix}${newStatus}${suffix}`;

    const newContent = linesArr.join('\n');
    setEditorContent(newContent);
  };

  const handleUpdateTaskMetadata = async (
    lineIdx: number,
    originalContent: string,
    isImportant: boolean,
    isUrgent: boolean,
    dueDate: string,
    repeat: string
  ) => {
    const linesArr = editorContent.split('\n');
    if (lineIdx < 0 || lineIdx >= linesArr.length) return;

    let cleanText = originalContent
      .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
      .replace(/\[due:\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]/gi, '')
      .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    let priorityStr = '';
    if (isImportant && isUrgent) {
      priorityStr = '[p:critical]';
    } else if (isUrgent) {
      priorityStr = '[p:high]';
    } else if (isImportant) {
      priorityStr = '[p:medium]';
    }

    let dueStr = dueDate ? `[due:${dueDate}]` : '';

    let repeatStr = '';
    if (repeat && repeat !== 'none') {
      repeatStr = `[repeat:${repeat}]`;
    }

    const suffixParts = [];
    if (priorityStr) suffixParts.push(priorityStr);
    if (dueStr) suffixParts.push(dueStr);
    if (repeatStr) suffixParts.push(repeatStr);

    const suffix = suffixParts.length > 0 ? ' ' + suffixParts.join(' ') : '';
    const fullLine = linesArr[lineIdx];
    const chkMatch = fullLine.match(/^(\s*[*\-]\s+\[[ xX]\]\s*)/);
    if (!chkMatch) return;

    linesArr[lineIdx] = `${chkMatch[1]}${cleanText}${suffix}`;

    const newContent = linesArr.join('\n');
    setEditorContent(newContent);
  };

  const handleDeleteTaskLine = async (lineIdx: number) => {
    const linesArr = editorContent.split('\n');
    if (lineIdx < 0 || lineIdx >= linesArr.length) return;

    linesArr.splice(lineIdx, 1);

    const newContent = linesArr.join('\n');
    setEditorContent(newContent);
    setExpandedTaskIdx(null);
    setFocusedLineIdx(null);
  };

  const calculateTaskScore = (text: string): number => {
    if (!text || typeof text !== 'string') return 0;
    let score = 0;

    const priorityMatch = text.match(/\[p:(critical|acil|high|yüksek|medium|orta|low|düşük)\]/i);
    if (priorityMatch) {
      const p = priorityMatch[1].toLowerCase();
      if (p === 'critical' || p === 'acil') score += 10;
      else if (p === 'high' || p === 'yüksek') score += 6;
      else if (p === 'medium' || p === 'orta') score += 3;
      else if (p === 'low' || p === 'düşük') score += 1;
    }

    const dueMatch = text.match(/\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/);
    if (dueMatch) {
      const dueStr = dueMatch[1];
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const due = new Date(dueStr);
      due.setHours(0, 0, 0, 0);

      const diffTime = due.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        score += 8;
      } else if (diffDays === 0 || diffDays === 1) {
        score += 5;
      } else if (diffDays <= 7) {
        score += 3;
      } else {
        score += 1;
      }
    }

    return score;
  };

  const calculateTaskScoreBreakdown = (text: string, totalScore: number): string => {
    if (!text || typeof text !== 'string') return '📊 Puan Kırılımı:\n  Öncelik: yok\n  Bitiş tarihi: yok\n  Toplam: 0';
    const lines: string[] = ['📊 Puan Kırılımı:'];
    const priorityMatch = text.match(/\[p:(critical|acil|high|yüksek|medium|orta|low|düşük)\]/i);
    if (priorityMatch) {
      const p = priorityMatch[1].toLowerCase();
      const labelMap: Record<string, string> = { critical: 'Kritik', acil: 'Kritik', high: 'Yüksek', 'yüksek': 'Yüksek', medium: 'Orta', orta: 'Orta', low: 'Düşük', 'düşük': 'Düşük' };
      const scoreMap: Record<string, number> = { critical: 10, acil: 10, high: 6, 'yüksek': 6, medium: 3, orta: 3, low: 1, 'düşük': 1 };
      lines.push(`  Öncelik (${labelMap[p] ?? p}): +${scoreMap[p] ?? 0}`);
    } else {
      lines.push('  Öncelik: yok');
    }
    const dueMatch = text.match(/\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/);
    if (dueMatch) {
      const now = new Date(); now.setHours(0,0,0,0);
      const due = new Date(dueMatch[1]); due.setHours(0,0,0,0);
      const diffDays = Math.ceil((due.getTime()-now.getTime())/(1000*60*60*24));
      let dScore = 0; let dLabel = '';
      if (diffDays < 0) { dScore=8; dLabel='Gecikmiş'; }
      else if (diffDays===0) { dScore=5; dLabel='Bugün'; }
      else if (diffDays===1) { dScore=5; dLabel='Yarın'; }
      else if (diffDays<=7) { dScore=3; dLabel=`${diffDays} gün sonra`; }
      else { dScore=1; dLabel=`${diffDays} gün sonra`; }
      lines.push(`  Bitiş tarihi (${dLabel}): +${dScore}`);
    } else {
      lines.push('  Bitiş tarihi: yok');
    }
    lines.push(`  Toplam: ${totalScore}`);
    return lines.join('\n');
  };

  // ==========================================
  // PREMIUM WIDGETS & TOOLS (PHASE 1 - 4)
  // ==========================================

  const updateLineContentPreservingPrefix = (lineIdx: number, newContentBody: string) => {
    const linesArr = [...lines];
    const originalLine = linesArr[lineIdx];
    if (!originalLine) return;
    
    const isChecklist = getChecklistInfo(originalLine);
    const isBullet = getBulletInfo(originalLine);
    const isOrdered = getOrderedListInfo(originalLine);
    
    let updatedLine = newContentBody;
    if (isChecklist) {
      updatedLine = `${isChecklist.prefix}${isChecklist.status}${isChecklist.spacer}${newContentBody}`;
    } else if (isBullet) {
      updatedLine = `${isBullet.prefix}${newContentBody}`;
    } else if (isOrdered) {
      updatedLine = `${isOrdered.prefix}${newContentBody}`;
    }
    
    linesArr[lineIdx] = updatedLine;
    setEditorContent(linesArr.join('\n'));
  };

  const playBeepSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      osc.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.error('Synthesized sound failed:', e);
    }
  };



  const getInlineCalculationsNode = (text: string): React.ReactNode | null => {
    const currencyMatch = text.match(/(\d+(?:\.\d+)?)\s*(dolar|euro|sterlin|usd|eur|gbp)\b/i);
    if (currencyMatch) {
      const val = parseFloat(currencyMatch[1]);
      const currency = currencyMatch[2].toLowerCase();
      let rate = 34.25;
      let symbol = '$';
      if (currency === 'euro' || currency === 'eur') {
        rate = currencyRates.eur;
        symbol = '€';
      } else if (currency === 'sterlin' || currency === 'gbp') {
        rate = currencyRates.gbp;
        symbol = '£';
      } else {
        rate = currencyRates.usd;
        symbol = '$';
      }
      const tlEquiv = val * rate;
      return (
        <span className="preview-calc-badge currency" title="Dinamik Döviz Çevirici" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          💸 {symbol}{val} ≈ {tlEquiv.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL
        </span>
      );
    }

    const percentMatch = text.match(/(\d+)\s*%(\d+)(?:\s*(indirim|kdv))?/i);
    if (percentMatch) {
      const base = parseFloat(percentMatch[1]);
      const percent = parseFloat(percentMatch[2]);
      const type = percentMatch[3] ? percentMatch[3].toLowerCase() : '';
      
      const diff = base * (percent / 100);
      if (type === 'indirim') {
        const result = base - diff;
        return (
          <span className="preview-calc-badge percent discount" title="Yüzdelik İndirim Hesabı" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            👉 Sonuç: {result.toLocaleString('tr-TR')} TL (%{percent} indirimli) [Fark: -{diff.toLocaleString('tr-TR')} TL]
          </span>
        );
      } else {
        const result = base + diff;
        return (
          <span className="preview-calc-badge percent markup" title="Yüzdelik KDV Ekleme" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            👉 Sonuç: {result.toLocaleString('tr-TR')} TL (%{percent} KDV dahil) [Ekleme: +{diff.toLocaleString('tr-TR')} TL]
          </span>
        );
      }
    }

    const signedRegex = /(?:^|\s)([-+]\d+(?:\.\d+)?)\b/g;
    const matches = [];
    let mMatch;
    while ((mMatch = signedRegex.exec(text)) !== null) {
      matches.push(parseFloat(mMatch[1]));
    }
    if (matches.length >= 1) {
      const sum = matches.reduce((acc, curr) => acc + curr, 0);
      return (
        <span className="preview-calc-badge running-total" title="Para Toplama Kasa Hesabı" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          📊 Hesap Toplamı: {sum >= 0 ? '+' : ''}{sum.toLocaleString('tr-TR')} TL
        </span>
      );
    }

    return null;
  };

  const getCalendarBtnNode = (line: string, idx: number): React.ReactNode | null => {
    if (line.includes('[due:')) return null;

    const calendarRegex = /\b(bugün|yarın|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)(?:\s+(\d{2}:\d{2}))?\b/i;
    const match = line.match(calendarRegex);
    if (!match) return null;

    const word = match[1];
    const timeVal = match[2] || '';

    const handleAddCalendar = (e: React.MouseEvent) => {
      e.stopPropagation();
      const now = new Date();
      const lowerWord = word.toLowerCase().trim();
      let targetDate = new Date();

      if (lowerWord === 'yarın' || lowerWord === 'yarin') {
        targetDate.setDate(now.getDate() + 1);
      } else if (lowerWord !== 'bugün' && lowerWord !== 'bugun') {
        const days: Record<string, number> = {
          'pazartesi': 1, 'salı': 2, 'sali': 2, 'çarşamba': 3, 'carsamba': 3,
          'perşembe': 4, 'persembe': 4, 'cuma': 5, 'cumartesi': 6, 'pazar': 0
        };
        const targetDay = days[lowerWord];
        if (targetDay !== undefined) {
          const currentDay = now.getDay();
          let diff = targetDay - currentDay;
          if (diff <= 0) diff += 7;
          targetDate.setDate(now.getDate() + diff);
        }
      }

      const yyyy = targetDate.getFullYear();
      const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const dd = String(targetDate.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      let timeSlotStr = '';
      if (timeVal) {
        const [hStr, mStr] = timeVal.split(':');
        let startH = parseInt(hStr, 10);
        let endH = startH + 1;
        if (endH >= 24) endH = 23;
        const formattedEnd = `${String(endH).padStart(2, '0')}:${mStr}`;
        timeSlotStr = ` [time:${timeVal}-${formattedEnd}]`;
      }

      const linesArr = [...lines];
      const currentLine = linesArr[idx];

      let updatedLine = currentLine;
      const isChecklist = getChecklistInfo(currentLine);
      const isBullet = getBulletInfo(currentLine);
      const isOrdered = getOrderedListInfo(currentLine);

      if (!isChecklist) {
        if (isBullet) {
          updatedLine = `- [ ] ${isBullet.content}`;
        } else if (isOrdered) {
          updatedLine = `- [ ] ${isOrdered.content}`;
        } else {
          updatedLine = `- [ ] ${currentLine.trim()}`;
        }
      }

      updatedLine = `${updatedLine} [due:${dateStr}]${timeSlotStr}`;
      linesArr[idx] = updatedLine;
      setEditorContent(linesArr.join('\n'));
    };

    return (
      <button className="preview-calendar-add-btn" onClick={handleAddCalendar} onMouseDown={(e) => e.stopPropagation()} title="Bu görevi/etkinliği takvime ekle">
        📅 Takvime Ekle
      </button>
    );
  };

  const renderLineWidgets = (line: string, idx: number): React.ReactNode => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Satır aktif bir kod bloğu içindeyse, hiçbir widget (Tablo, Kanban, Yüzde Hesap vb.) veya
    // markdown stili (kalın, yatık, inline code vb.) uygulanmaz. Ham satır metni döndürülür.
    const isInCodeBlock = activeCodeBlockRange && idx >= activeCodeBlockRange.start && idx <= activeCodeBlockRange.end;
    if (isInCodeBlock) {
      return <span>{line}</span>;
    }

    // 0. Web Arama / Açma Yönlendirici Kısayolu (web: galatasaray)
    if (line.trim().toLowerCase().startsWith('web:')) {
      const query = line.trim().substring(4).trim();
      return (
        <div 
          className="web-launcher-widget-container" 
          onClick={(e) => {
            e.stopPropagation();
            if (onSearchWeb) onSearchWeb(query);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '6px 12px',
            margin: '4px 0',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            color: 'var(--text-primary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-color)';
            e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-color)';
            e.currentTarget.style.background = 'var(--bg-tertiary)';
          }}
        >
          <Globe size={14} style={{ color: 'var(--accent-color)' }} />
          <span style={{ fontSize: '12px', fontWeight: '500' }}>Web'de Ara/Aç:</span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'underline', fontStyle: 'italic' }}>
            {query || 'google.com'}
          </span>
        </div>
      );
    }

    // 1. Excel-Lite Tablo
    if (line.trim().toLowerCase().startsWith('tablo:')) {
      const headerText = line.trim().substring(6).trim();
      const headers = headerText.split(',').map(h => h.trim());
      
      const tableRows: string[][] = [];
      let nextIdx = idx + 1;
      while (nextIdx < lines.length) {
        const nextLine = lines[nextIdx].trim();
        if (nextLine === '' || nextLine.startsWith('#') || nextLine.startsWith('---') || nextLine.startsWith('tablo:')) {
          break;
        }
        const cleanRow = nextLine.replace(/^[-*+]\s+/, '').trim();
        tableRows.push(cleanRow.split(',').map(cell => cell.trim()));
        nextIdx++;
      }
      
      if (tableRows.length > 0) {
        return (
          <div className="excel-lite-table-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5): */}
            {/* Başlığa, kullanıcının canlı canlı yeni tablo satırı eklemesini sağlayan Satır Ekle butonu yerleştirilmiştir. */}
            <div className="table-header-bar" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Table size={13} className="accent-text" />
                <span>Etkileşimli Excel Grid (tablo:)</span>
              </div>
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const linesArr = [...lines];
                  const insertIdx = idx + 1 + tableRows.length;
                  const newRowCells = Array(headers.length).fill('');
                  const newRowText = `- ${newRowCells.join(', ')}`;
                  linesArr.splice(insertIdx, 0, newRowText);
                  setEditorContent(linesArr.join('\n'));
                }}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  borderRadius: '4px',
                  color: '#10b981',
                  padding: '2px 8px',
                  fontSize: '10px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginLeft: 'auto',
                  transition: 'all 0.15s ease'
                }}
              >
                <Plus size={10} /> Satır Ekle
              </button>
            </div>
            <div className="excel-table-scroll">
              <table className="excel-lite-table">
                <thead>
                  <tr>
                    {headers.map((h, hidx) => <th key={hidx}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ridx) => (
                    <tr key={ridx} onMouseDown={(e) => e.stopPropagation()}>
                      {headers.map((h, cidx) => {
                        const val = row[cidx] || '';
                        return (
                          <td key={cidx} onMouseDown={(e) => e.stopPropagation()}>
                            <input 
                              type="text" 
                              className="excel-table-input"
                              defaultValue={val}
                              onMouseDown={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                const newVal = e.target.value;
                                if (newVal !== val) {
                                  const linesArr = [...lines];
                                  const targetLineIdx = idx + 1 + ridx;
                                  const originalNextLine = linesArr[targetLineIdx];
                                  const bulletMatch = originalNextLine.match(/^([-*+]\s+)/);
                                  const bulletPrefix = bulletMatch ? bulletMatch[1] : '';
                                  
                                  const newRowCells = [...row];
                                  newRowCells[cidx] = newVal;
                                  linesArr[targetLineIdx] = `${bulletPrefix}${newRowCells.join(', ')}`;
                                  setEditorContent(linesArr.join('\n'));
                                }
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
    }

    // 1.5 Kanban Pano
    if (line.trim().toLowerCase().startsWith('pano:')) {
      const headerText = line.trim().substring(5).trim();
      const columns = headerText.split(',').map(c => c.trim());
      const columnCards: Record<string, string[]> = {};
      columns.forEach(col => { columnCards[col] = []; });
      
      let nextIdx = idx + 1;
      while (nextIdx < lines.length) {
        const nextLine = lines[nextIdx].trim();
        if (nextLine === '' || nextLine.startsWith('#') || nextLine.startsWith('---') || nextLine.startsWith('pano:') || nextLine.startsWith('tablo:') || nextLine.startsWith('flow:')) {
          break;
        }
        const cardMatch = nextLine.match(/^[-*+]\s+([^:]+):\s*(.*)$/);
        if (cardMatch) {
          const colName = cardMatch[1].trim();
          const cardText = cardMatch[2].trim();
          const matchingCol = columns.find(c => c.toLowerCase() === colName.toLowerCase());
          if (matchingCol) {
            columnCards[matchingCol].push(cardText);
          }
        }
        nextIdx++;
      }
      return (
        <div className="kanban-pano-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{
          margin: '12px 0',
          display: 'flex',
          gap: '12px',
          overflowX: 'auto',
          padding: '4px'
        }}>
          {columns.map(col => (
            <div key={col} className="kanban-column" style={{
              flex: '1 1 200px',
              minWidth: '200px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '6px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--accent-color)', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                📋 {col} ({columnCards[col].length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {columnCards[col].map((card, cidx) => (
                  <div key={cidx} style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '12px',
                    color: 'var(--text-primary)'
                  }}>
                    {card}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // 1.7.5 Auto-Generated Table of Contents (TOC)
    if (line.trim().toLowerCase() === '[toc]') {
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Nottaki tüm başlık satırlarını (# ile başlayan) tarayarak tıklanabilir bir İçindekiler Tablosu (TOC) oluşturur.
      const headings: Array<{ text: string; level: number; lineIndex: number }> = [];
      lines.forEach((l, lIdx) => {
        const trimmed = l.trim();
        if (trimmed.startsWith('#') && lIdx !== idx) {
          const match = trimmed.match(/^(#+)\s+(.*)$/);
          if (match) {
            headings.push({
              level: match[1].length,
              text: match[2].trim(),
              lineIndex: lIdx
            });
          }
        }
      });

      if (headings.length === 0) {
        return (
          <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>
            İçindekiler tablosu oluşturulacak başlık bulunamadı.
          </div>
        );
      }

      return (
        <div 
          className="toc-container" 
          onClick={(e) => e.stopPropagation()} 
          onMouseDown={(e) => e.stopPropagation()} 
          style={{
            margin: '12px 0',
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.01)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '6px',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--accent-color)', letterSpacing: '0.05em', marginBottom: '8px', textTransform: 'uppercase' }}>
            📖 İçindekiler Tablosu
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {headings.map((h, hIdx) => (
              <div 
                key={hIdx} 
                onClick={() => {
                  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                  // Odaklanmamış satırlar textarea olmadığından lineRefs boş döner. Bu yüzden DOM üzerinden id ile kaydırıyoruz.
                  const targetEl = document.getElementById(`editor-line-${h.lineIndex}`);
                  if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => handleLineFocus(h.lineIndex), 300);
                  } else {
                    // Sanallaştırma nedeniyle hedef satır henüz mount edilmemiş
                    // olabilir — scrollToElement sabitleyip yeniden dener.
                    scrollToElement(`editor-line-${h.lineIndex}`);
                    setTimeout(() => handleLineFocus(h.lineIndex), 400);
                  }
                }}
                style={{
                  fontSize: '12.5px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  paddingLeft: `${(h.level - 1) * 12}px`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'color 0.2s ease',
                  userSelect: 'none'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <span style={{ opacity: 0.5 }}>{'.'.repeat(h.level)}</span>
                <span>{h.text}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // 1.8 Flow Embed & Block Transclusion
    const embedMatch = line.trim().match(/^!\[\[([^#\]]+)(?:#([^\]]+))?\]\]/);
    const isFlowStyle = line.trim().toLowerCase().startsWith('flow:');
    
    if (embedMatch || isFlowStyle) {
      let targetNotePath = '';
      let sectionHeader = '';
      
      if (embedMatch) {
        targetNotePath = embedMatch[1].trim();
        sectionHeader = embedMatch[2] ? embedMatch[2].trim() : '';
      } else {
        targetNotePath = line.trim().substring(5).trim();
      }

      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Gömülü dosya uzantılı veya uzantısız arandığında (.excalidraw veya .md)
      // notes listesindeki isimlerle tam ve hatasız eşleşebilmesi için temizleyip karşılaştırıyoruz.
      const cleanTargetName = targetNotePath.replace(/\.(md|excalidraw)$/, '');
      const targetNote = notes.find(n => 
        n.path === targetNotePath || 
        n.path.endsWith('/' + targetNotePath) || 
        n.path.endsWith('/' + targetNotePath + '.excalidraw') ||
        n.path.endsWith('/' + targetNotePath + '.md') ||
        n.name === targetNotePath || 
        n.name.replace(/\.(md|excalidraw)$/, '') === cleanTargetName ||
        n.name === targetNotePath + '.md' ||
        n.name === targetNotePath + '.excalidraw'
      );

      if (targetNote) {
        if (targetNote.type === 'excalidraw') {
          // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          // Gömülü .excalidraw çizim notlarını algılayıp doğrudan satırın içine
          // etkileşimli bir Excalidraw çizim çerçevesi (iframe) yerleştirir.
          return (
            <InlineExcalidrawEditor
              notePath={targetNote.path}
              noteName={targetNote.name}
              readNoteContent={readNoteContent}
              onSaveNote={onSaveNote}
              onOpenFullScreen={(path) => {
                setActiveNotePath(path);
              }}
            />
          );
        }

        let embedContent = fileContents[targetNote.path] || '';
        
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Eğer belirli bir başlık (sectionHeader) belirtilmişse, notun tamamı yerine sadece o başlık altındaki metin bloğu süzülerek getirilir.
        if (sectionHeader) {
          embedContent = extractSectionContent(embedContent, sectionHeader);
        }

        const isEditing = !!flowEditModes[idx] && !sectionHeader; // Disable editing if it's a section transclusion to prevent sync conflicts
        
        const renderMarkdownToHtml = (markdown: string) => {
          const mLines = markdown.split('\n');
          return (
            <div className="flow-markdown-preview" style={{ fontSize: '12.5px', lineHeight: '1.6', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {mLines.map((mLine, mIdx) => {
                const trimmed = mLine.trim();
                if (trimmed.startsWith('# ')) {
                  return <h1 key={mIdx} style={{ fontSize: '15px', border: 'none', margin: '4px 0 2px 0', fontWeight: 'bold' }}>{trimmed.substring(2)}</h1>;
                }
                if (trimmed.startsWith('## ')) {
                  return <h2 key={mIdx} style={{ fontSize: '13.5px', border: 'none', margin: '4px 0 2px 0', fontWeight: 'bold' }}>{trimmed.substring(3)}</h2>;
                }
                if (trimmed.startsWith('### ')) {
                  return <h3 key={mIdx} style={{ fontSize: '12.5px', border: 'none', margin: '3px 0 2px 0', fontWeight: 'bold' }}>{trimmed.substring(4)}</h3>;
                }
                if (trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) {
                  return (
                    <div key={mIdx} style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'line-through', opacity: 0.6 }}>
                      <input type="checkbox" checked readOnly style={{ accentColor: 'var(--accent-color)' }} />
                      <span>{trimmed.substring(6)}</span>
                    </div>
                  );
                }
                if (trimmed.startsWith('- [ ] ')) {
                  return (
                    <div key={mIdx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input type="checkbox" checked={false} readOnly />
                      <span>{trimmed.substring(6)}</span>
                    </div>
                  );
                }
                if (trimmed.startsWith('- ')) {
                  return (
                    <div key={mIdx} style={{ display: 'flex', gap: '6px', paddingLeft: '6px' }}>
                      <span>•</span>
                      <span>{trimmed.substring(2)}</span>
                    </div>
                  );
                }
                const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
                if (numMatch) {
                  return (
                    <div key={mIdx} style={{ display: 'flex', gap: '6px', paddingLeft: '6px' }}>
                      <span style={{ color: 'var(--accent-color)' }}>{numMatch[1]}.</span>
                      <span>{numMatch[2]}</span>
                    </div>
                  );
                }
                if (trimmed === '') {
                  return <div key={mIdx} style={{ height: '4px' }} />;
                }
                return <div key={mIdx}>{parseInlineStylesAndTags(mLine)}</div>;
              })}
            </div>
          );
        };

        return (
          <div className="flow-embed-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{
            margin: '12px 0',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)'
          }}>
            <div className="flow-embed-header" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--accent-color)' }}>
                <Infinity size={13} />
                <span style={{ fontWeight: '600' }}>
                  {sectionHeader ? `GÖMÜLÜ BLOK: ${targetNote.name} > #${sectionHeader}` : `GÖMÜLÜ NOT: ${targetNote.name}`}
                </span>
              </div>
              {!sectionHeader && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFlowEditModes(prev => ({ ...prev, [idx]: !prev[idx] }));
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    padding: '2px 8px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  {isEditing ? 'Önizleme' : 'Düzenle'}
                </button>
              )}
            </div>
            <div className="flow-embed-body" style={{ padding: '8px 12px' }}>
              {isEditing ? (
                <textarea
                  value={embedContent}
                  onChange={async (e) => {
                    const val = e.target.value;
                    if (onSaveNote) {
                      await onSaveNote(targetNote.path, val);
                    }
                  }}
                  placeholder="Bu not henüz boş..."
                  style={{
                    width: '100%',
                    minHeight: '100px',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                    fontFamily: 'inherit',
                    lineHeight: '1.6',
                    resize: 'vertical'
                  }}
                />
              ) : (
                embedContent ? renderMarkdownToHtml(embedContent) : <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>Bu bölüm boş veya bulunamadı...</div>
              )}
            </div>
          </div>
        );
      } else {
        return (
          <div style={{ padding: '8px 12px', color: '#ff4a5a', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '6px', fontSize: '12px', margin: '8px 0' }}>
            ⚠ Gömülü not bulunamadı: <strong>{targetNotePath}</strong>
          </div>
        );
      }
    }

    // 1.9 Code Block Lookahead
    if (line.trim().startsWith('```') && openingCodeBlockIndices.has(idx)) {
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Eğer kullanıcı şu anda bu kod bloğu içindeki herhangi bir satırı düzenliyorsa (aktif odak),
      // önizleme kutusunu göstermeyip tüm satırları tek tek düzenlenebilir normal satırlar olarak render eder.
      const isBeingEdited = activeCodeBlockRange && idx >= activeCodeBlockRange.start && idx <= activeCodeBlockRange.end;
      
      if (!isBeingEdited) {
        let hasClosing = false;
        for (let i = idx + 1; i < lines.length; i++) {
          if (lines[i].trim().startsWith('```')) {
            hasClosing = true;
            break;
          }
        }

        if (hasClosing) {
        const lang = line.trim().substring(3).trim();
        const codeLines: string[] = [];
        let nextIdx = idx + 1;
        while (nextIdx < lines.length) {
          const nextLine = lines[nextIdx];
          if (nextLine.trim().startsWith('```')) {
            break;
          }
          codeLines.push(nextLine);
          nextIdx++;
        }

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Kod bloğunun dili 'mermaid' ise, düz kod göstermek yerine MermaidViewer bileşenini kullanarak canlı akış şemasını çizer.
        // Tıklama eventini durdurmuyoruz (stopPropagation yapmıyoruz) ki kullanıcı şemaya veya altına tıkladığında o satırı düzenleyebilsin.
        if (lang.toLowerCase() === 'mermaid') {
          return (
            <div 
              className="preview-mermaid-container" 
              onClick={(e) => handleLineClick(idx, e)}
              style={{ margin: '10px 0', cursor: 'pointer' }}
            >
              <MermaidViewer code={codeLines.join('\n')} />
            </div>
          );
        }

      return (
        <div className="preview-code-block-container" style={{
          margin: '10px 0',
          background: '#0d0e12',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '6px',
          padding: '12px',
          fontFamily: 'monospace',
          fontSize: '12px',
          overflowX: 'auto',
          position: 'relative'
        }}>
          {lang && <span style={{ position: 'absolute', right: '10px', top: '5px', fontSize: '10px', color: '#64748b', textTransform: 'uppercase' }}>{lang}</span>}
          <pre style={{ margin: 0, padding: 0, color: '#e2e8f0', fontFamily: 'monospace', lineHeight: 1.5 }}>{codeLines.join('\n') || '\n'}</pre>
        </div>
      );
        }
      }
    }

    // 2. Collapsible Details
    const toggleMatch = line.match(/^toggle:\s*(.*)$/i);
    if (toggleMatch) {
      const summaryText = toggleMatch[1] || 'Detaylar';
      const toggledLines: string[] = [];
      let nextIdx = idx + 1;
      while (nextIdx < lines.length) {
        const nextLine = lines[nextIdx];
        if (nextLine.trim() !== '' && !nextLine.startsWith('  ') && !nextLine.startsWith('\t')) {
          break;
        }
        toggledLines.push(nextLine);
        nextIdx++;
      }
      
      return (
        <details className="premium-details" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <summary className="premium-summary" onMouseDown={(e) => e.stopPropagation()}>
            <span className="summary-text">{summaryText}</span>
          </summary>
          <div className="details-content" onMouseDown={(e) => e.stopPropagation()}>
            {toggledLines.filter(l => l.trim()).length === 0 ? (
              <div className="toggle-instruction-placeholder">
                <span>✍️ Detay yazmak için bu satırın altına geçip başına 2 boşluk (veya Tab) bırakarak yazın:</span>
                <code className="toggle-code-example">
                  &nbsp;&nbsp;Buraya detay satırı yazılacak
                </code>
              </div>
            ) : (
              toggledLines.map((tLine, tIdx) => (
                <div key={tIdx} style={{ paddingLeft: '8px', minHeight: '18px' }} onMouseDown={(e) => e.stopPropagation()}>
                  {parseInlineStylesAndTags(tLine.trim())}
                </div>
              ))
            )}
          </div>
        </details>
      );
    }

    // 3. Copier Helper
    const copyMatch = line.match(/^copy:\s*(.*)$/i);
    if (copyMatch) {
      return <CopyHelperWidget text={copyMatch[1]} />;
    }

    // 4. Şablon Helper
    const sablonMatch = line.match(/^şablon:\s*([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ\-]+)/i);
    if (sablonMatch) {
      const sablonType = sablonMatch[1].toLowerCase();
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Bu kısım şablon kelimesinin hem yerleşik şablonlar (mail, toplantı vb.)
      // hem de kullanıcının özel şablonları arasından aranmasını sağlamak için genişletilmiştir.
      const customTemplate = templateNotes.find(t => t.name.toLowerCase() === sablonType || t.name.replace('.md', '').toLowerCase() === sablonType);
      
      return (
        <div className="sablon-widget-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button 
            className="sablon-widget-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (customTemplate) {
                readNoteContent(customTemplate.path).then(content => {
                  const now = new Date();
                  const yyyy = now.getFullYear();
                  const mm = String(now.getMonth() + 1).padStart(2, '0');
                  const dd = String(now.getDate()).padStart(2, '0');
                  const dateStr = `${yyyy}-${mm}-${dd}`;
                  
                  const parsed = content
                    .replace(/\{\{date\}\}/g, dateStr)
                    .replace(/\{\{bugün\}\}/g, dateStr)
                    .replace(/\{\{bugun\}\}/g, dateStr);
                    
                  updateLineContentPreservingPrefix(idx, parsed);
                }).catch(err => {
                  console.error("Şablon yükleme hatası:", err);
                });
              } else {
                let content = '';
                if (sablonType === 'mail') {
                  content = `Merhaba [İsim],\n\n[Konu] hakkında sizinle iletişime geçiyorum. [Detaylar].\n\nİyi çalışmalar,\n[Adınız]`;
                } else if (sablonType === 'toplantı' || sablonType === 'toplanti') {
                  content = `### 📅 Toplantı Notları\n- **Konu:** [Konu]\n- **Katılımcılar:** [İsimler]\n- **Alınan Kararlar:**\n  - [ ] Karar 1\n  - [ ] Karar 2\n- **Aksiyon Planı:**\n  - [ ] [Ad] - [Görev] [due:2026-05-28]`;
                } else if (sablonType === 'plan' || sablonType === 'gunluk') {
                  content = `### ☀️ Günlük Plan\n- [ ] 09:00 - Güne Başlangıç & Kahve\n- [ ] 10:00 - Daily Standup\n- [ ] 11:00 - Odaklanmış Çalışma\n- [ ] 14:00 - Toplantılar\n- [ ] 17:00 - Raporlama & Kapanış`;
                } else {
                  content = `### 📝 Hazır Şablon\n- [ ] [Görev yazın]`;
                }
                updateLineContentPreservingPrefix(idx, content);
              }
            }}
          >
            <Sparkles size={11} />
            <span>📝 Hazır "{sablonType}" Şablonunu Uygula</span>
          </button>
        </div>
      );
    }

    // 5. Habit Tracker
    const habitMatch = line.match(/^her\s+gün:\s*([^\[]+?)(?:\s+\[stats:([x\s]{1,7})\])?\s*$/i);
    if (habitMatch) {
      const habitName = habitMatch[1].trim();
      const stats = (habitMatch[2] || '').padEnd(7, ' ');
      
      const toggleDay = (dayIdx: number) => {
        const charArray = stats.split('');
        charArray[dayIdx] = charArray[dayIdx] === 'x' ? ' ' : 'x';
        const newStats = charArray.join('');
        
        updateLineContentPreservingPrefix(idx, `her gün: ${habitName} [stats:${newStats}]`);
      };
      
      const dayNames = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
      
      return (
        <div className="habit-tracker-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <div className="habit-info" onMouseDown={(e) => e.stopPropagation()}>
            <Activity size={13} className="habit-icon" />
            <span className="habit-name">{habitName}</span>
          </div>
          <div className="habit-strip" onMouseDown={(e) => e.stopPropagation()}>
            {dayNames.map((day, dIdx) => {
              const checked = stats[dIdx] === 'x';
              return (
                <div 
                  key={dIdx} 
                  className={`habit-day-col ${checked ? 'active' : ''}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDay(dIdx);
                  }}
                >
                  <span className="habit-day-label">{day}</span>
                  <div className="habit-day-box">
                    {checked && <Check size={8} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 5.5 Yeni Aylık Alışkanlık Takip Zinciri [habit: Kitap Okuma]
    // Bu widget, kullanıcının belirli alışkanlıkları tüm ay bazında bir ızgara görünümünde takip etmesini sağlar.
    const habitMonthMatch = line.match(/^\[habit:\s*([^\]]+)\](?:\s+\[stats:([x\-_]+)\])?\s*$/i);
    if (habitMonthMatch) {
      const habitName = habitMonthMatch[1].trim();
      const statsRaw = habitMonthMatch[2] || '';
      
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const todayDate = now.getDate();
      
      const cleanStats = statsRaw.padEnd(daysInMonth, '-').slice(0, daysInMonth);
      
      const toggleDay = (dayIdx: number) => {
        const charArray = cleanStats.split('');
        charArray[dayIdx] = charArray[dayIdx] === 'x' ? '-' : 'x';
        const newStats = charArray.join('');
        updateLineContentPreservingPrefix(idx, `[habit: ${habitName}] [stats:${newStats}]`);
      };
      
      const trMonths = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
      ];
      const monthName = trMonths[month];
      
      const firstDayIndex = new Date(year, month, 1).getDay();
      // Pazartesi ilk gün olacak şekilde hizala (Pzt=0, Paz=6)
      const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
      
      const dayNames = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
      
      return (
        <div className="habit-tracker-container" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ minWidth: '220px', maxWidth: '280px' }}>
          <div className="habit-info" onMouseDown={(e) => e.stopPropagation()} style={{ justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={13} className="habit-icon" />
              <span className="habit-name">{habitName}</span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>{monthName}</span>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }} onMouseDown={(e) => e.stopPropagation()}>
            {dayNames.map((dName) => (
              <div key={dName} style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'center' }}>
                {dName}
              </div>
            ))}
            
            {Array.from({ length: startOffset }).map((_, oIdx) => (
              <div key={`offset-${oIdx}`} />
            ))}
            
            {Array.from({ length: daysInMonth }).map((_, dIdx) => {
              const dayNum = dIdx + 1;
              const checked = cleanStats[dIdx] === 'x';
              const isToday = dayNum === todayDate;
              
              return (
                <div
                  key={dIdx}
                  className={`habit-day-col ${checked ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDay(dIdx);
                  }}
                >
                  <div 
                    className="habit-day-box" 
                    style={{
                      width: '22px',
                      height: '22px',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      border: isToday ? '1.5px solid var(--accent-color)' : '1.5px solid rgba(255, 255, 255, 0.08)',
                      boxShadow: isToday ? '0 0 6px rgba(99, 102, 241, 0.4)' : 'none',
                      backgroundColor: checked ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                      color: checked ? '#10b981' : (isToday ? 'var(--accent-color)' : 'var(--text-muted)'),
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {dayNum}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 5.5.5 Dinamik Sorgu Widget'ı [query: sorgu]
    const queryMatch = line.match(/^\[query:\s*([^\]]+)\]\s*$/i);
    if (queryMatch) {
      const queryString = queryMatch[1].trim();
      return (
        <QueryWidget
          queryString={queryString}
          fileContents={fileContents}
          notes={notes}
          setActiveNotePath={setActiveNotePath}
        />
      );
    }

    // 5.6 Dinamik Grafik Oluşturucu [chart: bar] veya [chart: line]
    // Bu widget, altındaki markdown tablosunu görsel bir SVG grafiğe dönüştürür.
    const chartMatch = line.match(/^\[chart:\s*(bar|line)\]\s*$/i);
    if (chartMatch) {
      const chartType = chartMatch[1].toLowerCase() as 'bar' | 'line';
      
      // Grafik altındaki tablo verisini ayrıştırıyoruz.
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Bu kısım grafik çizicinin hem standart markdown | tablolarını hem de
      // excel-lite tablo: Harcamalar, Fiyatlar formatını desteklemesi için genişletilmiştir.
      let nextIdx = idx + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
        nextIdx++;
      }
      
      let hasTable = false;
      let headers: string[] = [];
      const rows: string[][] = [];
      
      if (nextIdx < lines.length) {
        const nextLineClean = lines[nextIdx].trim().toLowerCase();
        
        if (nextLineClean.startsWith('|')) {
          // 1. Standart Markdown Tablosu Ayrıştırma
          const headerLine = lines[nextIdx].trim();
          headers = headerLine.split('|').map(h => h.trim()).filter((h, i, arr) => i > 0 && i < arr.length - 1);
          nextIdx++;
          
          if (nextIdx < lines.length && lines[nextIdx].trim().startsWith('|')) {
            const sepLine = lines[nextIdx].trim();
            if (sepLine.replace(/[\s|:\-]/g, '') === '') {
              nextIdx++;
              while (nextIdx < lines.length) {
                const rowLine = lines[nextIdx].trim();
                if (!rowLine.startsWith('|')) break;
                
                const rowCells = rowLine.split('|').map(c => c.trim()).filter((c, i, arr) => i > 0 && i < arr.length - 1);
                rows.push(rowCells);
                nextIdx++;
              }
              if (rows.length > 0) {
                hasTable = true;
              }
            }
          }
        } else if (nextLineClean.startsWith('tablo:')) {
          // 2. tablo: Formatındaki Excel-Lite Tablosunu Ayrıştırma
          const headerText = lines[nextIdx].trim().substring(6).trim();
          headers = headerText.split(',').map(h => h.trim());
          nextIdx++;
          
          while (nextIdx < lines.length) {
            const rowLine = lines[nextIdx].trim();
            if (rowLine === '' || rowLine.startsWith('#') || rowLine.startsWith('---') || rowLine.startsWith('tablo:') || rowLine.startsWith('pano:') || rowLine.startsWith('flow:')) {
              break;
            }
            const cleanRow = rowLine.replace(/^[-*+]\s+/, '').trim();
            if (cleanRow.includes(',')) {
              rows.push(cleanRow.split(',').map(cell => cell.trim()));
            } else {
              break;
            }
            nextIdx++;
          }
          if (rows.length > 0) {
            hasTable = true;
          }
        }
      }
      
      if (hasTable) {
        return (
          <ChartWidget
            chartType={chartType}
            headers={headers}
            rows={rows}
          />
        );
      }
    }

    // 6. Odak Sayaç (Timer)
    // Geri sayım sayacı. Süre dolduğunda sistem/tarayıcı bildirimi tetikler ve not sonuna log yazar.
    const timerMatch = line.match(/timer\s+(\d+)/i);
    if (timerMatch) {
      const durationMin = parseInt(timerMatch[1], 10);
      return (
        <TimerWidget
          lineIdx={idx}
          durationMin={durationMin}
          activeTimers={activeTimers}
          setActiveTimers={setActiveTimers}
          timerIntervalsRef={timerIntervalsRef}
          playBeepSound={playBeepSound}
          onTimerComplete={() => {
            // Sistem / Tarayıcı bildirimi gönder
            if ('Notification' in window) {
              if (Notification.permission === 'granted') {
                new Notification('⏱️ Odak Süresi Doldu!', {
                  body: `"${durationMin} dakikalık" odağınız tamamlandı. Tebrikler!`,
                });
              } else if (Notification.permission !== 'denied') {
                Notification.requestPermission();
              }
            }
            
            // Çalışma süresini notun sonuna log olarak ekle
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const logLine = `- ${yyyy}-${mm}-${dd}: ${durationMin} dk çalışıldı`;
            
            setEditorContent(prev => {
              const trimmed = prev.trimEnd();
              return trimmed + '\n' + logLine + '\n';
            });
          }}
        />
      );
    }

    // 7. Counter Widget
    const counterMatch = line.match(/counter\s+([a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_\-]+)(?:\s+\[val:(-?\d+)\])?/i);
    if (counterMatch) {
      const counterName = counterMatch[1];
      const countVal = parseInt(counterMatch[2] || '0', 10);
      
      const updateCounter = (newVal: number) => {
        updateLineContentPreservingPrefix(idx, `counter ${counterName} [val:${newVal}]`);
      };
      
      return (
        <div className="inline-counter-widget" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <span className="counter-title">🔢 {counterName}:</span>
          <button 
            className="counter-btn minus"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); updateCounter(countVal - 1); }}
          >
            -
          </button>
          <span className="counter-val">{countVal}</span>
          <button 
            className="counter-btn plus"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); updateCounter(countVal + 1); }}
          >
            +
          </button>
        </div>
      );
    }

    // 8. Alarm Widget
    const alarmMatch = line.match(/alarm\s+(\d{2}:\d{2})/i);
    if (alarmMatch) {
      const alarmTime = alarmMatch[1];
      return (
        <AlarmWidget
          lineIdx={idx}
          alarmTime={alarmTime}
          currentTime={currentTime}
          dismissedAlarms={dismissedAlarms}
          setDismissedAlarms={setDismissedAlarms}
          playBeepSound={playBeepSound}
        />
      );
    }

    // 9. Voice Recorder Widget
    const recordMatch = line.match(/^(record|ses\s+kaydet)(?:\s+\[ses:([^\]]+)\])?$/i);
    if (recordMatch) {
      const sesPath = recordMatch[2] || '';
      return (
        <VoiceRecorderWidget
          lineIdx={idx}
          initialPath={sesPath}
          activeNotePath={activeNotePath!}
          onSaveRecording={(path, transcript) => {
            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            // Ses kaydı tamamlandığında, ses kaydı etiketini güncelliyoruz ve eğer SpeechRecognition ile
            // elde edilmiş bir deşifre metni varsa bunu bir alt satıra otomatik ekliyoruz.
            const linesArr = [...lines];
            linesArr[idx] = `record [ses:${path}]`;
            if (transcript) {
              linesArr.splice(idx + 1, 0, `  Deşifre: "${transcript}"`);
            }
            setEditorContent(linesArr.join('\n'));
          }}
          voiceRecordersRef={voiceRecordersRef}
          voiceChunksRef={voiceChunksRef}
        />
      );
    }

    // 9.5 Video Recorder Widget
    const videoMatch = line.match(/^(video|video\s+kaydet)(?:\s+\[video:([^\]]+)\])?$/i);
    if (videoMatch) {
      const videoPath = videoMatch[2] || '';
      return (
        <VideoRecorderWidget
          lineIdx={idx}
          initialPath={videoPath}
          activeNotePath={activeNotePath!}
          onSaveVideo={(path) => {
            updateLineContentPreservingPrefix(idx, `video [video:${path}]`);
          }}
        />
      );
    }

    // 9.6 YouTube Embed Widget
    // Match any YouTube watch, share or embed URLs (e.g. youtube.com/embed/XYZ or watch?v=XYZ) or standard iframe tags
    const ytIdMatch = line.match(/(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/v\/)([a-zA-Z0-9_\-]{11})/i) ||
                      line.match(/src="[^"]*youtube\.com\/embed\/([a-zA-Z0-9_\-]{11})/i);
    if (ytIdMatch && !line.includes('![')) {
      const ytId = ytIdMatch[1];
      // Clean up the line text to remove the iframe or raw link code, preserving surrounding text
      const cleanLine = line
        .replace(/<iframe[^>]*>([\s\S]*?)<\/iframe>/gi, '')
        .replace(/https?:\/\/(?:www\.)?(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/v\/)[a-zA-Z0-9_\-]{11}(?:\S*)?/gi, '')
        .trim();
      const renderedText = cleanLine ? parseInlineStylesAndTags(cleanLine, idx) : null;
      return (
        <div 
          className="youtube-embed-line-container" 
          style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {renderedText && <div className="youtube-embed-text-line">{renderedText}</div>}
          <div 
            className="youtube-embed-widget" 
            onClick={(e) => e.stopPropagation()} 
            onMouseDown={(e) => e.stopPropagation()}
            style={{ 
              margin: '6px 0 12px 0', 
              borderRadius: '12px', 
              overflow: 'hidden', 
              boxShadow: '0 8px 30px rgba(0,0,0,0.5)', 
              maxWidth: '560px', 
              width: '100%',
              aspectRatio: '16/9',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: '#000'
            }}
          >
            <iframe
              width="100%"
              height="100%"
              src={`https://www.youtube-nocookie.com/embed/${ytId}`}
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ display: 'block', border: 'none' }}
            ></iframe>
          </div>
        </div>
      );
    }

    // 10. Canvas Çizim Widget
    const sketchMatch = line.match(/^(çiz|sketch)(?:\s+\[sketch:([^\]]+)\])?$/i);
    if (sketchMatch) {
      const sketchPath = sketchMatch[2] || '';
      return (
        <SketchpadWidget
          lineIdx={idx}
          initialPath={sketchPath}
          activeNotePath={activeNotePath!}
          onSaveSketch={(path) => {
            updateLineContentPreservingPrefix(idx, `çiz [sketch:${path}]`);
          }}
        />
      );
    }

    // Fallbacks
    let renderedText: React.ReactNode[] = parseInlineStylesAndTags(line, idx);

    // 11. Yüzde, Döviz, running totals
    const calcNode = getInlineCalculationsNode(line);
    if (calcNode) {
      return (
        <div className="line-with-calc">
          <span>{renderedText}</span>
          {calcNode}
        </div>
      );
    }

    // 12. Takvim Parser
    const calendarBtn = getCalendarBtnNode(line, idx);
    if (calendarBtn) {
      return (
        <div className="line-with-calendar-btn">
          <span>{renderedText}</span>
          {calendarBtn}
        </div>
      );
    }

    const hasFloat = line.includes('|left') || line.includes('|right');
    if (hasFloat) {
      return (
        <div style={{ display: 'flow-root', width: '100%', overflow: 'visible' }}>
          {renderedText}
        </div>
      );
    }

    return <span>{renderedText}</span>;
  };

  const parseInlineStylesAndTags = (text: string, lineIdx?: number): React.ReactNode[] => {
    if (!text) return [];

    const regex = /(==.*?==|\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)?|\[[^\]]*\]\([^)]*\)?|\[\^[a-zA-Z0-9_-]+\]|\*\*.*?\*\*|\*.*?\*|`.*?`|#[a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_-]+|\[\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]|\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]|\[due:\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]|\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]|\[(?:harcama|gider|gelir|yatırım|yatirim|tasarruf|fiyat):\s*[^\]]+\])/gi;
    const parts = text.split(regex);
    const { map: footnoteMap } = getDetailedFootnotes();

    return parts.map((part, i) => {
      if (part.startsWith('==') && part.endsWith('==')) {
        const inner = part.slice(2, -2);
        let colorClass = 'highlight-yellow';
        let cleanText = inner;
        
        if (inner.startsWith('red:') || inner.startsWith('kırmızı:')) {
          colorClass = 'highlight-red';
          cleanText = inner.substring(inner.indexOf(':') + 1);
        } else if (inner.startsWith('green:') || inner.startsWith('yeşil:')) {
          colorClass = 'highlight-green';
          cleanText = inner.substring(inner.indexOf(':') + 1);
        } else if (inner.startsWith('blue:') || inner.startsWith('mavi:')) {
          colorClass = 'highlight-blue';
          cleanText = inner.substring(inner.indexOf(':') + 1);
        } else if (inner.startsWith('purple:') || inner.startsWith('mor:')) {
          colorClass = 'highlight-purple';
          cleanText = inner.substring(inner.indexOf(':') + 1);
        }
        
        return (
          <mark key={i} className={`preview-highlight ${colorClass}`}>
            {cleanText}
          </mark>
        );
      }
      if (part.startsWith('![') && part.includes('](')) {
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Resim veya video markdown formatını ayrıştırır. Alt etiketi içindeki hizalama takısına
        // (örn. |left, |right, |center) ve boyutlara (örn. |w:560|h:315 veya |560x315) bakarak 
        // float, genişlik, yükseklik ve kenar boşluğu stillerini ayarlar.
        // YouTube veya yerel video durumuna göre görsel mi, video oynatıcı mı yoksa YouTube iframe'i mi çizileceğine karar verir.
        const altText = part.substring(2, part.indexOf(']('));
        const imgUrlPart = part.substring(part.indexOf('](') + 2);
        const imgUrl = imgUrlPart.endsWith(')') ? imgUrlPart.slice(0, -1) : imgUrlPart;
        
        const altParts = altText.split('|');
        const cleanAlt = altParts[0];
        
        let align = 'center';
        let width = '100%';
        let height = 'auto';
        let customWidthNum = 560;
        let customHeightNum = 315;
        
        altParts.forEach((p: string) => {
          const trimP = p.trim().toLowerCase();
          if (trimP === 'left' || trimP === 'right' || trimP === 'center') {
            align = trimP;
          } else if (trimP.startsWith('width:') || trimP.startsWith('w:')) {
            const wVal = trimP.split(':')[1];
            width = wVal + (wVal.endsWith('%') || wVal.endsWith('px') ? '' : 'px');
            customWidthNum = parseInt(wVal) || 560;
          } else if (trimP.startsWith('height:') || trimP.startsWith('h:')) {
            const hVal = trimP.split(':')[1];
            height = hVal + (hVal.endsWith('%') || hVal.endsWith('px') ? '' : 'px');
            customHeightNum = parseInt(hVal) || 315;
          } else if (trimP.includes('x') && !isNaN(parseInt(trimP.split('x')[0]))) {
            const dims = trimP.split('x');
            customWidthNum = parseInt(dims[0]) || 560;
            customHeightNum = parseInt(dims[1]) || 315;
            width = customWidthNum + 'px';
            height = customHeightNum + 'px';
          }
        });
        
        let finalSrc = imgUrl;
        if (isElectron && !imgUrl.startsWith('http') && !imgUrl.startsWith('data:')) {
          finalSrc = `app-media://${imgUrl}`;
        }

        let floatStyle: React.CSSProperties = {};
        if (align === 'left') {
          floatStyle = { float: 'left', marginRight: '16px', marginBottom: '8px', clear: 'none', display: 'inline-block' };
        } else if (align === 'right') {
          floatStyle = { float: 'right', marginLeft: '16px', marginBottom: '8px', clear: 'none', display: 'inline-block' };
        } else {
          floatStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '12px auto', clear: 'both', width: '100%' };
        }

        // YouTube Link Kontrolü
        const ytIdMatch = imgUrl.match(/(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/v\/)([a-zA-Z0-9_\-]{11})/i);
        if (ytIdMatch) {
          const ytId = ytIdMatch[1];
          return (
            <div key={i} className="preview-media-container" style={{ ...floatStyle, width: width === '100%' ? `${customWidthNum}px` : width, maxWidth: '100%' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ position: 'relative', width: '100%', height: height === 'auto' ? `${customHeightNum}px` : height, borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)', background: '#000' }}>
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                  title="YouTube video player"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  style={{ display: 'block', border: 'none' }}
                ></iframe>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>🎥 YouTube: {cleanAlt || 'Video'}</span>
              
              {lineIdx !== undefined && (
                <div 
                  className="media-resize-handle" 
                  onMouseDown={(e) => handleResizeMouseDown(e, lineIdx)}
                />
              )}
            </div>
          );
        }

        const isVideo = imgUrl.toLowerCase().match(/\.(mp4|webm|ogg)$/i) || cleanAlt.toLowerCase().includes('video');

        if (isVideo) {
          return (
            <div key={i} className="preview-media-container" style={{ ...floatStyle, width: width === '100%' ? '320px' : width, maxWidth: '100%' }} onClick={(e) => e.stopPropagation()}>
              <video
                src={finalSrc}
                controls
                style={{ width: '100%', height: height === 'auto' ? 'auto' : height, maxHeight: height === 'auto' ? '240px' : 'none', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'block' }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>🎥 {cleanAlt || 'Video'}</span>
              
              {lineIdx !== undefined && (
                <div 
                  className="media-resize-handle" 
                  onMouseDown={(e) => handleResizeMouseDown(e, lineIdx)}
                />
              )}
            </div>
          );
        }

        return (
          <div key={i} className="preview-media-container" style={{ ...floatStyle, width: width === '100%' ? 'auto' : width, maxWidth: '100%' }} onClick={(e) => e.stopPropagation()}>
            {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                Önceden bu stil "maxHeight: 180px" olarak sabitti ve kaydedilmiş
                w:/h: boyutlarını hiç okumuyordu. Kullanıcı resmi sürükleyip
                büyüttükten sonra (handleResizeMouseUp ile satıra doğru şekilde
                yazılan boyutlar), hizalama butonuna tıklamak React'i yeniden
                render ettiriyor ve bu sabit 180px sınırı resmi tekrar küçültüp
                "eski boyutuna dönmüş" gibi gösteriyordu. Artık kaydedilmiş
                boyut varsa onu, yoksa varsayılan 180px sınırını kullanıyoruz. */}
            <img src={finalSrc} alt={cleanAlt} style={{
              width: height !== 'auto' ? '100%' : 'auto',
              height: height !== 'auto' ? height : 'auto',
              maxHeight: height !== 'auto' ? 'none' : '180px',
              maxWidth: '100%',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              display: 'block'
            }} onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }} />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>✨ {cleanAlt || 'Görsel'}</span>
            
            {lineIdx !== undefined && (
              <div
                className="media-resize-handle" 
                onMouseDown={(e) => handleResizeMouseDown(e, lineIdx)}
              />
            )}
          </div>
        );
      }
      if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
        const linkText = part.substring(1, part.indexOf(']('));
        const linkUrl = part.substring(part.indexOf('](') + 2, part.length - 1);
        if (!part.startsWith('[[') && !part.startsWith('[p:') && !part.startsWith('[due:') && !part.startsWith('[repeat:')) {
          return (
            <a
              key={i}
              href={linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="preview-web-link"
              style={{ color: 'var(--accent-color, #818cf8)', textDecoration: 'underline', cursor: 'pointer' }}
              onClick={(e) => e.stopPropagation()}
            >
              {linkText || linkUrl}
            </a>
          );
        }
      }
      if (part.startsWith('[') && part.endsWith(']') && (part.includes('harcama:') || part.includes('gider:') || part.includes('gelir:') || part.includes('yatırım:') || part.includes('yatirim:') || part.includes('tasarruf:') || part.includes('fiyat:'))) {
        const cleanPart = part.slice(1, -1);
        const [type, val] = cleanPart.split(':');
        const amountStr = val ? val.trim() : '';
        let label = 'Tutar';
        let className = 'finance-spending';
        let icon = '💸';
        
        if (type.toLowerCase() === 'gelir') {
          label = 'Gelir';
          className = 'finance-income';
          icon = '📥';
        } else if (type.toLowerCase() === 'yatırım' || type.toLowerCase() === 'yatirim') {
          label = 'Yatırım';
          className = 'finance-investment';
          icon = '📈';
        } else if (type.toLowerCase() === 'tasarruf') {
          label = 'Tasarruf';
          className = 'finance-savings';
          icon = '🏦';
        } else if (type.toLowerCase() === 'fiyat') {
          label = 'Fiyat';
          className = 'finance-price';
          icon = '🏷️';
        }
        
        return (
          <span key={i} className={`preview-finance-badge ${className}`} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '600',
            background: className === 'finance-income' ? 'rgba(16, 185, 129, 0.15)' : className === 'finance-spending' || className === 'finance-price' ? 'rgba(239, 68, 68, 0.15)' : className === 'finance-investment' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(168, 85, 247, 0.15)',
            color: className === 'finance-income' ? '#10b981' : className === 'finance-spending' || className === 'finance-price' ? '#ef4444' : className === 'finance-investment' ? '#f59e0b' : '#a855f7',
            margin: '0 4px',
            border: `1px solid ${className === 'finance-income' ? 'rgba(16, 185, 129, 0.3)' : className === 'finance-spending' || className === 'finance-price' ? 'rgba(239, 68, 68, 0.3)' : className === 'finance-investment' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(168, 85, 247, 0.3)'}`
          }}>
            <span>{icon}</span>
            <span>{amountStr} {!amountStr.toLowerCase().includes('tl') && 'TL'}</span>
          </span>
        );
      }
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const inner = part.slice(2, -2);
        const [target, label] = inner.split('|');
        const targetName = target.trim();
        const displayLabel = label ? label.trim() : targetName;
        const targetNote = notes.find(n => n.name.toLowerCase() === targetName.toLowerCase());
        const exists = !!targetNote;

        return (
          <span
            key={i}
            className={`wiki-link ${exists ? 'exists' : 'broken'}`}
            onClick={(e) => {
              e.stopPropagation();
              handleWikiLinkClick(targetName, exists);
            }}
            onMouseEnter={(e) => {
              cancelHideWikiPreview();
              const r = e.currentTarget.getBoundingClientRect();
              setHoveredWikiLink({ targetName, exists, x: r.left, y: r.bottom + 2 });
            }}
            onMouseLeave={scheduleHideWikiPreview}
            onContextMenu={(e) => {
              if (!exists || !targetNote) return;
              e.preventDefault();
              e.stopPropagation();
              setHoveredWikiLink(null);
              onNoteContextMenu?.(e, targetNote.path);
            }}
            title={exists ? `"${targetName}" notunu aç (önizleme için Ctrl + üzerine gel, sağ tık ile sekme/bölme seçenekleri için)` : `"${targetName}" notunu oluştur ve aç`}
          >
            {displayLabel}
          </span>
        );
      }
      if (part.startsWith('[^') && part.endsWith(']')) {
        const label = part.slice(2, -1);
        const footnote = footnoteMap[label];
        const index = footnote ? footnote.index : '?';
        const footnoteContent = footnote ? footnote.content : 'Dipnot tanımı bulunamadı.';
        const defId = footnote ? `editor-line-${footnote.lineIdx}` : `fn-def-${label}`;

        return (
          <a
            key={i}
            href={`#${defId}`}
            id={`fn-ref-${label}`}
            className="footnote-ref"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              scrollToElement(defId);
            }}
            title={footnoteContent}
          >
            {index}
          </a>
        );
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="preview-strong">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="preview-em">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="preview-code">{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('#')) {
        return null;
      }
      if (part.startsWith('[p:') && part.endsWith(']')) {
        const priority = part.slice(3, -1).toLowerCase();
        let label = 'Düşük';
        let className = 'priority-low';

        if (priority === 'critical' || priority === 'acil') {
          label = 'Acil';
          className = 'priority-critical';
        } else if (priority === 'high' || priority === 'yüksek') {
          label = 'Yüksek';
          className = 'priority-high';
        } else if (priority === 'medium' || priority === 'orta') {
          label = 'Orta';
          className = 'priority-medium';
        }

        return (
          <span key={i} className={`preview-priority-badge ${className}`}>
            {label}
          </span>
        );
      }
      if (part.startsWith('[due:') && part.endsWith(']')) {
        const dueDateVal = part.slice(5, -1);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const dueDate = new Date(dueDateVal.split(' ')[0]);
        dueDate.setHours(0, 0, 0, 0);
        const isOverdue = dueDate < now;

        return (
          <span key={i} className={`preview-due-badge ${isOverdue ? 'overdue' : ''}`} title="Bitiş Tarihi">
            <Calendar size={11} style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            <span style={{ verticalAlign: 'middle' }}>Bitiş: {dueDateVal}</span>
          </span>
        );
      }
      if (part.startsWith('[repeat:') && part.endsWith(']')) {
        const val = part.slice(8, -1).toLowerCase();
        let label = 'Tekrarlar';
        if (val === 'daily' || val === 'günlük') label = '🔄 Günlük';
        else if (val === 'weekly' || val === 'haftalık') label = '🔄 Haftalık';
        else if (val === 'monthly' || val === 'aylık') label = '🔄 Aylık';

        return (
          <span key={i} className="preview-repeat-badge" title="Tekrarlayan Görev">
            {label}
          </span>
        );
      }
      if (part.startsWith('[') && part.endsWith(']') && /\d{4}-\d{2}-\d{2}/.test(part)) {
        const dateVal = part.slice(1, -1);
        return (
          <span key={i} className="preview-timestamp-badge" title="Tarih damgası">
            <Clock size={11} style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle', opacity: 0.7 }} />
            <span style={{ verticalAlign: 'middle' }}>{dateVal}</span>
          </span>
        );
      }
      return part;
    });
  };

  const handleLineClick = (idx: number, e?: React.MouseEvent) => {
    // Clear selection on single line click
    setDragSelectStartIdx(null);
    setDragSelectEndIdx(null);
    setShowWikiSuggestions(false);

    // If user is drag-selecting text (mouse moved between mousedown and click), preserve selection
    if (e && mouseDownCoordsRef.current) {
      const dx = Math.abs(e.clientX - mouseDownCoordsRef.current.x);
      const dy = Math.abs(e.clientY - mouseDownCoordsRef.current.y);
      if (dx > 5 || dy > 5) {
        mouseDownCoordsRef.current = null;
        return;
      }
    }
    mouseDownCoordsRef.current = null;

    // If user has actively selected text, do not focus the line (preserve selection)
    if (window.getSelection()?.toString().trim()) {
      return;
    }

    setFocusedLineIdx(idx);
    const lineText = lines[idx];
    const isChecklist = getChecklistInfo(lineText);
    const isBullet = getBulletInfo(lineText);
    const isOrdered = getOrderedListInfo(lineText);

    let charIdx = lineText.length;
    if (isChecklist) {
      charIdx = isChecklist.content.length;
    } else if (isBullet) {
      charIdx = isBullet.content.length;
    } else if (isOrdered) {
      charIdx = isOrdered.content.length;
    }

    if (e && e.clientX !== undefined && e.clientY !== undefined) {
      let offset = -1;
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range && range.startContainer) {
          offset = range.startOffset;
        }
      } else if ((document as any).caretPositionFromPoint) {
        const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
        if (pos && pos.offsetNode) {
          offset = pos.offset;
        }
      }
      if (offset !== -1) {
        charIdx = offset;
      }
    }

    setCaretPos({ lineIdx: idx, charIdx });
  };

  const handleLineFocus = (idx: number) => {
    setFocusedLineIdx(idx);
    setDragSelectStartIdx(null);
    setDragSelectEndIdx(null);
    setSelectionInfo(null);

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Daktilo (Typewriter) modu aktifken, odaklanılan satırın otomatik olarak ekranın tam ortasına scroll edilmesini sağlar.
    const el = lineRefs.current[idx];
    if (isTypewriterModeRef.current && el) {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Kıvılcım efektleri için imlecin tam koordinatlarını (x, y) hatasız ve kayma olmadan bulmak amacıyla
  // yazılan özel yardımcı fonksiyon. Parent element referanslı çalışarak sidebar veya sayfa kaymalarından etkilenmez.
  //
  // PERFORMANS NOTU: Bu fonksiyon eskiden her çağrıda yeni bir <div>/<span>
  // oluşturup DOM'a ekleyip ölçüp siliyordu — bu, tarayıcıyı senkron bir
  // "forced reflow" (zorunlu yeniden düzen hesaplaması) yapmaya zorlar ve her
  // tuş vuruşunda tekrarlandığında ciddi bir donmaya yol açar. Artık aynalama
  // (mirror) elemanı bir ref'te bir kez oluşturulup DOM'a bir kez eklenir ve
  // sonraki çağrılarda yeniden kullanılır; yalnızca zorunlu tek bir layout
  // okuması (offsetTop/offsetLeft) kalır, node oluşturma/ekleme/silme reflow'ları
  // ortadan kalkar.
  const sparkMirrorRef = useRef<{ div: HTMLDivElement; span: HTMLSpanElement } | null>(null);
  const lastSparkTimeRef = useRef(0);

  useEffect(() => {
    return () => {
      if (sparkMirrorRef.current) {
        sparkMirrorRef.current.div.remove();
        sparkMirrorRef.current = null;
      }
    };
  }, []);

  const getSparkCaretCoordinates = (element: HTMLTextAreaElement, position: number) => {
    if (!sparkMirrorRef.current) {
      const div = document.createElement('div');
      const span = document.createElement('span');
      div.style.position = 'fixed';
      div.style.visibility = 'hidden';
      div.style.top = '0';
      div.style.left = '0';
      div.style.pointerEvents = 'none';
      div.appendChild(span);
      document.body.appendChild(div);
      sparkMirrorRef.current = { div, span };
    }
    const { div, span } = sparkMirrorRef.current;
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
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.width = `${element.clientWidth}px`;

    const textBeforeCaret = element.value.substring(0, position);
    div.textContent = '';
    div.appendChild(document.createTextNode(textBeforeCaret));
    span.textContent = element.value.substring(position, position + 1) || '.';
    div.appendChild(span);

    const lineHeightVal = parseInt(style.lineHeight || '');
    const finalLineHeight = isNaN(lineHeightVal) ? parseInt(style.fontSize || '14') * 1.25 : lineHeightVal;

    // Tek zorunlu layout okuması burada gerçekleşir.
    const coordinates = {
      top: span.offsetTop + finalLineHeight - element.scrollTop,
      left: span.offsetLeft - element.scrollLeft
    };

    return coordinates;
  };

  const handleLineChange = (
    idx: number,
    newValue: string,
    prefix = '',
    selectionStart?: number,
    e?: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const oldLine = lines[idx];
    const newLine = prefix ? `${prefix}${newValue}` : newValue;

    const oldInfo = getLineTypeAndOffset(oldLine);
    const newInfo = getLineTypeAndOffset(newLine);

    const newLines = [...lines];
    newLines[idx] = newLine;

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Kullanıcı bir satırda 3. ters tırnağı (```) yazıp kod bloğu başlattığında,
    // Obsidian stili otomatik tamamlama yaparak bir alt satıra da ``` kapanış satırı ekler.
    const isAddingThirdBacktick = newLine.trim() === '```' && oldLine.trim() === '``';
    if (isAddingThirdBacktick) {
      newLines.splice(idx + 1, 0, '```');
      
      if (e) {
        const target = e.target;
        setTimeout(() => {
          target.focus();
          target.selectionStart = newLine.length;
          target.selectionEnd = newLine.length;
        }, 10);
      }
    }

    setEditorContent(newLines.join('\n'));

    if (oldInfo.type !== newInfo.type) {
      const newAbsoluteCaret = selectionStart !== undefined ? selectionStart : newLine.length;
      const newCaretPos = Math.max(0, newAbsoluteCaret - newInfo.prefixLen);

      setFocusedLineIdx(idx);
      setCaretPos({ lineIdx: idx, charIdx: newCaretPos });
    } else {
      if (e) {
        updateCaretPosition(e.target, idx);
      }
    }

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Dinamik Klavye Hızı ve Kıvılcım (Power Mode) hesaplamaları ve tetiklemeleri.
    if (e && isFlowEffectsEnabled) {
      const now = Date.now();
      const diff = newLine.length - oldLine.length;
      
      if (diff > 0) {
        // Ortalama hız istatistiği için toplam karakter ve net aktif yazma süresi takibi
        // (artık senkron localStorage yazmıyor, bkz. typingStatsRef flush mekanizması)
        const stats = typingStatsRef.current;
        if (lastTypeTime > 0) {
          const elapsed = now - lastTypeTime;
          stats.totalTimeMs += elapsed < 3000 ? elapsed : 200;
        } else {
          // İlk vuruş için varsayılan 200ms aktif süre ekle
          stats.totalTimeMs += 200;
        }
        stats.totalChars += diff;
        stats.dirty = true;

        // Keystroke zaman takibi (anlık sıçramaları engellemek için son 5 saniye kullanılır)
        setKeystrokes(prev => {
          const filtered = prev.filter(t => now - t < 5000);
          filtered.push(now);

          // CPS (Saniyedeki Karakter) hesaplaması (5 saniyeye bölüyoruz)
          const cps = filtered.length / 5;
          if (cps > 1.2) {
            setComboCount(c => c + 1);
          }

          // WPM (Dakika Başına Kelime) hesaplaması: (CPS * 60) / 5
          const calculatedWpm = Math.round(cps * 12);
          setCurrentWpm(calculatedWpm);

          // En yüksek hız (Max WPM) kaydı (bellekte; diske periyodik flush edilir)
          if (calculatedWpm > stats.maxWpm) {
            stats.maxWpm = calculatedWpm;
            stats.dirty = true;
          }

          return filtered;
        });

        // İmleç koordinatlarını bulup kıvılcımları Canvas üzerinde canlandırıyoruz.
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Koordinat hesaplaması hâlâ (azaltılmış da olsa) bir layout okuması
        // gerektirdiğinden, hızlı yazımda her tuşta değil en fazla ~45ms'de bir
        // tetiklenecek şekilde throttle edilir. Görsel akıcılık kaybolmaz
        // (parçacıklar zaten süzülerek sönüyor) ama layout maliyeti düşer.
        if (now - lastSparkTimeRef.current >= 45) {
          lastSparkTimeRef.current = now;
          const textarea = e.target;
          const caret = textarea.selectionStart;
          try {
            const caretCoords = getSparkCaretCoordinates(textarea, caret);
            const rect = textarea.getBoundingClientRect();
            let x = rect.left + caretCoords.left;
            let y = rect.top + caretCoords.top;

            const canvas = canvasRef.current;
            if (canvas) {
              const canvasRect = canvas.getBoundingClientRect();
              x = x - canvasRect.left;
              y = y - canvasRect.top;
            }

            spawnParticles(x, y);
          } catch (err) {
            // Hata durumunda uygulamanın göçmemesi için sessizce yakalanır
          }
        }
      }

      setLastTypeTime(now);
    }

    // Wiki-link autocomplete trigger logic
    if (e) {
      checkWikiTrigger(e.target);
    }

    // Slash command trigger logic
    if (e) {
      const caret = e.target.selectionStart;
      const text = e.target.value;
      
      const beforeCaret = text.substring(0, caret);
      const lastSlashIdx = beforeCaret.lastIndexOf('/');
      if (lastSlashIdx !== -1) {
        const isStartOrSpace = lastSlashIdx === 0 || beforeCaret[lastSlashIdx - 1] === ' ';
        if (isStartOrSpace) {
          const filter = beforeCaret.substring(lastSlashIdx + 1);
          if (!filter.includes(' ')) {
            setShowSlashMenu(true);
            setSlashMenuLineIdx(idx);
            setSlashMenuFilter(filter);
            setActiveSlashOptionIdx(0);
          } else {
            setShowSlashMenu(false);
          }
        } else {
          setShowSlashMenu(false);
        }
      } else {
        setShowSlashMenu(false);
      }
    }
  };

  // Apply annotation tag to the focused line (priority, due date, time slot)
  const applyAnnotation = (type: 'priority' | 'due' | 'time', value: string) => {
    if (focusedLineIdx === null) return;
    const el = lineRefs.current[focusedLineIdx];
    const caretBefore = el ? el.selectionStart : 0;

    const newLines = [...lines];
    const currentLine = newLines[focusedLineIdx];

    if (type === 'priority') {
      // Remove existing [p:xxx] tag and add new one
      const cleaned = currentLine.replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '').trimEnd();
      newLines[focusedLineIdx] = `${cleaned} [p:${value}]`;
    } else if (type === 'due') {
      // Remove existing [due:xxx] tag and add new one
      const cleaned = currentLine.replace(/\[due:\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]/g, '').trimEnd();
      newLines[focusedLineIdx] = `${cleaned} [due:${value}]`;
    } else if (type === 'time') {
      // Remove existing [time:xxx] or [ts:xxx] annotations and add new
      const cleaned = currentLine.replace(/\[time:[^\]]+\]/g, '').trimEnd();
      newLines[focusedLineIdx] = `${cleaned} [time:${value}]`;
    }

    setEditorContent(newLines.join('\n'));

    // Restore caret position
    setTimeout(() => {
      const targetEl = lineRefs.current[focusedLineIdx!];
      if (targetEl) {
        targetEl.focus();
        const pos = Math.min(caretBefore, targetEl.value.length);
        targetEl.setSelectionRange(pos, pos);
        setCaretPos({ lineIdx: focusedLineIdx!, charIdx: pos });
      }
    }, 30);
  };

  const applyFormat = (formatType: string) => {
    if (focusedLineIdx === null) return;

    const el = lineRefs.current[focusedLineIdx];
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const fullLine = lines[focusedLineIdx];

    if (formatType === 'bold' || formatType === 'italic' || formatType === 'code' || formatType.startsWith('highlight-')) {
      const isChecklist = getChecklistInfo(fullLine);
      const isBullet = getBulletInfo(fullLine);
      const isOrdered = getOrderedListInfo(fullLine);

      const val = el.value;
      const selectedText = val.substring(start, end);

      let wrapped = '';
      let markerLen = 0;
      if (formatType === 'bold') {
        wrapped = `**${selectedText}**`;
        markerLen = 2;
      } else if (formatType === 'italic') {
        wrapped = `*${selectedText}*`;
        markerLen = 1;
      } else if (formatType === 'code') {
        wrapped = `\`${selectedText}\``;
        markerLen = 1;
      } else if (formatType.startsWith('highlight-')) {
        const color = formatType.substring(10); // 'yellow', 'red', etc.
        const prefix = color === 'yellow' ? '==' : `==${color}:`;
        wrapped = `${prefix}${selectedText}==`;
        markerLen = prefix.length;
      }

      const newVal = val.substring(0, start) + wrapped + val.substring(end);
      
      let newFullLine = '';
      if (isChecklist) {
        newFullLine = `${isChecklist.prefix}${isChecklist.status}${isChecklist.spacer}${newVal}`;
      } else if (isBullet) {
        newFullLine = `${isBullet.prefix}${newVal}`;
      } else if (isOrdered) {
        newFullLine = `${isOrdered.prefix}${newVal}`;
      } else {
        newFullLine = newVal;
      }

      const newLines = [...lines];
      newLines[focusedLineIdx] = newFullLine;
      setEditorContent(newLines.join('\n'));

      setTimeout(() => {
        const targetEl = lineRefs.current[focusedLineIdx!];
        if (targetEl) {
          targetEl.focus();
          const newCaretPos = selectedText ? start + wrapped.length : start + markerLen;
          targetEl.setSelectionRange(newCaretPos, newCaretPos);
          setCaretPos({ lineIdx: focusedLineIdx!, charIdx: newCaretPos });
        }
      }, 50);
    } else {
      const isChecklist = getChecklistInfo(fullLine);
      const isBullet = getBulletInfo(fullLine);
      const isOrdered = getOrderedListInfo(fullLine);
      const isHeading = fullLine.match(/^(#{1,6})\s+(.*)$/);

      let cleanContent = fullLine;
      if (isChecklist) cleanContent = isChecklist.content;
      else if (isBullet) cleanContent = isBullet.content;
      else if (isOrdered) cleanContent = isOrdered.content;
      else if (isHeading) cleanContent = isHeading[2];

      let alreadySelected = false;
      if (formatType === 'h1' && isHeading && isHeading[1].length === 1) alreadySelected = true;
      else if (formatType === 'h2' && isHeading && isHeading[1].length === 2) alreadySelected = true;
      else if (formatType === 'h3' && isHeading && isHeading[1].length === 3) alreadySelected = true;
      else if (formatType === 'checklist' && isChecklist) alreadySelected = true;
      else if (formatType === 'bullet' && isBullet) alreadySelected = true;
      else if (formatType === 'ordered' && isOrdered) alreadySelected = true;

      let newFullLine = '';
      if (alreadySelected) {
        newFullLine = cleanContent;
      } else {
        if (formatType === 'h1') newFullLine = `# ${cleanContent}`;
        else if (formatType === 'h2') newFullLine = `## ${cleanContent}`;
        else if (formatType === 'h3') newFullLine = `### ${cleanContent}`;
        else if (formatType === 'checklist') newFullLine = `- [ ] ${cleanContent}`;
        else if (formatType === 'bullet') newFullLine = `- ${cleanContent}`;
        else if (formatType === 'ordered') newFullLine = `1. ${cleanContent}`;
      }

      const newLines = [...lines];
      newLines[focusedLineIdx] = newFullLine;
      setEditorContent(newLines.join('\n'));

      setTimeout(() => {
        const targetEl = lineRefs.current[focusedLineIdx!];
        if (targetEl) {
          targetEl.focus();
          const targetChar = cleanContent.length;
          targetEl.setSelectionRange(targetChar, targetChar);
          setCaretPos({ lineIdx: focusedLineIdx!, charIdx: targetChar });
        }
      }, 50);
    }
  };

  const getActiveLineType = () => {
    if (focusedLineIdx === null) return 'paragraph';
    const line = lines[focusedLineIdx];
    if (!line) return 'paragraph';
    const isChecklist = getChecklistInfo(line);
    if (isChecklist) return 'checklist';
    const isBullet = getBulletInfo(line);
    if (isBullet) return 'bullet';
    const isOrdered = getOrderedListInfo(line);
    if (isOrdered) return 'ordered';
    const isHeading = line.match(/^(#{1,6})\s+(.*)$/);
    if (isHeading) {
      const level = isHeading[1].length;
      if (level === 1) return 'h1';
      if (level === 2) return 'h2';
      if (level === 3) return 'h3';
    }
    return 'paragraph';
  };

  const activeType = getActiveLineType();


  const handleLineKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, idx: number) => {
    const textarea = e.currentTarget;
    const val = textarea.value;
    const caret = textarea.selectionStart;
    const fullLine = lines[idx];

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Obsidian stili otomatik tamamlama çiftleri. Parantez, tırnak veya köşeli parantez açıldığında
    // otomatik olarak kapatma karakterini ekler ve imleci ikisinin arasına konumlandırır.
    const autoClosePairs: Record<string, string> = {
      '[': ']',
      '(': ')',
      '{': '}',
      '"': '"',
      "'": "'"
    };

    if (autoClosePairs[e.key] !== undefined) {
      e.preventDefault();
      const closingChar = autoClosePairs[e.key];
      const selectedText = val.substring(caret, textarea.selectionEnd);
      const newText = val.substring(0, caret) + e.key + selectedText + closingChar + val.substring(textarea.selectionEnd);
      
      const newLines = [...lines];
      newLines[idx] = newText;
      setEditorContent(newLines.join('\n'));
      
      setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = caret + 1;
        textarea.selectionEnd = caret + 1 + selectedText.length;
      }, 10);
      return;
    }

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Geri tuşuna (Backspace) basıldığında, otomatik açılmış parantez/tırnak çiftinin ortasındaysak
    // her iki karakteri de (açılış ve kapanış) birlikte siler.
    if (e.key === 'Backspace' && caret === textarea.selectionEnd && caret > 0) {
      const prevChar = val[caret - 1];
      const nextChar = val[caret];
      if ((prevChar === '[' && nextChar === ']') ||
          (prevChar === '(' && nextChar === ')') ||
          (prevChar === '{' && nextChar === '}') ||
          (prevChar === '"' && nextChar === '"') ||
          (prevChar === "'" && nextChar === "'")) {
        e.preventDefault();
        const newText = val.substring(0, caret - 1) + val.substring(caret + 1);
        const newLines = [...lines];
        newLines[idx] = newText;
        setEditorContent(newLines.join('\n'));
        
        setTimeout(() => {
          textarea.focus();
          textarea.selectionStart = caret - 1;
          textarea.selectionEnd = caret - 1;
        }, 10);
        return;
      }
    }



    // Handle Slash Menu autocomplete navigation keys
    if (showSlashMenu) {
      const filtered = slashOptions.filter(opt => 
        opt.label.toLowerCase().includes(slashMenuFilter.toLowerCase()) || 
        opt.desc.toLowerCase().includes(slashMenuFilter.toLowerCase())
      );
      if (filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveSlashOptionIdx(prev => (prev + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveSlashOptionIdx(prev => (prev - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          executeSlashCommand(filtered[activeSlashOptionIdx], idx);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowSlashMenu(false);
          return;
        }
      }
    }

    // TAB: Indent / Outdent line
    if (e.key === 'Tab' && !showWikiSuggestions) {
      e.preventDefault();
      
      const isShift = e.shiftKey;
      const currentLine = lines[idx];
      let newLine = currentLine;
      let shiftAmount = 0;
      
      if (isShift) {
        // Outdent: Remove up to 2 leading spaces or 1 tab
        if (currentLine.startsWith('  ')) {
          newLine = currentLine.substring(2);
          shiftAmount = -2;
        } else if (currentLine.startsWith(' ')) {
          newLine = currentLine.substring(1);
          shiftAmount = -1;
        } else if (currentLine.startsWith('\t')) {
          newLine = currentLine.substring(1);
          shiftAmount = -1;
        }
      } else {
        // Indent: Add 2 leading spaces
        newLine = '  ' + currentLine;
        shiftAmount = 2;
      }
      
      if (newLine !== currentLine) {
        const newLines = [...lines];
        newLines[idx] = newLine;
        setEditorContent(newLines.join('\n'));
        
        const oldInfo = getLineTypeAndOffset(currentLine);
        const hasSeparateContent = oldInfo.type !== 'paragraph';
        const newCaretCharIdx = hasSeparateContent ? caret : Math.max(0, caret + shiftAmount);
        
        setFocusedLineIdx(idx);
        setCaretPos({ lineIdx: idx, charIdx: newCaretCharIdx });
      }
      return;
    }

    // Handle Wiki autocomplete suggestions keys
    if (showWikiSuggestions && filteredWikiOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveWikiSuggestionIndex(prev => (prev + 1) % filteredWikiOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveWikiSuggestionIndex(prev => (prev - 1 + filteredWikiOptions.length) % filteredWikiOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectWikiSuggestion(filteredWikiOptions[activeWikiSuggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowWikiSuggestions(false);
        return;
      }
    }

    // Ctrl+A: Select All Shortcut override
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setDragSelectStartIdx(0);
      setDragSelectEndIdx(lines.length - 1);
      setFocusedLineIdx(null);
      return;
    }

    // Ctrl+B: Bold Shortcut
    if (e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      applyFormat('bold');
      return;
    }
    // Ctrl+I: Italic Shortcut
    if (e.ctrlKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      applyFormat('italic');
      return;
    }

    // ENTER: Split line and keep bullets/checklists format
    if (e.key === 'Enter') {
      e.preventDefault();
      
      const isChecklist = getChecklistInfo(fullLine);
      const isBullet = getBulletInfo(fullLine);
      const isOrdered = getOrderedListInfo(fullLine);

      if (isChecklist && isChecklist.content.trim() === '') {
        const newLines = [...lines];
        newLines[idx] = '';
        setEditorContent(newLines.join('\n'));
        setFocusedLineIdx(idx);
        setCaretPos({ lineIdx: idx, charIdx: 0 });
        return;
      }

      if (isBullet && isBullet.content.trim() === '') {
        const newLines = [...lines];
        newLines[idx] = '';
        setEditorContent(newLines.join('\n'));
        setFocusedLineIdx(idx);
        setCaretPos({ lineIdx: idx, charIdx: 0 });
        return;
      }

      if (isOrdered && isOrdered.content.trim() === '') {
        const newLines = [...lines];
        newLines[idx] = '';
        setEditorContent(newLines.join('\n'));
        setFocusedLineIdx(idx);
        setCaretPos({ lineIdx: idx, charIdx: 0 });
        return;
      }
      
      let prefixOffset = 0;
      if (isChecklist) {
        prefixOffset = isChecklist.prefix.length + isChecklist.status.length + isChecklist.spacer.length;
      } else if (isBullet) {
        prefixOffset = isBullet.prefix.length;
      } else if (isOrdered) {
        prefixOffset = isOrdered.prefix.length;
      }

      const absoluteCaret = prefixOffset + caret;
      const lineBefore = fullLine.substring(0, absoluteCaret);
      let lineAfter = fullLine.substring(absoluteCaret);

      let newLinePrefix = '';
      if (isChecklist) {
        const indentMatch = isChecklist.prefix.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        newLinePrefix = `${indent}- [ ] `;
      } else if (isBullet) {
        const indentMatch = isBullet.prefix.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        newLinePrefix = `${indent}- `;
      } else if (isOrdered) {
        const nextNumber = parseInt(isOrdered.number, 10) + 1;
        const indentMatch = isOrdered.prefix.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        newLinePrefix = `${indent}${nextNumber}. `;
      }

      lineAfter = `${newLinePrefix}${lineAfter}`;

      const newLines = [...lines];
      newLines[idx] = lineBefore;
      newLines.splice(idx + 1, 0, lineAfter);

      setEditorContent(newLines.join('\n'));
      setFocusedLineIdx(idx + 1);
      setCaretPos({ lineIdx: idx + 1, charIdx: 0 });
      return;
    }

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // BUG DÜZELTMESİ: Backspace tuşu basılı tutulup HIZLI art arda satır birleştirirken/
    // önek (- [ ], -, 1. vb.) kaldırırken imlecin yanlış yere (çoğunlukla satır başına)
    // atladığı bildirildi. Kök neden: React, aynı JS görevi içinde art arda gelen birden
    // fazla native keydown olayını (OS'in tuş tekrarı çok hızlı ürettiğinde) TEK bir
    // render'da toplu işleyebilir (React 18 otomatik batching). Bu durumda 2. tuş vuruşu,
    // 1. vuruşun state güncellemesi henüz DOM'a/closure'a yansımadan ESKİ (stale) `lines`/
    // `idx` üzerinden çalışıp yanlış bir sonuç üretebiliyordu. flushSync, her tuş vuruşunun
    // state güncellemesini VE bağlı DOM commit'ini (yeni textarea'nın mount'u + yukarıdaki
    // "Focus and Caret restore" useLayoutEffect'in çalışması dahil) fonksiyon geri dönmeden
    // ÖNCE, senkron olarak tamamlar — böylece bir sonraki (kuyruktaki) native keydown olayı
    // ancak DOM tamamen güncel ve imleç doğru konumdayken işlenmeye başlar.
    // BACKSPACE at cursor 0: Convert prefixes or join lines
    if (e.key === 'Backspace' && caret === 0 && textarea.selectionStart === textarea.selectionEnd) {
      const isChecklist = getChecklistInfo(fullLine);
      if (isChecklist) {
        e.preventDefault();
        flushSync(() => {
          const newLines = [...lines];
          newLines[idx] = isChecklist.content;
          setEditorContent(newLines.join('\n'));
          setCaretPos({ lineIdx: idx, charIdx: 0 });
        });
        return;
      }

      const isBullet = getBulletInfo(fullLine);
      if (isBullet) {
        e.preventDefault();
        flushSync(() => {
          const newLines = [...lines];
          newLines[idx] = isBullet.content;
          setEditorContent(newLines.join('\n'));
          setCaretPos({ lineIdx: idx, charIdx: 0 });
        });
        return;
      }

      const isOrdered = getOrderedListInfo(fullLine);
      if (isOrdered) {
        e.preventDefault();
        flushSync(() => {
          const newLines = [...lines];
          newLines[idx] = isOrdered.content;
          setEditorContent(newLines.join('\n'));
          setCaretPos({ lineIdx: idx, charIdx: 0 });
        });
        return;
      }

      const isHeading = fullLine.match(/^(#{1,6}\s+)(.*)$/);
      if (isHeading) {
        e.preventDefault();
        flushSync(() => {
          const newLines = [...lines];
          newLines[idx] = isHeading[2];
          setEditorContent(newLines.join('\n'));
          setCaretPos({ lineIdx: idx, charIdx: 0 });
        });
        return;
      }

      // Join with previous line
      if (idx > 0) {
        e.preventDefault();
        const prevLine = lines[idx - 1];
        const prevInfo = getChecklistInfo(prevLine) || getBulletInfo(prevLine) || getOrderedListInfo(prevLine);
        const prevLength = prevInfo ? prevInfo.content.length : prevLine.length;

        flushSync(() => {
          const newLines = [...lines];
          newLines[idx - 1] = prevLine + val;
          newLines.splice(idx, 1);

          setEditorContent(newLines.join('\n'));
          setFocusedLineIdx(idx - 1);
          setCaretPos({ lineIdx: idx - 1, charIdx: prevLength });
        });
      }
      return;
    }

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // BUG DÜZELTMESİ: Eskiden ArrowUp yalnızca caret===0 iken, ArrowDown yalnızca
    // caret===val.length iken devreye giriyordu — yani yatay imleç konumu ne olursa
    // olsun bir üst/alt satıra HER ZAMAN satır sonuna/başına atlıyordu, ve satırın
    // ortasındaysanız ilk tuş basışı native (tarayıcı) davranışını tetikleyip imleci
    // O SATIR İÇİNDE konum 0'a/sonuna götürüyordu — kullanıcının "iki kez basmam
    // gerekiyor ve imleç hep satır sonuna gidiyor" şikayetinin kaynağı buydu.
    // Satırlar otomatik büyüyen (word-wrap) textarea'lar olduğundan (adjustHeight),
    // uzun bir paragraf birden fazla görsel satıra sarabilir — bu yüzden yalnızca
    // imleç textarea'nın GÖRSEL OLARAK ilk satırındaysa (ArrowUp) / son satırındaysa
    // (ArrowDown) mantıksal satır değiştiriyoruz; aksi halde native davranış sarılmış
    // metin içinde satır değiştirir. Hedef satıra geçerken aynı karakter sütununu
    // (satır uzunluğuna kırpılmış) koruyoruz ki imleç "alttakinin hizasında" çıksın.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const isSameRow = (a: number, b: number) => Math.abs(a - b) < 2;
      const caretTop = getCaretCoordinates(textarea, caret).top;

      if (e.key === 'ArrowUp') {
        const firstRowTop = getCaretCoordinates(textarea, 0).top;
        if (isSameRow(caretTop, firstRowTop) && idx > 0) {
          e.preventDefault();
          const prevLineText = lines[idx - 1];
          const prevInfo = getChecklistInfo(prevLineText) || getBulletInfo(prevLineText) || getOrderedListInfo(prevLineText);
          const prevContent = prevInfo ? prevInfo.content : prevLineText;
          setFocusedLineIdx(idx - 1);
          setCaretPos({ lineIdx: idx - 1, charIdx: Math.min(caret, prevContent.length) });
        }
        return;
      }

      // ArrowDown
      const lastRowTop = getCaretCoordinates(textarea, val.length).top;
      if (isSameRow(caretTop, lastRowTop) && idx < lines.length - 1) {
        e.preventDefault();
        const nextLineText = lines[idx + 1];
        const nextInfo = getChecklistInfo(nextLineText) || getBulletInfo(nextLineText) || getOrderedListInfo(nextLineText);
        const nextContent = nextInfo ? nextInfo.content : nextLineText;
        setFocusedLineIdx(idx + 1);
        setCaretPos({ lineIdx: idx + 1, charIdx: Math.min(caret, nextContent.length) });
      }
      return;
    }
  };


  const handleLineBlur = (idx: number) => {
    // Rename note if title line (idx === 0) is blurred and has changed
    if (idx === 0 && activeNote && activeNotePath) {
      const firstLineText = lines[0];
      if (firstLineText) {
        const cleanTitle = firstLineText.replace(/^#\s*/, '').trim();
        const activeName = activeNote.name;
        if (cleanTitle && cleanTitle !== activeName) {
          const parts = activeNotePath.split('/');
          const filename = `${getCleanFilename(cleanTitle)}.md`;
          parts[parts.length - 1] = filename;
          const newPath = parts.join('/');
          
          if (newPath !== activeNotePath) {
            onRenameNote(activeNotePath, newPath);
          }
        }
      }
    }
  };

  const handleEmptyAreaClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowWikiSuggestions(false);
    const newLines = [...lines];
    newLines.push('');
    setEditorContent(newLines.join('\n'));
    const newIdx = newLines.length - 1;
    setFocusedLineIdx(newIdx);
    setCaretPos({ lineIdx: newIdx, charIdx: 0 });
  };

  const toggleDictation = () => {
    if (isDictating) {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      setIsDictating(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Tarayıcınız sesli dikte özelliğini desteklemiyor.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'tr-TR';

    recognition.onstart = () => {
      setIsDictating(true);
    };

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const addedText = event.results[i][0].transcript + ' ';
          setEditorContent((prev) => {
            if (focusedLineIdx !== null && focusedLineIdx < prev.split('\n').length) {
              const newLines = prev.split('\n');
              newLines[focusedLineIdx] = newLines[focusedLineIdx] + addedText;
              return newLines.join('\n');
            }
            return prev + addedText;
          });
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      setIsDictating(false);
    };

    recognition.onend = () => {
      setIsDictating(false);
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
  };

  const handleContainerClick = () => {
    setShowWikiSuggestions(false);
    if (focusedLineIdx === null && lines.length > 0) {
      const lastIdx = lines.length - 1;
      setFocusedLineIdx(lastIdx);
      setCaretPos({ lineIdx: lastIdx, charIdx: lines[lastIdx].length });
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${timestamp}_${safeName}`;
        
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            await platform.writeNote(`assets/${fileName}`, dataUrl);
            
            const mdImage = `\n![${safeName}|center](assets/${fileName})\n`;
            
            setEditorContent(prev => {
              if (focusedLineIdx !== null && focusedLineIdx < lines.length) {
                const newLines = prev.split('\n');
                newLines[focusedLineIdx] = newLines[focusedLineIdx] + mdImage;
                return newLines.join('\n');
              }
              return prev + mdImage;
            });
          };
          reader.readAsDataURL(file);
        } catch (err) {
          console.error("Failed to save dropped image", err);
        }
      } else if (file.type.startsWith('video/')) {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${timestamp}_${safeName}`;
        
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            await platform.writeNote(`assets/${fileName}`, dataUrl);
            
            const mdVideo = `\n![video_${safeName}|center](assets/${fileName})\n`;
            
            setEditorContent(prev => {
              if (focusedLineIdx !== null && focusedLineIdx < lines.length) {
                const newLines = prev.split('\n');
                newLines[focusedLineIdx] = newLines[focusedLineIdx] + mdVideo;
                return newLines.join('\n');
              }
              return prev + mdVideo;
            });
          };
          reader.readAsDataURL(file);
        } catch (err) {
          console.error("Failed to save dropped video", err);
        }
      }
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Panodan kopyalanan resim veya video verilerini yakalayıp yerel assets klasörüne kaydeder ve
    // markdown formatında varsayılan "center" (ortalanmış) hizalama parametresiyle editöre ekler.
    const items = e.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const timestamp = Date.now();
          const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.-]/g, '_') : `pasted_image_${timestamp}.png`;
          const fileName = `${timestamp}_${safeName}`;
          
          try {
            const reader = new FileReader();
            reader.onload = async () => {
              const dataUrl = reader.result as string;
              await platform.writeNote(`assets/${fileName}`, dataUrl);
              
              const mdImage = `\n![${safeName}|center](assets/${fileName})\n`;
              
              setEditorContent(prev => {
                if (focusedLineIdx !== null && focusedLineIdx < lines.length) {
                  const newLines = prev.split('\n');
                  newLines[focusedLineIdx] = newLines[focusedLineIdx] + mdImage;
                  return newLines.join('\n');
                }
                return prev + mdImage;
              });
            };
            reader.readAsDataURL(file);
          } catch (err) {
            console.error("Failed to save pasted image", err);
          }
        }
        break;
      } else if (item.type.indexOf('video') !== -1) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const timestamp = Date.now();
          const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.-]/g, '_') : `pasted_video_${timestamp}.mp4`;
          const fileName = `${timestamp}_${safeName}`;
          
          try {
            const reader = new FileReader();
            reader.onload = async () => {
              const dataUrl = reader.result as string;
              await platform.writeNote(`assets/${fileName}`, dataUrl);
              
              const mdVideo = `\n![video_${safeName}|center](assets/${fileName})\n`;
              
              setEditorContent(prev => {
                if (focusedLineIdx !== null && focusedLineIdx < lines.length) {
                  const newLines = prev.split('\n');
                  newLines[focusedLineIdx] = newLines[focusedLineIdx] + mdVideo;
                  return newLines.join('\n');
                }
                return prev + mdVideo;
              });
            };
            reader.readAsDataURL(file);
          } catch (err) {
            console.error("Failed to save pasted video", err);
          }
        }
        break;
      }
    }
  };

  // Blok Taşıma ve Boyutlandırma State ve Event Handler'ları (Kural 5)
  const [dragOverIdx, setDragOverIdx] = useState<{ idx: number; position: 'top' | 'bottom' } | null>(null);
  const dragLineIdxRef = useRef<number | null>(null);
  const resizeStateRef = useRef<{ lineIdx: number; startX: number; startWidth: number; startHeight: number; aspectRatio: number } | null>(null);

  const handleResizeMouseDown = (e: React.MouseEvent, lineIdx: number) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Görsel veya videonun resize handle'ına tıklandığında mouse drag takibini başlatır.
    e.preventDefault();
    e.stopPropagation();
    
    const container = (e.target as HTMLElement).closest('.preview-media-container') as HTMLElement;
    if (!container) return;
    
    const imgOrVideo = container.querySelector('img, video, iframe') as HTMLElement;
    if (!imgOrVideo) return;
    
    const rect = imgOrVideo.getBoundingClientRect();
    
    resizeStateRef.current = {
      lineIdx,
      startX: e.clientX,
      startWidth: rect.width,
      startHeight: rect.height,
      aspectRatio: rect.width / (rect.height || 1)
    };
    
    document.addEventListener('mousemove', handleResizeMouseMove);
    document.addEventListener('mouseup', handleResizeMouseUp);
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Sürükleme esnasında sadece DOM stillerini güncelleyerek anlık ve son derece akıcı boyutlanma sağlar.
    if (!resizeStateRef.current) return;
    const state = resizeStateRef.current;
    
    const deltaX = e.clientX - state.startX;
    let newWidth = Math.max(80, Math.min(800, state.startWidth + deltaX));
    let newHeight = Math.round(newWidth / state.aspectRatio);
    
    const container = document.getElementById(`editor-line-${state.lineIdx}`)?.querySelector('.preview-media-container') as HTMLElement;
    if (container) {
      container.style.width = `${newWidth}px`;
      const imgOrVideo = container.querySelector('img, video, iframe') as HTMLElement;
      if (imgOrVideo) {
        imgOrVideo.style.width = '100%';
        imgOrVideo.style.height = `${newHeight}px`;
        imgOrVideo.style.maxHeight = 'none';
        imgOrVideo.style.maxWidth = 'none';
      }
      
      const iframeContainer = container.querySelector('div') as HTMLElement;
      if (iframeContainer && iframeContainer !== container) {
        iframeContainer.style.height = `${newHeight}px`;
      }
    }
  };

  const handleResizeMouseUp = (e: MouseEvent) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Sürükleme bittiğinde nihai boyutları piksel cinsinden markdown koduna w:XYZ|h:ABC olarak yazar ve kaydeder.
    document.removeEventListener('mousemove', handleResizeMouseMove);
    document.removeEventListener('mouseup', handleResizeMouseUp);
    
    if (!resizeStateRef.current) return;
    const state = resizeStateRef.current;
    
    const container = document.getElementById(`editor-line-${state.lineIdx}`)?.querySelector('.preview-media-container') as HTMLElement;
    if (container) {
      const imgOrVideo = container.querySelector('img, video, iframe') as HTMLElement;
      if (imgOrVideo) {
        const rect = imgOrVideo.getBoundingClientRect();
        const finalWidth = Math.round(rect.width);
        const finalHeight = Math.round(rect.height);
        
        const currentLines = editorContent.split('\n');
        const currentLine = currentLines[state.lineIdx];
        if (!currentLine) return;
        const updatedLine = currentLine.replace(/!\[(.*?)\]\((.*?)\)/, (match, alt, url) => {
          const altParts = alt.split('|');
          const cleanAlt = altParts[0];
          
          let align = 'center';
          altParts.forEach((p: string) => {
            const t = p.trim().toLowerCase();
            if (t === 'left' || t === 'right' || t === 'center') {
              align = t;
            }
          });
          
          return `![${cleanAlt}|w:${finalWidth}|h:${finalHeight}|${align}](${url})`;
        });
        
        if (updatedLine !== currentLine) {
          const newLines = [...currentLines];
          newLines[state.lineIdx] = updatedLine;
          setEditorContent(newLines.join('\n'));
        }
      }
    }
    resizeStateRef.current = null;
  };

  const handleLineDragStart = (e: React.DragEvent, idx: number) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Satır taşıma (Drag) işlemi başladığında sürüklenen satır indeksini "line:idx" formatında kaydeder.
    // Ayrıca sürükle-seç (drag selection) durumunu sıfırlayarak seçimin takılı kalmasını önler.
    setIsDragging(false);
    setDragSelectStartIdx(null);
    setDragSelectEndIdx(null);
    
    dragLineIdxRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `line:${idx}`);
  };

  const handleLineDragOver = (e: React.DragEvent, idx: number) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Sürüklenen satır başka bir satırın üzerine geldiğinde drop göstergesini (çizgisini) hesaplar.
    if (dragLineIdxRef.current === null || dragLineIdxRef.current === idx) return;
    e.preventDefault();
    
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const position = mouseY < rect.height / 2 ? 'top' : 'bottom';
    
    setDragOverIdx({ idx, position });
  };

  const handleLineDragLeave = () => {
    setDragOverIdx(null);
  };

  const handleLineDragEnd = () => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Sürükleme bittiğinde dragging ve drag-seçim durumlarını sıfırlar.
    dragLineIdxRef.current = null;
    setDragOverIdx(null);
    setIsDragging(false);
  };

  const handleLineDrop = (e: React.DragEvent, targetIdx: number) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Satır bırakıldığında lines dizisindeki elemanların yerini kaydırarak markdown metnini günceller.
    // Ayrıca sürükle-seç durumunu sıfırlar.
    e.preventDefault();
    const rawData = e.dataTransfer.getData('text/plain');
    if (!rawData || !rawData.startsWith('line:')) return;
    const sourceIdx = parseInt(rawData.split(':')[1], 10);
    if (isNaN(sourceIdx) || sourceIdx === targetIdx) return;
    
    const newLines = editorContent.split('\n');
    const [removed] = newLines.splice(sourceIdx, 1);
    
    let insertIdx = targetIdx;
    if (dragOverIdx?.position === 'bottom') {
      insertIdx = targetIdx + 1;
    }
    
    if (sourceIdx < insertIdx) {
      insertIdx--;
    }
    
    newLines.splice(insertIdx, 0, removed);
    setEditorContent(newLines.join('\n'));
    
    dragLineIdxRef.current = null;
    setDragOverIdx(null);
    setIsDragging(false);
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Şablon içinde {{tarih}}, {{saat}}, {{tarihsaat}}, {{başlık}} yer tutucularını, notun
  // oluşturulduğu ana ait gerçek değerlerle değiştirir. Böylece kullanıcı kendi şablonlarını
  // (.templates klasöründe) bu değişkenlerle yazabilir ve her yeni not otomatik doldurulur.
  const applyTemplateVariables = (content: string, title: string): string => {
    const now = new Date();
    const tarih = now.toLocaleDateString('tr-TR');
    const saat = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const tarihsaat = `${tarih} ${saat}`;
    return content
      .replace(/\{\{\s*tarihsaat\s*\}\}/gi, tarihsaat)
      .replace(/\{\{\s*tarih\s*\}\}/gi, tarih)
      .replace(/\{\{\s*saat\s*\}\}/gi, saat)
      .replace(/\{\{\s*başlık\s*\}\}/gi, title)
      .replace(/\{\{\s*baslik\s*\}\}/gi, title);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteName.trim()) return;

    let initialContent = '';
    if (creatingType === 'rfc') {
      if (selectedTemplatePath !== 'default-rfc') {
        try {
          initialContent = await readNoteContent(selectedTemplatePath);
        } catch (err) {
          console.error("Failed to read template content:", err);
        }
      } else {
        initialContent = `# 🏗️ RFC: ${newNoteName.trim()}

> [!IMPORTANT]
> **MÜHENDİSLİK PLANI VE DÜŞÜNME KONTROL LİSTESİ**
> Kod yazmaya BAŞLAMADAN önce bu planı doldurmalısınız. Bu plan, sizi düz bir yazılımcı olarak değil, sistemi içselleştiren bir yazılım mühendisi olarak düşünmeye yönlendirir.

- [ ] 🎯 **1. HEDEF VE PROBLEM TANIMI**
  *Bu özellik neden gerekli? Çözdüğümüz iş problemi nedir? Bittiğinde kime ne kazandıracak?*
  - 

- [ ] 🏗️ **2. SİSTEM ÇÖZÜMÜ VE MİMARİ**
  *Veri akışı nasıl olacak? Hangi bileşenler/dosyalar değişecek? Veritabanı veya API değişecek mi?*
  - 
  - [ ] 🎨 **Önce Arayüz (Frontend-First):** Backend/veritabanı modellerini tasarlamadan önce kullanıcı arayüzünü (UI/akışını) çizerek veri ihtiyaçlarını son kullanıcının gözünden görerek netleştir.

- [ ] ⚡ **3. ÖNGÖRÜLEMEYEN RİSKLER VE AÇIKLAR (EDGE CASES)**
  *Kullanıcı yanlış girdi verirse ne olur? Limitler neler? Güvenlik ve performans açıkları ne olabilir? Projeyi gelecekte nasıl etkiler?*
  - 

- [ ] 🧪 **4. DOĞRULAMA VE BİRİM TEST PLANI**
  *Bu işin doğru şekilde tamamlandığını kod düzeyinde nasıl doğrulayacağız?*
  - 

- [ ] ⚙️ **5. SİSTEM TEST SENARYOLARI (UÇTAN UCA - E2E)**
  *Kullanıcının yapacağı adım adım E2E test yolları neler? (Örn: Giriş yap -> A butonuna tıkla -> Ekranda B verisinin geldiğini doğrula)*
  - 

---
## Notlar & Karalamalar
`;
      }
      initialContent = applyTemplateVariables(initialContent, newNoteName.trim());
    }

    await onCreateNote(newNoteName.trim(), selectedFolder, creatingType === 'drawio' ? 'drawio' : creatingType === 'excalidraw', creatingType === 'rfc' ? initialContent : undefined);
    setNewNoteName('');
    setIsCreating(false);
  };

  const activeNote = notes.find(n => n.path === activeNotePath);

  const renderTaskDetailDrawer = (lineIdx: number, taskContent: string) => {
    const priorityMatch = taskContent.match(/\[p:(critical|acil|high|yüksek|medium|orta|low|düşük)\]/i);
    let currentPriority: 'critical' | 'high' | 'medium' | 'low' = 'low';
    if (priorityMatch) {
      const p = priorityMatch[1].toLowerCase();
      if (p === 'critical' || p === 'acil') currentPriority = 'critical';
      else if (p === 'high' || p === 'yüksek') currentPriority = 'high';
      else if (p === 'medium' || p === 'orta') currentPriority = 'medium';
    }

    const isImportant = currentPriority === 'medium' || currentPriority === 'critical';
    const isUrgent = currentPriority === 'high' || currentPriority === 'critical';

    const dueMatch = taskContent.match(/\[due:(\d{4}-\d{2}-\d{2})\]/);
    const currentDueDate = dueMatch ? dueMatch[1] : '';

    const repeatMatch = taskContent.match(/\[repeat:(daily|günlük|weekly|haftalık|monthly|aylık)\]/i);
    let currentRepeat = 'none';
    if (repeatMatch) {
      const r = repeatMatch[1].toLowerCase();
      if (r === 'daily' || r === 'günlük') currentRepeat = 'daily';
      else if (r === 'weekly' || r === 'haftalık') currentRepeat = 'weekly';
      else if (r === 'monthly' || r === 'aylık') currentRepeat = 'monthly';
    }

    const score = calculateTaskScore(taskContent);

    return (
      <div className="task-details-drawer animate-fade">
        <div className="drawer-row">
          <div className="row-label">
            <RefreshCw size={14} />
            <span>TEKRAR</span>
          </div>
          <div className="row-control">
            <select
              value={currentRepeat}
              onChange={(e) => handleUpdateTaskMetadata(
                lineIdx,
                taskContent,
                isImportant,
                isUrgent,
                currentDueDate,
                e.target.value
              )}
              className="drawer-select"
            >
              <option value="none">Tekrarlamaz</option>
              <option value="daily">Günlük (Daily)</option>
              <option value="weekly">Haftalık (Weekly)</option>
              <option value="monthly">Aylık (Monthly)</option>
            </select>
          </div>
        </div>

        <div className="drawer-row">
          <div className="row-label">
            <Calendar size={14} />
            <span>TESLİM TARİHİ</span>
          </div>
          <div className="row-control">
            <input
              type="date"
              value={currentDueDate}
              onChange={(e) => handleUpdateTaskMetadata(
                lineIdx,
                taskContent,
                isImportant,
                isUrgent,
                e.target.value,
                currentRepeat
              )}
              className="drawer-date-input"
            />
          </div>
        </div>

        <div className="drawer-row">
          <div className="row-label">
            <Star size={14} />
            <span>ÖNCELİK</span>
          </div>
          <div className="row-control-pills">
            <button
              type="button"
              className={`pill-btn ${isImportant ? 'active' : ''}`}
              onClick={() => handleUpdateTaskMetadata(
                lineIdx,
                taskContent,
                !isImportant,
                isUrgent,
                currentDueDate,
                currentRepeat
              )}
            >
              Önemli (Important)
            </button>
            <button
              type="button"
              className={`pill-btn ${isUrgent ? 'active' : ''}`}
              onClick={() => handleUpdateTaskMetadata(
                lineIdx,
                taskContent,
                isImportant,
                !isUrgent,
                currentDueDate,
                currentRepeat
              )}
            >
              Acil (Urgent)
            </button>
          </div>
        </div>

        <div className="drawer-row">
          <div className="row-label">
            <Clock size={14} />
            <span>GÖREV PUANI</span>
          </div>
          <div className="row-control-score">
            <div className="score-num-display">{score}</div>
            <span className="score-desc-lbl">Task Score</span>
          </div>
        </div>

        <div className="drawer-footer-actions">
          <button
            type="button"
            className="footer-action-btn cross-btn"
            onClick={() => {
              handleToggleCheckboxInEditor(lineIdx);
              setExpandedTaskIdx(null);
            }}
          >
            GÖREVİ ÇİZ / TAMAMLA
          </button>
          <span className="action-divider">|</span>
          <button
            type="button"
            className="footer-action-btn delete-btn"
            onClick={() => {
              if (confirm('Bu görevi tamamen silmek istediğinize emin misiniz?')) {
                handleDeleteTaskLine(lineIdx);
              }
            }}
          >
            GÖREVİ SİL
          </button>
          <button
            type="button"
            className="btn-drawer-done"
            onClick={() => setExpandedTaskIdx(null)}
          >
            TAMAM
          </button>
        </div>
      </div>
    );
  };

  const renderContextualToolbar = (idx: number) => {
    return null;
  };



  return (
    <div className="notes-container animate-fade">
      {/* Scoped CSS Style Injection for Zen Focus Mode */}
      <style dangerouslySetInnerHTML={{__html: `
        body.zen-mode .sidebar,
        body.zen-mode .notes-sidebar,
        body.zen-mode .editor-header .active-note-meta,
        body.zen-mode .editor-header .toolbar-btn:not(.zen-toggle-btn):not(.typewriter-toggle-btn) {
          display: none !important;
        }
        body.zen-mode .main-viewport {
          padding: 0 !important;
        }
        body.zen-mode .notes-editor {
          flex: 1 !important;
          width: 100% !important;
          max-width: 800px !important;
          margin: 0 auto !important;
          border: none !important;
          box-shadow: none !important;
          background: transparent !important;
        }
        body.zen-mode .editor-content {
          padding: 40px 20px !important;
          max-width: 700px !important;
          margin: 0 auto !important;
        }
        body.zen-mode .notes-container {
          background: var(--bg-main) !important;
        }
      `}} />
      {/* Sidebar List of Notes */}
      {!hideSidebar && (
        <div className={`notes-sidebar ${activeNotePath ? 'hidden-mobile' : ''}`}>
          <div className="sidebar-header">
            {(() => {
              if (selectedFolder) {
                const custom = folderCustomizations[selectedFolder] || {};
                const customColor = custom.color;
                const customIconName = custom.icon || 'Folder';
                const CustomFolderIcon = iconMap[customIconName] || Folder;
                return (
                  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                  // Çok uzun klasör isimlerinin sidebar genişliğini aşarak sağdaki butonları taşırmasını
                  // ve sekmelerle üst üste binmesini engellemek için ellipsis (üç nokta) uyguluyoruz.
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: customColor || undefined, minWidth: 0, flex: 1 }}>
                    <CustomFolderIcon size={18} style={{ color: customColor || undefined, flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>@{selectedFolder}</span>
                  </h2>
                );
              }
              return <h2>Tüm Notlar</h2>;
            })()}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn-new-note" onClick={() => { setCreatingType('note'); setIsCreating(true); }}>
                <Plus size={16} />
                <span>Yeni Not</span>
              </button>
              <button className="btn-new-note" onClick={() => { setCreatingType('excalidraw'); setIsCreating(true); }} title="Yeni Excalidraw Çizimi" style={{ background: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.3)' }}>
                <PenTool size={16} />
              </button>
            </div>
          </div>

          {isCreating && (
            <form onSubmit={handleCreate} className="create-note-form">
              <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                <button type="button" onClick={() => setCreatingType('note')} style={{ flex: 1, padding: '4px 4px', fontSize: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: creatingType === 'note' ? 'var(--accent-color)' : 'transparent', color: creatingType === 'note' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                  <FileText size={10} /> Not
                </button>
                <button type="button" onClick={() => setCreatingType('excalidraw')} style={{ flex: 1, padding: '4px 4px', fontSize: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: creatingType === 'excalidraw' ? 'rgba(139, 92, 246, 0.9)' : 'transparent', color: creatingType === 'excalidraw' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                  <PenTool size={10} /> Çizim
                </button>
                <button type="button" onClick={() => setCreatingType('rfc')} style={{ flex: 1, padding: '4px 4px', fontSize: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: creatingType === 'rfc' ? 'rgba(16, 185, 129, 0.9)' : 'transparent', color: creatingType === 'rfc' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                  <Layout size={10} /> Şablon
                </button>
                <button type="button" onClick={() => setCreatingType('drawio')} title="draw.io diyagramı (internet gerektirir)" style={{ flex: 1, padding: '4px 4px', fontSize: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: creatingType === 'drawio' ? 'rgba(242, 148, 0, 0.9)' : 'transparent', color: creatingType === 'drawio' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                  <GitBranch size={10} /> Diyagram
                </button>
              </div>

              {creatingType === 'rfc' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '6px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Şablon Seçin:</label>
                  <select 
                    value={selectedTemplatePath} 
                    onChange={(e) => setSelectedTemplatePath(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      fontSize: '11px',
                      background: '#1c1c24',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px',
                      color: '#fff',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="default-rfc">Varsayılan Mühendislik Planı (RFC)</option>
                    {creatorTemplates.map(tn => {
                      const label = tn.path.replace(templatesFolder + '/', '').replace('.md', '');
                      return (
                        <option key={tn.path} value={tn.path}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <input
                type="text"
                placeholder={creatingType === 'excalidraw' ? "Çizim adı..." : (creatingType === 'drawio' ? "Diyagram adı..." : (creatingType === 'rfc' ? "Proje/Plan adı..." : "Not adı..."))}
                value={newNoteName}
                onChange={(e) => setNewNoteName(e.target.value)}
                autoFocus
                className="create-note-input"
              />
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <button type="submit" className="create-note-submit" style={{ background: creatingType === 'excalidraw' ? 'rgb(139, 92, 246)' : (creatingType === 'rfc' ? 'rgba(16, 185, 129, 0.95)' : undefined) }}>Oluştur</button>
                <button type="button" onClick={() => setIsCreating(false)} className="create-note-cancel">İptal</button>
              </div>
            </form>
          )}

          <div className="notes-list">
            {filteredNotes.length === 0 ? (
              <div className="empty-notes">Bu alanda not bulunamadı.</div>
            ) : (
              filteredNotes.map((note) => (
                <div
                  key={note.path}
                  className={`note-list-item ${activeNotePath === note.path ? 'active' : ''}`}
                  onClick={() => setActiveNotePath(note.path)}
                  onContextMenu={(e) => onNoteContextMenu?.(e, note.path)}
                >
                  <div className="note-item-icon">
                    {note.type === 'excalidraw' ? <PenTool size={16} style={{ color: 'rgb(139, 92, 246)' }} /> : note.type === 'drawio' ? <GitBranch size={16} style={{ color: 'rgb(242, 148, 0)' }} /> : <FileText size={16} />}
                  </div>
                  <div className="note-item-info" style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                    <span className="note-item-title" style={{ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.name}</span>
                    {note.path.includes('/') && (
                      <span className="note-item-folder-path" style={{ fontSize: '10px', color: 'var(--text-muted)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        📂 {note.path.substring(0, note.path.lastIndexOf('/'))}
                      </span>
                    )}
                    <span className="note-item-date" style={{ fontSize: '9px', opacity: 0.6 }}>
                      {new Date(note.updatedAt).toLocaleDateString('tr-TR')}
                    </span>
                  </div>
                  <button
                    className="btn-delete-note"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Bu notu silmek istediğinize emin misiniz?')) {
                        onDeletePath(note.path);
                        if (activeNotePath === note.path) setActiveNotePath(null);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Editor Content Area */}
      <div className={`notes-editor ${!activeNotePath ? 'hidden-mobile empty' : ''}`}>
        {activeNotePath && activeNote ? (
          <>
            {/* Editor Toolbar */}
            <div className="editor-header">
              <button className="btn-back visible-mobile" onClick={() => setActiveNotePath(null)}>
                <ArrowLeft size={18} />
              </button>
              <div className="active-note-meta">
                {activeNote.type === 'excalidraw' ? <PenTool size={18} style={{ color: 'rgb(139, 92, 246)' }} /> : activeNote.type === 'drawio' ? <GitBranch size={18} style={{ color: 'rgb(242, 148, 0)' }} /> : <FileText size={18} />}
                <h3>{activeNote.name}</h3>
                {activeNote.type === 'excalidraw' && <span className="folder-indicator" style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'rgb(139, 92, 246)' }}>Excalidraw</span>}
                {activeNote.type === 'drawio' && <span className="folder-indicator" style={{ background: 'rgba(242, 148, 0, 0.15)', color: 'rgb(242, 148, 0)' }}>draw.io</span>}
                {selectedFolder && (() => {
                  const custom = folderCustomizations[selectedFolder] || {};
                  const customColor = custom.color;
                  const customIconName = custom.icon || 'Folder';
                  const CustomFolderIcon = iconMap[customIconName] || Folder;
                  return (
                    <span 
                      className="folder-indicator" 
                      style={{ 
                        borderColor: customColor || undefined, 
                        color: customColor || undefined,
                        background: customColor ? `${customColor}14` : undefined,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <CustomFolderIcon size={10} style={{ color: customColor || undefined }} />
                      @{selectedFolder}
                    </span>
                  );
                })()}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {activeNotePath && activeNote.type !== 'excalidraw' && activeNote.type !== 'drawio' && (
                  <>
                    {/* Zen Focus Mode Toggle */}
                    <button
                      type="button"
                      className={`toolbar-btn zen-toggle-btn ${isZenMode ? 'active' : ''}`}
                      style={{
                        width: '28px',
                        height: '28px',
                        padding: 0,
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderColor: isZenMode ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                        background: isZenMode ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)',
                        color: isZenMode ? 'var(--accent)' : 'var(--text-muted)'
                      }}
                      onClick={() => setIsZenMode(!isZenMode)}
                      title="Zen Odaklanma Modu (Kısayol: Alt+Z)"
                    >
                      {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>

                    {/* Typewriter Mode Toggle */}
                    <button
                      type="button"
                      className={`toolbar-btn typewriter-toggle-btn ${isTypewriterMode ? 'active' : ''}`}
                      style={{
                        width: '28px',
                        height: '28px',
                        padding: 0,
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderColor: isTypewriterMode ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                        background: isTypewriterMode ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)',
                        color: isTypewriterMode ? 'var(--accent)' : 'var(--text-muted)'
                      }}
                      onClick={() => setIsTypewriterMode(!isTypewriterMode)}
                      title="Daktilo Modu (Typewriter Scrolling)"
                    >
                      <Type size={14} />
                    </button>
                  </>
                )}
                {activeNotePath && onShowProperties && (
                  <button
                    type="button"
                    className="toolbar-btn properties-btn"
                    style={{
                      width: '28px',
                      height: '28px',
                      padding: 0,
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onClick={() => onShowProperties(activeNotePath)}
                    title="Not Özellikleri"
                  >
                    <Info size={14} />
                  </button>
                )}
                {activeNotePath && activeNote.type !== 'excalidraw' && activeNote.type !== 'drawio' && (
                  <button
                    type="button"
                    className="toolbar-btn history-btn"
                    style={{
                      width: '28px',
                      height: '28px',
                      padding: 0,
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onClick={openVersionHistory}
                    title="Sürüm Geçmişi"
                  >
                    <History size={14} />
                  </button>
                )}

                {(() => {
                  const isHarcamaNote = editorContent.toLowerCase().includes('#harcama');
                  const checkedItems = lines
                    .map((l, index) => ({ text: l, index }))
                    .filter(item => item.text.trim().startsWith('- [x] ') || item.text.trim().startsWith('- [X] '))
                    .map(item => {
                      const match = item.text.trim().match(/^[-*+]\s+\[[xX]\]\s*(.*)$/);
                      return {
                        text: match ? match[1].trim() : item.text,
                        originalIndex: item.index
                      };
                    });

                  if (!activeNotePath || activeNote.type === 'excalidraw' || activeNote.type === 'drawio' || !isHarcamaNote) return null;

                  return (
                    <button
                      type="button"
                      className="toolbar-btn receipt-btn"
                      disabled={checkedItems.length === 0}
                      style={{
                        width: '28px',
                        height: '28px',
                        padding: 0,
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderColor: checkedItems.length > 0 ? '#10b981' : undefined,
                        background: checkedItems.length > 0 ? 'rgba(16, 185, 129, 0.15)' : undefined,
                        opacity: checkedItems.length > 0 ? 1 : 0.4,
                        cursor: checkedItems.length > 0 ? 'pointer' : 'not-allowed'
                      }}
                      onClick={() => {
                        setReceiptAmount('');
                        setReceiptLocation('');
                        // Fiş açıldığında taksit seçeneğini varsayılana sıfırla
                        setReceiptInstallment('1');
                        setReceiptItemPrices({});
                        setIsReceiptModalOpen(true);
                      }}
                      title={checkedItems.length > 0 ? "Seçili ürünleri fişle" : "Fiş kesmek için önce listeden ürünleri tikleyin"}
                    >
                      <span style={{ fontSize: '13px' }}>🧾</span>
                    </button>
                  );
                })()}

                {activeNote.type !== 'excalidraw' && activeNote.type !== 'drawio' && (
                  <button
                    type="button"
                    className={`toolbar-btn widget-pin-btn ${pinnedWidgetLists.includes(activeNotePath) ? 'active' : ''}`}
                    style={{
                      width: '28px',
                      height: '28px',
                      padding: 0,
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderColor: pinnedWidgetLists.includes(activeNotePath) ? 'var(--accent-color, #818cf8)' : undefined,
                      background: pinnedWidgetLists.includes(activeNotePath) ? 'rgba(99, 102, 241, 0.15)' : undefined
                    }}
                    onClick={handleTogglePinToWidget}
                    title={pinnedWidgetLists.includes(activeNotePath) ? "Widget sabitlemesini kaldır" : "Android ana ekran widget'ına sabitle"}
                  >
                    <Pin size={14} style={{ color: pinnedWidgetLists.includes(activeNotePath) ? 'var(--accent-color, #818cf8)' : undefined }} />
                  </button>
                )}

                {activeNote.type !== 'excalidraw' && activeNote.type !== 'drawio' && (
                  <button
                    type="button"
                    className={`toolbar-btn dictation-toggle-btn ${isDictating ? 'active animate-pulse-glow' : ''}`}
                    style={{ width: '28px', height: '28px', padding: 0, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDictating ? 'rgba(239, 68, 68, 0.15)' : 'transparent', color: isDictating ? '#ef4444' : 'inherit' }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleDictation();
                    }}
                    title={isDictating ? "Dikteyi Durdur" : "Sesli Dikte Başlat"}
                  >
                    {isDictating ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                )}

                {activeNote.type !== 'excalidraw' && activeNote.type !== 'drawio' && (
                  <button
                    type="button"
                    className={`toolbar-btn source-toggle-btn ${isSourceMode ? 'active' : ''}`}
                    style={{ width: '28px', height: '28px', padding: 0, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => {
                      setIsSourceMode(!isSourceMode);
                      setIsMindmapMode(false);
                      setFocusedLineIdx(null);
                      setDragSelectStartIdx(null);
                      setDragSelectEndIdx(null);
                    }}
                    title={isSourceMode ? "Canlı Editör Moduna Geç" : "Kaynak Kodu Düzenleme Moduna Geç"}
                  >
                    {isSourceMode ? <Eye size={14} /> : <FileCode size={14} />}
                  </button>
                )}

                {activeNote.type !== 'excalidraw' && activeNote.type !== 'drawio' && (
                  <button
                    type="button"
                    className={`toolbar-btn mindmap-toggle-btn ${isMindmapMode ? 'active' : ''}`}
                    style={{ 
                      width: '28px', 
                      height: '28px', 
                      padding: 0, 
                      borderRadius: '4px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      borderColor: isMindmapMode ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                      background: isMindmapMode ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)',
                      color: isMindmapMode ? 'var(--accent)' : 'var(--text-muted)'
                    }}
                    onClick={() => {
                      setIsMindmapMode(!isMindmapMode);
                      setIsSourceMode(false);
                      setFocusedLineIdx(null);
                      setDragSelectStartIdx(null);
                      setDragSelectEndIdx(null);
                    }}
                    title={isMindmapMode ? "Editör Moduna Geç" : "Zihin Haritası Moduna Geç"}
                  >
                    <Network size={14} />
                  </button>
                )}

                {onSplitWorkspace && (
                  <button
                    type="button"
                    className="toolbar-btn split-btn"
                    style={{ width: '28px', height: '28px', padding: 0, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={onSplitWorkspace}
                    title="Editörü Dikey Böl"
                  >
                    <Columns size={14} />
                  </button>
                )}

                {onClosePane && (
                  <button
                    type="button"
                    className="toolbar-btn close-pane-btn"
                    style={{ width: '28px', height: '28px', padding: 0, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)' }}
                    onClick={onClosePane}
                    title="Paneli Kapat"
                  >
                    <X size={14} />
                  </button>
                )}

                <div className="sync-status-container" title={syncStatus === 'saved' ? "Tüm değişiklikler yerel diske kaydedildi" : "Değişiklikler kaydediliyor..."}>
                  <div className={`sync-status-dot ${syncStatus}`} />
                  <span className="hidden-mobile">{syncStatus === 'saved' ? 'Eşitlendi (v2)' : 'Kaydediliyor...'}</span>
                </div>
              </div>
            </div>
            {activeNote.type === 'excalidraw' ? (
              /* Excalidraw Drawing Editor */
              <div className="excalidraw-editor-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '8px', margin: '0 8px 8px 8px', border: '1px solid rgba(139, 92, 246, 0.2)', background: '#121214' }}>
                <iframe
                  key={activeNotePath}
                  ref={excalidrawIframeRef}
                  src={isElectron ? `./excalidraw-embed.html?v=3` : `/excalidraw-embed.html?v=3`}
                  style={{ width: '100%', flex: 1, border: 'none', borderRadius: '8px' }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
                  title="Excalidraw Drawing Editor"
                />
              </div>
            ) : activeNote.type === 'drawio' && activeNotePath ? (
              /* draw.io Diyagram Editörü */
              <DrawioFullEditor
                key={activeNotePath}
                notePath={activeNotePath}
                readNoteContent={readNoteContent}
                onSaveNote={onSaveNote}
              />
            ) : (
              <>
                {isMindmapMode ? (
                  <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <MindmapView 
                      content={editorContent} 
                      onChangeContent={setEditorContent} 
                      noteName={activeNote.name} 
                      savedCoords={mindmapLayouts[activeNotePath || '']?.coords || {}}
                      savedCustoms={mindmapLayouts[activeNotePath || '']?.customs || []}
                      onSaveLayout={(coords, customs) => {
                        if (activeNotePath) {
                          onSaveMindmapLayout(activeNotePath, coords, customs);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div 
                    className="live-editor-container" 
                    onClick={!isSourceMode ? handleContainerClick : undefined}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onPaste={handlePaste}
                  >
                    {isSourceMode ? (
                      <textarea
                        className="source-mode-textarea"
                        value={editorContent}
                        onChange={(e) => setEditorContent(e.target.value)}
                        placeholder="Not içeriğini Markdown olarak yazın..."
                        spellCheck={false}
                      />
                    ) : (
                      <div className="live-editor-lines">
                  {/* Pinned lines list */}
                  {(() => {
                    const pinnedLines = lines
                      .map((line, idx) => ({ text: line.trim(), idx }))
                      .filter(item => item.text.toLowerCase().startsWith('pin:'));
                    if (pinnedLines.length === 0) return null;
                    return (
                      <div className="pinned-lines-header-bar" onClick={(e) => e.stopPropagation()}>
                        <div className="pinned-bar-title">
                          <Pin size={12} className="pinned-icon" />
                          <span>SABİTLENMİŞ NOT SATIRLARI</span>
                        </div>
                        <div className="pinned-lines-list">
                          {pinnedLines.map((item, pidx) => {
                            const cleanText = item.text.substring(4).trim();
                            return (
                              <div 
                                key={pidx} 
                                className="pinned-item-chip"
                                onClick={() => scrollToElement(`editor-line-${item.idx}`)}
                              >
                                <span className="pinned-bullet">📌</span>
                                <span className="pinned-text">{cleanText}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Procrastination Nudge Banner */}
                  {(() => {
                    const hasProjeNudge = editorContent.toLowerCase().includes('#hedefproje') && lines.some(l => l.includes('- [ ]'));
                    if (!hasProjeNudge) return null;
                    return (
                      <div className="proje-nudge-banner animate-slide-down" onClick={(e) => e.stopPropagation()}>
                        <div className="nudge-icon">🔥</div>
                        <div className="nudge-text">
                          <strong>Erteleme Karşıtı Uyarı:</strong> Yarım bıraktığın <em>{activeNote.name}</em> projesi seni bekliyor! Hedefine ulaşmak için bugün bir adım at.
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const getSkippedLineIndices = () => {
                      const skipped = new Set<number>();
                      let inCodeBlockState = false;
                      let codeBlockStartIdx = -1;
                      
                      for (let i = 0; i < lines.length; i++) {
                        const lText = lines[i];
                        
                        if (lText.trim().startsWith('```')) {
                          if (inCodeBlockState) {
                            const blockEndIdx = i;
                            const isBeingEdited = activeCodeBlockRange && codeBlockStartIdx >= activeCodeBlockRange.start && blockEndIdx <= activeCodeBlockRange.end;
                            if (!isBeingEdited) {
                              for (let k = codeBlockStartIdx + 1; k <= blockEndIdx; k++) {
                                skipped.add(k);
                              }
                            }
                            inCodeBlockState = false;
                            codeBlockStartIdx = -1;
                          } else {
                            let hasClosing = false;
                            for (let k = i + 1; k < lines.length; k++) {
                              if (lines[k].trim().startsWith('```')) {
                                hasClosing = true;
                                break;
                              }
                            }
                            if (hasClosing) {
                              inCodeBlockState = true;
                              codeBlockStartIdx = i;
                            }
                          }
                          continue;
                        }
                        
                        if (inCodeBlockState) {
                          continue;
                        }

                        if (lText.trim().toLowerCase().startsWith('tablo:')) {
                          let nIdx = i + 1;
                          while (nIdx < lines.length) {
                            const nText = lines[nIdx].trim();
                            if (nText === '' || nText.startsWith('#') || nText.startsWith('---') || nText.startsWith('tablo:') || nText.startsWith('pano:') || nText.startsWith('flow:')) {
                              break;
                            }
                            if (nText.replace(/^[-*+]\s+/, '').trim().includes(',')) {
                              skipped.add(nIdx);
                            } else {
                              break;
                            }
                            nIdx++;
                          }
                        }
                        if (lText.trim().toLowerCase().startsWith('pano:')) {
                          let nIdx = i + 1;
                          while (nIdx < lines.length) {
                            const nText = lines[nIdx].trim();
                            if (nText === '' || nText.startsWith('#') || nText.startsWith('---') || nText.startsWith('pano:') || nText.startsWith('tablo:') || nText.startsWith('flow:')) {
                              break;
                            }
                            if (nText.match(/^[-*+]\s+([^:]+):\s*(.*)$/)) {
                              skipped.add(nIdx);
                            }
                            nIdx++;
                          }
                        }
                        if (lText.trim().toLowerCase().startsWith('[chart:')) {
                          let nIdx = i + 1;
                          while (nIdx < lines.length && lines[nIdx].trim() === '') {
                            skipped.add(nIdx);
                            nIdx++;
                          }
                          if (nIdx < lines.length && lines[nIdx].trim().startsWith('|')) {
                            skipped.add(nIdx);
                            nIdx++;
                            if (nIdx < lines.length && lines[nIdx].trim().startsWith('|')) {
                              skipped.add(nIdx);
                              nIdx++;
                              while (nIdx < lines.length) {
                                if (!lines[nIdx].trim().startsWith('|')) break;
                                skipped.add(nIdx);
                                nIdx++;
                              }
                            }
                          }
                        }
                      }
                      return skipped;
                    };

                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                    // Standart GitHub-Flavored Markdown (GFM) pipe tablosu tespiti:
                    // "| a | b |" satırı, hemen ardından "|---|---|" hizalama satırı
                    // geldiğinde bir tablo olarak kabul edilir. Bu, uygulamanın kendi
                    // özel "Tablo:" widget sisteminden ayrı, standart .md dosyalarında
                    // (örn. bir yapay zekadan yapıştırılan) yaygın kullanılan sözdizimini
                    // düzgün render etmek için gereklidir.
                    const isMdTableSeparatorRow = (line: string): boolean => {
                      const trimmed = line.trim();
                      if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
                      const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
                      if (!inner.trim()) return false;
                      const cells = inner.split('|');
                      return cells.length > 0 && cells.every(c => /^\s*:?-{1,}:?\s*$/.test(c));
                    };
                    const parseMdTableRow = (line: string): string[] => {
                      let t = line.trim();
                      if (t.startsWith('|')) t = t.slice(1);
                      if (t.endsWith('|')) t = t.slice(0, -1);
                      return t.split('|').map(c => c.trim());
                    };
                    const getMdTableColAlign = (sepCell: string): 'left' | 'center' | 'right' | undefined => {
                      const c = sepCell.trim();
                      const left = c.startsWith(':');
                      const right = c.endsWith(':');
                      if (left && right) return 'center';
                      if (right) return 'right';
                      if (left) return 'left';
                      return undefined;
                    };

                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                    // Bir satırın EditorLine önbelleğinden yararlanıp
                    // yararlanamayacağını belirler. Odaklanılan satır (aktif
                    // yazma/imleç burada olduğu için) HER ZAMAN taze render
                    // edilir. Ayrıca satıra özel geçici widget durumu
                    // (zamanlayıcı, çizim, ses kaydı, makbuz fiyatı, başlık
                    // katlama, açık görev detayı, sürükleme hedefi, seçim
                    // araç çubuğu) varsa o satır da "sıradan" sayılmaz ve
                    // her zaman doğrudan render edilir — bu durumlar nadir
                    // olduğundan performans kaybı ihmal edilebilir düzeydedir,
                    // ama önbellek anahtarına dahil etmeyi unutma riskini
                    // (bayat/eski görünüm hatası) tamamen ortadan kaldırır.
                    const isPlainLine = (idx: number): boolean => {
                      if (idx === focusedLineIdx) return false;
                      if (activeTimers[idx] !== undefined) return false;
                      if (sketchingLines[idx] !== undefined) return false;
                      if (voiceRecorderLines[idx] !== undefined) return false;
                      if (dismissedAlarms[idx] !== undefined) return false;
                      if (flowEditModes[idx] !== undefined) return false;
                      if (receiptItemPrices[idx] !== undefined) return false;
                      if (collapsedHeadings[idx] !== undefined) return false;
                      if (expandedTaskIdx === idx) return false;
                      if (dragOverIdx && dragOverIdx.idx === idx) return false;
                      if (selectionInfo && selectionInfo.lineIdx === idx) return false;
                      return true;
                    };

                    const renderLinesWithColumns = () => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Satırları <<<row>>> ve <<<col>>> etiketlerine göre gruplayarak yan yana flex grid kolonlar halinde render eder.
    const result: React.ReactNode[] = [];
    const skippedLines = getSkippedLineIndices();
    const hiddenLines = getHiddenLineIndices();

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Kısa notlarda sanallaştırma ek yükü gereksiz — mevcut davranış aynen korunur.
    // Uzun notlarda her blok VirtBlock ile sarılır: görünür alan dışındaki bloklar
    // yalnızca yükseklik tutan boş bir div olur, pahalı render hiç çalışmaz.
    const VIRT_MIN_LINES = 80;
    const virtualizeLines = lines.length >= VIRT_MIN_LINES;

    const pushBlock = (key: React.Key, startL: number, endL: number, renderFn: () => React.ReactNode) => {
      if (!virtualizeLines) {
        result.push(renderFn());
        return;
      }
      // Odaklanılan, seçili, zamanlayıcılı vb. "sıradan olmayan" satır içeren
      // bloklar ile satıra-atlama için sabitlenen satırlar her zaman mount edilir.
      let forced = false;
      for (let k = startL; k <= endL && !forced; k++) {
        if (!isPlainLine(k) || virtPinnedRef.current.has(k)) forced = true;
      }
      const lineCount = Math.max(1, endL - startL + 1);
      const hKey = `${lineCount}|${(lines[startL] ?? '').slice(0, 60)}`;
      result.push(
        <VirtBlock
          key={`vb-${key}`}
          forced={forced}
          initialVisible={startL < 60}
          estHeight={lineCount * 30}
          cacheKey={hKey}
          heightCache={virtHeightCacheRef.current}
          getObserver={getVirtObserver}
          registry={virtRegistryRef.current}
        >
          {renderFn}
        </VirtBlock>
      );
    };

    let i = 0;
    while (i < lines.length) {
      if (hiddenLines.has(i) || skippedLines.has(i)) {
        i++;
        continue;
      }
      
      const lineText = lines[i].trim();
      
      if (lineText.startsWith('<<<row>>>')) {
        const rowChildren: { colLines: number[][] } = { colLines: [] };
        let currentCol: number[] = [];
        let j = i + 1;
        
        while (j < lines.length) {
          const subText = lines[j].trim();
          if (subText.startsWith('<<<row-end>>>')) {
            if (currentCol.length > 0) {
              rowChildren.colLines.push(currentCol);
            }
            break;
          } else if (subText.startsWith('<<<col>>>')) {
            if (currentCol.length > 0) {
              rowChildren.colLines.push(currentCol);
              currentCol = [];
            }
          } else {
            if (!hiddenLines.has(j) && !skippedLines.has(j)) {
              currentCol.push(j);
            }
          }
          j++;
        }
        
        {
          // `i` döngüde mutasyona uğrayan paylaşılan değişken — closure için sabite kopyala.
          const rowStart = i;
          const rowEnd = Math.min(j, lines.length - 1);
          pushBlock(`row-${rowStart}`, rowStart, rowEnd, () => (
            <div key={`row-${rowStart}`} className="row-container" onClick={(e) => e.stopPropagation()}>
              {rowChildren.colLines.map((colGroup, colIdx) => (
                <div key={`col-${rowStart}-${colIdx}`} className="col-container">
                  {colGroup.map(lineIdx => renderSingleLine(lineIdx))}
                </div>
              ))}
            </div>
          ));
        }

        i = j + 1;
      } else if (
        lineText.startsWith('|') &&
        i + 1 < lines.length &&
        !hiddenLines.has(i + 1) && !skippedLines.has(i + 1) &&
        isMdTableSeparatorRow(lines[i + 1])
      ) {
        // Standart Markdown (GFM) pipe tablosu: başlık satırı + |---|---| hizalama satırı + veri satırları.
        const headerCells = parseMdTableRow(lines[i]);
        const alignCells = parseMdTableRow(lines[i + 1]).map(getMdTableColAlign);
        const bodyRowIndices: number[] = [];
        let j = i + 2;
        while (j < lines.length && !hiddenLines.has(j) && !skippedLines.has(j) && lines[j].trim().startsWith('|')) {
          bodyRowIndices.push(j);
          j++;
        }

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Odaklanılan satır bu tablonun bir parçasıysa (kullanıcı ham sözdizimini
        // düzenliyorsa), tabloyu derlenmiş <table> olarak göstermek yerine normal
        // düzenlenebilir satırlara düş — "Tablo:" widget'ındaki davranışla tutarlı.
        const tableLineRange = [i, i + 1, ...bodyRowIndices];
        const isEditingThisTable = focusedLineIdx !== null && tableLineRange.includes(focusedLineIdx);

        if (isEditingThisTable) {
          tableLineRange.forEach(lineIdx => pushBlock(lineIdx, lineIdx, lineIdx, () => renderSingleLine(lineIdx)));
        } else {
          const tableStart = i;
          const tableEnd = j - 1;
          pushBlock(`mdtable-${tableStart}`, tableStart, tableEnd, () => (
            <div key={`mdtable-${tableStart}`} className="md-table-wrapper" onClick={(e) => e.stopPropagation()}>
              <table className="md-table">
                <thead>
                  <tr>
                    {headerCells.map((cell, ci) => (
                      <th key={ci} style={{ textAlign: alignCells[ci] || 'left' }}>{parseInlineStylesAndTags(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRowIndices.map(rowIdx => {
                    const rowCells = parseMdTableRow(lines[rowIdx]);
                    return (
                      <tr key={rowIdx}>
                        {headerCells.map((_, ci) => (
                          <td key={ci} style={{ textAlign: alignCells[ci] || 'left' }}>{parseInlineStylesAndTags(rowCells[ci] || '')}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ));
        }

        i = j;
      } else {
        {
          const lineIdx = i;
          if (isPlainLine(lineIdx)) {
            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            // Önbellek anahtarına önceki/sonraki satırı da dahil ediyoruz —
            // renderSingleLine bazı widget'larda (ör. görev altındaki girintili
            // detay satırı) komşu satırlara bakabiliyor. Yalnızca kendi satırını
            // anahtara koymak, komşu bir satır değiştiğinde bu satırın bayat
            // kalmasına yol açabilirdi; ufak bir güvenlik payı ekliyoruz.
            const cacheKey = `${lines[lineIdx - 1] ?? ''} ${lines[lineIdx]} ${lines[lineIdx + 1] ?? ''}`;
            pushBlock(lineIdx, lineIdx, lineIdx, () => (
              <EditorLine key={lineIdx} cacheKey={cacheKey} renderFn={() => renderSingleLine(lineIdx)} />
            ));
          } else {
            pushBlock(lineIdx, lineIdx, lineIdx, () => renderSingleLine(lineIdx));
          }
        }
        i++;
      }
    }
    return result;
  };

  const renderSingleLine = (idx: number) => {
    const line = lines[idx];
    if (line === undefined) return null;
    const isFocused = focusedLineIdx === idx;
    
    const lineText = line.trim();
    if (!isFocused && (lineText.startsWith('<<<row>>>') || lineText.startsWith('<<<col>>>') || lineText.startsWith('<<<row-end>>>'))) {
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Önizleme modunda <<<row>>>, <<<col>>> ve <<<row-end>>> etiketlerini düzenlenebilir grid tag satırları olarak hafif gri render eder.
      const isRowTag = lineText.startsWith('<<<row>>>');
      const isColTag = lineText.startsWith('<<<col>>>');
      return (
        <div 
          key={idx} 
          id={`editor-line-${idx}`} 
          className="editor-grid-tag-line" 
          style={{ fontSize: '10px', color: 'var(--text-muted)', opacity: 0.3, padding: '2px 6px', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '4px', margin: '4px 0', width: '100%', cursor: 'pointer', userSelect: 'none' }} 
          onClick={(e) => handleLineClick(idx, e)}
        >
          ░ {isRowTag ? 'Kolon Grubu Başlangıcı' : isColTag ? 'Yeni Sütun Kolonu' : 'Kolon Grubu Sonu'} ({lineText})
        </div>
      );
    }
                    
                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                    // Kod bloğu aktif düzenleme modundayken, satırların içindeki markdown simgelerinin (checkbox, bullet vb.)
                    // çalıştırılmasını önleyerek düz kod metni olarak görünmelerini sağlarız.
                    const isInCodeBlock = activeCodeBlockRange && idx >= activeCodeBlockRange.start && idx <= activeCodeBlockRange.end;

                    const isChecklist = isInCodeBlock ? null : getChecklistInfo(line);
                    const isBullet = isInCodeBlock ? null : getBulletInfo(line);
                    const isOrdered = isInCodeBlock ? null : getOrderedListInfo(line);
                    const isCallout = isInCodeBlock ? null : getCalloutInfo(line);
                    const isHR = isInCodeBlock ? false : line.trim() === '---';
                    const isHeading = isInCodeBlock ? null : line.match(/^(#{1,6})\s+(.*)$/);
                    const isFootnote = isInCodeBlock ? null : getFootnoteInfo(line);

                    // Heading accordion folding
                    const hiddenLines = getHiddenLineIndices();
                    
                    // Table, Kanban, Code block nested lines skipping
                    const skippedLines = getSkippedLineIndices();
                    if (hiddenLines.has(idx) || skippedLines.has(idx)) return null;

                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                    // Ayarlardan seçilen rakamsal line-height ve margin-bottom değerlerini inline stillere bağlar.
                    let spacingStyle: React.CSSProperties = {
                      lineHeight: String(lineHeight),
                      marginBottom: `${lineMargin}px`,
                      minHeight: 'auto',
                      paddingTop: lineHeight < 1.3 ? '0px' : '2px',
                      paddingBottom: lineHeight < 1.3 ? '0px' : '2px',
                      marginTop: lineHeight < 1.3 ? '0px' : '1px'
                    };

                    // Selection highlight
                    const range = getSelectedRange();
                    const isSelected = range && idx >= range.start && idx <= range.end;

                    // 1. If it's a checklist item
                    if (isChecklist) {
                      const isChecked = isChecklist.status.toLowerCase() === 'x';
                      const score = calculateTaskScore(isChecklist.content);
                      const isExpanded = expandedTaskIdx === idx;
                      const hasFloat = isChecklist.content.includes('|left') || isChecklist.content.includes('|right');

                      return (
                        <div
                          key={idx}
                          id={`editor-line-${idx}`}
                          className={`editor-line-container line-checklist ${isFocused ? 'editor-line-active' : 'editor-line-inactive'} ${isSelected ? 'line-selected' : ''} ${dragOverIdx && dragOverIdx.idx === idx ? `drag-over-${dragOverIdx.position}` : ''}`}
                          draggable={false}
                          onDragOver={(e) => handleLineDragOver(e, idx)}
                          onDragLeave={handleLineDragLeave}
                          onDrop={(e) => handleLineDrop(e, idx)}
                          onClick={(e) => handleLineClick(idx, e)}
                          onMouseDown={(e) => handleLineMouseDown(e, idx)}
                          onMouseEnter={() => {
                            if (isDragging) setDragSelectEndIdx(idx);
                          }}
                          style={{ 
                            paddingLeft: `${6 + getLineIndentPx(line)}px`,
                            ...(hasFloat ? { display: 'block', overflow: 'visible' } : {}),
                            ...spacingStyle
                          }}
                        >
                          {!isFocused && (
                            <div 
                              className="line-drag-handle" 
                              title="Satırı taşımak için sürükleyin"
                              draggable
                              onDragStart={(e) => handleLineDragStart(e, idx)}
                              onDragEnd={handleLineDragEnd}
                            >
                              ⠿
                            </div>
                          )}
                          <div
                            className="preview-checkbox-wrapper"
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent entering edit mode
                              handleToggleCheckboxInEditor(idx);
                            }}
                            style={hasFloat ? { display: 'inline-block', verticalAlign: 'top', marginRight: '8px' } : undefined}
                          >
                            <div className="preview-custom-checkbox" style={{
                              backgroundColor: isChecked ? 'var(--success-color)' : 'transparent',
                              borderColor: isChecked ? 'var(--success-color)' : 'var(--text-muted)',
                              boxShadow: isChecked ? '0 0 8px rgba(16, 185, 129, 0.3)' : 'none'
                            }}>
                              {isChecked && <div className="preview-custom-checkbox::after" style={{ opacity: 1 }} />}
                            </div>
                          </div>

                          <div 
                            className="line-content-wrapper" 
                            onClick={isFocused ? (e) => e.stopPropagation() : undefined}
                            style={hasFloat ? { display: 'block', width: '100%', overflow: 'visible' } : undefined}
                          >
                            <div className="checklist-row-wrapper" style={{ display: 'flex', alignItems: 'flex-start', width: '100%', position: 'relative', paddingRight: '122px' }}>
                              {isFocused ? (
                                <AutoResizingTextarea
                                  inputRef={(el) => { lineRefs.current[idx] = el; }}
                                  value={isChecklist.content}
                                  onChange={(e) => handleLineChange(idx, e.target.value, isChecklist.prefix + isChecklist.status + isChecklist.spacer, (isChecklist.prefix + isChecklist.status + isChecklist.spacer).length + e.target.selectionStart, e)}
                                  onKeyDown={(e) => handleLineKeyDown(e, idx)}
                                  onKeyUp={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                  onSelect={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                  onFocus={() => handleLineFocus(idx)}
                                  onBlur={() => handleLineBlur(idx)}
                                  className="line-textarea"
                                  placeholder="Görev yaz..."
                                  autoFocus
                                />
                              ) : (
                                <div
                                  onClick={(e) => handleLineClick(idx, e)}
                                  className={`preview-checklist-item ${isChecked ? 'checked' : ''}`}
                                  style={{ cursor: 'text', margin: 0, padding: 0 }}
                                >
                                  <div className="preview-checklist-text" style={{ cursor: 'text' }}>
                                    {score > 0 && !isChecked && (
                                      <span className="preview-task-score-badge" title={calculateTaskScoreBreakdown(lines[idx], score)}>
                                        ⭐ Puan: {score}
                                      </span>
                                    )}
                                    {isChecklist.content.trim() === '' ? (
                                      <span className="line-empty-placeholder">{'\u200B'}</span>
                                    ) : (
                                      renderLineWidgets(isChecklist.content, idx)
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Hover Quick Actions */}
                              <div className="checklist-actions-hover" style={{ position: 'absolute', right: 0, top: 0 }}>
                                <button
                                  type="button"
                                  className="action-hover-btn"
                                  onClick={(e) => { e.stopPropagation(); setExpandedTaskIdx(isExpanded ? null : idx); }}
                                  title="Görevi Gizle / Teslim Tarihi"
                                >
                                  <EyeOff size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="action-hover-btn"
                                  onClick={(e) => { e.stopPropagation(); setExpandedTaskIdx(isExpanded ? null : idx); }}
                                  title="Teslim Tarihi Ayarla"
                                >
                                  <Calendar size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="action-hover-btn"
                                  onClick={(e) => { e.stopPropagation(); setExpandedTaskIdx(isExpanded ? null : idx); }}
                                  title="Öncelik Seviyesi Ayarla"
                                >
                                  <Star size={12} />
                                </button>
                                <button
                                  type="button"
                                  className={`action-hover-btn ${isExpanded ? 'active' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); setExpandedTaskIdx(isExpanded ? null : idx); }}
                                  title={isExpanded ? "Detayları Kapat" : "Görevi Detaylandır"}
                                >
                                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              </div>
                            </div>

                            {/* Task Detail Drawer */}
                            {isExpanded && renderTaskDetailDrawer(idx, isChecklist.content)}
                            {renderWikiSuggestions(idx)}
                            {renderContextualToolbar(idx)}
                          </div>
                        </div>
                      );
                    }

                    // 2. If it's a standard bullet list item
                    if (isBullet) {
                      return (
                        <div
                          key={idx}
                          id={`editor-line-${idx}`}
                          className={`editor-line-container line-bullet ${isFocused ? 'editor-line-active' : 'editor-line-inactive'} ${isSelected ? 'line-selected' : ''} ${dragOverIdx && dragOverIdx.idx === idx ? `drag-over-${dragOverIdx.position}` : ''}`}
                          onClick={(e) => handleLineClick(idx, e)}
                          onMouseDown={(e) => handleLineMouseDown(e, idx)}
                          onMouseEnter={() => {
                            if (isDragging) setDragSelectEndIdx(idx);
                          }}
                          draggable={false}
                          onDragOver={(e) => handleLineDragOver(e, idx)}
                          onDragLeave={handleLineDragLeave}
                          onDrop={(e) => handleLineDrop(e, idx)}
                          style={{ paddingLeft: `${6 + getLineIndentPx(line)}px`, ...spacingStyle }}
                        >
                          {!isFocused && (
                            <div 
                              className="line-drag-handle" 
                              title="Satırı taşımak için sürükleyin"
                              draggable
                              onDragStart={(e) => handleLineDragStart(e, idx)}
                              onDragEnd={handleLineDragEnd}
                            >
                              ⠿
                            </div>
                          )}
                          <div className="line-prefix-container">
                            <div className="line-bullet-dot" />
                          </div>
                          <div className="line-content-wrapper" onClick={isFocused ? (e) => e.stopPropagation() : undefined}>
                            {isFocused ? (
                              <AutoResizingTextarea
                                inputRef={(el) => { lineRefs.current[idx] = el; }}
                                value={isBullet.content}
                                onChange={(e) => handleLineChange(idx, e.target.value, isBullet.prefix, isBullet.prefix.length + e.target.selectionStart, e)}
                                onKeyDown={(e) => handleLineKeyDown(e, idx)}
                                onKeyUp={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onSelect={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onFocus={() => handleLineFocus(idx)}
                                onBlur={() => handleLineBlur(idx)}
                                className="line-textarea"
                                placeholder="Liste öğesi..."
                                autoFocus
                              />
                            ) : (
                              <div
                                onClick={(e) => handleLineClick(idx, e)}
                                className="preview-li"
                                style={{ cursor: 'text', margin: 0, padding: 0 }}
                              >
                                {isBullet.content.trim() === '' ? (
                                  <span className="line-empty-placeholder">{'\u200B'}</span>
                                ) : (
                                  renderLineWidgets(isBullet.content, idx)
                                )}
                              </div>
                            )}
                            {renderWikiSuggestions(idx)}
                            {renderContextualToolbar(idx)}
                          </div>
                        </div>
                      );
                    }

                    // 2.5. If it's an ordered list item
                    if (isOrdered) {
                      return (
                        <div
                          key={idx}
                          id={`editor-line-${idx}`}
                          className={`editor-line-container line-ordered ${isFocused ? 'editor-line-active' : 'editor-line-inactive'} ${isSelected ? 'line-selected' : ''} ${dragOverIdx && dragOverIdx.idx === idx ? `drag-over-${dragOverIdx.position}` : ''}`}
                          onClick={(e) => handleLineClick(idx, e)}
                          onMouseDown={(e) => handleLineMouseDown(e, idx)}
                          onMouseEnter={() => {
                            if (isDragging) setDragSelectEndIdx(idx);
                          }}
                          draggable={false}
                          onDragOver={(e) => handleLineDragOver(e, idx)}
                          onDragLeave={handleLineDragLeave}
                          onDrop={(e) => handleLineDrop(e, idx)}
                          style={{ paddingLeft: `${6 + getLineIndentPx(line)}px`, ...spacingStyle }}
                        >
                          {!isFocused && (
                            <div 
                              className="line-drag-handle" 
                              title="Satırı taşımak için sürükleyin"
                              draggable
                              onDragStart={(e) => handleLineDragStart(e, idx)}
                              onDragEnd={handleLineDragEnd}
                            >
                              ⠿
                            </div>
                          )}
                          <div className="line-prefix-container line-number-prefix">
                            <span className="line-number-text">{isOrdered.number}.</span>
                          </div>
                          <div className="line-content-wrapper" onClick={isFocused ? (e) => e.stopPropagation() : undefined}>
                            {isFocused ? (
                              <AutoResizingTextarea
                                inputRef={(el) => { lineRefs.current[idx] = el; }}
                                value={isOrdered.content}
                                onChange={(e) => handleLineChange(idx, e.target.value, isOrdered.prefix, isOrdered.prefix.length + e.target.selectionStart, e)}
                                onKeyDown={(e) => handleLineKeyDown(e, idx)}
                                onKeyUp={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onSelect={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onFocus={() => handleLineFocus(idx)}
                                onBlur={() => handleLineBlur(idx)}
                                className="line-textarea"
                                placeholder="Liste öğesi..."
                                autoFocus
                              />
                            ) : (
                              <div
                                onClick={(e) => handleLineClick(idx, e)}
                                className="preview-li"
                                style={{ cursor: 'text', margin: 0, padding: 0 }}
                              >
                                {isOrdered.content.trim() === '' ? (
                                  <span className="line-empty-placeholder">{'\u200B'}</span>
                                ) : (
                                  renderLineWidgets(isOrdered.content, idx)
                                )}
                              </div>
                            )}
                            {renderWikiSuggestions(idx)}
                            {renderContextualToolbar(idx)}
                          </div>
                        </div>
                      );
                    }

                    // 2.6. If it's a Callout block
                    if (isCallout) {
                      const type = isCallout.isHeader ? isCallout.type : getCalloutTypeUpwards(idx);
                      const weldStyle = getCalloutWeldStyle(idx);

                      return (
                        <div
                          key={idx}
                          id={`editor-line-${idx}`}
                          className={`editor-line-container line-callout ${isFocused ? 'editor-line-active' : 'editor-line-inactive'} ${isSelected ? 'line-selected' : ''} ${dragOverIdx && dragOverIdx.idx === idx ? `drag-over-${dragOverIdx.position}` : ''}`}
                          onClick={(e) => handleLineClick(idx, e)}
                          onMouseDown={(e) => handleLineMouseDown(e, idx)}
                          onMouseEnter={() => {
                            if (isDragging) setDragSelectEndIdx(idx);
                          }}
                          draggable={false}
                          onDragOver={(e) => handleLineDragOver(e, idx)}
                          onDragLeave={handleLineDragLeave}
                          onDrop={(e) => handleLineDrop(e, idx)}
                          style={{ paddingLeft: `${6 + getLineIndentPx(line)}px`, ...spacingStyle }}
                        >
                          {!isFocused && (
                            <div 
                              className="line-drag-handle" 
                              title="Satırı taşımak için sürükleyin"
                              draggable
                              onDragStart={(e) => handleLineDragStart(e, idx)}
                              onDragEnd={handleLineDragEnd}
                            >
                              ⠿
                            </div>
                          )}
                          <div className="line-content-wrapper" onClick={isFocused ? (e) => e.stopPropagation() : undefined}>
                            {isFocused ? (
                              <AutoResizingTextarea
                                inputRef={(el) => { lineRefs.current[idx] = el; }}
                                value={line}
                                onChange={(e) => handleLineChange(idx, e.target.value, '', e.target.selectionStart, e)}
                                onKeyDown={(e) => handleLineKeyDown(e, idx)}
                                onKeyUp={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onSelect={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onFocus={() => handleLineFocus(idx)}
                                onBlur={() => handleLineBlur(idx)}
                                className="line-textarea"
                                placeholder="> Çağrı kutusu..."
                                autoFocus
                              />
                            ) : (
                              <div
                                onClick={() => handleLineClick(idx)}
                                className={`obsidian-callout callout-${type}`}
                                style={{ ...weldStyle, cursor: 'text' }}
                              >
                                {isCallout.isHeader ? (
                                  <div className="callout-header">
                                    {renderCalloutIcon(type)}
                                    <span className="callout-title">
                                      {parseInlineStylesAndTags(isCallout.title)}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="callout-content">
                                    {isCallout.content.trim() === '' ? (
                                      <span className="line-empty-placeholder">{'\u200B'}</span>
                                    ) : (
                                      renderLineWidgets(isCallout.content, idx)
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                            {renderWikiSuggestions(idx)}
                            {renderContextualToolbar(idx)}
                          </div>
                        </div>
                      );
                    }

                    // 2.7. If it's a Horizontal Rule
                    if (isHR) {
                      return (
                        <div
                          key={idx}
                          id={`editor-line-${idx}`}
                          className={`editor-line-container line-hr ${isFocused ? 'editor-line-active' : 'editor-line-inactive'} ${isSelected ? 'line-selected' : ''} ${dragOverIdx && dragOverIdx.idx === idx ? `drag-over-${dragOverIdx.position}` : ''}`}
                          onClick={(e) => handleLineClick(idx, e)}
                          onMouseDown={(e) => handleLineMouseDown(e, idx)}
                          onMouseEnter={() => {
                            if (isDragging) setDragSelectEndIdx(idx);
                          }}
                          draggable={false}
                          onDragOver={(e) => handleLineDragOver(e, idx)}
                          onDragLeave={handleLineDragLeave}
                          onDrop={(e) => handleLineDrop(e, idx)}
                          style={{ paddingLeft: `${6 + getLineIndentPx(line)}px`, ...spacingStyle }}
                        >
                          {!isFocused && (
                            <div 
                              className="line-drag-handle" 
                              title="Satırı taşımak için sürükleyin"
                              draggable
                              onDragStart={(e) => handleLineDragStart(e, idx)}
                              onDragEnd={handleLineDragEnd}
                            >
                              ⠿
                            </div>
                          )}
                          <div className="line-content-wrapper" onClick={isFocused ? (e) => e.stopPropagation() : undefined}>
                            {isFocused ? (
                              <AutoResizingTextarea
                                inputRef={(el) => { lineRefs.current[idx] = el; }}
                                value={line}
                                onChange={(e) => handleLineChange(idx, e.target.value, '', e.target.selectionStart, e)}
                                onKeyDown={(e) => handleLineKeyDown(e, idx)}
                                onKeyUp={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onSelect={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onFocus={() => handleLineFocus(idx)}
                                onBlur={() => handleLineBlur(idx)}
                                className="line-textarea"
                                placeholder="---"
                                autoFocus
                              />
                            ) : (
                              <div
                                onClick={(e) => handleLineClick(idx, e)}
                                style={{ cursor: 'text', width: '100%' }}
                              >
                                <div className="premium-hr-wrapper">
                                  <div className="hr-ornament-line" />
                                  <span className="hr-ornament-icon">⚜</span>
                                  <div className="hr-ornament-line" />
                                </div>
                              </div>
                            )}
                            {renderWikiSuggestions(idx)}
                            {renderContextualToolbar(idx)}
                          </div>
                        </div>
                      );
                    }

                    // 2.8. If it's a Footnote Definition
                    if (isFootnote) {
                      return (
                        <div
                          key={idx}
                          id={`editor-line-${idx}`}
                          className={`editor-line-container line-footnote ${isFocused ? 'editor-line-active' : 'editor-line-inactive'} ${isSelected ? 'line-selected' : ''} ${dragOverIdx && dragOverIdx.idx === idx ? `drag-over-${dragOverIdx.position}` : ''}`}
                          onClick={(e) => handleLineClick(idx, e)}
                          onMouseDown={(e) => handleLineMouseDown(e, idx)}
                          onMouseEnter={() => {
                            if (isDragging) setDragSelectEndIdx(idx);
                          }}
                          draggable={false}
                          onDragOver={(e) => handleLineDragOver(e, idx)}
                          onDragLeave={handleLineDragLeave}
                          onDrop={(e) => handleLineDrop(e, idx)}
                          style={{ paddingLeft: `${6 + getLineIndentPx(line)}px`, ...spacingStyle }}
                        >
                          {!isFocused && (
                            <div 
                              className="line-drag-handle" 
                              title="Satırı taşımak için sürükleyin"
                              draggable
                              onDragStart={(e) => handleLineDragStart(e, idx)}
                              onDragEnd={handleLineDragEnd}
                            >
                              ⠿
                            </div>
                          )}
                          <div className="line-content-wrapper" onClick={isFocused ? (e) => e.stopPropagation() : undefined}>
                            {isFocused ? (
                              <AutoResizingTextarea
                                inputRef={(el) => { lineRefs.current[idx] = el; }}
                                value={line}
                                onChange={(e) => handleLineChange(idx, e.target.value, '', e.target.selectionStart, e)}
                                onKeyDown={(e) => handleLineKeyDown(e, idx)}
                                onKeyUp={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onSelect={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onFocus={() => handleLineFocus(idx)}
                                onBlur={() => handleLineBlur(idx)}
                                className="line-textarea"
                                placeholder="[^dipnot]: Dipnot açıklaması..."
                                autoFocus
                              />
                            ) : (
                              <div onClick={(e) => handleLineClick(idx, e)} className="footnote-definition-card" style={{ cursor: 'text' }}>
                                <span className="footnote-def-tag">[^{isFootnote.label}]</span>
                                <div className="footnote-def-content">{renderLineWidgets(isFootnote.content, idx)}</div>
                              </div>
                            )}
                            {renderWikiSuggestions(idx)}
                            {renderContextualToolbar(idx)}
                          </div>
                        </div>
                      );
                    }

                    // 3. Headings or regular paragraphs
                    let lineClass = 'line-textarea';
                    let previewClass = 'preview-p';
                    let isH1 = false;
                    let isH2 = false;
                    let isH3 = false;

                    if (isHeading) {
                      const level = isHeading[1].length;
                      if (level === 1) {
                        lineClass += ' line-textarea-h1';
                        previewClass = 'preview-h1';
                        isH1 = true;
                      } else if (level === 2) {
                        lineClass += ' line-textarea-h2';
                        previewClass = 'preview-h2';
                        isH2 = true;
                      } else {
                        lineClass += ' line-textarea-h3';
                        previewClass = 'preview-h3';
                        isH3 = true;
                      }
                    }

                    let containerStyle: React.CSSProperties = { 
                      paddingLeft: `${6 + getLineIndentPx(line)}px`,
                      ...spacingStyle
                    };
                    if (isHeading) {
                      delete containerStyle.marginBottom;
                    }
                    
                    if (isInCodeBlock) {
                      const isStart = idx === activeCodeBlockRange.start;
                      const isEnd = idx === activeCodeBlockRange.end;
                      
                      containerStyle = {
                        ...containerStyle,
                        background: '#12131a', // Sleek Obsidian dark code block background
                        fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        paddingLeft: '20px',
                        paddingRight: '20px',
                        borderLeft: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRight: '1px solid rgba(255, 255, 255, 0.05)',
                        margin: '0 auto',
                        borderRadius: '0',
                        width: '100%',
                        maxWidth: '900px',
                        boxSizing: 'border-box'
                      };
                      
                      if (isStart) {
                        containerStyle.borderTop = '1px solid rgba(255, 255, 255, 0.05)';
                        containerStyle.borderRadius = '6px 6px 0 0';
                        containerStyle.paddingTop = '10px';
                        containerStyle.marginTop = '12px';
                      }
                      
                      if (isEnd) {
                        containerStyle.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
                        containerStyle.borderRadius = '0 0 6px 6px';
                        containerStyle.paddingBottom = '10px';
                        containerStyle.marginBottom = '12px';
                      }
                    }

                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                    // Flow State / Power Mode aktifken odaktaki satıra şık bir sol şerit ve arka plan ışıması ekler.
                    if (isFocused && comboCount > 5) {
                      const glowIntensity = Math.min(0.08, comboCount / 300);
                      const glowColor = comboCount > 25 ? '244, 63, 94' : '99, 102, 241';
                      
                      if (isInCodeBlock) {
                        containerStyle.background = `linear-gradient(to right, #12131a, rgba(${glowColor}, ${glowIntensity}))`;
                        containerStyle.boxShadow = `inset 3px 0 0 rgba(${glowColor}, 0.5)`;
                      } else {
                        containerStyle.background = `rgba(${glowColor}, ${glowIntensity})`;
                        containerStyle.boxShadow = `inset 4px 0 0 rgba(${glowColor}, 0.6)`;
                        containerStyle.borderRadius = '4px';
                      }
                    }

                    const hasFloat = line.includes('|left') || line.includes('|right');
                    if (hasFloat) {
                      containerStyle = {
                        ...containerStyle,
                        display: 'block',
                        overflow: 'visible'
                      };
                    }

                    return (
                      <div
                        key={idx}
                        id={`editor-line-${idx}`}
                        className={`editor-line-container ${isHeading ? `line-h${isHeading[1].length}` : 'line-paragraph'} ${isFocused ? 'editor-line-active' : 'editor-line-inactive'} ${isSelected ? 'line-selected' : ''} ${dragOverIdx && dragOverIdx.idx === idx ? `drag-over-${dragOverIdx.position}` : ''}`}
                        onClick={(e) => handleLineClick(idx, e)}
                        onMouseDown={(e) => handleLineMouseDown(e, idx)}
                        onMouseEnter={() => {
                          if (isDragging) setDragSelectEndIdx(idx);
                        }}
                        draggable={false}
                        onDragOver={(e) => handleLineDragOver(e, idx)}
                        onDragLeave={handleLineDragLeave}
                        onDrop={(e) => handleLineDrop(e, idx)}
                        style={containerStyle}
                      >
                        {!isFocused && !isHeading && (
                          <div 
                            className="line-drag-handle" 
                            title="Satırı taşımak için sürükleyin"
                            draggable
                            onDragStart={(e) => handleLineDragStart(e, idx)}
                            onDragEnd={handleLineDragEnd}
                          >
                            ⠿
                          </div>
                        )}
                        {isHeading && (
                          <div className="line-prefix-container" style={{ width: '24px', marginRight: '10px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span
                              className="heading-fold-chevron-wrapper"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCollapsedHeadings(prev => ({
                                  ...prev,
                                  [idx]: !prev[idx]
                                }));
                              }}
                            >
                              {collapsedHeadings[idx] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </span>
                          </div>
                        )}

                        <div 
                          className="line-content-wrapper" 
                          onClick={isFocused ? (e) => e.stopPropagation() : undefined}
                          style={hasFloat ? { display: 'block', width: '100%', overflow: 'visible' } : undefined}
                        >
                          {isFocused ? (
                            <div style={{ position: 'relative', width: '100%' }}>
                              <AutoResizingTextarea
                                inputRef={(el) => { lineRefs.current[idx] = el; }}
                                value={line}
                                onChange={(e) => handleLineChange(idx, e.target.value, '', e.target.selectionStart, e)}
                                onKeyDown={(e) => handleLineKeyDown(e, idx)}
                                onKeyUp={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onSelect={(e) => handleTextareaInteract(e.currentTarget, idx)}
                                onFocus={() => handleLineFocus(idx)}
                                onBlur={() => {
                                  handleLineBlur(idx);
                                  setTimeout(() => setShowSlashMenu(false), 200);
                                }}
                                className={lineClass}
                                placeholder={idx === 0 ? "Not başlığı..." : ""}
                                autoFocus
                                style={isInCodeBlock ? {
                                  fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace',
                                  fontSize: '13px',
                                  color: '#f4f4f5',
                                  lineHeight: '1.6'
                                } : undefined}
                              />
                              
                              {showSlashMenu && slashMenuLineIdx === idx && (() => {
                                const filtered = slashOptions.filter(opt => 
                                  opt.label.toLowerCase().includes(slashMenuFilter.toLowerCase()) || 
                                  opt.desc.toLowerCase().includes(slashMenuFilter.toLowerCase())
                                );
                                if (filtered.length === 0) return null;
                                return (
                                  <div className="slash-menu-popup animate-pop" style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    zIndex: 1000,
                                    background: '#1c1c24',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    borderRadius: '8px',
                                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                                    width: '260px',
                                    maxHeight: '260px',
                                    overflowY: 'auto',
                                    padding: '6px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px'
                                  }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
                                    {filtered.map((opt, oIdx) => {
                                      const Icon = opt.icon;
                                      const isActive = oIdx === activeSlashOptionIdx;
                                      return (
                                        <button
                                          key={opt.id}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            executeSlashCommand(opt, idx);
                                          }}
                                          className={`slash-option-btn ${isActive ? 'active' : ''}`}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            padding: '8px 10px',
                                            border: 'none',
                                            borderRadius: '6px',
                                            background: isActive ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                                            color: isActive ? 'var(--accent-color, #818cf8)' : 'var(--text-primary, #e2e8f0)',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            width: '100%',
                                            transition: 'all 0.15s'
                                          }}
                                        >
                                          <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '4px',
                                            background: isActive ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                                            color: isActive ? 'var(--accent-color, #818cf8)' : 'var(--text-secondary, #94a3b8)'
                                          }}>
                                            <Icon size={14} />
                                          </div>
                                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '12px', fontWeight: '500' }}>{opt.label}</span>
                                            <span style={{ fontSize: '9.5px', color: '#64748b', marginTop: '1px' }}>{opt.desc}</span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <div
                              onClick={(e) => handleLineClick(idx, e)}
                              className={previewClass}
                              style={isInCodeBlock ? {
                                cursor: 'text',
                                margin: 0,
                                padding: 0,
                                fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace',
                                fontSize: '13px',
                                color: '#a1a1aa',
                                lineHeight: '1.6'
                              } : { cursor: 'text', margin: 0, padding: 0 }}
                            >
                              {isHeading ? (
                                (() => {
                                  const { cleanText, colorClass } = parseHeadingColor(isHeading[2]);
                                  return (
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                      {isH1 ? (
                                        <h1 className={`preview-h1 ${colorClass}`} style={{ margin: 0, padding: 0, border: 'none', display: 'inline' }}>
                                          {renderLineWidgets(cleanText, idx)}
                                        </h1>
                                      ) : isH2 ? (
                                        <h2 className={`preview-h2 ${colorClass}`} style={{ margin: 0, padding: 0, border: 'none', display: 'inline' }}>
                                          {renderLineWidgets(cleanText, idx)}
                                        </h2>
                                      ) : (
                                        <h3 className={`preview-h3 ${colorClass}`} style={{ margin: 0, padding: 0, border: 'none', display: 'inline' }}>
                                          {renderLineWidgets(cleanText, idx)}
                                        </h3>
                                      )}
                                      {collapsedHeadings[idx] && <span className="heading-fold-dots">...</span>}
                                    </div>
                                  );
                                })()
                              ) : (
                                line.trim() === '' ? (
                                  <div className="line-empty-placeholder">{'\u200B'}</div>
                                ) : (
                                  renderLineWidgets(line, idx)
                                )
                              )}
                            </div>
                          )}
                          {renderWikiSuggestions(idx)}
                          {renderContextualToolbar(idx)}
                        </div>
                      </div>
                    );
                  };

                  return renderLinesWithColumns();
                })()}

                {/* Click target at bottom to add a new line */}
                <div className="live-editor-click-target" onClick={handleEmptyAreaClick} />

                  {/* Footnotes Section at the bottom */}
                  {(() => {
                    const { list: fnList } = getDetailedFootnotes();
                    if (fnList.length === 0) return null;
                    return (
                      <section className="editor-footnotes-section">
                        <div className="footnotes-title">
                          <BookOpen size={14} />
                          <span>DİPNOTLAR</span>
                        </div>
                        <div className="footnotes-list">
                          {fnList.map((fn, fidx) => {
                            const key = `${fn.label}-${fn.lineIdx}-${fidx}`;
                            return (
                              <div key={key} className="footnote-item" id={`fn-item-${fn.label}-${fn.lineIdx}`}>
                                <span className="footnote-item-num">{fn.index}</span>
                                <div className="footnote-item-content">
                                  {parseInlineStylesAndTags(fn.content)}
                                  <a
                                    href={`#fn-ref-${fn.label}`}
                                    className="footnote-backlink"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const refLineIdx = lines.findIndex((line) => {
                                        const hasRef = line.includes(`[^${fn.label}]`);
                                        const isDef = line.trim().startsWith(`[^${fn.label}]:`);
                                        return hasRef && !isDef;
                                      });
                                      if (refLineIdx !== -1) {
                                        scrollToElement(`editor-line-${refLineIdx}`);
                                      } else {
                                        scrollToElement(`editor-line-${fn.lineIdx}`);
                                      }
                                    }}
                                    title="Metne geri dön"
                                  >
                                    ↩
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

            {smartSuggestions.length > 0 && (
              <div className="smart-suggestions-bar" style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 16px',
                background: 'rgba(99, 102, 241, 0.04)',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                fontSize: '11px'
              }}>
                <span style={{ color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
                  <Sparkles size={12} />
                  <span>Akıllı Bağlantı Önerileri:</span>
                </span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {smartSuggestions.map(note => (
                    <button
                      key={note.path}
                      type="button"
                      onClick={() => handleInsertSmartLink(note.name)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        fontSize: '10.5px'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                      }}
                    >
                      + {note.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(() => {
              const stats = getEditorStats();
              return (
                <div className="editor-status-bar">
                  <div className="status-bar-item">
                    <span>{stats.lineCount} satır</span>
                  </div>
                  <span className="status-bar-divider">|</span>
                  <div className="status-bar-item">
                    <span>{stats.wordCount} kelime</span>
                  </div>
                  <span className="status-bar-divider">|</span>
                  <div className="status-bar-item">
                    <span>{stats.charCount} karakter</span>
                  </div>
                  <span className="status-bar-divider">|</span>
                  <div className="status-bar-item" style={{ gap: '4px' }}>
                    <Clock size={11} />
                    <span>{stats.readingTimeStr}</span>
                  </div>
                </div>
              );
            })()}

            {backlinks.length > 0 && (
              <div className="backlinks-panel" style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '10px 16px 14px 16px',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)'
              }}>
                <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600', fontSize: '11px' }}>
                  <Link2 size={12} />
                  <span>Bağlantılı Notlar ({backlinks.length}):</span>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {backlinks.map(({ note, snippet }) => (
                    <div
                      key={note.path}
                      onClick={() => setActiveNotePath(note.path)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'; }}
                    >
                      <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-primary)' }}>📄 {note.name}</span>
                      {snippet && (
                        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {snippet}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
              </>
            )}

          </>
        ) : (
          <div className="editor-empty-state">
            <FileText size={48} />
            <h3>Bir not seçin ya da yenisini oluşturun</h3>
            <p>Fabrika arayüzünden hızlıca dumping yapabilir ya da buradan doğrudan notlarınızı yönetebilirsiniz.</p>
          </div>
        )}
      </div>
      {isReceiptModalOpen && (() => {
        const checkedItems = lines
          .map((l, index) => ({ text: l, index }))
          .filter(item => item.text.trim().startsWith('- [x] ') || item.text.trim().startsWith('- [X] '))
          .map(item => {
            const match = item.text.trim().match(/^[-*+]\s+\[[xX]\]\s*(.*)$/);
            return {
              text: match ? match[1].trim() : item.text,
              originalIndex: item.index
            };
          });

        const handleSaveReceipt = async () => {
          const linesArr = [...lines];
          let total = parseFloat(receiptAmount);
          if (isNaN(total)) {
            total = 0;
            Object.values(receiptItemPrices).forEach(p => {
              const val = parseFloat(p);
              if (!isNaN(val)) total += val;
            });
          }

          if (total <= 0 && Object.keys(receiptItemPrices).length === 0) return;

          const itemDetails = checkedItems.map(item => {
            const price = receiptItemPrices[item.originalIndex];
            return price ? `${item.text} [fiyat: ${price}]` : item.text;
          }).join(', ');

          const today = new Date().toISOString().split('T')[0];
          const locationTag = receiptLocation.trim() ? ` @${receiptLocation.trim()}` : '';
          
          // Taksit sayısı 1'den büyükse [taksit: X] etiketini harcama satırına ekle
          const instVal = parseInt(receiptInstallment, 10);
          const installmentTag = (!isNaN(instVal) && instVal > 1) ? ` [taksit: ${instVal}]` : '';
          const receiptLine = `- [harcama: ${total} TL]${locationTag} (${itemDetails}) [${today}]${installmentTag}`;

          const sortedIndices = checkedItems.map(i => i.originalIndex).sort((a, b) => b - a);
          sortedIndices.forEach(idx => {
            linesArr.splice(idx, 1);
          });
          linesArr.push(receiptLine);

          setEditorContent(linesArr.join('\n'));
          setIsReceiptModalOpen(false);
        };

        return (
          <div className="modal-overlay active" onClick={() => setIsReceiptModalOpen(false)}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ width: '400px', padding: '20px', background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', color: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🧾</span> Fiş Oluştur (Harcama Kaydı)
                </h3>
                <button onClick={() => setIsReceiptModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '4px' }}>
                  <strong>Seçili Ürünler:</strong> {checkedItems.map(i => i.text).join(', ')}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Alışveriş Yapılan Yer</label>
                  <input 
                    type="text" 
                    placeholder="Bim, Migros, Bakkal vb."
                    value={receiptLocation}
                    onChange={(e) => setReceiptLocation(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: '12px', background: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Toplam Tutar (TL)</label>
                  <input 
                    type="number" 
                    placeholder="Örnek: 150"
                    value={receiptAmount}
                    onChange={(e) => setReceiptAmount(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: '12px', background: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#fff' }}
                  />
                </div>

                {/* Taksit seçeneği belirleme alanı */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Taksit Seçeneği</label>
                  <select
                    value={receiptInstallment}
                    onChange={(e) => setReceiptInstallment(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: '12px', background: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#fff' }}
                  >
                    <option value="1">Tek Çekim</option>
                    <option value="2">2 Taksit</option>
                    <option value="3">3 Taksit</option>
                    <option value="4">4 Taksit</option>
                    <option value="6">6 Taksit</option>
                    <option value="9">9 Taksit</option>
                    <option value="12">12 Taksit</option>
                  </select>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', marginTop: '4px' }}>
                  <label style={{ display: 'block', fontSize: '11px', marginBottom: '8px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Ürün Bazlı Fiyatlar (Opsiyonel)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto', paddingRight: '4px' }}>
                    {checkedItems.map(item => (
                      <div key={item.originalIndex} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.text}</span>
                        <input 
                          type="number" 
                          placeholder="Fiyat"
                          value={receiptItemPrices[item.originalIndex] || ''}
                          onChange={(e) => setReceiptItemPrices(prev => ({ ...prev, [item.originalIndex]: e.target.value }))}
                          style={{ width: '70px', padding: '4px 6px', fontSize: '11px', background: '#1c1c24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: '#fff' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={handleSaveReceipt}
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    padding: '8px',
                    background: '#10b981',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Fişi Onayla ve Listeyi Temizle
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Capacitor Android Widget Trigger Effect */}
      {(() => {
        // Trigger effect
        React.useEffect(() => {
          const checkWidgetReceiptTrigger = async () => {
            if (isElectron) return; // Capacitor only
            try {
              const isHarcamaNote = editorContent.toLowerCase().includes('#harcama');
              const { value } = await Preferences.get({ key: 'trigger_receipt_modal' });
              if (value === 'true') {
                await Preferences.remove({ key: 'trigger_receipt_modal' });
                const checkedItems = lines
                  .map((l, index) => ({ text: l, index }))
                  .filter(item => item.text.trim().startsWith('- [x] ') || item.text.trim().startsWith('- [X] '));

                if (isHarcamaNote && checkedItems.length > 0) {
                  setReceiptAmount('');
                  setReceiptLocation('');
                  // Fiş açıldığında taksit seçeneğini varsayılana sıfırla
                  setReceiptInstallment('1');
                  setReceiptItemPrices({});
                  setIsReceiptModalOpen(true);
                }
              }
            } catch (e) {
              console.error('Widget bridge error:', e);
            }
          };
          checkWidgetReceiptTrigger();
        }, [activeNotePath, editorContent]);
        return null;
      })()}

      {/* Sürüm Geçmişi (Version History) Modalı */}
      {isHistoryModalOpen && (
        <div className="modal-overlay active" onClick={() => { setIsHistoryModalOpen(false); setPreviewVersion(null); }}>
          <div
            className="modal-container"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '640px',
              maxWidth: '95%',
              maxHeight: '80vh',
              padding: '20px',
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent)' }}>
                <History size={16} /> Sürüm Geçmişi
              </h3>
              <button onClick={() => { setIsHistoryModalOpen(false); setPreviewVersion(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>

            {isLoadingHistory ? (
              <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>Yükleniyor...</div>
            ) : versionHistory.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                Bu not için henüz kaydedilmiş bir sürüm geçmişi yok.<br />
                <span style={{ fontSize: '10.5px' }}>Not her düzenlenip kaydedildiğinde, bir önceki hâli otomatik olarak burada saklanır.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '12px', minHeight: '300px', maxHeight: '55vh' }}>
                {/* Sol: Sürüm Listesi */}
                <div style={{ width: '200px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: '10px' }}>
                  {versionHistory.map((v, idx) => {
                    const isSelected = previewVersion?.timestamp === v.timestamp;
                    return (
                      <div
                        key={v.timestamp}
                        onClick={() => setPreviewVersion(v)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '11.5px',
                          background: isSelected ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.02)',
                          border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                          transition: 'background 0.15s'
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{new Date(v.timestamp).toLocaleDateString('tr-TR')}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(v.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                        {idx === 0 && <div style={{ fontSize: '9px', color: 'var(--accent)', marginTop: '2px' }}>En yeni</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Sağ: Önizleme + Geri Yükle */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
                  {!previewVersion ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                      Önizlemek için sol taraftan bir sürüm seçin.
                    </div>
                  ) : (
                    <>
                      <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        background: 'rgba(0,0,0,0.2)',
                        borderRadius: '8px',
                        padding: '12px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: 'var(--text-secondary)'
                      }}>
                        {previewVersion.content || '(boş içerik)'}
                      </div>
                      <button
                        onClick={() => {
                          if (confirm('Bu sürümü geri yüklemek istediğinize emin misiniz? Mevcut hâl de otomatik olarak geçmişe kaydedilecek.')) {
                            handleRestoreVersion(previewVersion);
                          }
                        }}
                        style={{
                          background: 'var(--accent)',
                          border: 'none',
                          borderRadius: '6px',
                          color: 'white',
                          padding: '8px 14px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        <History size={13} /> Bu Sürümü Geri Yükle
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dynamic Block Transclusion / Embedding Picker Modal */}
      {isTransclusionModalOpen && (
        <div className="modal-overlay active" onClick={() => setIsTransclusionModalOpen(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ width: '500px', maxWidth: '95%', padding: '20px', background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', color: '#fff', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent)' }}>
                <span>🔗</span> Gömülü Blok Oluşturucu (Block Transclusion)
              </h3>
              <button onClick={() => setIsTransclusionModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>

            {!selectedTransclusionNote ? (
              // Step 1: Select Note
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>1. Adım: Gömülecek Notu Seçin</label>
                <input 
                  type="text" 
                  value={transclusionSearch}
                  onChange={(e) => setTransclusionSearch(e.target.value)}
                  placeholder="Not ismine göre ara..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(0,0,0,0.2)',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '13px'
                  }}
                  autoFocus
                />
                <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', padding: '6px' }}>
                  {notes
                    .filter(n => n.name.toLowerCase().includes(transclusionSearch.toLowerCase()))
                    .slice(0, 10)
                    .map((note) => (
                      <div 
                        key={note.path}
                        onClick={() => setSelectedTransclusionNote(note)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12.5px',
                          background: 'rgba(255,255,255,0.02)',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99,102,241,0.15)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      >
                        📄 {note.name}
                      </div>
                    ))}
                  {notes.filter(n => n.name.toLowerCase().includes(transclusionSearch.toLowerCase())).length === 0 && (
                    <div style={{ padding: '8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>Eşleşen not bulunamadı.</div>
                  )}
                </div>
              </div>
            ) : (
              // Step 2: Select Section
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(99,102,241,0.1)', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px' }}>
                  <span>📄</span>
                  <strong>Seçili Not:</strong> {selectedTransclusionNote.name}
                  <button 
                    onClick={() => setSelectedTransclusionNote(null)}
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                  >
                    Değiştir
                  </button>
                </div>

                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>2. Adım: Gömülecek Bölümü Seçin (Opsiyonel)</label>
                
                <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', padding: '6px' }}>
                  {/* Option 1: Embed Whole Note */}
                  <div 
                    onClick={() => {
                      const linesArr = [...lines];
                      linesArr[transclusionLineIdx!] = `![[${selectedTransclusionNote.name.replace(/\.md$/, '')}]]`;
                      setEditorContent(linesArr.join('\n'));
                      setIsTransclusionModalOpen(false);
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12.5px',
                      background: 'rgba(255,255,255,0.04)',
                      fontWeight: 'bold',
                      color: 'var(--accent)',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99,102,241,0.2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  >
                    🔗 Notun Tamamını Göm (Tüm İçerik)
                  </div>

                  {/* Parse and list sections */}
                  {(() => {
                    const content = fileContents[selectedTransclusionNote.path] || '';
                    const headers = content.split('\n')
                      .map(l => l.trim())
                      .filter(l => l.startsWith('#'))
                      .map(l => {
                        const m = l.match(/^(#+)\s+(.*)$/);
                        return m ? { level: m[1].length, text: m[2].trim() } : null;
                      })
                      .filter(h => h !== null) as Array<{ level: number; text: string }>;

                    if (headers.length === 0) {
                      return (
                        <div style={{ padding: '8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '6px' }}>
                          Bu notun içinde başlık bulunmamaktadır. Yalnızca tümü gömülebilir.
                        </div>
                      );
                    }

                    return headers.map((h, idx) => (
                      <div 
                        key={idx}
                        onClick={() => {
                          const linesArr = [...lines];
                          linesArr[transclusionLineIdx!] = `![[${selectedTransclusionNote.name.replace(/\.md$/, '')}#${h.text}]]`;
                          setEditorContent(linesArr.join('\n'));
                          setIsTransclusionModalOpen(false);
                        }}
                        style={{
                          padding: '8px 10px',
                          paddingLeft: `${h.level * 10}px`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12.5px',
                          background: 'rgba(255,255,255,0.02)',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99,102,241,0.15)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      >
                        {'#'.repeat(h.level)} {h.text}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Power Mode / Flow State parçacık çizim alanı ve combo göstergesi. */}
      {isFlowEffectsEnabled && (
        <canvas
          ref={canvasRef}
          className="flow-sparks-canvas"
        />
      )}

      {comboCount > 5 && (
        <div 
          key={comboCount}
          className="flow-combo-meter animate-pop"
          style={{
            position: 'fixed',
            top: '80px',
            right: '40px',
            zIndex: 10000,
            padding: '10px 18px',
            borderRadius: '10px',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: comboCount > 25 
              ? '0 0 20px rgba(244, 63, 94, 0.3), 0 0 4px rgba(244, 63, 94, 0.2)' 
              : '0 0 15px rgba(99, 102, 241, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            color: '#fff',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            transition: 'all 0.3s ease',
            transform: `scale(${1 + Math.min(0.2, comboCount / 100)})`
          }}
        >
          <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#a5b4fc', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {comboCount > 25 ? '⚡ FLOW STATE ⚡' : '🔥 COMBO 🔥'}
          </span>
          <span style={{ fontSize: '24px', fontWeight: '900', color: comboCount > 25 ? '#f43f5e' : '#818cf8', textShadow: '0 0 10px currentColor' }}>
            x{comboCount}
          </span>
          {currentWpm > 0 && (
            <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', fontWeight: 'bold' }}>
              {currentWpm} WPM
            </span>
          )}
        </div>
      )}

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Obsidian tarzı Ctrl+hover not önizleme kartı. Fareyi popup'ın üzerine taşıyıp
          içeriği kaydırarak okuyabilmek için onMouseEnter/Leave ile hoveredWikiLink'i
          canlı tutuyoruz — aksi halde bağlantıdan popup'a geçerken kart hemen kapanırdı. */}
      {linkPreview && (
        <div
          ref={linkPreviewElRef}
          onMouseEnter={cancelHideWikiPreview}
          onMouseLeave={scheduleHideWikiPreview}
          style={{
            position: 'fixed',
            top: `${Math.min(linkPreview.y, window.innerHeight - 260)}px`,
            left: `${Math.min(linkPreview.x, window.innerWidth - 340)}px`,
            width: '320px',
            maxHeight: '260px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            zIndex: 10001,
            background: 'rgba(20, 20, 25, 0.97)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(14px)',
            padding: '12px 14px',
            animation: 'fadeIn 0.15s ease'
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-color)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Link2 size={12} />
            {linkPreview.targetName}
          </div>
          {!linkPreview.exists ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
              Bu not henüz oluşturulmadı.
            </p>
          ) : linkPreview.loading ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Yükleniyor…</p>
          ) : (
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              wordBreak: 'break-word',
              lineHeight: 1.5
            }}>
              {linkPreview.content.trim() === '' ? (
                <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Not boş.</span>
              ) : (
                linkPreview.content.split('\n').slice(0, 60).map((line, idx) => renderPreviewLine(line, idx))
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
