import React, { useState } from 'react';
import type { TimelineItem } from '../App';
import { Clock, Tag } from 'lucide-react';

interface KanbanBoardProps {
  tasks: TimelineItem[];
  onChangeTaskStatus: (id: string, newStatus: 'todo' | 'in-progress' | 'done') => void;
  onOpenNote?: (item: TimelineItem) => void;
}

export default function KanbanBoard({ tasks, onChangeTaskStatus, onOpenNote }: KanbanBoardProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const todoTasks = tasks.filter(t => t.status === 'todo' || (!t.status && !t.isCompleted));
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  const doneTasks = tasks.filter(t => t.status === 'done' || (!t.status && t.isCompleted));

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedTaskId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, status: 'todo' | 'in-progress' | 'done') => {
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
        background: 'var(--bg-card, #1e1e1e)',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '10px',
        border: '1px solid var(--border-color)',
        cursor: 'grab',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}
      onClick={() => onOpenNote?.(task)}
    >
      <div style={{ fontSize: '13px', lineHeight: '1.4', marginBottom: '8px', color: 'var(--text-color)' }}>
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
      
      {/* TODO Column */}
      <div 
        className="kanban-column"
        style={{ flex: '1', minWidth: '300px', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px' }}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, 'todo')}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Yapılacaklar</h3>
          <span style={{ background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{todoTasks.length}</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {todoTasks.map(renderCard)}
        </div>
      </div>

      {/* IN PROGRESS Column */}
      <div 
        className="kanban-column"
        style={{ flex: '1', minWidth: '300px', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px' }}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, 'in-progress')}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--accent-color)' }}>Devam Edenler</h3>
          <span style={{ background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{inProgressTasks.length}</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {inProgressTasks.map(renderCard)}
        </div>
      </div>

      {/* DONE Column */}
      <div 
        className="kanban-column"
        style={{ flex: '1', minWidth: '300px', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px' }}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, 'done')}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#4caf50' }}>Bitenler</h3>
          <span style={{ background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{doneTasks.length}</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {doneTasks.map(renderCard)}
        </div>
      </div>

    </div>
  );
}
