import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, FileText, FolderKanban, Clock, X, AlertTriangle, Sparkles } from 'lucide-react';
import { AREA_LABELS, buildDetails, hmOf, ymdOf, type SessionArea, type SessionItem, type SessionSummary } from '../sessionTracker';
import { overlapsOf, parseSlot, type DayBlock } from '../dayPlan';
import { recordFactsOf, type FactRecord } from '../sessionAI';
import AiPrivacyControls, { type AiPrivacy } from './AiPrivacyControls';

const overlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};
const panel: React.CSSProperties = {
  width: 'min(780px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)',
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

export interface SessionBlockResult { title: string; project: string; date: string; start: string; end: string; details: string[]; items: string[]; kind: 'calisma' | 'toplanti'; facts: FactRecord[] }

// Yapay zekâ köprüsü (App.tsx sağlar): anahtar var mı, adlar gizli mi, anlatı üret, proje tahmin et.
export interface SessionAiBridge extends AiPrivacy {
  configured: boolean;
  narrate: (o: { project: string | null; minutes: number | null; start: string; end: string; kind: 'calisma' | 'toplanti'; items: SessionItem[] }) => Promise<{ summary: string; details: string[] }>;
  guessProject: (title: string) => Promise<string | null>;
}

const AREA_ICONS: Record<SessionArea, React.ReactNode> = {
  notlar: <FileText size={13} />, takvim: <CalendarPlus size={13} />, projeler: <FolderKanban size={13} />
};

const hm = (ms: number) => hmOf(ms);

// "Geçen çalışmanız" penceresi: bir (proje × seans) taslağı; yaptıklarınız onay kutularıyla gelir (aynı türden görevler tek başlık altında),
// seçip başlık/saat girer, ayrıntıları düzenler ve takvime işlersiniz. Takvime yazma ve kayıt tutma App.tsx'te (onProcess/onSkip).
// Arka plana tıklamak pencereyi kapatmaz: yalnızca çarpı ya da "Sonra" kapatır.
export default function SessionSummaryModal({ session, remaining, projectNames, dayBlocksFor, ai, transcriptFor, onProcess, onSkip, onSkipAll, onOpenGaps, onOpenReport, onClose }: {
  session: SessionSummary;
  remaining: number;
  projectNames: string[];
  dayBlocksFor: (ymd: string) => DayBlock[];
  ai: SessionAiBridge;
  transcriptFor?: (session: SessionSummary) => { path: string; lines: string[] } | null;
  onProcess: (b: SessionBlockResult) => Promise<void>;
  onSkip: (items: string[], title: string, start: string, end: string, date: string) => Promise<void>;
  onSkipAll: () => Promise<void>;
  onOpenGaps: () => void;
  onOpenReport: () => void;
  onClose: () => void;
}) {
  const isMeeting = session.kind === 'toplanti';
  const [checked, setChecked] = useState<Set<string>>(() => new Set(session.items.map(i => i.id)));
  const [title, setTitle] = useState(session.suggestedTitle);
  const [project, setProject] = useState(session.suggestedProject || '');
  const [date, setDate] = useState(ymdOf(session.start));
  const [start, setStart] = useState(hmOf(session.start));
  const [end, setEnd] = useState(hmOf(session.end));
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState(() => buildDetails(session.items).join('\n'));
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const transcript = useMemo(() => (isMeeting && transcriptFor ? transcriptFor(session) : null), [session]);
  const [useTranscript, setUseTranscript] = useState(false);

  const selected = useMemo(() => session.items.filter(i => checked.has(i.id)), [session, checked]);
  // Ayrıntılar elle düzenlenmediyse seçimle birlikte kendiliğinden yeniden kurulur.
  const autoDetails = useMemo(() => [
    ...buildDetails(selected),
    ...(useTranscript && transcript ? transcript.lines.map((l, i) => (i === 0 ? `Toplantı özeti: ${l}` : `  ${l}`)) : [])
  ].join('\n'), [selected, useTranscript, transcript]);
  useEffect(() => { if (!detailsDirty) setDetails(autoDetails); }, [autoDetails, detailsDirty]);

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(checked);
    ids.forEach(id => (on ? next.add(id) : next.delete(id)));
    setChecked(next);
  };

  // Alan -> (grup etiketi | tekil) listesi.
  const byArea = (['notlar', 'takvim', 'projeler'] as SessionArea[]).map(a => {
    const list = session.items.filter(i => i.area === a);
    const groups = new Map<string, SessionItem[]>();
    const entries: ({ group: string; items: SessionItem[] } | { item: SessionItem })[] = [];
    list.forEach(i => {
      if (i.group) {
        const g = groups.get(i.group);
        if (g) g.push(i); else { const arr = [i]; groups.set(i.group, arr); entries.push({ group: i.group, items: arr }); }
      } else entries.push({ item: i });
    });
    return { area: a, entries, count: list.length };
  }).filter(g => g.count > 0);

  const dayBlocks = useMemo(() => dayBlocksFor(date), [date, dayBlocksFor]);
  const range = useMemo(() => parseSlot(date, `${start}-${end}`), [date, start, end]);
  const overlaps = range ? overlapsOf(dayBlocks.filter(b => b.id !== session.id), range.start, range.end) : [];

  const detailLines = details.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '');

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
      const all = [...lead, ...detailLines];
      await onProcess({ title: title.trim(), project, date, start, end, details: all, items: all, kind: isMeeting ? 'toplanti' : 'calisma', facts: recordFactsOf(selected) });
    } catch (e: any) { setError(`Takvime işlenemedi: ${String(e?.message || e)}`); setBusy(false); }
  };

  const skip = async () => {
    setBusy(true);
    try { await onSkip(detailLines, title.trim() || session.suggestedTitle, start, end, date); }
    catch (e: any) { setError(String(e?.message || e)); setBusy(false); }
  };

  const runNarrate = async () => {
    setAiBusy(true); setAiMsg('');
    try {
      const r = await ai.narrate({ project: project || null, minutes: session.minutes || null, start, end, kind: isMeeting ? 'toplanti' : 'calisma', items: selected });
      setSummary(r.summary);
      setDetails(r.details.join('\n'));
      setDetailsDirty(true);
      setAiMsg('Yapay zekâ ile oluşturuldu. Gözden geçirip düzenleyin; "Yeniden oluştur" kural tabanlı ayrıntılara döner.');
    } catch (e: any) { setAiMsg(String(e?.message || e)); }
    finally { setAiBusy(false); }
  };
  const runGuess = async () => {
    setAiBusy(true); setAiMsg('');
    try {
      const g = await ai.guessProject(title.trim() || session.suggestedTitle);
      if (g) { setProject(g); setAiMsg(`Önerilen proje: ${g}`); } else setAiMsg('Yapay zekâ emin olamadı, projeyi siz seçin.');
    } catch (e: any) { setAiMsg(String(e?.message || e)); }
    finally { setAiBusy(false); }
  };

  const minutesText = session.minutes ? ` · ${session.minutes} dk aktif` : '';

  return createPortal(
    // Arka plana tıklayınca kapanmaz (uzun listede yanlışlıkla kapanıp seçim kalsın); yalnızca çarpı ya da "Sonra" kapatır.
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>{isMeeting ? 'Toplantı (takvimden)' : 'Geçen çalışmanız'}</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
              {ymdOf(session.start)} · {hm(session.start)}–{hm(session.end)}{minutesText}{remaining > 0 ? ` · ${remaining} bekleyen taslak daha var` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '5px 8px' }} title="Kapat (sonra devam edebilirsiniz)"><X size={14} /></button>
        </div>

        {isMeeting && (
          <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            Takvimdeki bu toplantıyı çalışma süresi olarak bloğa işleyebilirsiniz. Başlığı, projeyi ve saati düzeltin.
          </div>
        )}

        {session.items.length > 0 && (
          <>
            <div style={label}>Neler yaptınız? ({checked.size}/{session.items.length} seçili)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '10px' }}>
              <button type="button" style={chip(false)} onClick={() => setMany(session.items.map(i => i.id), true)}>Hepsini seç</button>
              <button type="button" style={chip(false)} onClick={() => setMany(session.items.map(i => i.id), false)}>Hiçbirini seçme</button>
            </div>
            {byArea.map(g => (
              <div key={g.area} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  {AREA_ICONS[g.area]} {AREA_LABELS[g.area]}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {g.entries.map((en, idx) => {
                    if ('group' in en && en.items.length >= 2) {
                      const ids = en.items.map(i => i.id);
                      const n = ids.filter(id => checked.has(id)).length;
                      return (
                        <div key={`g${idx}`} style={{ background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '7px 10px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                            <input
                              type="checkbox"
                              checked={n === ids.length}
                              ref={el => { if (el) el.indeterminate = n > 0 && n < ids.length; }}
                              onChange={() => setMany(ids, n !== ids.length)}
                              style={{ flexShrink: 0 }}
                            />
                            <span>{en.group} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({ids.length} görev)</span></span>
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', margin: '6px 0 0 22px' }}>
                            {en.items.map(it => (
                              <label key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                <input type="checkbox" checked={checked.has(it.id)} onChange={() => setMany([it.id], !checked.has(it.id))} style={{ marginTop: '3px', flexShrink: 0 }} />
                                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it.title || it.text}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    const it = 'item' in en ? en.item : en.items[0];
                    return (
                      <label key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '7px 10px', background: 'var(--bg-tertiary)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                        <input type="checkbox" checked={checked.has(it.id)} onChange={() => setMany([it.id], !checked.has(it.id))} style={{ marginTop: '3px', flexShrink: 0 }} />
                        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it.text}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        {!isMeeting && session.items.length === 0 && (
          <div style={{ ...label, textTransform: 'none', letterSpacing: 0, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={13} /> Bu aralıkta kayıtlı bir not değişikliği yok (okuma/gezinme). İsterseniz ne yaptığınızı özet alanına yazın.
          </div>
        )}

        <div style={label}>Takvim bloğu</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık (örn. PScope dashboard çalışması)" style={{ ...field, flex: '2 1 260px' }} />
          <select value={project} onChange={(e) => setProject(e.target.value)} style={{ ...field, flex: '1 1 150px' }} title="Bloğun bağlanacağı proje">
            <option value="">Proje yok</option>
            {project && !projectNames.includes(project) && <option value={project}>{project}</option>}
            {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {!project && ai.configured && (
            <button type="button" style={{ ...btn, padding: '6px 10px', opacity: aiBusy ? 0.5 : 1 }} disabled={aiBusy} onClick={runGuess}
              title={ai.hideNames ? 'Başlığa bakarak proje önerir. Adlar gizli kalır: projeler jetonla, daha önce çalıştığınız görev başlıklarıyla birlikte gider' : 'Başlığa bakarak proje önerir (başlık, proje adları ve örnek görev başlıkları yapay zekâya gider)'}>
              <Sparkles size={13} /> Projeyi tahmin et
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={field} aria-label="Başlangıç saati" />
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={field} aria-label="Bitiş saati" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {isMeeting ? 'Saatler takvim etkinliğinden alındı.' : 'Saatler hareket kaydından alındı (molalar sayılmaz); düzeltebilirsiniz.'}
          </span>
        </div>

        {dayBlocks.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{date} günü için bloklar</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {dayBlocks.map((b, i) => {
                const hit = overlaps.includes(b);
                return (
                  <span key={i} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', border: `1px solid ${hit ? '#f59e0b' : 'var(--border-color)'}`, color: hit ? '#f59e0b' : 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}>
                    {hm(b.start)}–{hm(b.end)} {b.title}{b.source === 'bekleyen' ? ' (bekliyor)' : b.source === 'toplanti' ? ' (toplantı)' : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {overlaps.length > 0 && (
          <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '12px', color: '#f59e0b' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>Bu saat aralığı şu bloklarla çakışıyor: {overlaps.map(b => `${b.title} (${hm(b.start)}–${hm(b.end)})`).join(', ')}. Saati düzeltebilir ya da yine de işleyebilirsiniz.</span>
          </div>
        )}

        {transcript && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '10px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={useTranscript} onChange={(e) => setUseTranscript(e.target.checked)} style={{ marginTop: '2px' }} />
            <span>Toplantı transkript özetini ekle <span style={{ color: 'var(--text-muted)' }}>({transcript.path.split('/').pop()})</span></span>
          </label>
        )}

        <div style={{ marginTop: '14px', padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <button type="button" style={{ ...btn, opacity: aiBusy || !ai.configured ? 0.6 : 1 }} disabled={aiBusy || !ai.configured} onClick={runNarrate}
              title="Seçili görev olaylarını kısa bir anlatıya çevirir, görevleri temalara ayırır">
              <Sparkles size={14} /> {aiBusy ? 'Çalışıyor…' : 'Yapay zekâ ile anlat'}
            </button>
          </div>
          <div style={{ marginTop: '8px' }}><AiPrivacyControls p={ai} /></div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>
            {ai.configured
              ? 'Yapay zekâya yalnızca görev başlıkları ve olay türleri gider (not içeriği, yazdığınız özet ve ayrıntı metni gitmez). Önce ücretsiz Gemini, olmazsa Claude kullanılır.'
              : 'Yapay zekâ anahtarı ayarlı değil (Ayarlar > AI Mentor).'}
          </div>
          {aiMsg && <div style={{ fontSize: '12px', marginTop: '6px', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{aiMsg}</div>}
        </div>

        <div style={label}>Genel özet (isteğe bağlı — bloğun ilk maddesi olur)</div>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} style={{ ...field, width: '100%', resize: 'vertical', lineHeight: 1.5 }} placeholder="Örn. PScope bülten ekranını bitirdim, kalanlar test aşamasında" />

        <div style={{ ...label, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Ayrıntılar (bloğun altına madde madde yazılır, düzenleyebilirsiniz)</span>
          {detailsDirty && (
            <button type="button" style={{ ...chip(false), textTransform: 'none', letterSpacing: 0 }} onClick={() => setDetailsDirty(false)} title="Seçime göre yeniden oluştur">Yeniden oluştur</button>
          )}
        </div>
        <textarea
          value={details}
          onChange={(e) => { setDetails(e.target.value); setDetailsDirty(true); }}
          rows={7}
          style={{ ...field, width: '100%', resize: 'vertical', lineHeight: 1.5 }}
          placeholder="Her satır bir madde olur; iki boşlukla başlayan satır üstündeki maddenin altına girer"
        />

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
              title="Bekleyen tüm taslakları takvime yazmadan oturum kaydına geçirir"
              onClick={async () => { setBusy(true); try { await onSkipAll(); } catch (e: any) { setError(String(e?.message || e)); setBusy(false); } }}
            >
              Hepsini atla ({remaining + 1})
            </button>
          )}
          <button type="button" onClick={onOpenGaps} disabled={busy} style={btn} title="Hareketsiz geçen aralıklar ve Teams aramaları">Boşluklar ve aramalar</button>
          <button type="button" onClick={onOpenReport} disabled={busy} style={btn} title="Günlük/haftalık rapor ve müşteri durum e-postası taslağı">Rapor ve e-posta</button>
          <button type="button" onClick={onClose} disabled={busy} style={btn}>Sonra</button>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Yazılacak: günlük notu ({date})</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
