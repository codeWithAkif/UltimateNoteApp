import React, { useState } from 'react';
import { Clock, CheckCircle2, Circle, Tag as TagIcon, Folder as FolderIcon, Hash } from 'lucide-react';
import GraphView from './GraphView';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

interface TimelineItem {
  id: string;
  content: string;
  timestamp: string;
  dateStr: string; // YYYY-MM-DD
  isTodo: boolean;
  isCompleted: boolean;
  status?: 'todo' | 'in-progress' | 'done';
  isSubtask?: boolean;
  parentId?: string;
  folder: string | null;
  note: string | null;
  tags: string[];
}

interface TimelineViewProps {
  timelineItems: TimelineItem[];
  selectedTag: string | null;
  selectedFolder: string | null;
  onToggleTodo: (id: string) => void;
  onOpenNote: (item: TimelineItem) => void;
  notes?: NoteItem[];
  scannedContents?: Record<string, string>;
  onOpenNotePath?: (path: string) => void;
  folderCustomizations?: Record<string, { icon?: string; color?: string }>;
}

const calculateTaskScore = (text: string): number => {
  if (!text || typeof text !== 'string') return 0;
  let score = 0;

  // Extract Priority: [p:critical/acil] = 10, [p:high/yüksek] = 6, [p:medium/orta] = 3, [p:low/düşük] = 1
  const priorityMatch = text.match(/\[p:(critical|acil|high|yüksek|medium|orta|low|düşük)\]/i);
  if (priorityMatch) {
    const p = priorityMatch[1].toLowerCase();
    if (p === 'critical' || p === 'acil') score += 10;
    else if (p === 'high' || p === 'yüksek') score += 6;
    else if (p === 'medium' || p === 'orta') score += 3;
    else if (p === 'low' || p === 'düşük') score += 1;
  }

  // Extract Due Date: [due:YYYY-MM-DD]
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
      score += 8; // Overdue
    } else if (diffDays === 0 || diffDays === 1) {
      score += 5; // Due today or tomorrow
    } else if (diffDays <= 7) {
      score += 3; // Due within a week
    } else {
      score += 1;
    }
  }

  return score;
};

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

