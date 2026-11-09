import React, { useMemo, useState } from 'react';
import { MapPin, Plus, Route, ExternalLink } from 'lucide-react';
import { isGeminiConfigured } from '../services/geminiMentor';
import {
  PROFILE_PATH, collectErrands, generateErrandPlan, mapsRouteUrl, mapsSearchUrl,
  parseLocation, upsertLocation, type Errand, type ErrandPlan, type ErrandTaskInput
} from '../services/errandPlanner';

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
  borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none'
};
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  color: 'var(--text-primary)', borderRadius: '6px', padding: '7px 10px', fontSize: '12.5px'
};
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' };

// "Dışarı işler" paneli: alışveriş listelerinizdeki ve görevlerinizdeki fiziksel işleri toplar, işaretlediklerinizi
// konumunuza yakın, mümkün olan en az duraklı bir tura çevirir ve Google Haritalar rotası verir.
export default function ErrandPlannerPanel({ tasks, fileContents, onSaveNote }: {
  tasks: ErrandTaskInput[];
  fileContents: Record<string, string>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
}) {
  // Aday listesi açıldığı andaki hâliyle sabit: senkron/yazma sırasında satırlar kaymasın.
  const found = useMemo(() => collectErrands(tasks, fileContents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const [manual, setManual] = useState<Errand[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState('');
  const savedLocation = useMemo(() => parseLocation(fileContents[PROFILE_PATH]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const [location, setLocation] = useState(savedLocation);
  const [locNote, setLocNote] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [plan, setPlan] = useState<ErrandPlan | null>(null);
  const [error, setError] = useState('');
  const [planned, setPlanned] = useState<Errand[]>([]);

  const all = [...manual, ...found];
  const selected = all.filter(e => !off.has(e.id));
  const canPlan = selected.length > 0 && location.trim().length > 1 && state !== 'loading';

  const toggle = (id: string) => setOff(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const addCustom = () => {
    const t = custom.trim();
    if (!t) return;
    setManual(prev => [{ id: `elle:${Date.now()}`, text: t, source: 'elle' }, ...prev]);
    setCustom('');
  };
  const saveLocation = async () => {
    if (!onSaveNote) return;
    try { await onSaveNote(PROFILE_PATH, upsertLocation(fileContents[PROFILE_PATH], location)); setLocNote('Konum kaydedildi.'); }
    catch (e: any) { setLocNote(`Kaydedilemedi: ${String(e?.message || e)}`); }
  };
  const run = async () => {
    if (!isGeminiConfigured()) { setState('error'); setError('Yapay zekâ anahtarı ayarlı değil. Ayarlar > AI Mentor bölümünden Gemini ya da Claude anahtarı ekleyin.'); return; }
    setState('loading'); setError(''); setPlan(null);
    const chosen = selected.slice(0, 12);
    setPlanned(chosen);
    try { setPlan(await generateErrandPlan(location.trim(), chosen)); setState('ready'); }
    catch (e: any) { setState('error'); setError(String(e?.message || e)); }
  };

  const srcLabel = (e: Errand) => e.source === 'alınacaklar' ? (e.hint || 'liste') : e.source === 'görev' ? 'görev' : 'elle';

  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '12px' }}>
        Dışarıda yapılacak işlerinizi tek turda toplar: işaretlediğiniz işler ve konumunuz Gemini'ye gönderilir,
        size yakın durakları ve harita rotasını önerir.
      </div>

      <div style={label}>Konumunuz</div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
        <input value={location} onChange={(e) => { setLocation(e.target.value); setLocNote(''); }} placeholder="Semt, ilçe (örn. Taşdelen, Çekmeköy, İstanbul)" maxLength={100} style={inputStyle} />
        {onSaveNote && (
          <button type="button" onClick={saveLocation} disabled={!location.trim() || location.trim() === savedLocation} style={{ ...btn, opacity: !location.trim() || location.trim() === savedLocation ? 0.5 : 1 }}>
            <MapPin size={13} /> Kaydet
          </button>
        )}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', minHeight: '16px', marginBottom: '8px' }}>{locNote || (savedLocation ? '' : 'Bir kez kaydedin, bir daha sormam (Sistem/Asistan.md).')}</div>

      <div style={label}>Yapılacak işler ({selected.length}/{all.length})</div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder="Bir iş ekleyin (örn. kablo al)" maxLength={120} style={inputStyle} />
        <button type="button" onClick={addCustom} disabled={!custom.trim()} style={{ ...btn, opacity: custom.trim() ? 1 : 0.5 }}><Plus size={13} /> Ekle</button>
      </div>
      {all.length === 0 ? (
        <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
          Notlarınızda dışarı iş bulunamadı. Yukarıdan ekleyebilirsiniz. "alınacaklar" klasöründeki açık maddeler ve
          "market, kargo, eczane, kuru temizleme, … almam" gibi geçen görevler burada otomatik listelenir.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px', maxHeight: '190px', overflowY: 'auto' }}>
          {all.map(e => (
            <label key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', cursor: 'pointer', padding: '5px 6px', borderRadius: '6px', background: 'var(--bg-tertiary)' }}>
              <input type="checkbox" checked={!off.has(e.id)} onChange={() => toggle(e.id)} style={{ marginTop: '3px', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{e.text}</span>
              <span style={{ flexShrink: 0, fontSize: '10px', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1px 6px' }}>{srcLabel(e)}</span>
            </label>
          ))}
        </div>
      )}

      <button type="button" onClick={run} disabled={!canPlan} style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none', opacity: canPlan ? 1 : 0.5 }}>
        <Route size={14} /> {state === 'loading' ? 'Planlanıyor…' : 'Rota planla'}
      </button>

      {state === 'error' && <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}

      {state === 'ready' && plan && (
        <div style={{ marginTop: '16px' }}>
          {plan.stops.length === 0 ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              Durak çıkarılamadı. Modelin yanıtı: {plan.raw.slice(0, 400)}
            </div>
          ) : (
            <>
              <div style={label}>Önerilen tur ({plan.stops.length} durak)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {plan.stops.map((s, i) => {
                  const covers = s.errandNumbers.map(n => planned[n - 1]?.text).filter(Boolean) as string[];
                  return (
                    <div key={i} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '13.5px', fontWeight: 700, overflowWrap: 'anywhere' }}>{i + 1}. {s.name}</div>
                          {s.address && <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{s.address}</div>}
                        </div>
                        <a href={mapsSearchUrl(s, location)} target="_blank" rel="noopener noreferrer" style={{ ...btn, padding: '5px 9px', flexShrink: 0 }} title="Haritada aç"><ExternalLink size={12} /> Harita</a>
                      </div>
                      {covers.length > 0 && <div style={{ fontSize: '12px', marginTop: '6px', overflowWrap: 'anywhere' }}>İşler: {covers.join(' · ')}</div>}
                      {s.why && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '3px', overflowWrap: 'anywhere' }}>{s.why}</div>}
                    </div>
                  );
                })}
              </div>
              <a href={mapsRouteUrl(plan.stops, location)} target="_blank" rel="noopener noreferrer" style={{ ...btn, marginTop: '10px', background: 'var(--accent-glow)', color: 'var(--accent-color)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                <Route size={13} /> Tüm rotayı haritada aç
              </a>
            </>
          )}
          {plan.notes.length > 0 && (
            <ul style={{ margin: '12px 0 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {plan.notes.map((n, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{n}</li>)}
            </ul>
          )}
          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Yer bilgileri web aramasından geldi ve hatalı olabilir. Çalışma saatlerini ve stoku gitmeden doğrulayın.
          </div>
        </div>
      )}
    </div>
  );
}
