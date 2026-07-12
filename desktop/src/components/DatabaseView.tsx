import React, { useState, useEffect } from 'react';
import { 
  Table, Kanban, Search, Tag, Folder, CheckCircle2, Circle, Hash, 
  FileText, Clock, Calendar, Plus, X, Eye, Grid, List, 
  ChevronLeft, ChevronRight, Star 
} from 'lucide-react';

/* ==========================================================================
   BÖLÜM 1: YARDIMCI FONKSİYONLAR (HELPERS) - Kural 5
   Görevlerin puanlarının hesaplanması, puan kırılımlarının çıkarılması ve
   içerikteki özel etiketlerin (etiketler, tarihler vb.) parse edilmesi.
   ========================================================================== */

// Görevlerin öncelik ve bitiş tarihine göre puanını hesaplar
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
      score += 8; // Gecikmiş görev
    } else if (diffDays === 0 || diffDays === 1) {
      score += 5; // Bugün veya yarın
    } else if (diffDays <= 7) {
      score += 3; // 1 hafta içinde
    } else {
      score += 1;
    }
  }

  return score;
};

// Görev puanının detay kırılımını kullanıcıya tooltip olarak göstermek için oluşturur
const getScoreBreakdown = (text: string, totalScore: number): string => {
  if (!text || typeof text !== 'string') return '📊 Puan Kırılımı:\n  Öncelik: yok\n  Bitiş tarihi: yok\n  Toplam: 0';
  const lines: string[] = ['📊 Puan Kırılımı:'];
  const pm = text.match(/\[p:(critical|acil|high|yüksek|medium|orta|low|düşük)\]/i);
  if (pm) {
    const p = pm[1].toLowerCase();
    const lm: Record<string,string> = { critical:'Kritik',acil:'Kritik',high:'Yüksek','yüksek':'Yüksek',medium:'Orta',orta:'Orta',low:'Düşük','düşük':'Düşük' };
    const sm: Record<string,number> = { critical:10,acil:10,high:6,'yüksek':6,medium:3,orta:3,low:1,'düşük':1 };
    lines.push(`  Öncelik (${lm[p]??p}): +${sm[p]??0}`);
  } else { lines.push('  Öncelik: yok'); }
  const dm = text.match(/\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/);
  if (dm) {
    const now = new Date(); now.setHours(0,0,0,0);
    const due = new Date(dm[1]); due.setHours(0,0,0,0);
    const dd = Math.ceil((due.getTime()-now.getTime())/(86400000));
    let ds=0,dl='';
    if(dd<0){ds=8;dl='Gecikmiş';} else if(dd===0){ds=5;dl='Bugün';} else if(dd===1){ds=5;dl='Yarın';} else if(dd<=7){ds=3;dl=`${dd} gün sonra`;} else{ds=1;dl=`${dd} gün sonra`;}
    lines.push(`  Bitiş tarihi (${dl}): +${ds}`);
  } else { lines.push('  Bitiş tarihi: yok'); }
  lines.push(`  Toplam: ${totalScore}`);
  return lines.join('\n');
};

// Görev veya not içeriğindeki markdown benzeri özel etiketleri (due date, priority, tag) HTML badge'lere dönüştürür
const parseCardContent = (text: string, showScoreBadge: boolean = false): React.ReactNode[] => {
  if (!text) return [];

  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|#[a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_-]+|\[\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]|\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]|\[due:\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]|\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\])/gi;
  const parts = text.split(regex);
  const score = showScoreBadge ? calculateTaskScore(text) : 0;

  const result: React.ReactNode[] = [];

  if (score > 0) {
    result.push(
      <span key="score" className="preview-task-score-badge" title={getScoreBreakdown(text, score)} style={{ marginRight: '6px' }}>
        ⭐ Puan: {score}
      </span>
    );
  }

  const parsedParts = parts.map((part, i) => {
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
      return <span key={i} className="preview-tag-chip" style={{ margin: '0 2px' }}>{part}</span>;
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

      return <span key={i} className={`preview-priority-badge ${className}`}>{label}</span>;
    }
    if (part.startsWith('[due:') && part.endsWith(']')) {
      const dueDateVal = part.slice(5, -1);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const dueDate = new Date(dueDateVal.split(' ')[0]);
      dueDate.setHours(0, 0, 0, 0);
      const isOverdue = dueDate < now;

      return (
        <span key={i} className={`preview-due-badge ${isOverdue ? 'overdue' : ''}`}>
          <Calendar size={10} style={{ marginRight: '3px', display: 'inline-block', verticalAlign: 'middle' }} />
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
        <span key={i} className="preview-timestamp-badge" style={{ padding: '1px 5px', fontSize: '10.5px' }}>
          <Clock size={9} style={{ marginRight: '3px', display: 'inline-block', verticalAlign: 'middle', opacity: 0.7 }} />
          <span style={{ verticalAlign: 'middle' }}>{dateVal}</span>
        </span>
      );
    }
    return part;
  });

  return [...result, ...parsedParts];
};

