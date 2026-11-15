import { callAIJson } from './geminiMentor';
import { unescapeAIText } from '../aiTeacher';

export const LANGUAGE_LAB_NOTE_PATH = 'Sistem/DilAtolyesi.md';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type LabLevel = typeof LEVELS[number];

export interface SavedWord {
  word: string;
  meaning: string;
  context: string;
  native?: string;
  contextNative?: string;
  seen: number;
  added: string;
}

export interface LabLogEntry { date: string; minutes: number; words: number }

export interface LabSentence { text: string; latin?: string; translation: string; newLine?: boolean }

export const sentenceDisplay = (s: LabSentence): string => s.latin?.trim() || s.text;

export interface LabReading {
  title: string;
  sentences: LabSentence[];
  glossary: { word: string; meaning: string; native?: string }[];
}

export interface LabText extends LabReading {
  id: string;
  created: string;
  level: LabLevel;
  kind: 'story' | 'dialogue' | 'source';
  topic: string;
  seriesId?: string;
  episode?: number;
}

export interface LabSeries {
  id: string;
  title: string;
  premise: string;
  summary: string;
  episodes: number;
  created: string;
}

export interface LangData {
  level: LabLevel;
  easyStreak: number;
  hardStreak: number;
  words: SavedWord[];
  log: LabLogEntry[];
  texts: LabText[];
  series: LabSeries[];
  finishedCount: number;
  learnedCount: number;
}

export interface LabPlan { enabled: boolean; time: string; goalMinutes: number }

export interface LanguageLabState extends LangData {
  language: string;
  stash: Record<string, LangData>;
  plan: LabPlan;
}

export const MAX_TEXTS = 50;

export const emptyLangData = (level: LabLevel = 'A1'): LangData => ({
  level, easyStreak: 0, hardStreak: 0, words: [], log: [], texts: [], series: [], finishedCount: 0, learnedCount: 0
});

export const DEFAULT_PLAN: LabPlan = { enabled: false, time: '20:00', goalMinutes: 20 };

export const emptyLabState = (): LanguageLabState => ({
  language: '', ...emptyLangData(), stash: {}, plan: { ...DEFAULT_PLAN }
});

export const languageNames = (s: LanguageLabState): string[] =>
  [s.language, ...Object.keys(s.stash)].filter(Boolean);

const splitData = (s: LanguageLabState): LangData => {
  const { language, stash, plan, ...data } = s;
  return data;
};

export const switchLanguage = (s: LanguageLabState, name: string, level: LabLevel = 'A1'): LanguageLabState => {
  const wanted = name.trim();
  const existing = languageNames(s).find(n => n.toLowerCase() === wanted.toLowerCase());
  if (existing === s.language) return s;
  const stash = { ...s.stash };
  if (s.language) stash[s.language] = splitData(s);
  const key = existing ?? wanted;
  const data = stash[key] ?? emptyLangData(level);
  delete stash[key];
  return { language: key, ...data, stash, plan: s.plan };
};

export const deleteLanguage = (s: LanguageLabState): LanguageLabState => {
  const [next] = Object.keys(s.stash);
  if (!next) return { ...emptyLabState(), plan: s.plan };
  const stash = { ...s.stash };
  const data = stash[next];
  delete stash[next];
  return { language: next, ...data, stash, plan: s.plan };
};

export const allLogs = (s: LanguageLabState): LabLogEntry[] =>
  [...s.log, ...Object.values(s.stash).flatMap(d => d.log)];

export const textOf = (r: LabReading): string =>
  r.sentences.map(x => x.text.trim() + (x.newLine ? '\n' : ' ')).join('');

export const makeLabText = (r: LabReading, level: LabLevel, kind: LabText['kind'], topic: string): LabText => ({
  ...r, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  created: todayKey(), level, kind, topic
});

export const addText = (s: LanguageLabState, t: LabText): { state: LanguageLabState; dropped: boolean } => {
  const texts = [t, ...s.texts];
  const dropped = texts.length > MAX_TEXTS;
  return { state: { ...s, texts: texts.slice(0, MAX_TEXTS) }, dropped };
};

