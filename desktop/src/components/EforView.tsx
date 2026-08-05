// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// İSTEK: "Efor" ekranı — şirketin zaman takip uygulamasına (Proje x Görev x Gün ızgarası,
// hh:mm giriş kutuları + Enter'da açılan açıklama modalı) veriyi PRATİK şekilde elle
// girebilmek için süre ve açıklamayı AYRI AYRI kopyalayabilme. Kullanıcı bilerek o ızgara
// arayüzünün birebir kopyasını istemedi — asıl ihtiyaç, tek tek göreve tıklayıp süreyi
// (hh:mm formatında, şirket uygulamasının beklediği gibi) ve açıklamayı ayrı butonlarla
// kopyalayıp sırayla diğer uygulamaya yapıştırabilmek. Gruplama PROJE bazlı (client değil)
// — şirket uygulamasındaki "Project" satırlarıyla birebir eşleşsin diye (bkz. projectNames).
// Veri kaynağı takvimdeki görevlerle AYNI — notlardaki [due:]/[time:] etiketli satırlar.
// Ayrıca GÜNLÜK/HAFTALIK görünüm arasında geçiş yapılabilir — kullanıcı efor girişini haftalık
// olarak da (Pazartesi-Pazar, her gün kendi proje gruplarıyla) görebilmek istedi.

import React, { useMemo, useState } from 'react';
import { Timer, Copy, Check, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock, Calendar as CalendarIcon } from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  updatedAt: number;
}

interface EforViewProps {
  notes: NoteItem[];
  fileContents: Record<string, string>;
  projectNames: string[];
}

interface EforTask {
  content: string;
  timeSlot: string;
  minutes: number;
}

interface EforGroup {
  project: string;
  totalMinutes: number;
  tasks: EforTask[];
}

interface EforDay {
  dateStr: string;
  groups: EforGroup[];
  totalMinutes: number;
}

const CHECKLIST_REGEX = /^(\s*)([*\-]\s+\[([ xX\/])\])\s+(.*)$/;
const DUE_REGEX = /\[due:(\d{4}-\d{2}-\d{2})\]/i;
const TIME_REGEX = /\[(?:plannedtime|time|window):(\d{2}):(\d{2})-(\d{2}):(\d{2})\]/i;
const TAG_REGEX = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
// Görünmez proje bağlantısı — CalendarView.tsx artık projeyi görünür "#slug" yerine bununla
// işaretliyor (kullanıcı isteği: görev adında etiket görünmesin). Eski #slug notlarla geriye
// dönük uyumluluk için TAG_REGEX ile birlikte ayrıca taranır.
const PROJECT_BRACKET_REGEX = /\[(?:project|proje):([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)\]/gi;

// Şirket uygulamasının "hh:mm" giriş formatı — 2 saat 30 dk -> "2:30" (saat kısmı sıfır
// dolgulu DEĞİL, dakika kısmı 2 haneli — çoğu zaman takip aracının beklediği yaygın format).
const formatDurationInput = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
};

