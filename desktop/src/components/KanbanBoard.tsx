import React, { useEffect, useRef, useState } from 'react';
import type { TimelineItem } from '../App';
import { Clock, Tag, Settings, Plus, Trash2, ArrowUp, ArrowDown, X, Eye, EyeOff, Lock, Check } from 'lucide-react';
import {
  type KanbanColumn,
  DEFAULT_KANBAN_COLUMNS,
  KANBAN_COLOR_CHOICES,
  cssKanbanColor,
  slugifyKanbanKey,
  normalizeKanbanColumns
} from '../kanbanColumns';

interface KanbanBoardProps {
  tasks: TimelineItem[];
  columns: KanbanColumn[];
  onChangeTaskStatus: (id: string, newStatus: string) => void;
  onOpenNote?: (item: TimelineItem) => void;
  // Sütun düzenleme: verilmezse "Sütunları düzenle" düğmesi gösterilmez.
  onSaveColumns?: (columns: KanbanColumn[]) => void;
  // Proje kendi sütunlarını özelleştirdiyse varsayılana dönüş düğmesi için.
  isCustomized?: boolean;
  onResetColumns?: () => void;
  scopeLabel?: string;
}

// Eski görevlerin çoğunda [status:] etiketi yok — item.kanbanStatus bu yüzden geriye dönük
// uyumlu şekilde App.tsx tarafında checkbox işaretinden zaten türetilip dolduruluyor. Burada
// yine de savunma amaçlı bir fallback bırakıyoruz (kanbanStatus hiç set edilmemişse).
const resolveStatus = (t: TimelineItem): string => {
  if (t.kanbanStatus) return t.kanbanStatus;
  if (t.status === 'done' || t.isCompleted) return 'done';
  if (t.status === 'in-progress') return 'inprogress';
  return 'backlog';
};

// Yerleşik sütunlara özel hafif animasyon sınıfları (bkz. style.css "KANBAN DURUM ANİMASYONLARI"). Kullanıcının eklediği
// özel sütunlarda animasyon yoktur.
const COLUMN_ANIM: Record<string, string> = {
  inprogress: 'kb-live', test: 'kb-test', review: 'kb-review', blocked: 'kb-blocked', park: 'kb-park', done: 'kb-done'
};

