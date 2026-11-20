// "Neye ihtiyacım var?": önceki haftaların alışveriş notlarına bakıp bu haftanın listesinde eksik kalmış olabilecekleri önerir.
// Yalnızca geçmiş listelerde geçenlerden öneri yapılır (uydurma yok); bu haftanın listesinde zaten olanlar kodda elenir.
import { callGemini, callGeminiGroundedText } from './geminiMentor';
import { redactSensitive } from './budget';
import type { ShopWeek } from './shopping';

export interface NeedSuggestion { text: string; kat: string; neden: string }
export interface Needs { ozet: string; oneriler: NeedSuggestion[] }

export const NEEDS_SCHEMA = {
  type: 'object',
  properties: {
    ozet: { type: 'string' },
    oneriler: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, kat: { type: 'string' }, neden: { type: 'string' } }, required: ['text', 'kat', 'neden'] } }
  },
  required: ['ozet', 'oneriler']
};

type Hist = { id: string; items: { kat: string; text: string; done: boolean }[] }[];

export const buildNeedsPrompt = (o: { week: ShopWeek; history: Hist; today: string }): string => {
  const hist = o.history.map(h => `${h.id}: ` + (h.items.map(i => `${i.kat}/${redactSensitive(i.text)}${i.done ? ' ✓' : ''}`).join('; ') || '(boş)')).join('\n') || '(geçmiş hafta yok)';
  const cur = o.week.items.map(i => `${i.kat}/${redactSensitive(i.text)}${i.done ? ' ✓' : ''}`).join('; ') || '(boş)';
  return `Sen kişisel alışveriş planına yardım eden sakin bir asistansın. Kullanıcı market, araç, ev, kişisel bakım, kuru temizleme gibi her türlü ihtiyacını haftalık listelere yazıyor. "✓" alındı demek.

BUGÜN: ${o.today}
ÖNCEKİ HAFTALARIN LİSTELERİ (yeniden eskiye):
${hist}

BU HAFTANIN LİSTESİ (${o.week.id}):
${cur}

GÖREV: Geçmiş listelerde tekrar eden ya da düzenli alınan, ama BU HAFTANIN listesinde olmayan ihtiyaçları öner (en çok 8). Kurallar:
- Yalnızca geçmiş listelerde geçen şeylerden öner; yeni ürün/marka uydurma.
- Bu haftanın listesinde zaten olan şeyi önerme.
- "kat": önceki listelerdeki kategori adını kullan (Market, Araç, Ev, Kişisel, Diğer ya da kullanıcının kendi kategorisi).
- "neden": kısa Türkçe (örn. "son 3 haftadır her hafta aldınız", "2 hafta önce aldınız, ayda bir gerekir").
- "ozet": 1-2 cümle. Öneri yoksa oneriler boş, ozet nedenini söylesin.
Sadece JSON döndür.`;
};

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü ]/gi, ' ').replace(/\s+/g, ' ').trim();

export const sanitizeNeeds = (raw: any, week: ShopWeek): Needs => {
  const have = week.items.map(i => norm(i.text));
  const seen = new Set<string>();
  const out: NeedSuggestion[] = [];
  for (const o of Array.isArray(raw?.oneriler) ? raw.oneriler : []) {
    const text = String(o?.text ?? '').replace(/[|\r\n]+/g, ' ').trim().slice(0, 80);
    const n = norm(text);
    if (!text || !n || seen.has(n)) continue;
    if (have.some(h => h === n || (n.length >= 4 && (h.includes(n) || n.includes(h))))) continue; // zaten listede
    seen.add(n);
    out.push({ text, kat: String(o?.kat ?? 'Diğer').replace(/[|\r\n]+/g, ' ').trim().slice(0, 30) || 'Diğer', neden: String(o?.neden ?? '').trim().slice(0, 160) });
    if (out.length >= 8) break;
  }
  return { ozet: String(raw?.ozet ?? '').trim().slice(0, 300), oneriler: out };
};

export const askNeeds = async (o: { week: ShopWeek; history: Hist; today?: string }, call: <T>(p: string, s: any) => Promise<T> = callGemini): Promise<Needs> => {
  const raw = await call<any>(buildNeedsPrompt({ ...o, today: o.today || new Date().toLocaleDateString('tr-TR') }), NEEDS_SCHEMA);
  return sanitizeNeeds(raw, o.week);
};

// ---------------- web aramalı fiyat araştırma (market dışı her şey + marketfiyati çalışmazsa yedek) ----------------
// Gerçek Google araması kullanılır ama sonuç TAHMİNDİR: sayfada görülmeyen fiyat uydurulmaz ("bulunamadı"), kaynak bağlantısı her satırda
// gösterilir, kullanıcı doğrular. Web sayfalarından gelen metin yalnızca düz metin olarak gösterilir; bağlantılar yalnızca https kabul edilir.
export interface Quote { yer: string; fiyat: string; kaynak?: string; not?: string }
export interface Research { quotes: Quote[]; ozet: string }

export const buildResearchPrompt = (item: string, kat: string, place?: string): string => `Google Arama aracını kullanarak "${redactSensitive(item).slice(0, 100)}" (kategori: ${kat.slice(0, 30)}) için ${place ? `"${place.slice(0, 60)}" çevresinde` : 'Türkiye\'de'} GÜNCEL fiyatı ve uygun satın alma/hizmet yerlerini araştır.

Çıktı kuralları (başka HİÇBİR şey yazma: açıklama, markdown, giriş cümlesi yok):
- En çok 5 satır; her satır TAM şu biçimde: YER | FİYAT | KAYNAK_URL | KISA NOT
- FİYAT: TL cinsinden (aralık olabilir, örn. "850-1.100 TL"). Fiyatı kaynak sayfada GÖRMEDİYSEN uydurma, "bulunamadı" yaz.
- KAYNAK_URL: fiyatı gördüğün gerçek sayfanın tam https adresi; yoksa "-".
- KISA NOT: en çok 12 kelime (örn. "4 lastik takım fiyatı", "kampanya 30 Kasım'a kadar").
- Son satır: ÖZET: <tek cümle: en uygun seçenek hangisi, neye dikkat edilmeli>`;

const safeUrl = (u: string): string | undefined => { try { const x = new URL(u.trim()); return x.protocol === 'https:' ? x.toString().slice(0, 300) : undefined; } catch { return undefined; } };

export const parseResearch = (text: string): Research => {
  const quotes: Quote[] = [];
  let ozet = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    const o = line.match(/^ÖZET:\s*(.+)$/i);
    if (o) { ozet = o[1].trim().slice(0, 300); continue; }
    const p = line.split('|').map(s => s.trim());
    if (p.length < 3 || !p[0] || !p[1]) continue;
    if (!/\d/.test(p[1]) && !/bulunamad/i.test(p[1])) continue; // fiyat sütunu değilse satır sayılmaz
    quotes.push({ yer: p[0].slice(0, 70), fiyat: p[1].slice(0, 40), kaynak: p[2] && p[2] !== '-' ? safeUrl(p[2]) : undefined, not: p[3] ? p[3].slice(0, 120) : undefined });
    if (quotes.length >= 5) break;
  }
  return { quotes, ozet };
};

export const researchPrice = async (item: string, kat: string, place?: string, call: (p: string) => Promise<string> = callGeminiGroundedText): Promise<Research> => {
  const r = parseResearch(await call(buildResearchPrompt(item, kat, place)));
  if (!r.quotes.length && !r.ozet) throw new Error('Araştırma sonuç döndürmedi; ürün adını daha açık yazıp tekrar deneyin.');
  return r;
};
