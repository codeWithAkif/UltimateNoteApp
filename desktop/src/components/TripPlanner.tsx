import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, FileText, Route, Sparkles } from 'lucide-react';
import { isGeminiConfigured } from '../services/geminiMentor';
import { PROFILE_PATH, mapsRouteUrl, mapsSearchUrl, parseLocation } from '../services/errandPlanner';
import {
  GEZI_PAGE_PATH, TRIP_KINDS, archivePath, kindLabel, planItinerary, questionsFor, stepsToStops, suggestTrips,
  travelModeOf, tripMarkdown, weatherBlock,
  type Answers, type Step, type Suggestion, type TripKind
} from '../services/tripPlanner';
import { datesForWhen, fetchForecast, geocode, outdoorFriendly, weatherLine, type DayWeather } from '../services/weather';

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
  borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none'
};
const primary: React.CSSProperties = { ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none' };
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  color: 'var(--text-primary)', borderRadius: '6px', padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit'
};
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '14px 0 6px' };

const DEFAULTS_KEY = 'trip_answers_v1';
const readDefaults = (kind: TripKind): Answers => {
  try { return (JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}') || {})[kind] || {}; } catch { return {}; }
};
const writeDefaults = (kind: TripKind, answers: Answers) => {
  try {
    const all = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}') || {};
    // "Ne zaman" her seferinde yeniden seçilir; diğer cevaplar bir sonraki sefer hazır gelir.
    const { zaman, ...rest } = answers;
    all[kind] = rest;
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(all));
  } catch { /* yoksay */ }
};

