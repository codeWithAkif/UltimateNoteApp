// Dil Atölyesi sesli okuma planı: cümleleri "konuşma turlarına" böler (kim konuşuyor, hangi duyguyla), iki konuşmacıya farklı sesler atar ve
// Gemini TTS isteklerini kurar. Saf işlevler (ağ yok); ağ çağrısı lessonSpeech.ts'te.
//
// İki model ailesi desteklenir (hangisinin anahtarınızda açık olduğu önceden bilinemez, bu yüzden sırayla denenir):
//  - 'v38': güncel belge şeması; her tur ayrı bölüm, konuşmacı ve stil "speech_metadata" içinde.
//  - 'v25': eski gemini-2.5-flash-preview-tts; metin "Ad: cümle" satırları, stil "Make A sound ..., and make B sound ...:" kalıbıyla.
//  - 'legacy': tek sesli eski yol (hiçbir şey çalışmazsa; cümle renklendirme yine çalışır).

export interface TurnSource { text: string; speaker?: string; tone?: string; gender?: string }
export interface Turn { index: number; speaker: string; text: string; tone: string; gender: '' | 'f' | 'm' }

const NARRATOR = /^(anlatıcı|narrator|narration|erzähler|narrateur|narrador|ナレーター|내레이터|旁白|рассказчик|الراوي)$/i;
const normSpeaker = (s?: string): string => { const v = (s || '').trim(); return !v || NARRATOR.test(v) ? '' : v; };
const normGender = (g?: string): '' | 'f' | 'm' => { const v = (g || '').trim().toLowerCase(); return v === 'f' || v === 'm' ? v : ''; };
const PREFIX = /^\s*([\p{L}\p{M}][\p{L}\p{M}'’.\- ]{0,22}?)\s*[:：]\s+/u;

// strip: metni konuşmaya uygun hâle getirir (işaretleri temizler). kind==='dialogue' ise "Ad: ..." öneki konuşmacıyı belirtir ve okunmaz.
export const buildTurns = (sentences: TurnSource[], kind: string, strip: (s: string) => string = s => s): Turn[] => {
  const turns: Turn[] = [];
  let prevSpeaker = '';
  sentences.forEach((s, index) => {
    let text = strip(s.text || '').replace(/\s+/g, ' ').trim();
    let speaker = normSpeaker(s.speaker);
    const m = text.match(PREFIX);
    if (m) {
      const label = m[1].trim();
      if (kind === 'dialogue' || (speaker && label.toLowerCase() === speaker.toLowerCase())) {
        if (!speaker) speaker = normSpeaker(label);
        text = text.slice(m[0].length).trim();
      }
    }
    // Diyalogda önek olmayan satır (aynı kişinin devam cümlesi) bir önceki konuşmacıya aittir.
    if (!speaker && !s.speaker && kind === 'dialogue') speaker = prevSpeaker;
    prevSpeaker = speaker;
    turns.push({ index, speaker, text, tone: (s.tone || '').trim().slice(0, 80), gender: normGender(s.gender) });
  });
  return turns;
};

// ---------------- ses atama ----------------
export interface Slot { key: string; label: string; voice: string; gender: '' | 'f' | 'm'; tone: string }
export interface VoicePlan { multi: boolean; slots: Slot[]; slotOf: (speakerKey: string) => Slot }

// Hazır seslerin adları resmi listeden (Kore, Puck…); cinsiyet bilgisi belgede yok, yaygın bilgiye dayanır.
const FEM = ['Kore', 'Aoede', 'Leda', 'Zephyr'];
const MAL = ['Puck', 'Charon', 'Orus', 'Fenrir'];

const pickVoices = (g0: '' | 'f' | 'm', g1: '' | 'f' | 'm'): [string, string] => {
  let a = g0, b = g1;
  if (!a && !b) { a = 'f'; b = 'm'; }
  else if (!a) a = b === 'f' ? 'm' : 'f';
  else if (!b) b = a === 'f' ? 'm' : 'f';
  const pool = (g: string) => (g === 'f' ? FEM : MAL);
  return [pool(a)[0], pool(b)[a === b ? 1 : 0]];
};

const dominantTone = (turns: Turn[]): string => {
  const c = new Map<string, number>();
  turns.forEach(t => { if (t.tone) c.set(t.tone, (c.get(t.tone) || 0) + 1); });
  let best = '', n = 0;
  c.forEach((v, k) => { if (v > n) { best = k; n = v; } });
  return best;
};

const labelOf = (key: string, fallback: string): string => {
  if (!key) return 'Narrator';
  const l = key.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return l || fallback;
};

export const assignVoices = (turns: Turn[]): VoicePlan => {
  const counts = new Map<string, number>();
  const genders = new Map<string, '' | 'f' | 'm'>();
  turns.forEach(t => {
    counts.set(t.speaker, (counts.get(t.speaker) || 0) + 1);
    if (t.gender && !genders.get(t.speaker)) genders.set(t.speaker, t.gender);
  });
  const named = [...counts.keys()].filter(k => k !== '').sort((a, b) => (counts.get(b)! - counts.get(a)!));
  const hasNarrator = (counts.get('') || 0) > 0;

  let chosen: string[] = [];
  if (named.length >= 2) chosen = named.slice(0, 2);
  else if (named.length === 1 && hasNarrator) chosen = [named[0], ''];

  if (chosen.length < 2) {
    const key = named[0] ?? '';
    const g = genders.get(key) || '';
    const slot: Slot = { key, label: 'Speaker1', voice: g === 'm' ? MAL[0] : FEM[0], gender: g, tone: dominantTone(turns) };
    return { multi: false, slots: [slot], slotOf: () => slot };
  }

  const [v0, v1] = pickVoices(genders.get(chosen[0]) || '', genders.get(chosen[1]) || '');
  let l0 = labelOf(chosen[0], 'Speaker1'), l1 = labelOf(chosen[1], 'Speaker2');
  if (l0.toLowerCase() === l1.toLowerCase()) l1 = `${l1} 2`;
  const slots: Slot[] = [
    { key: chosen[0], label: l0, voice: v0, gender: genders.get(chosen[0]) || '', tone: dominantTone(turns.filter(t => chosen.length && t.speaker === chosen[0])) },
    { key: chosen[1], label: l1, voice: v1, gender: genders.get(chosen[1]) || '', tone: dominantTone(turns.filter(t => t.speaker === chosen[1])) }
  ];
  // İkiden fazla konuşmacı (ya da anlatıcı): TTS en çok iki sesi destekler; fazlası ilk konuşmacının sesine katılır.
  return { multi: true, slots, slotOf: (k: string) => (k === chosen[1] ? slots[1] : slots[0]) };
};

// ---------------- istek kurma ----------------
export type TtsMode = 'v38' | 'v25' | 'legacy';
export const TTS_MODELS: Record<'v38' | 'v25', string> = { v38: 'gemini-3.8-flash-tts', v25: 'gemini-2.5-flash-preview-tts' };

export interface TtsRequest { model: string; body: any }

export const buildTtsRequest = (mode: 'v38' | 'v25', turns: Turn[], plan: VoicePlan): TtsRequest => {
  if (mode === 'v38') {
    const parts = turns.filter(t => t.text).map(t => {
      const meta: Record<string, string> = {};
      if (plan.multi) meta.speaker = plan.slotOf(t.speaker).label;
      if (t.tone) meta.style = t.tone;
      return Object.keys(meta).length ? { text: t.text, speech_metadata: meta } : { text: t.text };
    });
    const speechConfig = plan.multi
      ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: plan.slots.map(s => ({ speaker: s.label, voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } } })) } }
      : { voiceConfig: { voice: plan.slots[0].voice } };
    return { model: TTS_MODELS.v38, body: { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['AUDIO'], speechConfig } } };
  }
  // v25: yalnızca çok konuşmacılı kullanılır (tek sesli metin eski yola gider)
  const [a, b] = plan.slots;
  let lead: string;
  if (a.tone && b?.tone) lead = `Make ${a.label} sound ${a.tone}, and make ${b.label} sound ${b.tone}:`;
  else if (a.tone || b?.tone) lead = `Make ${a.tone ? a.label : b.label} sound ${a.tone || b.tone}:`;
  else lead = `TTS the following conversation between ${a.label} and ${b ? b.label : a.label}:`;
  const lines = turns.filter(t => t.text).map(t => `${plan.slotOf(t.speaker).label}: ${t.text}`).join('\n');
  return {
    model: TTS_MODELS.v25,
    body: {
      contents: [{ parts: [{ text: `${lead}\n${lines}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: plan.slots.map(s => ({ speaker: s.label, voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } } })) } }
      }
    }
  };
};

// ---------------- model sırası ve hafıza ----------------
export interface ModeMemory { last?: TtsMode; unsupported: Partial<Record<TtsMode, number>> }
const UNSUPPORTED_MS = 3 * 24 * 3600 * 1000;

export const planModes = (plan: VoicePlan, mem: ModeMemory, now: number = Date.now()): TtsMode[] => {
  const base: TtsMode[] = plan.multi ? ['v38', 'v25', 'legacy'] : ['v38', 'legacy'];
  const usable = base.filter(m => m === 'legacy' || !(mem.unsupported[m] && now - mem.unsupported[m]! < UNSUPPORTED_MS));
  if (mem.last && usable.includes(mem.last)) return [mem.last, ...usable.filter(m => m !== mem.last)];
  return usable;
};

// Cümle numarasından bağımsız sabit ses: tek cümle dinlerken de konuşmacının sesi aynı kalsın.
export const voiceForTurn = (plan: VoicePlan, turn: Turn): { voice: string; label: string; tone: string } => {
  const s = plan.slotOf(turn.speaker);
  return { voice: s.voice, label: s.label, tone: turn.tone };
};

// Tek cümle dinlerken: o cümlenin konuşmacısının sesi ve tonuyla tek sesli plan (tüm metindekiyle aynı ses atanır).
export const singleTurnPlan = (plan: VoicePlan, turn: Turn): VoicePlan => {
  const s = plan.slotOf(turn.speaker);
  const slot: Slot = { ...s, label: 'Speaker1' };
  return { multi: false, slots: [slot], slotOf: () => slot };
};
