import React, { useId } from 'react';

interface HourglassProps {
  // 1 = süre henüz hiç azalmadı (kum tamamen üstte), 0 = süre bitti (kum tamamen altta).
  remainingFraction: number;
  active: boolean;
  size?: number;
}

// Cam baloncukların dış hatları: köşeden boyuna doğru kavisli, gerçek bir kum saati siluetine benzeyen eğriler.
const TOP_BULB_PATH = 'M22,20 Q22,58 50,82 Q78,58 78,20 Z';
const BOTTOM_BULB_PATH = 'M22,140 Q22,102 50,82 Q78,102 78,140 Z';
const NECK_Y = 82;
const TOP_INNER_Y = 20;
const BOTTOM_INNER_Y = 140;

export const Hourglass: React.FC<HourglassProps> = ({ remainingFraction, active, size = 30 }) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const p = Math.max(0, Math.min(1, remainingFraction));

  const topSandY = TOP_INNER_Y + (1 - p) * (NECK_Y - TOP_INNER_Y);
  const bottomSandY = BOTTOM_INNER_Y - (1 - p) * (BOTTOM_INNER_Y - NECK_Y);

  const showStream = active && p > 0.01 && p < 0.995;

  return (
    <svg width={size} height={size * (162 / 100)} viewBox="0 0 100 162" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`frame-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a9743f" />
          <stop offset="50%" stopColor="#e3b673" />
          <stop offset="100%" stopColor="#8a5a2d" />
        </linearGradient>
        <linearGradient id={`sand-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6d78c" />
          <stop offset="100%" stopColor="#d9a445" />
        </linearGradient>
        <linearGradient id={`glass-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0.02)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.12)" />
        </linearGradient>
        <clipPath id={`topClip-${uid}`}><path d={TOP_BULB_PATH} /></clipPath>
        <clipPath id={`bottomClip-${uid}`}><path d={BOTTOM_BULB_PATH} /></clipPath>
      </defs>

      {/* Ahşap üst ve alt çerçeve */}
      <rect x="10" y="6" width="80" height="12" rx="4" fill={`url(#frame-${uid})`} stroke="#6e4520" strokeWidth="1" />
      <rect x="10" y="144" width="80" height="12" rx="4" fill={`url(#frame-${uid})`} stroke="#6e4520" strokeWidth="1" />
      <rect x="16" y="16" width="4" height="130" rx="2" fill={`url(#frame-${uid})`} />
      <rect x="80" y="16" width="4" height="130" rx="2" fill={`url(#frame-${uid})`} />

      {/* Kum */}
      <g clipPath={`url(#topClip-${uid})`}>
        <rect x="18" y={topSandY} width="64" height={NECK_Y - topSandY + 2} fill={`url(#sand-${uid})`} />
      </g>
      <g clipPath={`url(#bottomClip-${uid})`}>
        <rect x="18" y={bottomSandY} width="64" height={BOTTOM_INNER_Y - bottomSandY} fill={`url(#sand-${uid})`} />
        {p < 0.995 && (
          <ellipse cx="50" cy={bottomSandY} rx="20" ry="3" fill="#f6d78c" opacity={0.7} />
        )}
      </g>

      {/* Düşen kum akışı */}
      {showStream && (
        <>
          <circle cx="50" cy="84" r="1.4" fill="#f6d78c" style={{ animation: `hourglassDrop-${uid} 0.5s linear infinite` }} />
          <circle cx="50" cy="84" r="1.4" fill="#f6d78c" style={{ animation: `hourglassDrop-${uid} 0.5s linear infinite 0.17s` }} />
          <circle cx="50" cy="84" r="1.4" fill="#f6d78c" style={{ animation: `hourglassDrop-${uid} 0.5s linear infinite 0.34s` }} />
        </>
      )}

      {/* Cam baloncuklar: dış hat + hafif parlama */}
      <path d={TOP_BULB_PATH} fill={`url(#glass-${uid})`} stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <path d={BOTTOM_BULB_PATH} fill={`url(#glass-${uid})`} stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes hourglassDrop-${uid} {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateY(52px); opacity: 0; }
        }
      `}} />
    </svg>
  );
};

export default Hourglass;
