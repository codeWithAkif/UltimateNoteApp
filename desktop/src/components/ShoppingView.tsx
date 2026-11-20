import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Plus, Trash2, Check, Search, ChevronLeft, ChevronRight, MapPin, Sparkles, RefreshCw, X, Copy, AlertTriangle, FileText, CornerDownRight } from 'lucide-react';
import {
  type ShopWeek, type ShopItem, MARKET_CAT, weekIdOf, weekPath, shiftWeek, weekLabel, parseWeek, serializeWeek, newItem, addableCats, withPlanBlock, listWeeks, recentHistory
} from '../services/shopping';
import {
  type MarketLoc, type MarketProduct, type BasketPlan, loadLoc, saveLoc, isMarketSupported, searchProducts, refreshProduct, planBasket, marketLabel
} from '../services/marketPrice';
import { askNeeds, researchPrice, type Needs, type Research } from '../services/shoppingAI';
import { HISTORY_PATH, type PriceRec, parseHistory, serializeHistory, addRecords, trendOf, discountHits, dayOf, type RadarHit } from '../services/priceHistory';
import { weeklyMarketBudget } from '../services/shopBudget';
import { reminderSupported, isReminderOn, setReminder } from '../services/shopReminder';
import { isGeminiConfigured } from '../services/geminiMentor';

const panel: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px' };
const field: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px',
  padding: '6px 8px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '6px 11px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};
