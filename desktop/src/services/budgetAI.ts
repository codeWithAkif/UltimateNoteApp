// Bütçe Planı'nın yapay zekâ katmanı: sohbetten kalem çıkarma ve tasarruf önerisi. Sağlayıcı zinciri ortaktır (Gemini -> masaüstünde Claude Code, bkz. geminiMentor.callGemini).
// Rakamları yapay zekâ HESAPLAMAZ: toplamlar, kalan, nakit takvimi ve kartsız geçiş süreleri budget.ts'ten gelir ve isteme hazır olarak verilir.
// Yapay zekânın önerdiği her kalem kullanıcıya onay kartı olarak gösterilir; onaylanmadan hiçbir şey yazılmaz.
// Gizlilik: mesajlardaki uzun rakam dizileri (kart no, IBAN, TC kimlik) gönderilmeden gizlenir.

import { callGemini } from './geminiMentor';
import {
  type Budget, type AIAction, type BudgetKind, KIND_LABEL, totals, cashflow, transition, fmtTL, redactSensitive, round2, parseTL
} from './budget';

export const PERSONA_PATH = 'Sistem/Finans Uzmanı.md';

// Kullanıcı bu notu istediği gibi düzenleyebilir; bütçe sohbetinin her isteminin başına eklenir (bir "skill" gibi).
export const DEFAULT_PERSONA = `# Finans Uzmanı

Bu not, Bütçe Planı sohbetindeki yapay zekâya verilen kişiliktir. İstediğiniz gibi düzenleyebilirsiniz.

Sen kişisel bütçe ve nakit akışı konusunda deneyimli, sakin ve net konuşan bir finans uzmanısın. Lisanslı bir yatırım danışmanı değilsin: yatırım, kredi ya da finansal ürün tavsiyesi verme; bütçe disiplini, harcama kısma ve düzenli birikim konusunda yardım et.

Kullanıcının durumu:
- Aylık gelirini ve sabit giderlerini (fatura, aidat, çocuğun okul masrafı, kira, taksit) söyler. Sabit giderler kısılamaz; asla "şunu kıs" diye sabit gider önerme.
- Kredi kartı ekstrelerini her ay TAM öder (faiz ödemez). Amacı kartlardan kurtulmak (kartsız yaşama geçmek) ve düzenli para biriktirmektir.
- Kısılabilecek tek yer değişken harcamalardır (market, yemek, eğlence, giyim, ulaşım vb.).

Çalışma kuralların:
- Rakam uydurma. Yalnızca kullanıcının söylediğini kalem olarak öner. Tutar, tür ya da gün belirsizse cevapta kısaca sor; emin olmadığın alanı tahmin etme.
- Toplam, kalan ya da süre hesaplama; bunları uygulama hesaplar. Cevabında verilen rakamları kullan, kendin yeni toplam yazma.
- Bir kalemi düzeltirse güncelle. Silmeyi yalnızca açıkça isterse öner.
- Kısa, sıcak ve yargılamayan Türkçe konuş (en çok 4-5 cümle).`;

const TYPE_HELP = `Tür eşlemesi:
- gelir: maaş, prim, ek iş, kira geliri, diğer gelirler
- sabit: kira, fatura (elektrik, su, doğalgaz, internet, telefon), aidat, okul/kreş/servis, sigorta, abonelik, kredi taksiti (kart dışı), diğer değişmeyen giderler
- kart: kredi kartı ekstresi/borcu (ad olarak banka/kart adı yaz; taksitli kısmı söylenirse taksitliTutar)
- degisken: market, yemek, ulaşım, eğlence, giyim, sağlık gibi ay içinde değişen harcamalar; YALNIZCA karta yazılmayan (nakit/banka kartı/havale) olanlar

NAKİT ESASLI MANTIK (çift saymayı önler): Bütçedeki her kalem o ay hesaptan çıkan/giren paradır. Kart ekstresi, ÖDENDİĞİ aya girilir (örn. Ekim harcamalarının ekstresi Kasım başında maaşla ödenir → Kasım bütçesine yazılır). Kullanıcı "kartla şunu aldım/harcadım" derse bunu değişken harcama olarak EKLEME: o harcama ekstre gelince ödeme ayına kart kalemi olarak girilecek; cevapta bunu kısaca söyle ve eylem üretme.`;

export interface ChatMsg { role: 'user' | 'ai'; text: string }
export interface ChatResult { cevap: string; senaryo: boolean; eylemler: AIAction[]; ekstreAy?: string }

