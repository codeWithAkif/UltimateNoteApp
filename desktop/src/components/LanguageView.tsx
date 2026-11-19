import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getGeminiApiKey } from '../services/geminiMentor';
import { synthesizeLesson } from '../services/lessonSpeech';
import { buildTurns, assignVoices, singleTurnPlan } from '../services/lessonVoices';
import { alignTurns, proportionalStarts, sentenceAt } from '../services/readAlign';
import { getClip, putClip, pruneClips } from '../services/audioCache';
import { stripMarkdownForSpeech } from '../aiTeacher';
import {
  LANGUAGE_LAB_NOTE_PATH, LEVELS, parseLabState, serializeLabState, todayKey,
  minutesToday, inputStreak, applyFeedback, pickReviewWords, generateReading, adaptSource,
  explainWord, sentenceDisplay, generatePlacement, levelFromPlacement, makeLabText, addText, textOf,
  switchLanguage, deleteLanguage, languageNames, totalMinutes, formatDuration, weekMinutes, countOccurrences, generateEpisode, annotateReading,
  type LanguageLabState, type LabText, type LabSeries, type PlacementPassage, type SavedWord, type WordExplanation
} from '../services/languageLab';

interface LanguageViewProps {
  fileContents: Record<string, string>;
  onSaveNote: (path: string, content: string, opts?: { lightweight?: boolean }) => Promise<void>;
  theme?: 'dark' | 'light';
  loaded?: boolean;
}

interface Token { text: string; isWord: boolean; start: number }
interface Segment { key: number; text: string; native: string; translation: string; newLine: boolean; tokens: Token[] }

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
  t.sentences.map((s, i) => {
    const shown = sentenceDisplay(s).trim();
    return { key: i, text: shown, native: s.text.trim(), translation: s.translation, newLine: !!s.newLine, tokens: tokenize(shown) };
  });


const PAL = {
  dark: {
    bg: '#0E1320', surface: '#171E30', surface2: '#1F2840', nav: '#131A2B', text: '#F2F5FA', muted: '#9AA6BF', faint: '#7D89A6',
    line: 'rgba(255,255,255,0.1)', primary: '#2DD4A7', onPrimary: '#0E1320', primaryShadow: '#1A9677', accent: '#FFB547',
    hl: '#FFB547', hlText: '#0E1320', ring: '#FFB547', bar: '#2DD4A7', barDone: '#22C55E', danger: '#F87171', ok: '#2DD4A7',
    hero: 'linear-gradient(135deg,#1C5F5A 0%,#2A3A8F 100%)',
    heading: "'Nunito',system-ui,sans-serif", body: "'Nunito',system-ui,sans-serif", read: "'Nunito',system-ui,sans-serif"
  },
  light: {
    bg: '#F6F1E7', surface: '#FFFDF8', surface2: '#EFE7D6', nav: '#FFFDF8', text: '#2B2620', muted: '#8A7F6E', faint: '#9A8F7C',
    line: '#E4D9C3', primary: '#3F7D5C', onPrimary: '#FFFFFF', primaryShadow: '#2F6148', accent: '#7A4B14',
    hl: '#F3D9A0', hlText: '#2B2620', ring: '#3F7D5C', bar: '#3F7D5C', barDone: '#3F7D5C', danger: '#B4402F', ok: '#3F7D5C',
    hero: '',
    heading: "'Fraunces',Georgia,serif", body: "'Inter',system-ui,sans-serif", read: "'Fraunces',Georgia,serif"
  }
};

const ICONS = {
  home: ['M4 11l8-7 8 7v9H4z'],
  source: ['M12 4v10', 'M7 9l5-5 5 5', 'M5 20h14'],
  words: ['M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z', 'M8 10h8', 'M8 14h5'],
  plan: ['M5 20V10', 'M12 20V4', 'M19 20v-7'],
  back: ['M15 6l-6 6 6 6'],
  chevron: ['M9 6l6 6-6 6'],
  speaker: ['M4 9v6h4l5 4V5L8 9z', 'M17 8a5 5 0 0 1 0 8'],
  play: ['M8 5l11 7-11 7z'],
  pause: ['M8 5v14', 'M16 5v14'],
  prev: ['M6 5v14', 'M19 5l-9 7 9 7z'],
  next: ['M18 5v14', 'M5 5l9 7-9 7z'],
  stop: ['M7 7h10v10H7z'],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  flame: ['M12 2c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z']
};

const Icon = ({ name, size = 22, fill = 'none' }: { name: keyof typeof ICONS; size?: number; fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name].map((d, i) => <path key={i} d={d} />)}
  </svg>
);


const TOPICS = ['Günlük hayat', 'Seyahat', 'Yemek', 'Teknoloji', 'İş hayatı', 'Macera hikâyesi'];
const KIND_LABEL: Record<LabText['kind'], string> = { story: 'Hikâye', dialogue: 'Diyalog', source: 'Kendi kaynağım' };

