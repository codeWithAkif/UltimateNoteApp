import React, { useMemo, useState } from 'react';
import { Brain, FileText } from 'lucide-react';
import ErrandPlannerPanel from './ErrandPlanner';
import TripPlannerPanel from './TripPlanner';
import TaskExtractorPanel from './TaskExtractor';
import MeetingTranscriptPanel from './MeetingTranscript';
import { ROUTE_PAGE_PATH, tasksFromContents } from '../services/errandPlanner';
import { GEZI_PAGE_PATH } from '../services/tripPlanner';

type Tab = 'rota' | 'gezi' | 'transkript' | 'gorev';
const TABS: { key: Tab; label: string }[] = [
  { key: 'rota', label: 'Dışarı işler' },
  { key: 'gezi', label: 'Gezi planla' },
  { key: 'transkript', label: 'Toplantı transkripti' },
  { key: 'gorev', label: 'Görev çıkar' }
];

// Bir plan sayfasının (Rota.md / Gezi.md) kısa özeti: başlık, güncelleme satırı ve ilk birkaç durak.
export const summarizePlan = (md: string | undefined): { title: string; meta: string; items: string[] } | null => {
  if (!md || !md.trim()) return null;
  const lines = md.split('\n');
  const strip = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim();
  const title = strip((lines.find(l => l.startsWith('# ')) || '').replace(/^#\s+/, ''));
  const meta = strip(lines.find(l => /^(Güncelleme|Oluşturma):/.test(l)) || '');
  const items = lines
    .filter(l => /^\d+\.\s/.test(l) || /^- \*\*/.test(l))
    .map(l => strip(l.replace(/^\d+\.\s+|^- /, '')).replace(/\s*·\s*Harita\s*$/, ''))
    .slice(0, 6);
  return { title, meta, items };
};

const card: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' };
const smallBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', background: 'var(--bg-hover)',
  border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '8px', padding: '6px 10px',
  fontSize: '12px', fontWeight: 600, cursor: 'pointer'
};

function LastPlanCard({ heading, path, md, onOpenNote }: { heading: string; path: string; md?: string; onOpenNote?: (p: string) => void }) {
  const s = summarizePlan(md);
  if (!s) return null;
  return (
    <div style={{ ...card, marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{heading}</div>
          <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '2px', overflowWrap: 'anywhere' }}>{s.title}</div>
          {s.meta && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{s.meta}</div>}
        </div>
        {onOpenNote && <button type="button" onClick={() => onOpenNote(path)} style={smallBtn}><FileText size={13} /> Sayfayı aç</button>}
      </div>
      {s.items.length > 0 && (
        <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px', fontSize: '12.5px', lineHeight: 1.6 }}>
          {s.items.map((it, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{it}</li>)}
        </ol>
      )}
    </div>
  );
}

// Kalıcı Asistan sayfası: modal gibi geçici değil; son planlar üstte durur, araçlar sekmelerle açılır.
export default function AssistantView({ fileContents, clientsFolder, onSaveNote, onOpenNote }: {
  fileContents: Record<string, string>;
  clientsFolder?: string;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onOpenNote?: (path: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = localStorage.getItem('assistant_tab') as Tab; if (TABS.some(x => x.key === t)) return t; } catch { /* yoksay */ }
    return 'rota';
  });
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem('assistant_tab', t); } catch { /* yoksay */ } };
  // Görev listesi sayfa açıldığı andaki içerikten bir kez çıkarılır (her yazımda yeniden taranmasın).
  const tasks = useMemo(() => tasksFromContents(fileContents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  return (
    <div style={{ height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '20px 16px' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px' }}><Brain size={22} /> Asistan</h1>
        <p style={{ margin: '4px 0 14px 0', fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Dışarı işlerinizi, gezilerinizi ve toplantı notlarınızı planlar. Son planlar aşağıda durur; her seferinde yeniden hesaplatmanız gerekmez.
        </p>

        <LastPlanCard heading="Son rota planı" path={ROUTE_PAGE_PATH} md={fileContents[ROUTE_PAGE_PATH]} onOpenNote={onOpenNote} />
        <LastPlanCard heading="Son gezi planı" path={GEZI_PAGE_PATH} md={fileContents[GEZI_PAGE_PATH]} onOpenNote={onOpenNote} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '14px 0' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => choose(t.key)}
              style={{
                flex: '1 1 auto', padding: '8px 12px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', borderRadius: '8px',
                border: '1px solid var(--border-color)', whiteSpace: 'nowrap', fontFamily: 'inherit',
                background: tab === t.key ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: tab === t.key ? '#fff' : 'var(--text-secondary)'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={card}>
          {tab === 'rota' && <ErrandPlannerPanel tasks={tasks} fileContents={fileContents} onSaveNote={onSaveNote} />}
          {tab === 'gezi' && <TripPlannerPanel fileContents={fileContents} onSaveNote={onSaveNote} onOpenNote={onOpenNote} />}
          {tab === 'transkript' && <MeetingTranscriptPanel fileContents={fileContents} clientsFolder={clientsFolder} onSaveNote={onSaveNote} />}
          {tab === 'gorev' && <TaskExtractorPanel fileContents={fileContents} onSaveNote={onSaveNote} />}
        </div>
      </div>
    </div>
  );
}