// Ekstrenin son ödeme ayı "YYYY-AA" olmalı ve bugünden makul uzaklıkta (±8 ay) olmalı; saçma bir ayı sessizce yok sayarız
export const validMonth = (v: unknown, now: Date = new Date()): string | undefined => {
  const s = String(v ?? '').trim();
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (!m) return undefined;
  const diff = (Number(m[1]) - now.getFullYear()) * 12 + (Number(m[2]) - 1 - now.getMonth());
  return Math.abs(diff) <= 8 ? s : undefined;
};

const ACTION_PROPS = {
  op: { type: 'string' }, kind: { type: 'string' }, id: { type: 'string' }, ad: { type: 'string' }, tutar: { type: 'number' }, gun: { type: 'integer' },
  taksitKalan: { type: 'integer' }, taksitToplam: { type: 'integer' }, taksitliTutar: { type: 'number' }, neden: { type: 'string' }
};
export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    cevap: { type: 'string' },
    senaryo: { type: 'boolean' },
    ekstreAy: { type: 'string' },
    eylemler: { type: 'array', items: { type: 'object', properties: ACTION_PROPS, required: ['op', 'ad', 'tutar'] } }
  },
  required: ['cevap', 'senaryo', 'eylemler']
};

export const budgetFacts = (b: Budget): string => {
  if (b.items.length === 0) return '(henüz hiç kalem yok)';
  const lines = b.items.map(i => `- [${i.id}] ${KIND_LABEL[i.kind]} · ${i.name} · ${round2(i.amount)} TL${i.day ? ` · gün ${i.day}` : ''}${i.taksit ? ` · taksit ${i.taksit.left}/${i.taksit.total}` : ''}${i.taksitAmount ? ` · taksitli kısım ${i.taksitAmount} TL` : ''}`);
  return lines.join('\n') + `\nBeklenmeyenler payı: %${b.reservePct}`;
};

export interface StatementIn { name: string; text: string }

// Ekstre metni: yapay zekâya yalnızca özet çıkarma görevi verilir; tek tek alışverişler değişken harcama olarak EKLENMEZ (kart tutarı zaten ekstrenin toplamıdır)
export const statementBlock = (s?: StatementIn, month?: string): string => s ? `\nEKLİ KART EKSTRESİ (${redactSensitive(s.name).slice(0, 80)}) — bilgisayarda metne çevrildi, kimlik numaraları gizlendi:\n"""\n${redactSensitive(s.text).slice(0, 14000)}\n"""\nEKSTRE GÖREVİ: Bu ekstreden TEK bir kart kalemi çıkar: kind=kart, ad=banka/kart adı (örn. "Garanti Bonus"), tutar=bu dönemin ÖDENECEK TOPLAM borcu (asgari ödeme DEĞİL; toplam dönem borcu/ekstre borcu), gun=son ödeme tarihinin günü. Ekstrede taksitli işlemler varsa taksitliTutar = bu ekstreye yansıyan taksitlerin toplamı. Tek tek alışverişleri ekleme. Rakamları kendin topla/doğrula; tutarı belirleyemiyorsan eylem ekleme, cevapta nedenini söyle. Listede aynı kart zaten varsa guncelle kullan. "ekstreAy" alanına ekstrenin SON ÖDEME TARİHİNİN ayını YYYY-AA biçiminde yaz (örn. son ödeme 9 Kasım 2026 ise "2026-11"); ödeme ayı odur, kesim ayı değil.${month ? ` Seçili bütçe ayı ${month}; ekstre başka aya aitse uygulama kartı o aya taşır, sen cevapta yalnızca "bu ekstre X ayına ait" de.` : ''} Son ödeme tarihi bugünden (${new Date().toLocaleDateString('tr-TR')}) önceyse yalnızca "ödediyseniz sorun yok" demen yeterli; kullanıcı ekstreleri tam öder, gecikme faizi uyarısı yapma.\n` : '';

