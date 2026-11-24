import React, { useEffect, useState } from 'react';
import { azureAvailable, setAzureVoice, useAzureVoice, speak, lastSpeakError } from '../services/assistant/voice';

// Azure ses ayarı: anahtar işletim sisteminin korumalı deposunda (Electron ana süreci) saklanır, bu ekrana geri GELMEZ.
// Yalnızca masaüstünde görünür (telefonda ana süreç yoktur).
const TEST = 'Merhaba, ben asistanınız. Yarın sabah dokuzda toplantıyı takvime ekledim.';

export default function AzureVoiceSettings({ compact }: { compact?: boolean }) {
  const [has, setHas] = useState(false);
  const [region, setRegion] = useState('germanywestcentral');
  const [voice, setVoice] = useState('tr-TR-AhmetNeural');
  const [key, setKey] = useState('');
  const [on, setOn] = useState(useAzureVoice());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const api = typeof window !== 'undefined' ? window.electron : undefined;

  useEffect(() => {
    void api?.azureSpeechStatus?.().then(s => { setHas(s.has); if (s.region) setRegion(s.region); if (s.voice) setVoice(s.voice); });
  }, []);
  if (!azureAvailable()) return null;

  const box: React.CSSProperties = { padding: compact ? '8px 10px' : '10px 12px', borderBottom: compact ? undefined : '1px solid rgba(127,127,127,0.3)', background: 'rgba(127,127,127,0.07)', display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '12.5px' };
  const inp: React.CSSProperties = { flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: '6px', border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.1)', color: 'inherit', font: 'inherit' };
  const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.15)', color: 'inherit', cursor: 'pointer', font: 'inherit' };

  const save = async () => {
    setBusy(true); setMsg('');
    const r = await api!.azureSpeechSave!({ key, region, voice });
    setBusy(false);
    if (!r.ok) { setMsg(r.error || 'Kaydedilemedi.'); return; }
    setKey(''); setHas(true); setAzureVoice(true); setOn(true); setMsg('Kaydedildi. Azure sesi açıldı; "Sesi dene" ile dinleyin.');
  };
  const clear = async () => { await api!.azureSpeechClear!(); setHas(false); setAzureVoice(false); setOn(false); setMsg('Azure anahtarı silindi.'); };
  const test = async () => {
    setBusy(true); setMsg('Çalıyor…');
    const sp = speak(TEST); await sp.done;
    const err = lastSpeakError();
    setBusy(false); setMsg(err ? `Azure çalışmadı: ${err} (bu sırada başka ses çalmış olabilir)` : 'Azure sesi çaldı.');
  };

  return (
    <div style={box}>
      <div style={{ fontWeight: 500 }}>Azure sesi (Microsoft Neural, doğal Türkçe)</div>
      <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input type="checkbox" checked={on} disabled={!has} onChange={(e) => { setOn(e.target.checked); setAzureVoice(e.target.checked); }} /> Azure sesini kullan {has ? '' : '(önce anahtarı kaydedin)'}
      </label>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input style={inp} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={has ? 'Anahtar kayıtlı (değiştirmek için yenisini yapıştırın)' : 'Azure KEY 1 (Anahtarlar ve Uç Nokta sayfası)'} />
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input style={inp} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Bölge, örn. germanywestcentral" />
        <select style={inp} value={voice} onChange={(e) => setVoice(e.target.value)}>
          <option value="tr-TR-AhmetNeural">Ahmet (erkek)</option>
          <option value="tr-TR-EmelNeural">Emel (kadın)</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button type="button" style={btn} disabled={busy || (!key.trim() && !has)} onClick={() => void save()}>Kaydet</button>
        <button type="button" style={btn} disabled={busy || !has} onClick={() => void test()}>Sesi dene</button>
        {has && <button type="button" style={btn} disabled={busy} onClick={() => void clear()}>Anahtarı sil</button>}
      </div>
      {msg && <div style={{ opacity: 0.85 }}>{msg}</div>}
      <div style={{ opacity: 0.6, fontSize: '11.5px' }}>Anahtar yalnızca bu bilgisayarda, Windows'un korumalı deposunda saklanır. Okunan metin Microsoft'a gönderilir. Hata olursa yerleşik sese dönülür.</div>
    </div>
  );
}