const formatDurationReadable = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}dk`;
  if (m === 0) return `${h}s`;
  return `${h}s ${m}dk`;
};

const cleanTaskText = (rawText: string): string => rawText
  .replace(/\[(?:priority|p):(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
  .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
  .replace(/\[(?:plannedtime|time|window):\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
  .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
  .replace(/\[(?:started|baslangic|başlangıç|başlama):[^\]]+\]/gi, '')
  .replace(/\[(?:completed|tamamlanma):[^\]]+\]/gi, '')
  .replace(/\[(?:outcome|dakiklik):(?:fast|ontime|late|incomplete)\]/gi, '')
  .replace(/\[(?:project|proje):[^\]]+\]/gi, '')
  .replace(/\[başlama:[^\]]+\]/gi, '')
  .replace(/#[a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Bir tarihi YYYY-MM-DD string'ine çevirir (yerel saat diliminde, toISOString'in UTC kaymasına
// düşmeden — [[timezone bug]] ile aynı sınıf hataya tekrar düşmemek için).
const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Seçili tarihin ait olduğu haftanın Pazartesi'sini bulur (Pazartesi=haftanın ilk günü).
const getWeekStartDateStr = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = d.getDay(); // 0=Pazar, 1=Pazartesi, ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diffToMonday);
  return toDateStr(d);
};

const getWeekDates = (weekStartStr: string): string[] => {
  const start = new Date(weekStartStr + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return toDateStr(d);
  });
};

export default function EforView({ notes, fileContents, projectNames }: EforViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedWeekProject, setExpandedWeekProject] = useState<string | null>(null);

  const shiftDate = (deltaDays: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    setSelectedDate(toDateStr(d));
  };

  const shiftWeek = (deltaWeeks: number) => shiftDate(deltaWeeks * 7);

  const projectSlugToName = useMemo(() => {
    const map: Record<string, string> = {};
    projectNames.forEach(name => {
      map[name.toLowerCase().replace(/\s+/g, '-')] = name;
    });
    return map;
  }, [projectNames]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Günlük VE haftalık görünümün İKİSİ de aynı taramayı kullanır — tek bir tarih için proje
  // gruplarını hesaplayan saf fonksiyon, hem "groups" (günlük) hem "weekDays" (haftalık,
  // 7 kez çağrılır) tarafından paylaşılır.
  const computeGroupsForDate = (dateStr: string): EforGroup[] => {
    const projectOf = (tags: string[]): string => {
      for (const tag of tags) {
        if (projectSlugToName[tag]) return projectSlugToName[tag];
      }
      return 'Diğer / Atanmamış';
    };

    const byProject: Record<string, EforGroup> = {};

    notes.forEach(note => {
      if (note.type !== 'note') return;
      const content = fileContents[note.path] || '';
      if (!content.includes(dateStr)) return; // hızlı ön-eleme, tam regex kontrolü aşağıda

      const lines = content.split('\n');

      // CalendarView.tsx'teki (parentStack ile girinti bazlı üst-alt görev) mantığın AYNISI:
      // "Ana görevi tek blok olarak planla" seçildiğinde alt görevler kendi [due:]/[time:]
      // etiketini ALMAZ — sadece ana görev satırı planlanır. Bu yüzden Efor'daki açıklamaya,
      // kendi tarih/saati OLMAYAN alt görevlerin adlarını da ekliyoruz; kendi [due:]/[time:]
      // etiketi olan alt görevler (dağıtılmış olanlar) zaten kendi satırları olarak ayrı
      // görünecek, burada tekrar eklenmez.
      type ParsedLine = { idx: number; indent: number; rawText: string; parentIdx: number | null; hasOwnDueTime: boolean };
      const parsed: ParsedLine[] = [];
      const stack: { indent: number; idx: number }[] = [];

      lines.forEach((line, idx) => {
        const checklistMatch = line.match(CHECKLIST_REGEX);
        if (!checklistMatch) {
          if (line.trim().length > 0 && !line.match(/^\s*[*\-]\s+/)) stack.length = 0;
          return;
        }
        const indent = checklistMatch[1].length;
        const rawText = checklistMatch[4];

        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
        const parentIdx = stack.length > 0 ? stack[stack.length - 1].idx : null;
        stack.push({ indent, idx });

        const dueMatch = rawText.match(DUE_REGEX);
        const timeMatch = rawText.match(TIME_REGEX);
        parsed.push({ idx, indent, rawText, parentIdx, hasOwnDueTime: !!(dueMatch && timeMatch) });
      });

      const childrenOf = (parentIdx: number): ParsedLine[] => parsed.filter(p => p.parentIdx === parentIdx);

      // Kendi [due:]/[time:] etiketi OLMAYAN alt görevlerin temizlenmiş adlarını, alt-alt
      // görevleri de dahil ederek düz bir listeye toplar.
      const collectUntaggedDescendantNames = (parentIdx: number): string[] => {
        const names: string[] = [];
        childrenOf(parentIdx).forEach(child => {
          if (child.hasOwnDueTime) return; // kendi satırı olarak ayrı zaten görünecek
          const name = cleanTaskText(child.rawText);
          if (name) names.push(name);
          names.push(...collectUntaggedDescendantNames(child.idx));
        });
        return names;
      };

      parsed.forEach(p => {
        const dueMatch = p.rawText.match(DUE_REGEX);
        if (!dueMatch || dueMatch[1] !== dateStr) return;
        const timeMatch = p.rawText.match(TIME_REGEX);
        if (!timeMatch) return; // Efor hesaplaması için saat aralığı şart

        const startMin = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
        const endMin = parseInt(timeMatch[3], 10) * 60 + parseInt(timeMatch[4], 10);
        const minutes = Math.max(0, endMin - startMin);
        const timeSlot = `${timeMatch[1]}:${timeMatch[2]}-${timeMatch[3]}:${timeMatch[4]}`;

        // BUG DÜZELTMESİ: Etiketler SADECE bu satırdan (rawText) okunur — aynı günün
        // notundaki BAŞKA bir görevin proje etiketi buraya asla sızmaz (bkz. CalendarView.tsx
        // ownTags ile aynı prensip).
        const tags: string[] = [];
        let m;
        TAG_REGEX.lastIndex = 0;
        while ((m = TAG_REGEX.exec(p.rawText)) !== null) tags.push(m[1].toLowerCase());
        PROJECT_BRACKET_REGEX.lastIndex = 0;
        while ((m = PROJECT_BRACKET_REGEX.exec(p.rawText)) !== null) tags.push(m[1].toLowerCase());

        const project = projectOf(tags);
        const ownName = cleanTaskText(p.rawText) || '(açıklamasız)';
        const subNames = collectUntaggedDescendantNames(p.idx);
        const content = subNames.length > 0 ? `${ownName} — ${subNames.join(', ')}` : ownName;

        if (!byProject[project]) byProject[project] = { project, totalMinutes: 0, tasks: [] };
        byProject[project].totalMinutes += minutes;
        byProject[project].tasks.push({ content, timeSlot, minutes });
      });
    });

    return Object.values(byProject).sort((a, b) => b.totalMinutes - a.totalMinutes);
  };

  const groups: EforGroup[] = useMemo(
    () => computeGroupsForDate(selectedDate),
    [notes, fileContents, selectedDate, projectSlugToName]
  );

  const weekStartStr = useMemo(() => getWeekStartDateStr(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => getWeekDates(weekStartStr), [weekStartStr]);

  const weekDays: EforDay[] = useMemo(() => {
    if (viewMode !== 'week') return [];
    return weekDates.map(dateStr => {
      const dayGroups = computeGroupsForDate(dateStr);
      return {
        dateStr,
        groups: dayGroups,
        totalMinutes: dayGroups.reduce((sum, g) => sum + g.totalMinutes, 0)
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, weekDates, notes, fileContents, projectSlugToName]);

  const grandTotalMinutes = groups.reduce((sum, g) => sum + g.totalMinutes, 0);
  const weekGrandTotalMinutes = weekDays.reduce((sum, d) => sum + d.totalMinutes, 0);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İSTEK: haftalık görünüm "takvim gibi" bir ızgara olsun — satırlar proje, sütunlar
  // Pazartesi-Pazar. Şirket uygulamasındaki Proje x Gün tablosuyla GÖRSEL olarak eşleşir
  // (veri girişi değil, sadece kopyalamayı kolaylaştıran bir özet ızgarası).
  interface WeekMatrixCell { dateStr: string; minutes: number; tasks: EforTask[] }
  interface WeekMatrixRow { project: string; totalMinutes: number; cells: WeekMatrixCell[] }

  const weekMatrix: WeekMatrixRow[] = useMemo(() => {
    const byProject: Record<string, WeekMatrixRow> = {};
    weekDays.forEach(day => {
      day.groups.forEach(g => {
        if (!byProject[g.project]) {
          byProject[g.project] = {
            project: g.project,
            totalMinutes: 0,
            cells: weekDates.map(dateStr => ({ dateStr, minutes: 0, tasks: [] }))
          };
        }
        const row = byProject[g.project];
        row.totalMinutes += g.totalMinutes;
        const cell = row.cells.find(c => c.dateStr === day.dateStr);
        if (cell) {
          cell.minutes += g.totalMinutes;
          cell.tasks.push(...g.tasks);
        }
      });
    });
    return Object.values(byProject).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [weekDays, weekDates]);

  const weekDayTotals = useMemo(
    () => weekDates.map(dateStr => weekMatrix.reduce((sum, row) => {
      const cell = row.cells.find(c => c.dateStr === dateStr);
      return sum + (cell ? cell.minutes : 0);
    }, 0)),
    [weekMatrix, weekDates]
  );

  const formatDateTr = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  };

  const formatDayShortNameTr = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('tr-TR', { weekday: 'short' });
  };

  const formatWeekRangeTr = (): string => {
    const start = new Date(weekDates[0] + 'T00:00:00');
    const end = new Date(weekDates[6] + 'T00:00:00');
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = start.toLocaleDateString('tr-TR', { day: 'numeric', month: sameMonth ? undefined : 'short' });
    const endStr = end.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1500);
    } catch (e) {
      console.error('Kopyalama başarısız:', e);
    }
  };

  const renderGroup = (group: EforGroup, keyPrefix: string) => (
    <div key={group.project} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>{group.project}</h3>
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-color)' }}>{formatDurationReadable(group.totalMinutes)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {group.tasks
          .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
          .map((t, idx) => {
            const descKey = `${keyPrefix}::${group.project}::${idx}::desc`;
            const durKey = `${keyPrefix}::${group.project}::${idx}::dur`;
            const durationInput = formatDurationInput(t.minutes);
            return (
              <div
                key={idx}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0, width: '90px' }}>
                  {t.timeSlot}
                </span>

                <button
                  type="button"
                  onClick={() => copyToClipboard(t.content, descKey)}
                  title="Açıklamayı kopyala"
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    borderRadius: '5px', fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  {copiedKey === descKey ? <Check size={13} color="#22c55e" style={{ flexShrink: 0 }} /> : <Copy size={13} style={{ flexShrink: 0, opacity: 0.6 }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.content}</span>
                </button>

                <button
                  type="button"
                  onClick={() => copyToClipboard(durationInput, durKey)}
                  title="Süreyi (hh:mm) kopyala"
                  style={{
                    flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '6px 12px', background: copiedKey === durKey ? '#22c55e' : 'var(--accent-color)',
                    border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 700, color: '#fff',
                    cursor: 'pointer', fontFamily: 'monospace', minWidth: '64px', justifyContent: 'center'
                  }}
                >
                  {copiedKey === durKey ? <Check size={13} /> : <Clock size={13} />}
                  {durationInput}
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px' }}>
            <Timer size={22} color="var(--accent-color)" />
            Efor
          </h2>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Her görev için süreyi (hh:mm) ve açıklamayı AYRI AYRI kopyalayıp şirket zaman takip uygulamasına sırayla yapıştırın.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '3px', gap: '2px' }}>
            <button
              type="button"
              onClick={() => setViewMode('day')}
              style={{
                padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                background: viewMode === 'day' ? 'var(--accent-color)' : 'transparent',
                color: viewMode === 'day' ? '#fff' : 'var(--text-secondary)'
              }}
            >
              Günlük
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              style={{
                padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                background: viewMode === 'week' ? 'var(--accent-color)' : 'transparent',
                color: viewMode === 'week' ? '#fff' : 'var(--text-secondary)'
              }}
            >
              Haftalık
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button type="button" onClick={() => (viewMode === 'week' ? shiftWeek(-1) : shiftDate(-1))} style={{ padding: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-primary)' }}>
              <ChevronLeft size={16} />
            </button>
            {viewMode === 'day' ? (
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{ padding: '7px 10px', fontSize: '13px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)' }}
              />
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                <CalendarIcon size={14} style={{ opacity: 0.7 }} />
                {formatWeekRangeTr()}
              </span>
            )}
            <button type="button" onClick={() => (viewMode === 'week' ? shiftWeek(1) : shiftDate(1))} style={{ padding: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-primary)' }}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'day' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {formatDateTr(selectedDate)} · Toplam: <strong style={{ color: 'var(--text-primary)' }}>{formatDurationReadable(grandTotalMinutes)}</strong>
          </div>

          {groups.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              Bu tarihte saati belirlenmiş ([time:] etiketli) bir görev bulunamadı.
            </div>
          )}

          {groups.map(group => renderGroup(group, selectedDate))}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {formatWeekRangeTr()} · Hafta Toplamı: <strong style={{ color: 'var(--text-primary)' }}>{formatDurationReadable(weekGrandTotalMinutes)}</strong>
          </div>

          {weekDays.every(d => d.groups.length === 0) && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              Bu haftada saati belirlenmiş ([time:] etiketli) bir görev bulunamadı.
            </div>
          )}

          {weekMatrix.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '640px' }}>
                <thead>
                  <tr>
                    <th style={{
                      textAlign: 'left', padding: '10px 14px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
                      background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', position: 'sticky', left: 0
                    }}>
                      PROJE
                    </th>
                    {weekDates.map(dateStr => {
                      const isToday = dateStr === toDateStr(new Date());
                      return (
                        <th key={dateStr} style={{
                          textAlign: 'center', padding: '10px 8px', fontSize: '13px', fontWeight: 700,
                          color: isToday ? 'var(--accent-color)' : 'var(--text-muted)',
                          background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap'
                        }}>
                          {new Date(dateStr + 'T00:00:00').getDate()}
                          <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.8, textTransform: 'uppercase' }}>{formatDayShortNameTr(dateStr)}</div>
                        </th>
                      );
                    })}
                    <th style={{
                      textAlign: 'center', padding: '10px 12px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
                      background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)'
                    }}>
                      TOPLAM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weekMatrix.map(row => {
                    const isExpanded = expandedWeekProject === row.project;
                    return (
                    <React.Fragment key={row.project}>
                    <tr>
                      <td style={{
                        padding: 0, fontSize: '12.5px', color: 'var(--text-primary)', fontWeight: 600,
                        borderBottom: '1px solid var(--border-color)', background: 'var(--bg-primary)', position: 'sticky', left: 0, whiteSpace: 'nowrap'
                      }}>
                        <button
                          type="button"
                          onClick={() => setExpandedWeekProject(isExpanded ? null : row.project)}
                          title="Görev ayrıntılarını göster/gizle"
                          style={{
                            display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                            padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
                            color: isExpanded ? 'var(--accent-color)' : 'var(--text-primary)', fontWeight: 600, fontSize: '12.5px', textAlign: 'left'
                          }}
                        >
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} style={{ transform: 'rotate(90deg)' }} />}
                          {row.project}
                        </button>
                      </td>
                      {row.cells.map(cell => {
                        const durKey = `grid::${row.project}::${cell.dateStr}::dur`;
                        const descKey = `grid::${row.project}::${cell.dateStr}::desc`;
                        const hasTime = cell.minutes > 0;
                        const cellDescription = cell.tasks.map(t => t.content).join('; ');
                        return (
                          <td key={cell.dateStr} style={{ padding: '6px', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>
                            {hasTime ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }} title={cellDescription}>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(formatDurationInput(cell.minutes), durKey)}
                                  title="Süreyi (hh:mm) kopyala"
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 8px',
                                    background: copiedKey === durKey ? '#22c55e' : 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-color)', borderRadius: '5px',
                                    fontSize: '11.5px', fontWeight: 700, fontFamily: 'monospace',
                                    color: copiedKey === durKey ? '#fff' : 'var(--text-primary)', cursor: 'pointer'
                                  }}
                                >
                                  {copiedKey === durKey ? <Check size={11} /> : <Clock size={11} />}
                                  {formatDurationInput(cell.minutes)}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(cellDescription, descKey)}
                                  title="Açıklamayı kopyala"
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', padding: '5px 6px',
                                    background: copiedKey === descKey ? '#22c55e' : 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-color)', borderRadius: '5px',
                                    color: copiedKey === descKey ? '#fff' : 'var(--text-secondary)', cursor: 'pointer'
                                  }}
                                >
                                  {copiedKey === descKey ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '12px', opacity: 0.4 }}>–</span>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ padding: '6px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--accent-color)', borderBottom: '1px solid var(--border-color)' }}>
                        {formatDurationReadable(row.totalMinutes)}
                      </td>
                    </tr>
                    {isExpanded && (() => {
                      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                      // İSTEK: proje satırı açılınca, ANA IZGARAYLA AYNI sütun yapısında (Pzt-Paz)
                      // görev bazlı alt satırlar görünsün — her görevin adı solda, hangi gün o
                      // göreve çalışılmışsa O GÜNÜN hizasında süresi. Aynı isimdeki görev haftanın
                      // birden çok gününde geçebilir (ör. "SubTask1" Salı ve Perşembe) — o yüzden
                      // önce projedeki TÜM benzersiz görev adları toplanır, sonra her biri için
                      // haftanın 7 günü ayrı ayrı hesaplanır (tıpkı üst satırın proje toplamları gibi).
                      const taskNames = new Set<string>();
                      row.cells.forEach(cell => cell.tasks.forEach(t => taskNames.add(t.content)));

                      const taskRows = Array.from(taskNames).map(taskName => {
                        const cells = weekDates.map(dateStr => {
                          const dayCell = row.cells.find(c => c.dateStr === dateStr);
                          const matching = (dayCell ? dayCell.tasks : []).filter(t => t.content === taskName);
                          const minutes = matching.reduce((s, t) => s + t.minutes, 0);
                          return { dateStr, minutes };
                        });
                        const totalMinutes = cells.reduce((s, c) => s + c.minutes, 0);
                        return { taskName, cells, totalMinutes };
                      }).sort((a, b) => b.totalMinutes - a.totalMinutes);

                      if (taskRows.length === 0) {
                        return (
                          <tr>
                            <td colSpan={weekDates.length + 2} style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '12px', color: 'var(--text-muted)' }}>
                              Bu hafta bu projeye ait görev yok.
                            </td>
                          </tr>
                        );
                      }

                      return taskRows.map((taskRow, taskRowIdx) => (
                        <tr key={taskRowIdx} style={{ background: 'var(--bg-secondary)' }}>
                          <td style={{
                            padding: '8px 14px 8px 34px', fontSize: '11.5px', color: 'var(--text-secondary)',
                            borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', position: 'sticky', left: 0,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px'
                          }}>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(taskRow.taskName, `detail::${row.project}::${taskRow.taskName}::desc`)}
                              title="Açıklamayı kopyala"
                              style={{
                                display: 'flex', alignItems: 'center', gap: '6px', width: '100%', background: 'transparent',
                                border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'inherit', textAlign: 'left', padding: 0
                              }}
                            >
                              {copiedKey === `detail::${row.project}::${taskRow.taskName}::desc`
                                ? <Check size={11} color="#22c55e" style={{ flexShrink: 0 }} />
                                : <Copy size={11} style={{ flexShrink: 0, opacity: 0.5 }} />}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{taskRow.taskName}</span>
                            </button>
                          </td>
                          {taskRow.cells.map(cell => {
                            const durKey = `detail::${row.project}::${taskRow.taskName}::${cell.dateStr}::dur`;
                            return (
                              <td key={cell.dateStr} style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                                {cell.minutes > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(formatDurationInput(cell.minutes), durKey)}
                                    title="Süreyi (hh:mm) kopyala"
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 7px',
                                      background: copiedKey === durKey ? '#22c55e' : 'var(--bg-tertiary)',
                                      border: '1px solid var(--border-color)', borderRadius: '5px',
                                      fontSize: '11px', fontWeight: 700, fontFamily: 'monospace',
                                      color: copiedKey === durKey ? '#fff' : 'var(--text-primary)', cursor: 'pointer'
                                    }}
                                  >
                                    {copiedKey === durKey ? <Check size={10} /> : null}
                                    {formatDurationInput(cell.minutes)}
                                  </button>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '11px', opacity: 0.35 }}>–</span>
                                )}
                              </td>
                            );
                          })}
                          <td style={{ padding: '4px 12px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                            {formatDurationReadable(taskRow.totalMinutes)}
                          </td>
                        </tr>
                      ));
                    })()}
                    </React.Fragment>
                  );
                  })}
                  <tr>
                    <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', position: 'sticky', left: 0, background: 'var(--bg-primary)' }}>
                      TOPLAM
                    </td>
                    {weekDayTotals.map((mins, i) => (
                      <td key={weekDates[i]} style={{ padding: '6px', textAlign: 'center', fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {mins > 0 ? formatDurationInput(mins) : '–'}
                      </td>
                    ))}
                    <td style={{ padding: '6px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 800, color: 'var(--accent-color)' }}>
                      {formatDurationReadable(weekGrandTotalMinutes)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            🕐 süreyi (hh:mm), 📋 açıklamayı kopyalar · birden çok görev varsa açıklamalar "; " ile birleştirilir.
          </div>
        </div>
      )}
    </div>
  );
}
