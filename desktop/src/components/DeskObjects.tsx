import React, { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Minus, Plus, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import Hourglass from './Hourglass';
import { ambientAudioService, AMBIENT_PRESETS } from '../services/ambientAudio';
import { useDeskTimer, timerLeft, checkTimerDone, startTimer, pauseTimer, resetTimer, setTimerMinutes, useMusicBridge } from '../services/studyDesk';

// Çalışma masasının üstündeki eşyalar: saat (sağ), kum saati (sol), ortam sesi kutusu ve radyo (ön).
// Hepsi büyük düğmelerle kullanılır; baş/el kontrolünde de (bekleyince tetikleme) işaretlenebilsin diye aria-label'lı <button>'dır.

export const DESK_OBJECTS_CSS = `
.dk-row{position:absolute;left:0;right:0;bottom:0;height:150px;z-index:4;display:flex;align-items:flex-end;justify-content:center;gap:clamp(10px,2.2vw,34px);padding:0 24px 22px;pointer-events:none}
.dk-row>*{pointer-events:auto}
.dk-obj{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 14px 9px;border-radius:14px;background:linear-gradient(180deg,rgba(94,58,28,.92),rgba(52,30,14,.95));border:1px solid rgba(255,214,150,.38);box-shadow:0 10px 22px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,235,200,.22);color:#ffe9c6}
.dk-lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#e7c892}
.dk-btn{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:34px;height:30px;padding:0 9px;border-radius:9px;background:rgba(255,226,170,.14);border:1px solid rgba(255,214,150,.45);color:#ffeccd;font:inherit;font-size:12px}
.dk-btn:hover{background:rgba(255,226,170,.3)}.dk-btn.on{background:rgba(255,196,96,.45);border-color:#ffe2a8}.dk-btn:disabled{opacity:.4;cursor:default}
.dk-btn.aimed{outline:2px solid #7fffd4;box-shadow:0 0 16px rgba(127,255,212,.6)}
.dk-time{font-variant-numeric:tabular-nums;font-size:19px;font-weight:600;color:#fff2d8;letter-spacing:.04em}
.dk-name{max-width:150px;font-size:11.5px;color:#f4dcb0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dk-radio{background:linear-gradient(180deg,#6b4423,#3b2210)}
.dk-grille{width:150px;height:22px;border-radius:6px;background:repeating-linear-gradient(90deg,rgba(0,0,0,.45) 0 2px,rgba(255,220,160,.18) 2px 5px);border:1px solid rgba(255,214,150,.25)}
@media (max-width:900px){.dk-row{height:130px;gap:8px;padding:0 8px 12px}.dk-obj{padding:7px 8px}.dk-grille{width:90px}}
`;

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** Sağdaki saat: analog kadran + dijital saat */
export function DeskClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
  const a = (deg: number, len: number) => ({ x2: 50 + Math.sin((deg * Math.PI) / 180) * len, y2: 50 - Math.cos((deg * Math.PI) / 180) * len });
  const hh = a((h + m / 60) * 30, 20), mm = a((m + s / 60) * 6, 30), ss = a(s * 6, 33);
  return (
    <div className="dk-obj" aria-label="Saat">
      <span className="dk-lbl">Saat</span>
      <svg width="78" height="78" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" fill="#fff4dc" stroke="#c89a55" strokeWidth="5" />
        {Array.from({ length: 12 }, (_, i) => { const p = a(i * 30, 41), q = a(i * 30, 36); return <line key={i} x1={p.x2} y1={p.y2} x2={q.x2} y2={q.y2} stroke="#5a3a1a" strokeWidth={i % 3 === 0 ? 3 : 1.5} />; })}
        <line x1="50" y1="50" {...hh} stroke="#3b2210" strokeWidth="4.5" strokeLinecap="round" />
        <line x1="50" y1="50" {...mm} stroke="#3b2210" strokeWidth="3" strokeLinecap="round" />
        <line x1="50" y1="50" {...ss} stroke="#c0392b" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="50" cy="50" r="3" fill="#c0392b" />
      </svg>
      <span className="dk-time" style={{ fontSize: 15 }}>{pad(now.getHours())}:{pad(m)}</span>
    </div>
  );
}

