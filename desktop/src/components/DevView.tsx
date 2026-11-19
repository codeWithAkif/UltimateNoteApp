import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hammer, Download, Monitor, Smartphone, Camera, Play, FileSearch, GitMerge, Rocket, Trash2, RefreshCw, FolderOpen, X, AlertTriangle, CheckCircle2, Square, ShieldCheck } from 'lucide-react';
import { CLAUDE_TASK_MODELS, getTaskModel, setTaskModel, planTask, applyTask, cancelPlan, discardWork, openWorkFolder, isClaudeReady } from '../services/claudeTask';
import { getProjectFolder, setProjectFolder, pickProjectFolder, inspectProjectFolder, type FolderInfo } from '../services/projectFolders';
import {
  isDevSupported, loadDevStore, saveDevStore, newDevId, taskText, buildDevApplyPrompt, buildDevFixPrompt, buildDevRedoPrompt, buildDevFeedbackPrompt, planRequestText, planHasQuestions, fmtDuration,
  appendReleaseLog, DEV_LOG_PATH, STAGE_LABEL, STAGE_COLOR, emptyStore, type DevStore, type DevRequest, type DevStage, type DevRelease
} from '../services/devWork';

import DevMachine from './DevMachine';

const FOLDER_KEY ='uygulama-gelistirme';
const PROJECT_LABEL = 'Ultimate NoteFactory';

const panel: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px' };
const field: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px',
  padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0, width: '100%'
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};
const btnPrimary: React.CSSProperties = { ...btn, background: 'var(--accent-color)', border: '1px solid var(--accent-color)', color: '#fff' };
const pre: React.CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px', lineHeight: 1.55, fontFamily: 'inherit', color: 'var(--text-secondary)' };
// Halka bölümün içeriğine yapışmasın diye iç boşluk verilir; negatif kenar boşluğu düzeni yerinde tutar.
const secWrap: React.CSSProperties = { padding: '0 10px 10px', margin: '0 -10px', borderRadius: '10px' };
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '14px 0 6px' };

// Yayın derlemesi bitince yeni sürümü kendiliğinden indirip yükleme durumu
interface UpdState { version: string; phase: 'waiting' | 'downloading' | 'ready' | 'postponed' | 'installing' | 'error'; percent?: number; text?: string; secs?: number }
const cmpV = (a: string, b: string): number => {
  const p = (s: string) => s.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
};

type Busy = { id: string; kind: 'plan' | 'apply' | 'check' | 'merge' | 'diff' } | null;
interface RelPlan {
  ok: boolean; error?: string; dirty?: string[]; latest?: string; lastTag?: string; current?: string; branch?: string; unpublished?: string;
  next?: { patch: string; minor: string; major: string }; commits?: string[]; fileCount?: number; files?: { status: string; path: string }[];
  findings?: { kind: string; file: string; sample: string }[]; ahead?: number; pulled?: number;
}

