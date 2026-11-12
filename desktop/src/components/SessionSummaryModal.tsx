import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, FileText, FolderKanban, X } from 'lucide-react';
import { AREA_LABELS, hmOf, ymdOf, type SessionArea, type SessionSummary } from '../sessionTracker';

const overlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};
const panel: React.CSSProperties = {
  width: 'min(760px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
};
const field: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px',
  padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '8px 13px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};
const chip = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent-color)' : 'var(--bg-hover)', color: active ? '#fff' : 'var(--text-secondary)',
  border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`, borderRadius: '14px', padding: '3px 10px',
  fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
});
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '14px 0 6px' };

export interface SessionBlockResult { title: string; project: string; date: string; start: string; end: string; details: string[]; items: string[] }

const AREA_ICONS: Record<SessionArea, React.ReactNode> = {
  notlar: <FileText size={13} />, takvim: <CalendarPlus size={13} />, projeler: <FolderKanban size={13} />
};

// "Geçen çalışma" penceresi: oturumda yaptıklarınız cümle cümle onay kutularıyla gelir; seçip başlık/saat girer, ayrıntıları düzenler ve
// takvime işlersiniz. Takvime yazma ve kayıt tutma App.tsx'te (onProcess/onSkip).
export default function SessionSummaryModal({ session, remaining, projectNames, onProcess, onSkip, onSkipAll, onClose }: {
  session: SessionSummary;
  remaining: number;
  projectNames: string[];
  onProcess: (b: SessionBlockResult) => Promise<void>;
  onSkip: (items: string[], title: string, start: string, end: string, date: string) => Promise<void>;
  onSkipAll: () => Promise<void>;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(session.items.map(i => i.id)));
  const [title, setTitle] = useState(session.suggestedTitle);
  const [project, setProject] = useState(session.suggestedProject || '');
  const [date, setDate] = useState(ymdOf(session.start));
  const [start, setStart] = useState(hmOf(session.start));
  const [end, setEnd] = useState(hmOf(session.end));
  const [details, setDetails] = useState(() => session.items.map(i => i.text).join('\n'));
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const textById = useMemo(() => new Map(session.items.map(i => [i.id, i.text])), [session]);

  // Seçimi toplu değiştirir (tek kutu, proje, alan ya da hepsi): işaretlenen cümleler ayrıntı editörüne eklenir,
  // kaldırılanlar (elle düzenlenmemişse) o satırdan çıkar. Sonuçta seçili her şey tek projeye aitse proje listesi ona geçer.
  const applySelection = (next: Set<string>) => {
    const addTexts = session.items.filter(i => next.has(i.id) && !checked.has(i.id)).map(i => i.text);
    const dropTexts = new Set(session.items.filter(i => !next.has(i.id) && checked.has(i.id)).map(i => i.text));
    setDetails(d => {
      let lines = d.split('\n').filter(l => !dropTexts.has(l));
      const have = new Set(lines);
      const add = addTexts.filter(t => !have.has(t));
      lines = [...lines.filter((l, i) => !(i === lines.length - 1 && !l.trim() && add.length > 0)), ...add];
      return lines.join('\n');
    });
    setChecked(next);
    const chosen = new Set(session.items.filter(i => next.has(i.id)).map(i => i.project || ''));
    if (chosen.size === 1) { const only = [...chosen][0]; if (only) setProject(only); }
  };
  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(checked);
    ids.forEach(id => (on ? next.add(id) : next.delete(id)));
    applySelection(next);
  };
  const toggle = (id: string) => setMany([id], !checked.has(id));

  // Oturumda geçen projeler (+ projesiz öğeler) ve her birinin öğeleri: "proje proje" seçim için.
  const projectGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    session.items.forEach(i => { const k = i.project || ''; const a = m.get(k); if (a) a.push(i.id); else m.set(k, [i.id]); });
    return [...m.entries()].map(([name, ids]) => ({ name, ids })).sort((a, b) => b.ids.length - a.ids.length);
  }, [session]);
  const allIds = session.items.map(i => i.id);

  const byArea = (['notlar', 'takvim', 'projeler'] as SessionArea[]).map(a => ({ area: a, items: session.items.filter(i => i.area === a) })).filter(g => g.items.length > 0);
  const detailLines = details.split('\n').map(l => l.trim()).filter(Boolean);

  const validate = (): string => {
    if (!title.trim()) return 'Bir başlık yazın.';
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 'Başlangıç ve bitiş saatini girin.';
    if (end <= start) return 'Bitiş saati başlangıçtan sonra olmalı (gece yarısını aşan oturumlar iki ayrı blok olarak işlenir).';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Tarihi girin.';
    return '';
  };

  const process = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setBusy(true); setError('');
    try {
      // Genel özet bloğun ilk maddesi(leri) olur: ilk satır "Özet: …" ile başlar.
      const summaryLines = summary.split('\n').map(l => l.trim()).filter(Boolean);
      const lead = summaryLines.length ? [`Özet: ${summaryLines[0]}`, ...summaryLines.slice(1)] : [];
      await onProcess({ title: title.trim(), project, date, start, end, details: [...lead, ...detailLines], items: detailLines });
    } catch (e: any) { setError(`Takvime işlenemedi: ${String(e?.message || e)}`); setBusy(false); }
  };

  const skip = async () => {
    setBusy(true);
    try { await onSkip(session.items.map(i => i.text), title.trim() || session.suggestedTitle, start, end, date); }
    catch (e: any) { setError(String(e?.message || e)); setBusy(false); }
  };

  return createPortal(
    // Arka plana tıklayınca kapanmaz (uzun listede yanlışlıkla kapanıp seçim kaybolmasın); yalnızca çarpı ya da "Sonra" kapatır.
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Geçen çalışmanız</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
              {date} · {hmOf(session.start)}–{hmOf(session.end)}{remaining > 0 ? ` · ${remaining} bekleyen oturum daha var` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '5px 8px' }} title="Kapat (sonra devam edebilirsiniz)"><X size={14} /></button>
        </div>

        <div style={label}>Neler yaptınız? ({checked.size}/{session.items.length} seçili)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '10px' }}>
          <button type="button" style={chip(false)} onClick={() => setMany(allIds, true)}>Hepsini seç</button>
          <button type="button" style={chip(false)} onClick={() => setMany(allIds, false)}>Hiçbirini seçme</button>
          {projectGroups.length > 1 && <span style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 2px 0 6px' }}>Proje:</span>}
          {projectGroups.length > 1 && projectGroups.map(g => {
            const n = g.ids.filter(id => checked.has(id)).length;
            const all = n === g.ids.length;
            return (
              <button
                key={g.name || '_none'}
                type="button"
                style={chip(all)}
                title={all ? 'Bu projenin hepsini kaldır' : 'Bu projenin hepsini seç'}
                onClick={() => setMany(g.ids, !all)}
              >
                {g.name || 'Projesiz'} ({n}/{g.ids.length})
              </button>
            );
          })}
          {projectGroups.length > 1 && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>· yalnızca bir proje için:</span>
          )}
          {projectGroups.length > 1 && projectGroups.filter(g => g.name).map(g => (
            <button
              key={`only-${g.name}`}
              type="button"
              style={chip(false)}
              title="Yalnızca bu projenin öğelerini seçili bırak"
              onClick={() => applySelection(new Set(g.ids))}
            >
              Sadece {g.name}
            </button>
          ))}
        </div>
        {byArea.map(g => (
          <div key={g.area} style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              {AREA_ICONS[g.area]} {AREA_LABELS[g.area]}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {g.items.map(it => (
                <label key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '7px 10px', background: 'var(--bg-tertiary)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  <input type="checkbox" checked={checked.has(it.id)} onChange={() => toggle(it.id)} style={{ marginTop: '3px', flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {it.text}
                    {it.project && <span style={{ marginLeft: '8px', fontSize: '10.5px', color: 'var(--accent-color)', border: '1px solid var(--accent-color)', borderRadius: '8px', padding: '0 6px', whiteSpace: 'nowrap' }}>{it.project}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div style={label}>Takvim bloğu</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık (örn. PScope dashboard çalışması)" style={{ ...field, flex: '2 1 260px' }} />
          <select value={project} onChange={(e) => setProject(e.target.value)} style={{ ...field, flex: '1 1 150px' }} title="Bloğun bağlanacağı proje">
            <option value="">Proje yok</option>
            {project && !projectNames.includes(project) && <option value={project}>{project}</option>}
            {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={field} aria-label="Başlangıç saati" />
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={field} aria-label="Bitiş saati" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Saatler uygulamadaki ilk ve son hareketinizden alındı; düzeltebilirsiniz.</span>
        </div>

        <div style={label}>Genel özet (isteğe bağlı — bloğun ilk maddesi olur)</div>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} style={{ ...field, width: '100%', resize: 'vertical', lineHeight: 1.5 }} placeholder="Örn. PScope bülten ekranını bitirdim, kalanlar test aşamasında" />

        <div style={label}>Ayrıntılar (bloğun altına madde madde yazılır, düzenleyebilirsiniz)</div>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={7} style={{ ...field, width: '100%', resize: 'vertical', lineHeight: 1.5 }} placeholder="Her satır bir madde olur" />

        {error && <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px', alignItems: 'center' }}>
          <button type="button" onClick={process} disabled={busy} style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }}>
            <CalendarPlus size={14} /> {busy ? 'İşleniyor…' : 'Takvime işle'}
          </button>
          <button type="button" onClick={skip} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }} title="Takvime yazmadan yalnızca oturum kaydına geçirir">Atla</button>
          {remaining > 0 && (
            <button
              type="button"
              disabled={busy}
              style={{ ...btn, opacity: busy ? 0.6 : 1 }}
              title="Bekleyen tüm oturumları takvime yazmadan oturum kaydına geçirir"
              onClick={async () => { setBusy(true); try { await onSkipAll(); } catch (e: any) { setError(String(e?.message || e)); setBusy(false); } }}
            >
              Hepsini atla ({remaining + 1})
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} style={btn}>Sonra</button>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Yazılacak: günlük notu ({date})</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
