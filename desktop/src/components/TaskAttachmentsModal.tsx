import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Paperclip, Trash2, FileText, Upload } from 'lucide-react';
import { platform } from '../services/platform';
import { isImagePath, MAX_ATTACHMENT_BYTES, type Attachment } from '../services/taskAttachments';

const overlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};
const panel: React.CSSProperties = {
  width: 'min(640px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};

// Pano/sürükleme ile gelen dosyaların adı çoğu zaman "image.png"dir; anlamlı bir ad verilir.
const nameClipboardFile = (f: File, i: number): File => {
  if (!/^image\.(png|jpe?g)$/i.test(f.name)) return f;
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const ext = (f.name.split('.').pop() || 'png').toLowerCase();
  return new File([f], `ekran-goruntusu-${hm}${i ? `-${i + 1}` : ''}.${ext}`, { type: f.type });
};

// Göreve ekler: dosya seç, sürükle-bırak ya da Ctrl+V ile ekran görüntüsü yapıştır. Resimler küçük önizlemeyle görünür.
// Dosyalar notlar kasasında "Ekler/<proje>/<görev>/" altında saklanır; Claude görevi başlatınca bunları okuyabilir.
export default function TaskAttachmentsModal({ taskTitle, attachments, onAdd, onRemove, onClose }: {
  taskTitle: string;
  attachments: Attachment[];
  onAdd: (files: File[]) => Promise<string | null>;
  onRemove: (a: Attachment) => Promise<void>;
  onClose: () => void;
}) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Ekleme sürerken gelen dosyalar kaybolmaz: sıraya alınır ve sırayla işlenir (aynı not satırı üzerinde yarış olmasın).
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const add = (files: File[]): Promise<void> => {
    if (files.length === 0) return Promise.resolve();
    pending.current += 1;
    setBusy(true);
    const named = files.map(nameClipboardFile);
    chain.current = chain.current.then(async () => {
      try { const err = await onAdd(named); setError(err || ''); }
      catch (e: any) { setError(String(e?.message || e)); }
      finally { pending.current -= 1; if (pending.current === 0) setBusy(false); }
    });
    return chain.current;
  };

  // Ctrl+V: panodaki dosya/resim eklenir (ekran görüntüsü alıp doğrudan yapıştırabilirsiniz).
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) { e.preventDefault(); void addRef.current(files); }
    };
    document.addEventListener('paste', h);
    return () => document.removeEventListener('paste', h);
  }, []);

  // Resim önizlemeleri (en çok 12): dosya okunur, veri adresine çevrilir.
  useEffect(() => {
    let alive = true;
    attachments.filter(a => isImagePath(a.path) && previews[a.path] === undefined).slice(0, 12).forEach(a => {
      platform.readMedia(a.path).then(d => { if (alive) setPreviews(p => ({ ...p, [a.path]: d || '' })); }).catch(() => { if (alive) setPreviews(p => ({ ...p, [a.path]: '' })); });
    });
    return () => { alive = false; };
  }, [attachments]);

  const download = async (a: Attachment) => {
    try {
      const d = await platform.readMedia(a.path);
      if (!d) { setError('Dosya okunamadı (henüz senkronize olmamış olabilir).'); return; }
      const link = document.createElement('a');
      link.href = d; link.download = a.name; link.click();
    } catch (e: any) { setError(String(e?.message || e)); }
  };

  return createPortal(
    <div style={overlay}>
      <div
        style={{ ...panel, outline: over ? '2px dashed var(--accent-color)' : 'none' }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add(Array.from(e.dataTransfer.files)); }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Paperclip size={16} /> Görev ekleri</h3>
            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '4px', overflowWrap: 'anywhere' }}>{taskTitle}</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '5px 8px' }} title="Kapat"><X size={14} /></button>
        </div>

        <div style={{ marginTop: '14px', border: '1px dashed var(--border-color)', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
          <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} onClick={() => input.current?.click()}>
            <Upload size={14} /> {busy ? 'Ekleniyor…' : 'Dosya seç'}
          </button>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.5 }}>
            ya da dosyayı buraya sürükleyin · ekran görüntüsünü <b>Ctrl+V</b> ile yapıştırın<br />
            Resim, PDF, metin/log, Word/Excel olabilir (en çok {MAX_ATTACHMENT_BYTES / 1048576} MB; çalıştırılabilir dosyalar eklenemez)
          </div>
          <input ref={input} type="file" multiple style={{ display: 'none' }} onChange={(e) => { void add(Array.from(e.target.files || [])); e.target.value = ''; }} />
        </div>

        {error && <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}

        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {attachments.length === 0 && <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Bu görevde henüz ek yok.</div>}
          {attachments.map(a => (
            <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '8px 10px' }}>
              {isImagePath(a.path) && previews[a.path] ? (
                <img src={previews[a.path]} alt={a.name} onClick={() => setBig(previews[a.path])} style={{ width: '64px', height: '48px', objectFit: 'cover', borderRadius: '6px', cursor: 'zoom-in', flexShrink: 0 }} />
              ) : (
                <div style={{ width: '64px', height: '48px', borderRadius: '6px', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}><FileText size={20} /></div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '13px', overflowWrap: 'anywhere' }}>{a.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{a.path}</div>
              </div>
              {!isImagePath(a.path) && <button type="button" style={{ ...btn, padding: '5px 9px' }} onClick={() => void download(a)}>Kaydet</button>}
              <button type="button" style={{ ...btn, padding: '5px 8px' }} title="Eki kaldır (dosya da silinir)" onClick={() => { if (window.confirm(`"${a.name}" eki kaldırılsın mı? Dosya da silinir.`)) void onRemove(a).catch((e: any) => setError(String(e?.message || e))); }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button type="button" style={btn} onClick={onClose}>Kapat</button>
        </div>
      </div>
      {big && (
        <div onClick={() => setBig(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2400, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', cursor: 'zoom-out' }}>
          <img src={big} alt="Önizleme" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' }} />
        </div>
      )}
    </div>,
    document.body
  );
}
