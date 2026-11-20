// Fiyat geçmişi: Alışveriş/Fiyat Geçmişi.md. Her ürün için günde en çok bir kayıt (o gün en ucuz fiyat + market başına fiyatlar).
// Amaç: "bu ürün geçen aya göre ucuzladı mı / 30 günün en düşüğü mü" gibi eğilimleri göstermek. Elle okunur/düzenlenir düz not.
import type { MarketProduct } from './marketPrice';

export const HISTORY_PATH = 'Alışveriş/Fiyat Geçmişi.md';
const MAX_RECS = 800;           // not şişmesin: en eski kayıtlar atılır
const KEEP_DAYS = 120;

export interface PriceRec { date: string; id: string; title: string; prices: Record<string, number> }

const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string) => s.replace(/[|;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
export const dayOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNum = (s: string): number => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN; };

export const cheapest = (r: PriceRec): number => { const v = Object.values(r.prices); return v.length ? Math.min(...v) : NaN; };

// - 2026-11-20 | <id> | <başlık> | bim:28.5; migros:28.25
export const parseHistory = (content: string | undefined): PriceRec[] => {
  const out: PriceRec[] = [];
  for (const raw of String(content || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^[-*]\s+(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(.+)$/);
    if (!m) continue;
    const prices: Record<string, number> = {};
    for (const part of m[4].split(';')) {
      const kv = part.trim().match(/^([\w.-]+):\s*([\d.,]+)$/);
      const v = kv ? Number(kv[2].replace(',', '.')) : NaN;
      if (kv && Number.isFinite(v) && v > 0) prices[kv[1].toLowerCase()] = round2(v);
    }
    if (Object.keys(prices).length) out.push({ date: m[1], id: m[2], title: m[3], prices });
  }
  return out;
};

export const serializeHistory = (recs: PriceRec[]): string => {
  const sorted = [...recs].sort((a, z) => a.date.localeCompare(z.date) || a.id.localeCompare(z.id)).slice(-MAX_RECS);
  return '# Fiyat geçmişi\n\nMarket fiyatları (marketfiyati.org.tr), her ürün için günde bir kayıt. Uygulama yazar; elle silebilirsiniz.\n\n' +
    sorted.map(r => `- ${r.date} | ${clean(r.id)} | ${clean(r.title)} | ${Object.entries(r.prices).map(([m, p]) => `${m}:${p}`).join('; ')}`).join('\n') + '\n';
};

// Aynı gün+ürün kaydı değişir (yenilenen fiyat). Çok eski kayıtlar atılır.
export const addRecords = (recs: PriceRec[], date: string, products: MarketProduct[]): PriceRec[] => {
  const today = dayNum(date);
  const keep = recs.filter(r => !(r.date === date && products.some(p => p.id === r.id)) && (!Number.isFinite(today) || today - dayNum(r.date) <= KEEP_DAYS));
  const fresh: PriceRec[] = [];
  for (const p of products) {
    const prices: Record<string, number> = {};
    for (const o of p.offers) if (o.price > 0) prices[o.market] = round2(o.price);
    if (Object.keys(prices).length) fresh.push({ date, id: p.id, title: p.title, prices });
  }
  return [...keep, ...fresh];
};

export interface Trend { now: number; prev?: number; prevDate?: string; pct?: number; min30?: number; lowest: boolean; samples: number }

// Eğilim: bugünün en ucuz fiyatı, en az 5 gün önceki (en çok 45 gün) son kayıtla ve son 30 günün en düşüğüyle kıyaslanır
export const trendOf = (recs: PriceRec[], id: string, nowPrice: number, today: string): Trend => {
  const t = dayNum(today);
  const mine = recs.filter(r => r.id === id && r.date < today).sort((a, z) => z.date.localeCompare(a.date));
  const old = mine.find(r => t - dayNum(r.date) >= 5 && t - dayNum(r.date) <= 45);
  const last30 = mine.filter(r => t - dayNum(r.date) <= 30).map(cheapest).filter(Number.isFinite);
  const min30 = last30.length ? Math.min(...last30) : undefined;
  const prev = old ? cheapest(old) : undefined;
  return {
    now: nowPrice, prev, prevDate: old?.date, samples: mine.length,
    pct: prev && prev > 0 ? Math.round((nowPrice - prev) / prev * 1000) / 10 : undefined,
    min30, lowest: min30 !== undefined && last30.length >= 3 && nowPrice <= min30
  };
};

// ---- indirim radarı (saf)
export interface RadarHit { product: MarketProduct; market: string; price: number; discount: number }
// API her teklif için indirim yüzdesi verir; minPct üstündekiler en yüksek indirimden başlayarak listelenir
export const discountHits = (products: MarketProduct[], minPct = 5): RadarHit[] => {
  const out: RadarHit[] = [];
  for (const p of products) {
    const best = p.offers.filter(o => (o.discount ?? 0) >= minPct).sort((a, z) => (z.discount ?? 0) - (a.discount ?? 0))[0];
    if (best) out.push({ product: p, market: best.market, price: best.price, discount: Math.round((best.discount ?? 0) * 10) / 10 });
  }
  return out.sort((a, z) => z.discount - a.discount);
};
