// Asistan sesi: bas-konuş kaydı, yazıya çevirme ve sesli okuma.
// Masaüstü (Electron) Chromium'unda tarayıcının SpeechRecognition'ı çalışmaz; bu yüzden ses MediaRecorder ile kaydedilip Gemini'ye
// yazıya çevrilir (uygulamadaki mevcut transcribeVoiceQuestion). Okuma için önce Gemini'nin doğal sesi, yoksa Windows/Android sesi.
import { getGeminiApiKey, transcribeVoiceQuestion, synthesizeSpeech } from '../geminiMentor';
import { pcmBase64ToWavUrl } from '../../aiTeacher';

export const canRecord = (): boolean => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
/** Yazıya çevirme Gemini anahtarı ister (Claude Code ses almaz) */
export const canTranscribe = (): boolean => canRecord() && !!getGeminiApiKey();

export interface Recording { stop: () => Promise<Blob>; cancel: () => void; /** 0..1 anlık mikrofon seviyesi */ level: () => number }

// Ses seviyesi: AnalyserNode'dan ortalama genlik. Yalnızca görsel geri bildirim için; ses hiçbir yere gitmez.
const makeMeter = (src: MediaStream | HTMLMediaElement, toSpeakers: boolean) => {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC();
    const an = ctx.createAnalyser(); an.fftSize = 256;
    const node = src instanceof MediaStream ? ctx.createMediaStreamSource(src) : ctx.createMediaElementSource(src);
    node.connect(an); if (toSpeakers) an.connect(ctx.destination);
    const buf = new Uint8Array(an.fftSize);
    return {
      level: () => { an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } return Math.min(1, Math.sqrt(s / buf.length) * 3.2); },
      close: () => { try { void ctx.close(); } catch { /* yoksay */ } },
    };
  } catch { return null; }
};

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const meter = makeMeter(stream, false);
  const release = () => { stream.getTracks().forEach(t => t.stop()); meter?.close(); };
  rec.start();
  return {
    level: () => meter?.level() ?? 0,
    stop: () => new Promise<Blob>((resolve) => {
      rec.onstop = () => { release(); resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })); };
      if (rec.state !== 'inactive') rec.stop(); else { release(); resolve(new Blob(chunks, { type: mime || 'audio/webm' })); }
    }),
    cancel: () => { try { rec.onstop = null; if (rec.state !== 'inactive') rec.stop(); } catch { /* yoksay */ } release(); },
  };
}

const blobToBase64 = (b: Blob): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(new Error('Ses okunamadı.'));
  r.readAsDataURL(b);
});

/** Kaydı yazıya çevirir. Boş/çok kısa kayıt hata verir (yanlışlıkla basma). */
export async function transcribe(blob: Blob): Promise<string> {
  if (blob.size < 2500) throw new Error('Ses duyulmadı. Düğmeye basıp konuşun, bitince tekrar basın.');
  if (!getGeminiApiKey()) throw new Error('Sesi yazıya çevirmek için Ayarlar > AI Mentor bölümüne Gemini anahtarı gerekir (Claude Code ses almıyor).');
  const base64 = await blobToBase64(blob);
  const { transcript } = await transcribeVoiceQuestion(base64, blob.type.split(';')[0] || 'audio/webm');
  const t = String(transcript || '').trim();
  if (!t) throw new Error('Söylediğiniz anlaşılamadı. Tekrar deneyin.');
  return t;
}

// ---------------------------------------------------------------- sesli okuma

// Asistan sesi erkek: Gemini'nin hazır seslerinden derin ve sakin olanı (Charon). Varsayılan ses (Kore) kadın olduğu için açıkça seçilir.
const ASSISTANT_VOICE = 'Charon';

// Gemini sesi (TTS) ücretsiz kotada çok sınırlı ve her cevapta bir istek yer; bu yüzden varsayılan cihazın kendi sesi (ücretsiz, kotasız).
const GV_KEY = 'assistant_gemini_voice_v1';
export const useGeminiVoice = (): boolean => { try { return localStorage.getItem(GV_KEY) === '1'; } catch { return false; } };
export const setGeminiVoice = (v: boolean) => { try { localStorage.setItem(GV_KEY, v ? '1' : '0'); } catch { /* yoksay */ } };

