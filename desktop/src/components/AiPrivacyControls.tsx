import React from 'react';

export interface AiPrivacy {
  hideNames: boolean;
  onHideNamesChange: (v: boolean) => void;
  extraNames: string;
  onExtraNamesChange: (v: string) => void;
  maskProper: boolean;
  onMaskProperChange: (v: boolean) => void;
}

const field: React.CSSProperties = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px',
  padding: '6px 9px', fontSize: '12px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0, width: '100%'
};

// Yapay zekâya gidecek metinlerin gizlenmesi: müşteri/proje adları, kişi adları (liste) ve isteğe bağlı olarak büyük harfli tüm özel adlar.
// Gizlenen adlar PROJE_A / MUSTERI_A / KISI_A / AD_A gibi jetonlarla gider, cevap gelince gerçek adlarla geri eşleştirilir.
export default function AiPrivacyControls({ p }: { p: AiPrivacy }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}
        title="Açıkken müşteri ve proje adları yapay zekâya gönderilmez (PROJE_A gibi jetonlarla gider, cevapta geri eşleştirilir)">
        <input type="checkbox" checked={p.hideNames} onChange={(e) => p.onHideNamesChange(e.target.checked)} />
        Müşteri/proje adlarını gizle
      </label>
      {p.hideNames && (
        <>
          <input
            value={p.extraNames}
            onChange={(e) => p.onExtraNamesChange(e.target.value)}
            placeholder="Gizlenecek kişi/ek adlar (virgülle: Betül Ünlü, Eren Kaptan)"
            style={field}
            title="Bu adlar PROJE_A / KISI_A gibi jetonlara çevrilip gönderilir. Teams aramasını eklediğinizde kişi adı buraya kendiliğinden eklenir."
          />
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '11.5px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={p.maskProper} onChange={(e) => p.onMaskProperChange(e.target.checked)} style={{ marginTop: '1px' }} />
            <span>Cümle içinde büyük harfle başlayan tüm özel adları da gizle (daha güvenli; özet daha az doğal olabilir)</span>
          </label>
        </>
      )}
    </div>
  );
}
