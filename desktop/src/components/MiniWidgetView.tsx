import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, RotateCcw, SkipForward, SkipBack, CheckSquare, Music, Clock, Minimize2, Plus, Check
} from 'lucide-react';

interface MiniWidgetViewProps {
  currentTrack: any;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onExitMiniMode: () => void;
  onAddQuickTodo: (text: string) => Promise<void>;

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Global Pomodoro sayacının props'ları.
  pomodoroSeconds: number;
  isPomodoroRunning: boolean;
  onTogglePomodoro: () => void;
  onResetPomodoro: () => void;
}

export default function MiniWidgetView({
  currentTrack,
  isPlaying,
  onPlayPause,
  onNext,
  onPrev,
  onExitMiniMode,
  onAddQuickTodo,
  pomodoroSeconds,
  isPomodoroRunning,
  onTogglePomodoro,
  onResetPomodoro
}: MiniWidgetViewProps) {
  const [activeTab, setActiveTab] = useState<'timer' | 'music' | 'todo'>('timer');
  
  // Todo input state
  const [todoText, setTodoText] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleTodoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todoText.trim()) return;

    await onAddQuickTodo(todoText.trim());
    setTodoText('');
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'linear-gradient(135deg, #1e1e24, #121216)',
      color: '#e1e1e6',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box',
      overflow: 'hidden',
      userSelect: 'none',
      border: '1px solid rgba(255,255,255,0.06)'
    }}>
      {/* Header (Title and Exit Button) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.2)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        gap: '8px'
      }}>
        <button
          onClick={onExitMiniMode}
          title="Normal Görünüme Dön"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: '4px',
            color: '#e1e1e6',
            width: '22px',
            height: '22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <Minimize2 size={12} />
        </button>
        {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5): */}
        {/* Electron sürükleme alanını sadece başlık metnine atayarak çıkış butonunun tıklanmasını garanti altına alıyoruz. */}
        <span style={{ 
          fontSize: '11px', 
          fontWeight: 600, 
          color: 'var(--accent)', 
          letterSpacing: '0.05em',
          flex: 1,
          height: '22px',
          display: 'flex',
          alignItems: 'center',
          WebkitAppRegion: 'drag'
        } as any}>
          WIDGET MODU
        </span>
      </div>

      {/* Widget Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px', justifyContent: 'center' }}>
        
        {/* Tab 1: Pomodoro Timer */}
        {activeTab === 'timer' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '38px', fontWeight: 700, fontFamily: 'monospace', letterSpacing: '-0.02em', color: '#fff', textShadow: '0 0 10px rgba(255,255,255,0.1)' }}>
              {formatTime(pomodoroSeconds)}
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
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
                  background: 'rgba(255,255,255,0.05)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#e1e1e6'
                }}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Music Player */}
        {activeTab === 'music' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center' }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 500,
              color: '#fff',
              maxWidth: '300px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              padding: '4px 0'
            }}>
              {currentTrack ? `🎵 ${currentTrack.name}` : 'Müzik oynatılmıyor'}
            </div>
            
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <button
                onClick={onPrev}
                disabled={!currentTrack}
                style={{ background: 'transparent', border: 'none', color: currentTrack ? '#e1e1e6' : '#555', cursor: 'pointer' }}
              >
                <SkipBack size={16} />
              </button>
              <button
                onClick={onPlayPause}
                disabled={!currentTrack}
                style={{
                  background: currentTrack ? 'var(--accent)' : '#555',
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
                {isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" style={{ marginLeft: '2px' }} />}
              </button>
              <button
                onClick={onNext}
                disabled={!currentTrack}
                style={{ background: 'transparent', border: 'none', color: currentTrack ? '#e1e1e6' : '#555', cursor: 'pointer' }}
              >
                <SkipForward size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Quick Todo */}
        {activeTab === 'todo' && (
          <form onSubmit={handleTodoSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder="Gelen kutusuna todo ekle..."
                value={todoText}
                onChange={(e) => setTodoText(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(0,0,0,0.2)',
                  color: '#fff',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#white',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <Plus size={16} color="white" />
              </button>
            </div>
            {showSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#34d399', justifyContent: 'center' }}>
                <Check size={12} /> Görev eklendi! (inbox.md)
              </div>
            )}
          </form>
        )}
      </div>

      {/* Tab Navigation Footer */}
      <div style={{
        display: 'flex',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(0,0,0,0.1)'
      }}>
        <button
          onClick={() => setActiveTab('timer')}
          style={{
            flex: 1,
            background: activeTab === 'timer' ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: 'none',
            color: activeTab === 'timer' ? 'var(--accent)' : '#a1a1aa',
            padding: '10px 0',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <Clock size={12} /> Zamanlayıcı
        </button>
        <button
          onClick={() => setActiveTab('music')}
          style={{
            flex: 1,
            background: activeTab === 'music' ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: 'none',
            color: activeTab === 'music' ? 'var(--accent)' : '#a1a1aa',
            padding: '10px 0',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <Music size={12} /> Müzik
        </button>
        <button
          onClick={() => setActiveTab('todo')}
          style={{
            flex: 1,
            background: activeTab === 'todo' ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: 'none',
            color: activeTab === 'todo' ? 'var(--accent)' : '#a1a1aa',
            padding: '10px 0',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <CheckSquare size={12} /> Todo Ekle
        </button>
      </div>
    </div>
  );
}
