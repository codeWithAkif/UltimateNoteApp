import { useState, useEffect, useRef, Fragment } from 'react';
import Sidebar from './components/Sidebar';
import InboxView from './components/InboxView';
import NoteFactoryView from './components/NoteFactoryView';
import type { ParsedInput } from './components/NoteFactoryView';
import NotesView from './components/NotesView';
import FinanceView from './components/FinanceView';
import TasksView from './components/TasksView';
import TimelineView from './components/TimelineView';
import CalendarView from './components/CalendarView';
import DatabaseView from './components/DatabaseView';
import BrowserView from './components/BrowserView';
import FlashcardView from './components/FlashcardView';
import AmbientMixerView from './components/AmbientMixerView';
import ForgeWorkbenchView from './components/ForgeWorkbenchView';
import NoteMentorView from './components/NoteMentorView';
import MusicPlayerView from './components/MusicPlayerView';
import MiniWidgetView from './components/MiniWidgetView';
import AnalyticsView from './components/AnalyticsView';
import ProjectsView from './components/ProjectsView';
import DashboardView from './components/DashboardView';
import CityBuilderView from './components/CityBuilderView';
import type { Track } from './components/MusicPlayerView';
import { format } from 'date-fns';
import { platform, isElectron, isCapacitor, isBrowser } from './services/platform';
import { initSupabase, handleLocalSave, handleLocalDelete, uploadFolderDirect, handleLocalFolderDelete, uploadDevPaths, triggerRemoteSync, resolveConflict, fetchDeletedNotes, restoreRemoteNote, permanentlyDeleteRemoteNote, fetchDatabaseSizeBytes, type SyncConflict } from './services/supabaseSync';
import { type DevPath, type DevPathLevel, type DevPathTopic, type DevPathNoteMode, RANK_LADDER, getRankForXp, XP_PER_TASK, XP_PER_LINK, countWikilinks } from './devPaths';
import {
  getGeminiApiKey, setGeminiApiKey, isGeminiConfigured, getGeminiModel, setGeminiModel,
  determineLevelAndTopics, generateNextLevel, generateTopicSubNotes, suggestAdditionalTopic, generateQuiz, gradeQuiz, generateFlashcards, evaluateSummary, buildLevelUpMessage,
  type ClarifyingQA, type TopicSubNote
} from './services/geminiMentor';
import { Preferences } from '@capacitor/preferences';
import { App as CapacitorApp } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';

const WidgetBridge = registerPlugin<any>('WidgetBridge');
import {
  Plus, Folder, FileText, Trash2, Settings,
  Briefcase, Code, Heart, Star, BookOpen, Database,
  Inbox, Calendar, Sparkles, Coffee, Rocket, Smile, HelpCircle,
  Play, Pause, SkipForward, SkipBack, Columns, Globe, X, Info, Layout, Minimize2,
  ArrowRight, Search, GripVertical,
  Zap, CheckSquare, Clock, KanbanSquare, Wallet, Building2, Volume2, FlaskConical, Compass, BarChart2, Headphones, Wrench,
  Award
} from 'lucide-react';
import { LocalNotifications } from '@capacitor/local-notifications';

interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

// Not başına saklanacak maksimum sürüm geçmişi anlık görüntüsü sayısı.
const MAX_NOTE_VERSIONS = 20;

