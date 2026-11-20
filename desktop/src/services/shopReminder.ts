// Telefonda haftalık hatırlatma: her Pazartesi 09:00 "bu haftanın alışveriş listesi". Yerel bildirim (internet gerekmez).
// Masaüstünde desteklenmez (arka planda çalışan zamanlayıcı yok); uygulama açılınca zaten bu haftanın notu oluşur.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const KEY = 'shop_reminder_v1';
const NOTIF_ID = 7301;
const CHANNEL = 'shopping_v1';

export const reminderSupported = (): boolean => Capacitor.isNativePlatform();
export const isReminderOn = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* yoksay */ } };

export async function setReminder(on: boolean): Promise<{ ok: boolean; msg: string }> {
  if (!reminderSupported()) return { ok: false, msg: 'Hatırlatma yalnızca telefon uygulamasında çalışır.' };
  try {
    if (!on) { await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID }] }); remember(false); return { ok: true, msg: 'Hatırlatma kapatıldı.' }; }
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return { ok: false, msg: 'Bildirim izni verilmedi; telefon ayarlarından izin verin.' };
    try { await LocalNotifications.createChannel({ id: CHANNEL, name: 'Alışveriş', importance: 3, vibration: false, visibility: 1 }); } catch { /* zaten var */ }
    // Capacitor: weekday 1=Pazar … 7=Cumartesi; 2 = Pazartesi
    await LocalNotifications.schedule({
      notifications: [{ id: NOTIF_ID, title: 'Alışveriş listesi', body: 'Yeni hafta başladı: bu haftanın alışveriş listesini hazırlayın.', channelId: CHANNEL, schedule: { on: { weekday: 2, hour: 9, minute: 0 }, allowWhileIdle: true } }]
    });
    remember(true);
    return { ok: true, msg: 'Her Pazartesi 09:00\'da hatırlatılacak.' };
  } catch (e: any) { return { ok: false, msg: `Hatırlatma ayarlanamadı: ${e?.message || e}` }; }
}