export const buildChatPrompt = (o: { persona: string; budget: Budget; history: ChatMsg[]; message: string; statement?: StatementIn }): string => {
  const hist = o.history.slice(-8).map(m => `${m.role === 'user' ? 'Kullanıcı' : 'Uzman'}: ${redactSensitive(m.text).slice(0, 500)}`).join('\n');
  return `${o.persona.slice(0, 6000)}

${TYPE_HELP}

BU AYIN BÜTÇESİ (${o.budget.month}) — kalem kimlikleriyle (güncelle/sil için bu kimlikleri kullan):
${budgetFacts(o.budget)}

${hist ? `SOHBET GEÇMİŞİ:\n${hist}\n\n` : ''}${statementBlock(o.statement, o.budget.month)}KULLANICININ SON MESAJI:
${redactSensitive(o.message).slice(0, 2000)}

GÖREV: Mesajdaki bütçe bilgilerini "eylemler" olarak çıkar (op: ekle | guncelle | sil). Her ekle için JSON alanları tam olarak şunlar olmalı: "kind" (gelir/sabit/kart/degisken), "ad" (kalemin kısa adı, örn. "Maaş", "Kira", "Elektrik", "Okul servisi"; ASLA boş bırakma), "tutar" (sayı, TL); ayrıca gün ve taksit yalnızca kullanıcı söylediyse. Zaten listede olan bir kalemi yeniden ekleme, guncelle kullan.
Kullanıcı "ya ... olsa" gibi bir varsayım soruyorsa senaryo=true yap; eylemler o varsayımın uygulanmış hâlidir (gerçek kayıt değil).
Mesajda bütçe bilgisi yoksa eylemler boş olsun, cevapta soruya yanıt ver ya da bir sonraki adımı sor.
"cevap": kısa Türkçe yanıt. Sadece JSON döndür.`;
};

const KIND_ALIAS: Record<string, BudgetKind> = {
  gelir: 'gelir', sabit: 'sabit', kart: 'kart', degisken: 'degisken', 'değişken': 'degisken', 'sabit gider': 'sabit', 'kredi kartı': 'kart', 'kredi karti': 'kart'
};
const toNum = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim()) { const n = parseTL(v); return n === null ? undefined : n; }
  return undefined;
};
const toInt = (v: unknown): number | undefined => { const n = toNum(v); return n === undefined ? undefined : Math.round(n); };

// Model alan adını şemadan sapıp farklı yazabiliyor (isim/name/kalem...); "ad" boş kalırsa kart hiç uygulanamıyordu
const pickName = (a: any): string | undefined => {
  for (const k of ['ad', 'isim', 'name', 'kalem', 'baslik', 'başlık', 'aciklama', 'açıklama']) {
    const v = a?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60);
  }
  return undefined;
};

// Cevabı güvenli bir biçime getirir (sağlayıcı sayıları metin ya da tür adını farklı yazmış olabilir)
export const normalizeChat = (raw: any): ChatResult => {
  const acts: AIAction[] = [];
  for (const a of Array.isArray(raw?.eylemler) ? raw.eylemler : []) {
    if (!a || typeof a !== 'object') continue;
    const op = String(a.op || '').toLowerCase().replace('güncelle', 'guncelle');
    const kind = a.kind ? KIND_ALIAS[String(a.kind).toLowerCase().trim()] : undefined;
    acts.push({
      op: op as AIAction['op'], kind, id: a.id ? String(a.id) : undefined, ad: pickName(a),
      tutar: toNum(a.tutar ?? a.miktar ?? a.amount), gun: toInt(a.gun) || undefined, taksitKalan: toInt(a.taksitKalan) || undefined, taksitToplam: toInt(a.taksitToplam) || undefined,
      taksitliTutar: toNum(a.taksitliTutar), neden: a.neden ? String(a.neden).slice(0, 200) : undefined
    });
  }
  return { cevap: String(raw?.cevap ?? '').trim() || 'Anladım.', senaryo: raw?.senaryo === true, eylemler: acts, ekstreAy: validMonth(raw?.ekstreAy) };
};

export type AICall = <T>(prompt: string, schema: any) => Promise<T>;

export const askBudget = async (o: { persona: string; budget: Budget; history: ChatMsg[]; message: string; statement?: StatementIn }, call: AICall = callGemini): Promise<ChatResult> => {
  const raw = await call<any>(buildChatPrompt(o), CHAT_SCHEMA);
  return normalizeChat(raw);
};

// ---------------- öneriler ----------------
export interface AdviceItem { baslik: string; aciklama: string; kalem: string; aylikTasarruf: number }
export interface Advice { ozet: string; oneriler: AdviceItem[]; kenaraAtma: { aylik: number; aciklama: string }; uyarilar: string[] }

export const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    ozet: { type: 'string' },
    oneriler: { type: 'array', items: { type: 'object', properties: { baslik: { type: 'string' }, aciklama: { type: 'string' }, kalem: { type: 'string' }, aylikTasarruf: { type: 'number' } }, required: ['baslik', 'aciklama', 'kalem', 'aylikTasarruf'] } },
    kenaraAtma: { type: 'object', properties: { aylik: { type: 'number' }, aciklama: { type: 'string' } }, required: ['aylik', 'aciklama'] },
    uyarilar: { type: 'array', items: { type: 'string' } }
  },
  required: ['ozet', 'oneriler', 'kenaraAtma', 'uyarilar']
};

