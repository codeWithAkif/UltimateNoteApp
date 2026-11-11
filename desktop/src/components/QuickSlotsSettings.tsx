import React from 'react';
import {
  CALENDAR_VIEW_LABELS, PROJECT_VIEW_LABELS, describeTarget,
  type CalendarViewMode, type ProjectView, type QuickSlot, type SlotTarget
} from '../quickSlots';

// Görünüm: Ayarlar > Kısayollar'daki mevcut satırlarla AYNI kalıp (kart, kalın başlık + "Aksiyon:" alt yazısı, sağda monospace tuş
// etiketi). Biçim sabitleri App.tsx'teki kısayol satırından birebir alınmıştır; orada değişirse burada da değiştirin.
const cardStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 14px',
  background: 'rgba(255, 255, 255, 0.02)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)'
};
const chipStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '6px 12px', borderRadius: '6px',
  fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--accent-color)', fontSize: '12px', whiteSpace: 'nowrap'
};
const fieldStyle: React.CSSProperties = {
  // Ayarlardaki diğer girdilerle (Müşteriler klasörü vb.) aynı koyu zemin; native açılır liste de bu sayede okunur kalır.
  background: '#1c1c24', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '6px 12px',
  color: '#fff', fontSize: '12px', minWidth: 0, outline: 'none'
};

type Kind = 'none' | 'project' | 'note' | 'diary' | 'calendar' | 'lastNote';
const kindOf = (t: SlotTarget | null): Kind => (t ? t.type : 'none');
const KIND_LABELS: Record<Kind, string> = { none: 'Boş', project: 'Proje', note: 'Not', diary: 'Bugünün günlüğü', calendar: 'Takvim (bugün)', lastNote: 'Son açılan not' };

// Ayarlar > Kısayollar içindeki "Hızlı slotlar": Alt+1 ... Alt+9 ile belirli bir hedefe gitme.
export default function QuickSlotsSettings({ slots, onChange, projectNames, notePaths }: {
  slots: QuickSlot[];
  onChange: (next: QuickSlot[]) => void;
  projectNames: string[];
  notePaths: string[];
}) {
  const setTarget = (i: number, target: SlotTarget | null) => onChange(slots.map((s, k) => (k === i ? { target } : s)));

  const changeKind = (i: number, kind: Kind) => {
    if (kind === 'none') return setTarget(i, null);
    if (kind === 'diary') return setTarget(i, { type: 'diary' });
    if (kind === 'lastNote') return setTarget(i, { type: 'lastNote' });
    if (kind === 'calendar') return setTarget(i, { type: 'calendar', view: 'day' });
    if (kind === 'note') return setTarget(i, { type: 'note', path: '' });
    return setTarget(i, { type: 'project', project: projectNames[0] || '', view: 'dashboard' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h3 style={{ margin: '4px 0 0 0', fontSize: '16px', color: '#fff' }}>Hızlı slotlar</h3>
      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
        Her slota belirli bir hedef atayın: şu proje şu görünümde, şu not, bugünün günlüğü ya da takvim. Uygulamanın herhangi bir
        yerindeyken (not yazarken de) Alt + rakam o hedefi açar. "Not" ve "Son açılan not" slotlarında Ctrl + Alt + rakam, notu sağda bölünmüş görünümde açar
        ("Son açılan not"ta bir önceki not, açık notun yanına gelir). Bu ayar yalnızca bu cihazda saklanır.
      </p>
      {slots.map((slot, i) => {
        const t = slot.target;
        const kind = kindOf(t);
        return (
          <div key={i} style={cardStyle}>
            <div style={{ minWidth: '150px', flex: '1 1 150px' }}>
              <div style={{ fontWeight: '600', color: t ? '#fff' : 'var(--text-muted)', overflowWrap: 'anywhere' }}>{describeTarget(t)}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Aksiyon: slot_{i + 1}</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', justifyContent: 'flex-end', flex: '2 1 280px' }}>
              <select value={kind} onChange={(e) => changeKind(i, e.target.value as Kind)} style={{ ...fieldStyle, width: '150px' }}>
                {(Object.keys(KIND_LABELS) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>

              {t && t.type === 'project' && (
                <>
                  <select value={t.project} onChange={(e) => setTarget(i, { ...t, project: e.target.value })} style={{ ...fieldStyle, width: '160px' }}>
                    {t.project && !projectNames.includes(t.project) && <option value={t.project}>{t.project} (bulunamadı)</option>}
                    {projectNames.length === 0 && <option value="">Proje bulunamadı</option>}
                    {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={t.view} onChange={(e) => setTarget(i, { ...t, view: e.target.value as ProjectView })} style={{ ...fieldStyle, width: '130px' }}>
                    {(Object.keys(PROJECT_VIEW_LABELS) as ProjectView[]).map(v => <option key={v} value={v}>{PROJECT_VIEW_LABELS[v]}</option>)}
                  </select>
                </>
              )}

              {t && t.type === 'note' && (
                <>
                  <input
                    list={`slot-notes-${i}`}
                    value={t.path}
                    onChange={(e) => setTarget(i, { type: 'note', path: e.target.value })}
                    placeholder="Not yolu (yazın ya da seçin)"
                    style={{ ...fieldStyle, width: '260px' }}
                  />
                  <datalist id={`slot-notes-${i}`}>{notePaths.map(p => <option key={p} value={p} />)}</datalist>
                  {t.path && !notePaths.includes(t.path) && <span style={{ fontSize: '11px', color: '#eab308' }}>Not bulunamadı</span>}
                </>
              )}

              {t && t.type === 'calendar' && (
                <select value={t.view} onChange={(e) => setTarget(i, { type: 'calendar', view: e.target.value as CalendarViewMode })} style={{ ...fieldStyle, width: '130px' }}>
                  {(Object.keys(CALENDAR_VIEW_LABELS) as CalendarViewMode[]).map(v => <option key={v} value={v}>{CALENDAR_VIEW_LABELS[v]}</option>)}
                </select>
              )}

              <div style={chipStyle}>Alt + {i + 1}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
