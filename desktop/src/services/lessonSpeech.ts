// Dil Atölyesi seslendirme ağ katmanı: konuşma turlarını (kim, hangi duyguyla) Gemini TTS'e gönderir. Hangi model ailesinin anahtarda açık
// olduğu önceden bilinemediği için sırayla denenir (v38 -> v25 -> eski tek ses); çalışan mod hatırlanır, "desteklenmiyor" diyenler 3 gün atlanır.
// Her durumda ses gelir: en kötü ihtimalle eski tek sesli yola düşülür.

import { GEMINI_API_BASE, getGeminiApiKey, synthesizeSpeech } from './geminiMentor';
import { pcmBase64ToWavUrl } from '../aiTeacher';
import { buildTtsRequest, planModes, type ModeMemory, type Turn, type TtsMode, type TtsRequest, type VoicePlan } from './lessonVoices';

const MEM_KEY = 'lang_tts_modes_v1';
const MAX_CHARS = 4500;

const loadMem = (): ModeMemory => {
  try { const o = JSON.parse(localStorage.getItem(MEM_KEY) || '{}'); return { last: o.last, unsupported: o.unsupported && typeof o.unsupported === 'object' ? o.unsupported : {} }; }
  catch { return { unsupported: {} }; }
};
const saveMem = (m: ModeMemory) => { try { localStorage.setItem(MEM_KEY, JSON.stringify(m)); } catch { /* yoksay */ } };

const b64ToBlob = (b64: string, type: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

// Yanıt ya başlıklı WAV ya da ham PCM (L16) gelebilir; ikisi de çalınabilir WAV Blob'una çevrilir.
const toWavBlob = async (audioBase64: string, mimeType: string): Promise<Blob> => {
  if (/wav|wave/i.test(mimeType)) return b64ToBlob(audioBase64, 'audio/wav');
  const url = pcmBase64ToWavUrl(audioBase64, mimeType);
  const blob = await (await fetch(url)).blob();
  URL.revokeObjectURL(url);
  return blob;
};

const callTts = async (req: TtsRequest): Promise<{ audioBase64: string; mimeType: string }> => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw Object.assign(new Error('Gemini API anahtarı ayarlanmamış. Ayarlar > AI Mentor bölümünden ekleyin.'), { status: 0, fatal: true });
  const res = await fetch(`${GEMINI_API_BASE}/${req.model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body)
  });
  if (!res.ok) {
    let t = ''; try { t = await res.text(); } catch { /* yoksay */ }
    throw Object.assign(new Error(`Gemini TTS hatası (${res.status}, ${req.model}): ${t.slice(0, 200)}`), { status: res.status });
  }
  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0];
  const audioBase64 = part?.inlineData?.data;
  if (!audioBase64) throw Object.assign(new Error(`Gemini ses üretemedi (${req.model}).`), { status: 0 });
  return { audioBase64, mimeType: part?.inlineData?.mimeType || 'audio/L16;rate=24000' };
};

const capTurns = (turns: Turn[]): Turn[] => {
  let n = 0;
  const out: Turn[] = [];
  for (const t of turns) { n += t.text.length; if (n > MAX_CHARS) break; out.push(t); }
  return out;
};

export const synthesizeLesson = async (turns: Turn[], plan: VoicePlan): Promise<{ blob: Blob; mode: TtsMode }> => {
  const used = capTurns(turns).filter(t => t.text);
  if (used.length === 0) throw new Error('Seslendirilecek metin yok.');
  const mem = loadMem();
  const modes = planModes(plan, mem);
  const errors: string[] = [];
  for (const mode of modes) {
    try {
      let raw: { audioBase64: string; mimeType: string };
      if (mode === 'legacy') {
        raw = await synthesizeSpeech(used.map(t => t.text).join(' ').slice(0, 1800), plan.slots[0].voice);
      } else {
        raw = await callTts(buildTtsRequest(mode, used, plan));
      }
      const blob = await toWavBlob(raw.audioBase64, raw.mimeType);
      const fresh = loadMem(); // hata sırasında yazılan "desteklenmiyor" işaretleri korunsun
      if (fresh.last !== mode) saveMem({ ...fresh, last: mode });
      return { blob, mode };
    } catch (e: any) {
      errors.push(String(e?.message || e));
      if (e?.fatal) throw e;
      // Model/şema bu anahtarda desteklenmiyor (404/400/403): bir süre atla. Kota (429) ve sunucu hataları atlanmaz, yalnızca bir sonrakine geçilir.
      if (mode !== 'legacy' && [400, 403, 404].includes(e?.status)) saveMem({ ...loadMem(), unsupported: { ...loadMem().unsupported, [mode]: Date.now() } });
    }
  }
  throw new Error(errors.join('\n'));
};