const btnPrimary: React.CSSProperties = { ...btn, background: 'var(--accent-color)', border: '1px solid var(--accent-color)', color: '#fff' };
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' };
const muted: React.CSSProperties = { fontSize: '11.5px', color: 'var(--text-muted)' };
const tl = (n: number) => `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const MAX_MARKETS_KEY = 'market_max_v1';

interface Picker { id: string; q: string; loading: boolean; results: MarketProduct[]; err: string; searched: boolean }

export default function ShoppingView({ fileContents, onSaveNote, onOpenNote }: {
  fileContents: Record<string, string>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onOpenNote?: (path: string) => void;
}) {
  const thisWeek = weekIdOf(new Date());
  const [weekId, setWeekId] = useState(thisWeek);
  const path = weekPath(weekId);

  // ---- not içeriği: yerel önbellek (kayıt dosya sistemine yansıyana kadar ekran eski hâle dönmesin)
  const [local, setLocal] = useState<{ path: string; content: string } | null>(null);
  const content = local && local.path === path ? local.content : fileContents[path];
  const contentRef = useRef(content); contentRef.current = content;
  useEffect(() => { if (local && local.path === path && fileContents[path] === local.content) setLocal(null); }, [fileContents[path]]); // eslint-disable-line react-hooks/exhaustive-deps
  const week = useMemo(() => parseWeek(content, weekId), [content, weekId]);

  const commit = (next: ShopWeek) => {
    const c = serializeWeek(next);
    if (c === contentRef.current) return;
    contentRef.current = c;
    setLocal({ path, content: c });
    void onSaveNote?.(path, c);
  };
  const mutate = (fn: (w: ShopWeek) => ShopWeek) => commit(fn(parseWeek(contentRef.current, weekId)));

  // Bu haftanın notu yoksa ilk açılışta oluşturulur ("hafta başında açılan not")
  useEffect(() => {
    if (weekId === thisWeek && fileContents[weekPath(thisWeek)] === undefined && onSaveNote) void onSaveNote(weekPath(thisWeek), serializeWeek(parseWeek('', thisWeek)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- ekleme
  const [text, setText] = useState('');
  const [kat, setKat] = useState(MARKET_CAT);
  const [newKat, setNewKat] = useState('');
  const cats = useMemo(() => addableCats(week), [week]);
  const add = () => {
    const k = kat === '__yeni' ? newKat.trim() : kat;
    if (!text.trim() || !k) return;
    mutate(w => newItem(w, k, text));
    setText('');
    if (kat === '__yeni') { setKat(k); setNewKat(''); }
  };
  const patch = (id: string, p: Partial<ShopItem>) => mutate(w => ({ ...w, items: w.items.map(i => (i.id === id ? { ...i, ...p } : i)) }));
  const remove = (id: string) => mutate(w => ({ ...w, items: w.items.filter(i => i.id !== id) }));

  // Geçen haftadan alınmayanları taşı
  const prevId = shiftWeek(weekId, -1);
  const prevLeft = useMemo(() => parseWeek(fileContents[weekPath(prevId)], prevId).items.filter(i => !i.done), [fileContents, prevId]);
  const carryOver = () => mutate(w => {
    let n = w;
    for (const it of prevLeft) if (!w.items.some(x => x.text.toLocaleLowerCase('tr') === it.text.toLocaleLowerCase('tr'))) n = { ...n, items: [...n.items, { ...it, id: `c${Math.random().toString(36).slice(2, 7)}`, done: false }] };
    return n;
  });

  // ---- konum + market ayarları
  const supported = isMarketSupported();
  const [loc, setLoc] = useState<MarketLoc | null>(() => loadLoc());
  const [showLoc, setShowLoc] = useState(false);
  const [latS, setLatS] = useState(loc ? String(loc.lat) : '');
  const [lonS, setLonS] = useState(loc ? String(loc.lon) : '');
  const [kmS, setKmS] = useState(loc ? String(loc.km) : '3');
  const [maxMarkets, setMaxMarkets] = useState(() => { try { return Math.min(4, Math.max(1, Number(localStorage.getItem(MAX_MARKETS_KEY)) || 2)); } catch { return 2; } });
  const [locMsg, setLocMsg] = useState('');
  const saveLocation = () => {
    const lat = Number(latS.replace(',', '.')), lon = Number(lonS.replace(',', '.')), km = Number(kmS.replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 35 || lat > 43 || lon < 25 || lon > 46) { setLocMsg('Konum Türkiye sınırları içinde olmalı (enlem 35–43, boylam 25–46).'); return; }
    const v = saveLoc({ lat, lon, km: Number.isFinite(km) ? km : 3 });
    setLoc(v); setLatS(String(v.lat)); setLonS(String(v.lon)); setKmS(String(v.km));
    setLocMsg(`Kaydedildi (yaklaşık ${v.lat}, ${v.lon} · ${v.km} km).`);
  };
  const findMe = () => {
    if (!navigator.geolocation) { setLocMsg('Bu cihaz konum bulmayı desteklemiyor; koordinatı elle girin.'); return; }
    setLocMsg('Konum aranıyor…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setLatS(String(Math.round(p.coords.latitude * 100) / 100)); setLonS(String(Math.round(p.coords.longitude * 100) / 100)); setLocMsg('Bulundu (yaklaşık). Kaydet\'e basın.'); },
      () => setLocMsg('Konum alınamadı. Google Haritalar\'da mahallenize sağ tıklayıp koordinatı kopyalayın ve elle girin.'),
      { timeout: 10000 }
    );
  };

  // ---- ürün seçici
  const [picker, setPicker] = useState<Picker | null>(null);
  const openPicker = (it: ShopItem) => { setPicker({ id: it.id, q: it.text.replace(/\d+\s*(adet|lt|l|kg|gr|g|ml)\b/gi, '').trim() || it.text, loading: false, results: [], err: '', searched: false }); };
  const runSearch = async (q: string) => {
    if (!loc) { setPicker(p => p && { ...p, err: 'Önce konumunuzu girin (aşağıdaki "Konum ve market ayarları").' }); return; }
    setPicker(p => p && { ...p, loading: true, err: '', q });
    try { const r = await searchProducts(loc, q, 12); setPicker(p => p && { ...p, loading: false, results: r, searched: true, err: r.length ? '' : 'Ürün bulunamadı; daha kısa/genel yazmayı deneyin.' }); }
    catch (e: any) { setPicker(p => p && { ...p, loading: false, err: String(e?.message || e) }); }
  };
  const [prices, setPrices] = useState<Record<string, MarketProduct>>({});
  const choose = (itemId: string, p: MarketProduct) => {
    patch(itemId, { urun: { id: p.id, title: p.title } });
    setPrices(m => ({ ...m, [p.id]: p }));
    setPicker(null);
  };

  // ---- fiyatlar + en uygun dağıtım
  const [pricing, setPricing] = useState(false);
  const [priceMsg, setPriceMsg] = useState('');
  const [plan, setPlan] = useState<{ plan: BasketPlan; unbound: string[]; notFound: string[]; names: Record<string, string>; oldest: string } | null>(null);
  const marketItems = week.items.filter(i => i.kat === MARKET_CAT && !i.done);

  const autoMatch = async () => {
    if (!loc) { setPriceMsg('Önce konumunuzu girin.'); return; }
    const todo = marketItems.filter(i => !i.urun).slice(0, 15);
    if (!todo.length) return;
    setPricing(true); setPriceMsg('Ürünler eşleniyor…');
    const found: Record<string, MarketProduct> = {};
    let fail = 0;
    try {
      for (const it of todo) {
        try {
          const r = await searchProducts(loc, it.text.replace(/\d+\s*(adet|lt|l|kg|gr|g|ml)\b/gi, '').trim() || it.text, 8);
          const pick = r.find(p => p.offers.length >= 2) || r[0];
          if (pick) found[it.id] = pick; else fail++;
        } catch (e: any) { setPriceMsg(String(e?.message || e)); fail++; break; }
      }
    } finally { setPricing(false); }
    const ids = Object.keys(found);
    if (ids.length) {
      mutate(w => ({ ...w, items: w.items.map(i => {
        const f = found[i.id];
        // eşleme yalnızca ilk okuma ile aynı sıradaki madde için geçerli: kimlik kayması olmasın diye metinle de doğrulanır
        return f && !i.urun && todo.some(t => t.id === i.id && t.text === i.text) ? { ...i, urun: { id: f.id, title: f.title } } : i;
      }) }));
      setPrices(m => ({ ...m, ...Object.fromEntries(ids.map(k => [found[k].id, found[k]])) }));
    }
    setPriceMsg(`${ids.length} ürün otomatik eşlendi${fail ? `, ${fail} tanesi bulunamadı` : ''}. Yanlışsa ürün adına tıklayıp değiştirin.`);
  };

  const getPrices = async () => {
    if (!loc) { setPriceMsg('Önce konumunuzu girin.'); return; }
    const bound = marketItems.filter(i => i.urun).slice(0, 30);
    const unbound = marketItems.filter(i => !i.urun).map(i => i.text);
    if (!bound.length) { setPriceMsg('Önce market maddelerine ürün seçin (maddenin yanındaki "Ürün seç" ya da "Otomatik eşle").'); return; }
    setPricing(true); setPriceMsg('Güncel fiyatlar getiriliyor…'); setPlan(null);
    const got: Record<string, MarketProduct> = { ...prices };
    const notFound: string[] = [];
    try {
      for (const it of bound) {
        const cached = got[it.urun!.id];
        let p: MarketProduct | null = cached || null;
        try { p = await refreshProduct(loc, it.urun!.id, it.urun!.title); } catch (e: any) { if (!cached) throw e; }
        if (p) got[p.id] = p; else if (!cached) notFound.push(it.text);
      }
      setPrices(got);
      saveHistory(bound.map(i => got[i.urun!.id]).filter((x): x is MarketProduct => !!x));
      const items = bound.filter(i => got[i.urun!.id]).map(i => ({ key: i.id, name: i.text, qty: i.adet || 1, offers: got[i.urun!.id].offers }));
      const names = Object.fromEntries(bound.map(i => [i.id, got[i.urun!.id]?.title || i.text]));
      const p = planBasket(items, maxMarkets);
      const times = p.markets.flatMap(m => m.lines.map(l => got[bound.find(b => b.id === l.key)!.urun!.id]?.offers.find(o => o.market === m.market)?.time || '')).filter(Boolean).sort();
      setPlan({ plan: p, unbound, notFound, names, oldest: times[0] || '' });
      setPriceMsg('');
    } catch (e: any) { setPriceMsg(String(e?.message || e)); }
    finally { setPricing(false); }
  };

  const planText = (): string => {
    if (!plan) return '';
    const lines = [`Alışveriş planı (${weekLabel(weekId)}) — tahmini fiyatlar, marketfiyati.org.tr`];
    for (const m of plan.plan.markets) { lines.push('', `${marketLabel(m.market)} — ${tl(m.total)}`); for (const l of m.lines) lines.push(`- ${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}: ${tl(l.total)}`); }
    lines.push('', `Toplam: ${tl(plan.plan.total)}`);
    return lines.join('\n');
  };
  const [copied, setCopied] = useState(false);
  const copyPlan = async () => { try { await navigator.clipboard.writeText(planText()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* yoksay */ } };

  // ---- neye ihtiyacım var
  const [needs, setNeeds] = useState<Needs | null>(null);
  const [needsBusy, setNeedsBusy] = useState(false);
  const [needsErr, setNeedsErr] = useState('');
  const aiReady = isGeminiConfigured();
  const askNeedsNow = async () => {
    if (needsBusy) return;
    if (!aiReady) { setNeedsErr('Yapay zekâ ayarlı değil (Ayarlar > AI Mentor).'); return; }
    setNeedsBusy(true); setNeedsErr(''); setNeeds(null);
    try { setNeeds(await askNeeds({ week, history: recentHistory(fileContents, weekId, 5) })); }
    catch (e: any) { setNeedsErr(String(e?.message || e)); }
    finally { setNeedsBusy(false); }
  };

  // ---- fiyat geçmişi (Alışveriş/Fiyat Geçmişi.md): fiyatlar her alındığında ürün başına günlük kayıt
  const histRef = useRef<PriceRec[]>(parseHistory(fileContents[HISTORY_PATH]));
  useEffect(() => { histRef.current = parseHistory(fileContents[HISTORY_PATH]); }, [fileContents[HISTORY_PATH]]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveHistory = (products: MarketProduct[]) => {
    if (!products.length) return;
    const next = addRecords(histRef.current, dayOf(new Date()), products);
    histRef.current = next;
    void onSaveNote?.(HISTORY_PATH, serializeHistory(next));
  };
  const trendBadge = (pr: MarketProduct) => {
    const price = pr.offers[0]?.price;
    if (!price) return null;
    const tr = trendOf(histRef.current, pr.id, price, dayOf(new Date()));
    if (tr.lowest) return <span style={{ fontSize: '11.5px', color: '#22c55e', fontWeight: 700 }}>30 günün en düşük fiyatı</span>;
    if (tr.pct !== undefined && Math.abs(tr.pct) >= 2) return <span style={{ fontSize: '11.5px', color: tr.pct < 0 ? '#22c55e' : '#ef4444' }}>{tr.pct < 0 ? '↓' : '↑'} %{Math.abs(tr.pct).toLocaleString('tr-TR')} ({tr.prevDate} → bugün)</span>;
    return null;
  };

  // ---- planı haftalık nota yaz ("## Fiyat planı", düz satırlar)
  const [planSaved, setPlanSaved] = useState(false);
  const savePlanToNote = () => {
    if (!plan) return;
    const lines = plan.plan.markets.map(m => `${marketLabel(m.market)} — ${tl(m.total)}: ${m.lines.map(l => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''} ${tl(l.total)}`).join(' · ')}`);
    lines.push(`Toplam: ${tl(plan.plan.total)} (tahmini, marketfiyati.org.tr, ${dayOf(new Date())})`);
    if (plan.plan.missing.length) lines.push(`Bulunamadı: ${plan.plan.missing.join(', ')}`);
    mutate(w => withPlanBlock(w, lines));
    setPlanSaved(true); setTimeout(() => setPlanSaved(false), 2200);
  };

  // ---- web aramalı fiyat araştırma: market dışı her şey (lastik, kuru temizleme, akaryakıt…) ve marketfiyati bulamazsa yedek
  const [place, setPlace] = useState(() => { try { return localStorage.getItem('shop_place_v1') || ''; } catch { return ''; } });
  const [research, setResearch] = useState<Record<string, { loading: boolean; res?: Research; err?: string }>>({});
  const doResearch = async (it: ShopItem) => {
    if (!aiReady) { setResearch(r => ({ ...r, [it.id]: { loading: false, err: 'Yapay zekâ ayarlı değil (Ayarlar > AI Mentor).' } })); return; }
    setResearch(r => ({ ...r, [it.id]: { loading: true } }));
    try { const res = await researchPrice(it.text, it.kat, place.trim() || undefined); setResearch(r => ({ ...r, [it.id]: { loading: false, res } })); }
    catch (e: any) { setResearch(r => ({ ...r, [it.id]: { loading: false, err: String(e?.message || e) } })); }
  };
  const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

  // ---- indirim radarı: listedeki + son haftalarda aldığınız ürünlerde indirim / fiyat düşüşü
  const [radar, setRadar] = useState<{ loading: boolean; hits: RadarHit[]; falling: { title: string; pct: number; price: number; market: string }[]; n: number; err?: string } | null>(null);
  const runRadar = async () => {
    if (!loc) { setRadar({ loading: false, hits: [], falling: [], n: 0, err: 'Önce konumunuzu girin.' }); return; }
    const ids = new Map<string, string>();
    for (const i of week.items) if (i.urun) ids.set(i.urun.id, i.urun.title);
    for (const wid of listWeeks(fileContents).filter(x => x < weekId).slice(0, 4)) for (const i of parseWeek(fileContents[weekPath(wid)], wid).items) if (i.urun) ids.set(i.urun.id, i.urun.title);
    const list = [...ids.entries()].slice(0, 15);
    if (!list.length) { setRadar({ loading: false, hits: [], falling: [], n: 0, err: 'Henüz ürün seçilmiş market maddeniz yok; önce "Ürün seç" ile birkaç ürün bağlayın.' }); return; }
    setRadar({ loading: true, hits: [], falling: [], n: list.length });
    const got: MarketProduct[] = [];
    try {
      for (const [id, title] of list) { const pr = await refreshProduct(loc, id, title); if (pr) got.push(pr); }
      saveHistory(got);
      setPrices(m => ({ ...m, ...Object.fromEntries(got.map(g => [g.id, g])) }));
      const today = dayOf(new Date());
      const falling = got.map(g => { const tr = trendOf(histRef.current, g.id, g.offers[0].price, today); return tr.pct !== undefined && tr.pct <= -5 ? { title: g.title, pct: tr.pct, price: g.offers[0].price, market: g.offers[0].market } : null; }).filter((x): x is { title: string; pct: number; price: number; market: string } => !!x);
      setRadar({ loading: false, hits: discountHits(got, 5), falling, n: got.length });
    } catch (e: any) { setRadar({ loading: false, hits: [], falling: [], n: 0, err: String(e?.message || e) }); }
  };

  // ---- Bütçe bağı: ekstredeki market harcamasından haftalık hedef
  const wm = useMemo(() => weeklyMarketBudget(fileContents), [fileContents]);

  // ---- telefon hatırlatması (Pazartesi 09:00)
  const [remOn, setRemOn] = useState(() => isReminderOn());
  const [remMsg, setRemMsg] = useState('');
  const toggleReminder = async (on: boolean) => { const r = await setReminder(on); setRemMsg(r.msg); if (r.ok) setRemOn(on); };

  const weeksWithNotes = listWeeks(fileContents).length;
  const byCat = (k: string) => week.items.filter(i => i.kat === k);

  return (
    <div style={{ padding: '22px 28px 60px', maxWidth: '1180px', margin: '0 auto', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <ShoppingCart size={22} color="var(--accent-color)" />
        <h2 style={{ margin: 0, fontSize: '20px' }}>Alışveriş</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button type="button" style={{ ...btn, padding: '5px 7px' }} onClick={() => setWeekId(shiftWeek(weekId, -1))} aria-label="Önceki hafta"><ChevronLeft size={15} /></button>
          <div style={{ minWidth: '170px', textAlign: 'center', fontWeight: 700, fontSize: '13.5px' }}>{weekId}<div style={{ ...muted, fontWeight: 400 }}>{weekLabel(weekId)}</div></div>
          <button type="button" style={{ ...btn, padding: '5px 7px' }} onClick={() => setWeekId(shiftWeek(weekId, 1))} aria-label="Sonraki hafta"><ChevronRight size={15} /></button>
          {weekId !== thisWeek && <button type="button" style={btn} onClick={() => setWeekId(thisWeek)}>Bu hafta</button>}
        </div>
      </div>
      <div style={{ ...muted, margin: '6px 0 14px', lineHeight: 1.6 }}>
        Her hafta için bir not: <code>{path}</code>. Market, araç, ev, kuru temizleme… her şeyi yazın; not elle de düzenlenebilir ({weeksWithNotes} haftalık not var).
        Fiyatlar <b>tahminidir</b> (marketfiyati.org.tr, günlük güncellenir); kaynak ve saat her zaman gösterilir.
        {onOpenNote && <> <button type="button" style={{ ...btn, padding: '2px 8px', fontSize: '11.5px', marginLeft: '6px' }} onClick={() => onOpenNote(path)}><FileText size={12} /> Notu aç</button></>}
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* SOL: liste */}
        <div style={{ flex: '1 1 440px', minWidth: 0 }}>
          <div style={panel}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                placeholder="Ne lazım? (örn. süt 1 lt, kış lastiği, palto kuru temizleme)" aria-label="Yeni madde" style={{ ...field, flex: '1 1 220px' }} />
              <select value={kat} onChange={(e) => setKat(e.target.value)} style={field} aria-label="Kategori">
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__yeni">+ Yeni kategori…</option>
              </select>
              {kat === '__yeni' && <input value={newKat} onChange={(e) => setNewKat(e.target.value)} placeholder="Kategori adı" aria-label="Yeni kategori adı" style={{ ...field, width: '130px' }} />}
              <button type="button" style={{ ...btnPrimary, opacity: text.trim() ? 1 : 0.6 }} disabled={!text.trim()} onClick={add}><Plus size={14} /> Ekle</button>
            </div>
            {prevLeft.length > 0 && week.items.length === 0 && (
              <div style={{ marginTop: '8px' }}><button type="button" style={btn} onClick={carryOver}><CornerDownRight size={13} /> Geçen haftadan kalan {prevLeft.length} maddeyi taşı</button></div>
            )}
          </div>

          {cats.map(k => {
            const items = byCat(k);
            if (!items.length) return null;
            return (
              <div key={k} style={{ ...panel, marginTop: '12px' }}>
                <div style={{ ...label, marginBottom: '6px' }}>{k} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· {items.filter(i => i.done).length}/{items.length}</span></div>
                {items.map(it => (
                  <div key={it.id} style={{ borderTop: '1px solid var(--border-color)', padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button type="button" onClick={() => patch(it.id, { done: !it.done })} aria-label={it.done ? 'Alındı işaretini kaldır' : 'Alındı olarak işaretle'}
                        style={{ width: '20px', height: '20px', borderRadius: '50%', border: '1.5px solid var(--border-color)', background: it.done ? '#22c55e' : 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0, padding: 0 }}>
                        {it.done && <Check size={12} color="#fff" />}
                      </button>
                      <span style={{ flex: 1, fontSize: '13px', textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--text-muted)' : 'var(--text-primary)', overflowWrap: 'anywhere' }}>{it.text}</span>
                      <input type="number" min={1} max={99} value={it.adet || 1} onChange={(e) => patch(it.id, { adet: Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))) })} aria-label={`${it.text} adedi`} title="Adet" style={{ ...field, width: '52px', padding: '4px 5px' }} />
                      <button type="button" onClick={() => remove(it.id)} aria-label={`${it.text} sil`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '2px' }}><Trash2 size={14} /></button>
                    </div>
                    {k === MARKET_CAT && !it.done && (
                      <div style={{ marginLeft: '28px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
                        {it.urun ? (
                          <>
                            <button type="button" onClick={() => openPicker(it)} title="Ürünü değiştir" style={{ ...btn, padding: '2px 8px', fontSize: '11.5px', fontWeight: 500 }}>{it.urun.title}</button>
                            {prices[it.urun.id] && <span style={muted}>en ucuz: <b style={{ color: '#22c55e' }}>{marketLabel(prices[it.urun.id].offers[0].market)} {tl(prices[it.urun.id].offers[0].price)}</b>{prices[it.urun.id].offers[1] ? ` · ${marketLabel(prices[it.urun.id].offers[1].market)} ${tl(prices[it.urun.id].offers[1].price)}` : ''}</span>}
                          </>
                        ) : <button type="button" onClick={() => openPicker(it)} style={{ ...btn, padding: '2px 8px', fontSize: '11.5px' }}><Search size={11} /> Ürün seç</button>}
                      </div>
                    )}
                    {!it.done && (
                      <div style={{ marginLeft: '28px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {k === MARKET_CAT && it.urun && prices[it.urun.id] && trendBadge(prices[it.urun.id])}
                        <button type="button" onClick={() => void doResearch(it)} disabled={research[it.id]?.loading} style={{ ...btn, padding: '2px 8px', fontSize: '11.5px', fontWeight: 500 }} title="Google araması ile güncel fiyat ve uygun yerleri araştırır (tahmini; kaynak bağlantısı gösterilir)">
                          {research[it.id]?.loading ? <RefreshCw size={11} className="animate-spin" /> : <Search size={11} />} {k === MARKET_CAT ? "Web'de ara" : 'Fiyat araştır'}
                        </button>
                      </div>
                    )}
                    {research[it.id] && !research[it.id].loading && (
                      <div style={{ marginLeft: '28px', marginTop: '6px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 10px' }}>
                        {research[it.id].err && <div style={{ fontSize: '12px', color: '#f59e0b', overflowWrap: 'anywhere' }}>{research[it.id].err}</div>}
                        {research[it.id].res && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {research[it.id].res!.quotes.map((q, qi) => (
                              <div key={qi} style={{ fontSize: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                                <b>{q.yer}</b><span style={{ color: /bulunamad/i.test(q.fiyat) ? 'var(--text-muted)' : '#22c55e', fontWeight: 700 }}>{q.fiyat}</span>
                                {q.not && <span style={muted}>{q.not}</span>}
                                {q.kaynak && <a href={q.kaynak} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)', fontSize: '11.5px' }}>{host(q.kaynak)} ↗</a>}
                              </div>
                            ))}
                            {research[it.id].res!.ozet && <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{research[it.id].res!.ozet}</div>}
                            <div style={muted}>Tahminidir: web aramasından derlendi, fiyatı kaynak sayfada doğrulayın.</div>
                          </div>
                        )}
                        <button type="button" onClick={() => setResearch(r => { const n = { ...r }; delete n[it.id]; return n; })} style={{ ...btn, padding: '2px 8px', fontSize: '11px', marginTop: '6px' }}><X size={11} /> Kapat</button>
                      </div>
                    )}
                    {picker && picker.id === it.id && (
                      <div style={{ marginLeft: '28px', marginTop: '6px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 10px' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input autoFocus value={picker.q} onChange={(e) => setPicker({ ...picker, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(picker.q); }} aria-label="Ürün ara" placeholder="Ürün adı (örn. içim süt)" style={{ ...field, flex: 1 }} />
                          <button type="button" style={btnPrimary} disabled={picker.loading} onClick={() => void runSearch(picker.q)}>{picker.loading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />} Ara</button>
                          <button type="button" style={btn} onClick={() => setPicker(null)} aria-label="Kapat"><X size={13} /></button>
                        </div>
                        {picker.err && <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '6px' }}>{picker.err}</div>}
                        {!picker.searched && !picker.loading && !picker.err && <div style={{ ...muted, marginTop: '6px' }}>Adı düzenleyip "Ara"ya basın (yakınınızdaki marketlerdeki ürünler listelenir).</div>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', maxHeight: '260px', overflowY: 'auto' }}>
                          {picker.results.map(p => (
                            <button key={p.id} type="button" onClick={() => choose(it.id, p)} style={{ textAlign: 'left', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', color: 'inherit' }}>
                              <div style={{ fontSize: '12.5px', fontWeight: 600 }}>{p.title}{p.size ? <span style={{ ...muted, fontWeight: 400 }}> · {p.size}</span> : null}</div>
                              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{p.offers.map(o => `${marketLabel(o.market)} ${tl(o.price)}`).join(' · ')}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {week.items.length === 0 && <div style={{ ...muted, textAlign: 'center', padding: '28px 0' }}>Bu hafta için liste boş. Yukarıdan ekleyin{prevLeft.length ? ' ya da geçen haftadan kalanları taşıyın' : ''}.</div>}

          {/* neye ihtiyacım var */}
          <div style={{ ...panel, marginTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ ...label, flex: 1 }}>Neye ihtiyacım var?</div>
              <button type="button" style={btnPrimary} disabled={needsBusy} onClick={() => void askNeedsNow()}>{needsBusy ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />} Geçmiş haftalara bak</button>
            </div>
            {!needs && !needsErr && !needsBusy && <div style={{ ...muted, marginTop: '8px' }}>Önceki haftalardaki listelere bakıp bu hafta listede olmayan, düzenli aldığınız şeyleri hatırlatır.</div>}
            {needsBusy && <div style={{ ...muted, marginTop: '8px' }}>Geçmiş listeler inceleniyor…</div>}
            {needsErr && <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px', overflowWrap: 'anywhere' }}>{needsErr}</div>}
            {needs && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {needs.ozet && <div style={{ fontSize: '12.5px', lineHeight: 1.55 }}>{needs.ozet}</div>}
                {needs.oneriler.map((n, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '6px 10px' }}>
                    <div style={{ flex: 1, fontSize: '12.5px' }}><b>{n.text}</b> <span style={muted}>· {n.kat}</span><div style={muted}>{n.neden}</div></div>
                    <button type="button" style={btn} onClick={() => { mutate(w => newItem(w, n.kat, n.text)); setNeeds(nd => nd && { ...nd, oneriler: nd.oneriler.filter((_, j) => j !== i) }); }}><Plus size={12} /> Ekle</button>
                  </div>
                ))}
                {needs.oneriler.length > 1 && <button type="button" style={{ ...btn, alignSelf: 'flex-start' }} onClick={() => { mutate(w => needs.oneriler.reduce((acc, n) => newItem(acc, n.kat, n.text), w)); setNeeds(nd => nd && { ...nd, oneriler: [] }); }}><Plus size={12} /> Hepsini ekle</button>}
              </div>
            )}
          </div>
        </div>

        {/* SAĞ: fiyat + dağıtım + ayarlar */}
        <div style={{ flex: '1 1 400px', minWidth: 0 }}>
          <div style={panel}>
            <div style={label}>En uygun fiyatla dağıt</div>
            <div style={{ ...muted, margin: '4px 0 8px', lineHeight: 1.55 }}>
              Market maddelerinize ürün seçin; yakınınızdaki marketlerin fiyatlarına bakıp en çok <b>{maxMarkets}</b> markete bölünmüş en ucuz alışveriş planını çıkarır.
            </div>
            {!supported && <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px' }}>Market fiyatları yalnızca masaüstü ve telefon uygulamasında çalışır.</div>}
            {supported && !loc && <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px' }}>Önce konumunuzu girin (aşağıda "Konum ve market ayarları").</div>}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" style={btn} disabled={!supported || pricing || !marketItems.some(i => !i.urun)} onClick={() => void autoMatch()} title="Eşlenmemiş market maddeleri için aramadaki ilk uygun ürünü seçer (kontrol edin)">Otomatik eşle ({marketItems.filter(i => !i.urun).length})</button>
              <button type="button" style={btnPrimary} disabled={!supported || pricing} onClick={() => void getPrices()}>{pricing ? <RefreshCw size={13} className="animate-spin" /> : <ShoppingCart size={13} />} Fiyatları getir ve dağıt</button>
            </div>
            {priceMsg && <div style={{ fontSize: '12px', color: pricing ? 'var(--text-muted)' : '#f59e0b', marginTop: '8px', overflowWrap: 'anywhere' }}>{priceMsg}</div>}
          </div>

          <div style={{ ...panel, marginTop: '12px' }}>
            <div style={label}>Haftalık market hedefi</div>
            {wm ? (
              <div style={{ marginTop: '6px', fontSize: '12.5px', lineHeight: 1.6 }}>
                <b>≈ {tl(wm.haftalik)}</b> / hafta
                <div style={muted}>{wm.month} ekstrelerindeki market harcamanız {tl(wm.aylik)}; öneri kuralıyla {tl(wm.kisma)} kısıp 4,3 haftaya bölünmüştür. (Bütçe Planı'ndaki ekstre dağılımından.)</div>
                {plan && (() => {
                  const pct = wm.haftalik > 0 ? plan.plan.total / wm.haftalik : 0;
                  return (
                    <div style={{ marginTop: '6px' }}>
                      <div style={{ height: '10px', background: 'var(--bg-tertiary)', borderRadius: '5px', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: pct <= 1 ? '#22c55e' : '#ef4444' }} /></div>
                      <div style={{ fontSize: '12px', marginTop: '4px', color: pct <= 1 ? '#22c55e' : '#ef4444' }}>Bu haftanın planı {tl(plan.plan.total)} · hedefin %{Math.round(pct * 100)}'i{pct > 1 ? ' (hedefi aşıyor)' : ''}</div>
                    </div>
                  );
                })()}
              </div>
            ) : <div style={{ ...muted, marginTop: '6px' }}>Bütçe Planı'na kart ekstresi PDF'i ekleyince (market harcamanız çıkar) haftalık hedef burada görünür.</div>}
          </div>

          {plan && (
            <div style={{ ...panel, marginTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ ...label, flex: 1 }}>Plan · {tl(plan.plan.total)}</div>
                <button type="button" style={btn} onClick={() => void copyPlan()}><Copy size={12} /> {copied ? 'Kopyalandı' : 'Kopyala'}</button>
                <button type="button" style={btn} onClick={savePlanToNote} title={`${path} notuna "Fiyat planı" bölümü olarak yazar`}><FileText size={12} /> {planSaved ? 'Nota yazıldı ✓' : 'Nota kaydet'}</button>
              </div>
              {plan.plan.markets.map(m => (
                <div key={m.market} style={{ marginTop: '10px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 10px' }}>
                  <div style={{ display: 'flex', fontSize: '13px', fontWeight: 700 }}><span style={{ flex: 1 }}>{marketLabel(m.market)}</span><span>{tl(m.total)}</span></div>
                  {m.lines.map(l => (
                    <div key={l.key} style={{ display: 'flex', gap: '8px', fontSize: '12px', marginTop: '3px' }}>
                      <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{l.name}{l.qty > 1 ? ` ×${l.qty}` : ''} <span style={muted}>· {plan.names[l.key]}</span></span>
                      <span style={{ whiteSpace: 'nowrap' }}>{l.qty > 1 ? `${l.qty} × ${tl(l.price)} = ` : ''}{tl(l.total)}</span>
                    </div>
                  ))}
                </div>
              ))}
              {plan.plan.bestSingle && plan.plan.markets.length > 1 && (
                <div style={{ fontSize: '12px', marginTop: '10px', lineHeight: 1.6 }}>
                  En iyi tek market: <b>{marketLabel(plan.plan.bestSingle.market)} {tl(plan.plan.bestSingle.total)}</b>{plan.plan.bestSingle.missing ? ` (${plan.plan.bestSingle.missing} ürün orada bulunamıyor)` : ''}.
                  {plan.plan.saving > 0 && <> Bölerek <b style={{ color: '#22c55e' }}>{tl(plan.plan.saving)}</b> kazanırsınız.</>}
                </div>
              )}
              {plan.plan.missing.length > 0 && <div style={{ display: 'flex', gap: '6px', fontSize: '12px', color: '#f59e0b', marginTop: '8px' }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} /> <span>Seçili marketlerde bulunamadı: {plan.plan.missing.join(', ')}</span></div>}
              {plan.notFound.length > 0 && <div style={{ display: 'flex', gap: '6px', fontSize: '12px', color: '#f59e0b', marginTop: '6px' }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} /> <span>Güncel fiyatı alınamadı: {plan.notFound.join(', ')}</span></div>}
              {plan.unbound.length > 0 && <div style={{ ...muted, marginTop: '6px' }}>Ürün seçilmediği için hesaba girmedi: {plan.unbound.join(', ')}</div>}
              <div style={{ ...muted, marginTop: '8px' }}>Tahmini fiyatlar · kaynak: marketfiyati.org.tr{plan.oldest ? ` · en eski veri: ${plan.oldest}` : ''} · mağaza raf fiyatı farklı olabilir.</div>
            </div>
          )}

          <div style={{ ...panel, marginTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ ...label, flex: 1 }}>İndirim radarı</div>
              <button type="button" style={btn} disabled={!supported || radar?.loading} onClick={() => void runRadar()}>{radar?.loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />} Tara</button>
            </div>
            {!radar && <div style={{ ...muted, marginTop: '6px', lineHeight: 1.55 }}>Listenizdeki ve son haftalarda aldığınız ürünlerde (ürün seçilmiş olanlar) indirim ve fiyat düşüşü arar.</div>}
            {radar?.loading && <div style={{ ...muted, marginTop: '6px' }}>{radar.n} ürün taranıyor…</div>}
            {radar?.err && <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '6px', overflowWrap: 'anywhere' }}>{radar.err}</div>}
            {radar && !radar.loading && !radar.err && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {radar.hits.length === 0 && radar.falling.length === 0 && <div style={muted}>{radar.n} ürün tarandı; şu an belirgin indirim ya da fiyat düşüşü yok.</div>}
                {radar.hits.map(h => (
                  <div key={h.product.id} style={{ fontSize: '12.5px', display: 'flex', gap: '8px' }}>
                    <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{h.product.title}</span>
                    <span style={{ whiteSpace: 'nowrap' }}><b style={{ color: '#22c55e' }}>%{h.discount.toLocaleString('tr-TR')} indirim</b> · {marketLabel(h.market)} {tl(h.price)}</span>
                  </div>
                ))}
                {radar.falling.map(f => (
                  <div key={f.title} style={{ fontSize: '12.5px', display: 'flex', gap: '8px' }}>
                    <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{f.title}</span>
                    <span style={{ whiteSpace: 'nowrap' }}><b style={{ color: '#22c55e' }}>↓ %{Math.abs(f.pct).toLocaleString('tr-TR')}</b> · {marketLabel(f.market)} {tl(f.price)}</span>
                  </div>
                ))}
                <div style={muted}>Tahmini · kaynak: marketfiyati.org.tr · fiyat geçmişi {HISTORY_PATH} notunda.</div>
              </div>
            )}
          </div>

          <div style={{ ...panel, marginTop: '12px' }}>
            <button type="button" onClick={() => setShowLoc(s => !s)} style={{ ...btn, background: 'none', border: 'none', padding: 0, color: 'var(--text-primary)' }}><MapPin size={14} /> Konum ve market ayarları {showLoc ? '▾' : '▸'}</button>
            {showLoc && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ ...muted, lineHeight: 1.55 }}>Konum <b>yaklaşık</b> (≈1 km) saklanır ve yalnızca yakındaki marketleri bulmak için marketfiyati.org.tr'ye gönderilir; tam adres hiçbir yere gitmez. Google Haritalar'da mahallenize sağ tıklayıp koordinatı kopyalayabilirsiniz.</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={latS} onChange={(e) => setLatS(e.target.value)} placeholder="Enlem (örn. 41.02)" aria-label="Enlem" style={{ ...field, width: '120px' }} />
                  <input value={lonS} onChange={(e) => setLonS(e.target.value)} placeholder="Boylam (örn. 29.18)" aria-label="Boylam" style={{ ...field, width: '120px' }} />
                  <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>yarıçap <input value={kmS} onChange={(e) => setKmS(e.target.value)} aria-label="Yarıçap km" style={{ ...field, width: '44px' }} /> km</label>
                  <button type="button" style={btn} onClick={findMe}><MapPin size={12} /> Konumumu bul</button>
                  <button type="button" style={btnPrimary} onClick={saveLocation}>Kaydet</button>
                </div>
                <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>En çok
                  <select value={maxMarkets} onChange={(e) => { const v = Number(e.target.value); setMaxMarkets(v); try { localStorage.setItem(MAX_MARKETS_KEY, String(v)); } catch { /* yoksay */ } }} style={field} aria-label="En çok market sayısı">
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select> markete bölünsün</label>
                <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>Şehir/ilçe (web fiyat araştırması için, isteğe bağlı)
                  <input value={place} onChange={(e) => { setPlace(e.target.value); try { localStorage.setItem('shop_place_v1', e.target.value); } catch { /* yoksay */ } }} placeholder="örn. İstanbul" aria-label="Şehir veya ilçe" style={{ ...field, width: '150px' }} />
                </label>
                <div style={{ ...muted, marginTop: '-4px' }}>Yalnızca "Fiyat araştır" aramasında yapay zekâ servisine gider.</div>
                {reminderSupported() && (
                  <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <input type="checkbox" checked={remOn} onChange={(e) => void toggleReminder(e.target.checked)} aria-label="Pazartesi hatırlatması" /> Her Pazartesi 09:00'da "alışveriş listesini hazırla" bildirimi
                  </label>
                )}
                {remMsg && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{remMsg}</div>}
                {locMsg && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{locMsg}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
