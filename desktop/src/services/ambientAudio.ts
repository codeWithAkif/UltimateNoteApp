// Ortam sesleri artık dışarıdan mp3 indirilmeden, Web Audio ile uygulamanın İÇİNDE üretilir (sentez).
// Neden: üçüncü taraf GitHub bağlantıları kırılabiliyor ve internet gerektiriyordu; sentez çevrimdışı çalışır, dosya yok.
// Servisin dışa açık API'si (toggleSound/setVolume/applyPreset…) eskisiyle aynı kalır; mikser ekranı ve Asistan aynı servisi kullanır.

export const AMBIENT_SOUNDS: { id: string; name: string }[] = [
  { id: 'rain', name: 'Yağmur' }, { id: 'thunder', name: 'Gök Gürültüsü' }, { id: 'campfire', name: 'Kamp Ateşi' },
  { id: 'wind', name: 'Orman Rüzgarı' }, { id: 'river', name: 'Dere Şırıltısı' }, { id: 'forest', name: 'Orman Kuşları' },
  { id: 'night', name: 'Gece Doğası' }, { id: 'waves', name: 'Okyanus Dalgaları' }, { id: 'space', name: 'Kozmik Uğultu' }, { id: 'train', name: 'Gece Treni' }
];
export const AMBIENT_PRESETS: { name: string; emoji: string; volumes: Record<string, number> }[] = [
  { name: 'Fırtınalı Gece', emoji: '⛈️', volumes: { rain: 0.8, thunder: 0.5, wind: 0.3 } },
  { name: 'Kamp Ateşi Başında', emoji: '🏕️', volumes: { campfire: 0.8, wind: 0.2, forest: 0.4 } },
  { name: 'Gece Treni Yolculuğu', emoji: '🚂', volumes: { train: 0.75, rain: 0.3, night: 0.2 } },
  { name: 'Okyanus Kafesi', emoji: '🏖️', volumes: { waves: 0.75, forest: 0.2, wind: 0.1 } },
  { name: 'Kozmik Fırtına', emoji: '🌌', volumes: { space: 0.8, wind: 0.3, thunder: 0.3 } }
];

type Noise = 'white' | 'pink' | 'brown';

// Çalışan bir sesin grafiği: çıkış düğümü + kapatırken durdurulacak kaynaklar ve zamanlayıcılar.
interface Voice { out: GainNode; sources: (AudioScheduledSourceNode)[]; timers: ReturnType<typeof setTimeout>[]; dead: boolean }

class AmbientAudioService {
  private ctx: AudioContext | null = null;
  private noiseBufs: Partial<Record<Noise, AudioBuffer>> = {};
  private voices: Record<string, Voice> = {};
  private playingMap: Record<string, boolean> = {};
  private volumeMap: Record<string, number> = {};
  private isGlobalPlaying = false;
  private isMuted = false;
  private masterVolume = 0.8;
  private listeners: (() => void)[] = [];

  constructor() {
    AMBIENT_SOUNDS.forEach(s => { this.playingMap[s.id] = false; this.volumeMap[s.id] = 0.5; });
  }

  // ---------------- Web Audio altyapısı ----------------
  private getCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined = typeof window !== 'undefined' ? ((window as any).AudioContext || (window as any).webkitAudioContext) : undefined;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  // 5 sn'lik gürültü tamponları bir kez üretilir; döngüde çalınır (gürültüde döngü izi duyulmaz).
  private noise(kind: Noise): AudioBuffer {
    const ctx = this.ctx!;
    const cached = this.noiseBufs[kind];
    if (cached) return cached;
    const len = ctx.sampleRate * 5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    this.noiseBufs[kind] = buf;
    return buf;
  }