// Gezi sihirbazı: tür -> kısa sorular (+ hava) -> 3 öneri -> seçilene saatli rota -> sayfaya yazılır (Asistan/Gezi.md ve tarihli arşiv).
export default function TripPlannerPanel({ fileContents, onSaveNote, onOpenNote }: {
  fileContents: Record<string, string>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onOpenNote?: (path: string) => void;
}) {
  const [step, setStep] = useState<'kind' | 'questions' | 'suggestions' | 'itinerary'>('kind');
  const [kind, setKind] = useState<TripKind>('haftasonu');
  const [location, setLocation] = useState(() => parseLocation(fileContents[PROFILE_PATH]));
  const [answers, setAnswers] = useState<Answers>({});
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [pick, setPick] = useState<Suggestion | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [rawText, setRawText] = useState('');
  const [pageNote, setPageNote] = useState('');
  const [forecast, setForecast] = useState<DayWeather[]>([]);
  const [weatherState, setWeatherState] = useState<'idle' | 'loading' | 'ok' | 'none'>('idle');
  const [weatherLoc, setWeatherLoc] = useState('');
  const runId = useRef(0);

  const questions = useMemo(() => questionsFor(kind), [kind]);
  const dates = useMemo(() => datesForWhen((answers.zaman || [])[0] || '', new Date()), [answers.zaman]);
  const weather = useMemo(() => weatherBlock(forecast, dates), [forecast, dates]);
  const pickedDays = forecast.filter(d => dates.includes(d.date));

  // Hava tahmini: sorular adımına girince ve konum alanından çıkınca (değiştiyse) çekilir; ağ yoksa havasız devam edilir.
  useEffect(() => {
    if (step !== 'questions' || kind === 'tatil' || !weatherLoc.trim()) return;
    let cancelled = false;
    setWeatherState('loading');
    (async () => {
      const g = await geocode(weatherLoc);
      const days = g ? await fetchForecast(g) : [];
      if (cancelled) return;
      setForecast(days); setWeatherState(days.length ? 'ok' : 'none');
    })();
    return () => { cancelled = true; };
  }, [step, kind, weatherLoc]);

  const startKind = (k: TripKind) => {
    setKind(k); setAnswers(readDefaults(k)); setExtra(''); setError(''); setSuggestions([]); setSeen([]); setPick(null); setSteps([]);
    setWeatherLoc(location);
    setStep('questions');
  };
  const choose = (qid: string, opt: string, multi?: boolean) => setAnswers(prev => {
    const cur = prev[qid] || [];
    if (multi) return { ...prev, [qid]: cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt] };
    return { ...prev, [qid]: cur[0] === opt ? [] : [opt] };
  });

  const guard = (): boolean => {
    if (!isGeminiConfigured()) { setError('Yapay zekâ anahtarı ayarlı değil. Ayarlar > AI Mentor bölümünden Gemini ya da Claude anahtarı ekleyin.'); return false; }
    if (!location.trim()) { setError('Önce çıkış konumunuzu yazın (örn. Taşdelen, Çekmeköy, İstanbul).'); return false; }
    return true;
  };

  const getSuggestions = async (more = false) => {
    if (!guard()) return;
    const id = ++runId.current;
    setBusy(true); setError('');
    writeDefaults(kind, answers);
    try {
      const r = await suggestTrips({ kind, location: location.trim(), answers, extra, weather, now: new Date(), avoid: more ? seen : undefined });
      if (id !== runId.current) return;
      setRawText(r.raw);
      setSuggestions(r.suggestions);
      setSeen(prev => [...prev, ...r.suggestions.map(s => s.title)]);
      setStep('suggestions');
    } catch (e: any) { if (id === runId.current) setError(String(e?.message || e)); }
    finally { if (id === runId.current) setBusy(false); }
  };

  const getItinerary = async (s: Suggestion) => {
    if (!guard()) return;
    const id = ++runId.current;
    setBusy(true); setError(''); setPick(s); setPageNote('');
    try {
      const now = new Date();
      const r = await planItinerary({ kind, location: location.trim(), answers, extra, weather, now, pick: s });
      if (id !== runId.current) return;
      setSteps(r.steps); setNotes(r.notes); setRawText(r.raw); setStep('itinerary');
      if (r.steps.length && onSaveNote) {
        const md = tripMarkdown({ now, kind, location: location.trim(), answers, extra, weather, pick: s, steps: r.steps, notes: r.notes });
        try {
          await onSaveNote(GEZI_PAGE_PATH, md);
          await onSaveNote(archivePath(now, s.title), md);
          setPageNote(`Plan sayfaya yazıldı: ${GEZI_PAGE_PATH} (arşiv: ${archivePath(now, s.title)})`);
        } catch (e: any) { setPageNote(`Plan sayfası yazılamadı: ${String(e?.message || e)}`); }
      }
    } catch (e: any) { if (id === runId.current) setError(String(e?.message || e)); }
    finally { if (id === runId.current) setBusy(false); }
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '6px 11px', borderRadius: '16px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
    background: active ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: active ? '#fff' : 'var(--text-secondary)'
  });

  const stops = stepsToStops(steps);

  return (
    <div>
      {step === 'kind' && (
        <div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '12px' }}>
            Ne planlayalım? Birkaç kısa soru sorarım, hava durumuna bakarım, size 3 öneri sunarım; seçtiğinize saatli bir rota çıkarıp sayfaya yazarım.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            {TRIP_KINDS.map(k => (
              <button key={k.key} type="button" onClick={() => startKind(k.key)} style={{ textAlign: 'left', padding: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                <div style={{ fontSize: '20px' }}>{k.emoji}</div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, marginTop: '4px' }}>{k.label}</div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>{k.hint}</div>
              </button>
            ))}
          </div>
          {onOpenNote && fileContents[GEZI_PAGE_PATH] !== undefined && (
            <button type="button" onClick={() => onOpenNote(GEZI_PAGE_PATH)} style={{ ...btn, marginTop: '14px' }}><FileText size={13} /> Son gezi planını aç</button>
          )}
        </div>
      )}

      {step !== 'kind' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <button type="button" onClick={() => { runId.current++; setBusy(false); setStep(step === 'itinerary' ? 'suggestions' : step === 'suggestions' ? 'questions' : 'kind'); setError(''); }} style={{ ...btn, padding: '5px 9px' }}><ArrowLeft size={13} /> Geri</button>
          <strong style={{ fontSize: '13.5px' }}>{kindLabel(kind)}</strong>
        </div>
      )}

      {step === 'questions' && (
        <div>
          <div style={label}>Çıkış konumunuz</div>
          <input value={location} onChange={(e) => setLocation(e.target.value)} onBlur={() => { if (location.trim() !== weatherLoc.trim()) setWeatherLoc(location); }} placeholder="Semt, ilçe (örn. Taşdelen, Çekmeköy, İstanbul)" maxLength={100} style={inputStyle} />

          {questions.map(q => (
            <div key={q.id}>
              <div style={label}>{q.text}{q.multi ? ' (birden fazla seçebilirsiniz)' : ''}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {q.options.map(o => <button key={o} type="button" onClick={() => choose(q.id, o, q.multi)} style={chip((answers[q.id] || []).includes(o))}>{o}</button>)}
              </div>
            </div>
          ))}

          {kind !== 'tatil' && (
            <div style={{ marginTop: '12px', fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {weatherState === 'loading' && 'Hava durumu alınıyor…'}
              {weatherState === 'none' && 'Hava durumu alınamadı, mevsime göre devam edilecek.'}
              {weatherState === 'ok' && (pickedDays.length === 0
                ? 'Yukarıda "Ne zaman?" seçince o günün hava tahmini burada görünür.'
                : pickedDays.map(d => <div key={d.date} style={{ color: outdoorFriendly(d) ? '#22c55e' : '#eab308' }}>{weatherLine(d)}</div>))}
            </div>
          )}

          <div style={label}>Eklemek istediğiniz (isteğe bağlı)</div>
          <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} maxLength={300} placeholder="Örn. köpeğimle gideceğim, vejetaryen mekân olsun, tekerlekli sandalye uygun" style={{ ...inputStyle, resize: 'vertical' }} />

          <div style={{ marginTop: '14px' }}>
            <button type="button" onClick={() => getSuggestions(false)} disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
              <Sparkles size={13} /> {busy ? 'Öneriler hazırlanıyor…' : 'Önerileri getir'}
            </button>
          </div>
        </div>
      )}

      {step === 'suggestions' && (
        <div>
          <div style={label}>Öneriler</div>
          {suggestions.length === 0 ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>Öneri çıkarılamadı. Modelin yanıtı: {rawText.slice(0, 400)}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {suggestions.map((s, i) => (
                <div key={`${s.title}-${i}`} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, overflowWrap: 'anywhere' }}>{s.title}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 6px', overflowWrap: 'anywhere' }}>
                    {[s.where, s.distance, s.budget ? `Bütçe: ${s.budget}` : ''].filter(Boolean).join(' · ')}
                  </div>
                  {s.why && <div style={{ fontSize: '12.5px', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{s.why}</div>}
                  {s.weatherNote && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px', overflowWrap: 'anywhere' }}>Hava: {s.weatherNote}</div>}
                  <button type="button" onClick={() => getItinerary(s)} disabled={busy} style={{ ...primary, marginTop: '10px', opacity: busy ? 0.6 : 1 }}>
                    <Route size={13} /> {busy && pick?.title === s.title ? 'Rota hazırlanıyor…' : 'Bunu seç, rotayı çıkar'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: '12px' }}>
            <button type="button" onClick={() => getSuggestions(true)} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy && !pick ? 'Aranıyor…' : 'Başka öneriler'}</button>
          </div>
        </div>
      )}

      {step === 'itinerary' && pick && (
        <div>
          <div style={label}>{pick.title}</div>
          {steps.length === 0 ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>Rota çıkarılamadı. Modelin yanıtı: {rawText.slice(0, 400)}</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {steps.map((s, i) => (
                  <div key={i} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, overflowWrap: 'anywhere' }}>{s.time ? `${s.time} · ` : ''}{s.name}</div>
                        {s.address && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{s.address}</div>}
                      </div>
                      <a href={mapsSearchUrl({ name: s.name, address: s.address, errandNumbers: [], why: '' }, location)} target="_blank" rel="noopener noreferrer" style={{ ...btn, padding: '5px 9px', flexShrink: 0 }} title="Haritada aç"><ExternalLink size={12} /></a>
                    </div>
                    {s.what && <div style={{ fontSize: '12.5px', marginTop: '5px', overflowWrap: 'anywhere' }}>{s.what}</div>}
                    {s.note && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '3px', overflowWrap: 'anywhere' }}>Not: {s.note}</div>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {stops.length > 0 && (
                  <a href={mapsRouteUrl(stops, location, travelModeOf(answers))} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: 'var(--accent-glow)', color: 'var(--accent-color)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                    <Route size={13} /> Tüm rotayı haritada aç
                  </a>
                )}
                {onOpenNote && <button type="button" onClick={() => onOpenNote(GEZI_PAGE_PATH)} style={btn}><FileText size={13} /> Sayfayı aç</button>}
              </div>
              {pageNote && <div style={{ marginTop: '8px', fontSize: '11.5px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{pageNote}</div>}
            </>
          )}
          {notes.length > 0 && (
            <ul style={{ margin: '12px 0 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {notes.map((n, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{n}</li>)}
            </ul>
          )}
          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Yer, saat ve fiyat bilgileri web aramasından geldi ve hatalı olabilir; gitmeden doğrulayın.
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  );
}
