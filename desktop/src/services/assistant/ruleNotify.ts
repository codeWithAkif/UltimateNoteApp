// Otomasyon kuralları ve hatırlatmalar için telefonda ZAMANLANMIŞ yerel bildirimler (uygulama kapalıyken de çalışır).
// Masaüstünde zamanlanmış bildirim yoktur: kurallar uygulama açıkken çalıştırıcı tarafından, kapalıyken kaçanlar açılışta gösterilir.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { type Rule, occurrencesBetween } from './automation';
import { screenById } from './assistantAI';

const CHANNEL = 'automation_v1';
const BASE_ID = 8000, MAX = 190;           // kurallar için ayrılmış bildirim kimlikleri 8000-8189
const REMINDER_BASE = 8200;                 // tek seferlik hatırlatmalar 8200+ (zaman damgasından türetilir)

export const nativeScheduling = (): boolean => Capacitor.isNativePlatform();

const ensureChannel = async () => { try { await LocalNotifications.createChannel({ id: CHANNEL, name: 'Otomasyon ve hatırlatmalar', importance: 4, vibration: true, visibility: 1 }); } catch { /* zaten var */ } };

const ruleBody = (r: Rule): { title: string; body: string } =>
  r.eylem.tur === 'bildir' ? { title: r.eylem.baslik, body: r.eylem.mesaj || r.ad } : { title: r.ad, body: r.eylem.mesaj || `${screenById(r.eylem.ekran)?.ad || r.eylem.ekran} ekranını açın` };

// Önümüzdeki 14 günün kural zamanlarını yeniden planlar (eskileri iptal eder)
export async function syncNativeRules(rules: Rule[], now: Date = new Date()): Promise<{ ok: boolean; n: number; msg?: string }> {
  if (!nativeScheduling()) return { ok: false, n: 0, msg: 'Zamanlanmış bildirim yalnızca telefon uygulamasında çalışır.' };
  try {
    await LocalNotifications.cancel({ notifications: Array.from({ length: MAX }, (_, i) => ({ id: BASE_ID + i })) });
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return { ok: false, n: 0, msg: 'Bildirim izni yok.' };
    await ensureChannel();
    const end = new Date(now.getTime() + 14 * 86400000);
    const items: { id: number; title: string; body: string; channelId: string; schedule: { at: Date; allowWhileIdle: boolean } }[] = [];
    for (const r of rules) {
      if (!r.acik) continue;
      for (const at of occurrencesBetween(r.sched, now, end, 20)) {
        if (items.length >= MAX) break;
        const { title, body } = ruleBody(r);
        items.push({ id: BASE_ID + items.length, title, body, channelId: CHANNEL, schedule: { at, allowWhileIdle: true } });
      }
    }
    if (items.length) await LocalNotifications.schedule({ notifications: items });
    return { ok: true, n: items.length };
  } catch (e: any) { return { ok: false, n: 0, msg: String(e?.message || e) }; }
}

// Tek seferlik hatırlatma (ör. "yarın 09:00 annemi ara")
export async function scheduleReminderNative(title: string, body: string, at: Date): Promise<boolean> {
  if (!nativeScheduling()) return false;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return false;
    await ensureChannel();
    await LocalNotifications.schedule({ notifications: [{ id: REMINDER_BASE + (Math.floor(at.getTime() / 60000) % 700), title, body, channelId: CHANNEL, schedule: { at, allowWhileIdle: true } }] });
    return true;
  } catch { return false; }
}
