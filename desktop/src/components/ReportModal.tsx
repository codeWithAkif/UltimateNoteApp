import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Copy } from 'lucide-react';
import { aggregateRecords, type BlockRecord, type ReportAgg, type ReportResult } from '../sessionAI';
import AiPrivacyControls, { type AiPrivacy } from './AiPrivacyControls';

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
  padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0
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

export interface ReportAiBridge extends AiPrivacy {
  configured: boolean;
  report: (agg: ReportAgg, scope: string, wantMail: boolean) => Promise<ReportResult>;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
export const fmtMin = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return h > 0 ? `${h} sa${r ? ` ${r} dk` : ''}` : `${r} dk`; };

type Period = 'today' | 'yesterday' | 'week' | 'lastweek' | 'month';
const PERIOD_LABEL: Record<Period, string> = { today: 'Bugün', yesterday: 'Dün', week: 'Bu hafta', lastweek: 'Geçen hafta', month: 'Bu ay' };
const rangeOf = (p: Period, now: Date): [string, string] => {
  if (p === 'today') return [ymd(now), ymd(now)];
  if (p === 'yesterday') { const y = addDays(now, -1); return [ymd(y), ymd(y)]; }
  if (p === 'week') return [ymd(mondayOf(now)), ymd(now)];
  if (p === 'lastweek') { const m = addDays(mondayOf(now), -7); return [ymd(m), ymd(addDays(m, 6))]; }
  return [`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, ymd(now)];
};

// Günlük/haftalık rapor ve müşteri durum e-postası taslağı. Süreler uygulama tarafından hesaplanır; yapay zekâ yalnızca anlatır.
// Rapor, bu cihazda işlediğiniz bloklardan kurulur (başka cihazdaki bloklar görünmez).
export default function ReportModal({ records, ai, onClose }: { records: BlockRecord[]; ai: ReportAiBridge; onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('today');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState<'' | 'report' | 'mail'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [copied, setCopied] = useState('');
  const now = useMemo(() => new Date(), []);
  const [from, to] = rangeOf(period, now);
  const scope = from === to ? from : `${from} – ${to}`;

  const projectsInPeriod = useMemo(() => [...new Set(records.filter(r => r.date >= from && r.date <= to).map(r => r.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')), [records, from, to]);
  const agg = useMemo(() => aggregateRecords(records, from, to, project || undefined), [records, from, to, project]);

  const plain = () => `${scope}\n` + agg.projeler.map(p => `- ${p.proje}: ${fmtMin(p.dakika)} (${p.bloklar.length} blok)`).join('\n') + `\nToplam: ${fmtMin(agg.toplamDakika)}`;
  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1800); } catch { setError('Panoya kopyalanamadı; metni elle seçip kopyalayın.'); }
  };

  const run = async (wantMail: boolean) => {
    setBusy(wantMail ? 'mail' : 'report'); setError('');
    try { setResult(await ai.report(agg, scope, wantMail)); }
    catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(''); }
  };

  return createPortal(
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Rapor ve e-posta</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>İşlediğiniz bloklardan günlük/haftalık özet. Süreler uygulama tarafından hesaplanır; bu cihazdaki bloklar gösterilir.</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '5px 8px' }} title="Kapat"><X size={14} /></button>
        </div>

        <div style={label}>Dönem</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          {(Object.keys(PERIOD_LABEL) as Period[]).map(p => <button key={p} type="button" style={chip(period === p)} onClick={() => { setPeriod(p); setResult(null); setProject(''); }}>{PERIOD_LABEL[p]}</button>)}
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{scope}</span>
        </div>
        <div style={{ marginTop: '8px' }}>
          <select value={project} onChange={(e) => { setProject(e.target.value); setResult(null); }} style={field}>
            <option value="">Tüm projeler</option>
            {projectsInPeriod.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={label}>Süreler</div>
        {agg.projeler.length === 0 ? (
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Bu dönemde işlenmiş blok yok.</div>
        ) : (
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 12px' }}>
            {agg.projeler.map(p => (
              <div key={p.proje} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '13px', padding: '3px 0' }}>
                <span>{p.proje} <span style={{ color: 'var(--text-muted)' }}>({p.bloklar.length} blok)</span></span>
                <strong>{fmtMin(p.dakika)}</strong>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '6px 0 0', borderTop: '1px solid var(--border-color)', marginTop: '4px' }}>
              <span>Toplam</span><strong>{fmtMin(agg.toplamDakika)}</strong>
            </div>
          </div>
        )}
        <div style={{ marginTop: '8px' }}>
          <button type="button" style={btn} disabled={agg.projeler.length === 0} onClick={() => copy('plain', plain())}><Copy size={13} /> {copied === 'plain' ? 'Kopyalandı' : 'Süreleri metin olarak kopyala'}</button>
        </div>

        <div style={label}>Yapay zekâ ile</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <button type="button" style={{ ...btn, opacity: !ai.configured || busy || agg.projeler.length === 0 ? 0.6 : 1 }} disabled={!ai.configured || !!busy || agg.projeler.length === 0} onClick={() => run(false)}>
            <Sparkles size={14} /> {busy === 'report' ? 'Çalışıyor…' : 'Özeti oluştur'}
          </button>
          <button type="button" style={{ ...btn, opacity: !ai.configured || busy || !project ? 0.6 : 1 }} disabled={!ai.configured || !!busy || !project}
            title={project ? 'Seçili proje için müşteriye gidecek durum e-postası taslağı' : 'E-posta taslağı için önce tek bir proje seçin'} onClick={() => run(true)}>
            <Sparkles size={14} /> {busy === 'mail' ? 'Çalışıyor…' : 'Müşteri durum e-postası taslağı'}
          </button>
        </div>
        <div style={{ marginTop: '8px' }}><AiPrivacyControls p={ai} /></div>
        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>
          {ai.configured ? 'Yapay zekâya yalnızca görev başlıkları, olay türleri ve süreler gider (not içeriği ve yazdığınız metinler gitmez). Taslak yalnızca gösterilir, hiçbir yere gönderilmez.' : 'Yapay zekâ anahtarı ayarlı değil (Ayarlar > AI Mentor).'}
        </div>
        {error && <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}

        {result && (
          <>
            <div style={label}>Özet</div>
            <textarea value={result.ozet} onChange={(e) => setResult({ ...result, ozet: e.target.value })} rows={4} style={{ ...field, width: '100%', resize: 'vertical', lineHeight: 1.5 }} />
            {result.projeler.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {result.projeler.map((p, i) => (
                  <div key={i} style={{ background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', lineHeight: 1.5 }}>
                    <strong>{p.proje}</strong>: {p.anlati}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: '8px' }}>
              <button type="button" style={btn} onClick={() => copy('ozet', `${scope}\n\n${result.ozet}\n\n${result.projeler.map(p => `${p.proje}: ${p.anlati}`).join('\n')}`)}><Copy size={13} /> {copied === 'ozet' ? 'Kopyalandı' : 'Özeti kopyala'}</button>
            </div>
            {result.eposta && (
              <>
                <div style={label}>E-posta taslağı</div>
                <input value={result.eposta.konu} onChange={(e) => setResult({ ...result, eposta: { ...result.eposta!, konu: e.target.value } })} style={{ ...field, width: '100%', marginBottom: '8px' }} />
                <textarea value={result.eposta.govde} onChange={(e) => setResult({ ...result, eposta: { ...result.eposta!, govde: e.target.value } })} rows={9} style={{ ...field, width: '100%', resize: 'vertical', lineHeight: 1.5 }} />
                <div style={{ marginTop: '8px' }}>
                  <button type="button" style={btn} onClick={() => copy('mail', `Konu: ${result.eposta!.konu}\n\n${result.eposta!.govde}`)}><Copy size={13} /> {copied === 'mail' ? 'Kopyalandı' : 'E-postayı kopyala'}</button>
                </div>
              </>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button type="button" style={btn} onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
