import React, { useEffect, useMemo, useRef, useState } from 'react';
import { synthesizeSpeech, isGeminiConfigured } from '../services/geminiMentor';
import { isClaudeConfigured } from '../services/claudeApi';
import { pcmBase64ToWavUrl, stripMarkdownForSpeech } from '../aiTeacher';
import {
  LANGUAGE_LAB_NOTE_PATH, LEVELS, parseLabState, serializeLabState, todayKey,
  minutesToday, inputStreak, applyFeedback, pickReviewWords, generateReading, adaptSource,
  explainWord, generatePlacement, levelFromPlacement, makeLabText, addText, textOf,
  type LanguageLabState, type LabText, type PlacementPassage, type SavedWord, type WordExplanation
} from '../services/languageLab';

interface LanguageViewProps {
  fileContents: Record<string, string>;
  onSaveNote: (path: string, content: string, opts?: { lightweight?: boolean }) => Promise<void>;
}

interface Token { text: string; isWord: boolean; start: number }
interface Segment { key: number; text: string; translation: string; newLine: boolean; tokens: Token[] }

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

const buildSegments = (t: LabText): Segment[] =>
  t.sentences.map((s, i) => ({
    key: i, text: s.text.trim(), translation: s.translation, newLine: !!s.newLine, tokens: tokenize(s.text.trim())
  }));

const card: React.CSSProperties = {
  background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 12, padding: 16
};
const btn = (primary = false, disabled = false): React.CSSProperties => ({
  padding: '9px 14px', borderRadius: 8, border: primary ? 'none' : '1px solid rgba(148,163,184,0.35)',
  background: primary ? '#0ea5e9' : 'transparent', color: primary ? '#04131c' : '#e2e8f0',
  fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1
});
const input: React.CSSProperties = {
  padding: 10, borderRadius: 8, border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit'
};