const parseCardContent = (text: string, showScoreBadge: boolean = false): React.ReactNode[] => {
  if (!text) return [];

  // Highlight tags, bold, italic, code, timestamps, priorities, due dates, repeats
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
          <Clock size={10} style={{ marginRight: '3px', display: 'inline-block', verticalAlign: 'middle' }} />
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

export default function TimelineView({
  timelineItems,
  selectedTag,
  selectedFolder,
  onToggleTodo,
  onOpenNote,
  notes = [],
  scannedContents = {},
  onOpenNotePath,
  folderCustomizations = {}
}: TimelineViewProps) {
  const [activeViewTab, setActiveViewTab] = useState<'timeline' | 'graph'>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filter timeline items
  const filteredItems = timelineItems.filter((item) => {
    if (selectedTag && !item.tags.includes(selectedTag)) return false;
    if (selectedFolder && item.folder !== selectedFolder) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const contentMatch = item.content.toLowerCase().includes(q);
      const noteMatch = item.note ? item.note.toLowerCase().includes(q) : false;
      const folderMatch = item.folder ? item.folder.toLowerCase().includes(q) : false;
      const tagMatch = item.tags.some(t => t.toLowerCase().includes(q));
      
      const displayDateStr = new Date(item.dateStr).toLocaleDateString('tr-TR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).toLowerCase();
      const dateMatch = item.dateStr.includes(q) || displayDateStr.includes(q) || item.timestamp.includes(q);
      
      return contentMatch || noteMatch || folderMatch || tagMatch || dateMatch;
    }
    return true;
  });

  // Group items by date
  const groupedItems: { [date: string]: TimelineItem[] } = {};
  filteredItems.forEach((item) => {
    if (!groupedItems[item.dateStr]) {
      groupedItems[item.dateStr] = [];
    }
    groupedItems[item.dateStr].push(item);
  });

  // Sort dates descending
  const sortedDates = Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));

  return (
    <div 
      className="timeline-container animate-fade" 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        overflow: 'hidden',
        padding: activeViewTab === 'graph' ? '0px' : undefined
      }}
    >
      <div className="timeline-header" style={{ paddingBottom: '12px', flexShrink: 0, paddingLeft: activeViewTab === 'graph' ? '12px' : undefined, paddingRight: activeViewTab === 'graph' ? '12px' : undefined }}>
        <div style={{ display: 'flex', justifyContent: activeViewTab === 'graph' ? 'center' : 'space-between', alignItems: 'center', width: '100%', padding: activeViewTab === 'graph' ? '6px 0' : undefined }}>
          {activeViewTab !== 'graph' && (
            <div>
              <h1>Zaman Akışı & Grafik Görünümü</h1>
              <p className="subtitle">Gün gün ne eklediğinizi takip edin ve not ilişkilerini görselleştirin.</p>
            </div>
          )}
          
          {/* Tab Navigation */}
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', gap: '4px' }}>
            <button
              onClick={() => setActiveViewTab('timeline')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                background: activeViewTab === 'timeline' ? 'var(--accent-color)' : 'transparent',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                transition: 'all 0.2s'
              }}
            >
              📅 Zaman Akışı
            </button>
            <button
              onClick={() => setActiveViewTab('graph')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                background: activeViewTab === 'graph' ? 'var(--accent-color)' : 'transparent',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                transition: 'all 0.2s'
              }}
            >
              🕸️ Grafik Görünümü
            </button>
          </div>
        </div>

        {/* Search and Filters row */}
        {activeViewTab === 'timeline' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginTop: '16px' }}>
            <input
              type="text"
              placeholder="Zaman akışında ara... (örn: süt, #iş)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                minWidth: '240px',
                maxWidth: '400px',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                outline: 'none'
              }}
            />
            
            {/* Active Filters Info */}
            {(selectedTag || selectedFolder) && (
              <div className="active-filters-bar" style={{ margin: 0 }}>
                <span>Filtreler:</span>
                {selectedFolder && <span className="filter-badge folder">@{selectedFolder}</span>}
                {selectedTag && <span className="filter-badge tag">#{selectedTag}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {activeViewTab === 'graph' ? (
        <GraphView
          notes={notes}
          scannedContents={scannedContents}
          onOpenNotePath={onOpenNotePath || (() => {})}
          folderCustomizations={folderCustomizations}
        />
      ) : (
        <div className="timeline-body" style={{ flex: 1, overflowY: 'auto' }}>
          {sortedDates.length === 0 ? (
            <div className="timeline-empty">
              <Clock size={48} />
              <h3>Zaman akışı boş</h3>
              <p>
                {searchQuery 
                  ? "Aradığınız kriterlere uygun zaman akışı öğesi bulunamadı."
                  : "Inbox veya Çalışma Alanından notlar ekledikçe zaman akışınız burada şekillenecektir."}
              </p>
            </div>
          ) : (
            <div className="timeline-thread">
              {sortedDates.map((dateStr) => {
                const displayDate = new Date(dateStr).toLocaleDateString('tr-TR', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                });

                return (
                  <div key={dateStr} className="timeline-day-group">
                    <div className="timeline-day-header">
                      <div className="day-bullet" />
                      <h3>{displayDate}</h3>
                    </div>

                    <div className="timeline-day-items">
                      {groupedItems[dateStr].map((item) => (
                        <div 
                          key={item.id} 
                          className={`timeline-card ${item.isTodo ? 'is-todo' : ''} ${item.isCompleted ? 'completed' : ''}`}
                        >
                          {/* Bullet / Toggle Circle */}
                          <div className="timeline-card-left">
                            {item.isTodo ? (
                              <button className="todo-toggle-btn" onClick={() => onToggleTodo(item.id)}>
                                {item.isCompleted ? (
                                  <CheckCircle2 size={18} className="text-success" />
                                ) : (
                                  <Circle size={18} />
                                )}
                              </button>
                            ) : (
                              <div className="card-bullet-dot" />
                            )}
                          </div>

                          {/* Content & Metadata */}
                          <div 
                            className="timeline-card-right"
                            onClick={() => onOpenNote(item)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="card-meta">
                              <span className="card-time">{item.timestamp}</span>
                              <div className="card-badges">
                                {item.folder && (
                                  <span className="card-badge folder">
                                    <FolderIcon size={10} />
                                    {item.folder}
                                  </span>
                                )}
                                {item.note && (
                                  <span className="card-badge note">
                                    {item.note}
                                  </span>
                                )}
                                {item.tags.map((tag) => (
                                  <span key={tag} className="card-badge tag">
                                    <Hash size={8} />
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <p className="card-content-text">{parseCardContent(item.content, item.isTodo && !item.isCompleted)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