export default function KanbanBoard({
  tasks, columns, onChangeTaskStatus, onOpenNote, onSaveColumns, isCustomized, onResetColumns, scopeLabel
}: KanbanBoardProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<KanbanColumn[]>([]);
  const [newTitle, setNewTitle] = useState('');

  // Sütunu silinmiş ya da bilinmeyen bir durum etiketi taşıyan görev kaybolmaz: ilk sütunda (Backlog) görünür.
  const keys = new Set(columns.map(c => c.key));
  const fallbackKey = columns[0]?.key || 'backlog';
  const tasksByStatus: Record<string, TimelineItem[]> = {};
  columns.forEach(c => { tasksByStatus[c.key] = []; });
  tasks.forEach(t => {
    const s = resolveStatus(t);
    tasksByStatus[keys.has(s) ? s : fallbackKey].push(t);
  });

  // "Bitti"ye az önce taşınan kartlar: bir kez onay efekti oynar (ilk çizimde ve zaten Bitti'deki kartlarda oynamaz).
  const prevColRef = useRef<Map<string, string>>(new Map());
  const justDone = new Set<string>();
  const currentCols = new Map<string, string>();
  Object.keys(tasksByStatus).forEach(k => tasksByStatus[k].forEach(t => {
    currentCols.set(t.id, k);
    const was = prevColRef.current.get(t.id);
    if (k === 'done' && was !== undefined && was !== 'done') justDone.add(t.id);
  }));
  useEffect(() => { prevColRef.current = currentCols; });

  const hiddenCols = columns.filter(c => c.hidden);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedTaskId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    if (draggedTaskId) {
      onChangeTaskStatus(draggedTaskId, status);
      setDraggedTaskId(null);
    }
  };

  const startEditing = () => { setDraft(columns.map(c => ({ ...c }))); setNewTitle(''); setEditing(true); };
  const move = (i: number, dir: -1 | 1) => {
    // 'done' son sütun olarak sabit; 'backlog' ilk sütun olarak sabit.
    const j = i + dir;
    if (j < 1 || j >= draft.length - 1 || i < 1 || i >= draft.length - 1) return;
    const next = draft.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  const addColumn = () => {
    const title = newTitle.trim();
    if (!title) return;
    const key = slugifyKanbanKey(title, new Set(draft.map(c => c.key)));
    const color = KANBAN_COLOR_CHOICES[(draft.length) % KANBAN_COLOR_CHOICES.length];
    const next = draft.slice();
    next.splice(next.length - 1, 0, { key, title: title.slice(0, 40), color });
    setDraft(next);
    setNewTitle('');
  };
  const save = () => {
    onSaveColumns?.(normalizeKanbanColumns(draft));
    setEditing(false);
  };

  const renderCard = (task: TimelineItem, colKey: string) => (
    <div
      key={task.id}
      draggable
      onDragStart={(e) => handleDragStart(e, task.id)}
      className={`kanban-card${COLUMN_ANIM[colKey] ? ` kb-anim ${COLUMN_ANIM[colKey]}` : ''}${justDone.has(task.id) ? ' kb-done-enter' : ''}`}
      style={{
        backgroundColor: 'var(--bg-tertiary)',
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
            {colKey === 'review' ? <span className="kb-eye"><Eye size={12} /></span>
              : colKey === 'blocked' ? <span className="kb-lock"><Lock size={12} /></span>
              : colKey === 'done' ? <span className="kb-check" style={{ display: 'inline-flex', color: '#4caf50' }}><Check size={12} /></span>
              : <Clock size={12} />}
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

  const smallBtn: React.CSSProperties = {
    background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
    borderRadius: '6px', padding: '4px 6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {onSaveColumns && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '8px 16px 0 16px' }}>
          {scopeLabel && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{scopeLabel}</span>}
          <button type="button" onClick={editing ? () => setEditing(false) : startEditing} style={{ ...smallBtn, gap: '6px', fontSize: '12px' }}>
            <Settings size={13} /> {editing ? 'Düzenlemeyi kapat' : 'Sütunları düzenle'}
          </button>
        </div>
      )}

      {editing && (
        <div style={{ margin: '10px 16px 0 16px', padding: '14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Sütunları ekleyin, yeniden adlandırın, sıralayın veya silin. "Backlog" ilk, "Bitti" son sütun olarak sabittir.
            Silinen bir sütundaki görevler kaybolmaz, Backlog'da görünür. Göz simgesiyle bir sütunu silmeden tahtada gizleyebilirsiniz.
          </div>
          {draft.map((col, i) => {
            const fixedFirst = i === 0;
            const fixedLast = i === draft.length - 1;
            return (
              <div key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  value={col.title}
                  onChange={(e) => setDraft(draft.map((c, k) => k === i ? { ...c, title: e.target.value } : c))}
                  maxLength={40}
                  style={{ width: '180px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', padding: '5px 8px', fontSize: '13px' }}
                />
                <div style={{ display: 'flex', gap: '4px' }}>
                  {KANBAN_COLOR_CHOICES.map(c => (
                    <button
                      key={c}
                      type="button"
                      title="Renk"
                      onClick={() => setDraft(draft.map((x, k) => k === i ? { ...x, color: c } : x))}
                      style={{
                        width: '16px', height: '16px', borderRadius: '50%', cursor: 'pointer', padding: 0,
                        background: cssKanbanColor(c),
                        border: (col.color || '') === c ? '2px solid var(--text-primary)' : '1px solid var(--border-color)'
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  style={{ ...smallBtn, ...(col.hidden ? { color: 'var(--accent-color)', borderColor: 'var(--accent-color)' } : {}) }}
                  onClick={() => setDraft(draft.map((c, k) => { if (k !== i) return c; const { hidden, ...rest } = c; return hidden ? rest : { ...rest, hidden: true }; }))}
                  title={col.hidden ? 'Sütun gizli: tahtada görünmez (göstermek için tıklayın)' : 'Sütunu tahtada gizle'}
                >
                  {col.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button type="button" style={smallBtn} disabled={fixedFirst || fixedLast || i <= 1} onClick={() => move(i, -1)} title="Yukarı / sola"><ArrowUp size={13} /></button>
                <button type="button" style={smallBtn} disabled={fixedFirst || fixedLast || i >= draft.length - 2} onClick={() => move(i, 1)} title="Aşağı / sağa"><ArrowDown size={13} /></button>
                <button
                  type="button"
                  style={{ ...smallBtn, opacity: fixedFirst || fixedLast ? 0.35 : 1 }}
                  disabled={fixedFirst || fixedLast}
                  onClick={() => setDraft(draft.filter((_, k) => k !== i))}
                  title={fixedFirst || fixedLast ? 'Bu sütun silinemez' : 'Sütunu sil'}
                >
                  <Trash2 size={13} />
                </button>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{col.key}{col.hidden ? ' · gizli' : ''}</span>
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColumn(); } }}
              placeholder="Yeni sütun adı (örn. QA)"
              maxLength={40}
              style={{ width: '180px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', padding: '5px 8px', fontSize: '13px' }}
            />
            <button type="button" onClick={addColumn} style={{ ...smallBtn, gap: '4px', fontSize: '12px' }}><Plus size={13} /> Ekle</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button type="button" onClick={save} style={{ background: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>Kaydet</button>
            <button type="button" onClick={() => setEditing(false)} style={{ ...smallBtn, gap: '4px', fontSize: '12.5px' }}><X size={13} /> İptal</button>
            <button type="button" onClick={() => setDraft(DEFAULT_KANBAN_COLUMNS.map(c => ({ ...c })))} style={{ ...smallBtn, fontSize: '12px' }}>Varsayılan sütunları yükle</button>
            {isCustomized && onResetColumns && (
              <button type="button" onClick={() => { onResetColumns(); setEditing(false); }} style={{ ...smallBtn, fontSize: '12px' }}>Bu projeyi varsayılana döndür</button>
            )}
          </div>
        </div>
      )}

      {!editing && hiddenCols.length > 0 && onSaveColumns && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', padding: '8px 16px 0 16px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
          <EyeOff size={12} />
          <span>Gizli sütunlar:</span>
          {hiddenCols.map(c => (
            <button
              key={c.key}
              type="button"
              onClick={() => onSaveColumns(normalizeKanbanColumns(columns.map(x => { if (x.key !== c.key) return x; const { hidden, ...rest } = x; return rest; })))}
              title="Göstermek için tıklayın"
              style={{ ...smallBtn, fontSize: '11.5px', padding: '2px 8px', gap: '4px' }}
            >
              <Eye size={11} /> {c.title} ({tasksByStatus[c.key]?.length ?? 0})
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0, overflowX: 'auto', padding: '16px' }}>
        {columns.filter(c => !c.hidden).map(col => (
          <div
            key={col.key}
            className="kanban-column"
            style={{ flex: '1', minWidth: '240px', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px' }}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.key)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: cssKanbanColor(col.color) || 'var(--text-primary)' }}>{col.key === 'inprogress' && <span className="kb-live-dot" />}{col.title}</h3>
              <span style={{ background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{tasksByStatus[col.key].length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {tasksByStatus[col.key].map(t => renderCard(t, col.key))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
