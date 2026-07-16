import React, { useState, useEffect, useRef } from 'react';
import { CheckSquare, Calendar, Star, RefreshCw, EyeOff, Folder, FileText, Trash2, ChevronDown, ChevronUp, Clock, AlertCircle } from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

interface TasksViewProps {
  notes: NoteItem[];
  folders: string[];
  tags: string[];
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
  setActiveNotePath: (path: string | null) => void;
  setActiveTab: (tab: string) => void;
  selectedTag: string | null;
  selectedFolder: string | null;
}

export interface WorkspaceSubTask {
  id: string;
  content: string;
  isChecked: boolean;
  lineIdx: number;
  filePath: string;
}

export interface WorkspaceTask {
  id: string; // FilePath + LineIdx
  content: string;
  isChecked: boolean;
  lineIdx: number;
  filePath: string;
  noteName: string;
  folderName: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  dueDate: string;
  timeSlot: string; // HH:mm-HH:mm
  repeat: string;
  score: number;
  tags: string[];
  isSubtask?: boolean;
  parentTaskId?: string | null;
  subtasks?: WorkspaceSubTask[];
}


// Utility: generate detailed score breakdown tooltip for ⭐ Puan badges
function getScoreBreakdown(task: WorkspaceTask): string {
  const lines: string[] = ['📊 Puan Kırılımı:'];

  // Priority score
  const priorityLabels: Record<string, string> = {
    critical: 'Kritik', high: 'Yüksek', medium: 'Orta', low: 'Düşük'
  };
  const priorityScores: Record<string, number> = {
    critical: 10, high: 6, medium: 3, low: 1
  };
  const pScore = priorityScores[task.priority] ?? 1;
  lines.push(`  Öncelik (${priorityLabels[task.priority] ?? task.priority}): +${pScore}`);

  // Due date score
  if (task.dueDate) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    let dScore = 0; let dLabel = '';
    if (diffDays < 0) { dScore = 8; dLabel = 'Gecikmiş'; }
    else if (diffDays === 0) { dScore = 5; dLabel = 'Bugün'; }
    else if (diffDays === 1) { dScore = 5; dLabel = 'Yarın'; }
    else if (diffDays <= 7) { dScore = 3; dLabel = `${diffDays} gün sonra`; }
    else { dScore = 1; dLabel = `${diffDays} gün sonra`; }
    lines.push(`  Bitiş tarihi (${dLabel}): +${dScore}`);
  } else {
    lines.push('  Bitiş tarihi: yok');
  }

  lines.push(`  Toplam: ${task.score}`);
  return lines.join('\n');
}

