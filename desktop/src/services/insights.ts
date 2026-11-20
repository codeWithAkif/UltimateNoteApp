// Bütçe içgörüleri (saf hesaplar; ağ ve yapay zekâ yok): taksit takvimi + borç eğrisi, "alabilir miyim?" karar aracı, abonelik avcısı, aylık karne.
// Veri kaynağı: aylık bütçe notları (Finans/Bütçe/YYYY-MM.md) ve içlerindeki ekstre harcama analizi. Hiçbiri bütçe toplamlarını değiştirmez.
import {
  type Budget, type BudgetItem, type SpendRow, parseBudgetNote, shiftMonth, totals, transition, cashflow, analizByCat, taksitOf, ruleKey, CUTTABLE_CATS, round2
} from './budget';
import { cutTarget, CUT_PCT } from './budgetAI';

export interface MonthData { month: string; b: Budget }

export const loadMonths = (files: Record<string, string>): MonthData[] => {
  const out: MonthData[] = [];
  for (const k of Object.keys(files)) {
    const m = /^Finans\/Bütçe\/(\d{4}-\d{2})\.md$/.exec(k);
    if (!m) continue;
    const b = parseBudgetNote(files[k], m[1]);
    if (b) out.push({ month: m[1], b });
  }
  return out.sort((a, z) => a.month.localeCompare(z.month));
};

const monthIdx = (m: string): number => { const x = /^(\d{4})-(\d{2})$/.exec(m); return x ? Number(x[1]) * 12 + Number(x[2]) - 1 : NaN; };
const kartKey = (s: string) => ruleKey(s) || 'kart';

// ---------------- taksit takvimi + borç eğrisi ----------------
export interface Installment { kart: string; ad: string; tutar: number; no: number; toplam: number; kalan: number; payMonth: string; sonAy: string }
export interface InstallmentMonth { month: string; toplam: number; biten: string[] }
export interface InstallmentPlan { items: Installment[]; yuk: InstallmentMonth[]; kalanToplam: number; bosAy: string | null; hafifleme: { month: string; azalan: number; neden: string[] }[] }

// Her kart için analizi olan EN YENİ ay alınır (eski aylardaki taksitler o kartın güncel ekstresinde yoksa bitmiş sayılır).
// Ekstrenin ödendiği ay P, taksit sırası no/toplam ise taksit P, P+1 ... P+(toplam-no) aylarında (her biri aynı tutar) ödenir.
export const installmentPlan = (months: MonthData[], now: Date = new Date()): InstallmentPlan => {
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seen = new Set<string>();
  const items: Installment[] = [];
  for (const md of [...months].reverse()) {
    const byKart = new Map<string, SpendRow[]>();
    for (const r of md.b.analiz || []) { const k = kartKey(r.kart); (byKart.get(k) || byKart.set(k, []).get(k)!).push(r); }
    for (const [k, rows] of byKart) {
      if (seen.has(k)) continue;
      seen.add(k);
      for (const r of rows) {
        const t = taksitOf(r);
        if (!t) continue;
        const kalan = t.toplam - t.no;
        items.push({ kart: r.kart || 'Kart', ad: (r.ad || 'Taksit').replace(/\s*\(\s*\d+\s*\/\s*\d+\s*taksit\s*\)/i, '').trim() || 'Taksit', tutar: r.tutar, no: t.no, toplam: t.toplam, kalan, payMonth: md.month, sonAy: shiftMonth(md.month, kalan) });
      }
    }
  }
  const live = items.filter(i => i.sonAy >= start).sort((a, z) => a.sonAy.localeCompare(z.sonAy) || z.tutar - a.tutar);
  const last = live.reduce((m, i) => (i.sonAy > m ? i.sonAy : m), start);
  const yuk: InstallmentMonth[] = [];
  for (let i = 0; i <= 36 && monthIdx(shiftMonth(start, i)) <= monthIdx(last); i++) {
    const m = shiftMonth(start, i);
    const active = live.filter(it => it.payMonth <= m && m <= it.sonAy);
    yuk.push({ month: m, toplam: round2(active.reduce((s, it) => s + it.tutar, 0)), biten: live.filter(it => it.sonAy === m).map(it => it.ad) });
  }
  const hafifleme = yuk.slice(1).map((y, i) => ({ month: y.month, azalan: round2(yuk[i].toplam - y.toplam), neden: yuk[i].biten })).filter(h => h.azalan > 0.5);
  const bosAy = yuk.find((y, i) => i > 0 && y.toplam === 0)?.month || (yuk.length && yuk[yuk.length - 1].toplam > 0 ? shiftMonth(yuk[yuk.length - 1].month, 1) : null);
  return { items: live, yuk, kalanToplam: round2(yuk.reduce((s, y) => s + y.toplam, 0)), bosAy: live.length ? bosAy : null, hafifleme };
};

