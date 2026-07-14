import React, { useMemo } from 'react';
import {
  Clock, CheckSquare, FileText, BarChart2, Calendar, TrendingUp, BookOpen, ChevronRight, AlertTriangle, Sun, Archive
} from 'lucide-react';

interface AnalyticsViewProps {
  notes: any[];
  fileContents: Record<string, string>;
  onSelectNote: (path: string) => void;
}

// Görev satırındaki "- [ ] metin [due:...] #etiket" gibi eklentileri temizleyip
// yalnızca okunabilir görev metnini döndürür.
function cleanTaskText(raw: string): string {
  return raw
    .replace(/\[due:\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\]/g, '')
    .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/g, '')
    .replace(/\[p:[a-zçığşü]+\]/gi, '')
    .replace(/\[repeat:[a-zçığşü]+\]/gi, '')
    .replace(/#[a-zA-Z0-9_çığşüöÇİĞŞÜÖ]+/g, '')
    .trim();
}

// Durağan proje eşiği: bu kadar gündür güncellenmemiş, hâlâ açık görevi olan
// notlar "durağan" sayılır.
const STALE_DAYS_THRESHOLD = 7;

export default function AnalyticsView({
  notes,
  fileContents,
  onSelectNote
}: AnalyticsViewProps) {
  
  // Projede yazılan kodların ne için gerekli olduklarını açıklayan Türkçe yorum satırları (Kural 5)
  const analyticsData = useMemo(() => {
    let totalFocusMinutes = 0;
    let completedTasks = 0;
    let pendingTasks = 0;
    let totalWords = 0;
    
    // Günlük odaklanma süreleri eşlemesi (Tarih -> Toplam Dakika)
    const dailyFocus: Record<string, number> = {};

    // Klasör bazında not sayıları
    const folderStats: Record<string, number> = { 'Kök Dizin': 0 };

    // Not dosyalarını filtrele (excalidraw dosyaları hariç düz metin notları)
    const textNotes = notes.filter(n => n.type === 'note');

    // Günlük Özet: geciken görevler, bugüne düşen görevler ve durağan projeler
    const dueRegex = /\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;
    const now = Date.now();

    interface DueTask { path: string; noteName: string; text: string; dueDate: string; }
    const overdueTasks: DueTask[] = [];
    const dueTodayTasks: DueTask[] = [];

    interface StaleNote { path: string; noteName: string; daysSinceUpdate: number; pendingCount: number; }
    const staleNotesMap: Record<string, StaleNote> = {};

    // Her bir notun içeriğini tara
    textNotes.forEach(note => {
      const content = fileContents[note.path] || '';

      // Kelime sayısını topla
      const words = content.trim().split(/\s+/).filter(w => w.length > 0).length;
      totalWords += words;

      // Klasör dağılımını hesapla
      const pathParts = note.path.split('/');
      if (pathParts.length > 1) {
        const folderName = pathParts[0];
        folderStats[folderName] = (folderStats[folderName] || 0) + 1;
      } else {
        folderStats['Kök Dizin']++;
      }

      const noteName = note.name || pathParts[pathParts.length - 1];
      let notePendingCount = 0;

      // Satır satır tara
      const lines = content.split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();

        // 1. Görev Durumu Taraması (- [ ] ve - [x])
        if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
          completedTasks++;
        } else if (trimmed.startsWith('- [ ]')) {
          pendingTasks++;
          notePendingCount++;

          // Geciken / bugüne düşen görev tespiti
          const dm = trimmed.match(dueRegex);
          if (dm) {
            const dueDateStr = dm[1];
            const taskEntry: DueTask = {
              path: note.path,
              noteName,
              text: cleanTaskText(trimmed.substring(5)),
              dueDate: dueDateStr
            };
            if (dueDateStr === todayStr) {
              dueTodayTasks.push(taskEntry);
            } else if (dueDateStr < todayStr) {
              overdueTasks.push(taskEntry);
            }
          }
        }

        // 2. Odak Süresi Taraması (- YYYY-MM-DD: XX dk çalışıldı)
        // Regex formatı: - 2026-07-06: 25 dk çalışıldı
        const focusMatch = trimmed.match(/^- (\d{4}-\d{2}-\d{2}):\s*(\d+)\s*dk çalışıldı/i);
        if (focusMatch) {
          const date = focusMatch[1];
          const mins = parseInt(focusMatch[2], 10);
          totalFocusMinutes += mins;
          dailyFocus[date] = (dailyFocus[date] || 0) + mins;
        }
      });

      // Durağan proje tespiti: açık görevi olan, uzun süredir güncellenmemiş notlar
      if (notePendingCount > 0 && note.updatedAt) {
        const daysSinceUpdate = Math.floor((now - note.updatedAt) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate >= STALE_DAYS_THRESHOLD) {
          staleNotesMap[note.path] = { path: note.path, noteName, daysSinceUpdate, pendingCount: notePendingCount };
        }
      }
    });

    overdueTasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const staleNotesList = Object.values(staleNotesMap).sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

    // Son 7 günlük odak verilerini al (SVG grafik için)
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      return {
        dateLabel: `${dd}/${mm}`,
        dateStr,
        minutes: dailyFocus[dateStr] || 0
      };
    }).reverse();

    return {
      totalFocusMinutes,
      completedTasks,
      pendingTasks,
      totalWords,
      totalNotes: textNotes.length,
      last7Days,
      folderStats: Object.entries(folderStats)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      overdueTasks,
      dueTodayTasks,
      staleNotesList
    };
  }, [notes, fileContents]);

  const {
    totalFocusMinutes,
    completedTasks,
    pendingTasks,
    totalWords,
    totalNotes,
    last7Days,
    folderStats,
    overdueTasks,
    dueTodayTasks,
    staleNotesList
  } = analyticsData;

  const totalTasks = completedTasks + pendingTasks;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const totalFocusHours = (totalFocusMinutes / 60).toFixed(1);

  // SVG grafik için en yüksek dakikayı bul (ölçeklendirme için)
  const maxFocusMinutes = Math.max(...last7Days.map(d => d.minutes), 25); // En az 25 olsun ki boş grafik sıfıra bölünmesin

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: 'var(--bg-main)',
      color: 'var(--text-primary)',
      padding: '24px',
      boxSizing: 'border-box',
      overflowY: 'auto',
      gap: '24px'
    }}>
      {/* Page Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <BarChart2 size={24} style={{ color: 'var(--accent)' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>Verimlilik ve Çalışma Süresi Analiz Paneli</h2>
      </div>

      {/* Daily Review: Geciken + Bugüne Düşen Görevler + Durağan Projeler */}
      {(overdueTasks.length > 0 || dueTodayTasks.length > 0 || staleNotesList.length > 0) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {/* Geciken Görevler */}
          <div style={{
            background: 'var(--bg-sidebar)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxHeight: '260px',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} style={{ color: '#ef4444' }} />
              <span style={{ fontSize: '14px', fontWeight: 600 }}>Geciken Görevler</span>
              <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>{overdueTasks.length}</span>
            </div>
            {overdueTasks.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Geciken görev yok. 🎉</div>
            ) : (
              overdueTasks.map((t, i) => (
                <div
                  key={i}
                  onClick={() => onSelectNote(t.path)}
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer', padding: '6px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.06)' }}
                >
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{t.text || '(başlıksız görev)'}</span>
                  <span style={{ fontSize: '10px', color: '#ef4444' }}>{t.dueDate} · {t.noteName}</span>
                </div>
              ))
            )}
          </div>

          {/* Bugüne Düşen Görevler */}
          <div style={{
            background: 'var(--bg-sidebar)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxHeight: '260px',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sun size={16} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: '14px', fontWeight: 600 }}>Bugüne Düşen Görevler</span>
              <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: '#f59e0b' }}>{dueTodayTasks.length}</span>
            </div>
            {dueTodayTasks.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Bugün için planlanmış görev yok.</div>
            ) : (
              dueTodayTasks.map((t, i) => (
                <div
                  key={i}
                  onClick={() => onSelectNote(t.path)}
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer', padding: '6px 8px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.06)' }}
                >
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{t.text || '(başlıksız görev)'}</span>
                  <span style={{ fontSize: '10px', color: '#f59e0b' }}>{t.noteName}</span>
                </div>
              ))
            )}
          </div>

          {/* Durağan Projeler */}
          <div style={{
            background: 'var(--bg-sidebar)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxHeight: '260px',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Archive size={16} style={{ color: '#8b5cf6' }} />
              <span style={{ fontSize: '14px', fontWeight: 600 }}>Durağan Projeler</span>
              <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: '#8b5cf6' }}>{staleNotesList.length}</span>
            </div>
            {staleNotesList.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Durağan proje yok.</div>
            ) : (
              staleNotesList.map((s, i) => (
                <div
                  key={i}
                  onClick={() => onSelectNote(s.path)}
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer', padding: '6px 8px', borderRadius: '6px', background: 'rgba(139, 92, 246, 0.06)' }}
                >
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{s.noteName}</span>
                  <span style={{ fontSize: '10px', color: '#8b5cf6' }}>{s.daysSinceUpdate} gündür güncellenmedi · {s.pendingCount} açık görev</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Summary Cards Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px'
      }}>
        {/* Card 1: Focus Hours */}
        <div className="analytics-card" style={{
          background: 'var(--bg-sidebar)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            background: 'rgba(99, 102, 241, 0.15)',
            color: 'var(--accent)',
            borderRadius: '8px',
            width: '42px',
            height: '42px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Clock size={20} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Toplam Odaklanma</div>
            <div style={{ fontSize: '22px', fontWeight: 700, margin: '2px 0 0 0' }}>{totalFocusHours} <span style={{ fontSize: '14px', fontWeight: 500 }}>Saat</span></div>
          </div>
        </div>

        {/* Card 2: Task Rate */}
        <div className="analytics-card" style={{
          background: 'var(--bg-sidebar)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            background: 'rgba(16, 185, 129, 0.15)',
            color: '#10b981',
            borderRadius: '8px',
            width: '42px',
            height: '42px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <CheckSquare size={20} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Görev Tamamlama</div>
            <div style={{ fontSize: '22px', fontWeight: 700, margin: '2px 0 0 0' }}>%{taskCompletionRate}</div>
          </div>
        </div>

        {/* Card 3: Note Count */}
        <div className="analytics-card" style={{
          background: 'var(--bg-sidebar)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#f59e0b',
            borderRadius: '8px',
            width: '42px',
            height: '42px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FileText size={20} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Toplam Not Hacmi</div>
            <div style={{ fontSize: '22px', fontWeight: 700, margin: '2px 0 0 0' }}>{totalNotes} <span style={{ fontSize: '14px', fontWeight: 500 }}>Dosya</span></div>
          </div>
        </div>

        {/* Card 4: Word Count */}
        <div className="analytics-card" style={{
          background: 'var(--bg-sidebar)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            background: 'rgba(139, 92, 246, 0.15)',
            color: '#8b5cf6',
            borderRadius: '8px',
            width: '42px',
            height: '42px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <BookOpen size={20} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Yazılan Kelime</div>
            <div style={{ fontSize: '22px', fontWeight: 700, margin: '2px 0 0 0' }}>{totalWords.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Graphs Layout Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '24px'
      }}>
        
        {/* Column 1: Focus Duration Bar Chart */}
        <div style={{
          background: 'var(--bg-sidebar)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Son 7 Günlük Çalışma Akışı (dk)</span>
          </div>

          {/* SVG Bar Chart */}
          <div style={{ width: '100%', height: '180px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {last7Days.map((d, index) => {
              // Bar yüksekliği oranını hesapla (maksimum 140px olacak şekilde)
              const height = (d.minutes / maxFocusMinutes) * 140;
              return (
                <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: '8px' }}>
                  {/* Tooltip-like value above bar */}
                  <span style={{ fontSize: '10px', color: d.minutes > 0 ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600 }}>
                    {d.minutes > 0 ? `${d.minutes}` : ''}
                  </span>
                  
                  {/* Bar element */}
                  <div style={{
                    width: '28px',
                    height: `${Math.max(height, 4)}px`,
                    background: d.minutes > 0 ? 'linear-gradient(to top, rgba(99, 102, 241, 0.2), var(--accent))' : 'rgba(255,255,255,0.04)',
                    borderTopLeftRadius: '4px',
                    borderTopRightRadius: '4px',
                    border: d.minutes > 0 ? '1px solid var(--accent)' : 'none',
                    transition: 'all 0.3s ease'
                  }} />

                  {/* Label under bar */}
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500 }}>
                    {d.dateLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Doughnut Task Chart */}
        <div style={{
          background: 'var(--bg-sidebar)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={16} style={{ color: '#10b981' }} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Görev Tamamlama Analizi</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', flex: 1, gap: '20px' }}>
            {/* SVG circular doughnut chart */}
            <div style={{ position: 'relative', width: '120px', height: '120px' }}>
              <svg width="120" height="120" viewBox="0 0 36 36">
                {/* Background circle */}
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3" />
                {/* Foreground completion circle */}
                <circle
                  cx="18"
                  cy="18"
                  r="15.915"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeDasharray={`${taskCompletionRate} ${100 - taskCompletionRate}`}
                  strokeDashoffset="25" // Start from top center
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.5s ease' }}
                />
              </svg>
              {/* Doughnut center label */}
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '18px', fontWeight: 700 }}>%{taskCompletionRate}</span>
                <span style={{ fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tamamlandı</span>
              </div>
            </div>

            {/* List values */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tamamlanan: <strong>{completedTasks}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Bekleyen: <strong>{pendingTasks}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px', marginTop: '2px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Toplam Görev: <strong>{totalTasks}</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Folder Stats & File Distribution */}
      <div style={{
        background: 'var(--bg-sidebar)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={16} style={{ color: '#f59e0b' }} />
          <span style={{ fontSize: '14px', fontWeight: 600 }}>Klasör Bazlı Dosya Dağılımı</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {folderStats.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>Klasör bulunamadı</div>
          ) : (
            folderStats.map((item, idx) => {
              // Calculate percent size based on max notes count
              const maxNotes = Math.max(...folderStats.map(f => f.count), 1);
              const percent = (item.count / maxNotes) * 100;
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 500 }}>
                    <span>@{item.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{item.count} dosya</span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${percent}%`,
                      height: '100%',
                      background: 'linear-gradient(to right, rgba(245, 158, 11, 0.3), #f59e0b)',
                      borderRadius: '4px'
                    }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
