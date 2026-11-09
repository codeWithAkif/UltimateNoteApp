// "Dışarı işler": notlardaki fiziksel işleri (alışveriş listeleri, "kargo", "kuru temizleme", "kablo al"...) toplayıp
// kullanıcının konumuna yakın, mümkünse TEK turda halledilecek duraklara çevirir (Gemini + Google araması) ve
// Google Haritalar rota bağlantısı üretir. Toplama/ayrıştırma saf fonksiyonlardır (ağ yok).
import { callGeminiGroundedText } from './geminiMentor';
import { normalizeTr } from './meetingBriefing';

export interface Errand {
  id: string;
  text: string;
  source: 'alınacaklar' | 'görev' | 'elle';
  hint?: string; // alışveriş listesinin adı (Market, Manav...) — istemde bağlam olur
}

export interface ErrandTaskInput { content: string; isChecked: boolean; filePath: string }

export const PROFILE_PATH = 'Sistem/Asistan.md';
const SHOPPING_FOLDER = 'alınacaklar/';

const cleanText = (s: string): string =>
  s.replace(/\[(?:due|plannedtime|time|window|started|completed|outcome|project|proje|status|durum|gcal|gcalh|hours|session|plan|repeat|priority|p):[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ').trim();

// Yer sözcükleri küçük ek alabilir (markete, eczaneden) ama "marketplace" gibi uzun devamlar eşleşmez.
const PLACE = '(market|eczane|kargo|postane|ptt|hırdavat|kuaför|berber|tamirci|terzi|noter|bakkal|manav|kasap|optik|anahtarcı|ayakkabıcı|fotokopi|çiçekçi|kırtasiye)';
const ERRAND_RE = new RegExp(
  `(?<!\\p{L})${PLACE}(?!\\p{L}{5})` +
  `|(?<!\\p{L})kuru\\s*temizle\\p{L}*` +
  `|(?<!\\p{L})satın\\s*al\\p{L}*` +
  `|(?<!\\p{L})\\p{L}+\\s+(almam|alıcam|alacağım)(?!\\p{L})` +
  `|(?<!\\p{L})(yaptır|götür|teslim\\s*(et|al))\\p{L}*`,
  'iu'
);
export const looksLikeErrand = (text: string): boolean => ERRAND_RE.test(text) && !/plana\s+al/i.test(text);

export const collectErrands = (tasks: ErrandTaskInput[], fileContents: Record<string, string>): Errand[] => {
  const out: Errand[] = [];
  const seen = new Set<string>();
  const push = (text: string, source: Errand['source'], hint?: string) => {
    const t = cleanText(text);
    const key = normalizeTr(t);
    if (!t || seen.has(key)) return;
    seen.add(key);
    out.push({ id: `${source}:${key}`, text: t, source, hint });
  };

  // 1) Kullanıcının kendi alışveriş listeleri: alınacaklar/*.md içindeki açık satırların HEPSİ.
  Object.keys(fileContents).forEach(path => {
    if (!path.toLocaleLowerCase('tr').startsWith(SHOPPING_FOLDER) || !/\.md$/i.test(path)) return;
    const hint = path.split('/').pop()!.replace(/\.md$/i, '');
    if (hint.toLocaleLowerCase('tr') === 'inbox' || hint.toLocaleLowerCase('tr') === 'record') return;
    (fileContents[path] || '').split('\n').forEach(line => {
      const m = line.match(/^\s*[*\-]\s+\[ \]\s+(.*)$/);
      if (m) push(m[1], 'alınacaklar', hint);
    });
  });

  // 2) Diğer notlardaki açık görevlerden fiziksel işe benzeyenler (kullanıcı listeden eleyebilir).
  tasks.forEach(t => {
    if (t.isChecked || !t.content) return;
    if (t.filePath.toLocaleLowerCase('tr').startsWith(SHOPPING_FOLDER)) return;
    if (looksLikeErrand(t.content)) push(t.content, 'görev');
  });

  return out.slice(0, 40);
};

export const parseLocation = (profileContent?: string): string => {
  const m = (profileContent || '').match(/\[konum:([^\]]+)\]/i);
  return m ? m[1].trim() : '';
};

export const upsertLocation = (profileContent: string | undefined, location: string): string => {
  const base = (profileContent && profileContent.trim())
    ? profileContent.replace(/\n?\[konum:[^\]]*\]/gi, '').trimEnd()
    : '# Asistan Profili\n\nAsistanın sizi tanıması için bilgiler. Elle düzenleyebilirsiniz.';
  return `${base}\n[konum:${location.trim()}]\n`;
};

export interface Stop { name: string; address: string; errandNumbers: number[]; why: string }
export interface ErrandPlan { stops: Stop[]; notes: string[]; raw: string }

export const buildErrandPrompt = (location: string, errands: Errand[]): string => `Sen kullanıcının günlük işlerini planlayan bir yardımcısın. Kullanıcı şu konumda: "${location}".
Yapması gereken fiziksel işler:
${errands.map((e, i) => `${i + 1}. ${e.text}${e.hint ? ` (liste: ${e.hint})` : ''}`).join('\n')}

Google aramasını kullanarak bu konuma YAKIN, gerçekten var olan yerler bul. Amaç: mümkün olan en az durakla, tek bir turda hepsini halletmek. Bir yer birden fazla işi karşılıyorsa (ör. büyük bir market hem gıdayı hem temizlik ürününü, bir AVM birkaç işi) onları aynı durağa ver. Durakları gidiş sırasına göre (yakından uzağa, mantıklı bir rota) yaz.
Yer ya da adres UYDURMA; emin olmadığın bir yeri yazma. En fazla 5 durak.

Çıktıyı SADECE şu satır biçiminde ver, başka hiçbir metin, başlık ya da açıklama ekleme:
DURAK | <yer adı> | <semt ve açık adres> | <karşıladığı iş numaraları, virgülle> | <tek cümle neden>
Sonra gerekirse en fazla 2 satır:
NOT | <çalışma saati, kapalı olma ya da stok gibi önemli bir uyarı>
Bir işe uygun yer bulamadıysan NOT satırında hangi iş olduğunu söyle.`;

export const parseErrandPlan = (text: string): ErrandPlan => {
  const stops: Stop[] = [];
  const notes: string[] = [];
  const clean = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\[\d+(?:,\s*\d+)*\]/g, '').trim();
  text.split('\n').forEach(rawLine => {
    const line = rawLine.replace(/^[\s*\-•\d.)]+(?=(DURAK|NOT)\b)/i, '').trim();
    if (/^DURAK\s*\|/i.test(line)) {
      const parts = line.split('|').map(p => clean(p));
      const [, name, address, nums, why] = parts;
      if (name) {
        stops.push({
          name,
          address: address || '',
          errandNumbers: (nums || '').split(/[,\s]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n)),
          why: why || ''
        });
      }
    } else if (/^NOT\s*\|/i.test(line)) {
      const n = clean(line.replace(/^NOT\s*\|/i, ''));
      if (n) notes.push(n);
    }
  });
  return { stops, notes, raw: text };
};

export const mapsSearchUrl = (s: Stop, location: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address || location}`.trim())}`;

// Tüm duraklar tek rota: son durak hedef, öncekiler ara nokta; çıkış noktası verilmediğinden Haritalar
// kullanıcının o anki konumunu başlangıç alır. Duraklar ad+adresle aranır (koordinat/anahtar gerekmez).
export const mapsRouteUrl = (stops: Stop[], location: string): string => {
  const q = (s: Stop) => `${s.name} ${s.address || location}`.trim();
  if (stops.length === 0) return '';
  const dest = q(stops[stops.length - 1]);
  const way = stops.slice(0, -1).map(q).join('|');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}&travelmode=driving`;
};

export const generateErrandPlan = async (location: string, errands: Errand[]): Promise<ErrandPlan> => {
  const text = await callGeminiGroundedText(buildErrandPrompt(location, errands));
  return parseErrandPlan(text);
};
