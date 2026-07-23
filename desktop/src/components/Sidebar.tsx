import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Inbox, FileText, Calendar, Database, Folder, Tag, Plus, Settings, Trash2,
  Briefcase, Code, Heart, Star, BookOpen, Sparkles, Coffee, Rocket, Smile, HelpCircle,
  ChevronLeft, ChevronRight, ChevronDown, Sun, Moon, Layout, Award
} from 'lucide-react';
import { type DevPath, getRankForXp, getAllSystemNoteNames } from '../devPaths';

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
  // BUG DÜZELTMESİ: native window.confirm() yerine App.tsx'teki paylaşılan uygulama-içi
  // onay modalını kullanır — bkz. App.tsx'teki requestConfirm üstündeki ayrıntılı yorum
  // (confirm() gerçek bir pencere blur/focus olayı tetiklemediği için odağa dayalı
  // temizleme mekanizmaları silme onayı sırasında hiç çalışmıyordu).
  onRequestConfirm?: (message: string, onConfirm: () => void) => void;
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
  isDevPathsEnabled?: boolean;
  developmentPaths?: Record<string, DevPath>;
  onOpenPathDetail?: (path: string) => void;
  fileContents?: Record<string, string>;
  notes?: any[];
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  appVersion?: string;
  updateStatus?: {
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    version?: string;
    percent?: number;
    text?: string;
  } | null;
  onRestartAndInstall?: () => void;
}

