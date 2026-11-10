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

// ---- Yerlerim (kayıtlı yerler): "[yer:kategori|ad|adres]" satırları Sistem/Asistan.md'de durur. Kategori başına tek yer; ----
// ---- kullanıcı bir seçenek seçtikçe ya da elle ekledikçe güncellenir ve sonraki planda varsayılan olarak gelir.      ----
export interface SavedPlace { category: string; name: string; address: string }

const fieldClean = (s: string) => s.replace(/[|\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const sameCategory = (a: string, b: string) => {
  const x = normalizeTr(a), y = normalizeTr(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

export const parsePlaces = (profileContent?: string): SavedPlace[] => {
  const out: SavedPlace[] = [];
  const re = /\[yer:([^|\]]*)\|([^|\]]*)\|([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(profileContent || ''))) {
    const p = { category: m[1].trim(), name: m[2].trim(), address: m[3].trim() };
    if (p.category && p.name) out.push(p);
  }
  return out;
};

const profileBase = (content?: string) => (content && content.trim())
  ? content.trimEnd()
  : '# Asistan Profili\n\nAsistanın sizi tanıması için bilgiler. Elle düzenleyebilirsiniz.';

export const removePlace = (profileContent: string | undefined, category: string): string => {
  const kept = (profileContent || '').split('\n').filter(line => {
    const m = line.match(/^\[yer:([^|\]]*)\|/i);
    return !(m && normalizeTr(m[1]) === normalizeTr(category));
  }).join('\n');
  return profileBase(kept) + '\n';
};

export const upsertPlace = (profileContent: string | undefined, place: SavedPlace): string => {
  const cat = fieldClean(place.category), name = fieldClean(place.name), addr = fieldClean(place.address);
  if (!cat || !name) return profileBase(profileContent) + '\n';
  return `${removePlace(profileContent, cat).trimEnd()}\n[yer:${cat}|${name}|${addr}]\n`;
};

export const matchSaved = (category: string, saved: SavedPlace[]): SavedPlace | undefined =>
  saved.find(p => sameCategory(p.category, category));

// ---- Seçenekli öneri ----
export interface PlaceOption {
  errand: number; // 1 tabanlı iş numarası
  category: string;
  name: string;
  address: string;
  distance: string; // "20 m", "1,2 km" ya da boş
  rating: string;   // "4,3" ya da boş
  hours: string;    // "09:00-19:00" ya da boş
  note: string;
  saved: boolean;   // kullanıcının kayıtlı yeri
}
export interface Stop { name: string; address: string; errandNumbers: number[]; why: string }
export interface ErrandPlan { options: PlaceOption[]; notes: string[]; raw: string }

export const buildErrandPrompt = (location: string, errands: Errand[], saved: SavedPlace[] = [], now: Date = new Date()): string => {
  const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  return `Sen kullanıcının günlük işlerini planlayan bir yardımcısın. Kullanıcı şu konumda: "${location}". Bugün ${days[now.getDay()]}.
Yapması gereken fiziksel işler:
${errands.map((e, i) => `${i + 1}. ${e.text}${e.hint ? ` (liste: ${e.hint})` : ''}`).join('\n')}
${saved.length ? `\nKullanıcının KENDİ tercih ettiği yerler (kategori: yer):\n${saved.map(p => `- ${p.category}: ${p.name}${p.address ? ` (${p.address})` : ''}`).join('\n')}\nBir iş bu kategorilerden birine uyuyorsa o yeri İLK seçenek olarak ver (kayıtlı: evet) ve yanına 1-2 alternatif ekle.\n` : ''}
Google aramasını kullanarak (Google Haritalar sayfalarına ve işletmenin kendi sitesine de bakarak) her iş için 2-4 gerçek yer SEÇENEĞİ bul. Amaç kullanıcıya seçtirmek.
İşleri iki türe ayır:
- GÜNLÜK işler (market, eczane, kuru temizleme, kargo, kırtasiye, genel hırdavat gibi her semtte bulunanlar): kullanıcının konumuna YAKIN yerleri seç, en yakından uzağa sırala.
- ÖZEL işler (deri, kumaş, boncuk, elektronik komponent, yedek parça, boya/malzeme, müzik aleti, toptan ürün gibi yalnızca belirli dükkânlarda ya da çarşılarda bulunanlar): yakınlık ikinci planda. Ürünün gerçekten satıldığı uzmanlaşmış dükkânı ya da semt/çarşıyı tüm şehirde ara (kullanıcının semti dışında olabilir); ürünü satmayan yakın genel mağazayı önerme. Kullanıcı işte bir semt belirttiyse ("Fatih'ten") önce orayı ara.
Aynı yer birden fazla işi karşılıyorsa o yeri ilgili her iş için ayrı SEÇENEK satırı olarak yaz (aynı ad ve adresle).
Yer, adres, puan ya da saat UYDURMA: bir bilgiyi bulamadıysan o alana tek karakter "-" yaz. Puanı Google Haritalar'da görünen biçimde yaz (örn. 4,3). Çalışma saatini bugüne göre yaz (örn. 09:00-19:00 ya da Kapalı). Uzaklığı YALNIZCA bir kaynakta (Haritalar sayfası, işletme sitesi) açıkça yazıyorsa yaz (örn. 20 m, 1,2 km); kendin hesaplama, tahmin etme, yoksa "-" yaz. Not alanı en fazla 8 kelime olsun; telefon numarası, kaynak/site adı ya da yorum özeti YAZMA.

Çıktıyı SADECE şu satır biçiminde ver, başka hiçbir metin, başlık ya da açıklama ekleme:
SEÇENEK | <iş numarası> | <kısa küçük harfli kategori, örn. kuru temizleme> | <yer adı> | <semt ve açık adres> | <uzaklık> | <puan> | <çalışma saati> | <tek kısa not> | <kayıtlı: evet ya da hayır>
Sonra gerekirse en fazla 2 satır:
NOT | <önemli bir uyarı (kapalı olma, stok, uzak olma gibi)>
Bir işe uygun yer bulamadıysan o iş için NOT satırında söyle.`;
};

// Telefon numaralarını ve "Tel:" ekini atar; çok uzun notları kısaltır (model bazen kaynak açıklaması sığdırıyor).
const tidy = (s: string, max: number) => {
  const t = (s || '').replace(/\b(?:tel|telefon)\s*[:.]?\s*[\d\s()+\-]{7,}/gi, '').replace(/\(?\b0?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, '').replace(/\s{2,}/g, ' ').replace(/[\s,;:-]+$/, '').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

const blankIfUnknown = (s: string) => {
  const t = (s || '').trim();
  return /^[-–—?]*$/.test(t) || /^(bilinmiyor|yok|belirtilmemiş|n\/a)$/i.test(t) ? '' : t;
};

export const parseErrandOptions = (text: string): ErrandPlan => {
  const options: PlaceOption[] = [];
  const notes: string[] = [];
  const clean = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\[\d+(?:,\s*\d+)*\]/g, '').trim();
  text.split('\n').forEach(rawLine => {
    const line = rawLine.replace(/^[\s*\-•\d.)]+(?=(SEÇENEK|SECENEK|NOT)\b)/i, '').trim();
    if (/^SE[ÇC]ENEK\s*\|/i.test(line)) {
      const p = line.split('|').map(x => clean(x));
      const [, no, category, name, address, distance, rating, hours, note, saved] = p;
      const errand = parseInt(no, 10);
      if (name && !isNaN(errand)) {
        options.push({
          errand, category: (category || '').toLocaleLowerCase('tr'), name, address: tidy(blankIfUnknown(address), 110),
          distance: blankIfUnknown(distance), rating: blankIfUnknown(rating), hours: blankIfUnknown(hours),
          note: tidy(blankIfUnknown(note), 70), saved: /^(evet|yes|true)/i.test((saved || '').trim())
        });
      }
    } else if (/^NOT\s*\|/i.test(line)) {
      const n = clean(line.replace(/^NOT\s*\|/i, ''));
      if (n) notes.push(n);
    }
  });
  return { options, notes, raw: text };
};

// İş başına en çok 4 seçenek; kullanıcının kayıtlı yeri model eklemeyi unutsa bile ilk seçenek olarak eklenir.
export const optionsByErrand = (plan: ErrandPlan, errands: Errand[], saved: SavedPlace[]): Map<number, PlaceOption[]> => {
  const map = new Map<number, PlaceOption[]>();
  plan.options.forEach(o => {
    if (o.errand < 1 || o.errand > errands.length) return;
    const arr = map.get(o.errand) || [];
    if (!arr.some(x => normalizeTr(x.name) === normalizeTr(o.name))) arr.push({ ...o }); // kopya: plan nesneleri değişmesin
    map.set(o.errand, arr);
  });
  map.forEach((arr, no) => {
    const cat = arr[0]?.category || '';
    const sp = cat ? matchSaved(cat, saved) : undefined;
    if (sp) {
      const at = arr.findIndex(o => normalizeTr(o.name) === normalizeTr(sp.name));
      if (at >= 0) { arr[at].saved = true; } else {
        arr.unshift({ errand: no, category: cat, name: sp.name, address: sp.address, distance: '', rating: '', hours: '', note: 'Kayıtlı yeriniz', saved: true });
      }
    }
    // Kayıtlı olan başa alınır (varsayılan seçim = 0. sıra).
    arr.sort((a, b) => Number(b.saved) - Number(a.saved));
    map.set(no, arr.slice(0, 4));
  });
  return map;
};

const distanceMeters = (d: string): number | null => {
  const m = d.replace(',', '.').match(/([\d.]+)\s*(km|m)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) ? null : (m[2].toLowerCase() === 'km' ? v * 1000 : v);
};

export const detailOf = (o: PlaceOption) => [o.distance, o.rating ? `${o.rating}★` : '', o.hours].filter(Boolean).join(' · ');

// Seçilen seçeneklerden duraklar: aynı yeri seçen işler tek durakta birleşir; mesafe bilgisi hepsinde varsa yakından uzağa sıralanır.
export const buildStops = (byErrand: Map<number, PlaceOption[]>, choice: Record<number, number>): Stop[] => {
  const stops = new Map<string, Stop & { meters: number | null }>();
  const order = Array.from(byErrand.keys()).sort((a, b) => a - b);
  order.forEach(no => {
    const opts = byErrand.get(no) || [];
    const o = opts[Math.min(choice[no] ?? 0, opts.length - 1)];
    if (!o) return;
    const key = `${normalizeTr(o.name)}|${normalizeTr(o.address)}`;
    const cur = stops.get(key);
    if (cur) { cur.errandNumbers.push(no); return; }
    stops.set(key, { name: o.name, address: o.address, errandNumbers: [no], why: detailOf(o), meters: distanceMeters(o.distance) });
  });
  const list = Array.from(stops.values());
  if (list.length > 1 && list.every(s => s.meters !== null)) list.sort((a, b) => a.meters! - b.meters!);
  return list.map(({ meters, ...s }) => s);
};

export const ROUTE_PAGE_PATH = 'Asistan/Rota.md';

// En son plan her seferinde bu sayfaya yazılır; kullanıcı rotayı yeniden hesaplatmadan açıp bakar.
export const routeMarkdown = (o: {
  now: Date; location: string; errands: Errand[]; byErrand: Map<number, PlaceOption[]>; choice: Record<number, number>; notes: string[];
}): string => {
  const { now, location, errands, byErrand, choice, notes } = o;
  const stops = buildStops(byErrand, choice);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let md = `# Rota planı\n\nGüncelleme: ${stamp} · Konum: ${location}\n\n`;
  if (stops.length) md += `[Tüm rotayı Haritalar'da aç](${mapsRouteUrl(stops, location)})\n\n## Duraklar\n`;
  stops.forEach((s, i) => {
    const jobs = s.errandNumbers.map(n => errands[n - 1]?.text).filter(Boolean).join(' · ');
    md += `${i + 1}. **${s.name}**${s.address ? ` — ${s.address}` : ''}${s.why ? ` (${s.why})` : ''} · [Harita](${mapsSearchUrl(s, location)})\n`;
    if (jobs) md += `   - İşler: ${jobs}\n`;
  });
  const alts: string[] = [];
  Array.from(byErrand.keys()).sort((a, b) => a - b).forEach(no => {
    const opts = byErrand.get(no) || [];
    const sel = Math.min(choice[no] ?? 0, opts.length - 1);
    const others = opts.filter((_, i) => i !== sel);
    if (others.length) alts.push(`- ${errands[no - 1]?.text || `İş ${no}`}: ${others.map(x => `${x.name}${detailOf(x) ? ` (${detailOf(x)})` : ''}`).join('; ')}`);
  });
  if (alts.length) md += `\n## Diğer seçenekler\n${alts.join('\n')}\n`;
  if (notes.length) md += `\n## Notlar\n${notes.map(n => `- ${n}`).join('\n')}\n`;
  md += `\n> Yer bilgileri web aramasından geldi ve hatalı olabilir; çalışma saatini ve stoku gitmeden doğrulayın.\n`;
  return md;
};

// Kategoriye göre kullanıcının çevresinde Haritalar araması (gerçek yakınlık, puan ve açık/kapalı bilgisini Haritalar kendisi gösterir).
export const mapsNearbyUrl = (category: string, location: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${category} ${location}`.trim())}`;

export const mapsSearchUrl = (s: Stop, location: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address || location}`.trim())}`;

// Tüm duraklar tek rota: son durak hedef, öncekiler ara nokta; çıkış noktası verilmediğinden Haritalar
// kullanıcının o anki konumunu başlangıç alır. Duraklar ad+adresle aranır (koordinat/anahtar gerekmez).
export const mapsRouteUrl = (stops: Stop[], location: string, mode: 'driving' | 'transit' | 'walking' | 'bicycling' = 'driving'): string => {
  const q = (s: Stop) => `${s.name} ${s.address || location}`.trim();
  if (stops.length === 0) return '';
  const dest = q(stops[stops.length - 1]);
  const way = stops.slice(0, -1).map(q).join('|');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}&travelmode=${mode}`;
};

export const generateErrandPlan = async (location: string, errands: Errand[], saved: SavedPlace[] = []): Promise<ErrandPlan> => {
  const text = await callGeminiGroundedText(buildErrandPrompt(location, errands, saved));
  return parseErrandOptions(text);
};

// Notlardaki tüm onay kutusu satırlarını (Asistan sayfası için) ErrandTaskInput biçimine çevirir; gizli klasörler atlanır.
export const tasksFromContents = (fileContents: Record<string, string>): ErrandTaskInput[] => {
  const out: ErrandTaskInput[] = [];
  Object.keys(fileContents).forEach(path => {
    if (!/\.md$/i.test(path) || path.split('/').some(seg => seg.startsWith('.'))) return;
    (fileContents[path] || '').split('\n').forEach(line => {
      const m = line.match(/^\s*[*\-]\s+\[([ xX\/])\]\s+(.*)$/);
      if (m) out.push({ content: m[2], isChecked: m[1].toLowerCase() === 'x', filePath: path });
    });
  });
  return out;
};