// Azure Neural sesi (Edge'in doğal Türkçe sesleri, Ahmet/Emel). Anahtar Electron ana sürecinde korumalı depoda durur; yalnızca masaüstünde vardır.
// Açıkken önce bu denenir; anahtar/kota/ağ hatasında sırayla Gemini sesine (açıksa), sonra cihaz sesine düşülür.
const AZ_KEY = 'assistant_azure_voice_v1';
export const azureAvailable = (): boolean => typeof window !== 'undefined' && !!window.electron?.azureSpeechSpeak;
export const useAzureVoice = (): boolean => { try { return localStorage.getItem(AZ_KEY) === '1'; } catch { return false; } };
export const setAzureVoice = (v: boolean) => { try { localStorage.setItem(AZ_KEY, v ? '1' : '0'); } catch { /* yoksay */ } };
let lastErr = '';
/** Son okumada Azure'dan gelen hata (boşsa sorun yok); arayüz "neden başka ses çaldı" demek için gösterebilir */
export const lastSpeakError = (): string => lastErr;

export interface Speaking { done: Promise<void>; stop: () => void; /** Çalan sesin anlık seviyesi (cihaz sesinde yok: undefined) */ level?: () => number | undefined }

/** Metni okur. Gemini anahtarı varsa doğal ses, hata ya da anahtar yoksa cihazın kendi Türkçe sesi. */
export function speak(text: string): Speaking {
  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let meter: ReturnType<typeof makeMeter> = null;
  const speaking: Speaking = { done: Promise.resolve(), stop: () => {}, level: () => (meter ? meter.level() : undefined) };
  const stopAll = () => { stopped = true; meter?.close(); try { audio?.pause(); } catch { /* yoksay */ } try { window.speechSynthesis?.cancel(); } catch { /* yoksay */ } };
  const device = () => new Promise<void>((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'tr-TR';
      // Cihaz sesine düşünce de erkek ses aranır (adında erkek/male/Tolga gibi geçen); bulunamazsa ses alçaltılarak erkeğe yaklaştırılır.
      const tr = window.speechSynthesis.getVoices().filter(x => x.lang.toLowerCase().startsWith('tr'));
      const male = tr.find(x => /tolga|erkek|\bmale\b|ahmet|cem|yusuf/i.test(x.name) && !/female|kad[ıi]n/i.test(x.name));
      if (male) u.voice = male; else { if (tr[0]) u.voice = tr[0]; u.pitch = 0.7; }
      u.onend = () => resolve(); u.onerror = () => resolve();
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch { resolve(); }
  });
  const done = (async () => {
    if (useAzureVoice() && azureAvailable()) {
      try {
        const r = await window.electron.azureSpeechSpeak!(text.slice(0, 1500));
        if (stopped) return;
        if (r.ok && r.base64) {
          const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes], { type: r.mime || 'audio/mpeg' }));
          audio = new Audio(url);
          meter = makeMeter(audio, true);
          await new Promise<void>((resolve) => { audio!.onended = () => resolve(); audio!.onerror = () => resolve(); void audio!.play().catch(() => resolve()); });
          URL.revokeObjectURL(url); lastErr = '';
          return;
        }
        lastErr = r.error || 'Azure sesi üretilemedi.';
      } catch { lastErr = 'Azure sesi çalınamadı.'; }
    }
    if (getGeminiApiKey() && useGeminiVoice()) {
      try {
        const { audioBase64, mimeType } = await synthesizeSpeech(text.slice(0, 900), ASSISTANT_VOICE);
        if (stopped) return;
        audio = new Audio(pcmBase64ToWavUrl(audioBase64, mimeType));
        meter = makeMeter(audio, true);
        await new Promise<void>((resolve) => { audio!.onended = () => resolve(); audio!.onerror = () => resolve(); void audio!.play().catch(() => resolve()); });
        return;
      } catch { /* kota/ağ: cihaz sesine düş */ }
    }
    if (!stopped) await device();
  })();
  speaking.done = done; speaking.stop = stopAll;
  return speaking;
}
