// Bütçe Planı'nın yapay zekâ katmanı: sohbetten kalem çıkarma ve tasarruf önerisi. Sağlayıcı zinciri ortaktır (Gemini -> masaüstünde Claude Code, bkz. geminiMentor.callGemini).
// Rakamları yapay zekâ HESAPLAMAZ: toplamlar, kalan, nakit takvimi ve kartsız geçiş süreleri budget.ts'ten gelir ve isteme hazır olarak verilir.
// Yapay zekânın önerdiği her kalem kullanıcıya onay kartı olarak gösterilir; onaylanmadan hiçbir şey yazılmaz.
// Gizlilik: mesajlardaki uzun rakam dizileri (kart no, IBAN, TC kimlik) gönderilmeden gizlenir.

import { callGemini } from './geminiMentor';
import {
  type Budget, type AIAction, type BudgetKind, KIND_LABEL, totals, cashflow, transition, fmtTL, redactSensitive, round2, parseTL, type SpendRow, SPEND_CATS, normalizeCat, CUTTABLE_CATS, analizByCat
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
export interface ChatResult { cevap: string; senaryo: boolean; eylemler: AIAction[]; ekstreAy?: string; harcamalar: SpendRow[] }

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
    islemler: { type: 'array', items: { type: 'object', properties: { ad: { type: 'string' }, tutar: { type: 'number' }, kategori: { type: 'string' }, taksitNo: { type: 'integer' }, taksitToplam: { type: 'integer' } }, required: ['ad', 'tutar', 'kategori'] } },
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
export const statementBlock = (s?: StatementIn, month?: string): string => s ? `\nEKLİ KART EKSTRESİ (${redactSensitive(s.name).slice(0, 80)}) — bilgisayarda metne çevrildi, kimlik numaraları gizlendi:\n"""\n${redactSensitive(s.text).slice(0, 14000)}\n"""\nEKSTRE GÖREVİ: Bu ekstreden TEK bir kart kalemi çıkar: kind=kart, ad=banka/kart adı (örn. "Garanti Bonus"), tutar=bu dönemin ÖDENECEK TOPLAM borcu (asgari ödeme DEĞİL; toplam dönem borcu/ekstre borcu), gun=son ödeme tarihinin günü. Ekstrede taksitli işlemler varsa taksitliTutar = bu ekstreye yansıyan taksitlerin toplamı. Tek tek alışverişleri ekleme. Rakamları kendin topla/doğrula; tutarı belirleyemiyorsan eylem ekleme, cevapta nedenini söyle. Listede aynı kart zaten varsa guncelle kullan. "islemler" alanına ekstredeki HER harcamayı ayrı satır olarak yaz: ad = işletme/harcama adı (kısa ve okunur; örn. "Migros", "Shell", "Anthropic Claude"; kod/numara ekleme), tutar = bu dönemdeki tutar (pozitif sayı), kategori yalnızca şunlardan biri: ${SPEND_CATS.join(', ')}. Önceki dönem borcu, ödeme ve toplam satırlarını YAZMA. Eski taksitli alışverişin bu döneme yansıyan taksitini "Taksitler" kategorisiyle yaz; taksitNo (bu ekstredeki taksit sırası, örn. 2) ve taksitToplam (toplam taksit sayısı, örn. 3) alanlarını doldur ve ad'ına da "(2/3 taksit)" ekle; tutar o ayki taksit tutarıdır. Faiz/ücret varsa "Faiz / Ücret". 150'den fazla harcama varsa en büyük 150'sini yaz, kalanı tek satır "Diğer küçük harcamalar" (kategori Diğer) yap. Toplam, ekstredeki dönem harcamasına eşit olmalı; rakam uydurma. "ekstreAy" alanına ekstrenin SON ÖDEME TARİHİNİN ayını YYYY-AA biçiminde yaz (örn. son ödeme 9 Kasım 2026 ise "2026-11"); ödeme ayı odur, kesim ayı değil.${month ? ` Seçili bütçe ayı ${month}; ekstre başka aya aitse uygulama kartı o aya taşır, sen cevapta yalnızca "bu ekstre X ayına ait" de.` : ''} Son ödeme tarihi bugünden (${new Date().toLocaleDateString('tr-TR')}) önceyse yalnızca "ödediyseniz sorun yok" demen yeterli; kullanıcı ekstreleri tam öder, gecikme faizi uyarısı yapma.\n` : '';

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
const toSpend = (raw: any): SpendRow[] => {
  const out: SpendRow[] = [];
  // islemler (tek tek); eski/aksak yanıt için harcamalar (kategori toplamı) da kabul edilir
  for (const h of [...(Array.isArray(raw?.islemler) ? raw.islemler : []), ...(Array.isArray(raw?.harcamalar) ? raw.harcamalar : [])]) {
    const tutar = toNum(h?.tutar);
    if (tutar === undefined || tutar <= 0 || tutar > 10_000_000) continue;
    const adRaw = h?.ad ?? h?.ornek;
    const ad = typeof adRaw === 'string' ? redactSensitive(adRaw).replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const tn = Math.round(Number(h?.taksitNo)), tt = Math.round(Number(h?.taksitToplam));
    out.push({ kart: '', kategori: normalizeCat(h?.kategori), tutar: round2(tutar), ad: ad || undefined, taksit: tn >= 1 && tt >= tn && tt <= 60 ? { no: tn, toplam: tt } : undefined });
    if (out.length >= 200) break;
  }
  return out;
};

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
  return { cevap: String(raw?.cevap ?? '').trim() || 'Anladım.', senaryo: raw?.senaryo === true, eylemler: acts, ekstreAy: validMonth(raw?.ekstreAy), harcamalar: toSpend(raw) };
};

