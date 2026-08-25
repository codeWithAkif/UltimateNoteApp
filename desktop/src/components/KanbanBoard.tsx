import React, { useState } from 'react';
import type { TimelineItem } from '../App';
import { Clock, Tag } from 'lucide-react';

type KanbanStatus = 'backlog' | 'inprogress' | 'review' | 'blocked' | 'done';

interface KanbanBoardProps {
  tasks: TimelineItem[];
  onChangeTaskStatus: (id: string, newStatus: KanbanStatus) => void;
  onOpenNote?: (item: TimelineItem) => void;
}

// Eski görevlerin çoğunda [status:] etiketi yok — item.kanbanStatus bu yüzden geriye dönük
// uyumlu şekilde App.tsx tarafında checkbox işaretinden zaten türetilip dolduruluyor. Burada
// yine de savunma amaçlı bir fallback bırakıyoruz (kanbanStatus hiç set edilmemişse).
const resolveStatus = (t: TimelineItem): KanbanStatus => {
  if (t.kanbanStatus) return t.kanbanStatus;
  if (t.status === 'done' || t.isCompleted) return 'done';
  if (t.status === 'in-progress') return 'inprogress';
  return 'backlog';
};

const COLUMNS: { key: KanbanStatus; title: string; accent?: string }[] = [
  { key: 'backlog', title: 'Backlog' },
  { key: 'inprogress', title: 'Devam Ediyor', accent: 'var(--accent-color)' },
  { key: 'review', title: 'İncelemede', accent: '#eab308' },
  { key: 'blocked', title: 'Bloklu', accent: '#ef4444' },
  { key: 'done', title: 'Bitti', accent: '#4caf50' },
];

export default function KanbanBoard({ tasks, onChangeTaskStatus, onOpenNote }: KanbanBoardProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const tasksByStatus: Record<KanbanStatus, TimelineItem[]> = {
    backlog: [], inprogress: [], review: [], blocked: [], done: [],
  };
  tasks.forEach(t => tasksByStatus[resolveStatus(t)].push(t));

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedTaskId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, status: KanbanStatus) => {
    e.preventDefault();
    if (draggedTaskId) {
      onChangeTaskStatus(draggedTaskId, status);
      setDraggedTaskId(null);
    }
  };

  const renderCard = (task: TimelineItem) => (
    <div
      key={task.id}
      draggable
      onDragStart={(e) => handleDragStart(e, task.id)}
      className="kanban-card"
      style={{
        background: 'var(--bg-tertiary)',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '10px',
        border: '1px solid var(--border-color)',
        cursor: 'grab',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}
      onClick={() => onOpenNote?.(task)}
    >
      <div style={{ fontSize: '13px', lineHeight: '1.4', marginBottom: '8px', color: 'var(--text-primary)' }}>
        {task.content}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
        {task.dateStr && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={12} />
            <span>{task.dateStr}</span>
          </div>
        )}
        {task.note && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Tag size={12} />
            <span style={{ maxWidth: '100px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {task.note}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: '16px', height: '100%', overflowX: 'auto', padding: '16px' }}>
      {COLUMNS.map(col => (
        <div
          key={col.key}
          className="kanban-column"
          style={{ flex: '1', minWidth: '260px', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px' }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, col.key)}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: col.accent || 'var(--text-primary)' }}>{col.title}</h3>
            <span style={{ background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{tasksByStatus[col.key].length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {tasksByStatus[col.key].map(renderCard)}
          </div>
        </div>
      ))}
    </div>
  );
}
