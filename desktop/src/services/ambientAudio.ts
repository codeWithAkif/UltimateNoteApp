// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Ortam seslerinin uygulama genelinde ve arka planda kesintisiz çalması için 
// HTML5 Audio nesnelerini tarayıcı bellek ömrü boyunca saklayan global singleton ses servisi.

class AmbientAudioService {
  private audios: Record<string, HTMLAudioElement> = {};
  private playingMap: Record<string, boolean> = {};
  private volumeMap: Record<string, number> = {};
  private isGlobalPlaying = false;
  private isMuted = false;
  private masterVolume = 0.8;
  private listeners: (() => void)[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    const sounds = [
      { id: 'rain', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/rain.mp3' },
      { id: 'thunder', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/thunder.mp3' },
      { id: 'campfire', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/campfire.mp3' },
      { id: 'wind', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/wind.mp3' },
      { id: 'river', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/river.mp3' },
      { id: 'forest', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/forest.mp3' },
      { id: 'night', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/night.mp3' },
      { id: 'waves', url: 'https://raw.githubusercontent.com/laurakalbag/whitenoise-demo/master/waves.mp3' },
      { id: 'space', url: 'https://raw.githubusercontent.com/akankshavm22/Solar-System-Simulator/main/sounds/space_ambient.mp3' },
      { id: 'train', url: 'https://raw.githubusercontent.com/karthiknvd/noctune/main/sounds/train.mp3' }
    ];

    sounds.forEach(sound => {
      const audio = new Audio(sound.url);
      audio.loop = true;
      audio.volume = 0.25;
      this.audios[sound.id] = audio;
      this.playingMap[sound.id] = false;
      this.volumeMap[sound.id] = 0.5;
    });
  }

  // Durum değişikliklerini dinlemek isteyen arayüz bileşenleri için abone olma metodu
  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  public getState() {
    return {
      playingMap: this.playingMap,
      volumeMap: this.volumeMap,
      isGlobalPlaying: this.isGlobalPlaying,
      isMuted: this.isMuted,
      masterVolume: this.masterVolume
    };
  }

  // Belirli bir sesi açma / kapatma (toggle)
  public toggleSound(id: string) {
    this.playingMap[id] = !this.playingMap[id];
    if (this.playingMap[id]) {
      this.isGlobalPlaying = true;
    }
    this.updateAudioPlayback();
    this.notify();
  }

  // Belirli bir ses kaynağının ses seviyesini ayarlama
  public setVolume(id: string, vol: number) {
    this.volumeMap[id] = vol;
    this.updateAudioPlayback();
    this.notify();
  }

  // Global oynatma durumunu değiştirme
  public setGlobalPlaying(playing: boolean) {
    this.isGlobalPlaying = playing;
    this.updateAudioPlayback();
    this.notify();
  }

  // Susturma (Mute) kontrolü
  public setMuted(muted: boolean) {
    this.isMuted = muted;
    this.updateAudioPlayback();
    this.notify();
  }

  // Master (Ana) ses kontrolü
  public setMasterVolume(vol: number) {
    this.masterVolume = vol;
    this.updateAudioPlayback();
    this.notify();
  }

  // Hazır ses karışımı (preset) uygulama
  public applyPreset(volumes: Record<string, number>) {
    Object.keys(this.playingMap).forEach(id => {
      const vol = volumes[id];
      if (vol !== undefined && vol > 0) {
        this.playingMap[id] = true;
        this.volumeMap[id] = vol;
      } else {
        this.playingMap[id] = false;
        this.volumeMap[id] = 0;
      }
    });
    this.isGlobalPlaying = true;
    this.isMuted = false;
    this.updateAudioPlayback();
    this.notify();
  }

  // Tüm sesleri durdurma
  public stopAll() {
    this.isGlobalPlaying = false;
    Object.keys(this.playingMap).forEach(id => {
      this.playingMap[id] = false;
    });
    this.updateAudioPlayback();
    this.notify();
  }

  // Arka plandaki HTML5 Audio nesnelerinin ses ve çalma durumunu senkronize eden motor
  private updateAudioPlayback() {
    Object.keys(this.audios).forEach(id => {
      const audio = this.audios[id];
      if (!audio) return;
      const isSoundPlaying = this.playingMap[id];
      const targetVol = this.volumeMap[id] !== undefined ? this.volumeMap[id] : 0.5;

      audio.volume = targetVol * this.masterVolume * (this.isMuted ? 0 : 1);

      if (this.isGlobalPlaying && isSoundPlaying && !this.isMuted) {
        audio.play().catch(e => console.log('Arka plan ses çalma hatası:', e));
      } else {
        audio.pause();
      }
    });
  }
}

export const ambientAudioService = new AmbientAudioService();