export type AICall = <T>(prompt: string, schema: any) => Promise<T>;

export const askBudget = async (o: { persona: string; budget: Budget; history: ChatMsg[]; message: string; statement?: StatementIn }, call: AICall = callGemini): Promise<ChatResult> => {
  const raw = await call<any>(buildChatPrompt(o), CHAT_SCHEMA);
  return normalizeChat(raw);
};

// ---------------- öneriler ----------------
// Tasarruf hedefleri KODDA sabit yüzdelerle hesaplanır: aynı bütçe her basışta aynı rakamı verir (yapay zekâ her seferinde farklı tutar uyduruyordu).
// Yapay zekâ yalnızca hangi kalemlerin öne çıkacağını ve "nasıl"ı (açıklama) yazar.
export const CUT_PCT: Record<string, number> = { 'Market': 0.12, 'Yemek / Kafe': 0.15, 'Ulaşım / Akaryakıt': 0.08, 'Eğlence / Abonelik': 0.15, 'Giyim': 0.20, 'Online alışveriş': 0.15, 'Diğer': 0.08 };
export const ITEM_CUT_PCT = 0.10; // elle girilmiş değişken kalemler
const round50 = (n: number) => Math.max(50, Math.round(n / 50) * 50);
export const cutTarget = (base: number, pct: number): number => (base > 0 ? round50(base * pct) : 0);
export interface AdviceItem { baslik: string; aciklama: string; kalem: string; aylikTasarruf: number; kaynak?: 'kalem' | 'ekstre' }
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
  const cats = analizByCat(o.budget);
  const dagilim = cats.length
    ? cats.map(c => `- ${c.kategori}: ${fmtTL(c.tutar)} [${c.kisilabilir ? `kısılabilir, aylık hedef −${fmtTL(cutTarget(c.tutar, CUT_PCT[c.kategori] ?? 0.08))}` : 'kısılamaz'}]${c.ornek ? ` — örn. ${redactSensitive(c.ornek)}` : ''}`).join('\n')
    : '(ekstre dağılımı yok)';
  return `${o.persona.slice(0, 6000)}

BU AYIN BÜTÇESİ (${o.budget.month}) — uygulamanın hesapladığı gerçek rakamlar (bunları aynen kullan, yeniden hesaplama):
${budgetFacts(o.budget)}

TOPLAMLAR: gelir ${fmtTL(t.gelir)}, sabit giderler ${fmtTL(t.sabit)}, kart ekstreleri ${fmtTL(t.kart)}, değişken harcamalar ${fmtTL(t.degisken)}, beklenmeyenler payı ${fmtTL(t.reserve)}, KALAN ${fmtTL(t.kalan)}.
NAKİT TAKVİMİ: ay içindeki en düşük bakiye ${fmtTL(cf.min.balance)} (ayın ${cf.min.day}. günü); eksi bakiyeli gün sayısı ${cf.negativeDays.length}.
KARTSIZ GEÇİŞ (mevcut kalanla): kartlarda kaydırılabilir tutar ${fmtTL(tr.shiftable)}; ${tr.bitis === null ? `geçiş mümkün değil (${tr.neden || 'kalan yetmiyor'})` : tr.bitis === 0 ? 'kaydırılacak tutar yok' : `${tr.bitis} ayda kartsıza geçilebilir`}.
KISILABİLECEK DEĞİŞKEN KALEMLER: ${deg}
EKSTRELERDEKİ HARCAMA DAĞILIMI (geçen dönemin kart harcamaları, kategori bazında; bunlar kart ekstresinin İÇİNDEDİR, ayrıca toplanmaz):
${dagilim}

GÖREV (Türkçe, kısa):
1. "ozet": durumu 3-4 cümleyle özetle (iyi giden ne, dikkat edilecek ne).
2. "oneriler": en çok 5 öneri. Yalnızca yukarıdaki DEĞİŞKEN kalemlerden ya da EKSTRE DAĞILIMINDAKİ [kısılabilir] kategorilerden; "kalem" alanına kalem/kategori adını BİREBİR yaz; "aylikTasarruf" için 0 yaz: tasarruf tutarlarını uygulama sabit yüzdelerle kendisi hesaplar. "aciklama" ve "ozet" metinlerinde TL tutarı YAZMA (tutarı uygulama gösterir); yalnızca nasıl yapılacağını yaz. Ekstre kategorisi önerisinde açıklamada hangi harcamalara/işletmelere dikkat edileceğini somut yaz (örn. "Market 8.100 TL: haftalık liste yapıp BİM/A101'e kaydırmak"). Dağılım varsa 'değişken kalem girilmemiş' deme; onu kullan. Sabit giderleri, "Taksitler", faiz/ücret ve kartın kendisini kısmayı ÖNERME.
3. "kenaraAtma": her ay kenara ayrılabilecek gerçekçi bir tutar ve kademeli artış fikri (açıklama 1-2 cümle). "aylik" için 0 yaz (uygulama hesaplar); "aciklama"da TL tutarı yazma, kademeli artış fikrini anlat.
4. "uyarilar": en çok 3 kısa uyarı (örn. maaş günü ile ödeme günleri arasındaki boşluk, günü yazılmayan kalemler). Uyarı yoksa boş dizi.
Yatırım, kredi ya da ürün tavsiyesi verme. Sadece JSON döndür.`;
};

