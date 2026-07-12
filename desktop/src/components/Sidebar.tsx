import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Inbox, FileText, Calendar, Clock, Database, Folder, Tag, Plus, Settings, CheckSquare, Zap, Trash2, Globe,
  Briefcase, Code, Heart, Star, BookOpen, Sparkles, Coffee, Rocket, Smile, HelpCircle, Headphones,
  ChevronLeft, ChevronRight, Wallet, KanbanSquare, BarChart2, Layout, Building2, Volume2, FlaskConical, Compass, Sun, Moon
} from 'lucide-react';

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

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  folders: string[];
  tags: string[];
  selectedFolder: string | null;
  setSelectedFolder: (folder: string | null) => void;
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: string) => void;
  syncStatus: 'synced' | 'syncing' | 'offline' | 'error';
  isSidebarOpen?: boolean;
  setIsSidebarOpen?: (open: boolean) => void;
  onOpenSettings?: () => void;
  onOpenHelp?: () => void;
  onFolderContextMenu?: (e: React.MouseEvent, folder: string) => void;
  folderCustomizations?: Record<string, { icon?: string; color?: string }>;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onToggleMiniMode?: () => void;
  isMiniMode?: boolean;
  isNoteCityEnabled?: boolean;
  isFocusPetEnabled?: boolean;
  fileContents?: Record<string, string>;
  notes?: any[];
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onSavePetData?: () => void;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Retro 16x16 piksel çözünürlüklü evcil hayvanı canvas üzerine piksel piksel çizen çizim motoru.
const drawPet = (ctx: CanvasRenderingContext2D, type: string, stage: number, frame: number, isCelebrating: boolean) => {
  ctx.clearRect(0, 0, 32, 32);
  ctx.imageSmoothingEnabled = false;
  
  // Kutlama veya nefes alma durumuna göre zıplama hareketi (frame hızı)
  const hop = isCelebrating ? (Math.floor(Date.now() / 120) % 2 === 0 ? 3 : 0) : (frame === 0 ? 0 : 1);
  
  // Elementlere göre renk paletinin ayarlanması
  let color = '#ef4444'; // Ateş: Kırmızı
  let lightColor = '#f97316'; // Ateş: Turuncu
  
  if (type === 'water') {
    color = '#2563eb'; // Su: Derin mavi
    lightColor = '#60a5fa'; // Su: Açık mavi
  } else if (type === 'electric') {
    color = '#ca8a04'; // Elektrik: Altın sarısı
    lightColor = '#facc15'; // Elektrik: Parlak sarı
  } else if (type === 'earth') {
    color = '#15803d'; // Toprak: Orman yeşili
    lightColor = '#4ade80'; // Toprak: Açık fidan yeşili
  } else if (type === 'wind') {
    color = '#64748b'; // Hava: Rüzgar grisi
    lightColor = '#cbd5e1'; // Hava: Bulut beyazı
  }

  // Çizim kalemi (Outline - Koyu mavi/siyah)
  ctx.fillStyle = '#0f172a';

  if (stage === 0) {
    // AŞAMA 0: BEBEK (Ember, Aqualing, Sparki, Seedling, Zephyr)
    // Yuvarlak, tatlı bir slime benzeri gövde çizimi
    ctx.fillRect(9, 15 - hop, 14, 11);
    ctx.fillRect(10, 14 - hop, 12, 13);
    
    ctx.fillStyle = color;
    ctx.fillRect(10, 15 - hop, 12, 9);
    ctx.fillRect(11, 14 - hop, 10, 11);
    
    // Yüz ışıması
    ctx.fillStyle = lightColor;
    ctx.fillRect(12, 16 - hop, 8, 7);

    // Gözler
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(13, 17 - hop, 2, 2);
    ctx.fillRect(17, 17 - hop, 2, 2);
    
    // Yanaklar
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(12, 19 - hop, 1, 1);
    ctx.fillRect(19, 19 - hop, 1, 1);
    
    // Element Aksesuarları
    if (type === 'earth') {
      ctx.fillStyle = '#22c55e'; // Kafada küçük yaprak
      ctx.fillRect(15, 11 - hop, 3, 2);
      ctx.fillRect(17, 10 - hop, 2, 1);
    } else if (type === 'fire') {
      ctx.fillStyle = '#ef4444'; // Küçük alev kıvılcımı
      ctx.fillRect(15, 12 - hop, 2, 2);
    } else if (type === 'electric') {
      ctx.fillStyle = '#facc15'; // Şimşek ucu
      ctx.fillRect(15, 12 - hop, 2, 2);
      ctx.fillRect(16, 10 - hop, 1, 2);
    }
  } else if (stage === 1) {
    // AŞAMA 1: GENÇ (Pyrocot, Shellhop, Voltcat, Sprout, Gale)
    // Kulaklı ve gövdeli canavar formu
    ctx.fillRect(7, 11 - hop, 18, 14);
    ctx.fillRect(8, 10 - hop, 16, 16);
    
    ctx.fillStyle = color;
    ctx.fillRect(8, 11 - hop, 16, 12);
    ctx.fillRect(9, 10 - hop, 14, 14);
    
    ctx.fillStyle = lightColor;
    ctx.fillRect(10, 12 - hop, 12, 10);
    
    // Kulaklar ve gözler
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(7, 7 - hop, 3, 3);
    ctx.fillRect(22, 7 - hop, 3, 3);
    ctx.fillRect(11, 13 - hop, 2, 2);
    ctx.fillRect(19, 13 - hop, 2, 2);
    
    if (type === 'water') {
      ctx.fillStyle = '#1e3a8a'; // Kaplumbağa kabuğu
      ctx.fillRect(6, 14 - hop, 2, 7);
    } else if (type === 'wind') {
      ctx.fillStyle = '#94a3b8'; // Rüzgar pelerini tüyleri
      ctx.fillRect(5, 12 - hop, 3, 4);
      ctx.fillRect(24, 12 - hop, 3, 4);
    }
  } else if (stage === 2) {
    // AŞAMA 2: YETİŞKİN (Blazerax, Neptulon, Thunderwing, Stonehorn, Aerochord)
    // İki ayak üzerinde dik duran, müzik kulaklığı takılı canavar formu
    ctx.fillRect(7, 7 - hop, 18, 20);
    ctx.fillRect(6, 25, 4, 3);
    ctx.fillRect(22, 25, 4, 3);
    
    ctx.fillStyle = color;
    ctx.fillRect(8, 8 - hop, 16, 18);
    
    ctx.fillStyle = lightColor;
    ctx.fillRect(10, 13 - hop, 12, 12);
    
    // Müzik kulaklığı
    ctx.fillStyle = '#334155';
    ctx.fillRect(9, 5 - hop, 14, 2);
    ctx.fillStyle = '#ec4899'; // Pembe kulaklık kapları
    ctx.fillRect(7, 7 - hop, 2, 5);
    ctx.fillRect(23, 7 - hop, 2, 5);
    
    // Gözler ve parıltı
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(11, 11 - hop, 2, 2);
    ctx.fillRect(19, 11 - hop, 2, 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(12, 11 - hop, 1, 1);
    ctx.fillRect(20, 11 - hop, 1, 1);
  } else {
    // AŞAMA 3: SİBER (Cyber-Vulkan, Cyber-Triton, Cyber-Zeus, Cyber-Gaia, Cyber-Tornado)
    // Siber zırhlı kanatlı, parlayan gözlü mega ejderha/robot canavar formu
    ctx.fillRect(5, 5, 22, 22);
    ctx.fillStyle = color;
    ctx.fillRect(6, 6, 20, 20);
    
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(9, 9, 14, 14);
    
    // Mekanik çırpan kanatlar
    const wingY = frame === 0 ? 6 : 4;
    ctx.fillStyle = lightColor;
    ctx.fillRect(1, wingY, 4, 10);
    ctx.fillRect(27, wingY, 4, 10);
    
    // Siber vizör / parlayan göz bandı
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(9, 10, 14, 3);
  }
};

interface FocusPetWidgetProps {
  isCollapsed: boolean;
  fileContents: Record<string, string>;
  onSavePetData?: () => void;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Sol menünün altına yerleşen, Pomodoro ve yapılacaklar tamamlandıkça canavarı besleyen/büyüten bağımsız widget.
function FocusPetWidget({ isCollapsed, fileContents, onSavePetData }: FocusPetWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Yerel hafızadan evcil hayvan durumlarını yükle
  const [starter, setStarter] = useState<string | null>(() => localStorage.getItem('focus_pet_starter'));
  const [exp, setExp] = useState<number>(() => Number(localStorage.getItem('focus_pet_exp') || '0'));
  const [health, setHealth] = useState<number>(() => Number(localStorage.getItem('focus_pet_health') || '100'));
  const [petName, setPetName] = useState<string>(() => localStorage.getItem('focus_pet_name') || 'Odak Dostu');

  const [frame, setFrame] = useState(0);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [isEvolving, setIsEvolving] = useState(false);

  // Evrim aşamasını hesaplayan yardımcı fonksiyon
  const stage = useMemo(() => {
    if (exp >= 1500) return 3; // Siber
    if (exp >= 600) return 2;  // Yetişkin
    if (exp >= 200) return 1;  // Genç
    return 0;                  // Bebek
  }, [exp]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Buluttan evcil hayvan verisi senkronize edildiğinde, widget durumlarını reaktif olarak günceller.
  useEffect(() => {
    const handlePetSynced = () => {
      setStarter(localStorage.getItem('focus_pet_starter'));
      setExp(Number(localStorage.getItem('focus_pet_exp') || '0'));
      setHealth(Number(localStorage.getItem('focus_pet_health') || '100'));
      setPetName(localStorage.getItem('focus_pet_name') || 'Odak Dostu');
    };
    window.addEventListener('focus_pet_synced', handlePetSynced);
    return () => {
      window.removeEventListener('focus_pet_synced', handlePetSynced);
    };
  }, []);

  // Canavarın element tipine göre Türkçe ismini ve emojisini döndürür
  const getPetInfo = () => {
    switch (starter) {
      case 'fire': return { label: 'Pyros', emoji: '🔥', color: '#ef4444' };
      case 'water': return { label: 'Aquas', emoji: '💧', color: '#3b82f6' };
      case 'electric': return { label: 'Volts', emoji: '⚡', color: '#eab308' };
      case 'earth': return { label: 'Terra', emoji: '🌿', color: '#22c55e' };
      case 'wind': return { label: 'Aetos', emoji: '💨', color: '#a855f7' };
      default: return { label: 'Bilinmeyen', emoji: '❓', color: '#64748b' };
    }
  };

  // Sağlık seviyesine göre ruh hali tespiti
  const getStatusText = () => {
    if (isEvolving) return 'EVRİMLEŞİYOR! ⚡';
    if (isCelebrating) return 'MUTLU! 🎉';
    if (health > 70) return 'Zinde / Odaklanmış 💪';
    if (health > 30) return 'Uykulu / Yorgun 🥱';
    if (health > 0) return 'Çok Aç / Halsiz 😢';
    return 'Dijital Uyku Modunda 💤';
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Canavar nefes alma animasyonu (400ms kare hızı) ve olay dinleyicileri.
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f: number) => (f === 0 ? 1 : 0));
    }, 450);

    // Pomodoro bitiminde tetiklenecek ödül sistemi
    const handlePomodoroCompleted = () => {
      setExp((prev: number) => {
        const next = prev + 50;
        localStorage.setItem('focus_pet_exp', String(next));
        return next;
      });
      setHealth((prev: number) => {
        const next = Math.min(100, prev + 25);
        localStorage.setItem('focus_pet_health', String(next));
        return next;
      });
      setIsCelebrating(true);
      setTimeout(() => setIsCelebrating(false), 3000);
      onSavePetData?.();
    };

    window.addEventListener('pomodoro_completed', handlePomodoroCompleted);

    return () => {
      clearInterval(timer);
      window.removeEventListener('pomodoro_completed', handlePomodoroCompleted);
    };
  }, [onSavePetData]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Offline geçen süreye göre canavarın sağlığını düşüren zaman kontrol mekanizması.
  useEffect(() => {
    const now = Date.now();
    const lastActive = Number(localStorage.getItem('focus_pet_last_active') || String(now));
    
    const elapsedHours = (now - lastActive) / (1000 * 60 * 60);
    const healthLoss = Math.floor(elapsedHours / 3); // Her 3 saatte 1 sağlık kaybeder

    if (healthLoss > 0) {
      setHealth((h: number) => {
        const next = Math.max(0, h - healthLoss);
        localStorage.setItem('focus_pet_health', String(next));
        return next;
      });
    }
    localStorage.setItem('focus_pet_last_active', String(now));
    onSavePetData?.();
  }, [onSavePetData]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Notlardaki tamamlanan görev (checklist) sayısını tarayarak canavarı otomatik geliştiren mekanizma.
  useEffect(() => {
    let completedCount = 0;
    Object.keys(fileContents).forEach(path => {
      const text = fileContents[path] || '';
      const lines = text.split('\n');
      let isInTable = false;
      lines.forEach(line => {
        const trimmed = line.trim();
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Tablo başlangıcını algılar ve tablo bitene kadar satırları canavar gelişim görevlerinden muaf tutar.
        if (trimmed.toLowerCase().startsWith('tablo:')) {
          isInTable = true;
          return;
        }
        if (isInTable) {
          if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.toLowerCase().startsWith('tablo:')) {
            isInTable = false;
          } else {
            return;
          }
        }
        if (/^-\s*\[[xX]\]/.test(trimmed)) {
          completedCount++;
        }
      });
    });

    const lastTaskCount = Number(localStorage.getItem('focus_pet_last_task_count') || '0');

    if (completedCount > lastTaskCount) {
      const diff = completedCount - lastTaskCount;
      setExp((prev: number) => {
        const next = prev + diff * 15; // Görev başına 15 EXP
        localStorage.setItem('focus_pet_exp', String(next));
        return next;
      });
      setHealth((prev: number) => {
        const next = Math.min(100, prev + diff * 10); // Görev başına +10 Sağlık
        localStorage.setItem('focus_pet_health', String(next));
        return next;
      });
      setIsCelebrating(true);
      setTimeout(() => setIsCelebrating(false), 3000);
    }
    localStorage.setItem('focus_pet_last_task_count', String(completedCount));
    onSavePetData?.();
  }, [fileContents, onSavePetData]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // EXP artışında Digimon tarzı evrim animasyonu tetikleme döngüsü.
  useEffect(() => {
    const savedStage = Number(localStorage.getItem('focus_pet_stage') || '0');
    if (stage > savedStage) {
      setIsEvolving(true);
      setTimeout(() => {
        localStorage.setItem('focus_pet_stage', String(stage));
        setIsEvolving(false);
        onSavePetData?.();
      }, 2500);
    }
  }, [stage, onSavePetData]);

  // Canvas üzerine canavarın piksel çizimini aktaran render efekti
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !starter) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawPet(ctx, starter, stage, frame, isCelebrating);
  }, [starter, stage, frame, isCelebrating]);

  // Canavarı ilk kez seçen başlangıç fonksiyonu
  const selectStarter = (type: string) => {
    localStorage.setItem('focus_pet_starter', type);
    localStorage.setItem('focus_pet_exp', '0');
    localStorage.setItem('focus_pet_health', '100');
    localStorage.setItem('focus_pet_stage', '0');
    
    // Toplam görev sayısını eşitle
    let completedCount = 0;
    Object.keys(fileContents).forEach(path => {
      const text = fileContents[path] || '';
      const lines = text.split('\n');
      let isInTable = false;
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().startsWith('tablo:')) {
          isInTable = true;
          return;
        }
        if (isInTable) {
          if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.toLowerCase().startsWith('tablo:')) {
            isInTable = false;
          } else {
            return;
          }
        }
        if (/^-\s*\[[xX]\]/.test(trimmed)) {
          completedCount++;
        }
      });
    });
    localStorage.setItem('focus_pet_last_task_count', String(completedCount));

    setStarter(type);
    setExp(0);
    setHealth(100);
    onSavePetData?.();
  };

  // Evcil hayvanı yumurtaya geri döndürme (Reset)
  const handleResetPet = () => {
    if (window.confirm('Odak canavarınızı sıfırlayıp yumurtaya geri döndürmek ve yeni bir element seçmek istediğinize emin misiniz?')) {
      localStorage.removeItem('focus_pet_starter');
      localStorage.removeItem('focus_pet_exp');
      localStorage.removeItem('focus_pet_health');
      localStorage.removeItem('focus_pet_stage');
      setStarter(null);
      onSavePetData?.();
    }
  };

  const info = getPetInfo();

  // 1. STARTER SEÇİM EKRANI
  if (!starter) {
    if (isCollapsed) {
      return (
        <div style={{ padding: '8px', textAlign: 'center', color: '#94a3b8' }} title="Bir Odak Yoldaşı Seçin!">
          🥚
        </div>
      );
    }
    return (
      <div style={{
        margin: '10px 14px',
        padding: '12px',
        borderRadius: '10px',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px dashed rgba(255,255,255,0.08)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>🥚 ODAK YOLDAŞI SEÇ:</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
          <button onClick={() => selectStarter('fire')} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '4px', padding: '6px 0', cursor: 'pointer', fontSize: '14px' }} title="Pyros (Ateş)">🔥</button>
          <button onClick={() => selectStarter('water')} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px', padding: '6px 0', cursor: 'pointer', fontSize: '14px' }} title="Aquas (Su)">💧</button>
          <button onClick={() => selectStarter('electric')} style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '4px', padding: '6px 0', cursor: 'pointer', fontSize: '14px' }} title="Volts (Elektrik)">⚡</button>
          <button onClick={() => selectStarter('earth')} style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '4px', padding: '6px 0', cursor: 'pointer', fontSize: '14px' }} title="Terra (Toprak)">🌿</button>
          <button onClick={() => selectStarter('wind')} style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '4px', padding: '6px 0', cursor: 'pointer', fontSize: '14px' }} title="Aetos (Hava)">💨</button>
        </div>
      </div>
    );
  }

  // 2. DARALTILMIŞ (COLLAPSED) MOD
  if (isCollapsed) {
    return (
      <div 
        onClick={handleResetPet}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '6px 0',
          cursor: 'pointer',
          borderTop: '1px solid rgba(255,255,255,0.03)'
        }}
        title={`${info.label} (Seviye ${stage + 1}) - Sağlık: %${health}`}
      >
        <canvas ref={canvasRef} width={32} height={32} style={{ width: '28px', height: '28px', imageRendering: 'pixelated' }} />
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: health > 70 ? '#22c55e' : health > 30 ? '#eab308' : '#ef4444',
          marginTop: '2px'
        }} />
      </div>
    );
  }

  // 3. TAM WIDGET EKRANI (Genişletilmiş Sidebar)
  const maxExp = stage === 0 ? 200 : stage === 1 ? 600 : stage === 2 ? 1500 : 3000;
  const expPercent = Math.min(100, Math.round((exp / maxExp) * 100));

  return (
    <div 
      className={`focus-pet-widget-card ${isEvolving ? 'focus-pet-evolving' : ''}`}
      style={{
        margin: '8px 12px',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'var(--bg-tertiary)',
        border: `1px solid ${isEvolving ? 'var(--text-primary)' : 'var(--border-color)'}`,
        boxShadow: isCelebrating ? `0 0 12px ${info.color}33` : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        position: 'relative'
      }}
    >
      {/* Reset Butonu (Sağ üst köşe) */}
      <button 
        onClick={handleResetPet}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: '11px',
          cursor: 'pointer'
        }}
        title="Yumurtaya Geri Dönüştür"
      >
        🥚
      </button>

      {/* Üst Kısım Canavar Resmi ve İsim */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          background: 'rgba(0,0,0,0.1)',
          borderRadius: '6px',
          padding: '2px',
          border: `1px solid ${info.color}44`
        }}>
          <canvas 
            ref={canvasRef} 
            width={32} 
            height={32} 
            style={{ width: '40px', height: '40px', imageRendering: 'pixelated', display: 'block' }} 
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{info.label}</span>
            <span style={{ fontSize: '10px', color: info.color }}>{info.emoji}</span>
          </div>
          <span style={{ fontSize: '9.5px', color: 'var(--text-secondary)' }}>
            Evre {stage + 1}: {stage === 0 ? 'Bebek' : stage === 1 ? 'Genç' : stage === 2 ? 'Yetişkin' : 'Siber Mega'}
          </span>
        </div>
      </div>

      {/* Durum/Ruh Hali Bilgisi */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>DURUM</span>
        <span style={{ fontSize: '9.5px', fontWeight: 600, color: isCelebrating ? info.color : 'var(--text-primary)' }}>{getStatusText()}</span>
      </div>

      {/* Sağlık Barı (HP) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)' }}>
          <span>SAĞLIK (HP)</span>
          <span style={{ color: health > 70 ? '#22c55e' : health > 30 ? '#eab308' : '#ef4444' }}>%{health}</span>
        </div>
        <div style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'var(--bg-hover)', overflow: 'hidden' }}>
          <div style={{ width: `${health}%`, height: '100%', borderRadius: '2px', background: health > 70 ? '#22c55e' : health > 30 ? '#eab308' : '#ef4444', transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* Tecrübe Puanı Barı (EXP) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)' }}>
          <span>ODAK (EXP)</span>
          <span>{exp}/{maxExp}</span>
        </div>
        <div style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'var(--bg-hover)', overflow: 'hidden' }}>
          <div style={{ width: `${expPercent}%`, height: '100%', borderRadius: '2px', background: info.color, transition: 'width 0.3s ease' }} />
        </div>
      </div>

    </div>
  );
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  folders,
  tags,
  selectedFolder,
  setSelectedFolder,
  selectedTag,
  setSelectedTag,
  onCreateFolder,
  onDeleteFolder,
  syncStatus,
  isSidebarOpen,
  setIsSidebarOpen,
  onOpenSettings,
  onOpenHelp,
  onFolderContextMenu,
  folderCustomizations = {},
  isCollapsed = false,
  onToggleCollapse,
  onToggleMiniMode,
  isMiniMode = false,
  isNoteCityEnabled = true,
  isFocusPetEnabled = true,
  fileContents = {},
  notes = [],
  theme = 'dark',
  onToggleTheme,
  onSavePetData
}: SidebarProps) {
  const primaryItems = [
    { id: 'notfactory', label: 'Hızlı Giriş', icon: Zap },
    { id: 'dashboard', label: 'Gösterge Paneli', icon: Layout },
    { id: 'inbox', label: 'Gelen Kutusu (Inbox)', icon: Inbox },
    { id: 'tasks', label: 'Görev Havuzu (Tasks)', icon: CheckSquare },
    { id: 'timeline', label: 'Zaman Akışı (Timeline)', icon: Clock },
    { id: 'calendar', label: 'Takvim Planlayıcı', icon: Calendar },
  ];

  const workItems = [
    { id: 'projects', label: 'Proje Yönetimi', icon: KanbanSquare },
    { id: 'finance', label: 'Finans', icon: Wallet },
  ];

  const toolItems = [
    { id: 'db', label: 'Depo (Veritabanı)', icon: Database },
    { id: 'srs', label: 'Ezber Kartları (SRS)', icon: BookOpen },
    ...(isNoteCityEnabled ? [{ id: 'city', label: 'Not Şehri (City)', icon: Building2 }] : []),
    { id: 'ambient', label: 'Ortam Sesleri', icon: Volume2 },
    { id: 'forge', label: 'Sentez Tezgahı', icon: FlaskConical },
    { id: 'mentor', label: 'Not Mentorü', icon: Compass },
    { id: 'analytics', label: 'Verimlilik Analizi', icon: BarChart2 },
    { id: 'browser', label: 'Web Araştırma', icon: Globe },
    { id: 'music', label: 'Müzik Kutusu', icon: Headphones },
  ];

  const [isWorkExpanded, setIsWorkExpanded] = React.useState(false);
  const [isToolsExpanded, setIsToolsExpanded] = React.useState(false);

  const renderItem = (item: typeof primaryItems[0]) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
        title={isCollapsed ? item.label : undefined}
        style={{ justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '10px 0' : '10px 16px' }}
        onClick={() => {
          setActiveTab(item.id);
          setSelectedFolder(null);
          setSelectedTag(null);
        }}
      >
        <Icon size={18} style={{ marginRight: isCollapsed ? '0' : '10px' }} />
        {!isCollapsed && <span>{item.label}</span>}
      </button>
    );
  };

  return (
    <aside className={`sidebar ${isSidebarOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
      {/* App Logo / Title */}
      <div className="sidebar-brand" style={{ justifyContent: isCollapsed ? 'center' : 'space-between', padding: isCollapsed ? '16px 0' : '16px 20px' }}>
        {!isCollapsed ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="brand-logo">▲</div>
              <div className="brand-title">
                <span>Ultimate</span>
                <span className="brand-subtitle">NoteFactory</span>
              </div>
            </div>
            {onToggleCollapse && (
              <button 
                onClick={onToggleCollapse} 
                title="Menüyü Daralt"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRadius: '4px' }}
              >
                <ChevronLeft size={16} />
              </button>
            )}
          </>
        ) : (
          onToggleCollapse && (
            <button 
              onClick={onToggleCollapse} 
              title="Menüyü Genişlet"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRadius: '4px' }}
            >
              <ChevronRight size={16} />
            </button>
          )
        )}
      </div>

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Menü elemanlarının ve klasör listesinin ekran dışına taşmasını engellemek için scrollable flex alanı. */}
      <div className="sidebar-scrollable-content" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0, gap: '5px' }}>
        {/* Primary Navigation */}
      <nav className="sidebar-nav">
        {primaryItems.map(renderItem)}
      </nav>

      {/* Divider / Header - İş & Yönetim */}
      <div 
        onClick={() => setIsWorkExpanded(!isWorkExpanded)}
        style={{ cursor: 'pointer' }}
      >
        {isCollapsed ? (
          <div className="sidebar-divider" style={{ margin: '12px 0', borderTop: isWorkExpanded ? '2px solid var(--accent-color)' : '1px dashed var(--border-color)' }} title="💼 İş & Yönetim (Aç/Kapat)" />
        ) : (
          <div className="sidebar-section-header" style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', margin: '20px 16px 6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.8, userSelect: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>💼</span> <span>İş & Yönetim</span>
            </div>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{isWorkExpanded ? '▼' : '▶'}</span>
          </div>
        )}
      </div>

      {isWorkExpanded && (
        <nav className="sidebar-nav" style={{ marginTop: '0' }}>
          {workItems.map(renderItem)}
        </nav>
      )}

      {/* Divider / Header - Diğer Araçlar */}
      <div 
        onClick={() => setIsToolsExpanded(!isToolsExpanded)}
        style={{ cursor: 'pointer' }}
      >
        {isCollapsed ? (
          <div className="sidebar-divider" style={{ margin: '12px 0', borderTop: isToolsExpanded ? '2px solid var(--accent-color)' : '1px dashed var(--border-color)' }} title="🛠️ Diğer Araçlar (Aç/Kapat)" />
        ) : (
          <div className="sidebar-section-header" style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', margin: '20px 16px 6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.8, userSelect: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🛠️</span> <span>Diğer Araçlar</span>
            </div>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{isToolsExpanded ? '▼' : '▶'}</span>
          </div>
        )}
      </div>

      {isToolsExpanded && (
        <nav className="sidebar-nav" style={{ marginTop: '0' }}>
          {toolItems.map(renderItem)}
        </nav>
      )}

      {!isCollapsed && (
        <>
          {/* Divider */}
          <div className="sidebar-divider" />

          {/* Folders Section */}
          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">Klasörler</span>
              <button className="btn-add" onClick={onCreateFolder} title="Yeni Klasör">
                <Plus size={14} />
              </button>
            </div>
            <div className="section-list">
              <button
                className={`list-item ${selectedFolder === null && activeTab === 'notes' ? 'active-filter' : ''}`}
                onClick={() => {
                  setSelectedFolder(null);
                  setSelectedTag(null); // Reset tag filter when viewing all notes
                  setActiveTab('notes');
                  if (window.innerWidth <= 768) {
                    setIsSidebarOpen?.(false);
                  }
                }}
              >
                <Folder size={14} />
                <span>Tüm Notlar</span>
              </button>
              {folders.map((folder) => {
                const parts = folder.split('/');
                const name = parts[parts.length - 1];
                const depth = parts.length - 1;
                
                const custom = folderCustomizations[folder] || {};
                const customColor = custom.color;
                const customIconName = custom.icon || 'Folder';
                const CustomFolderIcon = iconMap[customIconName] || Folder;
                const isActive = selectedFolder === folder;

                const itemStyle: React.CSSProperties = {
                  paddingLeft: `${10 + depth * 12}px`,
                  paddingRight: '28px',
                  width: '100%'
                };

                if (customColor) {
                  if (isActive) {
                    itemStyle.backgroundColor = `${customColor}14`; // 0.08 alpha
                    itemStyle.borderLeft = `2px solid ${customColor}`;
                    itemStyle.borderRadius = '0 6px 6px 0';
                  }
                }

                return (
                  <div key={folder} className="folder-list-item-container" style={{ position: 'relative' }}>
                    <button
                      className={`list-item ${isActive ? (customColor ? '' : 'active-filter') : ''}`}
                      style={itemStyle}
                      onClick={() => {
                        setSelectedFolder(folder);
                        setSelectedTag(null); // Reset tag filter when viewing a specific folder
                        setActiveTab('notes');
                        if (window.innerWidth <= 768) {
                          setIsSidebarOpen?.(false);
                        }
                      }}
                      onContextMenu={(e) => onFolderContextMenu?.(e, folder)}
                    >
                      <CustomFolderIcon 
                        size={14} 
                        style={{ 
                          opacity: customColor ? 1 : (1 - depth * 0.15), 
                          flexShrink: 0, 
                          color: customColor || undefined 
                        }} 
                      />
                      <span style={{ 
                        fontSize: depth > 0 ? '11.5px' : '12px', 
                        fontWeight: (depth === 0 || isActive) ? '600' : '400', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap',
                        color: customColor || undefined
                      }}>{name}</span>
                    </button>
                    <button
                      className="btn-delete-folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`"${name}" klasörünü ve içindeki tüm notları silmek istediğinize emin misiniz?`)) {
                          onDeleteFolder(folder);
                        }
                      }}
                      title="Klasörü Sil"
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tags Section */}
          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">Etiketler</span>
            </div>
            <div className="section-tags">
              <button
                className={`tag-chip ${selectedTag === null ? 'active-tag' : ''}`}
                onClick={() => {
                  setSelectedTag(null);
                  setSelectedFolder(null); // Reset folder filter when clicking "Tümü" tags
                }}
              >
                Tümü
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  className={`tag-chip ${selectedTag === tag ? 'active-tag' : ''}`}
                  onClick={() => {
                    setSelectedTag(tag);
                    setSelectedFolder(null); // Reset folder filter when filtering by a specific tag
                    if (activeTab !== 'notes' && activeTab !== 'tasks' && activeTab !== 'timeline' && activeTab !== 'db') {
                      setActiveTab('notes');
                    }
                  }}
                >
                  <Tag size={10} style={{ marginRight: '4px' }} />
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      </div>

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Odak Evcil Hayvanı (Tamagotchi) modülü aktifse, sol menünün altına yerleştirilir. */}
      {isFocusPetEnabled && (
        <FocusPetWidget 
          isCollapsed={isCollapsed} 
          fileContents={fileContents} 
          onSavePetData={onSavePetData}
        />
      )}

      {/* Footer / Settings & Sync Status */}
      <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '10px', alignItems: isCollapsed ? 'center' : 'stretch' }}>
        
        {/* Glowing Sync Status Indicator */}
        <div 
          className="sync-status-indicator"
          onClick={onOpenSettings}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            gap: isCollapsed ? '0' : '8px',
            padding: isCollapsed ? '6px' : '6px 12px',
            borderRadius: '6px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            fontSize: '11px',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            width: isCollapsed ? '28px' : 'auto',
            height: isCollapsed ? '28px' : 'auto'
          }}
          title={
            syncStatus === 'synced' ? 'Tüm verileriniz Git bulut deposuyla tamamen eşitlendi. Ayarlara gitmek için tıklayın.' :
            syncStatus === 'syncing' ? 'Değişiklikler arka planda Git sunucusuyla eşitleniyor...' :
            syncStatus === 'error' ? 'Eşitleme hatası. Ağ bağlantınızı veya Git ayarlarınızı kontrol etmek için tıklayın.' :
            'Yerel mod: Değişiklikler yerel Git deposuna kaydediliyor. Eşitlemeyi kurmak için tıklayın.'
          }
        >
          <div 
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: 
                syncStatus === 'synced' ? '#10b981' : 
                syncStatus === 'syncing' ? '#f59e0b' : 
                syncStatus === 'error' ? '#ef4444' : 
                '#71717a',
              boxShadow: 
                syncStatus === 'synced' ? '0 0 8px #10b981' : 
                syncStatus === 'syncing' ? '0 0 8px #f59e0b' : 
                syncStatus === 'error' ? '0 0 8px #ef4444' : 
                'none',
              transition: 'all 0.3s ease'
            }}
          />
          {!isCollapsed && (
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {syncStatus === 'synced' ? 'Bulutla Eşitlendi' :
               syncStatus === 'syncing' ? 'Eşitleniyor...' :
               syncStatus === 'error' ? 'Eşitleme Hatası' :
               'Yerel Kayıt'}
            </span>
          )}
        </div>

        {!isCollapsed ? (
          <div style={{ display: 'flex', gap: '6px', width: '100%', marginTop: '2px' }}>
            <button 
              className="footer-btn" 
              onClick={onToggleMiniMode}
              style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '4px', 
                padding: '6px 4px', 
                fontSize: '11px',
                cursor: 'pointer',
                borderColor: isMiniMode ? 'var(--accent)' : undefined,
                background: isMiniMode ? 'rgba(99,102,241,0.15)' : undefined
              }}
              title="Mini Widget Modu"
            >
              <Layout size={13} style={{ color: isMiniMode ? 'var(--accent)' : undefined }} />
              <span>Mini</span>
            </button>
            
            <button 
              className="footer-btn" 
              onClick={onOpenHelp}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px 4px', fontSize: '11px', cursor: 'pointer' }}
              title="Yardım Rehberi"
            >
              <HelpCircle size={13} />
              <span>Rehber</span>
            </button>

            <button 
              className="footer-btn" 
              onClick={onOpenSettings}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px 4px', fontSize: '11px', cursor: 'pointer' }}
              title="Ayarlar"
            >
              <Settings size={13} />
              <span>Ayarlar</span>
            </button>

            <button 
              className="footer-btn" 
              onClick={onToggleTheme}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px 4px', fontSize: '11px', cursor: 'pointer' }}
              title={theme === 'dark' ? 'Açık Tema' : 'Koyu Tema'}
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              <span>{theme === 'dark' ? 'Açık' : 'Koyu'}</span>
            </button>
          </div>
        ) : (
          <>
            <button 
              className="footer-btn" 
              onClick={onToggleMiniMode}
              style={{ 
                width: '28px', 
                height: '28px', 
                cursor: 'pointer', 
                marginBottom: '2px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: '0',
                borderColor: isMiniMode ? 'var(--accent)' : undefined,
                background: isMiniMode ? 'rgba(99,102,241,0.15)' : undefined
              }}
              title="Mini Widget Modu"
            >
              <Layout size={16} style={{ color: isMiniMode ? 'var(--accent)' : undefined }} />
            </button>
            
            <button 
              className="footer-btn" 
              onClick={onOpenHelp}
              style={{ width: '28px', height: '28px', cursor: 'pointer', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0' }}
              title="Yardım Rehberi"
            >
              <HelpCircle size={16} />
            </button>

            <button 
              className="footer-btn" 
              onClick={onOpenSettings}
              style={{ width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0', marginBottom: '2px' }}
              title="Ayarlar"
            >
              <Settings size={16} />
            </button>

            <button 
              className="footer-btn" 
              onClick={onToggleTheme}
              style={{ width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0' }}
              title={theme === 'dark' ? 'Açık Tema' : 'Koyu Tema'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