const JSON_BLOCK = /```json\n([\s\S]*?)\n```/;

export const parseLabState = (raw: string | undefined): LanguageLabState => {
  if (!raw) return emptyLabState();
  const m = raw.match(JSON_BLOCK);
  if (!m) return emptyLabState();
  try {
    const p = JSON.parse(m[1]);
    const base = emptyLabState();
    const stash: Record<string, LangData> = {};
    for (const [k, v] of Object.entries(p.stash || {})) stash[k] = { ...emptyLangData(), ...(v as object) };
    return { ...base, ...p, stash, plan: { ...base.plan, ...(p.plan || {}) }, level: LEVELS.includes(p.level) ? p.level : 'A1' };
  } catch {
    return emptyLabState();
  }
};

export const serializeLabState = (s: LanguageLabState): string => {
  const known = s.words.length;
  const total = s.log.reduce((a, l) => a + l.minutes, 0);
  return `# Dil Atölyesi\n\nHedef dil: ${s.language || '-'}${Object.keys(s.stash).length ? ` (+${Object.keys(s.stash).join(', ')})` : ''} · Seviye: ${s.level} · Kayıtlı kelime: ${known} · Devam eden içerik: ${s.texts.length} · Bitirilen: ${s.finishedCount} · Toplam input: ${total} dk\n\n\`\`\`json\n${JSON.stringify(s)}\n\`\`\`\n`;
};

export const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const minutesToday = (s: LanguageLabState): number =>
  allLogs(s).filter(l => l.date === todayKey()).reduce((a, l) => a + l.minutes, 0);

export const totalMinutes = (s: LanguageLabState): number => s.log.reduce((a, l) => a + l.minutes, 0);

export const formatDuration = (min: number): string =>
  min >= 60 ? `${Math.floor(min / 60)} sa ${min % 60} dk` : `${min} dk`;

export const weekMinutes = (s: LanguageLabState): { date: string; label: string; minutes: number }[] => {
  const names = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const logs = allLogs(s);
  const out: { date: string; label: string; minutes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date, label: names[d.getDay()], minutes: logs.filter(l => l.date === date).reduce((a, l) => a + l.minutes, 0) });
  }
  return out;
};

export const countOccurrences = (text: string, word: string): number => {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return (text.match(new RegExp(`(?<![\\p{L}\\p{M}])${esc}(?![\\p{L}\\p{M}])`, 'giu')) || []).length;
  } catch {
    return text.toLowerCase().includes(word.toLowerCase()) ? 1 : 0;
  }
};

export const inputStreak = (s: LanguageLabState): number => {
  const days = new Set(allLogs(s).filter(l => l.minutes > 0).map(l => l.date));
  let streak = 0;
  const d = new Date();
  if (!days.has(todayKey())) d.setDate(d.getDate() - 1);
  for (;;) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.has(k)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
};

export const applyFeedback = (s: LanguageLabState, fb: 'easy' | 'ok' | 'hard'): LanguageLabState => {
  const idx = LEVELS.indexOf(s.level);
  let { easyStreak, hardStreak } = s;
  let level = s.level;
  if (fb === 'easy') { easyStreak++; hardStreak = 0; }
  else if (fb === 'hard') { hardStreak++; easyStreak = 0; }
  else { easyStreak = 0; hardStreak = 0; }
  if (easyStreak >= 3 && idx < LEVELS.length - 1) { level = LEVELS[idx + 1]; easyStreak = 0; }
  if (hardStreak >= 2 && idx > 0) { level = LEVELS[idx - 1]; hardStreak = 0; }
  return { ...s, level, easyStreak, hardStreak };
};

export const pickReviewWords = (s: LanguageLabState, n = 5): SavedWord[] =>
  [...s.words].sort((a, b) => a.seen - b.seen).slice(0, n);

const READING_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, latin: { type: 'string' }, translation: { type: 'string' }, newLine: { type: 'boolean' } },
        required: ['text', 'translation']
      }
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: { word: { type: 'string' }, meaning: { type: 'string' }, native: { type: 'string' } },
        required: ['word', 'meaning']
      }
    }
  },
  required: ['title', 'sentences', 'glossary']
};

