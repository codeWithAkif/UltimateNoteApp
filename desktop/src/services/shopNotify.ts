// Anında bildirim (hedef fiyat uyarısı gibi): telefonda yerel bildirim, masaüstünde (izin verilmişse) sistem bildirimi.
// İzin yalnızca kullanıcı bir hedef fiyat koyduğunda istenir (requestNotifyPermission). Bildirim gidemese bile uyarı ekranda banner olarak görünür.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const CHANNEL = 'shopping_v1';
const baseId = () => 7400 + Math.floor(Math.random() * 500);

export async function requestNotifyPermission(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      let p = await LocalNotifications.checkPermissions();
      if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
      return p.display === 'granted';
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch { return false; }
}

export async function notifyNow(title: string, body: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const p = await LocalNotifications.checkPermissions();
      if (p.display !== 'granted') return false;
      try { await LocalNotifications.createChannel({ id: CHANNEL, name: 'Alışveriş', importance: 3, vibration: false, visibility: 1 }); } catch { /* zaten var */ }
      await LocalNotifications.schedule({ notifications: [{ id: baseId(), title, body, channelId: CHANNEL, schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true } }] });
      return true;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { new Notification(title, { body }); return true; }
  } catch { /* yoksay */ }
  return false;
}
