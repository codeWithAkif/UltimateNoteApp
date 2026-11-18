import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Copy, Paperclip, FolderOpen, Square } from 'lucide-react';
import { CLAUDE_TASK_MODELS, getTaskModel, setTaskModel, planTask, cancelPlan } from '../services/claudeTask';

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

type Stage = 'ask' | 'running' | 'done' | 'error';

// "Claude bu görevi başlatsın mı?" penceresi. Bu sürümde "Önce plan çıkar": Claude proje klasörünü yalnızca OKUYARAK plan yazar (dosya değiştirmez).
export default function ClaudeTaskModal({ taskTitle, project, folderName, branch, attachments, dir, onNeverAsk, onClose }: {
  taskTitle: string; project: string; folderName?: string; branch?: string; attachments: string[]; dir: string;
  onNeverAsk: () => void; onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>('ask');
  const [model, setModel] = useState(getTaskModel());
  const [never, setNever] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const runId = useRef(`run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const alive = useRef(true);
  // StrictMode (geliştirme) efekti iki kez çalıştırır: bayrak her kurulumda yeniden açılmalı, yoksa sonuç sessizce yok sayılır.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (stage !== 'running') return;
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
  const stop = () => { void cancelPlan(runId.current); };
  const close = () => { if (stage === 'running') void cancelPlan(runId.current); onClose(); };
  const copy = async () => { try { await navigator.clipboard.writeText(plan); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* yoksay */ } };

  return createPortal(
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Sparkles size={16} /> {stage === 'done' ? 'Claude\'un planı' : 'Claude bu görevi başlatsın mı?'}</h3>
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
              Claude proje klasörünü <b>yalnızca okuyarak</b> bu görev için bir plan yazar: hangi dosyalar, hangi adımlar, riskler, test. <b>Hiçbir dosyayı değiştirmez</b>, komut çalıştırmaz.
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
              <button type="button" onClick={() => { if (never) onNeverAsk(); onClose(); }} style={btn}>Hayır</button>
            </div>
          </>
        )}

        {stage === 'running' && (
          <>
            <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>Claude klasörü inceliyor… {elapsed} sn</div>
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
              <button type="button" onClick={copy} style={btn}><Copy size={13} /> {copied ? 'Kopyalandı' : 'Planı kopyala'}</button>
              <button type="button" onClick={onClose} style={btn}>Kapat</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
