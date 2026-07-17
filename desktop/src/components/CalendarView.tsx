import React, { useState, useEffect, useRef } from 'react';
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
  ChevronUp
} from 'lucide-react';

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
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
  onCreateDailyNote: (dateStr: string) => void;
  onSelectDateNotes: (dateStr: string) => void;
  embedded?: boolean; // Sağ hızlı erişim panelinde küçük "günlük takvim" olarak gömülüyken sadeleştirilmiş görünüm
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
  isSubtask?: boolean;
  parentTaskId?: string | null;
  subtasks?: WorkspaceSubTask[];
  isExternal?: boolean;
  externalSource?: 'google' | 'outlook';
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

export default function CalendarView({
  notes,
  folders,
  tags,
  readNoteContent,
  onSaveNote,
  onCreateDailyNote,
  onSelectDateNotes,
  embedded = false
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'threeDay' | 'day'>(() => {
    if (embedded) return 'day';
    return (isElectron || isBrowser) ? 'week' : 'day';
  });
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Scanned task states
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
    ...externalEvents.map(evt => ({
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
      isExternal: true,
      externalSource: evt.source
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

  // Auto-scroll to current time slot when view mode switches
  useEffect(() => {
    if (viewMode === 'month') return;
    
    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        
        // 1 hour = 60px
        const targetTop = currentHour * 60 + currentMin;
        const containerHeight = scrollContainerRef.current.clientHeight;
        const scrollTo = Math.max(0, targetTop - containerHeight / 2);
        
        scrollContainerRef.current.scrollTo({
          top: scrollTo,
          behavior: 'smooth'
        });
      }
    }, 150); // slight delay to guarantee DOM renders container
    
    return () => clearTimeout(timer);
  }, [viewMode]);

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
  } | null>(null);

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
        const tagRegexGlobal = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
        const noteLevelTags: string[] = [];
        let noteTagMatch;
        while ((noteTagMatch = tagRegexGlobal.exec(content)) !== null) {
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
            let cleanContent = rawText
              .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
              .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
              .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
              .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
              .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // Strip capture timestamp
              .replace(/\s+/g, ' ')
              .trim();

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
              score,
              tags: Array.from(new Set([...taskTags, ...noteLevelTags])),
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
              isSubtask: true,
              parentTaskId: p.id
            };
            break;
          }
        }
      }
    }
    if (!task) return;

    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');
      if (task.lineIdx < 0 || task.lineIdx >= lines.length) return;

      const rawLine = lines[task.lineIdx];
      const lineBodyMatch = rawLine.match(/^(\s*[*\-]\s+\[[ xX]\]\s+)(.*)$/);
      
      let cleanText = '';
      let prefix = '';
      if (lineBodyMatch) {
        prefix = lineBodyMatch[1];
        cleanText = lineBodyMatch[2]
          .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
          .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      } else {
        const match = rawLine.match(/^(\s*)/);
        prefix = match ? match[1] : '';
        cleanText = rawLine
          .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
          .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      let appendStr = ` [due:${dateStr}]`;
      if (timeSlot) {
        appendStr += ` [time:${timeSlot}]`;
      }

      lines[task.lineIdx] = `${prefix}${cleanText}${appendStr}`;

      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error scheduling task in Calendar:', err);
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
              isSubtask: true,
              parentTaskId: p.id
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
        
        const lineBodyMatch = rawLine.match(/^(\s*[*\-]\s+\[[ xX]\]\s+)(.*)$/);
        
        let cleanText = '';
        let prefix = '';
        if (lineBodyMatch) {
          prefix = lineBodyMatch[1];
          cleanText = lineBodyMatch[2]
            .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
            .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        } else {
          const match = rawLine.match(/^(\s*)/);
          prefix = match ? match[1] : '';
          cleanText = rawLine
            .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
            .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        }

        const subTimeSlot = `${formatTimeStr(currentStartMins)}-${formatTimeStr(currentStartMins + 30)}`;
        currentStartMins += 30;

        let appendStr = ` [due:${dateStr}] [time:${subTimeSlot}]`;
        lines[sub.lineIdx] = `${prefix}${cleanText}${appendStr}`;
      });

      const newContent = lines.join('\n');
      await onSaveNote(parentTask.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error distributing subtasks:', err);
    }
  };

  // Unschedule: remove [due:...] and [time:...] tags from a task and its subtasks
  const handleUnscheduleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      const fileContent = await readNoteContent(task.filePath);
      const lines = fileContent.split('\n');
      
      // Clear parent task
      if (task.lineIdx >= 0 && task.lineIdx < lines.length) {
        lines[task.lineIdx] = lines[task.lineIdx]
          .replace(/\s*\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
          .replace(/\s*\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
          .replace(/\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '');
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
      const match = rawLine.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
      if (!match) return;

      const prefix = match[1];
      const currentStatus = match[2];
      const suffix = match[3];

      const newStatus = currentStatus.toLowerCase() === 'x' ? ' ' : 'x';
      lines[task.lineIdx] = `${prefix}${newStatus}${suffix}`;

      const newContent = lines.join('\n');
      await onSaveNote(task.filePath, newContent);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Error toggling task:', err);
    }
  };

  // Click to create scheduled task
  const handleCreateQuickTask = async (content: string, dateStr: string, timeSlot: string | null) => {
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
        taskLine += ` [time:${timeSlot}]`;
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

    // rawHeightPx: sürükleme sırasında piksel cinsinden ham süre (1px = 1dk).
    // Geri dönüş: snap'lenmiş MUTLAK bitiş dakikası (gece yarısından itibaren).
    const snapEndAbsMinutes = (rawHeightPx: number) => {
      const rawEndAbs = startMinutesAbs + rawHeightPx;
      const snappedEndAbs = Math.round(rawEndAbs / SNAP_MINUTES) * SNAP_MINUTES;
      return Math.max(startMinutesAbs + SNAP_MINUTES, snappedEndAbs); // en az 15 dk süre
    };

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizingEvent.startY;
      const rawHeight = Math.max(30, resizingEvent.startHeight + deltaY);
      const snappedEndAbs = snapEndAbsMinutes(rawHeight);
      const newHeight = snappedEndAbs - startMinutesAbs;

      setTempEventHeights(prev => ({
        ...prev,
        [resizingEvent.taskId]: newHeight
      }));
    };

    const handleMouseUp = async (e: MouseEvent) => {
      const deltaY = e.clientY - resizingEvent.startY;
      const finalHeight = Math.max(30, resizingEvent.startHeight + deltaY);
      const newEndMinutes = snapEndAbsMinutes(finalHeight); // mutlak, 15 dk çizgisine yapışık

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
  }, [resizingEvent]);

  // Dynamic Drag-to-Create hook
  useEffect(() => {
    if (!dragToCreate) return;

    const handleMouseMove = (e: MouseEvent) => {
      const colEl = document.querySelector(`[data-day-col="${dragToCreate.dateStr}"]`);
      if (!colEl) return;
      const rect = colEl.getBoundingClientRect();
      const currentY = e.clientY - rect.top;
      const currentMin = Math.max(0, Math.min(1440, currentY));
      
      const diff = Math.abs(currentMin - dragToCreate.startMin);
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
        const startPixel = Math.min(minA, minB);
        const endPixel = Math.max(minA, minB);

        // Convert pixels to absolute day minutes (00:00 = 0px, no offset)
        const startAbsMin = startPixel;
        const endAbsMin = endPixel;

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
          endTime: formatTimeStr(finalEndAbsMin)
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
  }, [dragToCreate]);

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
    
    // Grid matches 00:00 to 24:00 (24 hours = 1440px, so 1 hour = 60px, 1 min = 1px)
    const startMinutes = mouseY; // direct pixel = minute from midnight
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
      endTime: formatTimeStr(endHour, endMin)
    });
    setCurrentDate(dayDate);
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
                  const dayTasks = allMergedEvents.filter(t => t.dueDate === dayStr);
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
                              <span 
                                className="mini-task-text"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (task.isExternal) {
                                    alert(`Takvim Etkinliği:\n\n📅 ${task.content}\nKaynak: ${task.externalSource === 'google' ? 'Google Calendar' : 'Outlook Calendar'}\nTarih: ${task.dueDate} ${task.timeSlot ? `(${task.timeSlot})` : ''}`);
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
                    return (
                      <div 
                        key={format(day, 'yyyy-MM-dd')} 
                        className={`day-col-header ${isTod ? 'today' : ''}`}
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
                    const dayAlldayTasks = allMergedEvents.filter(t => t.dueDate === dayStr && !t.timeSlot);
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
                <div className="scheduler-grid-relative">
                  
                  {/* Left Column: Time Axis Labels */}
                  <div className="time-axis-column">
                    {Array.from({ length: 24 }).map((_, i) => {
                      const h = i;
                      return (
                        <div key={h} className="time-hour-row">
                          <span>{String(h).padStart(2, '0')}:00</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Columns Grid columns for drops and events mapping */}
                  <div className="day-columns-grid">
                    {activeDaysList.map(day => {
                      const dayStr = format(day, 'yyyy-MM-dd');
                      
                      // Background grid lines drawing
                      const gridLines = Array.from({ length: 24 }).map((_, i) => (
                        <div key={i} className="scheduler-grid-hour-line" />
                      ));

                      // Scanned events scheduled in this day column
                      const dayScheduledEvents = allMergedEvents.filter(t => t.dueDate === dayStr && t.timeSlot);

                      return (
                        <div
                          key={dayStr}
                          data-day-col={dayStr}
                          className="scheduler-day-column"
                          onMouseDown={(e) => {
                            if (e.button !== 0) return; // Only trigger for left click
                            const rect = e.currentTarget.getBoundingClientRect();
                            const startY = e.clientY - rect.top;
                            const startMin = Math.max(0, Math.min(1440, startY));
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
                          onDragOver={(e) => {
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const mouseY = e.clientY - rect.top;
                            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                            // 15 dakikalık takvim çizgisine yapıştır (30 dk yerine) — resize ile tutarlı.
                            const snappedMin = Math.round(mouseY / 15) * 15;
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

                            // 1440px height corresponds to 24 hours (00:00 to 24:00)
                            // 1 hour = 60px, so 1 min = 1px.
                            const totalMinutes = mouseY;
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
                            const indicatorTop = currentHour * 60 + currentMin;

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
                            const top = Math.min(dragToCreate.startMin, dragToCreate.currentMin);
                            const height = Math.abs(dragToCreate.startMin - dragToCreate.currentMin);
                            
                            // Calculate dynamic time display for draft card (00:00 base)
                            const startAbsMin = top;
                            const endAbsMin = top + height;
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
                            const ghostTop = dragGhostState.snappedMin;
                            const ghostHeight = dragGhostState.durationMin;
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

                              // Starts at 00:00 (0 minutes) — pixel = minute from midnight
                              const top = Math.max(0, startMinutes);
                              
                              // Check if we have a temporary dragging resize height in progress
                              const isResizingThis = resizingEvent && resizingEvent.taskId === task.id;
                              const height = isResizingThis
                                ? tempEventHeights[task.id] || (endMinutes - startMinutes) * 1
                                : (endMinutes - startMinutes) * 1;

                              // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                              // Süre sürüklenirken kart üzerindeki saat etiketi de canlı olarak
                              // güncellensin ki kullanıcı hangi saate geldiğini anında görebilsin.
                              const displayTimeSlot = isResizingThis
                                ? (() => {
                                    const liveEndTotal = startMinutes + height;
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

                              return (
                                <div
                                  key={task.id}
                                  draggable={!task.isExternal && !resizingEvent}
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
                                  onMouseEnter={(e) => handleMouseEnterCard(e, task)}
                                  onMouseLeave={handleMouseLeaveCard}
                                  className={`scheduled-event-card priority-${task.priority} ${task.isChecked ? 'completed' : ''}`}
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  style={{
                                    position: 'absolute',
                                    top: `${top}px`,
                                    height: `${height}px`,
                                    left: '4px',
                                    right: '4px',
                                    zIndex: isResizingThis ? 50 : 10,
                                    // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                                    // .scheduled-event-card sınıfı `transition: all 0.25s` tanımlıyor.
                                    // Bu, yükseklik 15dk'lık adımlarla sıçrasa bile CSS'in bunu yumuşak
                                    // bir animasyonla kaydırmasına (glide) neden olup "yapışma" hissini
                                    // yok ediyordu. Aktif sürükleme/resize sırasında geçişi kapatıyoruz
                                    // ki her 15dk'lık snap noktası anında, "tık" diye hissedilsin.
                                    transition: isResizingThis ? 'none' : undefined,
                                    cursor: task.isExternal ? 'default' : 'grab',
                                    padding: isSmallCard ? '2px 6px' : '6px 8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: isSmallCard ? '4px' : '6px',
                                    borderLeft: task.isExternal 
                                      ? `3px solid ${task.externalSource === 'google' ? '#4285F4' : '#0078d4'}` 
                                      : undefined
                                  }}
                                >
                                  {/* Drag Handle or Indicator bar */}
                                  {!task.isExternal && <div className="event-priority-bar" style={isSmallCard ? { height: '80%' } : undefined} />}
                                  
                                  {/* Dedicated Checkbox */}
                                  <div 
                                    className="event-checkbox-wrapper"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (task.isExternal) {
                                        alert(`Takvim Etkinliği:\n\n📅 ${task.content}\nKaynak: ${task.externalSource === 'google' ? 'Google Calendar' : 'Outlook Calendar'}\nTarih: ${task.dueDate} ${task.timeSlot ? `(${task.timeSlot})` : ''}`);
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
                                  
                                  <div className="event-card-content" style={{ 
                                    paddingBottom: isSmallCard ? '0px' : (totalSub > 0 ? '12px' : '4px'),
                                    justifyContent: isSmallCard ? 'center' : 'space-between',
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column'
                                  }}>
                                    {!isSmallCard && <span className="event-time-lbl">{displayTimeSlot}</span>}
                                    
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
                                        <span>{task.content}</span>
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
                                        <span>{task.content}</span>
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
                                  {!task.isChecked && (
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
                                  endTime: '11:00'
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
                              className={`unscheduled-subtask-card priority-${subPriority} ${isSubChecked ? 'completed' : ''}`}
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
                                        endTime: '11:00'
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
                            endTime: '11:00'
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
      </div>

      {popoverState && (
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
                      const match = rawLine.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
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
        </div>
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
              {activeSchedulingModal.taskId ? 'Görevi Planla' : 'Yeni Görev Ekle'}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>GÖREV ADI</label>
              <input
                type="text"
                value={activeSchedulingModal.taskName}
                onChange={(e) => setActiveSchedulingModal({ ...activeSchedulingModal, taskName: e.target.value })}
                placeholder="Örn: Raporu tamamla"
                disabled={!!activeSchedulingModal.taskId}
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

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setActiveSchedulingModal(null)}
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
                  const { taskId, taskName, dateStr, startTime, endTime } = activeSchedulingModal;
                  const timeSlot = `${startTime}-${endTime}`;
                  if (taskId) {
                    handleDropTask(taskId, dateStr, timeSlot);
                    setIsUnplannedOpen(false);
                  } else {
                    await handleCreateQuickTask(taskName, dateStr, timeSlot);
                  }
                  setActiveSchedulingModal(null);
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
                {activeSchedulingModal.taskId ? 'Planla' : 'Ekle'}
              </button>
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

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
