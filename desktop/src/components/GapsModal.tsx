import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CalendarPlus, Phone } from 'lucide-react';
import { type Interval, MINUTE } from '../activityLog';
import { hmOf } from '../sessionTracker';
import { parseSlot } from '../dayPlan';
import { formatDuration, parseTeamsCalls, type ParsedCall } from '../teamsCalls';

const overlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2400, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};
const panel: React.CSSProperties = {
  width: 'min(780px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
};
const field: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px',
  padding: '6px 9px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};
const chip = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent-color)' : 'var(--bg-hover)', color: active ? '#fff' : 'var(--text-secondary)',
  border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`, borderRadius: '14px', padding: '3px 10px',
  fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
});
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '16px 0 8px' };
const card: React.CSSProperties = { background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' };

export interface GapBlock { title: string; project: string; date: string; start: string; end: string; details: string[]; status: string }

type Kind = 'Toplantı' | 'Çalışma' | 'Mola' | 'Diğer';

function GapRow({ ymd, gap, projectNames, onAdd, onLog, onIgnore }: {
  ymd: string; gap: Interval; projectNames: string[];
  onAdd: (b: GapBlock) => Promise<void>; onLog: (ymd: string, start: string, end: string, title: string, status: string) => Promise<void>; onIgnore: () => void;
}) {
  const [kind, setKind] = useState<Kind>('Toplantı');
  const [project, setProject] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(hmOf(gap.start));
  const [end, setEnd] = useState(hmOf(gap.end));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const minutes = Math.round((gap.end - gap.start) / MINUTE);
  const writes = kind === 'Toplantı' || kind === 'Çalışma';

  const save = async () => {
    if (end <= start) { setErr('Bitiş başlangıçtan sonra olmalı.'); return; }
    setBusy(true); setErr('');
    try {
      if (writes) {
        const t = title.trim() || (project ? `${project} ${kind === 'Toplantı' ? 'toplantısı' : 'çalışması'}` : kind);
        await onAdd({ title: t, project, date: ymd, start, end, details: [], status: `${kind.toLowerCase()} (boşluktan)` });
      } else {
        await onLog(ymd, start, end, title.trim() || kind, kind.toLowerCase());
      }
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false); }
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <strong style={{ fontSize: '13px' }}>{hmOf(gap.start)}–{hmOf(gap.end)}</strong>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatDuration(minutes * 60)} hareket yok. Ne yaptınız?</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
        {(['Toplantı', 'Çalışma', 'Mola', 'Diğer'] as Kind[]).map(k => <button key={k} type="button" style={chip(kind === k)} onClick={() => setKind(k)}>{k}</button>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={field} aria-label="Başlangıç" />
        <span style={{ color: 'var(--text-muted)' }}>–</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={field} aria-label="Bitiş" />
        {writes && (
          <select value={project} onChange={(e) => setProject(e.target.value)} style={{ ...field, flex: '1 1 140px' }}>
            <option value="">Proje yok</option>
            {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={writes ? 'Başlık (örn. Betül ile Teams görüşmesi)' : 'Not (isteğe bağlı)'} style={{ ...field, flex: '2 1 200px' }} />
        <button type="button" style={{ ...btn, background: writes ? 'var(--accent-color)' : 'var(--bg-hover)', color: writes ? '#fff' : undefined, border: writes ? 'none' : undefined, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>
          {writes ? <><CalendarPlus size={14} /> Takvime işle</> : 'Kaydet'}
        </button>
        <button type="button" style={btn} disabled={busy} onClick={onIgnore} title="Bu aralığı bir daha sorma">Sorma</button>
      </div>
      {err && <div style={{ marginTop: '6px', fontSize: '12px', color: '#ef4444' }}>{err}</div>}
    </div>
  );
}

function CallRow({ call, gaps, projectNames, defaultProject, onAdd, onSkip }: {
  call: ParsedCall; gaps: Interval[]; projectNames: string[]; defaultProject: string;
  onAdd: (b: GapBlock, rememberProject: string) => Promise<void>; onSkip: () => void;
}) {
  const dur = call.seconds * 1000;
  // Süreye uyan en küçük hareketsiz aralık; yoksa en büyüğü; hiç yoksa öğlen 12:00.
  const fit = gaps.filter(g => g.end - g.start >= dur).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] || gaps.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const initStart = fit ? fit.start : (parseSlot(call.ymd, '12:00-12:30')?.start || 0);
  const [start, setStart] = useState(hmOf(initStart));
  const [end, setEnd] = useState(hmOf(Math.min(initStart + Math.max(dur, 5 * 60_000), fit ? Math.max(fit.end, initStart + 5 * 60_000) : Infinity)));
  const [project, setProject] = useState(defaultProject);
  const [title, setTitle] = useState(`${call.person} ile görüşme`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (end <= start) { setErr('Bitiş başlangıçtan sonra olmalı.'); return; }
    setBusy(true); setErr('');
    try {
      await onAdd({ title: title.trim() || `${call.person} ile görüşme`, project, date: call.ymd, start, end, details: [`Teams ${call.direction.toLowerCase()} arama: ${call.person} (${formatDuration(call.seconds)})`], status: 'Teams araması' }, project);
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false); }
  };
  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Phone size={13} />
        <strong style={{ fontSize: '13px' }}>{call.person}</strong>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{call.ymd} · {call.direction} · {formatDuration(call.seconds)}</span>
        {fit ? <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>önerilen aralık: {hmOf(fit.start)}–{hmOf(fit.end)} boşluğuna uyuyor</span>
          : <span style={{ fontSize: '11.5px', color: '#f59e0b' }}>o gün uygun boşluk bulunamadı, saati siz girin</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={field} aria-label="Başlangıç" />
        <span style={{ color: 'var(--text-muted)' }}>–</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={field} aria-label="Bitiş" />
        <select value={project} onChange={(e) => setProject(e.target.value)} style={{ ...field, flex: '1 1 140px' }}>
          <option value="">Proje yok</option>
          {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...field, flex: '2 1 200px' }} />
        <button type="button" style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}><CalendarPlus size={14} /> Ekle</button>
        <button type="button" style={btn} disabled={busy} onClick={onSkip}>Atla</button>
      </div>
      {err && <div style={{ marginTop: '6px', fontSize: '12px', color: '#ef4444' }}>{err}</div>}
    </div>
  );
}

// Hareketsiz geçen aralıklar (toplantı/başka iş olabilir) ve yapıştırılan Teams arama listesi. Hiçbir şey otomatik yazılmaz: siz onaylarsınız.
export default function GapsModal({ days, gapsFor, projectNames, callMap, callsAdded, includeProjectless, onToggleProjectless, onAddBlock, onLog, onIgnoreGap, onCallDone, onClose }: {
  days: string[];
  gapsFor: (ymd: string) => Interval[];
  projectNames: string[];
  callMap: Record<string, string>;
  callsAdded: Set<string>;
  includeProjectless: boolean;
  onToggleProjectless: (v: boolean) => void;
  onAddBlock: (b: GapBlock) => Promise<void>;
  onLog: (ymd: string, start: string, end: string, title: string, status: string) => Promise<void>;
  onIgnoreGap: (ymd: string, gap: Interval) => void;
  onCallDone: (call: ParsedCall, project: string) => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState(days[0]);
  const [tick, setTick] = useState(0); // listeyi yeniden hesaplat
  const gaps = useMemo(() => gapsFor(day), [day, tick, gapsFor]);
  const [pasted, setPasted] = useState('');
  const [calls, setCalls] = useState<ParsedCall[] | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

  const parse = () => {
    const found = parseTeamsCalls(pasted).filter(c => c.seconds >= 5 * 60 && !callsAdded.has(c.key));
    setCalls(found);
  };

  return createPortal(
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Boşluklar ve aramalar</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>Uygulamada hareket olmayan aralıklar ve Teams aramaları. Hiçbir şey sizin onayınız olmadan yazılmaz.</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '5px 8px' }} title="Kapat"><X size={14} /></button>
        </div>

        <div style={label}>Hareketsiz aralıklar</div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          {days.map((d, i) => <button key={d} type="button" style={chip(day === d)} onClick={() => setDay(d)}>{i === 0 ? 'Bugün' : i === 1 ? 'Dün' : d}</button>)}
        </div>
        {gaps.length === 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
            {day} için sorulacak boşluk yok. (Yalnızca günün ilk ve son hareketi arasındaki, 20 dakikadan uzun ve 08:00–20:00 içindeki aralıklar sorulur.)
          </div>
        )}
        {gaps.map(g => (
          <GapRow
            key={`${day}|${g.start}|${g.end}`}
            ymd={day}
            gap={g}
            projectNames={projectNames}
            onAdd={async (b) => { await onAddBlock(b); setTick(t => t + 1); }}
            onLog={async (...a) => { await onLog(...a); onIgnoreGap(day, g); setTick(t => t + 1); }}
            onIgnore={() => { onIgnoreGap(day, g); setTick(t => t + 1); }}
          />
        ))}

        <div style={label}>Teams aramaları</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
          Teams'te Aramalar &gt; Geçmiş listesini seçip kopyalayın, buraya yapıştırın. Kişi, gün ve süre okunur; 5 dakikadan kısa aramalar alınmaz. Aramanın saati listede olmadığı için süreye uyan hareketsiz aralık önerilir, siz onaylarsınız.
        </div>
        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} style={{ ...field, width: '100%', resize: 'vertical' }} placeholder="Betül Ünlü  Giden  Dün  1sa 48dk …" />
        <div style={{ marginTop: '8px' }}>
          <button type="button" style={btn} onClick={parse} disabled={!pasted.trim()}>Aramaları çöz</button>
        </div>
        {calls && calls.length === 0 && <div style={{ marginTop: '8px', fontSize: '12.5px', color: 'var(--text-muted)' }}>Eklenecek arama bulunamadı (5 dakikadan kısa, daha önce eklenmiş ya da metin okunamadı).</div>}
        {calls && calls.filter(c => !doneKeys.has(c.key)).map(c => (
          <CallRow
            key={c.key}
            call={c}
            gaps={gapsFor(c.ymd)}
            projectNames={projectNames}
            defaultProject={callMap[c.person.toLocaleLowerCase('tr')] || ''}
            onAdd={async (b, proj) => { await onAddBlock(b); onCallDone(c, proj); setDoneKeys(s => new Set(s).add(c.key)); setTick(t => t + 1); }}
            onSkip={() => { onCallDone(c, ''); setDoneKeys(s => new Set(s).add(c.key)); }}
          />
        ))}

        <div style={label}>Ayar</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeProjectless} onChange={(e) => onToggleProjectless(e.target.checked)} style={{ marginTop: '2px' }} />
          <span>Projeye bağlı olmayan notları da say (kapalıyken yalnızca proje notları, proje klasörleri ve [project:] etiketli görevler özete girer)</span>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button type="button" style={btn} onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