const DEFAULT_SHORTCUTS: Record<string, { label: string; shortcut: ShortcutKey }> = {
  openBrowser: { label: 'Web Araştırma Tarayıcısını Aç', shortcut: { key: 'w', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  openHelp: { label: 'Yardım Rehberini Aç', shortcut: { key: 'h', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  toggleSidebar: { label: 'Sidebar\'ı Göster/Gizle', shortcut: { key: 'b', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  newNote: { label: 'Yeni Not Oluştur', shortcut: { key: 'n', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  goQuickAdd: { label: 'Hızlı Giriş Paneline Git', shortcut: { key: 'q', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  goCalendar: { label: 'Takvim Planlayıcıya Git', shortcut: { key: 'c', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  goNotes: { label: 'Tüm Notlara Git', shortcut: { key: 'd', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  globalSearch: { label: 'Global Arama (OmniSearch)', shortcut: { key: 'f', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  // Üst başlık çubuğuna taşınan gezinme öğeleri için hızlı açma kısayolları
  nav_dashboard: { label: 'Gösterge Panelini Aç', shortcut: { key: 'g', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_inbox: { label: 'Gelen Kutusunu (Inbox) Aç', shortcut: { key: 'i', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_tasks: { label: 'Görev Havuzunu Aç', shortcut: { key: 't', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_timeline: { label: 'Zaman Akışını Aç', shortcut: { key: 'z', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_projects: { label: 'Proje Yönetimini Aç', shortcut: { key: 'p', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_finance: { label: 'Finansı Aç', shortcut: { key: 'm', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_db: { label: 'Depoyu (Veritabanı) Aç', shortcut: { key: 'v', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_srs: { label: 'Ezber Kartlarını (SRS) Aç', shortcut: { key: 'e', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_city: { label: 'Not Şehrini Aç', shortcut: { key: 'y', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_ambient: { label: 'Ortam Seslerini Aç', shortcut: { key: 'o', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_forge: { label: 'Sentez Tezgahını Aç', shortcut: { key: 's', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_mentor: { label: 'Not Mentörünü Aç', shortcut: { key: 'r', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_analytics: { label: 'Verimlilik Analizini Aç', shortcut: { key: 'l', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } },
  nav_music: { label: 'Müzik Kutusunu Aç', shortcut: { key: 'u', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false } }
};

// Üst başlık çubuğu kısayolu -> ilgili sekme kimliği eşlemesi
const NAV_SHORTCUT_TARGETS: Record<string, string> = {
  nav_dashboard: 'dashboard',
  nav_inbox: 'inbox',
  nav_tasks: 'tasks',
  nav_timeline: 'timeline',
  nav_projects: 'projects',
  nav_finance: 'finance',
  nav_db: 'db',
  nav_srs: 'srs',
  nav_city: 'city',
  nav_ambient: 'ambient',
  nav_forge: 'forge',
  nav_mentor: 'mentor',
  nav_analytics: 'analytics',
  nav_music: 'music'
};

// Type Definitions
interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

export interface TimelineItem {
  id: string;
  content: string;
  timestamp: string;
  dateStr: string;
  isTodo: boolean;
  isCompleted: boolean;
  status?: 'todo' | 'in-progress' | 'done';
  folder: string | null;
  note: string | null;
  tags: string[];
  isSubtask?: boolean;
  parentId?: string;
}

interface AlarmItem {
  id: string;
  timeStr: string;
  dateStr: string;
  notePath: string;
  noteName: string;
  lineIdx: number;
}

const ContextMenuItem = ({ onClick, children, danger = false }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        background: hover ? (danger ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.08)') : 'transparent',
        border: 'none',
        color: danger ? '#ef4444' : 'var(--text-primary)',
        padding: '8px 12px',
        borderRadius: '6px',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {children}
    </button>
  );
};

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

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('active_tab') || 'notfactory';
  });
  const [browserInitialQuery, setBrowserInitialQuery] = useState<string | null>(null);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Masaüstünde çalışan Always-on-Top mini widget modu durumunu takip eder.
  const [isMiniMode, setIsMiniMode] = useState(false);

  // Dark/Light Tema durumu ve yerel depolama takibi (Kural 5)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('app-theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
    localStorage.setItem('app-theme', theme);

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Elektron'un çerçevesiz (frameless) pencere başlığındaki simge düğmeleri
    // (minimize/maximize/kapat) React'ın dışında, işletim sistemi seviyesinde
    // çizilir; bu yüzden tema her değiştiğinde ana sürece (main process) haber
    // vererek titleBarOverlay rengini de güncelliyoruz.
    if (isElectron) {
      window.electron?.setTitleBarTheme?.(theme);
    }
  }, [theme]);

  // Auto Updater & App Version States
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<{
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    version?: string;
    percent?: number;
    text?: string;
  } | null>(null);

  useEffect(() => {
    if (isElectron && window.electron) {
      if (window.electron.getAppVersion) {
        window.electron.getAppVersion().then(v => setAppVersion(v)).catch(() => {});
      }
      if (window.electron.onUpdateStatus) {
        const unsub = window.electron.onUpdateStatus((data: any) => {
          setUpdateStatus(data);
        });
        return () => { unsub(); };
      }
    }
  }, []);

  const handleRestartAndInstall = () => {
    if (isElectron && window.electron && window.electron.restartAndInstall) {
      window.electron.restartAndInstall();
    }
  };

  // Music Player States
  const [tracks, setTracks] = useState<Track[]>(() => {
    const saved = localStorage.getItem('music_tracks');
    return saved ? JSON.parse(saved) : [];
  });
  const [missingTracks, setMissingTracks] = useState<Record<string, boolean>>({});
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [resolvedAudioSrc, setResolvedAudioSrc] = useState<string | null>(null);
  const [showMiniPlayer, setShowMiniPlayer] = useState(() => {
    return localStorage.getItem('mini_player_manually_closed') !== 'true';
  });

  useEffect(() => {
    if (currentTrack) {
      const isClosed = localStorage.getItem('mini_player_manually_closed') === 'true';
      if (!isClosed) {
        setShowMiniPlayer(true);
      }
    }
  }, [currentTrack]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('music_volume');
    return saved ? parseFloat(saved) : 0.7;
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Müzik çalmaya başladığında kapatma kilidini kaldırır ve mini player'ı görünür kılar.
  useEffect(() => {
    if (isPlaying) {
      localStorage.removeItem('mini_player_manually_closed');
      setShowMiniPlayer(true);
    }
  }, [isPlaying]);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  
  // App-wide unified Timeline Items (Combined tasks & logs)
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [recentInputs, setRecentInputs] = useState<any[]>([]);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [parentFolder, setParentFolder] = useState('');

  // Right-click Context Menu states
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: string;
    type: 'folder' | 'file';
  } | null>(null);

  const [folderCustomizations, setFolderCustomizations] = useState<Record<string, { icon?: string; color?: string }>>({});
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Notların içini temiz tutmak ve mindmap koordinatlarını/özel öğelerini merkezi bir yerde saklamak için kullanılan state.
  const [mindmapLayouts, setMindmapLayouts] = useState<Record<string, { coords: any; customs: any[] }>>({});

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "Gelişim Yolu" (rütbe) verisi metadata.json'a değil, kendi localStorage anahtarına
  // yazılır (bkz. devPaths.ts) — metadata.json Supabase'e hiç senkronlanmıyor (bu oturumda
  // bulunan, eski pet özelliğinin de düştüğü bir tuzak), bu yüzden bu veriyi ayrı bir
  // "dev_paths" tablosuyla gerçekten senkronluyoruz (bkz. supabaseSync.ts).
  const [developmentPaths, setDevelopmentPaths] = useState<Record<string, DevPath>>(() => {
    try {
      return JSON.parse(localStorage.getItem('dev_paths_local') || '{}');
    } catch (e) {
      return {};
    }
  });
  const [rankUpCelebration, setRankUpCelebration] = useState<{ path: string; label: string; rankName: string } | null>(null);
  const devPathsUploadTimerRef = useRef<any>(null);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Gelişim yolu XP hesaplaması: her işaretli klasör için o klasör altındaki notlarda
  // tamamlanan task sayısı ve çıkan wikilink sayısı, "son görülen sayı" baseline'ına göre
  // delta olarak XP'ye çevrilir (eski pet özelliğinin task-sayma desenine benzer, bkz.
  // devPaths.ts). BUG DÜZELTMESİ: bu hesaplama önceden setDevelopmentPaths'in updater
  // fonksiyonu (prev => {...}) İÇİNDEN başka bir setState (setRankUpCelebration)
  // çağırıyordu — updater'lar React tarafından senkron çalıştırılacağı garanti edilmeyen
  // "saf" fonksiyonlardır, bu yüzden kutlama hiç görünmüyordu. Artık developmentPaths
  // doğrudan (functional update olmadan) okunuyor ve bağımlılık dizisine eklendi; sonsuz
  // döngü olmuyor çünkü ikinci çalıştırmada delta'lar sıfır olur (baseline'lar zaten
  // güncellendi) ve anyChange false kalıp setDevelopmentPaths hiç çağrılmaz.
  useEffect(() => {
    if (Object.keys(developmentPaths).length === 0) return;
    let anyChange = false;
    const next: Record<string, DevPath> = { ...developmentPaths };
    let celebration: { path: string; label: string; rankName: string } | null = null;

    Object.keys(developmentPaths).forEach(path => {
      const devPath = developmentPaths[path];
      // Faz 2: bu hesap sadece 'simple' modundaki (Faz 1 / AI'sız) yollar için geçerli —
      // 'ai' modundaki yollar konu/test tabanlı ayrı bir mekanizmayla ilerler (bkz.
      // handleTopicPassed/handleToggleDevPath). `mode` alanı yoksa (eski kayıt) 'simple' say.
      if ((devPath.mode || 'simple') !== 'simple') return;

      const taskCount = timelineItems.filter(t =>
        t.isCompleted && t.folder && (t.folder === path || t.folder.startsWith(path + '/'))
      ).length;

      let linkCount = 0;
      Object.keys(fileContents).forEach(notePath => {
        if (notePath.startsWith(path + '/')) {
          linkCount += countWikilinks(fileContents[notePath] || '');
        }
      });

      const lastTaskCount = devPath.lastTaskCount ?? 0;
      const lastLinkCount = devPath.lastLinkCount ?? 0;
      const currentXp = devPath.xp ?? 0;
      const taskDelta = Math.max(0, taskCount - lastTaskCount);
      const linkDelta = Math.max(0, linkCount - lastLinkCount);
      if (taskDelta === 0 && linkDelta === 0) return;

      const oldRank = getRankForXp(currentXp);
      const newXp = currentXp + taskDelta * XP_PER_TASK + linkDelta * XP_PER_LINK;
      const newRank = getRankForXp(newXp);

      next[path] = {
        ...devPath,
        xp: newXp,
        lastTaskCount: taskCount,
        lastLinkCount: linkCount,
        updatedAt: new Date().toISOString()
      };
      anyChange = true;

      if (newRank.index > oldRank.index && !celebration) {
        celebration = { path, label: devPath.label, rankName: newRank.name };
      }
    });

    if (anyChange) {
      setDevelopmentPaths(next);
      if (celebration) {
        setRankUpCelebration(celebration);
        setTimeout(() => setRankUpCelebration(null), 3000);
      }
    }
  }, [fileContents, timelineItems, developmentPaths]);

  // Yerel önbellek her zaman anında güncellenir; Supabase'e gönderim debounce'lu (hızlı
  // art arda değişikliklerde tek tek istek atmamak için, handleLocalSave'deki desenle aynı).
  useEffect(() => {
    localStorage.setItem('dev_paths_local', JSON.stringify(developmentPaths));
    if (devPathsUploadTimerRef.current) clearTimeout(devPathsUploadTimerRef.current);
    devPathsUploadTimerRef.current = setTimeout(() => {
      uploadDevPaths(developmentPaths);
    }, 800);
    return () => {
      if (devPathsUploadTimerRef.current) clearTimeout(devPathsUploadTimerRef.current);
    };
  }, [developmentPaths]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Uzaktan (başka bir cihazdan) gelen dev_paths verisini yerelle birleştirir — her yol
  // için hangisinin updatedAt'i daha yeniyse o kazanır. NOT: bu tek satırlık JSON blob
  // tasarımında tombstone yok, bu yüzden bir cihazda SİLİNEN bir yol, bu cihazda henüz
  // görülmemişse (bu cihaz kendi silme/push'unu yapana kadar) geçici olarak kalabilir —
  // düşük riskli bir sınırlama (XP/rütbe verisi kritik değil).
  const handleDevPathsChange = (remoteData: Record<string, any>) => {
    setDevelopmentPaths(prev => {
      const merged: Record<string, DevPath> = { ...prev };
      let changed = false;
      Object.keys(remoteData).forEach(path => {
        const remote = remoteData[path];
        const local = prev[path];
        if (!local || new Date(remote.updatedAt).getTime() > new Date(local.updatedAt).getTime()) {
          merged[path] = remote;
          changed = true;
        }
      });
      return changed ? merged : prev;
    });
  };
  const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);
  const [customizingFolder, setCustomizingFolder] = useState<string | null>(null);
  const [selectedIcon, setSelectedIcon] = useState('Folder');
  const [selectedColor, setSelectedColor] = useState('');

  // Rename and Move modal states
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameOldPath, setRenameOldPath] = useState('');
  const [renameNewName, setRenameNewName] = useState('');

  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [moveOldPath, setMoveOldPath] = useState('');
  const [moveDestFolder, setMoveDestFolder] = useState('');

  // Selected Filters
  const [selectedFolder, setSelectedFolder] = useState<string | null>(() => {
    return localStorage.getItem('selected_folder');
  });
  const [selectedTag, setSelectedTag] = useState<string | null>(() => {
    return localStorage.getItem('selected_tag');
  });
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'error'>('offline');
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bir senkron sırasında hem yerel hem uzak taraf değişmişse (gerçek çakışma), sync motoru
  // zaman damgasına göre otomatik bir seçim yapar (veri kaybı yok, .backup dosyası kalır) ve
  // bu listeye ekler. Kullanıcı isterse ÇakışmaÇözücü panelinden diğer sürümü seçebilir.
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [activeNotePath, setActiveNotePath] = useState<string | null>(() => {
    return localStorage.getItem('active_note_path');
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "Breadcrumb gibi bir şey — az önce açtığım nota dönmek istiyorum" isteği için son
  // görüntülenen notların geçmişi. activeNotePath'i her ayrı yerde (sidebar tıklaması,
  // arama sonucu, backlink, görev bağlantısı, mobil geri tuşu...) tek tek yakalamak
  // yerine TEK bir yerden, activeNotePath state'inin kendisini izleyen bir effect ile
  // takip ediyoruz — hangi kod yolu kullanılırsa kullanılsın nihayetinde hep bu state
  // güncellendiği için hiçbir giriş noktasını kaçırma riski yok.
  const [noteViewHistory, setNoteViewHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('note_view_history') || '[]');
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    if (!activeNotePath) return;
    setNoteViewHistory(prev => {
      if (prev[0] === activeNotePath) return prev;
      const next = [activeNotePath, ...prev.filter(p => p !== activeNotePath)].slice(0, 8);
      localStorage.setItem('note_view_history', JSON.stringify(next));
      return next;
    });
  }, [activeNotePath]);
  const [historyDropdownPaneIdx, setHistoryDropdownPaneIdx] = useState<number | null>(null);

  // Collapsible sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  // Minimal document window mode (floating window)
  const [isMinimalWindow, setIsMinimalWindow] = useState(() => {
    return window.location.search.includes('note=') || window.location.hash.includes('note=');
  });
  const [minimalNotePath, setMinimalNotePath] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    let note = params.get('note');
    if (!note && window.location.hash.startsWith('#/note/')) {
      note = decodeURIComponent(window.location.hash.substring(7));
    }
    return note;
  });

  // PaneState interface
  interface PaneState {
    id: string;
    tabs: string[];
    activeTabIdx: number;
  }

  const [panes, setPanes] = useState<PaneState[]>(() => {
    const active = localStorage.getItem('active_note_path');
    return [
      {
        id: 'pane-default',
        tabs: active ? [active] : [],
        activeTabIdx: 0
      }
    ];
  });
  const [activePaneIdx, setActivePaneIdx] = useState<number>(0);
  
  // Note properties modal state
  const [showPropertiesPath, setShowPropertiesPath] = useState<string | null>(null);
  const [propertiesNewTag, setPropertiesNewTag] = useState('');
  const [isPropertiesAddingTag, setIsPropertiesAddingTag] = useState(false);

  const [pinnedWidgetLists, setPinnedWidgetLists] = useState<string[]>(() => {
    const cached = localStorage.getItem('widget_pinned_lists');
    try {
      return cached ? JSON.parse(cached) : (localStorage.getItem('widget_pinned_list') ? [localStorage.getItem('widget_pinned_list')!] : []);
    } catch (e) {
      return [];
    }
  });
  const [pinnedWidgetList, setPinnedWidgetList] = useState<string | null>(() => localStorage.getItem('widget_pinned_list'));

  const updatePinnedWidgets = async (newLists: string[], newActive: string | null) => {
    setPinnedWidgetLists(newLists);
    setPinnedWidgetList(newActive);
    localStorage.setItem('widget_pinned_lists', JSON.stringify(newLists));
    if (newActive) {
      localStorage.setItem('widget_pinned_list', newActive);
    } else {
      localStorage.removeItem('widget_pinned_list');
    }
    if (isCapacitor) {
      try {
        await Preferences.set({ key: 'widget_pinned_lists', value: JSON.stringify(newLists) });
        if (newActive) {
          await Preferences.set({ key: 'widget_pinned_list', value: newActive });
        } else {
          await Preferences.remove({ key: 'widget_pinned_list' });
        }
        await WidgetBridge.refreshWidgets();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const getNoteStats = (path: string) => {
    const content = fileContents[path] || '';
    const lineCount = content.split('\n').length;
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const charCount = content.length;
    const readTime = Math.ceil(wordCount / 200) || 1; // 200 words/min, minimum 1 min
    
    // Parse tags from content
    const tags = Array.from(new Set(
      (content.match(/#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g) || [])
        .map(t => t.substring(1).toLowerCase())
    ));
    
    return { lineCount, wordCount, charCount, readTime, tags };
  };

  const handleDeleteTagInProperties = async (path: string, tagToDelete: string) => {
    const content = fileContents[path] || '';
    const escapedTag = tagToDelete.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:\\s+|^)#${escapedTag}\\b`, 'gi');
    const newContent = content.replace(regex, '').trim();
    await handleSaveNote(path, newContent);
  };

  const handleAddTagInProperties = async (path: string, newTag: string) => {
    const content = fileContents[path] || '';
    const cleanTag = newTag.trim().replace(/^#/, '');
    if (!cleanTag) return;
    
    const existingTags = Array.from(new Set(
      (content.match(/#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g) || [])
        .map(t => t.substring(1).toLowerCase())
    ));
    if (existingTags.includes(cleanTag.toLowerCase())) return;
    
    const newContent = content.trim() ? `${content.trim()} #${cleanTag}` : `#${cleanTag}`;
    await handleSaveNote(path, newContent);
  };

  const handleSetActiveNotePath = (path: string | null) => {
    if (!path) {
      setActiveNotePath(null);
      return;
    }
    setActiveNotePath(path);
    setPanes(prev => {
      if (prev.length === 0) {
        return [{
          id: 'pane-default',
          tabs: [path],
          activeTabIdx: 0
        }];
      }
      const newPanes = [...prev];
      const activePane = { ...newPanes[activePaneIdx] };
      
      const existingIdx = activePane.tabs.indexOf(path);
      if (existingIdx !== -1) {
        activePane.activeTabIdx = existingIdx;
      } else {
        if (activePane.tabs.length === 0) {
          activePane.tabs = [path];
          activePane.activeTabIdx = 0;
        } else {
          const newTabs = [...activePane.tabs];
          newTabs[activePane.activeTabIdx] = path;
          activePane.tabs = newTabs;
        }
      }
      newPanes[activePaneIdx] = activePane;
      return newPanes;
    });
  };

  const handleOpenInNewTab = (path: string) => {
    setPanes(prev => {
      const newPanes = [...prev];
      const activePane = { ...newPanes[activePaneIdx] };
      const existingIdx = activePane.tabs.indexOf(path);
      if (existingIdx !== -1) {
        activePane.activeTabIdx = existingIdx;
      } else {
        activePane.tabs = [...activePane.tabs, path];
        activePane.activeTabIdx = activePane.tabs.length - 1;
      }
      newPanes[activePaneIdx] = activePane;
      return newPanes;
    });
    setActiveNotePath(path);
  };

  const handleOpenInSplitView = (path: string) => {
    if (panes.length >= 3) return;
    setPanes(prev => {
      return [...prev, {
        id: `pane-${Date.now()}`,
        tabs: [path],
        activeTabIdx: 0
      }];
    });
    setActivePaneIdx(panes.length);
    setActiveNotePath(path);
  };

  // Bir sekmeyi yan paneli (varsa yeniden kullanarak, yoksa oluşturarak) sağda açar
  const handleOpenTabOnRight = (path: string, fromPaneIdx: number) => {
    setPanes(prev => {
      const targetIdx = fromPaneIdx + 1;
      if (targetIdx >= prev.length) {
        if (prev.length >= 3) return prev;
        setActivePaneIdx(targetIdx);
        return [...prev, { id: `pane-${Date.now()}`, tabs: [path], activeTabIdx: 0 }];
      }
      const newPanes = [...prev];
      const targetPane = { ...newPanes[targetIdx] };
      const existingIdx = targetPane.tabs.indexOf(path);
      if (existingIdx !== -1) {
        targetPane.activeTabIdx = existingIdx;
      } else {
        targetPane.tabs = [...targetPane.tabs, path];
        targetPane.activeTabIdx = targetPane.tabs.length - 1;
      }
      newPanes[targetIdx] = targetPane;
      setActivePaneIdx(targetIdx);
      return newPanes;
    });
    setActiveNotePath(path);
  };

  // Bir paneldeki sekmeyi kapatır (X tıklaması veya fare orta tuşu ile çağrılır)
  const closeTabAt = (paneIdx: number, tabIdx: number) => {
    setPanes(prev => {
      const newPanes = [...prev];
      const activePane = { ...newPanes[paneIdx] };
      activePane.tabs = activePane.tabs.filter((_, i) => i !== tabIdx);
      activePane.activeTabIdx = Math.max(0, activePane.activeTabIdx - 1);
      newPanes[paneIdx] = activePane;

      if (activePane.tabs.length === 0 && newPanes.length > 1) {
        newPanes.splice(paneIdx, 1);
        setActivePaneIdx(Math.max(0, paneIdx - 1));
      } else {
        setActiveNotePath(activePane.tabs[activePane.activeTabIdx] || null);
      }
      return newPanes;
    });
  };

  const handleOpenInNewWindow = (path: string) => {
    const url = `?note=${encodeURIComponent(path)}`;
    window.open(url, '_blank', 'width=900,height=700,menubar=no,toolbar=no,location=no');
  };

  // Tab drag & drop handlers
  const handleTabDragStart = (e: React.DragEvent, paneIdx: number, tabIdx: number) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ paneIdx, tabIdx }));
  };

  const handleTabDrop = (e: React.DragEvent, targetPaneIdx: number, targetTabIdx?: number) => {
    e.preventDefault();
    try {
      const rawData = e.dataTransfer.getData('text/plain');
      if (!rawData || !rawData.trim().startsWith('{')) return;
      
      const data = JSON.parse(rawData);
      if (data.paneIdx === undefined || data.tabIdx === undefined) return;
      
      const sourcePaneIdx = data.paneIdx;
      const sourceTabIdx = data.tabIdx;

      if (sourcePaneIdx === targetPaneIdx) {
        setPanes(prev => {
          const newPanes = [...prev];
          const activePane = { ...newPanes[sourcePaneIdx] };
          const tabs = [...activePane.tabs];
          const [movedTab] = tabs.splice(sourceTabIdx, 1);
          const insertIdx = targetTabIdx !== undefined ? targetTabIdx : tabs.length;
          tabs.splice(insertIdx, 0, movedTab);
          activePane.tabs = tabs;
          activePane.activeTabIdx = insertIdx;
          newPanes[sourcePaneIdx] = activePane;
          return newPanes;
        });
      } else {
        setPanes(prev => {
          const newPanes = [...prev];
          const sourcePane = { ...newPanes[sourcePaneIdx] };
          const targetPane = { ...newPanes[targetPaneIdx] };

          const [movedTab] = sourcePane.tabs.splice(sourceTabIdx, 1);
          sourcePane.activeTabIdx = Math.max(0, sourcePane.activeTabIdx - 1);

          const insertIdx = targetTabIdx !== undefined ? targetTabIdx : targetPane.tabs.length;
          targetPane.tabs.splice(insertIdx, 0, movedTab);
          targetPane.activeTabIdx = insertIdx;

          newPanes[sourcePaneIdx] = sourcePane;
          newPanes[targetPaneIdx] = targetPane;

          if (sourcePane.tabs.length === 0 && newPanes.length > 1) {
            newPanes.splice(sourcePaneIdx, 1);
            setActivePaneIdx(Math.max(0, targetPaneIdx - (sourcePaneIdx < targetPaneIdx ? 1 : 0)));
          }

          return newPanes;
        });
      }
    } catch (err) {
      console.error(err);
    }
  };
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth > 768);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);

  // Notlar ekranındaki sağ hızlı erişim paneli (Search / Takvim): açılır-kapanır ve yeniden boyutlandırılabilir
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<'search' | 'calendar'>('search');
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const isResizingRightPanel = useRef(false);
  const rightPanelResizeRaf = useRef<number | null>(null);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isResizingRightPanel.current) return;
      const newWidth = Math.max(260, Math.min(560, window.innerWidth - e.clientX));
      setRightPanelWidth(newWidth);
      // Not editörü, Excalidraw/grafik gibi genişliğe bağlı çocuk bileşenlerin de
      // sürükleme sırasında anında yeniden ölçülmesi için resize olayını tetikle.
      if (!rightPanelResizeRaf.current) {
        rightPanelResizeRaf.current = requestAnimationFrame(() => {
          rightPanelResizeRaf.current = null;
          window.dispatchEvent(new Event('resize'));
        });
      }
    };
    const handleUp = () => {
      isResizingRightPanel.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (rightPanelResizeRaf.current) cancelAnimationFrame(rightPanelResizeRaf.current);
    };
  }, []);

  // İki (veya üç) not paneli arasındaki genişlik oranları — sürüklenerek ayarlanabilir bölücü
  const [paneWidths, setPaneWidths] = useState<number[]>([100]);
  const paneResizeState = useRef<{ idx: number; startX: number; startLeft: number; startRight: number; containerWidth: number } | null>(null);
  const paneResizeRaf = useRef<number | null>(null);

  useEffect(() => {
    setPaneWidths(prev => {
      if (prev.length === panes.length) return prev;
      const even = 100 / panes.length;
      return panes.map(() => even);
    });
  }, [panes.length]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const st = paneResizeState.current;
      if (!st) return;
      const deltaPct = ((e.clientX - st.startX) / st.containerWidth) * 100;
      const minPct = 15;
      let left = st.startLeft + deltaPct;
      let right = st.startRight - deltaPct;
      if (left < minPct) { right -= (minPct - left); left = minPct; }
      if (right < minPct) { left -= (minPct - right); right = minPct; }
      setPaneWidths(prev => {
        const next = [...prev];
        next[st.idx] = left;
        next[st.idx + 1] = right;
        return next;
      });
      // Not editörü içindeki genişliğe bağlı bileşenlerin (Excalidraw, grafik vb.)
      // sürükleme sırasında anında yeniden ölçülmesi için resize olayını tetikle.
      if (!paneResizeRaf.current) {
        paneResizeRaf.current = requestAnimationFrame(() => {
          paneResizeRaf.current = null;
          window.dispatchEvent(new Event('resize'));
        });
      }
    };
    const handleUp = () => {
      if (!paneResizeState.current) return;
      paneResizeState.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (paneResizeRaf.current) cancelAnimationFrame(paneResizeRaf.current);
    };
  }, []);

  // Clipboard Monitoring states
  const [clipboardText, setClipboardText] = useState('');
  const [showClipboardBanner, setShowClipboardBanner] = useState(false);
  const [lastClipboardProcessed, setLastClipboardProcessed] = useState(() => {
    return localStorage.getItem('last_clipboard_processed') || '';
  });

  const [lineHeight, setLineHeight] = useState<number>(() => Number(localStorage.getItem('setting_line_height') || '1.6'));
  const [lineMargin, setLineMargin] = useState<number>(() => Number(localStorage.getItem('setting_line_margin') || '8'));

  useEffect(() => {
    const syncTracksToWidget = async () => {
      if (isCapacitor) {
        try {
          await Preferences.set({ key: 'music_tracks', value: JSON.stringify(tracks) });
          await WidgetBridge.refreshWidgets();
        } catch (e) {
          console.error(e);
        }
      }
    };
    syncTracksToWidget();
  }, [tracks]);

  useEffect(() => {
    if (!isCapacitor) return;
    if (currentTrack?.source === 'youtube') return;
    const interval = setInterval(async () => {
      try {
        const isPlayingRes = await Preferences.get({ key: 'music_is_playing' });
        const currentTrackRes = await Preferences.get({ key: 'music_current_track' });
        const positionRes = await Preferences.get({ key: 'music_position' });
        const durationRes = await Preferences.get({ key: 'music_duration' });
        
        if (isPlayingRes.value !== null) {
          setIsPlaying(isPlayingRes.value === 'true');
        }
        if (currentTrackRes.value) {
          const parsed = JSON.parse(currentTrackRes.value);
          const track = tracks.find(t => t.path === parsed.path);
          if (track) {
            setCurrentTrack(track);
          }
        }
        if (positionRes.value) {
          setCurrentTime(parseFloat(positionRes.value));
        }
        if (durationRes.value) {
          setDuration(parseFloat(durationRes.value));
        }
      } catch (e) {
        console.error(e);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [tracks, currentTrack]);

  // Music Player Side Effects
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
    localStorage.setItem('music_volume', volume.toString());
    if (isCapacitor) {
      WidgetBridge.sendMusicCommand({ command: 'set_volume', volume: volume }).catch((err: any) => {
        console.warn('Failed to send set_volume command:', err);
      });
    }
  }, [volume]);

  // Draggable Mini Player States
  const [miniPlayerPos, setMiniPlayerPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const initialDragPosRef = useRef({ x: 0, y: 0 });

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    setIsDragging(true);
    hasMovedRef.current = false;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = {
      x: clientX - miniPlayerPos.x,
      y: clientY - miniPlayerPos.y
    };
    initialDragPosRef.current = { x: clientX, y: clientY };
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      const dx = clientX - initialDragPosRef.current.x;
      const dy = clientY - initialDragPosRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMovedRef.current = true;
      }

      setMiniPlayerPos({
        x: clientX - dragStartRef.current.x,
        y: clientY - dragStartRef.current.y
      });
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  const savePlaylist = async (updatedTracks: Track[]) => {
    localStorage.setItem('music_tracks', JSON.stringify(updatedTracks));
    try {
      const safe = updatedTracks.map(x => ({
        name: x.name,
        path: x.path.startsWith('blob:') ? '' : x.path,
        source: x.path.startsWith('blob:') ? 'online' : x.source,
        onlineUrl: x.onlineUrl || (x.source === 'online' ? x.path : undefined)
      }));
      const content = JSON.stringify(safe, null, 2);
      await platform.writeNote('music_library.md', content);
      await handleLocalSave('music_library.md', content);
    } catch (err) {
      console.error("Error saving synced playlist file:", err);
    }
  };

  useEffect(() => {
    const syncAndVerifyTracks = async () => {
      try {
        let currentPlaylist = tracks;
        let exists = await platform.fileExists('music_library.md');
        if (!exists) {
          const jsonExists = await platform.fileExists('music_library.json');
          if (jsonExists) {
            const jsonContent = await platform.readNote('music_library.json');
            if (jsonContent) {
              await platform.writeNote('music_library.md', jsonContent);
              await handleLocalSave('music_library.md', jsonContent);
              await platform.deletePath('music_library.json');
              exists = true;
            }
          }
        }

        if (exists) {
          const content = await platform.readNote('music_library.md');
          if (content) {
            const parsed = JSON.parse(content) as Track[];
            if (parsed && parsed.length > 0) {
              currentPlaylist = parsed;
              setTracks(parsed);
              localStorage.setItem('music_tracks', JSON.stringify(parsed));
            }
          }
        }
        
        const missing: Record<string, boolean> = {};
        for (const t of currentPlaylist) {
          if (t.source === 'local' && !t.path.startsWith('blob:')) {
            const existsLocally = await platform.fileExists(t.path);
            if (!existsLocally) {
              missing[t.path] = true;
            }
          }
        }
        setMissingTracks(missing);
      } catch (e) {
        console.error("Error syncing playlist file:", e);
      }
    };
    syncAndVerifyTracks();
  }, [syncStatus]);


  useEffect(() => {
    if (isCapacitor) return;
    if (!currentTrack || currentTrack.source === 'youtube') {
      setResolvedAudioSrc(null);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }
    if (currentTrack.path.startsWith('blob:') || currentTrack.path.startsWith('data:')) {
      setResolvedAudioSrc(currentTrack.path);
    } else if (currentTrack.path.startsWith('ARCHIVE:')) {
      const identifier = currentTrack.path.replace('ARCHIVE:', '');
      platform.resolveArchiveTrack(identifier).then((url) => {
        setResolvedAudioSrc(url);
      }).catch((err) => {
        console.error("Failed to resolve archive stream:", err);
      });
    } else if (currentTrack.path.startsWith('http')) {
      setResolvedAudioSrc(currentTrack.path);
    } else {
      platform.readMedia(currentTrack.path).then((dataUrl) => {
        setResolvedAudioSrc(dataUrl);
      }).catch((err) => {
        console.error("Failed to read media track:", err);
      });
    }
  }, [currentTrack]);

  // Load track when source changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isCapacitor) return;

    if (resolvedAudioSrc) {
      audio.load();
      if (isPlaying) {
        audio.play().catch(err => console.warn('Playback error:', err));
      }
    } else {
      audio.pause();
    }
  }, [resolvedAudioSrc]);

  // Handle play/pause state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isCapacitor || !resolvedAudioSrc) return;

    if (isPlaying) {
      audio.play().catch(err => console.warn('Playback error:', err));
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleAudioEnded = () => {
    if (isRepeat) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(err => console.warn(err));
      }
    } else {
      handleNextTrack();
    }
  };

  const handleNextTrack = () => {
    if (tracks.length === 0) return;
    let nextIdx = 0;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * tracks.length);
    } else if (currentTrack) {
      const currentIdx = tracks.findIndex(t => t.path === currentTrack.path);
      nextIdx = (currentIdx + 1) % tracks.length;
    }
    handlePlayTrack(tracks[nextIdx]);
  };

  const handlePrevTrack = () => {
    if (tracks.length === 0) return;
    let prevIdx = 0;
    if (isShuffle) {
      prevIdx = Math.floor(Math.random() * tracks.length);
    } else if (currentTrack) {
      const currentIdx = tracks.findIndex(t => t.path === currentTrack.path);
      prevIdx = (currentIdx - 1 + tracks.length) % tracks.length;
    }
    handlePlayTrack(tracks[prevIdx]);
  };

  const handlePlayPause = () => {
    if (isCapacitor && currentTrack && currentTrack.source !== 'youtube') {
      WidgetBridge.sendMusicCommand({ command: 'play_pause' });
      setIsPlaying(prev => !prev);
      return;
    }
    if (!currentTrack && tracks.length > 0) {
      const firstPlayable = tracks.find(t => t.source !== 'youtube') || tracks[0];
      handlePlayTrack(firstPlayable);
    } else {
      setIsPlaying(prev => !prev);
    }
  };

  const handlePlayTrack = (track: Track) => {
    if (isCapacitor && track.source !== 'youtube') {
      WidgetBridge.sendMusicCommand({ command: 'play_track', track_path: track.path });
      setCurrentTrack(track);
      setIsPlaying(true);
      return;
    }
    if (isCapacitor && track.source === 'youtube') {
      WidgetBridge.sendMusicCommand({ command: 'stop' });
    }
    setCurrentTrack(track);
    setIsPlaying(true);
  };

  const handleAddTracks = async (files: FileList) => {
    const newTracks: Track[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name.replace(/\.[^/.]+$/, "");
      const workspacePath = `media/${Date.now()}_${file.name}`;
      const blobUrl = URL.createObjectURL(file);

      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          await platform.writeNote(workspacePath, dataUrl);
          setTracks(prev => {
            const updated = prev.map(t => t.path === blobUrl ? { ...t, path: workspacePath } : t);
            savePlaylist(updated);
            return updated;
          });
        };
        reader.onloadend = () => {
          // Trigger file check update
          setMissingTracks(prev => {
            const copy = { ...prev };
            delete copy[workspacePath];
            return copy;
          });
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.warn("Persistent save error:", err);
      }

      newTracks.push({
        name,
        path: blobUrl,
        source: 'local'
      });
    }

    const updated = [...tracks, ...newTracks];
    setTracks(updated);
    savePlaylist(updated);

    if (!currentTrack && newTracks.length > 0) {
      setCurrentTrack(newTracks[0]);
      setIsPlaying(true);
    }
  };

  const handleRemoveTrack = async (trackPath: string) => {
    if (currentTrack?.path === trackPath) {
      setIsPlaying(false);
      setCurrentTrack(null);
    }

    if (!trackPath.startsWith('blob:') && !trackPath.startsWith('data:')) {
      try {
        await platform.deletePath(trackPath);
      } catch (err) {
        console.warn("Track deletion error:", err);
      }
    }

    const updated = tracks.filter(t => t.path !== trackPath);
    setTracks(updated);
    savePlaylist(updated);
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleDownloadTrack = async (title: string, streamUrl: string) => {
    try {
      let targetUrl = streamUrl;
      if (streamUrl.startsWith('ARCHIVE:')) {
        const identifier = streamUrl.replace('ARCHIVE:', '');
        targetUrl = await platform.resolveArchiveTrack(identifier);
        if (!targetUrl) throw new Error("Could not resolve archive track URL");
      }

      // Try to determine extension from targetUrl path
      let extension = 'mp3';
      try {
        const urlObj = new URL(targetUrl);
        const pathname = urlObj.pathname.toLowerCase();
        if (pathname.endsWith('.ogg')) extension = 'ogg';
        else if (pathname.endsWith('.webm')) extension = 'webm';
        else if (pathname.endsWith('.wav')) extension = 'wav';
        else if (pathname.endsWith('.flac')) extension = 'flac';
        else if (pathname.endsWith('.m4a')) extension = 'm4a';
        else if (pathname.endsWith('.mp4')) extension = 'mp4';
        else if (pathname.endsWith('.aac')) extension = 'aac';
      } catch (e) {}

      let finalPath = '';
      let newTrack: Track | null = null;

      if (!platform.downloadMedia) {
        // Desktop/Web path (uses fetch)
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const blob = await res.blob();

        if (blob.type) {
          if (blob.type.includes('webm')) extension = 'webm';
          else if (blob.type.includes('ogg')) extension = 'ogg';
          else if (blob.type.includes('wav')) extension = 'wav';
          else if (blob.type.includes('mp4') || blob.type.includes('m4a') || blob.type.includes('x-m4a')) extension = 'm4a';
          else if (blob.type.includes('flac')) extension = 'flac';
          else if (blob.type.includes('aac')) extension = 'aac';
          else if (blob.type.includes('opus')) extension = 'opus';
        }

        const filename = `${Date.now()}_${title.replace(/[/\\?%*:|"<>]/g, '-')}.${extension}`;
        finalPath = `media/${filename}`;

        const reader = new FileReader();
        const loadPromise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        reader.readAsDataURL(blob);
        const dataUrl = await loadPromise;

        await platform.writeNote(finalPath, dataUrl);

        newTrack = {
          name: title,
          path: finalPath,
          source: 'local',
          onlineUrl: streamUrl
        };
      } else {
        // Mobile native path
        const filename = `${Date.now()}_${title.replace(/[/\\?%*:|"<>]/g, '-')}.${extension}`;
        finalPath = `media/${filename}`;

        const downloadRes = await platform.downloadMedia(finalPath, targetUrl);
        if (!downloadRes.success) throw new Error(downloadRes.error || "Native download failed");

        newTrack = {
          name: title,
          path: finalPath,
          source: 'local',
          onlineUrl: streamUrl
        };
      }

      if (newTrack) {
        const trackToSave = newTrack;
        setTracks(prev => {
          const updated = [...prev, trackToSave];
          savePlaylist(updated);
          return updated;
        });

        if (!currentTrack) {
          setCurrentTrack(trackToSave);
          setIsPlaying(true);
        }
      }
    } catch (err) {
      console.warn("Failed to download online track locally, falling back to streaming URL:", err);
      const fallbackTrack: Track = {
        name: title,
        path: streamUrl,
        source: 'online',
        onlineUrl: streamUrl
      };

      setTracks(prev => {
        const updated = [...prev, fallbackTrack];
        savePlaylist(updated);
        return updated;
      });

      if (!currentTrack) {
        setCurrentTrack(fallbackTrack);
        setIsPlaying(true);
      }
    }
  };

  const handleDownloadMissingTrack = async (track: Track) => {
    if (!track.onlineUrl) return;
    
    try {
      let targetUrl = track.onlineUrl;
      if (track.onlineUrl.startsWith('ARCHIVE:')) {
        const identifier = track.onlineUrl.replace('ARCHIVE:', '');
        targetUrl = await platform.resolveArchiveTrack(identifier);
        if (!targetUrl) throw new Error("Could not resolve archive URL");
      }
      
      if (platform.downloadMedia) {
        const downloadRes = await platform.downloadMedia(track.path, targetUrl);
        if (!downloadRes.success) throw new Error(downloadRes.error || "Native download failed");
      } else {
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const blob = await res.blob();
        
        const reader = new FileReader();
        const loadPromise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        reader.readAsDataURL(blob);
        const dataUrl = await loadPromise;
        
        await platform.writeNote(track.path, dataUrl);
      }
      
      setMissingTracks(prev => {
        const copy = { ...prev };
        delete copy[track.path];
        return copy;
      });
    } catch (err) {
      console.error("Failed to download missing track from cloud:", err);
    }
  };

  const handleDownloadAllMissing = async () => {
    const missing = tracks.filter(t => t.source === 'local' && missingTracks[t.path] && t.onlineUrl);
    for (const t of missing) {
      await handleDownloadMissingTrack(t);
    }
  };

  const handleAddYoutubeTrack = async (title: string, url: string) => {
    const newTrack: Track = {
      name: title,
      path: url,
      source: 'youtube',
      onlineUrl: url
    };
    setTracks(prev => {
      const updated = [...prev, newTrack];
      savePlaylist(updated);
      return updated;
    });

    if (!currentTrack) {
      setCurrentTrack(newTrack);
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    localStorage.setItem('active_tab', activeTab);
  }, [activeTab]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ: Aşağıdaki efekt eskiden [activeNotePath, lastClipboardProcessed, notes]'a
  // bağımlıydı. notes, her loadAllData() çağrısında (ör. handleFocusOrResume içinde) yeni bir
  // referans olarak yeniden oluşturuluyordu; bu da efektin listener'ları söküp yeniden kurmasına
  // VE her seferinde tekrar setTimeout(checkClipboard, 1500) planlamasına yol açıyordu. loadAllData
  // -> notes değişir -> efekt yeniden çalışır -> checkClipboard tekrar zamanlanır -> (odaklanma/
  // görünürlük olaylarıyla) tekrar loadAllData çağrılabilir şeklinde birbirini besleyen bir döngü
  // oluşuyordu — saniyede onlarca kez "panoyu oku" hatası ve arka planda sürekli tam veri taraması
  // demekti; bu hem "her 2 saniyede eşitleniyor" hissinin hem de uzun süre açık kalınca CPU/bellek
  // tükenip uygulamanın beyaz ekranda çökmesinin kök nedeniydi. Çözüm: state'leri ref'te tutup
  // efekti yalnızca bir kez (mount'ta) kurmak — listener'lar asla gereksiz yere yeniden kurulmaz.
  const activeNotePathRef = useRef(activeNotePath);
  useEffect(() => { activeNotePathRef.current = activeNotePath; }, [activeNotePath]);
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const lastClipboardProcessedRef = useRef(lastClipboardProcessed);
  useEffect(() => { lastClipboardProcessedRef.current = lastClipboardProcessed; }, [lastClipboardProcessed]);

  const checkClipboard = async () => {
    const targetPath = activeNotePathRef.current || notesRef.current.find(n => n.type === 'note')?.path;
    if (!targetPath) return;

    try {
      let text = '';
      if (isCapacitor) {
        const { Clipboard } = await import('@capacitor/clipboard');
        const res = await Clipboard.read();
        if (res.type === 'string' && res.value) {
          text = res.value.trim();
        }
      } else {
        text = (await navigator.clipboard.readText()).trim();
      }

      if (text && text !== lastClipboardProcessedRef.current) {
        setClipboardText(text);
        setShowClipboardBanner(true);
      }
    } catch (err) {
      console.warn('Failed to read clipboard:', err);
    }
  };

  useEffect(() => {
    setTimeout(checkClipboard, 1500);

    const handleFocusOrResume = async () => {
      setTimeout(checkClipboard, 500);
      await loadAllData();
      triggerRemoteSync();
    };

    const handleGlobalCopy = () => {
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Uygulama içerisinden kopyalanan metinlerin, uygulamaya geri dönüldüğünde
      // kopyalama modalı (clipboard popup) tetiklemesini önlemek için son kopyalanan olarak kaydederiz.
      setTimeout(async () => {
        try {
          let text = '';
          if (isCapacitor) {
            const { Clipboard } = await import('@capacitor/clipboard');
            const res = await Clipboard.read();
            if (res.type === 'string' && res.value) {
              text = res.value.trim();
            }
          } else {
            text = (await navigator.clipboard.readText()).trim();
          }
          if (text) {
            localStorage.setItem('last_clipboard_processed', text);
            setLastClipboardProcessed(text);
          }
        } catch (err) {
          console.warn('Failed to sync copy event to last_clipboard_processed:', err);
        }
      }, 100);
    };

    window.addEventListener('focus', handleFocusOrResume);
    document.addEventListener('resume', handleFocusOrResume);
    window.addEventListener('copy', handleGlobalCopy);
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleFocusOrResume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocusOrResume);
      document.removeEventListener('resume', handleFocusOrResume);
      window.removeEventListener('copy', handleGlobalCopy);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Android donanım/gesture geri tuşu hiç yakalanmıyordu (varsayılan davranış:
  // uygulamayı simge durumuna küçült). Bir not açıkken geri tuşuna basılırsa notu
  // kapatıp notların listelendiği sol paneli açıyoruz; aksi halde önceki varsayılan
  // davranışı (uygulamayı küçültme) korumak için App.exitApp() çağırıyoruz — bu
  // dinleyiciyi eklemek varsayılan geri tuşu davranışını TAMAMEN devre dışı bırakır,
  // bu yüzden başka hiçbir durumu ele almıyoruz burada onu manuel olarak yeniden
  // tetiklememiz gerekiyor.
  useEffect(() => {
    if (!isCapacitor) return;
    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      if (activeNotePath) {
        setActiveNotePath(null);
        setIsSidebarOpen(true);
      } else {
        CapacitorApp.exitApp();
      }
    });
    return () => {
      listenerPromise.then(handle => handle.remove());
    };
  }, [activeNotePath]);

  const handlePasteClipboardToNote = async () => {
    const targetPath = activeNotePath || notes.find(n => n.type === 'note')?.path;
    if (!targetPath || !clipboardText) return;

    try {
      const currentContent = fileContents[targetPath] || '';
      const timestamp = new Date().toLocaleString('tr-TR');
      const citation = `\n\n> 📋 **Pano Kaydı (${timestamp}):**\n${clipboardText.split('\n').map(line => `> ${line}`).join('\n')}\n`;
      const newContent = currentContent.trimEnd() + citation;

      await handleSaveNote(targetPath, newContent);
      
      localStorage.setItem('last_clipboard_processed', clipboardText);
      setLastClipboardProcessed(clipboardText);
      setShowClipboardBanner(false);
    } catch (err) {
      console.error('Failed to paste clipboard to note:', err);
    }
  };

  const handleDismissClipboard = () => {
    localStorage.setItem('last_clipboard_processed', clipboardText);
    setLastClipboardProcessed(clipboardText);
    setShowClipboardBanner(false);
  };

  // BUG DÜZELTMESİ (kök neden): "Bir şey sildikten sonra hiçbir yerde yazamıyorum, ama
  // uygulamayı küçültüp büyütünce düzeliyor" şikayetinin asıl kaynağı — native
  // `window.confirm()` diyaloğu. Bu diyalog senkron/bloklayıcı olsa da gerçek bir
  // pencere `blur`/`focus` OLAYI TETİKLEMİYOR (yalnızca OS seviyesinde küçültme gibi
  // GERÇEK bir pencere odağı kaybı bunu tetikliyor) — bu yüzden odağa dayalı hiçbir
  // temizleme/yenileme mekanizması (ör. NotesView'daki eski seçim aralığı temizliği)
  // silme onayı sırasında hiç çalışmıyordu. Kalıcı çözüm: tüm silme/onay diyaloglarını
  // native confirm() yerine bu uygulama-içi (in-app) React modalıyla değiştirmek —
  // odak hiçbir zaman gerçekten "kayıp" olmuyor, native diyalog kaynaklı tüm bu sınıf
  // hatalar kökten ortadan kalkıyor.
  const [confirmDialogState, setConfirmDialogState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const requestConfirm = (message: string, onConfirm: () => void) => {
    setConfirmDialogState({ message, onConfirm });
  };

  // Supabase Sync states
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [supabaseVault, setSupabaseVault] = useState('default');
  const [syncError, setSyncError] = useState<string | null>(null);
  // BUG DÜZELTMESİ: Tam ekran "Eşitleniyor..." engelleme ekranı yalnızca uygulamanın
  // İLK açılışındaki senkron için gösterilmeli — ama syncStatus oturum boyunca
  // (ör. bir klasör silinirken içindeki HER not için triggerRemoteSync tekrar
  // tekrar çalışıp 'syncing' -> 'synced' arasında gidip geldiğinde) defalarca
  // 'syncing' olabiliyor. REF (state değil) kullanılıyor çünkü bu sadece render
  // sırasında okunan bir bayrak — değişmesi kendi başına yeniden render tetiklemesin.
  const hasCompletedFirstSyncRef = useRef(false);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Yazma Hızı Efektleri (Flow-State / Power Mode) özelliğinin açık olup olmadığını tutar.
  const [isFlowEffectsEnabled, setIsFlowEffectsEnabled] = useState<boolean>(() => {
    return localStorage.getItem('flow_effects_enabled') !== 'false';
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Not Şehri modülünün sol menüde ve sekme olarak aktif olup olmadığını tutar.
  const [isNoteCityEnabled, setIsNoteCityEnabled] = useState<boolean>(() => {
    return localStorage.getItem('setting_note_city_enabled') !== 'false';
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "Gelişim Yolu" (rütbe) panelinin sol menü altında görünüp görünmeyeceğini tutar.
  // Eski "Odak Evcil Hayvanı" özelliğinin yerini alır.
  const [isDevPathsEnabled, setIsDevPathsEnabled] = useState<boolean>(() => {
    return localStorage.getItem('setting_dev_paths_enabled') !== 'false';
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Faz 2: Gemini destekli AI Mentor katmanı aç/kapa. Kapalıyken (veya API anahtarı
  // girilmemişken) gelişim yolu işaretleme Faz 1'in basit rütbe/XP akışına döner.
  const [isAiMentorEnabled, setIsAiMentorEnabled] = useState<boolean>(() => {
    return localStorage.getItem('setting_ai_mentor_enabled') !== 'false';
  });
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState<string>(() => getGeminiApiKey() || '');
  const [geminiModelInput, setGeminiModelInput] = useState<string>(() => getGeminiModel());

  // Gelişim yolu AI sihirbazı (seviye/müfredat belirleme) durumu.
  const [devPathWizardTarget, setDevPathWizardTarget] = useState<string | null>(null);
  // BUG DÜZELTMESİ (yanlış anlaşılan hedef): tek bir serbest metin kutusu yerine iki ayrı
  // alan — "şu anki durum" ve "hedeflenen rol" — kullanıcının niyetini tek bir belirsiz
  // paragrafa sığdırmak zorunda kalmadan daha net ifade etmesini sağlıyor.
  const [devPathWizardCurrentDesc, setDevPathWizardCurrentDesc] = useState('');
  const [devPathWizardGoalDesc, setDevPathWizardGoalDesc] = useState('');
  // Not oluşturma modu: sihirbazda alan bazında BİR KERE seçilir (bkz. devPaths.ts).
  const [devPathWizardNoteMode, setDevPathWizardNoteMode] = useState<DevPathNoteMode>('basic');
  const [devPathWizardQA, setDevPathWizardQA] = useState<ClarifyingQA[]>([]);
  const [devPathWizardQuestion, setDevPathWizardQuestion] = useState<{ question: string; options: string[] } | null>(null);
  const [devPathWizardBusy, setDevPathWizardBusy] = useState(false);
  const [devPathWizardError, setDevPathWizardError] = useState<string | null>(null);
  // BUG DÜZELTMESİ (yanlış anlaşılan hedef): AI'nin ürettiği seviye+konu listesi artık
  // HEMEN klasör olarak oluşturulmuyor — önce bu önizleme durumunda gösteriliyor, kullanıcı
  // konuları tek tek kaldırabiliyor VEYA "bu yanlış" deyip düzeltme yazıp yeniden
  // ürettirebiliyor. Yalnızca "Onayla ve Oluştur" ile gerçekten diske yazılıyor.
  const [devPathWizardPreview, setDevPathWizardPreview] = useState<{
    levelTitle: string;
    topics: { title: string; description: string; introNote?: string }[];
    priorLevels: { title: string; topics: { title: string; description: string; introNote?: string }[] }[];
  } | null>(null);
  const [devPathWizardShowCorrection, setDevPathWizardShowCorrection] = useState(false);
  const [devPathWizardCorrectionText, setDevPathWizardCorrectionText] = useState('');

  // Konu testi (quiz) sihirbazı durumu.
  const [devPathQuizTarget, setDevPathQuizTarget] = useState<{ path: string; levelIdx: number; topicIdx: number } | null>(null);
  const [devPathQuizQuestions, setDevPathQuizQuestions] = useState<string[]>([]);
  const [devPathQuizAnswers, setDevPathQuizAnswers] = useState<string[]>([]);
  const [devPathQuizBusy, setDevPathQuizBusy] = useState(false);
  const [devPathQuizResult, setDevPathQuizResult] = useState<{ passed: boolean; feedback: string; weakAreas?: string[] } | null>(null);
  const [devPathQuizError, setDevPathQuizError] = useState<string | null>(null);

  // "Test Et" ÖNCESİ ön koşul: kullanıcı konuyu kendi cümleleriyle özetler, AI onaylarsa
  // konuya gerçekten çalışıldığının ilk kanıtı sayılır ve quiz açılır.
  const [devPathSummaryTarget, setDevPathSummaryTarget] = useState<{ path: string; levelIdx: number; topicIdx: number } | null>(null);
  const [devPathSummaryText, setDevPathSummaryText] = useState('');
  const [devPathSummaryBusy, setDevPathSummaryBusy] = useState(false);
  const [devPathSummaryResult, setDevPathSummaryResult] = useState<{ approved: boolean; feedback: string } | null>(null);
  const [devPathSummaryError, setDevPathSummaryError] = useState<string | null>(null);

  // Gelişim yolu detay paneli (tüm seviyeler/konular + "bunu bilmiyorum" işaretleme).
  const [devPathDetailTarget, setDevPathDetailTarget] = useState<string | null>(null);

  // Gelişim Yolu Detayı panelinde mevcut seviyeye AI'den bir konu daha önerilmesi
  // ("Eksik bir konu var, ekle") akışının durumu.
  const [devPathAddTopicTarget, setDevPathAddTopicTarget] = useState<{ path: string; levelIdx: number } | null>(null);
  const [devPathAddTopicHint, setDevPathAddTopicHint] = useState('');
  const [devPathAddTopicBusy, setDevPathAddTopicBusy] = useState(false);
  const [devPathAddTopicError, setDevPathAddTopicError] = useState<string | null>(null);

  // Konu bazlı işlem (kart oluştur / takvime ekle) çalışıyor/sonuç durumu — detay
  // panelinde geçici bir onay mesajı göstermek için (ör. "8 kart oluşturuldu ✅").
  const [devPathTopicActionBusy, setDevPathTopicActionBusy] = useState<{ levelIdx: number; topicIdx: number } | null>(null);
  const [devPathTopicActionMessage, setDevPathTopicActionMessage] = useState<{ levelIdx: number; topicIdx: number; text: string } | null>(null);

  // Ana gezinme artık sol menüde değil, üst başlık çubuğunda (titlebar) kompakt ikonlar olarak gösteriliyor.
  const titlebarPrimaryItems = [
    { id: 'notfactory', label: 'Hızlı Giriş', icon: Zap },
    { id: 'dashboard', label: 'Gösterge Paneli', icon: Layout },
    { id: 'inbox', label: 'Gelen Kutusu (Inbox)', icon: Inbox },
    { id: 'tasks', label: 'Görev Havuzu (Tasks)', icon: CheckSquare },
    { id: 'timeline', label: 'Zaman Akışı (Timeline)', icon: Clock },
    { id: 'calendar', label: 'Takvim Planlayıcı', icon: Calendar },
  ];
  const titlebarWorkItems = [
    { id: 'projects', label: 'Proje Yönetimi', icon: KanbanSquare },
    { id: 'finance', label: 'Finans', icon: Wallet },
  ];
  const titlebarToolItems = [
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
  const [openTitlebarMenu, setOpenTitlebarMenu] = useState<'work' | 'tools' | null>(null);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Şablon (template) dosyalarının aranacağı ve oluşturulacağı özel klasör adını tutar.
  const [templatesFolder, setTemplatesFolder] = useState<string>(() => {
    return localStorage.getItem('setting_templates_folder') || '.templates';
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Global Pomodoro sayacının kalan saniyesini tutar (tüm sayfalarda kesintisiz çalışması için).
  const [pomodoroSeconds, setPomodoroSeconds] = useState<number>(25 * 60);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Global Pomodoro sayacının aktif olup olmadığını (çalışma durumunu) tutar.
  const [isPomodoroRunning, setIsPomodoroRunning] = useState<boolean>(false);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Global Pomodoro sayacının zamanlayıcı (setInterval) referansını saklar.
  const pomodoroIntervalRef = useRef<any>(null);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Pomodoro süresi dolduğunda çalacak olan uyarı bip sesini üreten fonksiyon.
  const playGlobalBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      oscillator.start();
      setTimeout(() => oscillator.stop(), 500);
    } catch (e) {
      console.error('Global bip sesi çalınamadı:', e);
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Pomodoro zamanlayıcısını saniyede bir güncelleyen, bittiğinde istatistikleri ve evcil hayvan EXP/sağlığını arttıran mekanizma.
  useEffect(() => {
    if (isPomodoroRunning) {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      pomodoroIntervalRef.current = setInterval(() => {
        setPomodoroSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(pomodoroIntervalRef.current);
            setIsPomodoroRunning(false);
            playGlobalBeep();

            // Tamamlanan Pomodoro istatistiğini kaydet
            const count = Number(localStorage.getItem('completed_pomodoros') || '0');
            localStorage.setItem('completed_pomodoros', String(count + 1));

            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('⏱️ Pomodoro tamamlandı!', { body: 'Mola verme zamanı geldi.' });
            }

            return 25 * 60;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
      }
    }

    return () => {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
      }
    };
  }, [isPomodoroRunning]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Çok sayfalı ayarlar panelinde aktif olan sayfa/sekme adını tutar.
  const [settingsTab, setSettingsTab] = useState<'sync' | 'ai' | 'appearance' | 'shortcuts' | 'trash' | 'about'>('sync');
  // Çöp Kutusu: yerel .trash/index.json içeriği + Supabase'de is_deleted=true olan
  // (yerelde kopyası olmayabilecek) notlar birleştirilerek gösterilir.
  const [localTrashEntries, setLocalTrashEntries] = useState<Array<{ id: string; originalPath: string; name: string; content: string; deletedAt: number }>>([]);
  const [remoteTrashEntries, setRemoteTrashEntries] = useState<Array<{ path: string; name: string; content: string; updated_at: string }>>([]);
  const [isTrashLoading, setIsTrashLoading] = useState(false);
  // Toplu geri getir/kalıcı sil için işaretlenen çöp kutusu öğeleri. Yerel (id) ve uzak
  // (path) girişler aynı Set'te "local:"/"remote:" önekiyle ayrıştırılarak tutulur.
  const [selectedTrashKeys, setSelectedTrashKeys] = useState<Set<string>>(new Set());
  const [trashSearchQuery, setTrashSearchQuery] = useState('');

  // Supabase veritabanı boyutu (Ayarlar > Senkronizasyon ekranında gösterilir).
  const [dbSizeBytes, setDbSizeBytes] = useState<number | null>(null);
  const [isDbSizeLoading, setIsDbSizeLoading] = useState(false);
  const [dbSizeError, setDbSizeError] = useState<string | null>(null);
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Toplam kota (kaç MB/GB'a kadar hakkımız var) Supabase'in Management API'si olmadan
  // programatik okunamıyor (bkz. önceki karar: hesap genelinde yetkili token istemiyoruz).
  // Bunun yerine kullanıcı planını burada bir kereliğine seçiyor, biz de kullanılan/toplam
  // oranını buradan hesaplıyoruz.
  const [dbCapacityMb, setDbCapacityMb] = useState<number>(() => {
    const saved = localStorage.getItem('supabase_db_capacity_mb');
    return saved ? Number(saved) : 500; // Supabase Free plan varsayılanı
  });

  const loadDbSize = async () => {
    setIsDbSizeLoading(true);
    setDbSizeError(null);
    try {
      const bytes = await fetchDatabaseSizeBytes();
      if (bytes === null) {
        setDbSizeError('get_db_size fonksiyonu bulunamadı — aşağıdaki SQL\'i Supabase SQL Editor\'de bir kez çalıştırman gerekiyor.');
      }
      setDbSizeBytes(bytes);
    } finally {
      setIsDbSizeLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIdx = -1;
    do {
      value /= 1024;
      unitIdx++;
    } while (value >= 1024 && unitIdx < units.length - 1);
    return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unitIdx]}`;
  };

  useEffect(() => {
    if (isSettingsModalOpen && settingsTab === 'sync') {
      loadDbSize();
    }
  }, [isSettingsModalOpen, settingsTab]);

  // Zaman Akışı'ndaki bir kayda tıklanınca o notun .versions geçmişinden git benzeri
  // (kırmızı/yeşil) satır bazlı değişiklik listesini gösteren modal.
  const [historyModalItem, setHistoryModalItem] = useState<TimelineItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<Array<{ timestamp: number; before: string; after: string }>>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Help Guide states
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [recordingShortcutKey, setRecordingShortcutKey] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<Record<string, { label: string; shortcut: ShortcutKey }>>(() => {
    const saved = localStorage.getItem('desktop_shortcuts');
    if (saved) {
      try {
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Kaydedilmiş kısayolları varsayılanlarla birleştiriyoruz ki sonradan eklenen yeni
        // kısayollar (örn. üst menü gezinme kısayolları) eski kullanıcılarda da görünsün.
        return { ...DEFAULT_SHORTCUTS, ...JSON.parse(saved) };
      } catch (e) {
        console.error('Error parsing shortcuts:', e);
      }
    }
    return DEFAULT_SHORTCUTS;
  });

  // Swipe gesture tracking state
  const [touchStartClientX, setTouchStartClientX] = useState<number | null>(null);
  const [touchStartClientY, setTouchStartClientY] = useState<number | null>(null);

  // Notification scheduling logic
  const scheduleNotificationsForTasks = async (tasks: TimelineItem[], alarms: AlarmItem[]) => {
    if (!isCapacitor) return;
    try {
      const isPermitted = await LocalNotifications.checkPermissions();
      if (isPermitted.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        if (req.display !== 'granted') return;
      }

      // Delete old channels so Android picks up new settings
      try {
        await LocalNotifications.deleteChannel({ id: 'tasks' });
        await LocalNotifications.deleteChannel({ id: 'alarms' });
      } catch (_) { /* ignore if not found */ }

      await LocalNotifications.createChannel({
        id: 'tasks_v2',
        name: 'Görevler',
        importance: 5,
        vibration: true,
        visibility: 1,
        sound: 'default'
      });

      await LocalNotifications.createChannel({
        id: 'alarms_v2',
        name: 'Alarmlar',
        importance: 5,
        vibration: true,
        visibility: 1,
        sound: 'default'
      });

      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
      }

      const activeTodos = tasks.filter(t => t.isTodo && !t.isCompleted);
      const notificationsToSchedule = [];
      let uniqueIdCounter = 1000;

      for (let i = 0; i < Math.min(activeTodos.length, 30); i++) {
        const task = activeTodos[i];
        const [year, month, day] = task.dateStr.split('-').map(Number);
        const [hour, minute] = task.timestamp.split(':').map(Number);
        
        if (!year || !month || !day || isNaN(hour) || isNaN(minute)) continue;

        const scheduledTime = new Date(year, month - 1, day, hour, minute, 0);
        
        if (scheduledTime.getTime() > Date.now()) {
          notificationsToSchedule.push({
            title: 'Görev Zamanı! ⏰',
            body: task.content,
            id: uniqueIdCounter++,
            schedule: { at: scheduledTime, allowWhileIdle: true, exact: true },
            channelId: 'tasks_v2',
            attachments: [],
            actionTypeId: '',
            extra: null
          });
        }

        const advanceTime = new Date(scheduledTime.getTime() - 15 * 60 * 1000);
        if (advanceTime.getTime() > Date.now()) {
          notificationsToSchedule.push({
            title: 'Yaklaşan Görev (15 dk kaldı) ⏳',
            body: task.content,
            id: uniqueIdCounter++,
            schedule: { at: advanceTime, allowWhileIdle: true, exact: true },
            channelId: 'tasks_v2',
            attachments: [],
            actionTypeId: '',
            extra: null
          });
        }
      }

      // Kademeli hatırlatmalar: bitiş tarihi geçmiş ama hâlâ tamamlanmamış
      // görevler için, geciken süreye göre giderek aciliyeti artan ek
      // bildirimler planla (gecikmeden +1, +3 ve +7 gün sonra, sabit bir saatte).
      // Yalnızca henüz gelmemiş (gelecekteki) zaman noktaları planlanır.
      const REMINDER_HOUR = 9; // Sabah 09:00
      const ESCALATION_OFFSETS_DAYS = [
        { days: 1, label: '1 gündür gecikti ⏰' },
        { days: 3, label: '3 gündür gecikti ⚠️' },
        { days: 7, label: '1 haftadır gecikti! 🚨' }
      ];

      const overdueTodos = activeTodos.filter(t => {
        const [y, m, d] = t.dateStr.split('-').map(Number);
        if (!y || !m || !d) return false;
        const due = new Date(y, m - 1, d, 23, 59, 59);
        return due.getTime() < Date.now();
      });

      for (let i = 0; i < Math.min(overdueTodos.length, 30); i++) {
        const task = overdueTodos[i];
        const [year, month, day] = task.dateStr.split('-').map(Number);
        if (!year || !month || !day) continue;

        ESCALATION_OFFSETS_DAYS.forEach(({ days, label }) => {
          const reminderTime = new Date(year, month - 1, day + days, REMINDER_HOUR, 0, 0);
          if (reminderTime.getTime() > Date.now()) {
            notificationsToSchedule.push({
              title: `Geciken Görev: ${label}`,
              body: task.content,
              id: uniqueIdCounter++,
              schedule: { at: reminderTime, allowWhileIdle: true, exact: true },
              channelId: 'tasks_v2',
              attachments: [],
              actionTypeId: '',
              extra: null
            });
          }
        });
      }

      for (let i = 0; i < Math.min(alarms.length, 20); i++) {
        const alarm = alarms[i];
        const [year, month, day] = alarm.dateStr.split('-').map(Number);
        const [hour, minute] = alarm.timeStr.split(':').map(Number);

        if (!year || !month || !day || isNaN(hour) || isNaN(minute)) continue;

        const scheduledTime = new Date(year, month - 1, day, hour, minute, 0);
        if (scheduledTime.getTime() > Date.now()) {
          notificationsToSchedule.push({
            title: `Alarm Hatırlatıcı ⏰ (${alarm.noteName})`,
            body: `${alarm.timeStr} için kurulan alarm süresi doldu!`,
            id: uniqueIdCounter++,
            schedule: { at: scheduledTime, allowWhileIdle: true, exact: true },
            channelId: 'alarms_v2',
            attachments: [],
            actionTypeId: '',
            extra: null
          });
        }
      }

      if (notificationsToSchedule.length > 0) {
        await LocalNotifications.schedule({
          notifications: notificationsToSchedule
        });
      }
    } catch (e) {
      console.error('Failed to schedule local notifications:', e);
    }
  };

  const handleRemoteChange = () => {
    loadAllData();
  };

  const handleStatusChange = (status: 'synced' | 'syncing' | 'offline' | 'error', error?: string | null) => {
    setSyncStatus(status);
    setSyncError(error || null);
    if (status === 'synced' || status === 'error' || status === 'offline') {
      hasCompletedFirstSyncRef.current = true;
    }
    if (status === 'synced') {
      loadAllData();
    }
  };

  const handleConflicts = (conflicts: SyncConflict[]) => {
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Aynı yol için birden fazla senkron turundan gelen bildirim varsa en güncelini tutar.
    setSyncConflicts(prev => {
      const merged = [...prev];
      conflicts.forEach(c => {
        const existingIdx = merged.findIndex(m => m.path === c.path);
        if (existingIdx >= 0) merged[existingIdx] = c;
        else merged.push(c);
      });
      return merged;
    });
  };

  const handleResolveConflict = async (conflict: SyncConflict, side: 'local' | 'remote') => {
    try {
      await resolveConflict(conflict.path, side, conflict.localContent, conflict.remoteContent, conflict.remoteUpdatedAt);
    } catch (err) {
      console.error('Failed to resolve conflict:', err);
    } finally {
      setSyncConflicts(prev => prev.filter(c => c.path !== conflict.path));
    }
  };

  const dismissConflict = (path: string) => {
    setSyncConflicts(prev => prev.filter(c => c.path !== path));
  };

  // Load Supabase credentials and initialize sync on startup
  useEffect(() => {
    // Request local notification permissions on mobile startup
    if (isCapacitor) {
      LocalNotifications.requestPermissions().catch(e => {
        console.error('Failed notification permission request:', e);
      });
    }

    const saved = localStorage.getItem('supabase_sync_creds');
    if (saved) {
      try {
        const creds = JSON.parse(saved);
        setSupabaseUrl(creds.url || '');
        setSupabaseAnonKey(creds.anonKey || '');
        setSupabaseVault(creds.vault || 'default');
        
        initSupabase(
          creds.url || '',
          creds.anonKey || '',
          creds.vault || 'default',
          platform,
          handleRemoteChange,
          handleStatusChange,
          handleConflicts,
          handleDevPathsChange
        );
      } catch (e) {
        console.error('Failed to parse Supabase creds', e);
      }
    } else {
      setIsSettingsModalOpen(true);
    }
  }, []);

  // Auto-close sidebar on screen change on mobile
  useEffect(() => {
    if (window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  }, [activeTab]);

  // TÜRKÇE YORUM (Kural 5):
  // Onboarding: Kasa (vault) tamamen boşsa (ilk açılış), kullanıcıya sistemi
  // canlı örneklerle anlatan bir "Başlangıç" notu otomatik oluşturup açar.
  // localStorage bayrağı sayesinde bu yalnızca bir kez tetiklenir — kullanıcı
  // notu sildikten sonra tekrar dirilmez (RFC şablonundan farklı olarak).
  useEffect(() => {
    if (isBrowser) return; // Web mock'ta onboarding'i atla
    // KRİTİK: notes state'i, gerçek disk okuması bitene kadar geçici olarak boş
    // dizidir. hasCompletedInitialLoadRef kontrolü olmadan bu geçici boşluk
    // "kasa gerçekten boş" sanılıp mevcut, dolu bir kasaya bile onboarding notu
    // yazılabilirdi (yaşanan hata buydu). Bu yüzden en az bir gerçek yükleme
    // tamamlanmadan asla tetiklenmez.
    if (!hasCompletedInitialLoadRef.current) return;
    if (notes.length !== 0) return;
    if (localStorage.getItem('onboarding_completed_v1')) return;

    const onboardingPath = '🚀 Başlangıç/👋 Hoş Geldin.md';
    const onboardingContent = `# 👋 Ultimate NoteFactory'ye Hoş Geldin!

Bu uygulamanın kalbinde yatan fikir basit: **tüm notların düz metin (.md) dosyaları olarak tamamen sana ait olsun.** Hiçbir "bulut kilidi" yok.

## ⚡ Hızlı Yakalama Sözdizimi

Yukarıdaki **Hızlı Not Fabrikası**'na şunu yazıp Enter'a bas, ne olduğunu gör:

\`\`\`
Faturayı öde @Ev #todo [due:2026-08-01] [p:high]
\`\`\`

Bu tek satır otomatik olarak: **Ev** klasörüne giden, **yüksek öncelikli**, **1 Ağustos**'a kadar süresi olan bir **görev** oluşturur.

| Etiket | Ne yapar |
| :--- | :--- |
| \`@klasör\` | Notu o klasöre yönlendirir |
| \`#todo\` | Girdiğini bir Göreve dönüştürür |
| \`[p:high]\` | Öncelik atar (critical/high/medium/low) |
| \`[due:2026-08-01]\` | Bitiş tarihi ekler |

## ✅ Görev Listesi Örneği (bu notta dene!)

- [ ] Bu bir görev — tıklayarak tamamlayabilirsin
- [ ] Bunu tamamlanmış olarak işaretle, üstü çizili görünecek
- [x] Bu zaten tamamlanmış bir görev

## 🔗 Not Bağlantıları

Herhangi bir yerde \`[[Not Adı]]\` yazarsan, o nota bağlantı oluşturur ve **Bağlantılı Notlar** panelinde görünür.

## 📚 Daha Fazlası

Sol menüdeki **Diğer Araçlar → Yardım** bölümünden tam kılavuza ulaşabilirsin. Bu notu silmekten çekinme, sadece bir başlangıç noktası!
`;

    platform.writeNote(onboardingPath, onboardingContent).then(() => {
      localStorage.setItem('onboarding_completed_v1', '1');
      return loadAllData();
    }).then(() => {
      setActiveTab('notes');
      setSelectedFolder('🚀 Başlangıç');
      setActiveNotePath(onboardingPath);
    }).catch(err => {
      console.error('Failed to create onboarding note:', err);
    });
  }, [notes]);

  // TÜRKÇE YORUM (Kural 5):
  // Şablon (template) klasöründeki şablonları denetleyen ve eğer klasör boşsa varsayılan mühendislik planını (RFC) otomatik oluşturan yan etki.
  useEffect(() => {
    if (notes.length === 0) return;
    const prefix = templatesFolder + '/';
    const hasTemplates = notes.some(n => n.path.startsWith(prefix));

    if (!hasTemplates) {
      const defaultTemplatePath = `${templatesFolder}/Mühendislik_Planı_(RFC).md`;
      
      const rfcTemplate = `# 🏗️ RFC: Yeni Plan

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

      if (!isBrowser) {
        platform.writeNote(defaultTemplatePath, rfcTemplate).then(() => {
          handleLocalSave(defaultTemplatePath, rfcTemplate);
          loadAllData();
        }).catch(err => {
          console.error('Failed to create default RFC template:', err);
        });
      } else {
        const newNote = {
          name: 'Mühendislik_Planı_(RFC)',
          path: defaultTemplatePath,
          type: 'note' as const,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        localStorage.setItem(`mock_note_${defaultTemplatePath}`, rfcTemplate);
        mockSaveNotes([...notes, newNote]);
      }
    }
  }, [notes, templatesFolder]);

  // Close context menu on window click
  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => {
      window.removeEventListener('click', handleWindowClick);
    };
  }, []);

  // Dynamically scan all tasks and logs from notes
  const scanTasksFromAllNotes = async (fileList: NoteItem[]): Promise<{ tasks: TimelineItem[]; fileContents: Record<string, string>; alarms: AlarmItem[] }> => {
    const noteFiles = fileList.filter(n => n.type === 'note' && n.path !== 'metadata.json');
    const scanned: TimelineItem[] = [];
    const scannedAlarms: AlarmItem[] = [];
    const fileContents: Record<string, string> = {};

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Bu fonksiyon loadAllData() içinden çok sık çağrılır (her kayıt, odak
    // değişimi, senkron sonrası) ve önceden tüm notları TEK TEK, sırayla
    // okuyordu — büyük bir kasada, özellikle Android'de (her okuma native
    // köprü üzerinden ayrı bir round-trip) bu, hem sayfa geçişlerini hem
    // genel uygulama tepkiselliğini ciddi şekilde yavaşlatan en büyük
    // darboğazlardan biriydi. Dosya okumaları artık PARALEL yapılıyor.
    const fileReadResults = await Promise.all(noteFiles.map(async (note) => {
      try {
        let content = '';
        if (!isBrowser) {
          content = await platform.readNote(note.path);
        } else {
          content = localStorage.getItem(`mock_note_${note.path}`) || '';
        }
        return { note, content, readError: false };
      } catch (err) {
        console.error(`Error reading note ${note.path}:`, err);
        return { note, content: '', readError: true };
      }
    }));

    for (const { note, content, readError } of fileReadResults) {
      if (readError) continue;
      try {
        fileContents[note.path] = content;
        if (!content) continue;

        // Parse note-level tags from the entire file content
        const tagRegexGlobal = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
        const noteLevelTags: string[] = [];
        let noteTagMatch;
        while ((noteTagMatch = tagRegexGlobal.exec(content)) !== null) {
          const t = noteTagMatch[1].toLowerCase();
          if (t !== 'todo' && !noteLevelTags.includes(t)) {
            noteLevelTags.push(t);
          }
        }

        const lines = content.split('\n');
        const parentStack: { indent: number, id: string }[] = [];
        let isInTable = false;

        lines.forEach((line, idx) => {
          if (line === undefined || line === null) return;
          
          const trimmed = line.trim();
          // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          // Tablo başlangıcını algılar ve tablo bitene kadar satırları görev taramasından muaf tutar.
          if (trimmed.toLowerCase().startsWith('tablo:')) {
            isInTable = true;
            return;
          }
          
          if (isInTable) {
            if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.toLowerCase().startsWith('tablo:')) {
              isInTable = false;
            } else {
              return; // Tablo satırlarını atla
            }
          }

          const checklistMatch = line.match(/^(\s*)([*\-]\s+\[([ xX\/])\])\s+(.*)$/);
          const logHeaderMatch = line.match(/^###\s+\[(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\]/);

          if (checklistMatch) {
            const leadingWhitespace = checklistMatch[1];
            const indent = leadingWhitespace.length;
            const mark = checklistMatch[3];
            const isChecked = mark.toLowerCase() === 'x';
            const isInProgress = mark === '/';
            const status = isChecked ? 'done' : (isInProgress ? 'in-progress' : 'todo');
            const rawText = checklistMatch[4];
            const taskId = `task::${note.path}::${idx}`;

            // Pop from stack until top of stack has strictly less indent
            while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
              parentStack.pop();
            }

            let isSubtask = false;
            let parentId = undefined;
            if (parentStack.length > 0) {
              isSubtask = true;
              parentId = parentStack[parentStack.length - 1].id;
            }
            parentStack.push({ indent, id: taskId });

            // Parse tags: #tagname
            const tagRegex = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
            const taskTags: string[] = [];
            let tagMatch;
            while ((tagMatch = tagRegex.exec(rawText)) !== null) {
              taskTags.push(tagMatch[1].toLowerCase());
            }

            const timestampMatch = rawText.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]/);
            const dueMatch = rawText.match(/\[due:(\d{4}-\d{2}-\d{2})\]/);
            const timeSlotMatch = rawText.match(/\[time:(\d{2}:\d{2})-\d{2}:\d{2}\]/);
            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            // Bazı görev satırları tarihi [due:...] etiketiyle değil, doğrudan okunabilir metin
            // olarak yazılmış (örn. "30-06-2026 - Salı Saat: 12:30-13:30"). Bu etiketsiz format
            // hiçbir bracket ile eşleşmediği için tarih tespit edilemiyor ve satır yanlışlıkla
            // notun son kaydedilme tarihine (genelde "bugün") düşüyordu.
            const naturalDateMatch = rawText.match(/(\d{2})-(\d{2})-(\d{4})\s*-\s*\S+\s+Saat:\s*(\d{2}):(\d{2})/i);

            let dateStr = '';
            let timestamp = '';

            if (timestampMatch) {
              dateStr = timestampMatch[1];
              timestamp = timestampMatch[2];
            } else if (dueMatch) {
              dateStr = dueMatch[1];
              if (timeSlotMatch) {
                timestamp = timeSlotMatch[1];
              } else {
                timestamp = '09:00';
              }
            } else if (naturalDateMatch) {
              dateStr = `${naturalDateMatch[3]}-${naturalDateMatch[2]}-${naturalDateMatch[1]}`;
              timestamp = `${naturalDateMatch[4]}:${naturalDateMatch[5]}`;
            } else {
              const noteDate = new Date(note.updatedAt);
              dateStr = format(noteDate, 'yyyy-MM-dd');
              timestamp = format(noteDate, 'HH:mm');
            }

            // Clean display content
            const cleanContent = rawText
              .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
              .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
              .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
              .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
              .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // strip capture timestamp
              .replace(/\s+/g, ' ')
              .trim();

            const parts = note.path.split('/');
            let folder: string | null = null;
            let noteName = '';
            if (parts.length > 1) {
              folder = parts.slice(0, -1).join('/');
              noteName = parts[parts.length - 1].replace('.md', '');
            } else {
              folder = null;
              noteName = parts[0].replace('.md', '');
            }

            const mergedTags = Array.from(new Set([...taskTags, ...noteLevelTags]));

            scanned.push({
              id: taskId,
              content: cleanContent,
              timestamp,
              dateStr,
              isTodo: true,
              isCompleted: isChecked,
              status,
              folder,
              note: noteName,
              tags: mergedTags,
              isSubtask,
              parentId
            });
          } else if (logHeaderMatch) {
            const dateStr = logHeaderMatch[1];
            const timestamp = logHeaderMatch[2] || '12:00';

            let logContent = '';
            let logTags: string[] = [];
            let nextIdx = idx + 1;
            while (nextIdx < lines.length) {
              const nextLine = lines[nextIdx];
              if (!nextLine || nextLine.startsWith('###') || nextLine.startsWith('#') || nextLine.match(/^\s*[*\-]\s+/)) {
                break;
              }
              const trimmed = nextLine.trim();
              if (trimmed) {
                const tagRegex = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
                const lineTags: string[] = [];
                let tagMatch;
                while ((tagMatch = tagRegex.exec(trimmed)) !== null) {
                  lineTags.push(tagMatch[1].toLowerCase());
                }

                const isTagOnly = trimmed.replace(/#[a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+/g, '').trim() === '';
                if (isTagOnly) {
                  logTags = Array.from(new Set([...logTags, ...lineTags]));
                } else {
                  if (logContent) logContent += '\n';
                  logContent += trimmed;
                  logTags = Array.from(new Set([...logTags, ...lineTags]));
                }
              }
              nextIdx++;
            }

            const parts = note.path.split('/');
            let folder: string | null = null;
            let noteName = '';
            if (parts.length > 1) {
              folder = parts.slice(0, -1).join('/');
              noteName = parts[parts.length - 1].replace('.md', '');
            } else {
              folder = null;
              noteName = parts[0].replace('.md', '');
            }

            const mergedTags = Array.from(new Set([...logTags, ...noteLevelTags]));

            scanned.push({
              id: `log::${note.path}::${idx}`,
              content: logContent.trim(),
              timestamp,
              dateStr,
              isTodo: false,
              isCompleted: false,
              folder,
              note: noteName,
              tags: mergedTags
            });
            if (line.trim().length > 0 && !line.match(/^\s*[*\-]\s+/)) {
              parentStack.length = 0;
            }
          }

          // Check for alarm HH:MM pattern
          const alarmMatch = line.match(/alarm\s+(\d{2}:\d{2})/i);
          if (alarmMatch) {
            const timeStr = alarmMatch[1];
            const dateInPath = note.path.match(/(\d{4})-(\d{2})-(\d{2})/);
            let dateStr = '';
            if (dateInPath) {
              dateStr = dateInPath[0];
            } else {
              const now = new Date();
              const [h, m] = timeStr.split(':').map(Number);
              const alarmToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
              if (alarmToday.getTime() <= now.getTime()) {
                const tomorrow = new Date(now);
                tomorrow.setDate(now.getDate() + 1);
                dateStr = format(tomorrow, 'yyyy-MM-dd');
              } else {
                dateStr = format(now, 'yyyy-MM-dd');
              }
            }

            scannedAlarms.push({
              id: `alarm::${note.path}::${idx}`,
              timeStr,
              dateStr,
              notePath: note.path,
              noteName: note.path.split('/').pop()?.replace('.md', '') || '',
              lineIdx: idx
            });
          }
        });
      } catch (err) {
        console.error(`Error scanning tasks for note ${note.path}:`, err);
      }
    }

    return { tasks: scanned, fileContents, alarms: scannedAlarms };
  };

  const getTimelineItemPath = (item: TimelineItem): string => {
    if (item.id.startsWith('note::')) {
      return item.id.substring(6);
    }
    if (item.id.startsWith('task::') || item.id.startsWith('log::')) {
      const parts = item.id.split('::');
      return parts[1];
    }
    if (item.folder && item.note) {
      const filename = `${item.note.replace(/\s+/g, '_')}.md`;
      return `${item.folder}/${filename}`;
    } else if (item.folder) {
      return `${item.folder}/inbox.md`;
    } else if (item.note) {
      const filename = `${item.note.replace(/\s+/g, '_')}.md`;
      return filename;
    } else {
      return 'inbox.md';
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Klasik LCS tabanlı satır-satır diff — iki metin arasında hangi satırların aynı kaldığını,
  // hangilerinin çıkarıldığını (remove) ve hangilerinin eklendiğini (add) hesaplar.
  const diffLines = (oldText: string, newText: string): Array<{ type: 'same' | 'add' | 'remove'; text: string }> => {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const result: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (oldLines[i] === newLines[j]) {
        result.push({ type: 'same', text: oldLines[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({ type: 'remove', text: oldLines[i] });
        i++;
      } else {
        result.push({ type: 'add', text: newLines[j] });
        j++;
      }
    }
    while (i < m) { result.push({ type: 'remove', text: oldLines[i] }); i++; }
    while (j < n) { result.push({ type: 'add', text: newLines[j] }); j++; }
    return result;
  };

  // Bir Zaman Akışı kaydına ait notun .versions geçmişini okuyup, her kayıt anı için
  // (önceki içerik -> sonraki içerik) çiftlerini en yeniden en eskiye sıralı döndürür.
  const handleViewNoteHistory = async (item: TimelineItem) => {
    const path = getTimelineItemPath(item);
    setHistoryModalItem(item);
    setIsHistoryLoading(true);
    try {
      let snapshots: Array<{ timestamp: number; content: string }> = [];
      try {
        const raw = await platform.readNote(`.versions/${path}.json`);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) snapshots = parsed;
      } catch (_e) {
        // Geçmiş dosyası yok — bu not hiç düzenlenmemiş olabilir.
      }
      const currentContent = fileContents[path] ?? '';
      const pairs: Array<{ timestamp: number; before: string; after: string }> = snapshots.map((snap, idx) => ({
        timestamp: snap.timestamp,
        before: snap.content,
        after: idx + 1 < snapshots.length ? snapshots[idx + 1].content : currentContent
      }));
      setHistoryEntries(pairs.reverse());
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleOpenTimelineNote = (item: TimelineItem) => {
    const path = getTimelineItemPath(item);
    handleSetActiveNotePath(path);
    setActiveTab('notes');
  };

  const hasCompletedInitialLoadRef = useRef(false);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // PERFORMANS: Her otomatik kaydetmede tüm çalışma alanını anında yeniden
  // taramak (loadAllData), kullanıcı yazmaya devam ederken ana iş parçacığını
  // kilitliyordu — "duraksadım, devam ettim, dondu" hissinin ana kaynağı.
  // scheduleWorkspaceScan taramayı 5 sn erteler ve her yeni kayıtta sayacı
  // sıfırlar: yazma seansı sürerken tam tarama HİÇ çalışmaz, kullanıcı
  // gerçekten işini bitirip bıraktığında bir kez çalışır.
  const pendingScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleWorkspaceScan = () => {
    if (pendingScanTimerRef.current) clearTimeout(pendingScanTimerRef.current);
    pendingScanTimerRef.current = setTimeout(() => {
      pendingScanTimerRef.current = null;
      loadAllData();
    }, 5000);
  };

  const loadAllData = async () => {
    let loadedNotes: NoteItem[] | null = null;
    if (!isBrowser) {
      try {
        // Load files list
        const fileList = await platform.listFiles();
        const filteredList = fileList.filter(f => f.path !== 'music_library.md');
        setNotes(filteredList);
        loadedNotes = filteredList;
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // "notes" state'i ilk render'da (gerçek disk okuması tamamlanmadan önce) hâlâ
        // boş dizi olduğundan, "kasa boş mu?" kontrolü yapan kodların (ör. onboarding)
        // bu geçici boş durumu "gerçekten boş kasa" sanmaması için, en az bir kez
        // gerçek bir dosya listesi okunduğunu bu ref ile işaretliyoruz.
        hasCompletedInitialLoadRef.current = true;

        // Extract folder list and sort alphabetically (excluding media assets)
        const folderList = Array.from(new Set(
          filteredList
            .filter(f => f.type === 'folder' && f.path !== 'media' && !f.path.startsWith('media/'))
            .map(f => f.path)
        )).sort();
        setFolders(folderList);

        // Load index/metadata from root notes directory (if it exists)
        // We will store timeline logs and tasks inside metadata.json for high speed
        let metadataObj = { timeline: [], recent: [], tags: [], folderCustomizations: {} };
        try {
          const rawMeta = await platform.readNote('metadata.json');
          if (rawMeta) {
            metadataObj = JSON.parse(rawMeta);
          }
        } catch (e) {
          // metadata.json might not exist yet, that's fine
        }
        setFolderCustomizations(metadataObj.folderCustomizations || {});
        setMindmapLayouts((metadataObj as any).mindmapLayouts || {});

        const rawTimeline: TimelineItem[] = metadataObj.timeline || [];
        const { tasks: scannedTasks, fileContents: scannedContents, alarms: scannedAlarms } = await scanTasksFromAllNotes(filteredList);
        setFileContents(scannedContents);
        
        const activeNotePaths = new Set(fileList.filter(n => n.type === 'note').map(n => n.path));
        const filteredRawTimeline = rawTimeline.filter(item => {
          const itemPath = getTimelineItemPath(item);
          if (!activeNotePaths.has(itemPath)) return false;
          
          const fileContent = scannedContents[itemPath];
          if (!fileContent) return false;
          
          return item.content && fileContent.includes(item.content.trim());
        });

        const didHeal = filteredRawTimeline.length !== rawTimeline.length;
        if (didHeal) {
          await saveMetadata(filteredRawTimeline, metadataObj.recent || [], metadataObj.tags || []);
        }

        const mergedTimeline = [...filteredRawTimeline];
        const scannedTimelineItems: TimelineItem[] = [];

        for (const scanned of scannedTasks) {
          let matched = false;
          for (let i = 0; i < mergedTimeline.length; i++) {
            const item = mergedTimeline[i];
            const normItemNote = (item.note || 'inbox').toLowerCase().replace('.md', '');
            const normScannedNote = (scanned.note || 'inbox').toLowerCase().replace('.md', '');
            const normItemFolder = (item.folder || '').toLowerCase();
            const normScannedFolder = (scanned.folder || '').toLowerCase();
            const sameLocation = normItemNote === normScannedNote && normItemFolder === normScannedFolder;
            const sameDateTime = item.dateStr === scanned.dateStr && item.timestamp === scanned.timestamp;

            const bothTodo = item.isTodo && scanned.isTodo;
            const bothLog = !item.isTodo && !scanned.isTodo;

            if (
              (bothTodo || bothLog) &&
              item.content &&
              scanned.content &&
              item.content.trim() === scanned.content.trim() &&
              (sameDateTime || sameLocation)
            ) {
              mergedTimeline[i] = {
                ...item,
                isCompleted: scanned.isCompleted,
                folder: scanned.folder,
                note: scanned.note,
                tags: scanned.tags
              };
              matched = true;
              break;
            }
          }

          if (!matched) {
            scannedTimelineItems.push(scanned);
          }
        }

        const noteFilesOnly = fileList.filter(n => n.type === 'note' && n.path !== 'metadata.json');
        
        const fileTimelineItems: TimelineItem[] = noteFilesOnly.map(note => {
          const parts = note.path.split('/');
          let folder: string | null = null;
          if (parts.length > 1) {
            folder = parts.slice(0, -1).join('/');
          }
          
          const noteDate = new Date(note.createdAt || note.updatedAt);
          const dateStr = format(noteDate, 'yyyy-MM-dd');
          const timestamp = format(noteDate, 'HH:mm');
          
          const fileContent = scannedContents[note.path] || '';
          const tagRegex = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
          const noteTags: string[] = [];
          let tagMatch;
          while ((tagMatch = tagRegex.exec(fileContent)) !== null) {
            noteTags.push(tagMatch[1].toLowerCase());
          }
          
          // Extract the clean H1 title from the first line if it exists
          const firstLine = fileContent.split('\n')[0] || '';
          let displayName = note.name;
          if (firstLine.trim().startsWith('# ')) {
            displayName = firstLine.trim().substring(2).trim();
          }
          
          return {
            id: `note::${note.path}`,
            content: displayName,
            timestamp,
            dateStr,
            isTodo: false,
            isCompleted: false,
            folder,
            note: null,
            tags: Array.from(new Set(noteTags))
          };
        });

        const finalTimeline = [...mergedTimeline, ...scannedTimelineItems, ...fileTimelineItems];
        finalTimeline.sort((a, b) => {
          const dateTimeA = `${a.dateStr}T${a.timestamp}`;
          const dateTimeB = `${b.dateStr}T${b.timestamp}`;
          return dateTimeB.localeCompare(dateTimeA);
        });

        setTimelineItems(finalTimeline);
        setRecentInputs(metadataObj.recent || []);
        setTags(metadataObj.tags || []);
        scheduleNotificationsForTasks(finalTimeline, scannedAlarms);
      } catch (err) {
        console.error('Electron data load error:', err);
      }
    } else {
      // LocalStorage Fallback (Browser testing)
      const cachedNotes = localStorage.getItem('notes_db') || '[]';
      const cachedMeta = localStorage.getItem('notes_meta') || '{"timeline":[],"recent":[],"tags":[]}';
      
      const parsedNotes = JSON.parse(cachedNotes);
      const parsedMeta = JSON.parse(cachedMeta);
      setFolderCustomizations(parsedMeta.folderCustomizations || {});

      setNotes(parsedNotes);
      loadedNotes = parsedNotes;
      const folderList = Array.from(new Set<string>(
        parsedNotes
          .filter((f: any) => f.type === 'folder' && f.path !== 'media' && !f.path.startsWith('media/'))
          .map((f: any) => f.path || f.name)
      )).sort();
      setFolders(folderList);
      
      const rawTimeline: TimelineItem[] = parsedMeta.timeline || [];
      const { tasks: scannedTasks, fileContents: scannedContents, alarms: scannedAlarms } = await scanTasksFromAllNotes(parsedNotes);
      setFileContents(scannedContents);
      
      const activeNotePaths = new Set(parsedNotes.filter((n: any) => n.type === 'note').map((n: any) => n.path));
      const filteredRawTimeline = rawTimeline.filter(item => {
        const itemPath = getTimelineItemPath(item);
        if (!activeNotePaths.has(itemPath)) return false;
        
        const fileContent = scannedContents[itemPath];
        if (!fileContent) return false;
        
        return item.content && fileContent.includes(item.content.trim());
      });

      const didHeal = filteredRawTimeline.length !== rawTimeline.length;
      if (didHeal) {
        saveMetadata(filteredRawTimeline, parsedMeta.recent || [], parsedMeta.tags || []);
      }

      const mergedTimeline = [...filteredRawTimeline];
      const scannedTimelineItems: TimelineItem[] = [];

      for (const scanned of scannedTasks) {
        let matched = false;
        for (let i = 0; i < mergedTimeline.length; i++) {
          const item = mergedTimeline[i];
          const normItemNote = (item.note || 'inbox').toLowerCase().replace('.md', '');
          const normScannedNote = (scanned.note || 'inbox').toLowerCase().replace('.md', '');
          const normItemFolder = (item.folder || '').toLowerCase();
          const normScannedFolder = (scanned.folder || '').toLowerCase();
          const sameLocation = normItemNote === normScannedNote && normItemFolder === normScannedFolder;
          const sameDateTime = item.dateStr === scanned.dateStr && item.timestamp === scanned.timestamp;

          const bothTodo = item.isTodo && scanned.isTodo;
          const bothLog = !item.isTodo && !scanned.isTodo;

          if (
            (bothTodo || bothLog) &&
            item.content &&
            scanned.content &&
            item.content.trim() === scanned.content.trim() &&
            (sameDateTime || sameLocation)
          ) {
            mergedTimeline[i] = {
              ...item,
              isCompleted: scanned.isCompleted,
              folder: scanned.folder,
              note: scanned.note,
              tags: scanned.tags
            };
            matched = true;
            break;
          }
        }

        if (!matched) {
          scannedTimelineItems.push(scanned);
        }
      }

      const noteFilesOnly = parsedNotes.filter((n: any) => n.type === 'note' && n.path !== 'metadata.json');
      
      const fileTimelineItems: TimelineItem[] = noteFilesOnly.map((note: any) => {
        const parts = note.path.split('/');
        let folder: string | null = null;
        if (parts.length > 1) {
          folder = parts.slice(0, -1).join('/');
        }
        
        const noteDate = new Date(note.createdAt || note.updatedAt);
        const dateStr = format(noteDate, 'yyyy-MM-dd');
        const timestamp = format(noteDate, 'HH:mm');
        
        const fileContent = scannedContents[note.path] || '';
        const tagRegex = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
        const noteTags: string[] = [];
        let tagMatch;
        while ((tagMatch = tagRegex.exec(fileContent)) !== null) {
          noteTags.push(tagMatch[1].toLowerCase());
        }
        
        // Extract the clean H1 title from the first line if it exists
        const firstLine = fileContent.split('\n')[0] || '';
        let displayName = note.name || note.path.split('/').pop().replace('.md', '');
        if (firstLine.trim().startsWith('# ')) {
          displayName = firstLine.trim().substring(2).trim();
        }
        
        return {
          id: `note::${note.path}`,
          content: displayName,
          timestamp,
          dateStr,
          isTodo: false,
          isCompleted: false,
          folder,
          note: null,
          tags: Array.from(new Set(noteTags))
        };
      });

      const finalTimeline = [...mergedTimeline, ...scannedTimelineItems, ...fileTimelineItems];
      finalTimeline.sort((a, b) => {
        const dateTimeA = `${a.dateStr}T${a.timestamp}`;
        const dateTimeB = `${b.dateStr}T${b.timestamp}`;
        return dateTimeB.localeCompare(dateTimeA);
      });

      setTimelineItems(finalTimeline);
      setRecentInputs(parsedMeta.recent || []);
      setTags(parsedMeta.tags || []);
      scheduleNotificationsForTasks(finalTimeline, scannedAlarms);
    }

    if (loadedNotes !== null) {
      const validLists = pinnedWidgetLists.filter(path => 
        loadedNotes!.some(n => n.path === path && n.type !== 'folder')
      );
      if (validLists.length !== pinnedWidgetLists.length) {
        let newActive = pinnedWidgetList;
        if (validLists.length === 0) {
          newActive = null;
        } else if (pinnedWidgetList && !validLists.includes(pinnedWidgetList)) {
          newActive = validLists[validLists.length - 1];
        }
        await updatePinnedWidgets(validLists, newActive);
      }
    }
  };

  // Load all data on initial component mount
  useEffect(() => {
    loadAllData();
  }, []);

  // Listen for global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // If user is inside an input or textarea, we shouldn't trigger shortcuts unless it's Ctrl or Alt modified
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true');
      
      const matches = (s: ShortcutKey) => {
        return e.key.toLowerCase() === s.key.toLowerCase() &&
               e.ctrlKey === s.ctrlKey &&
               e.altKey === s.altKey &&
               e.shiftKey === s.shiftKey &&
               e.metaKey === s.metaKey;
      };

      const openBrowserMatch = matches(shortcuts.openBrowser.shortcut);
      const openHelpMatch = matches(shortcuts.openHelp.shortcut);
      const toggleSidebarMatch = matches(shortcuts.toggleSidebar.shortcut);
      const newNoteMatch = matches(shortcuts.newNote.shortcut);
      const goQuickAddMatch = matches(shortcuts.goQuickAdd.shortcut);
      const goCalendarMatch = matches(shortcuts.goCalendar.shortcut);
      const goNotesMatch = matches(shortcuts.goNotes.shortcut);
      const globalSearchMatch = matches(shortcuts.globalSearch.shortcut);

      if (openBrowserMatch) {
        e.preventDefault();
        setActiveTab('browser');
      } else if (openHelpMatch) {
        e.preventDefault();
        setIsHelpModalOpen(true);
      } else if (toggleSidebarMatch) {
        e.preventDefault();
        setIsSidebarOpen(prev => !prev);
      } else if (newNoteMatch) {
        e.preventDefault();
        const name = prompt("Yeni notun adı:");
        if (name && name.trim()) {
          handleCreateNote(name.trim(), selectedFolder);
        }
      } else if (goQuickAddMatch) {
        e.preventDefault();
        setActiveTab('notfactory');
      } else if (goCalendarMatch) {
        e.preventDefault();
        setActiveTab('calendar');
      } else if (goNotesMatch) {
        e.preventDefault();
        setSelectedFolder(null);
        setSelectedTag(null);
      } else if (globalSearchMatch) {
        e.preventDefault();
        setIsGlobalSearchOpen(prev => !prev);
        setGlobalSearchQuery('');
        setSearchSelectedIndex(0);
        setActiveTab('notes');
      } else {
        // Üst başlık çubuğuna taşınan gezinme öğeleri için kısayol eşleşmesi
        for (const [shortcutId, tabId] of Object.entries(NAV_SHORTCUT_TARGETS)) {
          const item = shortcuts[shortcutId];
          if (item && matches(item.shortcut)) {
            e.preventDefault();
            setActiveTab(tabId);
            setSelectedFolder(null);
            setSelectedTag(null);
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [shortcuts, selectedFolder, handleCreateNote]);

  // Handle shortcut recording key listener
  useEffect(() => {
    if (!recordingShortcutKey) return;

    const handleRecordKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingShortcutKey(null);
        return;
      }

      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
      }

      const newShortcut: ShortcutKey = {
        key: e.key.toLowerCase(),
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      };

      setShortcuts(prev => {
        const updated = {
          ...prev,
          [recordingShortcutKey]: {
            ...prev[recordingShortcutKey],
            shortcut: newShortcut
          }
        };
        localStorage.setItem('desktop_shortcuts', JSON.stringify(updated));
        return updated;
      });

      setRecordingShortcutKey(null);
    };

    window.addEventListener('keydown', handleRecordKeyDown, true);
    return () => window.removeEventListener('keydown', handleRecordKeyDown, true);
  }, [recordingShortcutKey]);

  const formatShortcut = (s: ShortcutKey) => {
    const parts: string[] = [];
    if (s.ctrlKey) parts.push('Ctrl');
    if (s.altKey) parts.push('Alt');
    if (s.shiftKey) parts.push('Shift');
    if (s.metaKey) parts.push('Win/Cmd');
    if (s.key) {
      if (s.key === ' ') parts.push('Space');
      else parts.push(s.key.toUpperCase());
    }
    return parts.length > 0 ? parts.join(' + ') : 'Atanmamış';
  };

  // Sync session state to localStorage to prevent data loss across refreshes & HMR
  useEffect(() => {
    localStorage.setItem('active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedFolder) {
      localStorage.setItem('selected_folder', selectedFolder);
    } else {
      localStorage.removeItem('selected_folder');
    }
  }, [selectedFolder]);

  useEffect(() => {
    if (selectedTag) {
      localStorage.setItem('selected_tag', selectedTag);
    } else {
      localStorage.removeItem('selected_tag');
    }
  }, [selectedTag]);

  useEffect(() => {
    if (activeNotePath) {
      localStorage.setItem('active_note_path', activeNotePath);
    } else {
      localStorage.removeItem('active_note_path');
    }
  }, [activeNotePath]);

  // Helper to Save Metadata
  const saveMetadata = async (newTimeline: TimelineItem[], newRecent: any[], newTags: string[], newCustomizations?: any, newMindmapLayouts?: any) => {
    const cleanTimeline = newTimeline.filter(item => !item.id.startsWith('task::'));

    const metaObj = {
      timeline: cleanTimeline,
      recent: newRecent,
      tags: newTags,
      folderCustomizations: newCustomizations !== undefined ? newCustomizations : folderCustomizations,
      mindmapLayouts: newMindmapLayouts !== undefined ? newMindmapLayouts : mindmapLayouts
    };
    if (!isBrowser) {
      await platform.writeNote('metadata.json', JSON.stringify(metaObj, null, 2));
    } else {
      localStorage.setItem('notes_meta', JSON.stringify(metaObj));
    }
  };

  // Helper to Save Notes DB representation (Only needed in Web Mock)
  const mockSaveNotes = (updatedNotes: NoteItem[]) => {
    if (isBrowser) {
      localStorage.setItem('notes_db', JSON.stringify(updatedNotes));
      setNotes(updatedNotes);
      const folderList = Array.from(new Set(
        updatedNotes
          .filter(f => f.type === 'folder' && f.path !== 'media' && !f.path.startsWith('media/'))
          .map(f => f.path || f.name)
      )).sort();
      setFolders(folderList);
    }
  };

  // 1. Create Folder Modal Handlers
  const handleCreateFolder = () => {
    setNewFolderName('');
    setParentFolder('');
    setIsFolderModalOpen(true);
  };

  const handleConfirmCreateFolder = async () => {
    if (!newFolderName || !newFolderName.trim()) return;
    const cleanName = newFolderName.trim();
    
    // Combine with parent folder path if selected
    const relativePath = parentFolder ? `${parentFolder}/${cleanName}` : cleanName;
    
    setIsFolderModalOpen(false);
    setNewFolderName('');
    setParentFolder('');

    if (!isBrowser) {
      const res = await platform.createFolder(relativePath);
      if (res.success) {
        // Klasörü hemen Supabase'e de yansıt — bir sonraki tam senkron döngüsünü beklemeden.
        uploadFolderDirect(relativePath);
        await loadAllData();
      } else {
        alert(res.error || 'Klasör oluşturulamadı');
      }
    } else {
      // Web Mock
      if (folders.includes(relativePath)) {
        alert('Klasör zaten mevcut');
        return;
      }
      const newFolder: NoteItem = {
        name: cleanName,
        path: relativePath,
        type: 'folder',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const updated = [...notes, newFolder];
      mockSaveNotes(updated);
    }
  };

  // 2. Create Note / Drawing / RFC Plan
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // isExcalidraw parametresi geriye dönük uyumluluk için boolean kalır; 'drawio'
  // değeri geçilirse draw.io (diagrams.net) diyagram dosyası (.drawio) oluşturulur.
  async function handleCreateNote(name: string, folder: string | null, isExcalidraw: boolean | 'drawio' = false, initialContent: string = '', switchActiveNote: boolean = true) {
    const isDrawio = isExcalidraw === 'drawio';
    const ext = isDrawio ? '.drawio' : (isExcalidraw ? '.excalidraw' : '.md');
    const filename = `${name.replace(/\s+/g, '_')}${ext}`;
    const relativePath = folder ? `${folder}/${filename}` : filename;

    const excalidrawEmptyContent = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [],
      appState: {
        theme: "dark",
        viewBackgroundColor: "#121212"
      },
      files: {}
    });

    if (!isBrowser) {
      let header = '';
      if (isDrawio) {
        // Boş draw.io diyagramı: embed editörü boş XML ile açılır, ilk kayıtta doldurur.
        header = '';
      } else if (isExcalidraw) {
        header = excalidrawEmptyContent;
      } else if (initialContent) {
        header = initialContent;
      } else {
        header = `# ${name}\n\nOluşturuldu: ${new Date().toLocaleString('tr-TR')}\n\n`;
      }
      await platform.writeNote(relativePath, header);
      handleLocalSave(relativePath, header);
      await loadAllData();
      if (switchActiveNote) {
        handleSetActiveNotePath(relativePath);
      }
    } else {
      // Web Mock
      const newNote: NoteItem = {
        name,
        path: relativePath,
        type: isDrawio ? 'drawio' : (isExcalidraw ? 'excalidraw' : 'note'),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const updated = [...notes, newNote];
      mockSaveNotes(updated);
      const content = isDrawio ? '' : (isExcalidraw ? excalidrawEmptyContent : (initialContent || `# ${name}\n\n`));
      localStorage.setItem(`mock_note_${relativePath}`, content);
      if (switchActiveNote) {
        handleSetActiveNotePath(relativePath);
      }
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Zihin haritası düğüm koordinatları ve özel yüzen öğeleri metadata.json dosyasına kaydeden işlev.
  const handleSaveMindmapLayout = async (path: string, coords: any, customs: any[]) => {
    const updatedLayouts = {
      ...mindmapLayouts,
      [path]: { coords, customs }
    };
    setMindmapLayouts(updatedLayouts);
    await saveMetadata(timelineItems, recentInputs, tags, folderCustomizations, updatedLayouts);
  };

  // Helper to sync timeline items from a saved Markdown file's content
  const syncTimelineFromMarkdown = (path: string, content: string, currentTimeline: TimelineItem[]): TimelineItem[] => {
    const lines = content.split('\n');
    let updatedTimeline = [...currentTimeline];
    let changed = false;

    lines.forEach(line => {
      const checklistMatch = line.match(/^(\s*[*\-]\s+\[([ xX\/])\])\s+(.*)$/);
      if (checklistMatch) {
        const mark = checklistMatch[2];
        const isChecked = mark.toLowerCase() === 'x';
        const isInProgress = mark === '/';
        const newStatus = isChecked ? 'done' : (isInProgress ? 'in-progress' : 'todo');
        const rawText = checklistMatch[3];

        // Match standard inbox timestamp format: [YYYY-MM-DD HH:mm]
        const timestampMatch = rawText.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]/);
        if (timestampMatch) {
          const dateStr = timestampMatch[1];
          const timestamp = timestampMatch[2];

          // Clean display content to match the stored timeline item content
          const cleanContent = rawText
            .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
            .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
            .replace(/\[start:\d{4}-\d{2}-\d{2}\]/gi, '')
            .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
            .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
            .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // strip capture timestamp
            .replace(/\s+/g, ' ')
            .trim();

          // Find matching timeline item
          updatedTimeline = updatedTimeline.map(item => {
            if (
              item.isTodo &&
              item.dateStr === dateStr &&
              item.timestamp === timestamp &&
              item.content.trim() === cleanContent
            ) {
              if (item.isCompleted !== isChecked || item.status !== newStatus) {
                changed = true;
                return { ...item, isCompleted: isChecked, status: newStatus };
              }
            }
            return item;
          });
        }
      }
    });

    return changed ? updatedTimeline : currentTimeline;
  };

  // 3. Save Note Content
  const handleSaveNote = async (path: string, content: string) => {
    if (!isBrowser) {
      // Sürüm Geçmişi (Version History): içerik gerçekten değiştiyse, üzerine
      // yazılmadan önceki hâli `.versions/<yol>.json` altında JSON anlık
      // görüntü olarak sakla. Nokta ile başlayan bu klasör hem masaüstü hem
      // mobil dosya listelemesinde otomatik olarak gizlenir (bkz. platform.ts,
      // electron/main.cjs), dolayısıyla not listesinde görünmez.
      const previousContent = fileContents[path];
      if (previousContent !== undefined && previousContent !== content) {
        try {
          const historyPath = `.versions/${path}.json`;
          let history: { timestamp: number; content: string }[] = [];
          try {
            const raw = await platform.readNote(historyPath);
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) history = parsed;
          } catch (_e) {
            // Geçmiş dosyası yok ya da bozuk; boş geçmişle devam et.
          }
          history.push({ timestamp: Date.now(), content: previousContent });
          if (history.length > MAX_NOTE_VERSIONS) {
            history = history.slice(history.length - MAX_NOTE_VERSIONS);
          }
          await platform.writeNote(historyPath, JSON.stringify(history));
        } catch (e) {
          console.error('Sürüm geçmişi kaydedilemedi:', e);
        }
      }

      await platform.writeNote(path, content);
      handleLocalSave(path, content);
      
      const updatedTimeline = syncTimelineFromMarkdown(path, content, timelineItems);
      if (updatedTimeline !== timelineItems) {
        setTimelineItems(updatedTimeline);
        await saveMetadata(updatedTimeline, recentInputs, tags);
      }

      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Tam tarama yerine: kaydedilen notun içeriğini hedefli güncelle (sürüm
      // geçmişi diff'i ve bu nota bağlı görünümler için yeterli) ve tam
      // çalışma alanı taramasını ertelenmiş/debounce'lu olarak planla.
      setFileContents(prev => ({ ...prev, [path]: content }));
      scheduleWorkspaceScan();
    } else {
      // Web Mock
      localStorage.setItem(`mock_note_${path}`, content);
      const updated = notes.map(n => n.path === path ? { ...n, updatedAt: Date.now() } : n);
      mockSaveNotes(updated);

      const updatedTimeline = syncTimelineFromMarkdown(path, content, timelineItems);
      if (updatedTimeline !== timelineItems) {
        setTimelineItems(updatedTimeline);
        saveMetadata(updatedTimeline, recentInputs, tags);
      }
    }
  };

  // 4. Delete Path
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Yerel çöp kutusu: silinen notun son içeriği tek bir JSON indeksinde saklanır ki
  // Supabase kullanmayan (yerel kayıt modundaki) kullanıcılar da yanlışlıkla sildiği
  // notu geri getirebilsin. Ayarlar > Çöp Kutusu ekranından okunup geri yazılır.
  const TRASH_INDEX_PATH = '.trash/index.json';

  const readLocalTrash = async (): Promise<Array<{ id: string; originalPath: string; name: string; content: string; deletedAt: number }>> => {
    try {
      const raw = await platform.readNote(TRASH_INDEX_PATH);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  };

  const addToLocalTrash = async (path: string) => {
    try {
      const content = fileContents[path] ?? await platform.readNote(path);
      const trash = await readLocalTrash();
      trash.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        originalPath: path,
        name: path.split('/').pop() || path,
        content,
        deletedAt: Date.now()
      });
      await platform.writeNote(TRASH_INDEX_PATH, JSON.stringify(trash));
    } catch (e) {
      console.error('Not çöp kutusuna taşınamadı:', e);
    }
  };

  // Çöp Kutusu sekmesi açıldığında hem yerel hem (varsa) Supabase'deki silinmiş notları yükler.
  const loadTrashData = async () => {
    setIsTrashLoading(true);
    try {
      const local = await readLocalTrash();
      // BUG DÜZELTMESİ: Kullanıcı aynı yolda sonradan YENİ bir not oluşturursa (ya da eski
      // dosya bir şekilde geri gelirse), o yol için eski çöp kutusu kaydı kalıcı olarak
      // "silinmiş" gibi görünmeye devam ediyordu — oysa dosya CANLI ve kullanımda. Bu hem
      // kafa karıştırıcı hem de riskli (o kayıtta yanlışlıkla "Geri Getir"e basılırsa canlı
      // dosyanın üzerine eski içerik yazılabilir). Orijinal yolu hâlâ canlı bir not olarak
      // duran kayıtları listeden çıkarıp indeksten de temizliyoruz.
      const livePaths = new Set(notes.filter(n => n.type !== 'folder').map(n => n.path));
      const staleIdSet = new Set(local.filter(e => livePaths.has(e.originalPath)).map(e => e.id));
      let effectiveLocal = local;
      if (staleIdSet.size > 0) {
        effectiveLocal = local.filter(e => !staleIdSet.has(e.id));
        await platform.writeNote(TRASH_INDEX_PATH, JSON.stringify(effectiveLocal));
      }
      setLocalTrashEntries(effectiveLocal.slice().sort((a, b) => b.deletedAt - a.deletedAt));
      const remote = await fetchDeletedNotes();
      // Yerelde zaten bir çöp kutusu kaydı olan yollar uzak listede tekrar gösterilmesin;
      // yolu hâlâ canlı bir not olarak duranlar da (yukarıdaki gibi) gösterilmesin.
      const localPaths = new Set(effectiveLocal.map(e => e.originalPath));
      setRemoteTrashEntries(remote.filter(r => !localPaths.has(r.path) && !livePaths.has(r.path)));
    } finally {
      setIsTrashLoading(false);
    }
  };

  const handleRestoreLocalTrash = async (entry: { id: string; originalPath: string; content: string }) => {
    await platform.writeNote(entry.originalPath, entry.content);
    handleLocalSave(entry.originalPath, entry.content);
    const trash = await readLocalTrash();
    await platform.writeNote(TRASH_INDEX_PATH, JSON.stringify(trash.filter(e => e.id !== entry.id)));
    await loadAllData();
    await loadTrashData();
  };

  const handlePermanentlyDeleteLocalTrash = async (id: string) => {
    const trash = await readLocalTrash();
    await platform.writeNote(TRASH_INDEX_PATH, JSON.stringify(trash.filter(e => e.id !== id)));
    await loadTrashData();
  };

  const handleRestoreRemoteTrash = async (entry: { path: string; content: string }) => {
    await platform.writeNote(entry.path, entry.content);
    const res = await restoreRemoteNote(entry.path);
    if (!res.success) {
      console.error('Uzak not geri getirilemedi:', res.error);
    }
    await loadAllData();
    await loadTrashData();
  };

  const handlePermanentlyDeleteRemoteTrash = async (path: string) => {
    const res = await permanentlyDeleteRemoteNote(path);
    if (!res.success) {
      console.error('Uzak not kalıcı olarak silinemedi:', res.error);
    }
    await loadTrashData();
  };

  const toggleTrashSelection = (key: string) => {
    setSelectedTrashKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Tek tek "Kalıcı Sil"e basmak yerine işaretlenen (yerel + uzak) öğeleri TEK seferde
  // siler — yerel .trash/index.json'ı bir kez okuyup bir kez yazar (her öğe için ayrı
  // ayrı okuyup yazmak yerine), uzak notları ise sırayla siler.
  const handleBulkDeleteTrash = async () => {
    const localIds = localTrashEntries.filter(e => selectedTrashKeys.has(`local:${e.id}`)).map(e => e.id);
    const remotePaths = remoteTrashEntries.filter(e => selectedTrashKeys.has(`remote:${e.path}`)).map(e => e.path);
    const total = localIds.length + remotePaths.length;
    if (total === 0) return;
    requestConfirm(`${total} öğe kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`, async () => {
      if (localIds.length > 0) {
        const idSet = new Set(localIds);
        const trash = await readLocalTrash();
        await platform.writeNote(TRASH_INDEX_PATH, JSON.stringify(trash.filter(e => !idSet.has(e.id))));
      }
      for (const path of remotePaths) {
        const res = await permanentlyDeleteRemoteNote(path);
        if (!res.success) {
          console.error('Uzak not kalıcı olarak silinemedi:', path, res.error);
        }
      }
      setSelectedTrashKeys(new Set());
      await loadTrashData();
    });
  };

  const handleBulkRestoreTrash = async () => {
    const localEntries = localTrashEntries.filter(e => selectedTrashKeys.has(`local:${e.id}`));
    const remoteEntries = remoteTrashEntries.filter(e => selectedTrashKeys.has(`remote:${e.path}`));
    if (localEntries.length === 0 && remoteEntries.length === 0) return;

    for (const entry of localEntries) {
      await platform.writeNote(entry.originalPath, entry.content);
      handleLocalSave(entry.originalPath, entry.content);
    }
    if (localEntries.length > 0) {
      const idSet = new Set(localEntries.map(e => e.id));
      const trash = await readLocalTrash();
      await platform.writeNote(TRASH_INDEX_PATH, JSON.stringify(trash.filter(e => !idSet.has(e.id))));
    }
    for (const entry of remoteEntries) {
      await platform.writeNote(entry.path, entry.content);
      const res = await restoreRemoteNote(entry.path);
      if (!res.success) {
        console.error('Uzak not geri getirilemedi:', entry.path, res.error);
      }
    }
    setSelectedTrashKeys(new Set());
    await loadAllData();
    await loadTrashData();
  };

  const handleDeletePath = async (path: string) => {
    const isFile = path.endsWith('.md') || path.endsWith('.excalidraw') || path.endsWith('.drawio');
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Silinen dosyayı veya klasör altındaki dosyaları açık sekmelerden (panes) temizliyoruz.
    // Eğer silinen not aktif sekmedeyse, aktif notu sonraki uygun sekmeye geçiriyoruz veya null yapıyoruz.
    setPanes(prev => {
      const nextPanes = prev.map(pane => {
        let activeTabPath = pane.tabs[pane.activeTabIdx] || null;
        
        const updatedTabs = pane.tabs.filter(t => {
          if (isFile) {
            return t !== path;
          } else {
            return t !== path && !t.startsWith(path + '/');
          }
        });

        let newActiveIdx = pane.activeTabIdx;
        if (activeTabPath) {
          const isDeleted = isFile ? activeTabPath === path : (activeTabPath === path || activeTabPath.startsWith(path + '/'));
          if (isDeleted) {
            newActiveIdx = Math.max(0, updatedTabs.length - 1);
          } else {
            newActiveIdx = updatedTabs.indexOf(activeTabPath);
            if (newActiveIdx === -1) newActiveIdx = 0;
          }
        } else {
          newActiveIdx = 0;
        }

        return {
          ...pane,
          tabs: updatedTabs,
          activeTabIdx: newActiveIdx
        };
      });

      // Tüm sekmeleri silinen split-view panellerini kaldır, en az bir panel kalsın.
      const finalPanes = (nextPanes.length > 1 && nextPanes.some(p => p.tabs.length === 0))
        ? (nextPanes.filter(p => p.tabs.length > 0).length > 0 ? nextPanes.filter(p => p.tabs.length > 0) : [nextPanes[0]])
        : nextPanes;

      if (finalPanes.length !== nextPanes.length) {
        setActivePaneIdx(idx => Math.min(idx, finalPanes.length - 1));
      }

      const activePane = finalPanes[Math.min(activePaneIdx, finalPanes.length - 1)];
      if (activePane) {
        const newActivePath = activePane.tabs[activePane.activeTabIdx] || null;
        setActiveNotePath(newActivePath);
      }

      return finalPanes;
    });

    const updatedLists = pinnedWidgetLists.filter(p => {
      return isFile ? p !== path : (p !== path && !p.startsWith(path + '/'));
    });
    let newActive = pinnedWidgetList;
    if (isFile && pinnedWidgetList === path) {
      newActive = updatedLists.length > 0 ? updatedLists[updatedLists.length - 1] : null;
    } else if (!isFile && pinnedWidgetList && (pinnedWidgetList === path || pinnedWidgetList.startsWith(path + '/'))) {
      newActive = updatedLists.length > 0 ? updatedLists[updatedLists.length - 1] : null;
    }

    await updatePinnedWidgets(updatedLists, newActive);

    if (!isBrowser) {
      const isFile = path.endsWith('.md') || path.endsWith('.excalidraw') || path.endsWith('.drawio');
      if (!isFile) {
        // Folder deletion: soft-delete all containing notes/drawings in remote database
        // and move each one into the local trash index too.
        try {
          const allFiles = await platform.listFiles();
          for (const file of allFiles) {
            if ((file.type === 'note' || file.type === 'excalidraw' || file.type === 'drawio') && file.path.startsWith(path + '/')) {
              await addToLocalTrash(file.path);
              await handleLocalDelete(file.path);
            } else if (file.type === 'folder' && file.path.startsWith(path + '/')) {
              await handleLocalFolderDelete(file.path);
            }
          }
          // Silinen klasörün kendisini de (nested alt klasörlerden ayrı olarak) tombstone'la.
          await handleLocalFolderDelete(path);
        } catch (e) {
          console.error('[Delete Path] Failed to list or soft-delete folder children:', e);
        }
        // Silinen klasör (veya alt klasörlerinden biri) bir gelişim yolu olarak
        // işaretliyse, o rütbe/XP kaydı da anlamsız kalır — temizle.
        setDevelopmentPaths(prev => {
          const next = { ...prev };
          let changed = false;
          Object.keys(next).forEach(devPath => {
            if (devPath === path || devPath.startsWith(path + '/')) {
              delete next[devPath];
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      } else {
        await addToLocalTrash(path);
        await handleLocalDelete(path);
      }
      const res = await platform.deletePath(path);
      if (res.success) {
        // Silinen nota ait sürüm geçmişi anlık görüntüsünü de temizle (best-effort).
        if (isFile) {
          try {
            await platform.deletePath(`.versions/${path}.json`);
          } catch (_e) { /* geçmiş dosyası zaten yoksa yok say */ }
        }
        await loadAllData();
      }
    } else {
      // Web Mock
      const isFolder = notes.some(n => n.path === path && n.type === 'folder');
      const updated = notes.filter(n => {
        if (n.path === path) return false;
        if (isFolder && n.path.startsWith(path + '/')) {
          localStorage.removeItem(`mock_note_${n.path}`);
          return false;
        }
        return true;
      });
      mockSaveNotes(updated);
      localStorage.removeItem(`mock_note_${path}`);
      await loadAllData();
    }
  };

  const handleDeleteFolder = async (folder: string) => {
    if (selectedFolder === folder) {
      setSelectedFolder(null);
    }
    await handleDeletePath(folder);
  };

  const handleSaveFolderCustomization = async (folderPath: string, color: string, icon: string) => {
    const updated = {
      ...folderCustomizations,
      [folderPath]: { color, icon }
    };
    setFolderCustomizations(updated);
    await saveMetadata(timelineItems, recentInputs, tags, updated);
    setIsCustomizerOpen(false);
  };

  const handleClearFolderCustomization = async (folderPath: string) => {
    const updated = { ...folderCustomizations };
    delete updated[folderPath];
    setFolderCustomizations(updated);
    await saveMetadata(timelineItems, recentInputs, tags, updated);
    setIsCustomizerOpen(false);
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bir klasörü "Gelişim Yolu" olarak işaretler/kaldırır. İşaretlerken mevcut (o klasör
  // altındaki) tamamlanmış task ve wikilink sayıları baseline olarak kaydedilir — böylece
  // önceden yazılmış içerik anında dev bir XP dökmesine yol açmaz (pet'in selectStarter'daki
  // aynı baseline mantığı, bkz. eski Sidebar.tsx:393-429).
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // AI'nin ürettiği seviye/konu başlıkları klasör adı olarak kullanılacağı için dosya
  // sistemi açısından güvenli hale getirilir (özellikle "/" — aksi halde istemeden iç
  // içe klasör oluşturabilirdi).
  const sanitizeFolderName = (name: string): string => {
    return name.replace(/[\/\\:*?"<>|]/g, '-').trim().slice(0, 80) || 'Adsız';
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Her konu klasörüne otomatik yazılan sistem notları (Başlangıç Notu, 'advanced'/
  // 'complete' modda üretilen alt-notlar, Soru Kartları — bkz. createLevelFolders),
  // "Test Et"i açan / "Son çalışma" tarihini belirleyen / quiz-kart üretimine kaynak olan
  // not sayımlarına dahil EDİLMEMELİ — yoksa kullanıcı hiç not yazmadan Test Et anında
  // açılır ve "bugün çalışıldı" göstergesi yanlış olur. Bu yardımcı, bir konu klasöründeki
  // notları KULLANICININ KENDİ yazdıklarıyla sınırlar. `extraSystemNames`, o konuya özel
  // (dinamik başlıklı) alt-not/kart dosya adlarını da hariç tutmak için kullanılır.
  const DEV_PATH_SYSTEM_NOTE_NAMES = new Set(['Başlangıç Notu.md', 'Seviye Bilgisi.md']);
  const getUserNotesInTopicFolder = (folderPath: string, extraSystemNames: string[] = []) => {
    const excluded = extraSystemNames.length
      ? new Set([...DEV_PATH_SYSTEM_NOTE_NAMES, ...extraSystemNames])
      : DEV_PATH_SYSTEM_NOTE_NAMES;
    return notes.filter(n =>
      n.type !== 'folder' &&
      n.path.startsWith(folderPath + '/') &&
      !excluded.has(n.path.split('/').pop() || '')
    );
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bir seviyenin kalıcı, insan-okunur özet notu — konular ve durumları (⬜/🟡/✅/⚠️) ile
  // ilerleme oranını listeler. Konu durumları her değiştiğinde (test geçme, seviye atlama,
  // "bilmiyorum" işaretleme) yeniden yazılır ki not her zaman güncel kalsın.
  const buildLevelNoteContent = (domainLabel: string, level: DevPathLevel): string => {
    const lines = [
      `# ${domainLabel} — ${level.title}`,
      '',
      'Bir sonraki seviyeye geçmek için gereken konular:',
      ''
    ];
    level.topics.forEach(t => {
      const emoji = t.status === 'passed' ? '✅' : t.status === 'testable' ? '🟡' : t.status === 'flagged_unknown' ? '⚠️' : '⬜';
      lines.push(`${emoji} **${t.title}** — ${t.description}`);
    });
    const passedCount = level.topics.filter(t => t.status === 'passed').length;
    lines.push('', `İlerleme: ${passedCount}/${level.topics.length}`);
    return lines.join('\n');
  };

  const writeLevelNote = async (domainLabel: string, level: DevPathLevel) => {
    try {
      await platform.writeNote(`${level.folderPath}/Seviye Bilgisi.md`, buildLevelNoteContent(domainLabel, level));
    } catch (e) {
      console.error('[DevPath] Seviye notu yazılamadı:', e);
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bir seviye için klasör (ör. ".../ASPNET/Junior") ve altında her konu için ayrı bir alt
  // klasör (ör. ".../Junior/Dependency Injection") oluşturur — kullanıcı notlarını bu konu
  // klasörlerinin İÇİNE alır, "Test Et" o klasörde en az bir not olunca aktif olur.
  const createLevelFolders = async (
    basePath: string,
    levelTitle: string,
    topics: { title: string; description: string; introNote?: string }[],
    defaultTopicStatus: DevPathTopic['status'] = 'open',
    noteMode: DevPathNoteMode = 'basic'
  ): Promise<DevPathLevel> => {
    const levelFolderPath = `${basePath}/${sanitizeFolderName(levelTitle)}`;
    await platform.createFolder(levelFolderPath);
    uploadFolderDirect(levelFolderPath);

    const topicObjs: DevPathTopic[] = [];
    for (const t of topics) {
      const topicFolderPath = `${levelFolderPath}/${sanitizeFolderName(t.title)}`;
      await platform.createFolder(topicFolderPath);
      uploadFolderDirect(topicFolderPath);

      const systemNoteNames: string[] = [];
      // AI'nin ürettiği introNote'u, kullanıcı boş bir klasörle karşılaşmasın diye
      // uygulamanın kendi "🚀 Başlangıç" notu deseniyle tutarlı şekilde bir
      // "Başlangıç Notu.md" olarak konu klasörünün içine yazıyoruz.
      let introContent = (t.introNote || '').trim();

      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // BUG DÜZELTMESİ (az konu üretimi): alt-notlar artık konu listesiyle AYNI çağrıda
      // değil, HER konu için AYRI bir çağrıyla (generateTopicSubNotes) üretiliyor — eskiden
      // ikisi aynı çağrıda istendiğinde, konu sayısı arttıkça çıktı katlanarak büyüdüğü
      // için model konu sayısını (genişliği) fark ettirmeden kısıyordu (bkz.
      // geminiMentor.ts'teki TOPIC_LIST_SCHEMA yorumu). Alt-notlar her biri KENDİ dosyasına
      // yazılır ve ana "Başlangıç Notu" bunlara wikilink ile bağlanan bir indeks haline gelir.
      let subNotesList: TopicSubNote[] = [];
      if ((noteMode === 'advanced' || noteMode === 'complete') && introContent) {
        try {
          const subResult = await generateTopicSubNotes(t.title, t.description, introContent);
          subNotesList = subResult.subNotes || [];
        } catch (e) {
          console.error('[DevPath] Alt not üretimi başarısız:', e);
        }
      }
      if (subNotesList.length > 0) {
        const linkLines: string[] = [];
        for (const sn of subNotesList) {
          const subFileName = `${sanitizeFolderName(sn.title)}.md`;
          try {
            await handleSaveNote(`${topicFolderPath}/${subFileName}`, `# ${sn.title}\n\n${sn.content.trim()}\n`);
            systemNoteNames.push(subFileName);
            linkLines.push(`- [[${sanitizeFolderName(sn.title)}]]`);
          } catch (e) {
            console.error('[DevPath] Alt not yazılamadı:', e);
          }
        }
        if (linkLines.length > 0) {
          introContent = `${introContent}\n\n## Alt Konular\n${linkLines.join('\n')}\n`;
        }
      }

      if (introContent) {
        try {
          await handleSaveNote(`${topicFolderPath}/Başlangıç Notu.md`, `# ${t.title}\n\n${introContent}\n`);
          systemNoteNames.push('Başlangıç Notu.md');
        } catch (e) {
          console.error('[DevPath] Başlangıç notu yazılamadı:', e);
        }
      }

      // 'complete' modda, az önce üretilen içerikten otomatik soru kartları (SRS) oluşturulur —
      // kullanıcı "Kart Oluştur"a hiç basmadan konuya aralıklı tekrar ile başlayabilsin diye.
      if (noteMode === 'complete') {
        try {
          const combinedContent = [introContent, ...subNotesList.map(sn => sn.content)].filter(Boolean).join('\n\n---\n\n');
          if (combinedContent.trim()) {
            const result = await generateFlashcards(t.title, t.description, combinedContent);
            if (result.cards && result.cards.length > 0) {
              const todayStr = new Date().toISOString().slice(0, 10);
              const cardLines = result.cards.map(c => `[card: ${c.question.trim()} || ${c.answer.trim()}] [srs: box1, ${todayStr}]`).join('\n');
              await handleSaveNote(`${topicFolderPath}/Soru Kartları.md`, `# ${t.title} — Soru Kartları\n${cardLines}\n`);
              systemNoteNames.push('Soru Kartları.md');
            }
          }
        } catch (e) {
          console.error('[DevPath] Complete modu otomatik kart üretimi başarısız:', e);
        }
      }

      topicObjs.push({ title: t.title, description: t.description, folderPath: topicFolderPath, status: defaultTopicStatus, systemNoteNames });
    }

    const level: DevPathLevel = { title: levelTitle, folderPath: levelFolderPath, topics: topicObjs };
    await writeLevelNote(basePath.split('/').pop() || basePath, level);
    return level;
  };

  const handleToggleDevPath = (path: string) => {
    if (developmentPaths[path]) {
      const name = path.split('/').pop();
      requestConfirm(`"${name}" klasörünün gelişim yolu işaretini kaldırmak istediğinize emin misiniz? (Rütbe/XP verisi silinecek)`, () => {
        setDevelopmentPaths(prev => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
      });
      return;
    }

    // Faz 2: AI Mentor aktifse ve Gemini anahtarı girilmişse sihirbazı aç; aksi halde
    // Faz 1'in basit (AI'sız) akışına düş.
    if (isAiMentorEnabled && isGeminiConfigured()) {
      setDevPathWizardTarget(path);
      setDevPathWizardCurrentDesc('');
      setDevPathWizardGoalDesc('');
      setDevPathWizardNoteMode('basic');
      setDevPathWizardQA([]);
      setDevPathWizardQuestion(null);
      setDevPathWizardError(null);
      setDevPathWizardBusy(false);
      setDevPathWizardPreview(null);
      setDevPathWizardShowCorrection(false);
      setDevPathWizardCorrectionText('');
      return;
    }

    const label = prompt('Bu klasör hangi gelişim yolun? (örn: ASP.NET Yazılım Mühendisliği)');
    if (!label || !label.trim()) return;

    const currentTaskCount = timelineItems.filter(t =>
      t.isCompleted && t.folder && (t.folder === path || t.folder.startsWith(path + '/'))
    ).length;

    let currentLinkCount = 0;
    Object.keys(fileContents).forEach(notePath => {
      if (notePath.startsWith(path + '/')) {
        currentLinkCount += countWikilinks(fileContents[notePath] || '');
      }
    });

    setDevelopmentPaths(prev => ({
      ...prev,
      [path]: {
        mode: 'simple',
        label: label.trim(),
        xp: 0,
        lastTaskCount: currentTaskCount,
        lastLinkCount: currentLinkCount,
        updatedAt: new Date().toISOString()
      }
    }));
  };

  // İki ayrı alanı ("şu anki durum" + "hedeflenen rol") AI'nin beklediği tek
  // selfDescription string'ine birleştirir.
  const buildDevPathSelfDescription = () => {
    return `Şu anki durum/deneyim: ${devPathWizardCurrentDesc.trim() || '(belirtilmedi)'}\nUlaşmak istediği rol/hedef: ${devPathWizardGoalDesc.trim() || '(belirtilmedi)'}`;
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Sihirbazda "Devam Et" tıklanınca (ilk açıklama VEYA bir netleştirme sorusuna cevap
  // sonrası, VEYA bir düzeltme sonrası) çağrılır. AI ya yeni bir netleştirme sorusu döner
  // (döngü devam eder) ya da nihai seviye+konu listesini döner. BUG DÜZELTMESİ: eskiden bu
  // noktada doğrudan klasörler oluşturuluyordu — artık sadece bir ÖNİZLEME state'i
  // dolduruluyor, gerçek diske yazma yalnızca kullanıcı "Onayla ve Oluştur" dediğinde
  // (handleDevPathWizardConfirmPreview) oluyor.
  const runDevPathWizardStep = async (qaSoFar: ClarifyingQA[]) => {
    if (!devPathWizardTarget) return;
    const path = devPathWizardTarget;
    const domainLabel = path.split('/').pop() || path;

    setDevPathWizardQA(qaSoFar);
    setDevPathWizardBusy(true);
    setDevPathWizardError(null);
    try {
      const result = await determineLevelAndTopics(domainLabel, buildDevPathSelfDescription(), qaSoFar, devPathWizardNoteMode);
      if (result.needsClarification && result.clarifyingQuestion) {
        setDevPathWizardQuestion({
          question: result.clarifyingQuestion,
          options: result.clarifyingOptions || []
        });
        setDevPathWizardBusy(false);
        return;
      }

      if (!result.levelTitle || !result.topics || result.topics.length === 0) {
        throw new Error('AI geçerli bir seviye/konu listesi döndürmedi.');
      }

      setDevPathWizardQuestion(null);
      setDevPathWizardPreview({
        levelTitle: result.levelTitle,
        topics: result.topics,
        priorLevels: result.priorLevels || []
      });
      setDevPathWizardBusy(false);
    } catch (err: any) {
      console.error('[DevPath Wizard] Hata:', err);
      setDevPathWizardError(err?.message || 'Bilinmeyen bir hata oluştu.');
      setDevPathWizardBusy(false);
    }
  };

  const handleDevPathWizardSubmitDescription = () => {
    if (!devPathWizardCurrentDesc.trim() && !devPathWizardGoalDesc.trim()) return;
    runDevPathWizardStep([]);
  };

  // Önizlemedeki bir konuyu (tam yeniden üretime gerek kalmadan) listeden kaldırır.
  const handleRemovePreviewTopic = (topicIdx: number) => {
    setDevPathWizardPreview(prev => prev ? { ...prev, topics: prev.topics.filter((_, i) => i !== topicIdx) } : prev);
  };

  // "Bu yanlış anlaşılmış" — kullanıcının yazdığı düzeltmeyi bir netleştirme
  // sorusu/cevabı gibi geçmişe ekleyip (mevcut priorQA mekanizmasını yeniden kullanarak)
  // sihirbazı SIFIRDAN değil, bu bağlamla tekrar çalıştırır.
  const handleDevPathWizardRegenerateWithCorrection = () => {
    if (!devPathWizardCorrectionText.trim()) return;
    const newQA = [...devPathWizardQA, {
      question: 'Önceki öneri kullanıcının beklentisini karşılamadı. Kullanıcının düzeltmesi/ek açıklaması:',
      answer: devPathWizardCorrectionText.trim()
    }];
    setDevPathWizardCorrectionText('');
    setDevPathWizardShowCorrection(false);
    setDevPathWizardPreview(null);
    runDevPathWizardStep(newQA);
  };

  // Önizleme onaylandığında gerçek klasörleri/notları oluşturur — eskiden
  // runDevPathWizardStep'in başarı dalında doğrudan burada yapılan iş, artık kullanıcı
  // önizlemeyi onayladıktan SONRA tetikleniyor.
  const handleDevPathWizardConfirmPreview = async () => {
    if (!devPathWizardTarget || !devPathWizardPreview) return;
    const path = devPathWizardTarget;
    const domainLabel = path.split('/').pop() || path;

    if (devPathWizardPreview.topics.length === 0) {
      setDevPathWizardError('En az bir konu kalmalı — hepsini kaldırdınız.');
      return;
    }

    setDevPathWizardBusy(true);
    setDevPathWizardError(null);
    try {
      // Kullanıcı önceki seviyeleri atlayıp doğrudan ileri bir seviyeden başlıyorsa
      // (ör. "Mid-level" dedi), AI'nin döndürdüğü önceki seviyeleri de klasör+konu
      // olarak oluşturuyoruz — konuları baştan 'passed' (zaten bilindiği varsayılan)
      // işaretleniyor ki kullanıcı Gelişim Yolu Detayı panelinde bunları gözden
      // geçirip gerçekte bilmediklerini "Bunu Bilmiyorum" ile açığa çıkarabilsin.
      const priorLevelObjs: DevPathLevel[] = [];
      for (const pl of devPathWizardPreview.priorLevels) {
        if (!pl.title || !pl.topics || pl.topics.length === 0) continue;
        const priorLevel = await createLevelFolders(path, pl.title, pl.topics, 'passed', devPathWizardNoteMode);
        priorLevelObjs.push(priorLevel);
      }

      const level = await createLevelFolders(path, devPathWizardPreview.levelTitle, devPathWizardPreview.topics, 'open', devPathWizardNoteMode);
      const allLevels = [...priorLevelObjs, level];
      setDevelopmentPaths(prev => ({
        ...prev,
        [path]: {
          mode: 'ai',
          label: domainLabel,
          domainDescription: buildDevPathSelfDescription(),
          noteMode: devPathWizardNoteMode,
          currentLevelIndex: allLevels.length - 1,
          levels: allLevels,
          updatedAt: new Date().toISOString()
        }
      }));
      await loadAllData();
      setDevPathWizardTarget(null);
      setDevPathWizardPreview(null);
      setDevPathWizardBusy(false);
      // Önceki seviyeler oluşturulduysa, kullanıcının bunları hemen gözden geçirip
      // gerçekte bilmediklerini işaretleyebilmesi için detay panelini otomatik açıyoruz.
      if (priorLevelObjs.length > 0) {
        setDevPathDetailTarget(path);
      }
    } catch (err: any) {
      console.error('[DevPath Wizard] Hata:', err);
      setDevPathWizardError(err?.message || 'Bilinmeyen bir hata oluştu.');
      setDevPathWizardBusy(false);
    }
  };

  const handleDevPathWizardSelectOption = (option: string) => {
    if (!devPathWizardQuestion) return;
    const newQA = [...devPathWizardQA, { question: devPathWizardQuestion.question, answer: option }];
    setDevPathWizardQA(newQA);
    setDevPathWizardQuestion(null);
    runDevPathWizardStep(newQA);
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bir konunun testi geçildiğinde çağrılır: durumu 'passed' yapar, seviye notunu
  // günceller, ve eğer seviyedeki TÜM konular artık geçilmişse bir sonraki seviyeyi
  // AI'den isteyip klasörlerini oluşturur ve kutlama banner'ını tetikler.
  const handleTopicPassed = async (path: string, levelIdx: number, topicIdx: number) => {
    const devPath = developmentPaths[path];
    if (!devPath || !devPath.levels) return;
    const level = devPath.levels[levelIdx];
    if (!level) return;

    const updatedTopics = level.topics.map((t, i) => i === topicIdx ? { ...t, status: 'passed' as const } : t);
    const updatedLevel: DevPathLevel = { ...level, topics: updatedTopics };
    const updatedLevels = devPath.levels.map((l, i) => i === levelIdx ? updatedLevel : l);

    setDevelopmentPaths(prev => ({
      ...prev,
      [path]: { ...prev[path], levels: updatedLevels, updatedAt: new Date().toISOString() }
    }));
    await writeLevelNote(devPath.label, updatedLevel);

    const allPassed = updatedTopics.every(t => t.status === 'passed');
    const isCurrentLevel = levelIdx === (devPath.currentLevelIndex ?? 0);
    if (allPassed && isCurrentLevel) {
      try {
        const priorTitles = updatedLevels.map(l => l.title);
        const noteMode = devPath.noteMode || 'basic';
        const nextLevelData = await generateNextLevel(devPath.label, priorTitles, noteMode);
        const nextLevel = await createLevelFolders(path, nextLevelData.levelTitle, nextLevelData.topics, 'open', noteMode);
        const finalLevels = [...updatedLevels, nextLevel];
        setDevelopmentPaths(prev => ({
          ...prev,
          [path]: {
            ...prev[path],
            levels: finalLevels,
            currentLevelIndex: finalLevels.length - 1,
            updatedAt: new Date().toISOString()
          }
        }));
        setRankUpCelebration({ path, label: devPath.label, rankName: nextLevel.title });
        setTimeout(() => setRankUpCelebration(null), 4000);
        await loadAllData();
      } catch (err) {
        console.error('[DevPath] Sonraki seviye üretilemedi:', err);
      }
    }
  };

  // "Bunu bilmiyorum" — önceki bir seviyeden geçilmiş bir konuyu tekrar açığa alır
  // (yeniden çalışılıp test edilebilsin diye).
  const handleFlagTopicUnknown = async (path: string, levelIdx: number, topicIdx: number) => {
    const devPath = developmentPaths[path];
    if (!devPath || !devPath.levels) return;
    const level = devPath.levels[levelIdx];
    if (!level) return;
    const updatedTopics = level.topics.map((t, i) => i === topicIdx ? { ...t, status: 'flagged_unknown' as const } : t);
    const updatedLevel: DevPathLevel = { ...level, topics: updatedTopics };
    const updatedLevels = devPath.levels.map((l, i) => i === levelIdx ? updatedLevel : l);
    setDevelopmentPaths(prev => ({
      ...prev,
      [path]: { ...prev[path], levels: updatedLevels, updatedAt: new Date().toISOString() }
    }));
    await writeLevelNote(devPath.label, updatedLevel);
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Gelişim Yolu Detayı panelinde MEVCUT seviyedeki bir konuyu kaldırır — sihirbaz
  // önizlemesinden farklı olarak burada konu klasörü zaten diske yazılmış olabilir (gerçek
  // kullanıcı notları içerebilir), bu yüzden her zaman onay istenir ve klasör de silinir.
  const handleRemoveCurrentTopic = (path: string, levelIdx: number, topicIdx: number) => {
    const devPath = developmentPaths[path];
    if (!devPath || !devPath.levels) return;
    const level = devPath.levels[levelIdx];
    const topic = level?.topics[topicIdx];
    if (!topic) return;

    requestConfirm(`"${topic.title}" konusunu ve klasöründeki (varsa) tüm notları kalıcı olarak silmek istediğinize emin misiniz?`, async () => {
      try {
        await platform.deletePath(topic.folderPath);
      } catch (e) {
        console.error('[DevPath] Konu klasörü silinemedi:', e);
      }
      const updatedTopics = level.topics.filter((_, i) => i !== topicIdx);
      const updatedLevel: DevPathLevel = { ...level, topics: updatedTopics };
      const updatedLevels = devPath.levels!.map((l, i) => i === levelIdx ? updatedLevel : l);
      setDevelopmentPaths(prev => ({
        ...prev,
        [path]: { ...prev[path], levels: updatedLevels, updatedAt: new Date().toISOString() }
      }));
      await writeLevelNote(devPath.label, updatedLevel);
      await loadAllData();
    });
  };

  const handleOpenAddTopic = (path: string, levelIdx: number) => {
    setDevPathAddTopicTarget({ path, levelIdx });
    setDevPathAddTopicHint('');
    setDevPathAddTopicError(null);
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // AI'den mevcut seviyeye TEK bir yeni konu önerisi ister ve createLevelFolders'ı (aynı
  // seviyenin klasörüne, tek konuluk bir liste vererek) yeniden kullanıp gerçek klasörü
  // materyalize eder. createLevelFolders döndürdüğü level.topics SADECE bu yeni konuyu
  // içerdiği için (tüm seviyeyi değil), mevcut konu listesine elle EKLENİYOR — üzerine
  // yazılmıyor.
  const handleConfirmAddTopic = async () => {
    if (!devPathAddTopicTarget) return;
    const { path, levelIdx } = devPathAddTopicTarget;
    const devPath = developmentPaths[path];
    const level = devPath?.levels?.[levelIdx];
    if (!level) return;

    setDevPathAddTopicBusy(true);
    setDevPathAddTopicError(null);
    try {
      const suggestion = await suggestAdditionalTopic(devPath.label, level.title, level.topics.map(t => t.title), devPathAddTopicHint);
      const result = await createLevelFolders(path, level.title, [suggestion], 'open', devPath.noteMode || 'basic');
      const newTopic = result.topics[0];
      const updatedLevel: DevPathLevel = { ...level, topics: [...level.topics, newTopic] };
      const updatedLevels = devPath.levels!.map((l, i) => i === levelIdx ? updatedLevel : l);
      setDevelopmentPaths(prev => ({
        ...prev,
        [path]: { ...prev[path], levels: updatedLevels, updatedAt: new Date().toISOString() }
      }));
      await writeLevelNote(devPath.label, updatedLevel);
      await loadAllData();
      setDevPathAddTopicTarget(null);
      setDevPathAddTopicBusy(false);
    } catch (err: any) {
      console.error('[DevPath] Konu eklenemedi:', err);
      setDevPathAddTopicError(err?.message || 'Konu önerilemedi.');
      setDevPathAddTopicBusy(false);
    }
  };

  // Bir konu klasöründeki notların en son ne zaman güncellendiğini bulur — "Son
  // çalışma: X gün önce" göstergesi ve takvim hatırlatması tetikleme koşulu için.
  // Not yoksa null döner (henüz hiç çalışılmamış).
  const getFolderLastActivityDays = (folderPath: string, extraSystemNames: string[] = []): number | null => {
    const relevantNotes = getUserNotesInTopicFolder(folderPath, extraSystemNames);
    if (relevantNotes.length === 0) return null;
    const lastUpdated = Math.max(...relevantNotes.map(n => n.updatedAt || 0));
    if (!lastUpdated) return null;
    return Math.floor((Date.now() - lastUpdated) / (1000 * 60 * 60 * 24));
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Konu notlarından, uygulamanın var olan aralıklı tekrar (SRS) söz dizimiyle
  // ([card: soru || cevap] [srs: boxN, tarih]) uyumlu kartlar üretir ve konu
  // klasöründeki ayrı bir "Soru Kartları.md" notuna ekler — böylece FlashcardView.tsx
  // bu kartları otomatik olarak tekrar kuyruğuna alır, ekstra bir depolama gerekmez.
  const handleGenerateFlashcardsForTopic = async (path: string, levelIdx: number, topicIdx: number) => {
    const devPath = developmentPaths[path];
    const topic = devPath?.levels?.[levelIdx]?.topics[topicIdx];
    if (!topic) return;

    setDevPathTopicActionBusy({ levelIdx, topicIdx });
    setDevPathTopicActionMessage(null);
    try {
      const notesContent = getUserNotesInTopicFolder(topic.folderPath, topic.systemNoteNames || [])
        .map(n => fileContents[n.path] || '')
        .join('\n\n---\n\n');
      const result = await generateFlashcards(topic.title, topic.description, notesContent);
      if (!result.cards || result.cards.length === 0) {
        throw new Error('AI kart üretmedi.');
      }

      const cardsNotePath = `${topic.folderPath}/Soru Kartları.md`;
      const existingContent = fileContents[cardsNotePath] || `# ${topic.title} — Soru Kartları\n`;
      const todayStr = new Date().toISOString().slice(0, 10);
      const newLines = result.cards.map(c => `[card: ${c.question.trim()} || ${c.answer.trim()}] [srs: box1, ${todayStr}]`).join('\n');
      const updatedContent = `${existingContent.trimEnd()}\n${newLines}\n`;

      await handleSaveNote(cardsNotePath, updatedContent);
      await loadAllData();
      setDevPathTopicActionMessage({ levelIdx, topicIdx, text: `${result.cards.length} kart oluşturuldu ✅` });
    } catch (err: any) {
      setDevPathTopicActionMessage({ levelIdx, topicIdx, text: err?.message || 'Kartlar oluşturulamadı.' });
    } finally {
      setDevPathTopicActionBusy(null);
      setTimeout(() => setDevPathTopicActionMessage(null), 4000);
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // AI çağrısı GEREKTİRMEZ — sadece konu klasörüne, uygulamanın var olan
  // "- [ ] ... [due:YYYY-MM-DD]" görev söz dizimiyle bir hatırlatma satırı yazar,
  // bu da mevcut Takvim Planlayıcı'da otomatik olarak yarının görevi olarak belirir.
  // Aynı hatırlatma notu varsa üzerine yazılır (tekrar tekrar birikmesin diye).
  const handleAddCalendarReminderForTopic = async (path: string, levelIdx: number, topicIdx: number) => {
    const devPath = developmentPaths[path];
    const topic = devPath?.levels?.[levelIdx]?.topics[topicIdx];
    if (!topic) return;

    setDevPathTopicActionBusy({ levelIdx, topicIdx });
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dueStr = tomorrow.toISOString().slice(0, 10);
      const reminderPath = `${topic.folderPath}/Hatırlatma.md`;
      const content = `# Hatırlatma\n\n- [ ] "${topic.title}" konusuna çalış (${devPath!.label}) [due:${dueStr}]\n`;
      await handleSaveNote(reminderPath, content);
      await loadAllData();
      setDevPathTopicActionMessage({ levelIdx, topicIdx, text: 'Yarının takvimine eklendi 📅' });
    } catch (err: any) {
      setDevPathTopicActionMessage({ levelIdx, topicIdx, text: 'Takvime eklenemedi.' });
    } finally {
      setDevPathTopicActionBusy(null);
      setTimeout(() => setDevPathTopicActionMessage(null), 4000);
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "Test Et" ÖNCESİ özet modalını açar — konu notu var ama özet henüz onaylanmamışsa çağrılır.
  const handleOpenSummaryModal = (path: string, levelIdx: number, topicIdx: number) => {
    setDevPathSummaryTarget({ path, levelIdx, topicIdx });
    setDevPathSummaryText('');
    setDevPathSummaryResult(null);
    setDevPathSummaryError(null);
    setDevPathSummaryBusy(false);
  };

  const handleSubmitTopicSummary = async () => {
    if (!devPathSummaryTarget || !devPathSummaryText.trim()) return;
    const { path, levelIdx, topicIdx } = devPathSummaryTarget;
    const devPath = developmentPaths[path];
    const topic = devPath?.levels?.[levelIdx]?.topics[topicIdx];
    if (!topic) return;

    setDevPathSummaryBusy(true);
    setDevPathSummaryError(null);
    try {
      const notesContent = getUserNotesInTopicFolder(topic.folderPath, topic.systemNoteNames || [])
        .map(n => fileContents[n.path] || '')
        .join('\n\n---\n\n');
      const result = await evaluateSummary(topic.title, topic.description, notesContent, devPathSummaryText);
      setDevPathSummaryResult(result);
      setDevPathSummaryBusy(false);
      if (result.approved) {
        const updatedTopics = devPath!.levels![levelIdx].topics.map((t, i) => i === topicIdx ? { ...t, summaryApproved: true } : t);
        const updatedLevel = { ...devPath!.levels![levelIdx], topics: updatedTopics };
        const updatedLevels = devPath!.levels!.map((l, i) => i === levelIdx ? updatedLevel : l);
        setDevelopmentPaths(prev => ({
          ...prev,
          [path]: { ...prev[path], levels: updatedLevels, updatedAt: new Date().toISOString() }
        }));
      }
    } catch (err: any) {
      setDevPathSummaryError(err?.message || 'Özet değerlendirilemedi.');
      setDevPathSummaryBusy(false);
    }
  };

  const handleOpenDevPathQuiz = async (path: string, levelIdx: number, topicIdx: number) => {
    const devPath = developmentPaths[path];
    if (!devPath || !devPath.levels) return;
    const topic = devPath.levels[levelIdx]?.topics[topicIdx];
    if (!topic) return;

    setDevPathQuizTarget({ path, levelIdx, topicIdx });
    setDevPathQuizQuestions([]);
    setDevPathQuizAnswers([]);
    setDevPathQuizResult(null);
    setDevPathQuizError(null);
    setDevPathQuizBusy(true);

    try {
      const notesContent = getUserNotesInTopicFolder(topic.folderPath, topic.systemNoteNames || [])
        .map(n => fileContents[n.path] || '')
        .join('\n\n---\n\n');
      const quiz = await generateQuiz(topic.title, topic.description, notesContent);
      setDevPathQuizQuestions(quiz.questions);
      setDevPathQuizAnswers(new Array(quiz.questions.length).fill(''));
      setDevPathQuizBusy(false);
    } catch (err: any) {
      setDevPathQuizError(err?.message || 'Sınav hazırlanamadı.');
      setDevPathQuizBusy(false);
    }
  };

  const handleSubmitDevPathQuiz = async () => {
    if (!devPathQuizTarget) return;
    const { path, levelIdx, topicIdx } = devPathQuizTarget;
    const devPath = developmentPaths[path];
    const topic = devPath?.levels?.[levelIdx]?.topics[topicIdx];
    if (!topic) return;

    setDevPathQuizBusy(true);
    setDevPathQuizError(null);
    try {
      const qa = devPathQuizQuestions.map((q, i) => ({ question: q, answer: devPathQuizAnswers[i] || '' }));
      const result = await gradeQuiz(topic.title, qa);
      setDevPathQuizResult(result);
      setDevPathQuizBusy(false);
      if (result.passed) {
        await handleTopicPassed(path, levelIdx, topicIdx);
      } else {
        const updatedTopics = devPath!.levels![levelIdx].topics.map((t, i) => i === topicIdx ? { ...t, status: 'testable' as const } : t);
        const updatedLevel = { ...devPath!.levels![levelIdx], topics: updatedTopics };
        const updatedLevels = devPath!.levels!.map((l, i) => i === levelIdx ? updatedLevel : l);
        setDevelopmentPaths(prev => ({
          ...prev,
          [path]: { ...prev[path], levels: updatedLevels, updatedAt: new Date().toISOString() }
        }));
      }
    } catch (err: any) {
      setDevPathQuizError(err?.message || 'Sınav değerlendirilemedi.');
      setDevPathQuizBusy(false);
    }
  };

  const handleRenamePath = async (oldPath: string, newPath: string) => {
    try {
      const res = await platform.renamePath(oldPath, newPath);
      if (res.success) {
        const isFile = oldPath.endsWith('.md') || oldPath.endsWith('.excalidraw') || oldPath.endsWith('.drawio');

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Yarış durumunu engellemek için aktif not yolunu Supabase işlemlerinden hemen önce güncelliyoruz.
        if (activeNotePath === oldPath) {
          setActiveNotePath(newPath);
        } else if (activeNotePath && activeNotePath.startsWith(oldPath + '/')) {
          const rel = activeNotePath.substring(oldPath.length);
          setActiveNotePath(newPath + rel);
        }
        
        if (selectedFolder === oldPath) {
          setSelectedFolder(newPath);
        } else if (selectedFolder && selectedFolder.startsWith(oldPath + '/')) {
          const rel = selectedFolder.substring(oldPath.length);
          setSelectedFolder(newPath + rel);
        }

        // Yeniden adlandırılan klasör (veya alt klasörlerinden biri) bir gelişim yoluysa,
        // rütbe/XP verisi kaybolmasın diye anahtarı yeni yola taşı.
        if (!isFile) {
          setDevelopmentPaths(prev => {
            let changed = false;
            const next: Record<string, DevPath> = {};
            Object.keys(prev).forEach(devPath => {
              if (devPath === oldPath) {
                next[newPath] = prev[devPath];
                changed = true;
              } else if (devPath.startsWith(oldPath + '/')) {
                next[newPath + devPath.substring(oldPath.length)] = prev[devPath];
                changed = true;
              } else {
                next[devPath] = prev[devPath];
              }
            });
            return changed ? next : prev;
          });
        }

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Açık sekmelerdeki dosya ve klasör yollarını anında yenileriyle güncelleyerek sekmelerin kararsız kalmasını engelliyoruz.
        setPanes(prev => {
          return prev.map(pane => {
            const updatedTabs = pane.tabs.map(t => {
              if (t === oldPath) {
                return newPath;
              }
              if (!isFile) {
                if (t.startsWith(oldPath + '/')) {
                  return newPath + t.substring(oldPath.length);
                }
              }
              return t;
            });
            return { ...pane, tabs: updatedTabs };
          });
        });

        let hasChanges = false;
        const updatedLists = pinnedWidgetLists.map(p => {
          if (isFile) {
            if (p === oldPath) {
              hasChanges = true;
              return newPath;
            }
          } else {
            if (p === oldPath) {
              hasChanges = true;
              return newPath;
            } else if (p.startsWith(oldPath + '/')) {
              hasChanges = true;
              return newPath + p.substring(oldPath.length);
            }
          }
          return p;
        });

        let newActive = pinnedWidgetList;
        if (pinnedWidgetList) {
          if (isFile && pinnedWidgetList === oldPath) {
            newActive = newPath;
            hasChanges = true;
          } else if (!isFile) {
            if (pinnedWidgetList === oldPath) {
              newActive = newPath;
              hasChanges = true;
            } else if (pinnedWidgetList.startsWith(oldPath + '/')) {
              newActive = newPath + pinnedWidgetList.substring(oldPath.length);
              hasChanges = true;
            }
          }
        }

        if (hasChanges) {
          await updatePinnedWidgets(updatedLists, newActive);
        }

        if (!isBrowser) {
          if (isFile) {
            await handleLocalDelete(oldPath);
            const content = await platform.readNote(newPath);
            await handleLocalSave(newPath, content);
          } else {
            // For folders, we soft-delete all remote notes and drawings inside oldPath and upsert under newPath
            const allFiles = await platform.listFiles();
            for (const file of allFiles) {
              if ((file.type === 'note' || file.type === 'excalidraw' || file.type === 'drawio') && file.path.startsWith(newPath + '/')) {
                const oldNotePath = oldPath + file.path.substring(newPath.length);
                await handleLocalDelete(oldNotePath);
                const content = await platform.readNote(file.path);
                await handleLocalSave(file.path, content);
              } else if (file.type === 'folder' && file.path.startsWith(newPath + '/')) {
                const oldFolderPath = oldPath + file.path.substring(newPath.length);
                await handleLocalFolderDelete(oldFolderPath);
                await uploadFolderDirect(file.path);
              }
            }
            // Klasörün kendisi (yeni yolu) de aktif olarak yüklenmeli, eski yolu tombstone'lanmalı.
            await handleLocalFolderDelete(oldPath);
            await uploadFolderDirect(newPath);
          }
        }
        
        await loadAllData();
      } else {
        alert('Yeniden adlandırma hatası: ' + res.error);
      }
    } catch (err) {
      console.error('Rename failed:', err);
      alert('Yeniden adlandırma başarısız oldu.');
    }
  };

  const handleRenameNote = async (oldPath: string, newPath: string) => {
    await handleRenamePath(oldPath, newPath);
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folderPath: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: folderPath,
      type: 'folder'
    });
  };

  const handleNoteContextMenu = (e: React.MouseEvent, notePath: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: notePath,
      type: 'file'
    });
  };

  // 5. Read Note Content
  const handleReadNoteContent = async (path: string): Promise<string> => {
    if (!isBrowser) {
      return await platform.readNote(path);
    } else {
      // Web Mock
      return localStorage.getItem(`mock_note_${path}`) || `# ${path.split('/').pop()?.replace('.md', '')}\n\n`;
    }
  };

  // 6. Process Inbox Quick Dump Input (Factory Engine)
  const handleProcessInput = async (parsed: ParsedInput) => {
    const rawInput = parsed.raw.trim();
    if (rawInput.toLowerCase().startsWith('web:')) {
      const query = rawInput.substring(4).trim();
      setBrowserInitialQuery(query || 'https://www.google.com');
      setActiveTab('browser');
      return;
    }

    const now = new Date();
    const timestamp = format(now, 'HH:mm');
    const dateStr = format(now, 'yyyy-MM-dd');
    const fullTimeStr = format(now, 'yyyy-MM-dd HH:mm');

    const newTimelineItem: TimelineItem = {
      id: Math.random().toString(36).substr(2, 9),
      content: parsed.cleanText,
      timestamp,
      dateStr,
      isTodo: parsed.isTodo,
      isCompleted: false,
      folder: parsed.folder,
      note: parsed.note,
      tags: parsed.tags
    };

    // Update tags list
    const updatedTags = Array.from(new Set([...tags, ...parsed.tags]));
    
    // Update local react states
    const updatedTimeline = [newTimelineItem, ...timelineItems];
    const updatedRecent = [
      {
        id: newTimelineItem.id,
        content: parsed.cleanText,
        parsed,
        timestamp: fullTimeStr
      },
      ...recentInputs.slice(0, 19) // Keep last 20 recents
    ];

    // File placement routing
    let relativePath = '';
    let headerText = '';

    if (parsed.folder && parsed.note) {
      // Route to: Folder + Specific Note
      const filename = `${parsed.note.replace(/\s+/g, '_')}.md`;
      relativePath = `${parsed.folder}/${filename}`;
      headerText = `# ${parsed.note}\n\n`;
    } else if (parsed.folder) {
      // Route to: Folder + Inbox note
      relativePath = `${parsed.folder}/inbox.md`;
      headerText = `# ${parsed.folder} Gelen Kutusu\n\n`;
    } else if (parsed.note) {
      // Route to: Root specific note
      const filename = `${parsed.note.replace(/\s+/g, '_')}.md`;
      relativePath = filename;
      headerText = `# ${parsed.note}\n\n`;
    } else {
      // Default: Root inbox.md
      relativePath = 'inbox.md';
      headerText = `# Gelen Kutusu (Inbox)\n\n`;
    }

    // Prepare note content formatting
    let contentAppend = '';
    if (parsed.isTodo) {
      contentAppend = `\n- [ ] [${fullTimeStr}] ${parsed.cleanText} ${parsed.tags.map((t: string) => `#${t}`).join(' ')}`;
    } else {
      contentAppend = `\n\n### [${fullTimeStr}]\n${parsed.cleanText}\n${parsed.tags.map((t: string) => `#${t}`).join(' ')}`;
    }

    // Read existing note or start new, then write
    try {
      let existingContent = '';
      if (!isBrowser) {
        // Check if folder needs to be created
        if (parsed.folder && !folders.includes(parsed.folder)) {
          await platform.createFolder(parsed.folder);
        }
        try {
          existingContent = await platform.readNote(relativePath);
        } catch (e) {
          // File doesn't exist, we start new
          existingContent = headerText;
        }
        await platform.writeNote(relativePath, existingContent + contentAppend);
        handleLocalSave(relativePath, existingContent + contentAppend);
      } else {
        // Web Mock
        if (parsed.folder && !folders.includes(parsed.folder)) {
          const newFolder: NoteItem = {
            name: parsed.folder,
            path: parsed.folder,
            type: 'folder',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          mockSaveNotes([...notes, newFolder]);
        }
        existingContent = localStorage.getItem(`mock_note_${relativePath}`) || headerText;
        localStorage.setItem(`mock_note_${relativePath}`, existingContent + contentAppend);

        // Check if note is not already indexed in the notes state
        const noteExists = notes.some(n => n.path === relativePath);
        if (!noteExists) {
          const newNote: NoteItem = {
            name: parsed.note || (parsed.folder ? 'inbox' : 'inbox'),
            path: relativePath,
            type: 'note',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          mockSaveNotes([...notes, newNote]);
        }
      }
    } catch (error) {
      console.error('File writing error in parser engine:', error);
    }

    // Clear stale drafts and metadata for the updated file to force a fresh reload from disk
    localStorage.removeItem(`active_note_draft_${relativePath}`);
    localStorage.removeItem(`active_note_focused_line_${relativePath}`);
    localStorage.removeItem(`active_note_caret_char_${relativePath}`);

    // Commit timeline and recent dumps
    setTimelineItems(updatedTimeline);
    setRecentInputs(updatedRecent);
    setTags(updatedTags);
    await saveMetadata(updatedTimeline, updatedRecent, updatedTags);
    await loadAllData();
  };

  // Helper methods for OmniSearch and Recurring Tasks
  const getSearchResults = () => {
    const q = globalSearchQuery.toLowerCase().trim();
    if (!q) return [];
    return notes.filter(note => {
      if (note.type === 'folder') return false;
      const titleMatch = note.name.toLowerCase().includes(q) || note.path.toLowerCase().includes(q);
      const content = fileContents[note.path] || '';
      const contentMatch = content.toLowerCase().includes(q);
      return titleMatch || contentMatch;
    });
  };

  const getSearchSnippet = (content: string, query: string) => {
    const q = query.toLowerCase();
    const idx = content.toLowerCase().indexOf(q);
    if (idx === -1) return '';
    
    const start = Math.max(0, idx - 30);
    const end = Math.min(content.length, idx + query.length + 50);
    let snippet = content.substring(start, end);
    
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    
    const escaped = snippet
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
       
    const highlightRegex = new RegExp(`(${query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    return escaped.replace(highlightRegex, '<strong style="color: var(--accent-color); background: rgba(99, 102, 241, 0.15); padding: 1px 3px; border-radius: 3px;">$1</strong>');
  };

  const handleOpenSearchResult = (path: string) => {
    handleSetActiveNotePath(path);
    setActiveTab('notes');
    setIsGlobalSearchOpen(false);
  };

  const getNextRecurrenceDate = (dateStr: string, repeat: string): string => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    if (repeat === 'daily' || repeat === 'günlük') {
      d.setDate(d.getDate() + 1);
    } else if (repeat === 'weekly' || repeat === 'haftalık') {
      d.setDate(d.getDate() + 7);
    } else if (repeat === 'monthly' || repeat === 'aylık') {
      d.setMonth(d.getMonth() + 1);
    }
    
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // 7. Toggle Todo Completion directly
  const handleChangeTaskStatus = async (id: string, newStatus: 'todo' | 'in-progress' | 'done') => {
    let targetItem: TimelineItem | null = null;
    let nextStateCompleted = newStatus === 'done';

    const updatedTimeline = timelineItems.map(item => {
      if (item.id === id) {
        targetItem = item;
        return { ...item, isCompleted: nextStateCompleted, status: newStatus };
      }
      return item;
    });

    setTimelineItems(updatedTimeline);
    await saveMetadata(updatedTimeline, recentInputs, tags);

    if (targetItem && (targetItem as TimelineItem).isTodo) {
      const item: TimelineItem = targetItem;
      
      let relativePath = '';
      if (item.id.startsWith('task::')) {
        const parts = item.id.split('::');
        relativePath = parts[1];
      } else {
        if (item.folder && item.note) {
          const filename = `${item.note.replace(/\s+/g, '_')}.md`;
          relativePath = `${item.folder}/${filename}`;
        } else if (item.folder) {
          relativePath = `${item.folder}/inbox.md`;
        } else if (item.note) {
          const filename = `${item.note.replace(/\s+/g, '_')}.md`;
          relativePath = filename;
        } else {
          relativePath = 'inbox.md';
        }
      }

      try {
        let fileContent = '';
        if (!isBrowser) {
          fileContent = await platform.readNote(relativePath);
        } else {
          fileContent = localStorage.getItem(`mock_note_${relativePath}`) || '';
        }

        if (fileContent) {
          const lines = fileContent.split('\n');
          
          let lineIdx = -1;
          if (item.id.startsWith('task::')) {
            const parts = item.id.split('::');
            lineIdx = parseInt(parts[2], 10);
          } else {
            const fullTimeStr = `${item.dateStr} ${item.timestamp}`;
            lineIdx = lines.findIndex(l => {
              const hasTimestamp = l.includes(fullTimeStr);
              const hasContent = l.includes(item.content);
              const isChecklist = /^\s*[*\-]\s+\[([ xX\/])\]/.test(l);
              return isChecklist && hasTimestamp && hasContent;
            });
          }

          if (lineIdx !== -1 && lineIdx < lines.length) {
            const line = lines[lineIdx];
            const match = line.match(/^(\s*[*\-]\s+\[)([ xX\/])(\]\s*.*)$/);
            if (match) {
              const statusChar = newStatus === 'done' ? 'x' : (newStatus === 'in-progress' ? '/' : ' ');
              lines[lineIdx] = `${match[1]}${statusChar}${match[3]}`;
              
              if (newStatus === 'done') {
                const repeatMatch = line.match(/\[repeat:(daily|günlük|weekly|haftalık|monthly|aylık)\]/i);
                const dueMatch = line.match(/\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/i);
                
                if (repeatMatch && dueMatch) {
                  const repeatType = repeatMatch[1].toLowerCase();
                  const currentDueDate = dueMatch[1];
                  const nextDueDate = getNextRecurrenceDate(currentDueDate, repeatType);
                  
                  const newRecurrenceLine = line
                    .replace(/^(\s*[*\-]\s+\[)[xX\/](\])/, '$1 $2')
                    .replace(/\[due:\d{4}-\d{2}-\d{2}/i, `[due:${nextDueDate}`);
                  
                  lines.splice(lineIdx + 1, 0, newRecurrenceLine);
                }
              }
              
              const newContent = lines.join('\n');
              
              localStorage.removeItem(`active_note_draft_${relativePath}`);
              localStorage.removeItem(`active_note_focused_line_${relativePath}`);
              localStorage.removeItem(`active_note_caret_char_${relativePath}`);

              if (!isBrowser) {
                await platform.writeNote(relativePath, newContent);
              } else {
                localStorage.setItem(`mock_note_${relativePath}`, newContent);
              }
              handleLocalSave(relativePath, newContent);
              await loadAllData();
            }
          }
        }
      } catch (err) {
        console.error('Failed to sync task status to markdown file:', err);
      }
    }
  };

  const handleToggleTodo = async (id: string) => {
    let nextState = false;
    let targetItem: TimelineItem | null = null;

    const updatedTimeline = timelineItems.map(item => {
      if (item.id === id) {
        nextState = !item.isCompleted;
        targetItem = item;
        return { ...item, isCompleted: nextState };
      }
      return item;
    });

    setTimelineItems(updatedTimeline);
    await saveMetadata(updatedTimeline, recentInputs, tags);

    // Synchronize to the physical markdown file if target item was found and is a todo
    if (targetItem && (targetItem as TimelineItem).isTodo) {
      const item: TimelineItem = targetItem;
      
      // Determine file path
      let relativePath = '';
      if (item.id.startsWith('task::')) {
        const parts = item.id.split('::');
        relativePath = parts[1];
      } else {
        if (item.folder && item.note) {
          const filename = `${item.note.replace(/\s+/g, '_')}.md`;
          relativePath = `${item.folder}/${filename}`;
        } else if (item.folder) {
          relativePath = `${item.folder}/inbox.md`;
        } else if (item.note) {
          const filename = `${item.note.replace(/\s+/g, '_')}.md`;
          relativePath = filename;
        } else {
          relativePath = 'inbox.md';
        }
      }

      try {
        let fileContent = '';
        if (!isBrowser) {
          fileContent = await platform.readNote(relativePath);
        } else {
          fileContent = localStorage.getItem(`mock_note_${relativePath}`) || '';
        }

        if (fileContent) {
          const lines = fileContent.split('\n');
          
          let lineIdx = -1;
          if (item.id.startsWith('task::')) {
            const parts = item.id.split('::');
            lineIdx = parseInt(parts[2], 10);
          } else {
            const fullTimeStr = `${item.dateStr} ${item.timestamp}`;
            lineIdx = lines.findIndex(l => {
              const hasTimestamp = l.includes(fullTimeStr);
              const hasContent = l.includes(item.content);
              const isChecklist = /^\s*[*\-]\s+\[([ xX])\]/.test(l);
              return isChecklist && hasTimestamp && hasContent;
            });
          }

          if (lineIdx !== -1 && lineIdx < lines.length) {
            const line = lines[lineIdx];
            const match = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
            if (match) {
              const statusChar = nextState ? 'x' : ' ';
              lines[lineIdx] = `${match[1]}${statusChar}${match[3]}`;
              
              // Handle recurring task logic: if checked completed, append next recurrence
              if (nextState) {
                const repeatMatch = line.match(/\[repeat:(daily|günlük|weekly|haftalık|monthly|aylık)\]/i);
                const dueMatch = line.match(/\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/i);
                
                if (repeatMatch && dueMatch) {
                  const repeatType = repeatMatch[1].toLowerCase();
                  const currentDueDate = dueMatch[1];
                  const nextDueDate = getNextRecurrenceDate(currentDueDate, repeatType);
                  
                  const newRecurrenceLine = line
                    .replace(/^(\s*[*\-]\s+\[)[xX](\])/, '$1 $2')
                    .replace(/\[due:\d{4}-\d{2}-\d{2}/i, `[due:${nextDueDate}`);
                  
                  lines.splice(lineIdx + 1, 0, newRecurrenceLine);
                }
              }
              
              const newContent = lines.join('\n');
              
              // Clear stale drafts and metadata for the updated file to force a fresh reload from disk
              localStorage.removeItem(`active_note_draft_${relativePath}`);
              localStorage.removeItem(`active_note_focused_line_${relativePath}`);
              localStorage.removeItem(`active_note_caret_char_${relativePath}`);

              if (!isBrowser) {
                await platform.writeNote(relativePath, newContent);
              } else {
                localStorage.setItem(`mock_note_${relativePath}`, newContent);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error synchronizing timeline toggle to markdown:', err);
      }
    }

    // Refresh all views to read the updated markdown file
    await loadAllData();
  };

  // 8. Create Daily Log from Calendar
  const handleCreateDailyNote = async (dateStr: string) => {
    const formattedDate = new Date(dateStr).toLocaleDateString('tr-TR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const folder = 'Günlükler';
    const noteName = dateStr; // Name like YYYY-MM-DD
    const filename = `${noteName}.md`;
    const relativePath = `${folder}/${filename}`;

    if (!isBrowser) {
      if (!folders.includes(folder)) {
        await platform.createFolder(folder);
      }
      const header = `# Günlük Günce: ${formattedDate}\n\nBugünün Logları:\n`;
      await platform.writeNote(relativePath, header);
      handleLocalSave(relativePath, header);
      await loadAllData();
      handleSetActiveNotePath(relativePath);
      setActiveTab('notes');
    } else {
      // Web Mock
      if (!folders.includes(folder)) {
        const newFolder: NoteItem = {
          name: folder,
          path: folder,
          type: 'folder',
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        mockSaveNotes([...notes, newFolder]);
      }
      const newNote: NoteItem = {
        name: noteName,
        path: relativePath,
        type: 'note',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      mockSaveNotes([...notes, newNote]);
      localStorage.setItem(`mock_note_${relativePath}`, `# Günlük Günce: ${formattedDate}\n\n`);
      handleSetActiveNotePath(relativePath);
      setActiveTab('notes');
    }
  };

  const handleSelectDateNotes = (noteName: string) => {
    // Find note path that matches the selected name
    const foundNote = notes.find(n => n.name.toLowerCase() === noteName.toLowerCase());
    if (foundNote) {
      handleSetActiveNotePath(foundNote.path);
      setActiveTab('notes');
    }
  };

  // Show sync loading overlay ONLY while the app's FIRST (initial-launch) full
  // reconciliation is running.
  // BUG DÜZELTMESİ #1: Önceden bu overlay, senkron durumu netleşene kadar (aynı-cihaz
  // kısayolu uygulanacak olsa bile) HER açılışta koşulsuz gösteriliyordu — kullanıcı
  // "değişen bir şey yokken neden hâlâ görünüyor?" diye haklı olarak sordu. syncStatus'a
  // bakmaya geçildi: kısayol alındığında durum hiç 'syncing' olmadan direkt 'synced'
  // olur, bu yüzden overlay hiç görünmez.
  // BUG DÜZELTMESİ #2: Ama syncStatus yalnızca AÇILIŞTA değil, OTURUM BOYUNCA da
  // 'syncing' olabiliyor (ör. bir klasör silinirken içindeki HER not ayrı ayrı
  // triggerRemoteSync tetikleyip durumu 'syncing'<->'synced' arasında hızla
  // gidip getiriyordu) — bu da tam ekran engelleme ekranının silme işlemi
  // boyunca sürekli yanıp sönmesine yol açıyordu. hasCompletedFirstSyncRef,
  // İLK çözümlemeden sonra kalıcı olarak true kalır; overlay yalnızca bu HENÜZ
  // olmamışken (yani gerçekten uygulama yeni açılmışken) gösterilir — sonraki
  // hiçbir arka plan senkronu bu tam ekran ekranı bir daha tetiklemez.
  if (syncStatus === 'syncing' && !hasCompletedFirstSyncRef.current && !isBrowser) {
    return (
      <div className="sync-loading-overlay">
        <div className="sync-loading-card">
          <div className="sync-loading-spinner" />
          <h2 style={{ margin: '16px 0 8px', color: 'var(--text-primary)', fontSize: '1.2rem' }}>Eşitleniyor...</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
            Notlarınız diğer cihazlardan güncelleniyor.<br/>Lütfen bekleyin.
          </p>
          {syncError && (
            <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '12px' }}>{syncError}</p>
          )}
        </div>
      </div>
    );
  }

  if (isMinimalWindow && minimalNotePath) {
    return (
      <div className="minimal-editor-window" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', background: 'var(--bg-primary, #12131a)' }}>
        <NotesView
          selectedFolder={null}
          selectedTag={null}
          fileContents={fileContents}
          notes={notes}
          activeNotePath={minimalNotePath}
          setActiveNotePath={() => {}}
          onSaveNote={handleSaveNote}
          onDeletePath={() => Promise.resolve()}
          onCreateNote={() => Promise.resolve()}
          readNoteContent={handleReadNoteContent}
          onRenameNote={() => Promise.resolve()}
          onRequestConfirm={requestConfirm}
          hideSidebar={true}
          pinnedWidgetLists={pinnedWidgetLists}
          pinnedWidgetList={pinnedWidgetList}
          onUpdatePinnedWidgets={updatePinnedWidgets}
          isFlowEffectsEnabled={isFlowEffectsEnabled}
          templatesFolder={templatesFolder}
          mindmapLayouts={mindmapLayouts}
          onSaveMindmapLayout={handleSaveMindmapLayout}
          lineHeight={lineHeight}
          lineMargin={lineMargin}
        />
      </div>
    );
  }

  if (isMiniMode) {
    return (
      <MiniWidgetView
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onNext={handleNextTrack}
        onPrev={handlePrevTrack}
        onExitMiniMode={() => {
          setIsMiniMode(false);
          if (window.electron && window.electron.toggleMiniMode) {
            window.electron.toggleMiniMode(false);
          }
        }}
        onAddQuickTodo={async (text) => {
          const inboxPath = 'inbox.md';
          const currentInbox = fileContents[inboxPath] || '';
          const updated = currentInbox ? `${currentInbox.trimEnd()}\n- [ ] ${text}\n` : `- [ ] ${text}\n`;
          await handleSaveNote(inboxPath, updated);
        }}
        pomodoroSeconds={pomodoroSeconds}
        isPomodoroRunning={isPomodoroRunning}
        onTogglePomodoro={() => setIsPomodoroRunning(!isPomodoroRunning)}
        onResetPomodoro={() => {
          setIsPomodoroRunning(false);
          setPomodoroSeconds(25 * 60);
        }}
      />
    );
  }

  return (
    <div 
      className="app-layout"
      onTouchStart={(e) => {
        const touch = e.touches[0];
        setTouchStartClientX(touch.clientX);
        setTouchStartClientY(touch.clientY);
      }}
      onTouchMove={(e) => {
        if (touchStartClientX === null || touchStartClientY === null) return;
        const touch = e.touches[0];
        const diffX = touch.clientX - touchStartClientX;
        const diffY = touch.clientY - touchStartClientY;

        // If swiping horizontal is stronger than vertical
        if (Math.abs(diffX) > Math.abs(diffY)) {
          // Swipe right from left edge (within first 60px) to open
          if (diffX > 80 && touchStartClientX < 60) {
            setIsSidebarOpen(true);
            setTouchStartClientX(null);
            setTouchStartClientY(null);
          }
          // Swipe left to close sidebar
          else if (diffX < -80 && isSidebarOpen) {
            setIsSidebarOpen(false);
            setTouchStartClientX(null);
            setTouchStartClientY(null);
          }
        }
      }}
      onTouchEnd={() => {
        setTouchStartClientX(null);
        setTouchStartClientY(null);
      }}
    >
      {/* Visual Titlebar area for modern borderless Electron applications */}
      <div className="window-titlebar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 140px 0 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Mobile Sidebar Hamburger Toggle Button */}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="mobile-sidebar-toggle"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              alignItems: 'center',
              justifyContent: 'center',
              display: 'none' // only visible via CSS media query on mobile!
            }}
          >
            <span style={{ fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', lineHeight: 1 }}>☰</span>
          </button>
          <span className="titlebar-lbl">Ultimate NoteFactory</span>
        </div>

        {/* Ana gezinme: sol menüdeki klasör listesine daha çok yer bırakmak için üst başlık çubuğuna taşındı */}
        <div className="titlebar-nav-icons">
          {titlebarPrimaryItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`titlebar-nav-icon ${activeTab === item.id ? 'active' : ''}`}
                title={item.label}
                onClick={() => {
                  setActiveTab(item.id);
                  setSelectedFolder(null);
                  setSelectedTag(null);
                }}
              >
                <Icon size={16} />
              </button>
            );
          })}

          <div style={{ position: 'relative' }}>
            <button
              className={`titlebar-nav-icon ${openTitlebarMenu === 'work' ? 'active' : ''}`}
              title="İş & Yönetim"
              onClick={() => setOpenTitlebarMenu(m => m === 'work' ? null : 'work')}
            >
              <Briefcase size={16} />
            </button>
            {openTitlebarMenu === 'work' && (
              <div className="titlebar-dropdown">
                {titlebarWorkItems.map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className="titlebar-dropdown-item"
                      onClick={() => {
                        setActiveTab(item.id);
                        setSelectedFolder(null);
                        setSelectedTag(null);
                        setOpenTitlebarMenu(null);
                      }}
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              className={`titlebar-nav-icon ${openTitlebarMenu === 'tools' ? 'active' : ''}`}
              title="Diğer Araçlar"
              onClick={() => setOpenTitlebarMenu(m => m === 'tools' ? null : 'tools')}
            >
              <Wrench size={16} />
            </button>
            {openTitlebarMenu === 'tools' && (
              <div className="titlebar-dropdown">
                {titlebarToolItems.map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className="titlebar-dropdown-item"
                      onClick={() => {
                        setActiveTab(item.id);
                        setSelectedFolder(null);
                        setSelectedTag(null);
                        setOpenTitlebarMenu(null);
                      }}
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {openTitlebarMenu && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setOpenTitlebarMenu(null)}
          />
        )}
      </div>

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Bir gelişim yolu rütbe atladığında kısa süreliğine gösterilen kutlama banner'ı
          (eski pet özelliğinin "EVRİMLEŞİYOR!" ekranının yerini alır, bkz. rankUpCelebration state'i). */}
      {rankUpCelebration && (
        <div
          style={{
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10000,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--accent-color)',
            borderRadius: '10px',
            padding: '14px 22px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            animation: 'fadeIn 0.3s ease'
          }}
        >
          <span style={{ fontSize: '22px' }}>🎖️</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>TERFİ ETTİN!</span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {rankUpCelebration.label}: {rankUpCelebration.rankName}
            </span>
          </div>
        </div>
      )}

      <div className="main-viewport">
        {/* Sidebar Left */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          folders={folders}
          tags={tags}
          selectedFolder={selectedFolder}
          setSelectedFolder={(folder) => {
            setSelectedFolder(folder);
            if (window.innerWidth <= 768) {
              setActiveNotePath(null);
              setPanes(prev => prev.map(p => ({ ...p, tabs: [], activeTabIdx: 0 })));
              setActivePaneIdx(0);
            }
          }}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onRequestConfirm={requestConfirm}
          syncStatus={syncStatus}
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onOpenHelp={() => setIsHelpModalOpen(true)}
          onFolderContextMenu={handleFolderContextMenu}
          folderCustomizations={folderCustomizations}
          isCollapsed={isSidebarCollapsed}
          isMiniMode={isMiniMode}
          theme={theme}
          onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          onToggleMiniMode={() => {
            const next = !isMiniMode;
            setIsMiniMode(next);
            if (window.electron && window.electron.toggleMiniMode) {
              window.electron.toggleMiniMode(next);
            }
          }}
          onToggleCollapse={() => {
            setIsSidebarCollapsed(prev => {
              const next = !prev;
              localStorage.setItem('sidebar_collapsed', next.toString());
              return next;
            });
          }}
          isNoteCityEnabled={isNoteCityEnabled}
          isDevPathsEnabled={isDevPathsEnabled}
          developmentPaths={developmentPaths}
          onOpenPathDetail={(path) => setDevPathDetailTarget(path)}
          fileContents={fileContents}
          notes={notes}
          appVersion={appVersion}
          updateStatus={updateStatus}
          onRestartAndInstall={handleRestartAndInstall}
        />

        {/* Mobile touch backdrop overlay to dismiss sidebar */}
        {isSidebarOpen && (
          <div 
            className="mobile-sidebar-backdrop"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Content Panel Right */}
        <main className="content-panel">
          {activeTab === 'notfactory' && (
            <NoteFactoryView
              onProcessInput={handleProcessInput}
              folders={folders}
              notes={notes}
              tags={tags}
            />
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              onProcessInput={handleProcessInput}
              folders={folders}
              notes={notes}
              tags={tags}
              fileContents={fileContents}
              onSelectNote={(path) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
              onSaveNote={handleSaveNote}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              onNext={handleNextTrack}
              onPrev={handlePrevTrack}
              pomodoroSeconds={pomodoroSeconds}
              isPomodoroRunning={isPomodoroRunning}
              onTogglePomodoro={() => setIsPomodoroRunning(!isPomodoroRunning)}
              onResetPomodoro={() => {
                setIsPomodoroRunning(false);
                setPomodoroSeconds(25 * 60);
              }}
              onRequestConfirm={requestConfirm}
            />
          )}

          {activeTab === 'inbox' && (
            <InboxView
              notes={notes}
              folders={folders}
              tags={tags}
              readNoteContent={handleReadNoteContent}
              onSaveNote={handleSaveNote}
              onCreateNote={handleCreateNote}
              loadAllData={loadAllData}
              setActiveTab={setActiveTab}
              setActiveNotePath={handleSetActiveNotePath}
              onRequestConfirm={requestConfirm}
            />
          )}


          {activeTab === 'notes' && (
            <div className="notes-view-row">
            <div className="workspace-panes-wrapper">
              {panes.map((pane, idx) => {
                const isFocused = idx === activePaneIdx;
                const activePath = pane.tabs[pane.activeTabIdx] || null;
                // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                // NotesView'a prop olarak geçilen ile "son görüntülenenler" breadcrumb'ından
                // tıklanınca çağrılan AYNI mantık olsun diye isimlendirilmiş bir fonksiyona
                // çıkarıldı (öncesinde bu satır içi (inline) bir closure'dı).
                const setPaneActiveNotePath = (path: string | null) => {
                  setPanes(prev => {
                    const newPanes = [...prev];
                    const activePane = { ...newPanes[idx] };
                    if (path) {
                      const existingIdx = activePane.tabs.indexOf(path);
                      if (existingIdx !== -1) {
                        activePane.activeTabIdx = existingIdx;
                      } else {
                        activePane.tabs[activePane.activeTabIdx] = path;
                      }
                    } else {
                      activePane.tabs = activePane.tabs.filter((_, i) => i !== activePane.activeTabIdx);
                      activePane.activeTabIdx = Math.max(0, activePane.activeTabIdx - 1);

                      if (activePane.tabs.length === 0 && newPanes.length > 1) {
                        newPanes.splice(idx, 1);
                        setActivePaneIdx(Math.max(0, idx - 1));
                        return newPanes;
                      }
                    }
                    newPanes[idx] = activePane;
                    return newPanes;
                  });
                  if (idx === activePaneIdx) {
                    setActiveNotePath(path);
                  }
                };
                return (
                  <Fragment key={pane.id}>
                  <div
                    onClick={() => setActivePaneIdx(idx)}
                    className={`workspace-pane ${isFocused ? 'focused' : ''}`}
                    style={{
                      flex: `0 0 ${paneWidths[idx] ?? (100 / panes.length)}%`,
                      minWidth: 0,
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleTabDrop(e, idx)}
                  >
                    {/* Sekmeler Çubuğu (Tabs Bar) */}
                    <div className="pane-tabs-bar">
                      {pane.tabs.map((tabPath, tabIdx) => {
                        const isTabActive = tabIdx === pane.activeTabIdx;
                        const noteName = tabPath.split('/').pop()?.replace('.md', '') || 'Yeni Not';
                        return (
                          <div
                            key={tabPath}
                            draggable
                            onDragStart={(e) => handleTabDragStart(e, idx, tabIdx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.stopPropagation();
                              handleTabDrop(e, idx, tabIdx);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPanes(prev => {
                                const newPanes = [...prev];
                                newPanes[idx].activeTabIdx = tabIdx;
                                return newPanes;
                              });
                              setActivePaneIdx(idx);
                              setActiveNotePath(tabPath);
                            }}
                            onMouseDown={(e) => {
                              if (e.button === 1) {
                                e.preventDefault();
                                e.stopPropagation();
                                closeTabAt(idx, tabIdx);
                              }
                            }}
                            onAuxClick={(e) => e.preventDefault()}
                            className={`pane-tab ${isTabActive ? 'active' : ''}`}
                          >
                            <FileText size={12} />
                            <span>{noteName}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenTabOnRight(tabPath, idx);
                              }}
                              className="pane-tab-split"
                              title="Sağda aç"
                            >
                              <ArrowRight size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                closeTabAt(idx, tabIdx);
                              }}
                              className="pane-tab-close"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => {
                          const name = prompt('Yeni Not Adı:');
                          if (name && name.trim()) {
                            handleCreateNote(name.trim(), selectedFolder);
                          }
                        }}
                        className="pane-tab-add"
                        title="Yeni Sekme"
                      >
                        <Plus size={12} />
                      </button>
                      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                          "Breadcrumb gibi bir şey — az önce açtığım nota dönmek istiyorum" isteği:
                          açık sekmelerden bağımsız olarak son görüntülenen notlara hızlı dönüş. */}
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setHistoryDropdownPaneIdx(historyDropdownPaneIdx === idx ? null : idx);
                          }}
                          className="pane-tab-add"
                          title="Son Görüntülenen Notlar"
                        >
                          <Clock size={12} />
                        </button>
                        {historyDropdownPaneIdx === idx && (
                          <>
                            <div
                              onClick={() => setHistoryDropdownPaneIdx(null)}
                              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                            />
                            <div
                              className="context-menu-container"
                              style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', minWidth: '220px', maxWidth: '280px', zIndex: 50 }}
                            >
                              {(() => {
                                const recentPaths = noteViewHistory.filter(p => p !== activePath && notes.some(n => n.path === p));
                                if (recentPaths.length === 0) {
                                  return (
                                    <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                                      Henüz görüntülenen başka not yok
                                    </div>
                                  );
                                }
                                return recentPaths.map(path => {
                                  const parts = path.split('/');
                                  const name = parts.pop()?.replace(/\.(md|excalidraw|drawio)$/, '') || path;
                                  const folder = parts.join('/');
                                  return (
                                    <ContextMenuItem
                                      key={path}
                                      onClick={() => {
                                        setPaneActiveNotePath(path);
                                        setHistoryDropdownPaneIdx(null);
                                      }}
                                    >
                                      <Clock size={14} />
                                      <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                        {folder && (
                                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {folder}
                                          </span>
                                        )}
                                      </span>
                                    </ContextMenuItem>
                                  );
                                });
                              })()}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <NotesView
                      selectedFolder={selectedFolder}
                      selectedTag={selectedTag}
                      fileContents={fileContents}
                      notes={notes}
                      activeNotePath={activePath}
                      setActiveNotePath={setPaneActiveNotePath}
                      onSaveNote={handleSaveNote}
                      onDeletePath={handleDeletePath}
                      onCreateNote={handleCreateNote}
                      readNoteContent={handleReadNoteContent}
                      onRenameNote={handleRenameNote}
                      onNoteContextMenu={handleNoteContextMenu}
                      onRequestConfirm={requestConfirm}
                      onSearchWeb={(query) => {
                        setBrowserInitialQuery(query);
                        setActiveTab('browser');
                      }}
                      folderCustomizations={folderCustomizations}
                      hideSidebar={idx !== 0}
                      onShowProperties={(path) => setShowPropertiesPath(path)}
                      pinnedWidgetLists={pinnedWidgetLists}
                      pinnedWidgetList={pinnedWidgetList}
                      onUpdatePinnedWidgets={updatePinnedWidgets}
                      onSplitWorkspace={panes.length < 3 ? () => {
                        const nextPath = activePath || '';
                        setPanes(prev => [...prev, {
                          id: `pane-${Date.now()}`,
                          tabs: nextPath ? [nextPath] : [],
                          activeTabIdx: 0
                        }]);
                        setActivePaneIdx(panes.length);
                      } : undefined}
                      onClosePane={panes.length > 1 ? () => {
                        setPanes(prev => {
                          const newPanes = prev.filter((_, i) => i !== idx);
                          const nextIdx = Math.max(0, idx - 1);
                          setActivePaneIdx(nextIdx);
                          const nextPane = newPanes[nextIdx];
                          setActiveNotePath(nextPane ? (nextPane.tabs[nextPane.activeTabIdx] || null) : null);
                          return newPanes;
                        });
                      } : undefined}
                      isFlowEffectsEnabled={isFlowEffectsEnabled}
                      templatesFolder={templatesFolder}
                      mindmapLayouts={mindmapLayouts}
                      onSaveMindmapLayout={handleSaveMindmapLayout}
                      lineHeight={lineHeight}
                      lineMargin={lineMargin}
                    />
                  </div>
                  {idx < panes.length - 1 && (
                    <div
                      className="pane-resize-gutter"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const container = (e.currentTarget.parentElement) as HTMLElement;
                        paneResizeState.current = {
                          idx,
                          startX: e.clientX,
                          startLeft: paneWidths[idx] ?? (100 / panes.length),
                          startRight: paneWidths[idx + 1] ?? (100 / panes.length),
                          containerWidth: container ? container.getBoundingClientRect().width : window.innerWidth,
                        };
                        document.body.style.cursor = 'col-resize';
                        document.body.style.userSelect = 'none';
                      }}
                    >
                      <GripVertical size={12} />
                    </div>
                  )}
                  </Fragment>
                );
              })}
            </div>
            <div className={`notes-quick-panel ${rightPanelExpanded ? 'expanded' : ''}`} style={{ width: rightPanelExpanded ? rightPanelWidth : 44 }}>
              {rightPanelExpanded && (
                <div
                  className="notes-quick-panel-resize"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    isResizingRightPanel.current = true;
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                  }}
                />
              )}

              <div className="notes-quick-rail">
                <button
                  className={`notes-quick-rail-btn ${rightPanelExpanded && rightPanelView === 'search' ? 'active' : ''}`}
                  title="Arama"
                  onClick={() => {
                    if (rightPanelExpanded && rightPanelView === 'search') {
                      setRightPanelExpanded(false);
                    } else {
                      setRightPanelView('search');
                      setRightPanelExpanded(true);
                    }
                  }}
                >
                  <Search size={18} />
                </button>
                <button
                  className={`notes-quick-rail-btn ${rightPanelExpanded && rightPanelView === 'calendar' ? 'active' : ''}`}
                  title="Takvim"
                  onClick={() => {
                    if (rightPanelExpanded && rightPanelView === 'calendar') {
                      setRightPanelExpanded(false);
                    } else {
                      setRightPanelView('calendar');
                      setRightPanelExpanded(true);
                    }
                  }}
                >
                  <Calendar size={18} />
                </button>
              </div>

              {rightPanelExpanded && (
                <div className="notes-quick-panel-content">
                  {rightPanelView === 'search' ? (
                    <div className="notes-quick-search">
                      <input
                        type="text"
                        autoFocus
                        placeholder="Arama..."
                        value={globalSearchQuery}
                        onChange={(e) => setGlobalSearchQuery(e.target.value)}
                        className="notes-quick-search-input"
                      />
                      <div className="notes-quick-search-results">
                        {!globalSearchQuery.trim() ? (
                          <div className="notes-quick-panel-empty">Aramak istediğiniz kelimeyi yazın...</div>
                        ) : getSearchResults().length === 0 ? (
                          <div className="notes-quick-panel-empty">Eşleşen not bulunamadı.</div>
                        ) : (
                          getSearchResults().map(note => {
                            const content = fileContents[note.path] || '';
                            const snippet = getSearchSnippet(content, globalSearchQuery);
                            return (
                              <div
                                key={note.path}
                                className="notes-quick-search-result"
                                onClick={() => handleOpenSearchResult(note.path)}
                              >
                                <div className="notes-quick-search-result-title">{note.name.replace('.md', '')}</div>
                                {snippet && (
                                  <div
                                    className="notes-quick-search-result-snippet"
                                    dangerouslySetInnerHTML={{ __html: snippet }}
                                  />
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="notes-quick-calendar">
                      <CalendarView
                        embedded
                        notes={notes}
                        folders={folders}
                        tags={tags}
                        readNoteContent={handleReadNoteContent}
                        onSaveNote={handleSaveNote}
                        onCreateDailyNote={handleCreateDailyNote}
                        onSelectDateNotes={handleSelectDateNotes}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <TasksView
              notes={notes}
              folders={folders}
              tags={tags}
              readNoteContent={handleReadNoteContent}
              onSaveNote={handleSaveNote}
              setActiveNotePath={handleSetActiveNotePath}
              setActiveTab={setActiveTab}
              selectedTag={selectedTag}
              selectedFolder={selectedFolder}
              onRequestConfirm={requestConfirm}
            />
          )}

          {activeTab === 'timeline' && (
            <TimelineView
              timelineItems={timelineItems.filter(item => !item.isSubtask)}
              selectedTag={selectedTag}
              selectedFolder={selectedFolder}
              onToggleTodo={handleToggleTodo}
              onOpenNote={handleOpenTimelineNote}
              notes={notes}
              scannedContents={fileContents}
              onOpenNotePath={(path: string) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
              folderCustomizations={folderCustomizations}
              onViewHistory={handleViewNoteHistory}
            />
          )}

          <div style={{ display: activeTab === 'calendar' ? 'block' : 'none', height: '100%' }}>
            <CalendarView
              notes={notes}
              folders={folders}
              tags={tags}
              readNoteContent={handleReadNoteContent}
              onSaveNote={handleSaveNote}
              onCreateDailyNote={handleCreateDailyNote}
              onSelectDateNotes={handleSelectDateNotes}
            />
          </div>

          {activeTab === 'projects' && (
            <ProjectsView
              timelineItems={timelineItems}
              notes={notes}
              scannedContents={fileContents}
              onChangeTaskStatus={handleChangeTaskStatus}
              onOpenNote={(item) => {
                if (item.note) {
                  let relativePath = '';
                  if (item.folder) {
                    relativePath = `${item.folder}/${item.note.replace(/\s+/g, '_')}.md`;
                  } else {
                    relativePath = `${item.note.replace(/\s+/g, '_')}.md`;
                  }
                  handleSetActiveNotePath(relativePath);
                  setActiveTab('notes');
                }
              }}
            />
          )}

          {activeTab === 'db' && (
            <DatabaseView
              items={timelineItems.filter(item => !item.isSubtask)}
              selectedTag={selectedTag}
              selectedFolder={selectedFolder}
              onToggleTodo={handleToggleTodo}
            />
          )}

          {activeTab === 'finance' && (
            <FinanceView
              notes={notes}
              fileContents={fileContents}
              onSelectNote={(path) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
              onCreateNote={handleCreateNote}
              onSaveNote={handleSaveNote}
            />
          )}

          {activeTab === 'srs' && (
            <FlashcardView
              notes={notes}
              fileContents={fileContents}
              onSelectNote={(path) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
              onSaveNote={handleSaveNote}
              onRequestConfirm={requestConfirm}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsView
              notes={notes}
              fileContents={fileContents}
              onSelectNote={(path) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
            />
          )}

          {activeTab === 'city' && (
            <CityBuilderView
              notes={notes}
              fileContents={fileContents}
              onSelectNote={(path) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
            />
          )}

          {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
              Ortam Sesleri (Ambient Soundboard Mixer) sekmesi seçildiğinde ses mikseri bileşenini çağırır. */}
          {activeTab === 'ambient' && (
            <AmbientMixerView />
          )}

          {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
              Fikir Örsü (Forge Workbench) sekmesi seçildiğinde not birleştirme ve dövme bileşenini çağırır. */}
          {activeTab === 'forge' && (
            <ForgeWorkbenchView
              notes={notes}
              fileContents={fileContents}
              onSaveNote={handleSaveNote}
              onSelectNote={(path) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
            />
          )}
          {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
              Not Mentorü (Note-Taking Academy) sekmesi seçildiğinde, mesleki yönlendirici not sihirbazını çağırır. */}
          {activeTab === 'mentor' && (
            <NoteMentorView
              notes={notes}
              onSaveNote={handleSaveNote}
              onSelectNote={(path) => {
                handleSetActiveNotePath(path);
                setActiveTab('notes');
              }}
            />
          )}

          {activeTab === 'browser' && (
            <BrowserView
              notes={notes}
              folders={folders}
              onSaveNote={handleSaveNote}
              readNoteContent={handleReadNoteContent}
              initialQuery={browserInitialQuery}
              onClearInitialQuery={() => setBrowserInitialQuery(null)}
            />
          )}

          {activeTab === 'music' && (
            <MusicPlayerView
              tracks={tracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              onPlayTrack={handlePlayTrack}
              onNext={handleNextTrack}
              onPrev={handlePrevTrack}
              onAddTracks={handleAddTracks}
              onRemoveTrack={handleRemoveTrack}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              volume={volume}
              onVolumeChange={setVolume}
              isShuffle={isShuffle}
              onToggleShuffle={() => setIsShuffle(prev => !prev)}
              isRepeat={isRepeat}
              onToggleRepeat={() => setIsRepeat(prev => !prev)}
              onDownloadTrack={handleDownloadTrack}
              missingTracks={missingTracks}
              onDownloadMissingTrack={handleDownloadMissingTrack}
              onDownloadAllMissing={handleDownloadAllMissing}
              onAddYoutubeTrack={handleAddYoutubeTrack}
            />
          )}
        </main>
      </div>

      {/* Premium Glassmorphic Modal for Creating a Folder */}
      {isFolderModalOpen && (
        <div className="modal-overlay animate-fade">
          <div className="modal-content animate-pop">
            <div className="modal-header">
              <h3>Yeni Klasör Oluştur</h3>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleConfirmCreateFolder();
            }}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Üst Klasör (İsteğe Bağlı):</label>
                  <select
                    value={parentFolder}
                    onChange={(e) => setParentFolder(e.target.value)}
                    className="modal-input"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', width: '100%', cursor: 'pointer' }}
                  >
                    <option value="">[Kök Dizin (Üst Klasör Yok)]</option>
                    {folders.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Yeni Klasör Adı:</label>
                  <input
                    type="text"
                    placeholder="Klasör adı (örn: Borusan, Raporlar)..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="modal-input"
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-modal-cancel" onClick={() => {
                  setIsFolderModalOpen(false);
                  setNewFolderName('');
                  setParentFolder('');
                }}>
                  İptal
                </button>
                <button type="submit" className="btn-modal-confirm" disabled={!newFolderName.trim()}>
                  Oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Gelişim yolu AI sihirbazı: kendini tanımlama -> (gerekirse) netleştirme sorusu
          döngüsü -> seviye/konu klasörlerinin oluşturulması. Faz 1'in isFolderModalOpen
          şablonuyla aynı .modal-overlay/.modal-content deseni kullanılır. */}
      {devPathWizardTarget && (
        <div className="modal-overlay animate-fade">
          <div className="modal-content animate-pop" style={devPathWizardPreview ? { maxWidth: '520px', maxHeight: '82vh', display: 'flex', flexDirection: 'column' } : undefined}>
            <div className="modal-header">
              <h3>AI Gelişim Mentoru</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                "{devPathWizardTarget.split('/').pop()}" için seviyeni belirleyelim
              </p>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: devPathWizardPreview ? 'auto' : undefined }}>
              {devPathWizardError && (
                <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#ef4444', fontSize: '12px' }}>
                  {devPathWizardError}
                </div>
              )}
              {devPathWizardPreview ? (
                // BUG DÜZELTMESİ (yanlış anlaşılan hedef): AI'nin ürettiği sonucu diske
                // yazmadan ÖNCE burada gösteriyoruz — kullanıcı alakasız konuları tek tek
                // kaldırabilir VEYA "bu yanlış" deyip düzeltme yazıp yeniden ürettirebilir.
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(99,102,241,0.08)', border: '1px solid var(--accent-color)' }}>
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Belirlenen Seviye</span>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-color)' }}>{devPathWizardPreview.levelTitle}</div>
                  </div>
                  {devPathWizardPreview.priorLevels.length > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      + {devPathWizardPreview.priorLevels.length} önceki seviye de (geçilmiş olarak) otomatik oluşturulacak.
                    </span>
                  )}
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Konular ({devPathWizardPreview.topics.length})
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {devPathWizardPreview.topics.map((topic, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{topic.title}</span>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>{topic.description}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemovePreviewTopic(idx)}
                          disabled={devPathWizardBusy}
                          title="Bu konuyu kaldır"
                          style={{ flexShrink: 0, width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-muted)', cursor: devPathWizardBusy ? 'default' : 'pointer', fontSize: '11px' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {!devPathWizardShowCorrection ? (
                    <button
                      type="button"
                      onClick={() => setDevPathWizardShowCorrection(true)}
                      disabled={devPathWizardBusy}
                      style={{ alignSelf: 'flex-start', fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(234,179,8,0.4)', background: 'transparent', color: '#eab308', cursor: devPathWizardBusy ? 'default' : 'pointer' }}
                    >
                      Bu yanlış anlaşılmış, düzelt
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', borderRadius: '8px', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.25)' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Ne kastettiğini/neyin yanlış olduğunu yaz, aynı bağlamla yeniden üretilsin:</label>
                      <textarea
                        value={devPathWizardCorrectionText}
                        onChange={(e) => setDevPathWizardCorrectionText(e.target.value)}
                        placeholder="ör. Framework detaylarına değil, gerçek sistem tasarımı/mimari konularına odaklan..."
                        className="modal-input"
                        rows={3}
                        style={{ resize: 'vertical', width: '100%' }}
                        disabled={devPathWizardBusy}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleDevPathWizardRegenerateWithCorrection}
                        disabled={!devPathWizardCorrectionText.trim() || devPathWizardBusy}
                        style={{ alignSelf: 'flex-start', fontSize: '11px', padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#eab308', color: '#1c1400', fontWeight: 600, cursor: (!devPathWizardCorrectionText.trim() || devPathWizardBusy) ? 'default' : 'pointer' }}
                      >
                        Yeniden Oluştur
                      </button>
                    </div>
                  )}
                </div>
              ) : !devPathWizardQuestion ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Şu an ne iş yapıyorsun / deneyimin nedir?
                    </label>
                    <textarea
                      value={devPathWizardCurrentDesc}
                      onChange={(e) => setDevPathWizardCurrentDesc(e.target.value)}
                      placeholder="ör. Mid-level ASP.NET yazılım mühendisiyim / Yeni başlıyorum, hiç deneyimim yok..."
                      className="modal-input"
                      rows={3}
                      style={{ resize: 'vertical', width: '100%' }}
                      autoFocus
                      disabled={devPathWizardBusy}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Hangi role/seviyeye doğru gitmek istiyorsun?
                    </label>
                    <textarea
                      value={devPathWizardGoalDesc}
                      onChange={(e) => setDevPathWizardGoalDesc(e.target.value)}
                      placeholder="ör. Yazılım mimarı olmak istiyorum, bu konuda yeni başlıyorum..."
                      className="modal-input"
                      rows={3}
                      style={{ resize: 'vertical', width: '100%' }}
                      disabled={devPathWizardBusy}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Not oluşturma modu (bu alandaki tüm seviyeler için geçerli)
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {([
                        { value: 'basic' as const, title: 'Basic', desc: 'Her konu için tek bir başlangıç notu.' },
                        { value: 'advanced' as const, title: 'Advance', desc: 'Ana not + wikilink ile bağlı birden fazla alt-not.' },
                        { value: 'complete' as const, title: 'Complete', desc: 'Advance + notlardan otomatik üretilen soru kartları.' }
                      ]).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={devPathWizardBusy}
                          onClick={() => setDevPathWizardNoteMode(opt.value)}
                          style={{
                            textAlign: 'left', padding: '8px 10px', borderRadius: '8px',
                            border: `1px solid ${devPathWizardNoteMode === opt.value ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            background: devPathWizardNoteMode === opt.value ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                            cursor: devPathWizardBusy ? 'default' : 'pointer'
                          }}
                        >
                          <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{opt.title}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>{devPathWizardQuestion.question}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {devPathWizardQuestion.options.map(opt => (
                      <button
                        key={opt}
                        type="button"
                        disabled={devPathWizardBusy}
                        onClick={() => handleDevPathWizardSelectOption(opt)}
                        style={{ textAlign: 'left', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: devPathWizardBusy ? 'default' : 'pointer', fontSize: '12.5px' }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {devPathWizardBusy && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>AI düşünüyor...</span>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => setDevPathWizardTarget(null)}>
                İptal
              </button>
              {devPathWizardPreview ? (
                <button
                  type="button"
                  className="btn-modal-confirm"
                  disabled={devPathWizardBusy || devPathWizardPreview.topics.length === 0}
                  onClick={handleDevPathWizardConfirmPreview}
                >
                  Onayla ve Oluştur
                </button>
              ) : !devPathWizardQuestion && (
                <button
                  type="button"
                  className="btn-modal-confirm"
                  disabled={(!devPathWizardCurrentDesc.trim() && !devPathWizardGoalDesc.trim()) || devPathWizardBusy}
                  onClick={handleDevPathWizardSubmitDescription}
                >
                  Devam Et
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Özet modalı — "Test Et" ÖNCESİ ön koşul. Kullanıcı konuyu kendi cümleleriyle
          özetler, AI onaylarsa konu 'summaryApproved' olur ve quiz açılır. */}
      {devPathSummaryTarget && (() => {
        const summaryTopic = developmentPaths[devPathSummaryTarget.path]?.levels?.[devPathSummaryTarget.levelIdx]?.topics[devPathSummaryTarget.topicIdx];
        return (
          <div className="modal-overlay animate-fade">
            <div className="modal-content animate-pop">
              <div className="modal-header">
                <h3>Konuyu Özetle</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  "{summaryTopic?.title}" — notlarını okuyup kendi cümlelerinle özetle
                </p>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {devPathSummaryError && (
                  <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#ef4444', fontSize: '12px' }}>
                    {devPathSummaryError}
                  </div>
                )}
                {devPathSummaryResult ? (
                  <div style={{
                    padding: '12px', borderRadius: '8px',
                    background: devPathSummaryResult.approved ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
                    border: `1px solid ${devPathSummaryResult.approved ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.3)'}`
                  }}>
                    <strong style={{ display: 'block', marginBottom: '6px', color: devPathSummaryResult.approved ? '#22c55e' : '#eab308' }}>
                      {devPathSummaryResult.approved ? '✅ Onaylandı!' : '📝 Henüz Değil'}
                    </strong>
                    <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>{devPathSummaryResult.feedback}</span>
                  </div>
                ) : (
                  <textarea
                    value={devPathSummaryText}
                    onChange={(e) => setDevPathSummaryText(e.target.value)}
                    placeholder="Bu konuda öğrendiklerini kendi cümlelerinle özetle..."
                    className="modal-input"
                    rows={6}
                    style={{ resize: 'vertical', width: '100%' }}
                    autoFocus
                    disabled={devPathSummaryBusy}
                  />
                )}
                {devPathSummaryBusy && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>AI değerlendiriyor...</span>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-modal-cancel" onClick={() => setDevPathSummaryTarget(null)}>
                  {devPathSummaryResult ? 'Kapat' : 'Vazgeç'}
                </button>
                {!devPathSummaryResult && (
                  <button
                    type="button"
                    className="btn-modal-confirm"
                    disabled={!devPathSummaryText.trim() || devPathSummaryBusy}
                    onClick={handleSubmitTopicSummary}
                  >
                    Gönder
                  </button>
                )}
                {devPathSummaryResult && !devPathSummaryResult.approved && (
                  <button
                    type="button"
                    className="btn-modal-confirm"
                    onClick={() => { setDevPathSummaryResult(null); setDevPathSummaryError(null); }}
                  >
                    Tekrar Dene
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Konu testi (quiz) modalı — AI'nin ürettiği soruları gösterir, cevaplar
          gönderilince AI değerlendirir ve geçilirse konu 'passed' olur. */}
      {devPathQuizTarget && (
        <div className="modal-overlay animate-fade">
          <div className="modal-content animate-pop">
            <div className="modal-header">
              <h3>Konu Testi</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {developmentPaths[devPathQuizTarget.path]?.levels?.[devPathQuizTarget.levelIdx]?.topics[devPathQuizTarget.topicIdx]?.title}
              </p>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '50vh', overflowY: 'auto' }}>
              {devPathQuizError && (
                <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#ef4444', fontSize: '12px' }}>
                  {devPathQuizError}
                </div>
              )}
              {devPathQuizBusy && !devPathQuizResult && devPathQuizQuestions.length === 0 && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sınav hazırlanıyor...</span>
              )}
              {devPathQuizResult ? (
                <div style={{
                  padding: '12px', borderRadius: '8px',
                  background: devPathQuizResult.passed ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
                  border: `1px solid ${devPathQuizResult.passed ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.3)'}`
                }}>
                  <strong style={{ display: 'block', marginBottom: '6px', color: devPathQuizResult.passed ? '#22c55e' : '#eab308' }}>
                    {devPathQuizResult.passed ? '✅ Geçtin!' : '📝 Henüz Değil'}
                  </strong>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>{devPathQuizResult.feedback}</span>
                  {devPathQuizResult.weakAreas && devPathQuizResult.weakAreas.length > 0 && (
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${devPathQuizResult.passed ? 'rgba(34,197,94,0.2)' : 'rgba(234,179,8,0.2)'}` }}>
                      <strong style={{ display: 'block', marginBottom: '6px', fontSize: '11.5px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        {devPathQuizResult.passed ? 'Gözden geçirmen faydalı olur:' : 'Öncelikle şunları tekrar çalış:'}
                      </strong>
                      <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {devPathQuizResult.weakAreas.map((area, i) => (
                          <li key={i} style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>{area}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                devPathQuizQuestions.map((q, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>{i + 1}. {q}</label>
                    <textarea
                      value={devPathQuizAnswers[i] || ''}
                      onChange={(e) => setDevPathQuizAnswers(prev => prev.map((a, idx) => idx === i ? e.target.value : a))}
                      className="modal-input"
                      rows={2}
                      style={{ width: '100%' }}
                      disabled={devPathQuizBusy}
                    />
                  </div>
                ))
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => setDevPathQuizTarget(null)}>
                {devPathQuizResult ? 'Kapat' : 'Vazgeç'}
              </button>
              {!devPathQuizResult && devPathQuizQuestions.length > 0 && (
                <button
                  type="button"
                  className="btn-modal-confirm"
                  disabled={devPathQuizBusy || devPathQuizAnswers.some(a => !a.trim())}
                  onClick={handleSubmitDevPathQuiz}
                >
                  Gönder
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          "Gelişim Yolu Detayı" paneli — tüm seviyeleri ve konularını listeler; önceki
          seviyelerden geçilmiş bir konu "Bunu Bilmiyorum" ile tekrar açığa alınabilir. */}
      {devPathDetailTarget && developmentPaths[devPathDetailTarget] && (
        <div className="modal-overlay animate-fade" onClick={() => setDevPathDetailTarget(null)}>
          <div
            className="modal-content animate-pop"
            style={{ maxWidth: '540px', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{developmentPaths[devPathDetailTarget].label}</h3>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {(developmentPaths[devPathDetailTarget].levels || []).map((level, levelIdx) => {
                const isCurrent = levelIdx === (developmentPaths[devPathDetailTarget].currentLevelIndex ?? 0);
                return (
                  <div key={levelIdx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <strong style={{ fontSize: '13px', color: isCurrent ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                      Seviye {levelIdx + 1}: {level.title} {isCurrent && '(Mevcut)'}
                    </strong>
                    {level.topics.map((topic, topicIdx) => {
                      const hasNotes = getUserNotesInTopicFolder(topic.folderPath, topic.systemNoteNames || []).length > 0;
                      const daysSince = getFolderLastActivityDays(topic.folderPath, topic.systemNoteNames || []);
                      const isStale = topic.status !== 'passed' && (daysSince === null || daysSince >= 3);
                      const isBusyHere = devPathTopicActionBusy?.levelIdx === levelIdx && devPathTopicActionBusy?.topicIdx === topicIdx;
                      const messageHere = devPathTopicActionMessage?.levelIdx === levelIdx && devPathTopicActionMessage?.topicIdx === topicIdx ? devPathTopicActionMessage.text : null;
                      const activityLabel = daysSince === null ? 'Henüz not yok' : daysSince === 0 ? 'Bugün çalışıldı 🔥' : daysSince === 1 ? 'Dün çalışıldı' : `Son çalışma: ${daysSince} gün önce`;
                      return (
                        <div key={topicIdx} style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {topic.status === 'passed' ? '✅' : topic.status === 'testable' ? '🟡' : topic.status === 'flagged_unknown' ? '⚠️' : '⬜'} {topic.title}
                            </span>
                            <button
                              type="button"
                              onClick={() => { setSelectedFolder(topic.folderPath); setDevPathDetailTarget(null); }}
                              style={{ fontSize: '10px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '2px 6px', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                              Klasöre Git
                            </button>
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{topic.description}</span>
                          {topic.status !== 'passed' && (
                            <span style={{ fontSize: '10px', color: isStale ? '#f59e0b' : 'var(--text-muted)' }}>
                              {activityLabel}
                            </span>
                          )}
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {topic.status !== 'passed' && hasNotes && !topic.summaryApproved && (
                              <button
                                type="button"
                                onClick={() => handleOpenSummaryModal(devPathDetailTarget, levelIdx, topicIdx)}
                                style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #22c55e', background: '#22c55e', color: '#fff', cursor: 'pointer' }}
                                title="Konuyu kendi cümlelerinle özetle — AI onaylarsa Test Et açılır"
                              >
                                📝 Özet Gönder
                              </button>
                            )}
                            {topic.status !== 'passed' && (
                              <button
                                type="button"
                                disabled={!hasNotes || !topic.summaryApproved}
                                onClick={() => handleOpenDevPathQuiz(devPathDetailTarget, levelIdx, topicIdx)}
                                style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--accent-color)', background: (hasNotes && topic.summaryApproved) ? 'var(--accent-color)' : 'transparent', color: (hasNotes && topic.summaryApproved) ? '#fff' : 'var(--text-muted)', cursor: (hasNotes && topic.summaryApproved) ? 'pointer' : 'not-allowed' }}
                                title={!hasNotes ? 'Önce bu konuda not almalısın' : !topic.summaryApproved ? 'Önce özetini gönderip onaylatmalısın' : ''}
                              >
                                Test Et
                              </button>
                            )}
                            {topic.status !== 'passed' && (
                              <button
                                type="button"
                                disabled={!hasNotes || isBusyHere}
                                onClick={() => handleGenerateFlashcardsForTopic(devPathDetailTarget, levelIdx, topicIdx)}
                                style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(139,92,246,0.4)', background: 'transparent', color: hasNotes ? '#a78bfa' : 'var(--text-muted)', cursor: hasNotes && !isBusyHere ? 'pointer' : 'not-allowed' }}
                                title={hasNotes ? 'Bu konudaki notlardan ezber kartı üret' : 'Önce bu konuda not almalısın'}
                              >
                                🃏 {isBusyHere ? 'Üretiliyor...' : 'Kart Oluştur'}
                              </button>
                            )}
                            {isStale && (
                              <button
                                type="button"
                                disabled={isBusyHere}
                                onClick={() => handleAddCalendarReminderForTopic(devPathDetailTarget, levelIdx, topicIdx)}
                                style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.4)', background: 'transparent', color: '#60a5fa', cursor: isBusyHere ? 'not-allowed' : 'pointer' }}
                                title="Yarının takvimine bu konuya çalışma hatırlatması ekle"
                              >
                                📅 Yarına Ekle
                              </button>
                            )}
                            {topic.status === 'passed' && !isCurrent && (
                              <button
                                type="button"
                                onClick={() => handleFlagTopicUnknown(devPathDetailTarget, levelIdx, topicIdx)}
                                style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(234,179,8,0.4)', background: 'transparent', color: '#eab308', cursor: 'pointer' }}
                              >
                                Bunu Bilmiyorum
                              </button>
                            )}
                            {/* BUG DÜZELTMESİ (yanlış anlaşılan hedef): AI mevcut seviyeye
                                alakasız bir konu ürettiyse, kullanıcı bunu sonradan da
                                (sadece sihirbaz önizlemesinde değil) kaldırabilsin diye. */}
                            {isCurrent && topic.status !== 'passed' && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCurrentTopic(devPathDetailTarget, levelIdx, topicIdx)}
                                style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                              >
                                Kaldır
                              </button>
                            )}
                          </div>
                          {messageHere && (
                            <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>{messageHere}</span>
                          )}
                        </div>
                      );
                    })}
                    {/* BUG DÜZELTMESİ (yanlış anlaşılan hedef): müfredatta eksik olduğu
                        fark edilen bir konuyu mevcut seviyeye sonradan da ekleyebilmek için. */}
                    {isCurrent && (
                      devPathAddTopicTarget?.path === devPathDetailTarget && devPathAddTopicTarget?.levelIdx === levelIdx ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', borderRadius: '8px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)' }}>
                          {devPathAddTopicError && (
                            <span style={{ fontSize: '10.5px', color: '#ef4444' }}>{devPathAddTopicError}</span>
                          )}
                          <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Eksik olduğunu düşündüğün konuyu tarif et (boş bırakırsan AI kendisi karar verir):</label>
                          <textarea
                            value={devPathAddTopicHint}
                            onChange={(e) => setDevPathAddTopicHint(e.target.value)}
                            placeholder="ör. Kapasite planlama, sistem tasarımında ölçeklenme hesapları..."
                            className="modal-input"
                            rows={2}
                            style={{ resize: 'vertical', width: '100%' }}
                            disabled={devPathAddTopicBusy}
                            autoFocus
                          />
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={handleConfirmAddTopic}
                              disabled={devPathAddTopicBusy}
                              style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '6px', border: 'none', background: 'var(--accent-color)', color: '#fff', fontWeight: 600, cursor: devPathAddTopicBusy ? 'default' : 'pointer' }}
                            >
                              {devPathAddTopicBusy ? 'Ekleniyor...' : 'Konu Öner ve Ekle'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDevPathAddTopicTarget(null)}
                              disabled={devPathAddTopicBusy}
                              style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: devPathAddTopicBusy ? 'default' : 'pointer' }}
                            >
                              Vazgeç
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenAddTopic(devPathDetailTarget, levelIdx)}
                          style={{ alignSelf: 'flex-start', fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          + Konu Ekle
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => setDevPathDetailTarget(null)}>Kapat</button>
            </div>
          </div>
        </div>
      )}

      {/* Folder Customizer Modal */}
      {isCustomizerOpen && customizingFolder && (
        <div className="modal-overlay animate-fade">
          <div className="modal-content animate-pop folder-customizer-modal">
            <div className="modal-header">
              <h3>Klasör Simgesi ve Rengi</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {customizingFolder} klasörünü özelleştirin
              </p>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Renk Seçin
                </label>
                <div className="color-palette-grid">
                  {[
                    { name: 'Varsayılan', value: '' },
                    { name: 'Mavi', value: '#3b82f6' },
                    { name: 'Zümrüt', value: '#10b981' },
                    { name: 'Mor', value: '#8b5cf6' },
                    { name: 'Kehribar', value: '#f59e0b' },
                    { name: 'Gül', value: '#f43f5e' },
                    { name: 'Pembe', value: '#ec4899' },
                    { name: 'Turkuaz', value: '#06b6d4' },
                    { name: 'Turuncu', value: '#f97316' },
                    { name: 'İndigo', value: '#6366f1' }
                  ].map((colorObj) => (
                    <button
                      key={colorObj.name}
                      type="button"
                      className={`color-option-btn ${selectedColor === colorObj.value ? 'selected' : ''}`}
                      onClick={() => setSelectedColor(colorObj.value)}
                      style={{
                        backgroundColor: colorObj.value || '#71717a',
                        position: 'relative'
                      }}
                      title={colorObj.name}
                    >
                      {selectedColor === colorObj.value && (
                        <div 
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: '#fff',
                            boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Simge Seçin
                </label>
                <div className="icon-palette-grid">
                  {[
                    { key: 'Folder', label: 'Klasör', component: Folder },
                    { key: 'Briefcase', label: 'İş', component: Briefcase },
                    { key: 'Code', label: 'Yazılım', component: Code },
                    { key: 'Heart', label: 'Kişisel', component: Heart },
                    { key: 'Star', label: 'Önemli', component: Star },
                    { key: 'BookOpen', label: 'Öğrenim', component: BookOpen },
                    { key: 'Database', label: 'Veri', component: Database },
                    { key: 'Inbox', label: 'Fikir', component: Inbox },
                    { key: 'Calendar', label: 'Takvim', component: Calendar },
                    { key: 'Sparkles', label: 'İlham', component: Sparkles },
                    { key: 'Coffee', label: 'Sosyal', component: Coffee },
                    { key: 'Rocket', label: 'Hedefler', component: Rocket },
                    { key: 'Smile', label: 'Eğlence', component: Smile }
                  ].map((iconObj) => {
                    const IconComponent = iconObj.component;
                    return (
                      <button
                        key={iconObj.key}
                        type="button"
                        className={`icon-option-btn ${selectedIcon === iconObj.key ? 'selected' : ''}`}
                        onClick={() => setSelectedIcon(iconObj.key)}
                      >
                        <IconComponent size={16} style={{ color: selectedColor || undefined }} />
                        <span>{iconObj.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                type="button" 
                className="btn-modal-cancel" 
                onClick={() => {
                  handleClearFolderCustomization(customizingFolder);
                }}
                style={{ marginRight: 'auto', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
              >
                Özelleştirmeyi Kaldır
              </button>
              <button 
                type="button" 
                className="btn-modal-cancel" 
                onClick={() => {
                  setIsCustomizerOpen(false);
                  setCustomizingFolder(null);
                }}
              >
                İptal
              </button>
              <button 
                type="button" 
                className="btn-modal-confirm" 
                style={{ background: selectedColor || 'var(--accent-color)', color: '#fff' }}
                onClick={() => {
                  handleSaveFolderCustomization(customizingFolder, selectedColor, selectedIcon);
                }}
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Premium Glassmorphic Supabase Settings Modal */}
      {isSettingsModalOpen && (
        <div className="modal-overlay animate-fade" onClick={() => setIsSettingsModalOpen(false)} style={{ zIndex: 2000 }}>
          <div className="modal-content animate-pop" onClick={(e) => e.stopPropagation()} style={{
            maxWidth: '650px',
            width: '95%',
            padding: '0',
            display: 'flex',
            flexDirection: 'row',
            overflow: 'hidden',
            // Çöp Kutusu sekmesinde liste kısa sürede kaydırma gerektirdiği (aynı anda ~2
            // öğe görünüyordu) için o sekmede modalı belirgin şekilde daha uzun yapıyoruz;
            // diğer sekmelerin yerleşimini bozmamak için yalnızca 'trash' seçiliyken.
            height: settingsTab === 'trash' ? '640px' : '460px',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            position: 'relative'
          }}>
            {/* Top-Right Close Button (X) */}
            <button
              type="button"
              onClick={() => setIsSettingsModalOpen(false)}
              style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                zIndex: 50
              }}
              className="btn-modal-close-x"
              title="Kapat"
            >
              <X size={16} />
            </button>
            {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                Çok sayfalı ayarlar paneli için sol taraftaki kategori/sekme barı. */}
            <div className="settings-sidebar" style={{ 
              width: '180px', 
              background: 'rgba(255, 255, 255, 0.015)', 
              borderRight: '1px solid rgba(255, 255, 255, 0.05)', 
              display: 'flex', 
              flexDirection: 'column', 
              padding: '24px 10px', 
              gap: '6px' 
            }}>
              <div style={{ padding: '0 12px 14px 12px', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '8px' }}>
                ⚙️ AYARLAR
              </div>
              
              <button 
                type="button"
                onClick={() => setSettingsTab('sync')}
                style={{ 
                  background: settingsTab === 'sync' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  border: 'none',
                  color: settingsTab === 'sync' ? '#fff' : 'var(--text-muted)',
                  borderLeft: settingsTab === 'sync' ? '3px solid var(--accent-color)' : '3px solid transparent',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12.5px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <span>🔄</span> Senkronizasyon
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('ai')}
                style={{
                  background: settingsTab === 'ai' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  border: 'none',
                  color: settingsTab === 'ai' ? '#fff' : 'var(--text-muted)',
                  borderLeft: settingsTab === 'ai' ? '3px solid var(--accent-color)' : '3px solid transparent',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12.5px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <span>🎖️</span> AI Mentor
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('appearance')}
                style={{ 
                  background: settingsTab === 'appearance' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  border: 'none',
                  color: settingsTab === 'appearance' ? '#fff' : 'var(--text-muted)',
                  borderLeft: settingsTab === 'appearance' ? '3px solid var(--accent-color)' : '3px solid transparent',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12.5px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <span>🎨</span> Modül & Görünüm
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('shortcuts')}
                style={{
                  background: settingsTab === 'shortcuts' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  border: 'none',
                  color: settingsTab === 'shortcuts' ? '#fff' : 'var(--text-muted)',
                  borderLeft: settingsTab === 'shortcuts' ? '3px solid var(--accent-color)' : '3px solid transparent',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12.5px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <span>⌨️</span> Kısayollar
              </button>

              <button
                type="button"
                onClick={() => { setSettingsTab('trash'); loadTrashData(); }}
                style={{
                  background: settingsTab === 'trash' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  border: 'none',
                  color: settingsTab === 'trash' ? '#fff' : 'var(--text-muted)',
                  borderLeft: settingsTab === 'trash' ? '3px solid var(--accent-color)' : '3px solid transparent',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12.5px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <span>🗑️</span> Çöp Kutusu
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('about')}
                style={{ 
                  background: settingsTab === 'about' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  border: 'none',
                  color: settingsTab === 'about' ? '#fff' : 'var(--text-muted)',
                  borderLeft: settingsTab === 'about' ? '3px solid var(--accent-color)' : '3px solid transparent',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12.5px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <span>ℹ️</span> Hakkında
              </button>
            </div>

            {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                Seçilen ayar sekmesine göre sağ tarafta render edilen içerik alanı. */}
            <div className="settings-content" style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              padding: '24px', 
              overflowY: 'auto',
              minHeight: 0
            }}>
              
              {settingsTab === 'sync' && (
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setIsSettingsModalOpen(false);
                    const creds = {
                      url: supabaseUrl.trim(),
                      anonKey: supabaseAnonKey.trim(),
                      vault: supabaseVault.trim() || 'default'
                    };
                    localStorage.setItem('supabase_sync_creds', JSON.stringify(creds));
                    initSupabase(
                      creds.url,
                      creds.anonKey,
                      creds.vault,
                      platform,
                      handleRemoteChange,
                      handleStatusChange,
                      handleConflicts,
                      handleDevPathsChange
                    );
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}
                >
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#fff' }}>Supabase Senkronizasyon Ayarları</h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
                    Notlarınızı tüm cihazlarınız arasında anlık eşitlemek için Supabase projenizi bağlayın.
                  </p>

                  {syncError && (
                    <div style={{
                      padding: '10px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: '#ff4a5a',
                      wordBreak: 'break-all',
                      lineHeight: 1.4,
                      fontWeight: '500'
                    }}>
                      <strong>Hata Ayrıntısı:</strong> {syncError}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Supabase Proje URL:</label>
                    <input
                      type="url"
                      required
                      placeholder="https://your-project.supabase.co"
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      className="modal-input"
                      style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '8px 12px', color: '#fff', fontSize: '12.5px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Anon Key (Public API Key):</label>
                    <input
                      type="password"
                      required
                      placeholder="eyJhbGciOi..."
                      value={supabaseAnonKey}
                      onChange={(e) => setSupabaseAnonKey(e.target.value)}
                      className="modal-input"
                      style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '8px 12px', color: '#fff', fontSize: '12.5px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Kasa Adı (Vault ID):</label>
                    <input
                      type="text"
                      placeholder="default"
                      value={supabaseVault}
                      onChange={(e) => setSupabaseVault(e.target.value)}
                      className="modal-input"
                      style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '8px 12px', color: '#fff', fontSize: '12.5px' }}
                    />
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Farklı cihazları aynı hesaba bağlarken aynı Kasa Adını kullanın.
                    </span>
                  </div>

                  {supabaseUrl && supabaseAnonKey && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Veritabanı Kullanımı</span>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); loadDbSize(); }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '10.5px', fontWeight: '600' }}
                        >
                          {isDbSizeLoading ? 'Yükleniyor...' : 'Yenile'}
                        </button>
                      </div>
                      {dbSizeBytes !== null ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '15px', fontWeight: '700', color: '#fff' }}>
                              {formatBytes(dbSizeBytes)} <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-muted)' }}>/ {dbCapacityMb >= 1024 ? `${(dbCapacityMb / 1024).toFixed(1)} GB` : `${dbCapacityMb} MB`}</span>
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: (dbSizeBytes / (dbCapacityMb * 1024 * 1024)) > 0.9 ? '#ef4444' : (dbSizeBytes / (dbCapacityMb * 1024 * 1024)) > 0.7 ? '#f59e0b' : '#10b981' }}>
                              %{Math.min(100, (dbSizeBytes / (dbCapacityMb * 1024 * 1024)) * 100).toFixed(1)}
                            </span>
                          </div>
                          <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.min(100, (dbSizeBytes / (dbCapacityMb * 1024 * 1024)) * 100)}%`,
                              height: '100%',
                              borderRadius: '3px',
                              background: (dbSizeBytes / (dbCapacityMb * 1024 * 1024)) > 0.9 ? '#ef4444' : (dbSizeBytes / (dbCapacityMb * 1024 * 1024)) > 0.7 ? '#f59e0b' : '#10b981',
                              transition: 'width 0.3s ease'
                            }} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Plan:</span>
                            <select
                              value={[500, 8192].includes(dbCapacityMb) ? String(dbCapacityMb) : 'custom'}
                              onChange={(e) => {
                                const v = e.target.value;
                                const next = v === 'custom' ? dbCapacityMb : Number(v);
                                setDbCapacityMb(next);
                                localStorage.setItem('supabase_db_capacity_mb', String(next));
                              }}
                              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: '#fff', fontSize: '10px', padding: '2px 4px' }}
                            >
                              <option value="500">Free (500 MB)</option>
                              <option value="8192">Pro (8 GB)</option>
                              <option value="custom">Özel</option>
                            </select>
                            <input
                              type="number"
                              min={1}
                              value={dbCapacityMb}
                              onChange={(e) => {
                                const next = Math.max(1, Number(e.target.value) || 1);
                                setDbCapacityMb(next);
                                localStorage.setItem('supabase_db_capacity_mb', String(next));
                              }}
                              style={{ width: '70px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: '#fff', fontSize: '10px', padding: '2px 4px' }}
                            />
                            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>MB toplam kota</span>
                          </div>
                        </>
                      ) : dbSizeError ? (
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                          <div style={{ marginBottom: '6px' }}>{dbSizeError}</div>
                          <pre style={{ margin: 0, padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '9.5px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#a5b4fc' }}>
{`create or replace function get_db_size()
returns bigint
language sql
security definer
as $$
  select pg_database_size(current_database());
$$;

grant execute on function get_db_size() to anon;`}
                          </pre>
                        </div>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{isDbSizeLoading ? 'Yükleniyor...' : '—'}</span>
                      )}
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                        Aylık trafik (egress) bilgisi Postgres içinde tutulmadığı için buradan gösterilemiyor — Supabase Dashboard'daki proje kullanım sayfasından görülebilir.
                      </span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button type="button" style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }} onClick={() => setIsSettingsModalOpen(false)}>Kapat</button>
                    <button type="submit" style={{ flex: 1, padding: '8px 16px', background: 'var(--accent-color)', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>Bağlan ve Senkronize Et</button>
                  </div>
                </form>
              )}

              {settingsTab === 'ai' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#fff' }}>AI Mentor (Gemini)</h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
                    Gelişim yollarınızda seviye/müfredat belirleme ve testler için Google Gemini'yi kullanır. Kendi ücretsiz API anahtarınızı{' '}
                    <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)' }}>Google AI Studio</a>
                    {' '}üzerinden alabilirsiniz. Anahtar yalnızca bu cihazda saklanır, hiçbir yere gönderilmez.
                  </p>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Gemini API Anahtarı
                    </label>
                    <input
                      type="password"
                      placeholder="AIza..."
                      value={geminiApiKeyInput}
                      onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                      className="modal-input"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Model
                    </label>
                    <input
                      type="text"
                      list="gemini-model-options"
                      placeholder="gemini-3.5-flash"
                      value={geminiModelInput}
                      onChange={(e) => setGeminiModelInput(e.target.value)}
                      className="modal-input"
                      style={{ width: '100%' }}
                    />
                    <datalist id="gemini-model-options">
                      <option value="gemini-2.0-flash" />
                      <option value="gemini-2.0-flash-lite" />
                      <option value="gemini-2.5-flash" />
                      <option value="gemini-2.5-flash-lite" />
                      <option value="gemini-2.5-pro" />
                      <option value="gemini-3-flash" />
                      <option value="gemini-3.1-pro" />
                      <option value="gemini-3.1-flash-lite" />
                      <option value="gemini-3.5-flash" />
                    </datalist>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginTop: '4px', lineHeight: 1.4 }}>
                      Ücretsiz katmanda her modelin günlük istek kotası ayrı takip edilir — birinin kotası dolarsa (Google AI Studio "Rate Limit" panelinden görebilirsin) buradan başka bir modele geçebilirsin.
                    </span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.015)' }}>
                    <input
                      type="checkbox"
                      checked={isAiMentorEnabled}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        localStorage.setItem('setting_ai_mentor_enabled', String(checked));
                        setIsAiMentorEnabled(checked);
                      }}
                      style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-color)' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12px', color: '#fff', fontWeight: '600' }}>AI Mentor Aktif</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        Kapalıyken veya anahtar girilmemişken gelişim yolu işaretleme basit rütbe/XP moduna döner.
                      </span>
                    </div>
                  </label>
                  <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button type="button" style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }} onClick={() => setIsSettingsModalOpen(false)}>Kapat</button>
                    <button
                      type="button"
                      style={{ flex: 1, padding: '8px 16px', background: 'var(--accent-color)', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}
                      onClick={() => {
                        setGeminiApiKey(geminiApiKeyInput);
                        setGeminiModel(geminiModelInput);
                        setIsSettingsModalOpen(false);
                      }}
                    >
                      Kaydet
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'appearance' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#fff' }}>Modül ve Görünüm Ayarları</h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
                    Kişisel çalışma ortamınızı özelleştirin, premium özellikleri açın veya kapatın.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.015)' }}>
                      <input 
                        type="checkbox" 
                        checked={isFlowEffectsEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          localStorage.setItem('flow_effects_enabled', String(checked));
                          setIsFlowEffectsEnabled(checked);
                        }}
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-color)' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '12px', color: '#fff', fontWeight: '600' }}>Klavye Yazma Hızı Efektleri (Power Mode)</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Hızlandıkça klavyeden kıvılcımlar saçılır ve arayüz ışıldar.</span>
                      </div>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.015)' }}>
                      <input 
                        type="checkbox" 
                        checked={isNoteCityEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          localStorage.setItem('setting_note_city_enabled', String(checked));
                          setIsNoteCityEnabled(checked);
                        }}
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-color)' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '12px', color: '#fff', fontWeight: '600' }}>Not Şehri (Note-City) Görünümü</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Notlarınızı 3D izometrik bir piksel şehre dönüştüren modülü sol menüye ekler.</span>
                      </div>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.015)' }}>
                      <input
                        type="checkbox"
                        checked={isDevPathsEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          localStorage.setItem('setting_dev_paths_enabled', String(checked));
                          setIsDevPathsEnabled(checked);
                        }}
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-color)' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '12px', color: '#fff', fontWeight: '600' }}>Gelişim Yolları (Rütbe)</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Bir klasörü işaretleyip o alandaki gelişimini rütbe olarak takip et (Er → General).</span>
                      </div>
                    </label>

                    {/* Satır Yüksekliği (line-height) Ayarı */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.015)', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#fff', fontWeight: '600' }}>Satır Yüksekliği (Line Height)</span>
                        <span style={{ fontSize: '11px', color: 'var(--accent-color)', fontWeight: 'bold' }}>{lineHeight}</span>
                      </div>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px' }}>Editördeki satırların dikey yüksekliğini ayarlar.</span>
                      <input 
                        type="range" 
                        min="1.0" 
                        max="2.5" 
                        step="0.05" 
                        value={lineHeight}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          localStorage.setItem('setting_line_height', String(val));
                          setLineHeight(val);
                        }}
                        style={{ cursor: 'pointer', accentColor: 'var(--accent-color)', width: '100%' }}
                      />
                    </div>

                    {/* Satır Alt Boşluğu (margin-bottom) Ayarı */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.015)', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#fff', fontWeight: '600' }}>Satır Alt Boşluğu (Margin Bottom)</span>
                        <span style={{ fontSize: '11px', color: 'var(--accent-color)', fontWeight: 'bold' }}>{lineMargin}px</span>
                      </div>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px' }}>Satırların arasındaki dikey boşluğu ayarlar.</span>
                      <input 
                        type="range" 
                        min="0" 
                        max="30" 
                        step="1" 
                        value={lineMargin}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          localStorage.setItem('setting_line_margin', String(val));
                          setLineMargin(val);
                        }}
                        style={{ cursor: 'pointer', accentColor: 'var(--accent-color)', width: '100%' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.015)', marginTop: '4px' }}>
                      <label style={{ fontSize: '12px', color: '#fff', fontWeight: '600' }}>Şablon Klasörü Adı</label>
                      <input 
                        type="text" 
                        value={templatesFolder}
                        onChange={(e) => {
                          const val = e.target.value.trim().replace(/\/|\\/g, ''); // Klasör adından slaşları temizle
                          setTemplatesFolder(val || '.templates');
                          localStorage.setItem('setting_templates_folder', val || '.templates');
                        }}
                        placeholder=".templates"
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: '12px',
                          background: '#1c1c24',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          color: '#fff',
                          marginTop: '4px',
                          outline: 'none'
                        }}
                      />
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Şablon dosyalarının aranacağı ve oluşturulacağı klasörün adını girin (Örn: .templates veya Şablonlar).
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button type="button" style={{ flex: 1, padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }} onClick={() => setIsSettingsModalOpen(false)}>Kapat ve Kaydet</button>
                  </div>
                </div>
              )}

              {settingsTab === 'shortcuts' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>Klavye Kısayolları</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                    Desktop uygulamasında hızlı gezinme ve işlem gerçekleştirmek için kısayol tuşlarını buradan özelleştirebilirsiniz. Değiştirmek istediğiniz kısayolun yanındaki "Değiştir" butonuna tıklayıp ardından yeni tuş kombinasyonuna basın.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {Object.entries(shortcuts).map(([key, item]) => {
                      const isRecording = recordingShortcutKey === key;
                      return (
                        <div
                          key={key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'rgba(255, 255, 255, 0.02)',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 255, 255, 0.05)'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: '600', color: '#fff' }}>{item.label}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Aksiyon: {key}</div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div
                              style={{
                                background: isRecording ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                border: isRecording ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontFamily: 'monospace',
                                fontWeight: 'bold',
                                color: isRecording ? '#f59e0b' : 'var(--accent-color)',
                                fontSize: '12px'
                              }}
                            >
                              {isRecording ? 'Yeni tuşlara basın (İptal: Esc)...' : formatShortcut(item.shortcut)}
                            </div>

                            <button
                              type="button"
                              onClick={() => setRecordingShortcutKey(key)}
                              disabled={isRecording}
                              style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '6px',
                                padding: '6px 12px',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: '12px',
                                transition: 'all 0.2s'
                              }}
                            >
                              Değiştir
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      requestConfirm('Tüm kısayolları varsayılan fabrika ayarlarına döndürmek istediğinize emin misiniz?', () => {
                        setShortcuts(DEFAULT_SHORTCUTS);
                        localStorage.setItem('desktop_shortcuts', JSON.stringify(DEFAULT_SHORTCUTS));
                      });
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '6px',
                      padding: '8px 16px',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: '12px',
                      marginTop: '10px'
                    }}
                  >
                    Varsayılanlara Sıfırla
                  </button>
                </div>
              )}

              {settingsTab === 'trash' && (() => {
                const query = trashSearchQuery.trim().toLowerCase();
                const filteredLocal = query
                  ? localTrashEntries.filter(e => e.name.toLowerCase().includes(query) || e.originalPath.toLowerCase().includes(query))
                  : localTrashEntries;
                const filteredRemote = query
                  ? remoteTrashEntries.filter(e => e.name.toLowerCase().includes(query) || e.path.toLowerCase().includes(query))
                  : remoteTrashEntries;
                const filteredKeys = [
                  ...filteredLocal.map(e => `local:${e.id}`),
                  ...filteredRemote.map(e => `remote:${e.path}`)
                ];
                const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every(k => selectedTrashKeys.has(k));

                return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0, height: '100%' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>Çöp Kutusu</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                    Sildiğin notların son hâli burada tutulur. "Uzak" olarak işaretlenenler yalnızca Supabase'de duruyor
                    (yerelde kopyası yok) — muhtemelen başka bir cihazda veya bu özellik eklenmeden önce silinmiş.
                  </p>

                  {(localTrashEntries.length > 0 || remoteTrashEntries.length > 0) && (
                    <input
                      type="text"
                      value={trashSearchQuery}
                      onChange={(e) => setTrashSearchQuery(e.target.value)}
                      placeholder="Ara (ad veya yol)..."
                      className="modal-input"
                      style={{ width: '100%' }}
                    />
                  )}

                  {isTrashLoading ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Yükleniyor...</div>
                  ) : (localTrashEntries.length === 0 && remoteTrashEntries.length === 0) ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Çöp kutusu boş.</div>
                  ) : (filteredLocal.length === 0 && filteredRemote.length === 0) ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Aramayla eşleşen öğe bulunamadı.</div>
                  ) : (
                    <>
                      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                          Toplu işlem araç çubuğu — tek tek "Kalıcı Sil"e basmak yerine birden
                          fazla öğeyi işaretleyip tek seferde silebilme/geri getirebilme. "Tümünü
                          Seç" arama filtresi uygulanmışsa yalnızca FİLTRELENMİŞ öğeleri seçer. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTrashKeys(prev => {
                              if (allFilteredSelected) {
                                const next = new Set(prev);
                                filteredKeys.forEach(k => next.delete(k));
                                return next;
                              }
                              return new Set([...prev, ...filteredKeys]);
                            });
                          }}
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11.5px' }}
                        >
                          {allFilteredSelected ? 'Seçimi Kaldır' : query ? 'Filtrelenenleri Seç' : 'Tümünü Seç'}
                        </button>
                        {selectedTrashKeys.size > 0 && (
                          <>
                            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{selectedTrashKeys.size} öğe seçili</span>
                            <button
                              type="button"
                              onClick={handleBulkRestoreTrash}
                              style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', padding: '5px 10px', color: '#10b981', cursor: 'pointer', fontSize: '11.5px', fontWeight: '600' }}
                            >
                              Seçilenleri Geri Getir
                            </button>
                            <button
                              type="button"
                              onClick={handleBulkDeleteTrash}
                              style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', padding: '5px 10px', color: '#ef4444', cursor: 'pointer', fontSize: '11.5px', fontWeight: '600' }}
                            >
                              Seçilenleri Kalıcı Sil
                            </button>
                          </>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
                        {filteredLocal.map(entry => {
                          const key = `local:${entry.id}`;
                          const isSelected = selectedTrashKeys.has(key);
                          return (
                            <div
                              key={entry.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(255, 255, 255, 0.02)',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                border: `1px solid ${isSelected ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.05)'}`
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleTrashSelection(key)}
                                  style={{ flexShrink: 0, cursor: 'pointer' }}
                                />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                    {entry.originalPath} · {new Date(entry.deletedAt).toLocaleString('tr-TR')}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => handleRestoreLocalTrash(entry)}
                                  style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', padding: '6px 12px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                                >
                                  Geri Getir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    requestConfirm(`"${entry.name}" kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`, () => {
                                      handlePermanentlyDeleteLocalTrash(entry.id);
                                    });
                                  }}
                                  style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', padding: '6px 12px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                                >
                                  Kalıcı Sil
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {filteredRemote.map(entry => {
                          const key = `remote:${entry.path}`;
                          const isSelected = selectedTrashKeys.has(key);
                          return (
                            <div
                              key={entry.path}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(255, 255, 255, 0.02)',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                border: `1px solid ${isSelected ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.05)'}`
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleTrashSelection(key)}
                                  style={{ flexShrink: 0, cursor: 'pointer' }}
                                />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: '600', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
                                    <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--accent-color)', background: 'rgba(99, 102, 241, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>UZAK</span>
                                  </div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                    {entry.path} · {new Date(entry.updated_at).toLocaleString('tr-TR')}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => handleRestoreRemoteTrash(entry)}
                                  style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', padding: '6px 12px', color: '#10b981', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                                >
                                  Geri Getir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    requestConfirm(`"${entry.name}" kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`, () => {
                                      handlePermanentlyDeleteRemoteTrash(entry.path);
                                    });
                                  }}
                                  style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', padding: '6px 12px', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                                >
                                  Kalıcı Sil
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                );
              })()}

              {settingsTab === 'about' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#fff' }}>Uygulama Hakkında</h3>
                  
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    padding: '20px 10px', 
                    background: 'rgba(255,255,255,0.01)', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255,255,255,0.04)',
                    textAlign: 'center',
                    gap: '8px'
                  }}>
                    <div style={{ fontSize: '32px', filter: 'drop-shadow(0 0 10px var(--accent-color))' }}>▲</div>
                    <strong style={{ fontSize: '16px', color: '#fff' }}>Ultimate NoteFactory</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Version 1.4.0-Premium (Desktop & Mobile)</span>
                  </div>

                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span>Bu proje, <strong>Google DeepMind Advanced Engineering Team</strong> tarafından geliştirilen tamamen yerel, Git-tabanlı, şifrelenmiş ve çevrimdışı öncelikli (offline-first) bir not alma ve verimlilik asistanıdır.</span>
                    <span>Tüm verileriniz yerel cihazınızda tutulur ve Supabase entegrasyonu sayesinde uçtan uca şifrelenmiş (End-to-End Encrypted) WebSocket hatlarıyla güvenle senkronize edilir.</span>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button 
                      type="button" 
                      onClick={() => { setIsSettingsModalOpen(false); setIsHelpModalOpen(true); }}
                      style={{ padding: '8px 16px', background: 'rgba(99,102,241,0.15)', border: '1px solid var(--accent-color)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                    >
                      📖 Yardım Rehberini Aç
                    </button>
                    <button type="button" style={{ flex: 1, padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }} onClick={() => setIsSettingsModalOpen(false)}>Kapat</button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Paylaşılan onay modalı — tüm silme/onay eylemlerinin native window.confirm()
          yerine kullandığı tek modal (bkz. requestConfirm ve üstündeki BUG DÜZELTMESİ
          yorumu). Diğer modallerin ÜZERİNDE görünmesi gerektiğinden (ör. bağlam
          menüsünden tetiklenen bir silme onayı) yüksek bir z-index kullanılır. */}
      {confirmDialogState && (
        <div className="modal-overlay animate-fade" style={{ zIndex: 4000 }} onClick={() => setConfirmDialogState(null)}>
          <div className="modal-content animate-pop" style={{ maxWidth: '380px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-body" style={{ padding: '22px 20px 4px' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {confirmDialogState.message}
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => setConfirmDialogState(null)}>
                İptal
              </button>
              <button
                type="button"
                className="btn-modal-confirm"
                style={{ background: '#ef4444', borderColor: '#ef4444' }}
                onClick={() => {
                  const cb = confirmDialogState.onConfirm;
                  setConfirmDialogState(null);
                  cb();
                }}
              >
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Premium Glassmorphic Context Menu */}
      {contextMenu && (
        <div
          className="context-menu-container"
          style={{
            position: 'fixed',
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            zIndex: 9999,
            background: 'rgba(20, 20, 24, 0.95)',
            backdropFilter: 'blur(16px) saturate(140%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '6px',
            minWidth: '170px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'folder' ? (
            <>
              <ContextMenuItem
                onClick={() => {
                  const name = prompt('Yeni Not Adı:');
                  if (name && name.trim()) {
                    handleCreateNote(name.trim(), contextMenu.target);
                  }
                  setContextMenu(null);
                }}
              >
                <Plus size={14} />
                <span>Yeni Not Oluştur</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  setParentFolder(contextMenu.target);
                  setNewFolderName('');
                  setIsFolderModalOpen(true);
                  setContextMenu(null);
                }}
              >
                <Folder size={14} />
                <span>Yeni Alt Klasör</span>
              </ContextMenuItem>
              <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '4px 0' }} />
              <ContextMenuItem
                onClick={() => {
                  setRenameOldPath(contextMenu.target);
                  const parts = contextMenu.target.split('/');
                  setRenameNewName(parts[parts.length - 1]);
                  setIsRenameModalOpen(true);
                  setContextMenu(null);
                }}
              >
                <FileText size={14} />
                <span>Yeniden Adlandır</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  setMoveOldPath(contextMenu.target);
                  setMoveDestFolder('');
                  setIsMoveModalOpen(true);
                  setContextMenu(null);
                }}
              >
                <Folder size={14} />
                <span>Taşı</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const path = contextMenu.target;
                  const custom = folderCustomizations[path] || {};
                  setSelectedIcon(custom.icon || 'Folder');
                  setSelectedColor(custom.color || '');
                  setCustomizingFolder(path);
                  setIsCustomizerOpen(true);
                  setContextMenu(null);
                }}
              >
                <Settings size={14} />
                <span>Simge ve Renk Ayarla...</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  handleToggleDevPath(contextMenu.target);
                  setContextMenu(null);
                }}
              >
                <Award size={14} />
                <span>{developmentPaths[contextMenu.target] ? 'Gelişim Yolunu Kaldır' : 'Gelişim Yolu Olarak İşaretle'}</span>
              </ContextMenuItem>
              <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '4px 0' }} />
              <ContextMenuItem
                danger
                onClick={() => {
                  const parts = contextMenu.target.split('/');
                  const name = parts[parts.length - 1];
                  const targetPath = contextMenu.target;
                  setContextMenu(null);
                  requestConfirm(`"${name}" klasörünü ve içindeki tüm notları silmek istediğinize emin misiniz?`, () => {
                    handleDeleteFolder(targetPath);
                  });
                }}
              >
                <Trash2 size={14} />
                <span>Klasörü Sil</span>
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem
                onClick={() => {
                  handleOpenInNewTab(contextMenu.target);
                  setContextMenu(null);
                }}
              >
                <Plus size={14} />
                <span>Yeni Sekmede Aç</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  handleOpenInSplitView(contextMenu.target);
                  setContextMenu(null);
                }}
              >
                <Columns size={14} />
                <span>Bölünmüş Sayfada Aç</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  handleOpenInNewWindow(contextMenu.target);
                  setContextMenu(null);
                }}
              >
                <Globe size={14} />
                <span>Yeni Pencerede Aç</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  setShowPropertiesPath(contextMenu.target);
                  setContextMenu(null);
                }}
              >
                <Info size={14} />
                <span>Özellikleri Göster</span>
              </ContextMenuItem>
              <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '4px 0' }} />
              <ContextMenuItem
                onClick={() => {
                  setRenameOldPath(contextMenu.target);
                  const parts = contextMenu.target.split('/');
                  const name = parts[parts.length - 1].replace('.md', '');
                  setRenameNewName(name);
                  setIsRenameModalOpen(true);
                  setContextMenu(null);
                }}
              >
                <FileText size={14} />
                <span>Yeniden Adlandır</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  setMoveOldPath(contextMenu.target);
                  setMoveDestFolder('');
                  setIsMoveModalOpen(true);
                  setContextMenu(null);
                }}
              >
                <Folder size={14} />
                <span>Klasöre Taşı</span>
              </ContextMenuItem>
              <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '4px 0' }} />
              <ContextMenuItem
                danger
                onClick={() => {
                  const targetPath = contextMenu.target;
                  setContextMenu(null);
                  requestConfirm('Bu notu silmek istediğinize emin misiniz?', () => {
                    handleDeletePath(targetPath);
                  });
                }}
              >
                <Trash2 size={14} />
                <span>Notu Sil</span>
              </ContextMenuItem>
            </>
          )}
        </div>
      )}

      {/* Premium Glassmorphic Modal for Renaming File or Folder */}
      {isRenameModalOpen && (
        <div className="modal-overlay animate-fade">
          <div className="modal-content animate-pop">
            <div className="modal-header">
              <h3>Yeniden Adlandır</h3>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!renameNewName.trim()) return;
              
              let newPath = '';
              const parts = renameOldPath.split('/');
              if (parts.length > 1) {
                const parent = parts.slice(0, -1).join('/');
                newPath = renameOldPath.endsWith('.md')
                  ? `${parent}/${renameNewName.trim()}.md`
                  : `${parent}/${renameNewName.trim()}`;
              } else {
                newPath = renameOldPath.endsWith('.md')
                  ? `${renameNewName.trim()}.md`
                  : renameNewName.trim();
              }
              
              setIsRenameModalOpen(false);
              await handleRenamePath(renameOldPath, newPath);
            }}>
              <div className="modal-body">
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Yeni Adı:</label>
                <input
                  type="text"
                  placeholder="Yeni adını girin..."
                  value={renameNewName}
                  onChange={(e) => setRenameNewName(e.target.value)}
                  className="modal-input"
                  autoFocus
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-modal-cancel" onClick={() => setIsRenameModalOpen(false)}>İptal</button>
                <button type="submit" className="btn-modal-confirm" disabled={!renameNewName.trim()}>Kaydet</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Premium Glassmorphic Modal for Note Properties */}
      {showPropertiesPath && (() => {
        const note = notes.find(n => n.path === showPropertiesPath);
        if (!note) return null;
        const stats = getNoteStats(showPropertiesPath);
        return (
          <div className="modal-overlay animate-fade" onClick={() => setShowPropertiesPath(null)} style={{ zIndex: 2000 }}>
            <div className="modal-content animate-pop" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '90%' }}>
              <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Info size={16} /> Not Özellikleri
                </h3>
                <button onClick={() => setShowPropertiesPath(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>📝 Not Adı:</span>
                  <span style={{ fontWeight: '600' }}>{note.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>📂 Klasör:</span>
                  <span>{note.path.includes('/') ? `@${note.path.substring(0, note.path.lastIndexOf('/'))}` : 'Kök Klasör'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>📅 Oluşturulma:</span>
                  <span>{new Date(note.createdAt).toLocaleString('tr-TR')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>🔄 Güncellenme:</span>
                  <span>{new Date(note.updatedAt).toLocaleString('tr-TR')}</span>
                </div>
                
                <div style={{ height: '1px', background: 'var(--border-color)', margin: '8px 0' }} />
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '8px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Satır</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '4px' }}>{stats.lineCount}</div>
                  </div>
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '8px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Kelime</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '4px' }}>{stats.wordCount}</div>
                  </div>
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '8px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Karakter</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '4px' }}>{stats.charCount}</div>
                  </div>
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '8px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Okuma Süresi</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '4px' }}>{stats.readTime} dk</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>🏷️ Etiketler:</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    {stats.tags.map(tag => (
                      <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.2)', color: 'var(--accent-color)' }}>
                        #{tag}
                        <button
                          onClick={() => handleDeleteTagInProperties(showPropertiesPath, tag)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '10px', padding: 0, marginLeft: '2px', display: 'flex', alignItems: 'center' }}
                          title="Etiketi Sil"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    
                    {isPropertiesAddingTag ? (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (propertiesNewTag.trim()) {
                            await handleAddTagInProperties(showPropertiesPath, propertiesNewTag.trim());
                            setPropertiesNewTag('');
                            setIsPropertiesAddingTag(false);
                          }
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center' }}
                      >
                        <input
                          type="text"
                          placeholder="Etiket..."
                          value={propertiesNewTag}
                          onChange={(e) => setPropertiesNewTag(e.target.value.replace(/[^a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]/g, ''))}
                          autoFocus
                          onBlur={() => {
                            setTimeout(() => setIsPropertiesAddingTag(false), 200);
                          }}
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--accent-color)',
                            borderRadius: '4px',
                            color: '#fff',
                            fontSize: '11px',
                            padding: '2px 6px',
                            width: '80px',
                            outline: 'none'
                          }}
                        />
                      </form>
                    ) : (
                      <button
                        onClick={() => setIsPropertiesAddingTag(true)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px dashed rgba(255,255,255,0.2)',
                          color: 'var(--text-muted)',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        + Ekle
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-modal-cancel" onClick={() => setShowPropertiesPath(null)} style={{ margin: 0 }}>
                  Kapat
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* Premium Glassmorphic Modal for Moving File or Folder */}
      {isMoveModalOpen && (
        <div className="modal-overlay animate-fade">
          <div className="modal-content animate-pop">
            <div className="modal-header">
              <h3>Klasöre Taşı</h3>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              
              const parts = moveOldPath.split('/');
              const name = parts[parts.length - 1];
              let newPath = moveDestFolder ? `${moveDestFolder}/${name}` : name;
              
              if (moveOldPath === moveDestFolder || moveDestFolder.startsWith(moveOldPath + '/')) {
                alert('Bir klasör kendisinin veya alt klasörlerinin içine taşınamaz!');
                return;
              }
              
              setIsMoveModalOpen(false);
              await handleRenamePath(moveOldPath, newPath);
            }}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Taşınacak Öğe: <strong style={{ color: 'var(--text-primary)' }}>{moveOldPath}</strong>
                  </span>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hedef Klasör Seçin:</label>
                  <select
                    value={moveDestFolder}
                    onChange={(e) => setMoveDestFolder(e.target.value)}
                    className="modal-input"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', width: '100%', cursor: 'pointer' }}
                  >
                    <option value="">[Kök Dizin (Ana Klasör)]</option>
                    {folders
                      .filter(f => f !== moveOldPath && !f.startsWith(moveOldPath + '/'))
                      .map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-modal-cancel" onClick={() => setIsMoveModalOpen(false)}>İptal</button>
                <button type="submit" className="btn-modal-confirm">Taşı</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Obsidian-Style Premium OmniSearch Modal */}
      {isGlobalSearchOpen && (
        <div 
          className="modal-overlay active" 
          onClick={() => setIsGlobalSearchOpen(false)}
          style={{ zIndex: 10000 }}
        >
          <div 
            className="modal-container" 
            onClick={(e) => e.stopPropagation()} 
            style={{ 
              width: '680px', 
              maxWidth: '90%', 
              maxHeight: '75vh', 
              display: 'flex', 
              flexDirection: 'column', 
              background: 'rgba(15, 23, 42, 0.95)', 
              backdropFilter: 'blur(16px)', 
              border: '1px solid rgba(255, 255, 255, 0.1)', 
              borderRadius: '12px', 
              overflow: 'hidden' 
            }}
          >
            {/* Search Input Bar */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '18px', color: 'var(--accent-color)' }}>🔍</span>
              <input
                type="text"
                placeholder="Notlarda veya içeriklerinde ara... (Örn: #iş, toplantı)"
                value={globalSearchQuery}
                onChange={(e) => {
                  setGlobalSearchQuery(e.target.value);
                  setSearchSelectedIndex(0);
                }}
                autoFocus
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: '15px',
                  outline: 'none',
                  width: '100%'
                }}
                onKeyDown={(e) => {
                  const results = getSearchResults();
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchSelectedIndex(prev => Math.max(prev - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (results[searchSelectedIndex]) {
                      handleOpenSearchResult(results[searchSelectedIndex].path);
                    }
                  } else if (e.key === 'Escape') {
                    setIsGlobalSearchOpen(false);
                  }
                }}
              />
              <button 
                onClick={() => setIsGlobalSearchOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}
              >
                ESC
              </button>
            </div>

            {/* Results Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
              {(() => {
                const results = getSearchResults();
                if (!globalSearchQuery.trim()) {
                  return (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      Aramak istediğiniz kelimeyi yazın...
                    </div>
                  );
                }
                if (results.length === 0) {
                  return (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      Eşleşen not bulunamadı.
                    </div>
                  );
                }

                return results.map((note, idx) => {
                  const isSelected = idx === searchSelectedIndex;
                  const content = fileContents[note.path] || '';
                  const snippet = getSearchSnippet(content, globalSearchQuery);

                  return (
                    <div
                      key={note.path}
                      onClick={() => handleOpenSearchResult(note.path)}
                      onMouseEnter={() => setSearchSelectedIndex(idx)}
                      style={{
                        padding: '10px 20px',
                        background: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                        borderLeft: isSelected ? '3px solid var(--accent-color)' : '3px solid transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 'bold', color: isSelected ? '#fff' : 'var(--text-primary)' }}>
                          📄 {note.name}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {note.path.includes('/') ? `@${note.path.split('/')[0]}` : '@Kök'}
                        </span>
                      </div>
                      {snippet && (
                        <div 
                          style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', wordBreak: 'break-all' }}
                          dangerouslySetInnerHTML={{ __html: snippet }}
                        />
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Not Geçmişi Modalı: Zaman Akışı'ndaki bir kayda ait notun git benzeri (kırmızı/yeşil) satır diff'leri */}
      {historyModalItem && (
        <div className="modal-overlay active" style={{ zIndex: 3000 }} onClick={() => setHistoryModalItem(null)}>
          <div
            className="modal-container"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '720px',
              maxWidth: '92%',
              maxHeight: '82vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(15, 23, 42, 0.97)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              overflow: 'hidden'
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>Değişiklik Geçmişi</h2>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{getTimelineItemPath(historyModalItem)}</span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalItem(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '20px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {isHistoryLoading ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Yükleniyor...</div>
              ) : historyEntries.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Bu not için henüz kayıtlı bir değişiklik geçmişi yok (henüz sadece bir kez kaydedilmiş olabilir).
                </div>
              ) : (
                historyEntries.map((entry, idx) => {
                  const diff = diffLines(entry.before, entry.after);
                  return (
                    <div key={idx} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', overflow: 'hidden' }}>
                      <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {new Date(entry.timestamp).toLocaleString('tr-TR')}
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.6 }}>
                        {diff.filter(d => d.type !== 'same' || d.text.trim() !== '').map((d, i) => {
                          // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                          // Eklenen/çıkarılan satır tamamen boşsa renkli çubuk boş görünüp
                          // "bozuk" hissi veriyordu — bunun yerine görünür bir etiket gösteriyoruz.
                          const isBlank = d.text.trim() === '';
                          return (
                            <div
                              key={i}
                              style={{
                                padding: '1px 12px',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                fontStyle: isBlank ? 'italic' : 'normal',
                                opacity: isBlank ? 0.7 : 1,
                                background: d.type === 'add' ? 'rgba(16, 185, 129, 0.12)' : d.type === 'remove' ? 'rgba(239, 68, 68, 0.12)' : 'transparent',
                                color: d.type === 'add' ? '#34d399' : d.type === 'remove' ? '#f87171' : 'var(--text-muted)',
                                textDecoration: d.type === 'remove' && !isBlank ? 'line-through' : 'none'
                              }}
                            >
                              {d.type === 'add' ? '+ ' : d.type === 'remove' ? '- ' : '  '}{isBlank ? '(boş satır)' : d.text}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Premium Glassmorphic Help and Guide Modal */}
      {isHelpModalOpen && (
        <div className="modal-overlay active" onClick={() => setIsHelpModalOpen(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ width: '800px', maxWidth: '95%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', overflow: 'hidden' }}>
            
            {/* Header */}
            <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <HelpCircle className="text-accent" size={20} />
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#fff' }}>Yardım Rehberi & Kılavuz</h2>
              </div>
              <button 
                type="button" 
                onClick={() => setIsHelpModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '20px' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', color: 'var(--text-secondary)', fontSize: '13.5px', lineHeight: '1.6' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Card 1: NoteFactory / Hızlı Giriş Gücü */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span style={{ color: '#f59e0b' }}>⚡</span> Hızlı Giriş (NoteFactory) & Akıllı Kısayollar
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>Ana ekrandaki giriş satırına yazacağınız akıllı tetikleyicilerle saniyeler içinde notları ve görevleri yönetebilirsiniz:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: 'var(--accent-color)', display: 'inline-block', width: '120px' }}>💵 Döviz Çevirici:</strong> 
                        Giriş satırına <code style={{color:'#10b981'}}>500 dolar</code>, <code style={{color:'#10b981'}}>120 euro</code> veya <code style={{color:'#10b981'}}>80 sterlin</code> yazıp Enter'a bastığınızda, anlık merkez bankası kurları çekilerek TL karşılığı ekranda gösterilir.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: 'var(--accent-color)', display: 'inline-block', width: '120px' }}>🎙️ Ses Kaydı Başlat:</strong> 
                        Giriş satırına sadece <code style={{color:'#3b82f6'}}>record</code>, <code style={{color:'#3b82f6'}}>ses kaydı</code> veya <code style={{color:'#3b82f6'}}>kayıt</code> yazıp Enter'a basınca mikrofon arayüzü doğrudan tetiklenerek ses kaydını başlatır.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: 'var(--accent-color)', display: 'inline-block', width: '120px' }}>📁 Not/Klasör Seçimi:</strong> 
                        Metnin sonuna <code style={{color:'#f43f5e'}}>@notadi</code> veya <code style={{color:'#f43f5e'}}>@Klasör/Notadi</code> ekleyerek girdinizi doğrudan o notun en sonuna satır olarak ekleyebilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: 'var(--accent-color)', display: 'inline-block', width: '120px' }}>🏷️ Akıllı Etiketler:</strong> 
                        Metnin içerisine <code style={{color:'#f59e0b'}}>#iş</code>, <code style={{color:'#f59e0b'}}>#kişisel</code> gibi etiketler yazarak görevlerin otomatik etiketlenmesini sağlayabilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: 'var(--accent-color)', display: 'inline-block', width: '120px' }}>🔔 Sistem Alarmları:</strong> 
                        Metne <code style={{color:'#a855f7'}}>alarm 18:45</code> ekleyerek telefonunuzda ve bilgisayarınızda o saatte çalacak bir sistem alarm bildirimi programlayabilirsiniz.
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Markdown & Tasarım Özelleştirme */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span style={{ color: '#10b981' }}>🎨</span> Markdown Biçimlendirme & Görsel Özelleştirmeler
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>Not dosyalarınızın başlık satırına ekleyeceğiniz özel kodlarla görünümünü tamamen değiştirebilir, multimedya öğeleri entegre edebilirsiniz:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '120px' }}>🎨 Başlık Rengi:</strong> 
                        Notun ilk satırına veya başlığına <code style={{color:'#a855f7'}}># Not Başlığı [color:blue]</code> eklediğinizde, başlık rengi özelleşir (blue, red, green, purple, yellow, orange desteklenir).
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '120px' }}>🌅 Gradyan Tema:</strong> 
                        Başlığa <code style={{color:'#a855f7'}}>[gradient:sunset]</code> ekleyerek notunuza arka planda muhteşem bir gradyan tema verebilirsiniz (sunset, ocean, forest, neon, lava temaları bulunur).
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '120px' }}>🎬 Video Oynatıcı:</strong> 
                        Yüklediğiniz videoları not içinde doğrudan oynatmak için <code style={{color:'#3b82f6'}}>video [video:media/video_adi.webm]</code> formatını kullanabilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '120px' }}>🎵 Ses Oynatıcı:</strong> 
                        Ses kayıtlarınızı not içinden dinlemek için <code style={{color:'#3b82f6'}}>audio [audio:media/ses_adi.webm]</code> formatını kullanabilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '120px' }}>📺 Youtube Gömme:</strong> 
                        Notunuza doğrudan Youtube video linki veya iframe kodu yapıştırarak not içinden doğrudan video izleyebilirsiniz.
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Takvim Planlayıcı */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span>📅</span> Takvim Planlayıcı & Akıllı Filtreleme
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>Görevlerinize tarih/saat atayarak onları takvime koyabilirsiniz. Bazı özel notların takvimde kirlilik yaratmasını önleyebilirsiniz:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: '#3b82f6', display: 'inline-block', width: '140px' }}>🗓️ Görev Planlama:</strong> 
                        Metne <code style={{color:'#10b981'}}>[due:2026-06-30] [time:09:00-10:00] [repeat:daily]</code> ekleyerek takvimde yerini almasını sağlayabilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#3b82f6', display: 'inline-block', width: '140px' }}>🚫 Yan Paneli Temizle:</strong> 
                        Notun içine <code style={{color:'#f59e0b'}}>#no-unplanned</code> (veya <code style={{color:'#f59e0b'}}>#exclude-unplanned</code>) eklediğinizde, o nottaki (örn: Alışveriş.md) planlanmamış görevler takvim yan listesinde gizlenir.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#3b82f6', display: 'inline-block', width: '140px' }}>❌ Takvimden Çıkar:</strong> 
                        Notun içine <code style={{color:'#ef4444'}}>#no-calendar</code> (veya <code style={{color:'#ef4444'}}>#exclude-calendar</code>) ekleyerek o nottaki tüm görevleri takvimden tamamen gizleyebilirsiniz.
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Web clipping */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span>🌐</span> Web Kırpıcı (Web Clipper) & Eşitleme
                    </h3>
                    <p style={{ margin: '0 0 8px 0' }}><strong style={{color:'#fff'}}>Web Araştırma (Browser) Kırpma:</strong> Masaüstünde <kbd style={{background:'rgba(255,255,255,0.1)', padding:'2px 6px', borderRadius:'4px', fontFamily:'monospace'}}>Alt + W</kbd> kısayolu ile tarayıcıyı açabilir, gezindiğiniz herhangi bir sayfada seçtiğiniz metne sağ tıklayarak **"Nota Kırp (Clip to Note)"** eylemiyle aktif notunuza veya Inbox'a kopyalayabilirsiniz.</p>
                    <p style={{ margin: '0' }}><strong style={{color:'#fff'}}>3 Yollu Güvenli Bulut Eşitleme:</strong> Supabase ayarlarınız yapıldığında, yerel ve bulut veritabanınız otomatik olarak senkronize olur. Çakışma (conflict) durumunda yerel dosyanızın üzerine yazılmaması için otomatik olarak `.backup` uzantılı bir yedeği alınır.</p>
                  </div>

                  {/* Card 5: Slash Commands & Gömülü Notlar */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span style={{ color: '#818cf8' }}>⚡</span> Eğik Çizgi Menüsü (/) & Canlı Akış (Flow) & Tablolar
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>Not yazarken satır başında veya boşluktan sonra <code style={{color:'#818cf8'}}>/</code> yazarak açılan menüden gelişmiş Notion/Obsidian bileşenlerini ekleyebilirsiniz:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '150px' }}>🌊 Canlı Not Akışı:</strong> 
                        Satıra <code style={{color:'#10b981'}}>flow: NotAdi.md</code> ekleyerek veya `/Flow` seçerek başka bir notu bu notun içine gömebilirsiniz. Sağ üstteki **"Düzenle"** butonuyla içindeki metni doğrudan düzenleyebilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '150px' }}>📊 İnteraktif Tablo:</strong> 
                        `/New Table` seçerek satıra dinamik, hücreleri tıklanıp düzenlenebilen Excel grid tabloları (<code style={{color:'#10b981'}}>tablo: Kolon1, Kolon2</code>) ekleyebilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '150px' }}>📋 Kanban Pano:</strong> 
                        `/New Board` seçerek not içinde kolonlar ve kartlar barındıran tam etkileşimli bir pano (<code style={{color:'#10b981'}}>pano: Yapılacak, Tamamlandı</code>) çizebilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '150px' }}>⚠️ Açıklama Kutusu:</strong> 
                        `/Callout` seçerek satıra <code style={{color:'#10b981'}}>&gt; [!NOTE] Başlık</code> yazıp odak dışına çıktığınızda renkli, ikonlu bilgi kutuları oluşturabilirsiniz (NOTE, TIP, WARNING, CAUTION, IMPORTANT desteklenir).
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '150px' }}>🔗 Bağlantı ve Görsel:</strong> 
                        Standart Markdown formatlarıyla (<code style={{color:'#10b981'}}>[Link Metni](url)</code> ve <code style={{color:'#10b981'}}>![Görsel](url)</code>) harici bağlantılar ve resimler ekleyebilirsiniz.
                      </div>
                    </div>
                  </div>

                  {/* Card 6: Yeni Nesil İnteraktif Bileşenler & Grafikler */}
                  {/* Bu kart, kullanıcının yeni eklenen alışkanlık zinciri, grafik çizici ve sayaç günlükleyici özelliklerini nasıl kullanacağını açıklar. */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span style={{ color: '#10b981' }}>📊</span> Yeni Nesil İnteraktif Bileşenler & Grafikler
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>Not dosyanızın herhangi bir satırına yazacağınız özel kodlar veya tablolarla canlı etkileşimli grafikler ve takip panoları oluşturabilirsiniz:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '160px' }}>📅 Alışkanlık Takip Grid:</strong> 
                        Boş bir satıra <code style={{color:'#10b981'}}>[habit: Kitap Okuma]</code> yazarak o aya ait günleri gösteren interaktif bir takip zinciri oluşturabilirsiniz. Tıklanan günler otomatik olarak <code style={{color:'#f59e0b'}}>[stats:...]</code> şeklinde dosyaya kaydedilir.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '160px' }}>📈 Dinamik SVG Grafikler:</strong> 
                        Markdown formatındaki tablonun hemen üzerine <code style={{color:'#3b82f6'}}>[chart: bar]</code> veya <code style={{color:'#3b82f6'}}>[chart: line]</code> yazarak tablo verilerini anında etkileşimli bir sütun veya çizgi grafiğine dönüştürebilirsiniz (üzerine gelindiğinde değerleri gösterir).
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#10b981', display: 'inline-block', width: '160px' }}>⏱️ Gelişmiş Odak Sayacı:</strong> 
                        Satıra <code style={{color:'#a855f7'}}>timer 25</code> yazıp sayacı oynattığınızda süre dolunca sistem sesi ve push bildirimi tetiklenir. Ayrıca çalışma süresi notun en sonuna tarih damgasıyla otomatik günlüklenir.
                      </div>
                    </div>
                  </div>

                  {/* Card 7: Gelişmiş Verimlilik ve Otomasyon Araçları */}
                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5): */}
                  {/* Bu kart, yeni eklenen Şablon Sistemi, Ses Deşifre Etme ve Sorgu Blokları özelliklerinin sözdizimi ve kullanım detaylarını kullanıcıya sunar. */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span style={{ color: '#818cf8' }}>⚡</span> Gelişmiş Otomasyon & Arama Araçları
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>Not alma hızınızı ve verimliliğinizi en üst düzeye çıkaracak yeni dinamik otomasyon araçları:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '160px' }}>🧩 Özel Şablon Sistemi:</strong> 
                        Notlarınızın arasında <code style={{color:'#10b981'}}>Templates</code> veya <code style={{color:'#10b981'}}>Şablonlar</code> klasörü oluşturup içine şablonlarınızı ekleyin. Herhangi bir notta <code style={{color:'#3b82f6'}}>/</code> menüsünü açarak bu şablonları <code style={{color:'#f59e0b'}}>{"{{date}}"}</code> otomatik tarih damgalarıyla tek tıkla uygulayabilirsiniz.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '160px' }}>🎙️ Canlı Ses Deşifre:</strong> 
                        <code style={{color:'#a855f7'}}>record</code> widget'ı ile sesinizi kaydederken konuşmalarınız anlık olarak analiz edilerek Türkçe metne çevrilir. Kaydı durdurduğunuzda deşifre metni otomatik olarak ses oynatıcısının altına eklenir.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#818cf8', display: 'inline-block', width: '160px' }}>🔍 Dinamik Arama Blokları:</strong> 
                        Notun içine <code style={{color:'#3b82f6'}}>{"[query: due:today]"}</code> yazdığınızda, o gün teslim edilmesi gereken tüm görevleri (örneğin <code style={{color:'#f59e0b'}}>due:today</code>, <code style={{color:'#f59e0b'}}>due:tomorrow</code>, <code style={{color:'#f59e0b'}}>due:overdue</code> desteklenir) tüm notlarınızdan tarayıp listeler. Sadece belirli etiketlere sahip görevleri süzmek için <code style={{color:'#3b82f6'}}>{"[query: #görev due:today]"}</code> formatını da kullanabilirsiniz.
                      </div>
                    </div>
                  </div>

                  {/* Card 8: Yeni Premium Verimlilik Modülleri */}
                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5): */}
                  {/* Bu kart, yeni eklenen Ezber Kartları, Zen/Daktilo Modu, Mini Masaüstü Widget, Analiz Paneli ve Sürükle-Bırak Dashboard özelliklerinin kılavuz bilgilerini kullanıcıya sunar. */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span style={{ color: '#e0f2fe' }}>💎</span> Yeni Premium Verimlilik Modülleri
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>En son eklenen premium çalışma ve odaklanma araçları:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: '#e0f2fe', display: 'inline-block', width: '160px' }}>🃏 Ezber Kartları (SRS):</strong> 
                        Notlarınızın içinde <code style={{color:'#10b981'}}>[card: Soru || Cevap]</code> formatıyla kartlar tanımlayın. Sol menüden Ezber Kartları paneline giderek 3D animasyonlu kartlarla Leitner aralıklı tekrar metodunu uygulayın.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#e0f2fe', display: 'inline-block', width: '160px' }}>🧘 Zen & Daktilo Modu:</strong> 
                        Editör toolbarındaki butonlarla veya <code style={{color:'#3b82f6'}}>Alt+Z</code> kısayoluyla tüm dikkatinizi dağıtacak panelleri gizleyin. Daktilo (Typewriter) moduyla odaklandığınız satırı ekranda dikey olarak ortalayın.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#e0f2fe', display: 'inline-block', width: '160px' }}>⚡ Flow & Power Mode:</strong> 
                        Yazma hızınız arttıkça imleçten rengarenk parıldayan piksel kıvılcımları dökülür, sağ üstte bir Combo sayacı belirir ve aktif satırınız göz alıcı bir odaklanma ışımasıyla dolar. Yazmayı bırakınca efektler yavaşça söner.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#e0f2fe', display: 'inline-block', width: '160px' }}>🎛️ Mini Masaüstü Widget:</strong> 
                        Üst çubuktaki "Mini Mod" butonuyla uygulamayı her zaman üstte duran (Always-on-Top) 380x240px boyutlarında şık bir saate, Pomodoro sayacına, müzik kumandasına ve hızlı todo ekleme aracına dönüştürün.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#e0f2fe', display: 'inline-block', width: '160px' }}>📊 Verimlilik Analizi:</strong> 
                        Notlardaki verileri tarayan analiz paneliyle son 7 günlük çalışma dakikası (SVG), görev tamamlanma oranı (SVG doughnut) ve dosya/kelime hacmi istatistiklerinizi anlık görüntüleyin.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#e0f2fe', display: 'inline-block', width: '160px' }}>🎛️ Sürükle-Bırak Dashboard:</strong> 
                        Ana karşılama ekranında (Hızlı Giriş) Hızlı Giriş, Pomodoro, Son Notlar, Todo gibi widget'ları sürükleyip bırakarak kendi çalışma düzeninizi oluşturun. Sıralama kalıcı olarak kaydedilir.
                      </div>
                    </div>
                  </div>

                  {/* Card 9: Gelişmiş Markdown Yardımcıları */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                      <span style={{ color: '#f59e0b' }}>✍️</span> Gelişmiş Markdown Yardımcıları (Blok Gömme, TOC & Mermaid)
                    </h3>
                    <p style={{ margin: '0 0 12px 0' }}>Notlarınızı daha verimli bağlamak, yapılandırmak ve teknik şemalar çizmek için gelişmiş markdown araçları:</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div>
                        <strong style={{ color: '#f59e0b', display: 'inline-block', width: '160px' }}>🔗 Blok Gömme (Transclusion):</strong> 
                        Notun içine <code style={{color:'#10b981'}}>![[Not_Adi#Bölüm_Basligi]]</code> yazarak o notun sadece o başlığı altındaki paragrafları canlı ve salt-okunur şekilde bu nota gömebilirsiniz. Başlık belirtilmezse tüm not gömülür.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#f59e0b', display: 'inline-block', width: '160px' }}>📖 İçindekiler Tablosu:</strong> 
                        Not içine <code style={{color:'#3b82f6'}}>[toc]</code> veya <code style={{color:'#3b82f6'}}>[TOC]</code> yazarak nottaki tüm başlıkları tarayan tıklanabilir bir dizin oluşturabilirsiniz. Başlığa tıkladığınızda editör o satıra otomatik kayar ve odaklanır.
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                        <strong style={{ color: '#f59e0b', display: 'inline-block', width: '160px' }}>🧜‍♂️ Mermaid Diyagramları:</strong> 
                        Not içine <code style={{color:'#a855f7'}}>```mermaid</code> kod bloğu açıp akış şeması kodları yazarak şık ve etkileşimli teknik diyagramlar çizebilirsiniz (Uyumlu şemalar otomatik olarak çizilerek görselleştirilir).
                      </div>
                    </div>
                  </div>

                </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.1)' }}>
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setIsHelpModalOpen(false)}
                style={{ padding: '8px 20px', borderRadius: '6px', cursor: 'pointer' }}
              >
                Kapat
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Floating Clipboard Detection Banner */}
      {showClipboardBanner && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(24, 24, 27, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
          zIndex: 9999,
          maxWidth: '90%',
          width: '400px',
          animation: 'fadeIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#6366f1', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              📋 Kopyalanan Metin Algılandı
            </span>
            <p style={{
              fontSize: '12.5px',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              margin: 0,
              fontStyle: 'italic'
            }}>
              "{clipboardText}"
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={handleDismissClipboard}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Yoksay
            </button>
            <button
              onClick={handlePasteClipboardToNote}
              style={{
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)'
              }}
            >
              Aktif Nota Ekle
            </button>
          </div>
        </div>
      )}

      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Senkron Çakışma Çözücü: hem yerel hem bulut tarafı aynı anda değişmiş notlar için
          zaman damgasına göre otomatik yapılan seçimi burada gösterir. Kullanıcı isterse
          diğer sürümü tek tıkla seçebilir (veri kaybı yok, orijinal içerik zaten korunur). */}
      {syncConflicts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
          zIndex: 9998,
          width: '380px',
          maxHeight: '70vh',
          overflowY: 'auto',
          animation: 'fadeIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            fontWeight: 700,
            color: '#f59e0b',
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}>
            ⚠️ Senkronizasyon Çakışması ({syncConflicts.length})
          </div>
          {syncConflicts.map(c => (
            <div key={c.path} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', wordBreak: 'break-all' }}>
                {c.path}
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 8px 0', lineHeight: 1.4 }}>
                Bu not hem bu cihazda hem bulutta değişmiş. Otomatik olarak <strong>{c.autoChosenSide === 'local' ? 'yerel' : 'bulut'}</strong> sürüm kullanıldı; dilerseniz diğerini seçebilirsiniz.
              </p>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <button
                  onClick={() => handleResolveConflict(c, 'local')}
                  style={{
                    flex: 1,
                    background: c.autoChosenSide === 'local' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.05)',
                    border: c.autoChosenSide === 'local' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {c.autoChosenSide === 'local' ? '✓ ' : ''}Yerel Sürümü Kullan
                </button>
                <button
                  onClick={() => handleResolveConflict(c, 'remote')}
                  style={{
                    flex: 1,
                    background: c.autoChosenSide === 'remote' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.05)',
                    border: c.autoChosenSide === 'remote' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {c.autoChosenSide === 'remote' ? '✓ ' : ''}Bulut Sürümünü Kullan
                </button>
              </div>
              <button
                onClick={() => dismissConflict(c.path)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '10.5px',
                  cursor: 'pointer',
                  padding: '2px'
                }}
              >
                Kapat (otomatik seçimi onayla)
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Persistent Audio Element */}
      <audio
        ref={audioRef}
        src={resolvedAudioSrc || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleAudioEnded}
      />

      {/* Floating Mini Player */}
      {currentTrack && activeTab !== 'music' && showMiniPlayer && (
        <div 
          className="mini-floating-player animate-fade"
          style={{
            transform: `translate(${miniPlayerPos.x}px, ${miniPlayerPos.y}px)`,
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            position: 'relative'
          }}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          {/* Close button */}
          <button 
            onClick={(e) => {
              e.stopPropagation();
              localStorage.setItem('mini_player_manually_closed', 'true');
              setShowMiniPlayer(false);
            }}
            style={{
              position: 'absolute',
              top: '-8px',
              right: '-8px',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '10px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              zIndex: 1001
            }}
            title="Kapat"
          >
            <X size={10} />
          </button>
          <div 
            className="mini-track-info" 
            onClick={(e) => {
              if (hasMovedRef.current) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              setActiveTab('music');
            }}
          >
            <span className="mini-track-name">🎵 {currentTrack.name}</span>
          </div>
          <div className="mini-controls">
            <button className="mini-ctrl-btn" onClick={handlePrevTrack} title="Önceki">
              <SkipBack size={14} />
            </button>
            <button className="mini-ctrl-btn play-pause" onClick={handlePlayPause}>
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="mini-ctrl-btn" onClick={handleNextTrack} title="Sonraki">
              <SkipForward size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Floating Update Notification Toast */}
      {updateStatus && updateStatus.status === 'downloaded' && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 99999,
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#ffffff',
            padding: '14px 20px',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(16, 185, 129, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            animation: 'fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold' }}>🎉 Yeni Sürüm (v{updateStatus.version}) İndirildi!</span>
            <span style={{ fontSize: '11px', opacity: 0.9 }}>Güncellemeyi tamamlamak için uygulamayı şimdi yeniden başlatın.</span>
          </div>
          <button
            onClick={handleRestartAndInstall}
            style={{
              background: '#ffffff',
              color: '#059669',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              transition: 'transform 0.15s ease'
            }}
          >
            Yeniden Başlat ve Yükle
          </button>
        </div>
      )}
    </div>
  );
}
