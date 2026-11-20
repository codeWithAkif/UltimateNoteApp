import React, { useMemo, useState } from 'react';
import { Flame, Award, CreditCard, Repeat, Calculator, ClipboardList, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { type Budget, fmtTL, parseTL, monthLabel } from '../services/budget';
import {
  loadMonths, installmentPlan, debtSeries, canAfford, findSubscriptions, parseSubState, serializeSubState, scorecard, SUB_PATH, type SubState, type AffordResult
} from '../services/insights';

const panel: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px' };
const field: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px',
  padding: '6px 8px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '6px 11px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};
const btnSm: React.CSSProperties = { ...btn, padding: '2px 8px', fontSize: '11.5px', fontWeight: 500 };
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)' };
const muted: React.CSSProperties = { fontSize: '11.5px', color: 'var(--text-muted)' };
const GREEN = '#22c55e', RED = '#ef4444', ORANGE = '#f97316', BLUE = '#3b82f6', GRAY = '#94a3b8';
const k = (n: number) => `${Math.round(n / 100) / 10}k`;
const mShort = (m: string) => { const [y, mm] = m.split('-'); return `${['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'][Number(mm) - 1]} ${y.slice(2)}`; };

// Basit çubuk grafik: her çubuk bir ay; ikinci değer (varsa) alt kısımda koyu pay olarak gösterilir
function Bars({ data, color = ORANGE, color2 = BLUE, h = 150 }: { data: { label: string; v: number; v2?: number }[]; color?: string; color2?: string; h?: number }) {
  const W = 560, padT = 18, padB = 22, plotH = h - padT - padB;
  const max = Math.max(1, ...data.map(d => d.v));
  const slot = W / Math.max(1, data.length), bw = Math.min(46, slot * 0.7);
  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Aylık tutarlar">
      <line x1={0} x2={W} y1={padT + plotH} y2={padT + plotH} stroke="var(--border-color)" />
      {data.map((d, i) => {
        const x = i * slot + (slot - bw) / 2, bh = d.v / max * plotH, y = padT + plotH - bh;
        const bh2 = d.v2 ? Math.min(bh, d.v2 / max * plotH) : 0;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(1, bh)} rx={3} fill={color} opacity={0.9}><title>{d.label}: {fmtTL(d.v)}</title></rect>
            {bh2 > 0 && <rect x={x} y={padT + plotH - bh2} width={bw} height={bh2} rx={3} fill={color2} opacity={0.95}><title>taksitli kısım: {fmtTL(d.v2!)}</title></rect>}
            <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--text-primary)">{d.v > 0 ? k(d.v) : '0'}</text>
            <text x={x + bw / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

type Tab = 'taksit' | 'alabilir' | 'abonelik' | 'karne';

export default function BudgetInsights({ fileContents, budget, onSaveNote }: {
  fileContents: Record<string, string>;
  budget: Budget;
  onSaveNote?: (path: string, content: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>('taksit');
  const months = useMemo(() => loadMonths(fileContents), [fileContents]);
  const loaded = Object.keys(fileContents).length > 0; // notlar yüklenmeden karar notu yazılmaz (yüklenmemiş notun ezilmesini önler)
  const tabBtn = (t: Tab): React.CSSProperties => ({ ...btn, background: tab === t ? 'var(--accent-color)' : 'var(--bg-hover)', color: tab === t ? '#fff' : 'var(--text-secondary)', border: '1px solid ' + (tab === t ? 'var(--accent-color)' : 'var(--border-color)') });

  // ---- taksit & borç
  const plan = useMemo(() => installmentPlan(months), [months]);
  const debt = useMemo(() => debtSeries(months), [months]);

  // ---- alabilir miyim
  const [tutarS, setTutarS] = useState('');
  const [taksit, setTaksit] = useState(6);
  const [yontem, setYontem] = useState<'kart' | 'nakit'>('kart');
  const tutar = parseTL(tutarS) ?? 0;
  const afford: AffordResult | null = useMemo(() => (tutar > 0 ? canAfford(budget, { tutar, taksit, yontem }) : null), [budget, tutar, taksit, yontem]);

  // ---- abonelikler
  const subs = useMemo(() => findSubscriptions(months), [months]);
  const subState = useMemo(() => parseSubState(fileContents[SUB_PATH]), [fileContents]);
  const setSub = (key: string, v: SubState | null) => {
    if (!loaded || !onSaveNote) return;
    const next = { ...parseSubState(fileContents[SUB_PATH]) };
    if (v) next[key] = v; else delete next[key];
    void onSaveNote(SUB_PATH, serializeSubState(next));
  };
  const active = subs.filter(s => subState[s.key] !== 'iptal');
  const cancelled = subs.filter(s => subState[s.key] === 'iptal');
  const aylikToplam = active.reduce((s, x) => s + x.aylik, 0);

  // ---- karne
  const card = useMemo(() => scorecard(months), [months]);

  const verdictUi = (v: AffordResult['verdict']) => v === 'olur' ? { c: GREEN, t: 'Olur', I: CheckCircle2 } : v === 'dikkat' ? { c: ORANGE, t: 'Dikkat', I: AlertTriangle } : { c: RED, t: 'Olmaz', I: XCircle };

  return (
    <div style={{ ...panel, marginTop: '14px' }}>
      <div style={{ ...label, marginBottom: '8px' }}>Kartsız yaşam kokpiti</div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <button type="button" style={tabBtn('taksit')} onClick={() => setTab('taksit')}><CreditCard size={13} /> Taksit &amp; Borç</button>
        <button type="button" style={tabBtn('alabilir')} onClick={() => setTab('alabilir')}><Calculator size={13} /> Alabilir miyim?</button>
        <button type="button" style={tabBtn('abonelik')} onClick={() => setTab('abonelik')}><Repeat size={13} /> Abonelikler</button>
        <button type="button" style={tabBtn('karne')} onClick={() => setTab('karne')}><ClipboardList size={13} /> Karne</button>
      </div>

      {/* ===== TAKSİT & BORÇ ===== */}
      {tab === 'taksit' && (
        <div>
          {plan.items.length === 0 ? (
            <div style={muted}>Taksit bilgisi olan ekstre henüz yok. Ekstre PDF'i eklediğinizde taksitli işlemler (örn. "2/3 taksit") otomatik bulunur ve burada takvim olarak görünür.</div>
          ) : (
            <>
              <div style={{ fontSize: '12.5px', lineHeight: 1.6, marginBottom: '8px' }}>
                Önümüzdeki aylarda ödeyeceğiniz toplam taksit <b>{fmtTL(plan.kalanToplam)}</b>.{plan.bosAy && <> Taksitsiz ilk ay: <b>{monthLabel(plan.bosAy)}</b>.</>}
              </div>
              <Bars data={plan.yuk.map(y => ({ label: mShort(y.month), v: y.toplam }))} />
              <div style={{ ...muted, margin: '6px 0 4px' }}>Aylık taksit yükü (ay ay)</div>
              {plan.hafifleme.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '8px 0' }}>
                  {plan.hafifleme.map(h => (
                    <div key={h.month} style={{ fontSize: '12.5px' }}><b style={{ color: GREEN }}>↓ {fmtTL(h.azalan)}</b> {monthLabel(h.month)}'da hafifler{h.neden.length ? <span style={muted}> · {h.neden.join(', ')} biter</span> : null}</div>
                  ))}
                </div>
              )}
              <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '6px' }}>
                {plan.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12.5px', padding: '3px 0', flexWrap: 'wrap' }}>
                    <span style={{ flex: '1 1 160px', overflowWrap: 'anywhere' }}>{it.ad} <span style={muted}>· {it.kart}</span></span>
                    <span style={{ whiteSpace: 'nowrap' }}>{fmtTL(it.tutar)}/ay · {it.no}/{it.toplam}</span>
                    <span style={{ ...muted, whiteSpace: 'nowrap' }}>son: {monthLabel(it.sonAy)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ marginTop: '12px', ...label }}>Kart borcu eğrisi</div>
          {debt.length >= 2 ? (
            <>
              <Bars data={debt.map(d => ({ label: mShort(d.month), v: d.kart, v2: d.taksit }))} color={ORANGE} color2={BLUE} />
              <div style={muted}>Turuncu: aylık kart ekstre toplamı · mavi: taksitli (kaydırılamayan) kısmı</div>
            </>
          ) : <div style={{ ...muted, marginTop: '4px' }}>Eğri, en az iki ayın ekstresi girildiğinde oluşur ({debt.length} ay var).</div>}
        </div>
      )}

      {/* ===== ALABİLİR MİYİM ===== */}
      {tab === 'alabilir' && (
        <div>
          <div style={{ ...muted, marginBottom: '8px', lineHeight: 1.55 }}>{monthLabel(budget.month)} bütçenize göre: bir alımı yapmadan önce etkisini görün. Kartsız geçiş planınızı ve ay içi bakiyenizi nasıl etkiler?</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={tutarS} onChange={(e) => setTutarS(e.target.value)} inputMode="decimal" placeholder="Tutar (₺), örn. 15999" aria-label="Alım tutarı" style={{ ...field, width: '170px' }} />
            <select value={yontem} onChange={(e) => setYontem(e.target.value as 'kart' | 'nakit')} aria-label="Ödeme yöntemi" style={field}>
              <option value="kart">Kartla</option><option value="nakit">Nakit / havale</option>
            </select>
            {yontem === 'kart' && (
              <select value={taksit} onChange={(e) => setTaksit(Number(e.target.value))} aria-label="Taksit sayısı" style={field}>
                {[1, 2, 3, 4, 6, 9, 12].map(n => <option key={n} value={n}>{n === 1 ? 'Tek çekim' : `${n} taksit`}</option>)}
              </select>
            )}
          </div>
          {!afford && <div style={{ ...muted, marginTop: '10px' }}>Bir tutar girin.</div>}
          {afford && (() => {
            const V = verdictUi(afford.verdict);
            return (
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 800, color: V.c }}><V.I size={20} /> {V.t}</div>
                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', margin: '8px 0', fontSize: '12.5px' }}>
                  <div><div style={muted}>Aylık kalan</div><b>{fmtTL(afford.kalanOnce)}</b> → <b style={{ color: afford.kalanSonra < 0 ? RED : 'inherit' }}>{fmtTL(afford.kalanSonra)}</b></div>
                  <div><div style={muted}>Ayın en düşük bakiyesi</div><b>{fmtTL(afford.minOnce)}</b> → <b style={{ color: afford.minSonra < 0 ? RED : 'inherit' }}>{fmtTL(afford.minSonra)}</b></div>
                  <div><div style={muted}>Kartsız geçiş</div><b>{afford.gecisOnce === null ? '—' : `${afford.gecisOnce} ay`}</b> → <b>{afford.gecisSonra === null ? 'mümkün değil' : `${afford.gecisSonra} ay`}</b></div>
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.6 }}>{afford.notlar.map((n, i) => <li key={i}>{n}</li>)}</ul>
                <div style={{ ...muted, marginTop: '6px' }}>Hesap bütçenizdeki gelir, sabit gider ve kart ekstrelerine dayanır; faiz hesaba katılmaz (ekstrelerinizi tam ödediğiniz varsayılır).</div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===== ABONELİKLER ===== */}
      {tab === 'abonelik' && (
        <div>
          {subs.length === 0 ? <div style={muted}>Ekstrelerde abonelik gibi görünen tekrarlayan harcama bulunamadı. Ekstre ekledikçe (Netflix, Spotify, Google, Apple, yapay zekâ üyelikleri…) burada listelenir.</div> : (
            <>
              <div style={{ fontSize: '12.5px', lineHeight: 1.6, marginBottom: '8px' }}>
                Abonelik gibi görünen harcamalar: ayda <b>{fmtTL(aylikToplam)}</b>, yılda <b>{fmtTL(aylikToplam * 12)}</b>.
                {cancelled.length > 0 && <> İptal ettikleriniz yılda <b style={{ color: GREEN }}>{fmtTL(cancelled.reduce((s, x) => s + x.yillik, 0))}</b> tasarruf ediyor.</>}
              </div>
              {active.map(s => (
                <div key={s.key} style={{ borderTop: '1px solid var(--border-color)', padding: '6px 0', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px', minWidth: 0, fontSize: '12.5px' }}><b style={{ overflowWrap: 'anywhere' }}>{s.ad}</b>
                    <div style={muted}>{fmtTL(s.aylik)}/ay · yılda {fmtTL(s.yillik)} · {s.ay} ayda görüldü{subState[s.key] === 'gerekli' ? ' · gerekli ✓' : ''}</div></div>
                  <button type="button" style={btnSm} disabled={!loaded} onClick={() => setSub(s.key, subState[s.key] === 'gerekli' ? null : 'gerekli')}>{subState[s.key] === 'gerekli' ? 'Gerekli değil' : 'Gerekli'}</button>
                  <button type="button" style={{ ...btnSm, color: GREEN }} disabled={!loaded} onClick={() => setSub(s.key, 'iptal')}>İptal ettim</button>
                </div>
              ))}
              {cancelled.map(s => (
                <div key={s.key} style={{ borderTop: '1px solid var(--border-color)', padding: '6px 0', display: 'flex', gap: '8px', alignItems: 'center', opacity: 0.7, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px', fontSize: '12.5px', textDecoration: 'line-through' }}>{s.ad} <span style={muted}>· {fmtTL(s.aylik)}/ay</span></div>
                  <span style={{ ...muted, color: GREEN }}>iptal edildi</span>
                  <button type="button" style={btnSm} disabled={!loaded} onClick={() => setSub(s.key, null)}>Geri al</button>
                </div>
              ))}
              <div style={{ ...muted, marginTop: '8px' }}>"İptal ettim" yalnızca takip içindir; aboneliği ilgili servisten siz iptal edersiniz. Listede olmayan abonelikler yanlışlıkla işaretlenmiş olabilir: kontrol edin.</div>
            </>
          )}
        </div>
      )}

      {/* ===== KARNE ===== */}
      {tab === 'karne' && (
        <div>
          {!card.ready ? (
            <div style={{ fontSize: '12.5px', lineHeight: 1.6 }}>
              <div>{card.mesaj}</div>
              {card.gelecek && card.gelecek.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  {card.gelecek.map(g => <div key={g.kategori} style={{ display: 'flex', gap: '8px', padding: '2px 0' }}><span style={{ flex: 1 }}>{g.kategori}</span><span style={muted}>{fmtTL(g.tutar)}</span><b>≤ {fmtTL(g.hedef)}</b></div>)}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12.5px', flex: 1, minWidth: '160px' }}>{monthLabel(card.prevMonth!)} → <b>{monthLabel(card.month!)}</b><div style={muted}>isteğe bağlı harcamalar</div></div>
                <div style={{ fontSize: '13px' }}><b>{fmtTL(card.toplamOnceki)}</b> → <b style={{ color: card.fark >= 0 ? GREEN : RED }}>{fmtTL(card.toplamSimdi)}</b></div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: card.fark >= 0 ? GREEN : RED }}>{card.fark >= 0 ? '↓' : '↑'} {fmtTL(Math.abs(card.fark))}</div>
              </div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', margin: '8px 0', fontSize: '12.5px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Flame size={16} color={card.seri > 0 ? ORANGE : GRAY} /> <b>{card.seri}</b> ay seri</div>
                <div>Hedefi tutan kategori: <b>{card.hedefTutan}</b>/{card.cats.length}</div>
                <div>Toplam tasarruf: <b style={{ color: card.kumulatif >= 0 ? GREEN : RED }}>{fmtTL(card.kumulatif)}</b></div>
                {card.kart && <div>Kart ekstresi: <b>{fmtTL(card.kart.onceki)}</b> → <b>{fmtTL(card.kart.simdi)}</b></div>}
              </div>
              {card.cats.map(c => (
                <div key={c.kategori} style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-color)', padding: '4px 0', fontSize: '12.5px', flexWrap: 'wrap' }}>
                  <span style={{ flex: '1 1 130px' }}>{c.kategori}</span>
                  <span style={muted}>{fmtTL(c.onceki)} → <b style={{ color: 'var(--text-primary)' }}>{fmtTL(c.simdi)}</b> (hedef ≤ {fmtTL(c.hedef)})</span>
                  <span style={{ fontWeight: 700, color: c.durum === 'tuttu' ? GREEN : c.durum === 'iyilesti' ? ORANGE : RED, whiteSpace: 'nowrap' }}>{c.durum === 'tuttu' ? 'Hedef tuttu' : c.durum === 'iyilesti' ? 'Azaldı' : 'Aştı'}</span>
                </div>
              ))}
            </>
          )}
          <div style={{ ...label, margin: '12px 0 6px' }}>Rozetler</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {card.rozetler.map(r => (
              <span key={r.id} title={r.aciklama} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 600, padding: '4px 9px', borderRadius: '999px', border: '1px solid ' + (r.kazanildi ? GREEN : 'var(--border-color)'), color: r.kazanildi ? GREEN : 'var(--text-muted)', opacity: r.kazanildi ? 1 : 0.6 }}>
                <Award size={12} /> {r.ad}
              </span>
            ))}
          </div>
          <div style={{ ...muted, marginTop: '6px' }}>Karne iki ardışık ayın ekstre harcama analizini karşılaştırır; kısma hedefleri öneri kuralıyla aynıdır (örn. market %12). Taksit, fatura, sağlık gibi kısılamayan kalemler sayılmaz.</div>
        </div>
      )}
    </div>
  );
}
