import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiggyBank, Send, Undo2, Trash2, Plus, ChevronLeft, ChevronRight, Sparkles, Check, X, UserCog, AlertTriangle, RefreshCw, FileText, Paperclip, MessageCircle, Route, CalendarRange, Calculator, Repeat, Award } from 'lucide-react';
// Inter yazı tipi uygulamaya gömülüdür (internet gerekmez); Türkçe harfler için latin-ext dahil
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-600.css';
import { loadMonths, installmentPlan } from '../services/insights';
import {
  type Budget, type BudgetItem, type BudgetKind, type CheckedAction, KIND_LABEL, KIND_ORDER, monthPath, monthOf, shiftMonth, monthLabel, parseBudgetNote, serializeBudget,
  rollover, emptyBudget, mergeAnaliz, type SpendRow, recategorize, parseRules, serializeRules, applyRules, RULES_PATH, totals, cashflow, dailyAllowance, transition, checkActions, applyAction, applyActions, retarget, reindex, parseTL, fmtTL, round2
} from '../services/budget';
import { PERSONA_PATH, DEFAULT_PERSONA, askBudget, askAdvice, type Advice } from '../services/budgetAI';
import { isGeminiConfigured } from '../services/geminiMentor';
import { Waterfall, CashChart, SpendBars } from './BudgetCharts';
import BudgetInsights from './BudgetInsights';
import { readStatementPdf, type StatementText } from '../services/statementPdf';

// Nakit esaslı mantık: kalemler "o ay hesaptan çıkan/giren" paradır. Bu açıklama çift saymayı önler.
const HINT: Partial<Record<BudgetKind, string>> = {
  kart: 'Bu ay ÖDENECEK ekstreler (geçen ayın harcamaları). Ekstreyi ödendiği aya girin.',
  degisken: 'Yalnızca karta yazılmayanlar (nakit/banka kartı). Karttaki harcamalar sonraki ayın ekstresiyle gelir.'
};
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
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '16px 0 6px' };
const KIND_COLOR: Record<BudgetKind, string> = { gelir: '#22c55e', sabit: '#ef4444', kart: '#f97316', degisken: '#a855f7' };

interface ActState { check: CheckedAction; target?: { kind: BudgetKind; name: string }; state: 'bekliyor' | 'eklendi' | 'atlandi' | 'hata'; note?: string }
interface ChatEntry {
  id: string; role: 'user' | 'ai'; text: string; t: number; acts?: ActState[];
  analiz?: { kart: string; rows: SpendRow[]; toplam?: number; saved?: boolean }; // ekstreden çıkan kategori dağılımı: kart onaylanınca (ya da düğmeyle) nota yazılır
  goTo?: string; // ekstre başka aya ait: kartlar o ayın sohbetine hazırlandı, bu düğme o aya geçirir
  senaryo?: { kalanOnce: number; kalanSonra: number; ayOnce: number | null; aySonra: number | null };
}
// Harcama satırlarını kategoriye göre toplar (sohbetteki özet için)
const byCat = (rows: SpendRow[]): [string, number][] => { const m = new Map<string, number>(); rows.forEach(r => m.set(r.kategori, (m.get(r.kategori) || 0) + r.tutar)); return [...m.entries()].sort((a, z) => z[1] - a[1]); };
const chatKey = (m: string) => `budget_chat_v1_${m}`;
const loadChat = (m: string): ChatEntry[] => { try { const a = JSON.parse(localStorage.getItem(chatKey(m)) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const saveChat = (m: string, c: ChatEntry[]) => { try { localStorage.setItem(chatKey(m), JSON.stringify(c.slice(-40))); } catch { /* yoksay */ } };
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ---- tek satır: elle düzenlenebilir (ad, tutar, gün, tür, taksit)
function Row({ it, onChange, onRemove }: { it: BudgetItem; onChange: (p: Partial<BudgetItem>) => void; onRemove: () => void }) {
  const [name, setName] = useState(it.name);
  const [amount, setAmount] = useState(String(it.amount));
  const [day, setDay] = useState(it.day ? String(it.day) : '');
  const [tl, setTl] = useState(it.taksit ? String(it.taksit.left) : '');
  const [tt, setTt] = useState(it.taksit ? String(it.taksit.total) : '');
  const [tx, setTx] = useState(it.taksitAmount ? String(it.taksitAmount) : '');
  useEffect(() => { setName(it.name); setAmount(String(it.amount)); setDay(it.day ? String(it.day) : ''); setTl(it.taksit ? String(it.taksit.left) : ''); setTt(it.taksit ? String(it.taksit.total) : ''); setTx(it.taksitAmount ? String(it.taksitAmount) : ''); },
    [it.name, it.amount, it.day, it.taksit?.left, it.taksit?.total, it.taksitAmount, it.kind]);

  const commitName = () => { const v = name.trim(); if (v !== it.name) onChange({ name: v }); };
  const commitAmount = () => { const v = parseTL(amount); if (v === null || v < 0) { setAmount(String(it.amount)); return; } if (v !== it.amount) onChange({ amount: round2(v) }); };
  const commitDay = () => {
    if (!day.trim()) { if (it.day) onChange({ day: undefined }); return; }
    const v = Math.round(Number(day));
    if (!Number.isFinite(v) || v < 1 || v > 31) { setDay(it.day ? String(it.day) : ''); return; }
    if (v !== it.day) onChange({ day: v });
  };
  const commitTaksit = () => {
    const l = Math.round(Number(tl)), t = Math.round(Number(tt));
    if (!tl.trim() && !tt.trim()) { if (it.taksit) onChange({ taksit: undefined }); return; }
    if (!Number.isFinite(l) || !Number.isFinite(t) || l < 1 || t < l) { setTl(it.taksit ? String(it.taksit.left) : ''); setTt(it.taksit ? String(it.taksit.total) : ''); return; }
    if (!it.taksit || it.taksit.left !== l || it.taksit.total !== t) onChange({ taksit: { left: l, total: t } });
  };
  const commitTx = () => {
    if (!tx.trim()) { if (it.taksitAmount) onChange({ taksitAmount: undefined }); return; }
    const v = parseTL(tx);
    if (v === null || v < 0 || v > it.amount) { setTx(it.taksitAmount ? String(it.taksitAmount) : ''); return; }
    if (v !== it.taksitAmount) onChange({ taksitAmount: round2(v) });
  };
  const enter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter') { fn(); (e.target as HTMLInputElement).blur(); } };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border-color)' }}>
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={enter(commitName)} placeholder="Ad" aria-label="Kalem adı" style={{ ...field, flex: '2 1 110px' }} />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={commitAmount} onKeyDown={enter(commitAmount)} inputMode="decimal" placeholder="Tutar" aria-label="Tutar" style={{ ...field, width: '92px', textAlign: 'right' }} />
      <input value={day} onChange={(e) => setDay(e.target.value)} onBlur={commitDay} onKeyDown={enter(commitDay)} inputMode="numeric" placeholder="gün" title={it.kind === 'gelir' ? 'Ayın kaçında yatıyor' : 'Ayın kaçında ödeniyor (kart: son ödeme günü)'} aria-label="Gün" style={{ ...field, width: '48px', textAlign: 'center' }} />
      <select value={it.kind} onChange={(e) => onChange({ kind: e.target.value as BudgetKind })} aria-label="Tür" style={{ ...field, width: '122px' }}>
        {KIND_ORDER.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      {it.kind === 'sabit' && (
        <span title="Taksitliyse: kalan / toplam taksit" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--text-muted)' }}>
          taksit <input value={tl} onChange={(e) => setTl(e.target.value)} onBlur={commitTaksit} onKeyDown={enter(commitTaksit)} inputMode="numeric" aria-label="Kalan taksit" style={{ ...field, width: '36px', textAlign: 'center', padding: '6px 3px' }} />/
          <input value={tt} onChange={(e) => setTt(e.target.value)} onBlur={commitTaksit} onKeyDown={enter(commitTaksit)} inputMode="numeric" aria-label="Toplam taksit" style={{ ...field, width: '36px', textAlign: 'center', padding: '6px 3px' }} />
        </span>
      )}
      {it.kind === 'kart' && (
        <input value={tx} onChange={(e) => setTx(e.target.value)} onBlur={commitTx} onKeyDown={enter(commitTx)} inputMode="decimal" placeholder="taksitli kısım" title="Ekstrenin taksitli (kaydırılamayan) kısmı" aria-label="Taksitli kısım" style={{ ...field, width: '96px', textAlign: 'right' }} />
      )}
      <button type="button" onClick={onRemove} title="Sil" aria-label="Kalemi sil" style={{ ...btn, padding: '5px 7px' }}><Trash2 size={13} /></button>
    </div>
  );
}

