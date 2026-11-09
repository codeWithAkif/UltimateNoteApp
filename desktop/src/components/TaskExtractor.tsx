import React, { useMemo, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { isGeminiConfigured } from '../services/geminiMentor';
import {
  appendTasksToNote, dailyNotePath, dropExisting, generateTasks, prepareSource, type ExtractedTask
} from '../services/taskExtractor';

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
  borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  color: 'var(--text-primary)', borderRadius: '6px', padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit'
};
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '12px 0 6px' };

// "Görev çıkar" paneli: bir notu seçin ya da metin yapıştırın; yapay zekâ içindeki yapılacak işleri önerir, siz işaretleyip
// notun sonuna eklersiniz. Onay vermeden hiçbir dosyaya yazılmaz.
export default function TaskExtractorPanel({ fileContents, onSaveNote }: {
  fileContents: Record<string, string>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
}) {
  const paths = useMemo(
    () => Object.keys(fileContents).filter(p => /\.md$/i.test(p) && !p.split('/').some(s => s.startsWith('.'))).sort().reverse().slice(0, 400),
    // Liste açıldığı andaki hâliyle sabit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const today = dailyNotePath();
  const [notePath, setNotePath] = useState(fileContents[today] !== undefined ? today : '');
  const [pasted, setPasted] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'saved'>('idle');
  const [items, setItems] = useState<ExtractedTask[]>([]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');

  const noteKnown = notePath !== '' && fileContents[notePath] !== undefined;
  const source = pasted.trim() ? pasted : (noteKnown ? fileContents[notePath] : '');
  // Yapıştırılan metin için hedef: seçili not varsa o, yoksa bugünün günlüğü.
  const targetPath = noteKnown ? notePath : today;
  const canRun = source.trim().length >= 10 && state !== 'loading';

  const run = async () => {
    if (!isGeminiConfigured()) { setState('error'); setError('Gemini API anahtarı ayarlı değil. Ayarlar > AI Mentor bölümünden ekleyin.'); return; }
    setState('loading'); setError(''); setItems([]); setOff(new Set());
    try {
      const found = await generateTasks(prepareSource(source));
      setItems(dropExisting(found, fileContents[targetPath] || ''));
      setState('ready');
    } catch (e: any) { setState('error'); setError(String(e?.message || e)); }
  };
  const toggle = (i: number) => setOff(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const chosen = items.filter((_, i) => !off.has(i));
  const save = async () => {
    if (!onSaveNote || chosen.length === 0) return;
    try {
      await onSaveNote(targetPath, appendTasksToNote(fileContents[targetPath] || '', chosen));
      setTarget(targetPath); setState('saved');
    } catch (e: any) { setState('error'); setError(`Kaydedilemedi: ${String(e?.message || e)}`); }
  };

  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Bir not seçin ya da metin yapıştırın: içindeki yapılacak işler önerilir, işaretlediklerinizi nota görev olarak eklerim.
        Yalnızca bu metin Gemini'ye gönderilir.
      </div>

      <div style={label}>Not</div>
      <input
        list="gorev-cikar-notlar"
        value={notePath}
        onChange={(e) => { setNotePath(e.target.value); setState('idle'); }}
        placeholder="Not yolu (yazın ya da listeden seçin)"
        style={inputStyle}
      />
      <datalist id="gorev-cikar-notlar">{paths.map(p => <option key={p} value={p} />)}</datalist>
      {notePath && !noteKnown && <div style={{ fontSize: '11px', color: '#eab308', marginTop: '4px' }}>Bu yolda not bulunamadı.</div>}

      <div style={label}>Ya da metin yapıştırın</div>
      <textarea
        value={pasted}
        onChange={(e) => { setPasted(e.target.value); setState('idle'); }}
        rows={4}
        placeholder="Toplantı notu, mesaj, günlük girdisi…"
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', overflowWrap: 'anywhere' }}>
        Eklenecek yer: {targetPath}{!noteKnown && fileContents[targetPath] === undefined ? ' (yeni oluşturulur)' : ''}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
        <button type="button" disabled={!canRun} onClick={run} style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none', opacity: canRun ? 1 : 0.5 }}>
          <Sparkles size={13} /> {state === 'loading' ? 'Okunuyor…' : 'Görevleri çıkar'}
        </button>
      </div>

      {state === 'error' && <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}
      {state === 'saved' && <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#22c55e', overflowWrap: 'anywhere' }}>{chosen.length} görev eklendi: {target}</div>}
      {state === 'ready' && (
        items.length === 0 ? (
          <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--text-muted)' }}>Yeni görev bulunamadı (zaten notta olanlar atlanır).</div>
        ) : (
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {items.map((it, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  <input type="checkbox" checked={!off.has(i)} onChange={() => toggle(i)} style={{ marginTop: '3px', flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {it.text}
                    {it.due && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{it.due}</span>}
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
              {onSaveNote && (
                <button type="button" disabled={chosen.length === 0} onClick={save} style={{ ...btn, opacity: chosen.length ? 1 : 0.5 }}>
                  <Check size={13} /> {chosen.length} görevi ekle
                </button>
              )}
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Yapay zekâ hata yapabilir; eklemeden önce kontrol edin.</span>
            </div>
          </div>
        )
      )}
    </div>
  );
}