export default function LanguageView({ fileContents, onSaveNote, theme = 'dark', loaded = true }: LanguageViewProps) {
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

  const [tab, setTab] = useState<'read' | 'source' | 'words' | 'plan'>('read');
  const [adding, setAdding] = useState(false);
  const [langInput, setLangInput] = useState('');
  const [placement, setPlacement] = useState<PlacementPassage[] | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<'story' | 'dialogue'>('story');
  const [sourceText, setSourceText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picked, setPicked] = useState<{ word: string; segKey: number; exp: WordExplanation | null; loading: boolean } | null>(null);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [audioKey, setAudioKey] = useState<'full' | 'sentence' | null>(null);
  const startRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // "Tümünü dinle" sırasında o an okunan cümle (renklendirilir) ve çalma anını izleyen animasyon döngüsü.
  const [activeSeg, setActiveSeg] = useState<number>(-1);
  const rafRef = useRef<number | null>(null);
  // Cümle başlangıçları ve cümle numaraları: duraklat/devam ve cümle atlama için çalma boyunca saklanır.
  const startsRef = useRef<number[] | null>(null);
  const idxMapRef = useRef<number[]>([]);
  // Kelime panelinde cümle çevirisi (akordiyon); her yeni kelimede gizli başlar.
  const [transOpen, setTransOpen] = useState(false);

  const aiReady = !!getGeminiApiKey();
  const [showGen, setShowGen] = useState(false);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(() => window.innerWidth >= 1000);
  useEffect(() => {
    if (!el) return;
    const measure = () => setWide(el.getBoundingClientRect().width >= 820);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  useEffect(() => {
    const id = 'lang-lab-fonts';
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@500;600;700&family=Nunito:wght@600;700;800;900&display=swap';
    document.head.appendChild(l);
  }, []);
  const reading = useMemo(() => state.texts.find(t => t.id === openId) ?? null, [state.texts, openId]);
  const segments = useMemo(() => (reading ? buildSegments(reading) : []), [reading]);

  const stopAudio = () => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    startsRef.current = null;
    setAudioState('idle');
    setAudioKey(null);
    setActiveSeg(-1);
  };
  // Vurgulanan cümleyi sesin konumuna göre günceller (çalarken her karede, atlamada bir kez).
  const syncActive = (audio: HTMLAudioElement) => {
    const st = startsRef.current;
    if (!st) return;
    const i = sentenceAt(st, audio.currentTime);
    const seg = i >= 0 ? idxMapRef.current[i] : -1;
    setActiveSeg(prev => (prev === seg ? prev : seg));
  };
  const startHighlight = (audio: HTMLAudioElement) => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (!startsRef.current) return;
    const tick = () => {
      if (audioRef.current !== audio) return;
      syncActive(audio);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const togglePause = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioState === 'playing') {
      audio.pause();
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setAudioState('paused');
    } else if (audioState === 'paused') {
      try { await audio.play(); } catch (e: any) { setError(`Ses devam ettirilemedi: ${String(e?.message || e)}. Tekrar dene.`); return; }
      if (audioRef.current !== audio) return;
      setAudioState('playing');
      startHighlight(audio);
    }
  };
  // Cümle bazlı atlama. Tek cümle sesinde (starts yok) geri = başa sar, ileri yok.
  const skipSentence = (dir: -1 | 1) => {
    const audio = audioRef.current;
    if (!audio) return;
    const st = startsRef.current;
    if (!st || st.length === 0) {
      if (dir < 0) audio.currentTime = 0;
      return;
    }
    const cur = Math.max(0, sentenceAt(st, audio.currentTime));
    if (dir > 0) {
      if (cur >= st.length - 1) return;
      audio.currentTime = st[cur + 1];
    } else {
      // Cümlenin başından uzaksak önce başına dön, yakınsak bir önceki cümleye geç.
      audio.currentTime = audio.currentTime - st[cur] > 1.5 || cur === 0 ? st[cur] : st[cur - 1];
    }
    syncActive(audio);
  };
  // Okunan cümle görünür alanın dışına çıkarsa kaydır.
  useEffect(() => {
    if (activeSeg < 0) return;
    document.querySelector(`[data-seg="${activeSeg}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSeg]);
  useEffect(() => stopAudio, []);

  const textIdsKey = [...state.texts, ...Object.values(state.stash).flatMap(d => d.texts)].map(t => t.id).join(',');
  useEffect(() => {
    if (raw === undefined) return;
    pruneClips(new Set(textIdsKey ? textIdsKey.split(',') : []));
  }, [raw, textIdsKey]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const open = (id: string) => {
    setShowGen(false);
    stopAudio();
    setOpenId(id); setPicked(null);
    startRef.current = Date.now();
  };

  const saveAndOpen = (t: LabText, extra: Partial<LanguageLabState> = {}) => {
    const { state: next, dropped } = addText(state, t);
    persist({ ...next, ...extra });
    if (dropped) setNotice('Liste 50 içeriğe ulaştığı için en eski içerik silindi.');
    open(t.id);
  };

  const changeLanguage = (name: string) => {
    stopAudio();
    setOpenId(null); setPicked(null); setNotice(''); setError('');
    persist(switchLanguage(state, name));
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
    stopAudio();
    setOpenId(null); setPicked(null);
    persist(switchLanguage(state, langInput, level));
    setPlacement(null); setAdding(false); setLangInput('');
  };

  const generate = () => run(async () => {
    const review = pickReviewWords(state);
    const r = await generateReading(state.language, state.level, topic, review, format);
    saveAndOpen(makeLabText(r, state.level, format, topic));
  });

  const startSeries = () => run(async () => {
    const review = pickReviewWords(state);
    const r = await generateEpisode(state.language, state.level, topic, '', 1, review);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const series: LabSeries = { id, title: topic.trim() || r.title, premise: topic, summary: r.summary, episodes: 1, created: todayKey() };
    saveAndOpen({ ...makeLabText(r, state.level, 'story', series.title), seriesId: id, episode: 1 }, { series: [series, ...state.series] });
  });

  const nextEpisode = (sr: LabSeries) => run(async () => {
    const review = pickReviewWords(state);
    const n = sr.episodes + 1;
    const r = await generateEpisode(state.language, state.level, sr.premise, sr.summary, n, review);
    saveAndOpen(
      { ...makeLabText(r, state.level, 'story', sr.title), seriesId: sr.id, episode: n },
      { series: state.series.map(x => (x.id === sr.id ? { ...x, summary: r.summary, episodes: n } : x)) }
    );
  });

  const deleteSeries = (sr: LabSeries) => {
    if (!window.confirm('Bu seri ve bekleyen bölümleri silinsin mi?')) return;
    persist({ ...state, series: state.series.filter(x => x.id !== sr.id), texts: state.texts.filter(t => t.seriesId !== sr.id) });
  };

  const adapt = () => run(async () => {
    if (!sourceText.trim()) return;
    const r = await adaptSource(state.language, state.level, sourceText);
    saveAndOpen(makeLabText(r, state.level, 'source', ''));
  });

  const onWordClick = (token: Token, seg: Segment) => {
    if (!reading) return;
    const key = token.text.toLowerCase();
    const saved = state.words.find(w => w.word.toLowerCase() === key);
    const g = reading.glossary.find(x => x.word.toLowerCase() === key);
    const cacheKey = `${seg.key}:${key}`;
    // Metinle birlikte gelen cümle bazlı kelime anlamı: ağ isteği gerekmez. Eski içeriklerde yoktur, o zaman eski yola düşer.
    const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');
    const sw = reading.sentences[seg.key]?.words?.find(x => norm(x.w) === norm(token.text) || (!!x.native && norm(x.native) === norm(token.text)));
    const cachedExp = reading.explained?.[cacheKey];
    const known = saved
      ? { meaning: saved.meaning, note: `Kayıtlı kelime · ${saved.seen} kez karşılaştın`, native: saved.native }
      : g ? { meaning: g.meaning, note: '', native: g.native } : sw ? { meaning: sw.meaning, note: '', native: sw.native } : cachedExp ?? null;
    // Anlam beklenirken cümle çevirisi hemen görünsün; bekleme boşa geçmesin.
    setTransOpen(!known);
    setPicked({ word: token.text, segKey: seg.key, exp: known, loading: !known });
    if (!known) {
      explainWord(state.language, token.text, seg.text, seg.native)
        .then(exp => {
          setPicked(p => (p && p.word === token.text && p.segKey === seg.key ? { ...p, exp, loading: false } : p));
          const cur = stateRef.current;
          persist({ ...cur, texts: cur.texts.map(t => (t.id === reading.id ? { ...t, explained: { ...t.explained, [cacheKey]: exp } } : t)) });
        })
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
      words: [...state.words, { word: picked.word, meaning: picked.exp.meaning, context: seg?.text ?? '', native: picked.exp.native, contextNative: seg && seg.native !== seg.text ? seg.native : undefined, seen: 0, added: todayKey() }]
    });
    setPicked(null);
  };

  const learnWord = (w: SavedWord) => {
    persist({ ...state, words: state.words.filter(x => x !== w), learnedCount: state.learnedCount + 1 });
  };

  // Ses dosyasındaki cümle başlangıçlarını bulur (sessizliklere yaslı); ses çözülemezse süreye göre orantılı tahmin.
  const computeStarts = async (blob: Blob, texts: string[], audio: HTMLAudioElement): Promise<number[]> => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      try { ctx.close?.(); } catch { /* yoksay */ }
      return alignTurns(buf.getChannelData(0), buf.sampleRate, texts).starts;
    } catch {
      const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : texts.join(' ').length / 14;
      return proportionalStarts(texts, d).starts;
    }
  };

  const playAudio = async (_text: string, key: 'full' | 'sentence', clipKey: string) => {
    if (!reading) return;
    if (audioState !== 'idle' && audioKey === key) { stopAudio(); return; }
    stopAudio();
    setAudioKey(key); setAudioState('loading'); setError('');
    try {
      // Konuşan kişi / duygu bilgisi yoksa (eski içerik) bir kez çıkarılır ve içerikle birlikte kaydedilir.
      let current = reading;
      if (!current.sentences.some(x => x.tone || x.speaker) && getGeminiApiKey()) {
        try {
          const annotated = await annotateReading(stateRef.current.language, current.sentences);
          if (annotated.some(x => x.tone || x.speaker)) {
            current = { ...current, sentences: annotated };
            const id = current.id;
            const updated = current;
            persist({ ...stateRef.current, texts: stateRef.current.texts.map(t => (t.id === id ? updated : t)) });
          }
        } catch { /* analiz olmadan da okunur (öneklerden konuşmacı çıkarılır) */ }
      }
      const turns = buildTurns(current.sentences, current.kind, stripMarkdownForSpeech);
      const plan = assignVoices(turns);
      const sentenceIdx = key === 'sentence' ? parseInt(clipKey.replace(/^\D+/, ''), 10) : -1;
      const sel = key === 'full' ? turns.filter(t => t.text) : turns.filter(t => t.index === sentenceIdx && t.text);
      if (sel.length === 0) throw new Error('Seslendirilecek metin yok.');

      // Çok sesli içerik ayrı anahtarla saklanır (eski tek sesli kayıtlar yeniden kullanılmaz).
      const suffix = key === 'full' ? (plan.multi ? 'full3' : 'full') : `${plan.multi ? 'm' : ''}${clipKey}`;
      const storeKey = `${reading.id}|${suffix}`;
      let blob = await getClip(storeKey);
      if (!blob) {
        const usePlan = key === 'full' ? plan : singleTurnPlan(plan, sel[0]);
        blob = (await synthesizeLesson(sel, usePlan)).blob;
        await putClip(storeKey, blob);
      }
      const objUrl = URL.createObjectURL(blob);
      const audio = new Audio(objUrl);
      audioRef.current = audio;
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(objUrl);
        if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        startsRef.current = null;
        setActiveSeg(-1); setAudioState('idle'); setAudioKey(null);
      });
      let starts: number[] | null = null;
      if (key === 'full') starts = await computeStarts(blob, sel.map(t => t.text), audio);
      if (audioRef.current !== audio) return; // bu arada durduruldu
      await audio.play();
      setAudioState('playing');
      if (starts) {
        startsRef.current = starts;
        idxMapRef.current = sel.map(t => t.index);
        startHighlight(audio);
      }
    } catch (e: any) {
      setAudioState('idle'); setAudioKey(null); setActiveSeg(-1);
      setError(String(e?.message || e));
    }
  };

  const finish = (fb: 'easy' | 'ok' | 'hard') => {
    if (!reading) return;
    const minutes = Math.min(30, Math.max(1, Math.round((Date.now() - startRef.current) / 60000)));
    const full = reading.sentences.map(x => sentenceDisplay(x)).join(' ');
    const words = state.words.map(w => {
      const c = countOccurrences(full, w.word);
      return c ? { ...w, seen: w.seen + c } : w;
    });
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


  const dark = theme === 'dark';
  const P = PAL[theme];
  const btnR = dark ? 999 : 12;
  const cardR = dark ? 22 : 16;
  const S = {
    card: { background: P.surface, border: `1px solid ${P.line}`, borderRadius: cardR, padding: 18 } as React.CSSProperties,
    btn: (primary = false, disabled = false): React.CSSProperties => ({
      minHeight: 44, padding: '0 18px', borderRadius: btnR, fontFamily: P.body, fontSize: 15,
      fontWeight: dark ? 800 : 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      border: primary ? 'none' : `${dark ? 2 : 1}px solid ${dark ? 'rgba(255,255,255,0.2)' : '#CFC1A4'}`,
      background: primary ? P.primary : 'transparent', color: primary ? P.onPrimary : P.text,
      boxShadow: primary && dark ? `0 3px 0 ${P.primaryShadow}` : 'none'
    }),
    input: {
      minHeight: 44, padding: '0 14px', borderRadius: dark ? 16 : 12, border: `1px solid ${P.line}`,
      background: P.surface2, color: P.text, fontFamily: P.body, fontSize: 15, outline: 'none'
    } as React.CSSProperties,
    chip: (active: boolean): React.CSSProperties => ({
      minHeight: 40, padding: '0 14px', borderRadius: dark ? 999 : 10, cursor: 'pointer', fontFamily: P.body, fontSize: 14, fontWeight: 700,
      border: `1px solid ${active ? P.primary : P.line}`,
      background: active ? (dark ? 'rgba(45,212,167,0.15)' : 'rgba(63,125,92,0.1)') : 'transparent',
      color: active ? P.primary : P.text
    })
  };
  const eyebrow: React.CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: P.primary };
  const h3: React.CSSProperties = { margin: 0, fontFamily: P.heading, fontSize: dark ? 19 : 20, fontWeight: dark ? 900 : 700 };
  const muted: React.CSSProperties = { color: P.muted, fontSize: 13, fontWeight: 600 };

  if (!loaded && raw === undefined) {
    return (
      <div ref={setEl} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: P.bg, color: P.muted, fontFamily: P.body, fontWeight: 700 }}>
        Kayıtların yükleniyor...
      </div>
    );
  }

  if (!state.language || adding) {
    return (
      <div ref={setEl} style={{ height: '100%', overflowY: 'auto', padding: 20, background: P.bg, color: P.text, fontFamily: P.body }} className="custom-scroll">
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontFamily: P.heading, fontSize: 30, fontWeight: dark ? 900 : 700 }}>Dil Atölyesi</h2>
          {adding && state.language && (
            <div><button style={S.btn()} onClick={() => { setAdding(false); setPlacement(null); setLangInput(''); }}><Icon name="back" size={18} /> Vazgeç</button></div>
          )}
          <div style={{ ...S.card, lineHeight: 1.6 }}>
            Gramer ve ezber yok. Seviyenin biraz üstünde, anlayabileceğin içeriğe bol bol maruz kalarak dili edinirsin.
            Hangi dili istersen seçebilirsin.
          </div>
          {!aiReady && <div style={{ ...S.card, borderColor: P.accent }}>Önce Ayarlar &gt; AI Mentor bölümünden Gemini anahtarı ekle.</div>}
          {!placement && (
            <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                value={langInput}
                onChange={e => setLangInput(e.target.value)}
                placeholder="Öğrenmek istediğin dil (ör. İspanyolca, Japonca, Korece...)"
                style={S.input}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={S.btn(true, busy || !langInput.trim() || !aiReady)} disabled={busy || !langInput.trim() || !aiReady} onClick={startPlacement}>
                  {busy ? 'Hazırlanıyor...' : 'Seviyemi tespit et'}
                </button>
                <button style={S.btn(false, !langInput.trim())} disabled={!langInput.trim()} onClick={() => finishSetup('A1')}>
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
                <div style={S.card}>
                  <div style={{ marginBottom: 10 }}>Başlangıç seviyen: <b>{lvl}</b></div>
                  <button style={S.btn(true)} onClick={() => finishSetup(lvl)}>Başla</button>
                </div>
              );
            }
            return (
              <div style={S.card}>
                <div style={{ ...muted, marginBottom: 6 }}>Metin {i + 1}/{placement.length} — çeviri gerekmeden anladın mı?</div>
                <div style={{ fontSize: 20, lineHeight: 1.6, marginBottom: 12, fontFamily: P.read }}>
                  {placement[i].latin ? <><div>{placement[i].latin}</div><div style={{ color: P.muted }}>{placement[i].text}</div></> : placement[i].text}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={S.btn(true)} onClick={() => setAnswers([...answers, true])}>Anladım</button>
                  <button style={S.btn()} onClick={() => setAnswers([...answers, false, ...Array(placement.length - i - 1).fill(false)])}>Anlamadım</button>
                </div>
              </div>
            );
          })()}
          {error && <div style={{ ...S.card, borderColor: P.danger }}>{error}</div>}
        </div>
      </div>
    );
  }

  const todayMin = minutesToday(state);
  const streak = inputStreak(state);
  const savedSet = new Set(state.words.map(w => w.word.toLowerCase()));
  const pickedSaved = !!picked && savedSet.has(picked.word.toLowerCase());
  const goal = Math.max(1, state.plan.goalMinutes);
  const remaining = Math.max(0, goal - todayMin);
  const week = weekMinutes(state);
  const weekMax = Math.max(goal, ...week.map(d => d.minutes), 1);
  const setPlan = (patch: Partial<LanguageLabState['plan']>) => persist({ ...state, plan: { ...state.plan, ...patch } });
  const nextText = state.texts[0];
  const pickedSeg = picked ? segments.find(s => s.key === picked.segKey) ?? null : null;
  const sheetMode = !dark && !!reading && !!picked && !!pickedSeg;
  const showReading = (tab === 'read' || tab === 'source') && !!reading;
  const libraryInSidebar = !dark && wide;
  const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const TILES = ['linear-gradient(160deg,#8B7CFF,#4B3FD0)', 'linear-gradient(160deg,#FF8E72,#E04E6A)', 'linear-gradient(160deg,#34D3B0,#1B8F8A)', 'linear-gradient(160deg,#5BB8FF,#2A62D8)'];

  const ring = (size: number, onHero: boolean) => {
    const c = 2 * Math.PI * 46;
    const track = dark ? 'rgba(255,255,255,0.18)' : '#E4D9C3';
    return (
      <svg width={size} height={size} viewBox="0 0 110 110" role="img" aria-label={`Bugün ${todayMin} dakika, hedef ${goal}`} style={{ flex: '0 0 auto' }}>
        <circle cx="55" cy="55" r="46" stroke={track} strokeWidth="11" fill="none" />
        <circle cx="55" cy="55" r="46" stroke={P.ring} strokeWidth="11" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, todayMin / goal))} transform="rotate(-90 55 55)" />
        <text x="55" y="58" textAnchor="middle" fill={onHero ? '#fff' : P.text} fontSize="26" fontWeight="900" fontFamily={P.heading}>{todayMin}</text>
        <text x="55" y="76" textAnchor="middle" fill={onHero ? 'rgba(255,255,255,0.7)' : P.muted} fontSize="12" fontWeight="700" fontFamily={P.heading}>/ {goal} dk</text>
      </svg>
    );
  };

  const langSwitch = (vertical: boolean) => (
    <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 6 : 8, alignItems: vertical ? 'stretch' : 'center', overflowX: vertical ? 'visible' : 'auto', paddingBottom: vertical ? 0 : 2 }}>
      {languageNames(state).map(n => {
        const active = n === state.language;
        if (dark) {
          return (
            <button key={n} onClick={() => changeLanguage(n)} style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 16px', borderRadius: 22, flex: '0 0 auto', cursor: 'pointer',
              border: `2px solid ${active ? P.primary : P.line}`, background: active ? 'rgba(45,212,167,0.12)' : 'transparent',
              color: active ? P.text : P.muted, fontWeight: 800, fontSize: 15, fontFamily: P.body, textAlign: 'left'
            }}>
              <span style={{ width: 24, height: 24, borderRadius: 12, background: active ? P.primary : P.surface2, color: active ? P.onPrimary : P.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 }}>{n.slice(0, 2).toUpperCase()}</span>
              <span style={{ flex: 1 }}>{n}</span>{active && <span style={{ color: P.primary, fontSize: 13 }}>{state.level}</span>}
            </button>
          );
        }
        return (
          <button key={n} onClick={() => changeLanguage(n)} style={{
            minHeight: 44, padding: '0 6px', border: 'none', background: 'none', cursor: 'pointer', flex: '0 0 auto', textAlign: 'left',
            fontFamily: P.heading, fontSize: active ? 24 : 18, fontWeight: 700, color: active ? P.text : P.faint
          }}>
            {n}{active && <span style={{ marginLeft: 8, fontFamily: P.body, fontSize: 13, fontWeight: 700, color: '#7A4B14', background: '#E4D2AE', padding: '4px 10px', borderRadius: 12 }}>{state.level}</span>}
          </button>
        );
      })}
      <button aria-label="Yeni dil ekle" onClick={() => { setAdding(true); setLangInput(''); setPlacement(null); }} style={{
        flex: '0 0 auto', minHeight: 44, minWidth: 44, padding: vertical ? '0 14px' : 0, borderRadius: dark ? 22 : 12, cursor: 'pointer',
        border: `${dark ? 2 : 1}px dashed ${dark ? 'rgba(255,255,255,0.22)' : '#CFC1A4'}`, background: 'transparent', color: P.muted,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700, fontSize: 14, fontFamily: P.body
      }}>
        <Icon name="plus" size={18} />{vertical && 'Yeni dil ekle'}
      </button>
    </div>
  );

  const NAV: [typeof tab, string, string, keyof typeof ICONS][] = [
    ['read', dark ? 'Öğren' : 'Oku', dark ? 'Öğren' : 'Oku', 'home'],
    ['source', 'Kaynağım', 'Kendi kaynağım', 'source'],
    ['words', 'Kelimeler', 'Kelimelerim', 'words'],
    ['plan', 'Plan', 'Plan ve istatistik', 'plan']
  ];

  const genPanel = () => (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: P.muted, fontSize: 14, lineHeight: 1.5 }}>Konu seç ya da yaz. Kayıtlı kelimelerin metne doğal şekilde karışır.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TOPICS.map(t => <button key={t} style={S.chip(topic === t)} onClick={() => setTopic(t)}>{t}</button>)}
      </div>
      <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Kendi konun (isteğe bağlı)" style={S.input} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={S.chip(format === 'story')} onClick={() => setFormat('story')}>Hikâye</button>
        <button style={S.chip(format === 'dialogue')} onClick={() => setFormat('dialogue')}>Diyalog</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={S.btn(true, busy || !aiReady)} disabled={busy || !aiReady} onClick={generate}>{busy ? 'Yazılıyor...' : 'Yeni içerik üret'}</button>
        <button style={S.btn(false, busy || !aiReady)} disabled={busy || !aiReady} onClick={startSeries}>Yeni seri başlat</button>
      </div>
    </div>
  );

  const hero = () => {
    const goalDone = remaining === 0;
    if (dark) {
      return (
        <div style={{ borderRadius: 28, padding: wide ? 28 : 20, background: P.hero, color: '#fff', display: 'flex', gap: wide ? 28 : 18, alignItems: 'center', flexWrap: 'wrap' }}>
          {ring(wide ? 130 : 92, true)}
          <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', opacity: 0.75 }}>BUGÜNKÜ HEDEF</div>
            <div style={{ fontSize: wide ? 30 : 22, fontWeight: 900, lineHeight: 1.15 }}>{goalDone ? 'Hedef tamam' : `${remaining} dakika kaldı`}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: P.accent, fontWeight: 800, fontSize: 14 }}>
              <Icon name="flame" size={18} fill={P.accent} />{streak} günlük seri
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: '1 1 100%' }}>
            {nextText && (
              <button onClick={() => open(nextText.id)} style={{ minHeight: 52, padding: '0 24px', borderRadius: 26, border: 'none', background: '#fff', color: '#16204A', fontWeight: 900, fontSize: 16, cursor: 'pointer', fontFamily: P.body, boxShadow: '0 4px 0 rgba(0,0,0,0.25)', flex: '1 1 auto' }}>
                Devam et · {trim(nextText.title, 22)}
              </button>
            )}
            <button onClick={() => setShowGen(v => !v)} style={{ minHeight: 52, padding: '0 22px', borderRadius: 26, border: '2px solid rgba(255,255,255,0.5)', background: 'transparent', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: P.body }}>
              {showGen ? 'Kapat' : 'Yeni içerik'}
            </button>
          </div>
        </div>
      );
    }
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={eyebrow}>BUGÜN</div>
          <div style={{ fontFamily: P.heading, fontSize: wide ? 40 : 32, fontWeight: 700, lineHeight: 1.1 }}>{goalDone ? 'Bugünkü hedef tamam.' : `${remaining} dakika daha oku.`}</div>
          <div style={{ height: 8, borderRadius: 4, background: '#E4D9C3', marginTop: 6, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (todayMin / goal) * 100)}%`, height: '100%', background: P.bar, borderRadius: 4 }} />
          </div>
          <div style={muted}>{todayMin} / {goal} dk · {state.level} seviyesi · {streak} günlük seri</div>
        </div>
        {nextText && (
          <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
            <div style={eyebrow}>KALDIĞIN YER</div>
            <div>
              <div style={{ fontFamily: P.heading, fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{nextText.title}</div>
              <div style={{ ...muted, marginTop: 4 }}>{nextText.episode ? `Bölüm ${nextText.episode} · ` : ''}{KIND_LABEL[nextText.kind]} · {nextText.sentences.length} cümle</div>
            </div>
            <button onClick={() => open(nextText.id)} style={{ minHeight: 52, borderRadius: 14, border: 'none', background: P.text, color: P.bg, fontWeight: 700, fontSize: 16, cursor: 'pointer', fontFamily: P.body }}>Okumaya devam et</button>
          </div>
        )}
        <div><button style={S.btn(true)} onClick={() => setShowGen(v => !v)}><Icon name="plus" size={18} />{showGen ? 'Kapat' : 'Yeni içerik üret'}</button></div>
      </>
    );
  };

  const seriesAction = (sr: LabSeries) => {
    const pending = state.texts.find(t => t.seriesId === sr.id);
    const style: React.CSSProperties = dark
      ? { minHeight: 44, padding: '0 16px', borderRadius: 22, border: 'none', background: 'rgba(255,255,255,0.92)', color: '#16204A', fontWeight: 900, fontSize: 14, cursor: 'pointer', fontFamily: P.body }
      : S.btn(true);
    return pending
      ? <button style={style} onClick={() => open(pending.id)}>Bölümü aç</button>
      : <button style={{ ...style, opacity: busy || !aiReady ? 0.5 : 1 }} disabled={busy || !aiReady} onClick={() => nextEpisode(sr)}>{busy ? 'Yazılıyor...' : 'Sonraki bölüm'}</button>;
  };

  const seriesSection = () => state.series.length === 0 ? null : (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={h3}>Hikâye serilerim</h3>
      {dark ? (
        <div style={{ display: 'grid', gridTemplateColumns: wide ? 'repeat(auto-fill,minmax(260px,1fr))' : '1fr', gap: 12 }}>
          {state.series.map((sr, i) => (
            <div key={sr.id} style={{ borderRadius: 24, padding: 18, background: TILES[i % TILES.length], color: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{sr.title.slice(0, 1).toUpperCase()}</div>
                <button aria-label="Seriyi sil" onClick={() => deleteSeries(sr)} style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="trash" size={20} /></button>
              </div>
              <div><div style={{ fontWeight: 900, fontSize: 18 }}>{sr.title}</div><div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85 }}>{sr.episodes} bölüm · {sr.created}</div></div>
              <div>{seriesAction(sr)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {state.series.map(sr => (
            <div key={sr.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 68, padding: '8px 4px', borderBottom: `1px solid ${P.line}`, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: P.heading, fontSize: 26, fontWeight: 700, width: 36, color: P.accent }}>{sr.title.slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: '1 1 120px' }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{sr.title}</div>
                <div style={muted}>{sr.episodes} bölüm · {sr.created}</div>
              </div>
              {seriesAction(sr)}
              <button aria-label="Seriyi sil" onClick={() => deleteSeries(sr)} style={{ ...S.btn(), padding: 0, width: 44 }}><Icon name="trash" size={20} /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const textsSection = () => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={h3}>Devam eden içerikler ({state.texts.length})</h3>
      {state.texts.length === 0 && <div style={{ color: P.muted, fontSize: 14 }}>Henüz içerik yok. Üret ya da kendi metnini ekle.</div>}
      {state.texts.map(t => {
        const current = reading?.id === t.id;
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: dark ? 14 : '8px 12px', borderRadius: dark ? 20 : 12,
            background: dark ? P.surface : current ? P.surface : 'transparent',
            border: dark ? 'none' : current ? `1px solid ${P.primary}` : '1px solid transparent',
            borderBottom: dark ? undefined : current ? `1px solid ${P.primary}` : `1px solid ${P.line}`
          }}>
            <div role="button" tabIndex={0} onClick={() => open(t.id)} onKeyDown={e => { if (e.key === 'Enter') open(t.id); }} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
              <div style={{ fontFamily: dark ? P.body : P.heading, fontWeight: dark ? 900 : 700, fontSize: 16 }}>{t.title}</div>
              <div style={muted}>{t.episode ? `Bölüm ${t.episode} · ` : ''}{KIND_LABEL[t.kind]} · {t.level}{t.topic ? ` · ${t.topic}` : ''} · {t.sentences.length} cümle</div>
            </div>
            <button aria-label="Sil" onClick={() => deleteText(t.id)} style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: 'transparent', color: P.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="trash" size={20} /></button>
            <button aria-label="Aç" onClick={() => open(t.id)} style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: 'transparent', color: P.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevron" size={20} /></button>
          </div>
        );
      })}
    </section>
  );

  const playLabel = (key: 'full' | 'sentence', idle: string) =>
    audioKey === key && audioState === 'loading' ? 'Ses hazırlanıyor...' : audioKey === key && (audioState === 'playing' || audioState === 'paused') ? 'Durdur' : idle;

  const wordPanel = (seg: Segment) => picked && (
    <div style={{
      background: dark ? P.surface : P.surface, border: `2px solid ${dark ? 'rgba(255,181,71,0.5)' : P.line}`, borderRadius: dark ? 22 : 20,
      padding: 16, margin: dark ? '10px 0' : 0, fontSize: 16, lineHeight: 1.5, whiteSpace: 'normal', fontFamily: P.body, color: P.text, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div style={{ ...muted, fontSize: 12, letterSpacing: '0.08em' }}>KELİME</div>
          <div style={{ fontFamily: P.heading, fontSize: 28, fontWeight: dark ? 900 : 700, lineHeight: 1.1 }}>{picked.word}</div>
        </div>
        {picked.exp?.native && picked.exp.native !== picked.word && <div style={{ fontFamily: P.read, fontSize: 34, fontWeight: 700, color: P.accent, lineHeight: 1 }}>{picked.exp.native}</div>}
      </div>
      {picked.loading && <div style={{ color: P.muted }}>Yapay zekâ anlamı arıyor (birkaç saniye sürebilir)...</div>}
      {picked.exp && <>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{picked.exp.meaning}</div>
        {picked.exp.note && <div style={{ color: P.muted }}>{picked.exp.note}</div>}
      </>}
      <div style={{ borderTop: `1px solid ${P.line}`, paddingTop: 10 }}>
        <button aria-expanded={transOpen} onClick={() => setTransOpen(o => !o)}
          style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6, width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ display: 'inline-flex', transform: transOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><Icon name="chevron" size={16} /></span>
          {transOpen ? 'Cümlenin Türkçesini gizle' : 'Cümlenin Türkçesini göster'}
        </button>
        {transOpen && <>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{seg.translation || '—'}</div>
          {seg.native !== seg.text && <div style={{ fontFamily: P.read, fontSize: 20, marginTop: 6, color: P.muted }}>{seg.native}</div>}
        </>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={S.btn(true, !picked.exp || pickedSaved)} disabled={!picked.exp || pickedSaved} onClick={saveWord}>{pickedSaved ? 'Kayıtlı' : 'Kelimelerime ekle'}</button>
        <button style={S.btn(false, audioKey === 'full' || (audioKey === 'sentence' && audioState === 'loading'))} disabled={audioKey === 'full' || (audioKey === 'sentence' && audioState === 'loading')} onClick={() => playAudio(seg.native, 'sentence', `s${seg.key}`)}>
          <Icon name={audioKey === 'sentence' && (audioState === 'playing' || audioState === 'paused') ? 'stop' : 'speaker'} size={18} />{playLabel('sentence', 'Cümleyi dinle')}
        </button>
        <button style={S.btn()} onClick={() => setPicked(null)}>Kapat</button>
      </div>
    </div>
  );

  const readingView = () => reading && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: sheetMode ? (transOpen ? 480 : 320) : 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <button aria-label="Listeye dön" onClick={closeReading} style={{ ...S.btn(), padding: dark ? 0 : '0 14px', width: dark ? 44 : undefined, border: dark ? 'none' : S.btn().border, background: dark ? P.surface : 'transparent' }}>
          <Icon name="back" size={22} />{!dark && 'Listeye dön'}
        </button>
        <button style={{ ...S.btn(false, audioState === 'loading' && audioKey === 'full'), color: P.primary, background: dark ? P.surface : 'transparent', border: dark ? 'none' : S.btn().border }}
          disabled={audioState === 'loading' && audioKey === 'full'} onClick={() => playAudio(textOf(reading), 'full', 'full')}>
          <Icon name={audioKey === 'full' && (audioState === 'playing' || audioState === 'paused') ? 'stop' : 'speaker'} size={20} />{playLabel('full', 'Tümünü dinle')}
        </button>
        {(audioState === 'playing' || audioState === 'paused') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {([
              { label: 'Önceki cümle', icon: 'prev', onClick: () => skipSentence(-1) },
              { label: audioState === 'paused' ? 'Devam et' : 'Duraklat', icon: audioState === 'paused' ? 'play' : 'pause', onClick: togglePause },
              { label: 'Sonraki cümle', icon: 'next', onClick: () => skipSentence(1) }
            ] as const).map(b => (
              <button key={b.label} aria-label={b.label} title={b.label} onClick={b.onClick}
                style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: dark ? P.surface : 'transparent', color: P.primary, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={b.icon} size={20} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div style={eyebrow}>{reading.episode ? `BÖLÜM ${reading.episode} · ` : ''}{KIND_LABEL[reading.kind].toUpperCase()} · {reading.level} · {reading.sentences.length} CÜMLE</div>
        <div style={{ fontFamily: P.heading, fontSize: wide ? 38 : 28, fontWeight: dark ? 900 : 700, lineHeight: 1.15, marginTop: 4 }}>{reading.title}</div>
      </div>
      <div style={{ fontFamily: P.read, fontSize: wide ? 26 : 22, lineHeight: wide ? 1.75 : 1.65, fontWeight: dark ? 700 : 600, whiteSpace: 'pre-wrap', maxWidth: 760 }}>
        {segments.map(seg => (
          <React.Fragment key={seg.key}>
            <span data-seg={seg.key} style={activeSeg === seg.key ? { background: `${P.primary}33`, boxShadow: `0 0 0 3px ${P.primary}33`, borderRadius: 8, transition: 'background 0.2s' } : undefined}>
            {seg.tokens.map((t, i) => {
              if (!t.isWord) return <span key={i}>{t.text}</span>;
              const isSaved = savedSet.has(t.text.toLowerCase());
              const isPicked = !!picked && picked.segKey === seg.key && picked.word === t.text;
              return (
                <span key={i} onClick={() => onWordClick(t, seg)} style={{
                  cursor: 'pointer', borderRadius: 6,
                  ...(isSaved ? { background: P.hl, color: P.hlText, padding: '0 4px' } : { borderBottom: `1px dotted ${P.faint}` }),
                  ...(isPicked ? { borderBottom: `3px solid ${P.accent}` } : {})
                }}>{t.text}</span>
              );
            })}
            </span>
            {!dark ? null : picked && picked.segKey === seg.key && wordPanel(seg)}
            {seg.newLine ? '\n' : ' '}
          </React.Fragment>
        ))}
      </div>
      <div style={muted}>Bilmediğin kelimeye dokun, anlamı {dark ? 'cümlenin altında' : 'aşağıda'} açılır; cümlenin Türkçesi için paneldeki başlığa dokun.</div>

      <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ ...muted, textAlign: 'center' }}>Bitirdin mi? Zorluk nasıldı? (Bitti işaretlenir, içerik listeden kalkar.)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button style={S.btn()} onClick={() => finish('easy')}>Kolaydı</button>
          <button style={S.btn(true)} onClick={() => finish('ok')}>Tam kıvamında</button>
          <button style={S.btn()} onClick={() => finish('hard')}>Zordu</button>
        </div>
        <div style={{ textAlign: 'center' }}><button onClick={() => deleteText(reading.id)} style={{ minHeight: 44, border: 'none', background: 'none', color: P.muted, cursor: 'pointer', fontFamily: P.body, fontWeight: 700, fontSize: 14 }}>Bitirmeden sil</button></div>
      </div>
    </div>
  );

  const planView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...S.card, display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
        {ring(wide ? 130 : 104, false)}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontFamily: P.heading, fontSize: 22, fontWeight: dark ? 900 : 700 }}>{remaining === 0 ? 'Bugünkü hedef tamam' : `Hedefe ${remaining} dk kaldı`}</div>
          <div style={{ color: P.muted, fontSize: 14 }}>{state.language}: toplam {formatDuration(totalMinutes(state))} input</div>
          <div style={{ color: P.muted, fontSize: 14 }}>Seri: {streak} gün · {state.finishedCount} içerik bitti</div>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ ...muted, marginBottom: 10 }}>Son 7 gün (tüm diller)</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130 }}>
          {week.map(d => (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ fontSize: 11, color: P.muted, marginBottom: 2 }}>{d.minutes || ''}</div>
              <div style={{ width: '100%', height: `${Math.max(4, (d.minutes / weekMax) * 84)}px`, background: d.minutes >= goal ? P.barDone : d.minutes > 0 ? P.bar : (dark ? '#2A3350' : '#E4D9C3'), borderRadius: 8 }} />
              <div style={{ fontSize: 12, color: P.faint, fontWeight: 700, marginTop: 6 }}>{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700 }}>
          Günlük hedef (dk)
          <input type="number" min={5} max={240} step={5} value={state.plan.goalMinutes}
            onChange={e => setPlan({ goalMinutes: Math.min(240, Math.max(5, Number(e.target.value) || 5)) })}
            style={{ ...S.input, width: 90 }} />
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700, minHeight: 44 }}>
          <input type="checkbox" checked={state.plan.enabled} onChange={e => setPlan({ enabled: e.target.checked })} style={{ width: 20, height: 20 }} />
          Her gün hatırlat
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700, opacity: state.plan.enabled ? 1 : 0.5 }}>
          Saat
          <input type="time" value={state.plan.time} disabled={!state.plan.enabled} onChange={e => setPlan({ time: e.target.value || '20:00' })} style={S.input} />
        </label>
        <div style={{ color: P.muted, fontSize: 13, lineHeight: 1.5 }}>
          Telefonda bildirim her gün seçtiğin saatte gelir. Masaüstünde uygulama açıkken, hedefini henüz tamamlamadıysan o saatte hatırlatır.
        </div>
      </div>
    </div>
  );

  const wordsView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...muted, fontSize: 14 }}>{state.learnedCount} kelime öğrendin · {state.words.length} kelime listede</div>
      {state.words.length === 0 && <div style={{ ...S.card, color: P.muted }}>Henüz kelime yok. Okurken bilmediğin kelimelere dokunup ekle.</div>}
      {[...state.words].reverse().map(w => (
        <div key={w.word + w.added} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', padding: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: P.heading, fontSize: 20, fontWeight: dark ? 900 : 700 }}>
              {w.word}{w.native && w.native !== w.word && <span style={{ color: P.accent, marginLeft: 10 }}>{w.native}</span>}
            </div>
            <div style={{ fontWeight: 700 }}>{w.meaning}</div>
            <div style={{ color: P.muted, fontSize: 14 }}>{w.context}</div>
            {w.contextNative && <div style={{ color: P.muted, fontSize: 14 }}>{w.contextNative}</div>}
            <div style={{ color: P.faint, fontSize: 12, marginTop: 2 }}>{w.seen} kez karşılaştın</div>
          </div>
          <button style={S.btn()} onClick={() => learnWord(w)}>Öğrendim</button>
        </div>
      ))}
      <div>
        <button style={{ ...S.btn(), color: P.danger }} onClick={() => { if (window.confirm(`${state.language} dilinin tüm verisi (kelimeler, içerikler, seriler) silinsin mi?`)) { setOpenId(null); setPicked(null); persist(deleteLanguage(state)); } }}>
          Bu dili sil
        </button>
      </div>
    </div>
  );

  const sourceView = () => (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: P.muted, fontSize: 14, lineHeight: 1.5 }}>Bir makale, haber ya da video transkripti yapıştır. Seviyene uyarlanır.</div>
      <textarea value={sourceText} onChange={e => setSourceText(e.target.value)} rows={8} placeholder="Metni buraya yapıştır..."
        style={{ ...S.input, padding: 14, resize: 'vertical', lineHeight: 1.5 }} />
      <div><button style={S.btn(true, busy || !sourceText.trim() || !aiReady)} disabled={busy || !sourceText.trim() || !aiReady} onClick={adapt}>
        {busy ? 'Uyarlanıyor...' : 'Seviyeme uyarla'}
      </button></div>
    </div>
  );

  const sidebar = () => (
    <aside style={{ flex: `0 0 ${dark ? 264 : 300}px`, boxSizing: 'border-box', background: dark ? P.nav : P.surface2, borderRight: `1px solid ${P.line}`, padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }} className="custom-scroll">
      <div style={{ fontFamily: P.heading, fontSize: 22, fontWeight: dark ? 900 : 700, padding: '0 8px' }}>Dil Atölyesi</div>
      {langSwitch(true)}
      {!dark && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...muted }}><span>Bugünkü hedef</span><span>{todayMin} / {goal} dk</span></div>
            <div style={{ height: 8, borderRadius: 4, background: '#DDD0B6', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (todayMin / goal) * 100)}%`, height: '100%', background: P.bar }} /></div>
          </div>
          <button style={S.btn(true)} onClick={() => { setTab('read'); setOpenId(null); setPicked(null); setShowGen(true); }}>Yeni içerik üret</button>
        </>
      )}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV.map(([id, , long, icon]) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '0 14px', borderRadius: dark ? 14 : 12, border: 'none', cursor: 'pointer', textAlign: 'left',
              background: active ? (dark ? P.surface2 : P.surface) : 'transparent', color: active ? P.primary : (dark ? '#C3CCE0' : '#5A5143'),
              fontWeight: 700, fontSize: 15, fontFamily: P.body
            }}><Icon name={icon} size={22} />{long}</button>
          );
        })}
      </nav>
      {libraryInSidebar && <div style={{ borderTop: `1px solid ${P.line}`, paddingTop: 14 }}>{textsSection()}</div>}
    </aside>
  );

  const bottomNav = () => (
    <nav style={{ flex: '0 0 auto', minHeight: 68, background: P.nav, borderTop: `1px solid ${P.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '4px 8px' }}>
      {NAV.map(([id, short, , icon]) => {
        const active = tab === id;
        return (
          <button key={id} onClick={() => setTab(id)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer',
            color: active ? (dark ? P.primary : P.text) : P.faint, fontWeight: active ? 800 : 600, fontSize: 12, minWidth: 64, minHeight: 52, fontFamily: P.body
          }}><Icon name={icon} size={24} />{short}</button>
        );
      })}
    </nav>
  );

  const home = tab === 'read' || tab === 'source';

  return (
    <div ref={setEl} style={{ height: '100%', display: 'flex', flexDirection: wide ? 'row' : 'column', background: P.bg, color: P.text, fontFamily: P.body, overflow: 'hidden' }}>
      {wide && sidebar()}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: wide ? '32px 48px' : '16px 16px 24px' }} className="custom-scroll">
          <div style={{ maxWidth: wide ? 980 : 'none', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {!wide && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {langSwitch(false)}
              </div>
            )}
            {wide && !showReading && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: P.heading, fontSize: 30, fontWeight: dark ? 900 : 700 }}>{state.language}</div>
                  <div style={muted}>{state.level} seviyesi · {state.finishedCount} içerik bitti · {state.words.length} kelime</div>
                </div>
              </div>
            )}

            {error && <div style={{ ...S.card, borderColor: P.danger }}>{error}</div>}
            {notice && <div style={{ ...S.card, borderColor: P.ok }}>{notice}</div>}

            {home && !reading && (
              <>
                {tab === 'read' && hero()}
                {tab === 'read' && showGen && genPanel()}
                {tab === 'source' && sourceView()}
                {tab === 'read' && !wide && <div style={{ ...muted, fontSize: 13 }}>{state.finishedCount} içerik bitti · {state.words.length} kelime</div>}
                {tab === 'read' && seriesSection()}
                {!libraryInSidebar && textsSection()}
              </>
            )}
            {showReading && readingView()}
            {tab === 'plan' && planView()}
            {tab === 'words' && wordsView()}
          </div>
        </div>

        {sheetMode && pickedSeg && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 14px 14px', background: P.surface, borderTop: `1px solid ${P.line}`, borderRadius: '24px 24px 0 0', boxShadow: '0 -10px 30px rgba(43,38,32,0.12)', maxHeight: '70%', overflowY: 'auto' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: '#DDD0B6', margin: '0 auto 10px' }} />
            <div style={{ maxWidth: 760, margin: '0 auto' }}>{wordPanel(pickedSeg)}</div>
          </div>
        )}
        {!wide && bottomNav()}
      </div>
    </div>
  );
}