interface DevPathsWidgetProps {
  isCollapsed: boolean;
  developmentPaths: Record<string, DevPath>;
  onNavigateToPath: (path: string) => void;
  onOpenPathDetail: (path: string) => void;
  notes: any[];
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Bir yolun kök klasörü altındaki notların en son ne zaman güncellendiğini bulur —
// "Son çalışma: X gün önce" göstergesi için. Not yoksa null döner (henüz başlanmadı).
// Sistem/AI tarafından otomatik yazılan notlar (Başlangıç Notu, Seviye Bilgisi, ve
// 'advanced'/'complete' modda üretilen alt-notlar/Soru Kartları — bkz.
// getAllSystemNoteNames) hariç tutulur — bunlar kullanıcı notu DEĞİL, klasörler
// oluşturulur oluşturulmaz veya konu durumu her değiştiğinde otomatik yazılır;
// dahil edilirse "Bugün çalışıldı" göstergesi kullanıcı hiçbir şey yazmadan
// yanlışlıkla tetiklenir.
const getPathLastActivityDays = (path: string, notes: any[], devPath: DevPath): number | null => {
  const systemNoteNames = getAllSystemNoteNames(devPath);
  const relevant = notes.filter(n =>
    n.type !== 'folder' &&
    n.path.startsWith(path + '/') &&
    !systemNoteNames.has(n.path.split('/').pop() || '')
  );
  if (relevant.length === 0) return null;
  const lastUpdated = Math.max(...relevant.map(n => n.updatedAt || 0));
  if (!lastUpdated) return null;
  return Math.floor((Date.now() - lastUpdated) / (1000 * 60 * 60 * 24));
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Eski "Odak Evcil Hayvanı" widget'ının yerini alır. `mode: 'simple'` (Faz 1, AI'sız) için
// eski rütbe/XP çubuğunu, `mode: 'ai'` (Faz 2, Gemini müfredatı) için o seviyenin unvanını
// ve konu-bazlı ilerleme çubuğunu gösterir; tıklanınca detay paneli açılır.
function DevPathsWidget({ isCollapsed, developmentPaths, onNavigateToPath, onOpenPathDetail, notes }: DevPathsWidgetProps) {
  const paths = Object.keys(developmentPaths);

  if (paths.length === 0) {
    if (isCollapsed) return null;
    return (
      <div style={{
        margin: '10px 14px',
        padding: '12px',
        borderRadius: '10px',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px dashed rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>🎖️ GELİŞİM YOLLARIM</span>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
          Bir klasöre sağ tıklayıp "Gelişim Yolu Olarak İşaretle" ile başla.
        </span>
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <div style={{ padding: '8px', textAlign: 'center', color: 'var(--text-muted)' }} title={`${paths.length} gelişim yolu`}>
        <Award size={16} />
      </div>
    );
  }

  return (
    <div style={{ margin: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-muted)' }}>🎖️ GELİŞİM YOLLARIM</span>
      {paths.map(path => {
        const devPath = developmentPaths[path];
        const isAiMode = (devPath.mode || 'simple') === 'ai' && devPath.levels && devPath.levels.length > 0;

        let titleLabel: string;
        let progressPercent: number;
        let onClick: () => void;

        if (isAiMode) {
          const levelIdx = devPath.currentLevelIndex ?? 0;
          const level = devPath.levels![levelIdx];
          const passedCount = level.topics.filter(t => t.status === 'passed').length;
          titleLabel = level.title;
          progressPercent = level.topics.length > 0 ? Math.round((passedCount / level.topics.length) * 100) : 0;
          onClick = () => onOpenPathDetail(path);
        } else {
          const xp = devPath.xp ?? 0;
          const rank = getRankForXp(xp);
          titleLabel = rank.name;
          progressPercent = rank.nextMinXp
            ? Math.min(100, Math.round(((xp - rank.minXp) / (rank.nextMinXp - rank.minXp)) * 100))
            : 100;
          onClick = () => onNavigateToPath(path);
        }

        const daysSince = getPathLastActivityDays(path, notes, devPath);
        const activityLabel = daysSince === null
          ? 'Henüz başlanmadı'
          : daysSince === 0
          ? 'Bugün çalışıldı 🔥'
          : daysSince === 1
          ? 'Dün çalışıldı'
          : `Son çalışma: ${daysSince} gün önce`;
        const activityColor = daysSince !== null && daysSince <= 1 ? '#22c55e' : daysSince !== null && daysSince >= 3 ? '#f59e0b' : 'var(--text-muted)';

        return (
          <div
            key={path}
            onClick={onClick}
            style={{
              cursor: 'pointer',
              padding: '8px 10px',
              borderRadius: '8px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
            title={devPath.label}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {devPath.label}
              </span>
              <span style={{ fontSize: '9.5px', color: 'var(--accent-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px' }}>{titleLabel}</span>
            </div>
            <div style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'var(--bg-hover)', overflow: 'hidden' }}>
              <div style={{ width: `${progressPercent}%`, height: '100%', borderRadius: '2px', background: 'var(--accent-color)', transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ fontSize: '9px', color: activityColor }}>{activityLabel}</span>
          </div>
        );
      })}
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
  onRequestConfirm,
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
  isDevPathsEnabled = true,
  developmentPaths = {},
  onOpenPathDetail,
  fileContents = {},
  notes = [],
  theme = 'dark',
  onToggleTheme,
  appVersion,
  updateStatus,
  onRestartAndInstall
}: SidebarProps) {
  // Klasör ağacı Accordion durumu: alt klasörü olan bir klasör daraltıldığında
  // (collapsed) tüm alt öğeleri gizlenir. Seçim yapılabilirlik için localStorage'da saklanır.
  //
  // BUG DÜZELTMESİ (ilk denemede çalışmadı): `folders` prop'u ilk render'da HENÜZ BOŞ
  // geliyor (App.tsx verileri diskten asenkron yüklüyor) — bu yüzden aşağıdaki gibi bir
  // useState BAŞLANGIÇ DEĞERİ (`() => new Set(folders)`) sadece bir kez, o boş anda
  // çalışıyor ve bir daha ASLA yeniden çalışmıyor; sonuç: collapsedFolders hep boş Set
  // olarak kalıyor (= hiçbir şey kapalı değil). Kayıtlı bir tercih olup olmadığını mount
  // anında sabitliyoruz, gerçek "hepsi kapalı" varsayılanını ise `folders` GERÇEKTEN
  // dolduğunda (aşağıdaki effect'te) uyguluyoruz.
  const hadSavedFolderPrefRef = useRef<boolean>(false);
  const defaultCollapseAppliedRef = useRef<boolean>(false);

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('sidebar_collapsed_folders_v2');
      if (saved) {
        hadSavedFolderPrefRef.current = true;
        return new Set(JSON.parse(saved));
      }
      return new Set();
    } catch (e) {
      hadSavedFolderPrefRef.current = true;
      return new Set();
    }
  });

  const toggleFolderCollapse = (folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      localStorage.setItem('sidebar_collapsed_folders_v2', JSON.stringify([...next]));
      return next;
    });
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ: collapsedFolders girdileri klasör yeniden adlandırma/senkron sonrası
  // yapı değişince ASLA temizlenmiyordu — eski bir yol string'i (ör. "Eğitim/Azure Studies")
  // artık farklı bir klasörün yolu olsa bile "daraltılmış" kalabiliyor, bu da o klasörün
  // okunun yanlış (ilgisiz) bir düğümü aç/kapa yapıyormuş gibi görünmesine yol açıyordu.
  // Mevcut `folders` listesinde artık bulunmayan her girdiyi burada buduyoruz. Aynı effect,
  // `folders` gerçekten ilk kez dolduğunda (ve kayıtlı bir tercih yoksa) "hepsi kapalı"
  // varsayılanını da burada, TEK SEFERLİK olarak uyguluyor.
  useEffect(() => {
    if (folders.length === 0) return;

    if (!hadSavedFolderPrefRef.current && !defaultCollapseAppliedRef.current) {
      defaultCollapseAppliedRef.current = true;
      setCollapsedFolders(new Set(folders));
      return;
    }

    setCollapsedFolders(prev => {
      const validFolders = new Set(folders);
      let changed = false;
      const next = new Set<string>();
      prev.forEach(folder => {
        if (validFolders.has(folder)) {
          next.add(folder);
        } else {
          changed = true;
        }
      });
      if (!changed) return prev;
      localStorage.setItem('sidebar_collapsed_folders_v2', JSON.stringify([...next]));
      return next;
    });
  }, [folders]);

