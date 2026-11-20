// Tercih hafızası: Alışveriş/Tercihler.md. "Çamaşır deterjanı → Bingo (şu ürün)" gibi. Madde satırına (widget'ta görünen) hiçbir şey yazılmaz;
// ürün eşlemesi ve marka tercihi burada tutulur. Ürün seçtikçe kendiliğinden öğrenilir, elle de düzenlenebilir.
// Aynı not, maddenin öğrenilmiş kategorisini de tutar ("bebek suluğu → E-Bebek"): telefondan gelen madde otomatik doğru bölüme sıralanır.
import type { MarketProduct } from './marketPrice';

export const PREFS_PATH = 'Alışveriş/Tercihler.md';

export interface Pref { key: string; label: string; urun?: { id: string; title: string }; marka?: string; kat?: string; hedef?: number } // hedef: hedef fiyat (TL); ürün bu fiyatın altına inince haber verilir

const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
// Türkçe harflerden bağımsız anahtar (İ/I/ı → i, ç→c...): "Çamaşır" ile "camasir" aynı madde
export const fold = (s: string): string => String(s || '').replace(/[İIı]/g, 'i').toLowerCase().replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u');
const STOP = new Set(['al', 'alinacak', 'lazim', 'adet', 'tane', 'paket', 'kutu']);

// Madde metni → karşılaştırma anahtarı: adet soneki, etiket, noktalama atılır
export const prefKey = (text: string): string =>
  fold(text).replace(/\[[^\]]*\]/g, ' ').trim().replace(/\s+[x×]\s?\d{1,2}$/, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).join(' ');

const tokens = (k: string): string[] => k.split(' ').filter(Boolean);

