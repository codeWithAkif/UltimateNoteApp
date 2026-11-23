// Sesli mod: uygulamanın üstünde, sayfanın ortasında yüzen küçük Jarvis çekirdeği. Arka plan karartılmaz ve sayfa görünür kalır:
// asistan sizin yerinize uygulamayı kullanırken (ekran açma, düğmelere basma) ne yaptığını görebilirsiniz.
// Dinle -> Asistan'a gönder -> işi yap -> cevabı oku (gerekirse soru sor) -> yine dinle döngüsü AppAssistant'ta döner;
// bu bileşen yalnızca durumu gösterir (mantık tek yerde kalsın diye).
import React, { useState } from 'react';
import { X, Settings2 } from 'lucide-react';
import JarvisCore, { type CoreState } from './JarvisCore';

const LABEL: Record<CoreState, string> = { idle: 'Hazır', listening: 'Dinliyorum…', thinking: 'Düşünüyorum…', speaking: 'Konuşuyorum…', acting: 'Uygulamayı kullanıyorum…' };

export default function VoiceMode({ state, level, user, reply, note, wake, canWake, onWake, gv, onGv, onClose }: {
  state: CoreState; level: () => number; user: string; reply: string; note: string;
  wake: boolean; canWake: boolean; onWake: (v: boolean) => void; gv: boolean; onGv: (v: boolean) => void; onClose: () => void;
}) {
  const [opts, setOpts] = useState(false);
  const size = 104;
  const chip: React.CSSProperties = { background: 'rgba(3,14,24,0.88)', border: '1px solid rgba(34,211,238,0.4)', color: '#d7f3ff', borderRadius: '8px', padding: '5px 7px', cursor: 'pointer', display: 'inline-flex', pointerEvents: 'auto' };
  const bubble: React.CSSProperties = { background: 'rgba(3,14,24,0.88)', border: '1px solid rgba(34,211,238,0.28)', borderRadius: '12px', padding: '8px 12px', textAlign: 'center', boxShadow: '0 6px 22px rgba(0,0,0,0.35)' };
  return (
    // Kapsayıcı tıklamayı geçirir: altındaki uygulama kullanılabilir kalır; yalnızca küçük düğmeler tıklanır
    <div role="dialog" aria-label="Sesli mod" style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 2147483000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: 'min(440px, calc(100vw - 24px))', pointerEvents: 'none', color: '#d7f3ff' }}>
      <div style={{ position: 'relative', width: size + 16, height: size + 16, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle,#06243a 0%,#030b14 100%)', border: '1px solid rgba(34,211,238,0.5)', boxShadow: '0 0 34px rgba(34,211,238,0.35), 0 10px 30px rgba(0,0,0,0.5)' }}>
        <JarvisCore state={state} size={size} level={level} />
        <div style={{ position: 'absolute', right: -52, top: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button type="button" onClick={onClose} aria-label="Sesli modu kapat" title="Kapat (ya da “tamam” de)" style={chip}><X size={14} /></button>
          <button type="button" onClick={() => setOpts(o => !o)} aria-label="Sesli mod ayarları" aria-pressed={opts} title="Ayarlar" style={chip}><Settings2 size={14} /></button>
        </div>
      </div>
      <div style={{ fontSize: '12.5px', letterSpacing: '0.04em', color: '#8fe6ff', ...bubble, padding: '3px 12px', borderRadius: '999px' }}>{LABEL[state]}</div>
      {user && <div style={{ ...bubble, fontSize: '13px', opacity: 0.85, maxWidth: '100%' }}>“{user}”</div>}
      {reply && <div style={{ ...bubble, fontSize: '13.5px', lineHeight: 1.45, maxWidth: '100%', maxHeight: '22vh', overflowY: 'auto', whiteSpace: 'pre-wrap', pointerEvents: 'auto' }}>{reply}</div>}
      {note && <div style={{ ...bubble, fontSize: '12.5px', color: '#fbbf24', maxWidth: '100%' }}>{note}</div>}
      {opts && (
        <div style={{ ...bubble, textAlign: 'left', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12.5px' }}>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={gv} onChange={(e) => onGv(e.target.checked)} /> Gemini sesi kullan (daha doğal, ama ücretsiz kotayı hızlı doldurur)</label>
          {canWake && <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={wake} onChange={(e) => onWake(e.target.checked)} /> “Ultran” deyince sesli modu aç (uygulama açıkken dinler)</label>}
          <div style={{ opacity: 0.6 }}>Kapatmak için “tamam” ya da “dur” de</div>
        </div>
      )}
    </div>
  );
}