/* ==========================================================================
   BÖLÜM 2: TİP TANIMLAMALARI (TYPES) - Kural 5
   Veritabanı öğelerinin, görünüm sekmelerinin ve React props tiplerinin tanımlanması.
   ========================================================================== */

interface DbItem {
  id: string;
  content: string;
  dateStr: string;
  isTodo: boolean;
  isCompleted: boolean;
  folder: string | null;
  note: string | null;
  tags: string[];
}

interface DatabaseViewProps {
  items: DbItem[];
  selectedTag: string | null;
  selectedFolder: string | null;
  onToggleTodo: (id: string) => void;
}

// Görünüm sekmeleri (Tabs) için geçerli tipler
type ViewType = 'table' | 'kanban' | 'gallery' | 'list' | 'calendar' | 'timeline' | 'priority';

interface DbView {
  id: string;
  name: string;
  type: ViewType;
}

/* ==========================================================================
   BÖLÜM 3: ANA BİLEŞEN (DATABASE VIEW MAIN COMPONENT) - Kural 5
   ========================================================================== */

export default function DatabaseView({
  items,
  selectedTag,
  selectedFolder,
  onToggleTodo
}: DatabaseViewProps) {
  
  // --- Görünüm (View) State'leri ---
  const [views, setViews] = useState<DbView[]>(() => {
    const saved = localStorage.getItem('db_views_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Görünüm konfigürasyonu okunurken hata:", e);
      }
    }
    return [
      { id: 'default-table', name: 'Tablo Görünümü', type: 'table' },
      { id: 'default-kanban', name: 'Kanban Panosu', type: 'kanban' }
    ];
  });

  const [activeViewId, setActiveViewId] = useState<string>(() => {
    const savedActive = localStorage.getItem('db_active_view_id');
    if (savedActive) {
      return savedActive;
    }
    return 'default-table';
  });

  // --- Arama, Filtreleme ve Takvim/Modal State'leri ---
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'todo' | 'note'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewType, setNewViewType] = useState<ViewType>('table');
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());

  // Görünüm değişikliklerini localStorage'a kaydet
  useEffect(() => {
    localStorage.setItem('db_views_config', JSON.stringify(views));
  }, [views]);

  useEffect(() => {
    localStorage.setItem('db_active_view_id', activeViewId);
  }, [activeViewId]);

  // Aktif görünüm bilgisini bul
  const activeView = views.find(v => v.id === activeViewId) || views[0] || { id: 'default-table', type: 'table' };

  // --- Filtreleme Mantığı ---
  const filteredItems = items.filter(item => {
    // Sidebar'dan seçilen etikete göre filtrele
    if (selectedTag && !item.tags.includes(selectedTag.toLowerCase())) {
      return false;
    }

    // Sidebar'dan seçilen klasöre göre filtrele
    if (selectedFolder && item.folder !== selectedFolder) {
      return false;
    }

    // Arama kelimesine göre filtrele
    const matchesSearch = item.content.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (item.folder && item.folder.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Görev/Not tipine göre filtrele
    const matchesType = typeFilter === 'all' || 
                        (typeFilter === 'todo' && item.isTodo) || 
                        (typeFilter === 'note' && !item.isTodo);

    return matchesSearch && matchesType;
  });

  // --- Görünüm Ekleme / Silme Metotları ---
  const handleAddView = () => {
    if (!newViewName.trim()) return;
    const newId = 'view-' + Date.now();
    const newView: DbView = {
      id: newId,
      name: newViewName.trim(),
      type: newViewType
    };
    setViews([...views, newView]);
    setActiveViewId(newId);
    setIsAddModalOpen(false);
    setNewViewName('');
  };

  const handleDeleteView = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (views.length <= 1) return; // En az bir görünüm kalması zorunludur
    const updated = views.filter(v => v.id !== id);
    setViews(updated);
    if (activeViewId === id) {
      setActiveViewId(updated[0].id);
    }
  };

  // --- Kanban Görünümü İçin Alt Gruplar ---
  const todoItems = filteredItems.filter(item => item.isTodo && !item.isCompleted);
  const doneItems = filteredItems.filter(item => item.isTodo && item.isCompleted);
  const noteItems = filteredItems.filter(item => !item.isTodo);

  // --- Takvim Görünümü İçin Hesaplamalar ---
  const getItemDateString = (item: DbItem): string => {
    // Bitiş tarihi ([due:YYYY-MM-DD]) varsa önceliklidir
    const dueMatch = item.content.match(/\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/);
    if (dueMatch) {
      return dueMatch[1];
    }
    return item.dateStr;
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    const firstDayOfMonth = new Date(year, month, 1);
    // Pazartesi'yi haftanın ilk günü (index 0) yapmak için
    const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; 
    
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const totalDays = lastDayOfMonth.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    
    const days: { date: Date; isCurrentMonth: boolean; dayNum: number }[] = [];
    
    // Bir önceki aydan sarkan günler
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false,
        dayNum: prevMonthLastDay - i
      });
    }
    
    // Geçerli ayın günleri
    for (let i = 1; i <= totalDays; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
        dayNum: i
      });
    }
    
    // Bir sonraki aydan sarkan günler (toplam ızgarayı 42 güne tamamlamak için)
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
        dayNum: i
      });
    }
    
    return days;
  };

  const formatDateISO = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const calendarDays = getDaysInMonth(currentMonthDate);
  const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const weekDays = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

  // --- Zaman Tüneli (Timeline) Görünümü Gruplaması ---
  const groupedByDate: Record<string, DbItem[]> = {};
  const sortedItemsForTimeline = [...filteredItems].sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  sortedItemsForTimeline.forEach(item => {
    const d = item.dateStr || 'Tarihsiz';
    if (!groupedByDate[d]) {
      groupedByDate[d] = [];
    }
    groupedByDate[d].push(item);
  });
  const sortedTimelineDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  // --- Öncelik Matrisi (Priority Matrix) Çeyrek Hesaplamaları ---
  const getPriorityQuadrant = (item: DbItem): 'critical' | 'high' | 'medium' | 'low' => {
    const text = item.content.toLowerCase();
    if (text.includes('[p:critical]') || text.includes('[p:acil]')) return 'critical';
    if (text.includes('[p:high]') || text.includes('[p:yüksek]')) return 'high';
    if (text.includes('[p:medium]') || text.includes('[p:orta]')) return 'medium';
    return 'low';
  };

  const criticalItems = filteredItems.filter(item => getPriorityQuadrant(item) === 'critical');
  const highPriorityItems = filteredItems.filter(item => getPriorityQuadrant(item) === 'high');
  const mediumPriorityItems = filteredItems.filter(item => getPriorityQuadrant(item) === 'medium');
  const lowPriorityItems = filteredItems.filter(item => getPriorityQuadrant(item) === 'low');

  return (
    <div className="db-container animate-fade">
      {/* Database Başlık ve Toolbar */}
      <div className="db-toolbar">
        <div className="db-title-area">
          <h1>Not Deposu (Database)</h1>
          <p className="subtitle">Tüm verilerinizi Notion benzeri yapılandırılmış görünümlerde yönetin.</p>
        </div>

        <div className="db-controls">
          {/* Arama Wrapper */}
          <div className="search-wrapper">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Depoda ara (metin, klasör, etiket)..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Tip Seçim Kutusu */}
          <select 
            value={typeFilter} 
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="filter-select"
          >
            <option value="all">Tüm Tipler</option>
            <option value="todo">Görevler (Todos)</option>
            <option value="note">Notlar</option>
          </select>
        </div>
      </div>

      {/* ==========================================================================
         BÖLÜM 4: SEKME YÖNETİMİ (VIEW TABS) - Kural 5
         ========================================================================== */}
      <div className="db-view-tabs">
        {views.map(view => {
          const isActive = view.id === activeViewId;
          return (
            <button 
              key={view.id}
              className={`db-view-tab ${isActive ? 'active' : ''}`}
              onClick={() => setActiveViewId(view.id)}
            >
              {/* Tipine göre ikon */}
              {view.type === 'table' && <Table size={14} />}
              {view.type === 'kanban' && <Kanban size={14} />}
              {view.type === 'gallery' && <Grid size={14} />}
              {view.type === 'list' && <List size={14} />}
              {view.type === 'calendar' && <Calendar size={14} />}
              {view.type === 'timeline' && <Clock size={14} />}
              {view.type === 'priority' && <Star size={14} />}
              
              <span>{view.name}</span>
              
              {/* Silme Butonu (En az 1 view kalması şartıyla) */}
              {views.length > 1 && (
                <button 
                  className="db-view-tab-close"
                  onClick={(e) => handleDeleteView(view.id, e)}
                  title="Görünümü Sil"
                >
                  <X size={10} />
                </button>
              )}
            </button>
          );
        })}
        
        {/* Yeni Görünüm Ekleme Butonu */}
        <button 
          className="db-view-tab-add"
          onClick={() => {
            setNewViewName("Galeri Görünümü");
            setNewViewType("gallery");
            setIsAddModalOpen(true);
          }}
        >
          <Plus size={12} />
          <span>Görünüm Ekle</span>
        </button>
      </div>

      {/* ==========================================================================
         BÖLÜM 5: GÖRÜNÜM İÇERİKLERİNİN OLUŞTURULMASI (RENDER ACTIVE VIEW) - Kural 5
         ========================================================================== */}
      <div className="db-body">
        
        {/* --- 5.1: TABLO GÖRÜNÜMÜ (TABLE VIEW) --- */}
        {activeView.type === 'table' && (
          <div className="db-table-wrapper">
            <table className="db-table">
              <thead>
                <tr>
                  <th>Öğe Başlığı / İçerik</th>
                  <th>Tip</th>
                  <th>Klasör</th>
                  <th>İlgili Not</th>
                  <th>Tarih</th>
                  <th>Etiketler</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-empty">Eşleşen veri bulunamadı.</td>
                  </tr>
                ) : (
                  filteredItems.map(item => (
                    <tr key={item.id}>
                      <td className="cell-content">
                        {item.isTodo ? (
                          <div className="cell-todo-wrapper">
                            <button className="todo-toggle-btn" onClick={() => onToggleTodo(item.id)}>
                              {item.isCompleted ? (
                                <CheckCircle2 size={16} className="text-success" />
                              ) : (
                                <Circle size={16} />
                              )}
                            </button>
                            <span className={item.isCompleted ? 'text-completed' : ''}>
                              {parseCardContent(item.content, !item.isCompleted)}
                            </span>
                          </div>
                        ) : (
                          <div className="cell-note-wrapper">
                            <FileText size={16} className="text-muted" />
                            <span>{parseCardContent(item.content, false)}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`type-badge ${item.isTodo ? 'todo' : 'note'}`}>
                          {item.isTodo ? 'Task' : 'Note'}
                        </span>
                      </td>
                      <td>
                        {item.folder ? (
                          <span className="folder-link">
                            <Folder size={12} />
                            {item.folder}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {item.note ? (
                          <span className="note-ref">
                            {item.note}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="cell-date">{item.dateStr}</td>
                      <td>
                        <div className="cell-tags">
                          {item.tags.map(tag => (
                            <span key={tag} className="table-tag-chip">
                              <Hash size={8} />
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* --- 5.2: KANBAN PANOSU (KANBAN VIEW) --- */}
        {activeView.type === 'kanban' && (
          <div className="kanban-board">
            {/* Column 1: Yapılacaklar */}
            <div className="kanban-col">
              <div className="col-header todo">
                <h3>Yapılacaklar</h3>
                <span className="col-count">{todoItems.length}</span>
              </div>
              <div className="col-cards">
                {todoItems.length === 0 ? (
                  <div className="empty-col-card">Açık görev yok.</div>
                ) : (
                  todoItems.map(item => (
                    <div key={item.id} className="kanban-card">
                      <div className="card-top">
                        <button className="todo-toggle-btn" onClick={() => onToggleTodo(item.id)}>
                          <Circle size={16} />
                        </button>
                        <p>{parseCardContent(item.content, true)}</p>
                      </div>
                      <div className="card-bottom">
                        {item.folder && <span className="kb-badge folder">@{item.folder}</span>}
                        {item.tags.map(t => <span key={t} className="kb-badge tag">#{t}</span>)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Column 2: Notlar */}
            <div className="kanban-col">
              <div className="col-header notes">
                <h3>Bilgi Bankası / Notlar</h3>
                <span className="col-count">{noteItems.length}</span>
              </div>
              <div className="col-cards">
                {noteItems.length === 0 ? (
                  <div className="empty-col-card">Kayıtlı not yok.</div>
                ) : (
                  noteItems.map(item => (
                    <div key={item.id} className="kanban-card note-card">
                      <div className="card-top">
                        <FileText size={16} className="card-icon text-accent" />
                        <p className="note-title">{parseCardContent(item.content, false)}</p>
                      </div>
                      <div className="card-bottom">
                        {item.folder && <span className="kb-badge folder">@{item.folder}</span>}
                        {item.tags.map(t => <span key={t} className="kb-badge tag">#{t}</span>)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Column 3: Tamamlananlar */}
            <div className="kanban-col">
              <div className="col-header done">
                <h3>Tamamlanan Görevler</h3>
                <span className="col-count">{doneItems.length}</span>
              </div>
              <div className="col-cards">
                {doneItems.length === 0 ? (
                  <div className="empty-col-card">Henüz tamamlanan görev yok.</div>
                ) : (
                  doneItems.map(item => (
                    <div key={item.id} className="kanban-card done-card">
                      <div className="card-top">
                        <button className="todo-toggle-btn" onClick={() => onToggleTodo(item.id)}>
                          <CheckCircle2 size={16} className="text-success" />
                        </button>
                        <p className="line-through">{parseCardContent(item.content, false)}</p>
                      </div>
                      <div className="card-bottom">
                        {item.folder && <span className="kb-badge folder">@{item.folder}</span>}
                        {item.tags.map(t => <span key={t} className="kb-badge tag">#{t}</span>)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- 5.3: GALERİ GÖRÜNÜMÜ (GALLERY VIEW) --- */}
        {activeView.type === 'gallery' && (
          <div className="db-gallery-grid">
            {filteredItems.length === 0 ? (
              <div className="table-empty">Eşleşen veri bulunamadı.</div>
            ) : (
              filteredItems.map(item => (
                <div key={item.id} className="db-gallery-card">
                  <div className="db-gallery-header">
                    {item.isTodo ? (
                      <div className="cell-todo-wrapper">
                        <button className="todo-toggle-btn" onClick={() => onToggleTodo(item.id)}>
                          {item.isCompleted ? (
                            <CheckCircle2 size={16} className="text-success" />
                          ) : (
                            <Circle size={16} />
                          )}
                        </button>
                        <span className={`db-gallery-type todo ${item.isCompleted ? 'text-completed' : ''}`}>GÖREV</span>
                      </div>
                    ) : (
                      <div className="cell-note-wrapper">
                        <FileText size={16} className="text-muted" />
                        <span className="db-gallery-type note">NOT</span>
                      </div>
                    )}
                  </div>
                  
                  <div className={`db-gallery-content ${item.isCompleted ? 'text-completed' : ''}`}>
                    {parseCardContent(item.content, item.isTodo && !item.isCompleted)}
                  </div>

                  <div className="db-gallery-footer">
                    <div className="db-gallery-meta">
                      {item.folder && (
                        <span className="db-gallery-meta-item folder-link">
                          <Folder size={11} />
                          {item.folder}
                        </span>
                      )}
                      <span className="db-gallery-meta-item">
                        <Clock size={11} />
                        {item.dateStr}
                      </span>
                    </div>
                    {item.tags.length > 0 && (
                      <div className="db-gallery-tags">
                        {item.tags.map(t => (
                          <span key={t} className="db-gallery-tag-chip">#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* --- 5.4: LİSTE GÖRÜNÜMÜ (LIST VIEW) --- */}
        {activeView.type === 'list' && (
          <div className="db-list-container">
            {filteredItems.length === 0 ? (
              <div className="table-empty">Eşleşen veri bulunamadı.</div>
            ) : (
              filteredItems.map(item => (
                <div key={item.id} className="db-list-row">
                  <div className="db-list-left">
                    {item.isTodo ? (
                      <button className="todo-toggle-btn" onClick={() => onToggleTodo(item.id)}>
                        {item.isCompleted ? (
                          <CheckCircle2 size={16} className="text-success" />
                        ) : (
                          <Circle size={16} />
                        )}
                      </button>
                    ) : (
                      <FileText size={16} className="text-muted" />
                    )}
                    <span className={`db-list-title ${item.isCompleted ? 'text-completed' : ''}`}>
                      {parseCardContent(item.content, item.isTodo && !item.isCompleted)}
                    </span>
                  </div>
                  <div className="db-list-right">
                    {item.folder && (
                      <span className="db-list-folder">
                        <Folder size={11} style={{ marginRight: '3px' }} />
                        {item.folder}
                      </span>
                    )}
                    <span className="db-list-date">
                      <Clock size={11} />
                      {item.dateStr}
                    </span>
                    {item.tags.length > 0 && (
                      <div className="db-list-tags">
                        {item.tags.map(t => (
                          <span key={t} className="table-tag-chip">#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* --- 5.5: TAKVİM GÖRÜNÜMÜ (CALENDAR VIEW) --- */}
        {activeView.type === 'calendar' && (
          <div className="db-calendar-container">
            <div className="db-calendar-header">
              <div className="db-calendar-title">
                {monthNames[currentMonthDate.getMonth()]} {currentMonthDate.getFullYear()}
              </div>
              <div className="db-calendar-nav">
                <button className="db-calendar-nav-btn" onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1))}>
                  <ChevronLeft size={16} />
                </button>
                <button className="db-calendar-nav-btn" style={{ fontSize: '11px', width: 'auto', padding: '0 10px' }} onClick={() => setCurrentMonthDate(new Date())}>
                  Bugün
                </button>
                <button className="db-calendar-nav-btn" onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1))}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="db-calendar-grid-wrapper">
              <div className="db-calendar-weekdays">
                {weekDays.map(d => (
                  <div key={d} className="db-calendar-weekday">{d}</div>
                ))}
              </div>
              <div className="db-calendar-grid">
                {calendarDays.map((day, idx) => {
                  const dateStr = formatDateISO(day.date);
                  const dayItems = filteredItems.filter(item => getItemDateString(item) === dateStr);
                  const isToday = formatDateISO(new Date()) === dateStr;
                  
                  return (
                    <div key={idx} className={`db-calendar-cell ${day.isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}`}>
                      <span className="db-calendar-day-num">{day.dayNum}</span>
                      <div className="db-calendar-items-wrapper">
                        {dayItems.map(item => (
                          <div 
                            key={item.id} 
                            className={`db-calendar-item ${item.isTodo ? 'todo' : 'note'} ${item.isCompleted ? 'completed' : ''}`}
                            title={item.content}
                            onClick={() => item.isTodo && onToggleTodo(item.id)}
                          >
                            {item.isTodo ? (
                              item.isCompleted ? '✓ ' : '☐ '
                            ) : '• '}
                            {item.content.replace(/#\w+|\[.*?\]/g, '').trim() || 'İsimsiz Öğe'}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* --- 5.6: ZAMAN TÜNELİ GÖRÜNÜMÜ (TIMELINE VIEW) --- */}
        {activeView.type === 'timeline' && (
          <div className="db-timeline-v-container">
            <div className="db-timeline-v-line"></div>
            {sortedTimelineDates.length === 0 ? (
              <div className="table-empty">Eşleşen veri bulunamadı.</div>
            ) : (
              sortedTimelineDates.map(date => (
                <div key={date} className="db-timeline-v-group">
                  <div className="db-timeline-v-node"></div>
                  <div className="db-timeline-v-date">{date}</div>
                  <div className="db-timeline-v-content">
                    {groupedByDate[date].map(item => (
                      <div key={item.id} className="db-timeline-v-card" onClick={() => item.isTodo && onToggleTodo(item.id)}>
                        <div className="db-timeline-v-card-top">
                          {item.isTodo ? (
                            <button className="todo-toggle-btn" onClick={(e) => { e.stopPropagation(); onToggleTodo(item.id); }}>
                              {item.isCompleted ? (
                                <CheckCircle2 size={16} className="text-success" />
                              ) : (
                                <Circle size={16} />
                              )}
                            </button>
                          ) : (
                            <FileText size={16} className="text-muted" style={{ marginTop: '2px' }} />
                          )}
                          <div className={`db-timeline-v-text ${item.isCompleted ? 'text-completed' : ''}`}>
                            {parseCardContent(item.content, item.isTodo && !item.isCompleted)}
                          </div>
                        </div>
                        <div className="db-timeline-v-card-bottom">
                          <span className="db-timeline-v-folder">
                            {item.folder ? `@${item.folder}` : ''}
                          </span>
                          {item.tags.length > 0 && (
                            <div className="db-timeline-v-tags">
                              {item.tags.map(t => (
                                <span key={t} className="table-tag-chip">#{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* --- 5.7: ÖNCELİK MATRİSİ GÖRÜNÜMÜ (PRIORITY MATRIX VIEW) --- */}
        {activeView.type === 'priority' && (
          <div className="db-matrix-grid">
            
            {/* 1. Çeyrek: Kritik & Acil */}
            <div className="db-matrix-quadrant quadrant-critical">
              <div className="db-matrix-title critical">
                <span>🔥 Kritik & Acil (Hemen Yap)</span>
                <span className="db-matrix-count">{criticalItems.length}</span>
              </div>
              <div className="db-matrix-list">
                {criticalItems.length === 0 ? (
                  <div className="empty-col-card">Bu kategoride görev bulunmuyor.</div>
                ) : (
                  criticalItems.map(item => (
                    <div key={item.id} className="db-matrix-card" onClick={() => item.isTodo && onToggleTodo(item.id)}>
                      <div className="db-matrix-card-top">
                        {item.isTodo ? (
                          <button className="todo-toggle-btn" onClick={(e) => { e.stopPropagation(); onToggleTodo(item.id); }}>
                            {item.isCompleted ? (
                              <CheckCircle2 size={15} className="text-success" />
                            ) : (
                              <Circle size={15} />
                            )}
                          </button>
                        ) : (
                          <FileText size={15} className="text-muted" />
                        )}
                        <span className={item.isCompleted ? 'text-completed' : ''}>
                          {parseCardContent(item.content, item.isTodo && !item.isCompleted)}
                        </span>
                      </div>
                      <div className="db-matrix-card-bottom">
                        <span>{item.folder ? `@${item.folder}` : ''}</span>
                        <span>{item.dateStr}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 2. Çeyrek: Yüksek Öncelik */}
            <div className="db-matrix-quadrant quadrant-high">
              <div className="db-matrix-title high">
                <span>⚡ Yüksek Öncelik (Planla)</span>
                <span className="db-matrix-count">{highPriorityItems.length}</span>
              </div>
              <div className="db-matrix-list">
                {highPriorityItems.length === 0 ? (
                  <div className="empty-col-card">Bu kategoride görev bulunmuyor.</div>
                ) : (
                  highPriorityItems.map(item => (
                    <div key={item.id} className="db-matrix-card" onClick={() => item.isTodo && onToggleTodo(item.id)}>
                      <div className="db-matrix-card-top">
                        {item.isTodo ? (
                          <button className="todo-toggle-btn" onClick={(e) => { e.stopPropagation(); onToggleTodo(item.id); }}>
                            {item.isCompleted ? (
                              <CheckCircle2 size={15} className="text-success" />
                            ) : (
                              <Circle size={15} />
                            )}
                          </button>
                        ) : (
                          <FileText size={15} className="text-muted" />
                        )}
                        <span className={item.isCompleted ? 'text-completed' : ''}>
                          {parseCardContent(item.content, item.isTodo && !item.isCompleted)}
                        </span>
                      </div>
                      <div className="db-matrix-card-bottom">
                        <span>{item.folder ? `@${item.folder}` : ''}</span>
                        <span>{item.dateStr}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 3. Çeyrek: Orta Öncelik */}
            <div className="db-matrix-quadrant quadrant-medium">
              <div className="db-matrix-title medium">
                <span>📌 Orta Öncelik (Devret / Planla)</span>
                <span className="db-matrix-count">{mediumPriorityItems.length}</span>
              </div>
              <div className="db-matrix-list">
                {mediumPriorityItems.length === 0 ? (
                  <div className="empty-col-card">Bu kategoride görev bulunmuyor.</div>
                ) : (
                  mediumPriorityItems.map(item => (
                    <div key={item.id} className="db-matrix-card" onClick={() => item.isTodo && onToggleTodo(item.id)}>
                      <div className="db-matrix-card-top">
                        {item.isTodo ? (
                          <button className="todo-toggle-btn" onClick={(e) => { e.stopPropagation(); onToggleTodo(item.id); }}>
                            {item.isCompleted ? (
                              <CheckCircle2 size={15} className="text-success" />
                            ) : (
                              <Circle size={15} />
                            )}
                          </button>
                        ) : (
                          <FileText size={15} className="text-muted" />
                        )}
                        <span className={item.isCompleted ? 'text-completed' : ''}>
                          {parseCardContent(item.content, item.isTodo && !item.isCompleted)}
                        </span>
                      </div>
                      <div className="db-matrix-card-bottom">
                        <span>{item.folder ? `@${item.folder}` : ''}</span>
                        <span>{item.dateStr}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 4. Çeyrek: Düşük Öncelik & Önceliksiz */}
            <div className="db-matrix-quadrant quadrant-low">
              <div className="db-matrix-title low">
                <span>☕ Düşük Öncelik & Önceliksiz (Gereksizleri Ayıkla)</span>
                <span className="db-matrix-count">{lowPriorityItems.length}</span>
              </div>
              <div className="db-matrix-list">
                {lowPriorityItems.length === 0 ? (
                  <div className="empty-col-card">Bu kategoride görev bulunmuyor.</div>
                ) : (
                  lowPriorityItems.map(item => (
                    <div key={item.id} className="db-matrix-card" onClick={() => item.isTodo && onToggleTodo(item.id)}>
                      <div className="db-matrix-card-top">
                        {item.isTodo ? (
                          <button className="todo-toggle-btn" onClick={(e) => { e.stopPropagation(); onToggleTodo(item.id); }}>
                            {item.isCompleted ? (
                              <CheckCircle2 size={15} className="text-success" />
                            ) : (
                              <Circle size={15} />
                            )}
                          </button>
                        ) : (
                          <FileText size={15} className="text-muted" />
                        )}
                        <span className={item.isCompleted ? 'text-completed' : ''}>
                          {parseCardContent(item.content, item.isTodo && !item.isCompleted)}
                        </span>
                      </div>
                      <div className="db-matrix-card-bottom">
                        <span>{item.folder ? `@${item.folder}` : ''}</span>
                        <span>{item.dateStr}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

      </div>

      {/* ==========================================================================
         BÖLÜM 6: GÖRÜNÜM EKLEME MODALI (ADD VIEW DIALOG MODAL) - Kural 5
         ========================================================================== */}
      {isAddModalOpen && (
        <div className="db-view-modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="db-view-modal" onClick={e => e.stopPropagation()}>
            <h3>Yeni Görünüm Ekle</h3>
            
            <div className="db-view-modal-field">
              <label>Görünüm Adı</label>
              <input 
                type="text" 
                placeholder="Örn: Galeri Görünümü" 
                value={newViewName}
                onChange={e => setNewViewName(e.target.value)}
              />
            </div>
            
            <div className="db-view-modal-field">
              <label>Görünüm Tipi</label>
              <select 
                value={newViewType}
                onChange={e => {
                  const type = e.target.value as ViewType;
                  setNewViewType(type);
                  
                  // Tipe göre varsayılan ad öner
                  if (!newViewName || newViewName.trim() === "" || [
                    "Tablo Görünümü", "Kanban Panosu", "Galeri Görünümü", 
                    "Liste Görünümü", "Takvim Görünümü", "Zaman Tüneli", "Öncelik Matrisi"
                  ].includes(newViewName)) {
                    const defaultNames: Record<ViewType, string> = {
                      table: "Tablo Görünümü",
                      kanban: "Kanban Panosu",
                      gallery: "Galeri Görünümü",
                      list: "Liste Görünümü",
                      calendar: "Takvim Görünümü",
                      timeline: "Zaman Tüneli",
                      priority: "Öncelik Matrisi"
                    };
                    setNewViewName(defaultNames[type]);
                  }
                }}
              >
                <option value="table">Tablo</option>
                <option value="kanban">Kanban</option>
                <option value="gallery">Galeri</option>
                <option value="list">Liste</option>
                <option value="calendar">Takvim</option>
                <option value="timeline">Zaman Tüneli (Timeline)</option>
                <option value="priority">Öncelik Matrisi (Priority Matrix)</option>
              </select>
            </div>
            
            <div className="db-view-modal-actions">
              <button className="db-view-modal-btn cancel" onClick={() => setIsAddModalOpen(false)}>
                İptal
              </button>
              <button className="db-view-modal-btn confirm" onClick={handleAddView}>
                Oluştur
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