const TOPICS = ['Günlük hayat', 'Seyahat', 'Yemek', 'Teknoloji', 'İş hayatı', 'Macera hikâyesi'];
const KIND_LABEL: Record<LabText['kind'], string> = { story: 'Hikâye', dialogue: 'Diyalog', source: 'Kendi kaynağım' };

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviewUsed, setReviewUsed] = useState<SavedWord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picked, setPicked] = useState<{ word: string; segKey: number; exp: WordExplanation | null; loading: boolean } | null>(null);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [audioKey, setAudioKey] = useState<'full' | 'sentence' | null>(null);
  const startRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const aiReady = isGeminiConfigured() || isClaudeConfigured();
  const reading = useMemo(() => state.texts.find(t => t.id === openId) ?? null, [state.texts, openId]);
  const segments = useMemo(() => (reading ? buildSegments(reading) : []), [reading]);

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setAudioState('idle');
    setAudioKey(null);
  };
  useEffect(() => stopAudio, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const open = (id: string, review: SavedWord[] = []) => {
    stopAudio();
    setOpenId(id); setReviewUsed(review); setPicked(null);
    startRef.current = Date.now();
  };

  const saveAndOpen = (t: LabText, review: SavedWord[]) => {
    const { state: next, dropped } = addText(state, t);
    persist(next);
    if (dropped) setNotice('Liste 50 içeriğe ulaştığı için en eski içerik silindi.');
    open(t.id, review);
  };

  const closeReading = () => {
    if (reading) {
      const minutes = Math.min(30, Math.round((Date.now() - startRef.current) / 60000));
      if (minutes >= 1) persist({ ...state, log: [...state.log, { date: todayKey(), minutes, words: 0 }] });
    }
    stopAudio(); setOpenId(null); setPicked(null);
  };

  const deleteText = (id: string) => {
    if (!window.confirm('Bu içerik silinsin mi?')) return;
    stopAudio();
    persist({ ...state, texts: state.texts.filter(t => t.id !== id) });
    if (openId === id) { setOpenId(null); setPicked(null); }
  };

  const startPlacement = () => run(async () => {
    const lang = langInput.trim();
    if (!lang) return;
    setPlacement(await generatePlacement(lang)); setAnswers([]);
  });

  const finishSetup = (level: typeof LEVELS[number]) => {
    persist({ ...state, language: langInput.trim(), level });
    setPlacement(null);
  };

  const generate = () => run(async () => {
    const review = pickReviewWords(state);
    const r = await generateReading(state.language, state.level, topic, review, format);
    saveAndOpen(makeLabText(r, state.level, format, topic), review);
  });

  const adapt = () => run(async () => {
    if (!sourceText.trim()) return;
    const r = await adaptSource(state.language, state.level, sourceText);
    saveAndOpen(makeLabText(r, state.level, 'source', ''), []);
  });

  const onWordClick = (token: Token, seg: Segment) => {
    if (!reading) return;
    const key = token.text.toLowerCase();
    const g = reading.glossary.find(x => x.word.toLowerCase() === key);
    setPicked({ word: token.text, segKey: seg.key, exp: g ? { meaning: g.meaning, note: '' } : null, loading: !g });
    if (!g) {
      explainWord(state.language, token.text, seg.text)
        .then(exp => setPicked(p => (p && p.word === token.text && p.segKey === seg.key ? { ...p, exp, loading: false } : p)))
        .catch(e => { setPicked(p => (p ? { ...p, loading: false } : p)); setError(String(e?.message || e)); });
    }
  };

  const saveWord = () => {
    if (!picked?.exp) return;
    const key = picked.word.toLowerCase();
    if (state.words.some(w => w.word.toLowerCase() === key)) { setPicked(null); return; }
    const seg = segments.find(s => s.key === picked.segKey);
    persist({
      ...state,
      words: [...state.words, { word: picked.word, meaning: picked.exp.meaning, context: seg?.text ?? '', seen: 1, added: todayKey() }]
    });
    setPicked(null);
  };

  const learnWord = (w: SavedWord) => {
    persist({ ...state, words: state.words.filter(x => x !== w), learnedCount: state.learnedCount + 1 });
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
    const full = textOf(reading);
    const lower = full.toLowerCase();
    const reviewed = new Set(reviewUsed.filter(w => lower.includes(w.word.toLowerCase())).map(w => w.word));
    const words = state.words.map(w => (reviewed.has(w.word) ? { ...w, seen: w.seen + 1 } : w));
    const wordCount = full.split(/\s+/).filter(Boolean).length;
    persist(applyFeedback({
      ...state, words,
      texts: state.texts.filter(t => t.id !== reading.id),
      finishedCount: state.finishedCount + 1,
      log: [...state.log, { date: todayKey(), minutes, words: wordCount }]
    }, fb));
    stopAudio(); setOpenId(null); setPicked(null);
    setNotice('Bitti olarak işaretlendi ve listeden kaldırıldı.');
  };

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
                style={input}
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
          <div style={{ opacity: 0.8, fontSize: 14 }}>
            Bugün {todayMin} dk · Seri {streak} gün · {state.finishedCount} içerik bitti · {state.words.length} kelime
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {([['read', 'Günlük'], ['source', 'Kendi kaynağım'], ['words', 'Kelimelerim']] as const).map(([id, label]) => (
            <button key={id} style={btn(tab === id)} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {error && <div style={{ ...card, borderColor: '#ef4444' }}>{error}</div>}
        {notice && <div style={{ ...card, borderColor: '#22c55e' }}>{notice}</div>}

        {tab !== 'words' && !reading && (
          <>
            {tab === 'read' && (
              <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>Konu seç ya da yaz. Kayıtlı kelimelerin metne doğal şekilde karışır.</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {TOPICS.map(t => <button key={t} style={btn(topic === t)} onClick={() => setTopic(t)}>{t}</button>)}
                </div>
                <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Kendi konun (isteğe bağlı)" style={input} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button style={btn(format === 'story')} onClick={() => setFormat('story')}>Hikâye</button>
                  <button style={btn(format === 'dialogue')} onClick={() => setFormat('dialogue')}>Diyalog</button>
                  <button style={btn(true, busy || !aiReady)} disabled={busy || !aiReady} onClick={generate}>
                    {busy ? 'Yazılıyor...' : 'Yeni içerik üret'}
                  </button>
                </div>
              </div>
            )}
            {tab === 'source' && (
              <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>Bir makale, haber ya da video transkripti yapıştır. Seviyene uyarlanır.</div>
                <textarea
                  value={sourceText}
                  onChange={e => setSourceText(e.target.value)}
                  rows={8}
                  placeholder="Metni buraya yapıştır..."
                  style={{ ...input, resize: 'vertical' }}
                />
                <div><button style={btn(true, busy || !sourceText.trim() || !aiReady)} disabled={busy || !sourceText.trim() || !aiReady} onClick={adapt}>
                  {busy ? 'Uyarlanıyor...' : 'Seviyeme uyarla'}
                </button></div>
              </div>
            )}

            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>Devam eden içerikler ({state.texts.length})</b>
              {state.texts.length === 0 && <div style={{ opacity: 0.7 }}>Henüz içerik yok. Yukarıdan üret ya da kendi metnini ekle.</div>}
              {state.texts.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid rgba(148,163,184,0.15)', paddingTop: 8 }}>
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => open(t.id)}>
                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                    <div style={{ opacity: 0.6, fontSize: 13 }}>
                      {KIND_LABEL[t.kind]} · {t.level}{t.topic ? ` · ${t.topic}` : ''} · {t.created} · {t.sentences.length} cümle
                    </div>
                  </div>
                  <button style={btn()} onClick={() => open(t.id)}>Aç</button>
                  <button style={btn()} onClick={() => deleteText(t.id)} aria-label="Sil">🗑</button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab !== 'words' && reading && (
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button style={btn()} onClick={closeReading}>← Listeye dön</button>
              <button
                style={btn(false, audioState === 'loading' && audioKey === 'full')}
                disabled={audioState === 'loading' && audioKey === 'full'}
                onClick={() => playAudio(textOf(reading), 'full')}
              >
                {audioKey === 'full' && audioState === 'loading' ? 'Ses hazırlanıyor...' : audioKey === 'full' && audioState === 'playing' ? '⏹ Durdur' : '🔊 Tümünü dinle'}
              </button>
            </div>
            <b style={{ fontSize: 18 }}>{reading.title}</b>
            <div style={{ fontSize: 19, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
              {segments.map(seg => (
                <React.Fragment key={seg.key}>
                  {seg.tokens.map((t, i) => t.isWord
                    ? <span key={i} onClick={() => onWordClick(t, seg)} style={{ cursor: 'pointer', borderBottom: '1px dotted rgba(56,189,248,0.5)' }}>{t.text}</span>
                    : <span key={i}>{t.text}</span>)}
                  {picked && picked.segKey === seg.key && (
                    <div style={{ ...card, background: 'rgba(14,165,233,0.1)', margin: '8px 0', fontSize: 16, lineHeight: 1.6, whiteSpace: 'normal' }}>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>{picked.word}</div>
                      {picked.loading && <div style={{ opacity: 0.7 }}>Bakılıyor...</div>}
                      {picked.exp && <>
                        <div style={{ marginTop: 4 }}>{picked.exp.meaning}</div>
                        {picked.exp.note && <div style={{ opacity: 0.75, marginTop: 4 }}>{picked.exp.note}</div>}
                      </>}
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(148,163,184,0.2)' }}>
                        <div style={{ opacity: 0.6, fontSize: 13 }}>Cümlenin anlamı</div>
                        <div>{seg.translation || '—'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button style={btn(true, !picked.exp)} disabled={!picked.exp} onClick={saveWord}>Kelimelerime ekle</button>
                        <button
                          style={btn(false, audioKey === 'sentence' && audioState === 'loading')}
                          disabled={audioKey === 'sentence' && audioState === 'loading'}
                          onClick={() => playAudio(seg.text, 'sentence')}
                        >
                          {audioKey === 'sentence' && audioState === 'loading' ? 'Ses hazırlanıyor...' : audioKey === 'sentence' && audioState === 'playing' ? '⏹ Durdur' : '🔊 Cümleyi oku'}
                        </button>
                        <button style={btn()} onClick={() => { stopAudio(); setPicked(null); }}>Kapat</button>
                      </div>
                    </div>
                  )}
                  {seg.newLine ? '\n' : ' '}
                </React.Fragment>
              ))}
            </div>
            <div style={{ opacity: 0.6, fontSize: 13 }}>Bilmediğin kelimeye dokun, anlamı ve cümlenin çevirisi altında açılır.</div>

            <div>
              <div style={{ marginBottom: 6 }}>Bitirdin mi? Zorluk nasıldı? (Bitti işaretlenir, içerik listeden kalkar.)</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={btn()} onClick={() => finish('easy')}>Kolaydı</button>
                <button style={btn(true)} onClick={() => finish('ok')}>Tam kıvamında</button>
                <button style={btn()} onClick={() => finish('hard')}>Zordu</button>
                <button style={btn()} onClick={() => deleteText(reading.id)}>Bitirmeden sil</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'words' && (
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ opacity: 0.7, fontSize: 14 }}>{state.learnedCount} kelime öğrendin</div>
            {state.words.length === 0 && <div style={{ opacity: 0.7 }}>Henüz kelime yok. Okurken bilmediğin kelimelere dokunup ekle.</div>}
            {[...state.words].reverse().map(w => (
              <div key={w.word + w.added} style={{ borderBottom: '1px solid rgba(148,163,184,0.15)', paddingBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div><b>{w.word}</b> — {w.meaning}</div>
                  <div style={{ opacity: 0.65, fontSize: 14 }}>{w.context}</div>
                  <div style={{ opacity: 0.5, fontSize: 12 }}>{w.seen} kez karşılaştın</div>
                </div>
                <button style={btn()} onClick={() => learnWord(w)}>Öğrendim</button>
              </div>
            ))}
            <div>
              <button style={btn()} onClick={() => { if (window.confirm('Dil ve seviye sıfırlansın mı? Kelimeler ve içerikler kalır.')) persist({ ...state, language: '', easyStreak: 0, hardStreak: 0 }); }}>
                Dili değiştir
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
