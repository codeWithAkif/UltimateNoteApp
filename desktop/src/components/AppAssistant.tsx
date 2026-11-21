import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, Send, Check, Navigation, FileText, Bell, Repeat, MousePointerClick, RefreshCw, Undo2, Trash2, Square } from 'lucide-react';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import { isGeminiConfigured } from '../services/geminiMentor';
import { type AAction, type ChatTurn, askRouter, screenById, reminderPath, appendReminder, appendTask, TASK_PATH, SCREENS, parseReminders, removeLine } from '../services/assistant/assistantAI';
import { designNote, lineDiff, type DesignResult, type DiffOp } from '../services/assistant/noteDesign';
import { snapshotPage, planStep, performStep, highlight, type Step, type PageEl } from '../services/assistant/pageAgent';
import { type Rule, type Sched, type Eylem, RULES_PATH, parseRules, serializeRules, addRule, schedLabel, dueRules, validTime, GUNLER } from '../services/assistant/automation';
import { syncNativeRules, scheduleReminderNative, cancelReminderNative, nativeScheduling } from '../services/assistant/ruleNotify';
import { notifyNow, requestNotifyPermission } from '../services/shopNotify';

const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";
const border = '1px solid var(--border-color)';
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border, color: 'var(--text-secondary)', borderRadius: '8px', padding: '5px 10px', fontSize: '12.5px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' };
const btnP: React.CSSProperties = { ...btn, background: 'var(--accent-color)', border: '1px solid var(--accent-color)', color: '#fff' };
const card: React.CSSProperties = { background: 'var(--bg-tertiary)', border, borderRadius: '10px', padding: '9px 11px', fontSize: '12.5px', lineHeight: 1.5 };
const inp: React.CSSProperties = { background: 'var(--bg-secondary)', border, color: 'var(--text-primary)', borderRadius: '8px', padding: '6px 8px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0 };
const lab: React.CSSProperties = { fontSize: '11.5px', color: 'var(--text-muted)' };
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const GUN_ADLARI = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const ymdLabel = (t: string) => { const [y, m, d] = t.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }); };

type CardState = 'hazirlaniyor' | 'bekliyor' | 'hazir' | 'yapildi' | 'iptal' | 'hata';
interface CardT { id: string; a: AAction; state: CardState; not?: string; design?: { path: string; eski: string; sonuc: DesignResult; diff: DiffOp[] } }
interface Msg { id: string; role: 'user' | 'ai'; text: string; cards?: CardT[] }
interface Run { cardId: string; adim: number; durum: 'calisiyor' | 'bitti' | 'durdu' | 'hata'; log: string[] }
interface Confirm { step: Step; pe?: PageEl; resolve: (v: 'yap' | 'yaptim' | 'dur') => void; neden: string }
interface Fired { id: string; rule: Rule; at: Date }