export interface DebtPoint { month: string; kart: number; taksit: number }
export const debtSeries = (months: MonthData[]): DebtPoint[] =>
  months.filter(m => m.b.items.some(i => i.kind === 'kart')).map(m => ({
    month: m.month, kart: round2(totals(m.b).kart), taksit: round2(m.b.items.filter(i => i.kind === 'kart').reduce((s, i) => s + (i.taksitAmount || 0), 0))
  }));

// ---------------- "alabilir miyim?" ----------------
export interface AffordInput { tutar: number; taksit: number; yontem: 'kart' | 'nakit' }
export interface AffordResult {
  verdict: 'olur' | 'dikkat' | 'olmaz'; aylikOdeme: number; toplamYuk: number; kalanOnce: number; kalanSonra: number; minOnce: number; minSonra: number;
  gecisOnce: number | null; gecisSonra: number | null; biriktirmeAy: number | null; notlar: string[];
}
const fmt = (n: number) => `${Math.round(n).toLocaleString('tr-TR')} ₺`;

export const canAfford = (b: Budget, inp: AffordInput, today: Date = new Date()): AffordResult => {
  const tutar = Math.max(0, inp.tutar), n = inp.yontem === 'kart' ? Math.max(1, Math.round(inp.taksit) || 1) : 1;
  const monthly = round2(tutar / n);
  const day = Math.min(28, today.getDate());
  const extra: BudgetItem = inp.yontem === 'nakit'
    ? { id: 'alim', kind: 'sabit', name: 'Planlanan alım', amount: tutar, day }
    : { id: 'alim', kind: 'kart', name: 'Planlanan alım', amount: monthly, day: b.items.find(i => i.kind === 'kart' && i.day)?.day || 15, taksitAmount: n > 1 ? monthly : 0 };
  const b2: Budget = { ...b, items: [...b.items, extra] };
  const kalanOnce = totals(b).kalan, kalanSonra = totals(b2).kalan;
  const minOnce = cashflow(b).min.balance, minSonra = cashflow(b2).min.balance;
  const gecisOnce = transition(b).bitis, gecisSonra = transition(b2).bitis;
  const kenara = Math.max(0, kalanOnce) * 0.5;
  const biriktirmeAy = tutar > 0 && kenara > 0 ? Math.ceil(tutar / kenara) : null;

  let verdict: AffordResult['verdict'] = 'olur';
  if (tutar <= 0) verdict = 'olur';
  else if (kalanSonra < 0 || minSonra < 0 || (gecisOnce !== null && gecisSonra === null)) verdict = 'olmaz';
  // küçük alım kartsız geçişi 1 ay oynatabilir; uyarı için en az %10 uzama (ve en az 1 ay) aranır
  else if ((gecisOnce !== null && gecisSonra !== null && gecisSonra - gecisOnce >= Math.max(1, gecisOnce * 0.1)) || kalanSonra < kalanOnce * 0.5) verdict = 'dikkat';

  const notlar: string[] = [];
  if (inp.yontem === 'nakit') notlar.push(`Nakit: bu ayın kalanı ${fmt(kalanOnce)} → ${fmt(kalanSonra)}.`);
  else notlar.push(n > 1 ? `${n} taksit: ${n} ay boyunca aylık ${fmt(monthly)} ek yük; aylık kalanınız ${fmt(kalanOnce)} → ${fmt(kalanSonra)}.` : `Tek çekim: bir sonraki ekstrenize ${fmt(tutar)} eklenir; aylık kalanınız o ay ${fmt(kalanOnce)} → ${fmt(kalanSonra)}.`);
  if (minSonra < 0) notlar.push(`Ay içinde bakiye ${fmt(minSonra)}'ye düşer (eksiye iner).`);
  else if (minSonra < minOnce - 0.5) notlar.push(`Ayın en düşük bakiyesi ${fmt(minOnce)} → ${fmt(minSonra)}.`);
  if (gecisOnce !== null && gecisSonra === null) notlar.push('Kartsız geçiş mümkün olmaz hâle gelir (aylık kalan yetmez).');
  else if (gecisOnce !== null && gecisSonra !== null && gecisSonra !== gecisOnce) notlar.push(`Kartsız geçiş ${gecisOnce} ay → ${gecisSonra} ay.`);
  if (biriktirmeAy && inp.yontem === 'kart' && tutar > 0) notlar.push(`Alternatif: kalanınızın yarısını (${fmt(kenara)}/ay) ayırırsanız ${biriktirmeAy} ayda peşin alabilirsiniz.`);
  return { verdict, aylikOdeme: monthly, toplamYuk: round2(tutar), kalanOnce: round2(kalanOnce), kalanSonra: round2(kalanSonra), minOnce: round2(minOnce), minSonra: round2(minSonra), gecisOnce, gecisSonra, biriktirmeAy, notlar };
};

