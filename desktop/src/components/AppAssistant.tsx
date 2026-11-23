import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hand, Orbit, Sparkles, X, Send, Check, Mic, Navigation, FileText, Bell, Repeat, MousePointerClick, RefreshCw, Undo2, Trash2, Square } from 'lucide-react';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import { isGeminiConfigured } from '../services/geminiMentor';
import { parseDayNote } from './DayNoteCards';
import { buildBriefing } from '../services/assistant/dayBriefing';
import JarvisCore, { type CoreState } from './JarvisCore';
import { canRecord, canTranscribe, startRecording, transcribe, speak, useGeminiVoice, setGeminiVoice, type Recording, type Speaking } from '../services/assistant/voice';
import VoiceMode from './VoiceMode';
import type { DeskCard } from './HoloDesk';
// El kontrolü (MediaPipe) yalnızca açılınca yüklenir: uygulamanın açılışını yavaşlatmaz
const HoloDesk = React.lazy(() => import('./HoloDesk'));
const NoteSpace = React.lazy(() => import('./NoteSpace'));
import { type AAction, type ChatTurn, askRouter, screenById, reminderPath, appendReminder, appendTask, projectSlug, TASK_PATH, SCREENS, parseReminders, removeLine } from '../services/assistant/assistantAI';
import { designNote, lineDiff, type DesignResult, type DiffOp } from '../services/assistant/noteDesign';
import { snapshotPage, planStep, performStep, highlight, type Step, type PageEl } from '../services/assistant/pageAgent';
import { type Rule, type Sched, type Eylem, RULES_PATH, parseRules, serializeRules, addRule, schedLabel, dueRules, validTime, GUNLER } from '../services/assistant/automation';
import { syncNativeRules, scheduleReminderNative, cancelReminderNative, nativeScheduling } from '../services/assistant/ruleNotify';
import { notifyNow, requestNotifyPermission } from '../services/shopNotify';
import { KANBAN_CONFIG_PATH, parseKanbanConfig, columnsForProject } from '../kanbanColumns';
import { slugOf, findTaskCandidates, newClientFile, newProjectFile, lineStatus, appendDiary, diaryPath, setDueOnLine, foldTr, type TaskCand } from '../services/assistant/projectOps';
import { LIST_PATH, listAdd, listToggle, guessCat, type LItem } from '../services/shopList';
import { parseBudgetNote, serializeBudget, emptyBudget, monthPath, monthOf, totals, fmtTL, monthLabel, reindex, type BudgetItem } from '../services/budget';
import type { NewFinanceEntryInput } from '../services/financeSync';
import { parseLabState, serializeLabState, todayKey, LANGUAGE_LAB_NOTE_PATH } from '../services/languageLab';
import { findRelevantNotes, askNotesChat, callGeminiGroundedText } from '../services/geminiMentor';
import { sanitizeName } from '../services/assistant/projectOps';
import { ambientAudioService, AMBIENT_SOUNDS, AMBIENT_PRESETS } from '../services/ambientAudio';
import { findShopCandidates, appendCards, proposeCards, inboxOpenTasks, proposeInbox, tagLineProject, productivitySummary, daySummary, type CardPair, type InboxMove } from '../services/assistant/assistantTools';

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
interface CardT { id: string; a: AAction; state: CardState; not?: string; cands?: TaskCand[]; pick?: number; pairs?: CardPair[]; moves?: InboxMove[]; buy?: { istek: string; cands: LItem[]; pick: number }[]; design?: { path: string; eski: string; sonuc: DesignResult; diff: DiffOp[] } }
interface SendInfo { say: string; bekleyen: number; hatalar: string[] }
interface Msg { id: string; role: 'user' | 'ai'; text: string; cards?: CardT[] }
interface Run { cardId: string; adim: number; durum: 'calisiyor' | 'bitti' | 'durdu' | 'hata'; log: string[] }
interface Confirm { step: Step; pe?: PageEl; resolve: (v: 'yap' | 'yaptim' | 'dur') => void; neden: string }
interface Fired { id: string; rule: Rule; at: Date }