export default function AppAssistant({ ready, tab, onNavigate, activeNotePath, fileContents, saveNote }: {
  ready: boolean;
  tab: string;
  onNavigate: (id: string) => void;
  activeNotePath: string | null;
  fileContents: Record<string, string>;
  saveNote: (path: string, content: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem('assistant_open_v1') === '1'; } catch { return false; } });
  const [view, setView] = useState<'sohbet' | 'kurallar'>('sohbet');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [stepMode, setStepMode] = useState(true);
  const [fired, setFired] = useState<Fired[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef(false);
  const tabRef = useRef(tab); tabRef.current = tab;
  const stepModeRef = useRef(stepMode); stepModeRef.current = stepMode;
  const filesRef = useRef(fileContents); filesRef.current = fileContents;
  const noteOpen = tab === 'notes' && !!activeNotePath;

  const setOpenP = useCallback((o: boolean) => { setOpen(o); try { localStorage.setItem('assistant_open_v1', o ? '1' : '0'); } catch { /* yoksay */ } }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) { e.preventDefault(); setOpenP(!open); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, setOpenP]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, run, confirm]);

  // ---------------- otomasyon çalıştırıcı (uygulama açıkken dakikada iki kez bakar; kapalıyken kaçanlar açılışta gösterilir) ----------------
  const rules = useMemo(() => parseRules(fileContents[RULES_PATH]), [fileContents]);
  const rulesRef = useRef(rules); rulesRef.current = rules;
  const rulesSig = rules.map(r => `${r.ad}|${r.acik}`).join(';');
  useEffect(() => {
    if (!ready) return;
    const KEY = 'automation_last_run_v1';
    const tick = () => {
      const now = new Date();
      let last = now.getTime();
      try { last = Number(localStorage.getItem(KEY)) || now.getTime(); } catch { /* yoksay */ }
      const from = new Date(Math.max(last, now.getTime() - 48 * 3600 * 1000)); // çok eski kaçanlar gösterilmez
      try { localStorage.setItem(KEY, String(now.getTime())); } catch { /* yoksay */ }
      const due = dueRules(rulesRef.current, from, now);
      if (!due.length) return;
      setFired(f => [...f, ...due.map(d => ({ id: newId(), rule: d.rule, at: d.at }))].slice(-5));
      for (const d of due) { const e = d.rule.eylem; void notifyNow(e.tur === 'bildir' ? e.baslik : d.rule.ad, e.mesaj || (e.tur === 'ac' ? `${screenById(e.ekran)?.ad || e.ekran} ekranını açın` : d.rule.ad)); }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [ready]);
  useEffect(() => { if (ready && nativeScheduling()) void syncNativeRules(rulesRef.current); }, [ready, rulesSig]);

  // ---------------- kart işlemleri ----------------
  const patchCard = (msgId: string, cardId: string, p: Partial<CardT>) => setMsgs(ms => ms.map(m => (m.id === msgId ? { ...m, cards: (m.cards || []).map(c => (c.id === cardId ? { ...c, ...p } : c)) } : m)));

  const prepareDesign = async (msgId: string, c: CardT, path: string) => {
    const eski = filesRef.current[path] ?? '';
    try {
      const sonuc = await designNote({ icerik: eski, talimat: c.a.talimat || '' });
      patchCard(msgId, c.id, { state: 'hazir', design: { path, eski, sonuc, diff: lineDiff(eski, sonuc.icerik) } });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: String(e?.message || e) }); }
  };

  const applyDesign = async (msgId: string, c: CardT) => {
    const d = c.design; if (!d) return;
    if ((filesRef.current[d.path] ?? '') !== d.eski) { patchCard(msgId, c.id, { state: 'hata', not: 'Not siz bakarken değişti. Güvenlik için uygulanmadı; isteği yeniden yazın.' }); return; }
    await saveNote(d.path, d.sonuc.icerik);
    patchCard(msgId, c.id, { state: 'yapildi', not: 'Uygulandı.' });
  };
  const undoDesign = async (msgId: string, c: CardT) => { const d = c.design; if (!d) return; await saveNote(d.path, d.eski); patchCard(msgId, c.id, { state: 'iptal', not: 'Geri alındı.' }); };

  // Hatırlatma kurma (sohbet kartı ve "Otomasyon ve alarm" sekmesindeki form ortak kullanır).
  const createReminder = async (baslik: string, tarih: string, saat: string, mesaj?: string): Promise<{ path: string; native: boolean }> => {
    const path = reminderPath(tarih);
    await saveNote(path, appendReminder(filesRef.current[path], tarih, baslik, saat, mesaj));
    await requestNotifyPermission();
    const [y, m, d] = tarih.split('-').map(Number), [h, mi] = saat.split(':').map(Number);
    const native = await scheduleReminderNative(baslik, mesaj || 'Hatırlatma', new Date(y, m - 1, d, h, mi));
    return { path, native };
  };
  const doRemind = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.tarih || !a.saat || !a.baslik) return;
    const { path, native } = await createReminder(a.baslik, a.tarih, a.saat, a.mesaj);
    patchCard(msgId, c.id, { state: 'yapildi', not: `Kuruldu: ${path} (alarm ${a.saat})${native ? ' · telefona bildirim de zamanlandı' : ''}` });
  };

  // ---------------- "Otomasyon ve alarm" sekmesi: elle ekleme/silme ----------------
  const alarms = useMemo(() => {
    const now = Date.now() - 60_000;
    return parseReminders(fileContents).filter(r => { const [y, m, d] = r.tarih.split('-').map(Number), [h, mi] = r.saat.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime() >= now; });
  }, [fileContents]);
  const [aForm, setAForm] = useState({ baslik: '', tarih: todayYmd(), saat: '09:00' });
  const [rForm, setRForm] = useState({ ad: '', tur: 'gunluk' as Sched['tur'], gun: 1, ayGun: 1, tarih: todayYmd(), saat: '09:00', eylem: 'bildir' as Eylem['tur'], baslik: '', ekran: 'notes' });
  const [formErr, setFormErr] = useState('');

  const addAlarm = async () => {
    const baslik = aForm.baslik.replace(/\s+/g, ' ').trim();
    if (!baslik) { setFormErr('Alarm için bir başlık yazın.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(aForm.tarih) || !validTime(aForm.saat)) { setFormErr('Tarih ve saati seçin.'); return; }
    const [y, m, d] = aForm.tarih.split('-').map(Number), [h, mi] = aForm.saat.split(':').map(Number);
    if (new Date(y, m - 1, d, h, mi).getTime() < Date.now() - 60_000) { setFormErr('Bu zaman geçmişte kaldı; ileri bir tarih/saat seçin.'); return; }
    setFormErr('');
    try { const p = createReminder(baslik, aForm.tarih, aForm.saat); setAForm(f => ({ ...f, baslik: '' })); await p; }
    catch (e: any) { setFormErr(`Alarm kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.`); }
  };
  const removeAlarm = async (r: { path: string; lineIdx: number; tarih: string; saat: string }) => {
    const cur = filesRef.current[r.path]; if (cur === undefined) return;
    await saveNote(r.path, removeLine(cur, r.lineIdx));
    const [y, m, d] = r.tarih.split('-').map(Number), [h, mi] = r.saat.split(':').map(Number);
    void cancelReminderNative(new Date(y, m - 1, d, h, mi));
  };
  const addRuleManual = async () => {
    const ad = rForm.ad.replace(/\s+/g, ' ').trim();
    if (!ad) { setFormErr('Otomasyona bir ad verin.'); return; }
    if (!validTime(rForm.saat)) { setFormErr('Saati seçin.'); return; }
    let sched: Sched;
    if (rForm.tur === 'gunluk') sched = { tur: 'gunluk', saat: rForm.saat };
    else if (rForm.tur === 'haftalik') sched = { tur: 'haftalik', gun: rForm.gun, saat: rForm.saat };
    else if (rForm.tur === 'aylik') sched = { tur: 'aylik', gun: Math.min(28, Math.max(1, rForm.ayGun)), saat: rForm.saat };
    else { if (!/^\d{4}-\d{2}-\d{2}$/.test(rForm.tarih)) { setFormErr('Tarihi seçin.'); return; } sched = { tur: 'bir', tarih: rForm.tarih, saat: rForm.saat }; }
    const eylem: Eylem = rForm.eylem === 'ac' ? { tur: 'ac', ekran: rForm.ekran } : { tur: 'bildir', baslik: (rForm.baslik.trim() || ad).slice(0, 80) };
    const next = addRule(parseRules(filesRef.current[RULES_PATH]), { ad: ad.slice(0, 60), sched, eylem, acik: true });
    if (next.length === parseRules(filesRef.current[RULES_PATH]).length) { setFormErr('Aynı otomasyon zaten var ya da kural sınırına (40) ulaşıldı.'); return; }
    setFormErr('');
    await saveRules(next);
    setRForm(f => ({ ...f, ad: '', baslik: '' }));
    void requestNotifyPermission(); // izin penceresi kaydı/formu bekletmesin
  };

  // Görev: inbox.md'ye etiketli satır eklenir; Takvim/Görev Havuzu tüm notları taradığı için ayrıca bir kayıt gerekmez.
  const doTask = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.tarih || !a.baslik) return;
    try {
      await saveNote(TASK_PATH, appendTask(filesRef.current[TASK_PATH], a.baslik, a.tarih, a.saat, a.bitis));
      patchCard(msgId, c.id, { state: 'yapildi', not: `Eklendi: ${ymdLabel(a.tarih)}${a.saat ? ` ${a.saat}-${a.bitis}` : ''} (Gelen Kutusu / inbox.md). Takvim ve Görev Havuzu'nda görünür.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  const doRule = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.sched || !a.eylem || !a.ad) return;
    const next = addRule(parseRules(filesRef.current[RULES_PATH]), { ad: a.ad, sched: a.sched, eylem: a.eylem, acik: true });
    await saveNote(RULES_PATH, serializeRules(next));
    await requestNotifyPermission();
    if (nativeScheduling()) void syncNativeRules(next);
    patchCard(msgId, c.id, { state: 'yapildi', not: 'Kural kuruldu. Otomasyonlar sekmesinden kapatabilir ya da silebilirsiniz.' });
  };

  const saveRules = async (next: Rule[]) => { await saveNote(RULES_PATH, serializeRules(next)); if (nativeScheduling()) void syncNativeRules(next); };

  // ---------------- sayfa ajanı ----------------
  const runAgent = async (msgId: string, c: CardT) => {
    const talimat = c.a.talimat || '';
    stopRef.current = false;
    patchCard(msgId, c.id, { state: 'bekliyor', not: 'Çalışıyor…' });
    setRun({ cardId: c.id, adim: 0, durum: 'calisiyor', log: [] });
    const gecmis: string[] = [];
    let fails = 0;
    const finish = (durum: Run['durum'], text: string) => {
      setRun(r => (r ? { ...r, durum } : r)); setConfirm(null);
      patchCard(msgId, c.id, { state: durum === 'bitti' ? 'yapildi' : durum === 'hata' ? 'hata' : 'iptal', not: text });
    };
    for (let adim = 1; adim <= 14; adim++) {
      if (stopRef.current) { finish('durdu', 'Durduruldu.'); return; }
      const { els, map } = snapshotPage(document);
      let step: Step;
      try { step = await planStep({ talimat, els, map, gecmis, ekranAd: screenById(tabRef.current)?.ad || tabRef.current, adim }); }
      catch (e: any) { finish('hata', String(e?.message || e)); return; }
      if (stopRef.current) { finish('durdu', 'Durduruldu.'); return; }
      setRun(r => (r ? { ...r, adim, log: [...r.log, step.aciklama] } : r));
      if (step.tur === 'bitti') { finish('bitti', step.aciklama); return; }
      if (step.tur === 'sor') { finish('durdu', step.aciklama); setMsgs(ms => [...ms, { id: newId(), role: 'ai', text: step.aciklama }]); return; }
      if (step.tur === 'basarisiz') { finish('hata', step.aciklama); return; }
      if (step.tur === 'git') { onNavigate(step.ekran!); gecmis.push(`${step.aciklama} → ekran açıldı`); await wait(900); continue; }
      const el = map.get(step.ref!); const pe = els.find(e => e.ref === step.ref);
      if (!el) { finish('hata', 'Öğe bulunamadı.'); return; }
      if (pe?.risk === 'yasak') { finish('durdu', `"${pe.ad}" düğmesine dokunmam yasak (birleştirme/yayın gibi işlemler yalnızca sizin elinizde).`); return; }
      highlight(el, 1500);
      const needConfirm = pe?.risk === 'onay' || stepModeRef.current;
      if (needConfirm) {
        const ans = await new Promise<'yap' | 'yaptim' | 'dur'>(res => setConfirm({ step, pe, resolve: res, neden: pe?.risk === 'onay' ? 'Bu işlem geri alınamayabilir, onayınız gerekiyor.' : 'Adım adım kip açık.' }));
        setConfirm(null);
        if (ans === 'dur' || stopRef.current) { finish('durdu', 'Durduruldu.'); return; }
        if (ans === 'yaptim') { gecmis.push(`${step.aciklama} → kullanıcı kendisi yaptı`); await wait(500); continue; }
      } else await wait(550);
      const r = performStep(map, step);
      gecmis.push(`${step.aciklama} → ${r.mesaj}`);
      fails = r.ok ? 0 : fails + 1;
      if (fails >= 2) { finish('hata', `Adım uygulanamadı: ${r.mesaj}`); return; }
      await wait(800); // sayfa güncellensin
    }
    finish('durdu', 'Adım sınırına (14) ulaşıldı; işlem yarım kalmış olabilir.');
  };

  // ---------------- sohbet ----------------
  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    if (!isGeminiConfigured()) { setErr('Yapay zekâ ayarlı değil: Ayarlar > AI Mentor\'dan Gemini anahtarı ekleyin ya da masaüstünde Claude Code\'u açın.'); return; }
    setInput(''); setErr(''); setBusy(true);
    const um: Msg = { id: newId(), role: 'user', text: message };
    setMsgs(ms => [...ms, um]);
    try {
      const history: ChatTurn[] = msgs.slice(-6).map(m => ({ role: m.role, text: m.text }));
      const res = await askRouter({ ctx: { tab, noteOpen, notePath: activeNotePath || undefined, now: new Date() }, history, message });
      const cards: CardT[] = res.eylemler.map(a => ({ id: newId(), a, state: a.tur === 'notu_tasarla' ? 'hazirlaniyor' : 'bekliyor' }));
      const am: Msg = { id: newId(), role: 'ai', text: res.cevap, cards: cards.length ? cards : undefined };
      setMsgs(ms => [...ms, am]);
      for (const c of cards) if (c.a.tur === 'notu_tasarla' && activeNotePath) void prepareDesign(am.id, c, activeNotePath);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  // ---------------- görünüm ----------------
  const stateNote = (c: CardT) => c.not && <div style={{ ...lab, marginTop: '4px', color: c.state === 'hata' ? '#ef4444' : c.state === 'yapildi' ? '#22c55e' : undefined }}>{c.not}</div>;
  const renderCard = (m: Msg, c: CardT) => {
    const a = c.a;
    const done = c.state === 'yapildi' || c.state === 'iptal';
    const head = (icon: React.ReactNode, title: string) => <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>{icon}{title}</div>;
    if (a.tur === 'git') return (
      <div key={c.id} style={card}>{head(<Navigation size={14} />, `${screenById(a.ekran || '')?.ad || a.ekran} ekranına git`)}
        <div style={{ marginTop: '6px' }}>{c.state === 'yapildi' ? <span style={{ color: '#22c55e' }}>Açıldı ✓</span> : <button type="button" style={btnP} onClick={() => { onNavigate(a.ekran!); patchCard(m.id, c.id, { state: 'yapildi' }); }}>Aç</button>}</div></div>
    );
    if (a.tur === 'notu_tasarla') return (
      <div key={c.id} style={card}>{head(<FileText size={14} />, 'Notu yeniden tasarla')}
        <div style={lab}>{a.talimat}</div>
        {c.state === 'hazirlaniyor' && <div style={{ ...lab, marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={12} className="animate-spin" /> Tasarlanıyor…</div>}
        {c.design && (
          <>
            <div style={{ fontSize: '12.5px', marginTop: '6px' }}>{c.design.sonuc.ozet}</div>
            {c.design.sonuc.uyarilar.map((u, i) => <div key={i} style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>{u}</div>)}
            <div style={{ marginTop: '6px', maxHeight: '220px', overflowY: 'auto', background: 'var(--bg-secondary)', borderRadius: '8px', padding: '6px 8px', fontFamily: 'Consolas, monospace', fontSize: '11px', lineHeight: 1.5 }}>
              {c.design.diff.map((d, i) => d.t === 'ayni' ? null : <div key={i} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: d.t === 'ekle' ? '#22c55e' : '#ef4444', background: d.t === 'ekle' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)' }}>{d.t === 'ekle' ? '+ ' : '− '}{d.s || ' '}</div>)}
              {c.design.diff.every(d => d.t === 'ayni') && <div style={lab}>Değişiklik yok.</div>}
            </div>
            <div style={{ ...lab, marginTop: '4px' }}>Yeşil: eklenen · kırmızı: silinen/taşınan satırlar</div>
            {c.state === 'hazir' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={() => void applyDesign(m.id, c)}><Check size={13} /> Uygula</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
            {c.state === 'yapildi' && <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ color: '#22c55e' }}>Uygulandı ✓</span><button type="button" style={btn} onClick={() => void undoDesign(m.id, c)}><Undo2 size={13} /> Geri al</button></div>}
          </>
        )}
        {c.state !== 'yapildi' && stateNote(c)}
      </div>
    );
    if (a.tur === 'hatirlat') return (
      <div key={c.id} style={card}>{head(<Bell size={14} />, `Hatırlatma: ${a.baslik}`)}
        <div style={lab}>{ymdLabel(a.tarih || '')} · {a.saat}</div>
        {!done && c.state !== 'hata' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={() => void doRemind(m.id, c)}><Check size={13} /> Kur</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
        {stateNote(c)}
      </div>
    );
    if (a.tur === 'gorev') return (
      <div key={c.id} style={card}>{head(<Check size={14} />, `Görev: ${a.baslik}`)}
        <div style={lab}>{ymdLabel(a.tarih || '')}{a.saat ? ` · ${a.saat}-${a.bitis}` : ' · saat yok'}</div>
        {!done && c.state !== 'hata' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={() => void doTask(m.id, c)}><Check size={13} /> Ekle</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
        {stateNote(c)}
      </div>
    );
    if (a.tur === 'otomasyon') return (
      <div key={c.id} style={card}>{head(<Repeat size={14} />, `Otomasyon: ${a.ad}`)}
        <div style={lab}>{a.sched ? schedLabel(a.sched) : ''} → {a.eylem?.tur === 'ac' ? `${screenById(a.eylem.ekran)?.ad || a.eylem.ekran} ekranını aç` : `bildirim: ${a.eylem?.baslik}`}</div>
        {!done && c.state !== 'hata' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={() => void doRule(m.id, c)}><Check size={13} /> Kur</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
        {stateNote(c)}
      </div>
    );
    return (
      <div key={c.id} style={card}>{head(<MousePointerClick size={14} />, 'Sayfada işlem yapayım')}
        <div style={lab}>{a.talimat}</div>
        {(c.state === 'bekliyor' && !(run && run.cardId === c.id && run.durum === 'calisiyor')) && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={btnP} disabled={!!run && run.durum === 'calisiyor'} onClick={() => void runAgent(m.id, c)}><MousePointerClick size={13} /> Başla</button>
            <label style={{ ...lab, display: 'inline-flex', alignItems: 'center', gap: '5px' }}><input type="checkbox" checked={stepMode} onChange={(e) => setStepMode(e.target.checked)} /> Her adımda onay iste</label>
          </div>
        )}
        {stateNote(c)}
      </div>
    );
  };

  const suggestions = noteOpen
    ? ['Başlığı mavi yap, altını 3 parçaya böl: solda görev listesi, ortada madde işaretleri', 'Bu notun en üstüne bir uyarı kutusu ekle', 'Bu ekranda ne yapabilirim?']
    : ['Bu ekranda ne yapabilirim?', 'Yarın sabah 9\'da annemi aramayı hatırlat', 'Cuma 14:00-15:30 takvime sunum hazırlığı görevi ekle', 'Her pazartesi 09:00\'da alışveriş ekranını aç'];

  const wrapStyle: React.CSSProperties = { fontFamily: FONT, fontSize: '13px', color: 'var(--text-primary)' };
  return (
    <div data-agent-ignore="1" style={wrapStyle}>
      {/* otomasyon bildirim kartları */}
      {fired.length > 0 && (
        <div style={{ position: 'fixed', right: '16px', bottom: open ? '16px' : '72px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 2147482000, width: 'min(340px, calc(100vw - 32px))', transform: open ? 'translateX(calc(-1 * min(430px, 100vw) - 8px))' : 'none' }}>
          {fired.map(f => (
            <div key={f.id} style={{ ...card, background: 'var(--bg-secondary)', boxShadow: '0 6px 22px rgba(0,0,0,0.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}><Bell size={14} /> {f.rule.eylem.tur === 'bildir' ? f.rule.eylem.baslik : f.rule.ad}</div>
              <div style={lab}>{f.rule.eylem.mesaj || (f.rule.eylem.tur === 'ac' ? `${screenById(f.rule.eylem.ekran)?.ad || f.rule.eylem.ekran} ekranını açın` : f.rule.ad)}</div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {f.rule.eylem.tur === 'ac' && <button type="button" style={btnP} onClick={() => { onNavigate((f.rule.eylem as any).ekran); setFired(x => x.filter(y => y.id !== f.id)); }}>Aç</button>}
                <button type="button" style={btn} onClick={() => setFired(x => x.filter(y => y.id !== f.id))}>Kapat</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!open && (
        <button type="button" onClick={() => setOpenP(true)} aria-label="Asistanı aç (Ctrl+K)" title="Asistan (Ctrl+K)"
          style={{ position: 'fixed', right: '16px', bottom: '16px', width: '46px', height: '46px', borderRadius: '50%', border: 'none', background: 'var(--accent-color)', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', zIndex: 2147482000, boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}>
          <Sparkles size={20} />
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Asistan" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(430px, 100vw)', background: 'var(--bg-secondary)', borderLeft: border, display: 'flex', flexDirection: 'column', zIndex: 2147482000, boxShadow: '-8px 0 30px rgba(0,0,0,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderBottom: border }}>
            <Sparkles size={16} color="var(--accent-color)" />
            <div style={{ fontWeight: 500, flex: 1 }}>Asistan <span style={lab}>· {screenById(tab)?.ad || tab}</span></div>
            <button type="button" style={{ ...btn, padding: '4px 7px' }} onClick={() => setOpenP(false)} aria-label="Asistanı kapat"><X size={14} /></button>
          </div>
          <div style={{ display: 'flex', gap: '2px', padding: '0 12px', borderBottom: border }}>
            {([['sohbet', 'Sohbet'], ['kurallar', `Otomasyon ve alarm${rules.length + alarms.length ? ` (${rules.length + alarms.length})` : ''}`]] as ['sohbet' | 'kurallar', string][]).map(([id, t]) => (
              <button key={id} type="button" onClick={() => setView(id)} style={{ background: 'none', border: 'none', borderBottom: `2px solid ${view === id ? 'var(--accent-color)' : 'transparent'}`, color: view === id ? 'var(--text-primary)' : 'var(--text-muted)', padding: '8px 10px', fontSize: '13px', fontWeight: view === id ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{t}</button>
            ))}
          </div>

          {view === 'kurallar' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
              {formErr && <div style={{ fontSize: '12px', color: '#ef4444', marginBottom: '8px', overflowWrap: 'anywhere' }}>{formErr}</div>}
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Alarmlar</div>
              <div style={{ ...lab, marginBottom: '8px', lineHeight: 1.55 }}>Tek seferlik hatırlatmalar. Not: <code>Hatırlatmalar/&lt;tarih&gt;.md</code></div>
              <div style={{ ...card, marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input value={aForm.baslik} onChange={(e) => setAForm(f => ({ ...f, baslik: e.target.value }))} placeholder="Örn. Annemi ara" aria-label="Alarm başlığı" style={inp} />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input type="date" value={aForm.tarih} onChange={(e) => setAForm(f => ({ ...f, tarih: e.target.value }))} aria-label="Alarm tarihi" style={{ ...inp, flex: 1 }} />
                  <input type="time" value={aForm.saat} onChange={(e) => setAForm(f => ({ ...f, saat: e.target.value }))} aria-label="Alarm saati" style={{ ...inp, width: '110px' }} />
                </div>
                <div><button type="button" style={btnP} onClick={() => void addAlarm()}><Bell size={13} /> Alarm ekle</button></div>
              </div>
              {alarms.length === 0 && <div style={{ ...lab, marginBottom: '8px' }}>Yaklaşan alarm yok.</div>}
              {alarms.map(r => (
                <div key={r.path + r.lineIdx} style={{ ...card, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{r.baslik}</div>
                    <div style={lab}>{ymdLabel(r.tarih)} · {r.saat}</div>
                  </div>
                  <button type="button" style={btn} onClick={() => void removeAlarm(r)} aria-label={`${r.baslik} alarmını sil`}><Trash2 size={13} /> Sil</button>
                </div>
              ))}

              <div style={{ fontWeight: 600, margin: '16px 0 4px' }}>Otomasyonlar</div>
              <div style={{ ...lab, marginBottom: '8px', lineHeight: 1.55 }}>Tekrarlayan kurallar. Kural yalnızca bildirim gösterir ya da bir ekranı açar; hiçbir şeyi silmez veya göndermez. Not: <code>{RULES_PATH}</code></div>
              <div style={{ ...card, marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input value={rForm.ad} onChange={(e) => setRForm(f => ({ ...f, ad: e.target.value }))} placeholder="Ad (örn. Sabah planı)" aria-label="Otomasyon adı" style={inp} />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <select value={rForm.tur} onChange={(e) => setRForm(f => ({ ...f, tur: e.target.value as Sched['tur'] }))} aria-label="Sıklık" style={{ ...inp, flex: 1 }}>
                    <option value="gunluk">Her gün</option><option value="haftalik">Haftalık</option><option value="aylik">Ayın günü</option><option value="bir">Tek sefer</option>
                  </select>
                  {rForm.tur === 'haftalik' && <select value={rForm.gun} onChange={(e) => setRForm(f => ({ ...f, gun: Number(e.target.value) }))} aria-label="Gün" style={inp}>{GUNLER.map((_, i) => <option key={i} value={i + 1}>{GUN_ADLARI[i]}</option>)}</select>}
                  {rForm.tur === 'aylik' && <input type="number" min={1} max={28} value={rForm.ayGun} onChange={(e) => setRForm(f => ({ ...f, ayGun: Number(e.target.value) || 1 }))} aria-label="Ayın günü" style={{ ...inp, width: '70px' }} />}
                  {rForm.tur === 'bir' && <input type="date" value={rForm.tarih} onChange={(e) => setRForm(f => ({ ...f, tarih: e.target.value }))} aria-label="Tarih" style={inp} />}
                  <input type="time" value={rForm.saat} onChange={(e) => setRForm(f => ({ ...f, saat: e.target.value }))} aria-label="Saat" style={{ ...inp, width: '110px' }} />
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <select value={rForm.eylem} onChange={(e) => setRForm(f => ({ ...f, eylem: e.target.value as Eylem['tur'] }))} aria-label="Eylem" style={inp}>
                    <option value="bildir">Bildirim göster</option><option value="ac">Ekranı aç</option>
                  </select>
                  {rForm.eylem === 'bildir'
                    ? <input value={rForm.baslik} onChange={(e) => setRForm(f => ({ ...f, baslik: e.target.value }))} placeholder="Bildirim başlığı (boşsa ad)" aria-label="Bildirim başlığı" style={{ ...inp, flex: 1 }} />
                    : <select value={rForm.ekran} onChange={(e) => setRForm(f => ({ ...f, ekran: e.target.value }))} aria-label="Ekran" style={{ ...inp, flex: 1 }}>{SCREENS.map(sc => <option key={sc.id} value={sc.id}>{sc.ad}</option>)}</select>}
                </div>
                <div><button type="button" style={btnP} onClick={() => void addRuleManual()}><Repeat size={13} /> Otomasyon ekle</button></div>
              </div>
              {rules.length === 0 && <div style={lab}>Henüz kural yok. Yukarıdan ekleyin ya da sohbette "her pazartesi 09:00'da alışveriş ekranını aç" gibi bir şey yazın.</div>}
              {rules.map(r => (
                <div key={r.id} style={{ ...card, marginBottom: '8px', opacity: r.acik ? 1 : 0.55 }}>
                  <div style={{ fontWeight: 500 }}>{r.ad}</div>
                  <div style={lab}>{schedLabel(r.sched)} → {r.eylem.tur === 'ac' ? `${screenById(r.eylem.ekran)?.ad || r.eylem.ekran} ekranını aç` : `bildirim: ${r.eylem.baslik}`}</div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <button type="button" style={btn} onClick={() => void saveRules(rules.map(x => (x.id === r.id ? { ...x, acik: !x.acik } : x)))}>{r.acik ? 'Kapat' : 'Aç'}</button>
                    <button type="button" style={btn} onClick={() => void saveRules(rules.filter(x => x.id !== r.id))} aria-label={`${r.ad} kuralını sil`}><Trash2 size={13} /> Sil</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {msgs.length === 0 && (
                  <div>
                    <div style={{ ...lab, lineHeight: 1.6, marginBottom: '10px' }}>
                      Uygulamada ne yapabileceğinizi anlatırım, sizi ilgili ekrana götürürüm, açık notu tasarlarım, hatırlatma ve otomasyon kurarım, sayfadaki düğmelere sizin yerinize basarım. Hiçbir şeyi onayınız olmadan yazmam ya da silmem.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {suggestions.map(s => <button key={s} type="button" style={{ ...btn, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => void send(s)}>{s}</button>)}
                    </div>
                    <div style={{ ...lab, marginTop: '10px' }}>Kısayol: Ctrl+K</div>
                  </div>
                )}
                {msgs.map(m => (
                  <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'stretch', maxWidth: m.role === 'user' ? '90%' : '100%' }}>
                    <div style={{ background: m.role === 'user' ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: m.role === 'user' ? '#fff' : 'var(--text-primary)', borderRadius: '10px', padding: '8px 11px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>{m.text}</div>
                    {m.cards && <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>{m.cards.map(c => renderCard(m, c))}</div>}
                  </div>
                ))}
                {run && run.durum === 'calisiyor' && (
                  <div style={{ ...card, borderColor: 'var(--accent-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={13} className="animate-spin" /><b style={{ fontWeight: 500, flex: 1 }}>Çalışıyor · adım {run.adim}</b><button type="button" style={btn} onClick={() => { stopRef.current = true; confirm?.resolve('dur'); }}><Square size={12} /> Dur</button></div>
                    <div style={{ ...lab, marginTop: '4px' }}>{run.log[run.log.length - 1]}</div>
                    {confirm && (
                      <div style={{ marginTop: '8px', borderTop: border, paddingTop: '8px' }}>
                        <div style={{ fontWeight: 500 }}>{confirm.step.aciklama}</div>
                        <div style={lab}>{confirm.pe ? `Hedef: "${confirm.pe.ad}"` : ''} · {confirm.neden}</div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                          <button type="button" style={btnP} onClick={() => confirm.resolve('yap')}><Check size={13} /> Yap</button>
                          <button type="button" style={btn} onClick={() => confirm.resolve('yaptim')}>Ben yaptım</button>
                          <button type="button" style={btn} onClick={() => confirm.resolve('dur')}>Dur</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {busy && <div style={{ ...lab, display: 'flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={13} className="animate-spin" /> Düşünüyor…</div>}
                <div ref={endRef} />
              </div>
              <div style={{ padding: '10px 12px', borderTop: border }}>
                {err && <div style={{ fontSize: '12px', color: '#ef4444', marginBottom: '6px', overflowWrap: 'anywhere' }}>{err}</div>}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} aria-label="Asistana mesaj" placeholder={noteOpen ? 'Örn. başlığı mavi yap, altını 3 parçaya böl…' : 'Ne yapmak istersiniz?'}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    style={{ flex: 1, resize: 'none', background: 'var(--bg-tertiary)', border, color: 'var(--text-primary)', borderRadius: '8px', padding: '7px 9px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  <button type="button" style={{ ...btnP, padding: '8px', opacity: input.trim() && !busy ? 1 : 0.6 }} disabled={!input.trim() || busy} onClick={() => void send()} aria-label="Gönder"><Send size={14} /></button>
                </div>
                <div style={{ ...lab, marginTop: '5px' }}>{SCREENS.length} ekran biliyorum · sayfa içeriğiniz yapay zekâya gönderilmez, yalnızca ekrandaki düğme adları gider.</div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
