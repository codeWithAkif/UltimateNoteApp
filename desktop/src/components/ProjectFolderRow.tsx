import React, { useEffect, useState } from 'react';
import { FolderOpen, X, AlertTriangle } from 'lucide-react';
import { isClaudeTaskSupported, isAskEnabled, setAskEnabled } from '../services/claudeTask';
import {
  isProjectFolderSupported, getProjectFolder, setProjectFolder, clearProjectFolder, pickProjectFolder, inspectProjectFolder, type FolderInfo
} from '../services/projectFolders';

// Proje kartındaki "Proje klasörü" satırı: klasör Windows penceresiyle seçilir (elle yazılmaz), riskli yerler reddedilir, seçilen klasörün adı ve
// git dalı gösterilir ki yanlış yer seçildiyse görülsün. Yol yalnızca bu bilgisayarda saklanır.
export default function ProjectFolderRow({ project }: { project: string }) {
  const [dir, setDir] = useState<string | null>(() => getProjectFolder(project));
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [askOn, setAskOn] = useState(() => isAskEnabled(project));

  // Kayıtlı klasör hâlâ geçerli mi (taşınmış/silinmiş olabilir)?
  useEffect(() => {
    let alive = true;
    setDir(getProjectFolder(project));
    setAskOn(isAskEnabled(project));
    setError('');
    const d = getProjectFolder(project);
    if (!d) { setInfo(null); return; }
    inspectProjectFolder(d).then(i => { if (alive) setInfo(i); }).catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [project]);

  if (!isProjectFolderSupported()) return null;

  const pick = async () => {
    setBusy(true); setError('');
    try {
      const r = await pickProjectFolder();
      if (r.canceled || !r.info) return;
      if (!r.info.ok || !r.info.path) { setError(r.info.error || 'Bu klasör seçilemez.'); return; }
      setProjectFolder(project, r.info.path);
      setDir(r.info.path);
      setInfo(r.info);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  const clear = () => { clearProjectFolder(project); setDir(null); setInfo(null); setError(''); };

  const bad = !!dir && !!info && !info.ok;
  return (
    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <FolderOpen size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Proje klasörü</span>
        {dir ? (
          <span title={dir} style={{ fontSize: '12px', color: bad ? '#ef4444' : 'var(--text-secondary)', overflowWrap: 'anywhere', minWidth: 0, flex: '1 1 120px' }}>
            {info?.ok ? `${info.name}${info.branch ? ` · dal: ${info.branch}` : ''}` : dir}
          </span>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', flex: '1 1 80px' }}>Seçilmedi</span>
        )}
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '6px', cursor: 'pointer', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--accent-color)', whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}
        >{dir ? 'Değiştir…' : 'Klasör seç…'}</button>
        {dir && (
          <button type="button" onClick={clear} title="Klasör bağlantısını kaldır (klasöre dokunulmaz)" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', display: 'inline-flex' }}><X size={14} /></button>
        )}
      </div>
      {dir && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px', overflowWrap: 'anywhere' }}>{dir}</div>}
      {bad && <div style={{ fontSize: '11.5px', color: '#ef4444', marginTop: '4px' }}>{info?.error}</div>}
      {info?.ok && info.warning && (
        <div style={{ fontSize: '11.5px', color: '#f59e0b', marginTop: '4px', display: 'flex', gap: '5px', alignItems: 'flex-start' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /><span>{info.warning}</span>
        </div>
      )}
      {dir && info?.ok && isClaudeTaskSupported() && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '11.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={askOn} onChange={(e) => { setAskOn(e.target.checked); setAskEnabled(project, e.target.checked); }} />
          Kart "Devam Ediyor"a geçince "Claude başlasın mı?" diye sor
        </label>
      )}
      {error && <div style={{ fontSize: '11.5px', color: '#ef4444', marginTop: '4px', overflowWrap: 'anywhere' }}>{error}</div>}
    </div>
  );
}