  return (
    <aside className={`sidebar ${isSidebarOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
      {/* App Logo / Title */}
      <div className="sidebar-brand" style={{ justifyContent: isCollapsed ? 'center' : 'space-between', padding: isCollapsed ? '16px 0' : '16px 20px' }}>
        {!isCollapsed ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img src="/favicon.png" alt="Ultimate NoteFactory" className="brand-logo" />
              <div className="brand-title">
                <span>Ultimate</span>
                <span className="brand-subtitle">NoteFactory {appVersion ? `v${appVersion}` : ''}</span>
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
        {!isCollapsed && (
        <>
          {/* Divider */}
          <div className="sidebar-divider" />

          {/* Folders Section */}
          <div className="sidebar-section sidebar-section-folders">
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

                // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                // .templates, .versions gibi nokta ile başlayan sistem klasörleri hâlâ tamamen
                // işlevsel taranır/kullanılır — sadece kullanıcıya görünen klasör ağacında gösterilmezler.
                if (parts[0].startsWith('.')) return null;

                // Bu klasörün üstündeki (ata) klasörlerden herhangi biri daraltılmışsa
                // (collapsed) bu klasörü gizle — Accordion görünürlük mantığı.
                const isHiddenByCollapsedAncestor = parts.slice(0, depth).some((_, i) => {
                  const ancestorPath = parts.slice(0, i + 1).join('/');
                  return collapsedFolders.has(ancestorPath);
                });
                if (isHiddenByCollapsedAncestor) return null;

                const hasChildren = folders.some(f => f !== folder && f.startsWith(folder + '/'));
                const isCollapsed = collapsedFolders.has(folder);

                const custom = folderCustomizations[folder] || {};
                const customColor = custom.color;
                const customIconName = custom.icon || 'Folder';
                const CustomFolderIcon = iconMap[customIconName] || Folder;
                const isActive = selectedFolder === folder;

                const itemStyle: React.CSSProperties = {
                  paddingLeft: `${10 + depth * 12}px`,
                  paddingRight: hasChildren ? '46px' : '28px',
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
                    {hasChildren && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFolderCollapse(folder);
                        }}
                        title={isCollapsed ? 'Genişlet' : 'Daralt'}
                        style={{
                          position: 'absolute',
                          right: '26px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '16px',
                          height: '16px',
                          cursor: 'pointer',
                          color: 'var(--text-muted)'
                        }}
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </span>
                    )}
                    <button
                      className="btn-delete-folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        const message = `"${name}" klasörünü ve içindeki tüm notları silmek istediğinize emin misiniz?`;
                        if (onRequestConfirm) {
                          onRequestConfirm(message, () => onDeleteFolder(folder));
                        } else if (confirm(message)) {
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
          Gelişim Yolları (rütbe) modülü aktifse, sol menünün altına yerleştirilir. */}
      {isDevPathsEnabled && (
        <DevPathsWidget
          isCollapsed={isCollapsed}
          developmentPaths={developmentPaths}
          onNavigateToPath={(path) => setSelectedFolder(path)}
          onOpenPathDetail={(path) => onOpenPathDetail?.(path)}
          notes={notes}
        />
      )}

      {/* Footer / Settings & Sync Status */}
      <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '10px', alignItems: isCollapsed ? 'center' : 'stretch' }}>
        
        {/* Live Auto-Updater Status Banner */}
        {updateStatus && updateStatus.status === 'downloading' && (
          <div style={{
            padding: isCollapsed ? '6px' : '8px 10px',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#a5b4fc',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            {!isCollapsed && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 'bold' }}>
                <span>⬇️ Sürüm v{updateStatus.version || ''} İndiriliyor</span>
                <span>%{updateStatus.percent || 0}</span>
              </div>
            )}
            <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ width: `${updateStatus.percent || 0}%`, height: '100%', background: 'var(--accent-color)', transition: 'width 0.2s ease' }} />
            </div>
          </div>
        )}

        {updateStatus && updateStatus.status === 'downloaded' && (
          <div 
            onClick={onRestartAndInstall}
            style={{
              padding: isCollapsed ? '6px' : '8px 12px',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#ffffff',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCollapsed ? 'center' : 'space-between',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)'
            }}
            title="Tıklayarak uygulamayı yeniden başlatın ve güncellemeyi yükleyin"
          >
            {!isCollapsed ? (
              <>
                <span>🚀 v{updateStatus.version} Hazır! Yükle</span>
                <span>➔</span>
              </>
            ) : (
              <span>🚀</span>
            )}
          </div>
        )}

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
