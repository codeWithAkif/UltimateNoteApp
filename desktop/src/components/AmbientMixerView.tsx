import React, { useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Headphones, Music } from 'lucide-react';
import { ambientAudioService } from '../services/ambientAudio';

interface SoundItem {
  id: string;
  name: string;
  emoji: string;
  url: string;
  color: string;
  desc: string;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Mikserde kullanılacak 10 adet yüksek kaliteli, CORS destekli (GitHub Raw) ve kararlı ortam seslerinin listesi.
const SOUNDS: SoundItem[] = [
  {
    id: 'rain',
    name: 'Yağmur',
    emoji: '🌧️',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/rain.mp3',
    color: '#3b82f6',
    desc: 'Rahatlatıcı, kesintisiz yaz yağmuru ve gri gökyüzü uğultusu.'
  },
  {
    id: 'thunder',
    name: 'Gök Gürültüsü',
    emoji: '⚡',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/thunder.mp3',
    color: '#fbbf24',
    desc: 'Uzaktan gelen derin, yankılı fırtına ve yıldırım uğultuları.'
  },
  {
    id: 'campfire',
    name: 'Kamp Ateşi',
    emoji: '🔥',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/campfire.mp3',
    color: '#ef4444',
    desc: 'Odunların çıtırdadığı sıcak ve samimi gece kamp ateşi.'
  },
  {
    id: 'wind',
    name: 'Orman Rüzgarı',
    emoji: '🌲',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/wind.mp3',
    color: '#10b981',
    desc: 'Çam dalları arasından esen loş ve fısıltılı rüzgarlar.'
  },
  {
    id: 'river',
    name: 'Dere Şırıltısı',
    emoji: '🏞️',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/river.mp3',
    color: '#06b6d4',
    desc: 'Zihni tazeleyen tatlı akarsu ve nehir uğultusu.'
  },
  {
    id: 'forest',
    name: 'Orman Kuşları',
    emoji: '🌳',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/forest.mp3',
    color: '#059669',
    desc: 'Kuş cıvıltıları ve hışırdayan yapraklarla huzurlu orman havası.'
  },
  {
    id: 'night',
    name: 'Gece Doğası',
    emoji: '🦉',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/night.mp3',
    color: '#475569',
    desc: 'Ağustos böcekleri ve loş gece cırcır böcekleri uğultusu.'
  },
  {
    id: 'waves',
    name: 'Okyanus Dalgaları',
    emoji: '🌊',
    url: 'https://raw.githubusercontent.com/laurakalbag/whitenoise-demo/master/waves.mp3',
    color: '#0ea5e9',
    desc: 'Sahile vuran dinlendirici ve ritmik okyanus dalgaları.'
  },
  {
    id: 'space',
    name: 'Kozmik Uğultu',
    emoji: '🌌',
    url: 'https://raw.githubusercontent.com/akankshavm22/Solar-System-Simulator/main/sounds/space_ambient.mp3',
    color: '#a78bfa',
    desc: 'Uzay boşluğunun meditatif ve odaklayıcı derin synthwave uğultusu.'
  },
  {
    id: 'train',
    name: 'Gece Treni',
    emoji: '🚂',
    url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/train.mp3',
    color: '#8b5cf6',
    desc: 'Raylar üzerinde ilerleyen trenin loş ve ritmik uğultusu.'
  }
];

interface Preset {
  name: string;
  emoji: string;
  volumes: Record<string, number>;
}

const PRESETS: Preset[] = [
  {
    name: 'Fırtınalı Gece',
    emoji: '⛈️',
    volumes: { rain: 0.8, thunder: 0.5, wind: 0.3 }
  },
  {
    name: 'Kamp Ateşi Başında',
    emoji: '🏕️',
    volumes: { campfire: 0.8, wind: 0.2, forest: 0.4 }
  },
  {
    name: 'Gece Treni Yolculuğu',
    emoji: '🚂',
    volumes: { train: 0.75, rain: 0.3, night: 0.2 }
  },
  {
    name: 'Okyanus Kafesi',
    emoji: '🏖️',
    volumes: { waves: 0.75, forest: 0.2, wind: 0.1 }
  },
  {
    name: 'Kozmik Fırtına',
    emoji: '🌌',
    volumes: { space: 0.8, wind: 0.3, thunder: 0.3 }
  }
];

export default function AmbientMixerView() {
  const [syncState, setSyncState] = useState(() => ambientAudioService.getState());

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Global ses servisinin durum değişikliklerini dinler (abone olur) ve arayüzü günceller.
  useEffect(() => {
    const unsubscribe = ambientAudioService.subscribe(() => {
      setSyncState(ambientAudioService.getState());
    });
    return () => unsubscribe();
  }, []);

  const { playingMap, volumeMap, isGlobalPlaying, isMuted, masterVolume } = syncState;

  const toggleSound = (id: string) => {
    ambientAudioService.toggleSound(id);
  };

  const handleVolumeChange = (id: string, vol: number) => {
    ambientAudioService.setVolume(id, vol);
  };

  const handleStopAll = () => {
    ambientAudioService.stopAll();
  };

  const applyPreset = (preset: Preset) => {
    ambientAudioService.applyPreset(preset.volumes);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px', boxSizing: 'border-box', background: 'var(--bg-main)', overflowY: 'auto' }}>
      
      {/* Header */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-main)' }}>
            <Headphones style={{ color: 'var(--accent)' }} /> Ortam Sesi Mikseri
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Ders çalışırken veya kod yazarken kendi arka plan atmosferinizi oluşturun ve odaklanmanızı artırın.
          </p>
        </div>

        {/* Global Controls */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(15, 23, 42, 0.4)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px',
          padding: '8px 16px',
          backdropFilter: 'blur(8px)'
        }}>
          <button
            onClick={() => ambientAudioService.setGlobalPlaying(!isGlobalPlaying)}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: '99px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#fff'
            }}
            title={isGlobalPlaying ? 'Tümünü Duraklat' : 'Tümünü Oynat'}
          >
            {isGlobalPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: '2px' }} />}
          </button>

          <button
            onClick={() => ambientAudioService.setMuted(!isMuted)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: 'none',
              borderRadius: '99px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: isMuted ? '#ef4444' : 'var(--text-main)'
            }}
            title={isMuted ? 'Sesi Aç' : 'Sesi Sustur'}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Genel:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={masterVolume}
              onChange={(e) => ambientAudioService.setMasterVolume(parseFloat(e.target.value))}
              style={{
                width: '80px',
                accentColor: 'var(--accent)',
                cursor: 'pointer'
              }}
            />
          </div>

          <button
            onClick={handleStopAll}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f87171',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px'
            }}
          >
            <RotateCcw size={12} /> Sıfırla
          </button>
        </div>
      </div>

      {/* Main Grid Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Presets Row */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Music size={14} style={{ color: 'var(--accent)' }} /> Hazır Atmosfer Ön Ayarları
          </h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {PRESETS.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => applyPreset(preset)}
                style={{
                  background: 'rgba(15, 23, 42, 0.3)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '10px',
                  padding: '10px 16px',
                  color: '#fff',
                  fontSize: '12.5px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s',
                  backdropFilter: 'blur(12px)'
                }}
                className="ambient-preset-btn"
              >
                <span>{preset.emoji}</span>
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sound Mixer Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px'
        }}>
          {SOUNDS.map(sound => {
            const isPlaying = playingMap[sound.id] || false;
            const currentVol = volumeMap[sound.id] !== undefined ? volumeMap[sound.id] : 0.5;

            return (
              <div
                key={sound.id}
                style={{
                  background: isPlaying ? 'rgba(30, 41, 59, 0.45)' : 'rgba(15, 23, 42, 0.25)',
                  border: `1px solid ${isPlaying ? sound.color : 'rgba(255,255,255,0.05)'}`,
                  borderRadius: '16px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.3s',
                  boxShadow: isPlaying ? `0 4px 20px -5px ${sound.color}33` : 'none'
                }}
              >
                {isPlaying && isGlobalPlaying && !isMuted && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0, left: 0, right: 0,
                    height: '3px',
                    background: `linear-gradient(90deg, transparent, ${sound.color}, transparent)`,
                    opacity: 0.6
                  }}
                  className="ambient-wave"
                  />
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '24px' }}>{sound.emoji}</span>
                    <div>
                      <strong style={{ fontSize: '14.5px', color: '#fff', display: 'block' }}>{sound.name}</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ortam Elementi</span>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleSound(sound.id)}
                    style={{
                      background: isPlaying ? sound.color : 'rgba(255,255,255,0.04)',
                      border: 'none',
                      borderRadius: '99px',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: isPlaying ? '#fff' : 'var(--text-main)',
                      transition: 'all 0.2s'
                    }}
                  >
                    {isPlaying ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: '1px' }} />}
                  </button>
                </div>

                <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4, minHeight: '32px' }}>
                  {sound.desc}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '30px' }}>
                    {Math.round(currentVol * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={currentVol}
                    onChange={(e) => handleVolumeChange(sound.id, parseFloat(e.target.value))}
                    disabled={!isPlaying}
                    style={{
                      flex: 1,
                      accentColor: sound.color,
                      cursor: isPlaying ? 'pointer' : 'not-allowed',
                      opacity: isPlaying ? 1 : 0.4,
                      transition: 'opacity 0.2s'
                    }}
                  />
                </div>

              </div>
            );
          })}
        </div>

      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes ambientWave {
          0% { transform: scaleX(0.7); opacity: 0.3; }
          50% { transform: scaleX(1.1); opacity: 0.8; }
          100% { transform: scaleX(0.7); opacity: 0.3; }
        }
        .ambient-wave {
          animation: ambientWave 1.8s ease-in-out infinite;
        }
        .ambient-preset-btn:hover {
          background: rgba(255, 255, 255, 0.05) !important;
          border-color: var(--accent) !important;
        }
      `}} />

    </div>
  );
}
