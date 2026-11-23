import React, { useMemo, useState } from 'react';
import { Check, Circle, CircleDot } from 'lucide-react';

// Günlük notu ham metin yerine kartlar olarak gösterir (salt okunur). Düzenleme için üstteki "Metin" kipi
// kullanılır; böylece görev satırındaki etiketler ([due:], [started:]...) kullanıcıya hiç görünmez ama dosyaya dokunulmaz.
interface Card { status: ' ' | 'x' | '/'; title: string; slug?: string; planned?: string; started?: string; completed?: string; body: { text: string; depth: number }[] }
interface Parsed { heading?: string; cards: Card[]; free: string[] }

const TAG_RE = /\[([a-zA-Zçğıöşü]+):([^\]]*)\]/g;
// Kartlarda ham işaretler görünmesin: **kalın**, *italik*, ==vurgu==, [[bağlantı]] yalnızca metin olarak gösterilir.
const plain = (t: string): string => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/==(?:[^:=]{1,10}:)?(.+?)==/g, '$1').replace(/\*(\S[^*]*?)\*/g, '$1').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1');
const hm = (iso: string): string | null => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const parseDayNote = (content: string): Parsed => {
  const out: Parsed = { cards: [], free: [] };
  let cur: Card | null = null;
  for (const raw of content.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    if (/^#\s/.test(raw) && !out.heading) { out.heading = raw.replace(/^#+\s*/, '').trim(); continue; }
    const m = raw.match(/^- \[([ xX/])\]\s+(.*)$/);
    if (m) {
      const tags: Record<string, string> = {};
      const title = m[2].replace(TAG_RE, (_, k: string, v: string) => { tags[k.toLowerCase()] = v.trim(); return ''; }).replace(/\s{2,}/g, ' ').trim();
      cur = { status: m[1].toLowerCase() as Card['status'], title, slug: tags.project, planned: tags.plannedtime, started: tags.started, completed: tags.completed, body: [] };
      out.cards.push(cur);
      continue;
    }
    const indent = (raw.match(/^\s*/) || [''])[0].length;
    if (cur && (indent > 0 || /^-\s/.test(raw))) {
      const text = raw.trim().replace(/^[-*]\s+(\[[ xX/]\]\s+)?/, '').replace(TAG_RE, '').trim();
      if (text) cur.body.push({ text, depth: indent >= 8 ? 1 : 0 });
      continue;
    }
    cur = null;
    if (/^\[durum:[^\]]*\]$/.test(raw.trim())) continue; // uygulamanın iç işareti, kullanıcıya gösterilmez
    out.free.push(raw.trim());
  }
  return out;
};

const timeText = (c: Card): string => {
  const a = c.started ? hm(c.started) : null, b = c.completed ? hm(c.completed) : null;
  if (a && b) {
    const mins = Math.round((new Date(c.completed!).getTime() - new Date(c.started!).getTime()) / 60000);
    return `${a}–${b}${mins > 0 && mins < 14 * 60 ? ` · ${mins >= 60 ? `${Math.floor(mins / 60)} sa ${mins % 60 ? `${mins % 60} dk` : ''}`.trim() : `${mins} dk`}` : ''}`;
  }
  return c.planned ? `${c.planned.replace('-', '–')} (plan)` : '';
};

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#f97316'];
const colorOf = (slug?: string): string => {
  if (!slug) return 'var(--border-color)';
  let h = 0; for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const prettySlug = (s: string) => s.split('-').map(w => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1)).join(' ');

// Uzun kartlar ilk 4 satırla görünür; "daha fazla" ile açılır (günlük notta bir iş 20 satıra çıkabiliyor).
function CardBody({ body }: { body: Card['body'] }) {
  const [all, setAll] = useState(false);
  if (body.length === 0) return null;
  const shown = all ? body : body.slice(0, 4);
  return (
    <div style={{ marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {shown.map((b, j) => (
        <div key={j} style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)', paddingLeft: b.depth ? '14px' : 0, overflowWrap: 'anywhere' }}>{plain(b.text)}</div>
      ))}
      {body.length > 4 && (
        <button type="button" onClick={() => setAll(!all)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '2px 0', color: 'var(--accent-color, #6366f1)', fontSize: '11.5px', cursor: 'pointer', fontFamily: 'inherit' }}>
          {all ? 'Daha az göster' : `+${body.length - 4} satır daha`}
        </button>
      )}
    </div>
  );
}

export default function DayNoteCards({ content, clientBySlug, query }: { content: string; clientBySlug: (slug: string) => string | undefined; query: string }) {
  const parsed = useMemo(() => parseDayNote(content), [content]);
  const q = query.trim().toLocaleLowerCase('tr');
  const cards = q ? parsed.cards.filter(c => (c.title + ' ' + c.body.map(b => b.text).join(' ')).toLocaleLowerCase('tr').includes(q)) : parsed.cards;
  const free = q ? parsed.free.filter(l => l.toLocaleLowerCase('tr').includes(q)) : parsed.free;
  const done = parsed.cards.filter(c => c.status === 'x').length;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 2px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--text-secondary)' }}>
        {parsed.heading && <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{parsed.heading}</span>}
        {parsed.cards.length > 0 && <span style={{ background: 'rgba(34,197,94,0.14)', color: '#22c55e', borderRadius: '999px', padding: '1px 8px', fontSize: '11px' }}>{done}/{parsed.cards.length} bitti</span>}
      </div>
      {cards.length === 0 && free.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '14px 4px' }}>{q ? 'Eşleşen kayıt yok.' : 'Bu günde henüz kayıt yok. "Metin" kipinde yazmaya başlayın.'}</div>
      )}
      {cards.map((c, i) => {
        const client = c.slug ? clientBySlug(c.slug) : undefined;
        const accent = colorOf(c.slug);
        const isDone = c.status === 'x';
        const t = timeText(c);
        return (
          <div key={i} style={{ border: '1px solid var(--border-color)', borderLeft: `3px solid ${accent}`, borderRadius: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ marginTop: '2px', color: isDone ? '#22c55e' : c.status === '/' ? '#f59e0b' : 'var(--text-muted)', flex: 'none' }}>
                {isDone ? <Check size={14} /> : c.status === '/' ? <CircleDot size={14} /> : <Circle size={14} />}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, overflowWrap: 'anywhere', color: isDone ? 'var(--text-secondary)' : 'var(--text-primary)', textDecoration: isDone ? 'line-through' : 'none', textDecorationColor: 'rgba(255,255,255,0.25)' }}>{plain(c.title) || '(başlıksız)'}</span>
                </div>
                {(t || c.slug) && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {t && <span>{t}</span>}
                    {c.slug && <span style={{ color: accent }}>{client ? `${client} › ` : ''}{prettySlug(c.slug)}</span>}
                  </div>
                )}
                <CardBody body={c.body} />
              </div>
            </div>
          </div>
        );
      })}
      {free.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {free.map((l, i) => /^#{1,6}\s/.test(l)
            ? <div key={i} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>{plain(l.replace(/^#+\s*/, ''))}</div>
            : <div key={i} style={{ fontSize: '12px', lineHeight: 1.55, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{plain(l)}</div>)}
        </div>
      )}
    </div>
  );
}
