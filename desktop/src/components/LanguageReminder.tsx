import { useEffect, useMemo } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { isCapacitor } from '../services/platform';
import { LANGUAGE_LAB_NOTE_PATH, parseLabState, minutesToday, todayKey } from '../services/languageLab';

export const LANGUAGE_REMINDER_NOTIFICATION_ID = 7700001;
const CHANNEL_ID = 'language_lab';
const NOTIFIED_KEY = 'lang_lab_notified';

export default function LanguageReminder({ fileContents }: { fileContents: Record<string, string> }) {
  const raw = fileContents[LANGUAGE_LAB_NOTE_PATH];
  const state = useMemo(() => parseLabState(raw), [raw]);
  const { enabled, time, goalMinutes } = state.plan;
  const language = state.language;
  const doneToday = minutesToday(state) >= goalMinutes;

  useEffect(() => {
    if (!isCapacitor) return;
    (async () => {
      try {
        await LocalNotifications.cancel({ notifications: [{ id: LANGUAGE_REMINDER_NOTIFICATION_ID }] });
        if (!enabled || !language) return;
        let perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
        if (perm.display !== 'granted') return;
        try {
          await LocalNotifications.createChannel({ id: CHANNEL_ID, name: 'Dil Atölyesi', importance: 4, vibration: true, visibility: 1 });
        } catch { /* kanal zaten var */ }
        const [hour, minute] = time.split(':').map(Number);
        await LocalNotifications.schedule({
          notifications: [{
            id: LANGUAGE_REMINDER_NOTIFICATION_ID,
            title: '🌍 Dil Atölyesi',
            body: `Bugünkü hedefin ${goalMinutes} dk. ${language} için biraz input zamanı.`,
            schedule: { on: { hour, minute }, allowWhileIdle: true },
            channelId: CHANNEL_ID
          }]
        });
      } catch (e) {
        console.error('Dil Atölyesi hatırlatması kurulamadı:', e);
      }
    })();
  }, [enabled, time, goalMinutes, language]);

  useEffect(() => {
    if (isCapacitor || !enabled || !language || typeof Notification === 'undefined') return;
    const tick = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (hhmm < time || doneToday) return;
      try {
        if (localStorage.getItem(NOTIFIED_KEY) === todayKey()) return;
        if (Notification.permission === 'default') { Notification.requestPermission(); return; }
        if (Notification.permission !== 'granted') return;
        localStorage.setItem(NOTIFIED_KEY, todayKey());
        new Notification('🌍 Dil Atölyesi', { body: `Bugünkü hedefin ${goalMinutes} dk. ${language} için biraz input zamanı.` });
      } catch { /* bildirim desteklenmiyor */ }
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [enabled, time, goalMinutes, language, doneToday]);

  return null;
}
