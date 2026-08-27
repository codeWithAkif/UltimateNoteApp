import React, { useState, useEffect, useRef } from 'react';
import NotesView from './NotesView';
import { createPortal } from 'react-dom';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  isToday 
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { isElectron, isBrowser, isCapacitor } from '../services/platform';
import { registerPlugin } from '@capacitor/core';
import {
  applyCompletionToLine, applyQuestStartToLine, applyManualTimeEditToLine, parseQuestTags, stripQuestTags,
  type LineCompletionResult
} from '../punctuality';
import { 
  ChevronLeft, 
  ChevronRight, 
  FileText, 
  CheckCircle2, 
  Circle, 
  Plus, 
  Calendar as CalIcon, 
  CheckSquare, 
  Clock, 
  Star,
  RefreshCw,
  EyeOff,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Building2,
  ExternalLink,
  ListTodo
} from 'lucide-react';
import Hourglass from './Hourglass';

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Bir görevin planlanan bitişine kalan süre için canlı geri sayım. Her saniye kendini
// günceller. Başlatılmış olması ŞART DEĞİL — sadece bir zaman dilimi olan (henüz
// başlanmamış da olsa) her görevde "bitmesine ne kadar kaldığını" gösterir. Kalan süre
// 10 dakikanın altına düşünce kırmızıya döner ve hafifçe nabız atar (uyarı); süre dolunca
// kum saati durur, "geçti" yazısı sabit kırmızı kalır.
//
// BUG DÜZELTMESİ (tutarsız görsel): kum saatinin doluluk oranı önceden görevin TOPLAM
// planlanan süresine (başlangıçtan bitişe) göre hesaplanıyordu — uzun bir görevde (ör. 6
// saatlik pencere) 1 saat kalsa bile bu oransal olarak yalnızca %17 ediyor, kum saati neredeyse
// bitmiş görünüyordu; halbuki kırmızı uyarı zaten MUTLAK dakikaya (son 10dk) bakıyor, ikisi
// tutarsızdı. Artık kum saati de aynı mantıkla, görevin toplam süresinden BAĞIMSIZ, sabit bir
// "son 60 dakikalık pencere" üzerinden doluyor: 60dk+ kalınca tam dolu, 60dk'nın altına
// düşünce görsel olarak akmaya başlıyor, kırmızı eşiğe (10dk) yaklaştıkça iyice azalıyor.
const TASK_COUNTDOWN_URGENT_MS = 10 * 60 * 1000;
const TASK_COUNTDOWN_VISUAL_WINDOW_MS = 60 * 60 * 1000;

const TaskCountdown: React.FC<{ startTime?: Date; deadline: Date; size?: 'compact' | 'full' }> = ({ startTime, deadline, size = 'compact' }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadlineMs = deadline.getTime();
  const startMs = startTime ? startTime.getTime() : 0;
  const isNotStarted = startTime && now < startMs;
  const isOverdue = now >= deadlineMs;

  const remainingToStartMs = isNotStarted ? startMs - now : 0;
  const remainingToEndMs = !isNotStarted && !isOverdue ? deadlineMs - now : 0;

  const isUrgent = !isNotStarted && !isOverdue && remainingToEndMs <= TASK_COUNTDOWN_URGENT_MS;
  const isDanger = isUrgent || isOverdue;

  const color = isDanger ? '#fecaca' : isNotStarted ? '#93c5fd' : '#e2e8f0';
  const background = isDanger ? '#7f1d1d' : isNotStarted ? 'rgba(30, 58, 138, 0.85)' : 'rgba(15,23,42,0.85)';
  const borderColor = isDanger ? '#ef4444' : isNotStarted ? 'rgba(147, 197, 253, 0.4)' : 'rgba(226,232,240,0.35)';

  const remainingFraction = isNotStarted
    ? Math.max(0, Math.min(1, remainingToStartMs / TASK_COUNTDOWN_VISUAL_WINDOW_MS))
    : isOverdue ? 0 : Math.max(0, Math.min(1, remainingToEndMs / TASK_COUNTDOWN_VISUAL_WINDOW_MS));

  const formatText = () => {
    if (isNotStarted) {
      const totalMin = Math.ceil(remainingToStartMs / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const txt = h > 0 ? `${h}s ${m}dk` : `${m}dk`;
      return size === 'compact' ? `${txt} sonra` : `${txt} sonra başlıyor`;
    }
    if (isOverdue) {
      const abs = Math.abs(now - deadlineMs);
      const totalMin = Math.floor(abs / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const txt = h > 0 ? `${h}s ${m}dk` : `${m}dk`;
      return `${txt} geçti`;
    }
    const totalMin = Math.ceil(remainingToEndMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const txt = h > 0 ? `${h}s ${m}dk` : `${m}dk`;
    return `${txt} kaldı`;
  };

  const title = isNotStarted
    ? 'Başlamasına kalan süre'
    : isOverdue ? 'Süre doldu' : isUrgent ? 'Son 10 dakika!' : 'Bitişe kalan süre';

  const urgentClass = isDanger ? 'countdown-urgent-pulse' : '';

  if (size === 'compact') {
    return (
      <span
        title={title}
        className={urgentClass}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          fontSize: '9px',
          fontWeight: 700,
          color,
          background,
          border: `1px solid ${borderColor}`,
          borderRadius: '4px',
          padding: '1px 4px',
          flexShrink: 0,
          position: 'relative',
          zIndex: 2
        }}
      >
        <Hourglass remainingFraction={remainingFraction} active={!isOverdue} size={11} />
        {formatText()}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={urgentClass}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '11.5px',
        fontWeight: 800,
        color,
        padding: '3px 8px',
        borderRadius: '6px',
        background,
        border: `1.5px solid ${borderColor}`,
        boxShadow: isDanger ? '0 0 8px rgba(239,68,68,0.5)' : isNotStarted ? '0 1px 3px rgba(30,58,138,0.5)' : '0 1px 3px rgba(0,0,0,0.4)',
        alignSelf: 'flex-start',
        position: 'relative',
        zIndex: 2
      }}
    >
      <Hourglass remainingFraction={remainingFraction} active={!isOverdue} size={14} />
      {formatText()}
    </span>
  );
};

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

interface CalendarViewProps {
  notes: NoteItem[];
  folders: string[];
  tags: string[];
  fileContents: Record<string, string>;
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
  onCreateNote: (name: string, folder: string | null, isExcalidraw?: boolean | 'drawio', initialContent?: string, switchActiveNote?: boolean) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
  onRenameNote: (oldPath: string, newPath: string) => Promise<void>;
  onRequestConfirm?: (message: string, onConfirm: () => void) => void;
  templatesFolder?: string;
  mindmapLayouts?: Record<string, { coords: any; customs: any[] }>;
  onSaveMindmapLayout?: (path: string, coords: any, customs: any[]) => Promise<void>;
  pinnedWidgetLists?: string[];
  pinnedWidgetList?: string | null;
  onUpdatePinnedWidgets?: (newLists: string[], newActive: string | null) => Promise<void>;
  isFlowEffectsEnabled?: boolean;
  lineHeight?: number;
  lineMargin?: number;
  onCreateDailyNote: (dateStr: string) => void;
  onSelectDateNotes: (dateStr: string) => void;
  embedded?: boolean;
  onQuestReward?: (reward: LineCompletionResult) => void;
  activeCascadeCompletedAt?: string | null;
  projectNames?: string[];
  projectColors?: Record<string, { color: string; icon: string }>;
  clientNames?: string[];
  clientProjectSlugs?: Record<string, string[]>;
  // İSTEK ("kütüphane" — sağ tık bağlam menüsündeki "Kitap Oku" seçeneği): Kütüphane'deki
  // kitap başlıkları — bkz. LibraryView.tsx'teki bookNotes taramasıyla AYNI mantık.
  bookNames?: string[];
  onOpenNotePath?: (path: string) => void;
}

export interface WorkspaceSubTask {
  id: string;
  content: string;
  isChecked: boolean;
  lineIdx: number;
  filePath: string;
  dueDate?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
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
  dueDate: string; // YYYY-MM-DD
  timeSlot: string; // HH:mm-HH:mm
  repeat: string;
  score: number;
  tags: string[];
  // Yalnızca bu görevin KENDİ satırındaki etiketler (not-geneli etiketler HARİÇ) — bkz.
  // ilgili atama noktasındaki yorum. Proje/müşteri eşleştirmesi bunu kullanmalı.
  ownTags: string[];
  isSubtask?: boolean;
  parentTaskId?: string | null;
  subtasks?: WorkspaceSubTask[];
  isExternal?: boolean;
  externalSource?: 'google' | 'outlook';
  // Bir işe birden fazla günde çalışılmışsa (bkz. handleContinueTaskSession/[session:]
  // etiketi), ana satır YALNIZCA en güncel günü [due:]/[plannedtime:] olarak taşır — geçmiş
  // günler kaybolmasın diye her biri BURADA salt-okunur, ayrı bir takvim bloğu olarak da
  // render edilir (aynı satırdan türer, sürükleme/resize/çift-tık-düzenleme YOK — hepsi ana
  // satırı değiştirir, geçmiş günün kaydını bozardı).
  isSessionOccurrence?: boolean;
  // Bu satırda en az bir [session:] geçmişi (bkz. isSessionOccurrence yorumu) varsa true —
  // "hiç başlanmadan planlanan pencere geçmiş görevi otomatik geri çek" mekanizması (bkz.
  // autoRevertedTaskIdsRef) bunu kullanıp session geçmişi olan görevleri MUAF tutar: bu
  // görevler kullanıcının aktif takip ettiği çok günlü işlerdir, "unutulmuş" tek seferlik bir
  // görev değildir — sessizce planından koparılıp kaybolmamalı.
  hasSessionHistory?: boolean;
  // İSTEK ("önümdeki 3-4 sessionu planlama"): [plan:TARİH THH:MM-HH:MM] etiketinden türer —
  // isSessionOccurrence'ın (geçmiş, salt-okunur) TERSİ: henüz çalışılmamış, GELECEKTEKİ ek bir
  // oturum planıdır. Normal bir kart gibi tam etkileşimlidir (sürüklenebilir/boyutlandırılabilir)
  // ama satır metnini değiştirmek anlamsız olduğundan çift-tık düzenleme kapalıdır — bkz.
  // handleScheduleTask/handleUnscheduleTask'taki isPlanOccurrence dallanması (kendi [plan:]
  // etiketini bulup değiştirir/siler, ana [due:]/[plannedtime:]'a dokunmaz).
  isPlanOccurrence?: boolean;
  questStartedAt: string | null;
  questCompletedAt: string | null;
  questOutcome: 'fast' | 'ontime' | 'late' | 'incomplete' | null;
}

interface ICSEvent {
  id: string;
  content: string;
  dueDate: string;
  timeSlot: string;
}

interface RawVEVENT {
  id: string;
  content: string;
  startRaw: string;
  endRaw: string;
  rrule?: string;
  recurrenceId?: string;
}

function normalizeSummary(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(canceled|iptal edildi|kopya|copy|declined|reddedildi|iptal):\s*/, '')
    .trim();
}

function expandRecurringEvent(
  baseEvent: RawVEVENT,
  rangeStart: Date,
  rangeEnd: Date,
  exceptionKeys: Set<string>
): ICSEvent[] {
  const events: ICSEvent[] = [];
  const startRaw = baseEvent.startRaw;
  const endRaw = baseEvent.endRaw || startRaw;
  const rruleStr = baseEvent.rrule || '';

  const startMatch = startRaw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!startMatch) return events;
  
  const startYear = parseInt(startMatch[1]);
  const startMonth = parseInt(startMatch[2]) - 1;
  const startDay = parseInt(startMatch[3]);
  
  let startHour = 0;
  let startMin = 0;
  const startTIdx = startRaw.indexOf('T');
  if (startTIdx !== -1) {
    startHour = parseInt(startRaw.slice(startTIdx + 1, startTIdx + 3));
    startMin = parseInt(startRaw.slice(startTIdx + 3, startTIdx + 5));
  }

  const dtStart = new Date(startYear, startMonth, startDay, startHour, startMin);

  let untilDate: Date | null = null;
  const untilMatch = rruleStr.match(/UNTIL=(\d{4})(\d{2})(\d{2})/);
  if (untilMatch) {
    const uy = parseInt(untilMatch[1]);
    const um = parseInt(untilMatch[2]) - 1;
    const ud = parseInt(untilMatch[3]);
    untilDate = new Date(uy, um, ud, 23, 59, 59);
  }

  const freqMatch = rruleStr.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/);
  if (!freqMatch) return events;
  const freq = freqMatch[1];

  const intervalMatch = rruleStr.match(/INTERVAL=(\d+)/);
  const interval = intervalMatch ? parseInt(intervalMatch[1]) : 1;

  const bydayMatch = rruleStr.match(/BYDAY=([A-Z,]+)/);
  const bydays = bydayMatch ? bydayMatch[1].split(',') : [];

  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  const formatDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  let timeSlot = '';
  const endTIdx = endRaw.indexOf('T');
  if (startTIdx !== -1 && endTIdx !== -1) {
    const sHour = startRaw.slice(startTIdx + 1, startTIdx + 3);
    const sMin = startRaw.slice(startTIdx + 3, startTIdx + 5);
    const eHour = endRaw.slice(endTIdx + 1, endTIdx + 3);
    const eMin = endRaw.slice(endTIdx + 3, endTIdx + 5);
    if (sHour && sMin && eHour && eMin) {
      timeSlot = `${sHour}:${sMin}-${eHour}:${eMin}`;
    }
  }

  if (freq === 'DAILY') {
    let curr = new Date(dtStart);
    let count = 0;
    while (curr <= rangeEnd && count < 1000) {
      if (untilDate && curr > untilDate) break;
      
      const dateStrYMD = formatDate(curr);
      const datePart = dateStrYMD.replace(/-/g, '');
      const key = `${normalizeSummary(baseEvent.content)}_${datePart}`;

      if (!exceptionKeys.has(key)) {
        if (curr >= rangeStart) {
          events.push({
            id: `${baseEvent.id}-${dateStrYMD}`,
            content: baseEvent.content,
            dueDate: dateStrYMD,
            timeSlot
          });
        }
      }
      curr.setDate(curr.getDate() + interval);
      count++;
    }
  } else if (freq === 'WEEKLY') {
    let currWeekStart = new Date(dtStart);
    let count = 0;
    while (currWeekStart <= rangeEnd && count < 200) {
      if (untilDate && currWeekStart > untilDate) break;

      if (bydays.length > 0) {
        for (const byday of bydays) {
          const targetDayNum = dayMap[byday];
          if (targetDayNum !== undefined) {
            const diff = targetDayNum - currWeekStart.getDay();
            const eventDate = new Date(currWeekStart);
            eventDate.setDate(currWeekStart.getDate() + diff);

            if (untilDate && eventDate > untilDate) continue;
            
            const dateStrYMD = formatDate(eventDate);
            const datePart = dateStrYMD.replace(/-/g, '');
            const key = `${normalizeSummary(baseEvent.content)}_${datePart}`;

            if (!exceptionKeys.has(key)) {
              if (eventDate >= rangeStart && eventDate <= rangeEnd) {
                events.push({
                  id: `${baseEvent.id}-${dateStrYMD}`,
                  content: baseEvent.content,
                  dueDate: dateStrYMD,
                  timeSlot
                });
              }
            }
          }
        }
      } else {
        const dateStrYMD = formatDate(currWeekStart);
        const datePart = dateStrYMD.replace(/-/g, '');
        const key = `${normalizeSummary(baseEvent.content)}_${datePart}`;

        if (!exceptionKeys.has(key)) {
          if (currWeekStart >= rangeStart && currWeekStart <= rangeEnd) {
            events.push({
              id: `${baseEvent.id}-${dateStrYMD}`,
              content: baseEvent.content,
              dueDate: dateStrYMD,
              timeSlot
            });
          }
        }
      }

      currWeekStart.setDate(currWeekStart.getDate() + 7 * interval);
      count++;
    }
  } else {
    if (dtStart >= rangeStart && dtStart <= rangeEnd) {
      const dateStrYMD = formatDate(dtStart);
      const datePart = dateStrYMD.replace(/-/g, '');
      const key = `${normalizeSummary(baseEvent.content)}_${datePart}`;
      if (!exceptionKeys.has(key)) {
        events.push({
          id: `${baseEvent.id}-${dateStrYMD}`,
          content: baseEvent.content,
          dueDate: dateStrYMD,
          timeSlot
        });
      }
    }
  }

  return events;
}

function parseICS(icsText: string): ICSEvent[] {
  const rawEvents: RawVEVENT[] = [];
  const exceptionKeys = new Set<string>();

  const lines = icsText.split(/\r?\n/);
  let currentEvent: Partial<RawVEVENT> | null = null;
  let eventCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length && (lines[i+1].startsWith(' ') || lines[i+1].startsWith('\t'))) {
      line += lines[i+1].slice(1);
      i++;
    }

    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      currentEvent = {};
      eventCounter++;
    } else if (trimmed === 'END:VEVENT' && currentEvent) {
      if (currentEvent.content && currentEvent.startRaw) {
        currentEvent.id = currentEvent.id || `ics-${eventCounter}`;
        rawEvents.push(currentEvent as RawVEVENT);

        if (currentEvent.recurrenceId) {
          const datePart = currentEvent.recurrenceId.substring(0, 8);
          const key = `${normalizeSummary(currentEvent.content)}_${datePart}`;
          exceptionKeys.add(key);
        }
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const keyPart = trimmed.substring(0, colonIdx);
        const value = trimmed.substring(colonIdx + 1);

        if (keyPart.startsWith('SUMMARY')) {
          currentEvent.content = value.replace(/\\,/g, ',').replace(/\\;/g, ';');
        } else if (keyPart.startsWith('DTSTART')) {
          currentEvent.startRaw = value;
        } else if (keyPart.startsWith('DTEND')) {
          currentEvent.endRaw = value;
        } else if (keyPart.startsWith('UID')) {
          currentEvent.id = value;
        } else if (keyPart.startsWith('RRULE')) {
          currentEvent.rrule = value;
        } else if (keyPart.startsWith('RECURRENCE-ID')) {
          currentEvent.recurrenceId = value;
        }
      }
    }
  }

  const rangeStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

  const finalEvents: ICSEvent[] = [];

  for (const raw of rawEvents) {
    if (raw.rrule) {
      const expanded = expandRecurringEvent(raw, rangeStart, rangeEnd, exceptionKeys);
      finalEvents.push(...expanded);
    } else {
      const startRaw = raw.startRaw;
      const startMatch = startRaw.match(/^(\d{4})(\d{2})(\d{2})/);
      if (startMatch) {
        const y = startMatch[1];
        const m = startMatch[2];
        const d = startMatch[3];
        const dueDate = `${y}-${m}-${d}`;
        const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));

        if (dt >= rangeStart && dt <= rangeEnd) {
          let timeSlot = '';
          const startTIdx = startRaw.indexOf('T');
          const endRaw = raw.endRaw || startRaw;
          const endTIdx = endRaw.indexOf('T');
          if (startTIdx !== -1 && endTIdx !== -1) {
            const sHour = startRaw.slice(startTIdx + 1, startTIdx + 3);
            const sMin = startRaw.slice(startTIdx + 3, startTIdx + 5);
            const eHour = endRaw.slice(endTIdx + 1, endTIdx + 3);
            const eMin = endRaw.slice(endTIdx + 3, endTIdx + 5);
            if (sHour && sMin && eHour && eMin) {
              timeSlot = `${sHour}:${sMin}-${eHour}:${eMin}`;
            }
          }

          finalEvents.push({
            id: raw.id,
            content: raw.content,
            dueDate,
            timeSlot
          });
        }
      }
    }
  }

  return finalEvents;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// BUG DÜZELTMESİ (kullanıcı geri bildirimi: "sadece köşesini yapıyormuşsun göremedim") —
// müşteri rengi önceden yalnızca ince bir sol kenarlık olarak uygulanıyordu, bu da pratikte
// fark edilmiyordu. .scheduled-event-card'ın arka plan gradyanı/kenarlığı/gölgesi ZATEN
// tek bir CSS değişkenine (--card-priority-rgb, "r, g, b" formatında) bağlı — bu değişkeni
// inline stille müşterinin rengine ayarlamak, KARTIN TAMAMINI (arka plan tonu + kenarlık +
// parlama) o renge boyuyor; öncelik rengine göre çok daha belirgin.
const hexToRgbString = (hex: string): string => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `${r}, ${g}, ${b}`;
};