export default function TasksView({
  notes,
  folders,
  tags,
  readNoteContent,
  onSaveNote,
  setActiveNotePath,
  setActiveTab,
  selectedTag,
  selectedFolder
}: TasksViewProps) {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [newSubtaskText, setNewSubtaskText] = useState('');

  // Filters State
  const [statusFilter, setStatusFilter] = useState<'pending' | 'completed' | 'all'>('pending');
  const [priorityCategory, setPriorityCategory] = useState<'all' | 'urgent' | 'important' | 'due' | 'repeat'>('all');
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string | null>(null);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  // Automatic background refresh on window focus & gentle 10-second interval
  useEffect(() => {
    const handleFocus = () => {
      setRefreshTrigger(prev => prev + 1);
    };
    window.addEventListener('focus', handleFocus);
    
    const interval = setInterval(() => {
      setRefreshTrigger(prev => prev + 1);
    }, 10000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, []);

  // Sync sidebar filters with local view filters
  useEffect(() => {
    setSelectedTagFilter(selectedTag);
  }, [selectedTag]);

  useEffect(() => {
    setSelectedFolderFilter(selectedFolder);
  }, [selectedFolder]);

  // Scan all markdown files for tasks
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // hasScannedOnceRef: "notes" prop'u her arka plan yenilemesinde (senkron,
  // odak, 10sn zamanlayıcı) yeni referansla geldiği için bu effect sık sık
  // yeniden tetikleniyor ve "loading" her seferinde true'ya dönüp "Çalışma
  // alanı taranıyor..." panelini gereksiz yere yeniden gösteriyordu. Spinner
  // artık yalnızca GERÇEK ilk taramada gösteriliyor.
  const hasScannedOnceRef = useRef(false);
  useEffect(() => {
    let active = true;

    const scanTasks = async () => {
      if (!hasScannedOnceRef.current) {
        setLoading(true);
      }
      const noteFiles = notes.filter(n => n.type === 'note');

      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Notlar önceden TEK TEK, sırayla (await ile) okunuyordu — büyük bir
      // kasada bu, özellikle Android'de (her dosya okuması native köprü
      // üzerinden ayrı bir round-trip) çok yavaş oluyor ve "Görev Havuzu"
      // sonsuza kadar "taranıyor" durumunda kalabiliyordu. Artık tüm dosya
      // okumaları PARALEL yapılıyor; ayrıştırma (senkron/CPU işi) hâlâ
      // sırayla ama bu zaten hızlı.
      const fileResults = await Promise.all(noteFiles.map(async (note) => {
        try {
          const content = await readNoteContent(note.path);
          return { note, content };
        } catch (err) {
          console.error('Error reading file for task scan:', note.path, err);
          return null;
        }
      }));

      const aggregated: WorkspaceTask[] = [];

      for (const result of fileResults) {
        if (!result) continue;
        const { note, content } = result;
        try {
          const lines = content.split('\n');
          const noteTasks: WorkspaceTask[] = [];
          const parentStack: { indent: number; id: string }[] = [];
          let isInTable = false;

          lines.forEach((line, idx) => {
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

            const checklistMatch = line.match(/^(\s*)([*\-]\s+\[([ xX])\])\s+(.*)$/);
            if (checklistMatch) {
              const leadingWhitespace = checklistMatch[1];
              const indent = leadingWhitespace.length;
              const isChecked = checklistMatch[3].toLowerCase() === 'x';
              const rawText = checklistMatch[4];

              // Pop from stack until top of stack has strictly less indent
              while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
                parentStack.pop();
              }

              let parentTaskId: string | null = null;
              let isSubtask = false;

              if (parentStack.length > 0) {
                isSubtask = true;
                parentTaskId = parentStack[parentStack.length - 1].id;
              }

              const taskId = `${note.path}-${idx}`;
              parentStack.push({ indent, id: taskId });

              // Parse priority
              const priorityMatch = rawText.match(/\[p:(critical|acil|high|yüksek|medium|orta|low|düşük)\]/i);
              let priority: 'critical' | 'high' | 'medium' | 'low' = 'low';
              if (priorityMatch) {
                const p = priorityMatch[1].toLowerCase();
                if (p === 'critical' || p === 'acil') priority = 'critical';
                else if (p === 'high' || p === 'yüksek') priority = 'high';
                else if (p === 'medium' || p === 'orta') priority = 'medium';
              }

              // Parse due date
              const dueMatch = rawText.match(/\[due:(\d{4}-\d{2}-\d{2})\]/);
              let dueDate = dueMatch ? dueMatch[1] : '';

              // Parse time slot: [time:HH:mm-HH:mm]
              const timeMatch = rawText.match(/\[time:(\d{2}:\d{2}-\d{2}:\d{2})\]/);
              let timeSlot = timeMatch ? timeMatch[1] : '';

              // Fallback: parse capture timestamp [YYYY-MM-DD HH:mm]
              const timestampMatch = rawText.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]/);
              if (timestampMatch) {
                if (!dueDate) dueDate = timestampMatch[1];
                if (!timeSlot) {
                  const [hStr, mStr] = timestampMatch[2].split(':');
                  const sh = parseInt(hStr), sm = parseInt(mStr);
                  let eh = sh + 1, em = sm;
                  if (eh >= 24) { eh = 23; em = 59; }
                  const pad = (n: number) => String(n).padStart(2, '0');
                  timeSlot = `${pad(sh)}:${pad(sm)}-${pad(eh)}:${pad(em)}`;
                }
              }

              // Parse repeat
              const repeatMatch = rawText.match(/\[repeat:(daily|günlük|weekly|haftalık|monthly|aylık)\]/i);
              let repeat = 'none';
              if (repeatMatch) {
                const r = repeatMatch[1].toLowerCase();
                if (r === 'daily' || r === 'günlük') repeat = 'daily';
                else if (r === 'weekly' || r === 'haftalık') repeat = 'weekly';
                else if (r === 'monthly' || r === 'aylık') repeat = 'monthly';
              }

              // Parse tags: #tagname
              const tagRegex = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
              const taskTags: string[] = [];
              let tagMatch;
              while ((tagMatch = tagRegex.exec(rawText)) !== null) {
                taskTags.push(tagMatch[1].toLowerCase());
              }

              // Calculate Amplenote Score
              let score = 0;
              if (priority === 'critical') score += 10;
              else if (priority === 'high') score += 6;
              else if (priority === 'medium') score += 3;
              else score += 1;

              if (dueDate) {
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const due = new Date(dueDate);
                due.setHours(0, 0, 0, 0);
                const diffTime = due.getTime() - now.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays < 0) score += 8;
                else if (diffDays === 0 || diffDays === 1) score += 5;
                else if (diffDays <= 7) score += 3;
                else score += 1;
              }

              const pathParts = note.path.split('/');
              const folderName = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : null;

              // Clean display content: strip all annotation tags and capture timestamps
              const displayContent = rawText
                .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
                .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
                .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
                .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
                .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // strip capture timestamp
                .replace(/\s+/g, ' ')
                .trim();

              noteTasks.push({
                id: taskId,
                content: displayContent,
                isChecked,
                lineIdx: idx,
                filePath: note.path,
                noteName: note.name,
                folderName,
                priority,
                dueDate,
                timeSlot,
                repeat,
                score,
                tags: taskTags,
                isSubtask,
                parentTaskId,
                subtasks: []
              });
            } else {
              if (line.trim().length > 0 && !line.match(/^\s*[*\-]\s+/)) {
                parentStack.length = 0;
              }
            }
          });

          // Nest subtasks into their respective parents
          noteTasks.forEach(task => {
            if (task.isSubtask && task.parentTaskId) {
              const parent = noteTasks.find(t => t.id === task.parentTaskId);
              if (parent) {
                if (!parent.subtasks) parent.subtasks = [];
                parent.subtasks.push({
                  id: task.id,
                  content: task.content,
                  isChecked: task.isChecked,
                  lineIdx: task.lineIdx,
                  filePath: task.filePath
                });
              }
            }
          });

          aggregated.push(...noteTasks);
        } catch (err) {
          console.error('Error scanning file for tasks:', note.path, err);
        }
      }

      if (active) {
        // Sort by score descending
        setTasks(aggregated.sort((a, b) => b.score - a.score));
        setLoading(false);
        hasScannedOnceRef.current = true;
      }
    };

    scanTasks();
    return () => { active = false; };
  }, [notes, refreshTrigger]);

  // Actions
  const handleToggleTask = async (task: WorkspaceTask) => {
    try {
      const content = await readNoteContent(task.filePath);
      const lines = content.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      const line = lines[task.lineIdx];
      const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s+.*)$/);
      if (!checklistMatch) return;

      const prefix = checklistMatch[1];
      const currentStatus = checklistMatch[2];
      const suffix = checklistMatch[3];

      const newStatus = currentStatus.toLowerCase() === 'x' ? ' ' : 'x';
      lines[task.lineIdx] = `${prefix}${newStatus}${suffix}`;

      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error toggling task:', err);
    }
  };

  const handleUpdateTaskMetadata = async (
    task: WorkspaceTask,
    isImportant: boolean,
    isUrgent: boolean,
    dueDate: string,
    timeSlot: string,
    repeat: string
  ) => {
    try {
      const content = await readNoteContent(task.filePath);
      const lines = content.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      // Re-read the raw line to preserve capture timestamps; strip only annotation tags
      const rawLine = lines[task.lineIdx];
      const lineBodyMatch = rawLine.match(/^(\s*[*\-]\s+\[[ xX]\]\s+)(.*)$/);
      if (!lineBodyMatch) return;

      let cleanText = lineBodyMatch[2]
        .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
        .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
        .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
        .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Priority
      let priorityStr = '';
      if (isImportant && isUrgent) priorityStr = '[p:critical]';
      else if (isUrgent) priorityStr = '[p:high]';
      else if (isImportant) priorityStr = '[p:medium]';

      const dueStr = dueDate ? `[due:${dueDate}]` : '';
      const timeStr = (timeSlot && timeSlot.match(/^\d{2}:\d{2}-\d{2}:\d{2}$/)) ? `[time:${timeSlot}]` : '';
      const repeatStr = (repeat && repeat !== 'none') ? `[repeat:${repeat}]` : '';

      const suffixParts = [];
      if (priorityStr) suffixParts.push(priorityStr);
      if (dueStr) suffixParts.push(dueStr);
      if (timeStr) suffixParts.push(timeStr);
      if (repeatStr) suffixParts.push(repeatStr);

      const suffix = suffixParts.length > 0 ? ' ' + suffixParts.join(' ') : '';

      lines[task.lineIdx] = `${lineBodyMatch[1]}${cleanText}${suffix}`;

      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error updating task metadata:', err);
    }
  };

  const handleDeleteTask = async (task: WorkspaceTask) => {
    try {
      const content = await readNoteContent(task.filePath);
      const lines = content.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      lines.splice(task.lineIdx, 1);
      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setExpandedTaskId(null);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  const handleToggleSubtask = async (subtask: WorkspaceSubTask) => {
    try {
      const content = await readNoteContent(subtask.filePath);
      const lines = content.split('\n');
      if (subtask.lineIdx < 0 || subtask.lineIdx >= lines.length) return;

      const line = lines[subtask.lineIdx];
      const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s+.*)$/);
      if (!checklistMatch) return;

      const prefix = checklistMatch[1];
      const currentStatus = checklistMatch[2];
      const suffix = checklistMatch[3];

      const newStatus = currentStatus.toLowerCase() === 'x' ? ' ' : 'x';
      lines[subtask.lineIdx] = `${prefix}${newStatus}${suffix}`;

      const newContent = lines.join('\n');
      await onSaveNote(subtask.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error toggling subtask:', err);
    }
  };

  const handleDeleteSubtask = async (subtask: WorkspaceSubTask) => {
    try {
      const content = await readNoteContent(subtask.filePath);
      const lines = content.split('\n');
      if (subtask.lineIdx < 0 || subtask.lineIdx >= lines.length) return;

      lines.splice(subtask.lineIdx, 1);
      const newContent = lines.join('\n');
      await onSaveNote(subtask.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error deleting subtask:', err);
    }
  };

  const handleAddSubtask = async (parentTask: WorkspaceTask, newSubtaskText: string) => {
    if (!newSubtaskText.trim()) return;
    try {
      const content = await readNoteContent(parentTask.filePath);
      const lines = content.split('\n');
      if (parentTask.lineIdx < 0 || parentTask.lineIdx >= lines.length) return;

      const parentLine = lines[parentTask.lineIdx];
      const indentMatch = parentLine.match(/^(\s*)/);
      const parentIndent = indentMatch ? indentMatch[1] : '';
      const subtaskIndent = parentIndent + '  ';

      let insertIdx = parentTask.lineIdx + 1;
      if (parentTask.subtasks && parentTask.subtasks.length > 0) {
        const subtaskIndices = parentTask.subtasks.map(s => s.lineIdx);
        insertIdx = Math.max(...subtaskIndices) + 1;
      }

      const newLine = `${subtaskIndent}- [ ] ${newSubtaskText.trim()}`;
      lines.splice(insertIdx, 0, newLine);

      const newContent = lines.join('\n');
      await onSaveNote(parentTask.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error adding subtask:', err);
    }
  };

  const handleOpenNote = (filePath: string) => {
    setActiveNotePath(filePath);
    setActiveTab('notes');
  };

  // Parsing details helper
  const parseInlineStylesAndTags = (text: string) => {
    // Strip tags, metadata and capture timestamps from display
    let display = text
      .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
      .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
      .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
      .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
      .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // strip capture timestamp
      .replace(/\s+/g, ' ')
      .trim();

    const tagRegex = /#([a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_-]+)/g;
    const boldRegex = /\*\*(.*?)\*\*/g;
    const codeRegex = /`(.*?)`/g;

    // A simple parse
    return display.split(' ').map((word, i) => {
      if (word.startsWith('#')) {
        return <span key={i} className="task-inline-tag">{word} </span>;
      }
      if (word.startsWith('**') && word.endsWith('**')) {
        return <strong key={i}>{word.slice(2, -2)} </strong>;
      }
      if (word.startsWith('`') && word.endsWith('`')) {
        return <code key={i} className="preview-code">{word.slice(1, -1)} </code>;
      }
      return word + ' ';
    });
  };

  // Filters calculation
  const parentTasks = tasks.filter(t => !t.isSubtask);

  const filteredTasks = parentTasks.filter(task => {
    // Status
    if (statusFilter === 'pending' && task.isChecked) return false;
    if (statusFilter === 'completed' && !task.isChecked) return false;

    // Priorities category
    if (priorityCategory === 'urgent' && task.priority !== 'critical' && task.priority !== 'high') return false;
    if (priorityCategory === 'important' && task.priority !== 'critical' && task.priority !== 'medium') return false;
    if (priorityCategory === 'due' && !task.dueDate) return false;
    if (priorityCategory === 'repeat' && (!task.repeat || task.repeat === 'none')) return false;

    // Folder
    if (selectedFolderFilter && task.folderName !== selectedFolderFilter) return false;

    // Tag
    if (selectedTagFilter && !task.tags.includes(selectedTagFilter.toLowerCase())) return false;

    return true;
  });

  // Category counts
  const pendingCount = parentTasks.filter(t => !t.isChecked).length;
  const completedCount = parentTasks.filter(t => t.isChecked).length;

  const urgentCount = parentTasks.filter(t => !t.isChecked && (t.priority === 'critical' || t.priority === 'high')).length;
  const importantCount = parentTasks.filter(t => !t.isChecked && (t.priority === 'critical' || t.priority === 'medium')).length;
  const dueCount = parentTasks.filter(t => !t.isChecked && t.dueDate).length;
  const repeatCount = parentTasks.filter(t => !t.isChecked && t.repeat && t.repeat !== 'none').length;

  // Folder and Tag collections from active tasks
  const activeFolders = Array.from(new Set(parentTasks.map(t => t.folderName).filter(Boolean))) as string[];
  const activeTags = Array.from(new Set(parentTasks.flatMap(t => t.tags).filter(Boolean))) as string[];

  // Render detail panel drawer
  const renderTaskDrawer = (task: WorkspaceTask) => {
    const isImportant = task.priority === 'medium' || task.priority === 'critical';
    const isUrgent = task.priority === 'high' || task.priority === 'critical';

    // Parse start/end time from timeSlot for controlled inputs
    const parseSlotParts = (slot: string) => {
      const m = slot.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
      return m ? { start: m[1], end: m[2] } : { start: '', end: '' };
    };
    const slotParts = parseSlotParts(task.timeSlot);

    const updateTime = (newStart: string, newEnd: string) => {
      const newSlot = (newStart && newEnd) ? `${newStart}-${newEnd}` : '';
      handleUpdateTaskMetadata(task, isImportant, isUrgent, task.dueDate, newSlot, task.repeat);
    };

    return (
      <div className="task-details-drawer workspace-task-drawer animate-fade">
        {/* Due Date + Time row combined */}
        <div className="drawer-row">
          <div className="row-label">
            <Calendar size={13} />
            <span>TARİH</span>
          </div>
          <div className="row-control">
            <input
              type="date"
              value={task.dueDate}
              onChange={(e) => handleUpdateTaskMetadata(
                task, isImportant, isUrgent, e.target.value, task.timeSlot, task.repeat
              )}
              className="drawer-date-input"
            />
          </div>
        </div>

        {/* Time range row - only relevant if date is set */}
        <div className="drawer-row">
          <div className="row-label">
            <Clock size={13} />
            <span>SAAT</span>
          </div>
          <div className="row-control" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="time"
              value={slotParts.start}
              onChange={(e) => {
                const newStart = e.target.value;
                // Auto-compute end as +1h if end is empty or before new start
                let newEnd = slotParts.end;
                if (newStart) {
                  const [sh, sm] = newStart.split(':').map(Number);
                  const autoEnd = `${String(Math.min(sh + 1, 23)).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
                  if (!newEnd || newEnd <= newStart) newEnd = autoEnd;
                }
                updateTime(newStart, newEnd);
              }}
              className="drawer-date-input"
              style={{ width: '110px' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>→</span>
            <input
              type="time"
              value={slotParts.end}
              onChange={(e) => updateTime(slotParts.start, e.target.value)}
              className="drawer-date-input"
              style={{ width: '110px' }}
            />
            {task.timeSlot && (
              <button
                type="button"
                title="Saati temizle"
                onClick={() => updateTime('', '')}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
              >✕</button>
            )}
          </div>
        </div>

        <div className="drawer-row">
          <div className="row-label">
            <RefreshCw size={13} />
            <span>TEKRAR</span>
          </div>
          <div className="row-control">
            <select
              value={task.repeat}
              onChange={(e) => handleUpdateTaskMetadata(
                task, isImportant, isUrgent, task.dueDate, task.timeSlot, e.target.value
              )}
              className="drawer-select"
            >
              <option value="none">Tekrarlamaz</option>
              <option value="daily">Günlük (Daily)</option>
              <option value="weekly">Haftalık (Weekly)</option>
              <option value="monthly">Aylık (Monthly)</option>
            </select>
          </div>
        </div>

        <div className="drawer-row">
          <div className="row-label">
            <Star size={13} />
            <span>ÖNCELİK</span>
          </div>
          <div className="row-control-pills">
            <button
              type="button"
              className={`pill-btn ${isImportant ? 'active' : ''}`}
              onClick={() => handleUpdateTaskMetadata(
                task, !isImportant, isUrgent, task.dueDate, task.timeSlot, task.repeat
              )}
            >
              Önemli (Important)
            </button>
            <button
              type="button"
              className={`pill-btn ${isUrgent ? 'active' : ''}`}
              onClick={() => handleUpdateTaskMetadata(
                task, isImportant, !isUrgent, task.dueDate, task.timeSlot, task.repeat
              )}
            >
              Acil (Urgent)
            </button>
          </div>
        </div>

        <div className="drawer-row">
          <div className="row-label">
            <CheckSquare size={13} />
            <span>PUAN</span>
          </div>
          <div className="row-control-score">
            <div className="score-num-display">{task.score}</div>
            <span className="score-desc-lbl">Task Score</span>
          </div>
        </div>

        {/* ALT GÖREVLER (SUBTASKS) SECTION */}
        <div className="drawer-row subtasks-section-header" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px', marginTop: '4px' }}>
          <div className="row-label">
            <CheckSquare size={13} style={{ color: '#06b6d4' }} />
            <span>ALT GÖREVLER</span>
          </div>
          <div className="row-control" style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 'bold' }}>
            {task.subtasks && task.subtasks.length > 0 ? (
              `${task.subtasks.filter(s => s.isChecked).length}/${task.subtasks.length}`
            ) : 'Alt Görev Yok'}
          </div>
        </div>

        {task.subtasks && task.subtasks.length > 0 && (() => {
          const total = task.subtasks.length;
          const checked = task.subtasks.filter(s => s.isChecked).length;
          const pct = Math.round((checked / total) * 100);
          return (
            <div className="subtask-progress-container" style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden', margin: '-4px 0 6px 0', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div 
                className="subtask-progress-bar" 
                style={{ 
                  width: `${pct}%`, 
                  height: '100%', 
                  background: pct === 100 ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, #06b6d4, #0891b2)', 
                  boxShadow: pct === 100 ? '0 0 10px rgba(16, 185, 129, 0.4)' : '0 0 10px rgba(6, 182, 212, 0.4)',
                  transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)' 
                }} 
              />
            </div>
          );
        })()}

        {task.subtasks && task.subtasks.length > 0 && (
          <div className="drawer-subtasks-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '8px', maxHeight: '180px', overflowY: 'auto' }}>
            {task.subtasks.map(sub => (
              <div key={sub.id} className="drawer-subtask-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', transition: 'all 0.2s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                  <div 
                    onClick={() => handleToggleSubtask(sub)} 
                    style={{ 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      width: '15px',
                      height: '15px',
                      borderRadius: '4px',
                      border: `1px solid ${sub.isChecked ? '#10b981' : 'var(--text-muted)'}`,
                      background: sub.isChecked ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {sub.isChecked && <div style={{ width: '7px', height: '7px', borderRadius: '1px', background: '#10b981' }} />}
                  </div>
                  <span style={{ 
                    fontSize: '12px', 
                    color: sub.isChecked ? 'var(--text-muted)' : 'var(--text-primary)', 
                    textDecoration: sub.isChecked ? 'line-through' : 'none',
                    transition: 'all 0.2s ease' 
                  }}>
                    {parseInlineStylesAndTags(sub.content)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteSubtask(sub)}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    color: 'rgba(239, 68, 68, 0.6)', 
                    cursor: 'pointer', 
                    padding: '4px', 
                    borderRadius: '4px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(239, 68, 68, 0.6)'}
                  title="Alt görevi sil"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (newSubtaskText.trim()) {
              handleAddSubtask(task, newSubtaskText);
              setNewSubtaskText('');
            }
          }}
          style={{ display: 'flex', gap: '8px', marginTop: '4px' }}
        >
          <input
            type="text"
            value={newSubtaskText}
            onChange={(e) => setNewSubtaskText(e.target.value)}
            placeholder="Yeni alt görev ekle..."
            className="drawer-date-input"
            style={{ flex: 1, minWidth: 0, padding: '6px 12px' }}
          />
          <button
            type="submit"
            className="pill-btn"
            style={{ 
              padding: '6px 14px', 
              borderRadius: '6px', 
              background: 'rgba(6, 182, 212, 0.15)', 
              color: '#67e8f9', 
              border: '1px solid rgba(6, 182, 212, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px'
            }}
          >
            Ekle
          </button>
        </form>

        <div className="drawer-footer-actions">
          <button
            type="button"
            className="footer-action-btn delete-btn"
            onClick={() => {
              if (confirm('Bu görevi ilgili not dosyasından tamamen silmek istediğinize emin misiniz?')) {
                handleDeleteTask(task);
              }
            }}
          >
            <Trash2 size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
            GÖREVİ SİL
          </button>
          <button
            type="button"
            className="btn-drawer-done"
            onClick={() => setExpandedTaskId(null)}
          >
            KAPAT
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="tasks-workspace-layout animate-fade">
      {isFiltersOpen && (
        <div 
          className="drawer-overlay visible-mobile" 
          onClick={() => setIsFiltersOpen(false)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 998,
            backdropFilter: 'blur(2px)'
          }}
        />
      )}
      {/* 1. Sol Kategori Paneli (Distinctions Panel) */}
      <aside 
        className={`tasks-filters-sidebar ${isFiltersOpen ? 'open' : ''}`}
        onClick={() => setIsFiltersOpen(false)}
      >
        <div className="filters-header">
          <CheckSquare size={16} />
          <h3>GÖREV SÜZGEÇLERİ</h3>
        </div>

        {/* Durum Bölümü */}
        <div className="filter-group">
          <span className="filter-group-title">DURUM</span>
          <div className="filter-buttons">
            <button 
              className={`filter-sidebar-btn ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              <span>⏳ Yapılacaklar</span>
              <span className="filter-badge-count">{pendingCount}</span>
            </button>
            <button 
              className={`filter-sidebar-btn ${statusFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('completed')}
            >
              <span>✅ Tamamlananlar</span>
              <span className="filter-badge-count">{completedCount}</span>
            </button>
            <button 
              className={`filter-sidebar-btn ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              <span>📚 Tüm Görevler</span>
              <span className="filter-badge-count">{tasks.length}</span>
            </button>
          </div>
        </div>

        {/* Öncelik Kümeleri */}
        <div className="filter-group">
          <span className="filter-group-title">ÖNCELİK & KATEGORİ</span>
          <div className="filter-buttons">
            <button
              className={`filter-sidebar-btn ${priorityCategory === 'all' ? 'active' : ''}`}
              onClick={() => setPriorityCategory('all')}
            >
              <span>🌟 Tüm Öncelikler</span>
            </button>
            <button
              className={`filter-sidebar-btn ${priorityCategory === 'urgent' ? 'active' : ''}`}
              onClick={() => setPriorityCategory('urgent')}
            >
              <span>🔥 Acil (Urgent)</span>
              {statusFilter === 'pending' && <span className="filter-badge-count urgent">{urgentCount}</span>}
            </button>
            <button
              className={`filter-sidebar-btn ${priorityCategory === 'important' ? 'active' : ''}`}
              onClick={() => setPriorityCategory('important')}
            >
              <span>⭐ Önemli (Important)</span>
              {statusFilter === 'pending' && <span className="filter-badge-count important">{importantCount}</span>}
            </button>
            <button
              className={`filter-sidebar-btn ${priorityCategory === 'due' ? 'active' : ''}`}
              onClick={() => setPriorityCategory('due')}
            >
              <span>📅 Teslim Tarihi Olan</span>
              {statusFilter === 'pending' && <span className="filter-badge-count">{dueCount}</span>}
            </button>
            <button
              className={`filter-sidebar-btn ${priorityCategory === 'repeat' ? 'active' : ''}`}
              onClick={() => setPriorityCategory('repeat')}
            >
              <span>🔄 Tekrarlayanlar</span>
              {statusFilter === 'pending' && <span className="filter-badge-count">{repeatCount}</span>}
            </button>
          </div>
        </div>

        {/* Klasörlere Göre Kategori */}
        {activeFolders.length > 0 && (
          <div className="filter-group">
            <span className="filter-group-title">KLASÖRLER</span>
            <div className="filter-buttons">
              <button
                className={`filter-sidebar-btn ${selectedFolderFilter === null ? 'active' : ''}`}
                onClick={() => setSelectedFolderFilter(null)}
              >
                <span>Tüm Klasörler</span>
              </button>
              {activeFolders.map(folder => (
                <button
                  key={folder}
                  className={`filter-sidebar-btn ${selectedFolderFilter === folder ? 'active' : ''}`}
                  onClick={() => setSelectedFolderFilter(folder)}
                >
                  <span className="truncate">📁 @{folder}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Etiketlere Göre Kategori */}
        {activeTags.length > 0 && (
          <div className="filter-group">
            <span className="filter-group-title">ETİKETLER</span>
            <div className="filter-tags-grid">
              <button
                className={`tag-pill-filter ${selectedTagFilter === null ? 'active' : ''}`}
                onClick={() => setSelectedTagFilter(null)}
              >
                Tümü
              </button>
              {activeTags.map(tag => (
                <button
                  key={tag}
                  className={`tag-pill-filter ${selectedTagFilter === tag ? 'active' : ''}`}
                  onClick={() => setSelectedTagFilter(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* 2. Sağ Görev Listesi Paneli */}
      <main className="tasks-list-panel">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Görev Havuzu (Global Workspace)</h2>
            <p className="subtitle">Tüm çalışma alanındaki görevlerinizin anlık derlenmiş hali.</p>
          </div>
          <button 
            type="button"
            className="btn-filter-toggle visible-mobile"
            onClick={() => setIsFiltersOpen(!isFiltersOpen)}
            style={{
              background: 'var(--accent-glow)',
              color: 'var(--accent-color)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'none',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            Filtreler
          </button>
        </div>

        <div className="panel-body">
          {loading && tasks.length === 0 ? (
            <div className="tasks-empty-state">
              <RefreshCw size={48} className="animate-spin text-accent" />
              <h3>Çalışma Alanı Taranıyor...</h3>
              <p>Tüm notlardaki görevleriniz okunuyor ve anlık hesaplanıyor.</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="tasks-empty-state">
              <AlertCircle size={48} className="text-muted" />
              <h3>Görev Bulunamadı</h3>
              <p>Seçilen süzgeç kriterlerine uygun herhangi bir checklist görevi bulunmamaktadır.</p>
            </div>
          ) : (
            <div className="tasks-list-scroll">
              {filteredTasks.map(task => {
                const isExpanded = expandedTaskId === task.id;
                
                return (
                  <div key={task.id} className="preview-checklist-wrapper-container workspace-task-item">
                    <div className={`preview-checklist-item ${task.isChecked ? 'checked' : ''}`}>
                      
                      {/* Checkbox */}
                      <div className="preview-checkbox-wrapper" onClick={() => handleToggleTask(task)}>
                        <div className="preview-custom-checkbox" />
                      </div>

                      {/* Text */}
                      <span className="preview-checklist-text">
                        {task.score > 0 && !task.isChecked && (
                          <span className="preview-task-score-badge" title={getScoreBreakdown(task)}>
                            ⭐ Puan: {task.score}
                          </span>
                        )}
                        {task.subtasks && task.subtasks.length > 0 && (
                          <span className="preview-task-score-badge" style={{ background: 'rgba(6, 182, 212, 0.08)', color: '#67e8f9', border: '1px solid rgba(6, 182, 212, 0.18)' }} title="Alt Görev İlerlemesi">
                            📊 {task.subtasks.filter(s => s.isChecked).length}/{task.subtasks.length}
                          </span>
                        )}
                        {parseInlineStylesAndTags(task.content)}
                      </span>

                      {/* Folder / Note Badge - Clickable to open that note instantly! */}
                      <div className="task-location-badge" onClick={() => handleOpenNote(task.filePath)} title="Bu nota git">
                        <FileText size={10} />
                        <span>
                          {task.folderName ? `@${task.folderName}/` : ''}{task.noteName}
                        </span>
                      </div>

                      {/* Quick Meta Indicators */}
                      <div className="task-indicators">
                        {task.priority !== 'low' && (
                          <span className={`preview-priority-badge priority-${task.priority}`}>
                            {task.priority === 'critical' ? 'Acil' : task.priority === 'high' ? 'Yüksek' : 'Orta'}
                          </span>
                        )}
                        {task.dueDate && (
                          <span className="preview-due-badge" title="Bitiş Tarihi">
                            <Calendar size={10} style={{ marginRight: '3px' }} />
                            <span>{task.dueDate}{task.timeSlot ? ` ${task.timeSlot.split('-')[0]}` : ''}</span>
                          </span>
                        )}
                        {task.timeSlot && !task.dueDate && (
                          <span className="preview-due-badge" title="Saat Aralığı">
                            <Clock size={10} style={{ marginRight: '3px' }} />
                            <span>{task.timeSlot}</span>
                          </span>
                        )}
                        {task.repeat !== 'none' && (
                          <span className="preview-repeat-badge" title="Tekrarlayan">
                            🔄
                          </span>
                        )}
                      </div>

                      {/* Chevron details toggler */}
                      <button
                        type="button"
                        className={`action-hover-btn ${isExpanded ? 'active' : ''}`}
                        onClick={() => {
                          setExpandedTaskId(isExpanded ? null : task.id);
                          setNewSubtaskText('');
                        }}
                        style={{ marginLeft: '10px', opacity: 1, transform: 'none' }}
                        title="Detaylar"
                      >
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>

                    {/* Expandable details drawer */}
                    {isExpanded && renderTaskDrawer(task)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