export default function AppAssistant({ ready, tab, onNavigate, activeNotePath, fileContents, saveNote, clientsFolder, changeTaskStatus, financeCategoryNames, addFinanceEntry, openNote }: {
  ready: boolean;
  tab: string;
  onNavigate: (id: string) => void;
  activeNotePath: string | null;
  fileContents: Record<string, string>;
  saveNote: (path: string, content: string) => Promise<void>;
  clientsFolder: string;
  changeTaskStatus: (id: string, status: string) => Promise<void>;
  financeCategoryNames: string[];
  addFinanceEntry: (input: NewFinanceEntryInput) => Promise<unknown>;
  openNote: (path: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem('assistant_open_v1') === '1'; } catch { return false; } });
  const [view, setView] = useState<'sohbet' | 'kurallar'>('sohbet');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  // Sesle yazma: tarayıcının SpeechRecognition'ı varsa (telefon WebView'ında olmayabilir; yoksa düğme gizlenir). Konuşma kutuya yazılır, otomatik gönderilmez.
  const SpeechCls: any = typeof window !== 'undefined' && !(window as any).electron ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  // Masaüstünde (Electron) SpeechRecognition yok: ses kaydedilip Gemini ile yazıya çevrilir, çevrilince doğrudan gönderilir
  const rec2 = useRef<Recording | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const toggleMic = async () => {
    if (!SpeechCls) {
      if (rec2.current) {
        setListening(false); setTranscribing(true);
        try { const blob = await rec2.current.stop(); rec2.current = null; const t = await transcribe(blob); setTranscribing(false); void send(t); }
        catch (e: any) { rec2.current = null; setTranscribing(false); setErr(String(e?.message || 'Ses işlenemedi.')); }
        return;
      }
      if (!canTranscribe()) { setErr('Sesli komut için Ayarlar > AI Mentor bölümüne Gemini anahtarı gerekir (Claude Code ses almıyor).'); return; }
      try { rec2.current = await startRecording(); setErr(''); setListening(true); } catch { setErr('Mikrofon izni verilmedi. Uygulama/Windows ayarlarından izin verin.'); }
      return;
    }
    if (listening) { try { recRef.current?.stop(); } catch { /* yoksay */ } return; }
    try {
      const r = new SpeechCls();
      r.lang = 'tr-TR'; r.interimResults = true; r.continuous = false;
      r.onresult = (ev: any) => { let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript; setInput(t.trim()); };
      r.onerror = (ev: any) => { setListening(false); setErr(ev?.error === 'not-allowed' ? 'Mikrofon izni verilmedi. Tarayıcı/uygulama ayarlarından izin verin.' : 'Ses tanınamadı. Tekrar deneyin ya da yazın.'); };
      r.onend = () => setListening(false);
      recRef.current = r; setErr(''); setListening(true); r.start();
    } catch { setListening(false); setErr('Mikrofon başlatılamadı. Yazarak devam edebilirsiniz.'); }
  };
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
  // Otomatik modda arka arkaya yazılan eylemler aynı dosyaya dokunabilir; kayıt yeniden çizime yansımadan sonraki eylem eski içeriği okurdu (kayıp güncelleme).
  // Bu yüzden yazılan içerik hemen yerel referansa da işlenir; bir sonraki çizimde gerçek durum zaten bunu içerir.
  const writeNote = async (path: string, content: string) => { filesRef.current = { ...filesRef.current, [path]: content }; await saveNote(path, content); };
  const noteOpen = tab === 'notes' && !!activeNotePath;

  // Jarvis masası (el kontrolü): ekranlar küre, bugünün açık işleri kart olarak gelir
  const [holo, setHolo] = useState(false);
  const [holoBrief, setHoloBrief] = useState(false);
  const [space, setSpace] = useState(false); // Not uzayı: notlar derinlikte yüzen kartlar
  const deskCards = useMemo<DeskCard[]>(() => {
    const orbs: [string, number][] = [['notes', 200], ['calendar', 170], ['tasks', 280], ['projects', 35], ['budget', 140], ['shopping', 20], ['dashboard', 320], ['aichat', 250]];
    const out: DeskCard[] = orbs.map(([id, hue]) => ({ id: 'o-' + id, kind: 'orb', title: screenById(id)?.ad || id, hue, screen: id }));
    out.push({ id: 'o-notespace', kind: 'orb', title: 'Not uzayı', hue: 175, screen: 'notespace' }, { id: 'a-brief', kind: 'orb', title: 'Günümü anlat', hue: 50, action: 'briefing' }, { id: 'a-mic', kind: 'orb', title: 'Konuş', hue: 330, action: 'mic' });
    if (!holo) return out;
    const n = new Date(), today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    const text = filesRef.current[`Günlükler/${today}.md`];
    if (text) parseDayNote(text).cards.filter(c => c.status !== 'x').slice(0, 5).forEach((c, i) =>
      out.push({ id: 't-' + i, kind: 'task', title: c.title.replace(/\*\*|==/g, '') || '(başlıksız)', sub: c.planned ? c.planned.replace('-', '–') : c.slug ? c.slug : undefined, hue: 45 + (i % 3) * 30 }));
    return out;
  }, [holo]);
  const deskScenes = useMemo(() => (holo ? buildBriefing(filesRef.current, new Date()) : []), [holo]);

  const setOpenP = useCallback((o: boolean) => { setOpen(o); try { localStorage.setItem('assistant_open_v1', o ? '1' : '0'); } catch { /* yoksay */ } }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) { e.preventDefault(); setOpenP(!open); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'j' && !e.altKey) { e.preventDefault(); setHolo(v => !v); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'u' && !e.altKey) { e.preventDefault(); setSpace(v => !v); }
    };
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
  // Otomatik mod (varsayılan açık): net eylemler onay beklemeden uygulanır. Belirsiz olanlar (birden çok eşleşme, eşleşmeyen proje, önizleme gerektirenler) yine kartla sorar.
  const [auto, setAuto] = useState<boolean>(() => { try { return localStorage.getItem('assistant_auto_v1') !== '0'; } catch { return true; } });
  const autoRef = useRef(auto); autoRef.current = auto;
  // Geniş ekranda panel tam yükseklikte olursa sağ üstteki pencere/araç düğmelerini örter; bu yüzden orada ekranın ~2/3'ü kadar ve alta yaslı açılır.
  const [wide, setWide] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 769px)').matches);
  useEffect(() => { const mq = window.matchMedia('(min-width: 769px)'); const f = () => setWide(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  const toggleAuto = () => { const n = !auto; setAuto(n); try { localStorage.setItem('assistant_auto_v1', n ? '1' : '0'); } catch { /* yoksay */ } };
  const cardMeta = useRef(new Map<string, AAction>());
  const cardRes = useRef(new Map<string, { state: string; not?: string }>());
  // Sesli modda sayfa değiştirme/panel kapatma/not açma yapılmaz: kullanıcı konuşmaya odaklıdır, ekran onu bölmemeli.
  const voiceRef = useRef(false);
  // İşlem bir sayfayı ilgilendiriyorsa başarıdan sonra o sayfa açılır; telefonda panel de kapanır ki sonuç görünsün.
  const screenFor = (a: AAction): string | null => {
    switch (a.tur) {
      case 'git': return a.ekran || null;
      case 'gorev': case 'gorev_gun': return 'calendar';
      case 'gorevler': return a.proje ? 'projects' : 'calendar';
      case 'proje_ac': case 'gorev_tasi': return 'projects';
      case 'alisveris': case 'alisveris_al': return 'shopping';
      case 'finans': return 'finance';
      case 'butce': return 'budget';
      case 'gunluk': return 'diary';
      case 'kelime_ekle': return 'language';
      case 'kart_ekle': return 'srs';
      case 'ortam': return 'ambient';
      case 'not_olustur': return null;
      default: return null;
    }
  };
  const closeOnMobile = () => { if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) setTimeout(() => setOpenP(false), 700); };
  const afterDone = (cardId: string) => {
    if (voiceRef.current) return;
    const a = cardMeta.current.get(cardId); const target = a && screenFor(a);
    if (!target) return;
    onNavigate(target);
    closeOnMobile();
  };
  const patchCard = (msgId: string, cardId: string, p: Partial<CardT>) => { if (p.state === 'yapildi') afterDone(cardId); patchCard0(msgId, cardId, p); };
  const patchCard0 = (msgId: string, cardId: string, p: Partial<CardT>) => { if (p.state) cardRes.current.set(cardId, { state: p.state, not: p.not }); setMsgs(ms => ms.map(m => (m.id === msgId ? { ...m, cards: (m.cards || []).map(c => (c.id === cardId ? { ...c, ...p } : c)) } : m))); };

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
    await writeNote(d.path, d.sonuc.icerik);
    patchCard(msgId, c.id, { state: 'yapildi', not: 'Uygulandı.' });
  };
  const undoDesign = async (msgId: string, c: CardT) => { const d = c.design; if (!d) return; await writeNote(d.path, d.eski); patchCard(msgId, c.id, { state: 'iptal', not: 'Geri alındı.' }); };

  // Hatırlatma kurma (sohbet kartı ve "Otomasyon ve alarm" sekmesindeki form ortak kullanır).
  const createReminder = async (baslik: string, tarih: string, saat: string, mesaj?: string): Promise<{ path: string; native: boolean }> => {
    const path = reminderPath(tarih);
    await writeNote(path, appendReminder(filesRef.current[path], tarih, baslik, saat, mesaj));
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
    await writeNote(r.path, removeLine(cur, r.lineIdx));
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
    else if (rForm.tur === 'aylik') sched = { tur: 'aylik', gun: Math.min(31, Math.max(1, rForm.ayGun)), saat: rForm.saat };
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
  // #proje etiketli notlar (App.tsx ve Proje Yönetimi ile aynı ölçüt): ad → not yolu.
  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const [path, content] of Object.entries(fileContents)) {
      if (!/\.md$/i.test(path) || path.startsWith('Hatırlatmalar/') || path.startsWith('Sistem/')) continue;
      if (/#proje(?![a-zçğıöşü0-9_])/i.test(content || '')) m.set((path.split('/').pop() || path).replace(/\.md$/i, ''), path);
    }
    return m;
  }, [fileContents]);
  const projectMapRef = useRef(projectMap); projectMapRef.current = projectMap;

  // Geri al: yazılmadan önceki içerik saklanır; yalnızca dosya hâlâ bizim yazdığımız hâldeyse geri yüklenir (sonradan yapılan düzenleme ezilmez).
  const undoRef = useRef(new Map<string, { path: string; before: string | undefined; after: string }[]>());
  const statusUndoRef = useRef(new Map<string, { id: string; old: string }>());
  const saveT = async (cardId: string, path: string, content: string) => {
    undoRef.current.set(cardId, [...(undoRef.current.get(cardId) || []), { path, before: filesRef.current[path], after: content }]);
    await writeNote(path, content);
  };
  const canUndo = (c: CardT) => c.state === 'yapildi' && (statusUndoRef.current.has(c.id) || (() => { const e = undoRef.current.get(c.id); return !!e && e.length > 0 && e.every(x => x.before !== undefined); })());
  const doUndo = async (msgId: string, c: CardT) => {
    try {
      const su = statusUndoRef.current.get(c.id);
      if (su) { await changeTaskStatus(su.id, su.old); statusUndoRef.current.delete(c.id); patchCard(msgId, c.id, { state: 'iptal', not: 'Geri alındı: görev eski durumuna döndü.' }); return; }
      const ents = [...(undoRef.current.get(c.id) || [])].reverse();
      for (const e of ents) {
        let cur = filesRef.current[e.path];
        for (let i = 0; i < 4 && cur !== e.after; i++) { await wait(250); cur = filesRef.current[e.path]; }
        if (cur !== e.after) { patchCard(msgId, c.id, { state: 'hata', not: 'Dosya sonradan değişmiş; başkasının düzenlemesini ezmemek için geri alınmadı. Elle düzeltin.' }); return; }
        await writeNote(e.path, e.before as string);
      }
      undoRef.current.delete(c.id);
      patchCard(msgId, c.id, { state: 'iptal', not: 'Geri alındı.' });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Geri alınamadı: ${String(e?.message || e)}.` }); }
  };

  const doTask = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.tarih || !a.baslik) return;
    try {
      const projPath = a.proje ? projectMapRef.current.get(a.proje) : undefined;
      const when = `${ymdLabel(a.tarih)}${a.saat ? ` ${a.saat}-${a.bitis}` : ''}`;
      if (a.proje && projPath && filesRef.current[projPath] !== undefined) {
        await saveT(c.id, projPath, appendTask(filesRef.current[projPath], a.baslik, a.tarih, a.saat, a.bitis, projectSlug(a.proje), a.tekrar));
        patchCard(msgId, c.id, { state: 'yapildi', not: `Eklendi: ${when} · ${a.proje} projesine. Takvim, Görev Havuzu ve Proje Yönetimi'nde görünür.` });
      } else {
        await saveT(c.id, TASK_PATH, appendTask(filesRef.current[TASK_PATH], a.baslik, a.tarih, a.saat, a.bitis, undefined, a.tekrar));
        patchCard(msgId, c.id, { state: 'yapildi', not: `Eklendi: ${when} (Gelen Kutusu / inbox.md). Takvim ve Görev Havuzu'nda görünür.${a.proje ? ' Proje notu bulunamadığı için projeye bağlanmadı.' : ''}` });
      }
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  // Müşteriler: #müşteri etiketli notlar (Proje Yönetimi ile aynı ölçüt): ad → not yolu.
  const clientMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const [path, content] of Object.entries(fileContents)) {
      if (!/\.md$/i.test(path) || path.startsWith('Hatırlatmalar/') || path.startsWith('Sistem/')) continue;
      if (/#müşteri(?![a-zçğıöşü0-9_])/i.test(content || '')) m.set((path.split('/').pop() || path).replace(/\.md$/i, ''), path);
    }
    return m;
  }, [fileContents]);
  const clientMapRef = useRef(clientMap); clientMapRef.current = clientMap;
  // Durum sütunları Sistem/Kanban.md'den okunur; proje verilmişse o projenin sütunları geçerlidir.
  const columnsFor = (proje?: string) => columnsForProject(parseKanbanConfig(filesRef.current[KANBAN_CONFIG_PATH]), proje || null).filter(c => !c.hidden).map(c => ({ key: c.key, title: c.title }));

  const doProjeAc = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.ad || !a.musteri) return;
    try {
      const cp = clientMapRef.current.get(a.musteri);
      const f = newProjectFile(a.musteri, cp, clientsFolder, a.ad);
      if (filesRef.current[f.path] !== undefined || projectMapRef.current.has(a.ad)) { patchCard(msgId, c.id, { state: 'hata', not: `"${a.ad}" adında bir proje zaten var; üzerine yazılmadı. Farklı bir ad deneyin.` }); return; }
      await saveT(c.id, f.path, f.content);
      patchCard(msgId, c.id, { state: 'yapildi', not: `"${a.ad}" projesi ${a.musteri} müşterisinin altına açıldı. Proje Yönetimi'nde görünür.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Proje açılamadı: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  const doMusteriVeProje = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.ad || !a.musteriIstek) return;
    try {
      const cf = newClientFile(clientsFolder, a.musteriIstek);
      if (filesRef.current[cf.path] !== undefined) { patchCard(msgId, c.id, { state: 'hata', not: 'Bu müşteri dosyası zaten var; üzerine yazılmadı.' }); return; }
      const name = cf.path.split('/').pop()!.replace(/\.md$/i, '');
      const pf = newProjectFile(name, cf.path, clientsFolder, a.ad);
      await saveT(c.id, cf.path, cf.content);
      await saveT(c.id, pf.path, pf.content);
      patchCard(msgId, c.id, { state: 'yapildi', not: `"${name}" müşterisi ve altında "${a.ad}" projesi açıldı.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Açılamadı: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  // Çoklu görev: tek kartla hepsi aynı proje notuna (ya da inbox.md'ye) tek yazımda eklenir.
  const doTasks = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.basliklar?.length) return;
    try {
      const projPath = a.proje ? projectMapRef.current.get(a.proje) : undefined;
      const toProject = !!(a.proje && projPath && filesRef.current[projPath] !== undefined);
      const path = toProject ? projPath! : TASK_PATH;
      let content = filesRef.current[path];
      for (const b of a.basliklar) content = appendTask(content, b, a.tarih, undefined, undefined, toProject ? projectSlug(a.proje!) : undefined);
      await saveT(c.id, path, content);
      patchCard(msgId, c.id, { state: 'yapildi', not: `${a.basliklar.length} görev eklendi (${toProject ? `${a.proje} projesi` : 'Gelen Kutusu / inbox.md'}).` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  // Durum taşıma: görev satırı vault'tan bulunur, App'in kendi durum değiştiricisi çağrılır, sonra satırın gerçekten değiştiği doğrulanır.
  const doMove = async (msgId: string, c: CardT) => {
    const a = c.a; const t = c.cands?.[c.pick ?? 0]; if (!t || !a.hedef) return;
    try {
      statusUndoRef.current.set(c.id, { id: `task::${t.path}::${t.lineIdx}`, old: t.durum });
      await changeTaskStatus(`task::${t.path}::${t.lineIdx}`, a.hedef);
      let ok = false;
      for (let i = 0; i < 6 && !ok; i++) {
        await wait(250);
        const line = (filesRef.current[t.path] || '').split('\n')[t.lineIdx];
        ok = !!line && lineStatus(line) === a.hedef;
      }
      const hedefAd = columnsFor(t.proje).find(x => x.key === a.hedef)?.title || a.hedef;
      if (ok) patchCard(msgId, c.id, { state: 'yapildi', not: `"${t.title}" → ${hedefAd} olarak taşındı.` });
      else { statusUndoRef.current.delete(c.id); patchCard(msgId, c.id, { state: 'hata', not: 'Görevin durumu değişmedi (görev bulunamadı ya da liste henüz yenilenmedi). Proje Yönetimi\'ni açıp kontrol edin, gerekirse tekrar deneyin.' }); }
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Taşınamadı: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  // Bu ayın bütçe özeti: model "kalan bütçem ne?" sorusunu uydurmadan bu satırdan cevaplar.
  const butceOzet = (): string => {
    const ay = monthOf(new Date());
    const b = parseBudgetNote(filesRef.current[monthPath(ay)], ay);
    if (!b) return '';
    const t = totals(b);
    return `${monthLabel(ay)}: gelir ${fmtTL(t.gelir)}, sabit gider ${fmtTL(t.sabit)}, kart ${fmtTL(t.kart)}, değişken ${fmtTL(t.degisken)}, beklenmeyenler payı ${fmtTL(t.reserve)}, toplam gider ${fmtTL(t.gider)}, kalan ${fmtTL(t.kalan)}`;
  };

  const doShop = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.basliklar?.length) return;
    try {
      let content = filesRef.current[LIST_PATH];
      for (const b of a.basliklar) content = listAdd(content, a.kategori || guessCat(b) || '', b);
      await saveT(c.id, LIST_PATH, content);
      patchCard(msgId, c.id, { state: 'yapildi', not: `${a.basliklar.length} ürün alışveriş listesine eklendi.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  // "X aldım": listede var olan açık madde işaretlenir; yeni madde eklenmez. Madde satırı hâlâ aynıysa (listToggle satır+metinle bulur) işaretlenir.
  const doBought = async (msgId: string, c: CardT) => {
    const groups = (c.buy || []).filter(g => g.pick >= 0 && g.cands[g.pick]); if (!groups.length) return;
    try {
      let content = filesRef.current[LIST_PATH] ?? '';
      let n = 0;
      for (const g of groups) { const it = g.cands[g.pick]; const next = listToggle(content, it.line, it.text); if (next !== content) { content = next; n++; } }
      if (!n) { patchCard(msgId, c.id, { state: 'hata', not: 'Liste bu arada değişmiş; madde bulunamadı. Tekrar deneyin.' }); return; }
      await saveT(c.id, LIST_PATH, content);
      patchCard(msgId, c.id, { state: 'yapildi', not: `${n} madde alındı olarak işaretlendi.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  // Ortam sesi: ses çalmak tarayıcıda kullanıcı dokunuşu ister; bu yüzden kart düğmesine basınca uygulanır.
  // Yeni not: var olan notun üzerine ASLA yazılmaz; ad doluysa " (2)" gibi sayı eklenir. Açılışı App yapar (sekme + not ekranı).
  const notePathFor = (a: AAction): string => {
    const dir = (a.klasor || '').split('/').map(sanitizeName).filter(Boolean).join('/');
    const base = `${dir ? dir + '/' : ''}${sanitizeName(a.baslik || 'Yeni not') || 'Yeni not'}`;
    let p = `${base}.md`, n = 2;
    while (filesRef.current[p] !== undefined && n < 100) p = `${base} (${n++}).md`;
    return p;
  };
  const doNote = async (msgId: string, c: CardT) => {
    const a = c.a;
    try {
      const path = notePathFor(a);
      await writeNote(path, a.icerik || '');
      // Not listesi diske göre yeniden okunmadan açılırsa yeni not boş görünür; bu yüzden açmadan önce App listeyi yeniler (Günlük notu da böyle yapıyor).
      if (!voiceRef.current) { await openNote(path); closeOnMobile(); }
      patchCard(msgId, c.id, { state: 'yapildi', not: `Not oluşturuldu: ${path.replace(/\.md$/i, '')}` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Not oluşturulamadı: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  const doAmbient = (msgId: string, c: CardT) => {
    const a = c.a;
    try {
      const vols: Record<string, number> = {};
      for (const s of a.sesler || []) vols[s.id] = s.v / 100;
      if (a.ortamIslem === 'hazir') { const p = AMBIENT_PRESETS.find(x => x.name === a.hazir); if (p) ambientAudioService.applyPreset(p.volumes); }
      else if (a.ortamIslem === 'degistir') ambientAudioService.applyPreset(vols);
      else if (a.ortamIslem === 'ayarla') ambientAudioService.adjust(vols);
      else if (a.ortamIslem === 'durdur') ambientAudioService.stopAll();
      else if (a.ortamIslem === 'sustur') ambientAudioService.setMuted(true);
      else if (a.ortamIslem === 'sesac') ambientAudioService.setMuted(false);
      patchCard(msgId, c.id, { state: 'yapildi', not: a.ortamIslem === 'durdur' ? 'Ortam sesleri kapatıldı.' : 'Ortam sesleri güncellendi.' });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Ses başlatılamadı: ${String(e?.message || e)}. Ortam Sesleri ekranından deneyin.` }); }
  };
  const doFinans = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.tutar || !a.kategori || !a.tarih) return;
    try {
      await addFinanceEntry({ entryDate: a.tarih, category: a.kategori, type: a.finTur === 'gelir' ? 'gelir' : 'gider', amount: a.tutar, note: a.baslik || null });
      patchCard(msgId, c.id, { state: 'yapildi', not: 'Finans kaydı eklendi. Finans ekranında görünür.' });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  const doButce = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.tutar || !a.baslik || !a.butceTur) return;
    try {
      const ay = monthOf(new Date());
      const b = parseBudgetNote(filesRef.current[monthPath(ay)], ay) || emptyBudget(ay);
      const it: BudgetItem = { id: 'yeni', kind: a.butceTur as BudgetItem['kind'], name: a.baslik, amount: a.tutar, ...(a.gun ? { day: a.gun } : {}) };
      await saveT(c.id, monthPath(ay), serializeBudget({ ...b, items: reindex([...b.items, it]) }));
      patchCard(msgId, c.id, { state: 'yapildi', not: `Kalem ${monthLabel(ay)} bütçesine eklendi.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  const doDiary = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.metin || !a.tarih) return;
    try {
      await saveT(c.id, diaryPath(a.tarih), appendDiary(filesRef.current[diaryPath(a.tarih)], a.tarih, a.metin));
      patchCard(msgId, c.id, { state: 'yapildi', not: `Günlüğe eklendi (${ymdLabel(a.tarih)}).` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  // Görevi başka güne alma: satır hâlâ aynı görevse yalnızca [due:] değişir; dosya bu arada değiştiyse yazmadan hata verir.
  const doMoveDay = async (msgId: string, c: CardT) => {
    const a = c.a; const t = c.cands?.[c.pick ?? 0]; if (!t || !a.tarih) return;
    try {
      const lines = (filesRef.current[t.path] ?? '').split('\n');
      const cur = lines[t.lineIdx];
      if (cur === undefined || foldTr(cur.replace(/\[[^\]]*\]/g, ' ')) .indexOf(foldTr(t.title)) < 0) { patchCard(msgId, c.id, { state: 'hata', not: 'Görev satırı bu arada değişmiş. Asistana isteği yeniden yazın.' }); return; }
      lines[t.lineIdx] = setDueOnLine(cur, a.tarih);
      await saveT(c.id, t.path, lines.join('\n'));
      patchCard(msgId, c.id, { state: 'yapildi', not: `"${t.title}" → ${ymdLabel(a.tarih)} gününe alındı.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Taşınamadı: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  // Ezber kartı: üretim öneridir; Ekle'ye basılınca açık notun sonuna [card: s || c] satırları eklenir (FlashcardView bunları tüm notlardan tarar).
  const prepareCards = async (msgId: string, c: CardT, path: string) => {
    try {
      const pairs = await proposeCards(filesRef.current[path] ?? '', c.a.talimat || '');
      if (!pairs.length) { patchCard(msgId, c.id, { state: 'hata', not: 'Bu nottan kart çıkaramadım. Notta daha çok bilgi olunca tekrar deneyin.' }); return; }
      patchCard(msgId, c.id, { state: 'bekliyor', pairs });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: String(e?.message || e) }); }
  };
  const doCards = async (msgId: string, c: CardT, path: string) => {
    const pairs = c.pairs ?? c.a.kartlar ?? []; if (!pairs.length) return;
    try {
      const before = filesRef.current[path];
      const next = appendCards(before, pairs, todayYmd());
      if (next === (before ?? '')) { patchCard(msgId, c.id, { state: 'yapildi', not: 'Bu kartlar zaten ekliymiş; yeni kart eklenmedi.' }); return; }
      await saveT(c.id, path, next);
      patchCard(msgId, c.id, { state: 'yapildi', not: `${pairs.length} kart eklendi. Ezber Kartları ekranında görünür.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };
  // Gelen Kutusu: görev silinmez/taşınmaz; satıra yalnızca [project:slug] etiketi eklenir, böylece Proje Yönetimi'nde görünür.
  const prepareInbox = async (msgId: string, c: CardT) => {
    try {
      const tasks = inboxOpenTasks(filesRef.current);
      if (!tasks.length) { patchCard(msgId, c.id, { state: 'yapildi', not: 'Gelen Kutusu\'nda projesiz açık görev yok.' }); return; }
      const moves = await proposeInbox(tasks, [...projectMapRef.current.keys()]);
      if (!moves.length) { patchCard(msgId, c.id, { state: 'yapildi', not: 'Açıkça bir projeye uyan görev bulamadım; hiçbir şey değişmedi.' }); return; }
      patchCard(msgId, c.id, { state: 'bekliyor', moves });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: String(e?.message || e) }); }
  };
  const doInbox = async (msgId: string, c: CardT) => {
    const sel = (c.moves || []).filter(m => m.on); if (!sel.length) return;
    try {
      let ok = 0, skip = 0;
      const byPath = new Map<string, InboxMove[]>();
      for (const m of sel) byPath.set(m.path, [...(byPath.get(m.path) || []), m]);
      for (const [path, ms] of byPath) {
        const lines = (filesRef.current[path] ?? '').split('\n');
        for (const m of ms) {
          const cur = lines[m.lineIdx];
          if (cur === undefined || !foldTr(cur).includes(foldTr(m.title).slice(0, 40)) || /\[project:/i.test(cur) || !/\[ \]/.test(cur)) { skip++; continue; }
          lines[m.lineIdx] = tagLineProject(cur, m.proje); ok++;
        }
        await saveT(c.id, path, lines.join('\n'));
      }
      patchCard(msgId, c.id, { state: 'yapildi', not: `${ok} görev projeye bağlandı.${skip ? ` ${skip} görev bu arada değiştiği için atlandı.` : ''}` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  const doWords = async (msgId: string, c: CardT) => {
    const pairs = c.a.kartlar ?? []; if (!pairs.length) return;
    try {
      const raw = filesRef.current[LANGUAGE_LAB_NOTE_PATH];
      const st = parseLabState(raw);
      if (!raw || !st.language) { patchCard(msgId, c.id, { state: 'hata', not: 'Önce Dil Atölyesi\'ni açıp bir hedef dil seçin; sonra tekrar deneyin.' }); return; }
      const have = new Set(st.words.map(w => foldTr(w.word)));
      const add = pairs.filter(p => !have.has(foldTr(p.s)));
      if (!add.length) { patchCard(msgId, c.id, { state: 'yapildi', not: 'Bu kelimeler zaten kayıtlıymış.' }); return; }
      st.words = [...st.words, ...add.map(p => ({ word: p.s, meaning: p.c, context: '', seen: 1, added: todayKey() }))];
      await saveT(c.id, LANGUAGE_LAB_NOTE_PATH, serializeLabState(st));
      patchCard(msgId, c.id, { state: 'yapildi', not: `${add.length} kelime ${st.language} listesine eklendi.` });
    } catch (e: any) { patchCard(msgId, c.id, { state: 'hata', not: `Kaydedilemedi: ${String(e?.message || e)}. Tekrar deneyin.` }); }
  };

  const doRule = async (msgId: string, c: CardT) => {
    const a = c.a; if (!a.sched || !a.eylem || !a.ad) return;
    const next = addRule(parseRules(filesRef.current[RULES_PATH]), { ad: a.ad, sched: a.sched, eylem: a.eylem, acik: true });
    await writeNote(RULES_PATH, serializeRules(next));
    await requestNotifyPermission();
    if (nativeScheduling()) void syncNativeRules(next);
    patchCard(msgId, c.id, { state: 'yapildi', not: 'Kural kuruldu. Otomasyonlar sekmesinden kapatabilir ya da silebilirsiniz.' });
  };

  const saveRules = async (next: Rule[]) => { await writeNote(RULES_PATH, serializeRules(next)); if (nativeScheduling()) void syncNativeRules(next); };

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
      if (voiceRef.current) setVState('acting');
      const { els, map } = snapshotPage(document);
      let step: Step;
      try { step = await planStep({ talimat, els, map, gecmis, ekranAd: screenById(tabRef.current)?.ad || tabRef.current, adim }); }
      catch (e: any) { finish('hata', String(e?.message || e)); return; }
      if (stopRef.current) { finish('durdu', 'Durduruldu.'); return; }
      setRun(r => (r ? { ...r, adim, log: [...r.log, step.aciklama] } : r));
      if (step.tur === 'bitti') { finish('bitti', step.aciklama); return; }
      if (step.tur === 'sor') {
        setMsgs(ms => [...ms, { id: newId(), role: 'ai', text: step.aciklama }]);
        // Sesli modda eksik bilgi sesli sorulur, cevap dinlenir ve ajan kaldığı yerden devam eder ("toplantı kiminle?" gibi)
        if (voiceRef.current) {
          const ans = await voiceAsk(step.aciklama);
          if (ans && voiceRef.current && !stopRef.current) { gecmis.push(`Kullanıcıya soruldu: "${step.aciklama}" → cevabı: "${ans}"`); setVState('acting'); continue; }
        }
        finish('durdu', step.aciklama); return;
      }
      if (step.tur === 'basarisiz') { finish('hata', step.aciklama); return; }
      if (step.tur === 'git') { onNavigate(step.ekran!); gecmis.push(`${step.aciklama} → ekran açıldı`); await wait(900); continue; }
      const el = map.get(step.ref!); const pe = els.find(e => e.ref === step.ref);
      if (!el) { finish('hata', 'Öğe bulunamadı.'); return; }
      if (pe?.risk === 'yasak') { finish('durdu', `"${pe.ad}" düğmesine dokunmam yasak (birleştirme/yayın gibi işlemler yalnızca sizin elinizde).`); return; }
      highlight(el, 1500);
      const needConfirm = pe?.risk === 'onay' || (stepModeRef.current && !voiceRef.current);
      if (voiceRef.current && pe?.risk === 'onay') {
        if (!(await voiceConfirm(`“${pe.ad}” işlemini yapayım mı? Geri alınamayabilir.`))) { finish('durdu', 'Onay verilmedi, yapmadım.'); return; }
        setVState('acting'); await wait(300);
      } else if (needConfirm) {
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
  // Otomatik uygulanabilir mi: yalnızca belirsizlik/uyarı içermeyen net eylemler.
  const autoOk = (c: CardT): boolean => {
    const a = c.a;
    switch (a.tur) {
      case 'hatirlat': case 'otomasyon': case 'alisveris': case 'butce': case 'gunluk': case 'kelime_ekle': case 'ortam': case 'git': return true;
      case 'kart_ekle': return !!a.kartlar?.length;
      case 'not_olustur': return filesRef.current[`${(a.klasor || '').split('/').map(sanitizeName).filter(Boolean).join('/')}${a.klasor ? '/' : ''}${sanitizeName(a.baslik || '')}.md`] === undefined;
      case 'gorev': case 'gorevler': return !a.projeIstek;
      case 'ui': return voiceRef.current && !!a.talimat; // sayfayı sizin yerinize kullanma: yalnızca sesli konuşmada (metinde 'Başla' kartı kalır)
      case 'proje_ac': return !!a.musteri;
      case 'gorev_tasi': case 'gorev_gun': return (c.cands?.length ?? 0) === 1;
      case 'alisveris_al': return !!c.buy?.length && c.buy.every(g => g.cands.length <= 1) && c.buy.some(g => g.cands.length === 1);
      case 'finans': return financeCategoryNames.includes(a.kategori || '');
      default: return false;
    }
  };
  const runCard = async (msgId: string, c: CardT) => {
    const a = c.a;
    switch (a.tur) {
      case 'hatirlat': return doRemind(msgId, c);
      case 'otomasyon': return doRule(msgId, c);
      case 'gorev': return doTask(msgId, c);
      case 'gorevler': return doTasks(msgId, c);
      case 'proje_ac': return doProjeAc(msgId, c);
      case 'gorev_tasi': return doMove(msgId, c);
      case 'gorev_gun': return doMoveDay(msgId, c);
      case 'alisveris': return doShop(msgId, c);
      case 'alisveris_al': return doBought(msgId, c);
      case 'finans': return doFinans(msgId, c);
      case 'butce': return doButce(msgId, c);
      case 'gunluk': return doDiary(msgId, c);
      case 'kelime_ekle': return doWords(msgId, c);
      case 'kart_ekle': return doCards(msgId, c, (noteOpen ? activeNotePath : null) || 'Ezber Kartları.md');
      case 'ortam': return doAmbient(msgId, c);
      case 'ui': return runAgent(msgId, c);
      case 'not_olustur': return doNote(msgId, c);
      case 'git': onNavigate(a.ekran!); patchCard(msgId, c.id, { state: 'yapildi' }); return;
      default: return;
    }
  };

  const send = async (text?: string): Promise<SendInfo | undefined> => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    // "Günümü anlat": yapay zekâ gerekmez, notlardan hesaplanır; hemen açılır
    if (/(g[üu]n[üu]m[üu]|bug[üu]n[üu])\s+anlat|g[üu]nl[üu]k brifing|sabah brifing/i.test(message)) {
      setInput(''); setErr('');
      if (voiceRef.current) { const say = buildBriefing(filesRef.current, new Date()).map(x => x.oku).join(' '); return { say: say || 'Bugün için kayıtlı bir şey bulamadım.', bekleyen: 0, hatalar: [] }; }
      setMsgs(ms => [...ms, { id: newId(), role: 'user', text: message }, { id: newId(), role: 'ai', text: 'Günlük brifingi açıyorum. Sahneler notlarınızdan hesaplanır, yapay zekâ rakam uydurmaz.' }]);
      // El masası telefonda ekranı kapladığı ve elemanlar üst üste bindiği için yalnızca geniş ekranda açılır; telefonda brifing düz yazı olarak sohbete gelir.
      if (!wide) { const say = buildBriefing(filesRef.current, new Date()).map(x => x.oku).join(' '); setMsgs(ms => ms.map((m, i) => (i === ms.length - 1 ? { ...m, text: say || 'Bugün için kayıtlı bir şey bulamadım.' } : m))); return; }
      setHoloBrief(true); setHolo(true);
      return;
    }
    if (!isGeminiConfigured()) { setErr('Yapay zekâ ayarlı değil: Ayarlar > AI Mentor\'dan Gemini anahtarı ekleyin ya da masaüstünde Claude Code\'u açın.'); return; }
    setInput(''); setErr(''); setBusy(true);
    const um: Msg = { id: newId(), role: 'user', text: message };
    setMsgs(ms => [...ms, um]);
    try {
      const history: ChatTurn[] = msgs.slice(-6).map(m => ({ role: m.role, text: m.text }));
      const res = await askRouter({ ctx: { tab, noteOpen, notePath: activeNotePath || undefined, now: new Date(), projeler: [...projectMapRef.current.keys()], musteriler: [...clientMapRef.current.keys()], durumlar: columnsFor(), finKategoriler: financeCategoryNames, butceOzet: butceOzet(), ortamDurum: (() => { const st = ambientAudioService.getState(); const on = AMBIENT_SOUNDS.filter(s => st.playingMap[s.id] && st.isGlobalPlaying && !st.isMuted).map(s => `${s.name} %${Math.round((st.volumeMap[s.id] ?? 0) * 100)}`); return on.join(', '); })(), verimOzet: productivitySummary(filesRef.current, new Date()), gunOzet: (() => { const n = new Date(); const t = todayYmd(); return daySummary(filesRef.current, n, parseReminders(filesRef.current).filter(r => r.tarih === t).map(r => ({ saat: r.saat, baslik: r.baslik }))); })() }, history, message: voiceRef.current ? `${message}

[Sesli konuşma: cevabın sesli okunacak, en çok 2 kısa cümle yaz. Bir iş için gerekli bilgi eksikse (saat, kiminle, ne hakkında) tahmin etme; tek kısa soru sor, cevabı bir sonraki mesajda gelecek.]` : message });
      // Notlarımla Sohbet: not sorusu salt okunur olduğundan onay kartı olmadan, notlar aranıp cevap doğrudan yazılır.
      const ask = res.eylemler.find(a => a.tur === 'not_sor');
      let answerText = '';
      if (ask?.soru) {
        try {
          const noteList = Object.keys(filesRef.current).filter(p => /\.md$/i.test(p) && !p.startsWith('Sistem/')).map(p => ({ type: 'note', path: p, name: (p.split('/').pop() || p).replace(/\.md$/i, '') }));
          const relevant = findRelevantNotes(ask.soru, noteList, filesRef.current, 6);
          const r = await askNotesChat(ask.soru, relevant, history.map(h => ({ role: h.role === 'user' ? 'user' as const : 'assistant' as const, text: h.text })));
          const used = relevant.filter(x => r.usedNoteNames.some(n => n.toLowerCase() === x.name.toLowerCase())).map(x => x.name);
          answerText = `${r.answer}${used.length ? `\n\nKaynak notlar: ${used.join(', ')}` : ''}`;
        } catch (e: any) { answerText = `Notlara bakarken hata oluştu: ${String(e?.message || e)}. Tekrar deneyin.`; }
      }
      // Web araması: cevap uydurulmasın diye gerçek arama (grounding) kullanılır; kaynaklar ve uyarı cevaba eklenir.
      const web = res.eylemler.find(a => a.tur === 'web_ara');
      let webSave: AAction | null = null;
      if (web?.soru && !answerText) {
        try {
          const kaynaklar: { title: string; uri: string }[] = [];
          const txt = await callGeminiGroundedText(`Bugünün tarihi: ${new Date().toLocaleDateString('tr-TR')}. Aşağıdaki isteği internette arayarak Türkçe, kısa ve net yanıtla. KURALLAR: Fiyat, link ve özellikleri YALNIZCA arama sonuçlarında gördüğün sayfalardan yaz; görmediğin fiyatı ya da linki UYDURMA, "bulunamadı" yaz. Her fiyatın yanına mağaza/site adını yaz. Link vereceksen tam ve gerçek adres ver. Karşılaştırma isteniyorsa markdown tablo kullan.\n\nİSTEK: ${web.soru}`, kaynaklar);
          if (!txt.trim()) throw new Error('Arama sonuç döndürmedi');
          const src = kaynaklar.slice(0, 6).map(k => `- ${k.title}: ${k.uri}`).join('\n');
          answerText = `${txt.trim()}${src ? `\n\nKaynaklar:\n${src}` : ''}\n\nNot: Fiyatlar ve stok anlık değişir; satın almadan önce mağaza sayfasından doğrulayın.`;
          if (web.baslik) webSave = { tur: 'not_olustur', baslik: web.baslik, icerik: answerText };
        } catch (e: any) {
          // Ham API hatası (JSON) kullanıcıya eylem göstermez; kota hatasında ne yapacağı açıkça söylenir.
          const msg = String(e?.message || e);
          answerText = e?.status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(msg)
            ? 'Gemini\'nin internet arama kotası doldu. Birkaç saat sonra tekrar deneyin ya da Ayarlar > AI Mentor bölümünden modeli değiştirin. Diğer Asistan işlemleri çalışmaya devam eder.'
            : `İnternette ararken hata oluştu: ${msg.slice(0, 200)}. Tekrar deneyin.`;
        }
      }
      const cards: CardT[] = [...res.eylemler.filter(a => a.tur !== 'not_sor' && a.tur !== 'web_ara'), ...(webSave ? [webSave] : [])].map(a => {
        const base: CardT = { id: newId(), a, state: a.tur === 'notu_tasarla' || a.tur === 'kart_uret' || a.tur === 'inbox_ayir' ? 'hazirlaniyor' : 'bekliyor' };
        if (a.tur === 'alisveris_al') {
          base.buy = (a.basliklar || []).map(istek => { const cands = findShopCandidates(filesRef.current[LIST_PATH], istek, a.kategori); return { istek, cands, pick: cands.length ? 0 : -1 }; });
        }
        if (a.tur === 'gorev_tasi' || a.tur === 'gorev_gun') {
          base.cands = findTaskCandidates(filesRef.current, projectMapRef.current, { baslik: a.baslik || '', proje: a.proje, mevcut: a.tur === 'gorev_tasi' ? a.mevcut : undefined, hepsi: a.tur === 'gorev_gun' });
          base.pick = 0;
        }
        return base;
      });
      const am: Msg = { id: newId(), role: 'ai', text: answerText || res.cevap, cards: cards.length ? cards : undefined };
      setMsgs(ms => [...ms, am]);
      for (const c of cards) cardMeta.current.set(c.id, c.a);
      // Otomatik mod: net eylemler sırayla (aynı dosyaya yazanlar birbirini ezmesin diye) onay beklemeden uygulanır.
      const todo = (autoRef.current || voiceRef.current) ? cards.filter(autoOk) : [];
      if (todo.length) {
        const job = (async () => { for (const c of todo) { patchCard0(am.id, c.id, { state: 'hazirlaniyor' }); try { await runCard(am.id, c); } catch (e: any) { patchCard0(am.id, c.id, { state: 'hata', not: String(e?.message || e) }); } } })();
        // Sesli modda sonuç söylenecek: işler bitmeden cevap okunmasın.
        if (voiceRef.current) await job; else void job;
      }
      for (const c of cards) {
        if (c.a.tur === 'notu_tasarla' && activeNotePath) void prepareDesign(am.id, c, activeNotePath);
        if (c.a.tur === 'kart_uret' && activeNotePath) void prepareCards(am.id, c, activeNotePath);
        if (c.a.tur === 'inbox_ayir') void prepareInbox(am.id, c);
      }
      const hatalar = todo.map(c => cardRes.current.get(c.id)).filter(r => r?.state === 'hata').map(r => r?.not || 'hata');
      // Sayfa ajanı bir şey yaptıysa sonucu da söylenir ("Toplantıyı ekledim" gibi)
      const ajanSonuc = voiceRef.current ? todo.filter(c => c.a.tur === 'ui').map(c => cardRes.current.get(c.id)).filter(r => r?.state === 'yapildi' && r.not).map(r => r!.not).join(' ') : '';
      return { say: [answerText || res.cevap, ajanSonuc].filter(Boolean).join(' '), bekleyen: cards.filter(c => !todo.includes(c)).length, hatalar };
    } catch (e: any) { setErr(String(e?.message || e)); return { say: `Bir sorun oldu: ${String(e?.message || e).slice(0, 140)}`, bekleyen: 0, hatalar: [] }; }
    finally { setBusy(false); }
  };
  const sendRef = useRef(send); sendRef.current = send;

  // ---------------- sesli mod ----------------
  // Dinle -> gönder (işler otomatik modda yapılır) -> sonucu oku -> yine dinle. SpeechRecognition varsa (telefon) o dinler; yoksa (masaüstü)
  // kayıt alınıp sessizlikte kesilir ve Gemini ile yazıya çevrilir.
  const [voice, setVoice] = useState(false);
  const [vState, setVState] = useState<CoreState>('idle');
  const [vUser, setVUser] = useState('');
  const [vReply, setVReply] = useState('');
  const [vNote, setVNote] = useState('');
  const vStop = useRef<(() => void) | null>(null);
  const vSpeak = useRef<Speaking | null>(null);
  const vLevel = useRef<() => number>(() => 0);
  const vFatal = useRef('');
  const [wake, setWake] = useState<boolean>(() => { try { return localStorage.getItem('assistant_wake_v1') === '1'; } catch { return false; } });
  const [gv, setGv] = useState<boolean>(() => useGeminiVoice());
  const setGvP = (v: boolean) => { setGv(v); setGeminiVoice(v); };
  const setWakeP = (v: boolean) => { setWake(v); try { localStorage.setItem('assistant_wake_v1', v ? '1' : '0'); } catch { /* yoksay */ } };

  const listenOnce = (): Promise<string> => new Promise((resolve) => {
    if (SpeechCls) {
      let got = '';
      try {
        const r = new SpeechCls();
        r.lang = 'tr-TR'; r.interimResults = true; r.continuous = false;
        r.onresult = (ev: any) => { let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript; got = t.trim(); setVUser(got); };
        r.onerror = (ev: any) => { if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') vFatal.current = 'Mikrofon izni verilmedi. Uygulama ayarlarından mikrofona izin verin.'; };
        r.onend = () => resolve(got);
        vStop.current = () => { try { r.abort(); } catch { /* yoksay */ } };
        r.start();
      } catch { vFatal.current = 'Mikrofon başlatılamadı.'; resolve(''); }
      return;
    }
    void (async () => {
      let rec: Recording | null = null;
      try {
        rec = await startRecording();
        const r0 = rec; vLevel.current = () => r0.level();
        let cancelled = false; vStop.current = () => { cancelled = true; r0.cancel(); };
        const t0 = Date.now(); let spoke = false, lastVoice = Date.now();
        // Konuşma başlayınca ~1,3 sn sessizlikte kayıt kesilir; hiç konuşulmazsa 8 sn sonra boş döner.
        await new Promise<void>((done) => {
          const iv = setInterval(() => {
            const l = r0.level();
            if (l > 0.1) { spoke = true; lastVoice = Date.now(); }
            if (cancelled || (spoke && Date.now() - lastVoice > 1300) || (!spoke && Date.now() - t0 > 8000) || Date.now() - t0 > 30000) { clearInterval(iv); done(); }
          }, 100);
        });
        if (cancelled) { resolve(''); return; }
        if (!spoke) { r0.cancel(); resolve(''); return; }
        setVState('thinking');
        const t = await transcribe(await r0.stop());
        setVUser(t); resolve(t);
      } catch (e: any) { if (!rec) vFatal.current = 'Mikrofon izni verilmedi. Windows ayarlarından izin verin.'; resolve(''); }
      finally { vLevel.current = () => 0; }
    })();
  });
  // Okunacak metin: tablo/link/kaynak listesi sesli okunmaz (ekranda kalır), uzun cevap ilk cümlelerle kısaltılır.
  const spokenText = (info: SendInfo): string => {
    let t = info.say.replace(/Kaynaklar:[\s\S]*$/i, '').replace(/Not: Fiyatlar[\s\S]*$/, '').replace(/https?:\/\/\S+/g, '').replace(/^[-*]\s+/gm, '').replace(/[*_`#>|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > 420) { const cut = t.slice(0, 420); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! ')); t = (i > 150 ? cut.slice(0, i + 1) : cut) + ' Ayrıntıyı ekrana yazdım.'; }
    if (info.hatalar.length) t += ` Bir işlem yapılamadı: ${info.hatalar[0].slice(0, 120)}`;
    if (info.bekleyen > 0) t += ' Bu işlem için onay gerekiyor, asistan ekranına bıraktım.';
    return t || 'Tamam.';
  };
  const sayIt = async (text: string) => { const sp = speak(text); vSpeak.current = sp; setVState('speaking'); await sp.done; vSpeak.current = null; };
  // Sesli soru: soruyu okur, cevabı dinler (boş dönerse cevap yok demektir)
  const voiceAsk = async (q: string): Promise<string> => {
    setVReply(q); await sayIt(q);
    if (!voiceRef.current) return '';
    setVState('listening'); setVUser('');
    const a = await listenOnce();
    return voiceRef.current ? a : '';
  };
  const voiceConfirm = async (q: string): Promise<boolean> => /^(evet|tamam|olur|yap|yapabilirsin|onayl[ai]yorum|devam)([ .!,]|$)/.test(foldTr(await voiceAsk(q)).trim());
  const stopVoice = () => { voiceRef.current = false; vStop.current?.(); vSpeak.current?.stop(); };
  const startVoice = async () => {
    if (voiceRef.current) return;
    if (!isGeminiConfigured()) { setErr('Yapay zekâ ayarlı değil: Ayarlar > AI Mentor\'dan Gemini anahtarı ekleyin.'); return; }
    if (!SpeechCls && !canTranscribe()) { setErr('Sesli mod için mikrofon ve Ayarlar > AI Mentor\'da Gemini anahtarı gerekir.'); return; }
    voiceRef.current = true; vFatal.current = '';
    setOpen(false); setVoice(true); setVUser(''); setVReply(''); setVNote(''); setErr('');
    let idle = 0;
    try {
      while (voiceRef.current) {
        setVState('listening'); setVUser('');
        const heard = await listenOnce();
        if (!voiceRef.current) break;
        if (vFatal.current) { setVNote(vFatal.current); break; }
        if (!heard) { if (++idle >= 4) { setVNote('Ses duyulmadı, sesli mod kapandı.'); break; } continue; }
        idle = 0;
        if (/^(tamam|kapat|dur|yeter|bu kadar|gorusuruz)( ultran)?[.!]?$/.test(foldTr(heard).trim())) { await sayIt('Görüşürüz.'); break; }
        setVState('thinking');
        const info = await sendRef.current(heard);
        if (!voiceRef.current) break;
        if (!info) continue;
        setVReply(info.say.replace(/\n{3,}/g, '\n\n'));
        await sayIt(spokenText(info));
      }
    } finally { voiceRef.current = false; vStop.current?.(); vSpeak.current?.stop(); setVoice(false); setVState('idle'); }
  };
  const startVoiceRef = useRef(startVoice); startVoiceRef.current = startVoice;

  // "Ultran" uyandırma: yalnızca uygulama açık ve ön plandayken, SpeechRecognition olan cihazda (telefon) çalışır. Ekran kapalıyken/arka planda çalışmaz.
  useEffect(() => {
    if (!wake || !SpeechCls || voice || !ready) return;
    let stop = false; let r: any; let tm: any;
    const begin = () => {
      if (stop) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') { tm = setTimeout(begin, 2500); return; }
      try {
        r = new SpeechCls(); r.lang = 'tr-TR'; r.continuous = true; r.interimResults = true;
        r.onresult = (ev: any) => {
          let t = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
          if (/ult(r|ir)an|ultren|altran/.test(foldTr(t))) { stop = true; try { r.abort(); } catch { /* yoksay */ } void startVoiceRef.current(); }
        };
        r.onerror = (ev: any) => { if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') { stop = true; setWakeP(false); setErr('Mikrofon izni verilmedi, "Ultran" uyandırması kapatıldı.'); } };
        r.onend = () => { if (!stop) tm = setTimeout(begin, 500); };
        r.start();
      } catch { tm = setTimeout(begin, 3000); }
    };
    begin();
    return () => { stop = true; clearTimeout(tm); try { r?.abort(); } catch { /* yoksay */ } };
  }, [wake, voice, ready]);

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
        <div style={lab}>{ymdLabel(a.tarih || '')}{a.saat ? ` · ${a.saat}-${a.bitis}` : ' · saat yok'}{a.proje ? ` · Proje: ${a.proje}` : ''}{a.tekrar ? ` · Tekrar: ${a.tekrar === 'daily' ? 'her gün' : a.tekrar === 'weekly' ? 'her hafta' : 'her ay'}` : ''}</div>
        {a.projeIstek && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.projeIstek}" adıyla tek bir proje eşleşmedi (yok ya da birden fazla benzer var); görev Gelen Kutusu'na (inbox.md) eklenecek.</div>}
        {!done && c.state !== 'hata' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={() => void doTask(m.id, c)}><Check size={13} /> Ekle</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
        {stateNote(c)}
      </div>
    );
    if (a.tur === 'proje_ac') return (
      <div key={c.id} style={card}>{head(<FileText size={14} />, `Proje aç: ${a.ad}`)}
        <div style={lab}>Müşteri: {a.musteri || a.musteriIstek}</div>
        {a.musteriIstek && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.musteriIstek}" adında müşteri yok. Aşağıdan yeni müşteri olarak açabilirsiniz; ya da başka bir müşteri adı söyleyin.</div>}
        {!done && c.state !== 'hata' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}><button type="button" style={btnP} onClick={() => void (a.musteri ? doProjeAc(m.id, c) : doMusteriVeProje(m.id, c))}><Check size={13} /> {a.musteri ? 'Projeyi aç' : 'Müşteriyi de aç'}</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
        {stateNote(c)}
      </div>
    );
    if (a.tur === 'gorevler') return (
      <div key={c.id} style={card}>{head(<Check size={14} />, `${a.basliklar?.length} görev ekle`)}
        <div style={lab}>{a.proje ? `Proje: ${a.proje}` : 'Gelen Kutusu (inbox.md)'}{a.tarih ? ` · ${ymdLabel(a.tarih)}` : ''}</div>
        <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{a.basliklar?.map((b, i) => <li key={i}>{b}</li>)}</ul>
        {a.projeIstek && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.projeIstek}" adıyla tek bir proje eşleşmedi; görevler Gelen Kutusu'na eklenecek.</div>}
        {!done && c.state !== 'hata' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={() => void doTasks(m.id, c)}><Check size={13} /> Ekle</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
        {stateNote(c)}
      </div>
    );
    if (a.tur === 'gorev_tasi') {
      const cs = c.cands || [];
      const hedefAd = columnsFor(cs[c.pick ?? 0]?.proje || a.proje).find(x => x.key === a.hedef)?.title || a.hedef;
      const durAd = (k: string) => columnsFor(cs[0]?.proje || a.proje).find(x => x.key === k)?.title || k;
      return (
        <div key={c.id} style={card}>{head(<Check size={14} />, `Görevi taşı → ${hedefAd}`)}
          {a.projeIstek && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.projeIstek}" adıyla proje eşleşmedi; tüm projelerde arandı.</div>}
          {!cs.length && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.baslik}" ile eşleşen görev bulunamadı. Görev adını daha açık yazıp tekrar deneyin.</div>}
          {cs.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
            {cs.length > 1 && <div style={lab}>Birden fazla eşleşme var, birini seçin:</div>}
            {cs.map((t, i) => (
              <label key={`${t.path}:${t.lineIdx}`} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', cursor: done ? 'default' : 'pointer' }}>
                {cs.length > 1 && <input type="radio" disabled={done} checked={(c.pick ?? 0) === i} onChange={() => patchCard(m.id, c.id, { pick: i })} />}
                <span>{t.title}<span style={lab}> · {t.proje} · {durAd(t.durum)}</span></span>
              </label>
            ))}
          </div>}
          {!done && c.state !== 'hata' && cs.length > 0 && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={() => void doMove(m.id, c)}><Check size={13} /> Taşı</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>}
          {stateNote(c)}
        </div>
      );
    }
    const okBtns = (fn: () => void, label: string) => !done && c.state !== 'hata' && <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}><button type="button" style={btnP} onClick={fn}><Check size={13} /> {label}</button><button type="button" style={btn} onClick={() => patchCard(m.id, c.id, { state: 'iptal', not: 'Vazgeçildi.' })}>Vazgeç</button></div>;
    if (a.tur === 'alisveris') return (
      <div key={c.id} style={card}>{head(<Check size={14} />, `Alışveriş listesine ${a.basliklar?.length} ürün`)}
        <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{a.basliklar?.map((b, i) => <li key={i}>{b}</li>)}</ul>
        {okBtns(() => void doShop(m.id, c), 'Ekle')}{stateNote(c)}
      </div>
    );
    if (a.tur === 'alisveris_al') {
      const bg = c.buy || [];
      const any = bg.some(g => g.cands.length > 0);
      return (
        <div key={c.id} style={card}>{head(<Check size={14} />, 'Alındı olarak işaretle')}
          {bg.map((g, gi) => (
            <div key={gi} style={{ marginTop: '4px' }}>
              {g.cands.length === 0 && <div style={{ fontSize: '11.5px', color: '#f59e0b' }}>"{g.istek}" listede açık madde olarak yok; bir şey eklenmedi.</div>}
              {g.cands.map((it, i) => (
                <label key={`${it.line}`} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  {(g.cands.length > 1) && <input type="radio" disabled={done} checked={g.pick === i} onChange={() => patchCard(m.id, c.id, { buy: bg.map((x, xi) => (xi === gi ? { ...x, pick: i } : x)) })} />}
                  <span>{it.text}<span style={lab}> · {it.kat}</span></span>
                </label>
              ))}
            </div>
          ))}
          {any && okBtns(() => void doBought(m.id, c), 'İşaretle')}{stateNote(c)}
        </div>
      );
    }
    if (a.tur === 'not_olustur') return (
      <div key={c.id} style={card}>{head(<FileText size={14} />, `Yeni not: ${a.baslik}`)}
        {a.klasor && <div style={lab}>Klasör: {a.klasor}</div>}
        {a.icerik ? <div style={{ ...lab, marginTop: '4px', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto' }}>{a.icerik.slice(0, 400)}{a.icerik.length > 400 ? '…' : ''}</div> : <div style={lab}>Boş not açılır.</div>}
        {okBtns(() => doNote(m.id, c), 'Oluştur ve aç')}{stateNote(c)}
      </div>
    );
    if (a.tur === 'ortam') {
      const nm = (id: string) => AMBIENT_SOUNDS.find(s => s.id === id)?.name || id;
      const isl = a.ortamIslem;
      const baslik = isl === 'hazir' ? `Karışım: ${a.hazir}` : isl === 'durdur' ? 'Tüm ortam seslerini kapat' : isl === 'sustur' ? 'Sesi sustur' : isl === 'sesac' ? 'Sesi geri aç' : isl === 'degistir' ? (a.ad ? `Karışım: ${a.ad}` : 'Ortam karışımını değiştir') : 'Ortam seslerini ayarla';
      return (
        <div key={c.id} style={card}>{head(<Check size={14} />, baslik)}
          {(a.sesler || []).length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{a.sesler!.map(s => <li key={s.id}>{nm(s.id)} <span style={lab}>{s.v === 0 ? '· kapat' : `· %${s.v}`}</span></li>)}</ul>}
          {isl === 'degistir' && <div style={{ ...lab, marginTop: '4px' }}>Listede olmayan sesler kapatılır.</div>}
          {okBtns(() => doAmbient(m.id, c), 'Uygula')}{stateNote(c)}
        </div>
      );
    }
    if (a.tur === 'finans') return (
      <div key={c.id} style={card}>{head(<Check size={14} />, `${a.finTur === 'gelir' ? 'Gelir' : 'Gider'}: ${fmtTL(a.tutar || 0)}`)}
        <div style={lab}>{a.kategori}{a.baslik ? ` · ${a.baslik}` : ''} · {ymdLabel(a.tarih || '')}</div>
        {!financeCategoryNames.includes(a.kategori || '') && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.kategori}" kategorisi listede yok; bu adla kaydedilecek.</div>}
        {okBtns(() => void doFinans(m.id, c), 'Kaydet')}{stateNote(c)}
      </div>
    );
    if (a.tur === 'butce') return (
      <div key={c.id} style={card}>{head(<Check size={14} />, `Bütçeye ekle: ${a.baslik}`)}
        <div style={lab}>{a.butceTur === 'gelir' ? 'Gelir' : a.butceTur === 'sabit' ? 'Sabit gider' : 'Değişken harcama'} · {fmtTL(a.tutar || 0)}{a.gun ? ` · ayın ${a.gun}. günü` : ''} · bu ayın planı</div>
        {okBtns(() => void doButce(m.id, c), 'Ekle')}{stateNote(c)}
      </div>
    );
    if (a.tur === 'gunluk') return (
      <div key={c.id} style={card}>{head(<FileText size={14} />, `Günlüğe yaz · ${ymdLabel(a.tarih || '')}`)}
        <div style={{ ...lab, whiteSpace: 'pre-wrap' }}>{a.metin}</div>
        {okBtns(() => void doDiary(m.id, c), 'Yaz')}{stateNote(c)}
      </div>
    );
    if (a.tur === 'gorev_gun') {
      const cs = c.cands || [];
      return (
        <div key={c.id} style={card}>{head(<Check size={14} />, `Görevi taşı → ${ymdLabel(a.tarih || '')}`)}
          {a.projeIstek && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.projeIstek}" adıyla proje eşleşmedi; tüm projelerde arandı.</div>}
          {!cs.length && <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '3px' }}>"{a.baslik}" ile eşleşen görev bulunamadı. Görev adını daha açık yazıp tekrar deneyin.</div>}
          {cs.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
            {cs.length > 1 && <div style={lab}>Birden fazla eşleşme var, birini seçin:</div>}
            {cs.map((t, i) => (
              <label key={`${t.path}:${t.lineIdx}`} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                {cs.length > 1 && <input type="radio" disabled={done} checked={(c.pick ?? 0) === i} onChange={() => patchCard(m.id, c.id, { pick: i })} />}
                <span>{t.title}<span style={lab}> · {t.proje}</span></span>
              </label>
            ))}
          </div>}
          {cs.length > 0 && okBtns(() => void doMoveDay(m.id, c), 'Taşı')}{stateNote(c)}
        </div>
      );
    }
    if (a.tur === 'kart_uret' || a.tur === 'kart_ekle') {
      const pairs = c.pairs ?? a.kartlar ?? [];
      const path = (a.tur === 'kart_uret' ? activeNotePath : (noteOpen ? activeNotePath : null)) || 'Ezber Kartları.md';
      return (
        <div key={c.id} style={card}>{head(<FileText size={14} />, a.tur === 'kart_uret' ? 'Nottan ezber kartı üret' : 'Ezber kartı ekle')}
          {c.state === 'hazirlaniyor' && <div style={{ ...lab, marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={12} className="animate-spin" /> Kartlar hazırlanıyor…</div>}
          {pairs.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{pairs.map((p, i) => <li key={i}>{p.s} <span style={lab}>→ {p.c}</span></li>)}</ul>}
          {pairs.length > 0 && <div style={{ ...lab, marginTop: '4px' }}>Eklenecek not: {path.split('/').pop()}</div>}
          {pairs.length > 0 && okBtns(() => void doCards(m.id, c, path), 'Ekle')}{stateNote(c)}
        </div>
      );
    }
    if (a.tur === 'kelime_ekle') return (
      <div key={c.id} style={card}>{head(<FileText size={14} />, 'Dil Atölyesi\'ne kelime ekle')}
        <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{a.kartlar?.map((p, i) => <li key={i}>{p.s} <span style={lab}>→ {p.c}</span></li>)}</ul>
        {okBtns(() => void doWords(m.id, c), 'Ekle')}{stateNote(c)}
      </div>
    );
    if (a.tur === 'inbox_ayir') return (
      <div key={c.id} style={card}>{head(<Check size={14} />, 'Gelen Kutusu\'nu projelere ayır')}
        {c.state === 'hazirlaniyor' && <div style={{ ...lab, marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={12} className="animate-spin" /> Görevler inceleniyor…</div>}
        {(c.moves || []).map((mv, i) => (
          <label key={`${mv.path}:${mv.lineIdx}`} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginTop: '3px' }}>
            <input type="checkbox" disabled={done} checked={mv.on} onChange={() => patchCard(m.id, c.id, { moves: (c.moves || []).map((x, j) => (j === i ? { ...x, on: !x.on } : x)) })} />
            <span>{mv.title}<span style={lab}> → {mv.proje}</span></span>
          </label>
        ))}
        {(c.moves || []).length > 0 && <div style={{ ...lab, marginTop: '4px' }}>Görev silinmez; yalnızca projeye bağlanır.</div>}
        {(c.moves || []).length > 0 && okBtns(() => void doInbox(m.id, c), 'Uygula')}{stateNote(c)}
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

  // Asistanın çekirdek animasyonu ne yaptığını gösterir: dinliyor, düşünüyor ya da sayfada işlem yapıyor
  const coreState: CoreState = listening ? 'listening' : (busy || transcribing) ? 'thinking' : run && run.durum === 'calisiyor' ? 'acting' : 'idle';
  const coreLevel = () => rec2.current?.level() as number;

  const suggestions = noteOpen
    ? ['Başlığı mavi yap, altını 3 parçaya böl: solda görev listesi, ortada madde işaretleri', 'Bu notun en üstüne bir uyarı kutusu ekle', 'Bu ekranda ne yapabilirim?']
    : ['Günümü anlat', 'Bu ekranda ne yapabilirim?', 'Yarın sabah 9\'da annemi aramayı hatırlat', 'Cuma 14:00-15:30 takvime sunum hazırlığı görevi ekle', 'Her pazartesi 09:00\'da alışveriş ekranını aç'];

  const wrapStyle: React.CSSProperties = { fontFamily: FONT, fontSize: '13px', color: 'var(--text-primary)' };
  return (
    <div data-agent-ignore="1" style={wrapStyle}>
      {voice && <VoiceMode state={vState} level={() => (vState === 'speaking' ? (vSpeak.current?.level?.() ?? 0.35) : vLevel.current())} user={vUser} reply={vReply} note={vNote} wake={wake} canWake={!!SpeechCls} onWake={setWakeP} gv={gv} onGv={setGvP} onClose={stopVoice} />}
      {holo && (
        <Suspense fallback={null}>
          <HoloDesk cards={deskCards} scenes={deskScenes} autoBrief={holoBrief} onNavigate={(id) => { if (id === 'notespace') { setHolo(false); setHoloBrief(false); setSpace(true); } else onNavigate(id); }}
            onAsk={(t) => { setHolo(false); setHoloBrief(false); setOpenP(true); setView('sohbet'); void send(t); }}
            onClose={() => { setHolo(false); setHoloBrief(false); }} />
        </Suspense>
      )}
      {space && (
        <Suspense fallback={null}>
          <NoteSpace files={fileContents} onOpenInApp={(p) => { setSpace(false); void openNote(p); }} onClose={() => setSpace(false)} />
        </Suspense>
      )}
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
          style={{ position: 'fixed', right: '12px', bottom: '12px', width: '56px', height: '56px', borderRadius: '50%', border: '1px solid rgba(34,211,238,0.45)', background: 'radial-gradient(circle,#06243a 0%,#030b14 100%)', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', zIndex: 2147482000, boxShadow: '0 0 18px rgba(34,211,238,0.35), 0 6px 20px rgba(0,0,0,0.5)', padding: 0 }}>
          <JarvisCore state={coreState} size={56} level={coreLevel} />
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Asistan" style={{ position: 'fixed', right: 0, bottom: 0, ...(wide ? { height: '66vh', borderTop: border, borderTopLeftRadius: '10px' } : { top: 0 }), width: 'min(430px, 100vw)', background: 'var(--bg-secondary)', borderLeft: border, display: 'flex', flexDirection: 'column', zIndex: 2147482000, boxShadow: '-8px 0 30px rgba(0,0,0,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderBottom: border }}>
            <JarvisCore state={coreState} size={34} level={coreLevel} />
            <div style={{ fontWeight: 500, flex: 1 }}>Asistan <span style={lab}>· {screenById(tab)?.ad || tab}</span></div>
            <button type="button" style={{ ...btn, padding: '4px 8px', fontSize: '11.5px', background: auto ? 'var(--accent-color)' : undefined, color: auto ? '#fff' : undefined }} onClick={toggleAuto} title={auto ? 'Otomatik: net işlemler sormadan yapılır. Kapatmak için dokunun.' : 'Sor: her işlem için onay istenir. Otomatik için dokunun.'}>{auto ? '⚡ Otomatik' : 'Sor'}</button>
            {(SpeechCls || canRecord()) && <button type="button" style={{ ...btn, padding: '4px 8px', fontSize: '11.5px' }} onClick={() => void startVoice()} title="Sesli mod: konuşarak sürekli sohbet" aria-label="Sesli mod"><Mic size={13} /> Sesli</button>}
            {wide && <button type="button" style={{ ...btn, padding: '4px 8px', fontSize: '11.5px' }} onClick={() => { setHoloBrief(false); setHolo(true); }} title="Jarvis masası: elinizi kamerayla izler, çimdikle ekranları açarsınız (Ctrl+Shift+J)" aria-label="Jarvis masasını aç"><Hand size={13} /> El</button>}
            <button type="button" style={{ ...btn, padding: '4px 8px', fontSize: '11.5px' }} onClick={() => setSpace(true)} title="Not uzayı: tüm notlarınız önünüzde yüzer; tıklayıp sağda açın, rafa toplayıp yan yana okuyun (Ctrl+Shift+U)" aria-label="Not uzayını aç"><Orbit size={13} /> Uzay</button>
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
                  {rForm.tur === 'aylik' && <input type="number" min={1} max={31} value={rForm.ayGun} onChange={(e) => setRForm(f => ({ ...f, ayGun: Number(e.target.value) || 1 }))} aria-label="Ayın günü" style={{ ...inp, width: '70px' }} />}
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
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0 12px' }}><JarvisCore state={coreState} size={132} level={coreLevel} /></div>
                    <div style={{ ...lab, lineHeight: 1.6, marginBottom: '10px' }}>
                      Uygulamada ne yapabileceğinizi anlatırım, sizi ilgili ekrana götürürüm, açık notu tasarlarım, hatırlatma ve otomasyon kurarım, sayfadaki düğmelere sizin yerinize basarım. Hiçbir şeyi onayınız olmadan yazmam ya da silmem.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {suggestions.map(s => <button key={s} type="button" style={{ ...btn, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => void send(s)}>{s}</button>)}
                    </div>
                    <div style={{ ...lab, marginTop: '10px' }}>Kısayol: Ctrl+K</div>
                    {SpeechCls && <label style={{ ...lab, marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={wake} onChange={(e) => setWakeP(e.target.checked)} /> “Ultran” deyince sesli modu aç (uygulama açıkken dinler)</label>}
                  </div>
                )}
                {msgs.map(m => (
                  <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'stretch', maxWidth: m.role === 'user' ? '90%' : '100%' }}>
                    <div style={{ background: m.role === 'user' ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: m.role === 'user' ? '#fff' : 'var(--text-primary)', borderRadius: '10px', padding: '8px 11px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>{m.text}</div>
                    {m.cards && <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>{m.cards.map(c => (<React.Fragment key={c.id}>{renderCard(m, c)}{canUndo(c) && <div style={{ marginTop: '-2px' }}><button type="button" style={btn} onClick={() => void doUndo(m.id, c)}><Undo2 size={13} /> Geri al</button></div>}</React.Fragment>))}</div>}
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
                {busy && <div style={{ ...lab, display: 'flex', alignItems: 'center', gap: '8px' }}><JarvisCore state="thinking" size={30} /> Düşünüyor…</div>}
                <div ref={endRef} />
              </div>
              <div style={{ padding: '10px 12px', borderTop: border }}>
                {err && <div style={{ fontSize: '12px', color: '#ef4444', marginBottom: '6px', overflowWrap: 'anywhere' }}>{err}</div>}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} aria-label="Asistana mesaj" placeholder={noteOpen ? 'Örn. başlığı mavi yap, altını 3 parçaya böl…' : 'Ne yapmak istersiniz?'}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    style={{ flex: 1, resize: 'none', background: 'var(--bg-tertiary)', border, color: 'var(--text-primary)', borderRadius: '8px', padding: '7px 9px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  {(SpeechCls || canRecord()) && <button type="button" style={{ ...btn, padding: '8px', background: listening ? '#ef4444' : undefined, color: listening ? '#fff' : undefined, opacity: transcribing ? 0.5 : 1 }} disabled={transcribing} onClick={() => void toggleMic()} aria-label={listening ? 'Dinlemeyi durdur' : 'Sesle yaz'} title={listening ? 'Bitirmek için tekrar basın' : transcribing ? 'Yazıya çevriliyor…' : 'Konuşmak için basın'}><Mic size={14} /></button>}
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
