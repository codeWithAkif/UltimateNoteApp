import React from 'react';
import { type Budget, type Cashflow, totals, fmtTL, analizByCat, SPEND_CATS, CUTTABLE_CATS } from '../services/budget';

const GREEN = '#22c55e', RED = '#ef4444', ORANGE = '#f97316', BLUE = '#3b82f6', PURPLE = '#a855f7', GRAY = '#94a3b8';
const short = (s: string, n = 11) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const k = (n: number) => Math.round(n).toLocaleString('tr-TR');

// Şelale grafiği: gelirden başlayıp sabit giderler, her kart, değişken harcamalar ve beklenmeyenler payı düşülür; sonda KALAN.
export function Waterfall({ b }: { b: Budget }) {
  const t = totals(b);
  type Step = { label: string; value: number; color: string; total?: boolean };
  const steps: Step[] = [];
  steps.push({ label: 'Gelir', value: t.gelir, color: GREEN });
  if (t.sabit > 0) steps.push({ label: 'Sabit', value: -t.sabit, color: RED });
  b.items.filter(i => i.kind === 'kart').forEach(c => steps.push({ label: c.name, value: -c.amount, color: ORANGE }));
  if (t.degisken > 0) steps.push({ label: 'Değişken', value: -t.degisken, color: PURPLE });
  if (t.reserve > 0) steps.push({ label: 'Beklenmeyen', value: -t.reserve, color: GRAY });
  steps.push({ label: 'Kalan', value: t.kalan, color: t.kalan >= 0 ? BLUE : RED, total: true });

  // kümülatif düzeyler
  let level = 0;
  const bars = steps.map(s => {
    const from = s.total ? 0 : level;
    const to = s.total ? s.value : level + s.value;
    if (!s.total) level = to;
    return { ...s, lo: Math.min(from, to), hi: Math.max(from, to) };
  });
  const maxY = Math.max(1, ...bars.map(x => x.hi));
  const minY = Math.min(0, ...bars.map(x => x.lo));
  const W = 640, H = 270, padL = 8, padR = 8, padT = 22, padB = 44;
  const plotH = H - padT - padB;
  const y = (v: number) => padT + (maxY - v) / (maxY - minY || 1) * plotH;
  const slot = (W - padL - padR) / bars.length;
  const bw = Math.min(56, slot * 0.7);

  if (t.gelir === 0 && bars.length <= 2 && t.kalan === 0) return <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>Gelir ve gider ekledikçe grafik burada oluşur.</div>;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Gelirden kalana şelale grafiği">
      <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--border-color)" strokeWidth="1" />
      {bars.map((bar, i) => {
        const x = padL + slot * i + (slot - bw) / 2;
        const top = y(bar.hi), bot = y(bar.lo);
        const h = Math.max(2, bot - top);
        return (
          <g key={i}>
            <rect x={x} y={top} width={bw} height={h} rx={4} fill={bar.color} opacity={bar.total ? 1 : 0.9} />
            <text x={x + bw / 2} y={top - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text-primary)">{bar.value < 0 ? '−' : ''}{k(Math.abs(bar.value))}</text>
            <text x={x + bw / 2} y={H - padB + 16} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">{short(bar.label)}</text>
            <title>{bar.label}: {fmtTL(bar.value)}</title>
          </g>
        );
      })}
    </svg>
  );
}

