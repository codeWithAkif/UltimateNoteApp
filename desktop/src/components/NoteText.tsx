import React from 'react';

// Not metni (yalnızca okunur): başlık, madde ve görev işaretleri hafifçe biçimlenir. Not uzayı panelinde ve Çalışma masasında ortak.
export default function NoteText({ text, big }: { text: string; big?: boolean }) {
  const body = text.replace(/^---[\s\S]*?---\s*/, '');
  const f = big ? 1.25 : 1;
  return (
    <div style={{ fontSize: 13 * f, lineHeight: 1.55 }}>
      {body.split(/\r?\n/).map((ln, i) => {
        const h = /^(#{1,6})\s+(.*)/.exec(ln);
        if (h) return <div key={i} style={{ fontWeight: 600, fontSize: (h[1].length === 1 ? 18 : h[1].length === 2 ? 15.5 : 14) * f, margin: '10px 0 4px', color: '#e8fbff' }}>{h[2]}</div>;
        const t = /^(\s*)- \[([ xX])\]\s*(.*)/.exec(ln);
        if (t) return <div key={i} style={{ paddingLeft: t[1].length * 6, display: 'flex', gap: 7, opacity: t[2] === ' ' ? 1 : 0.55 }}><span>{t[2] === ' ' ? '☐' : '☑'}</span><span style={{ textDecoration: t[2] === ' ' ? 'none' : 'line-through' }}>{t[3]}</span></div>;
        const b = /^(\s*)[-*]\s+(.*)/.exec(ln);
        if (b) return <div key={i} style={{ paddingLeft: b[1].length * 6 + 4, display: 'flex', gap: 7 }}><span style={{ opacity: 0.6 }}>•</span><span>{b[2]}</span></div>;
        return <div key={i} style={{ minHeight: ln.trim() ? undefined : 8, overflowWrap: 'anywhere' }}>{ln}</div>;
      })}
    </div>
  );
}