// ---------------- abonelik avcısı ----------------
export const SUB_PATH = 'Finans/Bütçe/Abonelikler.md';
const SUB_WORDS = new Set(['netflix', 'spotify', 'youtube', 'google', 'apple', 'icloud', 'hbo', 'hbomax', 'disney', 'amazon', 'prime', 'exxen', 'gain', 'blutv', 'tod', 'anthropic', 'claude', 'openai', 'chatgpt', 'canva', 'adobe', 'microsoft', 'dropbox', 'notion', 'duolingo', 'playstation', 'xbox', 'steam', 'deezer', 'fizy', 'bein']);
export type SubState = 'gerekli' | 'iptal';
export interface SubItem { key: string; ad: string; aylik: number; yillik: number; ay: number; kategori: string; son: string }

export const parseSubState = (content: string | undefined): Record<string, SubState> => {
  const out: Record<string, SubState> = {};
  for (const raw of String(content || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^[-*]\s+(.+?)\s*\|\s*durum:\s*(gerekli|iptal)\s*$/i);
    if (m) { const k = ruleKey(m[1]); if (k) out[k] = m[2].toLowerCase() as SubState; }
  }
  return out;
};
export const serializeSubState = (s: Record<string, SubState>): string =>
  '# Abonelik kararları\n\nBütçe Planı > Abonelikler ekranında "Gerekli" ya da "İptal ettim" dediğiniz abonelikler. Elle de düzenleyebilirsiniz.\n\n' +
  Object.entries(s).sort((a, z) => a[0].localeCompare(z[0], 'tr')).map(([k, v]) => `- ${k} | durum:${v}`).join('\n') + '\n';

export const findSubscriptions = (months: MonthData[]): SubItem[] => {
  const acc = new Map<string, { ad: string; perMonth: Map<string, number>; kat: string }>();
  for (const md of months) for (const r of md.b.analiz || []) {
    if (r.kategori === 'Taksitler' || r.kategori === 'Faiz / Ücret') continue;
    const key = ruleKey(r.ad || '');
    if (!key) continue;
    const isSub = r.kategori === 'Eğlence / Abonelik' || key.split(' ').some(w => SUB_WORDS.has(w));
    if (!isSub) continue;
    const cur = acc.get(key) || { ad: r.ad || key, perMonth: new Map<string, number>(), kat: r.kategori };
    cur.perMonth.set(md.month, round2((cur.perMonth.get(md.month) || 0) + r.tutar));
    acc.set(key, cur);
  }
  return [...acc.entries()].map(([key, v]) => {
    const vals = [...v.perMonth.values()];
    const aylik = round2(vals.reduce((s, x) => s + x, 0) / vals.length);
    return { key, ad: v.ad, aylik, yillik: round2(aylik * 12), ay: vals.length, kategori: v.kat, son: [...v.perMonth.keys()].sort().pop()! };
  }).sort((a, z) => z.aylik - a.aylik);
};

// ---------------- aylık karne + seri + rozetler ----------------
export interface CatScore { kategori: string; onceki: number; simdi: number; hedef: number; durum: 'tuttu' | 'iyilesti' | 'asti' }
export interface Badge { id: string; ad: string; aciklama: string; kazanildi: boolean }
export interface Scorecard {
  ready: boolean; month?: string; prevMonth?: string; cats: CatScore[]; toplamOnceki: number; toplamSimdi: number; fark: number; hedefTutan: number;
  seri: number; kumulatif: number; kart?: { onceki: number; simdi: number }; rozetler: Badge[];
  gelecek?: { kategori: string; hedef: number; tutar: number }[]; mesaj?: string;
}

const catMap = (b: Budget): Map<string, number> => new Map(analizByCat(b).map(c => [c.kategori, c.tutar]));
const cutCats = [...CUTTABLE_CATS];

