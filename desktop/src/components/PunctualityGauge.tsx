import React, { useId } from 'react';
import { getPunctualityLabel } from '../punctuality';

interface PunctualityGaugeProps {
  score: number; // 0-100
  width?: number;
  showLabel?: boolean;
  compact?: boolean;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Yatay hız göstergesi (speedometer) tarzı ibre — sol uç "Erteleyen/Tembel", orta "Nötr",
// sağ uç "Dakik/Hızlı/Deha". score prop'u 0-100 aralığında, ibrenin yatay konumunu belirler.
// Hem Sidebar'daki küçük önizlemede (compact) hem de tam Dakiklik sayfasında kullanılır.
export const PunctualityGauge: React.FC<PunctualityGaugeProps> = ({ score, width = 240, showLabel = true, compact = false }) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const clamped = Math.max(0, Math.min(100, score));
  const { label, color } = getPunctualityLabel(clamped);
  const trackHeight = compact ? 8 : 14;
  const needleSize = compact ? 12 : 20;

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ (taşma): dış kapsayıcıya SABİT piksel width veriyordu (varsayılan 240px).
  // Sidebar'ın daraltılmış kartı bundan daha dar olduğunda gauge kartın dışına taşıyordu.
  // Artık her zaman ebeveynin %100'ünü kaplar; `width` prop'u sadece bir ÜST SINIR (maxWidth)
  // olarak kullanılır — bağımsız sayfalarda (AdventureView) hâlâ belirli bir genişlikte
  // sabitlenebilir ama asla ebeveyni taşacak kadar büyümez. İbrenin en uçlardaki (0/100)
  // yarım-dışarı-taşma payı için de kapsayıcıya küçük bir yatay padding eklendi.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 8, width: '100%', maxWidth: width, boxSizing: 'border-box' }}>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: compact ? 9 : 11, color: 'var(--text-muted)' }}>🐌 Erteleyen</span>
          <span style={{ fontSize: compact ? 10.5 : 13, fontWeight: 700, color }}>{label}</span>
          <span style={{ fontSize: compact ? 9 : 11, color: 'var(--text-muted)' }}>Deha ⚡</span>
        </div>
      )}
      <div style={{ position: 'relative', width: '100%', height: trackHeight, boxSizing: 'border-box' }}>
        <svg width="100%" height={trackHeight} viewBox={`0 0 100 ${trackHeight}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'hidden' }}>
          <defs>
            <linearGradient id={`gauge-track-${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="35%" stopColor="#f59e0b" />
              <stop offset="50%" stopColor="#94a3b8" />
              <stop offset="65%" stopColor="#4ade80" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height={trackHeight} rx={trackHeight / 2} fill={`url(#gauge-track-${uid})`} opacity={0.85} />
          {/* Orta (nötr) çizgisi */}
          <line x1="50" y1="0" x2="50" y2={trackHeight} stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
        </svg>
        {/* İbre — calc() ile piksel+yüzde karışık konumlama: needle'ın kendi yarım
            genişliği kadar payı düşer, geri kalan mesafe boyunca skora göre kayar. Bu
            sayede uçlarda (0/100) needle asla kapsayıcının dışına taşmaz. */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `calc(${needleSize / 2}px + (100% - ${needleSize}px) * ${clamped / 100})`,
            transform: 'translate(-50%, -50%)',
            width: needleSize,
            height: needleSize,
            borderRadius: '50%',
            background: '#fff',
            border: `2.5px solid ${color}`,
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            transition: 'left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'
          }}
        />
      </div>
    </div>
  );
};

export default PunctualityGauge;