export default function CalendarView({
  notes,
  folders,
  tags,
  fileContents,
  readNoteContent,
  onSaveNote,
  onCreateNote,
  onDeletePath,
  onRenameNote,
  onRequestConfirm,
  templatesFolder = '',
  mindmapLayouts = {},
  onSaveMindmapLayout,
  pinnedWidgetLists,
  pinnedWidgetList,
  onUpdatePinnedWidgets,
  isFlowEffectsEnabled,
  lineHeight,
  lineMargin,
  onCreateDailyNote,
  onSelectDateNotes,
  embedded = false,
  onQuestReward,
  activeCascadeCompletedAt = null,
  projectNames = [],
  projectColors = {},
  clientNames = [],
  clientProjectSlugs = {},
  bookNames = [],
  onOpenNotePath
}: CalendarViewProps) {
  const [selectedTaskNotePath, setSelectedTaskNotePath] = useState<string | null>(null);

  // Right sidebar resizable width state
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('calendar_sidebar_width');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 220 && parsed <= 900) return parsed;
    }
    return 320;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);

  const handleStartResizeSidebar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(240, Math.min(800, startWidth + deltaX));
      setSidebarWidth(newWidth);
      localStorage.setItem('calendar_sidebar_width', String(newWidth));
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleSelectTaskForNote = (task: { filePath?: string; noteName?: string; content: string; lineIdx?: number; isExternal?: boolean }) => {
    if (task.isExternal || !task.filePath) return;
    setSelectedTaskNotePath(task.filePath);
  };
  // İSTEK: takvimde müşteri seçince sadece o müşterilerin görevleri gösterilsin, "Tümü"
  // (boş seçim) seçilince eskisi gibi hepsi görünsün (çoklu seçim desteği).
  const [selectedClientFilters, setSelectedClientFilters] = useState<string[]>([]);
  const [isClientFilterOpen, setIsClientFilterOpen] = useState(false);

  const taskMatchesClientFilter = (t: { ownTags: string[] }): boolean => {
    if (selectedClientFilters.length === 0) return true;
    const slugs = selectedClientFilters.flatMap(client => clientProjectSlugs[client] || []);
    if (slugs.length === 0) return false;
    return t.ownTags.some(tag => slugs.includes(tag));
  };

  const toggleClientFilter = (clientName: string) => {
    setSelectedClientFilters(prev =>
      prev.includes(clientName)
        ? prev.filter(c => c !== clientName)
        : [...prev, clientName]
    );
  };

  const [viewMode, setViewMode] = useState<'month' | 'week' | 'threeDay' | 'day'>(() => {
    if (embedded) return 'day';
    return (isElectron || isBrowser) ? 'week' : 'day';
  });
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Scanned task states
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "Başla" planlanan saatten 5dk+ sonra basıldığında kısa süreliğine gösterilen, cezalandırıcı
  // olmayan bilgi notu (bkz. handleStartTaskFromCalendar) — skoru etkilemez.
  const [lateStartNotice, setLateStartNotice] = useState<{ taskContent: string; lateByMin: number } | null>(null);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: "İşi zamanında yaptım ama uygulamaya sonradan ekledim, sanki geç kalmışım gibi
  // puan kırıldı." Başlangıç/tamamlanma damgaları yalnızca UYGULAMADA TIKLANAN ana göre
  // yazıldığı için, işi gerçekte NE ZAMAN yaptığını burada elle düzeltebilmesi gerekiyordu.
  // datetime-local input'ları saniye/milisaniye taşımadığı için form state basit string
  // (YYYY-MM-DDTHH:mm) tutar, kaydederken ISO'ya çevrilir.
  const [editingTimesTask, setEditingTimesTask] = useState<WorkspaceTask | null>(null);
  const [editStartLocal, setEditStartLocal] = useState('');
  const [editCompletedLocal, setEditCompletedLocal] = useState('');

  // External Calendar Sync States
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [connectedCalendars, setConnectedCalendars] = useState<{ google: boolean; outlook: boolean }>(() => {
    try {
      const saved = localStorage.getItem('connected_calendars');
      return saved ? JSON.parse(saved) : { google: false, outlook: false };
    } catch {
      return { google: false, outlook: false };
    }
  });

  const [calendarUrls, setCalendarUrls] = useState<{ google: string; outlook: string }>(() => {
    try {
      const saved = localStorage.getItem('calendar_urls');
      return saved ? JSON.parse(saved) : { google: '', outlook: '' };
    } catch {
      return { google: '', outlook: '' };
    }
  });

  const [googleInput, setGoogleInput] = useState('');
  const [outlookInput, setOutlookInput] = useState('');
  
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Kullanıcının modal içinde geçici olarak takvimleri aktif/pasif etmesini sağlayan geçici UI stateleri.
  const [googleActive, setGoogleActive] = useState(false);
  const [outlookActive, setOutlookActive] = useState(false);

  useEffect(() => {
    if (isSyncModalOpen) {
      setGoogleInput(calendarUrls.google);
      setOutlookInput(calendarUrls.outlook);
      setGoogleActive(connectedCalendars.google);
      setOutlookActive(connectedCalendars.outlook);
    }
  }, [isSyncModalOpen, calendarUrls, connectedCalendars]);

  const [externalEvents, setExternalEvents] = useState<{
    id: string;
    content: string;
    dueDate: string;
    timeSlot: string;
    source: 'google' | 'outlook';
  }[]>([]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: dış takvimlerden (Google/Outlook) gelen bazı tekrarlayan etkinlikler (ör. günlük
  // "Daily" toplantıları) takvimi kalabalıklaştırıyor — kullanıcı bunları tek tek gizleyebilsin
  // istedi. Gizleme, etkinliğin BAŞLIĞINA (content) göre kalıcı olarak (localStorage) saklanır —
  // tekrarlayan bir toplantı her göründüğünde ayrı ayrı gizlenmesin diye. Kaynak, kullanıcının
  // ICS URL'sini kendi kontrol ettiği (parseICS harici, üçüncü taraf bir kaynak) yerel bir
  // tercih listesidir — sunucu tarafında hiçbir şey değişmez.
  const HIDDEN_EXTERNAL_TITLES_KEY = 'calendar_hidden_external_titles';
  const [hiddenExternalTitles, setHiddenExternalTitles] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_EXTERNAL_TITLES_KEY) || '[]');
    } catch (e) {
      return [];
    }
  });
  const hideExternalEventTitle = (title: string) => {
    setHiddenExternalTitles(prev => {
      if (prev.includes(title)) return prev;
      const next = [...prev, title];
      localStorage.setItem(HIDDEN_EXTERNAL_TITLES_KEY, JSON.stringify(next));
      return next;
    });
  };
  const restoreExternalEventTitle = (title: string) => {
    setHiddenExternalTitles(prev => {
      const next = prev.filter(t => t !== title);
      localStorage.setItem(HIDDEN_EXTERNAL_TITLES_KEY, JSON.stringify(next));
      return next;
    });
  };
  const [externalEventInfoModal, setExternalEventInfoModal] = useState<{
    content: string; source: 'google' | 'outlook'; dueDate: string; timeSlot: string;
  } | null>(null);

  const fetchICSFeed = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Direct fetch failed');
      return await res.text();
    } catch {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      return await res.text();
    }
  };

  useEffect(() => {
    let active = true;

    const syncFeeds = async () => {
      const eventsList = [];

      if (connectedCalendars.google && calendarUrls.google) {
        try {
          const icsText = await fetchICSFeed(calendarUrls.google);
          const parsed = parseICS(icsText);
          eventsList.push(...parsed.map(e => ({ ...e, source: 'google' as const })));
        } catch (err) {
          console.error('Google calendar sync failed', err);
        }
      }

      if (connectedCalendars.outlook && calendarUrls.outlook) {
        try {
          const icsText = await fetchICSFeed(calendarUrls.outlook);
          const parsed = parseICS(icsText);
          eventsList.push(...parsed.map(e => ({ ...e, source: 'outlook' as const })));
        } catch (err) {
          console.error('Outlook calendar sync failed', err);
        }
      }

      if (active) {
        setExternalEvents(eventsList);
      }
    };

    syncFeeds();
    const interval = setInterval(syncFeeds, 5 * 60 * 1000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [connectedCalendars, calendarUrls]);

  // Combined array for all calendar renderings
  const allMergedEvents: WorkspaceTask[] = [
    ...tasks,
    ...externalEvents.filter(evt => !hiddenExternalTitles.includes(evt.content)).map(evt => ({
      id: evt.id,
      content: evt.content,
      isChecked: false,
      lineIdx: -1,
      filePath: '',
      noteName: evt.source === 'google' ? 'Google Calendar' : 'Outlook Calendar',
      folderName: null,
      priority: 'medium' as const,
      dueDate: evt.dueDate,
      timeSlot: evt.timeSlot,
      repeat: '',
      score: 5,
      tags: [] as string[],
      ownTags: [] as string[],
      isExternal: true,
      externalSource: evt.source,
      questStartedAt: null,
      questCompletedAt: null,
      questOutcome: null
    }))
  ];

  useEffect(() => {
    if (!isCapacitor) return;
    const syncReminders = async () => {
      try {
        const now = Date.now();
        const upcoming = allMergedEvents
          .filter(evt => {
            if (!evt.dueDate) return false;
            const datePart = evt.dueDate;
            const startTime = evt.timeSlot ? evt.timeSlot.split('-')[0].trim() : '09:00';
            if (!/^\d{2}:\d{2}$/.test(startTime)) return false;
            const dt = new Date(`${datePart}T${startTime}:00`);
            const timeMs = dt.getTime();
            return timeMs > (now - 60 * 60 * 1000) && (timeMs - now) < 24 * 60 * 60 * 1000;
          })
          .map(evt => {
            const datePart = evt.dueDate;
            const startTime = evt.timeSlot ? evt.timeSlot.split('-')[0].trim() : '09:00';
            const dt = new Date(`${datePart}T${startTime}:00`);
            return {
              id: evt.id,
              title: evt.content,
              eventTimeMs: dt.getTime(),
              completed: evt.isChecked
            };
          });

        if (upcoming.length > 0) {
          const WidgetBridge = registerPlugin<any>('WidgetBridge');
          await WidgetBridge.scheduleEventCountdowns({ events: upcoming });
        }
      } catch (err) {
        console.error(err);
      }
    };
    syncReminders();
  }, [allMergedEvents]);

  // Track accordion expanded state in sidebar
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [isUnplannedOpen, setIsUnplannedOpen] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: "ctrl + orta mouse (tekerlek) ileri-geri yuvarlama ile zaman scopelama" — takvimin
  // saatlik satır yüksekliğini (dolayısıyla tüm gün/hafta görünümündeki zaman yoğunluğunu)
  // Ctrl+tekerlek ile yakınlaştırıp uzaklaştırma. Izgara HER YERDE "1 dakika = 1px" varsayımıyla
  // kuruluydu (fare pozisyonu <-> dakika dönüşümleri, sürükle-oluştur, yeniden boyutlandırma,
  // şu-an çizgisi, saat satırı yükseklikleri) — bu yüzden tek bir çarpan (zoomLevel) ekleyip
  // TÜM bu dönüşüm noktalarını ona göre güncelledik (bkz. minToPx/pxToMin). Tercih
  // localStorage'da kalıcı — kullanıcı bir kez ayarlayınca her açılışta korunur.
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const stored = parseFloat(localStorage.getItem('calendar_zoom_level') || '1');
    return isNaN(stored) ? 1 : Math.max(0.5, Math.min(3, stored));
  });
  useEffect(() => {
    localStorage.setItem('calendar_zoom_level', String(zoomLevel));
  }, [zoomLevel]);
  // Pinch-zoom dokunma olayı dinleyicisi (aşağıda) [] bağımlılığıyla bir kere kurulduğundan
  // zoomLevel'i doğrudan kapatırsa BAYAT kalır (her zaman ilk değeri görür) — bu ref her
  // render'da güncel değeri tutar, dokunma başlarken "şu anki zoom neydi" diye buradan okunur.
  const zoomLevelRef = useRef(zoomLevel);
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);
  // px -> gerçek dakika (fare/piksel ölçümlerini zoom'dan bağımsız dakikaya çevirir)
  const pxToMin = (px: number) => px / zoomLevel;
  // gerçek dakika -> px (render için, zoom'a göre ölçeklenmiş yükseklik/konum)
  const minToPx = (min: number) => min * zoomLevel;
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: "yaklaştıkça aradaki bölümler de çıksın, önce 11:30 sonra 11:15/11:45" — zoom
  // arttıkça saat çizgisi granülaritesi kademeli olarak inceliyor (Google Calendar tarzı):
  // uzaktan sadece tam saat, orta zoom'da yarım saat, yüksek zoom'da çeyrek saat çizgileri.
  // Saat etiketi (time-axis-column) VE arka plan çizgileri (grid-lines-layer) AYNI dizinin
  // (minuteMarks) üzerinden üretilir — bir önceki hizalama hatasının (satır sayısı/yüksekliği
  // iki yerde ayrı hesaplanınca kayması) tekrar etmemesi için TEK bir kaynak kullanılır.
  const minuteMarks = zoomLevel >= 2.2 ? [0, 15, 30, 45] : zoomLevel >= 1.4 ? [0, 30] : [0];
  const timeMarks: { hour: number; min: number }[] = [];
  for (let h = 0; h < 24; h++) {
    minuteMarks.forEach(m => timeMarks.push({ hour: h, min: m }));
  }
  const markHeightPx = minToPx(60 / minuteMarks.length);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleWheelZoom = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // Fare imlecinin altındaki saatte kalınmasını sağlamak için, zoom öncesi o noktanın
      // içerikteki (scroll edilmemiş) mutlak konumunu saklayıp zoom sonrası aynı ekran
      // konumuna geri kaydırıyoruz — aksi halde her zoom'da görünüm rastgele bir yere zıplar.
      const rect = el.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      const absoluteY = el.scrollTop + pointerY;
      setZoomLevel(prev => {
        const next = Math.max(0.5, Math.min(3, prev + (e.deltaY < 0 ? 0.1 : -0.1)));
        const ratio = next / prev;
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = absoluteY * ratio - pointerY;
          }
        });
        return next;
      });
    };
    el.addEventListener('wheel', handleWheelZoom, { passive: false });

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // İSTEK: masaüstünde Ctrl+fare tekerleği ile yapılan yakınlaştırmanın AYNISI, telefonda
    // iki parmakla sıkıştırma/açma (pinch) hareketiyle de çalışsın. Aynı zoomLevel state'ini
    // ve aynı "işaret noktasının altında kalma" mantığını (wheel'deki pointerY/absoluteY gibi,
    // burada iki dokunuşun orta noktası) paylaşır — tek fark tetikleyici olay türü.
    const pinchState = { active: false, startDist: 0, startZoom: 1, anchorAbsoluteY: 0, anchorScreenY: 0 };
    const touchDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      pinchState.active = true;
      pinchState.startDist = touchDistance(e.touches);
      pinchState.startZoom = zoomLevelRef.current;
      const rect = container.getBoundingClientRect();
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      pinchState.anchorScreenY = midY - rect.top;
      pinchState.anchorAbsoluteY = container.scrollTop + pinchState.anchorScreenY;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!pinchState.active || e.touches.length !== 2) return;
      e.preventDefault();
      const dist = touchDistance(e.touches);
      if (pinchState.startDist <= 0) return;
      const scale = dist / pinchState.startDist;
      const next = Math.max(0.5, Math.min(3, pinchState.startZoom * scale));
      const ratio = next / pinchState.startZoom;
      setZoomLevel(next);
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = pinchState.anchorAbsoluteY * ratio - pinchState.anchorScreenY;
        }
      });
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchState.active = false;
    };
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      el.removeEventListener('wheel', handleWheelZoom);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  // Auto-scroll to current time slot when view mode switches
  useEffect(() => {
    if (viewMode === 'month') return;

    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();

        const targetTop = minToPx(currentHour * 60 + currentMin);
        const containerHeight = scrollContainerRef.current.clientHeight;
        const scrollTo = Math.max(0, targetTop - containerHeight / 2);

        scrollContainerRef.current.scrollTo({
          top: scrollTo,
          behavior: 'smooth'
        });
      }
    }, 150); // slight delay to guarantee DOM renders container

    return () => clearTimeout(timer);
  }, [viewMode, zoomLevel]);

  // Subtasks popover and choice modal states
  const [popoverState, setPopoverState] = useState<{
    task: WorkspaceTask;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const popoverTimeoutRef = useRef<any>(null);

  const [schedulingModalData, setSchedulingModalData] = useState<{
    task: WorkspaceTask;
    dateStr: string;
    timeSlot: string;
  } | null>(null);

  const [activeSchedulingModal, setActiveSchedulingModal] = useState<{
    taskId?: string;
    taskName: string;
    dateStr: string;
    startTime: string;
    endTime: string;
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Görev hem o günün notunda hem ilgili PROJENİN altında "görünmeli" isteği (müşteriye
    // DEĞİL — hiyerarşi Müşteri → Proje → Görev, bkz. kullanıcı geri bildirimi). Görevi İKİ
    // dosyaya fiziksel olarak yazmak yerine (o zaman biri tiklenince diğeri habersiz kalır,
    // aynı dev_paths'teki "tek blob" sorununun task versiyonu olur), günlük nottaki satıra
    // proje etiketini (#proje-slug) ekliyoruz. Proje notu (ve dolayısıyla o projeye bağlı
    // müşteri) bu etiketle canlı bir sorgu yaparak aynı satırı sayar (bkz. ProjectsView.tsx
    // getProjectProgress/currentProjectTasks) — TEK gerçek kopya, iki görünüm.
    projectTag: string;
    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Takvimdeki bir göreve ÇİFT TIKLAYINCA açılan gerçek düzenleme modunu, "Seçili tarihe
    // planla" / drag-drop akışlarından (bunlar da aynı modalı, ama sadece tarih/saat
    // değiştirmek için kullanır — GÖREV ADI alanı kilitli kalır, subtask grup/dağıt
    // sorusu vs. o akışlara özel davranışlar bozulmasın diye) ayırt eder.
    isEditMode: boolean;
  } | null>(null);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: "Yeni Görev Ekle/Düzenle" modalında önce MÜŞTERİ seçilsin, sonra proje dropdown'u
  // sadece o müşterinin projeleriyle sınırlansın. Bu filtre, activeSchedulingModal'ın kendi
  // state şeklini (7 farklı yerde oluşturuluyor) değiştirmeden, modal her açıldığında/mevcut
  // projeye göre senkronize edilen AYRI bir yerel state olarak tutulur.
  const [modalClientFilter, setModalClientFilter] = useState('');
  // İSTEK ("önümdeki 3-4 sessionu planlama"): activeSchedulingModal'ın paylaşılan tipini
  // (7 farklı yerde oluşturuluyor, bkz. yukarıdaki yorum) değiştirmemek için AYRI bir yerel
  // state — modalClientFilter ile aynı desen. İşaretliyken, aynı isim+projeyle açık bir görev
  // bulunursa mevcut plan TAŞINMAZ, ek bir [plan:] günü olarak eklenir (bkz.
  // handleAddPlanOccurrence).
  const [keepExistingPlan, setKeepExistingPlan] = useState(false);
  useEffect(() => {
    if (!activeSchedulingModal) {
      setModalClientFilter('');
      return;
    }
    if (activeSchedulingModal.projectTag) {
      const owningClient = clientNames.find(c =>
        (clientProjectSlugs[c] || []).includes(activeSchedulingModal.projectTag.toLocaleLowerCase('tr').replace(/\s+/g, '-'))
      );
      setModalClientFilter(owningClient || '');
    } else {
      setModalClientFilter('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchedulingModal?.taskId, activeSchedulingModal !== null]);

  // Drag, Drop, and Resize states
  const [tempEventHeights, setTempEventHeights] = useState<{ [key: string]: number }>({});
  const [resizingEvent, setResizingEvent] = useState<{
    taskId: string;
    startY: number;
    startHeight: number;
    originalTimeSlot: string;
    dateStr: string;
  } | null>(null);

  // Click to create task inline popup
  const [quickTaskSlot, setQuickTaskSlot] = useState<{
    dateStr: string;
    timeSlot: string;
    y: number;
  } | null>(null);

  // Drag-to-create state and conflict reference
  const [dragToCreate, setDragToCreate] = useState<{
    dateStr: string;
    startMin: number; // Y offset in pixels/minutes from 00:00 (midnight)
    currentMin: number;
    isDragging: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);

  // Ghost card state for drag-over preview (snapped to 30-min intervals)
  const [dragGhostState, setDragGhostState] = useState<{
    dayStr: string;
    snappedMin: number;   // top offset in px from midnight
    taskId: string;
    durationMin: number;  // estimated duration in minutes
  } | null>(null);
  const dragGhostTaskIdRef = useRef<string | null>(null);

  // Current time state for the green line indicator
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const handleMouseEnterCard = (e: React.MouseEvent<HTMLDivElement>, task: WorkspaceTask) => {
    if (!task.subtasks || task.subtasks.length === 0) return;
    if (popoverTimeoutRef.current) {
      clearTimeout(popoverTimeoutRef.current);
      popoverTimeoutRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPopoverState({
      task,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    });
  };

  const handleMouseLeaveCard = () => {
    if (popoverTimeoutRef.current) {
      clearTimeout(popoverTimeoutRef.current);
    }
    popoverTimeoutRef.current = setTimeout(() => {
      setPopoverState(null);
    }, 300);
  };

  const handlePopoverMouseEnter = () => {
    if (popoverTimeoutRef.current) {
      clearTimeout(popoverTimeoutRef.current);
      popoverTimeoutRef.current = null;
    }
  };

  const handlePopoverMouseLeave = () => {
    popoverTimeoutRef.current = setTimeout(() => {
      setPopoverState(null);
    }, 300);
  };

  // 1. Scan all markdown files for tasks
  const scanAllTasks = async () => {
    const noteFiles = notes.filter(n => n.type === 'note');
    const aggregated: WorkspaceTask[] = [];

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Notlar önceden tek tek, sırayla okunuyordu — büyük bir kasada, özellikle
    // Android'de (her dosya okuması native köprü üzerinden ayrı bir round-trip)
    // bu çok yavaş oluyordu. Tüm dosya okumaları artık PARALEL yapılıyor.
    const fileResults = await Promise.all(noteFiles.map(async (note) => {
      try {
        const content = await readNoteContent(note.path);
        return { note, content };
      } catch (err) {
        console.error('Notes task scan error in Calendar:', note.path, err);
        return null;
      }
    }));

    for (const fileResult of fileResults) {
      if (!fileResult) continue;
      const { note, content } = fileResult;
      try {
        if (!content) continue;

        // Parse note-level tags
        // BUG DÜZELTMESİ: ```mermaid gibi kod bloklarındaki "style X fill:#4a5568" satırları
        // sahte #etiket olarak algılanmasın diye taramadan önce kod blokları çıkarılır.
        const tagRegexGlobal = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
        const noteLevelTags: string[] = [];
        let noteTagMatch;
        const contentForTagScan = content.replace(/```[\s\S]*?```/g, '');
        while ((noteTagMatch = tagRegexGlobal.exec(contentForTagScan)) !== null) {
          const t = noteTagMatch[1].toLowerCase();
          if (t !== 'todo' && !noteLevelTags.includes(t)) {
            noteLevelTags.push(t);
          }
        }

        if (noteLevelTags.includes('no-calendar') || noteLevelTags.includes('exclude-calendar')) {
          continue;
        }

        const lines = content.split('\n');
        const noteTasks: WorkspaceTask[] = [];
        const parentStack: { indent: number; id: string }[] = [];

        lines.forEach((line, idx) => {
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

            // Standardize fallback: parse from capture timestamp [YYYY-MM-DD HH:mm]
            const timestampMatch = rawText.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]/);
            if (timestampMatch) {
              const tsDate = timestampMatch[1];
              const tsTime = timestampMatch[2];
              if (!dueDate) {
                dueDate = tsDate;
              }
              if (!timeSlot) {
                // Generate a 1-hour slot starting from tsTime
                const [hStr, mStr] = tsTime.split(':');
                const startHour = parseInt(hStr);
                const startMin = parseInt(mStr);
                
                let endHour = startHour + 1;
                let endMin = startMin;
                if (endHour >= 24) {
                  endHour = 23;
                  endMin = 59;
                }
                
                const formatTimeStr = (h: number, m: number) => {
                  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                };
                
                timeSlot = `${formatTimeStr(startHour, startMin)}-${formatTimeStr(endHour, endMin)}`;
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

            // Parse tags
            const tagRegex = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
            const taskTags: string[] = [];
            let tagMatch;
            while ((tagMatch = tagRegex.exec(rawText)) !== null) {
              taskTags.push(tagMatch[1].toLowerCase());
            }
            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            // İSTEK: kullanıcı proje etiketinin ("#borusan" gibi) görev metninde görünmesini
            // istemiyor. Yeni oluşturulan görevler artık görünmez [project:slug] köşeli parantez
            // etiketiyle işaretleniyor (bkz. CalendarView.tsx handleCreateQuickTask/handleEditTask).
            // Eski #slug etiketli notlarla geriye dönük uyumluluk için HER İKİSİ de taranır.
            const projectBracketRegex = /\[(?:project|proje|book|kitap):([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)\]/gi;
            let projTagMatch;
            while ((projTagMatch = projectBracketRegex.exec(rawText)) !== null) {
              taskTags.push(projTagMatch[1].toLowerCase());
            }

            // Calculate Score
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
              const diff = due.getTime() - now.getTime();
              const diffDays = Math.ceil(diff / (1000 * 60 * 60 * 24));
              if (diffDays < 0) score += 8;
              else if (diffDays === 0 || diffDays === 1) score += 5;
              else if (diffDays <= 7) score += 3;
              else score += 1;
            }

            const pathParts = note.path.split('/');
            const folderName = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : null;

            // Remove annotations from content to display neatly
            let cleanContent = stripQuestTags(rawText)
              .replace(/\[(?:priority|p):(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
              .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
              .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
              .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
              .replace(/\[(?:project|proje|book|kitap):[^\]]+\]/gi, '') // Görünmez proje bağlantısı — göreve eklenen ama gösterilmeyen etiket
              .replace(/\[status:(?:backlog|inprogress|review|blocked|done)\]/gi, '') // DevOps Kanban durumu — sadece Kanban tahtasında görünür
              .replace(/\[type:(?:bug|feature|chore)\]/gi, '') // DevOps iş tipi — sadece Kanban tahtasında görünür
              .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // Strip capture timestamp
              // BUG DÜZELTMESİ: Bazı eski notlarda stripQuestTags'in tanıdığı ASCII
              // "[baslangic:]"/"[tamamlanma:]" dışında, muhtemelen eski bir kod sürümünden
              // kalma "[başlama:...]" gibi TANINMAYAN, Türkçe yazımlı zaman etiketleri
              // yetim olarak kalıp ham köşeli-parantez metni olarak görev başlığında
              // görünüyordu ("can sıkıcı"). Etiket adı ne olursa olsun, ISO zaman damgası
              // BİÇİMİNDEKİ herhangi bir köşeli parantez etiketini genel olarak temizler.
              .replace(/\[[^\]:]+:\d{4}-\d{2}-\d{2}T[\d:.]+Z?\]/gi, '')
              // Çok günlü işlerde bir işe ikinci gün "devam edildiğinde" (bkz.
              // handleContinueTaskSession) eski gün/saat burada geçmiş kaydı olarak tutulur —
              // görev başlığında ham etiket olarak görünmesin.
              .replace(/\[session:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
              // Gelecekte planlanan ek oturumlar (bkz. handleAddPlanOccurrence) — kendi
              // kartlarında ayrıca render edilir, başlıkta ham etiket görünmesin.
              .replace(/\[plan:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}-\d{2}:\d{2})?\]/gi, '')
              .replace(/\s+/g, ' ')
              .trim();

            const questTags = parseQuestTags(rawText);
            const hasSessionHistory = /\[session:\d{4}-\d{2}-\d{2}/i.test(rawText);

            noteTasks.push({
              id: taskId,
              content: cleanContent,
              isChecked,
              lineIdx: idx,
              filePath: note.path,
              noteName: note.name,
              folderName,
              priority,
              dueDate,
              timeSlot,
              repeat,
              hasSessionHistory,
              score,
              tags: Array.from(new Set([...taskTags, ...noteLevelTags])),
              // BUG DÜZELTMESİ (kullanıcı geri bildirimi: müşteri filtresi ilgisiz görevleri
              // de gösteriyordu): `tags` notun TÜM içeriğindeki hashtag'leri (noteLevelTags)
              // her göreve miras bırakır — bu, "günün notunda birden fazla, FARKLI projeye
              // ait görev olabilir" senaryosunda proje/müşteri eşleştirmesini bozar (aynı
              // günlük nottaki BAŞKA bir görevin #proje-slug'ı, alakasız bir göreve de
              // sızar). `ownTags` SADECE bu görevin KENDİ satırındaki etiketleri tutar —
              // proje/müşteri filtreleme ve düzenleme modalındaki "hangi proje seçili"
              // tespiti bunu kullanır.
              ownTags: taskTags,
              isSubtask,
              parentTaskId,
              subtasks: [],
              questStartedAt: questTags.startedAt,
              questCompletedAt: questTags.completedAt,
              questOutcome: questTags.outcome
            });

            // BUG DÜZELTMESİ (kullanıcı geri bildirimi: "buralara girdiğim tasklar vardı
            // şimdi yok, efora bakarak giriyorum"): handleContinueTaskSession bir işe ikinci
            // günde devam edildiğinde eski günü [session:] etiketi olarak SAKLIYOR ama bu
            // etiket takvimde HİÇBİR YERDE render edilmiyordu — kullanıcı geçmiş güne bakınca
            // orada hiç iz kalmıyordu (efor/mesai takibi için kritikti). Her [session:] etiketi
            // için, kendi tarihinde salt-okunur ayrı bir blok üretilir (isSessionOccurrence).
            const sessionTagRegex = /\[session:(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}-\d{2}:\d{2}))?\]/gi;
            let sessionMatch;
            let sessionIdx = 0;
            while ((sessionMatch = sessionTagRegex.exec(rawText)) !== null) {
              sessionIdx++;
              noteTasks.push({
                id: `${taskId}::session::${sessionIdx}`,
                content: cleanContent,
                isChecked,
                lineIdx: idx,
                filePath: note.path,
                noteName: note.name,
                folderName,
                priority,
                dueDate: sessionMatch[1],
                timeSlot: sessionMatch[2] || '',
                repeat: '',
                score: 0,
                tags: Array.from(new Set([...taskTags, ...noteLevelTags])),
                ownTags: taskTags,
                isSubtask,
                parentTaskId,
                subtasks: [],
                isSessionOccurrence: true,
                // Bu günün GERÇEK başlangıç/bitişi ayrı tutulmuyor (yalnızca tek [started:]/
                // [completed:] ana satırda var, en son güne ait) — yanlış güne "iz düşüm"
                // gölgesi çizmemek için burada bilerek null bırakılır.
                questStartedAt: null,
                questCompletedAt: null,
                questOutcome: null
              });
            }

            // İSTEK ("önümdeki 3-4 sessionu planlama"): [plan:] etiketiyle işaretlenmiş,
            // henüz çalışılmamış GELECEK oturumlar — isSessionOccurrence'ın tersine tam
            // etkileşimli (sürüklenebilir/boyutlandırılabilir) ayrı kartlar olarak render
            // edilir; bkz. handleScheduleTask/handleUnscheduleTask'taki isPlanOccurrence
            // dallanması (kendi [plan:] etiketini bulup değiştirir/siler).
            const planTagRegex = /\[plan:(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}-\d{2}:\d{2}))?\]/gi;
            let planMatch;
            let planIdx = 0;
            while ((planMatch = planTagRegex.exec(rawText)) !== null) {
              planIdx++;
              noteTasks.push({
                id: `${taskId}::plan::${planIdx}`,
                content: cleanContent,
                isChecked,
                lineIdx: idx,
                filePath: note.path,
                noteName: note.name,
                folderName,
                priority,
                dueDate: planMatch[1],
                timeSlot: planMatch[2] || '',
                repeat: '',
                score: 0,
                tags: Array.from(new Set([...taskTags, ...noteLevelTags])),
                ownTags: taskTags,
                isSubtask,
                parentTaskId,
                subtasks: [],
                isPlanOccurrence: true,
                questStartedAt: null,
                questCompletedAt: null,
                questOutcome: null
              });
            }
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
                filePath: task.filePath,
                dueDate: task.dueDate,
                priority: task.priority
              });
            }
          }
        });

        aggregated.push(...noteTasks);
      } catch (err) {
        console.error('Notes task scan error in Calendar:', note.path, err);
      }
    }
    return aggregated;
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "notes" prop'u, App.tsx her arka plan yenilemesinde (odak/focus, kayıt
  // sonrası, senkron vb.) yeni bir dizi referansıyla geldiği için bu effect
  // sık sık yeniden tetikleniyordu. Yükleniyor animasyonunu yalnızca GERÇEK
  // ilk yüklemede gösteriyoruz; sonraki arka plan taramaları sessizce
  // (spinner göstermeden) güncelleniyor — "Planlanmamış Görevler" paneli artık
  // her senkronda yanıp sönmüyor.
  const hasScannedOnceRef = useRef(false);
  useEffect(() => {
    let active = true;
    if (!hasScannedOnceRef.current) {
      setLoading(true);
    }
    scanAllTasks().then(res => {
      if (active) {
        setTasks(res);
        setLoading(false);
        hasScannedOnceRef.current = true;
      }
    });
    return () => { active = false; };
  }, [notes, refreshTrigger]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: planlanan bir görevin başlangıcı VE bitişi geçtiği hâlde hiç başlatılmamışsa
  // (▶️'ye hiç basılmamış — questStartedAt yok), görev "Planlanmamış Görevler"e geri
  // düşsün — kullanıcı elle "planı kaldır" yapmak zorunda kalmadan. Bunun için sadece
  // PLANLANAN BAŞLANGIÇ saatini değil, bloğun TAMAMEN bitmiş olmasını (planlanan bitiş
  // saatini) bekliyoruz — "isOverdueToStart" (kartı turuncu yapan uyarı) kasıtlı olarak
  // daha erken tetiklenir, bu farklı ve daha temkinli bir eşik. handleUnscheduleTask ile
  // AYNI [due:]/[time:] temizleme mantığını kullanır, ama aynı dosyaya ait birden fazla
  // geciken görev varsa hepsini TEK okuma/yazma turunda işler (yarış durumu olmasın diye).
  const autoRevertedTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = Date.now();
    const isPlannedWindowPassed = (t: WorkspaceTask): boolean => {
      if (!t.dueDate || !t.timeSlot) return false;
      const endPart = t.timeSlot.split('-')[1];
      if (!endPart) return false;
      const [eh, em] = endPart.split(':').map(Number);
      if (isNaN(eh) || isNaN(em)) return false;
      const plannedEndMs = new Date(`${t.dueDate}T00:00:00`).setHours(eh, em, 0, 0);
      return now > plannedEndMs;
    };

    const overdueUnstarted = tasks.filter(t => {
      if (t.isExternal || t.isChecked || t.questStartedAt || !t.dueDate || !t.timeSlot) return false;
      // BUG DÜZELTMESİ (kullanıcı geri bildirimi: "26'da soluk iz var ama 28'de görevin
      // olmasını beklerdim yok"): [session:] geçmişi olan görev, kullanıcının aktif takip
      // ettiği çok günlü bir iştir — "unutulmuş, tek seferlik" görev değildir. Bunu da
      // sessizce plandan koparıp geri çekersek hem asıl kart hem de üstüne kurulu tüm
      // [session:] geçmişi görünürlüğünü kaybeder (bkz. isSessionOccurrence render'ı).
      if (t.hasSessionHistory) return false;
      if (autoRevertedTaskIdsRef.current.has(t.id)) return false;
      return isPlannedWindowPassed(t);
    });

    // İSTEK ("önümdeki 3-4 sessionu planlama"): geleceğe planlanmış ama hiç çalışılmadan
    // penceresi geçmiş [plan:] günleri de aynı mantıkla sessizce silinir — session geçmişinin
    // aksine bunlar zaten "gerçekleşmemiş", tutmanın bir anlamı yok (design kararı: ayrı bir
    // "kaçırıldı" kaydı tutulmuyor, basitlik için).
    const overduePlans = tasks.filter(t => {
      if (!t.isPlanOccurrence || t.isChecked) return false;
      if (autoRevertedTaskIdsRef.current.has(t.id)) return false;
      return isPlannedWindowPassed(t);
    });

    if (overdueUnstarted.length === 0 && overduePlans.length === 0) return;

    const byFile = new Map<string, { due: WorkspaceTask[]; plan: WorkspaceTask[] }>();
    overdueUnstarted.forEach(t => {
      autoRevertedTaskIdsRef.current.add(t.id);
      if (!byFile.has(t.filePath)) byFile.set(t.filePath, { due: [], plan: [] });
      byFile.get(t.filePath)!.due.push(t);
    });
    overduePlans.forEach(t => {
      autoRevertedTaskIdsRef.current.add(t.id);
      if (!byFile.has(t.filePath)) byFile.set(t.filePath, { due: [], plan: [] });
      byFile.get(t.filePath)!.plan.push(t);
    });

    (async () => {
      for (const [filePath, { due, plan }] of byFile) {
        try {
          const fileContent = await readNoteContent(filePath);
          const lines = fileContent.split('\n');
          due.forEach(t => {
            if (t.lineIdx >= 0 && t.lineIdx < lines.length) {
              lines[t.lineIdx] = lines[t.lineIdx]
                .replace(/\s*\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
                .replace(/\s*\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
                .replace(/\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '');
            }
          });
          plan.forEach(t => {
            if (t.lineIdx >= 0 && t.lineIdx < lines.length) {
              const planTag = t.timeSlot ? `[plan:${t.dueDate}T${t.timeSlot}]` : `[plan:${t.dueDate}]`;
              lines[t.lineIdx] = lines[t.lineIdx].replace(` ${planTag}`, '').replace(planTag, '');
            }
          });
          await onSaveNote(filePath, lines.join('\n'));
        } catch (err) {
          console.error('Error auto-reverting overdue unstarted tasks:', filePath, err);
        }
      }
      setRefreshTrigger(prev => prev + 1);
    })();
  }, [tasks]);

  // Handle Drag scheduling
  const handleScheduleTask = async (taskId: string, dateStr: string, timeSlot: string | null) => {
    let task = tasks.find(t => t.id === taskId);
    if (!task) {
      // Look inside subtasks of parent tasks
      for (const p of tasks) {
        if (p.subtasks) {
          const found = p.subtasks.find(s => s.id === taskId);
          if (found) {
            task = {
              id: found.id,
              content: found.content,
              isChecked: found.isChecked,
              lineIdx: found.lineIdx,
              filePath: found.filePath,
              noteName: p.noteName,
              folderName: p.folderName,
              priority: found.priority || 'low',
              dueDate: found.dueDate || '',
              timeSlot: '',
              repeat: '',
              score: 0,
              tags: [],
              ownTags: [],
              isSubtask: true,
              parentTaskId: p.id,
              questStartedAt: null,
      questCompletedAt: null,
              questOutcome: null
            };
            break;
          }
        }
      }
    }
    if (!task) return;

    // İSTEK ("önümdeki 3-4 sessionu planlama"): bir [plan:] kartını sürükleyip/boyutlandırıp
    // saatini değiştirmek, ana [due:]/[plannedtime:]'a DEĞİL, o kartın KENDİ [plan:ESKİ...]
    // etiketine dokunmalı — diğer plan günlerini ve asıl görevi etkilememeli.
    if (task.isPlanOccurrence) {
      try {
        const fileContent = await readNoteContent(task.filePath);
        const lines = fileContent.split('\n');
        if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

        const oldPlanTag = task.timeSlot ? `[plan:${task.dueDate}T${task.timeSlot}]` : `[plan:${task.dueDate}]`;
        const newPlanTag = timeSlot ? `[plan:${dateStr}T${timeSlot}]` : `[plan:${dateStr}]`;
        if (!lines[task.lineIdx].includes(oldPlanTag)) return;
        lines[task.lineIdx] = lines[task.lineIdx].replace(oldPlanTag, newPlanTag);
        await onSaveNote(task.filePath, lines.join('\n'));
        setRefreshTrigger(prev => prev + 1);
      } catch (err) {
        console.error('Error rescheduling plan occurrence:', err);
      }
      return;
    }

    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      const rawLine = lines[task.lineIdx];
      const lineBodyMatch = rawLine.match(/^(\s*[*\-]\s+\[[ xX/]\]\s+)(.*)$/);
      
      let cleanText = '';
      let prefix = '';
      if (lineBodyMatch) {
        prefix = lineBodyMatch[1];
        cleanText = lineBodyMatch[2]
          .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
          .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      } else {
        const match = rawLine.match(/^(\s*)/);
        prefix = match ? match[1] : '';
        cleanText = rawLine
          .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
          .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      let appendStr = ` [due:${dateStr}]`;
      if (timeSlot) {
        appendStr += ` [plannedtime:${timeSlot}]`;
      }

      lines[task.lineIdx] = `${prefix}${cleanText}${appendStr}`;

      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error scheduling task in Calendar:', err);
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Takvimdeki bir göreve çift tıklayınca açılan gerçek DÜZENLEME (bkz. activeSchedulingModal.
  // isEditMode) — handleScheduleTask'ten farkı: sadece tarih/saat değil, görev METNİNİ ve
  // PROJE etiketini de değiştirebilir. Satırdaki DİĞER etiketleri ([priority:], [repeat:], dakiklik
  // geçmişi vb.) olduğu gibi korur; yalnızca [due:]/[plannedtime:] her zaman yeniden yazılır
  // ve proje etiketi (varsa eskisini kaldırıp yenisini ekleyerek) güncellenir.
  const handleEditTask = async (
    taskId: string,
    newText: string,
    dateStr: string,
    timeSlot: string | null,
    newProjectSlug?: string
  ) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      const rawLine = lines[task.lineIdx];
      const lineBodyMatch = rawLine.match(/^(\s*[*\-]\s+\[[ xX\/]\]\s+)(.*)$/);
      let prefix = '';
      let body = rawLine;
      if (lineBodyMatch) {
        prefix = lineBodyMatch[1];
        body = lineBodyMatch[2];
      } else {
        const m = rawLine.match(/^(\s*)/);
        prefix = m ? m[1] : '';
        body = rawLine.slice(prefix.length);
      }

      // due/plannedtime HER ZAMAN tarih/saat alanlarından yeniden yazılır — diğer tüm köşeli
      // parantezli etiketler ([priority:], [repeat:], [started:], [completed:], [outcome:] vb.)
      // ham satırdan olduğu gibi korunur.
      let preservedBracketTags = (body.match(/\[[^\]]+\]/g) || [])
        .filter(tag => !/^\[due:/i.test(tag) && !/^\[(?:plannedtime|time|window):/i.test(tag));

      const oldProjectSlug = projectNames
        .map(n => n.toLocaleLowerCase('tr').replace(/\s+/g, '-'))
        .find(slug => task.ownTags.includes(slug));

      let editedText = newText.trim();
      if (oldProjectSlug && oldProjectSlug !== newProjectSlug) {
        editedText = editedText.replace(new RegExp(`#${oldProjectSlug}\\b`, 'i'), '').replace(/\s+/g, ' ').trim();
        preservedBracketTags = preservedBracketTags.filter(tag => !new RegExp(`^\\[(?:project|proje|book|kitap):${oldProjectSlug}\\]$`, 'i').test(tag));
      }
      if (newProjectSlug && !preservedBracketTags.some(tag => new RegExp(`^\\[(?:project|proje|book|kitap):${newProjectSlug}\\]$`, 'i').test(tag))) {
        preservedBracketTags.push(`[project:${newProjectSlug}]`);
      }

      let newBody = `${editedText} [due:${dateStr}]`;
      if (timeSlot) newBody += ` [plannedtime:${timeSlot}]`;
      if (preservedBracketTags.length) newBody += ` ${preservedBracketTags.join(' ')}`;

      lines[task.lineIdx] = `${prefix}${newBody}`;
      await onSaveNote(task.filePath, lines.join('\n'));
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error editing task:', err);
    }
  };

  // Helper to handle drop and show modal if task has subtasks
  const handleDropTask = (taskId: string, dateStr: string, timeSlot: string | null) => {
    let task = tasks.find(t => t.id === taskId);
    if (!task) {
      for (const p of tasks) {
        if (p.subtasks) {
          const found = p.subtasks.find(s => s.id === taskId);
          if (found) {
            task = {
              id: found.id,
              content: found.content,
              isChecked: found.isChecked,
              lineIdx: found.lineIdx,
              filePath: found.filePath,
              noteName: p.noteName,
              folderName: p.folderName,
              priority: found.priority || 'low',
              dueDate: found.dueDate || '',
              timeSlot: '',
              repeat: '',
              score: 0,
              tags: [],
              ownTags: [],
              isSubtask: true,
              parentTaskId: p.id,
              questStartedAt: null,
      questCompletedAt: null,
              questOutcome: null
            };
            break;
          }
        }
      }
    }
    if (!task) return;
    if (task.subtasks && task.subtasks.length > 0) {
      const savedChoice = localStorage.getItem('subtaskSchedulingChoice');
      if (savedChoice === 'group') {
        handleScheduleTask(taskId, dateStr, timeSlot);
        return;
      } else if (savedChoice === 'distribute') {
        handleDistributeSubtasks(task, dateStr, timeSlot);
        return;
      }
      setSchedulingModalData({
        task,
        dateStr,
        timeSlot: timeSlot || '09:00-10:00'
      });
    } else {
      handleScheduleTask(taskId, dateStr, timeSlot);
    }
  };

  // Distribute subtasks sequentially in 30-min consecutive slots
  const handleDistributeSubtasks = async (parentTask: WorkspaceTask, dateStr: string, startTimeSlot: string | null) => {
    try {
      const fileContent = await readNoteContent(parentTask.filePath);
      const lines = fileContent.split('\n');
      
      const startSlot = startTimeSlot || '09:00-09:30';
      const timeData = parseTime(startSlot);
      let currentStartMins = timeData ? (timeData.startHour * 60 + timeData.startMin) : 9 * 60;

      const formatTimeStr = (totalMins: number) => {
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };

      const subtasks = parentTask.subtasks || [];
      subtasks.forEach(sub => {
        if (sub.lineIdx < 0 || sub.lineIdx >= lines.length) return;
        const rawLine = lines[sub.lineIdx];
        
        const lineBodyMatch = rawLine.match(/^(\s*[*\-]\s+\[[ xX/]\]\s+)(.*)$/);
        
        let cleanText = '';
        let prefix = '';
        if (lineBodyMatch) {
          prefix = lineBodyMatch[1];
          cleanText = lineBodyMatch[2]
            .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
            .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        } else {
          const match = rawLine.match(/^(\s*)/);
          prefix = match ? match[1] : '';
          cleanText = rawLine
            .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
            .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        }

        const subTimeSlot = `${formatTimeStr(currentStartMins)}-${formatTimeStr(currentStartMins + 30)}`;
        currentStartMins += 30;

        let appendStr = ` [due:${dateStr}] [plannedtime:${subTimeSlot}]`;
        lines[sub.lineIdx] = `${prefix}${cleanText}${appendStr}`;
      });

      const newContent = lines.join('\n');
      await onSaveNote(parentTask.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error distributing subtasks:', err);
    }
  };

  // Unschedule: remove [due:...] and [plannedtime:...] tags from a task and its subtasks
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: takvimdeki gün başlığına (ör. "31 Temmuz") tıklayınca o günün günlük notu
  // açılsın. Not zaten varsa doğrudan açılır (onSelectDateNotes — App.tsx bunu isme göre
  // arar, günlük notların adı zaten YYYY-MM-DD olduğundan eşleşir); yoksa
  // onCreateDailyNote ile OLUŞTURULUP açılır — handleCreateDailyNote var olan bir notu
  // asla üzerine yazmaz (yalnızca dosya hiç yokken çağrılır), bu yüzden burada önce
  // notes listesinde arama yapıp hangisinin çağrılacağına karar veriyoruz.
  const handleOpenDailyNote = (dateStr: string) => {
    const cleanDate = dateStr.toLowerCase();
    const foundNote = notes.find(n => 
      n.type === 'note' && (
        n.name.toLowerCase() === cleanDate ||
        n.name.toLowerCase() === `${cleanDate}.md` ||
        n.name.toLowerCase().replace(/\.md$/, '') === cleanDate ||
        n.path.toLowerCase().endsWith(`/${cleanDate}.md`) ||
        n.path.toLowerCase().endsWith(`/${cleanDate}`)
      )
    );
    if (foundNote) {
      onSelectDateNotes(foundNote.name);
    } else {
      onCreateDailyNote(dateStr);
    }
  };

  // İSTEK (kullanıcı geri bildirimi: "bir taska başladım, bir oturumda çalıştım ama iş
  // bitmedi, bitti diye işaretlemem saçma ama ara verdiğimi de belirtmeliyim — planlanmamış
  // görevlerin orada dursun, sonraki güne tekrar atayabileyim"): göreve GERÇEKTEN
  // başlanmışsa (▶️'ye basılmış, questStartedAt var), takvimden "Planlanmamış Görevler"e
  // sürükleyip planı kaldırmak artık o oturumu SESSİZCE SİLMİYOR — [due:]/[plannedtime:]
  // bir [session:] geçmişi olarak satırda saklanıyor (checkbox'a dokunulmuyor, görev "Bitti"
  // olmuyor). Kullanıcı istediği zaman aynı isimle "Yeni Görev Ekle" ile tekrar planlayıp
  // devam edebilir (bkz. handleContinueTaskSession/findContinuableTask) — o zamana kadarki
  // çalışma kaybolmaz. Hiç başlanmamış bir görev sürüklenirse (sadece yanlışlıkla planlanmış)
  // eskisi gibi hiçbir iz bırakmadan temizlenir.
  const handleUnscheduleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Bir [plan:] kartını "Planlanmamış"a sürüklemek, o TEK günün planından vazgeçmek demek —
    // sadece kendi [plan:...] etiketi silinir, ana görev/checkbox/diğer plan günleri etkilenmez.
    if (task.isPlanOccurrence) {
      try {
        const fileContent = await readNoteContent(task.filePath);
        const lines = fileContent.split('\n');
        if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;
        const planTag = task.timeSlot ? `[plan:${task.dueDate}T${task.timeSlot}]` : `[plan:${task.dueDate}]`;
        lines[task.lineIdx] = lines[task.lineIdx].replace(` ${planTag}`, '').replace(planTag, '');
        await onSaveNote(task.filePath, lines.join('\n'));
        setRefreshTrigger(prev => prev + 1);
      } catch (err) {
        console.error('Error removing plan occurrence:', err);
      }
      return;
    }

    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');

      // Clear parent task
      if (task.lineIdx >= 0 && task.lineIdx < lines.length) {
        let newLine = lines[task.lineIdx];
        if (task.questStartedAt && task.dueDate) {
          // İSTEK (kullanıcı sorusu: "play'e bastım ama 5dk sonra vazgeçtim, başka taska
          // geçmek istedim, ne olur?"): PLANLANAN pencereyi değil, GERÇEKTEN geçen süreyi
          // ([started:] → şu an) [session:] olarak kaydeder — hem daha doğru bir efor kaydı
          // olur hem de anlamsız kısa "yanlış başlangıçlar" (birkaç dakika) hiç iz bırakmaz,
          // gerçek çalışmadan ayırt edilir.
          const MIN_MEANINGFUL_MINUTES = 5;
          const startedDate = new Date(task.questStartedAt);
          const now = new Date();
          const elapsedMinutes = (now.getTime() - startedDate.getTime()) / 60000;
          if (!isNaN(startedDate.getTime()) && elapsedMinutes >= MIN_MEANINGFUL_MINUTES) {
            const pad = (n: number) => String(n).padStart(2, '0');
            const sessionDate = `${startedDate.getFullYear()}-${pad(startedDate.getMonth() + 1)}-${pad(startedDate.getDate())}`;
            const startLabel = `${pad(startedDate.getHours())}:${pad(startedDate.getMinutes())}`;
            const endLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
            newLine = `${newLine} [session:${sessionDate}T${startLabel}-${endLabel}]`;
          }
          // 5 dakikadan az sürmüşse: "yanlışlıkla başlattım" sayılır, hiç [session:] eklenmez
          // — sadece aşağıda [started:] temizlenir, geri kalan (due/plannedtime) da silinir.
        }
        newLine = newLine
          .replace(/\s*\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
          .replace(/\s*\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
          .replace(/\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '');
        if (task.questStartedAt) {
          newLine = newLine.replace(/\s*\[(?:started|baslangic|başlangıç|başlama):[^\]]+\]/gi, '');
        }
        lines[task.lineIdx] = newLine;
      }

      // Clear all nested subtasks too
      const subtasks = task.subtasks || [];
      subtasks.forEach(sub => {
        if (sub.lineIdx >= 0 && sub.lineIdx < lines.length) {
          lines[sub.lineIdx] = lines[sub.lineIdx]
            .replace(/\s*\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
            .replace(/\s*\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
            .replace(/\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '');
        }
      });

      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error unscheduling task:', err);
    }
  };

  // Toggle checklist checkbox
  const handleToggleTodo = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      const rawLine = lines[task.lineIdx];
      const match = rawLine.match(/^(\s*[*\-]\s+\[)([ xX/])(\]\s*.*)$/);
      if (!match) return;

      const prefix = match[1];
      const currentStatus = match[2];
      const suffix = match[3];

      const newStatus = currentStatus.toLowerCase() === 'x' ? ' ' : 'x';
      lines[task.lineIdx] = `${prefix}${newStatus}${suffix}`;

      if (newStatus === 'x') {
        const questReward = applyCompletionToLine(lines[task.lineIdx]);
        if (questReward) {
          lines[task.lineIdx] = questReward.newLine;
          // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
          // "Boşluğu doldur" önerisinin tespiti/uygulaması artık BURADA değil, App.tsx'te
          // (applyQuestRewardToState) — çünkü görev tamamlama Takvim dışında da (Görev Havuzu,
          // not içi checkbox) olabiliyordu ve öneri sadece Takvim'den tamamlananlarda çıkıyordu.
          // App.tsx tüm tamamlama yollarının ortak atası, oradan HER yerden tetiklenir.
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

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // TasksView.tsx'teki handleStartQuest ile AYNI mantık — Takvim kartından tek tıkla
  // başlatabilmek için (önceden yalnızca Görev Havuzu'nun detay çekmecesinde vardı, kullanıcı
  // her seferinde oraya gitmek zorunda kalıyordu).
  //
  // Geç başlama bilgilendirmesi: planlanan başlangıç saati çoktan geçmişse (kullanıcı geç
  // "Başla" demişse) skoru ETKİLEMİYORUZ — sonuç (ne zaman bitirdiği) zaten dakiklik skorunu
  // belirliyor, geç başlayıp hızlı bitirmek gerçek bir başarı sayılmalı. Ama kullanıcı bunu
  // FARK ETSİN diye kısa, cezalandırıcı olmayan bir bilgi notu gösteriyoruz — bitiş saatinin
  // SABİT kaldığını (kısalan pencereyi) hatırlatır.
  const handleStartTaskFromCalendar = async (task: WorkspaceTask) => {
    try {
      const content = await readNoteContent(task.filePath);
      const lines = content.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;
      const newLine = applyQuestStartToLine(lines[task.lineIdx]);
      if (!newLine) return;
      lines[task.lineIdx] = newLine;

      const timeData = task.timeSlot ? parseTime(task.timeSlot) : null;
      if (timeData) {
        const plannedStartMin = timeData.startHour * 60 + timeData.startMin;
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const lateByMin = nowMin - plannedStartMin;
        if (lateByMin >= 5) {
          setLateStartNotice({ taskContent: task.content, lateByMin });
          setTimeout(() => setLateStartNotice(null), 4000);
        }
      }

      await onSaveNote(task.filePath, lines.join('\n'));
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error starting task from calendar:', err);
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // datetime-local input'u YYYY-MM-DDTHH:mm biçiminde, YEREL saatte bir string bekler/döner
  // (saniye/milisaniye taşımaz) — ISO damgalarla (UTC) arasında iki yönlü çeviri gerekir.
  const isoToLocalInputValue = (iso: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const localInputValueToIso = (val: string): string | null => {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  const handleOpenEditTimes = (task: WorkspaceTask) => {
    setEditingTimesTask(task);
    setEditStartLocal(isoToLocalInputValue(task.questStartedAt));
    setEditCompletedLocal(isoToLocalInputValue(task.questCompletedAt));
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Skor bir EMA (hareketli ortalama) olduğu için, yanlış bir zamanla verilen ESKİ puanı
  // matematiksel olarak tam geri almak mümkün değil — bunun yerine düzeltilmiş zamanlarla
  // YENİ bir puan uygulanır, EMA'nın doğası gereği eski (yanlış) etkisi zamanla söner. Bu,
  // kusursuz bir defter tutmaktan daha basit ve "esnek/basit olsun" isteğine daha uygun.
  const handleSaveEditedTimes = async () => {
    if (!editingTimesTask) return;
    const task = editingTimesTask;
    try {
      const content = await readNoteContent(task.filePath);
      const lines = content.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) { setEditingTimesTask(null); return; }

      const newStartedAt = localInputValueToIso(editStartLocal);
      const newCompletedAt = localInputValueToIso(editCompletedLocal);
      const result = applyManualTimeEditToLine(lines[task.lineIdx], newStartedAt, newCompletedAt);
      lines[task.lineIdx] = result.newLine;

      if (result.outcome && result.outcomeScore !== null) {
        onQuestReward?.({
          newLine: result.newLine,
          outcome: result.outcome,
          outcomeScore: result.outcomeScore,
          completedAt: newCompletedAt || new Date().toISOString(),
          gapMinutes: 0,
          dueDate: null,
          plannedEndAbsMin: null
        });
      }

      await onSaveNote(task.filePath, lines.join('\n'));
      setRefreshTrigger(prev => prev + 1);
      setEditingTimesTask(null);
    } catch (err) {
      console.error('Zamanlar güncellenemedi:', err);
    }
  };

  // Click to create scheduled task
  // İSTEK (kullanıcı geri bildirimi: "bir taska çalışıyorum bitmiyor ertesi gün devam
  // ediyorum, aynı isimle tekrar eklediğimde iki ayrı task oluyor"): Aynı isim + aynı proje
  // ile HÂLÂ AÇIK (işaretlenmemiş) bir görev varsa, yeni bir satır açmak yerine
  // handleContinueTaskSession çağrılır — eski gün/saat [session:] etiketi olarak satırın
  // sonuna eklenir (geçmiş kaybolmaz), [due:]/[plannedtime:] YENİ güne taşınır. Böylece
  // Kanban'da hep TEK kart kalır, dakiklik hesabı son (gerçek) tamamlanma anına göre yapılır.
  const findContinuableTask = (content: string, projectSlug?: string): WorkspaceTask | undefined => {
    const trimmed = content.trim().toLowerCase();
    return tasks.find(t =>
      // BUG DÜZELTMESİ (kullanıcı geri bildirimi: "aynı isimle ekledim yine de yeni kart
      // açtı"): görev kullanıcı tarafından değil, SİSTEM tarafından (otomatik-geç-kapatma /
      // overdue-auto-revert mekanizması) [outcome:incomplete] ile zorla kapatılmış olabilir —
      // bu gerçek bir tamamlanma değildir, kullanıcı hâlâ o işe devam ediyor demektir. Böyle
      // bir görev de "devam edilebilir" sayılır (aşağıda handleContinueTaskSession checkbox'ı
      // yeniden açar).
      (!t.isChecked || t.questOutcome === 'incomplete') &&
      !t.isExternal &&
      !t.isSubtask &&
      t.content.trim().toLowerCase() === trimmed &&
      (projectSlug ? t.ownTags.includes(projectSlug.toLowerCase()) : true)
    );
  };

  const handleContinueTaskSession = async (task: WorkspaceTask, dateStr: string, timeSlot: string | null) => {
    // Aynı güne (aynı [due:]) tekrar planlanıyorsa bu zaten mevcut olan planlama akışı —
    // yeni bir oturum değil, saatin güncellenmesi.
    if (task.dueDate === dateStr) {
      await handleScheduleTask(task.id, dateStr, timeSlot);
      return;
    }
    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      let newLine = lines[task.lineIdx];

      // Sistem tarafından "incomplete" diye kapatılmış görev yeniden açılıyor: checkbox'ı
      // boşalt, gerçek olmayan [completed:]/[outcome:] damgalarını temizle — kullanıcı devam
      // ettiğine göre bu satır artık gerçekten bitmiş değil.
      if (task.isChecked && task.questOutcome === 'incomplete') {
        newLine = newLine
          .replace(/^(\s*[*\-]\s+\[)[xX](\])/, '$1 $2')
          .replace(/\s*\[(?:completed|tamamlanma):[^\]]+\]/gi, '')
          .replace(/\s*\[(?:outcome|dakiklik):[^\]]+\]/gi, '')
          // Eski [started:] yeni oturumun planlanan penceresinden ÖNCEKİ bir ana ait —
          // dakiklik hesabını bozmasın diye temizlenir; kullanıcı ▶️'ye tekrar basınca
          // gerçek (yeni) başlangıç anı yazılacak.
          .replace(/\s*\[(?:started|baslangic|başlangıç|başlama):[^\]]+\]/gi, '');
      }

      if (task.dueDate) {
        const oldSession = task.timeSlot
          ? `[session:${task.dueDate}T${task.timeSlot}]`
          : `[session:${task.dueDate}]`;
        newLine = `${newLine} ${oldSession}`;
      }
      newLine = newLine
        .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
        .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      newLine += ` [due:${dateStr}]`;
      if (timeSlot) newLine += ` [plannedtime:${timeSlot}]`;

      lines[task.lineIdx] = newLine;
      await onSaveNote(task.filePath, lines.join('\n'));
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error continuing task session in Calendar:', err);
    }
  };

  // İSTEK ("önümdeki 3-4 sessionu planlama"): mevcut [due:]/[plannedtime:]'a DOKUNMADAN,
  // aynı satıra ek bir [plan:TARİH THH:MM-HH:MM] etiketi ekler — "bu güne TAŞI" (devam et)
  // ile "bu güne DE EKLE" (ek gelecek oturum) farklı şeylerdir, bkz. modal'daki
  // "keepExistingPlan" seçeneği.
  const handleAddPlanOccurrence = async (task: WorkspaceTask, dateStr: string, timeSlot: string | null) => {
    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;
      const planTag = timeSlot ? `[plan:${dateStr}T${timeSlot}]` : `[plan:${dateStr}]`;
      lines[task.lineIdx] = `${lines[task.lineIdx]} ${planTag}`;
      await onSaveNote(task.filePath, lines.join('\n'));
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error adding future plan occurrence:', err);
    }
  };

  const handleCreateQuickTask = async (content: string, dateStr: string, timeSlot: string | null, projectSlug?: string, keepExistingPlan?: boolean) => {
    const continuable = findContinuableTask(content, projectSlug);
    if (continuable) {
      if (keepExistingPlan) {
        await handleAddPlanOccurrence(continuable, dateStr, timeSlot);
        return;
      }
      await handleContinueTaskSession(continuable, dateStr, timeSlot);
      return;
    }
    const folder = 'Günlükler';
    const noteName = dateStr;
    const filename = `${noteName}.md`;
    const relativePath = `${folder}/${filename}`;

    try {
      let existingContent = '';
      try {
        existingContent = await readNoteContent(relativePath);
      } catch (e) {
        // Parse dateStr back to Date object for nice display in daily note header
        let parsedDate = new Date();
        const dateParts = dateStr.split('-');
        if (dateParts.length === 3) {
          parsedDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
        }
        const formattedDate = parsedDate.toLocaleDateString('tr-TR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        existingContent = `# Günlük Günce: ${formattedDate}\n\nBugünün Logları:\n`;
      }

      let taskLine = `\n- [ ] ${content} [due:${dateStr}]`;
      if (timeSlot) {
        taskLine += ` [plannedtime:${timeSlot}]`;
      }
      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Görev fiziksel olarak SADECE günün notuna yazılır (kullanıcının sevdiği yapı korunur) —
      // ama bir proje seçildiyse satıra GÖRÜNMEZ [proje:slug] köşeli parantez etiketi eklenir
      // (kullanıcı isteği: görünür "#proje-slug" hashtag'i görev adını kirletmesin). Proje notu
      // (bkz. ProjectsView.tsx getProjectProgress/currentProjectTasks) bu etiketi canlı olarak
      // sorgulayıp aynı satırı sayar, fiziksel ikinci bir kopya oluşturulmaz.
      if (projectSlug) {
        taskLine += ` [project:${projectSlug}]`;
      }

      await onSaveNote(relativePath, existingContent + taskLine);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error creating calendar click task:', err);
    }
  };

  // Dynamic Event Resizing hook
  useEffect(() => {
    if (!resizingEvent) return;

    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
    // Yükseklik piksel cinsinden doğrudan dakikaya karşılık gelir (1px = 1dk).
    // ÖNEMLİ: Süreyi (duration) 15'e yuvarlamak yeterli değil — görev
    // başlangıcı zaten 15'in katı değilse (örn. 20:07), bitiş de "temiz"
    // görünmez ve kullanıcıya snap hiç olmamış gibi gelir. Bunun yerine
    // BİTİŞ SAATİNİ (mutlak, gece yarısından itibaren dakika) en yakın
    // 15 dakikalık takvim çizgisine (:00/:15/:30/:45) yapıştırıyoruz —
    // Google Calendar tarzı standart "grid snap" davranışı. Bunu hem
    // sürüklerken hem bırakırken aynı formülle uyguluyoruz ki önizleme
    // ile sonuç arasında sıçrama olmasın.
    const SNAP_MINUTES = 15;
    const timeDataForSnap = parseTime(resizingEvent.originalTimeSlot);
    const startMinutesAbs = timeDataForSnap ? timeDataForSnap.startHour * 60 + timeDataForSnap.startMin : 0;

    // rawHeightMin: sürükleme sırasında GERÇEK dakika cinsinden ham süre (zoom'dan
    // bağımsız — pxToMin ile px'ten dakikaya çevrilmiş).
    // Geri dönüş: snap'lenmiş MUTLAK bitiş dakikası (gece yarısından itibaren).
    const snapEndAbsMinutes = (rawHeightMin: number) => {
      const rawEndAbs = startMinutesAbs + rawHeightMin;
      const snappedEndAbs = Math.round(rawEndAbs / SNAP_MINUTES) * SNAP_MINUTES;
      return Math.max(startMinutesAbs + SNAP_MINUTES, snappedEndAbs); // en az 15 dk süre
    };

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizingEvent.startY;
      const rawHeightPx = Math.max(30 * zoomLevel, resizingEvent.startHeight + deltaY);
      const snappedEndAbs = snapEndAbsMinutes(pxToMin(rawHeightPx));
      const newHeightMin = snappedEndAbs - startMinutesAbs;

      setTempEventHeights(prev => ({
        ...prev,
        [resizingEvent.taskId]: minToPx(newHeightMin)
      }));
    };

    const handleMouseUp = async (e: MouseEvent) => {
      const deltaY = e.clientY - resizingEvent.startY;
      const finalHeightPx = Math.max(30 * zoomLevel, resizingEvent.startHeight + deltaY);
      const newEndMinutes = snapEndAbsMinutes(pxToMin(finalHeightPx)); // mutlak, 15 dk çizgisine yapışık

      const timeData = timeDataForSnap;
      if (timeData) {
        const newEndHour = Math.floor(newEndMinutes / 60);
        const newEndMin = newEndMinutes % 60;
        
        const formatTimeStr = (h: number, m: number) => {
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };
        
        const newTimeSlot = `${formatTimeStr(timeData.startHour, timeData.startMin)}-${formatTimeStr(newEndHour, newEndMin)}`;
        
        await handleScheduleTask(resizingEvent.taskId, resizingEvent.dateStr, newTimeSlot);
      }

      setResizingEvent(null);
      setTempEventHeights({});
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingEvent, zoomLevel]);

  // Dynamic Drag-to-Create hook
  useEffect(() => {
    if (!dragToCreate) return;

    const handleMouseMove = (e: MouseEvent) => {
      const colEl = document.querySelector(`[data-day-col="${dragToCreate.dateStr}"]`);
      if (!colEl) return;
      const rect = colEl.getBoundingClientRect();
      const currentY = e.clientY - rect.top;
      const currentMin = Math.max(0, Math.min(1440, pxToMin(currentY)));

      const diff = Math.abs(currentY - minToPx(dragToCreate.startMin));
      const isDragging = diff > 5 || dragToCreate.isDragging;

      setDragToCreate(prev => prev ? {
        ...prev,
        currentMin,
        isDragging
      } : null);
    };

    const handleMouseUp = () => {
      if (dragToCreate.isDragging) {
        const minA = dragToCreate.startMin;
        const minB = dragToCreate.currentMin;

        // dragToCreate.startMin/currentMin zaten GERÇEK dakika (zoom'dan bağımsız).
        const startAbsMin = Math.min(minA, minB);
        const endAbsMin = Math.max(minA, minB);

        // Round to nearest 15-minute intervals
        const roundedStartAbsMin = Math.round(startAbsMin / 15) * 15;
        const roundedEndAbsMin = Math.round(endAbsMin / 15) * 15;

        // Make sure duration is at least 15 mins
        let finalStartAbsMin = roundedStartAbsMin;
        let finalEndAbsMin = roundedEndAbsMin;
        if (finalEndAbsMin - finalStartAbsMin < 15) {
          finalEndAbsMin = finalStartAbsMin + 15;
        }

        // Clip to maximum allowed bounds (24:00 = 1440 absolute minutes)
        if (finalEndAbsMin > 24 * 60) {
          finalEndAbsMin = 24 * 60;
          if (finalEndAbsMin - finalStartAbsMin < 15) {
            finalStartAbsMin = finalEndAbsMin - 15;
          }
        }

        const formatTimeStr = (totalMins: number) => {
          const h = Math.floor(totalMins / 60);
          const m = totalMins % 60;
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        setActiveSchedulingModal({
          taskName: '',
          dateStr: dragToCreate.dateStr,
          startTime: formatTimeStr(finalStartAbsMin),
          endTime: formatTimeStr(finalEndAbsMin),
          projectTag: '',
          isEditMode: false
        });

        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 50);
      }

      setDragToCreate(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragToCreate, zoomLevel]);

  // Navigate dates based on active view mode
  const handleNext = () => {
    if (viewMode === 'month') setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === 'week') setCurrentDate(addWeeks(currentDate, 1));
    else if (viewMode === 'threeDay') setCurrentDate(addDays(currentDate, 3));
    else setCurrentDate(addDays(currentDate, 1));
    setQuickTaskSlot(null);
  };

  const handlePrev = () => {
    if (viewMode === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === 'week') setCurrentDate(subWeeks(currentDate, 1));
    else if (viewMode === 'threeDay') setCurrentDate(subDays(currentDate, 3));
    else setCurrentDate(subDays(currentDate, 1));
    setQuickTaskSlot(null);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setQuickTaskSlot(null);
  };

  // Helper to parse "HH:mm-HH:mm" time string
  const parseTime = (timeStr: string) => {
    const match = timeStr.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (match) {
      const startHour = parseInt(match[1]);
      const startMin = parseInt(match[2]);
      const endHour = parseInt(match[3]);
      const endMin = parseInt(match[4]);
      return { startHour, startMin, endHour, endMin };
    }
    return null;
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bir görevi sürükleyip yeni bir zamana taşırken KENDİ orijinal süresini
  // (ör. 3 saatlik bir görev 3 saatlik kalmalı) korumak için kullanılır.
  // timeSlot'u yoksa veya bozuksa güvenli varsayılanlara (alt görev: 30dk,
  // normal görev: 60dk) düşer.
  const getTaskDurationMinutes = (task: WorkspaceTask | undefined | null): number => {
    if (task?.timeSlot) {
      const t = parseTime(task.timeSlot);
      if (t) {
        const startAbs = t.startHour * 60 + t.startMin;
        const endAbs = t.endHour * 60 + t.endMin;
        if (endAbs > startAbs) return endAbs - startAbs;
      }
    }
    return task?.isSubtask ? 30 : 60;
  };

  // Filter tasks based on schedule status
  const unscheduledTasks = tasks.filter(t => {
    if (t.isSubtask) return false; // Subtasks are nested, not top-level

    // Tamamlanmış görevler "Planlanmamış Görevler" panelinde gösterilmez.
    if (t.isChecked) return false;

    // Müşteri filtresi seçiliyse, o müşteriye ait olmayan görevleri gizle.
    if (!taskMatchesClientFilter(t)) return false;

    // Check if task should be skipped/excluded from unplanned list
    const hasExcludeTag = t.tags && (
      t.tags.includes('no-unplanned') ||
      t.tags.includes('exclude-unplanned') ||
      t.tags.includes('hide-unplanned')
    );
    if (hasExcludeTag) return false;

    if (t.subtasks && t.subtasks.length > 0) {
      // Main task with subtasks: show it if it itself has no dueDate AND it has at least one
      // unscheduled VE tamamlanmamış alt görevi varsa.
      const hasUnscheduledSubs = t.subtasks.some(sub => !sub.dueDate && !sub.isChecked);
      return !t.dueDate && hasUnscheduledSubs;
    }

    // Regular task without subtasks: show if not scheduled
    return !t.dueDate;
  });
  
  // Calendar Dates ranges calculations
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const monthDays = eachDayOfInterval({ start: startDate, end: endDate });

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(currentDate, { weekStartsOn: 1 }) });

  const threeDays = [currentDate, addDays(currentDate, 1), addDays(currentDate, 2)];
  const singleDay = [currentDate];

  const activeDaysList = 
    viewMode === 'month' ? monthDays :
    viewMode === 'week' ? weekDays :
    viewMode === 'threeDay' ? threeDays :
    singleDay;

  // Active Date header display text
  const getHeaderDateLabel = () => {
    if (viewMode === 'month') return format(currentDate, 'MMMM yyyy', { locale: tr });
    if (viewMode === 'day') return format(currentDate, 'd MMMM yyyy', { locale: tr });
    
    const firstDay = activeDaysList[0];
    const lastDay = activeDaysList[activeDaysList.length - 1];
    
    if (firstDay && lastDay) {
      if (firstDay.getMonth() === lastDay.getMonth()) {
        return `${format(firstDay, 'd')} - ${format(lastDay, 'd MMMM yyyy', { locale: tr })}`;
      }
      return `${format(firstDay, 'd MMMM', { locale: tr })} - ${format(lastDay, 'd MMMM yyyy', { locale: tr })}`;
    }
    return '';
  };

  // Handle clicking on an hourly grid slot to open popup
  const handleSlotClick = (e: React.MouseEvent<HTMLDivElement>, dayDate: Date) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;

    // Izgara 00:00-24:00 aralığına yayılır; px -> dakika dönüşümü zoom seviyesine göre yapılır.
    const startMinutes = pxToMin(mouseY);
    const roundedMinutes = Math.round(startMinutes / 15) * 15; // 15 dk'lık çizgiye yapış (diğer akışlarla tutarlı)
    
    const startHour = Math.floor(roundedMinutes / 60);
    const startMin = roundedMinutes % 60;
    const endHour = Math.floor((roundedMinutes + 60) / 60);
    const endMin = (roundedMinutes + 60) % 60;
    
    const formatTimeStr = (h: number, m: number) => {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    
    const timeSlot = `${formatTimeStr(startHour, startMin)}-${formatTimeStr(endHour, endMin)}`;
    const dateStr = format(dayDate, 'yyyy-MM-dd');
    
    setActiveSchedulingModal({
      taskName: '',
      dateStr,
      startTime: formatTimeStr(startHour, startMin),
      endTime: formatTimeStr(endHour, endMin),
      projectTag: '',
      isEditMode: false
    });
    setCurrentDate(dayDate);
  };

  // İSTEK ("sağ tıklayarak açılan bir modalda Yeni Task / Kitap Oku seçenekleri"): sağ
  // tıklanan saat/gün bilgisini handleSlotClick ile AYNI şekilde hesaplar, ama modalı hemen
  // açmak yerine küçük bir bağlam menüsü gösterir — "Yeni Task" seçilirse zaten var olan
  // akışa (activeSchedulingModal) devam eder, "Kitap Oku" seçilirse kitap seçim popup'ı açılır.
  const [calendarContextMenu, setCalendarContextMenu] = useState<{
    x: number; y: number; dateStr: string; startTime: string; endTime: string; dayDate: Date; showBookPicker: boolean;
  } | null>(null);

  const handleSlotContextMenu = (e: React.MouseEvent<HTMLDivElement>, dayDate: Date) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const startMinutes = pxToMin(mouseY);
    const roundedMinutes = Math.round(startMinutes / 15) * 15;
    const startHour = Math.floor(roundedMinutes / 60);
    const startMin = roundedMinutes % 60;
    const endHour = Math.floor((roundedMinutes + 60) / 60);
    const endMin = (roundedMinutes + 60) % 60;
    const formatTimeStr = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    setCalendarContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 220),
      dateStr: format(dayDate, 'yyyy-MM-dd'),
      startTime: formatTimeStr(startHour, startMin),
      endTime: formatTimeStr(endHour, endMin),
      dayDate,
      showBookPicker: false
    });
  };

  // "Kitap Oku" ile bir kitap seçilince, o kitabın HENÜZ İŞARETLENMEMİŞ ilk "Mütalaa"
  // (okuma) görevini bulup (bölüm dosya adına göre sıralı — bkz. LibraryView.tsx
  // getBookChapters ile AYNI sıralama) sağ tıklanan tarih/saate planlar. Var olan
  // handleScheduleTask zaten [due:]/[plannedtime:] yazma işini doğru yapıyor — burada sadece
  // "hangi görev" sorusuna cevap veriliyor.
  const handlePickBookForReading = async (bookTitle: string) => {
    if (!calendarContextMenu) return;
    const bookSlug = bookTitle.toLocaleLowerCase('tr').replace(/\s+/g, '-');
    const candidates = tasks
      .filter(t => !t.isChecked && !t.isSessionOccurrence && !t.isPlanOccurrence && t.ownTags.includes(bookSlug) && /mütalaa/i.test(t.content))
      .sort((a, b) => a.noteName.localeCompare(b.noteName, 'tr', { numeric: true }));
    const next = candidates[0];
    if (!next) {
      alert(`"${bookTitle}" kitabında bekleyen bir bölüm bulunamadı. Önce Kütüphane'den bir bölüm ekle.`);
      setCalendarContextMenu(null);
      return;
    }
    await handleScheduleTask(next.id, calendarContextMenu.dateStr, `${calendarContextMenu.startTime}-${calendarContextMenu.endTime}`);
    setCalendarContextMenu(null);
  };

  return (
    <div className={`calendar-workspace-layout animate-fade ${embedded ? 'embedded' : ''}`}>
      {isUnplannedOpen && (
        <div 
          className="drawer-overlay visible-mobile" 
          onClick={() => setIsUnplannedOpen(false)}
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
      {/* 1. Left Section: Main Calendar Workspace */}
      <div className="calendar-main-panel">

        {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            Geç başlama bilgi notu — cezalandırıcı değil, sadece bitiş saatinin sabit kaldığını
            (yani penceresinin kısaldığını) hatırlatır. 4 saniye sonra kendiliğinden kaybolur. */}
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

        {/* Header Bar */}
        <div className="calendar-workspace-header">
          <div className="calendar-header-left">
            <CalIcon size={22} className="text-accent" />
            <h2>{getHeaderDateLabel()}</h2>
            <div className="calendar-nav-buttons">
              <button className="btn-nav" onClick={handlePrev} title="Geri">
                <ChevronLeft size={16} />
              </button>
              <button className="btn-nav today" onClick={handleToday}>Bugün</button>
              <button className="btn-nav" onClick={handleNext} title="İleri">
                <ChevronRight size={16} />
              </button>
            </div>
            {!embedded && <button
              type="button"
              className="btn-unplanned-toggle visible-mobile"
              onClick={() => setIsUnplannedOpen(!isUnplannedOpen)}
              style={{
                background: 'var(--accent-glow)',
                color: 'var(--accent-color)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
                alignItems: 'center',
                gap: '6px',
                marginLeft: '8px'
              }}
            >
              <span>Planlanmamış</span>
              <span style={{ background: 'var(--accent-color)', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '9px', lineHeight: 1 }}>
                {unscheduledTasks.length}
              </span>
            </button>}
          </div>

          {/* View Switcher Segmented Control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!embedded && <button
              onClick={() => setIsSyncModalOpen(true)}
              style={{
                background: 'rgba(99, 102, 241, 0.1)',
                color: 'var(--accent-color)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11.5px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s'
              }}
              title="Dış Takvim Eşitle (Google / Outlook)"
            >
              📅 Takvim Bağla
            </button>}

            {!embedded && <div className="calendar-view-toggle">
              <button 
                type="button" 
                className={`toggle-btn ${viewMode === 'month' ? 'active' : ''}`}
                onClick={() => { setViewMode('month'); setQuickTaskSlot(null); }}
              >
                Aylık
              </button>
              <button 
                type="button" 
                className={`toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
                onClick={() => { setViewMode('week'); setQuickTaskSlot(null); }}
              >
                Haftalık
              </button>
              <button 
                type="button" 
                className={`toggle-btn ${viewMode === 'threeDay' ? 'active' : ''}`}
                onClick={() => { setViewMode('threeDay'); setQuickTaskSlot(null); }}
              >
                3 Günlük
              </button>
              <button 
                type="button" 
                className={`toggle-btn ${viewMode === 'day' ? 'active' : ''}`}
                onClick={() => { setViewMode('day'); setQuickTaskSlot(null); }}
              >
                Günlük
              </button>
            </div>}
            {viewMode !== 'month' && (
              // İSTEK: Ctrl+tekerlek zoom sırasında hangi ölçekte olduğunuzu net görmeniz için —
              // tıklayınca %100'e (varsayılan saat yüksekliğine) sıfırlar.
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                title="Zaman ölçeğini sıfırla (Ctrl+fare tekerleği ile yakınlaştır/uzaklaştır)"
                style={{
                  marginLeft: '8px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: zoomLevel !== 1 ? 'var(--bg-hover)' : 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  cursor: 'pointer'
                }}
              >
                🔍 {Math.round(zoomLevel * 100)}%
              </button>
            )}
            {clientNames.length > 0 && (
              <div style={{ position: 'relative', display: 'inline-block', marginLeft: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsClientFilterOpen(prev => !prev)}
                  title="Müşteriye göre filtrele (Çoklu Seçim)"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: selectedClientFilters.length > 0 ? 'var(--accent-color)' : 'var(--bg-secondary)',
                    color: selectedClientFilters.length > 0 ? '#fff' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Building2 size={13} />
                  <span>
                    {selectedClientFilters.length === 0
                      ? 'Tümü'
                      : (selectedClientFilters.length === 1
                          ? selectedClientFilters[0]
                          : `${selectedClientFilters.length} Müşteri`)}
                  </span>
                  <ChevronDown size={12} style={{ opacity: 0.7, transform: isClientFilterOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {isClientFilterOpen && (
                  <>
                    <div
                      onClick={() => setIsClientFilterOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                    />
                    <div
                      className="context-menu-container"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '6px',
                        minWidth: '220px',
                        maxWidth: '280px',
                        zIndex: 9999,
                        background: '#18181b',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '10px',
                        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7)',
                        padding: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 6px 4px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Müşteriler
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedClientFilters([...clientNames])}
                            style={{ background: 'transparent', border: 'none', color: 'var(--accent-color, #60a5fa)', fontSize: '10px', cursor: 'pointer', fontWeight: '600' }}
                          >
                            Tümünü Seç
                          </button>
                          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px' }}>|</span>
                          <button
                            type="button"
                            onClick={() => setSelectedClientFilters([])}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer' }}
                          >
                            Temizle
                          </button>
                        </div>
                      </div>

                      <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {clientNames.map(name => {
                          const isChecked = selectedClientFilters.includes(name);
                          return (
                            <div
                              key={name}
                              onClick={() => toggleClientFilter(name)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                background: isChecked ? 'rgba(255,255,255,0.08)' : 'transparent',
                                fontSize: '12px',
                                color: isChecked ? '#fff' : 'var(--text-secondary)',
                                transition: 'background 0.15s',
                                userSelect: 'none'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                readOnly
                                style={{ accentColor: 'var(--accent-color, #3b82f6)', cursor: 'pointer', pointerEvents: 'none' }}
                              />
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 2. Main Calendar Content Area */}
        <div className="calendar-workspace-body">
          {viewMode === 'month' ? (
            
            /* MONTH VIEW */
            <div className="calendar-grid-card" style={{ flex: 1, border: 'none', background: 'transparent', padding: '10px' }}>
              <div className="days-of-week" style={{ marginBottom: '10px' }}>
                {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(d => (
                  <div key={d} className="weekday-lbl" style={{ color: 'var(--text-muted)', fontWeight: '700' }}>{d}</div>
                ))}
              </div>
              
              <div className="days-grid" style={{ gridTemplateRows: 'repeat(6, 1fr)', flex: 1, minHeight: '500px' }}>
                {monthDays.map((day, idx) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const isSel = isSameDay(day, currentDate);
                  const isCurMonth = isSameMonth(day, currentDate);
                  const isTod = isToday(day);
                  
                  // Filter tasks scheduled on this day
                  const dayTasks = allMergedEvents.filter(t => t.dueDate === dayStr && taskMatchesClientFilter(t));
                  const pendingDayTasks = dayTasks.filter(t => !t.isChecked);

                  return (
                    <div
                      key={dayStr}
                      className={`day-cell ${!isCurMonth ? 'disabled' : ''} ${isSel ? 'selected' : ''} ${isTod ? 'today' : ''}`}
                      onClick={() => setCurrentDate(day)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const rawData = e.dataTransfer.getData('text/plain');
                        if (!rawData) return;
                        const { taskId } = JSON.parse(rawData);
                        handleDropTask(taskId, dayStr, null);
                      }}
                      style={{ 
                        height: 'auto', 
                        minHeight: '80px', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'stretch',
                        justifyContent: 'flex-start',
                        padding: '6px',
                        cursor: 'pointer',
                        position: 'relative'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span className="day-number" style={{ fontSize: '12px', fontWeight: '700' }}>{format(day, 'd')}</span>
                        {isTod && <span style={{ width: '6px', height: '6px', backgroundColor: 'var(--accent-color)', borderRadius: '50%', boxShadow: '0 0 6px var(--accent-color)' }} />}
                      </div>

                      {/* Scheduled Tasks Render inside Day cell */}
                      <div className="cell-tasks-scroller" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {dayTasks.slice(0, 3).map(task => {
                          const totalSub = task.subtasks?.length || 0;
                          const completedSub = task.subtasks?.filter(s => s.isChecked).length || 0;
                          const percentSub = totalSub > 0 ? Math.round((completedSub / totalSub) * 100) : 0;
                          const parentTask = task.isSubtask && task.parentTaskId ? allMergedEvents.find(t => t.id === task.parentTaskId) : null;

                          return (
                            <div 
                              key={task.id} 
                              draggable={!task.isExternal}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id }));
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onMouseEnter={(e) => handleMouseEnterCard(e, task)}
                              onMouseLeave={handleMouseLeaveCard}
                              className={`mini-cell-task ${task.isChecked ? 'completed' : ''} priority-${task.priority}`}
                              title={`${parentTask ? `${parentTask.content} › ` : ''}${task.content} (${task.noteName})${totalSub > 0 ? ` [Alt Görevler: ${completedSub}/${totalSub}]` : ''}`}
                              style={{
                                paddingBottom: totalSub > 0 ? '5px' : '2px',
                                borderLeft: task.isExternal 
                                  ? `2.5px solid ${task.externalSource === 'google' ? '#4285F4' : '#0078d4'}` 
                                  : undefined
                              }}
                            >
                              <div
                                className="mini-task-checkbox"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!task.isExternal) {
                                    handleToggleTodo(task.id);
                                  }
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: task.isExternal ? 'default' : 'pointer',
                                  flexShrink: 0
                                }}
                              >
                                {task.isExternal ? (
                                  <span 
                                    style={{ 
                                      display: 'inline-flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'center',
                                      background: task.externalSource === 'google' ? '#4285F4' : '#0078d4', 
                                      color: '#fff', 
                                      fontSize: '8px', 
                                      fontWeight: 'bold', 
                                      borderRadius: '3px', 
                                      width: '12px', 
                                      height: '12px'
                                    }}
                                    title={task.externalSource === 'google' ? 'Google Calendar' : 'Outlook Calendar'}
                                  >
                                    {task.externalSource === 'google' ? 'G' : 'O'}
                                  </span>
                                ) : task.isChecked ? (
                                  <CheckCircle2 size={10} style={{ color: 'var(--success-color)' }} />
                                ) : (
                                  <Circle size={10} style={{ color: 'var(--text-muted)' }} />
                                )}
                              </div>
                              {!task.isExternal && task.questOutcome && (
                                <span
                                  title={
                                    task.questOutcome === 'fast' ? 'Erken bitirdi' :
                                    task.questOutcome === 'ontime' ? 'Zamanında bitirdi' :
                                    task.questOutcome === 'incomplete' ? 'Bitirilmedi (otomatik durduruldu)' :
                                    'Geç kaldı'
                                  }
                                  style={{ fontSize: '9px', flexShrink: 0, marginRight: '2px' }}
                                >
                                  {task.questOutcome === 'fast' ? '⚡' : task.questOutcome === 'ontime' ? '✅' : task.questOutcome === 'incomplete' ? '❌' : '🐌'}
                                </span>
                              )}
                              {!task.isExternal && !task.questOutcome && task.questStartedAt && !task.isChecked && (() => {
                                const deadline = task.dueDate
                                  ? (() => {
                                      const [y, m, d] = task.dueDate.split('-').map(Number);
                                      if (task.timeSlot) {
                                        const endPart = task.timeSlot.split('-')[1];
                                        if (endPart) {
                                          const [eh, em] = endPart.split(':').map(Number);
                                          return new Date(y, m - 1, d, eh, em, 0);
                                        }
                                      }
                                      return new Date(y, m - 1, d, 23, 59, 59);
                                    })()
                                  : null;
                                return deadline
                                  ? <TaskCountdown deadline={deadline} size="compact" />
                                  : <span title="Devam ediyor" style={{ fontSize: '9px', flexShrink: 0, marginRight: '2px' }}>▶️</span>;
                              })()}
                              {!task.isExternal && !task.questOutcome && !task.questStartedAt && !task.isChecked && (
                                // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                // Tek tıkla başlatma — önceden yalnızca Görev Havuzu'nun detay
                                // çekmecesinden mümkündü, kullanıcı her seferinde oraya gitmek
                                // zorunda kalıyordu.
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartTaskFromCalendar(task);
                                  }}
                                  title="Göreve başla"
                                  style={{
                                    fontSize: '9px',
                                    flexShrink: 0,
                                    marginRight: '2px',
                                    background: 'rgba(99,102,241,0.15)',
                                    border: '1px solid rgba(99,102,241,0.4)',
                                    borderRadius: '4px',
                                    padding: '1px 4px',
                                    cursor: 'pointer',
                                    lineHeight: 1
                                  }}
                                >
                                  ▶️
                                </button>
                              )}
                              <span
                                className="mini-task-text"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (task.isExternal) {
                                    setExternalEventInfoModal({
                                      content: task.content,
                                      source: task.externalSource as 'google' | 'outlook',
                                      dueDate: task.dueDate,
                                      timeSlot: task.timeSlot
                                    });
                                  } else {
                                    onSelectDateNotes(task.noteName);
                                  }
                                }}
                                style={{
                                  flex: 1,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  textDecoration: task.isChecked ? 'line-through' : 'none',
                                  cursor: 'pointer'
                                }}
                              >
                                {task.timeSlot ? `⏱️${task.timeSlot.split('-')[0]} ` : ''}
                                {parentTask && (
                                  <span style={{ opacity: 0.6, fontWeight: 'normal', marginRight: '3px' }}>
                                    {parentTask.content} › 
                                  </span>
                                )}
                                {task.content}
                                {totalSub > 0 && ` (${completedSub}/${totalSub})`}
                              </span>

                              {totalSub > 0 && (
                                <div style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  height: '2px',
                                  background: 'rgba(255, 255, 255, 0.1)',
                                  borderRadius: '0 0 3px 3px',
                                  overflow: 'hidden'
                                }}>
                                  <div style={{
                                    width: `${percentSub}%`,
                                    height: '100%',
                                    background: 'linear-gradient(90deg, #06b6d4, #10b981)',
                                    boxShadow: '0 0 4px #06b6d4'
                                  }} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {dayTasks.length > 3 && (
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: '600', paddingLeft: '2px' }}>
                            +{dayTasks.length - 3} görev daha
                          </span>
                        )}
                      </div>

                      {/* Click to Create quick hover plus */}
                      <button
                        type="button"
                        className="cell-quick-add-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentDate(day);
                          const taskName = prompt(`${format(day, 'd MMMM')} için yeni görev girin:`);
                          if (taskName && taskName.trim()) {
                            handleCreateQuickTask(taskName.trim(), format(day, 'yyyy-MM-dd'), null);
                          }
                        }}
                        style={{
                          position: 'absolute',
                          right: '4px',
                          bottom: '4px',
                          opacity: 0,
                          background: 'var(--accent-color)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          width: '16px',
                          height: '16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'opacity 0.2s'
                        }}
                      >
                        <Plus size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            
            /* DOCK TIME GRID: WEEK / 3-DAY / DAY VIEW */
            <div className="scheduler-grid-container animate-fade">
              {/* Header Days Row */}
              <div className="scheduler-header-row">
                {/* Empty corner block for time axis */}
                <div className="time-axis-header" />
                
                {/* Columns headers */}
                <div className="day-columns-headers">
                  {activeDaysList.map(day => {
                    const isTod = isToday(day);
                    const dayStr = format(day, 'yyyy-MM-dd');
                    return (
                      <div
                        key={dayStr}
                        className={`day-col-header ${isTod ? 'today' : ''}`}
                        onClick={() => handleOpenDailyNote(dayStr)}
                        title="Bu günün notunu aç"
                        style={{ cursor: 'pointer' }}
                      >
                        <span className="w-day-lbl">{format(day, 'eeee', { locale: tr })}</span>
                        <span className="w-date-num">{format(day, 'd MMMM', { locale: tr })}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* All-Day Tasks Row */}
              <div className="scheduler-allday-row">
                <div className="allday-axis-lbl">
                  <span>Tüm Gün</span>
                </div>
                <div className="allday-columns">
                  {activeDaysList.map(day => {
                    const dayStr = format(day, 'yyyy-MM-dd');
                    const dayAlldayTasks = allMergedEvents.filter(t => t.dueDate === dayStr && !t.timeSlot && taskMatchesClientFilter(t));
                    return (
                      <div 
                        key={dayStr} 
                        className="allday-col-cell"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const rawData = e.dataTransfer.getData('text/plain');
                          if (!rawData) return;
                          const { taskId } = JSON.parse(rawData);
                          handleDropTask(taskId, dayStr, null);
                        }}
                      >
                        {dayAlldayTasks.map(task => {
                          const totalSub = task.subtasks?.length || 0;
                          const completedSub = task.subtasks?.filter(s => s.isChecked).length || 0;
                          const percentSub = totalSub > 0 ? Math.round((completedSub / totalSub) * 100) : 0;
                          const parentTask = task.isSubtask && task.parentTaskId ? allMergedEvents.find(t => t.id === task.parentTaskId) : null;

                          return (
                            <div 
                              key={task.id}
                              draggable={!task.isExternal}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id }));
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onMouseEnter={(e) => handleMouseEnterCard(e, task)}
                              onMouseLeave={handleMouseLeaveCard}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTaskForNote(task);
                              }}
                              className={`allday-task-card priority-${task.priority} ${task.isChecked ? 'completed' : ''}`}
                              title={`${parentTask ? `${parentTask.content} › ` : ''}${task.content} (${task.noteName})${totalSub > 0 ? ` [Alt Görevler: ${completedSub}/${totalSub}]` : ''}`}
                              style={{ 
                                cursor: task.isExternal ? 'default' : 'grab', 
                                position: 'relative', 
                                paddingBottom: totalSub > 0 ? '8px' : '4px',
                                borderLeft: task.isExternal 
                                  ? `3px solid ${task.externalSource === 'google' ? '#4285F4' : '#0078d4'}` 
                                  : undefined
                              }}
                            >
                              <div 
                                className="allday-checkbox-wrapper"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!task.isExternal) {
                                    handleToggleTodo(task.id);
                                  }
                                }}
                                style={{ cursor: task.isExternal ? 'default' : 'pointer' }}
                              >
                                {task.isExternal ? (
                                  <span 
                                    style={{ 
                                      display: 'inline-flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'center',
                                      background: task.externalSource === 'google' ? '#4285F4' : '#0078d4', 
                                      color: '#fff', 
                                      fontSize: '9px', 
                                      fontWeight: 'bold', 
                                      borderRadius: '3px', 
                                      width: '14px', 
                                      height: '14px',
                                      flexShrink: 0
                                    }}
                                    title={task.externalSource === 'google' ? 'Google Calendar' : 'Outlook Calendar'}
                                  >
                                    {task.externalSource === 'google' ? 'G' : 'O'}
                                  </span>
                                ) : task.isChecked ? (
                                  <CheckCircle2 size={12} className="allday-check-icon checked" />
                                ) : (
                                  <Circle size={12} className="allday-check-icon" />
                                )}
                              </div>
                              <span className="allday-task-text" onClick={(e) => {
                                e.stopPropagation();
                                if (task.isExternal) {
                                  alert(`Takvim Etkinliği:\n\n📅 ${task.content}\nKaynak: ${task.externalSource === 'google' ? 'Google Calendar' : 'Outlook Calendar'}\nTarih: ${task.dueDate} ${task.timeSlot ? `(${task.timeSlot})` : ''}`);
                                } else {
                                  onSelectDateNotes(task.noteName);
                                }
                              }}>
                                {parentTask && (
                                  <span style={{ opacity: 0.6, fontWeight: 'normal', marginRight: '4px' }}>
                                    {parentTask.content} › 
                                  </span>
                                )}
                                {task.content}
                                {totalSub > 0 && (
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 'bold' }}>
                                    ({completedSub}/{totalSub})
                                  </span>
                                )}
                              </span>

                              {totalSub > 0 && (
                                <div style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  height: '3px',
                                  background: 'rgba(255, 255, 255, 0.05)',
                                  borderRadius: '0 0 4px 4px',
                                  overflow: 'hidden'
                                }}>
                                  <div style={{
                                    width: `${percentSub}%`,
                                    height: '100%',
                                    background: 'linear-gradient(90deg, #06b6d4, #10b981)',
                                    boxShadow: '0 0 6px #06b6d4'
                                  }} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>


              {/* Scrollable scheduler body */}
              <div className="scheduler-body-scroll" ref={scrollContainerRef}>
                <div className="scheduler-grid-relative" style={{ height: `${minToPx(1440)}px` }}>
                  
                  {/* Left Column: Time Axis Labels */}
                  <div className="time-axis-column">
                    {timeMarks.map((mark, i) => (
                      <div
                        key={i}
                        className={`time-hour-row ${mark.min !== 0 ? 'time-sub-row' : ''}`}
                        style={{ height: `${markHeightPx}px` }}
                      >
                        <span>{String(mark.hour).padStart(2, '0')}:{String(mark.min).padStart(2, '0')}</span>
                      </div>
                    ))}
                  </div>

                  {/* Columns Grid columns for drops and events mapping */}
                  <div className="day-columns-grid">
                    {activeDaysList.map(day => {
                      const dayStr = format(day, 'yyyy-MM-dd');

                      // Background grid lines drawing — time-axis-column ile AYNI timeMarks/
                      // markHeightPx kaynağını kullanır (bkz. yukarıdaki yorum).
                      const gridLines = timeMarks.map((mark, i) => (
                        <div
                          key={i}
                          className={`scheduler-grid-hour-line ${mark.min !== 0 ? 'sub-line' : ''}`}
                          style={{ height: `${markHeightPx}px` }}
                        />
                      ));

                      // Scanned events scheduled in this day column
                      const dayScheduledEvents = allMergedEvents.filter(t => t.dueDate === dayStr && t.timeSlot && taskMatchesClientFilter(t));

                      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                      // BUG DÜZELTMESİ: zaman olarak çakışan görevler önceden hepsi aynı tam-genişlik
                      // (left:4px, right:4px) bloğunda üst üste render ediliyordu — hangi görevin
                      // hangisi olduğu anlaşılmıyordu. Google Calendar tarzı standart bir "çakışma
                      // kümesi + açgözlü sütun ataması" algoritmasıyla, aynı anda çakışan görevler
                      // artık yan yana, eşit genişlikte sütunlara bölünüyor. Çakışmayan görevler
                      // (kümede tek başınalarsa) eskisi gibi tam genişlik kaplamaya devam eder.
                      const overlapLayout = (() => {
                        const layout = new Map<string, { col: number; cols: number }>();
                        const parsed = dayScheduledEvents
                          .map(t => {
                            const td = parseTime(t.timeSlot);
                            if (!td) return null;
                            return { id: t.id, start: td.startHour * 60 + td.startMin, end: td.endHour * 60 + td.endMin };
                          })
                          .filter((x): x is { id: string; start: number; end: number } => !!x)
                          .sort((a, b) => a.start - b.start);

                        // 1) Zincirleme çakışan olayları kümelere ayır (sweep).
                        let cluster: typeof parsed = [];
                        let clusterMaxEnd = -Infinity;
                        const clusters: (typeof parsed)[] = [];
                        parsed.forEach(ev => {
                          if (cluster.length === 0 || ev.start < clusterMaxEnd) {
                            cluster.push(ev);
                            clusterMaxEnd = Math.max(clusterMaxEnd, ev.end);
                          } else {
                            clusters.push(cluster);
                            cluster = [ev];
                            clusterMaxEnd = ev.end;
                          }
                        });
                        if (cluster.length > 0) clusters.push(cluster);

                        // 2) Her kümede açgözlü sütun ataması: bir sütundaki son olay bitmişse
                        // (yeni olay başlamadan önce) o sütun yeniden kullanılır, yoksa yeni sütun açılır.
                        clusters.forEach(clusterEvents => {
                          const columns: (typeof parsed)[] = [];
                          clusterEvents.forEach(ev => {
                            let placed = false;
                            for (const col of columns) {
                              if (col[col.length - 1].end <= ev.start) {
                                col.push(ev);
                                layout.set(ev.id, { col: columns.indexOf(col), cols: 0 });
                                placed = true;
                                break;
                              }
                            }
                            if (!placed) {
                              layout.set(ev.id, { col: columns.length, cols: 0 });
                              columns.push([ev]);
                            }
                          });
                          const totalCols = columns.length;
                          clusterEvents.forEach(ev => {
                            const entry = layout.get(ev.id);
                            if (entry) entry.cols = totalCols;
                          });
                        });

                        return layout;
                      })();

                      return (
                        <div
                          key={dayStr}
                          data-day-col={dayStr}
                          className="scheduler-day-column"
                          onMouseDown={(e) => {
                            if (e.button !== 0) return; // Only trigger for left click
                            const rect = e.currentTarget.getBoundingClientRect();
                            const startY = e.clientY - rect.top;
                            const startMin = Math.max(0, Math.min(1440, pxToMin(startY)));
                            setDragToCreate({
                              dateStr: dayStr,
                              startMin,
                              currentMin: startMin,
                              isDragging: false
                            });
                          }}
                          onClick={(e) => {
                            if (justDraggedRef.current) {
                              e.stopPropagation();
                              return;
                            }
                            handleSlotClick(e, day);
                          }}
                          onContextMenu={(e) => handleSlotContextMenu(e, day)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const mouseY = e.clientY - rect.top;
                            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                            // 15 dakikalık takvim çizgisine yapıştır (30 dk yerine) — resize ile tutarlı.
                            const snappedMin = Math.round(pxToMin(mouseY) / 15) * 15;
                            const taskId = dragGhostTaskIdRef.current;
                            if (taskId) {
                              // Görevin KENDİ orijinal süresini koru (sabit 30/60dk varsayımı yerine).
                              const dragged = allMergedEvents.find(t => t.id === taskId);
                              const durationMin = getTaskDurationMinutes(dragged);
                              setDragGhostState({ dayStr, snappedMin, taskId, durationMin });
                            }
                          }}
                          onDragLeave={() => setDragGhostState(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragGhostState(null);
                            const rect = e.currentTarget.getBoundingClientRect();
                            const mouseY = e.clientY - rect.top;

                            const rawData = e.dataTransfer.getData('text/plain');
                            if (!rawData) return;
                            const { taskId } = JSON.parse(rawData);

                            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                            // KRİTİK: Önceden bitiş saati her zaman sabit +60dk ile hesaplanıyordu —
                            // yani 3 saatlik bir görevi taşımak onu 1 saate düşürüyordu. Artık
                            // sürüklenen görevin KENDİ orijinal süresi korunuyor, yalnızca başlangıç
                            // saati değişiyor. Ayrıca 15 dakikalık takvim çizgisine (30 yerine) yapışıyor.
                            const dragged = allMergedEvents.find(t => t.id === taskId);
                            const durationMin = getTaskDurationMinutes(dragged);

                            // Izgara 00:00-24:00 aralığına yayılır; px -> dakika dönüşümü zoom seviyesine göre yapılır.
                            const totalMinutes = pxToMin(mouseY);
                            const roundedMinutes = Math.round(totalMinutes / 15) * 15; // 15 dk'lık çizgiye yapış

                            const startHour = Math.floor(roundedMinutes / 60);
                            const startMin = roundedMinutes % 60;
                            const endTotalMinutes = roundedMinutes + durationMin;
                            const endHour = Math.floor(endTotalMinutes / 60);
                            const endMin = endTotalMinutes % 60;

                            const formatTimeStr = (h: number, m: number) => {
                              return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                            };

                            const timeSlot = `${formatTimeStr(startHour, startMin)}-${formatTimeStr(endHour, endMin)}`;
                            handleDropTask(taskId, dayStr, timeSlot);
                          }}
                        >
                          {/* 1. Background grid rows */}
                          <div className="grid-lines-layer">{gridLines}</div>

                          {/* Real-time Green Time Line Indicator */}
                          {(() => {
                            const todayStr = format(now, 'yyyy-MM-dd');
                            const currentHour = now.getHours();
                            const currentMin = now.getMinutes();
                            const showIndicator = true; // always show — 24h grid covers full day
                            const indicatorTop = minToPx(currentHour * 60 + currentMin);

                            if (dayStr === todayStr && showIndicator) {
                              return (
                                <div 
                                  className="current-time-indicator"
                                  style={{
                                    position: 'absolute',
                                    top: `${indicatorTop}px`,
                                    left: 0,
                                    right: 0,
                                    height: '2px',
                                    background: '#10b981',
                                    boxShadow: '0 0 8px #10b981, 0 0 15px rgba(16, 185, 129, 0.6)',
                                    zIndex: 40,
                                    pointerEvents: 'none',
                                    display: 'flex',
                                    alignItems: 'center'
                                  }}
                                >
                                  <div 
                                    style={{
                                      width: '6px',
                                      height: '6px',
                                      borderRadius: '50%',
                                      background: '#10b981',
                                      marginLeft: '-3px',
                                      boxShadow: '0 0 6px #10b981'
                                    }}
                                  />
                                  <span 
                                    style={{
                                      fontSize: '9px',
                                      color: '#34d399',
                                      background: '#18181b',
                                      border: '1px solid #10b981',
                                      padding: '1px 4px',
                                      borderRadius: '3px',
                                      fontWeight: 'bold',
                                      marginLeft: '4px',
                                      fontFamily: 'monospace',
                                      lineHeight: 1
                                    }}
                                  >
                                    {format(now, 'HH:mm')}
                                  </span>
                                </div>
                              );
                            }
                            return null;
                          })()}

                          {/* Real-time drag-to-create draft card rendering */}
                          {dragToCreate && dragToCreate.dateStr === dayStr && dragToCreate.isDragging && (() => {
                            // dragToCreate.startMin/currentMin GERÇEK dakika (zoom'dan bağımsız);
                            // render için minToPx ile px'e çevrilir.
                            const startAbsMin = Math.min(dragToCreate.startMin, dragToCreate.currentMin);
                            const endAbsMin = Math.max(dragToCreate.startMin, dragToCreate.currentMin);
                            const top = minToPx(startAbsMin);
                            const height = minToPx(endAbsMin - startAbsMin);
                            const roundedStart = Math.round(startAbsMin / 15) * 15;
                            const roundedEnd = Math.max(roundedStart + 15, Math.round(endAbsMin / 15) * 15);
                            
                            const formatTimeStr = (totalMins: number) => {
                              const h = Math.floor(totalMins / 60);
                              const m = totalMins % 60;
                              return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                            };
                            
                            const tempTimeSlot = `${formatTimeStr(roundedStart)}-${formatTimeStr(roundedEnd)}`;
                            
                            return (
                              <div
                                className="drag-to-create-draft-card"
                                style={{
                                  position: 'absolute',
                                  top: `${top}px`,
                                  height: `${height}px`,
                                  left: '4px',
                                  right: '4px',
                                  zIndex: 45,
                                  background: 'rgba(99, 102, 241, 0.25)',
                                  backdropFilter: 'blur(4px)',
                                  border: '2px dashed var(--accent-color)',
                                  borderRadius: '6px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  color: '#fff',
                                  pointerEvents: 'none',
                                  boxShadow: '0 0 10px rgba(99, 102, 241, 0.4)'
                                }}
                              >
                                <span style={{ fontSize: '10px', fontWeight: 'bold', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                                  Yeni Görev Oluştur
                                </span>
                                <span style={{ fontSize: '10px', opacity: 0.9, fontFamily: 'monospace', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                                  {tempTimeSlot}
                                </span>
                              </div>
                            );
                          })()}

                          {/* Ghost card preview during drag-over (snapped to 30-min intervals) */}
                          {dragGhostState && dragGhostState.dayStr === dayStr && (() => {
                            const ghostTop = minToPx(dragGhostState.snappedMin);
                            const ghostHeight = minToPx(dragGhostState.durationMin);
                            const ghostStartH = Math.floor(dragGhostState.snappedMin / 60);
                            const ghostStartM = dragGhostState.snappedMin % 60;
                            const ghostEndTotalMin = dragGhostState.snappedMin + ghostHeight;
                            const ghostEndH = Math.floor(ghostEndTotalMin / 60);
                            const ghostEndM = ghostEndTotalMin % 60;
                            const fmtG = (h: number, m: number) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                            return (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: `${ghostTop}px`,
                                  height: `${ghostHeight}px`,
                                  left: '4px',
                                  right: '4px',
                                  zIndex: 48,
                                  background: 'rgba(99, 102, 241, 0.18)',
                                  backdropFilter: 'blur(6px)',
                                  border: '2px dashed rgba(99, 102, 241, 0.7)',
                                  borderRadius: '8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  pointerEvents: 'none',
                                  transition: 'top 0.08s ease',
                                  boxShadow: '0 0 12px rgba(99,102,241,0.3)'
                                }}
                              >
                                <span style={{ fontSize: '9px', color: 'rgba(165,180,252,0.9)', fontWeight: '700', fontFamily: 'monospace' }}>
                                  {fmtG(ghostStartH, ghostStartM)} – {fmtG(ghostEndH, ghostEndM)}
                                </span>
                              </div>
                            );
                          })()}

                          {/* 2. Absolute events card rendering */}
                          <div className="events-render-layer">
                            {dayScheduledEvents.map(task => {
                              const timeData = parseTime(task.timeSlot);
                              if (!timeData) return null;

                              const startMinutes = timeData.startHour * 60 + timeData.startMin;
                              const endMinutes = timeData.endHour * 60 + timeData.endMin;

                              // 00:00'dan itibaren geçen dakika, zoom seviyesine göre px'e çevrilir.
                              const top = Math.max(0, minToPx(startMinutes));

                              // Check if we have a temporary dragging resize height in progress
                              // (tempEventHeights zaten px cinsinden tutulur, bkz. yeniden boyutlandırma hook'u)
                              const isResizingThis = resizingEvent && resizingEvent.taskId === task.id;
                              const height = isResizingThis
                                ? tempEventHeights[task.id] || minToPx(endMinutes - startMinutes)
                                : minToPx(endMinutes - startMinutes);

                              // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                              // Süre sürüklenirken kart üzerindeki saat etiketi de canlı olarak
                              // güncellensin ki kullanıcı hangi saate geldiğini anında görebilsin.
                              const displayTimeSlot = isResizingThis
                                ? (() => {
                                    const liveEndTotal = startMinutes + pxToMin(height);
                                    const liveEndHour = Math.floor(liveEndTotal / 60) % 24;
                                    const liveEndMin = liveEndTotal % 60;
                                    const fmt = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                                    return `${fmt(timeData.startHour, timeData.startMin)}-${fmt(liveEndHour, liveEndMin)}`;
                                  })()
                                : task.timeSlot;

                               const totalSub = task.subtasks?.length || 0;
                              const completedSub = task.subtasks?.filter(s => s.isChecked).length || 0;
                              const percentSub = totalSub > 0 ? Math.round((completedSub / totalSub) * 100) : 0;
                              const parentTask = task.isSubtask && task.parentTaskId ? allMergedEvents.find(t => t.id === task.parentTaskId) : null;
                              const isSmallCard = height < 48;
                              // İSTEK: müşteriye özel renk/icon — görevin proje etiketi (varsa) o
                              // projenin bağlı olduğu müşterinin rengini/iconunu miras alır.
                              const clientColorInfo = task.ownTags.map(t => projectColors[t]).find(Boolean);

                              // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                              // Yukarıda hesaplanan overlapLayout'tan bu görevin sütun konumunu al —
                              // çakışmıyorsa (cols===1) eskisi gibi tam genişlik, çakışıyorsa eşit
                              // genişlikte yan yana sütunlar. %4px iç boşluk küçük sütunlarda orantısız
                              // büyüyeceğinden, sütun varken kenar boşluğu 2px'e düşürülür.
                              const colInfo = overlapLayout.get(task.id) || { col: 0, cols: 1 };
                              const colGap = colInfo.cols > 1 ? 2 : 4;
                              const colWidthPercent = 100 / colInfo.cols;
                              const colLeftPercent = colInfo.col * colWidthPercent;

                              // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                              // Görevin bitmesine ne kadar kaldığını gösteren canlı geri sayım
                              // (TaskCountdown) için planlanan bitiş anı — Date nesnesi olarak,
                              // dayStr + timeData'dan (zaten yukarıda ayrıştırıldı).
                              const taskDeadlineDate = new Date(dayStr + 'T00:00:00');
                              taskDeadlineDate.setHours(timeData.endHour, timeData.endMin, 0, 0);

                              const taskStartDate = new Date(dayStr + 'T00:00:00');
                              taskStartDate.setHours(timeData.startHour, timeData.startMin, 0, 0);

                              // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                              // Geç başlamayı caydırma: yalnızca bilgilendirici toast yeterli değil —
                              // kullanıcı "planlı yaşam mantığının önüne geçiyor" dedi. Planlanan
                              // başlangıç saati geçmiş ama görev HENÜZ başlatılmamışsa (▶️'ye
                              // basılmamışsa), kart kendiliğinden amber/turuncu bir uyarı çerçevesine
                              // bürünür — kullanıcı "Başla"ya hiç dokunmadan bile geciktiğini görür,
                              // bildirim açmasına gerek kalmaz.
                              const taskPlannedStartMs = new Date(dayStr + 'T00:00:00').setHours(timeData.startHour, timeData.startMin, 0, 0);
                              const isOverdueToStart = !task.isExternal && !task.isChecked && !task.questStartedAt &&
                                (now.getTime() > taskPlannedStartMs);

                              // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                              // "İz düşüm": göreve gerçekten ne zaman başlandığını/bitirildiğini
                              // (ya da hâlâ devam ediyorsa şimdiye kadar geçeni) planlanan bloğun
                              // ÜZERİNE yarı saydam bir gölge olarak çizer. Aynı 1px=1dk koordinat
                              // sistemini (top/height, gece yarısından itibaren dakika) kullanır ki
                              // iki blok piksel piksel karşılaştırılabilir olsun. Hiç başlanmamış
                              // görevlerde (questStartedAt yok) karşılaştıracak bir şey olmadığından
                              // gölge hiç render edilmez.
                              const actualShadow = (() => {
                                if (task.isExternal || !task.questStartedAt) return null;
                                const actualStartMs = new Date(task.questStartedAt).getTime();
                                if (isNaN(actualStartMs)) return null;
                                const dayStartMs = new Date(dayStr + 'T00:00:00').getTime();
                                const dayEndMs = dayStartMs + 24 * 60 * 60000;

                                // BUG DÜZELTMESİ: Göreve başka bir günde başlanıp/tamamlanmış olabilir,
                                // [due:]/[time:] etiketi ise SONRADAN farklı bir güne atanmış olabilir
                                // (ör. 30 Temmuz'da oluşturulan görev 3 Ağustos'ta yapıldı, takvime
                                // 4 Ağustos'ta eklendi). Eskiden "0'a kırp" mantığı bu durumda günün
                                // BAŞINDAN o anki saate kadar devasa, anlamsız bir gölge çiziyordu
                                // ("çok geriye doğru gecikme çizgisi"). Gerçek başlangıç bu günün
                                // aralığında değilse, bu gün için hiç gölge çizilmez — karşılaştırılacak
                                // anlamlı bir şey yok.
                                if (actualStartMs < dayStartMs || actualStartMs >= dayEndMs) return null;

                                const actualStartMin = (actualStartMs - dayStartMs) / 60000;

                                const actualEndMs = task.questCompletedAt
                                  ? new Date(task.questCompletedAt).getTime()
                                  : Date.now();
                                // Bitiş de aynı güne ait olmayabilir (ör. hâlâ devam eden bir görev
                                // ertesi güne sarkmışsa) — gün sonunu (1440 dk) aşmasını engelle.
                                const actualEndMin = Math.min(1440, Math.max(actualStartMin + 1, (actualEndMs - dayStartMs) / 60000));

                                const plannedEndMin = startMinutes + (endMinutes - startMinutes);
                                const isOver = actualEndMin > plannedEndMin;
                                // Erken bitirme (kazanılan süre) yalnızca GERÇEKTEN tamamlanmış,
                                // planı belirgin biçimde (5dk+) erken bitiren görevlerde anlamlı —
                                // devam eden bir görevde "kazanç" henüz kesinleşmemiştir.
                                const savedMinutes = (task.questCompletedAt && !isOver)
                                  ? plannedEndMin - actualEndMin
                                  : 0;

                                return {
                                  // Bu gölge/iz düşümü, ana kartla AYNI mutlak (gece yarısından
                                  // itibaren) px koordinat uzayını paylaşan bir KARDEŞ (sibling)
                                  // eleman olarak render edilir — bu yüzden top/height/savedTop/
                                  // savedHeight de ana kartla aynı şekilde minToPx ile ölçeklenir.
                                  top: minToPx(actualStartMin),
                                  height: minToPx(actualEndMin - actualStartMin),
                                  isOver,
                                  isOngoing: !task.questCompletedAt && !task.isChecked,
                                  savedMinutes,
                                  savedTop: minToPx(actualEndMin),
                                  savedHeight: minToPx(plannedEndMin - actualEndMin)
                                };
                              })();

                              return (
                                <React.Fragment key={task.id}>
                                {actualShadow && (
                                  <div
                                    className={`actual-time-shadow ${actualShadow.isOver ? 'overrun' : 'within-plan'} ${actualShadow.isOngoing ? 'ongoing' : ''}`}
                                    style={{
                                      position: 'absolute',
                                      top: `${actualShadow.top}px`,
                                      height: `${actualShadow.height}px`,
                                      left: `calc(${colLeftPercent}% + ${colGap - 1}px)`,
                                      width: '5px',
                                      zIndex: 9,
                                      borderRadius: '3px',
                                      pointerEvents: 'none',
                                      background: actualShadow.isOver
                                        ? 'repeating-linear-gradient(135deg, rgba(239,68,68,0.9), rgba(239,68,68,0.9) 3px, rgba(239,68,68,0.5) 3px, rgba(239,68,68,0.5) 6px)'
                                        : (actualShadow.isOngoing ? 'rgba(99,102,241,0.85)' : 'rgba(34,197,94,0.8)'),
                                      boxShadow: actualShadow.isOver
                                        ? '0 0 6px rgba(239,68,68,0.6)'
                                        : (actualShadow.isOngoing ? '0 0 6px rgba(99,102,241,0.5)' : '0 0 4px rgba(34,197,94,0.4)')
                                    }}
                                    title={
                                      actualShadow.isOver
                                        ? 'Planlanan süreyi aştın'
                                        : actualShadow.isOngoing
                                          ? 'Devam ediyor'
                                          : 'Plan içinde tamamlandı'
                                    }
                                  />
                                )}
                                {actualShadow && actualShadow.savedMinutes >= 5 && task.questCompletedAt && task.questCompletedAt === activeCascadeCompletedAt && (
                                  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                  // YALNIZCA App.tsx'teki "boşluğu doldur" önerisi HÂLÂ bu göreve
                                  // aitken gösterilir (activeCascadeCompletedAt eşleşmesi). Kullanıcı
                                  // öneriyi yanıtlar yanıtlamaz (Evet ya da Vazgeç) App.tsx bu değeri
                                  // null'a çeker, parlak katman kaybolur, blok normal (düz gölge
                                  // şeridi) görünümüne iner — kullanıcının açıkça istediği davranış.
                                  // Erken bitirme, ince gölge şeridiyle fark edilmiyordu — kullanıcı
                                  // Takvim'de bunu net görmek istedi. Kazanılan (kullanılmayan)
                                  // planlanan süreyi, bloğun kalan kısmını parlak/yeşil bir "kazanım"
                                  // dolgusuyla kaplayıp üzerine "⚡ X dk kazandın" yazarak vurguluyoruz
                                  // — sönük ince şerit yerine göze çarpan, olumlayıcı bir işaret.
                                  <div
                                    className="saved-time-highlight"
                                    style={{
                                      position: 'absolute',
                                      top: `${actualShadow.savedTop}px`,
                                      height: `${actualShadow.savedHeight}px`,
                                      left: `calc(${colLeftPercent}% + ${colGap}px)`,
                                      width: `calc(${colWidthPercent}% - ${colGap * 2}px)`,
                                      zIndex: 8,
                                      borderRadius: '0 0 6px 6px',
                                      pointerEvents: 'none',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      overflow: 'hidden',
                                      background: 'repeating-linear-gradient(135deg, rgba(74,222,128,0.28), rgba(74,222,128,0.28) 6px, rgba(74,222,128,0.14) 6px, rgba(74,222,128,0.14) 12px)',
                                      border: '1.5px dashed rgba(74,222,128,0.75)',
                                      boxShadow: '0 0 10px rgba(74,222,128,0.35), inset 0 0 12px rgba(74,222,128,0.15)',
                                      animation: 'savedTimeGlow 2s ease-in-out infinite'
                                    }}
                                    title={`${Math.round(actualShadow.savedMinutes)} dakika erken bitirdin`}
                                  >
                                    {actualShadow.savedHeight >= 20 && (
                                      <span style={{
                                        fontSize: '10px',
                                        fontWeight: 800,
                                        color: '#22c55e',
                                        textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(74,222,128,0.6)',
                                        whiteSpace: 'nowrap'
                                      }}>
                                        ⚡ {Math.round(actualShadow.savedMinutes)} dk kazandın
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div
                                  draggable={!task.isExternal && !task.isSessionOccurrence && !resizingEvent}
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id }));
                                    e.dataTransfer.effectAllowed = 'move';
                                    dragGhostTaskIdRef.current = task.id;
                                  }}
                                  onDragEnd={() => {
                                    dragGhostTaskIdRef.current = null;
                                    setDragGhostState(null);
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectTaskForNote(task);
                                  }}
                                  onMouseEnter={(e) => handleMouseEnterCard(e, task)}
                                  onMouseLeave={handleMouseLeaveCard}
                                  className={`scheduled-event-card priority-${task.priority} ${task.isChecked ? 'completed' : ''} ${isOverdueToStart ? 'countdown-urgent-pulse' : ''}`}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe
                                    // yorum satırı (Kural 5): İSTEK — takvimdeki bir göreve çift
                                    // tıklayınca düzenlenebilir olsun. Aynı "Yeni Görev Ekle" modalı
                                    // gerçek DÜZENLEME moduyla (isEditMode) açılır: metin, tarih/saat
                                    // VE proje etiketi değiştirilebilir (bkz. handleEditTask).
                                    // [plan:] kartlarında metin/proje düzenlemesi anlamsız (o bilgi
                                    // ana görev satırına ait) — sadece sürükleyip saatini değiştirmek
                                    // veya "Planlanmamış"a atıp iptal etmek mümkün.
                                    if (task.isExternal || task.isSessionOccurrence || task.isPlanOccurrence) return;
                                    const [depStart, depEnd] = (task.timeSlot || '10:00-11:00').split('-');
                                    const currentProjectSlug = projectNames
                                      .map(n => n.toLocaleLowerCase('tr').replace(/\s+/g, '-'))
                                      .find(slug => task.ownTags.includes(slug));
                                    const currentProjectName = projectNames.find(
                                      n => n.toLocaleLowerCase('tr').replace(/\s+/g, '-') === currentProjectSlug
                                    );
                                    setActiveSchedulingModal({
                                      taskId: task.id,
                                      taskName: task.content,
                                      dateStr: task.dueDate || format(currentDate, 'yyyy-MM-dd'),
                                      startTime: depStart || '10:00',
                                      endTime: depEnd || '11:00',
                                      projectTag: currentProjectName || '',
                                      isEditMode: true
                                    });
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  title={
                                    task.isSessionOccurrence
                                      ? 'Bu işe bu gün de çalışıldı — güncel planı görmek için görevin taşındığı güne bak'
                                      : task.isPlanOccurrence
                                        ? 'Bu işe bu gün de çalışılması planlanıyor (henüz başlanmadı) — sürükleyip saatini değiştirebilir veya Planlanmamış\'a atıp iptal edebilirsin'
                                        : undefined
                                  }
                                  style={{
                                    position: 'absolute',
                                    top: `${top}px`,
                                    height: `${height}px`,
                                    left: `calc(${colLeftPercent}% + ${colGap}px)`,
                                    width: `calc(${colWidthPercent}% - ${colGap * 2}px)`,
                                    zIndex: isResizingThis ? 50 : (10 + colInfo.col + (isOverdueToStart ? 5 : 0)),
                                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                    // .scheduled-event-card sınıfı `transition: all 0.25s` tanımlıyor.
                                    // Bu, yükseklik 15dk'lık adımlarla sıçrasa bile CSS'in bunu yumuşak
                                    // bir animasyonla kaydırmasına (glide) neden olup "yapışma" hissini
                                    // yok ediyordu. Aktif sürükleme/resize sırasında geçişi kapatıyoruz
                                    // ki her 15dk'lık snap noktası anında, "tık" diye hissedilsin.
                                    transition: isResizingThis ? 'none' : undefined,
                                    cursor: (task.isExternal || task.isSessionOccurrence) ? 'default' : 'grab',
                                    opacity: task.isSessionOccurrence ? 0.6 : 1,
                                    padding: isSmallCard ? '2px 6px' : '6px 8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: isSmallCard ? '4px' : '6px',
                                    borderLeft: task.isExternal
                                      ? `3px solid ${task.externalSource === 'google' ? '#4285F4' : '#0078d4'}`
                                      : undefined,
                                    // Müşteri rengi atanmışsa, kartın arka plan gradyanını/kenarlığını/
                                    // parlamasını YÖNETEN CSS değişkenini o renge çeviriyoruz — böylece
                                    // sadece ince bir kenar değil, KARTIN TAMAMI o rengin tonuna bürünüyor
                                    // (bkz. yukarıdaki hexToRgbString ve .scheduled-event-card CSS kuralı).
                                    ...(clientColorInfo && !task.isExternal
                                      ? { ['--card-priority-rgb' as any]: hexToRgbString(clientColorInfo.color) }
                                      : {}),
                                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                    // Geç başlama caydırıcısı: planlanan başlangıç geçti ama "▶️ Başla"
                                    // hiç basılmadıysa kart kendiliğinden amber çerçeve+nabız alır —
                                    // sadece "Başla"ya basınca çıkan toast'tan daha proaktif bir uyarı.
                                    ...(isOverdueToStart ? {
                                      border: '1.5px solid #f59e0b',
                                      boxShadow: '0 0 10px rgba(245,158,11,0.4)'
                                    } : {})
                                  }}
                                >
                                  {/* Drag Handle or Indicator bar — müşteri rengi atanmışsa öncelik rengi yerine onu kullanır */}
                                  {!task.isExternal && (
                                    <div
                                      className="event-priority-bar"
                                      style={{
                                        ...(isSmallCard ? { height: '80%' } : {}),
                                        ...(clientColorInfo ? { background: clientColorInfo.color } : {})
                                      }}
                                    />
                                  )}
                                  {clientColorInfo && (
                                    <span title="Müşteri" style={{ fontSize: isSmallCard ? '10px' : '12px', flexShrink: 0 }}>
                                      {clientColorInfo.icon}
                                    </span>
                                  )}

                                  {/* Dedicated Checkbox */}
                                  <div 
                                    className="event-checkbox-wrapper"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (task.isExternal) {
                                        setExternalEventInfoModal({
                                      content: task.content,
                                      source: task.externalSource as 'google' | 'outlook',
                                      dueDate: task.dueDate,
                                      timeSlot: task.timeSlot
                                    });
                                      } else {
                                        handleToggleTodo(task.id);
                                      }
                                    }}
                                    style={isSmallCard ? { display: 'flex', alignItems: 'center', cursor: task.isExternal ? 'default' : 'pointer' } : undefined}
                                  >
                                    {task.isExternal ? (
                                      <span 
                                        style={{ 
                                          display: 'inline-flex', 
                                          alignItems: 'center', 
                                          justifyContent: 'center',
                                          background: task.externalSource === 'google' ? '#4285F4' : '#0078d4', 
                                          color: '#fff', 
                                          fontSize: '9px', 
                                          fontWeight: 'bold', 
                                          borderRadius: '3px', 
                                          width: '14px', 
                                          height: '14px',
                                          flexShrink: 0
                                        }}
                                        title={task.externalSource === 'google' ? 'Google Calendar' : 'Outlook Calendar'}
                                      >
                                        {task.externalSource === 'google' ? 'G' : 'O'}
                                      </span>
                                    ) : task.isChecked ? (
                                      <CheckCircle2 size={13} className="event-check-icon checked" />
                                    ) : (
                                      <Circle size={13} className="event-check-icon" />
                                    )}
                                  </div>

                                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                      Kart çok kısa olduğunda (isSmallCard, ör. 10dk'dan kısa
                                      görevler) event-card-content içindeki tam boyutlu sayaç hiç
                                      sığmaz/görünmez — bu yüzden küçük kartlarda kompakt bir
                                      geri sayım kartın sağ üst köşesine (start butonunun biraz
                                      solunda) ayrıca eklenir, aksi halde tam da en acil (kısa
                                      süreli) görevlerde sayaç hiç görünmezdi. */}
                                  {isSmallCard && !task.isExternal && !task.isChecked && (
                                    <div style={{ position: 'absolute', top: '2px', right: task.questOutcome || task.questStartedAt ? '4px' : '32px', zIndex: 11 }}>
                                      <TaskCountdown startTime={taskStartDate} deadline={taskDeadlineDate} size="compact" />
                                    </div>
                                  )}

                                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                      Tek tıkla başlatma — önceden yalnızca Görev Havuzu'nun detay
                                      çekmecesinden mümkündü. Kartın sağ üst köşesine mutlak
                                      konumlanır ki mevcut flex düzenini (checkbox+içerik) bozmasın. */}
                                  {!task.isExternal && !task.questOutcome && !task.questStartedAt && !task.isChecked && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStartTaskFromCalendar(task);
                                      }}
                                      title={isOverdueToStart ? 'Planlanan saat geçti — başlaman gerekiyordu!' : 'Göreve başla'}
                                      className={isOverdueToStart ? 'countdown-urgent-pulse' : ''}
                                      style={{
                                        position: 'absolute',
                                        top: '4px',
                                        right: '4px',
                                        zIndex: 12,
                                        fontSize: '10px',
                                        fontWeight: isOverdueToStart ? 700 : 400,
                                        color: isOverdueToStart ? '#fecaca' : undefined,
                                        background: isOverdueToStart ? '#7f1d1d' : 'rgba(99,102,241,0.2)',
                                        border: `1px solid ${isOverdueToStart ? '#f59e0b' : 'rgba(99,102,241,0.5)'}`,
                                        borderRadius: '5px',
                                        padding: '2px 5px',
                                        cursor: 'pointer',
                                        lineHeight: 1
                                      }}
                                    >
                                      {isOverdueToStart ? '⏰▶️' : '▶️'}
                                    </button>
                                  )}

                                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                      İSTEK: "İşi zamanında yaptım ama uygulamaya sonradan
                                      ekledim, sanki geç kalmışım gibi puan kırıldı." Başlangıç/
                                      tamamlanma damgaları TIKLANAN ana göre yazıldığı için,
                                      gerçek zamanı elle düzeltebilme + yanlışlıkla basılan
                                      "▶️ Başla"yı geri alabilme ihtiyacı — ikisi de aynı küçük
                                      saat butonuyla açılan tek bir modalda birleştirilir.
                                      isSmallCard'da ▶️ butonuyla çakışmaması için ayrı bir
                                      satıra (biraz aşağıya) konumlanır. */}
                                  {!task.isExternal && !task.isChecked && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenEditTimes(task);
                                      }}
                                      title="Başlangıç/tamamlanma zamanlarını elle düzenle"
                                      style={{
                                        position: 'absolute',
                                        top: task.questOutcome || task.questStartedAt ? '4px' : '22px',
                                        right: '4px',
                                        zIndex: 12,
                                        fontSize: '10px',
                                        color: 'var(--text-muted, #94a3b8)',
                                        background: 'rgba(255,255,255,0.08)',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        borderRadius: '5px',
                                        padding: '2px 5px',
                                        cursor: 'pointer',
                                        lineHeight: 1
                                      }}
                                    >
                                      🕐
                                    </button>
                                  )}

                                  <div className="event-card-content" style={{
                                    paddingBottom: isSmallCard ? '0px' : (totalSub > 0 ? '12px' : '4px'),
                                    justifyContent: isSmallCard ? 'center' : 'space-between',
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column'
                                  }}>
                                    {!isSmallCard && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                        <span className="event-time-lbl">{displayTimeSlot}</span>
                                        {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                            Görevin bitmesine ne kadar kaldığını gösteren canlı sayaç —
                                            kullanıcının "takvimde bir timer koyar mısın... son 10dk kala
                                            kırmızı olsun" isteği. Görev başlatılmış olmasa bile gösterilir
                                            (planlanan bitişe göre). */}
                                        {!task.isExternal && !task.isChecked && (
                                          <TaskCountdown startTime={taskStartDate} deadline={taskDeadlineDate} size="full" />
                                        )}
                                      </div>
                                    )}
                                    
                                    {height >= 50 ? (
                                      <p className="event-title-lbl" style={{ margin: '2px 0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        {parentTask && (
                                          <span className="event-parent-lbl" style={{
                                            fontSize: '9px',
                                            color: 'var(--text-secondary)',
                                            fontWeight: '500',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.3px',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            marginBottom: '1px'
                                          }}>
                                            {parentTask.content}
                                          </span>
                                        )}
                                        <span>{task.isSessionOccurrence && '↩ '}{task.isPlanOccurrence && '📅 '}{task.content}</span>
                                      </p>
                                    ) : (
                                      <p className="event-title-lbl" style={{ 
                                        margin: '0',
                                        fontSize: isSmallCard ? '10px' : '11px',
                                        lineHeight: '1.2',
                                        whiteSpace: isSmallCard ? 'nowrap' : 'normal',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                      }}>
                                        {parentTask && (
                                          <span style={{ opacity: 0.6, fontWeight: 'normal', marginRight: '4px' }}>
                                            {parentTask.content} › 
                                          </span>
                                        )}
                                        <span>{task.isSessionOccurrence && '↩ '}{task.isPlanOccurrence && '📅 '}{task.content}</span>
                                      </p>
                                    )}
                                    
                                    {!isSmallCard && height >= 85 && (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                                        <span className="event-note-badge" title="Tıklandığında notu açar" onClick={(e) => {
                                          e.stopPropagation();
                                          onSelectDateNotes(task.noteName);
                                        }} style={{ margin: 0 }}>
                                          <FileText size={10} style={{ marginRight: '2px' }} />
                                          {task.noteName}
                                        </span>

                                        {totalSub > 0 && (
                                          <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            fontSize: '9px',
                                            color: '#06b6d4',
                                            background: 'rgba(6, 182, 212, 0.1)',
                                            border: '1px solid rgba(6, 182, 212, 0.2)',
                                            padding: '1px 4px',
                                            borderRadius: '4px',
                                            fontWeight: 'bold',
                                            whiteSpace: 'nowrap'
                                          }}>
                                            📋 {completedSub}/{totalSub}
                                          </span>
                                        )}

                                        {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                            İSTEK: Başlangıç/tamamlanma ham köşeli-parantez metni
                                            olarak DEĞİL, küçük okunabilir rozetler olarak
                                            gösterilsin — başlık üstte, altında (varsa) başlangıç
                                            rozeti, onun da altında (varsa) tamamlanma rozeti. */}
                                        {task.questStartedAt && !isNaN(new Date(task.questStartedAt).getTime()) && (
                                          <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px',
                                            color: '#93c5fd', background: 'rgba(59,130,246,0.12)',
                                            border: '1px solid rgba(59,130,246,0.25)', padding: '1px 4px',
                                            borderRadius: '4px', whiteSpace: 'nowrap'
                                          }}>
                                            🕐 Başlangıç: {new Date(task.questStartedAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                        )}
                                        {task.questCompletedAt && !isNaN(new Date(task.questCompletedAt).getTime()) && (
                                          <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px',
                                            color: '#86efac', background: 'rgba(34,197,94,0.12)',
                                            border: '1px solid rgba(34,197,94,0.25)', padding: '1px 4px',
                                            borderRadius: '4px', whiteSpace: 'nowrap'
                                          }}>
                                            ✅ Tamamlanma: {new Date(task.questCompletedAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {!isSmallCard && totalSub > 0 && (
                                    <div style={{
                                      position: 'absolute',
                                      bottom: 0,
                                      left: 0,
                                      right: 0,
                                      height: '4px',
                                      background: 'var(--border-color)',
                                      borderRadius: '0 0 6px 6px',
                                      overflow: 'hidden'
                                    }}>
                                      <div style={{
                                        width: `${percentSub}%`,
                                        height: '100%',
                                        background: 'linear-gradient(90deg, #06b6d4, #10b981)',
                                        boxShadow: '0 0 8px #06b6d4'
                                      }} />
                                    </div>
                                  )}

                                  {/* Event Resizing bottom handle */}
                                  {!task.isChecked && !task.isSessionOccurrence && (
                                    <div
                                      className="event-resize-handle"
                                      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                      // Üst görev kartı `draggable` (native HTML5 sürükle-bırak, günler
                                      // arası taşımak için). Bu tutamaç o kartın İÇİNDE olduğundan,
                                      // `onMouseDown`'daki stopPropagation() tarayıcının kendi native
                                      // dragstart algılamasını DURDURMUYOR — React state güncellemesi
                                      // (draggable=false) DOM'a yansımadan önce tarayıcı bazen native
                                      // sürüklemeyi de başlatabiliyordu. Bu, hem "hayalet" sürükleme
                                      // kutusuna hem de bırakma anının bazen çalışmamasına yol açan
                                      // yarış durumuydu. `draggable={false}` + dragstart engelleme ile
                                      // bu tutamaçtan native sürüklemenin asla tetiklenmemesini garanti ediyoruz.
                                      draggable={false}
                                      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setResizingEvent({
                                          taskId: task.id,
                                          startY: e.clientY,
                                          startHeight: height,
                                          originalTimeSlot: task.timeSlot,
                                          dateStr: dayStr
                                        });
                                      }}
                                    />
                                  )}
                                </div>
                                </React.Fragment>
                              );
                            })}
                          </div>


                        </div>
                      );
                    })}
                  </div>

                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Right Section: Unscheduled Tasks Inbox panel */}
      <div 
        className={`calendar-unscheduled-sidebar ${isUnplannedOpen ? 'open' : ''} ${embedded ? 'force-hidden' : ''}`}
        style={{ width: `${sidebarWidth}px`, position: 'relative' }}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drop-hover');
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove('drop-hover');
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drop-hover');
          const rawData = e.dataTransfer.getData('text/plain');
          if (!rawData) return;
          try {
            const { taskId } = JSON.parse(rawData);
            handleUnscheduleTask(taskId);
          } catch (err) {
            console.error('Error unscheduling via drop:', err);
          }
        }}
      >
        {/* Resizer Handle */}
        <div
          className={`sidebar-resizer-handle ${isResizingSidebar ? 'active' : ''}`}
          onMouseDown={handleStartResizeSidebar}
          title="Kenar çubuğunu genişletmek/daraltmak için sürükleyin"
        />

        <div className="sidebar-header-title">
          <CheckSquare size={16} className="text-accent" />
          <h3>Planlanmamış Görevler</h3>
        </div>
        
        <p className="sidebar-subtitle-desc">
          Görevleri takvime sürükleyin veya takvimden buraya geri bırakarak planı kaldırın.
        </p>

        {loading ? (
          <div className="sidebar-loading">
            <RefreshCw size={20} className="animate-spin text-muted" />
            <span>Görevler taranıyor...</span>
          </div>
        ) : unscheduledTasks.length === 0 ? (
          <div className="sidebar-empty">
            <CheckCircle2 size={32} className="text-success" />
            <p>Harika! Planlanmamış açık göreviniz kalmadı.</p>
          </div>
        ) : (
          <div className="unscheduled-tasks-list">
            {unscheduledTasks.map(task => {
              const hasSubtasks = task.subtasks && task.subtasks.length > 0;
              const parentTask = task.isSubtask && task.parentTaskId ? tasks.find(t => t.id === task.parentTaskId) : null;
              if (hasSubtasks) {
                // Filter only unscheduled VE tamamlanmamış alt görevleri
                const unscheduledSubs = (task.subtasks || [])
                  .filter(sub => !sub.dueDate && !sub.isChecked);
                
                // If there are no unscheduled subtasks left, do not render the parent task card at all!
                if (unscheduledSubs.length === 0) return null;
                
                const isExpanded = expandedParents[task.id] !== false; // expanded by default
                const totalSubCount = task.subtasks?.length || 0;
                const scheduledSubCount = totalSubCount - unscheduledSubs.length;
                
                return (
                  <div key={task.id} className="unscheduled-parent-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id }));
                        e.dataTransfer.effectAllowed = 'move';
                        dragGhostTaskIdRef.current = task.id;
                        setIsUnplannedOpen(false); // Close sidebar on mobile/desktop drag start
                      }}
                      onDragEnd={() => {
                        dragGhostTaskIdRef.current = null;
                        setDragGhostState(null);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectTaskForNote(task);
                      }}
                      className={`unscheduled-task-card priority-${task.priority} ${task.isChecked ? 'completed' : ''}`}
                      style={task.isChecked ? { opacity: 0.6 } : {}}
                    >
                      <div className="card-grab-handle">
                        <GripVertical size={14} />
                      </div>
                      
                      {/* Clickable Checkbox */}
                      <div 
                        className="unscheduled-checkbox-wrapper"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleTodo(task.id);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          marginRight: '8px',
                          color: task.isChecked ? 'var(--success-color)' : 'var(--text-muted)'
                        }}
                      >
                        {task.isChecked ? (
                          <CheckCircle2 size={14} className="text-success" />
                        ) : (
                          <Circle size={14} />
                        )}
                      </div>

                      <div className="card-info-wrap" style={{ flex: 1 }}>
                        <div className="card-main-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                            <span className={`priority-dot ${task.priority}`} />
                            <p 
                              className={`task-content-lbl ${task.isChecked ? 'line-through' : ''}`}
                              style={task.isChecked ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}}
                            >
                              {task.content}
                            </p>
                          </div>
                          
                          {/* Accordion Toggle Chevron */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedParents(prev => ({
                                ...prev,
                                [task.id]: !isExpanded
                              }));
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '2px',
                              borderRadius: '4px',
                              transition: 'all 0.2s',
                              marginLeft: '6px'
                            }}
                            className="accordion-toggle-btn"
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </div>
                        <div className="card-note-origin" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <FileText size={10} />
                            <span>{task.noteName}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn-assign-date"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveSchedulingModal({
                                  taskId: task.id,
                                  taskName: task.content,
                                  dateStr: format(currentDate, 'yyyy-MM-dd'),
                                  startTime: '10:00',
                                  endTime: '11:00',
                                  projectTag: '',
                                  isEditMode: false
                                });
                              }}
                              style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '4px',
                                padding: '2px 6px',
                                fontSize: '9px',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                              }}
                              title={`Seçili tarihe (${format(currentDate, 'd MMM', { locale: tr })}) planla`}
                            >
                              Planla
                            </button>
                            <span style={{ fontSize: '9px', opacity: 0.6, fontWeight: 'bold' }}>
                              {scheduledSubCount}/{totalSubCount}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Subtask list */}
                    {isExpanded && unscheduledSubs.length > 0 && (
                      <div className="nested-subtasks-container" style={{
                        paddingLeft: '20px',
                        marginLeft: '10px',
                        borderLeft: '1px dashed rgba(255, 255, 255, 0.15)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        marginTop: '4px',
                        marginBottom: '8px'
                      }}>
                        {unscheduledSubs.map(sub => {
                          const isSubChecked = sub.isChecked;
                          const subPriority = sub.priority;
                          
                          return (
                            <div
                              key={sub.id}
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: sub.id }));
                                e.dataTransfer.effectAllowed = 'move';
                                dragGhostTaskIdRef.current = sub.id;
                                setIsUnplannedOpen(false); // Close sidebar on mobile/desktop drag start
                              }}
                              onDragEnd={() => {
                                dragGhostTaskIdRef.current = null;
                                setDragGhostState(null);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTaskForNote(sub);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                background: 'rgba(24, 24, 27, 0.4)',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '6px',
                                padding: '6px 8px',
                                fontSize: '11px',
                                cursor: 'grab',
                                transition: 'all 0.2s',
                                opacity: isSubChecked ? 0.6 : 1
                              }}
                            >
                              <div className="card-grab-handle" style={{ marginRight: '4px', cursor: 'grab', opacity: 0.5 }}>
                                <GripVertical size={12} />
                              </div>

                              <div
                                className="unscheduled-checkbox-wrapper"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleTodo(sub.id);
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  marginRight: '6px',
                                  color: isSubChecked ? 'var(--success-color)' : 'var(--text-muted)'
                                }}
                              >
                                {isSubChecked ? (
                                  <CheckCircle2 size={12} className="text-success" />
                                ) : (
                                  <Circle size={12} />
                                )}
                              </div>

                              <div className="card-info-wrap" style={{ flex: 1, minWidth: 0, padding: 0 }}>
                                <div className="card-main-text" style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'space-between' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: 1 }}>
                                    <span className={`priority-dot ${subPriority}`} style={{ width: '6px', height: '6px' }} />
                                    <p
                                      className={`task-content-lbl ${isSubChecked ? 'line-through' : ''}`}
                                      style={{
                                        margin: 0,
                                        fontSize: '11px',
                                        textDecoration: isSubChecked ? 'line-through' : 'none',
                                        color: isSubChecked ? 'var(--text-muted)' : '#fff',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                      }}
                                    >
                                      {sub.content}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn-assign-date"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveSchedulingModal({
                                        taskId: sub.id,
                                        taskName: sub.content,
                                        dateStr: format(currentDate, 'yyyy-MM-dd'),
                                        startTime: '10:00',
                                        endTime: '11:00',
                                        projectTag: '',
                                        isEditMode: false
                                      });
                                    }}
                                    style={{
                                      background: 'rgba(255, 255, 255, 0.05)',
                                      border: '1px solid rgba(255, 255, 255, 0.1)',
                                      borderRadius: '4px',
                                      padding: '2px 6px',
                                      fontSize: '9px',
                                      color: 'var(--text-secondary)',
                                      cursor: 'pointer',
                                      marginLeft: '6px',
                                      flexShrink: 0
                                    }}
                                    title={`Seçili tarihe (${format(currentDate, 'd MMM', { locale: tr })}) planla`}
                                  >
                                    Planla
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              
              // Standard rendering for tasks without subtasks
              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id }));
                    e.dataTransfer.effectAllowed = 'move';
                    dragGhostTaskIdRef.current = task.id;
                    setIsUnplannedOpen(false); // Close sidebar on mobile/desktop drag start
                  }}
                  onDragEnd={() => {
                    dragGhostTaskIdRef.current = null;
                    setDragGhostState(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectTaskForNote(task);
                  }}
                  className={`unscheduled-task-card priority-${task.priority} ${task.isChecked ? 'completed' : ''}`}
                  style={task.isChecked ? { opacity: 0.6 } : {}}
                >
                  <div className="card-grab-handle">
                    <GripVertical size={14} />
                  </div>
                  
                  {/* Clickable Checkbox */}
                  <div 
                    className="unscheduled-checkbox-wrapper"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleTodo(task.id);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      marginRight: '8px',
                      color: task.isChecked ? 'var(--success-color)' : 'var(--text-muted)'
                    }}
                  >
                    {task.isChecked ? (
                      <CheckCircle2 size={14} className="text-success" />
                    ) : (
                      <Circle size={14} />
                    )}
                  </div>

                  <div className="card-info-wrap">
                    <div className="card-main-text">
                      <span className={`priority-dot ${task.priority}`} />
                      <p 
                        className={`task-content-lbl ${task.isChecked ? 'line-through' : ''}`}
                        style={task.isChecked ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}}
                      >
                        {parentTask && (
                          <span style={{ opacity: 0.6, fontWeight: 'normal', marginRight: '4px' }}>
                            {parentTask.content} › 
                          </span>
                        )}
                        {task.content}
                      </p>
                    </div>
                    <div className="card-note-origin" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FileText size={10} />
                        <span>{task.noteName}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-assign-date"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSchedulingModal({
                            taskId: task.id,
                            taskName: task.content,
                            dateStr: format(currentDate, 'yyyy-MM-dd'),
                            startTime: '10:00',
                            endTime: '11:00',
                            projectTag: '',
                            isEditMode: false
                          });
                        }}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '9px',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                        title={`Seçili tarihe (${format(currentDate, 'd MMM', { locale: tr })}) planla`}
                      >
                        Planla
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Section: Selected Task Note Editor (NotesView) */}
        <div
          className="calendar-note-panel"
          style={{
            borderTop: '1px solid var(--border-color)',
            paddingTop: '12px',
            marginTop: '12px',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: '220px',
            overflow: 'hidden'
          }}
        >
          {!selectedTaskNotePath ? (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              textAlign: 'center',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '8px',
              border: '1px dashed rgba(255,255,255,0.08)',
              color: 'var(--text-muted)'
            }}>
              <FileText size={28} style={{ opacity: 0.4, marginBottom: '8px' }} />
              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Göreve Tıklayarak Not Alın
              </span>
              <span style={{ fontSize: '11px', opacity: 0.7, maxWidth: '220px' }}>
                Takvimdeki herhangi bir göreve tıkladığınızda not içeriği burada açılır ve doğrudan düzenleyebilirsiniz.
              </span>
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <NotesView
                selectedFolder={null}
                selectedTag={null}
                fileContents={fileContents}
                notes={notes}
                activeNotePath={selectedTaskNotePath}
                setActiveNotePath={setSelectedTaskNotePath}
                onSaveNote={onSaveNote}
                onDeletePath={onDeletePath}
                onCreateNote={onCreateNote}
                readNoteContent={readNoteContent}
                onRenameNote={onRenameNote}
                onRequestConfirm={onRequestConfirm}
                onQuestReward={onQuestReward}
                hideSidebar={true}
                templatesFolder={templatesFolder}
                mindmapLayouts={mindmapLayouts}
                onSaveMindmapLayout={onSaveMindmapLayout || (async () => {})}
                pinnedWidgetLists={pinnedWidgetLists}
                pinnedWidgetList={pinnedWidgetList}
                onUpdatePinnedWidgets={onUpdatePinnedWidgets}
                isFlowEffectsEnabled={isFlowEffectsEnabled}
                lineHeight={1.25}
                lineMargin={2}
              />
            </div>
          )}
        </div>
      </div>

      {popoverState && createPortal(
        <div
          className="subtask-hover-popover animate-fade"
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
          style={{
            position: 'fixed',
            top: `${popoverState.rect.top}px`,
            left: `${(popoverState.rect.left + popoverState.rect.width + 268) > window.innerWidth
              ? popoverState.rect.left - 268
              : popoverState.rect.left + popoverState.rect.width + 8}px`,
            width: '260px',
            zIndex: 1000,
            background: 'rgba(24, 24, 27, 0.9)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(6, 182, 212, 0.4)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 15px rgba(6, 182, 212, 0.2)',
            borderRadius: '8px',
            padding: '12px',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#06b6d4', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Alt Görevler
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'bold' }}>
              {popoverState.task.subtasks?.filter(s => s.isChecked).length}/{popoverState.task.subtasks?.length}
            </span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
            {popoverState.task.subtasks?.map(sub => (
              <div
                key={sub.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '4px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  transition: 'background 0.2s',
                  cursor: 'pointer'
                }}
                onClick={async (e) => {
                  e.stopPropagation();
                  const newChecked = !sub.isChecked;
                  
                  // 1. Optimistic update of UI
                  setTasks(prevTasks => prevTasks.map(t => {
                    if (t.id === popoverState.task.id) {
                      const updatedSubtasks = t.subtasks?.map(s => s.id === sub.id ? { ...s, isChecked: newChecked } : s) || [];
                      return { ...t, subtasks: updatedSubtasks };
                    }
                    if (t.id === sub.id) {
                      return { ...t, isChecked: newChecked };
                    }
                    return t;
                  }));

                  setPopoverState(prev => {
                    if (!prev) return null;
                    const updatedSubtasks = prev.task.subtasks?.map(s => s.id === sub.id ? { ...s, isChecked: newChecked } : s) || [];
                    return {
                      ...prev,
                      task: { ...prev.task, subtasks: updatedSubtasks }
                    };
                  });

                  // 2. Save to file
                  try {
                    const fileContent = await readNoteContent(sub.filePath);
                    const lines = fileContent.split('\n');
                    if (sub.lineIdx >= 0 && sub.lineIdx < lines.length) {
                      const rawLine = lines[sub.lineIdx];
                      const match = rawLine.match(/^(\s*[*\-]\s+\[)([ xX/])(\]\s*.*)$/);
                      if (match) {
                        const prefix = match[1];
                        const currentStatus = match[2];
                        const suffix = match[3];
                        const newStatus = newChecked ? 'x' : ' ';
                        lines[sub.lineIdx] = `${prefix}${newStatus}${suffix}`;
                        const newContent = lines.join('\n');
                        await onSaveNote(sub.filePath, newContent);
                        setRefreshTrigger(prev => prev + 1);
                      }
                    }
                  } catch (err) {
                    console.error('Error saving subtask check from popover:', err);
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
                  {sub.isChecked ? (
                    <CheckCircle2 size={13} style={{ color: '#10b981' }} />
                  ) : (
                    <Circle size={13} style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <span style={{
                  fontSize: '11px',
                  color: sub.isChecked ? 'var(--text-muted)' : '#fff',
                  textDecoration: sub.isChecked ? 'line-through' : 'none',
                  lineHeight: '1.3',
                  flex: 1
                }}>
                  {sub.content}
                </span>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

      {schedulingModalData && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(10, 10, 12, 0.6)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100
          }}
          onClick={() => setSchedulingModalData(null)}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '450px',
              width: '90%',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(6, 182, 212, 0.15)',
              color: 'var(--text-primary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#06b6d4', margin: 0 }}>
                Akıllı Planlama Asistanı
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Sürüklediğiniz görev birden çok alt görev içeriyor. Nasıl planlamak istersiniz?
              </p>
            </div>

            <div style={{
              padding: '12px',
              background: 'var(--bg-tertiary)',
              border: '1px dashed var(--border-color)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                {schedulingModalData.task.content}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                📋 {schedulingModalData.task.subtasks?.length} alt görev içeriyor
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={async () => {
                  const rememberCheckbox = document.getElementById('remember-sched-choice') as HTMLInputElement;
                  if (rememberCheckbox?.checked) {
                    localStorage.setItem('subtaskSchedulingChoice', 'group');
                  }
                  await handleScheduleTask(
                    schedulingModalData.task.id,
                    schedulingModalData.dateStr,
                    schedulingModalData.timeSlot
                  );
                  setSchedulingModalData(null);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '2px',
                  padding: '12px',
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s'
                }}
                className="modal-choice-btn"
              >
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#818cf8' }}>
                  📦 Grup Olarak Planla (Plan as Group)
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Ana görevi tek bir blok halinde yerleştirir. Alt görevleri kartın hover menüsünden takip edebilirsiniz.
                </span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  const rememberCheckbox = document.getElementById('remember-sched-choice') as HTMLInputElement;
                  if (rememberCheckbox?.checked) {
                    localStorage.setItem('subtaskSchedulingChoice', 'distribute');
                  }
                  await handleDistributeSubtasks(
                    schedulingModalData.task,
                    schedulingModalData.dateStr,
                    schedulingModalData.timeSlot
                  );
                  setSchedulingModalData(null);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '2px',
                  padding: '12px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s'
                }}
                className="modal-choice-btn"
              >
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#34d399' }}>
                  ⚡ Alt Görevleri Sırayla Dağıt (Distribute Sequentially)
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Her alt görevi sırayla 30'ar dakikalık ardışık ayrı kartlar olarak dağıtır.
                </span>
              </button>
            </div>

            {/* Remember my choice checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                id="remember-sched-choice"
                type="checkbox"
                style={{ accentColor: '#06b6d4', width: '14px', height: '14px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Tercihimi hatırla (bir sonraki sürüklemede bu modalı gösterme)
              </span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('subtaskSchedulingChoice');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(239, 68, 68, 0.6)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: '4px'
                }}
              >
                🔄 Kaydedilmiş tercihi sıfırla
              </button>
              <button
                type="button"
                onClick={() => setSchedulingModalData(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  padding: '6px 12px',
                  borderRadius: '4px'
                }}
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}

      {calendarContextMenu && createPortal(
        <div
          onClick={() => setCalendarContextMenu(null)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2500 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: calendarContextMenu.y,
              left: calendarContextMenu.x,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              padding: '6px',
              minWidth: '180px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}
          >
            {!calendarContextMenu.showBookPicker ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSchedulingModal({
                      taskName: '',
                      dateStr: calendarContextMenu.dateStr,
                      startTime: calendarContextMenu.startTime,
                      endTime: calendarContextMenu.endTime,
                      projectTag: '',
                      isEditMode: false
                    });
                    setCurrentDate(calendarContextMenu.dayDate);
                    setCalendarContextMenu(null);
                  }}
                  style={contextMenuBtnStyle}
                >
                  🆕 Yeni Task
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarContextMenu({ ...calendarContextMenu, showBookPicker: true })}
                  disabled={bookNames.length === 0}
                  style={{ ...contextMenuBtnStyle, opacity: bookNames.length === 0 ? 0.5 : 1, cursor: bookNames.length === 0 ? 'not-allowed' : 'pointer' }}
                  title={bookNames.length === 0 ? 'Kütüphanede henüz kitap yok' : undefined}
                >
                  📚 Kitap Oku
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Hangi kitap?</div>
                {bookNames.map(name => (
                  <button key={name} type="button" onClick={() => handlePickBookForReading(name)} style={contextMenuBtnStyle}>
                    {name}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {activeSchedulingModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(10, 10, 12, 0.75)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000
          }}
          onClick={() => setActiveSchedulingModal(null)}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--accent-color)' }}>
              {activeSchedulingModal.isEditMode ? 'Görevi Düzenle' : (activeSchedulingModal.taskId ? 'Görevi Planla' : 'Yeni Görev Ekle')}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>GÖREV ADI</label>
              <input
                type="text"
                value={activeSchedulingModal.taskName}
                onChange={(e) => setActiveSchedulingModal({ ...activeSchedulingModal, taskName: e.target.value })}
                placeholder="Örn: Raporu tamamla"
                disabled={!!activeSchedulingModal.taskId && !activeSchedulingModal.isEditMode}
                autoFocus
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  padding: '8px 12px',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
            </div>

            {(!activeSchedulingModal.taskId || activeSchedulingModal.isEditMode) && clientNames.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>MÜŞTERİ (opsiyonel)</label>
                <select
                  value={modalClientFilter}
                  onChange={(e) => {
                    // Müşteri değişince, artık listede olmayan bir proje seçili kalmasın
                    setModalClientFilter(e.target.value);
                    setActiveSchedulingModal({ ...activeSchedulingModal, projectTag: '' });
                  }}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                >
                  <option value="">Müşteri seçme</option>
                  {clientNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {(!activeSchedulingModal.taskId || activeSchedulingModal.isEditMode) && projectNames.length > 0 && (() => {
              const visibleProjectNames = modalClientFilter
                ? projectNames.filter(name => (clientProjectSlugs[modalClientFilter] || []).includes(name.toLocaleLowerCase('tr').replace(/\s+/g, '-')))
                : projectNames;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>PROJE (opsiyonel)</label>
                  <select
                    value={activeSchedulingModal.projectTag}
                    onChange={(e) => setActiveSchedulingModal({ ...activeSchedulingModal, projectTag: e.target.value })}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      fontSize: '13px',
                      outline: 'none'
                    }}
                  >
                    <option value="">Proje seçme</option>
                    {visibleProjectNames.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  {modalClientFilter && visibleProjectNames.length === 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Bu müşterinin projesi yok.</span>
                  )}
                </div>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>TARİH</label>
              <input
                type="date"
                value={activeSchedulingModal.dateStr}
                onChange={(e) => setActiveSchedulingModal({ ...activeSchedulingModal, dateStr: e.target.value })}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  padding: '8px 12px',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>BAŞLANGIÇ</label>
                <input
                  type="time"
                  value={activeSchedulingModal.startTime}
                  onChange={(e) => setActiveSchedulingModal({ ...activeSchedulingModal, startTime: e.target.value })}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>BİTİŞ</label>
                <input
                  type="time"
                  value={activeSchedulingModal.endTime}
                  onChange={(e) => setActiveSchedulingModal({ ...activeSchedulingModal, endTime: e.target.value })}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    padding: '8px 12px',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            {!activeSchedulingModal.taskId && !activeSchedulingModal.isEditMode && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  checked={keepExistingPlan}
                  onChange={(e) => setKeepExistingPlan(e.target.checked)}
                />
                Aynı isimde açık bir görev varsa TAŞIMA, bu güne EK bir oturum olarak ekle
              </label>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => { setActiveSchedulingModal(null); setKeepExistingPlan(false); }}
                style={{
                  flex: 1,
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-secondary)',
                  padding: '10px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!activeSchedulingModal.taskName.trim()}
                onClick={async () => {
                  const { taskId, taskName, dateStr, startTime, endTime, projectTag, isEditMode } = activeSchedulingModal;
                  const timeSlot = `${startTime}-${endTime}`;
                  const projectSlug = projectTag ? projectTag.toLocaleLowerCase('tr').replace(/\s+/g, '-') : undefined;
                  if (taskId) {
                    if (isEditMode) {
                      await handleEditTask(taskId, taskName, dateStr, timeSlot, projectSlug);
                    } else {
                      handleDropTask(taskId, dateStr, timeSlot);
                      setIsUnplannedOpen(false);
                    }
                  } else {
                    await handleCreateQuickTask(taskName, dateStr, timeSlot, projectSlug, keepExistingPlan);
                  }
                  setActiveSchedulingModal(null);
                  setKeepExistingPlan(false);
                }}
                style={{
                  flex: 1,
                  background: 'var(--accent-color)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  padding: '10px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  opacity: activeSchedulingModal.taskName.trim() ? 1 : 0.5
                }}
              >
                {activeSchedulingModal.isEditMode ? 'Kaydet' : (activeSchedulingModal.taskId ? 'Planla' : 'Ekle')}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTimesTask && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setEditingTimesTask(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '380px',
              maxWidth: '92%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                🕐 Zamanları Düzenle
              </h3>
              <button onClick={() => setEditingTimesTask(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              {editingTimesTask.content}
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              İşi gerçekte ne zaman yaptıysan onu gir — dakiklik puanı buna göre yeniden hesaplanır. Bir alanı boşaltmak o damgayı tamamen kaldırır (ör. yanlışlıkla basılan "Başla"yı geri almak için başlangıcı boşalt).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>Başlangıç</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="datetime-local"
                  value={editStartLocal}
                  onChange={(e) => setEditStartLocal(e.target.value)}
                  style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '12px' }}
                />
                {editStartLocal && (
                  <button type="button" onClick={() => setEditStartLocal('')} title="Başlangıcı kaldır" className="btn-modal-cancel" style={{ padding: '0 10px' }}>✕</button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>Tamamlanma</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="datetime-local"
                  value={editCompletedLocal}
                  onChange={(e) => setEditCompletedLocal(e.target.value)}
                  style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '12px' }}
                />
                {editCompletedLocal && (
                  <button type="button" onClick={() => setEditCompletedLocal('')} title="Tamamlanmayı kaldır" className="btn-modal-cancel" style={{ padding: '0 10px' }}>✕</button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button type="button" className="btn-modal-cancel" onClick={() => setEditingTimesTask(null)}>Vazgeç</button>
              <button type="button" className="btn-modal-confirm" onClick={handleSaveEditedTimes}>Kaydet</button>
            </div>
          </div>
        </div>
      )}

      {isSyncModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setIsSyncModalOpen(false)}
        >
          <div 
            style={{
              width: '420px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              color: '#fff',
              fontFamily: 'sans-serif'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 'bold' }}>🗓️ Dış Takvimleri Bağla (iCal)</h3>
              <button 
                onClick={() => setIsSyncModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Google iCal URL Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '16px' }}>🔵</span>
                    <label style={{ fontSize: '12.5px', fontWeight: 'bold', color: '#94a3b8' }}>Google Calendar iCal Linki</label>
                  </div>
                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5): */}
                  // Google Takvim bağlantısını geçici olarak açıp kapatmayı sağlayan toggle checkbox'ı.
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', gap: '6px', fontSize: '11px', color: '#94a3b8' }}>
                    <span>Aktif</span>
                    <input 
                      type="checkbox"
                      checked={googleActive}
                      onChange={(e) => setGoogleActive(e.target.checked)}
                      style={{ cursor: 'pointer', width: '13px', height: '13px', accentColor: 'var(--accent-color)' }}
                    />
                  </label>
                </div>
                <input 
                  type="text"
                  placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                  value={googleInput}
                  onChange={(e) => setGoogleInput(e.target.value)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '10px 12px',
                    fontSize: '12.5px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Outlook iCal URL Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '16px' }}>🔴</span>
                    <label style={{ fontSize: '12.5px', fontWeight: 'bold', color: '#94a3b8' }}>Outlook Calendar iCal Linki</label>
                  </div>
                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5): */}
                  // Outlook Takvim bağlantısını geçici olarak açıp kapatmayı sağlayan toggle checkbox'ı.
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', gap: '6px', fontSize: '11px', color: '#94a3b8' }}>
                    <span>Aktif</span>
                    <input 
                      type="checkbox"
                      checked={outlookActive}
                      onChange={(e) => setOutlookActive(e.target.checked)}
                      style={{ cursor: 'pointer', width: '13px', height: '13px', accentColor: 'var(--accent-color)' }}
                    />
                  </label>
                </div>
                <input 
                  type="text"
                  placeholder="https://outlook.live.com/owa/calendar/.../calendar.ics"
                  value={outlookInput}
                  onChange={(e) => setOutlookInput(e.target.value)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '10px 12px',
                    fontSize: '12.5px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Actions */}
              <button
                onClick={() => {
                  const urls = { google: googleInput.trim(), outlook: outlookInput.trim() };
                  setCalendarUrls(urls);
                  localStorage.setItem('calendar_urls', JSON.stringify(urls));

                  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                  // Sadece link girilmişse VE aktiflik seçilmişse takvimi bağlı (aktif) kabul eder.
                  const conns = { 
                    google: googleActive && !!urls.google, 
                    outlook: outlookActive && !!urls.outlook 
                  };
                  setConnectedCalendars(conns);
                  localStorage.setItem('connected_calendars', JSON.stringify(conns));

                  setIsSyncModalOpen(false);
                }}
                style={{
                  background: 'var(--accent-color)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  marginTop: '6px',
                  transition: 'background 0.2s'
                }}
              >
                Kaydet ve Eşitle 🔄
              </button>

              {/* "Nasıl Alınır?" Guide */}
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '11px',
                lineHeight: '1.5',
                color: 'var(--text-muted)'
              }}>
                <div style={{ fontWeight: 'bold', color: '#e2e8f0', marginBottom: '6px' }}>🔗 iCal Linkleri Nasıl Alınır?</div>
                
                <div style={{ marginBottom: '8px' }}>
                  <strong>Google:</strong> Takvim Ayarları &gt; İlgili Takvime Tıkla &gt; Takvimi Entegre Et &gt; <strong>"iCal biçimindeki gizli adres"</strong> URL'sini kopyalayıp buraya yapıştırın.
                </div>
                
                <div>
                  <strong>Outlook:</strong> Outlook Web &gt; Ayarlar &gt; Takvim &gt; Paylaşılan Takvimler &gt; Takvim yayınla &gt; <strong>"ICS linkini"</strong> kopyalayıp buraya yapıştırın.
                </div>
              </div>

              {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                  İSTEK: bazı dış takvim etkinlikleri (ör. günlük toplantılar) takvimi kalabalıklaştırıyor —
                  kullanıcı bir etkinliğe tıklayıp "Gizle" diyerek başlığa göre kalıcı olarak gizleyebiliyor
                  (bkz. hideExternalEventTitle). Burada gizlenenleri görüp geri getirebiliyor. */}
              {hiddenExternalTitles.length > 0 && (
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '11px',
                  color: 'var(--text-muted)'
                }}>
                  <div style={{ fontWeight: 'bold', color: '#e2e8f0', marginBottom: '8px' }}>
                    🙈 Gizlenen Etkinlikler ({hiddenExternalTitles.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                    {hiddenExternalTitles.map(title => (
                      <div key={title} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={title}>{title}</span>
                        <button
                          type="button"
                          onClick={() => restoreExternalEventTitle(title)}
                          style={{
                            flexShrink: 0, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                            borderRadius: '5px', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '10.5px',
                            fontWeight: 600, padding: '3px 8px'
                          }}
                        >
                          Geri Getir
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {externalEventInfoModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 2100,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          onClick={() => setExternalEventInfoModal(null)}
        >
          <div
            style={{
              width: '340px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: '12px', padding: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: '#fff'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: externalEventInfoModal.source === 'google' ? '#4285F4' : '#0078d4',
                color: '#fff', fontSize: '10px', fontWeight: 'bold', borderRadius: '4px', width: '18px', height: '18px'
              }}>
                {externalEventInfoModal.source === 'google' ? 'G' : 'O'}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {externalEventInfoModal.source === 'google' ? 'Google Calendar' : 'Outlook Calendar'}
              </span>
            </div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700 }}>{externalEventInfoModal.content}</h3>
            <p style={{ margin: '0 0 18px 0', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              {externalEventInfoModal.dueDate}{externalEventInfoModal.timeSlot ? ` (${externalEventInfoModal.timeSlot})` : ''}
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setExternalEventInfoModal(null)}
                style={{
                  flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '8px',
                  color: 'var(--text-secondary)', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                }}
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => {
                  hideExternalEventTitle(externalEventInfoModal.content);
                  setExternalEventInfoModal(null);
                }}
                title="Bu başlıktaki tüm etkinlikleri takvimden gizler (Dış Takvim Eşitle menüsünden geri getirebilirsiniz)"
                style={{
                  flex: 1, background: '#ef4444', border: 'none', borderRadius: '8px',
                  color: '#fff', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                }}
              >
                🙈 Bu Etkinliği Gizle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const contextMenuBtnStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  padding: '8px 10px',
  fontSize: '13px',
  cursor: 'pointer'
};