export const scorecard = (months: MonthData[]): Scorecard => {
  const withA = months.filter(m => (m.b.analiz || []).length > 0);
  const pairs: { prev: MonthData; cur: MonthData }[] = [];
  for (let i = 1; i < withA.length; i++) if (shiftMonth(withA[i - 1].month, 1) === withA[i].month) pairs.push({ prev: withA[i - 1], cur: withA[i] });
  const empty: Scorecard = { ready: false, cats: [], toplamOnceki: 0, toplamSimdi: 0, fark: 0, hedefTutan: 0, seri: 0, kumulatif: 0, rozetler: [] };

  const badges = (latest: { cats: CatScore[]; seri: number; hedefTutan: number; fark: number; kart?: { onceki: number; simdi: number }; aboneliktenAzaldi: boolean }, any: boolean): Badge[] => [
    { id: 'ilk-adim', ad: 'İlk adım', aciklama: 'Bir önceki aya göre isteğe bağlı harcamayı azalttınız.', kazanildi: any },
    { id: 'seri-3', ad: '3 ay serisi', aciklama: 'Üst üste 3 ay isteğe bağlı harcamayı azalttınız.', kazanildi: latest.seri >= 3 },
    { id: 'hedef-ustasi', ad: 'Hedef ustası', aciklama: 'Bir ayda en az 3 kategoride kısma hedefini tutturdunuz.', kazanildi: latest.hedefTutan >= 3 },
    { id: 'market-hedefi', ad: 'Market hedefi', aciklama: 'Market harcamasında hedefi tutturdunuz.', kazanildi: latest.cats.some(c => c.kategori === 'Market' && c.durum === 'tuttu') },
    { id: 'abonelik', ad: 'Abonelik temizliği', aciklama: 'Eğlence/abonelik harcamasını en az %10 düşürdünüz.', kazanildi: latest.aboneliktenAzaldi },
    { id: 'borc-eriyor', ad: 'Borç eriyor', aciklama: 'Kart ekstre toplamınız bir önceki aya göre en az %10 azaldı.', kazanildi: !!latest.kart && latest.kart.simdi <= latest.kart.onceki * 0.9 }
  ];

  if (!pairs.length) {
    const latest = withA[withA.length - 1];
    const gelecek = latest ? cutCats.map(k => ({ kategori: k, tutar: catMap(latest.b).get(k) || 0 })).filter(x => x.tutar > 0).map(x => ({ ...x, hedef: round2(x.tutar - cutTarget(x.tutar, CUT_PCT[x.kategori] ?? 0.08)) })).sort((a, z) => z.tutar - a.tutar) : [];
    return { ...empty, month: latest?.month, gelecek, mesaj: latest ? 'İlk karneniz bir sonraki ekstre eklenince çıkar. O zamana kadar hedefleriniz:' : 'Karne için en az bir ayın ekstre harcama analizi gerekir (Bütçe Planı\'na ekstre PDF\'i ekleyin).', rozetler: badges({ cats: [], seri: 0, hedefTutan: 0, fark: 0, aboneliktenAzaldi: false }, false) };
  }

  const scoreOf = (p: { prev: MonthData; cur: MonthData }) => {
    const pm = catMap(p.prev.b), cm = catMap(p.cur.b);
    // yalnızca önceki ayda harcaması olan kategoriler puanlanır (yeni çıkan kategorinin kıyaslanacak bir şeyi yok)
    const cats: CatScore[] = cutCats.filter(k => (pm.get(k) || 0) > 0).map(k => {
      const onceki = pm.get(k) || 0, simdi = cm.get(k) || 0;
      const hedef = round2(onceki - cutTarget(onceki, CUT_PCT[k] ?? 0.08));
      return { kategori: k, onceki, simdi, hedef, durum: simdi <= hedef ? 'tuttu' : simdi <= onceki ? 'iyilesti' : 'asti' } as CatScore;
    }).sort((a, z) => z.onceki - a.onceki);
    const o = round2(cats.reduce((s, c) => s + c.onceki, 0)), s = round2(cats.reduce((x, c) => x + c.simdi, 0));
    return { cats, onceki: o, simdi: s, fark: round2(o - s) };
  };
  const scores = pairs.map(scoreOf);
  const last = scores[scores.length - 1], lp = pairs[pairs.length - 1];
  let seri = 0;
  for (let i = scores.length - 1; i >= 0 && scores[i].fark > 0; i--) seri++;
  const kartOnce = round2(totals(lp.prev.b).kart), kartSimdi = round2(totals(lp.cur.b).kart);
  const abOnce = catMap(lp.prev.b).get('Eğlence / Abonelik') || 0, abSimdi = catMap(lp.cur.b).get('Eğlence / Abonelik') || 0;
  const hedefTutan = last.cats.filter(c => c.durum === 'tuttu').length;
  const core = { cats: last.cats, seri, hedefTutan, fark: last.fark, kart: { onceki: kartOnce, simdi: kartSimdi }, aboneliktenAzaldi: abOnce > 0 && abSimdi <= abOnce * 0.9 };
  return {
    ready: true, month: lp.cur.month, prevMonth: lp.prev.month, cats: last.cats, toplamOnceki: last.onceki, toplamSimdi: last.simdi, fark: last.fark,
    hedefTutan, seri, kumulatif: round2(scores.reduce((s, x) => s + x.fark, 0)), kart: core.kart, rozetler: badges(core, scores.some(x => x.fark > 0))
  };
};
