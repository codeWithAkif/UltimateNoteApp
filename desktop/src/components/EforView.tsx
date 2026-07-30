// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// İSTEK: "Efor" ekranı — bir günde hangi müşteriye kaç saat çalışılmış, neler yapılmış
// gösterilecek; başka bir uygulamada (ör. faturalama/zaman takibi) kullanmak için kolayca
// kopyalanabilmeli. Veri kaynağı, takvimdeki görevlerle AYNI — notlardaki [due:]/[time:]
// etiketli satırlar; ayrı bir depolama katmanı YOK. Müşteri eşleştirmesi, App.tsx'teki
// clientProjectSlugs haritasıyla (proje etiketi -> müşteri) AYNI mantığı kullanır — böylece
// takvimdeki müşteri filtresiyle burası hep tutarlı kalır.

import React, { useMemo, useState } from 'react';
import { Timer, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  updatedAt: number;
}

interface EforViewProps {
  notes: NoteItem[];
  fileContents: Record<string, string>;
  clientNames: string[];
  clientProjectSlugs: Record<string, string[]>;
}

interface EforTask {
  content: string;
  timeSlot: string;
  minutes: number;
}

interface EforGroup {
  client: string;
  totalMinutes: number;
  tasks: EforTask[];
}

const CHECKLIST_REGEX = /^(\s*[*\-]\s+\[([ xX\/])\])\s+(.*)$/;
const DUE_REGEX = /\[due:(\d{4}-\d{2}-\d{2})\]/i;
const TIME_REGEX = /\[time:(\d{2}):(\d{2})-(\d{2}):(\d{2})\]/i;
const TAG_REGEX = /#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g;

const formatDuration = (mins: number): string => {
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
  .replace(/\s+/g, ' ')
  .trim();

export default function EforView({ notes, fileContents, clientNames, clientProjectSlugs }: EforViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const shiftDate = (deltaDays: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const groups: EforGroup[] = useMemo(() => {
    const clientOf = (tags: string[]): string => {
      for (const client of clientNames) {
        const slugs = clientProjectSlugs[client] || [];
        if (tags.some(t => slugs.includes(t))) return client;
      }
      return 'Diğer / Atanmamış';
    };

    const byClient: Record<string, EforGroup> = {};

    notes.forEach(note => {
      if (note.type !== 'note') return;
      const content = fileContents[note.path] || '';
      if (!content.includes(selectedDate)) return; // hızlı ön-eleme, tam regex kontrolü aşağıda

      content.split('\n').forEach(line => {
        const checklistMatch = line.match(CHECKLIST_REGEX);
        if (!checklistMatch) return;
        const rawText = checklistMatch[3];

        const dueMatch = rawText.match(DUE_REGEX);
        if (!dueMatch || dueMatch[1] !== selectedDate) return;
        const timeMatch = rawText.match(TIME_REGEX);
        if (!timeMatch) return; // Efor hesaplaması için saat aralığı şart

        const startMin = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
        const endMin = parseInt(timeMatch[3], 10) * 60 + parseInt(timeMatch[4], 10);
        const minutes = Math.max(0, endMin - startMin);
        const timeSlot = `${timeMatch[1]}:${timeMatch[2]}-${timeMatch[3]}:${timeMatch[4]}`;

        const tags: string[] = [];
        let m;
        TAG_REGEX.lastIndex = 0;
        while ((m = TAG_REGEX.exec(rawText)) !== null) tags.push(m[1].toLowerCase());

        const client = clientOf(tags);
        if (!byClient[client]) byClient[client] = { client, totalMinutes: 0, tasks: [] };
        byClient[client].totalMinutes += minutes;
        byClient[client].tasks.push({ content: cleanTaskText(rawText) || '(açıklamasız)', timeSlot, minutes });
      });
    });

    return Object.values(byClient).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [notes, fileContents, selectedDate, clientNames, clientProjectSlugs]);

  const grandTotalMinutes = groups.reduce((sum, g) => sum + g.totalMinutes, 0);

  const formatDateTr = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  };

  const buildGroupText = (group: EforGroup): string => {
    const lines = [`${group.client} — ${formatDuration(group.totalMinutes)}`];
    group.tasks
      .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
      .forEach(t => lines.push(`- ${t.content} (${t.timeSlot})`));
    return lines.join('\n');
  };

  const buildFullReportText = (): string => {
    const lines = [`${formatDateTr(selectedDate)} - Efor Raporu`, ''];
    groups.forEach((g, i) => {
      if (i > 0) lines.push('');
      lines.push(buildGroupText(g));
    });
    if (groups.length === 0) lines.push('(Bu tarihte saatli/planlanmış görev bulunamadı)');
    return lines.join('\n');
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1800);
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
            Seçili günde hangi müşteriye kaç saat çalıştığınızı ve neler yaptığınızı gösterir — saatli ([time:]) görevlerden hesaplanır.
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {formatDateTr(selectedDate)} · Toplam: <strong style={{ color: 'var(--text-primary)' }}>{formatDuration(grandTotalMinutes)}</strong>
          </div>
          {groups.length > 0 && (
            <button
              type="button"
              onClick={() => copyToClipboard(buildFullReportText(), 'all')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
            >
              {copiedKey === 'all' ? <Check size={14} /> : <Copy size={14} />}
              {copiedKey === 'all' ? 'Kopyalandı' : 'Tüm Günü Kopyala'}
            </button>
          )}
        </div>

        {groups.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Bu tarihte saati belirlenmiş ([time:] etiketli) bir görev bulunamadı.
          </div>
        )}

        {groups.map(group => (
          <div key={group.client} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>{group.client}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-color)' }}>{formatDuration(group.totalMinutes)}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(buildGroupText(group), group.client)}
                  title="Bu müşterinin efor kaydını kopyala"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '5px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  {copiedKey === group.client ? <Check size={12} /> : <Copy size={12} />}
                  {copiedKey === group.client ? 'Kopyalandı' : 'Kopyala'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {group.tasks
                .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
                .map((t, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    <span>{t.content}</span>
                    <span style={{ flexShrink: 0, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{t.timeSlot}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