/** Soldaki kum saati: süre ayarlanır (−5/+5 dk), başlat/duraklat, sıfırla. Bitince zil çalar. */
export function DeskHourglass() {
  const t = useDeskTimer();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => { checkTimerDone(); tick(v => v + 1); }, 500); return () => clearInterval(i); }, []);
  const left = timerLeft(t), running = !!t.endAt, done = left <= 0 && !running;
  const min = Math.round(t.total / 60);
  return (
    <div className="dk-obj" aria-label="Kum saati">
      <span className="dk-lbl">Kum saati · {min} dk</span>
      <Hourglass remainingFraction={t.total > 0 ? left / t.total : 0} active={running} size={40} />
      <span className="dk-time" style={done ? { color: '#ff9d8a' } : undefined}>{done ? 'Süre doldu' : `${pad(left / 60)}:${pad(left % 60)}`}</span>
      <div style={{ display: 'flex', gap: 5 }}>
        <button type="button" className="dk-btn" onClick={() => setTimerMinutes(min - 5)} aria-label="Kum saati süresini 5 dakika kısalt" disabled={running || min <= 1}><Minus size={13} />5</button>
        <button type="button" className={`dk-btn${running ? ' on' : ''}`} onClick={() => (running ? pauseTimer() : startTimer())} aria-label={running ? 'Kum saatini duraklat' : 'Kum saatini başlat'}>{running ? <Pause size={14} /> : <Play size={14} />}</button>
        <button type="button" className="dk-btn" onClick={() => resetTimer()} aria-label="Kum saatini sıfırla"><RotateCcw size={13} /></button>
        <button type="button" className="dk-btn" onClick={() => setTimerMinutes(min + 5)} aria-label="Kum saati süresini 5 dakika uzat" disabled={running || min >= 180}><Plus size={13} />5</button>
      </div>
    </div>
  );
}

/** Önde ortam sesi kutusu: hazır karışımlar arasında geçer (yağmur, kamp ateşi…), kapatır. */
export function DeskAmbient() {
  const [st, setSt] = useState(() => ambientAudioService.getState());
  const [idx, setIdx] = useState(-1);
  useEffect(() => ambientAudioService.subscribe(() => setSt(ambientAudioService.getState())), []);
  const playing = st.isGlobalPlaying && Object.values(st.playingMap).some(Boolean);
  const go = (d: number) => { const n = AMBIENT_PRESETS.length, i = (idx + d + n * 2) % n; setIdx(i); ambientAudioService.applyPreset(AMBIENT_PRESETS[i].volumes); };
  const cur = idx >= 0 ? AMBIENT_PRESETS[idx] : null;
  return (
    <div className="dk-obj" aria-label="Ortam sesleri">
      <span className="dk-lbl">Ortam sesi</span>
      <div className="dk-grille" aria-hidden="true" />
      <span className="dk-name">{playing ? (cur ? `${cur.emoji} ${cur.name}` : 'Çalıyor') : 'Kapalı'}</span>
      <div style={{ display: 'flex', gap: 5 }}>
        <button type="button" className="dk-btn" onClick={() => go(-1)} aria-label="Önceki ortam sesi"><SkipBack size={13} /></button>
        <button type="button" className={`dk-btn${playing ? ' on' : ''}`} onClick={() => (playing ? ambientAudioService.stopAll() : go(1))} aria-label={playing ? 'Ortam sesini kapat' : 'Ortam sesini aç'}>{playing ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
        <button type="button" className="dk-btn" onClick={() => go(1)} aria-label="Sonraki ortam sesi"><SkipForward size={13} /></button>
      </div>
    </div>
  );
}

/** Önde radyo: uygulamanın müzik çalarını (App'in yazdığı köprü) açar, durdurur, parça değiştirir. */
export function DeskRadio() {
  const b = useMusicBridge();
  return (
    <div className="dk-obj dk-radio" aria-label="Radyo">
      <span className="dk-lbl">Radyo</span>
      <div className="dk-grille" aria-hidden="true" />
      <span className="dk-name">{b ? (b.hasTracks ? (b.title || (b.playing ? 'Çalıyor' : 'Duruyor')) : 'Müzik ekranına parça ekleyin') : 'Müzik çalar hazır değil'}</span>
      <div style={{ display: 'flex', gap: 5 }}>
        <button type="button" className="dk-btn" onClick={() => b?.onPrev()} aria-label="Önceki parça" disabled={!b?.hasTracks}><SkipBack size={13} /></button>
        <button type="button" className={`dk-btn${b?.playing ? ' on' : ''}`} onClick={() => b?.onPlayPause()} aria-label={b?.playing ? 'Müziği duraklat' : 'Müziği çal'} disabled={!b?.hasTracks}>{b?.playing ? <Pause size={14} /> : <Play size={14} />}</button>
        <button type="button" className="dk-btn" onClick={() => b?.onNext()} aria-label="Sonraki parça" disabled={!b?.hasTracks}><SkipForward size={13} /></button>
      </div>
    </div>
  );
}

export default function DeskObjects() {
  return (
    <div className="dk-row" data-agent-ignore="1">
      <DeskHourglass />
      <DeskAmbient />
      <DeskRadio />
      <DeskClock />
    </div>
  );
}