// - çamaşır deterjanı | ürün:ID | başlık:Bingo ... | marka:Bingo | kat:Ev
export const parsePrefs = (content: string | undefined): Pref[] => {
  const out: Pref[] = [];
  for (const raw of String(content || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const parts = m[1].split('|').map(s => s.trim());
    const label = parts[0];
    const key = prefKey(label);
    if (!label || !key) continue;
    const p: Pref = { key, label };
    let id = '', title = '';
    for (const x of parts.slice(1)) {
      const kv = x.match(/^([a-zçğıöşü]+):\s*(.+)$/i);
      if (!kv) continue;
      const k = kv[1].toLowerCase();
      if (k === 'ürün' || k === 'urun') id = kv[2].trim();
      else if (k === 'başlık' || k === 'baslik') title = kv[2].trim();
      else if (k === 'marka') p.marka = kv[2].trim();
      else if (k === 'kat') p.kat = kv[2].trim();
      else if (k === 'hedef') { const v = Number(kv[2].replace(',', '.')); if (Number.isFinite(v) && v > 0 && v < 1e7) p.hedef = Math.round(v * 100) / 100; }
    }
    if (id) p.urun = { id, title: title || label };
    out.push(p);
  }
  return out;
};

export const serializePrefs = (prefs: Pref[]): string =>
  '# Alışveriş tercihleri\n\nHer satır: madde | ürün:ID | başlık | marka | kat. Ürün seçtikçe uygulama öğrenir; elle düzenleyebilir ya da silebilirsiniz.\n\n' +
  prefs.map(p => `- ${[clean(p.label), p.urun ? `ürün:${clean(p.urun.id)}` : '', p.urun ? `başlık:${clean(p.urun.title)}` : '', p.marka ? `marka:${clean(p.marka)}` : '', p.kat ? `kat:${clean(p.kat)}` : '', p.hedef ? `hedef:${p.hedef}` : ''].filter(Boolean).join(' | ')}`).join('\n') + '\n';

// En uygun tercihi bulur: önce tam anahtar, sonra bir tarafın sözcükleri diğerinin içindeyse (en çok ortak sözcük, sonra en uzun anahtar).
// Örn. "Bingo çamaşır deterjanı" yazılmışsa ve tercih "çamaşır deterjanı → Bingo" ise ya da tersi.
export const findPref = (prefs: Pref[], text: string): Pref | null => {
  const key = prefKey(text);
  if (!key) return null;
  const exact = prefs.find(p => p.key === key);
  if (exact) return exact;
  const tk = tokens(key);
  let best: Pref | null = null, bestScore = 0;
  for (const p of prefs) {
    const pk = tokens(p.key);
    if (!pk.length) continue;
    const common = pk.filter(w => tk.includes(w)).length;
    const contained = common === pk.length || common === tk.length; // biri diğerinin altkümesi
    if (!contained || common < 1) continue;
    const score = common * 10 + pk.length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
};

export const brandOf = (p: { brand?: string; title: string }): string => clean(p.brand || '') || clean(p.title).split(' ')[0] || '';

// Tercihi yazar/günceller. Maddede marka adı geçiyorsa ("Bingo çamaşır deterjanı") markasız tür anahtarı da öğrenilir ("çamaşır deterjanı"),
// böylece telefondan markasız yazılan madde de aynı markaya bağlanır.
export const learnPref = (prefs: Pref[], text: string, p: { urun?: { id: string; title: string }; marka?: string; kat?: string; hedef?: number }): Pref[] => {
  const key = prefKey(text);
  if (!key) return prefs;
  const set = (list: Pref[], k: string, label: string): Pref[] => {
    const i = list.findIndex(x => x.key === k);
    const next: Pref = { key: k, label, urun: p.urun ?? (i >= 0 ? list[i].urun : undefined), marka: p.marka ?? (i >= 0 ? list[i].marka : undefined), kat: p.kat ?? (i >= 0 ? list[i].kat : undefined), hedef: p.hedef ?? (i >= 0 ? list[i].hedef : undefined) };
    return i >= 0 ? list.map((x, j) => (j === i ? next : x)) : [...list, next];
  };
  let out = set(prefs, key, clean(text).replace(/\s+[x×]\s?\d{1,2}$/i, ''));
  const brand = p.marka ? fold(p.marka) : '';
  if (brand) {
    const typeKey = tokens(key).filter(w => !brand.split(' ').includes(w)).join(' ');
    if (typeKey && typeKey !== key && tokens(typeKey).length >= 2) {
      const label = clean(text).split(/\s+/).filter(w => !brand.split(' ').includes(fold(w))).join(' ');
      out = set(out, typeKey, label);
    }
  }
  return out;
};

// Hedef fiyat: tercih satırına yazılır; 0/boş hedefi kaldırır
export const setHedef = (prefs: Pref[], key: string, hedef: number | null): Pref[] =>
  prefs.map(p => (p.key === key ? { ...p, hedef: hedef && hedef > 0 ? Math.round(hedef * 100) / 100 : undefined } : p));

export interface TargetHit { pref: Pref; product: MarketProduct; market: string; price: number; hedef: number }
// Hedef fiyata ulaşıldı mı: ürünün en ucuz teklifi hedefin altında ya da eşitse. skip: ör. boykot listesindeki ürünler atlanır
export const targetHits = (prefs: Pref[], products: MarketProduct[], skip?: (p: MarketProduct) => boolean): TargetHit[] => {
  const byId = new Map(products.map(p => [p.id, p]));
  const out: TargetHit[] = [];
  for (const pref of prefs) {
    if (!pref.hedef || !pref.urun) continue;
    const p = byId.get(pref.urun.id);
    if (!p || !p.offers.length || (skip && skip(p))) continue;
    const best = p.offers[0];
    if (best.price <= pref.hedef) out.push({ pref, product: p, market: best.market, price: best.price, hedef: pref.hedef });
  }
  return out;
};

export const removePref = (prefs: Pref[], key: string): Pref[] => prefs.filter(p => p.key !== key);

// Marka tercihleri kümesi (tüm tercihlerin markaları)
export const preferredBrands = (prefs: Pref[]): Set<string> => new Set(prefs.map(p => fold(p.marka || '')).filter(Boolean));

// Ürün seçici sıralaması: tam tercih edilen ürün → tercih edilen marka → geri kalanlar (özgün sıra korunur)
export const rankProducts = (products: MarketProduct[], prefs: Pref[], text: string): MarketProduct[] => {
  const pref = findPref(prefs, text);
  const brands = preferredBrands(prefs);
  if (pref?.marka) brands.add(fold(pref.marka));
  const score = (p: MarketProduct) => (pref?.urun && p.id === pref.urun.id ? 2 : brands.has(fold(brandOf(p))) ? 1 : 0);
  return products.map((p, i) => ({ p, i, s: score(p) })).sort((a, z) => z.s - a.s || a.i - z.i).map(x => x.p);
};

// Eski notlardaki "Sıvı bulaşık deterjanı - Bingo" gibi satırlardan marka tercihi ADAYLARI (onay gerekir, kendiliğinden yazılmaz)
export const legacySuggestions = (contents: string[]): { label: string; marka: string }[] => {
  const out: { label: string; marka: string }[] = [];
  const re = /^\s*[-*]\s*\[[ xX]\]\s*(.+?)\s+[-–]\s+(\p{Lu}[\p{L}]{2,})\s*$/u;
  for (const c of contents) for (const line of c.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const label = clean(m[1]); const marka = m[2];
    if (label.split(' ').length > 6) continue;
    if (!out.some(o => prefKey(o.label) === prefKey(label))) out.push({ label, marka });
  }
  return out;
};
