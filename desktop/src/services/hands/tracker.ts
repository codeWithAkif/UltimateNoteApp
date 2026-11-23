// El kontrolü · kamera ve MediaPipe el takibi. Her şey bu cihazda çalışır: kamera kareleri hiçbir yere gönderilmez,
// model ve wasm dosyaları uygulamayla birlikte gelir (public/mediapipe), internet gerekmez.
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { P } from './gestures';

// base './' (Electron'da file://) ve geliştirme sunucusu için sayfanın kendi adresine göre çözülür
const asset = (p: string) => new URL(`mediapipe/${p}`, document.baseURI).href;

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, // düşük çözünürlük: model zaten küçültür, kare başı iş azalır
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try { await video.play(); }
  catch (e) {
    // Aynı video öğesine ikinci akış bağlanırsa play() iptal edilir; bu bir kamera hatası değil
    if ((e as Error)?.name !== 'AbortError') { stream.getTracks().forEach(t => t.stop()); throw e; }
  }
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  return stream;
}

// Model bir kez yüklenir ve masa kapanınca da bellekte kalır: her açışta yeniden yükleme beklenmez
let cached: Promise<{ lm: HandLandmarker; delegate: 'GPU' | 'CPU' }> | null = null;
let ready = false;
export const landmarkerReady = () => ready;
export function loadLandmarker(): Promise<{ lm: HandLandmarker; delegate: 'GPU' | 'CPU' }> {
  if (!cached) cached = loadLandmarkerOnce().then(r => { ready = true; return r; }, e => { cached = null; throw e; });
  return cached;
}

async function loadLandmarkerOnce(): Promise<{ lm: HandLandmarker; delegate: 'GPU' | 'CPU' }> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks(asset('wasm'));
  const make = (delegate: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: asset('hand_landmarker.task'), delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6, // arka plandaki yüz ve lamba gibi sahte eller bu eşikte elenir
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try { return { lm: await make('GPU'), delegate: 'GPU' }; }
  catch (e) { console.warn('[el] GPU açılamadı, CPU ile devam', e); return { lm: await make('CPU'), delegate: 'CPU' }; }
}

/** Video noktasını (0..1) ekran pikseline çevirir: object-fit: cover ve ayna (sağ el ekranda sağda görünür). */
export const makeMapper = (vw: number, vh: number, W: number, H: number) => {
  const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
  return (u: number, v: number): P => ({ x: W - (ox + u * dw), y: oy + v * dh });
};

/** Bir kare için ekran pikselinde el noktaları. Çok küçük algılar (kare genişliğinin %2.5'inden az) arka plan gürültüsü sayılır. */
export function detect(lm: HandLandmarker, video: HTMLVideoElement, ts: number, W: number, H: number): P[][] {
  const res = lm.detectForVideo(video, ts);
  const map = makeMapper(video.videoWidth, video.videoHeight, W, H);
  return res.landmarks
    .filter(pts => Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y) > 0.025)
    .map(pts => pts.map(q => ({ ...map(q.x, q.y), z: q.z })));
}
