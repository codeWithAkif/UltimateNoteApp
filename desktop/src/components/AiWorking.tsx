import React from 'react';

// Yapay zekâ çalışırken gösterilen bekleme alanı: ızgara zemin + tarama çizgisi + canlı nokta (bkz. style.css .ai-working).
export default function AiWorking({ text }: { text: string }) {
  return (
    <div className="ai-working" role="status" aria-live="polite">
      <span className="ai-dot" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