  private src(v: Voice, kind: Noise): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise(kind); s.loop = true;
    // Aynı tampon her seste farklı noktadan başlasın (iki katman birbirine kilitlenmesin).
    s.start(0, Math.random() * 4);
    v.sources.push(s);
    return s;
  }
  private filt(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f;
  }
  private gain(val: number): GainNode { const g = this.ctx!.createGain(); g.gain.value = val; return g; }
  // Yavaş salınım: hedef parametreye (ör. filtre frekansı, kazanç) depth kadar ekler.
  private lfo(v: Voice, rate: number, depth: number, target: AudioParam) {
    const o = this.ctx!.createOscillator(); o.frequency.value = rate;
    const g = this.gain(depth); o.connect(g); g.connect(target); o.start(); v.sources.push(o);
  }
  // Rastgele aralıklarla olay üreten zamanlayıcı (ses kapanınca temizlenir).
  private every(v: Voice, minMs: number, maxMs: number, fn: (t: number) => void) {
    const tick = () => {
      if (v.dead) return;
      fn(this.ctx!.currentTime + 0.02);
      v.timers.push(setTimeout(tick, minMs + Math.random() * (maxMs - minMs)));
    };
    v.timers.push(setTimeout(tick, minMs * Math.random()));
  }
  private burst(v: Voice, t: number, kind: Noise, ftype: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number) {
    const s = this.ctx!.createBufferSource(); s.buffer = this.noise(kind);
    const f = this.filt(ftype, freq, q), g = this.gain(0);
    s.connect(f); f.connect(g); g.connect(v.out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.start(t, Math.random() * 4, attack + decay + 0.05);
  }
  private chirp(v: Voice, t: number) {
    const o = this.ctx!.createOscillator(), g = this.gain(0), base = 2200 + Math.random() * 2400, dur = 0.07 + Math.random() * 0.11;
    o.type = 'sine';
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.4), t + dur);
    o.connect(g); g.connect(v.out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Her ses için grafik kurar; çıkış seviyesi (trim) sesler arası yüksekliği dengeler.
  private build(id: string): Voice | null {
    const ctx = this.getCtx(); if (!ctx) return null;
    const out = this.gain(0);
    const v: Voice = { out, sources: [], timers: [], dead: false };
    const trim = this.gain(1); trim.connect(ctx.destination); out.connect(trim);
    this.voices[id] = v;
    switch (id) {
      case 'rain': { // yüksek frekanslı serpinti + alçak zemin uğultusu
        const a = this.src(v, 'white'), hp = this.filt('highpass', 900), lp = this.filt('lowpass', 9000), ga = this.gain(0.35);
        a.connect(hp); hp.connect(lp); lp.connect(ga); ga.connect(out);
        const b = this.src(v, 'pink'), lb = this.filt('lowpass', 500), gb = this.gain(0.5);
        b.connect(lb); lb.connect(gb); gb.connect(out); trim.gain.value = 0.9; break;
      }
      case 'thunder': { // sürekli uzak uğultu + rastgele gürlemeler
        const a = this.src(v, 'brown'), lp = this.filt('lowpass', 140), g = this.gain(0.3);
        a.connect(lp); lp.connect(g); g.connect(out);
        this.every(v, 7000, 17000, t => this.burst(v, t, 'brown', 'lowpass', 110 + Math.random() * 120, 0.7, 2.2, 0.25 + Math.random() * 0.4, 2.5 + Math.random() * 3));
        trim.gain.value = 1.4; break;
      }
      case 'campfire': { // alçak yanma uğultusu + çıtırtılar
        const a = this.src(v, 'brown'), lp = this.filt('lowpass', 420), g = this.gain(0.5);
        a.connect(lp); lp.connect(g); g.connect(out);
        this.every(v, 40, 380, t => this.burst(v, t, 'white', 'bandpass', 1800 + Math.random() * 3500, 2, 0.25 + Math.random() * 0.5, 0.002, 0.012 + Math.random() * 0.03));
        trim.gain.value = 1.2; break;
      }
      case 'wind': { // süpürülen bant geçiren filtre + dalgalı şiddet
        const a = this.src(v, 'pink'), bp = this.filt('bandpass', 550, 0.9), g = this.gain(0.55);
        a.connect(bp); bp.connect(g); g.connect(out);
        this.lfo(v, 0.11, 260, bp.frequency); this.lfo(v, 0.07, 0.25, g.gain); trim.gain.value = 1.8; break;
      }
      case 'river': { // iki bant: akış gövdesi + baloncuk tıngırtısı
        const a = this.src(v, 'pink'), bp = this.filt('bandpass', 850, 0.5), g = this.gain(0.7);
        a.connect(bp); bp.connect(g); g.connect(out);
        const b = this.src(v, 'white'), bp2 = this.filt('bandpass', 2600, 1.4), g2 = this.gain(0.12);
        b.connect(bp2); bp2.connect(g2); g2.connect(out);
        this.lfo(v, 0.6, 0.06, g2.gain); this.lfo(v, 0.13, 180, bp.frequency); trim.gain.value = 1.7; break;
      }
      case 'forest': { // hafif yaprak hışırtısı + kuş cıvıltıları
        const a = this.src(v, 'pink'), lp = this.filt('lowpass', 700), g = this.gain(0.16);
        a.connect(lp); lp.connect(g); g.connect(out);
        this.every(v, 1200, 5500, t => { const n = 1 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) this.chirp(v, t + i * (0.11 + Math.random() * 0.07)); });
        trim.gain.value = 2.2; break;
      }
      case 'night': { // gece zemini + cırcır böceği (genlik modülasyonlu ince tonlar)
        const a = this.src(v, 'brown'), lp = this.filt('lowpass', 260), g = this.gain(0.14);
        a.connect(lp); lp.connect(g); g.connect(out);
        [[4300, 15], [4650, 19], [3900, 12]].forEach(([f, am], i) => {
          const o = this.ctx!.createOscillator(); o.type = 'sine'; o.frequency.value = f;
          const cg = this.gain(0.012 + i * 0.002);
          o.connect(cg); cg.connect(out); o.start(); v.sources.push(o);
          this.lfo(v, am, 0.012, cg.gain); this.lfo(v, 0.08 + i * 0.03, 0.01, cg.gain);
        });
        trim.gain.value = 1.8; break;
      }
      case 'waves': { // gelip giden dalga: ~10 sn'lik yavaş şiddet salınımı
        const a = this.src(v, 'pink'), hp = this.filt('highpass', 250), lp = this.filt('lowpass', 2200), g = this.gain(0.5);
        a.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
        this.lfo(v, 0.1, 0.42, g.gain); this.lfo(v, 0.1, 700, lp.frequency); trim.gain.value = 1.4; break;
      }
      case 'space': { // detone sinüs drone'ları + yavaş soluma
        [55, 82.6, 110.4, 164.9].forEach((f, i) => {
          const o = this.ctx!.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
          const lp = this.filt('lowpass', 500), g = this.gain(0.09);
          o.connect(lp); lp.connect(g); g.connect(out); o.start(); v.sources.push(o);
          this.lfo(v, 0.04 + i * 0.017, 0.06, g.gain);
        });
        const a = this.src(v, 'pink'), lp = this.filt('lowpass', 300), g = this.gain(0.1);
        a.connect(lp); lp.connect(g); g.connect(out); trim.gain.value = 0.8; break;
      }
      case 'train': { // tekerlek uğultusu + ritmik rayların tıkırtısı (ta-tak … ta-tak)
        const a = this.src(v, 'brown'), lp = this.filt('lowpass', 480), g = this.gain(0.45);
        a.connect(lp); lp.connect(g); g.connect(out);
        const beat = 0.46; let n = 0;
        this.every(v, beat * 1000, beat * 1000, t => {
          const strong = n++ % 2 === 0;
          this.burst(v, t, 'brown', 'lowpass', 320, 1, strong ? 1.6 : 1.1, 0.004, 0.09);
          this.burst(v, t + 0.015, 'white', 'bandpass', 1400, 2, strong ? 0.22 : 0.15, 0.002, 0.04);
        });
        trim.gain.value = 1.3; break;
      }
      default: break;
    }
    return v;
  }

  private teardown(id: string) {
    const v = this.voices[id]; if (!v) return;
    delete this.voices[id];
    v.dead = true; // bekleyen zamanlayıcı tikleri artık yeni olay üretmesin
    v.timers.forEach(clearTimeout);
    const ctx = this.ctx;
    // Sert kesme "tık" yapmasın: önce kısa süreli kısılır, sonra kaynaklar durdurulur.
    try { if (ctx) { v.out.gain.cancelScheduledValues(ctx.currentTime); v.out.gain.setTargetAtTime(0, ctx.currentTime, 0.06); } } catch { /* yoksay */ }
    setTimeout(() => { v.sources.forEach(s => { try { s.stop(); } catch { /* zaten durmuş */ } }); try { v.out.disconnect(); } catch { /* yoksay */ } }, 400);
  }

  // Durum değişikliklerini dinlemek isteyen arayüz bileşenleri için abone olma metodu
  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }
  private notify() { this.listeners.forEach(l => l()); }

  public getState() {
    return { playingMap: this.playingMap, volumeMap: this.volumeMap, isGlobalPlaying: this.isGlobalPlaying, isMuted: this.isMuted, masterVolume: this.masterVolume };
  }

  public toggleSound(id: string) {
    this.playingMap[id] = !this.playingMap[id];
    if (this.playingMap[id]) this.isGlobalPlaying = true;
    this.updateAudioPlayback(); this.notify();
  }
  public setVolume(id: string, vol: number) { this.volumeMap[id] = vol; this.updateAudioPlayback(); this.notify(); }
  public setGlobalPlaying(playing: boolean) { this.isGlobalPlaying = playing; this.updateAudioPlayback(); this.notify(); }
  public setMuted(muted: boolean) { this.isMuted = muted; this.updateAudioPlayback(); this.notify(); }
  public setMasterVolume(vol: number) { this.masterVolume = vol; this.updateAudioPlayback(); this.notify(); }

  public applyPreset(volumes: Record<string, number>) {
    Object.keys(this.playingMap).forEach(id => {
      const vol = volumes[id];
      if (vol !== undefined && vol > 0) { this.playingMap[id] = true; this.volumeMap[id] = vol; }
      else { this.playingMap[id] = false; this.volumeMap[id] = 0; }
    });
    this.isGlobalPlaying = true; this.isMuted = false;
    this.updateAudioPlayback(); this.notify();
  }
  // Asistan için ekleyici ayar: yalnızca verilen sesler değişir (0 = kapat), diğerleri çalmaya devam eder.
  public adjust(volumes: Record<string, number>) {
    for (const [id, vol] of Object.entries(volumes)) {
      if (!(id in this.playingMap)) continue;
      if (vol > 0) { this.playingMap[id] = true; this.volumeMap[id] = vol; } else { this.playingMap[id] = false; }
    }
    if (Object.values(this.playingMap).some(Boolean)) { this.isGlobalPlaying = true; this.isMuted = false; }
    this.updateAudioPlayback(); this.notify();
  }
  public stopAll() {
    this.isGlobalPlaying = false;
    Object.keys(this.playingMap).forEach(id => { this.playingMap[id] = false; });
    this.updateAudioPlayback(); this.notify();
  }

  // Durum → ses grafiği: çalması gereken sesler kurulur/seviyesi ayarlanır, gerekmeyenler kapatılır (CPU tasarrufu).
  private updateAudioPlayback() {
    const ctx = this.getCtx(); if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* kullanıcı dokunuşu gerekebilir; bir sonraki dokunuşta yeniden denenir */ });
    for (const s of AMBIENT_SOUNDS) {
      const id = s.id;
      const should = this.isGlobalPlaying && this.playingMap[id] && !this.isMuted;
      if (!should) { this.teardown(id); continue; }
      const v = this.voices[id] || this.build(id);
      if (!v) continue;
      const vol = (this.volumeMap[id] ?? 0.5) * this.masterVolume;
      v.out.gain.cancelScheduledValues(ctx.currentTime);
      v.out.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
    }
  }
}

export const ambientAudioService = new AmbientAudioService();
