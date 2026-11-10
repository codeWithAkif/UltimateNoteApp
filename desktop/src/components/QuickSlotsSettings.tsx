import React from 'react';
import {
  CALENDAR_VIEW_LABELS, PROJECT_VIEW_LABELS, describeTarget,
  type CalendarViewMode, type ProjectView, type QuickSlot, type SlotTarget
} from '../quickSlots';

const sel: React.CSSProperties = {
  background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
  borderRadius: '6px', padding: '5px 8px', fontSize: '12px', minWidth: 0
};

type Kind = 'none' | 'project' | 'note' | 'diary' | 'calendar';
const kindOf = (t: SlotTarget | null): Kind => (t ? t.type : 'none');

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
    if (kind === 'calendar') return setTarget(i, { type: 'calendar', view: 'day' });
    if (kind === 'note') return setTarget(i, { type: 'note', path: '' });
    return setTarget(i, { type: 'project', project: projectNames[0] || '', view: 'dashboard' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Hızlı slotlar (Alt+1 … Alt+9)</div>
      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Her slota belirli bir hedef atayın: şu proje şu görünümde, şu not, bugünün günlüğü ya da takvim. Uygulamanın herhangi bir yerindeyken
        (not yazarken de) Alt + rakam o hedefi açar. Bu ayar yalnızca bu cihazda saklanır.
      </div>
      {slots.map((slot, i) => {
        const t = slot.target;
        const kind = kindOf(t);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px' }}>
            <span style={{ width: '48px', fontSize: '12px', fontWeight: 700, color: 'var(--accent-color)', flexShrink: 0 }}>Alt+{i + 1}</span>
            <select value={kind} onChange={(e) => changeKind(i, e.target.value as Kind)} style={{ ...sel, width: '150px' }}>
              <option value="none">Boş</option>
              <option value="project">Proje</option>
              <option value="note">Not</option>
              <option value="diary">Bugünün günlüğü</option>
              <option value="calendar">Takvim (bugün)</option>
            </select>

            {t && t.type === 'project' && (
              <>
                <select
                  value={t.project}
                  onChange={(e) => setTarget(i, { ...t, project: e.target.value })}
                  style={{ ...sel, flex: '1 1 140px' }}
                >
                  {t.project && !projectNames.includes(t.project) && <option value={t.project}>{t.project} (bulunamadı)</option>}
                  {projectNames.length === 0 && <option value="">Proje bulunamadı</option>}
                  {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={t.view} onChange={(e) => setTarget(i, { ...t, view: e.target.value as ProjectView })} style={{ ...sel, width: '120px' }}>
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
                  placeholder="Not yolu (yazın ya da listeden seçin)"
                  style={{ ...sel, flex: '1 1 220px' }}
                />
                <datalist id={`slot-notes-${i}`}>{notePaths.map(p => <option key={p} value={p} />)}</datalist>
                {t.path && !notePaths.includes(t.path) && <span style={{ fontSize: '11px', color: '#eab308' }}>Bu yolda not bulunamadı</span>}
              </>
            )}

            {t && t.type === 'calendar' && (
              <select value={t.view} onChange={(e) => setTarget(i, { type: 'calendar', view: e.target.value as CalendarViewMode })} style={{ ...sel, width: '120px' }}>
                {(Object.keys(CALENDAR_VIEW_LABELS) as CalendarViewMode[]).map(v => <option key={v} value={v}>{CALENDAR_VIEW_LABELS[v]}</option>)}
              </select>
            )}

            {t && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{describeTarget(t)}</span>}
          </div>
        );
      })}
    </div>
  );
}
