import React, { useEffect } from 'react';
import type { DevStage } from '../services/devWork';

// Geliştir ekranının üstündeki "makine": iş akışının neresinde olunduğunu ve sıradaki adımı canlı gösterir.
// Yalnızca görsel katmandır; hiçbir işlem tetiklemez (tıklama yalnızca seçimi değiştirir).
// Animasyon saf SVG/CSS: bağımlılık yok. Yalnızca aktif istasyon hareket eder ki DevView arka planda yaşarken CPU/pil harcanmasın.

export type MachineBusy = 'plan' | 'apply' | 'check' | 'merge' | 'diff' | null;
type Ci = 'none' | 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | undefined;

interface Props {
  stage: DevStage | null;          // seçili isteğin aşaması; yoksa boşta görünümü
  busyKind: MachineBusy;
  elapsed: number;
  readyCount: number;
  ci: Ci;
  hasRequest: boolean;
  onPick?: (station: number) => void;
}

const GREEN = '#22c55e';
const GLOW = '#4ade80';
const RED = '#ef4444';
const AMBER = '#eab308';

const STATIONS: { name: string; tip: string }[] = [
  { name: 'İstek', tip: 'İsteği yazarsınız; kayıt buradan başlar.' },
  { name: 'Plan', tip: 'Claude kodu inceler ve yapılacakları planlar.' },
  { name: 'Yapılıyor', tip: 'Claude ayrı bir çalışma kopyasında kodu yazar.' },
  { name: 'Kontrol', tip: 'Tür denetimi (tsc) çalışır; geçmeden birleştirilemez.' },
  { name: 'İnceleme', tip: 'Farkı siz okur, onaylar ya da reddedersiniz.' },
  { name: 'Birleştir', tip: 'Değişiklik yerel ana dala eklenir (henüz yayınlanmaz).' },
  { name: 'Yayın', tip: 'Sürüm yayınlanır, derleme (CI) izlenir.' }
];

// Aşamaya göre "şu an hangi istasyondayız" (0-7; 7 = hepsi tamam) ve hata istasyonu
const position = (stage: DevStage | null, busyKind: MachineBusy): { cur: number; fail: number } => {
  if (busyKind === 'plan') return { cur: 1, fail: -1 };
  if (busyKind === 'apply') return { cur: 2, fail: -1 };
  if (busyKind === 'check') return { cur: 3, fail: -1 };
  if (busyKind === 'merge') return { cur: 5, fail: -1 };
  switch (stage) {
    case 'istek': return { cur: 0, fail: -1 };
    case 'plan': return { cur: 1, fail: -1 };
    case 'yapiliyor': return { cur: 2, fail: -1 };
    case 'kontrol': return { cur: 3, fail: -1 };
    case 'inceleme': return { cur: 4, fail: -1 };
    case 'birlesti': return { cur: 6, fail: -1 };
    case 'yayinda': return { cur: 7, fail: -1 };
    case 'hata': return { cur: 2, fail: 2 };
    default: return { cur: -1, fail: -1 };
  }
};

export const nextStepText = (p: Props): string => {
  const { stage, busyKind } = p;
  if (busyKind === 'plan') return 'Claude planı çıkarıyor, bekleyin.';
  if (busyKind === 'apply') return 'Claude çalışıyor, bekleyin. Gerekirse Durdur\'a basabilirsiniz.';
  if (busyKind === 'check') return 'Tür denetimi çalışıyor, bekleyin.';
  if (busyKind === 'merge') return 'Ana dala birleştiriliyor, bekleyin.';
  if (!p.hasRequest || !stage) return '1. Soldan yeni bir istek yazıp "İstek ekle"ye basın ya da mevcut bir isteği seçin.';
  switch (stage) {
    case 'istek': return '1. İsteği gözden geçirin, "Plan çıkar"a (ya da doğrudan "Direkt uygula"ya) basın.';
    case 'plan': return 'Plan hazır: okuyun, uygun ise "Bu planla uygula"ya basın.';
    case 'inceleme': return 'Farkı inceleyin; kontrol geçtiyse "Birleştir"e, beğenmediyseniz "Reddet ve sil"e basın.';
    case 'birlesti': return 'Değişiklik ana dalda. Sol taraftaki "Yayına hazırla"ya basın.';
    case 'yayinda': return p.ci === 'failure' ? 'Yayınlandı ama derleme başarısız: Yayınlar listesindeki durumu kontrol edin.' : 'Yayınlandı. Yeni bir istekle devam edebilirsiniz.';
    case 'hata': return 'Bir hata oldu: aşağıdaki mesajı okuyun, "Plan çıkar" ya da "Direkt uygula" ile tekrar deneyin.';
    case 'reddedildi': return 'İstek reddedildi, çalışma kopyası silindi. Yeni bir istek ekleyebilirsiniz.';
    default: return 'Çalışma sürüyor…';
  }
};