// Uygulamanın kendi kodunu Claude Code ile geliştirme: istek -> plan -> uygula -> kontrol -> inceleme -> birleştir -> yayınla (+ derleme takibi).
// Claude hiçbir zaman push/birleştirme/yayın yapmaz; bunları yalnızca bu ekrandaki düğmeler (uygulama) yapar.
export default function DevView({ fileContents, onSaveNote }: {
  fileContents: Record<string, string>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
}) {
  const api = (window as any).electron;
  const [store, setStore] = useState<DevStore>(emptyStore());
  const storeRef = useRef(store);
  const [loaded, setLoaded] = useState(false);
  const [dir, setDir] = useState<string | null>(() => getProjectFolder(FOLDER_KEY));
  const [folderInfo, setFolderInfo] = useState<FolderInfo | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [model, setModel] = useState(() => getTaskModel());
  const [busy, setBusy] = useState<Busy>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [msg, setMsg] = useState('');
  const [diffView, setDiffView] = useState<{ id: string; text: string; files: { added: number; removed: number; path: string }[]; file?: string } | null>(null);
  const [confirm, setConfirm] = useState<'' | 'merge' | 'discard'>('');
  const [conflict, setConflict] = useState<{ id: string; files: string[] } | null>(null);
  const [rel, setRel] = useState<{ plan: RelPlan | null; loading: boolean; bump: 'patch' | 'minor' | 'major'; summary: string; running: boolean; progress: string; error: string; findings?: RelPlan['findings']; output?: string } | null>(null);
  const runId = useRef('');
  const alive = useRef(true);
  // Önizleme: çalışma kopyasındaki uygulama tarayıcı modunda çalışır, <webview> ile gösterilir; ekran görüntüleri Claude'un düzeltme turuna eklenir
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [wvReady, setWvReady] = useState(false);
  const [phone, setPhone] = useState(false);
  const [shots, setShots] = useState<{ path: string; thumb: string }[]>([]);
  const [feedback, setFeedback] = useState('');
  const webviewRef = useRef<any>(null);
  const [appVer, setAppVer] = useState('');
  const [upd, setUpd] = useState<UpdState | null>(null);
  const updRef = useRef<UpdState | null>(null);
  updRef.current = upd;

  const commit = useCallback((fn: (s: DevStore) => DevStore) => {
    const next = fn(storeRef.current);
    storeRef.current = next;
    setStore(next);
    void saveDevStore(next);
  }, []);
  const patch = useCallback((id: string, p: Partial<DevRequest>, logText?: string) => {
    commit(s => ({ ...s, requests: s.requests.map(r => (r.id === id ? { ...r, ...p, updatedAt: Date.now(), log: logText ? [...r.log, { t: Date.now(), text: logText }].slice(-60) : r.log } : r)) }));
  }, [commit]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { loadDevStore().then(s => { storeRef.current = s; setStore(s); setLoaded(true); }); }, []);
  useEffect(() => { isClaudeReady().then(setReady).catch(() => setReady(false)); }, []);
  useEffect(() => { Promise.resolve(api?.getAppVersion?.()).then(v => setAppVer(String(v || ''))).catch(() => undefined); }, [api]);

  const refreshStatus = useCallback(async () => {
    if (!dir || !api?.devStatus) { setStatus(null); return; }
    setStatus(await api.devStatus({ dir }));
  }, [dir, api]);
  useEffect(() => {
    if (!dir) { setFolderInfo(null); return; }
    inspectProjectFolder(dir).then(setFolderInfo).catch(() => setFolderInfo(null));
    void refreshStatus();
  }, [dir, refreshStatus]);

  // çalışırken geçen süre
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - t0), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Derleme (CI) takibi: yayınlanan sürümün derlemesi bitene kadar 20 sn'de bir sorulur (en çok 45 dk)
  useEffect(() => {
    if (!dir || !api?.devCi) return;
    const pending = store.releases.filter(r => (!r.ci || ['none', 'queued', 'running'].includes(r.ci)) && Date.now() - r.at < 45 * 60000);
    if (pending.length === 0) return;
    let stop = false;
    const tick = async () => {
      for (const r of pending) {
        const res = await api.devCi({ dir, tag: `v${r.version}` });
        if (stop || !res?.ok) continue;
        if (res.state !== r.ci) commit(s => ({ ...s, releases: s.releases.map(x => (x.version === r.version ? { ...x, ci: res.state, ciUrl: res.url } : x)) }));
      }
    };
    void tick();
    const t = setInterval(tick, 20000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, store.releases.map(r => `${r.version}:${r.ci || ''}`).join('|')]);

  // Otomatik güncelleme: derlemesi başarılı biten, çalışan sürümden yeni bir yayın varsa indirilir ve (iş yokken) kendiliğinden yüklenir.
  const updTarget = appVer ? store.releases.find(r => r.ci === 'success' && cmpV(r.version, appVer) > 0 && Date.now() - r.at < 24 * 3600 * 1000) : undefined;
  const updTargetVersion = updTarget?.version || '';
  useEffect(() => {
    if (!updTargetVersion || !api?.checkForUpdates || !api?.onUpdateStatus) return;
    let cancelled = false, attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setUpd({ version: updTargetVersion, phase: 'waiting', text: 'Yeni sürümün GitHub\'da hazır olması bekleniyor…' });
    const off = api.onUpdateStatus((d: { status: string; version?: string; percent?: number }) => {
      if (cancelled) return;
      if (d.status === 'downloading') setUpd(u => (u && u.phase !== 'ready' && u.phase !== 'installing' ? { version: updTargetVersion, phase: 'downloading', percent: d.percent } : u));
      else if (d.status === 'downloaded' && d.version && cmpV(d.version, updTargetVersion) >= 0) setUpd(u => (u && (u.phase === 'ready' || u.phase === 'installing' || u.phase === 'postponed') ? u : { version: d.version as string, phase: 'ready', secs: 15 }));
    });
    const attempt = async () => {
      if (cancelled) return;
      attempts++;
      let res: any;
      try { res = await api.checkForUpdates(); } catch (e: any) { res = { success: false, error: String(e?.message || e) }; }
      if (cancelled) return;
      if (res && res.success === false && res.error) { setUpd({ version: updTargetVersion, phase: 'error', text: String(res.error) }); return; }
      // Sürüm yayında hazırsa indirme/indirildi olayları gelir; gelmediyse (derleme sonrası GitHub'ın görünür kılması gecikebilir) 30 sn sonra yeniden sorulur
      timer = setTimeout(() => {
        if (cancelled) return;
        const u = updRef.current;
        if (u && u.phase === 'waiting') {
          if (attempts < 12) void attempt();
          else setUpd({ version: updTargetVersion, phase: 'error', text: 'Yeni sürüm GitHub\'da bulunamadı. Biraz sonra Ayarlar > Hakkında > Güncellemeleri Kontrol Et ile deneyin.' });
        }
      }, 30000);
    };
    void attempt();
    return () => { cancelled = true; if (timer) clearTimeout(timer); try { off?.(); } catch { /* yoksay */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updTargetVersion]);

  const installNow = async () => {
    setUpd(u => (u ? { ...u, phase: 'installing', text: 'Yeniden başlatılıp yükleniyor…' } : u));
    try { await saveDevStore(storeRef.current); } catch { /* yoksay */ }
    await api.restartAndInstall?.({ silent: true });
  };
  // geri sayım: iş yokken 0'a inince yükler; Claude işi/yayın sürüyorsa bitmesini bekler
  useEffect(() => {
    if (upd?.phase !== 'ready') return;
    const t = setInterval(() => setUpd(u => (u && u.phase === 'ready' ? { ...u, secs: Math.max(0, (u.secs ?? 0) - 1) } : u)), 1000);
    return () => clearInterval(t);
  }, [upd?.phase]);
  useEffect(() => {
    if (upd?.phase === 'ready' && (upd.secs ?? 0) <= 0 && !busy && !rel?.running) void installNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upd?.phase, upd?.secs, busy, rel?.running]);

  if (!isDevSupported()) {
    return <div style={{ padding: '24px', color: 'var(--text-muted)' }}>Geliştir bölümü yalnızca masaüstü uygulamasında çalışır (Claude Code orada kurulu).</div>;
  }

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !preview) return;
    const onReady = () => setWvReady(true);
    wv.addEventListener('dom-ready', onReady);
    return () => { try { wv.removeEventListener('dom-ready', onReady); } catch { /* yoksay */ } };
  }, [preview?.url]);

  const selected = store.requests.find(r => r.id === selectedId) || null;
  const progress = (t: string) => setLines(l => [...l.slice(-40), t]);
  const isBusy = !!busy || !!rel?.running || previewLoading;

  const pickDir = async () => {
    setMsg('');
    const r = await pickProjectFolder();
    if (r.canceled || !r.info) return;
    if (!r.info.ok || !r.info.path) { setMsg(r.info.error || 'Bu klasör seçilemez.'); return; }
    if (!r.info.isGit) { setMsg('Seçilen klasör bir git deposu değil.'); return; }
    setProjectFolder(FOLDER_KEY, r.info.path); setDir(r.info.path);
  };

  const addRequest = () => {
    const t = title.trim();
    if (!t) return;
    const r: DevRequest = { id: newDevId(), title: t.slice(0, 160), detail: detail.trim().slice(0, 8000), model, createdAt: Date.now(), updatedAt: Date.now(), stage: 'istek', log: [{ t: Date.now(), text: 'İstek oluşturuldu' }] };
    commit(s => ({ ...s, requests: [r, ...s.requests] }));
    setTitle(''); setDetail(''); setSelectedId(r.id);
  };

  // ---- Claude: plan
  const doPlan = async (r: DevRequest) => {
    if (!dir) return;
    setTaskModel(model); setMsg(''); setLines([]);
    runId.current = newDevId(); setBusy({ id: r.id, kind: 'plan' });
    const res = await planTask(runId.current, { dir, title: planRequestText(r), project: PROJECT_LABEL, attachments: [], model }, progress);
    if (!alive.current) return;
    if (res.ok) patch(r.id, { stage: 'plan', plan: res.text || '', error: undefined }, `Plan çıkarıldı (${fmtDuration(res.ms || 0)})`);
    else if (!res.cancelled) patch(r.id, { error: res.error }, `Plan hatası: ${res.error}`);
    setBusy(null);
  };

  const closePreview = async () => { setPreview(null); setWvReady(false); try { await api.devPreviewStop?.(); } catch { /* yoksay */ } };
  const startPreview = async (r: DevRequest) => {
    if (!dir || !r.worktree || !r.branch) return;
    setMsg(''); setPreviewLoading(true); setWvReady(false);
    const res = await api.devPreviewStart({ dir, worktree: r.worktree, branch: r.branch });
    if (!alive.current) return;
    setPreviewLoading(false);
    if (res?.ok) setPreview({ id: r.id, url: res.url }); else { setPreview(null); setMsg(res?.error || 'Önizleme başlatılamadı.'); }
  };
  const takeShot = async () => {
    const wv = webviewRef.current;
    if (!wv || !wvReady) { setMsg('Sayfa henüz yüklenmedi; birkaç saniye sonra tekrar deneyin.'); return; }
    setMsg('');
    let id = 0;
    try { id = wv.getWebContentsId(); } catch { /* yok */ }
    const res = await api.devPreviewShot(id);
    if (res?.ok) setShots(s => [...s.slice(-5), { path: res.path, thumb: res.thumb }]); else setMsg(res?.error || 'Ekran görüntüsü alınamadı.');
  };

  const doCheck = async (r: DevRequest) => {
    if (!dir || !r.worktree || !r.branch) return;
    if (preview) { setPreview(null); setWvReady(false); } // kontrol çalışırken önizleme kapanır (sunucu tarafı da durdurur)
    setBusy({ id: r.id, kind: 'check' }); setLines(['Tür denetimi (tsc) çalışıyor…']);
    patch(r.id, { stage: 'kontrol' });
    const res = await api.devCheck({ dir, worktree: r.worktree, branch: r.branch });
    if (!alive.current) return;
    patch(r.id, { stage: 'inceleme', check: { ok: !!res?.ok, output: res?.ok ? '' : `${res?.error || ''}\n${res?.output || ''}`.trim(), at: Date.now() } }, res?.ok ? 'Kontrol geçti' : 'Kontrol başarısız');
    setBusy(null);
  };

  // ---- Claude: uygula (ilk tur / düzeltme / çakışma sonrası yeniden)
  const doApply = async (r: DevRequest, mode: 'first' | 'fix' | 'redo' | 'feedback') => {
    if (!dir) return;
    if (mode === 'feedback' && !feedback.trim() && shots.length === 0) { setMsg('Önce neyin düzeltileceğini yazın ya da ekran görüntüsü alın.'); return; }
    const hadPreview = !!preview && preview.id === r.id;
    const sendShots = mode === 'feedback' ? shots.map(s => s.path) : [];
    const note = feedback;
    if (preview) { setPreview(null); setWvReady(false); }
    setTaskModel(model); setMsg(''); setLines([]); setConflict(null); setDiffView(null);
    runId.current = newDevId(); setBusy({ id: r.id, kind: 'apply' });
    const prevStage = r.stage;
    const oldWork = mode === 'redo' && r.worktree && r.branch ? { worktree: r.worktree, branch: r.branch } : null;
    const prompt = mode === 'fix' ? buildDevFixPrompt(r, r.check?.output || r.error || 'Bilinmeyen sorun')
      : mode === 'feedback' ? buildDevFeedbackPrompt(r, note.trim() || '(yazılı not yok; ekran görüntülerine bakıp gördüğün sorunları düzelt)', sendShots.length)
      : mode === 'redo' ? buildDevRedoPrompt(r, conflict?.files || []) : buildDevApplyPrompt(r);
    patch(r.id, { stage: 'yapiliyor', error: undefined }, mode === 'fix' ? 'Düzeltme turu başladı' : mode === 'feedback' ? `Önizleme geri bildirimiyle tur başladı (${sendShots.length} görüntü)` : mode === 'redo' ? 'Güncel koddan yeniden uygulama başladı' : 'Uygulama başladı');
    const res = await applyTask(runId.current, {
      dir, title: r.title, project: PROJECT_LABEL, attachments: [], model, plan: r.plan, prompt,
      shots: sendShots,
      reuse: (mode === 'fix' || mode === 'feedback') && r.worktree && r.branch ? { worktree: r.worktree, branch: r.branch } : undefined
    }, progress);
    if (!alive.current) return;
    if (res.cancelled) { patch(r.id, { stage: prevStage === 'yapiliyor' ? 'istek' : prevStage }, 'Durduruldu'); setBusy(null); return; }
    if (!res.ok && !res.changed) { patch(r.id, { stage: mode === 'fix' || mode === 'feedback' ? 'inceleme' : 'hata', error: res.error }, `Hata: ${res.error}`); setBusy(null); return; }
    if (res.ok && res.changed === false && mode !== 'fix' && mode !== 'feedback') { patch(r.id, { stage: 'hata', error: 'Claude hiçbir dosyayı değiştirmedi.', summary: res.text }, 'Değişiklik yapılmadı'); setBusy(null); return; }
    if (res.ok && res.changed === false) { patch(r.id, { stage: 'inceleme', summary: res.text || r.summary }, 'Düzeltme turunda yeni değişiklik olmadı'); setBusy(null); return; }
    if (oldWork) await discardWork(dir, oldWork.worktree, oldWork.branch); // yeniden yapma başarılı: çakışan eski kopya silinir
    patch(r.id, {
      branch: res.branch, worktree: res.worktree, stat: res.stat, files: res.files, summary: res.text, rounds: (r.rounds || 0) + 1, error: res.partial ? res.error : undefined, check: undefined
    }, `Claude turu bitti (${fmtDuration(res.ms || 0)})${res.partial ? ' — kısmen' : ''}`);
    setBusy(null);
    if (mode === 'feedback') { setFeedback(''); setShots([]); }
    await doCheck({ ...r, branch: res.branch, worktree: res.worktree });
    if (hadPreview && alive.current) await startPreview({ ...r, branch: res.branch, worktree: res.worktree }); // açık olan önizleme yeni hâliyle yeniden açılır
  };

  const showDiff = async (r: DevRequest, file?: string) => {
    if (!dir || !r.worktree || !r.branch) return;
    setBusy({ id: r.id, kind: 'diff' });
    const res = await api.devDiff({ dir, worktree: r.worktree, branch: r.branch, file });
    if (!alive.current) return;
    if (res?.ok) setDiffView({ id: r.id, text: res.text, files: res.files, file }); else setMsg(res?.error || 'Fark alınamadı.');
    setBusy(null);
  };

  const doMerge = async (r: DevRequest) => {
    if (!dir || !r.worktree || !r.branch) return;
    setConfirm(''); setMsg(''); setConflict(null);
    if (preview) { setPreview(null); setWvReady(false); }
    setBusy({ id: r.id, kind: 'merge' }); setLines(['Ana dal güncelleniyor ve birleştiriliyor…']);
    const res = await api.devMerge({ dir, worktree: r.worktree, branch: r.branch });
    if (!alive.current) return;
    if (res?.ok) { patch(r.id, { stage: 'birlesti', mergedAt: Date.now(), worktree: undefined, branch: undefined }, `Ana dala birleştirildi (${res.head})`); setDiffView(null); void refreshStatus(); }
    else if (res?.conflict) { setConflict({ id: r.id, files: res.files || [] }); setMsg(res.error); }
    else setMsg(res?.error || 'Birleştirilemedi.');
    setBusy(null);
  };

  const doDiscard = async (r: DevRequest) => {
    setConfirm('');
    if (preview) { setPreview(null); setWvReady(false); }
    if (dir && r.worktree && r.branch) { const res = await discardWork(dir, r.worktree, r.branch); if (!res.ok) { setMsg(res.error || 'Silinemedi.'); return; } }
    patch(r.id, { stage: 'reddedildi', worktree: undefined, branch: undefined }, 'Reddedildi ve silindi');
    setDiffView(null); void refreshStatus();
  };

  const stop = () => { void cancelPlan(runId.current); };

  // ---- Yayın
  const openRelease = async () => {
    if (!dir) return;
    const ready = store.requests.filter(r => r.stage === 'birlesti');
    setRel({ plan: null, loading: true, bump: 'patch', summary: ready.map(r => r.title).join('; ').slice(0, 170), running: false, progress: '', error: '' });
    const plan: RelPlan = await api.devReleasePlan({ dir });
    setRel(x => (x ? { ...x, plan, loading: false } : x));
  };
  const doRelease = async () => {
    if (!dir || !rel?.plan?.ok || !rel.plan.next) return;
    const version = rel.plan.next[rel.bump];
    setRel(x => (x ? { ...x, running: true, error: '', progress: 'Başlıyor…' } : x));
    const off = api.onDevProgress?.((d: { text: string }) => setRel(x => (x ? { ...x, progress: d.text } : x)));
    const res = await api.devReleaseDo({ dir, version, summary: rel.summary });
    try { off?.(); } catch { /* yoksay */ }
    if (!alive.current) return;
    if (!res?.ok) { setRel(x => (x ? { ...x, running: false, error: res?.error || 'Yayınlanamadı.', findings: res?.findings, output: res?.output } : x)); return; }
    const ready = storeRef.current.requests.filter(r => r.stage === 'birlesti');
    const record: DevRelease = { version: res.version, at: Date.now(), requestIds: ready.map(r => r.id), summary: rel.summary, ci: 'none' };
    commit(s => ({
      requests: s.requests.map(r => (r.stage === 'birlesti' ? { ...r, stage: 'yayinda' as DevStage, version: res.version, updatedAt: Date.now(), log: [...r.log, { t: Date.now(), text: `v${res.version} olarak yayınlandı` }] } : r)),
      releases: [record, ...s.releases].slice(0, 60)
    }));
    if (onSaveNote) { try { await onSaveNote(DEV_LOG_PATH, appendReleaseLog(fileContents[DEV_LOG_PATH], record, ready.map(r => r.title))); } catch { /* günlük yazılamazsa yayın yine geçerli */ } }
    setRel(null); void refreshStatus();
  };

  const readyCount = store.requests.filter(r => r.stage === 'birlesti').length;
  const active = store.requests.filter(r => !['birlesti', 'yayinda', 'reddedildi'].includes(r.stage));
  const history = store.requests.filter(r => ['yayinda', 'reddedildi'].includes(r.stage));
  const folderBad = !!dir && !!folderInfo && !folderInfo.ok;
  const runningHere = (id: string) => busy?.id === id;
  // Aynı anda tek bölüm parlasın diye, seçili isteğin o anki aşamasına ait bölümü seçer.
  const activeSection = (r: typeof selected): string => {
    if (!r) return '';
    if (runningHere(r.id)) return 'busy';
    if (r.stage === 'plan') return 'plan';
    if (r.stage === 'inceleme') return r.check && !r.check.ok ? 'check' : r.files && r.files.length > 0 ? 'files' : r.check ? 'check' : '';
    if (r.stage === 'birlesti' || r.stage === 'yayinda') return r.summary ? 'summary' : '';
    if (r.stage === 'istek' || r.stage === 'hata') return r.error ? 'error' : '';
    return '';
  };
  // Halka rengi aşamanın rengidir; CSS değişkeni olduğu için tür dönüşümü gerekir.
  const glow = (key: string): { className?: string; style?: React.CSSProperties } => (selected && activeSection(selected) === key) ? { className: 'dev-glow', style: { '--dev-glow': STAGE_COLOR[selected.stage] } as React.CSSProperties } : {};
  // Makinede istasyona tıklama yalnızca seçimi değiştirir (işlem tetiklemez): o aşamadaki en yeni isteği seçer
  const pickStation = (i: number) => { const st: DevStage[][] = [['istek', 'hata'], ['plan'], ['yapiliyor'], ['kontrol'], ['inceleme'], ['birlesti'], ['yayinda']]; const r = store.requests.find(x => st[i].includes(x.stage)); if (r) { setSelectedId(r.id); setDiffView(null); setConfirm(''); setMsg(''); setConflict(null); } };
  const card = (r: DevRequest) => (
    <div key={r.id} onClick={() => { setSelectedId(r.id); setDiffView(null); setConfirm(''); setMsg(''); setConflict(null); }}
      style={{ padding: '9px 11px', borderRadius: '8px', cursor: 'pointer', marginBottom: '6px', background: selectedId === r.id ? 'var(--bg-hover)' : 'var(--bg-tertiary)', border: `1px solid ${selectedId === r.id ? 'var(--accent-color)' : 'var(--border-color)'}` }}>
      <div style={{ fontSize: '12.5px', fontWeight: 600, overflowWrap: 'anywhere' }}>{r.title}</div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', fontSize: '11px' }}>
        <span style={{ color: STAGE_COLOR[r.stage], fontWeight: 700 }}>{runningHere(r.id) ? 'Çalışıyor…' : STAGE_LABEL[r.stage]}</span>
        {r.version && <span style={{ color: 'var(--text-muted)' }}>v{r.version}</span>}
        {r.check && <span style={{ color: r.check.ok ? '#22c55e' : '#ef4444' }}>{r.check.ok ? '✓ kontrol' : '✗ kontrol'}</span>}
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '18px 16px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {(window as any).__devDemo && <div style={{ marginBottom: '8px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', fontSize: '12px' }}>DEMO: önizleme için örnek verilerle gösteriliyor; hiçbir gerçek işlem (git, Claude, yayın) yapılmaz.</div>}
        <h1 style={{ margin: 0, fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px' }}><Hammer size={22} /> Geliştir</h1>
        <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Uygulamayı Claude Code ile geliştirin: isteği yazın, plan ve uygulamayı izleyin, farkı onaylayın, birleştirin, yayınlayın. Claude hiçbir zaman gönderme/birleştirme/yayın yapmaz; bunları yalnızca bu ekrandaki düğmeler yapar.</div>

        <DevMachine stage={selected?.stage ?? null} busyKind={selected && busy?.id === selected.id ? busy.kind : null} elapsed={elapsed} readyCount={readyCount} ci={store.releases[0]?.ci} hasRequest={!!selected} onPick={pickStation} />

        {upd && (
          <div style={{ ...panel, marginTop: '12px', borderColor: upd.phase === 'error' ? '#ef4444' : 'var(--accent-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <Download size={16} style={{ color: upd.phase === 'error' ? '#ef4444' : 'var(--accent-color)' }} />
              <div style={{ flex: '1 1 240px', fontSize: '12.5px', overflowWrap: 'anywhere' }}>
                <b>v{upd.version}</b>{' '}
                {upd.phase === 'waiting' && (upd.text || 'hazırlanıyor…')}
                {upd.phase === 'downloading' && `indiriliyor %${upd.percent ?? 0}`}
                {upd.phase === 'ready' && ((upd.secs ?? 0) > 0 ? `indirildi — ${upd.secs} sn sonra yeniden başlatılıp yüklenecek` : 'indirildi — çalışan iş bitince yeniden başlatılıp yüklenecek')}
                {upd.phase === 'postponed' && 'indirildi; uygulamayı kapattığınızda kendiliğinden yüklenir'}
                {upd.phase === 'installing' && (upd.text || 'yükleniyor…')}
                {upd.phase === 'error' && `: ${upd.text}`}
              </div>
              {(upd.phase === 'ready' || upd.phase === 'postponed') && <button type="button" style={btnPrimary} onClick={() => void installNow()}>Şimdi yükle</button>}
              {upd.phase === 'ready' && <button type="button" style={btn} onClick={() => setUpd(u => (u ? { ...u, phase: 'postponed' } : u))}>Ertele</button>}
            </div>
            {upd.phase === 'downloading' && <div style={{ height: '4px', background: 'var(--border-color)', borderRadius: '2px', marginTop: '8px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${upd.percent ?? 0}%`, background: 'var(--accent-color)' }} /></div>}
          </div>
        )}

        {/* Depo ve durum */}
        <div style={{ ...panel, marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center' }}>
          <FolderOpen size={15} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '12.5px', color: folderBad ? '#ef4444' : 'var(--text-secondary)', overflowWrap: 'anywhere', flex: '1 1 200px' }} title={dir || ''}>
            {dir ? (folderInfo?.ok ? `${folderInfo.name} · ${dir}` : dir) : 'Uygulamanın kod klasörü seçilmedi'}
          </span>
          {status?.ok && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              dal <b>{status.branch}</b> · sürüm <b>v{status.version}</b>
              {status.dirty > 0 && <span style={{ color: '#f59e0b' }}> · {status.dirty} kaydedilmemiş dosya</span>}
              {status.ahead > 0 && <span style={{ color: '#f59e0b' }}> · {status.ahead} gönderilmemiş commit</span>}
              {status.behind > 0 && <span style={{ color: '#f59e0b' }}> · uzakta {status.behind} yeni commit</span>}
              {status.offline && <span style={{ color: '#f59e0b' }}> · uzak depoya ulaşılamadı</span>}
            </span>
          )}
          {status && !status.ok && <span style={{ fontSize: '12px', color: '#ef4444' }}>{status.error}</span>}
          <button type="button" style={btn} onClick={pickDir}><FolderOpen size={14} /> {dir ? 'Değiştir' : 'Klasör seç'}</button>
          {dir && <button type="button" style={{ ...btn, padding: '7px 9px' }} title="Durumu yenile" onClick={() => void refreshStatus()}><RefreshCw size={14} /></button>}
          <span style={{ fontSize: '12px', color: ready === false ? '#ef4444' : 'var(--text-muted)' }}>{ready === null ? 'Claude Code kontrol ediliyor…' : ready ? 'Claude Code hazır' : 'Claude Code kurulu değil ya da giriş yapılmamış (Ayarlar > AI Mentor > Kontrol et)'}</span>
        </div>
        {msg && <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{msg}</div>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '14px', alignItems: 'flex-start' }}>
          {/* Sol: yeni istek + liste */}
          <div style={{ flex: '1 1 300px', minWidth: 0, maxWidth: '420px' }}>
            <div style={panel}>
              <div style={{ ...label, margin: '0 0 6px' }}>Yeni istek</div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ne yapılsın? (kısa başlık)" style={field} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addRequest(); }} />
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Ayrıntı (isteğe bağlı): nasıl görünsün, hangi ekran, neye dikkat edilsin…" rows={4} style={{ ...field, marginTop: '8px', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...field, width: 'auto' }} title="Claude modeli">
                  {CLAUDE_TASK_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <button type="button" style={btnPrimary} disabled={!title.trim() || !loaded} onClick={addRequest}>İstek ekle</button>
              </div>
            </div>

            <div style={label}>Açık istekler ({active.length})</div>
            {!loaded ? <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Yükleniyor…</div> : active.length === 0 ? <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Açık istek yok.</div> : active.map(card)}

            <div style={{ ...label, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Yayına hazır ({readyCount})
              <button type="button" style={{ ...btnPrimary, marginLeft: 'auto', padding: '5px 10px', fontSize: '12px', opacity: readyCount || status?.ahead ? 1 : 0.6 }} disabled={isBusy || !dir} onClick={openRelease}><Rocket size={13} /> Yayına hazırla</button>
            </div>
            {readyCount === 0 ? <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Birleştirilmiş istek yok.</div> : store.requests.filter(r => r.stage === 'birlesti').map(card)}

            {store.releases.length > 0 && (
              <>
                <div style={label}>Yayınlar</div>
                {store.releases.slice(0, 6).map(r => (
                  <div key={r.version} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', padding: '4px 0', color: 'var(--text-secondary)' }}>
                    <b>v{r.version}</b>
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(r.at).toLocaleDateString('tr-TR')}</span>
                    <span style={{ marginLeft: 'auto', color: r.ci === 'success' ? '#22c55e' : r.ci === 'failure' ? '#ef4444' : '#eab308', fontWeight: 600 }}>
                      {r.ci === 'success' ? 'Derleme başarılı' : r.ci === 'failure' ? 'Derleme BAŞARISIZ' : r.ci === 'cancelled' ? 'Derleme iptal' : r.ci === 'running' ? 'Derleniyor…' : r.ci === 'queued' ? 'Sırada…' : 'Derleme bekleniyor…'}
                    </span>
                  </div>
                ))}
              </>
            )}

            {history.length > 0 && (<><div style={label}>Geçmiş ({history.length})</div>{history.slice(0, 15).map(card)}</>)}
          </div>

          {/* Sağ: seçili istek */}
          <div style={{ flex: '2 1 420px', minWidth: 0 }}>
            {!selected ? (
              <div style={{ ...panel, color: 'var(--text-muted)', fontSize: '13px' }}>Soldan bir istek seçin ya da yeni istek ekleyin.</div>
            ) : (
              <div style={panel}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, overflowWrap: 'anywhere' }}>{selected.title}</div>
                    <div style={{ fontSize: '11.5px', marginTop: '3px', color: STAGE_COLOR[selected.stage], fontWeight: 700 }}>{STAGE_LABEL[selected.stage]}{selected.rounds ? ` · ${selected.rounds} Claude turu` : ''}</div>
                  </div>
                  {!isBusy && ['istek', 'hata', 'reddedildi', 'yayinda'].includes(selected.stage) && (
                    <button type="button" style={{ ...btn, padding: '5px 8px' }} title="Kaydı sil" onClick={() => { commit(s => ({ ...s, requests: s.requests.filter(x => x.id !== selected.id) })); setSelectedId(null); }}><X size={14} /></button>
                  )}
                </div>
                {selected.detail && <pre style={{ ...pre, marginTop: '8px' }}>{selected.detail}</pre>}

                {/* çalışıyor */}
                {runningHere(selected.id) && (
                  <div className={glow('busy').className} style={{ marginTop: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px', ...glow('busy').style }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600 }}>
                      <RefreshCw size={14} className="animate-spin" /> {busy?.kind === 'plan' ? 'Plan çıkarılıyor' : busy?.kind === 'apply' ? 'Claude çalışıyor' : busy?.kind === 'check' ? 'Kontrol ediliyor' : busy?.kind === 'merge' ? 'Birleştiriliyor' : 'Çalışıyor'} · {fmtDuration(elapsed)}
                      {(busy?.kind === 'plan' || busy?.kind === 'apply') && <button type="button" style={{ ...btn, marginLeft: 'auto', padding: '4px 9px' }} onClick={stop}><Square size={12} /> Durdur</button>}
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '11.5px', color: 'var(--text-muted)', maxHeight: '140px', overflowY: 'auto' }}>
                      {lines.slice(-12).map((l, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>{l}</div>)}
                    </div>
                  </div>
                )}

                {selected.error && !runningHere(selected.id) && (
                  <div className={glow('error').className} style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444', display: 'flex', gap: '6px', borderRadius: '8px', padding: '6px 8px', ...glow('error').style }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} /><span style={{ overflowWrap: 'anywhere' }}>{selected.error}</span></div>
                )}

                {selected.plan && (<div className={glow('plan').className} style={{ ...secWrap, ...glow('plan').style }}><div style={label}>Plan</div><div style={{ maxHeight: '260px', overflowY: 'auto', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px' }}><pre style={pre}>{selected.plan}</pre></div></div>)}
                {selected.plan && selected.stage === 'plan' && !isBusy && (
                  <>
                    <div style={label}>Sorulara cevaplarınız / ek notunuz</div>
                    <textarea
                      value={selected.answers || ''}
                      onChange={(e) => patch(selected.id, { answers: e.target.value })}
                      rows={4}
                      placeholder={'Plandaki "Emin olmadığım noktalar"ı numarasıyla cevaplayın, örn.\n1: (a) sağdaki panel\n2: hepsi\n3: yalnızca iş sürerken\nBoş bırakırsanız Claude varsayımla ilerler.'}
                      style={{ ...field, resize: 'vertical' }}
                    />
                    {planHasQuestions(selected.plan) && !(selected.answers || '').trim() && (
                      <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '4px' }}>Planda Claude'un size sorduğu noktalar var; cevaplamazsanız Claude kendi varsayımıyla ilerler.</div>
                    )}
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Cevaplarınız uygulamaya "planın varsayımlarından öncelikli" diye iletilir. Çok şey değiştiyse "Planı yeniden çıkar" ile Claude planı cevaplarınıza göre günceller.</div>
                  </>
                )}

                {/* eylemler */}
                {!isBusy && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                    {(selected.stage === 'istek' || selected.stage === 'hata') && (
                      <>
                        <button type="button" style={btn} disabled={!dir || !ready} onClick={() => doPlan(selected)}><FileSearch size={14} /> Plan çıkar</button>
                        <button type="button" style={btnPrimary} disabled={!dir || !ready} onClick={() => doApply(selected, 'first')}><Play size={14} /> Direkt uygula</button>
                      </>
                    )}
                    {selected.stage === 'plan' && (
                      <>
                        <button type="button" style={btnPrimary} disabled={!dir || !ready} onClick={() => doApply(selected, 'first')}><Play size={14} /> Bu planla uygula</button>
                        <button type="button" style={btn} disabled={!dir || !ready} onClick={() => doPlan(selected)}>Planı yeniden çıkar</button>
                      </>
                    )}
                    {selected.stage === 'inceleme' && selected.worktree && (
                      <>
                        <button type="button" style={btnPrimary} disabled={isBusy} onClick={() => startPreview(selected)}><Monitor size={14} /> {preview?.id === selected.id ? 'Önizlemeyi yenile' : 'Önizle'}</button>
                        <button type="button" style={btn} onClick={() => showDiff(selected)}><FileSearch size={14} /> Farkı göster</button>
                        <button type="button" style={btn} onClick={() => doCheck(selected)}><ShieldCheck size={14} /> Kontrolü tekrarla</button>
                        {selected.check && !selected.check.ok && <button type="button" style={btnPrimary} disabled={!ready} onClick={() => doApply(selected, 'fix')}>Claude düzeltsin</button>}
                        {confirm === 'merge' ? (
                          <>
                            <button type="button" style={{ ...btnPrimary, background: '#16a34a', border: '1px solid #16a34a' }} onClick={() => doMerge(selected)}><GitMerge size={14} /> Evet, ana dala birleştir</button>
                            <button type="button" style={btn} onClick={() => setConfirm('')}>Vazgeç</button>
                          </>
                        ) : (
                          <button type="button" style={{ ...btnPrimary, opacity: selected.check?.ok ? 1 : 0.5 }} disabled={!selected.check?.ok} title={selected.check?.ok ? '' : 'Önce kontrol geçmeli'} onClick={() => setConfirm('merge')}><GitMerge size={14} /> Birleştir</button>
                        )}
                        {confirm === 'discard' ? (
                          <>
                            <button type="button" style={{ ...btn, color: '#ef4444' }} onClick={() => doDiscard(selected)}><Trash2 size={14} /> Evet, sil</button>
                            <button type="button" style={btn} onClick={() => setConfirm('')}>Vazgeç</button>
                          </>
                        ) : (
                          <button type="button" style={btn} onClick={() => setConfirm('discard')}><Trash2 size={14} /> Reddet ve sil</button>
                        )}
                        <button type="button" style={{ ...btn, padding: '7px 9px' }} title="Çalışma klasörünü aç" onClick={() => dir && selected.worktree && openWorkFolder(dir, selected.worktree)}><FolderOpen size={14} /></button>
                      </>
                    )}
                    {conflict?.id === selected.id && (
                      <button type="button" style={btnPrimary} disabled={!ready} onClick={() => doApply(selected, 'redo')}>Claude güncel koddan yeniden yapsın</button>
                    )}
                  </div>
                )}
                {confirm === 'merge' && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>Değişiklik, güncel ana dalın üstüne alınıp ana dala eklenir (yerel; henüz yayınlanmaz). Ana klasörde kaydedilmemiş değişiklik varsa durur.</div>}
                {conflict?.id === selected.id && conflict.files.length > 0 && <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '6px', overflowWrap: 'anywhere' }}>Çakışan dosyalar: {conflict.files.join(', ')}</div>}

                {/* kontrol sonucu */}
                {selected.check && (
                  <div className={glow('check').className} style={{ ...secWrap, ...glow('check').style }}>
                    <div style={label}>Kontrol (tür denetimi)</div>
                    {selected.check.ok
                      ? <div style={{ fontSize: '12.5px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle2 size={14} /> Geçti</div>
                      : <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px' }}><pre style={{ ...pre, color: '#ef4444' }}>{selected.check.output}</pre></div>}
                  </div>
                )}

                {selected.files && selected.files.length > 0 && selected.stage === 'inceleme' && (
                  <div className={glow('files').className} style={{ ...secWrap, ...glow('files').style }}>
                    <div style={label}>Değişen dosyalar {selected.stat ? `· ${selected.stat}` : ''}</div>
                    <div style={{ fontSize: '12px' }}>
                      {selected.files.map(f => (
                        <div key={f.path} onClick={() => showDiff(selected, f.path)} style={{ display: 'flex', gap: '8px', padding: '2px 0', cursor: 'pointer', color: diffView?.file === f.path ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                          <span style={{ width: '14px', fontWeight: 700, color: f.status === 'A' ? '#22c55e' : f.status === 'D' ? '#ef4444' : '#eab308' }}>{f.status}</span><span style={{ overflowWrap: 'anywhere' }}>{f.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewLoading && <div style={{ marginTop: '12px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={14} className="animate-spin" /> Önizleme sunucusu başlatılıyor…</div>}
                {preview && preview.id === selected.id && selected.stage === 'inceleme' && (
                  <>
                    <div style={label}>Önizleme <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 0 }}>(tarayıcı modu: sahte boş kasa, gerçek notlarınıza dokunmaz; masaüstüne özel özellikler çalışmaz)</span></div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <button type="button" style={btn} onClick={() => { try { webviewRef.current?.reload(); } catch { /* yoksay */ } }}><RefreshCw size={13} /> Yenile</button>
                      <button type="button" style={{ ...btn, ...(phone ? { background: 'var(--accent-color)', color: '#fff', border: '1px solid var(--accent-color)' } : {}) }} onClick={() => setPhone(v => !v)}><Smartphone size={13} /> Telefon boyutu</button>
                      <button type="button" style={btnPrimary} disabled={!wvReady} onClick={takeShot}><Camera size={13} /> Ekran görüntüsü al</button>
                      <button type="button" style={btn} onClick={closePreview}><X size={13} /> Kapat</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', background: '#0b0f14', borderRadius: '8px', padding: phone ? '8px 0' : 0, overflow: 'hidden' }}>
                      <webview ref={webviewRef} src={preview.url} partition="devpreview" style={{ width: phone ? '390px' : '100%', height: '560px', border: 0, background: '#fff' }} />
                    </div>
                    {!wvReady && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>Sayfa yükleniyor… ilk açılış 10-30 saniye sürebilir.</div>}
                    {shots.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                        {shots.map((s, i) => (
                          <div key={s.path} style={{ position: 'relative' }}>
                            <img src={s.thumb} alt={`Ekran görüntüsü ${i + 1}`} style={{ width: '120px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'block' }} />
                            <button type="button" title="Kaldır" onClick={() => setShots(x => x.filter(y => y.path !== s.path))} style={{ position: 'absolute', top: '3px', right: '3px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: '18px', height: '18px', cursor: 'pointer', fontSize: '11px', lineHeight: 1 }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} placeholder="Ne düzeltilsin? (örn. 'düğme çok küçük', 'yazılar taşıyor'). Aldığınız ekran görüntüleri Claude'a eklenir." style={{ ...field, marginTop: '10px', resize: 'vertical' }} />
                    <div style={{ marginTop: '8px' }}>
                      <button type="button" style={btnPrimary} disabled={isBusy || !ready || (!feedback.trim() && shots.length === 0)} onClick={() => doApply(selected, 'feedback')}>Claude düzeltsin{shots.length ? ` (notum + ${shots.length} görüntü)` : ' (notum)'}</button>
                    </div>
                  </>
                )}

                {diffView?.id === selected.id && (
                  <>
                    <div style={label}>Fark {diffView.file ? `· ${diffView.file}` : '(tümü)'}</div>
                    <div style={{ maxHeight: '420px', overflow: 'auto', background: '#0b0f14', borderRadius: '8px', padding: '10px 12px', fontFamily: 'Consolas, monospace', fontSize: '11.5px', lineHeight: 1.5 }}>
                      {diffView.text.split('\n').map((l, i) => (
                        <div key={i} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: l.startsWith('+') && !l.startsWith('+++') ? '#4ade80' : l.startsWith('-') && !l.startsWith('---') ? '#f87171' : l.startsWith('@@') ? '#60a5fa' : '#9ca3af' }}>{l || ' '}</div>
                      ))}
                    </div>
                  </>
                )}

                {selected.summary && (<div className={glow('summary').className} style={{ ...secWrap, ...glow('summary').style }}><div style={label}>Claude'un özeti</div><div style={{ maxHeight: '240px', overflowY: 'auto', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px' }}><pre style={pre}>{selected.summary}</pre></div></div>)}

                {selected.log.length > 0 && (
                  <>
                    <div style={label}>Geçmiş</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      {selected.log.slice(-12).map((l, i) => <div key={i}>{new Date(l.t).toLocaleString('tr-TR')} · {l.text}</div>)}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Yayın penceresi */}
      {rel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
          <div style={{ width: 'min(640px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px 20px', color: 'var(--text-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}><Rocket size={16} /> Yayına hazırla</h3>
              {!rel.running && <button type="button" style={{ ...btn, padding: '5px 8px' }} onClick={() => setRel(null)}><X size={14} /></button>}
            </div>
            {rel.loading && <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--text-muted)' }}>Depo ve uzak etiketler denetleniyor…</div>}
            {rel.plan && !rel.plan.ok && (
              <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{rel.plan.error}{rel.plan.dirty && rel.plan.dirty.length > 0 && <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>{rel.plan.dirty.join(' · ')}</div>}</div>
            )}
            {rel.plan?.ok && rel.plan.next && (
              <>
                {rel.plan.pulled ? <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '8px' }}>Uzaktaki {rel.plan.pulled} yeni commit ana klasöre alındı.</div> : null}
                <div style={label}>Sürüm (son yayın: v{rel.plan.latest})</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {(['patch', 'minor', 'major'] as const).map(k => (
                    <button key={k} type="button" disabled={rel.running || (k !== 'patch' && !!rel.plan?.unpublished)} onClick={() => setRel({ ...rel, bump: k })}
                      style={{ ...btn, ...(rel.bump === k ? { background: 'var(--accent-color)', color: '#fff', border: '1px solid var(--accent-color)' } : {}) }}>
                      v{rel.plan!.next![k]} <span style={{ fontWeight: 400, opacity: 0.8 }}>{k === 'patch' ? (rel.plan!.unpublished ? '(bekleyen sürüm)' : 'küçük düzeltme/özellik') : k === 'minor' ? 'yeni özellik' : 'büyük değişiklik'}</span>
                    </button>
                  ))}
                </div>
                <div style={label}>Yayın notu (commit mesajına yazılır)</div>
                <input value={rel.summary} onChange={(e) => setRel({ ...rel, summary: e.target.value })} disabled={rel.running} style={field} />
                <div style={label}>Son yayından beri {rel.plan.commits?.length || 0} commit · {rel.plan.fileCount || 0} dosya</div>
                <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 10px' }}>
                  {(rel.plan.commits || []).map((c, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>• {c}</div>)}
                </div>
                {rel.plan.findings && rel.plan.findings.length > 0 && (
                  <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444' }}>
                    <b>Gizli bilgi olabilecek içerik bulundu, yayın engellendi:</b>
                    {rel.plan.findings.map((f, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>• {f.kind}: {f.file} {f.sample}</div>)}
                  </div>
                )}
                <div style={{ marginTop: '12px', fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Yayınlamak şunları yapar: tür denetimi (tsc) → sürüm numarası → commit → etiket → <b>herkese açık GitHub deposuna gönderme</b> → derleme başlar. Geri alınamaz.
                </div>
              </>
            )}
            {rel.error && <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{rel.error}{rel.findings?.map((f, i) => <div key={i}>• {f.kind}: {f.file} {f.sample}</div>)}{rel.output && <pre style={{ ...pre, marginTop: '6px', color: '#ef4444', maxHeight: '160px', overflowY: 'auto' }}>{rel.output}</pre>}</div>}
            {rel.running && <div style={{ marginTop: '10px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={14} className="animate-spin" /> {rel.progress}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              {!rel.running && <button type="button" style={btn} onClick={() => setRel(null)}>Kapat</button>}
              {rel.plan?.ok && rel.plan.next && !(rel.plan.findings && rel.plan.findings.length) && (
                <button type="button" style={{ ...btnPrimary, background: '#16a34a', border: '1px solid #16a34a', opacity: rel.running ? 0.6 : 1 }} disabled={rel.running} onClick={doRelease}>
                  <Rocket size={14} /> v{rel.plan.next[rel.bump]} olarak yayınla
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
