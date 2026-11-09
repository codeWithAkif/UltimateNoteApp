// Serbest metinden görev çıkarma: toplantı notu, yapıştırılan yazı ya da günlük girdisindeki "Ahmet ile görüş",
// "cuma günü sunumu gönder" gibi cümleleri Gemini ile görev adaylarına çevirir. Kullanıcı onaylamadan hiçbir şey yazılmaz.
// Ayrıştırma/temizleme/tekilleştirme/ekleme saf fonksiyonlardır (ağ yok).
import { getGeminiApiKey, getGeminiModel } from './geminiMentor';
import { normalizeTr } from './meetingBriefing';

export interface ExtractedTask { text: string; due?: string }

const MAX_SOURCE = 4000;
const MAX_TASKS = 15;
const HEADING = '## Çıkarılan görevler';

const SCHEMA = {
  type: 'object',
  properties: {
    gorevler: {
      type: 'array',
      items: {
        type: 'object',
        properties: { metin: { type: 'string' }, tarih: { type: 'string' } },
        required: ['metin', 'tarih']
      }
    }
  },
  required: ['gorevler']
};

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DOW = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

// Uzun metinde güncel içerik genelde sonda olduğu için sondan kesilir; meta etiketleri gürültü olduğu için atılır.
export const prepareSource = (text: string): string => {
  const clean = text
    .replace(/\[(?:due|plannedtime|time|window|started|completed|outcome|project|proje|status|durum|gcal|gcalh|hours|session|plan|repeat|priority|p):[^\]]*\]/gi, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > MAX_SOURCE ? clean.slice(-MAX_SOURCE) : clean;
};

export const buildExtractPrompt = (source: string, now: Date): string =>
  `Sen kullanıcının not asistanısın. Aşağıdaki serbest metinden kullanıcının YAPMASI gereken somut işleri çıkar.
Bugün: ${ymdOf(now)} (${DOW[now.getDay()]}).

Kurallar:
- Yalnızca metinde açıkça geçen işleri yaz; uydurma, varsayım yapma, genel tavsiye ekleme.
- Zaten yapılmış ("yaptım", "gönderdim", "tamamlandı", [x] işaretli) işleri ALMA.
- Başkasının yapacağı işleri ALMA (yalnızca kullanıcıya düşenleri al). Bilgi/karar cümleleri görev değildir.
- metin: Türkçe, kısa ve eylemle biten tek satır (en fazla 100 karakter), "Ahmet ile görüş" gibi.
- tarih: metinde net bir zaman varsa (bugün, yarın, cuma, 15 Kasım...) YYYY-MM-DD yaz; yoksa boş string. Tarihi tahmin etme.
- En fazla ${MAX_TASKS} görev. İş yoksa boş dizi.
Sadece JSON döndür.

Metin:
"""
${source}
"""`;

const norm = (s: string) => normalizeTr(s);

// Modelin çıktısını güvenli hâle getirir: boş/uzun satırları, geçmiş/bozuk tarihleri ve tekrarları ayıklar.
export const parseExtracted = (raw: any, now: Date): ExtractedTask[] => {
  const list: any[] = Array.isArray(raw?.gorevler) ? raw.gorevler : [];
  const today = ymdOf(now);
  const seen = new Set<string>();
  const out: ExtractedTask[] = [];
  for (const g of list) {
    let text = typeof g?.metin === 'string' ? g.metin.replace(/\s+/g, ' ').replace(/^[-*\s\[\]xX]+/, '').trim() : '';
    if (text.length < 3) continue;
    if (text.length > 120) text = text.slice(0, 117).trimEnd() + '…';
    const key = norm(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const d = typeof g?.tarih === 'string' ? g.tarih.trim() : '';
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && d >= today;
    out.push({ text, due: valid ? d : undefined });
    if (out.length >= MAX_TASKS) break;
  }
  return out;
};

// Hedef notta zaten aynı görev varsa (açık ya da kapalı) tekrar önerilmez.
export const dropExisting = (items: ExtractedTask[], existingContent: string): ExtractedTask[] => {
  const have = new Set<string>();
  (existingContent || '').split('\n').forEach(line => {
    const m = line.match(/^\s*[*\-]\s+\[[ xX\/]\]\s*(.*)$/);
    if (m) have.add(norm(m[1].replace(/\[[a-z]+:[^\]]*\]/gi, '')));
  });
  return items.filter(i => !have.has(norm(i.text)));
};

// Seçilen görevleri notun sonuna "## Çıkarılan görevler" başlığı altında ekler (başlık varsa onun altına eklemez, sona yazar).
export const appendTasksToNote = (content: string, items: ExtractedTask[]): string => {
  const lines = items.map(i => `- [ ] ${i.text.replace(/\[/g, '(').replace(/\]/g, ')')}${i.due ? ` [due:${i.due}]` : ''}`);
  const base = (content || '').replace(/\s+$/, '');
  const needHeading = !base.includes(HEADING);
  return `${base}${base ? '\n\n' : ''}${needHeading ? `${HEADING}\n` : ''}${lines.join('\n')}\n`;
};

export const dailyNotePath = (now: Date = new Date()) => `Günlükler/${ymdOf(now)}.md`;

export const generateTasks = async (source: string, now: Date = new Date()): Promise<ExtractedTask[]> => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API anahtarı ayarlanmamış. Ayarlar > AI Mentor bölümünden ekleyin.');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildExtractPrompt(source, now) }] }],
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini yanıtı boş döndü.');
  return parseExtracted(JSON.parse(text), now);
};
