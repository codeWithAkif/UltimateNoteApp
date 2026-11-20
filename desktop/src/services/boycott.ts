// Boykot listesi: Alışveriş/Boykot Listesi.md. Liste KULLANICIYA aittir: yalnızca onayladığınız markalar yazılır (web araması aday getirir, siz karar verirsiniz).
// Kaynaklar birbiriyle çelişebildiği için her kayıt kaynak bağlantısı ve tarih taşır. Uygulama bu konuda yargı vermez; yalnızca sizin listenizi uygular.
import { fold } from './shopPrefs';
import type { MarketProduct } from './marketPrice';

export const BOYCOTT_PATH = 'Alışveriş/Boykot Listesi.md';

export interface BoycottEntry { marka: string; kaynak?: string; tarih?: string; not?: string; ayrica?: string[] }

const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const safeUrl = (u: string): string | undefined => { try { const x = new URL(u.trim()); return x.protocol === 'https:' ? x.toString().slice(0, 300) : undefined; } catch { return undefined; } };

// - Marka | kaynak:https://... | tarih:2026-11-20 | not:... | ayrıca:Alt Marka, Diğer
export const parseBoycott = (content: string | undefined): BoycottEntry[] => {
  const out: BoycottEntry[] = [];
  for (const raw of String(content || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const parts = m[1].split('|').map(s => s.trim());
    const marka = clean(parts[0] || '');
    if (!marka) continue;
    const e: BoycottEntry = { marka };
    for (const x of parts.slice(1)) {
      const kv = x.match(/^([a-zçğıöşü]+):\s*(.+)$/i);
      if (!kv) continue;
      const k = kv[1].toLowerCase();
      if (k === 'kaynak') e.kaynak = safeUrl(kv[2]);
      else if (k === 'tarih') e.tarih = kv[2].trim();
      else if (k === 'not') e.not = kv[2].trim().slice(0, 200);
      else if (k === 'ayrıca' || k === 'ayrica') e.ayrica = kv[2].split(',').map(s => clean(s)).filter(Boolean).slice(0, 10);
    }
    if (!out.some(o => fold(o.marka) === fold(marka))) out.push(e);
  }
  return out;
};

export const serializeBoycott = (list: BoycottEntry[]): string =>
  '# Boykot listesi\n\nBu liste size aittir; uygulama yalnızca onayladığınız markaları yazar. Kaynaklar birbiriyle çelişebilir: her satırdaki kaynak bağlantısını kontrol edin. ' +
  'Elle ekleyip silebilirsiniz.\n\n' +
  [...list].sort((a, z) => a.marka.localeCompare(z.marka, 'tr')).map(e => `- ${[clean(e.marka), e.kaynak ? `kaynak:${e.kaynak}` : '', e.tarih ? `tarih:${e.tarih}` : '', e.not ? `not:${clean(e.not)}` : '', e.ayrica?.length ? `ayrıca:${e.ayrica.map(clean).join(', ')}` : ''].filter(Boolean).join(' | ')}`).join('\n') + '\n';

export const addBoycott = (list: BoycottEntry[], e: BoycottEntry): BoycottEntry[] => {
  const marka = clean(e.marka);
  if (!marka || marka.length > 60) return list;
  if (list.some(x => fold(x.marka) === fold(marka))) return list;
  return [...list, { ...e, marka }];
};
export const removeBoycott = (list: BoycottEntry[], marka: string): BoycottEntry[] => list.filter(x => fold(x.marka) !== fold(marka));

// Ürün (marka alanı + başlık) listedeki bir markayla (ya da "ayrıca" adlarıyla) eşleşiyor mu? Sözcük sınırıyla: "Pınar" "Pınarbaşı"yı yakalamaz.
export const matchBoycott = (p: { brand?: string; title: string }, list: BoycottEntry[]): BoycottEntry | null => {
  if (!list.length) return null;
  const brand = ` ${fold(p.brand || '')} `;
  const title = ` ${fold(p.title).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const e of list) {
    for (const name of [e.marka, ...(e.ayrica || [])]) {
      const n = fold(name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!n) continue;
      if (brand.trim() === n || brand.includes(` ${n} `) || title.includes(` ${n} `)) return e;
    }
  }
  return null;
};

// Alternatifler: aynı aramanın sonuçlarından listedekileri çıkarır; önce tercih edilen markalar, sonra en ucuz
export const pickAlternatives = (products: MarketProduct[], list: BoycottEntry[], preferred: Set<string>, brandOf: (p: MarketProduct) => string, limit = 6): MarketProduct[] =>
  products.filter(p => !matchBoycott(p, list))
    .map((p, i) => ({ p, i, pref: preferred.has(fold(brandOf(p))) ? 1 : 0, price: p.offers[0]?.price ?? Infinity }))
    .sort((a, z) => z.pref - a.pref || a.price - z.price || a.i - z.i)
    .slice(0, limit).map(x => x.p);
