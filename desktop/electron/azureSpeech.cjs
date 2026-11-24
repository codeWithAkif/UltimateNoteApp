// Azure AI Speech (Neural) ile sesli okuma. Anahtar işletim sisteminin korumalı deposunda (safeStorage) saklanır ve arayüze ASLA geri dönmez;
// istek bu süreçten yapılır, arayüz yalnızca üretilen sesi alır. Metin yalnızca bu istekle Microsoft'a gider.
const VOICES = { 'tr-TR-AhmetNeural': 1, 'tr-TR-EmelNeural': 1 };

function register({ ipcMain, app, safeStorage, net, fs, path }) {
  const file = () => path.join(app.getPath('userData'), 'azure-speech.enc');
  const read = () => {
    try {
      if (!fs.existsSync(file()) || !safeStorage.isEncryptionAvailable()) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
    } catch { return null; }
  };
  // Portal "Germany West Central" gösterse de API bölge kimliği "germanywestcentral"tır
  const normRegion = (r) => String(r || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const esc = (s) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

  ipcMain.handle('azure-speech-save', async (_e, cfg) => {
    let key = cfg && typeof cfg.key === 'string' ? cfg.key.trim() : '';
    const old = read();
    if (!key && old) key = old.key; // anahtar boş bırakılırsa kayıtlı olan korunur (yalnızca bölge/ses değişsin)
    const region = normRegion(cfg && cfg.region);
    const voice = cfg && VOICES[cfg.voice] ? cfg.voice : 'tr-TR-AhmetNeural';
    if (key.length < 20 || key.length > 200 || /\s/.test(key)) return { ok: false, error: 'Anahtar geçersiz görünüyor. Azure portalında "Anahtarlar ve Uç Nokta" sayfasındaki KEY 1 değerini yapıştırın.' };
    if (!/^[a-z0-9]{3,30}$/.test(region)) return { ok: false, error: 'Bölge geçersiz. Örnek: germanywestcentral' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Bu sistemde şifreli depolama kullanılamıyor; anahtar saklanmadı.' };
    fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify({ key, region, voice })));
    return { ok: true };
  });
  ipcMain.handle('azure-speech-status', async () => {
    const c = read();
    return { has: !!c, region: c ? c.region : '', voice: c ? c.voice : '' };
  });
  ipcMain.handle('azure-speech-clear', async () => {
    try { if (fs.existsSync(file())) fs.unlinkSync(file()); } catch { /* yoksay */ }
    return { ok: true };
  });
  ipcMain.handle('azure-speech-speak', async (_e, text) => {
    const c = read();
    if (!c) return { ok: false, error: 'Azure ses anahtarı kayıtlı değil.' };
    const t = typeof text === 'string' ? text.trim().slice(0, 1500) : '';
    if (!t) return { ok: false, error: 'Okunacak metin boş.' };
    const ssml = `<speak version='1.0' xml:lang='tr-TR'><voice xml:lang='tr-TR' name='${c.voice}'>${esc(t)}</voice></speak>`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await net.fetch(`https://${c.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': c.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'UltimateNoteFactory' },
        body: ssml,
        signal: ctl.signal,
      });
      if (!res.ok) {
        const why = res.status === 401 || res.status === 403 ? 'Azure anahtarı ya da bölge hatalı olabilir.' : res.status === 429 ? 'Azure ücretsiz kotası doldu ya da istek sınırına takıldı.' : `Azure ${res.status} hatası verdi.`;
        return { ok: false, error: why };
      }
      return { ok: true, base64: Buffer.from(await res.arrayBuffer()).toString('base64'), mime: 'audio/mpeg' };
    } catch (e) {
      return { ok: false, error: e && e.name === 'AbortError' ? 'Azure yanıt vermedi (zaman aşımı).' : 'Azure\'a ulaşılamadı. İnternet bağlantısını denetleyin.' };
    } finally { clearTimeout(to); }
  });
}

module.exports = { register };
