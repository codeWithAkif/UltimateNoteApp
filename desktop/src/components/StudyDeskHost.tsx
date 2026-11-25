import React, { Suspense, useEffect, useState } from 'react';
import { OPEN_DESK_EVENT, useDesk } from '../services/studyDesk';

const StudyTable = React.lazy(() => import('./StudyTable'));

// Çalışma masasını Not uzayına gitmeden açar: kenar çubuğu/düğmeler `openStudyDesk()` çağırır, Ctrl+Shift+M de açar.
// Masa tam ekran üst katmandır; Esc ya da "Kapat" ile kapanır.
export default function StudyDeskHost({ files, onOpenNote }: { files: Record<string, string>; onOpenNote: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const items = useDesk();
  useEffect(() => {
    const show = () => setOpen(true);
    const key = (e: KeyboardEvent) => { if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); setOpen(v => !v); } };
    window.addEventListener(OPEN_DESK_EVENT, show); window.addEventListener('keydown', key);
    return () => { window.removeEventListener(OPEN_DESK_EVENT, show); window.removeEventListener('keydown', key); };
  }, []);
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483000 }}>
      <Suspense fallback={<div style={{ position: 'absolute', inset: 0, background: '#04090f', color: '#7fdcff', display: 'grid', placeItems: 'center' }}>Masa hazırlanıyor…</div>}>
        <StudyTable files={files} items={items} backLabel="Kapat" onBack={close} onClose={close} onOpenInApp={(p) => { close(); onOpenNote(p); }} />
      </Suspense>
    </div>
  );
}