// Bütçe Planı: sohbetle ya da elle gelir/sabit gider/kart ekstresi/değişken harcama girin; kalan para, grafikler, öneriler ve kartsız geçiş planı canlı hesaplanır.
// Veri kasada aylık nota (Finans/Bütçe/YYYY-MM.md) yazılır. Yapay zekânın önerdiği her kalem onay kartı olarak gelir; siz onaylamadan hiçbir şey yazılmaz.
export default function BudgetView({ fileContents, onSaveNote, onOpenNote }: {
  fileContents: Record<string, string>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onOpenNote?: (path: string) => void;
}) {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [budget, setBudget] = useState<Budget>(() => emptyBudget(monthOf(new Date())));
  const budgetRef = useRef(budget); budgetRef.current = budget;
  const [rolled, setRolled] = useState(false);
  const [undo, setUndo] = useState<Budget[]>([]);
  // Sohbet ay ile birlikte tutulur (ay değişince eski ayın mesajları yeni aya yazılmasın; açılışta yükleme bitmeden boş liste kaydedilmesin)
  const [chat, setChat] = useState<{ month: string; list: ChatEntry[] }>(() => { const m0 = monthOf(new Date()); return { month: m0, list: loadChat(m0) }; });
  const msgs = chat.month === month ? chat.list : [];
  const setMsgs = (fn: ChatEntry[] | ((m: ChatEntry[]) => ChatEntry[])) =>
    setChat(c => { const base = c.month === month ? c.list : loadChat(month); return { month, list: typeof fn === 'function' ? fn(base) : fn }; });
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [waitSec, setWaitSec] = useState(0); // yanıt beklerken geçen süre: takıldı mı yoksa çalışıyor mu anlaşılsın
  useEffect(() => {
    if (!thinking) { setWaitSec(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setWaitSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [thinking]);
  const [err, setErr] = useState('');
  // Eklenen ekstre PDF'i: bilgisayarda metne çevrilir (kimlik numaraları gizli), bir sonraki mesajla yapay zekâya gider
  const [stmt, setStmt] = useState<StatementText | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickPdf = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { setErr('Yalnızca PDF eklenebilir.'); return; }
    setReading(true);
    try { setStmt(await readStatementPdf(f)); } catch (e: any) { setStmt(null); setErr(String(e?.message || e)); } finally { setReading(false); }
  };
  const [advice, setAdvice] = useState<{ a: Advice; applied: number[]; cached?: boolean } | null>(null);
  const [advising, setAdvising] = useState(false);
  const [tampon, setTampon] = useState('');
  const [kisinti, setKisinti] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Budget | null>(null);
  const lastSaved = useRef('');
  const savedSet = useRef<string[]>([]); // yakın zamanda kendi kaydettiğimiz içerikler: kasadan gecikmeli dönen eski kopyalar "dışarıdan değişiklik" sayılmasın
  const path = monthPath(month);
  const aiReady = isGeminiConfigured();

  // ---- kaydetme (kısa bekleme ile birleştirilir)
  const flush = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const b = pending.current;
    if (!b || !onSaveNote) { pending.current = null; return; }
    pending.current = null;
    const content = serializeBudget(b);
    lastSaved.current = content;
    savedSet.current = [...savedSet.current.slice(-9), content];
    void onSaveNote(monthPath(b.month), content);
  }, [onSaveNote]);
  const scheduleSave = useCallback((b: Budget) => {
    pending.current = b;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 500);
  }, [flush]);
  useEffect(() => () => { flush(); }, [flush]);

  const commit = useCallback((next: Budget, pushUndo = true) => {
    if (pushUndo) setUndo(u => [...u.slice(-29), budgetRef.current]);
    budgetRef.current = next;
    setBudget(next); setRolled(false);
    scheduleSave(next);
  }, [scheduleSave]);

  // ---- ay yükleme (kayıt yoksa önceki aydan devredilir; kullanıcı değişiklik yapana kadar dosya oluşturulmaz)
  useEffect(() => {
    flush();
    const parsed = parseBudgetNote(fileContents[path], month);
    if (parsed) { setBudget(parsed); budgetRef.current = parsed; setRolled(false); lastSaved.current = fileContents[path] || ''; savedSet.current = []; }
    else {
      const pm = shiftMonth(month, -1);
      const prev = parseBudgetNote(fileContents[monthPath(pm)], pm);
      const b = prev && prev.items.length ? rollover(prev, month) : emptyBudget(month);
      setBudget(b); budgetRef.current = b; setRolled(!!(prev && prev.items.length)); lastSaved.current = '';
    }
    setUndo([]); setChat({ month, list: loadChat(month) }); setAdvice(null); setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
  // not başka yerden (elle ya da başka cihazdan) değiştiyse yansıt
  useEffect(() => {
    const c = fileContents[path];
    if (c === undefined || c === lastSaved.current || pending.current || savedSet.current.includes(c)) return;
    if (c === serializeBudget(budgetRef.current)) return;
    const parsed = parseBudgetNote(c, month);
    if (parsed) { setBudget(parsed); budgetRef.current = parsed; lastSaved.current = c; savedSet.current = [...savedSet.current.slice(-9), c]; setRolled(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContents[path]]);
  useEffect(() => { saveChat(chat.month, chat.list); chatEnd.current?.scrollIntoView({ block: 'end' }); }, [chat]);

  const T = useMemo(() => totals(budget), [budget]);
  const CF = useMemo(() => cashflow(budget), [budget]);
  const allowance = useMemo(() => dailyAllowance(budget, new Date()), [budget]);
  const tNum = parseTL(tampon) ?? 0, kNum = parseTL(kisinti) ?? 0;
  const trNow = useMemo(() => transition(budget), [budget]);
  const trTampon = useMemo(() => transition(budget, { tampon: tNum }), [budget, tNum]);
  const trKisinti = useMemo(() => transition(budget, { kisinti: kNum }), [budget, kNum]);
  const trBoth = useMemo(() => transition(budget, { tampon: tNum, kisinti: kNum }), [budget, tNum, kNum]);

  // ---- elle düzenleme
  const edit = (fn: (items: BudgetItem[]) => BudgetItem[]) => commit({ ...budget, items: reindex(fn(budget.items)) });
  const patchItem = (id: string, p: Partial<BudgetItem>) => edit(items => items.map(i => (i.id === id ? { ...i, ...p } : i)));
  const removeItem = (id: string) => edit(items => items.filter(i => i.id !== id));
  const addItem = (kind: BudgetKind) => edit(items => [...items, { id: '', kind, name: '', amount: 0 }]);
  const doUndo = () => { const prev = undo[undo.length - 1]; if (!prev) return; setUndo(u => u.slice(0, -1)); commit(prev, false); };

  // ---- sohbet
  const updateMsg = (id: string, fn: (m: ChatEntry) => ChatEntry) => setMsgs(ms => ms.map(m => (m.id === id ? fn(m) : m)));
  const setAct = (id: string, idx: number, p: Partial<ActState>) => updateMsg(id, m => ({ ...m, acts: (m.acts || []).map((a, i) => (i === idx ? { ...a, ...p } : a)) }));

  // Harcama kategorisini elle değiştirme: aynı işletmenin hepsi değişir ve kural olarak hatırlanır (sonraki ekstrelerde otomatik uygulanır)
  const rulesRef = useRef<Record<string, string>>({});
  useEffect(() => { rulesRef.current = parseRules(fileContents[RULES_PATH]); }, [fileContents[RULES_PATH]]);
  const [recatMsg, setRecatMsg] = useState('');
  const recat = (idx: number, cat: string) => {
    const r = recategorize(budgetRef.current, idx, cat, true);
    if (!r.changed) return;
    commit(r.budget);
    if (r.key && onSaveNote) { rulesRef.current = { ...rulesRef.current, [r.key]: cat }; void onSaveNote(RULES_PATH, serializeRules(rulesRef.current)); }
    setRecatMsg(r.changed > 1 ? `"${r.key}" işletmesinin ${r.changed} harcaması "${cat}" oldu; sonraki ekstrelerde de böyle girer. (Geri al ile geri dönebilirsiniz.)` : `Harcama "${cat}" kategorisine alındı${r.key ? '; bu işletme sonraki ekstrelerde de böyle girer' : ''}.`);
  };

  // Başka bir ayın bütçesi: kayıtlıysa o, yoksa önceki aydan devir (önceki ay bu ekrandaysa kaydedilmemiş son hâli kullanılır)
  const budgetFor = (m: string, curB: Budget): Budget => {
    const parsed = parseBudgetNote(fileContents[monthPath(m)], m);
    if (parsed) return parsed;
    const pm = shiftMonth(m, -1);
    const prev = pm === curB.month ? curB : parseBudgetNote(fileContents[monthPath(pm)], pm);
    return prev && prev.items.length ? rollover(prev, m) : emptyBudget(m);
  };

  const send = async () => {
    const typed = input.trim();
    if ((!typed && !stmt) || thinking || reading) return;
    const text = typed || 'Ekteki kart ekstresini bütçeye işle.';
    const att = stmt;
    if (!aiReady) { setErr('Yapay zekâ ayarlı değil: Ayarlar > AI Mentor\'dan Gemini anahtarı ekleyin ya da masaüstünde Claude Code\'u açın.'); return; }
    setInput(''); setErr(''); setThinking(true); setStmt(null);
    const um: ChatEntry = { id: newId(), role: 'user', text: att ? `📎 ${att.name}\n${text}` : text, t: Date.now() };
    setMsgs(ms => [...ms, um]);
    try {
      const persona = (fileContents[PERSONA_PATH] || '').trim() || DEFAULT_PERSONA;
      const cur = budgetRef.current;
      const res = await askBudget({ persona, budget: cur, history: msgsRef.current.filter(m => m.id !== um.id).map(m => ({ role: m.role, text: m.text })), message: text, statement: att ? { name: att.name, text: att.text } : undefined });
      // Ekstre seçili aydan başka bir ayın ödemesiyse: kartları o ayın bütçesine göre hazırla, o ayın sohbetine koy, buradan düğmeyle geçilsin
      const kartAd = res.eylemler.map(a => (a.kind === 'kart' && a.ad ? a.ad : a.id ? cur.items.find(i => i.id === a.id && i.kind === 'kart')?.name : undefined)).find(Boolean);
      const kartTutar = res.eylemler.find(a => a.kind === 'kart' && typeof a.tutar === 'number')?.tutar ?? (res.eylemler.length === 1 ? res.eylemler[0].tutar : undefined);
      const analiz = att && res.harcamalar.length ? { kart: kartAd || att.name.replace(/\.pdf$/i, ''), rows: applyRules(res.harcamalar, rulesRef.current), toplam: kartTutar } : undefined;
      const target = att ? res.ekstreAy : undefined;
      if (target && target !== cur.month && res.eylemler.length) {
        const bt = budgetFor(target, cur);
        const ch = checkActions(bt, res.eylemler);
        const tActs: ActState[] = ch.map(c => ({ check: c, state: c.ok ? 'bekliyor' : 'hata', note: c.problem }));
        saveChat(target, [...loadChat(target), um, { id: newId(), role: 'ai', text: res.cevap, t: Date.now(), acts: tActs, analiz }]);
        setMsgs(ms => [...ms, { id: newId(), role: 'ai', text: `${res.cevap}\n\nBu ekstre ${monthLabel(target)} ödemesi; kartı o ayın bütçesi için hazırladım.`, t: Date.now(), goTo: target }]);
        return;
      }
      const checked = checkActions(cur, res.eylemler);
      const acts: ActState[] = checked.map(c => {
        const it = c.ok && c.action.op !== 'ekle' ? cur.items.find(i => i.id === c.action.id) : undefined;
        return { check: c, target: it ? { kind: it.kind, name: it.name } : undefined, state: c.ok ? 'bekliyor' : 'hata', note: c.problem };
      });
      let senaryo: ChatEntry['senaryo'];
      const okActs = checked.filter(c => c.ok).map(c => c.action);
      if (res.senaryo && okActs.length) {
        const b2 = applyActions(cur, okActs);
        senaryo = { kalanOnce: totals(cur).kalan, kalanSonra: totals(b2).kalan, ayOnce: transition(cur).bitis, aySonra: transition(b2).bitis };
      }
      setMsgs(ms => [...ms, { id: newId(), role: 'ai', text: res.cevap, t: Date.now(), acts: acts.length ? acts : undefined, senaryo, analiz }]);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally { setThinking(false); }
  };

  // Bekleyen eylemleri, kimlik kayması olmasın diye tür+ad ile yeniden hedefleyerek uygular
  const applyActs = (msgId: string, idxs: number[]) => {
    const m = msgsRef.current.find(x => x.id === msgId);
    if (!m || !m.acts) return;
    let cur = budgetRef.current;
    const results: Record<number, Partial<ActState>> = {};
    let kartAdi: string | undefined;
    for (const i of idxs) {
      const a = m.acts[i];
      if (!a || a.state !== 'bekliyor') continue;
      const act = retarget(cur, a.check.action, a.target);
      if (!act) { results[i] = { state: 'hata', note: 'Kalem artık yok' }; continue; }
      const re = checkActions(cur, [act])[0];
      if (!re || !re.ok) { results[i] = { state: 'hata', note: re?.problem || 'Uygulanamadı' }; continue; }
      cur = applyAction(cur, re.action);
      if ((a.target?.kind ?? re.action.kind) === 'kart') kartAdi = a.target?.name || re.action.ad || kartAdi;
      results[i] = { state: 'eklendi' };
    }
    // Kart onaylandıysa ekstreden çıkan harcama dağılımı da aynı anda kaydedilir (aynı kartın eskisi değişir)
    const savedAnaliz = !!(m.analiz && kartAdi);
    if (m.analiz && kartAdi) cur = mergeAnaliz(cur, kartAdi, m.analiz.rows);
    if (cur !== budgetRef.current) commit(cur);
    updateMsg(msgId, mm => ({ ...mm, analiz: mm.analiz && savedAnaliz ? { ...mm.analiz, saved: true } : mm.analiz, acts: (mm.acts || []).map((a, i) => (results[i] ? { ...a, ...results[i] } : a)) }));
  };

  // Kart kalemi zaten doğruysa dağılımı tek başına kaydet
  const saveAnaliz = (msgId: string) => {
    const m = msgsRef.current.find(x => x.id === msgId);
    if (!m?.analiz || m.analiz.saved) return;
    commit(mergeAnaliz(budgetRef.current, m.analiz.kart, m.analiz.rows));
    updateMsg(msgId, mm => ({ ...mm, analiz: mm.analiz ? { ...mm.analiz, saved: true } : mm.analiz }));
  };

  // Öneri bütçe değişmedikçe kayıtlıdır: aynı bütçeye her basışta aynı sonuç görünür ("Yenile" ile yeniden istenir)
  const adviceKey = `budget_advice_v1_${month}`;
  const getAdvice = async (force = false) => {
    if (advising) return;
    const sig = serializeBudget(budgetRef.current);
    if (!force) {
      try { const c = JSON.parse(localStorage.getItem(adviceKey) || 'null'); if (c && c.sig === sig && c.a) { setAdvice({ a: c.a, applied: [], cached: true }); return; } } catch { /* yoksay */ }
    }
    if (!aiReady) { setErr('Yapay zekâ ayarlı değil: Ayarlar > AI Mentor\'dan Gemini anahtarı ekleyin ya da masaüstünde Claude Code\'u açın.'); return; }
    setAdvising(true); setErr('');
    try {
      const persona = (fileContents[PERSONA_PATH] || '').trim() || DEFAULT_PERSONA;
      const a = await askAdvice({ persona, budget });
      setAdvice({ a, applied: [] });
      try { localStorage.setItem(adviceKey, JSON.stringify({ sig, a })); } catch { /* yoksay */ }
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setAdvising(false); }
  };
  const applyAdvice = (i: number) => {
    if (!advice) return;
    const o = advice.a.oneriler[i];
    const it = budget.items.find(x => x.kind === 'degisken' && x.name === o.kalem);
    if (!it) return;
    commit({ ...budget, items: reindex(budget.items.map(x => (x === it ? { ...x, amount: Math.max(0, round2(x.amount - o.aylikTasarruf)) } : x))) });
    setAdvice({ ...advice, applied: [...advice.applied, i] });
  };

  const openPersona = async () => {
    if (!fileContents[PERSONA_PATH] && onSaveNote) await onSaveNote(PERSONA_PATH, DEFAULT_PERSONA);
    onOpenNote?.(PERSONA_PATH);
  };

  const clearChat = () => setMsgs([]);

  // ---- yeni düzen: üstte kalan özeti, beş sekme, sağdan içeriğin ÜSTÜNE açılan sohbet çekmecesi (içeriği sıkıştırmaz)
  type BTab = 'genel' | 'kalem' | 'harcama' | 'kartsiz' | 'oneri';
  type KSec = 'yol' | 'taksit' | 'alabilir' | 'abonelik' | 'karne';
  const TABS: [BTab, string][] = [['genel', 'Genel'], ['kalem', 'Kalemler'], ['harcama', 'Harcamalar'], ['kartsiz', 'Kartsız yaşam'], ['oneri', 'Öneriler']];
  const [tab, setTab] = useState<BTab>(() => { try { const v = localStorage.getItem('budget_tab_v1') as BTab; return TABS.some(x => x[0] === v) ? v : 'genel'; } catch { return 'genel'; } });
  const [kSec, setKSec] = useState<KSec>('yol');
  const [chatOpen, setChatOpen] = useState<boolean>(() => { try { return localStorage.getItem('budget_chat_open_v1') === '1'; } catch { return false; } });
  const pickTab = (t: BTab) => { setTab(t); try { localStorage.setItem('budget_tab_v1', t); } catch { /* yoksay */ } };
  const setChatPanel = (o: boolean) => { setChatOpen(o); try { localStorage.setItem('budget_chat_open_v1', o ? '1' : '0'); } catch { /* yoksay */ } };
  const pendingCount = msgs.reduce((n, m) => n + (m.acts || []).filter(a => a.state === 'bekliyor').length, 0);

  const instPlan = useMemo(() => installmentPlan(loadMonths(fileContents)), [fileContents]);
  const todayD = new Date();
  const dayNow = month === monthOf(todayD) ? todayD.getDate() : 0;
  const nextPay = budget.items.filter(i => (i.kind === 'kart' || i.kind === 'sabit') && i.day && i.day >= dayNow).sort((a, z) => (a.day as number) - (z.day as number))[0];

  const card: React.CSSProperties = { ...panel, borderRadius: '12px', padding: '14px 16px', minWidth: 0 };
  const lab: React.CSSProperties = { fontSize: '12px', color: 'var(--text-muted)' };
  const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: '16px' });
  const kalanColor = T.kalan >= 0 ? '#22c55e' : '#ef4444';
  const seg = [
    { k: 'Sabit', v: T.sabit, c: '#E24B4A' }, { k: 'Kart ekstresi', v: T.kart, c: '#D85A30' }, { k: 'Değişken', v: T.degisken, c: '#a855f7' },
    { k: 'Beklenmeyen', v: T.reserve, c: '#888780' }, { k: 'Kalan', v: Math.max(0, T.kalan), c: '#378ADD' }
  ].filter(s => s.v > 0);
  const segTotal = Math.max(T.gelir, seg.reduce((s, x) => s + x.v, 0)) || 1;
  const plan = (tNum > 0 && kNum > 0 ? trBoth : tNum > 0 ? trTampon : kNum > 0 ? trKisinti : trNow);
  const monthsText = (r: ReturnType<typeof transition>) => (r.bitis === null ? 'mümkün değil' : r.bitis === 0 ? 'kaydırılacak yok' : `${r.bitis} ay`);

  const tabBtn = (active: boolean): React.CSSProperties => ({ background: 'none', border: 'none', borderBottom: `2px solid ${active ? 'var(--accent-color)' : 'transparent'}`, color: active ? 'var(--text-primary)' : 'var(--text-muted)', padding: '10px 12px', fontSize: '13px', fontWeight: active ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' });
  const railBtn = (active: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', border: 'none', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer', background: active ? 'var(--bg-tertiary)' : 'none', color: active ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' });
  const KSECS: [KSec, string, React.ReactNode][] = [
    ['yol', 'Yol haritası', <Route size={14} key="y" />], ['taksit', 'Taksitler', <CalendarRange size={14} key="t" />], ['alabilir', 'Alabilir miyim?', <Calculator size={14} key="a" />],
    ['abonelik', 'Abonelikler', <Repeat size={14} key="b" />], ['karne', 'Karne', <Award size={14} key="k" />]
  ];

  const chatDrawer = (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(380px, 100%)', background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', zIndex: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 12px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>Finans uzmanı</div>
        <button type="button" style={{ ...btn, padding: '4px 8px', fontSize: '11.5px' }} onClick={openPersona} title="Yapay zekâya verilen kişilik metnini düzenleyin"><UserCog size={13} /> Kişilik</button>
        {msgs.length > 0 && <button type="button" style={{ ...btn, padding: '4px 8px', fontSize: '11.5px' }} onClick={clearChat} title="Sohbeti temizle (kalemler silinmez)">Temizle</button>}
        <button type="button" style={{ ...btn, padding: '4px 7px' }} onClick={() => setChatPanel(false)} aria-label="Sohbeti kapat"><X size={14} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {msgs.length === 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Örnek: "Maaşım 50 bin, her ayın 5'inde yatıyor. Kira 12 bin, aidat 1500, çocuğun okulu 6 bin (9 taksitin 3'ü kaldı). Yapı Kredi ekstresi 18 bin, son ödeme 3'ü; bunun 4 bini taksit."<br />
            Ya da kart ekstresi PDF'ini ataçla ekleyin; "ya ayda 3 bin market kıssam?" gibi senaryolar da sorabilirsiniz.
          </div>
        )}
        {msgs.map(m => (
          <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'stretch', maxWidth: m.role === 'user' ? '90%' : '100%' }}>
            <div style={{ background: m.role === 'user' ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: m.role === 'user' ? '#fff' : 'var(--text-primary)', borderRadius: '10px', padding: '8px 11px', fontSize: '12.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</div>
            {m.analiz && (
              <div style={{ marginTop: '6px', fontSize: '12px', background: 'rgba(249,115,22,0.10)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: '8px', padding: '7px 10px', lineHeight: 1.6 }}>
                <b>Harcama dağılımı ({m.analiz.kart}):</b>{' '}
                {byCat(m.analiz.rows).slice(0, 7).map(([k, v]) => `${k} ${fmtTL(v)}`).join(' · ')}{byCat(m.analiz.rows).length > 7 ? ' …' : ''}
                <div style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>{m.analiz.rows.length} harcama{(() => { const s = m.analiz.rows.reduce((x, r) => x + r.tutar, 0); return m.analiz.toplam && Math.abs(s - m.analiz.toplam) > Math.max(5, m.analiz.toplam * 0.01) ? ` · toplamı ${fmtTL(s)} (ekstre borcu ${fmtTL(m.analiz.toplam)}; fark önceki dönemden devreden olabilir)` : ` · toplamı ${fmtTL(s)}`; })()}</div>
                <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '11.5px', flexWrap: 'wrap' }}>
                  {m.analiz.saved ? <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ kaydedildi</span>
                    : <><span>Kart kalemini onaylayınca birlikte kaydedilir.</span><button type="button" style={{ ...btn, padding: '3px 8px', fontSize: '11.5px' }} onClick={() => saveAnaliz(m.id)}>Yalnızca dağılımı kaydet</button></>}
                </div>
              </div>
            )}
            {m.goTo && (
              <button type="button" style={{ ...btnPrimary, marginTop: '6px' }} onClick={() => setMonth(m.goTo!)}>
                <ChevronRight size={14} /> {monthLabel(m.goTo)} bütçesine git ve kartı onayla
              </button>
            )}
            {m.acts && m.acts.length > 0 && (
              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {m.senaryo && (
                  <div style={{ fontSize: '12px', background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: '8px', padding: '7px 10px', lineHeight: 1.55 }}>
                    <b>Senaryo (kayıt değil):</b> kalan {fmtTL(m.senaryo.kalanOnce)} → <b style={{ color: m.senaryo.kalanSonra >= m.senaryo.kalanOnce ? '#22c55e' : '#ef4444' }}>{fmtTL(m.senaryo.kalanSonra)}</b>
                    {m.senaryo.ayOnce !== m.senaryo.aySonra && <> · kartsız geçiş: {m.senaryo.ayOnce === null ? 'mümkün değil' : `${m.senaryo.ayOnce} ay`} → {m.senaryo.aySonra === null ? 'mümkün değil' : `${m.senaryo.aySonra} ay`}</>}
                  </div>
                )}
                {m.acts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-tertiary)', border: `1px solid ${a.state === 'hata' ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}`, borderRadius: '8px', padding: '6px 9px', fontSize: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', opacity: a.state === 'atlandi' ? 0.5 : 1, textDecoration: a.state === 'atlandi' ? 'line-through' : 'none' }}>
                      {a.check.label}
                      {a.state === 'hata' && <div style={{ color: '#ef4444', fontSize: '11px' }}>{a.note || 'Uygulanamaz'}</div>}
                      {a.check.action.neden && a.state === 'bekliyor' && <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{a.check.action.neden}</div>}
                    </div>
                    {a.state === 'bekliyor' && (
                      <>
                        <button type="button" style={{ ...btnPrimary, padding: '4px 8px' }} onClick={() => applyActs(m.id, [i])} title={m.senaryo ? 'Gerçekten uygula' : 'Ekle'}><Check size={13} /> {m.senaryo ? 'Uygula' : 'Ekle'}</button>
                        <button type="button" style={{ ...btn, padding: '4px 7px' }} onClick={() => setAct(m.id, i, { state: 'atlandi' })} title="Atla" aria-label="Atla"><X size={13} /></button>
                      </>
                    )}
                    {a.state === 'eklendi' && <span style={{ color: '#22c55e', fontSize: '11.5px', fontWeight: 600 }}>✓ uygulandı</span>}
                  </div>
                ))}
                {m.acts.filter(a => a.state === 'bekliyor').length > 1 && (
                  <button type="button" style={{ ...btnPrimary, alignSelf: 'flex-start' }} onClick={() => applyActs(m.id, m.acts!.map((_, i) => i))}><Check size={14} /> Hepsini {m.senaryo ? 'uygula' : 'ekle'}</button>
                )}
              </div>
            )}
          </div>
        ))}
        {thinking && <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={13} className="animate-spin" /> Düşünüyor… {waitSec} sn{waitSec >= 20 ? ' (uzun sürerse otomatik yedeğe geçer ya da hata gösterir)' : ''}</div>}
        <div ref={chatEnd} />
      </div>
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-color)' }}>
        {err && <div style={{ fontSize: '12px', color: '#ef4444', marginBottom: '6px', overflowWrap: 'anywhere' }}>{err}</div>}
        {!aiReady && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginBottom: '6px' }}>Yapay zekâ ayarlı değil (Ayarlar &gt; AI Mentor). Kalemleri Kalemler sekmesinden elle girebilirsiniz.</div>}
        {(stmt || reading) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '12px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <FileText size={13} />
            {reading ? 'PDF okunuyor…' : <>
              <span style={{ fontWeight: 500 }}>{stmt!.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>· {stmt!.pages} sayfa{stmt!.truncated ? ' (ilk bölümü okunacak)' : ''} · kart/IBAN/TC numaraları gizlendi</span>
              <button type="button" onClick={() => setStmt(null)} aria-label="Eki kaldır" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}><X size={13} /></button>
            </>}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pickPdf(f); }} />
          <button type="button" style={{ ...btn, padding: '8px' }} disabled={thinking || reading} onClick={() => fileRef.current?.click()} aria-label="Kart ekstresi PDF ekle" title="Kart ekstresi PDF'i ekle"><Paperclip size={14} /></button>
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} rows={2} aria-label="Mesajınız"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Bu ay maaşım…, kira…, kart ekstresi…" style={{ ...field, flex: 1, resize: 'none' }}
          />
          <button type="button" style={{ ...btnPrimary, opacity: (input.trim() || stmt) && !thinking && !reading ? 1 : 0.6 }} disabled={(!input.trim() && !stmt) || thinking || reading} onClick={() => void send()} aria-label="Gönder"><Send size={14} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden', fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif", fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
      {/* üst çubuk */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '14px 20px 0' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}><PiggyBank size={20} color="var(--accent-color)" /> Bütçe Planı</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
          <button type="button" style={{ ...btn, padding: '5px 7px' }} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Önceki ay"><ChevronLeft size={15} /></button>
          <div style={{ minWidth: '112px', textAlign: 'center', fontWeight: 500, fontSize: '14px', textTransform: 'capitalize' }}>{monthLabel(month)}</div>
          <button type="button" style={{ ...btn, padding: '5px 7px' }} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Sonraki ay"><ChevronRight size={15} /></button>
          {month !== monthOf(new Date()) && <button type="button" style={btn} onClick={() => setMonth(monthOf(new Date()))}>Bu ay</button>}
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...btn, opacity: undo.length ? 1 : 0.5 }} disabled={undo.length === 0} onClick={doUndo} title="Son değişikliği geri al"><Undo2 size={14} /> Geri al</button>
        <button type="button" style={{ ...btn, borderColor: chatOpen ? 'var(--accent-color)' : undefined, color: chatOpen ? 'var(--accent-color)' : undefined }} onClick={() => setChatPanel(!chatOpen)} aria-label="Finans uzmanı sohbetini aç veya kapat" aria-pressed={chatOpen}>
          <MessageCircle size={14} /> Finans uzmanı
          {pendingCount > 0 && <span style={{ background: 'var(--accent-color)', color: '#fff', borderRadius: '10px', padding: '0 7px', fontSize: '11.5px' }}>{pendingCount}</span>}
        </button>
      </div>

      {/* kalan özeti + gelirin dağılımı */}
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={lab}>Bu ay kalan</div>
            <div style={{ fontSize: '28px', fontWeight: 500, lineHeight: 1.15, color: kalanColor }}>{fmtTL(T.kalan)}</div>
          </div>
          <div style={{ ...lab, marginLeft: 'auto', paddingBottom: '4px' }}>
            Gelir <b style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fmtTL(T.gelir)}</b>
            {allowance !== null && <> · günlük harcama payı <b style={{ fontWeight: 500, color: T.kalan > 0 ? 'var(--text-primary)' : '#ef4444' }}>{T.kalan > 0 ? `~${fmtTL(allowance)}` : 'yok, bu ay açık veriyor'}</b></>}
          </div>
        </div>
        {seg.length > 0 ? (
          <>
            <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', marginTop: '10px', background: 'var(--bg-tertiary)' }} role="img" aria-label="Gelirin dağılımı: sabit, kart, değişken, beklenmeyen, kalan">
              {seg.map(s => <div key={s.k} style={{ width: `${s.v / segTotal * 100}%`, background: s.c }} title={`${s.k}: ${fmtTL(s.v)}`} />)}
            </div>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '8px', ...lab }}>
              {seg.map(s => <span key={s.k}><i style={{ display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', background: s.c, marginRight: '6px' }} />{s.k} {fmtTL(s.v)}</span>)}
            </div>
          </>
        ) : <div style={{ ...lab, marginTop: '8px' }}>Gelir ve giderler eklenince dağılım burada görünür.</div>}
        {rolled && <div style={{ marginTop: '8px', fontSize: '12px', color: '#f59e0b' }}>Önceki aydan gelir ve sabit giderler devredildi (taksitler 1 azaldı). Bir değişiklik yaptığınızda bu ay kaydedilir.</div>}
      </div>

      {/* sekmeler */}
      <div style={{ display: 'flex', gap: '2px', padding: '0 20px', marginTop: '10px', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }} role="tablist">
        {TABS.map(([id, text]) => <button key={id} type="button" role="tab" aria-selected={tab === id} style={tabBtn(tab === id)} onClick={() => pickTab(id)}>{text}</button>)}
      </div>

      {/* içerik + sohbet çekmecesi */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ height: '100%', overflowY: 'auto', padding: '18px 20px 24px', boxSizing: 'border-box' }}>

          {tab === 'genel' && (
            <>
              <div style={grid(300)}>
                <div style={card}><div style={{ ...lab, marginBottom: '6px' }}>Gelirden kalana</div><Waterfall b={budget} /></div>
                <div style={card}>
                  <div style={{ ...lab, marginBottom: '6px' }}>Ay içi nakit takvimi</div>
                  {budget.items.length === 0 ? <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>Kalemler eklenince burada gün gün bakiyeniz görünür.</div> : <CashChart cf={CF} />}
                  {CF.negativeDays.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', fontSize: '12.5px', color: '#ef4444', marginTop: '6px', lineHeight: 1.5 }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <span>Bakiye ayın {CF.negativeDays[0]}. gününden {CF.negativeDays[CF.negativeDays.length - 1]}. gününe kadar eksiye düşüyor (en düşük {fmtTL(CF.min.balance)}). Maaş günü ile ödeme günleri arasındaki boşluğa dikkat.</span>
                    </div>
                  )}
                  {CF.undated.length > 0 && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>Günü yazılmayan kalemler ayın 1'inde varsayıldı: {CF.undated.join(', ')}. Gün ekleyerek takvimi netleştirin.</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', marginTop: '18px' }}>
                <div><div style={lab}>Sıradaki ödeme</div><div style={{ fontWeight: 500 }}>{nextPay ? `${nextPay.name}, ayın ${nextPay.day}'i · ${fmtTL(nextPay.amount)}` : 'Bu ay ödeme kalmadı'}</div></div>
                <div><div style={lab}>Kartsız geçiş</div><div style={{ fontWeight: 500 }}>{monthsText(trNow)}</div></div>
                <div><div style={lab}>Taksitler biter</div><div style={{ fontWeight: 500 }}>{instPlan.items.length ? (instPlan.bosAy ? monthLabel(instPlan.bosAy) : '—') : 'taksit yok'}</div></div>
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '18px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <FileText size={12} /> Bu ay <code>{path}</code> notunda saklanır.
                {onOpenNote && fileContents[path] !== undefined && <button type="button" style={{ ...btn, padding: '2px 7px', fontSize: '11px' }} onClick={() => onOpenNote(path)}>Notu aç</button>}
              </div>
            </>
          )}

          {tab === 'kalem' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
                <label style={{ ...lab, display: 'inline-flex', alignItems: 'center', gap: '6px' }} title="Bayram, tamir, hastalık gibi beklenmeyenler için gelirden ayrılan pay">
                  Beklenmeyen payı %
                  <input type="number" min={0} max={50} step={1} value={budget.reservePct} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 50) commit({ ...budget, reservePct: v }); }} aria-label="Beklenmeyenler payı yüzdesi" style={{ ...field, width: '60px', textAlign: 'center' }} />
                </label>
                <span style={lab}>Satırları elle düzenleyebilirsiniz; yapay zekâ önerdiği her kalemi sohbette onayınıza sunar.</span>
              </div>
              <div style={grid(420)}>
                {KIND_ORDER.map(kind => {
                  const rows = budget.items.filter(i => i.kind === kind);
                  return (
                    <div key={kind} style={card}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: KIND_COLOR[kind], display: 'inline-block' }} />
                        <span style={{ fontWeight: 500 }}>{KIND_LABEL[kind]}</span><span style={lab}>· {fmtTL(rows.reduce((s, r) => s + r.amount, 0))}</span>
                        <button type="button" style={{ ...btn, marginLeft: 'auto', padding: '3px 8px', fontSize: '11.5px' }} onClick={() => addItem(kind)}><Plus size={12} /> Ekle</button>
                      </div>
                      {HINT[kind] && <div style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '3px 0 4px' }}>{HINT[kind]}</div>}
                      {rows.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>—</div>}
                      {rows.map(it => <Row key={it.id} it={it} onChange={(p) => patchItem(it.id, p)} onRemove={() => removeItem(it.id)} />)}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {tab === 'harcama' && (
            budget.analiz && budget.analiz.length > 0 ? (
              <div style={card}>
                <div style={{ ...lab, marginBottom: '8px' }}>Ekstre harcama dağılımı</div>
                <SpendBars b={budget} onRecat={recat} />
                {recatMsg && <div style={{ fontSize: '11.5px', color: '#22c55e', marginTop: '6px' }}>{recatMsg}</div>}
              </div>
            ) : (
              <div style={{ ...card, textAlign: 'center', padding: '32px 16px' }}>
                <div style={{ fontWeight: 500, marginBottom: '6px' }}>Harcama dağılımı henüz yok</div>
                <div style={{ ...lab, lineHeight: 1.6, marginBottom: '12px' }}>Kart ekstresi PDF'ini sohbetten eklediğinizde harcamalar kategorilere ayrılır ve burada tek tek görünür.</div>
                <button type="button" style={btnPrimary} onClick={() => setChatPanel(true)}><MessageCircle size={14} /> Sohbeti aç</button>
              </div>
            )
          )}

          {tab === 'kartsiz' && (
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ width: '168px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' }} role="tablist" aria-label="Kartsız yaşam bölümleri">
                {KSECS.map(([id, text, icon]) => <button key={id} type="button" role="tab" aria-selected={kSec === id} style={railBtn(kSec === id)} onClick={() => setKSec(id)}>{icon} {text}</button>)}
              </div>
              <div style={{ flex: '1 1 380px', minWidth: 0 }}>
                {kSec === 'yol' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      <div><div style={lab}>Kartsız yaşama</div><div style={{ fontSize: '30px', fontWeight: 500, lineHeight: 1.1, color: plan.bitis === null ? '#ef4444' : 'var(--accent-color)' }}>{monthsText(plan)}</div></div>
                      <div style={{ ...lab, flex: 1, minWidth: '200px', lineHeight: 1.55, paddingBottom: '4px' }}>
                        Kaydırılabilir kart borcu <b style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fmtTL(trNow.shiftable)}</b>.
                        {trNow.sabitKartYuku > 0 && <> Taksitli <b style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fmtTL(trNow.sabitKartYuku)}</b> taksit bitince kendiliğinden düşer.</>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                      <label style={{ ...lab, display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 150px' }}>
                        Tek seferlik tampon (₺)
                        <input value={tampon} onChange={(e) => setTampon(e.target.value)} inputMode="decimal" placeholder="örn. 20000" style={{ ...field, width: '100%' }} />
                      </label>
                      <label style={{ ...lab, display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 150px' }}>
                        Aylık ek kısıntı (₺)
                        <input value={kisinti} onChange={(e) => setKisinti(e.target.value)} inputMode="decimal" placeholder="örn. 3000" style={{ ...field, width: '100%' }} />
                      </label>
                    </div>
                    <div style={{ ...grid(140), gap: '10px', marginBottom: '14px' }}>
                      {([['Mevcut kalanla', trNow, true], ['Tamponla', trTampon, tNum > 0], ['Kısıntıyla', trKisinti, kNum > 0], ['İkisi birlikte', trBoth, tNum > 0 && kNum > 0]] as [string, ReturnType<typeof transition>, boolean][]).map(([t, r, on]) => (
                        <div key={t} style={{ ...card, padding: '10px 12px', opacity: on ? 1 : 0.5 }}>
                          <div style={lab}>{t}</div>
                          <div style={{ fontSize: '17px', fontWeight: 500, color: !on ? 'var(--text-muted)' : r.bitis === null ? '#ef4444' : '#22c55e' }}>{on ? monthsText(r) : '—'}</div>
                        </div>
                      ))}
                    </div>
                    {plan.neden && <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '10px' }}>{plan.neden}</div>}
                    {plan.kapanis.length > 0 && (
                      <div style={card}>
                        <div style={{ ...lab, marginBottom: '6px' }}>Kartlar hangi ay kapanır</div>
                        {plan.kapanis.map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: i < plan.kapanis.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                            <span style={{ width: '104px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                            <div style={{ flex: 1, height: '10px', background: 'var(--bg-tertiary)', borderRadius: '5px', position: 'relative' }}>
                              {c.ay !== null && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, c.ay / Math.max(1, plan.bitis || c.ay) * 100)}%`, background: '#378ADD', borderRadius: '5px' }} />}
                            </div>
                            <b style={{ fontWeight: 500, width: '64px', textAlign: 'right' }}>{c.ay ? `${c.ay}. ay` : '—'}</b>
                          </div>
                        ))}
                        {plan.kapanis.some(c => c.taksitKalan > 0) && <div style={{ ...lab, marginTop: '6px' }}>Taksitli kartlar, taksitleri bitince fiilen kapanabilir (Taksitler bölümüne bakın).</div>}
                      </div>
                    )}
                    {plan.months.length > 0 && (
                      <details style={{ marginTop: '12px' }}>
                        <summary style={{ ...lab, cursor: 'pointer' }}>Ay ay plan</summary>
                        <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr', gap: '4px 10px', marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          <b style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Ay</b><b style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Nakde çevrilen</b><b style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Kartta kalan</b>
                          {plan.months.slice(0, 24).map(m => (<React.Fragment key={m.ay}><span>{m.ay}.</span><span>{fmtTL(m.kayan)}</span><span>{fmtTL(m.kartKalan)}</span></React.Fragment>))}
                        </div>
                      </details>
                    )}
                    <div style={{ ...lab, marginTop: '14px', lineHeight: 1.55 }}>Bir kartı kapatmadan önce: bağlı otomatik ödemeleri ve abonelikleri taşıyın, puan/mili kullanın, yazılı kapatma onayı isteyin, 1 ay sonra ekstreyi kontrol edin.</div>
                  </>
                )}
                {kSec !== 'yol' && <BudgetInsights section={kSec} fileContents={fileContents} budget={budget} onSaveNote={onSaveNote} />}
              </div>
            </div>
          )}

          {tab === 'oneri' && (
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ ...lab, flex: 1 }}>Öneriler</div>
                <button type="button" style={btnPrimary} disabled={advising || T.gelir <= 0} onClick={() => void getAdvice()} title={T.gelir <= 0 ? 'Önce gelir ekleyin' : ''}><Sparkles size={14} /> {advising ? 'Hazırlanıyor…' : 'Öneri al'}</button>
                {advice?.cached && !advising && <button type="button" style={btn} onClick={() => void getAdvice(true)} title="Bütçe değişmedi; yeni öneri ister (rakamlar yine aynı kurallarla hesaplanır)"><RefreshCw size={13} /> Yenile</button>}
              </div>
              {!advice && <div style={{ ...lab, marginTop: '8px', lineHeight: 1.55 }}>Ekstrelerdeki harcama dağılımına ve değişken kalemlere göre kısılabilecek yerler, kademeli kenara atma önerisi ve uyarılar. Sabit giderlere ve kartlara dokunulmaz.</div>}
              {advice && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {advice.cached && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Kayıtlı öneri: bütçeniz değişmediği için aynı sonuç gösteriliyor.</div>}
                  {advice.a.ozet && <div style={{ fontSize: '13px', lineHeight: 1.6 }}>{advice.a.ozet}</div>}
                  <div style={{ ...grid(260), gap: '10px' }}>
                    {advice.a.oneriler.map((o, i) => (
                      <div key={i} style={{ background: 'var(--bg-tertiary)', borderRadius: '10px', padding: '10px 12px' }}>
                        <div style={{ fontWeight: 500 }}>{o.baslik}</div>
                        <div style={{ color: '#22c55e', margin: '2px 0 4px' }}>−{fmtTL(o.aylikTasarruf)}/ay</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{o.aciklama}</div>
                        <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{o.kaynak === 'ekstre' ? 'Ekstre kategorisi' : 'Kalem'}: {o.kalem}</span>
                          {o.kaynak === 'ekstre' ? <span style={{ color: 'var(--text-muted)', fontSize: '11px' }} title="Karttaki harcama: sonraki ekstrede bu kadar az çıkması hedeflenir">hedef · sonraki ekstre</span>
                            : advice.applied.includes(i) ? <span style={{ color: '#22c55e', fontSize: '11.5px', fontWeight: 600 }}>✓ uygulandı</span>
                            : <button type="button" style={{ ...btn, padding: '3px 8px', fontSize: '11.5px' }} onClick={() => applyAdvice(i)} title={`"${o.kalem}" kaleminin tutarını düşürür`}>Limit olarak uygula</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {advice.a.kenaraAtma.aylik > 0 && (
                    <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: '8px', padding: '8px 10px', fontSize: '12.5px', lineHeight: 1.55 }}>
                      <b style={{ fontWeight: 500 }}>Kenara atma:</b> ayda ~{fmtTL(advice.a.kenaraAtma.aylik)}. {advice.a.kenaraAtma.aciklama}
                    </div>
                  )}
                  {advice.a.uyarilar.map((u, i) => (
                    <div key={i} style={{ display: 'flex', gap: '6px', fontSize: '12px', color: '#f59e0b' }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} /> <span>{u}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {chatOpen && chatDrawer}
      </div>
    </div>
  );
}
