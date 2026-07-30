// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// İSTEK: "Efor" ekranı — şirketin zaman takip uygulamasına (Proje x Görev x Gün ızgarası,
// hh:mm giriş kutuları + Enter'da açılan açıklama modalı) veriyi PRATİK şekilde elle
// girebilmek için süre ve açıklamayı AYRI AYRI kopyalayabilme. Kullanıcı bilerek o ızgara
// arayüzünün birebir kopyasını istemedi — asıl ihtiyaç, tek tek göreve tıklayıp süreyi
// (hh:mm formatında, şirket uygulamasının beklediği gibi) ve açıklamayı ayrı butonlarla
// kopyalayıp sırayla diğer uygulamaya yapıştırabilmek. Gruplama PROJE bazlı (client değil)
// — şirket uygulamasındaki "Project" satırlarıyla birebir eşleşsin diye (bkz. projectNames).
// Veri kaynağı takvimdeki görevlerle AYNI — notlardaki [due:]/[time:] etiketli satırlar.

import React, { useMemo, useState } from 'react';
import { Timer, Copy, Check, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

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

const CHECKLIST_REGEX = /^(\s*)([*\-]\s+\[([ xX\/])\])\s+(.*)$/;
const DUE_REGEX = /\[due:(\d{4}-\d{2}-\d{2})\]/i;
const TIME_REGEX = /\[time:(\d{2}):(\d{2})-(\d{2}):(\d{2})\]/i;
const TAG_REGEX = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;
// Görünmez proje bağlantısı — CalendarView.tsx artık projeyi görünür "#slug" yerine bununla
// işaretliyor (kullanıcı isteği: görev adında etiket görünmesin). Eski #slug notlarla geriye
// dönük uyumluluk için TAG_REGEX ile birlikte ayrıca taranır.
const PROJECT_BRACKET_REGEX = /\[proje:([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)\]/gi;

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
  .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
  .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
  .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
  .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
  .replace(/\[baslangic:[^\]]+\]/gi, '')
  .replace(/\[tamamlanma:[^\]]+\]/gi, '')
  .replace(/\[dakiklik:(?:fast|ontime|late)\]/gi, '')
  .replace(/#[a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+/g, '')
  .replace(/\[proje:[^\]]+\]/gi, '')
  .replace(/\s+/g, ' ')
  .trim();

export default function EforView({ notes, fileContents, projectNames }: EforViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const shiftDate = (deltaDays: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const projectSlugToName = useMemo(() => {
    const map: Record<string, string> = {};
    projectNames.forEach(name => {
      map[name.toLowerCase().replace(/\s+/g, '-')] = name;
    });
    return map;
  }, [projectNames]);

  const groups: EforGroup[] = useMemo(() => {
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
      if (!content.includes(selectedDate)) return; // hızlı ön-eleme, tam regex kontrolü aşağıda

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
        if (!dueMatch || dueMatch[1] !== selectedDate) return;
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
  }, [notes, fileContents, selectedDate, projectSlugToName]);

  const grandTotalMinutes = groups.reduce((sum, g) => sum + g.totalMinutes, 0);

  const formatDateTr = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button type="button" onClick={() => shiftDate(-1)} style={{ padding: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '13px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)' }}
          />
          <button type="button" onClick={() => shiftDate(1)} style={{ padding: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {formatDateTr(selectedDate)} · Toplam: <strong style={{ color: 'var(--text-primary)' }}>{formatDurationReadable(grandTotalMinutes)}</strong>
        </div>

        {groups.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Bu tarihte saati belirlenmiş ([time:] etiketli) bir görev bulunamadı.
          </div>
        )}

        {groups.map(group => (
          <div key={group.project} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>{group.project}</h3>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-color)' }}>{formatDurationReadable(group.totalMinutes)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {group.tasks
                .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
                .map((t, idx) => {
                  const descKey = `${group.project}::${idx}::desc`;
                  const durKey = `${group.project}::${idx}::dur`;
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
        ))}
      </div>
    </div>
  );
}
