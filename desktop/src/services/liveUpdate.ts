import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Mobil (Android/Capacitor) ortamında uygulamanın her açılışında GitHub Releases API'ye
// sorgu atarak yeni bir `dist.zip` web paketi yayınlanıp yayınlanmadığını kontrol eder.
// Yeni sürüm varsa arka planda indirip Capacitor webview'ını günceller.
export async function initLiveUpdates(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    await CapacitorUpdater.notifyAppReady();

    const response = await fetch('https://api.github.com/repos/codeWithAkif/UltimateNoteApp/releases/latest', {
      headers: { Accept: 'application/vnd.github.v3+json' }
    });

    if (!response.ok) return;

    const data = await response.json();
    const latestTag = data.tag_name ? data.tag_name.replace(/^v/, '') : null;
    if (!latestTag) return;

    const currentBundle = await CapacitorUpdater.current();
    const currentVersion = currentBundle?.bundle?.version || '1.0.0';

    if (latestTag !== currentVersion) {
      const zipAsset = data.assets?.find((a: any) => a.name === 'dist.zip' || a.name.endsWith('.zip'));
      if (zipAsset && zipAsset.browser_download_url) {
        console.log(`[LiveUpdate] New web bundle v${latestTag} found. Downloading...`);
        const downloadedVersion = await CapacitorUpdater.download({
          url: zipAsset.browser_download_url,
          version: latestTag
        });
        if (downloadedVersion) {
          console.log(`[LiveUpdate] Applying new web bundle v${latestTag}`);
          await CapacitorUpdater.set(downloadedVersion);
        }
      }
    }
  } catch (err) {
    console.error('[LiveUpdate Error]:', err);
  }
}
