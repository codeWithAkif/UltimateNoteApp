import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hammer, Play, FileSearch, GitMerge, Rocket, Trash2, RefreshCw, FolderOpen, X, AlertTriangle, CheckCircle2, Square, ShieldCheck } from 'lucide-react';
import { CLAUDE_TASK_MODELS, getTaskModel, setTaskModel, planTask, applyTask, cancelPlan, discardWork, openWorkFolder, isClaudeReady } from '../services/claudeTask';
import { getProjectFolder, setProjectFolder, pickProjectFolder, inspectProjectFolder, type FolderInfo } from '../services/projectFolders';
import {
  isDevSupported, loadDevStore, saveDevStore, newDevId, taskText, buildDevApplyPrompt, buildDevFixPrompt, buildDevRedoPrompt, fmtDuration,
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
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '14px 0 6px' };

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

  if (!isDevSupported()) {
    return <div style={{ padding: '24px', color: 'var(--text-muted)' }}>Geliştir bölümü yalnızca masaüstü uygulamasında çalışır (Claude Code orada kurulu).</div>;
  }

  const selected = store.requests.find(r => r.id === selectedId) || null;
  const progress = (t: string) => setLines(l => [...l.slice(-40), t]);
  const isBusy = !!busy || !!rel?.running;

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
    const res = await planTask(runId.current, { dir, title: taskText(r), project: PROJECT_LABEL, attachments: [], model }, progress);
    if (!alive.current) return;
    if (res.ok) patch(r.id, { stage: 'plan', plan: res.text || '', error: undefined }, `Plan çıkarıldı (${fmtDuration(res.ms || 0)})`);
    else if (!res.cancelled) patch(r.id, { error: res.error }, `Plan hatası: ${res.error}`);
    setBusy(null);
  };

  const doCheck = async (r: DevRequest) => {
    if (!dir || !r.worktree || !r.branch) return;
    setBusy({ id: r.id, kind: 'check' }); setLines(['Tür denetimi (tsc) çalışıyor…']);
    patch(r.id, { stage: 'kontrol' });
    const res = await api.devCheck({ dir, worktree: r.worktree, branch: r.branch });
    if (!alive.current) return;
    patch(r.id, { stage: 'inceleme', check: { ok: !!res?.ok, output: res?.ok ? '' : `${res?.error || ''}\n${res?.output || ''}`.trim(), at: Date.now() } }, res?.ok ? 'Kontrol geçti' : 'Kontrol başarısız');
    setBusy(null);
  };

  // ---- Claude: uygula (ilk tur / düzeltme / çakışma sonrası yeniden)
  const doApply = async (r: DevRequest, mode: 'first' | 'fix' | 'redo') => {
    if (!dir) return;
    setTaskModel(model); setMsg(''); setLines([]); setConflict(null); setDiffView(null);
    runId.current = newDevId(); setBusy({ id: r.id, kind: 'apply' });
    const prevStage = r.stage;
    const oldWork = mode === 'redo' && r.worktree && r.branch ? { worktree: r.worktree, branch: r.branch } : null;
    const prompt = mode === 'fix' ? buildDevFixPrompt(r, r.check?.output || r.error || 'Bilinmeyen sorun')
      : mode === 'redo' ? buildDevRedoPrompt(r, conflict?.files || []) : buildDevApplyPrompt(r);
    patch(r.id, { stage: 'yapiliyor', error: undefined }, mode === 'fix' ? 'Düzeltme turu başladı' : mode === 'redo' ? 'Güncel koddan yeniden uygulama başladı' : 'Uygulama başladı');
    const res = await applyTask(runId.current, {
      dir, title: r.title, project: PROJECT_LABEL, attachments: [], model, plan: r.plan, prompt,
      reuse: mode === 'fix' && r.worktree && r.branch ? { worktree: r.worktree, branch: r.branch } : undefined
    }, progress);
    if (!alive.current) return;
    if (res.cancelled) { patch(r.id, { stage: prevStage === 'yapiliyor' ? 'istek' : prevStage }, 'Durduruldu'); setBusy(null); return; }
    if (!res.ok && !res.changed) { patch(r.id, { stage: mode === 'fix' ? 'inceleme' : 'hata', error: res.error }, `Hata: ${res.error}`); setBusy(null); return; }
    if (res.ok && res.changed === false && mode !== 'fix') { patch(r.id, { stage: 'hata', error: 'Claude hiçbir dosyayı değiştirmedi.', summary: res.text }, 'Değişiklik yapılmadı'); setBusy(null); return; }
    if (res.ok && res.changed === false) { patch(r.id, { stage: 'inceleme', summary: res.text || r.summary }, 'Düzeltme turunda yeni değişiklik olmadı'); setBusy(null); return; }
    if (oldWork) await discardWork(dir, oldWork.worktree, oldWork.branch); // yeniden yapma başarılı: çakışan eski kopya silinir
    patch(r.id, {
      branch: res.branch, worktree: res.worktree, stat: res.stat, files: res.files, summary: res.text, rounds: (r.rounds || 0) + 1, error: res.partial ? res.error : undefined, check: undefined
    }, `Claude turu bitti (${fmtDuration(res.ms || 0)})${res.partial ? ' — kısmen' : ''}`);
    setBusy(null);
    await doCheck({ ...r, branch: res.branch, worktree: res.worktree });
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
        <h1 style={{ margin: 0, fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px' }}><Hammer size={22} /> Geliştir</h1>
        <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Uygulamayı Claude Code ile geliştirin: isteği yazın, plan ve uygulamayı izleyin, farkı onaylayın, birleştirin, yayınlayın. Claude hiçbir zaman gönderme/birleştirme/yayın yapmaz; bunları yalnızca bu ekrandaki düğmeler yapar.</div>

        <DevMachine stage={selected?.stage ?? null} busyKind={selected && busy?.id === selected.id ? busy.kind : null} elapsed={elapsed} readyCount={readyCount} ci={store.releases[0]?.ci} hasRequest={!!selected} onPick={pickStation} />

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
                  <div style={{ marginTop: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px' }}>
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
                  <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444', display: 'flex', gap: '6px' }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} /><span style={{ overflowWrap: 'anywhere' }}>{selected.error}</span></div>
                )}

                {selected.plan && (<><div style={label}>Plan</div><div style={{ maxHeight: '260px', overflowY: 'auto', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px' }}><pre style={pre}>{selected.plan}</pre></div></>)}

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
                  <>
                    <div style={label}>Kontrol (tür denetimi)</div>
                    {selected.check.ok
                      ? <div style={{ fontSize: '12.5px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle2 size={14} /> Geçti</div>
                      : <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px' }}><pre style={{ ...pre, color: '#ef4444' }}>{selected.check.output}</pre></div>}
                  </>
                )}

                {selected.files && selected.files.length > 0 && selected.stage === 'inceleme' && (
                  <>
                    <div style={label}>Değişen dosyalar {selected.stat ? `· ${selected.stat}` : ''}</div>
                    <div style={{ fontSize: '12px' }}>
                      {selected.files.map(f => (
                        <div key={f.path} onClick={() => showDiff(selected, f.path)} style={{ display: 'flex', gap: '8px', padding: '2px 0', cursor: 'pointer', color: diffView?.file === f.path ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                          <span style={{ width: '14px', fontWeight: 700, color: f.status === 'A' ? '#22c55e' : f.status === 'D' ? '#ef4444' : '#eab308' }}>{f.status}</span><span style={{ overflowWrap: 'anywhere' }}>{f.path}</span>
                        </div>
                      ))}
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

                {selected.summary && (<><div style={label}>Claude'un özeti</div><div style={{ maxHeight: '240px', overflowY: 'auto', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px' }}><pre style={pre}>{selected.summary}</pre></div></>)}

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
