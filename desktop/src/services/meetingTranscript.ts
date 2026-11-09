// Toplantı transkripti: Teams'ten inen standart WebVTT (.vtt) dosyasını konuşmacı bazlı dökümüne çevirir, Gemini ile
// özet / kararlar / kişi bazlı görevler / paylaşılan kaynaklar çıkarır ve nota yazılacak markdown'ı üretir.
// Ayrıştırma ve markdown üretimi saf fonksiyonlardır (ağ yok).
import { getGeminiApiKey, getGeminiModel } from './geminiMentor';
import { normalizeTr } from './meetingBriefing';

export interface Turn { speaker: string; start: number; text: string } // start: saniye
export interface ParsedTranscript {
  turns: Turn[];
  speakers: { name: string; words: number }[];
  durationSec: number;
}

const NO_SPEAKER = 'Konuşmacı';
const TIME = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/;
const CUE_LINE = new RegExp(`^\\s*${TIME.source}\\s*-->\\s*${TIME.source}`);

const toSec = (h: string | undefined, m: string, s: string, ms: string) =>
  (h ? parseInt(h, 10) * 3600 : 0) + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms.padEnd(3, '0'), 10) / 1000;

const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Standart WebVTT: "<v Konuşmacı Adı>metin</v>" (Teams bu biçimi kullanır). Etiket yoksa "Ad: metin" biçimi de denenir.
export const parseVtt = (raw: string): ParsedTranscript => {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Turn[] = [];
  let end = 0;
  for (const block of blocks) {
    const lines = block.split('\n');
    const idx = lines.findIndex(l => CUE_LINE.test(l));
    if (idx < 0) continue; // WEBVTT başlığı, NOTE, STYLE blokları
    const m = lines[idx].match(CUE_LINE)!;
    const start = toSec(m[1], m[2], m[3], m[4]);
    const stop = toSec(m[5], m[6], m[7], m[8]);
    if (stop > end) end = stop;
    const payload = lines.slice(idx + 1).join(' ');
    if (!payload.trim()) continue;
    let speaker = '';
    let body = payload;
    const v = payload.match(/<v(?:\.[^\s>]*)?\s+([^>]+)>/);
    if (v) {
      speaker = decode(v[1]).trim();
    } else {
      const c = payload.match(/^\s*([^:<>]{2,40}):\s+(.*)$/);
      if (c) { speaker = c[1].trim(); body = c[2]; }
    }
    body = decode(body.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!body) continue;
    cues.push({ speaker: speaker || NO_SPEAKER, start, text: body });
  }
  // Art arda aynı kişinin cümleleri tek konuşmada birleşir.
  const turns: Turn[] = [];
  for (const c of cues) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === c.speaker) last.text += ' ' + c.text;
    else turns.push({ ...c });
  }
  const count = new Map<string, number>();
  turns.forEach(t => count.set(t.speaker, (count.get(t.speaker) || 0) + t.text.split(/\s+/).length));
  const speakers = Array.from(count.entries()).map(([name, words]) => ({ name, words })).sort((a, b) => b.words - a.words);
  return { turns, speakers, durationSec: Math.round(end) };
};

export const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// Teams dosya adı: "Borusan Datahub sync-20261109_103000UTC-Meeting Transcript.vtt" -> "Borusan Datahub sync".
export const titleFromFileName = (name: string): string => {
  const base = name.replace(/\.vtt$/i, '');
  const cut = base.replace(/[-_ ]*\d{8}[_T-]?\d{4,6}.*$/i, '').replace(/[-_ ]*Meeting Transcript.*$/i, '').replace(/[-_ ]*Toplantı.*Transkript.*$/i, '').trim();
  return (cut || base).trim();
};

const MAX_PROMPT_CHARS = 150000;

export const transcriptForPrompt = (p: ParsedTranscript): { text: string; trimmed: boolean } => {
  const lines = p.turns.map(t => `[${fmtClock(t.start)}] ${t.speaker}: ${t.text}`);
  const full = lines.join('\n');
  if (full.length <= MAX_PROMPT_CHARS) return { text: full, trimmed: false };
  const half = Math.floor(MAX_PROMPT_CHARS / 2);
  return { text: `${full.slice(0, half)}\n[... transkriptin ortası çok uzun olduğu için atlandı ...]\n${full.slice(-half)}`, trimmed: true };
};

