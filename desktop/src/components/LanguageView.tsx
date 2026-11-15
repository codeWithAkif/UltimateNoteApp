import React, { useEffect, useMemo, useRef, useState } from 'react';
import { synthesizeSpeech, isGeminiConfigured } from '../services/geminiMentor';
import { isClaudeConfigured } from '../services/claudeApi';
import { pcmBase64ToWavUrl, stripMarkdownForSpeech } from '../aiTeacher';
import {
  LANGUAGE_LAB_NOTE_PATH, LEVELS, parseLabState, serializeLabState, todayKey,
  minutesToday, inputStreak, applyFeedback, pickReviewWords, generateReading, adaptSource,
  explainWord, translateSentence, generatePlacement, levelFromPlacement,
  type LanguageLabState, type LabReading, type PlacementPassage, type SavedWord, type WordExplanation
} from '../services/languageLab';

interface LanguageViewProps {
  fileContents: Record<string, string>;
  onSaveNote: (path: string, content: string, opts?: { lightweight?: boolean }) => Promise<void>;
}

interface Token { text: string; isWord: boolean; start: number }

const tokenize = (text: string): Token[] => {
  const Seg = (Intl as any).Segmenter;
  if (Seg) {
    const out: Token[] = [];
    for (const s of new Seg(undefined, { granularity: 'word' }).segment(text)) {
      out.push({ text: s.segment, isWord: !!s.isWordLike, start: s.index });
    }
    return out;
  }
  const out: Token[] = [];
  const re = /(\p{L}[\p{L}\p{M}'’-]*)|([^\p{L}]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ text: m[0], isWord: !!m[1], start: m.index });
  return out;
};

interface Segment { start: number; end: number; text: string; tokens: Token[] }

const splitSegments = (text: string, tokens: Token[]): Segment[] => {
  const re = /[^.!?。！？\n]+[.!?。！？]*["'”’)]*\s*|[.!?。！？]+\s*|\n+/g;
  const out: Segment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({ start, end, text: m[0], tokens: tokens.filter(t => t.start >= start && t.start < end) });
  }
  return out;
};

const card: React.CSSProperties = {
  background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 12, padding: 16
};
const btn = (primary = false, disabled = false): React.CSSProperties => ({
  padding: '9px 14px', borderRadius: 8, border: primary ? 'none' : '1px solid rgba(148,163,184,0.35)',
  background: primary ? '#0ea5e9' : 'transparent', color: primary ? '#04131c' : '#e2e8f0',
  fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1
});

const TOPICS = ['Günlük hayat', 'Seyahat', 'Yemek', 'Teknoloji', 'İş hayatı', 'Macera hikâyesi'];

export default function LanguageView({ fileContents, onSaveNote }: LanguageViewProps) {
  const raw = fileContents[LANGUAGE_LAB_NOTE_PATH];
  const [override, setOverride] = useState<LanguageLabState | null>(null);
  const base = useMemo(() => parseLabState(raw), [raw]);
  const state = override ?? base;
  const lastSaved = useRef('');
  const chain = useRef<Promise<void>>(Promise.resolve());

  const persist = (next: LanguageLabState) => {
    setOverride(next);
    const text = serializeLabState(next);
    lastSaved.current = text;
    chain.current = chain.current
      .then(() => onSaveNote(LANGUAGE_LAB_NOTE_PATH, text, { lightweight: true }))
      .catch(e => console.error('Dil Atölyesi kaydı başarısız:', e));
  };
  useEffect(() => {
    if (override && raw === lastSaved.current) setOverride(null);
  }, [raw]);

  const [tab, setTab] = useState<'read' | 'source' | 'words'>('read');
  const [langInput, setLangInput] = useState('');
  const [placement, setPlacement] = useState<PlacementPassage[] | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<'story' | 'dialogue'>('story');
  const [sourceText, setSourceText] = useState('');
  const [reading, setReading] = useState<LabReading | null>(null);
  const [reviewUsed, setReviewUsed] = useState<SavedWord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<{ word: string; sentence: string; segStart: number; exp: WordExplanation | null; loading: boolean; translation: string | null } | null>(null);
  const translations = useRef<Map<string, string>>(new Map());
  const [audioKey, setAudioKey] = useState<'full' | 'sentence' | null>(null);
  const [finished, setFinished] = useState(false);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const startRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const aiReady = isGeminiConfigured() || isClaudeConfigured();

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setAudioState('idle');
    setAudioKey(null);
  };
  useEffect(() => stopAudio, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const openReading = (r: LabReading, review: SavedWord[]) => {
    stopAudio();
    setReading(r); setReviewUsed(review); setFinished(false); setPicked(null);
    startRef.current = Date.now();
  };

  const startPlacement = () => run(async () => {
    const lang = langInput.trim();
    if (!lang) return;
    const p = await generatePlacement(lang);
    setPlacement(p); setAnswers([]);
  });

  const finishSetup = (level: typeof LEVELS[number]) => {
    persist({ ...state, language: langInput.trim(), level });
    setPlacement(null);
  };

  const generate = () => run(async () => {
    const review = pickReviewWords(state);
    openReading(await generateReading(state.language, state.level, topic, review, format), review);
  });

  const adapt = () => run(async () => {
    if (!sourceText.trim()) return;
    openReading(await adaptSource(state.language, state.level, sourceText), []);
  });

  const onWordClick = (token: Token, seg: Segment) => {
    if (!reading) return;
    const sentence = seg.text.trim();
    const key = token.text.toLowerCase();
    const g = reading.glossary.find(x => x.word.toLowerCase() === key);
    const cached = translations.current.get(sentence) ?? null;
    setPicked({
      word: token.text, sentence, segStart: seg.start,
      exp: g ? { meaning: g.meaning, note: '' } : null, loading: !g, translation: cached
    });
    if (!g) {
      explainWord(state.language, token.text, sentence)
        .then(exp => setPicked(p => (p && p.word === token.text && p.segStart === seg.start ? { ...p, exp, loading: false } : p)))
        .catch(e => { setPicked(p => (p ? { ...p, loading: false } : p)); setError(String(e?.message || e)); });
    }
    if (cached === null) {
      translateSentence(state.language, sentence)
        .then(tr => {
          translations.current.set(sentence, tr);
          setPicked(p => (p && p.sentence === sentence ? { ...p, translation: tr } : p));
        })
        .catch(e => setError(String(e?.message || e)));
    }
  };

  const saveWord = () => {
    if (!picked?.exp) return;
    const key = picked.word.toLowerCase();
    if (state.words.some(w => w.word.toLowerCase() === key)) { setPicked(null); return; }
    persist({
      ...state,
      words: [...state.words, { word: picked.word, meaning: picked.exp.meaning, context: picked.sentence, seen: 1, added: todayKey() }]
    });
    setPicked(null);
  };

  const playAudio = async (text: string, key: 'full' | 'sentence') => {
    if (audioState !== 'idle' && audioKey === key) { stopAudio(); return; }
    stopAudio();
    setAudioKey(key); setAudioState('loading'); setError('');
    try {
      const { audioBase64, mimeType } = await synthesizeSpeech(stripMarkdownForSpeech(text).slice(0, 1800));
      const audio = new Audio(pcmBase64ToWavUrl(audioBase64, mimeType));
      audioRef.current = audio;
      audio.addEventListener('ended', () => { setAudioState('idle'); setAudioKey(null); });
      await audio.play();
      setAudioState('playing');
    } catch (e: any) {
      setAudioState('idle'); setAudioKey(null);
      setError(String(e?.message || e));
    }
  };

  const finish = (fb: 'easy' | 'ok' | 'hard') => {
    if (!reading) return;
    const minutes = Math.min(30, Math.max(1, Math.round((Date.now() - startRef.current) / 60000)));
    const lower = reading.text.toLowerCase();
    const reviewed = new Set(reviewUsed.filter(w => lower.includes(w.word.toLowerCase())).map(w => w.word));
    const words = state.words.map(w => (reviewed.has(w.word) ? { ...w, seen: w.seen + 1 } : w));
    const wordCount = reading.text.split(/\s+/).filter(Boolean).length;
    persist(applyFeedback({ ...state, words, log: [...state.log, { date: todayKey(), minutes, words: wordCount }] }, fb));
    stopAudio();
    setFinished(true);
  };

  const segments = useMemo(() => (reading ? splitSegments(reading.text, tokenize(reading.text)) : []), [reading]);

  if (!state.language) {
    return (
      <div style={{ height: '100%', overflowY: 'auto', padding: 20, color: '#e2e8f0' }} className="custom-scroll">
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0 }}>🌍 Dil Atölyesi</h2>
          <div style={card}>
            Gramer ve ezber yok. Seviyenin biraz üstünde, anlayabileceğin içeriğe bol bol maruz kalarak dili edinirsin.
            Hangi dili istersen seçebilirsin.
          </div>
          {!aiReady && <div style={{ ...card, borderColor: '#f59e0b' }}>Önce Ayarlar &gt; AI Mentor bölümünden Gemini ya da Claude anahtarı ekle.</div>}
          {!placement && (
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                value={langInput}
                onChange={e => setLangInput(e.target.value)}
                placeholder="Öğrenmek istediğin dil (ör. İspanyolca, Japonca, Korece...)"
                style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={btn(true, busy || !langInput.trim() || !aiReady)} disabled={busy || !langInput.trim() || !aiReady} onClick={startPlacement}>
                  {busy ? 'Hazırlanıyor...' : 'Seviyemi tespit et'}
                </button>
                <button style={btn(false, !langInput.trim())} disabled={!langInput.trim()} onClick={() => finishSetup('A1')}>
                  Sıfırdan başla
                </button>
              </div>
            </div>
          )}
          {placement && (() => {
            const i = answers.length;
            if (i >= placement.length) {
              const lvl = levelFromPlacement(answers, placement);
              return (
                <div style={card}>
                  <div style={{ marginBottom: 10 }}>Başlangıç seviyen: <b>{lvl}</b></div>
                  <button style={btn(true)} onClick={() => finishSetup(lvl)}>Başla</button>
                </div>
              );
            }
            return (
              <div style={card}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>Metin {i + 1}/{placement.length} — çeviri gerekmeden anladın mı?</div>
                <div style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 12 }}>{placement[i].text}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btn(true)} onClick={() => setAnswers([...answers, true])}>Anladım</button>
                  <button style={btn()} onClick={() => setAnswers([...answers, false, ...Array(placement.length - i - 1).fill(false)])}>Anlamadım</button>
                </div>
              </div>
            );
          })()}
          {error && <div style={{ ...card, borderColor: '#ef4444' }}>{error}</div>}
        </div>
      </div>
    );
  }

  const todayMin = minutesToday(state);
  const streak = inputStreak(state);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, color: '#e2e8f0' }} className="custom-scroll">
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>🌍 {state.language} · {state.level}</h2>
          <div style={{ opacity: 0.8, fontSize: 14 }}>Bugün {todayMin} dk · Seri {streak} gün · {state.words.length} kelime</div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {([['read', 'Günlük'], ['source', 'Kendi kaynağım'], ['words', 'Kelimelerim']] as const).map(([id, label]) => (
            <button key={id} style={btn(tab === id)} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {error && <div style={{ ...card, borderColor: '#ef4444' }}>{error}</div>}

        {tab === 'read' && !reading && (
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>Konu seç ya da yaz. Kayıtlı kelimelerin metne doğal şekilde karışır.</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TOPICS.map(t => <button key={t} style={btn(topic === t)} onClick={() => setTopic(t)}>{t}</button>)}
            </div>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Kendi konun (isteğe bağlı)"
              style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button style={btn(format === 'story')} onClick={() => setFormat('story')}>Hikâye</button>
              <button style={btn(format === 'dialogue')} onClick={() => setFormat('dialogue')}>Diyalog</button>
              <button style={btn(true, busy || !aiReady)} disabled={busy || !aiReady} onClick={generate}>
                {busy ? 'Yazılıyor...' : 'Yeni içerik üret'}
              </button>
            </div>
          </div>
        )}

        {tab === 'source' && !reading && (
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>Bir makale, haber ya da video transkripti yapıştır. Seviyene uyarlanır.</div>
            <textarea
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
              rows={8}
              placeholder="Metni buraya yapıştır..."
              style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit', resize: 'vertical' }}
            />
            <div><button style={btn(true, busy || !sourceText.trim() || !aiReady)} disabled={busy || !sourceText.trim() || !aiReady} onClick={adapt}>
              {busy ? 'Uyarlanıyor...' : 'Seviyeme uyarla'}
            </button></div>
          </div>
        )}

        {tab !== 'words' && reading && (
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 18 }}>{reading.title}</b>
              <button style={btn(false, audioState === 'loading' && audioKey === 'full')} disabled={audioState === 'loading' && audioKey === 'full'} onClick={() => playAudio(reading.text, 'full')}>
                {audioKey === 'full' && audioState === 'loading' ? 'Ses hazırlanıyor...' : audioKey === 'full' && audioState === 'playing' ? '⏹ Durdur' : '🔊 Tümünü dinle'}
              </button>
            </div>
            <div style={{ fontSize: 19, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
              {segments.map(seg => (
                <React.Fragment key={seg.start}>
                  {seg.tokens.map((t, i) => t.isWord
                    ? <span key={i} onClick={() => onWordClick(t, seg)} style={{ cursor: 'pointer', borderBottom: '1px dotted rgba(56,189,248,0.5)' }}>{t.text}</span>
                    : <span key={i}>{t.text}</span>)}
                  {picked && picked.segStart === seg.start && (
                    <div style={{ ...card, background: 'rgba(14,165,233,0.1)', margin: '8px 0', fontSize: 16, lineHeight: 1.6, whiteSpace: 'normal' }}>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>{picked.word}</div>
                      {picked.loading && <div style={{ opacity: 0.7 }}>Bakılıyor...</div>}
                      {picked.exp && <>
                        <div style={{ marginTop: 4 }}>{picked.exp.meaning}</div>
                        {picked.exp.note && <div style={{ opacity: 0.75, marginTop: 4 }}>{picked.exp.note}</div>}
                      </>}
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(148,163,184,0.2)' }}>
                        <div style={{ opacity: 0.6, fontSize: 13 }}>Cümlenin anlamı</div>
                        <div>{picked.translation ?? 'Çevriliyor...'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button style={btn(true, !picked.exp)} disabled={!picked.exp} onClick={saveWord}>Kelimelerime ekle</button>
                        <button style={btn(false, audioKey === 'sentence' && audioState === 'loading')} disabled={audioKey === 'sentence' && audioState === 'loading'} onClick={() => playAudio(picked.sentence, 'sentence')}>
                          {audioKey === 'sentence' && audioState === 'loading' ? 'Ses hazırlanıyor...' : audioKey === 'sentence' && audioState === 'playing' ? '⏹ Durdur' : '🔊 Cümleyi oku'}
                        </button>
                        <button style={btn()} onClick={() => { stopAudio(); setPicked(null); }}>Kapat</button>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
            <div style={{ opacity: 0.6, fontSize: 13 }}>Bilmediğin kelimeye dokun, anlamı bu cümledeki hâliyle gör.</div>

            {!finished ? (
              <div>
                <div style={{ marginBottom: 6 }}>Bitirdin mi? Zorluk nasıldı?</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btn()} onClick={() => finish('easy')}>Kolaydı</button>
                  <button style={btn(true)} onClick={() => finish('ok')}>Tam kıvamında</button>
                  <button style={btn()} onClick={() => finish('hard')}>Zordu</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>Kaydedildi. Seviye: <b>{state.level}</b></span>
                <button style={btn(true)} onClick={() => { stopAudio(); setReading(null); }}>Yeni içerik</button>
              </div>
            )}
          </div>
        )}

        {tab === 'words' && (
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {state.words.length === 0 && <div style={{ opacity: 0.7 }}>Henüz kelime yok. Okurken bilmediğin kelimelere dokunup ekle.</div>}
            {[...state.words].reverse().map(w => (
              <div key={w.word + w.added} style={{ borderBottom: '1px solid rgba(148,163,184,0.15)', paddingBottom: 8 }}>
                <div><b>{w.word}</b> — {w.meaning}</div>
                <div style={{ opacity: 0.65, fontSize: 14 }}>{w.context}</div>
                <div style={{ opacity: 0.5, fontSize: 12 }}>{w.seen} kez karşılaştın</div>
              </div>
            ))}
            <div>
              <button style={btn()} onClick={() => { if (window.confirm('Dil ve seviye sıfırlansın mı? Kelimeler kalır.')) persist({ ...state, language: '', easyStreak: 0, hardStreak: 0 }); }}>
                Dili değiştir
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