const X0 = 60, DX = 100, Y = 62;
const cx = (i: number) => X0 + DX * i;

export default function DevMachine(props: Props) {
  const { stage, busyKind, elapsed, readyCount, ci, onPick } = props;
  // Sekme gizliyken animasyonlar durur (arka planda boşuna CPU/pil harcanmasın)
  useEffect(() => {
    const f = () => document.body.classList.toggle('devm-hidden', document.hidden);
    f(); document.addEventListener('visibilitychange', f);
    return () => { document.removeEventListener('visibilitychange', f); document.body.classList.remove('devm-hidden'); };
  }, []);
  const { cur, fail } = position(stage, busyKind);
  const rejected = stage === 'reddedildi';
  const working = !!busyKind && busyKind !== 'diff';
  const mins = Math.floor(elapsed / 60000), secs = Math.floor(elapsed / 1000) % 60;

  // Durum: done (tamam), active, todo (sönük), fail
  const state = (i: number): 'done' | 'active' | 'todo' | 'fail' => {
    if (i === fail) return 'fail';
    if (rejected) return 'todo';
    if (i < cur) return 'done';
    if (i === cur) return 'active';
    return 'todo';
  };
  const mark = (s: string) => (s === 'done' ? '✓ ' : s === 'fail' ? '✗ ' : '');
  const spin = (i: number) => (state(i) === 'active' && (working || i === 4) ? '' : 'devm-paused');
  const fast = busyKind === 'apply';
  const ciFill = ci === 'success' || cur >= 7 ? 1 : ci === 'running' ? 0.65 : ci === 'queued' ? 0.35 : cur >= 6 ? 0.15 : 0;

  const station = (i: number) => {
    const s = state(i);
    const c = s === 'fail' ? RED : s === 'todo' ? 'var(--text-muted)' : s === 'active' ? GLOW : GREEN;
    const x = cx(i);
    const op = s === 'todo' ? 0.45 : 1;
    let art: React.ReactNode = null;
    if (i === 0) {
      // kâğıt + huni
      art = (<g>
        <rect x={x - 14} y={Y - 30} width="22" height="28" rx="2" fill="none" stroke={c} strokeWidth="2" />
        <path d={`M${x - 10} ${Y - 22}h14M${x - 10} ${Y - 16}h14M${x - 10} ${Y - 10}h9`} stroke={c} strokeWidth="1.5" />
        <path d={`M${x - 16} ${Y + 2}h32l-12 12v8h-8v-8z`} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
      </g>);
    } else if (i === 1) {
      // büyüteç + küçük çark
      art = (<g>
        <g className={`devm-spin ${spin(i)}`} style={{ transformOrigin: `${x + 12}px ${Y + 8}px` }}>
          <circle cx={x + 12} cy={Y + 8} r="9" fill="none" stroke={c} strokeWidth="2" strokeDasharray="4 3" />
          <circle cx={x + 12} cy={Y + 8} r="3" fill={c} />
        </g>
        <circle cx={x - 6} cy={Y - 10} r="12" fill="none" stroke={c} strokeWidth="2.5" />
        <path d={`M${x + 3} ${Y - 1}l9 9`} stroke={c} strokeWidth="3" strokeLinecap="round" />
      </g>);
    } else if (i === 2) {
      // iki dişli + piston
      const gear = (gx: number, gy: number, r: number, rev: boolean) => (
        <g className={`devm-spin ${rev ? 'devm-rev' : ''} ${fast ? 'devm-fast' : ''} ${spin(i)}`} style={{ transformOrigin: `${gx}px ${gy}px` }}>
          <circle cx={gx} cy={gy} r={r} fill="none" stroke={c} strokeWidth="3" strokeDasharray="5 3" />
          <circle cx={gx} cy={gy} r={r - 5} fill="none" stroke={c} strokeWidth="2" />
          <path d={`M${gx - r + 5} ${gy}h${2 * r - 10}M${gx} ${gy - r + 5}v${2 * r - 10}`} stroke={c} strokeWidth="1.5" />
        </g>
      );
      art = (<g>
        {gear(x - 9, Y - 8, 17, false)}
        {gear(x + 16, Y + 12, 11, true)}
        <g className={`devm-piston ${fast ? 'devm-fast' : ''} ${spin(i)}`}>
          <rect x={x + 22} y={Y - 30} width="8" height="18" rx="1" fill={c} />
        </g>
        <rect x={x + 19} y={Y - 14} width="14" height="4" fill="none" stroke={c} strokeWidth="1.5" />
      </g>);
    } else if (i === 3) {
      // beher: kaynayan yeşil sıvı
      const liquid = s === 'fail' ? RED : GLOW;
      art = (<g>
        <path d={`M${x - 10} ${Y - 30}v14l-14 32a4 4 0 0 0 4 6h40a4 4 0 0 0 4-6l-14-32v-14`} fill="none" stroke={c} strokeWidth="2.5" strokeLinejoin="round" />
        <path d={`M${x - 17} ${Y + 2}h34l7 16a4 4 0 0 1-4 6h-40a4 4 0 0 1-4-6z`} fill={liquid} opacity={s === 'todo' ? 0.2 : 0.75} className={s === 'active' ? 'devm-glow' : ''} />
        {[-8, 2, 10].map((dx, k) => (
          <circle key={k} cx={x + dx} cy={Y + 14} r={2.4 - k * 0.3} fill="#dcfce7" className={`devm-bubble ${spin(i)}`} style={{ animationDelay: `${k * 0.45}s` }} />
        ))}
      </g>);
    } else if (i === 4) {
      // tartı + lamba (onay bekler: nabız gibi yanıp söner)
      art = (<g>
        <path d={`M${x} ${Y - 28}v44M${x - 14} ${Y + 16}h28M${x - 20} ${Y - 18}h40`} stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        <path d={`M${x - 26} ${Y - 6}h12l-6-12zM${x + 14} ${Y - 6}h12l-6-12z`} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
        <circle cx={x} cy={Y - 32} r="5" fill={s === 'active' ? AMBER : c} className={s === 'active' ? 'devm-pulse' : ''} />
      </g>);
    } else if (i === 5) {
      // iki borunun birleştiği vana
      art = (<g>
        <path d={`M${x - 26} ${Y - 18}h14q8 0 8 8v6M${x + 26} ${Y - 18}h-14q-8 0-8 8v6`} fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" />
        <rect x={x - 8} y={Y - 6} width="16" height="22" rx="2" fill="none" stroke={c} strokeWidth="2.5" />
        <g className={`devm-spin ${spin(i)}`} style={{ transformOrigin: `${x}px ${Y + 24}px` }}>
          <circle cx={x} cy={Y + 24} r="8" fill="none" stroke={c} strokeWidth="2.5" />
          <path d={`M${x - 8} ${Y + 24}h16M${x} ${Y + 16}v16`} stroke={c} strokeWidth="2" />
        </g>
      </g>);
    } else {
      // roket/tank: derleme durumuna göre dolar
      const fillH = 40 * ciFill;
      const tank = ci === 'failure' ? RED : GLOW;
      art = (<g>
        <clipPath id="devm-tank"><rect x={x - 14} y={Y - 30} width="28" height="40" rx="12" /></clipPath>
        <rect x={x - 14} y={Y - 30} width="28" height="40" rx="12" fill="none" stroke={c} strokeWidth="2.5" />
        <rect x={x - 14} y={Y + 10 - fillH} width="28" height={fillH} fill={tank} opacity="0.8" clipPath="url(#devm-tank)" className={ci === 'running' || ci === 'queued' ? 'devm-glow' : ''} />
        <path d={`M${x - 14} ${Y + 2}l-10 14h10M${x + 14} ${Y + 2}l10 14h-10`} fill="none" stroke={c} strokeWidth="2.5" strokeLinejoin="round" />
        {s !== 'todo' && cur === 6 && <path d={`M${x - 6} ${Y + 14}q6 14 12 0`} fill={AMBER} className="devm-pulse" />}
      </g>);
    }
    const tip = `${STATIONS[i].name}: ${STATIONS[i].tip}`;
    return (
      <g key={i} opacity={op} style={{ cursor: onPick ? 'pointer' : 'default' }} onClick={() => onPick?.(i)} role="button" tabIndex={0} aria-label={tip}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(i); } }}>
        <title>{tip}</title>
        <rect x={x - 44} y={4} width="88" height="122" rx="10" fill={s === 'active' ? 'rgba(74,222,128,0.10)' : 'transparent'} stroke={s === 'active' ? GLOW : 'transparent'} strokeWidth="1.5" className={s === 'active' && working ? 'devm-pulse' : ''} />
        {art}
        <text x={x} y={112} textAnchor="middle" fontSize="12" fontWeight="700" fill={s === 'fail' ? RED : 'var(--text-secondary)'}>{mark(s)}{STATIONS[i].name}</text>
        {i === 6 && readyCount > 0 && <text x={x + 30} y={20} textAnchor="middle" fontSize="11" fontWeight="700" fill={GREEN}>{readyCount} hazır</text>}
      </g>
    );
  };

  // Borular: tamamlanan bölümlerde parlak yeşil sıvı akar
  const pipe = (i: number) => {
    const x1 = cx(i) + 34, x2 = cx(i + 1) - 34;
    const flowing = !rejected && i + 1 <= cur;
    const feeding = !rejected && i + 1 === cur && working; // aktif istasyona sıvı hızlı akar
    const broken = fail >= 0 && i + 1 >= fail;
    return (
      <g key={`p${i}`}>
        <line x1={x1} y1={Y} x2={x2} y2={Y} stroke="var(--border-color)" strokeWidth="9" strokeLinecap="round" />
        {!broken && flowing && <line x1={x1} y1={Y} x2={x2} y2={Y} stroke={GLOW} strokeWidth="4" strokeLinecap="round" strokeDasharray="8 8" className={`devm-flow ${feeding ? 'devm-fast' : ''}`} />}
        {broken && fail === i + 1 && <path d={`M${x2 - 6} ${Y - 8}l5 7-5 4 5 7`} fill="none" stroke={RED} strokeWidth="2" />}
      </g>
    );
  };

  return (
    <div className="devm-wrap" style={{ marginTop: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px 12px' }}>
      <style>{`
        @keyframes devm-spin { to { transform: rotate(360deg); } }
        @keyframes devm-flow { to { stroke-dashoffset: -16; } }
        @keyframes devm-bubble { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-26px); opacity: 0; } }
        @keyframes devm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes devm-piston { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(12px); } }
        .devm-spin { animation: devm-spin 6s linear infinite; }
        .devm-rev { animation-direction: reverse; }
        .devm-fast.devm-spin { animation-duration: 1.6s; }
        .devm-flow { animation: devm-flow 1.2s linear infinite; }
        .devm-flow.devm-fast { animation-duration: 0.45s; }
        .devm-bubble { animation: devm-bubble 1.4s ease-in infinite; }
        .devm-pulse { animation: devm-pulse 1.3s ease-in-out infinite; }
        .devm-glow { animation: devm-pulse 2.2s ease-in-out infinite; }
        .devm-piston { animation: devm-piston 1.6s ease-in-out infinite; }
        .devm-piston.devm-fast { animation-duration: 0.5s; }
        .devm-paused, .devm-paused.devm-spin, .devm-paused.devm-bubble, .devm-paused.devm-piston { animation-play-state: paused; }
        /* Sekme gizliyken animasyon durur: DevView arka planda yaşadığı için boşuna CPU/pil harcanmasın */
        body.devm-hidden .devm-wrap * { animation-play-state: paused !important; }
        @media (prefers-reduced-motion: reduce) { .devm-wrap * { animation: none !important; } }
      `}</style>
      <svg viewBox="0 0 720 130" width="100%" style={{ display: 'block', maxHeight: '170px' }} role="group" aria-label="Geliştirme hattı">
        {STATIONS.slice(0, 6).map((_, i) => pipe(i))}
        {STATIONS.map((_, i) => station(i))}
      </svg>
      <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
        <span style={{ color: GREEN }}>▶ Sıradaki adım:</span>
        <span style={{ overflowWrap: 'anywhere' }}>{nextStepText(props)}</span>
        {working && <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>{mins > 0 ? `${mins} dk ` : ''}{secs} sn</span>}
      </div>
    </div>
  );
}
