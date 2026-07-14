import React, { useState, useEffect, useRef, useMemo } from 'react';
import NoteFactoryView from './NoteFactoryView';
import type { Track } from './MusicPlayerView';
import {
  Play, Pause, RotateCcw, Clock, CheckSquare, FileText, BarChart2, GripVertical, Music, Plus, Check, SkipForward, SkipBack, AlertTriangle, Sun
} from 'lucide-react';

interface DashboardViewProps {
  onProcessInput: (input: any) => Promise<any>;
  folders: string[];
  notes: any[];
  tags: string[];
  fileContents: Record<string, string>;
  onSelectNote: (path: string) => void;
  onSaveNote: (path: string, content: string) => Promise<void>;
  
  // Music player props
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Global Pomodoro sayacının props'ları.
  pomodoroSeconds: number;
  isPomodoroRunning: boolean;
  onTogglePomodoro: () => void;
  onResetPomodoro: () => void;
}

export default function DashboardView({
  onProcessInput,
  folders,
  notes,
  tags,
  fileContents,
  onSelectNote,
  onSaveNote,
  currentTrack,
  isPlaying,
  onPlayPause,
  onNext,
  onPrev,
  pomodoroSeconds,
  isPomodoroRunning,
  onTogglePomodoro,
  onResetPomodoro
}: DashboardViewProps) {
  
  // Widget sıralama durumunu localStorage'dan al veya varsayılanı kullan
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('dashboard_widget_order_v2');
    const order = saved ? JSON.parse(saved) : ['todayReview', 'pomodoro', 'recentNotes', 'taskSummary', 'productivity', 'musicPlayer'];
    const filtered = order.filter((id: string) => id !== 'notfactory');
    // Daha önce kaydedilmiş sıralamalarda yeni "todayReview" widget'ı yoksa başa ekle.
    if (!filtered.includes('todayReview')) {
      filtered.unshift('todayReview');
    }
    return filtered;
  });

  const [draggedOverId, setDraggedOverId] = useState<string | null>(null);
  
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Yazma hızları sıfırlandığında Gösterge Paneli bileşeninin anında güncellenmesini sağlayan tetikleyici state.
  const [resetTrigger, setResetTrigger] = useState(0);

  // Quick Todo States
  const [todoInput, setTodoInput] = useState('');
  const [todoSuccess, setTodoSuccess] = useState(false);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Son güncellenen notları sırala (excalidraw hariç)
  const recentNotes = useMemo(() => {
    return [...notes]
      .filter(n => n.type === 'note')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5);
  }, [notes]);

  // Gelen kutusundaki tamamlanmamış görevleri tara
  const pendingInboxTasks = useMemo(() => {
    const inboxContent = fileContents['inbox.md'] || '';
    const lines = inboxContent.split('\n');
    const tasks: string[] = [];
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
      if (trimmed.startsWith('- [ ]')) {
        const text = line.replace(/[-*+]\s+\[\s*\]/, '').trim();
        if (text) tasks.push(text);
      }
    });
    return tasks.slice(0, 5);
  }, [fileContents]);

  // Günlük Özet: geciken görevler + bugüne düşen görevler (tüm notlar taranır)
  const todayReview = useMemo(() => {
    const dueRegex = /\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/;
    const cleanText = (raw: string) => raw
      .replace(/\[due:\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]/g, '')
      .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/g, '')
      .replace(/\[p:[a-zçığşü]+\]/gi, '')
      .replace(/\[repeat:[a-zçığşü]+\]/gi, '')
      .replace(/#[a-zA-Z0-9_çığşüöÇİĞŞÜÖ]+/g, '')
      .trim();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;

    interface DueTask { path: string; noteName: string; text: string; dueDate: string; }
    const overdue: DueTask[] = [];
    const dueToday: DueTask[] = [];

    notes.filter(n => n.type === 'note').forEach(note => {
      const content = fileContents[note.path] || '';
      const noteName = note.name || note.path.split('/').pop() || note.path;
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('- [ ]')) return;
        const dm = trimmed.match(dueRegex);
        if (!dm) return;
        const entry = { path: note.path, noteName, text: cleanText(trimmed.substring(5)), dueDate: dm[1] };
        if (dm[1] === todayStr) dueToday.push(entry);
        else if (dm[1] < todayStr) overdue.push(entry);
      });
    });

    overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { overdue, dueToday };
  }, [notes, fileContents]);

  // Verimlilik Analiz Verileri
  const stats = useMemo(() => {
    let completed = 0;
    let pending = 0;
    let totalWords = 0;
    notes.filter(n => n.type === 'note').forEach(n => {
      const content = fileContents[n.path] || '';
      totalWords += content.trim().split(/\s+/).filter(w => w.length > 0).length;
      let isInTable = false;
      content.split('\n').forEach(l => {
        const trimmed = l.trim();
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
        if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) completed++;
        else if (trimmed.startsWith('- [ ]')) pending++;
      });
    });
    return { completed, pending, totalWords, totalNotes: notes.filter(n => n.type === 'note').length };
  }, [notes, fileContents]);

  // Quick Todo form submit
  const handleQuickTodoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todoInput.trim()) return;

    const inboxPath = 'inbox.md';
    const currentInbox = fileContents[inboxPath] || '';
    const updated = currentInbox ? `${currentInbox.trimEnd()}\n- [ ] ${todoInput.trim()}\n` : `- [ ] ${todoInput.trim()}\n`;
    await onSaveNote(inboxPath, updated);
    setTodoInput('');
    setTodoSuccess(true);
    setTimeout(() => setTodoSuccess(false), 2000);
  };

  // HTML5 Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDraggedOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDraggedOverId(null);
    const sourceId = e.dataTransfer.getData('text/plain');
    if (sourceId === targetId) return;

    const sourceIdx = widgetOrder.indexOf(sourceId);
    const targetIdx = widgetOrder.indexOf(targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const newOrder = [...widgetOrder];
    newOrder.splice(sourceIdx, 1);
    newOrder.splice(targetIdx, 0, sourceId);

    setWidgetOrder(newOrder);
    localStorage.setItem('dashboard_widget_order_v2', JSON.stringify(newOrder));
  };

  // Render Widget Content
  const renderWidgetContent = (id: string) => {
    switch (id) {
      case 'notfactory':
        return (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Plus size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Hızlı Giriş</span>
            </div>
            <div style={{ flex: 1 }}>
              <NoteFactoryView
                onProcessInput={onProcessInput}
                folders={folders}
                notes={notes}
                tags={tags}
              />
            </div>
          </div>
        );

      case 'todayReview': {
        const { overdue, dueToday } = todayReview;
        const isEmpty = overdue.length === 0 && dueToday.length === 0;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sun size={16} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Bugün</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, overflowY: 'auto', maxHeight: '220px' }}>
              {isEmpty ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Geciken veya bugüne düşen görev yok. 🎉</div>
              ) : (
                <>
                  {overdue.map((t, idx) => (
                    <div
                      key={`o-${idx}`}
                      onClick={() => onSelectNote(t.path)}
                      style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer', padding: '6px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.06)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertTriangle size={11} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text || '(başlıksız görev)'}</span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#ef4444', marginLeft: '17px' }}>{t.dueDate} · {t.noteName}</span>
                    </div>
                  ))}
                  {dueToday.map((t, idx) => (
                    <div
                      key={`t-${idx}`}
                      onClick={() => onSelectNote(t.path)}
                      style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer', padding: '6px 8px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.06)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Sun size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text || '(başlıksız görev)'}</span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#f59e0b', marginLeft: '17px' }}>{t.noteName}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        );
      }

      case 'pomodoro':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Odaklanma Sayacı</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px' }}>
              <div style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'monospace' }}>
                {formatTime(pomodoroSeconds)}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={onTogglePomodoro}
                  style={{
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white'
                  }}
                >
                  {isPomodoroRunning ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" style={{ marginLeft: '2px' }} />}
                </button>
                <button
                  onClick={onResetPomodoro}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'var(--text-primary)'
                  }}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
          </div>
        );

      case 'recentNotes':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={16} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Son Düzenlenen Notlar</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {recentNotes.map((note, index) => (
                <div
                  key={index}
                  onClick={() => onSelectNote(note.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s ease'
                  }}
                  className="recent-note-row"
                >
                  <span style={{ fontWeight: 500 }}>📄 {note.name}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {new Date(note.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'taskSummary':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckSquare size={16} style={{ color: '#10b981' }} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Gelen Kutusu Görevleri</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
              {pendingInboxTasks.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Planlanmış görev yok</div>
              ) : (
                pendingInboxTasks.map((task, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '6px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.01)' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task}</span>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleQuickTodoSubmit} style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
              <input
                type="text"
                placeholder="Hızlı todo ekle..."
                value={todoInput}
                onChange={(e) => setTodoInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 500
                }}
              >
                Ekle
              </button>
            </form>
          </div>
        );

      case 'productivity':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart2 size={16} style={{ color: '#8b5cf6' }} />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Verimlilik Özet</span>
              </div>
              <button
                onClick={() => {
                  if (confirm('Yazma hızı istatistiklerini sıfırlamak istediğinize emin misiniz?')) {
                    localStorage.removeItem('typing_max_wpm');
                    localStorage.removeItem('typing_total_time_ms');
                    localStorage.removeItem('typing_total_chars');
                    setResetTrigger(prev => prev + 1);
                  }
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                  fontWeight: '500'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#ff4a5a'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                Hızları Sıfırla
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>TOPLAM GÖREV</div>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px' }}>{stats.completed + stats.pending}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>TAMAMLANAN</div>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', color: '#10b981' }}>{stats.completed}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>TOPLAM KELİME</div>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px' }}>{stats.totalWords.toLocaleString()}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>TOPLAM NOT</div>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', color: '#8b5cf6' }}>{stats.totalNotes}</div>
              </div>
              
              {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                  Dinamik yazma hızı istatistikleri (En Yüksek WPM ve Ortalama WPM). */}
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>EN YÜKSEK HIZ</div>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', color: '#f59e0b' }}>
                  {localStorage.getItem('typing_max_wpm') || '0'} WPM
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>ORTALAMA HIZ</div>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', color: '#3b82f6' }}>
                  {(() => {
                    const totalChars = Number(localStorage.getItem('typing_total_chars') || '0');
                    const totalTimeMs = Number(localStorage.getItem('typing_total_time_ms') || '0');
                    return totalTimeMs > 0 ? Math.round((totalChars * 12000) / totalTimeMs) : 0;
                  })()} WPM
                </div>
              </div>
            </div>
          </div>
        );

      case 'musicPlayer':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Music size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Müzik Oynatıcı</span>
            </div>
            {currentTrack ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 500, maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  🎵 {currentTrack.name}
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button onClick={onPrev} style={{ background: 'transparent', border: 'none', color: '#e1e1e6', cursor: 'pointer' }}><SkipBack size={14} /></button>
                  <button
                    onClick={onPlayPause}
                    style={{
                      background: 'var(--accent)',
                      border: 'none',
                      borderRadius: '50%',
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: 'white'
                    }}
                  >
                    {isPlaying ? <Pause size={12} fill="white" /> : <Play size={12} fill="white" style={{ marginLeft: '1px' }} />}
                  </button>
                  <button onClick={onNext} style={{ background: 'transparent', border: 'none', color: '#e1e1e6', cursor: 'pointer' }}><SkipForward size={14} /></button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Müzik Kutusu sekmesinden müzik başlatın</div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: 'var(--bg-main)',
      color: 'var(--text-primary)',
      boxSizing: 'border-box',
      overflowY: 'auto'
    }}>
      {/* Dashboard Grid Container */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '20px',
        padding: '24px'
      }}>
        {widgetOrder.map((id) => {
          const isOver = draggedOverId === id;
          return (
            <div
              key={id}
              draggable="true"
              onDragStart={(e) => handleDragStart(e, id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDrop={(e) => handleDrop(e, id)}
              style={{
                background: 'var(--bg-sidebar)',
                border: isOver ? '1px dashed var(--accent)' : '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '16px 20px 20px 20px',
                minHeight: '180px',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                transform: isOver ? 'scale(0.98)' : 'scale(1)',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
              }}
            >
              {/* Drag Handle Top Bar */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                height: '14px',
                marginBottom: '4px',
                cursor: 'grab'
              }}>
                <GripVertical size={14} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
              </div>
              
              {/* Widget Main Content */}
              <div style={{ flex: 1 }}>
                {renderWidgetContent(id)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