const clean = (r: LabReading): LabReading => ({
  title: unescapeAIText(r.title),
  sentences: (Array.isArray(r.sentences) ? r.sentences : [])
    .filter(x => x && typeof x.text === 'string' && x.text.trim())
    .map(x => ({
      text: unescapeAIText(x.text),
      latin: x.latin && x.latin.trim() ? unescapeAIText(x.latin) : undefined,
      translation: unescapeAIText(x.translation || ''),
      newLine: !!x.newLine
    })),
  glossary: Array.isArray(r.glossary)
    ? r.glossary.map(g => ({ word: g.word, meaning: g.meaning, native: g.native && g.native.trim() ? g.native : undefined }))
    : []
});

const RULES = `Kurallar: Gramer anlatma, kural listesi verme, çeviri alıştırması yapma. Metin tamamen hedef dilde, doğal ve akıcı olsun. Kullanıcının seviyesinin HAFİF ÜSTÜNDE (yaklaşık %90 anlaşılır, %10 yeni) yaz. Glossary alanına metindeki seviyeye göre yeni/zor 8-12 kelimeyi, metinde GEÇTİĞİ HALİYLE (çekimli şekliyle) ve o cümledeki anlamıyla Türkçe olarak koy. Metni cümle cümle sentences alanına böl (diyalogda her konuşma satırı ayrı öğe olsun, konuşmacı adı satırın başında yer alsın); her öğenin translation alanına o cümlenin doğal Türkçe çevirisini yaz. Bir paragraf ya da konuşma satırı bittiğinde newLine true olsun. Hedef dil Latin alfabesi kullanmıyorsa (ör. Japonca, Korece, Çince, Arapça, Rusça, Hintçe): sentences öğesinde text alanına cümleyi dilin KENDİ yazısıyla, latin alanına aynı cümlenin Latin harfli okunuşunu (Japoncada romaji, Korecede romanizasyon, Çincede pinyin) kelimeler boşlukla ayrılmış şekilde yaz; glossary öğesinde word alanına kelimeyi latin alanındaki Latin yazılışıyla, native alanına aynı kelimeyi dilin kendi yazısıyla koy. Dil Latin alfabesi kullanıyorsa latin ve native alanlarını boş bırak.`;

export const generateReading = async (
  language: string,
  level: LabLevel,
  topic: string,
  reviewWords: SavedWord[],
  format: 'story' | 'dialogue'
): Promise<LabReading> => {
  const review = reviewWords.length
    ? `Şu kelimeleri metne doğal şekilde yedir (zorlama olmasın): ${reviewWords.map(w => w.word).join(', ')}.`
    : '';
  const prompt = `Bir dil edinme uygulaması için ${language} dilinde ${level} seviyesinde, yaklaşık 150-200 kelimelik bir ${format === 'story' ? 'kısa hikâye' : 'diyalog'} yaz. Konu: ${topic || 'günlük hayattan ilginç bir an'}. ${review}
${RULES}
title hedef dilde olsun. Sadece JSON döndür.`;
  return clean(await callAIJson<LabReading>(prompt, READING_SCHEMA));
};

const SERIES_SCHEMA = {
  ...READING_SCHEMA,
  properties: { ...READING_SCHEMA.properties, summary: { type: 'string' } },
  required: [...READING_SCHEMA.required, 'summary']
};

export const generateEpisode = async (
  language: string,
  level: LabLevel,
  premise: string,
  prevSummary: string,
  episode: number,
  reviewWords: SavedWord[]
): Promise<LabReading & { summary: string }> => {
  const review = reviewWords.length
    ? `Şu kelimeleri metne doğal şekilde yedir (zorlama olmasın): ${reviewWords.map(w => w.word).join(', ')}.`
    : '';
  const story = prevSummary
    ? `Hikâyenin şimdiye kadarki özeti: ${prevSummary}\nBu ${episode}. bölüm; hikâyeyi tutarlı biçimde devam ettir, aynı karakterleri kullan ve bölümü merak uyandıran bir yerde bitir.`
    : `Bu hikâyenin 1. bölümü. Konu/kurgu: ${premise || 'ilgi çekici bir macera'}. Ana karakterleri ve mekânı tanıt.`;
  const prompt = `Bir dil edinme uygulaması için ${language} dilinde ${level} seviyesinde, yaklaşık 150-200 kelimelik bölümlü bir hikâyenin ${episode}. bölümünü yaz. ${story} ${review}
${RULES}
title hedef dilde "bölüm adı" olsun. summary alanına bu bölüm dahil hikâyenin şimdiye kadarki özetini Türkçe yaz (karakter adları, yerler, olaylar; en fazla 120 kelime). Sadece JSON döndür.`;
  const r = await callAIJson<LabReading & { summary: string }>(prompt, SERIES_SCHEMA);
  return { ...clean(r), summary: unescapeAIText(r.summary || '') };
};

