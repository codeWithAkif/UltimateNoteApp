import React, { useMemo, useRef, useState } from 'react';
import { MapPin, Plus, Route, ExternalLink, Trash2, Star } from 'lucide-react';
import { isGeminiConfigured } from '../services/geminiMentor';
import {
  PROFILE_PATH, ROUTE_PAGE_PATH, buildStops, collectErrands, detailOf, generateErrandPlan, mapsRouteUrl, mapsSearchUrl,
  optionsByErrand, parseLocation, parsePlaces, removePlace, routeMarkdown, upsertLocation, upsertPlace,
  type Errand, type ErrandTaskInput, type PlaceOption, type SavedPlace
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

// "Dışarı işler" paneli: alışveriş listelerinizdeki ve görevlerinizdeki fiziksel işleri toplar; her iş için 2-4 yer seçeneği
// (uzaklık, puan, saat) sunar. Seçtiğiniz yer "Yerlerim"e kaydedilir ve bir dahaki sefer varsayılan gelir. En son plan her seferinde
// Asistan/Rota.md sayfasına yazılır.
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
  // Profil (konum + yerlerim) bellekte güncel tutulur; her kayıt bu en son içeriğe dayanır.
  const profileRef = useRef<string | undefined>(fileContents[PROFILE_PATH]);
  const [profile, setProfile] = useState<string | undefined>(fileContents[PROFILE_PATH]);
  const savedLocation = useMemo(() => parseLocation(fileContents[PROFILE_PATH]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const [location, setLocation] = useState(savedLocation);
  const [locNote, setLocNote] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [planned, setPlanned] = useState<Errand[]>([]);
  const [byErrand, setByErrand] = useState<Map<number, PlaceOption[]>>(new Map());
  const [choice, setChoice] = useState<Record<number, number>>({});
  const [planNotes, setPlanNotes] = useState<string[]>([]);
  const [rawText, setRawText] = useState('');
  const [pageNote, setPageNote] = useState('');
  const [newPlace, setNewPlace] = useState({ category: '', name: '', address: '' });
  const [showPlaces, setShowPlaces] = useState(false);

  const savedPlaces = parsePlaces(profile);
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

  const saveProfile = async (content: string): Promise<boolean> => {
    if (!onSaveNote) return false;
    try { await onSaveNote(PROFILE_PATH, content); profileRef.current = content; setProfile(content); return true; }
    catch (e: any) { setLocNote(`Kaydedilemedi: ${String(e?.message || e)}`); return false; }
  };
  const saveLocation = async () => {
    if (await saveProfile(upsertLocation(profileRef.current, location))) setLocNote('Konum kaydedildi.');
  };
  const addPlace = async () => {
    const c = newPlace.category.trim(), n = newPlace.name.trim();
    if (!c || !n) return;
    if (await saveProfile(upsertPlace(profileRef.current, { category: c, name: n, address: newPlace.address.trim() }))) setNewPlace({ category: '', name: '', address: '' });
  };
  const deletePlace = async (p: SavedPlace) => { await saveProfile(removePlace(profileRef.current, p.category)); };

  // En son plan sayfası: her üretimde ve seçim değişiminde yeniden yazılır.
  const writePage = async (errands: Errand[], map: Map<number, PlaceOption[]>, ch: Record<number, number>, notes: string[]) => {
    if (!onSaveNote) return;
    try {
      await onSaveNote(ROUTE_PAGE_PATH, routeMarkdown({ now: new Date(), location: location.trim(), errands, byErrand: map, choice: ch, notes }));
      setPageNote(`Plan sayfaya yazıldı: ${ROUTE_PAGE_PATH}`);
    } catch (e: any) { setPageNote(`Plan sayfası yazılamadı: ${String(e?.message || e)}`); }
  };

  const run = async () => {
    if (!isGeminiConfigured()) { setState('error'); setError('Yapay zekâ anahtarı ayarlı değil. Ayarlar > AI Mentor bölümünden Gemini ya da Claude anahtarı ekleyin.'); return; }
    setState('loading'); setError(''); setPageNote('');
    const chosen = selected.slice(0, 12);
    setPlanned(chosen);
    try {
      const saved = parsePlaces(profileRef.current);
      const plan = await generateErrandPlan(location.trim(), chosen, saved);
      const map = optionsByErrand(plan, chosen, saved);
      setByErrand(map); setChoice({}); setPlanNotes(plan.notes); setRawText(plan.raw); setState('ready');
      if (map.size > 0) writePage(chosen, map, {}, plan.notes);
    } catch (e: any) { setState('error'); setError(String(e?.message || e)); }
  };

  // Bir seçeneği elle seçmek, o kategori için kayıtlı yerinizi günceller (bir dahaki sefer varsayılan olur).
  const pick = async (no: number, idx: number) => {
    const next = { ...choice, [no]: idx };
    setChoice(next);
    writePage(planned, byErrand, next, planNotes);
    const o = byErrand.get(no)?.[idx];
    if (o && o.category && !o.saved) await saveProfile(upsertPlace(profileRef.current, { category: o.category, name: o.name, address: o.address }));
    // Kaydedilen yer artık "kayıtlı" sayılır.
    if (o && o.category) {
      setByErrand(prev => {
        const m = new Map(prev);
        m.forEach((arr, k) => m.set(k, arr.map(x => (x.category === o.category ? { ...x, saved: x === o } : x))));
        return m;
      });
    }
  };
  const rememberAll = async () => {
    let content = profileRef.current;
    byErrand.forEach((opts, no) => {
      const o = opts[Math.min(choice[no] ?? 0, opts.length - 1)];
      if (o && o.category) content = upsertPlace(content, { category: o.category, name: o.name, address: o.address });
    });
    if (content !== profileRef.current && await saveProfile(content!)) setPageNote('Seçimleriniz Yerlerim\'e kaydedildi; bir dahaki sefer varsayılan gelir.');
  };

  const stops = useMemo(() => buildStops(byErrand, choice), [byErrand, choice]);
  const srcLabel = (e: Errand) => e.source === 'alınacaklar' ? (e.hint || 'liste') : e.source === 'görev' ? 'görev' : 'elle';

  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '12px' }}>
        Dışarıda yapılacak işlerinizi tek turda toplar: işaretlediğiniz işler ve konumunuz yapay zekâya gönderilir, her iş için
        uzaklık, puan ve saatle birkaç yer seçeneği sunar. Seçtiğiniz yer bir dahaki sefer varsayılan gelir.
      </div>

      <div style={label}>Konumunuz</div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
        <input value={location} onChange={(e) => { setLocation(e.target.value); setLocNote(''); }} placeholder="Semt, ilçe (örn. Taşdelen, Çekmeköy, İstanbul)" maxLength={100} style={inputStyle} />
        {onSaveNote && (
          <button type="button" onClick={saveLocation} disabled={!location.trim() || location.trim() === parseLocation(profile)} style={{ ...btn, opacity: !location.trim() || location.trim() === parseLocation(profile) ? 0.5 : 1 }}>
            <MapPin size={13} /> Kaydet
          </button>
        )}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', minHeight: '16px', marginBottom: '8px' }}>{locNote || (savedLocation ? '' : 'Bir kez kaydedin, bir daha sormam (Sistem/Asistan.md).')}</div>

      <div style={{ marginBottom: '12px' }}>
        <button type="button" onClick={() => setShowPlaces(v => !v)} style={{ ...btn, padding: '5px 10px' }}>
          <Star size={12} /> Yerlerim ({savedPlaces.length}) {showPlaces ? '▴' : '▾'}
        </button>
        {showPlaces && (
          <div style={{ marginTop: '8px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px' }}>
            {savedPlaces.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Henüz kayıtlı yer yok. Aşağıdan ekleyin ya da bir planda seçenek seçin.</div>}
            {savedPlaces.map(p => (
              <div key={p.category} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', padding: '4px 0' }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><strong>{p.category}</strong>: {p.name}{p.address ? ` · ${p.address}` : ''}</span>
                {onSaveNote && <button type="button" onClick={() => deletePlace(p)} title="Sil" style={{ ...btn, padding: '4px 7px' }}><Trash2 size={12} /></button>}
              </div>
            ))}
            {onSaveNote && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                <input value={newPlace.category} onChange={(e) => setNewPlace(v => ({ ...v, category: e.target.value }))} placeholder="Kategori (kuru temizleme)" maxLength={40} style={{ ...inputStyle, flex: '1 1 120px' }} />
                <input value={newPlace.name} onChange={(e) => setNewPlace(v => ({ ...v, name: e.target.value }))} placeholder="Yer adı" maxLength={60} style={{ ...inputStyle, flex: '1 1 120px' }} />
                <input value={newPlace.address} onChange={(e) => setNewPlace(v => ({ ...v, address: e.target.value }))} placeholder="Adres / semt (isteğe bağlı)" maxLength={100} style={{ ...inputStyle, flex: '2 1 160px' }} />
                <button type="button" onClick={addPlace} disabled={!newPlace.category.trim() || !newPlace.name.trim()} style={{ ...btn, opacity: newPlace.category.trim() && newPlace.name.trim() ? 1 : 0.5 }}><Plus size={13} /> Ekle</button>
              </div>
            )}
          </div>
        )}
      </div>

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
        <Route size={14} /> {state === 'loading' ? 'Yerler aranıyor…' : 'Yerleri bul'}
      </button>

      {state === 'error' && <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{error}</div>}

      {state === 'ready' && (
        <div style={{ marginTop: '16px' }}>
          {byErrand.size === 0 ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              Yer çıkarılamadı. Modelin yanıtı: {rawText.slice(0, 400)}
            </div>
          ) : (
            <>
              <div style={label}>Seçenekler</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {Array.from(byErrand.keys()).sort((a, b) => a - b).map(no => {
                  const opts = byErrand.get(no) || [];
                  const sel = Math.min(choice[no] ?? 0, opts.length - 1);
                  return (
                    <div key={no} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '6px', overflowWrap: 'anywhere' }}>{planned[no - 1]?.text}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {opts.map((o, i) => (
                          <label key={`${o.name}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '12.5px', padding: '5px 6px', borderRadius: '6px', background: i === sel ? 'var(--accent-glow)' : 'transparent' }}>
                            <input type="radio" name={`errand-${no}`} checked={i === sel} onChange={() => pick(no, i)} style={{ marginTop: '3px', flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                              <strong>{o.name}</strong>
                              {o.saved && <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--accent-color)', border: '1px solid var(--accent-color)', borderRadius: '8px', padding: '0 5px', whiteSpace: 'nowrap' }}>Yerlerim</span>}
                              {detailOf(o) && <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)' }}>{detailOf(o)}</span>}
                              {o.address && <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>{o.address}</span>}
                              {o.note && !o.saved && <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>{o.note}</span>}
                            </span>
                            <a href={mapsSearchUrl({ name: o.name, address: o.address, errandNumbers: [], why: '' }, location)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ ...btn, padding: '4px 8px', flexShrink: 0 }} title="Haritada aç ve doğrula"><ExternalLink size={12} /></a>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ ...label, marginTop: '14px' }}>Tur ({stops.length} durak)</div>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '12.5px', lineHeight: 1.6 }}>
                {stops.map((s, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}><strong>{s.name}</strong>{s.why ? ` (${s.why})` : ''}</li>)}
              </ol>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                {stops.length > 0 && (
                  <a href={mapsRouteUrl(stops, location)} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: 'var(--accent-glow)', color: 'var(--accent-color)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                    <Route size={13} /> Tüm rotayı haritada aç
                  </a>
                )}
                {onSaveNote && <button type="button" onClick={rememberAll} style={btn}><Star size={13} /> Seçimleri hatırla</button>}
              </div>
              {pageNote && <div style={{ marginTop: '8px', fontSize: '11.5px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{pageNote}</div>}
            </>
          )}
          {planNotes.length > 0 && (
            <ul style={{ margin: '12px 0 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {planNotes.map((n, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{n}</li>)}
            </ul>
          )}
          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Yer bilgileri web aramasından geldi ve hatalı olabilir; puan ve saat eksikse bulunamamıştır. Gitmeden Haritalar'da doğrulayın.
          </div>
        </div>
      )}
    </div>
  );
}
