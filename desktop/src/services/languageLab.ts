import { callAIJson } from './geminiMentor';
import { unescapeAIText } from '../aiTeacher';

export const LANGUAGE_LAB_NOTE_PATH = 'Sistem/DilAtolyesi.md';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type LabLevel = typeof LEVELS[number];

export interface SavedWord {
  word: string;
  meaning: string;
  context: string;
  seen: number;
  added: string;
}

export interface LabLogEntry { date: string; minutes: number; words: number }

export interface LanguageLabState {
  language: string;
  level: LabLevel;
  easyStreak: number;
  hardStreak: number;
  words: SavedWord[];
  log: LabLogEntry[];
}

export const emptyLabState = (): LanguageLabState => ({
  language: '', level: 'A1', easyStreak: 0, hardStreak: 0, words: [], log: []
});

const JSON_BLOCK = /```json\n([\s\S]*?)\n```/;

export const parseLabState = (raw: string | undefined): LanguageLabState => {
  if (!raw) return emptyLabState();
  const m = raw.match(JSON_BLOCK);
  if (!m) return emptyLabState();
  try {
    const p = JSON.parse(m[1]);
    return { ...emptyLabState(), ...p, level: LEVELS.includes(p.level) ? p.level : 'A1' };
  } catch {
    return emptyLabState();
  }
};

export const serializeLabState = (s: LanguageLabState): string => {
  const known = s.words.length;
  const total = s.log.reduce((a, l) => a + l.minutes, 0);
  return `# Dil Atölyesi\n\nHedef dil: ${s.language || '-'} · Seviye: ${s.level} · Kayıtlı kelime: ${known} · Toplam input: ${total} dk\n\n\`\`\`json\n${JSON.stringify(s)}\n\`\`\`\n`;
};

export const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const minutesToday = (s: LanguageLabState): number =>
  s.log.filter(l => l.date === todayKey()).reduce((a, l) => a + l.minutes, 0);

export const inputStreak = (s: LanguageLabState): number => {
  const days = new Set(s.log.filter(l => l.minutes > 0).map(l => l.date));
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

export interface LabReading {
  title: string;
  text: string;
  glossary: { word: string; meaning: string }[];
}

const READING_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    text: { type: 'string' },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: { word: { type: 'string' }, meaning: { type: 'string' } },
        required: ['word', 'meaning']
      }
    }
  },
  required: ['title', 'text', 'glossary']
};

const clean = (r: LabReading): LabReading => ({
  title: unescapeAIText(r.title),
  text: unescapeAIText(r.text),
  glossary: Array.isArray(r.glossary) ? r.glossary : []
});

const RULES = `Kurallar: Gramer anlatma, kural listesi verme, çeviri alıştırması yapma. Metin tamamen hedef dilde, doğal ve akıcı olsun. Kullanıcının seviyesinin HAFİF ÜSTÜNDE (yaklaşık %90 anlaşılır, %10 yeni) yaz. Glossary alanına metindeki seviyeye göre yeni/zor 8-12 kelimeyi, metinde GEÇTİĞİ HALİYLE (çekimli şekliyle) ve o cümledeki anlamıyla Türkçe olarak koy.`;

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

export interface WordExplanation { meaning: string; note: string }

const WORD_SCHEMA = {
  type: 'object',
  properties: { meaning: { type: 'string' }, note: { type: 'string' } },
  required: ['meaning', 'note']
};

export const explainWord = async (language: string, word: string, sentence: string): Promise<WordExplanation> => {
  const prompt = `${language} dilinde "${word}" kelimesinin bu cümledeki anlamını Türkçe ver: "${sentence}"
meaning: kısa Türkçe karşılık. note: en fazla bir cümle, bağlamı veya kullanımı anlatan Türkçe not (gramer terimi kullanma). Sadece JSON döndür.`;
  return callAIJson<WordExplanation>(prompt, WORD_SCHEMA);
};

export interface PlacementPassage { level: LabLevel; text: string }

const PLACEMENT_SCHEMA = {
  type: 'object',
  properties: {
    passages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { level: { type: 'string' }, text: { type: 'string' } },
        required: ['level', 'text']
      }
    }
  },
  required: ['passages']
};

export const generatePlacement = async (language: string): Promise<PlacementPassage[]> => {
  const prompt = `${language} dilinde seviye tespiti için 5 kısa metin yaz (her biri 1-2 cümle), giderek zorlaşan: A1, A2, B1, B2, C1 seviyelerinde, bu sırayla. Her metnin level alanı seviyesi olsun. Sadece JSON döndür.`;
  const r = await callAIJson<{ passages: PlacementPassage[] }>(prompt, PLACEMENT_SCHEMA);
  return r.passages
    .filter(p => LEVELS.includes(p.level))
    .map(p => ({ level: p.level, text: unescapeAIText(p.text) }));
};

export const levelFromPlacement = (understood: boolean[], passages: PlacementPassage[]): LabLevel => {
  let best: LabLevel = 'A1';
  for (let i = 0; i < passages.length; i++) {
    if (!understood[i]) break;
    best = passages[i].level;
  }
  return best;
};
