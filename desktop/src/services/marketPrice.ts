// Market fiyatları (marketfiyati.org.tr) istemcisi + "en uygun dağıt" hesabı.
// Masaüstü: istek ana süreçten gider (electron/marketApi.cjs). Telefon: CapacitorHttp. Veri resmi/belgeli bir API'den değil, sitenin arayüz uç noktalarından
// gelir; bozulabilir, bu yüzden her hata kullanıcıya açık mesajla döner ve hesaplama saf fonksiyonlarda tutulur (test edilir).
// Konum yalnızca yaklaşık (2 ondalık ≈ 1 km) saklanır ve gönderilir; tam adres hiçbir yere gitmez.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface MarketLoc { lat: number; lon: number; km: number }
export interface Offer { market: string; price: number; unit?: string; discount?: number; depot?: string; time?: string }
export interface MarketProduct { id: string; title: string; brand?: string; size?: string; offers: Offer[] }

export const MARKET_LABEL: Record<string, string> = {
  bim: 'BİM', a101: 'A101', sok: 'Şok', migros: 'Migros', carrefour: 'CarrefourSA', tarim_kredi: 'Tarım Kredi', hakmar: 'Hakmar', macro: 'Macrocenter'
};
export const marketLabel = (m: string): string => MARKET_LABEL[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : '?');

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- konum ayarı ----------------
const LOC_KEY = 'market_loc_v1';
export const roundCoord = (n: number): number => Math.round(n * 100) / 100;
export const loadLoc = (): MarketLoc | null => {
  try {
    const j = JSON.parse(localStorage.getItem(LOC_KEY) || 'null');
    if (j && Number.isFinite(j.lat) && Number.isFinite(j.lon)) return { lat: j.lat, lon: j.lon, km: Math.min(10, Math.max(1, Math.round(j.km) || 3)) };
  } catch { /* yoksay */ }
  return null;
};
export const saveLoc = (l: MarketLoc): MarketLoc => {
  const v = { lat: roundCoord(l.lat), lon: roundCoord(l.lon), km: Math.min(10, Math.max(1, Math.round(l.km) || 3)) };
  try { localStorage.setItem(LOC_KEY, JSON.stringify(v)); } catch { /* yoksay */ }
  return v;
};

// ---------------- ham yanıtı ayrıştırma (saf) ----------------
const numOf = (v: unknown): number | undefined => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };

// Aynı marketin birden çok şubesi olabilir: market başına en ucuz fiyat tutulur. Fiyatı geçersiz/sıfır olanlar atılır.
export const parseProducts = (raw: any): MarketProduct[] => {
  const out: MarketProduct[] = [];
  for (const p of Array.isArray(raw?.content) ? raw.content : []) {
    const id = String(p?.id ?? '').trim();
    const title = String(p?.title ?? '').trim();
    if (!id || !title) continue;
    const best = new Map<string, Offer>();
    for (const d of Array.isArray(p?.productDepotInfoList) ? p.productDepotInfoList : []) {
      const price = numOf(d?.price);
      const market = String(d?.marketAdi ?? '').trim().toLowerCase();
      if (price === undefined || price <= 0 || !market) continue;
      const cur = best.get(market);
      if (!cur || price < cur.price) best.set(market, { market, price: round2(price), unit: d?.unitPrice ? String(d.unitPrice) : undefined, discount: numOf(d?.percentage), depot: d?.depotName ? String(d.depotName) : undefined, time: d?.indexTime ? String(d.indexTime) : undefined });
    }
    const offers = [...best.values()].sort((a, z) => a.price - z.price);
    if (!offers.length) continue;
    out.push({ id, title, brand: p?.brand ? String(p.brand) : undefined, size: p?.refinedVolumeOrWeight ? String(p.refinedVolumeOrWeight) : (p?.refinedQuantityUnit ? String(p.refinedQuantityUnit) : undefined), offers });
  }
  return out;
};

