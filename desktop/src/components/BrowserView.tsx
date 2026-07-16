import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Search, Globe, FileText, Check, Loader2 } from 'lucide-react';
import { isElectron } from '../services/platform';
import { Browser } from '@capacitor/browser';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

interface BrowserViewProps {
  notes: NoteItem[];
  folders: string[];
  onSaveNote: (path: string, content: string) => Promise<void>;
  readNoteContent: (path: string) => Promise<string>;
  initialQuery?: string | null;
  onClearInitialQuery?: () => void;
}

export default function BrowserView({
  notes,
  folders,
  onSaveNote,
  readNoteContent,
  initialQuery,
  onClearInitialQuery
}: BrowserViewProps) {
  const webviewRef = useRef<HTMLElement>(null);
  
  // Set default initial URL
  const [currentUrl, setCurrentUrl] = useState(() => {
    if (initialQuery) {
      let targetUrl = initialQuery.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        if (/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        } else {
          targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
        }
      }
      return targetUrl;
    }
    return 'https://www.google.com';
  });

  const [urlInput, setUrlInput] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Determine active note from localStorage or default to first note
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(() => {
    const activePath = localStorage.getItem('active_note_path');
    if (activePath) return activePath;
    const firstNote = notes.find(n => n.type === 'note');
    return firstNote ? firstNote.path : null;
  });

  // Automatically update selectedNotePath if active note changes or is loaded
  useEffect(() => {
    const markdownNotes = notes.filter(n => n.type === 'note');
    if (markdownNotes.length > 0) {
      if (!selectedNotePath || !markdownNotes.some(n => n.path === selectedNotePath)) {
        const activePath = localStorage.getItem('active_note_path');
        if (activePath && markdownNotes.some(n => n.path === activePath)) {
          setSelectedNotePath(activePath);
        } else {
          setSelectedNotePath(markdownNotes[0].path);
        }
      }
    }
  }, [notes]);

  // Toast auto-dismiss
  useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => {
        setToastMsg(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  // Electron specific event listeners
  useEffect(() => {
    if (!isElectron) return;

    const webview = webviewRef.current;
    if (!webview) return;

    const handleStartLoading = () => setIsLoading(true);
    const handleStopLoading = () => {
      setIsLoading(false);
      try {
        const currentUrl = (webview as any).getURL();
        setUrlInput(currentUrl);
        setCurrentUrl(currentUrl);
      } catch (e) {
        // ignore
      }

      // Inject selection listeners to capture selected text
      try {
        (webview as any).executeJavaScript(`
          if (!window.hasSelectionListener) {
            window.hasSelectionListener = true;
            const reportSelection = () => {
              const sel = window.getSelection().toString();
              console.log('WEB_SELECTION:' + sel);
            };
            document.addEventListener('mouseup', reportSelection);
            document.addEventListener('keyup', reportSelection);
            document.addEventListener('selectionchange', reportSelection);
          }
        `);
      } catch (e) {
        console.error('Failed to inject selection listener:', e);
      }
    };

    const handleConsoleMessage = (e: any) => {
      const msg = e.message || '';
      if (msg.startsWith('WEB_SELECTION:')) {
        const selection = msg.substring('WEB_SELECTION:'.length).trim();
        setSelectedText(selection);
      }
    };

    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('console-message', handleConsoleMessage);

    return () => {
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('console-message', handleConsoleMessage);
    };
  }, []);

  const navigateTo = (input: string) => {
    let targetUrl = input.trim();
    if (!targetUrl) return;

    if (!/^https?:\/\//i.test(targetUrl)) {
      if (/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      } else {
        targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
      }
    }
    setCurrentUrl(targetUrl);
    setUrlInput(targetUrl);

    if (isElectron) {
      const webview = webviewRef.current;
      if (webview && typeof (webview as any).loadURL === 'function') {
        try {
          (webview as any).loadURL(targetUrl);
        } catch (e) {
          console.error('Failed to load URL:', e);
        }
      }
    } else {
      // Open in system browser via Capacitor Browser plugin
      Browser.open({ url: targetUrl }).catch(err => {
        console.error('Failed to open browser natively:', err);
        window.open(targetUrl, '_blank');
      });
    }
  };

  // Handle initial query from NoteFactory / launcher
  useEffect(() => {
    if (initialQuery) {
      navigateTo(initialQuery);
      if (onClearInitialQuery) {
        onClearInitialQuery();
      }
    }
  }, [initialQuery]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigateTo(urlInput);
    }
  };

  const goBack = () => {
    if (isElectron) {
      const webview = webviewRef.current;
      if (webview && typeof (webview as any).canGoBack === 'function' && (webview as any).canGoBack()) {
        (webview as any).goBack();
      }
    }
  };

  const goForward = () => {
    if (isElectron) {
      const webview = webviewRef.current;
      if (webview && typeof (webview as any).canGoForward === 'function' && (webview as any).canGoForward()) {
        (webview as any).goForward();
      }
    }
  };

  const reload = () => {
    if (isElectron) {
      const webview = webviewRef.current;
      if (webview && typeof (webview as any).reload === 'function') {
        (webview as any).reload();
      }
    }
  };

  const handlePasteToNote = async () => {
    if (!selectedNotePath) {
      setToastMsg('Lütfen hedef bir not seçin!');
      return;
    }
    if (!selectedText.trim()) {
      return;
    }

    try {
      const currentContent = await readNoteContent(selectedNotePath);
      const webview = webviewRef.current;
      let pageTitle = 'Web Kaynağı';
      if (webview && isElectron) {
        try {
          pageTitle = (webview as any).getTitle() || 'Web Kaynağı';
        } catch (e) {
          // ignore
        }
      }

      const citation = `\n\n> 📎 [Kaynak: ${pageTitle}](${currentUrl})\n${selectedText.split('\n').map(line => `> ${line}`).join('\n')}\n`;
      const updatedContent = currentContent.trimEnd() + citation;
      await onSaveNote(selectedNotePath, updatedContent);

      setToastMsg(`Seçili metin "${selectedNotePath.split('/').pop()?.replace('.md', '')}" notuna yapıştırıldı!`);
      setSelectedText('');
    } catch (e) {
      console.error('Failed to paste selected text:', e);
      setToastMsg('Yapıştırma işlemi başarısız oldu!');
    }
  };

  const markdownNotes = notes.filter(n => n.type === 'note');

  // RENDER FOR MOBILE / WEB
  if (!isElectron) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        background: 'var(--bg-primary)',
        padding: '24px',
        boxSizing: 'border-box',
        color: 'var(--text-primary)'
      }}>
        <div style={{
          maxWidth: '480px',
          width: '100%',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '32px 24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '14px',
            background: 'rgba(99, 102, 241, 0.15)',
            color: '#6366f1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '8px'
          }}>
            <Globe size={32} />
          </div>

          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-primary)' }}>Mobil Web Araştırma</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
              Güvenli ve kesintisiz bir deneyim için araştırmanızı yerel mobil tarayıcınızda yapın.
            </p>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '0 12px',
            height: '46px',
            width: '100%',
            gap: '8px',
            boxSizing: 'border-box'
          }}>
            <Search size={16} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  navigateTo(urlInput);
                }
              }}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '14px',
                outline: 'none',
                width: '100%'
              }}
              placeholder="Arama terimi veya URL girin..."
            />
          </div>

          <button
            onClick={() => navigateTo(urlInput)}
            style={{
              width: '100%',
              height: '42px',
              borderRadius: '8px',
              background: '#6366f1',
              color: '#ffffff',
              border: 'none',
              fontWeight: '600',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s'
            }}
          >
            <Search size={15} />
            Ara / Git
          </button>

          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: '12px',
            padding: '16px',
            textAlign: 'left',
            width: '100%',
            boxSizing: 'border-box'
          }}>
            <h4 style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              💡 Nasıl Araştırma Yapılır?
            </h4>
            <ol style={{ fontSize: '11.5px', color: 'var(--text-muted)', paddingLeft: '16px', margin: 0, display: 'flex', flexDirection: 'column', gap: '6px', lineHeight: '1.5' }}>
              <li>Aramak istediğinizi yazıp <b>Ara / Git</b> butonuna basın.</li>
              <li>Açılan pencerede beğendiğiniz bilgileri <b>kopyalayın</b>.</li>
              <li>Uygulamaya geri döndüğünüzde, kopyalanan metin otomatik olarak tespit edilecek ve aktif nota yapıştırma seçeneği sunulacaktır.</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // RENDER FOR DESKTOP (ELECTRON)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: 'var(--bg-primary)', position: 'relative' }}>
      
      {/* Top Browser Bar */}
      <div style={{
        height: 'var(--header-height)',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        gap: '12px',
        zIndex: 10
      }}>
        
        {/* Navigation Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
            onClick={goBack}
            className="nav-btn"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.04)'
            }}
            title="Geri"
          >
            <ArrowLeft size={16} />
          </button>
          
          <button 
            onClick={goForward}
            className="nav-btn"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.04)'
            }}
            title="İleri"
          >
            <ArrowRight size={16} />
          </button>

          <button 
            onClick={reload}
            className="nav-btn"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.04)'
            }}
            title="Yenile"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent-color)' }} /> : <RotateCw size={16} />}
          </button>
        </div>

        {/* URL Input Bar */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '0 12px',
          height: '34px',
          gap: '8px',
          position: 'relative'
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '13px',
              width: '100%'
            }}
            placeholder="Aramak istediğinizi yazın veya URL girin..."
          />
        </div>

        {/* Note Target Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600', whiteSpace: 'nowrap' }}>Hedef Not:</span>
          <select
            value={selectedNotePath || ''}
            onChange={(e) => setSelectedNotePath(e.target.value)}
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              maxWidth: '180px',
              cursor: 'pointer'
            }}
          >
            {markdownNotes.length === 0 ? (
              <option value="">[Not bulunamadı]</option>
            ) : (
              markdownNotes.map(n => (
                <option key={n.path} value={n.path}>
                  {n.path.split('/').pop()?.replace('.md', '')}
                </option>
              ))
            )}
          </select>
        </div>

      </div>

      {/* Webview Content Box */}
      <div style={{ flex: 1, position: 'relative', background: '#ffffff', overflow: 'hidden' }}>
        <webview
          ref={webviewRef as any}
          src={currentUrl}
          style={{ width: '100%', height: '100%', border: 'none', background: '#ffffff' }}
          allowpopups={true}
          useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ></webview>
      </div>

      {/* Floating Clipping Toolbar */}
      {selectedText && (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(20, 20, 22, 0.92)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          maxWidth: '85%',
          zIndex: 100
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '350px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Seçili Metin:</span>
            <span style={{
              fontSize: '12px',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontStyle: 'italic'
            }}>
              "{selectedText}"
            </span>
          </div>

          <div style={{ height: '24px', width: '1px', background: 'var(--border-color)' }}></div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handlePasteToNote}
              style={{
                background: 'var(--accent-color)',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <FileText size={14} />
              Nota Yapıştır
            </button>
            
            <button
              onClick={() => setSelectedText('')}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer'
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* Glassmorphic Toast Notification */}
      {toastMsg && (
        <div style={{
          position: 'absolute',
          top: '64px',
          right: '24px',
          background: 'rgba(16, 185, 129, 0.95)',
          backdropFilter: 'blur(8px)',
          color: '#fff',
          padding: '10px 16px',
          borderRadius: '8px',
          fontSize: '12px',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 1000
        }}>
          <Check size={16} />
          {toastMsg}
        </div>
      )}

    </div>
  );
}