// Ekstre harcama dağılımı: önce kategori genelinde (çubuk), kategoriye tıklayınca tek tek harcamalar; "Tüm harcamalar" düz liste + arama.
// Her harcamanın kategorisi elle değiştirilebilir (özellikle "Diğer"); onRecat işletmeyi hatırlatır.
const selStyle: React.CSSProperties = { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '3px 4px', fontSize: '11.5px', maxWidth: '124px' };
const chip = (on: boolean): React.CSSProperties => ({ background: on ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: on ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '999px', padding: '3px 11px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 });

export function SpendBars({ b, onRecat }: { b: Budget; onRecat: (idx: number, cat: string) => void }) {
  const [mode, setMode] = React.useState<'kat' | 'liste'>('kat');
  const [sel, setSel] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [limit, setLimit] = React.useState(40);
  const all = b.analiz || [];
  if (!all.length) return null;
  const cats = analizByCat(b);
  const total = cats.reduce((s, c) => s + c.tutar, 0);
  const cut = cats.filter(c => c.kisilabilir).reduce((s, c) => s + c.tutar, 0);
  const maxCat = Math.max(1, ...cats.map(c => c.tutar));
  const ql = q.trim().toLocaleLowerCase('tr');
  const list = all.map((r, idx) => ({ r, idx }))
    .filter(({ r }) => (mode === 'liste' || (sel !== null && r.kategori === sel)) && (!ql || `${r.ad || ''} ${r.kategori} ${r.kart}`.toLocaleLowerCase('tr').includes(ql)))
    .sort((x, y) => y.r.tutar - x.r.tutar);
  const maxTx = Math.max(1, ...list.map(x => x.r.tutar));
  const selCat = sel ? cats.find(c => c.kategori === sel) : undefined;

  const txRow = ({ r, idx }: { r: (typeof all)[number]; idx: number }) => (
    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
      <div style={{ width: '150px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${r.ad || '(ad yok)'} · ${r.kart}`}>
        {r.ad || '(ad yok)'}{mode === 'liste' || cats.length > 1 ? <span style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}> · {r.kart}</span> : null}
      </div>
      <div style={{ flex: 1, background: 'var(--bg-tertiary)', borderRadius: '4px', height: '12px', overflow: 'hidden', minWidth: '30px' }}>
        <div style={{ width: `${Math.max(2, r.tutar / maxTx * 100)}%`, height: '100%', background: CUTTABLE_CATS.has(r.kategori) ? ORANGE : GRAY, opacity: 0.9 }} />
      </div>
      <div style={{ width: '84px', textAlign: 'right', fontWeight: 600 }}>{fmtTL(r.tutar)}</div>
      <select value={r.kategori} onChange={(e) => onRecat(idx, e.target.value)} style={selStyle} aria-label={`${r.ad || 'Harcama'} kategorisi`} title="Kategoriyi değiştir (aynı işletmenin hepsi değişir ve hatırlanır)">
        {SPEND_CATS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Ekstrelerdeki dönem harcaması <b>{fmtTL(total)}</b> · kısılabilir <b style={{ color: ORANGE }}>{fmtTL(cut)}</b> · kısılamayan (taksit, fatura, sağlık vb.) <b>{fmtTL(total - cut)}</b>
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" style={chip(mode === 'kat')} onClick={() => { setMode('kat'); setSel(null); setLimit(40); }}>Kategoriler</button>
        <button type="button" style={chip(mode === 'liste')} onClick={() => { setMode('liste'); setSel(null); setLimit(40); }}>Tüm harcamalar ({all.length})</button>
        {(mode === 'liste' || sel !== null) && (
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(40); }} placeholder="Ara (işletme, kategori, kart)" aria-label="Harcamalarda ara"
            style={{ ...selStyle, maxWidth: 'none', flex: 1, minWidth: '120px', padding: '4px 8px', fontSize: '12px' }} />
        )}
      </div>

      {mode === 'kat' && sel === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {cats.map(c => (
            <button key={c.kategori} type="button" onClick={() => { setSel(c.kategori); setQ(''); setLimit(40); }} title={c.ornek ? `örn. ${c.ornek} — tıklayınca harcamalar açılır` : 'Tıklayınca harcamalar açılır'}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>
              <div style={{ width: '128px', flexShrink: 0, color: 'var(--text-primary)' }}>{c.kategori} <span style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>({c.adet})</span></div>
              <div style={{ flex: 1, background: 'var(--bg-tertiary)', borderRadius: '4px', height: '14px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(2, c.tutar / maxCat * 100)}%`, height: '100%', background: c.kisilabilir ? ORANGE : GRAY, opacity: 0.9 }} />
              </div>
              <div style={{ width: '86px', textAlign: 'right', fontWeight: 600 }}>{fmtTL(c.tutar)}</div>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
            </button>
          ))}
        </div>
      )}

      {mode === 'kat' && sel !== null && (
        <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' }}>
          <button type="button" style={chip(false)} onClick={() => { setSel(null); setQ(''); }}>‹ Tüm kategoriler</button>
          <b>{sel}</b>{selCat ? <span style={{ color: 'var(--text-secondary)' }}>· {fmtTL(selCat.tutar)} · {selCat.adet} harcama</span> : <span style={{ color: 'var(--text-muted)' }}>· bu kategoride harcama kalmadı</span>}
        </div>
      )}

      {(mode === 'liste' || sel !== null) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {list.slice(0, limit).map(txRow)}
          {list.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Eşleşen harcama yok.</div>}
          {list.length > limit && <button type="button" style={{ ...chip(false), alignSelf: 'flex-start' }} onClick={() => setLimit(l => l + 60)}>Daha fazla göster ({list.length - limit})</button>}
        </div>
      )}
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>Bilgi amaçlıdır: bu tutarlar kart ekstresinin içindedir, ayrıca toplanmaz. Kategorisi yanlış olan harcamayı sağdaki listeden değiştirin; aynı işletme hatırlanır.</div>
    </div>
  );
}

// Nakit takvimi: ay içinde gün gün bakiye. Eksiye düşen günler kırmızı, en düşük nokta işaretli.
export function CashChart({ cf }: { cf: Cashflow }) {
  const pts = cf.points;
  const n = pts.length;
  const vals = pts.map(p => p.balance);
  const maxV = Math.max(1, ...vals), minV = Math.min(0, ...vals);
  const W = 640, H = 230, padL = 8, padR = 8, padT = 24, padB = 26;
  const x = (d: number) => padL + (d - 1) / Math.max(1, n - 1) * (W - padL - padR);
  const y = (v: number) => padT + (maxV - v) / (maxV - minV || 1) * (H - padT - padB);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const zero = y(0);
  const area = `${line} L${x(n).toFixed(1)},${zero.toFixed(1)} L${x(1).toFixed(1)},${zero.toFixed(1)} Z`;
  const minP = cf.min;
  const hasEvents = pts.filter(p => p.events.length > 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Ay içi nakit takvimi">
      <defs>
        <clipPath id="cf-pos"><rect x="0" y="0" width={W} height={Math.max(0, zero)} /></clipPath>
        <clipPath id="cf-neg"><rect x="0" y={zero} width={W} height={Math.max(0, H - zero)} /></clipPath>
      </defs>
      <path d={area} fill={GREEN} opacity="0.22" clipPath="url(#cf-pos)" />
      <path d={area} fill={RED} opacity="0.28" clipPath="url(#cf-neg)" />
      <line x1={padL} x2={W - padR} y1={zero} y2={zero} stroke="var(--border-color)" strokeWidth="1" strokeDasharray="4 3" />
      <path d={line} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
      {hasEvents.map(p => (
        <g key={p.day}>
          <circle cx={x(p.day)} cy={y(p.balance)} r={3} fill="var(--text-primary)" opacity="0.8"><title>Gün {p.day}: {p.events.join(' · ')}</title></circle>
        </g>
      ))}
      <circle cx={x(minP.day)} cy={y(minP.balance)} r={5} fill={minP.balance < 0 ? RED : ORANGE} />
      <text x={Math.min(Math.max(x(minP.day), 60), W - 60)} y={Math.min(H - padB - 6, y(minP.balance) + 18)} textAnchor="middle" fontSize="11" fontWeight="700" fill={minP.balance < 0 ? RED : 'var(--text-primary)'}>en düşük: {fmtTL(minP.balance)} ({minP.day}. gün)</text>
      {[1, 5, 10, 15, 20, 25, n].filter((d, i, a) => d <= n && a.indexOf(d) === i).map(d => (
        <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">{d}</text>
      ))}
    </svg>
  );
}
