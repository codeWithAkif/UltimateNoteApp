import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ShoppingCart, Plus, Trash2, Check, Search, ChevronLeft, ChevronRight, MapPin, Sparkles, RefreshCw, X, Copy, AlertTriangle, FileText, Pin, ArrowDownUp, Archive, Download, Ban } from 'lucide-react';
import {
  type ShopWeek, type ShopItem, MARKET_CAT, weekIdOf, weekPath, shiftWeek, weekLabel, parseWeek, serializeWeek, withPlanBlock, listWeeks, recentHistory
} from '../services/shopping';
import { LIST_PATH, INBOX_CAT, DEFAULT_LIST_CATS, type LItem, parseList, ensureList, listAdd, listToggle, listRemove, listSetQty, listMove, archiveDone, legacyOpenItems, guessCat } from '../services/shopList';
import { type Pref, fold, parsePrefs, serializePrefs, findPref, learnPref, removePref, rankProducts, legacySuggestions, brandOf, preferredBrands, PREFS_PATH, setHedef, targetHits, type TargetHit } from '../services/shopPrefs';
import { notifyNow, requestNotifyPermission } from '../services/shopNotify';
import { type BoycottEntry, BOYCOTT_PATH, parseBoycott, serializeBoycott, addBoycott, removeBoycott, matchBoycott, pickAlternatives } from '../services/boycott';
import { proposeBoycott, askOwner, type BoycottCandidate, type OwnerInfo } from '../services/boycottAI';
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
const btnSm: React.CSSProperties = { ...btn, padding: '2px 8px', fontSize: '11.5px', fontWeight: 500 };
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' };
const muted: React.CSSProperties = { fontSize: '11.5px', color: 'var(--text-muted)' };
const banner: React.CSSProperties = { ...{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px 12px' }, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12.5px', lineHeight: 1.5 };
const tl = (n: number) => `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const MAX_MARKETS_KEY = 'market_max_v1';
const EXCLUDE_KEY = 'shop_exclude_boycott_v1';
const IMPORTED_KEY = 'shop_imported_v2';
const PIN_HINT_KEY = 'shop_pin_hint_hidden_v1';
const sameText = (a: string, b: string) => a.toLocaleLowerCase('tr') === b.toLocaleLowerCase('tr');

interface Picker { key: string; q: string; loading: boolean; results: MarketProduct[]; err: string; searched: boolean; alt: boolean }
type Tab = 'liste' | 'haftalar' | 'tercih';

// Bir notun içeriğini yerel olarak da tutar: kayıt dosya sistemine yansıyana kadar ekran eski hâle dönmesin, art arda işlemler son içeriği kullansın
function useNote(path: string, fileContents: Record<string, string>, onSaveNote: ((p: string, c: string) => Promise<void>) | undefined, ready: boolean) {
  const [local, setLocal] = useState<{ path: string; content: string } | null>(null);
  const raw = fileContents[path];
  const content = local && local.path === path ? local.content : raw;
  const ref = useRef<string | undefined>(content); ref.current = content;
  useEffect(() => { if (local && local.path === path && raw === local.content) setLocal(null); }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  // VERİ KAYBI KORUMASI: notlar henüz yüklenmediyse (fileContents boş) ya da ilk bulut senkronu bitmediyse yazılmaz; "yok" görünen not aslında yüklenmemiş olabilir
  const write = (c: string) => { if (!ready || c === ref.current) return; ref.current = c; setLocal({ path, content: c }); void onSaveNote?.(path, c); };
  return { content, ref, write };
}

export default function ShoppingView({ fileContents, onSaveNote, onOpenNote, pinnedWidget, onPinWidget, ready = true }: {
  fileContents: Record<string, string>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onOpenNote?: (path: string) => void;
  pinnedWidget?: string | null;
  onPinWidget?: (path: string) => void | Promise<void>;
  ready?: boolean; // notlar yüklendi ve ilk senkron bitti
}) {
  const thisWeek = weekIdOf(new Date());
  const isNative = Capacitor.isNativePlatform();
  const [tab, setTab] = useState<Tab>('liste');

  // ---- notlar: canlı liste, tercihler, boykot listesi, fiyat geçmişi, bu haftanın arşivi ve gezilen hafta
  const listNote = useNote(LIST_PATH, fileContents, onSaveNote, ready);
  const prefsNote = useNote(PREFS_PATH, fileContents, onSaveNote, ready);
  const boyNote = useNote(BOYCOTT_PATH, fileContents, onSaveNote, ready);
  const thisWeekNote = useNote(weekPath(thisWeek), fileContents, onSaveNote, ready);
  const [weekId, setWeekId] = useState(thisWeek);
  const viewWeekNote = useNote(weekPath(weekId), fileContents, onSaveNote, ready);

  const model = useMemo(() => parseList(listNote.content), [listNote.content]);
  const items = model.items;
  const prefs = useMemo(() => parsePrefs(prefsNote.content), [prefsNote.content]);
  const boycott = useMemo(() => parseBoycott(boyNote.content), [boyNote.content]);
  const thisWeekData = useMemo(() => parseWeek(thisWeekNote.content, thisWeek), [thisWeekNote.content, thisWeek]);
  const viewWeek = useMemo(() => parseWeek(viewWeekNote.content, weekId), [viewWeekNote.content, weekId]);

  const writeList = (c: string) => listNote.write(c);
  const curList = () => ensureList(listNote.ref.current);
  const curPrefs = () => parsePrefs(prefsNote.ref.current);
  const writePrefs = (p: Pref[]) => prefsNote.write(serializePrefs(p));
  const curBoy = () => parseBoycott(boyNote.ref.current);
  const writeBoy = (b: BoycottEntry[]) => boyNote.write(serializeBoycott(b));
  const key = (it: LItem) => `${it.line}:${it.text}`;

  // ---- ekleme
  const [text, setText] = useState('');
  const [kat, setKat] = useState(MARKET_CAT);
  const [newKat, setNewKat] = useState('');
  const cats = useMemo(() => {
    const seen: string[] = [];
    for (const c of [...DEFAULT_LIST_CATS, ...items.map(i => i.kat)]) if (c !== INBOX_CAT && !seen.includes(c)) seen.push(c);
    return seen;
  }, [items]);
  const add = () => {
    const k = kat === '__yeni' ? newKat.trim() : kat;
    if (!text.trim() || !k) return;
    writeList(listAdd(curList(), k, text));
    setText('');
    if (kat === '__yeni') { setKat(k); setNewKat(''); }
  };
  const toggle = (it: LItem) => writeList(listToggle(curList(), it.line, it.text));
  const remove = (it: LItem) => writeList(listRemove(curList(), it.line, it.text));
  const setQty = (it: LItem, q: number) => writeList(listSetQty(curList(), it.line, it.text, q));
  const moveTo = (it: LItem, k: string) => {
    writeList(listMove(curList(), it.line, it.text, k));
    writePrefs(learnPref(curPrefs(), it.text, { kat: k })); // kategori öğrenilir: aynı madde telefondan gelince doğru bölüme sıralanır
  };

  // ---- banner'lar: telefondan gelenleri sırala, alınanları arşivle, eski notlardan içe aktar
  const inboxItems = items.filter(i => i.kat === INBOX_CAT && !i.done);
  const learnedCats = useMemo(() => Object.fromEntries(prefs.filter(p => p.kat).map(p => [p.label.toLocaleLowerCase('tr'), p.kat as string])), [prefs]);
  const sortInbox = () => {
    let c = curList();
    let n = 0;
    for (const it of parseList(c).items.filter(i => i.kat === INBOX_CAT && !i.done)) {
      const p = findPref(curPrefs(), it.text);
      const k = p?.kat || guessCat(it.text, learnedCats);
      if (!k) continue;
      const m = parseList(c).items.find(x => x.kat === INBOX_CAT && x.text === it.text);
      if (!m) continue;
      c = listMove(c, m.line, m.text, k); n++;
    }
    if (n) writeList(c);
    setMsg(n ? `${n} madde sıralandı.` : 'Hiçbir maddenin kategorisi tahmin edilemedi; maddelerin yanındaki kategori seçiciyle taşıyın (öğrenilir).');
  };
  const doneItems = items.filter(i => i.done);
  const archive = () => {
    const r = archiveDone(curList());
    if (!r.done.length) return;
    const w = parseWeek(thisWeekNote.ref.current, thisWeek);
    const add: ShopItem[] = r.done.map((d, i) => ({ id: `a${Date.now().toString(36)}${i}`, kat: d.kat === INBOX_CAT ? 'Diğer' : d.kat, text: d.text, done: true, adet: d.adet > 1 ? d.adet : undefined }));
    thisWeekNote.write(serializeWeek({ ...w, items: [...w.items, ...add] }));
    writeList(r.content);
    setMsg(`${r.done.length} alınan madde ${thisWeek} haftasına arşivlendi.`);
  };

  const legacyKey = useMemo(() => Object.keys(fileContents).find(k => /^alınacaklar\/market\.md$/i.test(k)), [fileContents]);
  const legacyItems = useMemo(() => (legacyKey ? legacyOpenItems(fileContents[legacyKey]) : []), [legacyKey, fileContents]);
  const weekUndone = thisWeekData.items.filter(i => !i.done);
  const [imported, setImported] = useState(() => { try { return localStorage.getItem(IMPORTED_KEY) === '1'; } catch { return false; } });
  const importCount = new Set([...legacyItems.map(t => t.toLocaleLowerCase('tr')), ...weekUndone.map(i => i.text.toLocaleLowerCase('tr'))]).size;
  const hideImport = () => { setImported(true); try { localStorage.setItem(IMPORTED_KEY, '1'); } catch { /* yoksay */ } };
  const importLegacy = () => {
    let c = curList();
    const have = new Set(parseList(c).items.map(i => i.text.toLocaleLowerCase('tr')));
    let pl = curPrefs();
    let n = 0;
    for (const it of weekUndone) {
      if (have.has(it.text.toLocaleLowerCase('tr'))) continue;
      c = listAdd(c, it.kat, it.text, it.adet || 1); have.add(it.text.toLocaleLowerCase('tr')); n++;
      pl = learnPref(pl, it.text, { kat: it.kat }); // özel kategoriler (E-Bebek, Ev Tadilat…) öğrenilir: telefondan gelen aynı madde doğru bölüme sıralanır
      if (it.urun) {
        // marka yalnızca ürün başlığının ilk sözcüğü madde metninde de geçiyorsa alınır ("Bingo çamaşır deterjanı" → Bingo); aksi hâlde tahmin edilmez
        const first = brandOf({ title: it.urun.title });
        const inText = fold(it.text).split(/[^a-z0-9]+/).includes(fold(first));
        pl = learnPref(pl, it.text, { urun: it.urun, marka: inText ? first : undefined });
      }
    }
    for (const t of legacyItems) {
      if (have.has(t.toLocaleLowerCase('tr'))) continue;
      c = listAdd(c, guessCat(t, learnedCats) || MARKET_CAT, t); have.add(t.toLocaleLowerCase('tr')); n++;
    }
    writeList(c); writePrefs(pl);
    // haftalık nottan alınmayanlar artık listede yaşar; haftalık not kayıt (alınanlar + fiyat planı) olarak kalır
    if (weekUndone.length) thisWeekNote.write(serializeWeek({ ...thisWeekData, items: thisWeekData.items.filter(i => i.done) }));
    hideImport();
    setMsg(`${n} madde içe aktarıldı. Eski not (${legacyKey || '—'}) olduğu gibi duruyor.`);
  };

  const [msg, setMsg] = useState('');
  const [pinHintHidden, setPinHintHidden] = useState(() => { try { return localStorage.getItem(PIN_HINT_KEY) === '1'; } catch { return false; } });
  const isPinned = pinnedWidget === LIST_PATH;

  // ---- konum + market ayarları
  const supported = isMarketSupported();
  const [loc, setLoc] = useState<MarketLoc | null>(() => loadLoc());
  const [showLoc, setShowLoc] = useState(false);
  const [latS, setLatS] = useState(loc ? String(loc.lat) : '');
  const [lonS, setLonS] = useState(loc ? String(loc.lon) : '');
  const [kmS, setKmS] = useState(loc ? String(loc.km) : '3');
  const [maxMarkets, setMaxMarkets] = useState(() => { try { return Math.min(4, Math.max(1, Number(localStorage.getItem(MAX_MARKETS_KEY)) || 2)); } catch { return 2; } });
  const [excludeBoy, setExcludeBoy] = useState(() => { try { return localStorage.getItem(EXCLUDE_KEY) !== '0'; } catch { return true; } });
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

  // ---- ürün bağı (tercihlerden) + boykot durumu
  const [prices, setPrices] = useState<Record<string, MarketProduct>>({});
  const bound = (it: LItem) => findPref(prefs, it.text)?.urun;
  const boyOf = (it: LItem): BoycottEntry | null => {
    const u = bound(it);
    if (!u) return null;
    const p = prices[u.id];
    return matchBoycott({ brand: p?.brand || findPref(prefs, it.text)?.marka, title: p?.title || u.title }, boycott);
  };

  // ---- ürün seçici / alternatifler
  const [picker, setPicker] = useState<Picker | null>(null);
  const stripSize = (s: string) => s.replace(/\d+\s*(adet|lt|l|kg|gr|g|ml|li|lı)\b/gi, '').replace(/\s+/g, ' ').trim();
  const openPicker = (it: LItem, alt = false) => {
    const brand = findPref(prefs, it.text)?.marka;
    let q = stripSize(it.text) || it.text;
    if (alt && brand) q = q.split(' ').filter(w => w.toLocaleLowerCase('tr') !== brand.toLocaleLowerCase('tr')).join(' ') || q;
    setPicker({ key: key(it), q, loading: false, results: [], err: '', searched: false, alt });
  };
  const runSearch = async (it: LItem, q: string, alt: boolean) => {
    if (!loc) { setPicker(p => p && { ...p, err: 'Önce konumunuzu girin (sağdaki "Konum ve market ayarları").' }); return; }
    setPicker(p => p && { ...p, loading: true, err: '', q });
    try {
      const r = await searchProducts(loc, q, alt ? 24 : 12);
      const out = alt ? pickAlternatives(r, boycott, preferredBrands(prefs), brandOf, 8) : rankProducts(r, prefs, it.text);
      setPicker(p => p && { ...p, loading: false, results: out, searched: true, err: out.length ? '' : alt ? 'Boykot listenizin dışında alternatif bulunamadı; farklı bir arama deneyin.' : 'Ürün bulunamadı; daha kısa/genel yazmayı deneyin.' });
    } catch (e: any) { setPicker(p => p && { ...p, loading: false, err: String(e?.message || e) }); }
  };
  const choose = (it: LItem, p: MarketProduct) => {
    writePrefs(learnPref(curPrefs(), it.text, { urun: { id: p.id, title: p.title }, marka: brandOf(p) }));
    setPrices(m => ({ ...m, [p.id]: p }));
    setPicker(null);
  };

  // ---- fiyatlar + en uygun dağıtım
  const [pricing, setPricing] = useState(false);
  const [priceMsg, setPriceMsg] = useState('');
  const [plan, setPlan] = useState<{ plan: BasketPlan; unbound: string[]; notFound: string[]; names: Record<string, string>; oldest: string; boycott: { name: string; marka: string }[] } | null>(null);
  const marketItems = items.filter(i => i.kat === MARKET_CAT && !i.done);

  const autoMatch = async () => {
    if (!loc) { setPriceMsg('Önce konumunuzu girin.'); return; }
    const todo = marketItems.filter(i => !bound(i)).slice(0, 15);
    if (!todo.length) return;
    setPricing(true); setPriceMsg('Ürünler eşleniyor…');
    let pl = curPrefs();
    const got: MarketProduct[] = [];
    let fail = 0;
    try {
      for (const it of todo) {
        try {
          const r = rankProducts(await searchProducts(loc, stripSize(it.text) || it.text, 8), pl, it.text);
          // boykot listesindeki markalar otomatik eşlemede seçilmez
          const pool = r.filter(p => !matchBoycott(p, boycott));
          const pick = pool.find(p => p.offers.length >= 2) || pool[0];
          if (pick) { pl = learnPref(pl, it.text, { urun: { id: pick.id, title: pick.title }, marka: brandOf(pick) }); got.push(pick); } else fail++;
        } catch (e: any) { setPriceMsg(String(e?.message || e)); fail++; break; }
      }
    } finally { setPricing(false); }
    if (got.length) { writePrefs(pl); setPrices(m => ({ ...m, ...Object.fromEntries(got.map(g => [g.id, g])) })); }
    setPriceMsg(`${got.length} ürün otomatik eşlendi${fail ? `, ${fail} tanesi bulunamadı` : ''}. Yanlışsa ürün adına tıklayıp değiştirin.`);
  };

  // ---- fiyat geçmişi (Alışveriş/Fiyat Geçmişi.md)
  const histNote = useNote(HISTORY_PATH, fileContents, onSaveNote, ready);
  const histRef = useRef<PriceRec[]>(parseHistory(histNote.content));
  useEffect(() => { histRef.current = parseHistory(histNote.content); }, [histNote.content]);
  const saveHistory = (products: MarketProduct[]) => {
    if (!products.length) return;
    const next = addRecords(histRef.current, dayOf(new Date()), products);
    histRef.current = next;
    histNote.write(serializeHistory(next));
  };
  const trendBadge = (pr: MarketProduct) => {
    const price = pr.offers[0]?.price;
    if (!price) return null;
    const tr = trendOf(histRef.current, pr.id, price, dayOf(new Date()));
    if (tr.lowest) return <span style={{ fontSize: '11.5px', color: '#22c55e', fontWeight: 700 }}>30 günün en düşük fiyatı</span>;
    if (tr.pct !== undefined && Math.abs(tr.pct) >= 2) return <span style={{ fontSize: '11.5px', color: tr.pct < 0 ? '#22c55e' : '#ef4444' }}>{tr.pct < 0 ? '↓' : '↑'} %{Math.abs(tr.pct).toLocaleString('tr-TR')} ({tr.prevDate} → bugün)</span>;
    return null;
  };

  const getPrices = async () => {
    if (!loc) { setPriceMsg('Önce konumunuzu girin.'); return; }
    const withProd = marketItems.filter(i => bound(i)).slice(0, 30);
    const unbound = marketItems.filter(i => !bound(i)).map(i => i.text);
    if (!withProd.length) { setPriceMsg('Önce market maddelerine ürün seçin (maddenin yanındaki "Ürün seç" ya da "Otomatik eşle").'); return; }
    setPricing(true); setPriceMsg('Güncel fiyatlar getiriliyor…'); setPlan(null);
    const got: Record<string, MarketProduct> = { ...prices };
    const notFound: string[] = [];
    try {
      for (const it of withProd) {
        const u = bound(it)!;
        const cached = got[u.id];
        let p: MarketProduct | null = cached || null;
        try { p = await refreshProduct(loc, u.id, u.title); } catch (e: any) { if (!cached) throw e; }
        if (p) got[p.id] = p; else if (!cached) notFound.push(it.text);
      }
      setPrices(got);
      saveHistory(withProd.map(i => got[bound(i)!.id]).filter((x): x is MarketProduct => !!x));
      const flagged: { name: string; marka: string }[] = [];
      const basket = [] as { key: string; name: string; qty: number; offers: MarketProduct['offers'] }[];
      for (const i of withProd) {
        const pr = got[bound(i)!.id];
        if (!pr) continue;
        const bm = matchBoycott({ brand: pr.brand, title: pr.title }, boycott);
        if (bm && excludeBoy) { flagged.push({ name: i.text, marka: bm.marka }); continue; }
        basket.push({ key: key(i), name: i.text, qty: i.adet || 1, offers: pr.offers });
      }
      const names = Object.fromEntries(withProd.map(i => [key(i), got[bound(i)!.id]?.title || i.text]));
      const p = planBasket(basket, maxMarkets);
      const times = p.markets.flatMap(m => m.lines.map(l => { const it = withProd.find(b => key(b) === l.key); return it ? got[bound(it)!.id]?.offers.find(o => o.market === m.market)?.time || '' : ''; })).filter(Boolean).sort();
      setPlan({ plan: p, unbound, notFound, names, oldest: times[0] || '', boycott: flagged });
      setPriceMsg('');
    } catch (e: any) { setPriceMsg(String(e?.message || e)); }
    finally { setPricing(false); }
  };

  const planText = (): string => {
    if (!plan) return '';
    const lines = [`Alışveriş planı — tahmini fiyatlar, marketfiyati.org.tr`];
    for (const m of plan.plan.markets) { lines.push('', `${marketLabel(m.market)} — ${tl(m.total)}`); for (const l of m.lines) lines.push(`- ${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}: ${tl(l.total)}`); }
    lines.push('', `Toplam: ${tl(plan.plan.total)}`);
    return lines.join('\n');
  };
  const [copied, setCopied] = useState(false);
  const copyPlan = async () => { try { await navigator.clipboard.writeText(planText()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* yoksay */ } };

  // planı bu haftanın notuna "## Fiyat planı" olarak yaz (düz satırlar; madde/görev kutusu değil)
  const [planSaved, setPlanSaved] = useState(false);
  const savePlanToNote = () => {
    if (!plan) return;
    const lines = plan.plan.markets.map(m => `${marketLabel(m.market)} — ${tl(m.total)}: ${m.lines.map(l => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''} ${tl(l.total)}`).join(' · ')}`);
    lines.push(`Toplam: ${tl(plan.plan.total)} (tahmini, marketfiyati.org.tr, ${dayOf(new Date())})`);
    if (plan.plan.missing.length) lines.push(`Bulunamadı: ${plan.plan.missing.join(', ')}`);
    thisWeekNote.write(serializeWeek(withPlanBlock(parseWeek(thisWeekNote.ref.current, thisWeek), lines)));
    setPlanSaved(true); setTimeout(() => setPlanSaved(false), 2200);
  };

  // ---- web aramalı fiyat araştırma
  const aiReady = isGeminiConfigured();
  const [place, setPlace] = useState(() => { try { return localStorage.getItem('shop_place_v1') || ''; } catch { return ''; } });
  const [research, setResearch] = useState<Record<string, { loading: boolean; res?: Research; err?: string }>>({});
  const doResearch = async (it: LItem) => {
    const k = key(it);
    if (!aiReady) { setResearch(r => ({ ...r, [k]: { loading: false, err: 'Yapay zekâ ayarlı değil (Ayarlar > AI Mentor).' } })); return; }
    setResearch(r => ({ ...r, [k]: { loading: true } }));
    try { const res = await researchPrice(it.text, it.kat, place.trim() || undefined); setResearch(r => ({ ...r, [k]: { loading: false, res } })); }
    catch (e: any) { setResearch(r => ({ ...r, [k]: { loading: false, err: String(e?.message || e) } })); }
  };
  const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

  // ---- indirim radarı
  const [radar, setRadar] = useState<{ loading: boolean; hits: RadarHit[]; falling: { title: string; pct: number; price: number; market: string }[]; n: number; err?: string } | null>(null);
  const runRadar = async () => {
    if (!loc) { setRadar({ loading: false, hits: [], falling: [], n: 0, err: 'Önce konumunuzu girin.' }); return; }
    const ids = new Map<string, string>();
    for (const i of items) { const u = bound(i); if (u) ids.set(u.id, u.title); }
    for (const p of prefs) if (p.urun) ids.set(p.urun.id, p.urun.title);
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

  // ---- hedef fiyat uyarısı: ürüne hedef fiyat konur; fiyat hedefe inince banner + (izin varsa) bildirim. Günde bir kez otomatik kontrol edilir.
  const [hedefHits, setHedefHits] = useState<TargetHit[]>([]);
  const [targetBusy, setTargetBusy] = useState(false);
  const hedefCount = prefs.filter(p => p.hedef && p.urun).length;
  const checkTargets = async (manual = false) => {
    if (targetBusy) return;
    if (!loc || !supported) { if (manual) setMsg('Hedef fiyat kontrolü için konumunuzu girin (Konum ve market ayarları).'); return; }
    const withT = prefs.filter(p => p.hedef && p.urun).slice(0, 10);
    if (!withT.length) { if (manual) setMsg('Hedef fiyatı olan ürün yok: bir market maddesinin altındaki "hedef ₺" kutusuna fiyat yazın.'); return; }
    setTargetBusy(true);
    try {
      const got: MarketProduct[] = [];
      for (const pf of withT) { const pr = await refreshProduct(loc, pf.urun!.id, pf.urun!.title); if (pr) got.push(pr); }
      saveHistory(got);
      setPrices(m => ({ ...m, ...Object.fromEntries(got.map(g => [g.id, g])) }));
      const hits = targetHits(withT, got, pr => !!matchBoycott(pr, boycott));
      setHedefHits(hits);
      const today = dayOf(new Date());
      let seen: Record<string, string> = {};
      try { seen = JSON.parse(localStorage.getItem('shop_target_notified_v1') || '{}'); } catch { /* yoksay */ }
      for (const h of hits) if (seen[h.pref.key] !== today) { await notifyNow('Hedef fiyata ulaşıldı', `${h.product.title}: ${marketLabel(h.market)} ${tl(h.price)} (hedef ${tl(h.hedef)})`); seen[h.pref.key] = today; }
      try { localStorage.setItem('shop_target_notified_v1', JSON.stringify(seen)); } catch { /* yoksay */ }
      if (manual) setMsg(hits.length ? `${hits.length} ürün hedef fiyata ulaştı.` : `${got.length} ürün kontrol edildi; hedef fiyata ulaşan yok.`);
    } catch (e: any) { if (manual) setMsg(String(e?.message || e)); }
    finally { setTargetBusy(false); }
  };
  // ekran açılınca günde bir kez (notlar yüklendikten sonra)
  useEffect(() => {
    if (!ready || !supported || !loc || hedefCount === 0) return;
    const today = dayOf(new Date());
    try { if (localStorage.getItem('shop_target_check_v1') === today) return; localStorage.setItem('shop_target_check_v1', today); } catch { /* yoksay */ }
    void checkTargets(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hedefCount]);
  const saveHedef = (prefKey: string, raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (!raw.trim()) { writePrefs(setHedef(curPrefs(), prefKey, null)); return; }
    if (!Number.isFinite(v) || v <= 0) { setMsg('Hedef fiyat pozitif bir sayı olmalı.'); return; }
    writePrefs(setHedef(curPrefs(), prefKey, v));
    void requestNotifyPermission(); // izin yalnızca hedef koyulunca istenir
  };

  const wm = useMemo(() => weeklyMarketBudget(fileContents), [fileContents]);
  const [remOn, setRemOn] = useState(() => isReminderOn());
  const [remMsg, setRemMsg] = useState('');
  const toggleReminder = async (on: boolean) => { const r = await setReminder(on); setRemMsg(r.msg); if (r.ok) setRemOn(on); };

  // ---- neye ihtiyacım var (geçmiş haftaların arşivi + bu haftanın listesi)
  const [needs, setNeeds] = useState<Needs | null>(null);
  const [needsBusy, setNeedsBusy] = useState(false);
  const [needsErr, setNeedsErr] = useState('');
  const askNeedsNow = async () => {
    if (needsBusy) return;
    if (!aiReady) { setNeedsErr('Yapay zekâ ayarlı değil (Ayarlar > AI Mentor).'); return; }
    setNeedsBusy(true); setNeedsErr(''); setNeeds(null);
    try {
      const asWeek: ShopWeek = { id: thisWeek, extra: [], items: items.map(i => ({ id: key(i), kat: i.kat, text: i.text, done: i.done })) };
      setNeeds(await askNeeds({ week: asWeek, history: recentHistory(fileContents, thisWeek, 6) }));
    } catch (e: any) { setNeedsErr(String(e?.message || e)); }
    finally { setNeedsBusy(false); }
  };
  const addNeed = (n: { text: string; kat: string }) => writeList(listAdd(curList(), cats.includes(n.kat) ? n.kat : (guessCat(n.text, learnedCats) || n.kat || INBOX_CAT), n.text));

  // ---- tercihler sekmesi
  const prefSuggestions = useMemo(() => {
    const sources = [legacyKey ? fileContents[legacyKey] : '', ...listWeeks(fileContents).slice(0, 8).map(w => fileContents[weekPath(w)] || '')].filter(Boolean);
    return legacySuggestions(sources).filter(s => !findPref(prefs, s.label));
  }, [fileContents, legacyKey, prefs]);

  // ---- boykot sekmesi
  const [boyInput, setBoyInput] = useState('');
  const [boySrc, setBoySrc] = useState('');
  const [boyPaste, setBoyPaste] = useState('');
  const [cands, setCands] = useState<BoycottCandidate[] | null>(null);
  const [candBusy, setCandBusy] = useState(false);
  const [candErr, setCandErr] = useState('');
  const [owners, setOwners] = useState<Record<string, { loading: boolean; info?: OwnerInfo; err?: string }>>({});
  const addBoyManual = () => { const m = boyInput.trim(); if (!m) return; writeBoy(addBoycott(curBoy(), { marka: m, kaynak: boySrc.trim().startsWith('https://') ? boySrc.trim() : undefined, tarih: dayOf(new Date()), not: 'elle eklendi' })); setBoyInput(''); setBoySrc(''); };
  const pasteBoy = () => {
    let l = curBoy(); let n = 0;
    for (const line of boyPaste.split(/\r?\n/)) { const m = line.replace(/^[-*•]\s*/, '').trim(); if (!m) continue; const before = l.length; l = addBoycott(l, { marka: m, tarih: dayOf(new Date()), not: 'listenizden eklendi' }); if (l.length > before) n++; }
    writeBoy(l); setBoyPaste(''); setMsg(`${n} marka eklendi.`);
  };
  const fetchCands = async () => {
    if (candBusy) return;
    if (!aiReady) { setCandErr('Yapay zekâ ayarlı değil (Ayarlar > AI Mentor).'); return; }
    setCandBusy(true); setCandErr(''); setCands(null);
    try { setCands(await proposeBoycott(boycott, boySrc.trim().startsWith('http') ? [boySrc.trim()] : [])); }
    catch (e: any) { setCandErr(String(e?.message || e)); }
    finally { setCandBusy(false); }
  };
  const acceptCand = (c: BoycottCandidate) => { writeBoy(addBoycott(curBoy(), { marka: c.marka, kaynak: c.kaynak, tarih: dayOf(new Date()), not: [c.kategori, c.not].filter(Boolean).join(' · ') || undefined })); setCands(cs => cs && cs.filter(x => x.marka !== c.marka)); };
  const skipCand = (c: BoycottCandidate) => setCands(cs => cs && cs.filter(x => x.marka !== c.marka));
  const lookupOwner = async (marka: string) => {
    setOwners(o => ({ ...o, [marka]: { loading: true } }));
    if (!aiReady) { setOwners(o => ({ ...o, [marka]: { loading: false, err: 'Yapay zekâ ayarlı değil.' } })); return; }
    try { const info = await askOwner(marka); setOwners(o => ({ ...o, [marka]: { loading: false, info } })); }
    catch (e: any) { setOwners(o => ({ ...o, [marka]: { loading: false, err: String(e?.message || e) } })); }
  };

  // ---- gruplama: kategoriler dosyadaki sırayla, Yeni eklenenler hep sonda
  const groups = useMemo(() => {
    const order: string[] = [];
    for (const i of items) if (!order.includes(i.kat)) order.push(i.kat);
    const sorted = [...order.filter(k => k !== INBOX_CAT), ...order.filter(k => k === INBOX_CAT)];
    return sorted.map(k => ({ kat: k, items: items.filter(i => i.kat === k) }));
  }, [items]);

  const weeksWithNotes = listWeeks(fileContents).length;
  const tabBtn = (t: Tab, text: string): React.CSSProperties => ({ ...btn, background: tab === t ? 'var(--accent-color)' : 'var(--bg-hover)', color: tab === t ? '#fff' : 'var(--text-secondary)', border: '1px solid ' + (tab === t ? 'var(--accent-color)' : 'var(--border-color)') });

  const renderItem = (it: LItem) => {
    const k = key(it);
    const pref = findPref(prefs, it.text);
    const u = pref?.urun;
    const pr = u ? prices[u.id] : undefined;
    const boy = boyOf(it);
    return (
      <div key={k} style={{ borderTop: '1px solid var(--border-color)', padding: '6px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button type="button" onClick={() => toggle(it)} aria-label={it.done ? 'Alındı işaretini kaldır' : 'Alındı olarak işaretle'}
            style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1.5px solid var(--border-color)', background: it.done ? '#22c55e' : 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0, padding: 0 }}>
            {it.done && <Check size={12} color="#fff" />}
          </button>
          <span style={{ flex: 1, fontSize: '13px', textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--text-muted)' : 'var(--text-primary)', overflowWrap: 'anywhere' }}>{it.text}{it.detail.length > 0 && <span style={muted}> · {it.detail.map(d => d.trim()).join(' ')}</span>}</span>
          <input type="number" min={1} max={99} value={it.adet} onChange={(e) => setQty(it, Number(e.target.value))} aria-label={`${it.text} adedi`} title="Adet" style={{ ...field, width: '52px', padding: '4px 5px' }} />
          <button type="button" onClick={() => remove(it)} aria-label={`${it.text} sil`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '2px' }}><Trash2 size={14} /></button>
        </div>
        {it.kat === MARKET_CAT && !it.done && (
          <div style={{ marginLeft: '30px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
            {u ? (
              <>
                <button type="button" onClick={() => openPicker(it)} title="Ürünü değiştir" style={btnSm}>{u.title}</button>
                {pref?.marka && <span style={muted}>tercih: {pref.marka}</span>}
                {pref && <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Fiyat bu tutarın altına inince haber verilir">hedef ₺<input key={pref.key + (pref.hedef ?? '')} defaultValue={pref.hedef ?? ''} inputMode="decimal" aria-label={`${it.text} hedef fiyat`} onBlur={(e) => { if (e.target.value !== String(pref.hedef ?? '')) saveHedef(pref.key, e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} style={{ ...field, width: '64px', padding: '2px 5px', fontSize: '11.5px' }} /></label>}
                {pr && <span style={muted}>en ucuz: <b style={{ color: '#22c55e' }}>{marketLabel(pr.offers[0].market)} {tl(pr.offers[0].price)}</b>{pr.offers[1] ? ` · ${marketLabel(pr.offers[1].market)} ${tl(pr.offers[1].price)}` : ''}</span>}
              </>
            ) : <button type="button" onClick={() => openPicker(it)} style={{ ...btnSm }}><Search size={11} /> Ürün seç</button>}
            {boy && <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Ban size={11} /> Boykot listenizde: {boy.marka}</span>}
            {boy && <button type="button" onClick={() => openPicker(it, true)} style={btnSm}>Alternatif</button>}
          </div>
        )}
        {!it.done && (
          <div style={{ marginLeft: '30px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select value={it.kat} onChange={(e) => moveTo(it, e.target.value)} aria-label={`${it.text} kategorisi`} title="Kategoriyi değiştir (öğrenilir)" style={{ ...field, width: '112px', padding: '2px 3px', fontSize: '11.5px' }}>
              {[...new Set([...cats, it.kat])].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {it.kat === MARKET_CAT && pr && trendBadge(pr)}
            <button type="button" onClick={() => void doResearch(it)} disabled={research[k]?.loading} style={btnSm} title="Google araması ile güncel fiyat ve uygun yerleri araştırır (tahmini; kaynak bağlantısı gösterilir)">
              {research[k]?.loading ? <RefreshCw size={11} className="animate-spin" /> : <Search size={11} />} {it.kat === MARKET_CAT ? "Web'de ara" : 'Fiyat araştır'}
            </button>
          </div>
        )}
        {research[k] && !research[k].loading && (
          <div style={{ marginLeft: '30px', marginTop: '6px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 10px' }}>
            {research[k].err && <div style={{ fontSize: '12px', color: '#f59e0b', overflowWrap: 'anywhere' }}>{research[k].err}</div>}
            {research[k].res && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {research[k].res!.quotes.map((q, qi) => (
                  <div key={qi} style={{ fontSize: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <b>{q.yer}</b><span style={{ color: /bulunamad/i.test(q.fiyat) ? 'var(--text-muted)' : '#22c55e', fontWeight: 700 }}>{q.fiyat}</span>
                    {q.not && <span style={muted}>{q.not}</span>}
                    {q.kaynak && <a href={q.kaynak} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)', fontSize: '11.5px' }}>{host(q.kaynak)} ↗</a>}
                  </div>
                ))}
                {research[k].res!.ozet && <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{research[k].res!.ozet}</div>}
                <div style={muted}>Tahminidir: web aramasından derlendi, fiyatı kaynak sayfada doğrulayın.</div>
              </div>
            )}
            <button type="button" onClick={() => setResearch(r => { const n = { ...r }; delete n[k]; return n; })} style={{ ...btnSm, marginTop: '6px' }}><X size={11} /> Kapat</button>
          </div>
        )}
        {picker && picker.key === k && (
          <div style={{ marginLeft: '30px', marginTop: '6px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 10px' }}>
            <div style={{ ...muted, marginBottom: '4px' }}>{picker.alt ? 'Alternatif ürünler (boykot listenizdeki markalar hariç, tercih ettiğiniz markalar önde)' : 'Ürün seçin (tercih ettiğiniz markalar önde)'}</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input autoFocus value={picker.q} onChange={(e) => setPicker({ ...picker, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(it, picker.q, picker.alt); }} aria-label="Ürün ara" placeholder="Ürün adı (örn. çamaşır deterjanı)" style={{ ...field, flex: 1 }} />
              <button type="button" style={btnPrimary} disabled={picker.loading} onClick={() => void runSearch(it, picker.q, picker.alt)}>{picker.loading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />} Ara</button>
              <button type="button" style={btn} onClick={() => setPicker(null)} aria-label="Kapat"><X size={13} /></button>
            </div>
            {picker.err && <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '6px' }}>{picker.err}</div>}
            {!picker.searched && !picker.loading && !picker.err && <div style={{ ...muted, marginTop: '6px' }}>Adı düzenleyip "Ara"ya basın.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', maxHeight: '260px', overflowY: 'auto' }}>
              {picker.results.map(p => {
                const bm = matchBoycott(p, boycott);
                return (
                  <button key={p.id} type="button" onClick={() => choose(it, p)} style={{ textAlign: 'left', background: 'var(--bg-secondary)', border: '1px solid ' + (bm ? '#ef4444' : 'var(--border-color)'), borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', color: 'inherit' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 600 }}>{p.title}{p.size ? <span style={{ ...muted, fontWeight: 400 }}> · {p.size}</span> : null}{bm && <span style={{ color: '#ef4444', fontSize: '11px', marginLeft: '6px' }}>● boykot listenizde</span>}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{p.offers.map(o => `${marketLabel(o.market)} ${tl(o.price)}`).join(' · ')}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '16px 14px 70px', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <ShoppingCart size={22} color="var(--accent-color)" />
          <h2 style={{ margin: 0, fontSize: '20px' }}>Alışveriş</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button type="button" style={tabBtn('liste', 'Liste')} onClick={() => setTab('liste')}>Liste</button>
            <button type="button" style={tabBtn('haftalar', 'Haftalar')} onClick={() => setTab('haftalar')}>Haftalar</button>
            <button type="button" style={tabBtn('tercih', 'Tercih & Boykot')} onClick={() => setTab('tercih')}>Tercih &amp; Boykot</button>
          </div>
        </div>
        {msg && <div style={{ ...banner, marginTop: '10px', borderColor: '#22c55e' }}><span style={{ flex: 1 }}>{msg}</span><button type="button" style={btnSm} onClick={() => setMsg('')}><X size={11} /></button></div>}

        {/* ============ LİSTE ============ */}
        {tab === 'liste' && (
          <>
            <div style={{ ...muted, margin: '8px 0 12px', lineHeight: 1.6 }}>
              Canlı liste: <code>{LIST_PATH}</code> — telefondaki widget'ta görünen not. Telefondan eklediğiniz ve işaretlediğiniz her şey burada, buradan yaptığınız da widget'ta görünür.
              Fiyatlar <b>tahminidir</b> (marketfiyati.org.tr); kaynak ve saat gösterilir.
              {onOpenNote && <> <button type="button" style={{ ...btnSm, marginLeft: '6px' }} onClick={() => onOpenNote(LIST_PATH)}><FileText size={12} /> Notu aç</button></>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {hedefHits.length > 0 && (
                <div style={{ ...banner, borderColor: '#22c55e', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <b style={{ color: '#22c55e' }}>Hedef fiyata ulaşıldı</b>
                  {hedefHits.map(h => <div key={h.pref.key} style={{ fontSize: '12.5px' }}>{h.product.title}: <b>{marketLabel(h.market)} {tl(h.price)}</b> <span style={muted}>(hedef {tl(h.hedef)})</span></div>)}
                </div>
              )}
              {!ready && <div style={{ ...banner, borderColor: '#f59e0b' }}><RefreshCw size={15} className="animate-spin" /><span>Notlar yükleniyor ve bulutla senkronlanıyor… Bu sırada değişiklik yapılmaz (kaydedilmemiş bir not ezilmesin diye).</span></div>}
              {isNative && !isPinned && onPinWidget && (
                <div style={banner}><Pin size={15} /><span style={{ flex: 1 }}>Telefon widget'ı şu an {pinnedWidget ? <b>{pinnedWidget}</b> : 'hiçbir notu'} gösteriyor. Alışveriş listesini widget'ta görmek için sabitleyin.</span>
                  <button type="button" style={btnPrimary} onClick={() => { if (listNote.ref.current === undefined) writeList(ensureList(undefined)); void onPinWidget(LIST_PATH); }}><Pin size={13} /> Widget'a sabitle</button></div>
              )}
              {isNative && isPinned && <div style={{ ...banner, borderColor: '#22c55e' }}><Pin size={15} color="#22c55e" /><span>Bu liste widget'a sabitlenmiş ✓</span></div>}
              {!isNative && !pinHintHidden && (
                <div style={banner}><Pin size={15} /><span style={{ flex: 1 }}>Telefonda bu ekranı açıp <b>Widget'a sabitle</b> düğmesine bir kez basın; sonra widget'tan eklediğiniz her şey bu listeye düşer.</span>
                  <button type="button" style={btnSm} onClick={() => { setPinHintHidden(true); try { localStorage.setItem(PIN_HINT_KEY, '1'); } catch { /* yoksay */ } }}>Gizle</button></div>
              )}
              {!imported && importCount > 0 && (
                <div style={banner}><Download size={15} /><span style={{ flex: 1 }}>Eski notlarınızda <b>{importCount}</b> açık madde var{legacyKey ? ` (${legacyKey}` : ' ('}{weekUndone.length ? `${legacyKey ? ' + ' : ''}${thisWeek} haftalık notu` : ''}). Canlı listeye aktarılsın mı? Eski notlara dokunulmaz.</span>
                  <button type="button" style={btnPrimary} onClick={importLegacy}>İçe aktar</button><button type="button" style={btnSm} onClick={hideImport}>Gizle</button></div>
              )}
              {inboxItems.length > 0 && (
                <div style={banner}><ArrowDownUp size={15} /><span style={{ flex: 1 }}><b>{inboxItems.length}</b> yeni madde ("{INBOX_CAT}", telefondan gelenler). Kategorilerine sıralansın mı? Tahmin edilemeyenler yerinde kalır.</span>
                  <button type="button" style={btnPrimary} onClick={sortInbox}>Sırala</button></div>
              )}
              {doneItems.length > 0 && (
                <div style={banner}><Archive size={15} /><span style={{ flex: 1 }}><b>{doneItems.length}</b> alınan madde listede duruyor. {thisWeek} haftasına arşivlensin mi (kayıt olarak kalır, listeden çıkar)?</span>
                  <button type="button" style={btnPrimary} onClick={archive}>Arşivle</button></div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* SOL: liste */}
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div style={panel}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                      placeholder="Ne lazım? (örn. süt 1 lt, kış lastiği, palto kuru temizleme)" aria-label="Yeni madde" style={{ ...field, flex: '1 1 200px' }} />
                    <select value={kat} onChange={(e) => setKat(e.target.value)} style={field} aria-label="Kategori">
                      {cats.map(c => <option key={c} value={c}>{c}</option>)}
                      <option value="__yeni">+ Yeni kategori…</option>
                    </select>
                    {kat === '__yeni' && <input value={newKat} onChange={(e) => setNewKat(e.target.value)} placeholder="Kategori adı" aria-label="Yeni kategori adı" style={{ ...field, width: '130px' }} />}
                    <button type="button" style={{ ...btnPrimary, opacity: text.trim() && ready ? 1 : 0.6 }} disabled={!text.trim() || !ready} onClick={add}><Plus size={14} /> Ekle</button>
                  </div>
                </div>

                {groups.map(g => (
                  <div key={g.kat} style={{ ...panel, marginTop: '12px' }}>
                    <div style={{ ...label, marginBottom: '6px' }}>{g.kat} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· {g.items.filter(i => i.done).length}/{g.items.length}</span></div>
                    {g.items.map(renderItem)}
                  </div>
                ))}
                {items.length === 0 && <div style={{ ...muted, textAlign: 'center', padding: '28px 0' }}>Liste boş. Yukarıdan ya da telefondaki widget'tan ekleyin.</div>}

                {/* neye ihtiyacım var */}
                <div style={{ ...panel, marginTop: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ ...label, flex: 1 }}>Neye ihtiyacım var?</div>
                    <button type="button" style={btnPrimary} disabled={needsBusy} onClick={() => void askNeedsNow()}>{needsBusy ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />} Geçmişe bak</button>
                  </div>
                  {!needs && !needsErr && !needsBusy && <div style={{ ...muted, marginTop: '8px' }}>Arşivlenen önceki haftalara bakıp listede olmayan, düzenli aldığınız şeyleri hatırlatır.</div>}
                  {needsBusy && <div style={{ ...muted, marginTop: '8px' }}>Geçmiş listeler inceleniyor…</div>}
                  {needsErr && <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px', overflowWrap: 'anywhere' }}>{needsErr}</div>}
                  {needs && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {needs.ozet && <div style={{ fontSize: '12.5px', lineHeight: 1.55 }}>{needs.ozet}</div>}
                      {needs.oneriler.map((n, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '6px 10px' }}>
                          <div style={{ flex: 1, fontSize: '12.5px' }}><b>{n.text}</b> <span style={muted}>· {n.kat}</span><div style={muted}>{n.neden}</div></div>
                          <button type="button" style={btn} onClick={() => { addNeed(n); setNeeds(nd => nd && { ...nd, oneriler: nd.oneriler.filter((_, j) => j !== i) }); }}><Plus size={12} /> Ekle</button>
                        </div>
                      ))}
                      {needs.oneriler.length > 1 && <button type="button" style={{ ...btn, alignSelf: 'flex-start' }} onClick={() => { needs.oneriler.forEach(addNeed); setNeeds(nd => nd && { ...nd, oneriler: [] }); }}><Plus size={12} /> Hepsini ekle</button>}
                    </div>
                  )}
                </div>
              </div>

              {/* SAĞ: fiyat + dağıtım + ayarlar */}
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div style={panel}>
                  <div style={label}>En uygun fiyatla dağıt</div>
                  <div style={{ ...muted, margin: '4px 0 8px', lineHeight: 1.55 }}>
                    Market maddelerinize ürün seçin; yakınınızdaki marketlerin fiyatlarına bakıp en çok <b>{maxMarkets}</b> markete bölünmüş en ucuz planı çıkarır.{boycott.length > 0 && excludeBoy ? ' Boykot listenizdeki markalar plana alınmaz.' : ''}
                  </div>
                  {!supported && <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px' }}>Market fiyatları yalnızca masaüstü ve telefon uygulamasında çalışır.</div>}
                  {supported && !loc && <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px' }}>Önce konumunuzu girin (aşağıda "Konum ve market ayarları").</div>}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button type="button" style={btn} disabled={!supported || pricing || !marketItems.some(i => !bound(i))} onClick={() => void autoMatch()} title="Eşlenmemiş market maddeleri için tercihinizi ya da aramadaki ilk uygun ürünü seçer (kontrol edin)">Otomatik eşle ({marketItems.filter(i => !bound(i)).length})</button>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ ...label, flex: 1 }}>Plan · {tl(plan.plan.total)}</div>
                      <button type="button" style={btn} onClick={() => void copyPlan()}><Copy size={12} /> {copied ? 'Kopyalandı' : 'Kopyala'}</button>
                      <button type="button" style={btn} onClick={savePlanToNote} title={`${weekPath(thisWeek)} notuna "Fiyat planı" bölümü olarak yazar`}><FileText size={12} /> {planSaved ? 'Nota yazıldı ✓' : 'Nota kaydet'}</button>
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
                    {plan.boycott.length > 0 && <div style={{ display: 'flex', gap: '6px', fontSize: '12px', color: '#ef4444', marginTop: '8px' }}><Ban size={14} style={{ flexShrink: 0, marginTop: '1px' }} /> <span>Boykot listenizde olduğu için plana alınmadı: {plan.boycott.map(b => `${b.name} (${b.marka})`).join(', ')}. Maddenin yanındaki "Alternatif" ile başka ürün seçebilirsiniz.</span></div>}
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
                  {!radar && <div style={{ ...muted, marginTop: '6px', lineHeight: 1.55 }}>Listenizdeki ve tercih ettiğiniz ürünlerde indirim ve fiyat düşüşü arar.</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                    <span style={muted}>Hedef fiyatı olan ürün: <b>{hedefCount}</b> (günde bir kez kendiliğinden kontrol edilir)</span>
                    <button type="button" style={btnSm} disabled={!supported || targetBusy} onClick={() => void checkTargets(true)}>{targetBusy ? <RefreshCw size={11} className="animate-spin" /> : null} Şimdi kontrol et</button>
                  </div>
                  {radar?.loading && <div style={{ ...muted, marginTop: '6px' }}>{radar.n} ürün taranıyor…</div>}
                  {radar?.err && <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '6px', overflowWrap: 'anywhere' }}>{radar.err}</div>}
                  {radar && !radar.loading && !radar.err && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {radar.hits.length === 0 && radar.falling.length === 0 && <div style={muted}>{radar.n} ürün tarandı; şu an belirgin indirim ya da fiyat düşüşü yok.</div>}
                      {radar.hits.map(h => (
                        <div key={h.product.id} style={{ fontSize: '12.5px', display: 'flex', gap: '8px' }}>
                          <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{h.product.title}{matchBoycott(h.product, boycott) ? <span style={{ color: '#ef4444' }}> ● boykot</span> : null}</span>
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
                      <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <input type="checkbox" checked={excludeBoy} onChange={(e) => { setExcludeBoy(e.target.checked); try { localStorage.setItem(EXCLUDE_KEY, e.target.checked ? '1' : '0'); } catch { /* yoksay */ } }} aria-label="Boykot markalarını plana alma" /> Boykot listemdeki markaları plana alma</label>
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
          </>
        )}

        {/* ============ HAFTALAR (arşiv) ============ */}
        {tab === 'haftalar' && (
          <div style={{ marginTop: '12px', maxWidth: '760px' }}>
            <div style={{ ...muted, lineHeight: 1.6, marginBottom: '10px' }}>Her haftanın kaydı: alınan maddeler ve (varsa) fiyat planı. Canlı listedeki alınanları "Arşivle" ile haftaya taşırsınız. Not dosyası: <code>{weekPath(weekId)}</code> ({weeksWithNotes} haftalık not var).</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <button type="button" style={{ ...btn, padding: '5px 7px' }} onClick={() => setWeekId(shiftWeek(weekId, -1))} aria-label="Önceki hafta"><ChevronLeft size={15} /></button>
              <div style={{ minWidth: '170px', textAlign: 'center', fontWeight: 700, fontSize: '13.5px' }}>{weekId}<div style={{ ...muted, fontWeight: 400 }}>{weekLabel(weekId)}</div></div>
              <button type="button" style={{ ...btn, padding: '5px 7px' }} onClick={() => setWeekId(shiftWeek(weekId, 1))} aria-label="Sonraki hafta"><ChevronRight size={15} /></button>
              {weekId !== thisWeek && <button type="button" style={btn} onClick={() => setWeekId(thisWeek)}>Bu hafta</button>}
              {onOpenNote && viewWeekNote.content !== undefined && <button type="button" style={btn} onClick={() => onOpenNote(weekPath(weekId))}><FileText size={12} /> Notu aç</button>}
            </div>
            {viewWeek.items.length === 0 && viewWeek.extra.length === 0 && <div style={{ ...muted, padding: '20px 0' }}>Bu hafta için kayıt yok.</div>}
            {[...new Set(viewWeek.items.map(i => i.kat))].map(k => (
              <div key={k} style={{ ...panel, marginTop: '10px' }}>
                <div style={{ ...label, marginBottom: '6px' }}>{k}</div>
                {viewWeek.items.filter(i => i.kat === k).map(i => <div key={i.id} style={{ fontSize: '13px', padding: '3px 0', color: i.done ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{i.done ? '✓ ' : '• '}{i.text}{i.adet && i.adet > 1 ? ` ×${i.adet}` : ''}</div>)}
              </div>
            ))}
            {viewWeek.extra.filter(e => e.kat === 'Fiyat planı').length > 0 && (
              <div style={{ ...panel, marginTop: '10px' }}>
                <div style={{ ...label, marginBottom: '6px' }}>Fiyat planı</div>
                {viewWeek.extra.filter(e => e.kat === 'Fiyat planı').map((e, i) => <div key={i} style={{ fontSize: '12.5px', padding: '2px 0', overflowWrap: 'anywhere' }}>{e.text}</div>)}
              </div>
            )}
          </div>
        )}

        {/* ============ TERCİH & BOYKOT ============ */}
        {tab === 'tercih' && (
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '12px' }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div style={panel}>
                <div style={label}>Tercihlerim</div>
                <div style={{ ...muted, margin: '4px 0 8px', lineHeight: 1.55 }}>Ürün seçtikçe öğrenilir ("çamaşır deterjanı → Bingo"). Ürün seçerken tercih ettiğiniz markalar öne gelir, telefondan markasız yazdığınız madde aynı ürüne bağlanır. Not: <code>{PREFS_PATH}</code></div>
                {prefs.length === 0 && <div style={muted}>Henüz tercih yok. Bir market maddesine "Ürün seç" ile ürün bağlayın.</div>}
                {prefs.map(p => (
                  <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-color)', padding: '6px 0', fontSize: '12.5px' }}>
                    <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><b>{p.label}</b>{p.marka ? <span style={muted}> · marka: {p.marka}</span> : null}{p.kat ? <span style={muted}> · {p.kat}</span> : null}{p.hedef ? <span style={{ ...muted, color: '#22c55e' }}> · hedef ≤ {tl(p.hedef)}</span> : null}{p.urun ? <div style={muted}>{p.urun.title}</div> : null}</div>
                    <button type="button" style={btnSm} onClick={() => writePrefs(removePref(curPrefs(), p.key))} aria-label={`${p.label} tercihini sil`}><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
              {prefSuggestions.length > 0 && (
                <div style={{ ...panel, marginTop: '12px' }}>
                  <div style={label}>Eski notlarınızdan tercih adayları</div>
                  <div style={{ ...muted, margin: '4px 0 8px' }}>Notlarınızda "X - Marka" biçiminde geçenler. Onaylarsanız tercih olur.</div>
                  {prefSuggestions.map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '12.5px' }}>
                      <span style={{ flex: 1 }}>{s.label} → <b>{s.marka}</b></span>
                      <button type="button" style={btn} onClick={() => writePrefs(learnPref(curPrefs(), s.label, { marka: s.marka }))}><Plus size={12} /> Ekle</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div style={panel}>
                <div style={label}>Boykot listem</div>
                <div style={{ ...muted, margin: '4px 0 8px', lineHeight: 1.55 }}>
                  Bu liste <b>size aittir</b>: yalnızca sizin onayladığınız markalar yazılır. Kaynaklar birbiriyle çelişebilir; her kayıtta kaynak bağlantısı vardır, kontrol edin. Boykotlu ürünler seçicide, listede ve planda işaretlenir; "Alternatif" ile başka ürün önerilir. Not: <code>{BOYCOTT_PATH}</code>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <input value={boyInput} onChange={(e) => setBoyInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addBoyManual(); }} placeholder="Marka adı" aria-label="Boykot markası" style={{ ...field, flex: '1 1 140px' }} />
                  <input value={boySrc} onChange={(e) => setBoySrc(e.target.value)} placeholder="Kaynak bağlantısı (isteğe bağlı, https://…)" aria-label="Kaynak bağlantısı" style={{ ...field, flex: '2 1 200px' }} />
                  <button type="button" style={btnPrimary} disabled={!boyInput.trim()} onClick={addBoyManual}><Plus size={13} /> Ekle</button>
                </div>
                <details style={{ marginTop: '8px' }}>
                  <summary style={{ ...muted, cursor: 'pointer' }}>Kendi listemi yapıştır (satır başına bir marka)</summary>
                  <textarea value={boyPaste} onChange={(e) => setBoyPaste(e.target.value)} rows={4} aria-label="Boykot listesi yapıştır" style={{ ...field, width: '100%', marginTop: '6px' }} placeholder={'Marka A\nMarka B'} />
                  <button type="button" style={{ ...btn, marginTop: '6px' }} disabled={!boyPaste.trim()} onClick={pasteBoy}>Listeye ekle</button>
                </details>
                {boycott.length === 0 && <div style={{ ...muted, marginTop: '10px' }}>Liste boş.</div>}
                {boycott.map(e => (
                  <div key={e.marka} style={{ borderTop: '1px solid var(--border-color)', padding: '6px 0', marginTop: '6px', fontSize: '12.5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <b style={{ flex: 1, overflowWrap: 'anywhere' }}>{e.marka}</b>
                      <button type="button" style={btnSm} onClick={() => void lookupOwner(e.marka)} disabled={owners[e.marka]?.loading}>{owners[e.marka]?.loading ? <RefreshCw size={11} className="animate-spin" /> : null} Kimin?</button>
                      <button type="button" style={btnSm} onClick={() => writeBoy(removeBoycott(curBoy(), e.marka))} aria-label={`${e.marka} sil`}><Trash2 size={11} /></button>
                    </div>
                    <div style={muted}>{[e.tarih, e.not].filter(Boolean).join(' · ')}{e.kaynak ? <> · <a href={e.kaynak} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)' }}>{host(e.kaynak)} ↗</a></> : null}</div>
                    {owners[e.marka]?.err && <div style={{ fontSize: '11.5px', color: '#f59e0b' }}>{owners[e.marka].err}</div>}
                    {owners[e.marka]?.info && <div style={{ fontSize: '12px', marginTop: '3px' }}>Sahibi: <b>{owners[e.marka].info!.sahip}</b>{owners[e.marka].info!.not ? <span style={muted}> · {owners[e.marka].info!.not}</span> : null}{owners[e.marka].info!.kaynak ? <> · <a href={owners[e.marka].info!.kaynak} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)' }}>{host(owners[e.marka].info!.kaynak)} ↗</a></> : null}<div style={muted}>Web aramasından derlendi; kaynakta doğrulayın.</div></div>}
                  </div>
                ))}
              </div>

              <div style={{ ...panel, marginTop: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ ...label, flex: 1 }}>Web'den aday getir</div>
                  <button type="button" style={btnPrimary} disabled={candBusy} onClick={() => void fetchCands()}>{candBusy ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />} Listeyi güncelle</button>
                </div>
                <div style={{ ...muted, margin: '4px 0 8px', lineHeight: 1.55 }}>BDS'nin güncel listesi ve bir ikinci kaynaktan aday markaları kaynak bağlantılarıyla getirir (yukarıdaki kaynak kutusuna bir adres yazarsanız onu da kullanır). <b>Hiçbiri kendiliğinden eklenmez</b>: her marka için "Ekle" ya da "Atla" dersiniz; kaynaklar çelişebilir.</div>
                {candBusy && <div style={muted}>Kaynaklar taranıyor (birkaç on saniye sürebilir)…</div>}
                {candErr && <div style={{ fontSize: '12px', color: '#f59e0b', overflowWrap: 'anywhere' }}>{candErr}</div>}
                {cands && cands.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
                    {cands.map(c => (
                      <div key={c.marka} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '6px 10px' }}>
                        <div style={{ flex: 1, fontSize: '12.5px', minWidth: 0 }}><b>{c.marka}</b>{c.kategori ? <span style={muted}> · {c.kategori}</span> : null}
                          <div style={muted}>{c.not}{c.kaynak ? <> {c.not ? '· ' : ''}<a href={c.kaynak} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)' }}>{host(c.kaynak)} ↗</a></> : ' · kaynak yok'}</div></div>
                        <button type="button" style={btn} onClick={() => acceptCand(c)}><Plus size={12} /> Ekle</button>
                        <button type="button" style={btnSm} onClick={() => skipCand(c)}>Atla</button>
                      </div>
                    ))}
                    <button type="button" style={{ ...btnSm, alignSelf: 'flex-start' }} onClick={() => setCands([])}>Hepsini atla</button>
                  </div>
                )}
                {cands && cands.length === 0 && <div style={muted}>Aday kalmadı.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