export interface MeetingTask { kisi: string; metin: string; tarih?: string }
export interface MeetingSummary {
  ozet: string;
  kararlar: string[];
  gorevler: MeetingTask[];
  kaynaklar: string[];
  acikSorular: string[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    ozet: { type: 'string' },
    kararlar: { type: 'array', items: { type: 'string' } },
    gorevler: {
      type: 'array',
      items: { type: 'object', properties: { kisi: { type: 'string' }, metin: { type: 'string' }, tarih: { type: 'string' } }, required: ['kisi', 'metin', 'tarih'] }
    },
    kaynaklar: { type: 'array', items: { type: 'string' } },
    acikSorular: { type: 'array', items: { type: 'string' } }
  },
  required: ['ozet', 'kararlar', 'gorevler', 'kaynaklar', 'acikSorular']
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DOW = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export const buildTranscriptPrompt = (title: string, p: ParsedTranscript, body: string, now: Date, meetingDate?: Date): string =>
  `Sen kullanıcının toplantı asistanısın. Aşağıda "${title}" toplantısının konuşmacı etiketli transkripti var (Türkçe/İngilizce karışık olabilir; transkripsiyon hataları içerebilir).
Bugün: ${ymd(now)} (${DOW[now.getDay()]}).${meetingDate ? ` Toplantı tarihi: ${ymd(meetingDate)} (${DOW[meetingDate.getDay()]}).` : ''}
Katılımcılar: ${p.speakers.map(s => s.name).join(', ') || 'bilinmiyor'}.

SADECE transkriptte geçenlere dayan; bilgi uydurma, varsayım yapma.
- ozet: toplantının neyle ilgili olduğunu ve vardığı sonucu anlatan 3-5 cümle.
- kararlar: açıkça alınmış kararlar (yoksa boş dizi).
- gorevler: toplantıda birinin üstlendiği ya da kendisine verilen somut işler. kisi: işi yapacak katılımcının transkriptteki adı (belli değilse "Belirsiz"). metin: eylemle biten kısa Türkçe tek satır (en fazla 100 karakter). tarih: net bir zaman söylendiyse (yarın, cuma, haftaya...) toplantı tarihine göre YYYY-MM-DD, yoksa boş string. Tarihi tahmin etme.
- kaynaklar: konuşmada anılan belge, doküman, link, sistem, ekran, rapor, araç adları (örn. "Datahub API dokümanı", "Q3 bütçe tablosu"). Uydurma; yalnızca geçenler.
- acikSorular: cevaplanmamış kalan ya da takip gerektiren sorular (en fazla 5).
Sadece JSON döndür.

Transkript:
"""
${body}
"""`;

const arr = (x: any): string[] => (Array.isArray(x) ? x.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : []);

export const parseSummary = (raw: any, now: Date): MeetingSummary => {
  const today = ymd(now);
  const seen = new Set<string>();
  const gorevler: MeetingTask[] = [];
  for (const g of (Array.isArray(raw?.gorevler) ? raw.gorevler : [])) {
    const metin = typeof g?.metin === 'string' ? g.metin.replace(/\s+/g, ' ').trim() : '';
    if (metin.length < 3) continue;
    const kisi = typeof g?.kisi === 'string' && g.kisi.trim() ? g.kisi.trim() : 'Belirsiz';
    const key = normalizeTr(`${kisi} ${metin}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const d = typeof g?.tarih === 'string' ? g.tarih.trim() : '';
    // Toplantıdan önceki/bozuk tarih verilmişse yok sayılır (görev kalır).
    gorevler.push({ kisi, metin: metin.length > 120 ? metin.slice(0, 117) + '…' : metin, tarih: /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && d >= today ? d : undefined });
    if (gorevler.length >= 25) break;
  }
  return {
    ozet: typeof raw?.ozet === 'string' ? raw.ozet.trim() : '',
    kararlar: arr(raw?.kararlar), gorevler, kaynaklar: arr(raw?.kaynaklar), acikSorular: arr(raw?.acikSorular).slice(0, 5)
  };
};

export const generateMeetingSummary = async (title: string, p: ParsedTranscript, meetingDate?: Date, now: Date = new Date()): Promise<MeetingSummary> => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API anahtarı ayarlanmamış. Ayarlar > AI Mentor bölümünden ekleyin.');
  const { text } = transcriptForPrompt(p);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildTranscriptPrompt(title, p, text, now, meetingDate) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA }
      })
    }
  );
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch { /* yoksay */ }
    throw new Error(`Gemini API hatası (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error('Gemini yanıtı boş döndü.');
  return parseSummary(JSON.parse(out), now);
};

const safe = (s: string) => s.replace(/\[/g, '(').replace(/\]/g, ')');

// Nota yazılacak markdown. Görevler "- [ ] Kişi: iş" biçiminde gerçek görev satırı olur (uygulama görev listesinde görünür).
export const meetingNoteMarkdown = (o: {
  title: string; date: Date; parsed: ParsedTranscript; summary: MeetingSummary; tasks: MeetingTask[]; includeTranscript: boolean;
}): string => {
  const { title, date, parsed, summary, tasks } = o;
  const sec = (h: string, items: string[]) => (items.length ? `## ${h}\n${items.map(i => `- ${i}`).join('\n')}\n\n` : '');
  let md = `# Toplantı: ${title}\n\nTarih: ${ymd(date)}${parsed.durationSec ? ` · Süre: ${fmtClock(parsed.durationSec)}` : ''}\n`;
  if (parsed.speakers.length) md += `Katılımcılar: ${parsed.speakers.map(s => s.name).join(', ')}\n`;
  md += '\n';
  if (summary.ozet) md += `## Özet\n${summary.ozet}\n\n`;
  md += sec('Kararlar', summary.kararlar);
  if (tasks.length) {
    md += `## Görevler\n${tasks.map(t => `- [ ] ${safe(t.kisi === 'Belirsiz' ? t.metin : `${t.kisi}: ${t.metin}`)}${t.tarih ? ` [due:${t.tarih}]` : ''}`).join('\n')}\n\n`;
  }
  md += sec('Paylaşılan kaynaklar', summary.kaynaklar);
  md += sec('Açık sorular', summary.acikSorular);
  if (o.includeTranscript && parsed.turns.length) {
    md += `## Döküm\n\n${parsed.turns.map(t => `**${t.speaker}** (${fmtClock(t.start)}): ${t.text}`).join('\n\n')}\n`;
  }
  return md.replace(/\s+$/, '') + '\n';
};
