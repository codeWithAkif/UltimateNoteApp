import React from 'react';
import { LayoutGrid, Check } from 'lucide-react';
import { useDesk, toggleDesk, DESK_MAX, type DeskKind } from '../services/studyDesk';

// "Masaya al" düğmesi: not, kitap, dil metni ya da ezber destesini çalışma masasına ekler/çıkarır. Her ekranda aynı görünür.
export default function DeskButton({ path, kind = 'note', compact = false, style }: { path: string; kind?: DeskKind; compact?: boolean; style?: React.CSSProperties }) {
  const items = useDesk();
  const on = items.some(x => x.path === path);
  const full = !on && items.length >= DESK_MAX;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); toggleDesk(path, kind); }} disabled={full}
      title={on ? 'Çalışma masasından çıkar' : full ? `Masa dolu (en fazla ${DESK_MAX} öğe)` : 'Çalışma masasına al (Ctrl+Shift+M ile masayı açın)'}
      aria-label={on ? 'Masadan çıkar' : 'Masaya al'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: full ? 'default' : 'pointer', padding: compact ? '3px 7px' : '5px 10px', fontSize: 12, borderRadius: 8, border: '1px solid var(--border-color, #8884)', background: on ? 'var(--accent, #6366f1)' : 'transparent', color: on ? '#fff' : 'inherit', opacity: full ? 0.5 : 1, ...style }}>
      {on ? <Check size={13} /> : <LayoutGrid size={13} />}{compact ? null : <span>{on ? 'Masada' : 'Masaya al'}</span>}
    </button>
  );
}