// Öneriler uygulamanın kurallarına göre temizlenir: yalnızca değişken kalemlere bağlı, makul tutarlı
export const sanitizeAdvice = (raw: any, b: Budget): Advice => {
  const deg = b.items.filter(i => i.kind === 'degisken');
  const cats = analizByCat(b).filter(c => c.kisilabilir);
  const oneriler: AdviceItem[] = [];
  for (const o of Array.isArray(raw?.oneriler) ? raw.oneriler : []) {
    const name = String(o?.kalem ?? '').trim().toLocaleLowerCase('tr');
    const item = deg.find(i => i.name.toLocaleLowerCase('tr') === name);
    const cat = item ? undefined : cats.find(c => c.kategori.toLocaleLowerCase('tr') === name);
    if (!item && !cat) continue;
    const label = item ? item.name : cat!.kategori;
    if (oneriler.some(x => x.kalem === label)) continue; // aynı kalem iki kez önerilmez
    const target = item ? cutTarget(item.amount, ITEM_CUT_PCT) : cutTarget(cat!.tutar, CUT_PCT[cat!.kategori] ?? 0.08);
    oneriler.push({ baslik: String(o.baslik || label).slice(0, 80), aciklama: String(o.aciklama || '').slice(0, 400), kalem: label, aylikTasarruf: target, kaynak: item ? 'kalem' : 'ekstre' });
    if (oneriler.length >= 5) break;
  }
  // Kenara atma tutarı sabit kural: kalanın yarısı + öneri tasarrufları (yapay zekâ tutar uydurmaz)
  return {
    ozet: String(raw?.ozet ?? '').slice(0, 800),
    oneriler,
    kenaraAtma: { aylik: (() => { const kalan = Math.max(0, totals(b).kalan), sav = oneriler.reduce((s, x) => s + x.aylikTasarruf, 0); return kalan + sav > 0 ? Math.min(round50(kalan * 0.5 + sav), Math.floor((kalan + sav) / 50) * 50) : 0; })(), aciklama: String(raw?.kenaraAtma?.aciklama ?? '').slice(0, 400) },
    uyarilar: (Array.isArray(raw?.uyarilar) ? raw.uyarilar : []).map((x: unknown) => String(x).slice(0, 200)).filter(Boolean).slice(0, 3)
  };
};

export const askAdvice = async (o: { persona: string; budget: Budget }, call: AICall = callGemini): Promise<Advice> => {
  const raw = await call<any>(buildAdvicePrompt(o), ADVICE_SCHEMA);
  return sanitizeAdvice(raw, o.budget);
};
