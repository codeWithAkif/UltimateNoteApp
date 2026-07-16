import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FlaskConical, Plus, Trash2, Search, Zap, FileText, Sparkles, Maximize2 } from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

interface ForgeWorkbenchViewProps {
  notes: NoteItem[];
  fileContents: Record<string, string>;
  onSaveNote: (path: string, content: string) => Promise<any>;
  onSelectNote: (path: string) => void;
}

interface PotNote {
  id: string;
  path: string;
  name: string;
  x: number;
  y: number;
}

export default function ForgeWorkbenchView({
  notes,
  fileContents,
  onSaveNote,
  onSelectNote
}: ForgeWorkbenchViewProps) {
  // Arama metni (not kütüphanesi için)
  const [searchQuery, setSearchQuery] = useState('');
  
  // Tuval üzerindeki aktif not pencereleri (sınırsız)
  const [activePots, setActivePots] = useState<PotNote[]>([]);
  
  // Yeni sentez not bilgileri
  const [newNoteName, setNewNoteName] = useState('');
  const [anvilContent, setAnvilContent] = useState('');
  
  // Seçilen metin takibi
  const [selectedText, setSelectedText] = useState('');
  const [activeSelectionPotId, setActiveSelectionPotId] = useState<string | null>(null);

  // Özel uyarı mesajı ve girdi odağı ref'i (Kural 5)
  const [alertText, setAlertText] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Sonsuz tuval pan & zoom durumları
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [draggedPotId, setDraggedPotId] = useState<string | null>(null);

  // Sürükle ve bırak referansları
  const panStart = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0, potX: 0, potY: 0 });

  // Kimyasal reaksiyon / sentez animasyon durumu
  const [isForging, setIsForging] = useState(false);

  // Seçmek için kullanılacak markdown notları listesi
  const filteredNotes = useMemo(() => {
    return notes.filter(n => 
      n.type === 'note' && 
      n.path.endsWith('.md') &&
      n.path.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [notes, searchQuery]);

  // Kütüphaneden silinen notları tuvalden de temizleyen senkronizasyon (Kural 5)
  useEffect(() => {
    setActivePots(prev => prev.filter(pot => 
      notes.some(n => n.path === pot.path)
    ));
  }, [notes]);

  // Tuvale (Çalışma Tezgahına) Not Ekleme
  const addToPot = (notePath: string) => {
    if (!notePath) return;
    const isAlreadyInPot = activePots.some(p => p.path === notePath);
    if (isAlreadyInPot) {
      setAlertText('Bu not zaten çalışma tezgahınızda açık!');
      return;
    }

    const name = notePath.split('/').pop()?.replace('.md', '') || 'Adsız Not';
    // Ekranın/tuvalin ortasına yerleştir
    const potX = (window.innerWidth * 0.35 - pan.x - 160) / zoom;
    const potY = (window.innerHeight / 2 - pan.y - 190) / zoom;

    setActivePots(prev => [...prev, {
      id: `pot_${Date.now()}`,
      path: notePath,
      name,
      x: potX,
      y: potY
    }]);
  };

  // Tezgahtan (Tuvalden) Not Çıkarma
  const removeFromPot = (id: string) => {
    // Seçimi temizle
    try {
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      console.error(e);
    }

    setActivePots(prev => prev.filter(p => p.id !== id));
    if (activeSelectionPotId === id) {
      setSelectedText('');
      setActiveSelectionPotId(null);
    }
  };

  // Sonsuz Tuval Sürükleme Başlangıcı
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('canvas-viewport') || target.classList.contains('canvas-grid')) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.preventDefault();
    }
  };

  // Sürükleme ve Pencere Taşıma Hareketleri
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y
      });
    } else if (draggedPotId) {
      const deltaX = (e.clientX - dragStart.current.x) / zoom;
      const deltaY = (e.clientY - dragStart.current.y) / zoom;
      
      setActivePots(prev => prev.map(p => {
        if (p.id === draggedPotId) {
          return {
            ...p,
            x: dragStart.current.potX + deltaX,
            y: dragStart.current.potY + deltaY
          };
        }
        return p;
      }));
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggedPotId(null);
  };

  // Not Penceresi Sürükleme Başlangıcı
  const handlePotDragStart = (e: React.MouseEvent, potId: string) => {
    const pot = activePots.find(p => p.id === potId);
    if (!pot) return;
    
    setDraggedPotId(potId);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      potX: pot.x,
      potY: pot.y
    };
    e.stopPropagation();
  };

  // Tekerlek ile Yakınlaştırma / Uzaklaştırma
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.08;
    let nextZoom = zoom;
    if (e.deltaY < 0) {
      nextZoom = Math.min(zoom * zoomFactor, 1.8);
    } else {
      nextZoom = Math.max(zoom / zoomFactor, 0.35);
    }
    setZoom(nextZoom);
  };

  // Metin Seçim Tespiti
  const handleSelectionDetect = (potId: string) => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      setSelectedText(selection.toString().trim());
      setActiveSelectionPotId(potId);
    } else {
      setSelectedText('');
      setActiveSelectionPotId(potId);
    }
  };

  // Seçileni Sentez Alanına Ekle
  const rivetSelectionToAnvil = (text: string, sourceName: string) => {
    if (!text) return;
    setAnvilContent(prev => {
      const separator = prev.length > 0 ? '\n\n' : '';
      return `${prev}${separator}> 📄 **[[${sourceName}]]**:\n> ${text.split('\n').join('\n> ')}`;
    });
    
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
  };

  // Tüm Notu Sentez Alanına Ekle
  const addAllToAnvil = (notePath: string, name: string) => {
    const content = fileContents[notePath] || '';
    setAnvilContent(prev => {
      const separator = prev.length > 0 ? '\n\n' : '';
      return `${prev}${separator}## 📌 [[${name}]] Tam İçeriği\n\n${content}`;
    });
  };

  // Kimyasal Sentezleme & Not Kaydetme
  const handleForgeNote = () => {
    if (!newNoteName.trim()) {
      setAlertText('Lütfen yeni sentez notuna bir başlık verin!');
      return;
    }
    if (!anvilContent.trim()) {
      setAlertText('Sentez alanı boş! Lütfen önce tezgahtaki notlardan içerik ekleyin.');
      return;
    }

    setIsForging(true);

    const cleanName = newNoteName.trim().replace(/[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ\s-]/g, '');
    const finalPath = `Sentez/${cleanName}.md`;

    setTimeout(async () => {
      try {
        await onSaveNote(finalPath, anvilContent);
        setNewNoteName('');
        setAnvilContent('');
        setActivePots([]);
        setIsForging(false);
        onSelectNote(finalPath);
      } catch (e) {
        console.error(e);
        setIsForging(false);
        setAlertText('Not Sentezlenirken Bir Hata Oluştu!');
      }
    }, 2400); // Fokurdayan cam şişe animasyon süresi
  };

  // Kimyasal Kabarcık (Bubble) Animasyon Değerleri
  const bubbles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 20; i++) {
      const x = 30 + Math.random() * 60; // Flask taban genişliği aralığı
      const delay = Math.random() * 1.8;
      const size = 3 + Math.random() * 6;
      const duration = 0.8 + Math.random() * 0.8;
      arr.push({ id: i, x, delay, size, duration });
    }
    return arr;
  }, [isForging]);

  return (
    <div className="forge-view-container" style={{ display: 'flex', height: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box', overflow: 'hidden', position: 'relative' }}>
      
      {/* 🧪 Bubbling Chemical Flask Animation Overlay */}
      {isForging && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0,
          width: '100vw', height: '100vh',
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          userSelect: 'none'
        }}>
          {/* Beaker Container */}
          <div style={{ position: 'relative', width: '200px', height: '240px' }}>
            
            {/* Liquid Bubbles inside Beaker */}
            {bubbles.map(bubble => (
              <div
                key={bubble.id}
                style={{
                  position: 'absolute',
                  width: `${bubble.size}px`,
                  height: `${bubble.size}px`,
                  borderRadius: '50%',
                  background: 'rgba(234, 88, 12, 0.8)',
                  boxShadow: '0 0 8px #f97316, 0 0 16px #ff6b35',
                  left: `${bubble.x}px`,
                  bottom: '30px',
                  opacity: 0,
                  pointerEvents: 'none',
                  animation: `bubbleUp ${bubble.duration}s ease-in infinite`,
                  animationDelay: `${bubble.delay}s`
                }}
              />
            ))}

            {/* SVG Chemical Conical Flask (Glass) */}
            <svg width="100%" height="100%" viewBox="0 0 120 150" style={{ overflow: 'visible' }}>
              {/* Glowing Liquid Base */}
              <path
                d="M38 75 L82 75 L106 122 A 8 8 0 0 1 98 135 L22 135 A 8 8 0 0 1 14 122 Z"
                fill="url(#liquidGrad)"
                style={{ filter: 'drop-shadow(0 0 12px rgba(234, 88, 12, 0.6))' }}
              />
              
              {/* Glass Frame Outline */}
              <path
                d="M50 20 L70 20 L70 50 L110 122 A 10 10 0 0 1 100 137 L20 137 A 10 10 0 0 1 10 122 L50 50 Z"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="4"
                strokeLinejoin="round"
              />

              {/* Glowing Steam rising up */}
              <path
                d="M54 10 Q50 -10 56 -25 M66 10 Q70 -10 64 -25"
                fill="none"
                stroke="rgba(253, 186, 116, 0.3)"
                strokeWidth="2"
                strokeLinecap="round"
                style={{ animation: 'steamRise 1.2s linear infinite' }}
              />

              <defs>
                <linearGradient id="liquidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#ea580c" stopOpacity="0.8" />
                </linearGradient>
              </defs>
            </svg>

          </div>

          {/* Status Message */}
          <h2 style={{
            margin: '20px 0 8px 0',
            fontSize: '18px',
            color: 'var(--text-primary)',
            textShadow: '0 0 10px rgba(249, 115, 22, 0.6)',
            letterSpacing: '1px',
            animation: 'pulseText 1.5s ease-in-out infinite',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <FlaskConical style={{ color: '#f97316' }} /> Fikirler Sentezleniyor...
          </h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>Çalışma tezgahındaki notlar reaksiyona giriyor, birleştiriliyor.</p>
        </div>
      )}

      {/* 2D Infinite Canvas (Left / Center - 70% width) */}
      <div
        className="canvas-viewport"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onWheel={handleWheel}
        style={{
          width: '70%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          cursor: isPanning ? 'grabbing' : 'grab',
          userSelect: 'none',
          background: 'var(--bg-primary)'
        }}
      >
        {/* Infinite Grid Background */}
        <div
          className="canvas-grid"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            pointerEvents: 'none',
            backgroundSize: `${40 * zoom}px ${40 * zoom}px`,
            backgroundImage: `
              linear-gradient(to right, var(--border-color) 1px, transparent 1px),
              linear-gradient(to bottom, var(--border-color) 1px, transparent 1px)
            `,
            opacity: 0.25,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        />

        {/* Toolbar Overlay on Canvas */}
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          padding: '8px 12px',
          backdropFilter: 'blur(12px)'
        }}>
          {/* Note selector to add */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <select
              onChange={(e) => {
                addToPot(e.target.value);
                e.target.value = ''; // Reset selection
              }}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                outline: 'none',
                width: '180px'
              }}
            >
              <option value="">➕ Tuvale Not Ekle...</option>
              {filteredNotes.map(n => (
                <option key={n.path} value={n.path}>{n.path.split('/').pop()?.replace('.md', '')}</option>
              ))}
            </select>
          </div>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />

          {/* Zoom Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ölçek: %{Math.round(zoom * 100)}</span>
            <button
              onClick={() => { setPan({ x: 50, y: 50 }); setZoom(1); }}
              style={{
                background: 'var(--bg-tertiary)',
                border: 'none',
                borderRadius: '4px',
                color: 'var(--text-primary)',
                padding: '4px 8px',
                fontSize: '10.5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '2px'
              }}
              title="Görünümü Sıfırla"
            >
              <Maximize2 size={10} /> Ortala
            </button>
          </div>
        </div>

        {/* 2D Transform Group (Moving elements) */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '4000px',
            height: '4000px',
            pointerEvents: 'none'
          }}
        >
          {/* Note Windows Scattered on Canvas */}
          {activePots.map(pot => {
            const content = fileContents[pot.path] || '*Not içeriği bulunamadı veya boş.*';
            const isThisPotSelected = activeSelectionPotId === pot.id && selectedText.length > 0;

            return (
              <div
                key={pot.id}
                style={{
                  position: 'absolute',
                  left: pot.x,
                  top: pot.y,
                  width: '320px',
                  height: '380px',
                  background: 'var(--bg-secondary)',
                  backdropFilter: 'blur(16px)',
                  border: isThisPotSelected ? '2px solid #ea580c' : '1px solid var(--border-color)',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
                  pointerEvents: 'auto',
                  transition: 'border-color 0.2s',
                  boxSizing: 'border-box'
                }}
              >
                {/* Pot Window Header */}
                <div
                  onMouseDown={(e) => handlePotDragStart(e, pot.id)}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--bg-tertiary)',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'move',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderRadius: '11px 11px 0 0'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                    <FileText size={13} style={{ color: '#ea580c', flexShrink: 0 }} />
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '230px' }} title={pot.name}>
                      {pot.name}
                    </strong>
                  </div>
                  
                  <button
                    onClick={() => removeFromPot(pot.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: '2px 6px'
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Pot Window scrollable Markdown full-text */}
                <div
                  onMouseUp={() => handleSelectionDetect(pot.id)}
                  onKeyUp={() => handleSelectionDetect(pot.id)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    overflowY: 'auto',
                    fontSize: '12px',
                    lineHeight: '1.55',
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-primary)',
                    userSelect: 'text',
                    background: 'var(--bg-primary)'
                  }}
                  className="pot-scroll custom-scroll"
                >
                  {content}
                </div>

                {/* Window footer action bar */}
                <div style={{
                  padding: '8px 12px',
                  background: 'var(--bg-tertiary)',
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  borderRadius: '0 0 11px 11px'
                }}>
                  {isThisPotSelected ? (
                    <button
                      onClick={() => rivetSelectionToAnvil(selectedText, pot.name)}
                      style={{
                        width: '100%',
                        background: '#ea580c',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#fff',
                        padding: '6px 12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        animation: 'pulseGlow 1.5s infinite'
                      }}
                    >
                      Seçileni Senteze Ekle 🧪
                    </button>
                  ) : (
                    <button
                      onClick={() => addAllToAnvil(pot.path, pot.name)}
                      style={{
                        width: '100%',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-secondary)',
                        padding: '6px 12px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      Tümünü Senteze Ekle 📥
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tip info inside canvas background */}
        <div style={{ position: 'absolute', bottom: '16px', left: '16px', fontSize: '11px', color: 'var(--text-secondary)', pointerEvents: 'none', zIndex: 1 }}>
          💡 Boş alana tıklayıp sürükleyerek tuvalde gezinin. Not başlığından tutarak pencereleri sürükleyin.
        </div>
      </div>

      {/* Fixed Right Sidebar: Sentez Editörü (30% width) */}
      <div className="forge-sidebar" style={{
        width: '30%',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        padding: '20px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        zIndex: 10,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.05)'
      }}>
        
        {/* Title header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
          <FlaskConical style={{ color: '#f97316' }} />
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            🧪 Sentez Tezgahı
          </h2>
        </div>

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
          
          {/* New note title */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', color: '#ff6b35', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              YENİ NOT BAŞLIĞI
            </label>
            <input
              ref={titleInputRef}
              type="text"
              placeholder="Orn: Termodinamik_Ozet"
              value={newNoteName}
              onChange={(e) => setNewNoteName(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: '12.5px',
                outline: 'none'
              }}
            />
          </div>

          {/* Anvil text editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
            <label style={{ fontSize: '11px', color: '#ff6b35', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              SENTEZLENEN NOT İÇERİĞİ (MARKDOWN)
            </label>
            <textarea
              placeholder="Tuvaldeki notlardan metin seçip ekleyin veya doğrudan buraya düzenleyin..."
              value={anvilContent}
              onChange={(e) => setAnvilContent(e.target.value)}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                lineHeight: '1.5',
                resize: 'none',
                outline: 'none',
                fontFamily: 'monospace'
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => setAnvilContent('')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f87171',
                fontSize: '11px',
                cursor: 'pointer',
                padding: '4px'
              }}
            >
              Temizle 🗑️
            </button>
            
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Karakter: {anvilContent.length}
            </span>
          </div>

          {/* Save Button */}
          <button
            onClick={handleForgeNote}
            style={{
              background: 'linear-gradient(90deg, #ea580c 0%, #f97316 100%)',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              padding: '12px',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 20px rgba(234, 88, 12, 0.4)',
              transition: 'all 0.2s'
            }}
            className="forge-action-btn"
          >
            <FlaskConical size={16} /> Notu Sentezle 🧪
          </button>

        </div>

      </div>

      {/* Custom Alert Overlay Modal */}
      {alertText && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0,
          width: '100vw', height: '100vh',
          background: 'rgba(0, 0, 0, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999,
          userSelect: 'none'
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '24px',
            width: '320px',
            textAlign: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
              {alertText}
            </p>
            <button
              onClick={() => {
                setAlertText(null);
                setTimeout(() => {
                  titleInputRef.current?.focus();
                }, 50);
              }}
              style={{
                background: 'linear-gradient(90deg, #ea580c 0%, #f97316 100%)',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                padding: '8px 24px',
                fontSize: '12.5px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scroll::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.2);
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(249, 115, 22, 0.3);
          border-radius: 3px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(249, 115, 22, 0.5);
        }
        .forge-ore-item:hover {
          background: rgba(249, 115, 22, 0.08) !important;
          border-color: rgba(249, 115, 22, 0.3) !important;
        }
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.5); }
          70% { box-shadow: 0 0 0 8px rgba(234, 88, 12, 0); }
          100% { box-shadow: 0 0 0 0 rgba(234, 88, 12, 0); }
        }
        .forge-action-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 24px rgba(234, 88, 12, 0.6);
        }
        .forge-action-btn:active {
          transform: translateY(1px);
        }
        
        /* 🧪 Bubbling Flask Animation Keyframes */
        @keyframes bubbleUp {
          0% {
            transform: translateY(0) scale(0.5);
            opacity: 0;
          }
          15% {
            opacity: 0.8;
          }
          85% {
            opacity: 0.8;
          }
          100% {
            transform: translateY(-110px) scale(1.3);
            opacity: 0;
          }
        }

        @keyframes steamRise {
          0% {
            stroke-dashoffset: 0;
            opacity: 0;
            transform: translateY(0);
          }
          50% {
            opacity: 0.5;
          }
          100% {
            stroke-dashoffset: -30;
            opacity: 0;
            transform: translateY(-10px);
          }
        }

        @keyframes pulseText {
          0%, 100% { opacity: 0.8; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.03); }
        }
      `}} />

    </div>
  );
}