export const adaptSource = async (language: string, level: LabLevel, source: string): Promise<LabReading> => {
  const prompt = `Aşağıdaki kaynak metni ${language} dilinde ${level} seviyesindeki bir öğrenicinin anlayacağı hâle getir: anlamı ve içeriği koru, uzun ve ağır cümleleri sadeleştir, çok zor kelimeleri daha yaygın karşılıklarıyla değiştir. Kaynak başka dilde ise hedef dile çevirerek uyarla. En fazla 300 kelime olsun.
${RULES}
Kaynak:
"""
${source.slice(0, 8000)}
"""
Sadece JSON döndür.`;
  return clean(await callAIJson<LabReading>(prompt, READING_SCHEMA));
};

export interface WordExplanation { meaning: string; note: string; native?: string }

const WORD_SCHEMA = {
  type: 'object',
  properties: { meaning: { type: 'string' }, note: { type: 'string' }, native: { type: 'string' } },
  required: ['meaning', 'note']
};

export const explainWord = async (language: string, word: string, sentence: string, nativeSentence = ''): Promise<WordExplanation> => {
  const original = nativeSentence && nativeSentence !== sentence ? ` (dilin kendi yazısıyla: "${nativeSentence}")` : '';
  const prompt = `${language} dilinde "${word}" kelimesinin bu cümledeki anlamını Türkçe ver: "${sentence}"${original}
meaning: kısa Türkçe karşılık. native: kelimenin dilin KENDİ yazısıyla yazılışı (dil Latin alfabesi kullanıyorsa boş bırak). note: en fazla bir cümle, bağlamı veya kullanımı anlatan Türkçe not (gramer terimi kullanma). Sadece JSON döndür.`;
  return callAIJson<WordExplanation>(prompt, WORD_SCHEMA);
};

export interface PlacementPassage { level: LabLevel; text: string; latin?: string }

const PLACEMENT_SCHEMA = {
  type: 'object',
  properties: {
    passages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { level: { type: 'string' }, text: { type: 'string' }, latin: { type: 'string' } },
        required: ['level', 'text']
      }
    }
  },
  required: ['passages']
};

export const generatePlacement = async (language: string): Promise<PlacementPassage[]> => {
  const prompt = `${language} dilinde seviye tespiti için 5 kısa metin yaz (her biri 1-2 cümle), giderek zorlaşan: A1, A2, B1, B2, C1 seviyelerinde, bu sırayla. Her metnin level alanı seviyesi olsun. Dil Latin alfabesi kullanmıyorsa text alanına dilin kendi yazısıyla, latin alanına Latin harfli okunuşunu (romaji, pinyin vb.) yaz; kullanıyorsa latin alanını boş bırak. Sadece JSON döndür.`;
  const r = await callAIJson<{ passages: PlacementPassage[] }>(prompt, PLACEMENT_SCHEMA);
  return r.passages
    .filter(p => LEVELS.includes(p.level))
    .map(p => ({ level: p.level, text: unescapeAIText(p.text), latin: p.latin && p.latin.trim() ? unescapeAIText(p.latin) : undefined }));
};

export const levelFromPlacement = (understood: boolean[], passages: PlacementPassage[]): LabLevel => {
  let best: LabLevel = 'A1';
  for (let i = 0; i < passages.length; i++) {
    if (!understood[i]) break;
    best = passages[i].level;
  }
  return best;
};