// ---------------- ağ + önbellek ----------------
const CACHE_PREFIX = 'market_cache_v1_';
const TTL_MS = 12 * 3600 * 1000; // fiyatlar günde bir güncelleniyor; gereksiz istek atma
const cacheGet = <T,>(key: string): T | null => { try { const j = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null'); if (j && Date.now() - j.t < TTL_MS) return j.v as T; } catch { /* yoksay */ } return null; };
const cacheSet = (key: string, v: unknown) => { try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v })); } catch { /* yoksay */ } };

export const isMarketSupported = (): boolean => typeof window !== 'undefined' && (!!(window as any).electron?.marketSearch || Capacitor.isNativePlatform());

const BASE = 'https://api.marketfiyati.org.tr';
const nativePost = async (path: string, data: unknown): Promise<any> => {
  const r = await CapacitorHttp.post({ url: BASE + path, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, data, connectTimeout: 20000, readTimeout: 30000 });
  if (r.status !== 200) throw new Error(`Market fiyat servisi ${r.status} döndürdü.`);
  return r.data;
};

const callNearest = async (loc: MarketLoc): Promise<any> => {
  const e = (window as any).electron;
  if (e?.marketNearest) { const r = await e.marketNearest({ latitude: loc.lat, longitude: loc.lon, distance: loc.km }); if (!r.ok) throw new Error(r.error || 'Yakın marketler alınamadı.'); return r.data; }
  if (Capacitor.isNativePlatform()) return nativePost('/api/v2/nearest', { latitude: loc.lat, longitude: loc.lon, distance: loc.km });
  throw new Error('Market fiyatları yalnızca masaüstü ve telefon uygulamasında çalışır.');
};
const callSearch = async (loc: MarketLoc, keywords: string, depots: string[], size: number): Promise<any> => {
  const e = (window as any).electron;
  const req = { keywords, latitude: loc.lat, longitude: loc.lon, distance: loc.km, depots, size, pages: 0 };
  if (e?.marketSearch) { const r = await e.marketSearch(req); if (!r.ok) throw new Error(r.error || 'Ürün araması başarısız.'); return r.data; }
  if (Capacitor.isNativePlatform()) return nativePost('/api/v2/search', req);
  throw new Error('Market fiyatları yalnızca masaüstü ve telefon uygulamasında çalışır.');
};

export interface Depot { id: string; market: string; dist: number }
const locKey = (l: MarketLoc) => `${l.lat}_${l.lon}_${l.km}`;

export async function nearbyDepots(loc: MarketLoc): Promise<Depot[]> {
  const k = 'depots_' + locKey(loc);
  const c = cacheGet<Depot[]>(k);
  if (c) return c;
  const raw = await callNearest(loc);
  const list: Depot[] = (Array.isArray(raw) ? raw : []).map((d: any) => ({ id: String(d?.id ?? ''), market: String(d?.marketName ?? '').toLowerCase(), dist: numOf(d?.distance) ?? 0 })).filter(d => d.id);
  // Her zincirden en yakın birkaç şube yeterli (istek gövdesi küçük kalsın, fiyat farkı şubeler arasında zaten küçük)
  const per = new Map<string, number>();
  const picked = list.sort((a, z) => a.dist - z.dist).filter(d => { const n = (per.get(d.market) || 0) + 1; per.set(d.market, n); return n <= 4; });
  if (picked.length) cacheSet(k, picked);
  return picked;
}

export async function searchProducts(loc: MarketLoc, keywords: string, size = 12): Promise<MarketProduct[]> {
  const kw = keywords.trim();
  if (!kw) return [];
  const k = `s_${locKey(loc)}_${size}_${kw.toLocaleLowerCase('tr')}`;
  const c = cacheGet<MarketProduct[]>(k);
  if (c) return c;
  const depots = await nearbyDepots(loc);
  if (!depots.length) throw new Error('Bu konumda yakın market bulunamadı. Konumu ya da yarıçapı değiştirin.');
  const raw = await callSearch(loc, kw, depots.map(d => d.id), size);
  const list = parseProducts(raw);
  cacheSet(k, list);
  return list;
}

