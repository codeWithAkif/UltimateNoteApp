import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Copy, Paperclip, FolderOpen, Square, Play, GitBranch, Trash2 } from 'lucide-react';
import { CLAUDE_TASK_MODELS, getTaskModel, setTaskModel, planTask, cancelPlan, applyTask, discardWork, openWorkFolder, type ApplyResult } from '../services/claudeTask';

const overlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};
const panel: React.CSSProperties = {
  width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};

type Stage = 'ask' | 'running' | 'done' | 'applying' | 'applied' | 'error';

// "Claude bu görevi başlatsın mı?" penceresi. İki yol: "Önce plan çıkar" (yalnızca okur) ve "Uygula" (ayrı git dalında/çalışma kopyasında yapar; push/birleştirme yok).
export default function ClaudeTaskModal({ taskTitle, project, folderName, branch, attachments, dir, onNeverAsk, onApplied, onClose }: {
  taskTitle: string; project: string; folderName?: string; branch?: string; attachments: string[]; dir: string;
  onNeverAsk: () => void; onApplied?: () => void; onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>('ask');
  const [model, setModel] = useState(getTaskModel());
  const [never, setNever] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [work, setWork] = useState<ApplyResult | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [workNote, setWorkNote] = useState('');
  const runId = useRef(`run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const alive = useRef(true);
  // StrictMode (geliştirme) efekti iki kez çalıştırır: bayrak her kurulumda yeniden açılmalı, yoksa sonuç sessizce yok sayılır.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (stage !== 'running' && stage !== 'applying') return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const start = async () => {
    if (never) onNeverAsk();
    setTaskModel(model);
    setStage('running'); setLines([]); setElapsed(0); setError('');
    const r = await planTask(runId.current, { dir, title: taskTitle, project, attachments, model }, (t) => {
      if (alive.current) setLines(prev => (prev[prev.length - 1] === t ? prev : [...prev, t].slice(-8)));
    });
    if (!alive.current) return;
    if (r.ok) { setPlan(r.text || ''); setStage('done'); }
    else if (r.cancelled) setStage('ask');
    else { setError(r.error || 'Claude plan çıkaramadı.'); setStage('error'); }
  };
  const apply = async (withPlan: boolean) => {
    if (never) onNeverAsk();
    setTaskModel(model);
    setStage('applying'); setLines([]); setElapsed(0); setError(''); setWork(null); setConfirmDiscard(false); setWorkNote('');
    const r = await applyTask(runId.current, { dir, title: taskTitle, project, attachments, model, plan: withPlan ? plan : undefined }, (t) => {
      if (alive.current) setLines(prev => (prev[prev.length - 1] === t ? prev : [...prev, t].slice(-8)));
    });
    if (!alive.current) return;
    if (r.cancelled) { setStage(withPlan ? 'done' : 'ask'); return; }
    if (r.ok || r.changed) {
      setWork(r); setStage('applied');
      if (r.changed && onApplied) { try { onApplied(); } catch { /* yoksay */ } }
    } else { setError(r.error || 'Claude görevi uygulayamadı.'); setStage('error'); }
  };
  const stop = () => { void cancelPlan(runId.current); };
  const close = () => { if (stage === 'running' || stage === 'applying') void cancelPlan(runId.current); onClose(); };
  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(''), 1800); };
  const copy = async () => { try { await navigator.clipboard.writeText(plan); flash('plan'); } catch { /* yoksay */ } };
  const copyText = async (k: string, text: string) => { try { await navigator.clipboard.writeText(text); flash(k); } catch { /* yoksay */ } };
  const openFolder = async () => { if (!work?.worktree) return; const r = await openWorkFolder(dir, work.worktree); if (!r.ok) setWorkNote(r.error || 'Klasör açılamadı.'); };
  const discard = async () => {
    if (!work?.worktree || !work.branch) return;
    if (!confirmDiscard) { setConfirmDiscard(true); return; }
    const r = await discardWork(dir, work.worktree, work.branch);
    if (r.ok) { setWork(w => (w ? { ...w, changed: false, worktree: undefined, branch: undefined, files: [], stat: '', text: 'Çalışma kopyası ve dal silindi.' } : w)); setConfirmDiscard(false); }
    else { setWorkNote(r.error || 'Silinemedi.'); setConfirmDiscard(false); }
  };

  return createPortal(
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Sparkles size={16} /> {stage === 'done' ? 'Claude\'un planı' : stage === 'applying' || stage === 'applied' ? 'Claude\'un çalışması' : 'Claude bu görevi başlatsın mı?'}</h3>
          <button type="button" onClick={close} style={{ ...btn, padding: '5px 8px' }} title="Kapat"><X size={14} /></button>
        </div>

        <div style={{ marginTop: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', overflowWrap: 'anywhere' }}>
          <div style={{ fontWeight: 600 }}>{taskTitle}</div>
          <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><FolderOpen size={12} /> {folderName || dir}{branch ? ` · dal: ${branch}` : ''}</span>
            {attachments.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Paperclip size={12} /> {attachments.length} ek Claude'a verilir</span>}
          </div>
        </div>

        {stage === 'ask' && (
          <>
            <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <b>Önce plan çıkar:</b> Claude klasörü yalnızca okuyarak plan yazar; hiçbir dosyayı değiştirmez.<br />
              <b>Uygula:</b> Claude görevi projenizin <b>ayrı bir git dalında, ayrı bir çalışma klasöründe</b> yapar. Ana klasörünüze ve ana dalınıza dokunulmaz; gönderme (push) ve birleştirme yapılmaz, farkı siz görüp karar verirsiniz.
              Birkaç dakika sürebilir ve Claude aboneliğinizin limitinden harcar.
            </div>
            <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
              <select value={model} onChange={(e) => setModel(e.target.value)} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', padding: '7px 10px', fontSize: '12.5px' }}>
                {CLAUDE_TASK_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} /> Bu projede bir daha sorma
              </label>
            </div>
            <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" onClick={start} style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none' }}><Sparkles size={14} /> Önce plan çıkar</button>
              <button type="button" onClick={() => void apply(false)} style={btn} title="Ayrı dalda, ayrı klasörde yapar; ana klasöre dokunmaz"><Play size={14} /> Doğrudan uygula</button>
              <button type="button" onClick={() => { if (never) onNeverAsk(); onClose(); }} style={btn}>Hayır</button>
            </div>
          </>
        )}

        {(stage === 'running' || stage === 'applying') && (
          <>
            <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>{stage === 'applying' ? 'Claude ayrı dalda çalışıyor…' : 'Claude klasörü inceliyor…'} {elapsed} sn</div>
            <div style={{ marginTop: '8px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', minHeight: '40px', overflowWrap: 'anywhere' }}>
              {lines.length === 0 ? 'Başlatılıyor…' : lines.map((l, i) => <div key={i} style={{ opacity: i === lines.length - 1 ? 1 : 0.6 }}>{l}</div>)}
            </div>
            <div style={{ marginTop: '12px' }}><button type="button" onClick={stop} style={btn}><Square size={13} /> Durdur</button></div>
          </>
        )}

        {stage === 'error' && (
          <>
            <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
              <button type="button" onClick={start} style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none' }}>Tekrar dene</button>
              <button type="button" onClick={onClose} style={btn}>Kapat</button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <>
            <div style={{ marginTop: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '48vh', overflowY: 'auto' }}>{plan}</div>
            <div style={{ marginTop: '10px', fontSize: '11.5px', color: 'var(--text-muted)' }}>Hiçbir dosya değiştirilmedi. Planı beğendiyseniz kopyalayıp Claude Code'a verebilirsiniz.</div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
              <button type="button" onClick={() => void apply(true)} style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none' }} title="Bu planla, ayrı dalda uygular; ana klasöre dokunmaz"><Play size={13} /> Bu planla uygula</button>
              <button type="button" onClick={copy} style={btn}><Copy size={13} /> {copied === 'plan' ? 'Kopyalandı' : 'Planı kopyala'}</button>
              <button type="button" onClick={onClose} style={btn}>Kapat</button>
            </div>
          </>
        )}

        {stage === 'applied' && work && (
          <>
            {work.changed ? (
              <>
                <div style={{ marginTop: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', lineHeight: 1.6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}><GitBranch size={13} /> {work.branch}</div>
                  <div style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{work.worktree}</div>
                  <div style={{ marginTop: '4px' }}>{work.stat}</div>
                  <div style={{ marginTop: '6px', maxHeight: '110px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {(work.files || []).map((f, i) => <div key={i}>{f.status}  {f.path}</div>)}
                  </div>
                </div>
                <div style={{ marginTop: '10px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  Ana klasörünüze ve <b>{work.base || 'ana dal'}</b> dalına dokunulmadı; gönderme ve birleştirme yapılmadı. Kart Test'e alındı. Farkı inceleyin, beğendiyseniz kendiniz birleştirin.
                </div>
              </>
            ) : (
              <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>{work.text && work.text.startsWith('Çalışma kopyası') ? work.text : 'Claude hiçbir dosyayı değiştirmedi (aşağıdaki yanıta bakın).'}</div>
            )}
            {work.changed && work.dirtyBase && <div style={{ marginTop: '8px', fontSize: '12px', color: '#f59e0b' }}>Ana klasörünüzde kaydedilmemiş değişiklikler vardı; Claude'un kopyası son commit'ten açıldığı için onları görmedi.</div>}
            {work.partial && <div style={{ marginTop: '8px', fontSize: '12px', color: '#f59e0b' }}>{work.error || 'Çalışma yarıda kaldı; o ana kadarki değişiklikler dalda korundu.'}</div>}
            {work.text && !(work.text.startsWith('Çalışma kopyası ve dal')) && (
              <div style={{ marginTop: '10px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '34vh', overflowY: 'auto' }}>{work.text}</div>
            )}
            {workNote && <div style={{ marginTop: '8px', fontSize: '12px', color: '#ef4444' }}>{workNote}</div>}
            <div style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {work.changed && work.worktree && <button type="button" onClick={openFolder} style={btn}><FolderOpen size={13} /> Klasörü aç</button>}
              {work.changed && work.branch && <button type="button" onClick={() => copyText('diff', `git diff ${work.base || 'HEAD'}...${work.branch}`)} style={btn}><Copy size={13} /> {copied === 'diff' ? 'Kopyalandı' : 'Fark komutunu kopyala'}</button>}
              {work.changed && work.branch && <button type="button" onClick={() => copyText('merge', `git merge ${work.branch}`)} style={btn}><Copy size={13} /> {copied === 'merge' ? 'Kopyalandı' : 'Birleştirme komutunu kopyala'}</button>}
              {work.changed && work.branch && <button type="button" onClick={discard} style={{ ...btn, color: confirmDiscard ? '#ef4444' : undefined }}><Trash2 size={13} /> {confirmDiscard ? 'Emin misiniz? Tekrar tıklayın' : 'Beğenmedim, sil'}</button>}
              <button type="button" onClick={onClose} style={btn}>Kapat</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
