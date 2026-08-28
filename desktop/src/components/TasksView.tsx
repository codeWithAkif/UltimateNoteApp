import React, { useState, useEffect, useRef } from 'react';
import { CheckSquare, Calendar, Star, RefreshCw, EyeOff, Folder, FileText, Trash2, ChevronDown, ChevronUp, Clock, AlertCircle, Play, Compass, Search, ArrowUpDown, X, Plus } from 'lucide-react';
import {
  applyCompletionToLine, applyQuestStartToLine, parseQuestTags, stripQuestTags,
  type LineCompletionResult
} from '../punctuality';
import Hourglass from './Hourglass';

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
  // BUG DÜZELTMESİ: native window.confirm() yerine App.tsx'teki paylaşılan uygulama-içi
  // onay modalını kullanır (confirm() gerçek bir pencere blur/focus olayı tetiklemediği
  // için odağa dayalı temizleme mekanizmaları silme onayı sırasında hiç çalışmıyordu).
  onRequestConfirm?: (message: string, onConfirm: () => void) => void;
  onQuestReward?: (reward: LineCompletionResult) => void;
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
  questStartedAt: string | null;
  questOutcome: 'fast' | 'ontime' | 'late' | 'incomplete' | null;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// task.dueDate/task.timeSlot alanlarından planlanmış bitiş anını hesaplar — CalendarView.tsx'te