// Kaydedilmiş bir ürünün güncel fiyatları: başlığıyla arayıp aynı kimliği bulur (kimlikle doğrudan sorgu yok)
export async function refreshProduct(loc: MarketLoc, id: string, title: string): Promise<MarketProduct | null> {
  const list = await searchProducts(loc, title, 24);
  return list.find(p => p.id === id) || null;
}

// ---------------- en uygun dağıtım (saf) ----------------
export interface BasketItem { key: string; name: string; qty: number; offers: Offer[] }
export interface PlanLine { key: string; name: string; qty: number; price: number; total: number }
export interface PlanMarket { market: string; lines: PlanLine[]; total: number }
export interface BasketPlan {
  markets: PlanMarket[]; total: number; missing: string[];
  bestSingle: { market: string; total: number; missing: number } | null;
  saving: number; // en iyi tek marketten alışverişe göre kazanç (aynı ürünleri kapsıyorsa)
}

const combos = <T,>(arr: T[], k: number): T[][] => {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => { if (cur.length === k) { out.push([...cur]); return; } for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); } };
  rec(0, []);
  return out;
};

// Bir market kümesiyle sepet: her ürün kümedeki en ucuz yerden. Kümede hiç satılmayanlar "missing".
const evalSet = (items: BasketItem[], set: string[]): { markets: PlanMarket[]; total: number; missing: string[] } => {
  const by = new Map<string, PlanLine[]>();
  const missing: string[] = [];
  for (const it of items) {
    const o = it.offers.filter(x => set.includes(x.market)).sort((a, z) => a.price - z.price)[0];
    if (!o) { missing.push(it.name); continue; }
    const lines = by.get(o.market) || [];
    lines.push({ key: it.key, name: it.name, qty: it.qty, price: o.price, total: round2(o.price * it.qty) });
    by.set(o.market, lines);
  }
  const markets = [...by.entries()].map(([market, lines]) => ({ market, lines, total: round2(lines.reduce((s, l) => s + l.total, 0)) })).sort((a, z) => z.total - a.total);
  return { markets, total: round2(markets.reduce((s, m) => s + m.total, 0)), missing };
};

// maxMarkets: en çok kaç markete gidilsin. İkinci/üçüncü market, kazancı minGain TL'yi geçmiyorsa ya da hiç ürün eksikliği gidermiyorsa seçilmez
// (5 markete gitmek kimseye yaramaz; küçük tasarruf için ekstra yol yapılmaz).
export const planBasket = (items: BasketItem[], maxMarkets = 2, minGain = 20): BasketPlan => {
  const live = items.filter(i => i.qty > 0);
  const all = [...new Set(live.flatMap(i => i.offers.map(o => o.market)))];
  if (!live.length || !all.length) return { markets: [], total: 0, missing: live.map(i => i.name), bestSingle: null, saving: 0 };

  const singles = all.map(m => ({ m, ...evalSet(live, [m]) })).sort((a, z) => a.missing.length - z.missing.length || a.total - z.total);
  const bestSingle = singles[0];
  let best: { set: string[]; markets: PlanMarket[]; total: number; missing: string[] } = { set: [bestSingle.m], markets: bestSingle.markets, total: bestSingle.total, missing: bestSingle.missing };
  for (let k = 2; k <= Math.min(maxMarkets, all.length); k++) {
    let cand: { set: string[]; markets: PlanMarket[]; total: number; missing: string[] } | null = null;
    for (const set of combos(all, k)) {
      const r = evalSet(live, set);
      if (!cand || r.missing.length < cand.missing.length || (r.missing.length === cand.missing.length && r.total < cand.total)) cand = { set, ...r };
    }
    if (cand && (cand.missing.length < best.missing.length || (cand.missing.length === best.missing.length && best.total - cand.total >= minGain))) best = cand;
  }
  const plan = { markets: best.markets, total: best.total, missing: best.missing };
  const single = { market: bestSingle.m, total: bestSingle.total, missing: bestSingle.missing.length };
  const comparable = single.missing === plan.missing.length;
  return { ...plan, bestSingle: single, saving: comparable ? Math.max(0, round2(single.total - plan.total)) : 0 };
};