export const buildAdvicePrompt = (o: { persona: string; budget: Budget }): string => {
  const t = totals(o.budget);
  const cf = cashflow(o.budget);
  const tr = transition(o.budget);
  const deg = o.budget.items.filter(i => i.kind === 'degisken').map(i => `${i.name} (${round2(i.amount)} TL)`).join(', ') || '(yok)';
  return `${o.persona.slice(0, 6000)}

BU AYIN BÜTÇESİ (${o.budget.month}) — uygulamanın hesapladığı gerçek rakamlar (bunları aynen kullan, yeniden hesaplama):
${budgetFacts(o.budget)}

TOPLAMLAR: gelir ${fmtTL(t.gelir)}, sabit giderler ${fmtTL(t.sabit)}, kart ekstreleri ${fmtTL(t.kart)}, değişken harcamalar ${fmtTL(t.degisken)}, beklenmeyenler payı ${fmtTL(t.reserve)}, KALAN ${fmtTL(t.kalan)}.
NAKİT TAKVİMİ: ay içindeki en düşük bakiye ${fmtTL(cf.min.balance)} (ayın ${cf.min.day}. günü); eksi bakiyeli gün sayısı ${cf.negativeDays.length}.
KARTSIZ GEÇİŞ (mevcut kalanla): kartlarda kaydırılabilir tutar ${fmtTL(tr.shiftable)}; ${tr.bitis === null ? `geçiş mümkün değil (${tr.neden || 'kalan yetmiyor'})` : tr.bitis === 0 ? 'kaydırılacak tutar yok' : `${tr.bitis} ayda kartsıza geçilebilir`}.
KISILABİLECEK DEĞİŞKEN KALEMLER: ${deg}

GÖREV (Türkçe, kısa):
1. "ozet": durumu 3-4 cümleyle özetle (iyi giden ne, dikkat edilecek ne).
2. "oneriler": en çok 5 öneri. Yalnızca yukarıdaki DEĞİŞKEN kalemlerden; "kalem" alanına kalem adını BİREBİR yaz; "aylikTasarruf" gerçekçi bir aylık tutar olsun (kalemin yarısını geçmesin). Sabit giderleri, taksitleri ve kartları kısmayı ÖNERME.
3. "kenaraAtma": her ay kenara ayrılabilecek gerçekçi bir tutar ve kademeli artış fikri (açıklama 1-2 cümle). Tutarı kalan ve önerdiğin tasarruflara göre ver.
4. "uyarilar": en çok 3 kısa uyarı (örn. maaş günü ile ödeme günleri arasındaki boşluk, günü yazılmayan kalemler). Uyarı yoksa boş dizi.
Yatırım, kredi ya da ürün tavsiyesi verme. Sadece JSON döndür.`;
};

// Öneriler uygulamanın kurallarına göre temizlenir: yalnızca değişken kalemlere bağlı, makul tutarlı
export const sanitizeAdvice = (raw: any, b: Budget): Advice => {
  const deg = b.items.filter(i => i.kind === 'degisken');
  const oneriler: AdviceItem[] = [];
  for (const o of Array.isArray(raw?.oneriler) ? raw.oneriler : []) {
    const name = String(o?.kalem ?? '').trim().toLocaleLowerCase('tr');
    const item = deg.find(i => i.name.toLocaleLowerCase('tr') === name);
    const save = toNum(o?.aylikTasarruf);
    if (!item || save === undefined || save <= 0) continue;
    oneriler.push({ baslik: String(o.baslik || item.name).slice(0, 80), aciklama: String(o.aciklama || '').slice(0, 400), kalem: item.name, aylikTasarruf: round2(Math.min(save, item.amount * 0.6)) });
    if (oneriler.length >= 5) break;
  }
  const ka = toNum(raw?.kenaraAtma?.aylik);
  return {
    ozet: String(raw?.ozet ?? '').slice(0, 800),
    oneriler,
    kenaraAtma: { aylik: ka !== undefined && ka > 0 ? round2(Math.min(ka, Math.max(0, totals(b).kalan) + oneriler.reduce((s, x) => s + x.aylikTasarruf, 0))) : 0, aciklama: String(raw?.kenaraAtma?.aciklama ?? '').slice(0, 400) },
    uyarilar: (Array.isArray(raw?.uyarilar) ? raw.uyarilar : []).map((x: unknown) => String(x).slice(0, 200)).filter(Boolean).slice(0, 3)
  };
};

export const askAdvice = async (o: { persona: string; budget: Budget }, call: AICall = callGemini): Promise<Advice> => {
  const raw = await call<any>(buildAdvicePrompt(o), ADVICE_SCHEMA);
  return sanitizeAdvice(raw, o.budget);
};