// task.dueDate + task.timeSlot ile AYNI mantık, o dosyadaki getDeadlineFromLine ham satır
// metnine ihtiyaç duyduğu için burada zaten ayrıştırılmış alanlarla tekrarlanıyor.
function getTaskDeadline(task: WorkspaceTask): Date | null {
  if (!task.dueDate) return null;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  if (task.timeSlot) {
    const endPart = task.timeSlot.split('-')[1];
    if (endPart) {
      const [eh, em] = endPart.split(':').map(Number);
      return new Date(y, m - 1, d, eh, em, 0);
    }
  }
  return new Date(y, m - 1, d, 23, 59, 59);
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// CalendarView.tsx'teki TaskCountdownBadge ile AYNI canlı geri sayım, görev detay
// çekmecesinde biraz daha büyük/okunur boyutta.
const TaskCountdownInline: React.FC<{ startedAt: string; deadline: Date }> = ({ startedAt, deadline }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startMs = new Date(startedAt).getTime();
  const deadlineMs = deadline.getTime();
  const totalMs = Math.max(1, deadlineMs - startMs);
  const remainingMs = deadlineMs - now;
  const remainingFraction = Math.max(0, Math.min(1, remainingMs / totalMs));
  const isOverdue = remainingMs <= 0;

  const abs = Math.abs(remainingMs);
  const totalMin = Math.floor(abs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const txt = h > 0 ? `${h}s ${m}dk` : `${m}dk`;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: isOverdue ? '#ef4444' : 'var(--text-muted)' }}>
      <Hourglass remainingFraction={isOverdue ? 0 : remainingFraction} active={!isOverdue} size={16} />
      {isOverdue ? `${txt} geçti — geciktin` : `${txt} kaldı`}
    </span>
  );
};

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
  selectedFolder,
  onRequestConfirm,
  onQuestReward
}: TasksViewProps) {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "Başla" planlanan saatten 5dk+ sonra basıldığında kısa süreliğine gösterilen, cezalandırıcı
  // olmayan bilgi notu (bkz. handleStartQuest) — CalendarView.tsx'teki AYNI kavramın bu görünüme
  // özel kopyası, skoru etkilemez.
  const [lateStartNotice, setLateStartNotice] = useState<{ taskContent: string; lateByMin: number } | null>(null);
  const [newSubtaskText, setNewSubtaskText] = useState('');

  // Filters State
  const [statusFilter, setStatusFilter] = useState<'pending' | 'completed' | 'all'>('pending');
  const [priorityCategory, setPriorityCategory] = useState<'all' | 'urgent' | 'important' | 'due' | 'repeat'>('all');
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string | null>(null);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'dueDate' | 'alpha' | 'priority'>('score');

  // İSTEK: Görev Havuzu ekranından doğrudan yeni görev eklenebilsin. Diğer hızlı-ekleme
  // noktalarıyla (Dashboard "Hızlı todo ekle", InboxView) AYNI deseni kullanır: seçilen
  // klasörün (veya kök dizinin) "inbox.md" dosyasına yeni bir checklist satırı ekler —
  // ayrı bir depolama katmanı yok, tarama zaten tüm notları kapsadığından görev anında listede belirir.
  const [isNewTaskFormOpen, setIsNewTaskFormOpen] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskFolder, setNewTaskFolder] = useState('');

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

            const checklistMatch = line.match(/^(\s*)([*\-]\s+\[([ xX/])\])\s+(.*)$/);
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
              const priorityMatch = rawText.match(/\[(?:priority|p):(critical|acil|high|yüksek|medium|orta|low|düşük)\]/i);
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

              // Parse time slot: [plannedtime:HH:mm-HH:mm] or legacy [time:]/[window:]
              const timeMatch = rawText.match(/\[(?:plannedtime|time|window):(\d{2}:\d{2}-\d{2}:\d{2})\]/);
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
              // Görünmez proje bağlantısı — CalendarView.tsx artık projeyi görünür "#slug"
              // yerine bununla işaretliyor (kullanıcı isteği: görev adında etiket görünmesin).
              const projectBracketRegex = /\[(?:project|proje|book|kitap):([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)\]/gi;
              let projTagMatch;
              while ((projTagMatch = projectBracketRegex.exec(rawText)) !== null) {
                taskTags.push(projTagMatch[1].toLowerCase());
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
              const displayContent = stripQuestTags(rawText)
                .replace(/\[(?:priority|p):(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
                .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
                .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
                .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
                .replace(/\[(?:started|baslangic|başlangıç|başlama):[^\]]+\]/gi, '')
                .replace(/\[(?:completed|tamamlanma):[^\]]+\]/gi, '')
                .replace(/\[status:(?:backlog|inprogress|review|blocked|done)\]/gi, '')
                .replace(/\[type:(?:bug|feature|chore)\]/gi, '')
                .replace(/\[session:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
                .replace(/\[plan:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
                .replace(/\[hours:[\d.]+\]/gi, '')
                .replace(/\[(?:outcome|dakiklik):(?:fast|ontime|late)\]/gi, '')
                .replace(/\[(?:project|proje|book|kitap):[^\]]+\]/gi, '')
                .replace(/\[başlama:[^\]]+\]/gi, '')
                .replace(/#[a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+/g, '')
                .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // strip capture timestamp
                .replace(/\s+/g, ' ')
                .trim();

              const questTags = parseQuestTags(rawText);

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
                subtasks: [],
                questStartedAt: questTags.startedAt,
                questOutcome: questTags.outcome
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
      const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX/])(\]\s+.*)$/);
      if (!checklistMatch) return;

      const prefix = checklistMatch[1];
      const currentStatus = checklistMatch[2];
      const suffix = checklistMatch[3];

      const newStatus = currentStatus.toLowerCase() === 'x' ? ' ' : 'x';
      lines[task.lineIdx] = `${prefix}${newStatus}${suffix}`;

      if (newStatus === 'x') {
        const questReward = applyCompletionToLine(lines[task.lineIdx]);
        if (questReward) {
          lines[task.lineIdx] = questReward.newLine;
          onQuestReward?.(questReward);
        }
      }

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
      const lineBodyMatch = rawLine.match(/^(\s*[*\-]\s+\[[ xX/]\]\s+)(.*)$/);
      if (!lineBodyMatch) return;

      let cleanText = lineBodyMatch[2]
        .replace(/\[(?:priority|p):(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
        .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
        .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
        .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
        .replace(/\[(?:started|baslangic|başlangıç|başlama):[^\]]+\]/gi, '')
        .replace(/\[(?:completed|tamamlanma):[^\]]+\]/gi, '')
        .replace(/\[status:(?:backlog|inprogress|review|blocked|done)\]/gi, '')
        .replace(/\[type:(?:bug|feature|chore)\]/gi, '')
        .replace(/\[session:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
        .replace(/\[plan:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
        .replace(/\[hours:[\d.]+\]/gi, '')
        .replace(/\[(?:outcome|dakiklik):[^\]]+\]/gi, '')
        .replace(/\[(?:project|proje|book|kitap):[^\]]+\]/gi, '')
        .replace(/\[başlama:[^\]]+\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Priority
      let priorityStr = '';
      if (isImportant && isUrgent) priorityStr = '[priority:critical]';
      else if (isUrgent) priorityStr = '[priority:high]';
      else if (isImportant) priorityStr = '[priority:medium]';

      const dueStr = dueDate ? `[due:${dueDate}]` : '';
      const timeStr = (timeSlot && timeSlot.match(/^\d{2}:\d{2}-\d{2}:\d{2}$/)) ? `[plannedtime:${timeSlot}]` : '';
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

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Geç başlama bilgilendirmesi — CalendarView.tsx'teki handleStartTaskFromCalendar ile AYNI
  // mantık, skoru etkilemiyor (sonuç zaten dakiklik skorunu belirliyor), sadece bitiş saatinin
  // sabit kaldığını (penceresinin kısaldığını) hatırlatan cezalandırıcı olmayan bir bilgi notu.
  const handleStartQuest = async (task: WorkspaceTask) => {
    try {
      const content = await readNoteContent(task.filePath);
      const lines = content.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      const newLine = applyQuestStartToLine(lines[task.lineIdx]);
      if (!newLine) return;
      lines[task.lineIdx] = newLine;

      if (task.timeSlot) {
        const startMatch = task.timeSlot.match(/^(\d{2}):(\d{2})/);
        if (startMatch) {
          const plannedStartMin = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10);
          const now = new Date();
          const nowMin = now.getHours() * 60 + now.getMinutes();
          const lateByMin = nowMin - plannedStartMin;
          if (lateByMin >= 5) {
            setLateStartNotice({ taskContent: task.content, lateByMin });
            setTimeout(() => setLateStartNotice(null), 4000);
          }
        }
      }

      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error starting quest:', err);
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
      const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX/])(\]\s+.*)$/);
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

  const handleAddNewTask = async () => {
    if (!newTaskText.trim()) return;
    const destPath = newTaskFolder ? `${newTaskFolder}/inbox.md` : 'inbox.md';
    try {
      let currentContent = '';
      try {
        currentContent = await readNoteContent(destPath);
      } catch (e) {
        // Dosya henüz yoksa boş başlar — aşağıda oluşturulur.
      }
      const updated = currentContent.trim()
        ? `${currentContent.trimEnd()}\n- [ ] ${newTaskText.trim()}\n`
        : `- [ ] ${newTaskText.trim()}\n`;
      await onSaveNote(destPath, updated);
      setNewTaskText('');
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error adding new task:', err);
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
      .replace(/\[(?:priority|p):(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
      .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
      .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
      .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
      .replace(/\[(?:started|baslangic|başlangıç|başlama):[^\]]+\]/gi, '')
      .replace(/\[(?:completed|tamamlanma):[^\]]+\]/gi, '')
      .replace(/\[status:(?:backlog|inprogress|review|blocked|done)\]/gi, '')
      .replace(/\[type:(?:bug|feature|chore)\]/gi, '')
      .replace(/\[session:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
      .replace(/\[plan:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
      .replace(/\[hours:[\d.]+\]/gi, '')
      .replace(/\[(?:outcome|dakiklik):[^\]]+\]/gi, '')
      .replace(/\[(?:project|proje|book|kitap):[^\]]+\]/gi, '')
      .replace(/\[başlama:[^\]]+\]/gi, '')
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

    // Arama: görev metni, not adı veya etiketlerde geçiyor mu
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const haystack = `${task.content} ${task.noteName} ${task.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: Görev Havuzu'na sıralama seçeneği eklendi. Varsayılan ('score') tarama sırasında
  // zaten uygulanan puan-azalan sıralamayı korur (bkz. setTasks(...).sort al satırı); diğer
  // seçenekler filteredTasks üzerinde AYRICA (kopyalanarak, orijinal diziyi mutasyona
  // uğratmadan) uygulanır.
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === 'dueDate') {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate) || (a.timeSlot || '').localeCompare(b.timeSlot || '');
    }
    if (sortBy === 'alpha') {
      return a.content.localeCompare(b.content, 'tr');
    }
    if (sortBy === 'priority') {
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4);
    }
    return b.score - a.score; // 'score' — varsayılan
  });

  // Category counts
  const pendingCount = parentTasks.filter(t => !t.isChecked).length;
  const completedCount = parentTasks.filter(t => t.isChecked).length;

  const urgentCount = parentTasks.filter(t => !t.isChecked && (t.priority === 'critical' || t.priority === 'high')).length;
  const importantCount = parentTasks.filter(t => !t.isChecked && (t.priority === 'critical' || t.priority === 'medium')).length;
  const dueCount = parentTasks.filter(t => !t.isChecked && t.dueDate).length;
  const repeatCount = parentTasks.filter(t => !t.isChecked && t.repeat && t.repeat !== 'none').length;

  // Folder and Tag collections from active tasks
  // BUG DÜZELTMESİ: .templates gibi nokta ile başlayan sistem klasörleri Sidebar.tsx'te
  // zaten gizleniyor (bkz. Sidebar.tsx satır ~452) — buradaki klasör süzgeci listesi aynı
  // kuralı uygulamıyordu, bu yüzden bir şablon notunun içinde görev varsa ".templates"
  // kullanıcıya görünen bir süzgeç seçeneği olarak sızıyordu.
  const activeFolders = Array.from(new Set(
    parentTasks
      .map(t => t.folderName)
      .filter((f): f is string => !!f && !f.split('/')[0].startsWith('.'))
  ));
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

        {/* DAKİKLİK PUSULASI BÖLÜMÜ */}
        <div className="drawer-row">
          <div className="row-label">
            <Compass size={13} />
            <span>DAKİKLİK</span>
          </div>
          <div className="row-control">
            {task.questOutcome ? (
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: task.questOutcome === 'fast' ? '#22c55e' : task.questOutcome === 'ontime' ? '#94a3b8' : '#ef4444' }}>
                {task.questOutcome === 'fast' ? '⚡ Erken bitirdi' : task.questOutcome === 'ontime' ? '✅ Zamanında bitirdi' : task.questOutcome === 'incomplete' ? '❌ Bitirilmedi' : '🐌 Geç kaldı'}
              </span>
            ) : task.questStartedAt ? (
              (() => {
                const deadline = task.dueDate ? getTaskDeadline(task) : null;
                return deadline
                  ? <TaskCountdownInline startedAt={task.questStartedAt} deadline={deadline} />
                  : <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>▶️ Başladı, devam ediyor...</span>;
              })()
            ) : (
              <button
                type="button"
                className="pill-btn"
                onClick={() => handleStartQuest(task)}
                style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <Play size={11} /> Başla
              </button>
            )}
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
            onKeyDown={(e) => {
              // BUG DÜZELTMESİ: Enter'a basınca alt görev eklenmiyordu — tarayıcının
              // formu Enter'da otomatik submit etmesi (implicit submission) senkron
              // olmayan/güvenilmeyen tuş olaylarında (bazı Electron/otomasyon
              // bağlamlarında) tetiklenmeyebiliyor. Native davranışa güvenmek yerine
              // Enter'ı burada doğrudan yakalayıp aynı ekleme mantığını çalıştırıyoruz.
              if (e.key === 'Enter') {
                e.preventDefault();
                if (newSubtaskText.trim()) {
                  handleAddSubtask(task, newSubtaskText);
                  setNewSubtaskText('');
                }
              }
            }}
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
              const message = 'Bu görevi ilgili not dosyasından tamamen silmek istediğinize emin misiniz?';
              if (onRequestConfirm) {
                onRequestConfirm(message, () => handleDeleteTask(task));
              } else if (confirm(message)) {
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
      {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          Geç başlama bilgi notu — cezalandırıcı değil, sadece bitiş saatinin sabit kaldığını
          hatırlatır. CalendarView.tsx'teki aynı kavramın Görev Havuzu'na özel kopyası. */}
      {lateStartNotice && (
        <div
          className="animate-fade"
          style={{
            margin: '10px 12px 0 12px',
            padding: '9px 14px',
            borderRadius: '8px',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span style={{ fontSize: '15px' }}>⏰</span>
          <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
            "{lateStartNotice.taskContent}" planlanandan <strong>{lateStartNotice.lateByMin} dk</strong> geç başladın — bitiş saatin aynı kalıyor, penceren kısaldı.
          </span>
        </div>
      )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsNewTaskFormOpen(prev => !prev)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'var(--accent-color)', color: '#fff', border: 'none',
                borderRadius: '8px', padding: '8px 14px', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer'
              }}
            >
              <Plus size={14} />
              Yeni Görev
            </button>
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
        </div>

        {isNewTaskFormOpen && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleAddNewTask(); }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 20px 14px', flexWrap: 'wrap' }}
          >
            <input
              type="text"
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              placeholder="Görev adı..."
              autoFocus
              style={{
                flex: '1 1 220px', minWidth: '180px', padding: '8px 12px', fontSize: '13px',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px',
                color: 'var(--text-primary)', outline: 'none'
              }}
            />
            <select
              value={newTaskFolder}
              onChange={(e) => setNewTaskFolder(e.target.value)}
              style={{
                padding: '8px 10px', fontSize: '13px', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer'
              }}
            >
              <option value="">Kök Gelen Kutusu (inbox.md)</option>
              {folders.filter(f => !f.split('/')[0].startsWith('.')).map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!newTaskText.trim()}
              style={{
                padding: '8px 16px', fontSize: '12.5px', fontWeight: '700', color: '#fff',
                background: 'var(--accent-color)', border: 'none', borderRadius: '8px',
                cursor: newTaskText.trim() ? 'pointer' : 'not-allowed', opacity: newTaskText.trim() ? 1 : 0.5
              }}
            >
              Ekle
            </button>
          </form>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 20px 14px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '180px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Görevlerde ara..."
              style={{
                width: '100%', padding: '8px 30px 8px 32px', fontSize: '13px',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px',
                color: 'var(--text-primary)', outline: 'none'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="Aramayı temizle"
                style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', padding: '2px'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <ArrowUpDown size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{
                padding: '8px 10px', fontSize: '13px', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer'
              }}
            >
              <option value="score">Puana göre</option>
              <option value="dueDate">Bitiş tarihine göre</option>
              <option value="priority">Önceliğe göre</option>
              <option value="alpha">Alfabetik (A-Z)</option>
            </select>
          </div>
        </div>

        <div className="panel-body">
          {loading && tasks.length === 0 ? (
            <div className="tasks-empty-state">
              <RefreshCw size={48} className="animate-spin text-accent" />
              <h3>Çalışma Alanı Taranıyor...</h3>
              <p>Tüm notlardaki görevleriniz okunuyor ve anlık hesaplanıyor.</p>
            </div>
          ) : sortedTasks.length === 0 ? (
            <div className="tasks-empty-state">
              <AlertCircle size={48} className="text-muted" />
              <h3>Görev Bulunamadı</h3>
              <p>Seçilen süzgeç kriterlerine uygun herhangi bir checklist görevi bulunmamaktadır.</p>
            </div>
          ) : (
            <div className="tasks-list-scroll">
              {sortedTasks.map(task => {
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
