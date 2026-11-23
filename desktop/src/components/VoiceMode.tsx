// Sesli mod: tam ekran, ortada Jarvis çekirdeği. Dinle -> Asistan'a gönder -> işi yap -> cevabı oku -> yine dinle döngüsü AppAssistant'ta döner;
// bu bileşen yalnızca durumu gösterir (mantık tek yerde kalsın, ekran sadeleşsin diye).
import React from 'react';
import { X } from 'lucide-react';
import JarvisCore, { type CoreState } from './JarvisCore';

const LABEL: Record<CoreState, string> = { idle: 'Hazır', listening: 'Dinliyorum…', thinking: 'Düşünüyorum…', speaking: 'Konuşuyorum…', acting: 'İşlem yapıyorum…' };

export default function VoiceMode({ state, level, user, reply, note, wake, canWake, onWake, onClose }: {
  state: CoreState; level: () => number; user: string; reply: string; note: string;
  wake: boolean; canWake: boolean; onWake: (v: boolean) => void; onClose: () => void;
}) {
  const size = Math.min(260, Math.round((typeof window !== 'undefined' ? window.innerWidth : 360) * 0.62));
  return (
    <div role="dialog" aria-label="Sesli mod" style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'radial-gradient(circle at 50% 38%, #06243a 0%, #030b14 70%)', color: '#d7f3ff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '34px 18px 20px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', letterSpacing: '0.18em', fontSize: '12px', color: '#5fd4f0' }}>
        <span>SESLİ MOD</span>
        <button type="button" onClick={onClose} aria-label="Sesli modu kapat" style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.4)', color: '#d7f3ff', borderRadius: '8px', padding: '6px 9px', cursor: 'pointer' }}><X size={16} /></button>
      </div>
      <div style={{ marginTop: '4vh' }}><JarvisCore state={state} size={size} level={level} /></div>
      <div style={{ marginTop: '10px', fontSize: '15px', color: '#8fe6ff' }}>{LABEL[state]}</div>
      {user && <div style={{ marginTop: '14px', fontSize: '14px', opacity: 0.75, textAlign: 'center', maxWidth: '560px' }}>“{user}”</div>}
      {reply && <div style={{ marginTop: '12px', fontSize: '15px', lineHeight: 1.5, textAlign: 'center', maxWidth: '560px', maxHeight: '26vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{reply}</div>}
      {note && <div style={{ marginTop: '12px', fontSize: '13px', color: '#fbbf24', textAlign: 'center', maxWidth: '560px' }}>{note}</div>}
      <div style={{ flex: 1 }} />
      {canWake && (
        <label style={{ fontSize: '12.5px', opacity: 0.8, display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
          <input type="checkbox" checked={wake} onChange={(e) => onWake(e.target.checked)} /> “Ultran” deyince sesli modu aç (uygulama açıkken dinler)
        </label>
      )}
      <div style={{ fontSize: '12px', opacity: 0.6, textAlign: 'center' }}>Kapatmak için “tamam” ya da “dur” de</div>
    </div>
  );
}
