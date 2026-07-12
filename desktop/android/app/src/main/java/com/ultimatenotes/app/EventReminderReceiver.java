package com.ultimatenotes.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

public class EventReminderReceiver extends BroadcastReceiver {
    public static final String CHANNEL_ID = "event_countdown_channel";

    @Override
    public void onReceive(Context context, Intent intent) {
        String eventId = intent.getStringExtra("event_id");
        String eventTitle = intent.getStringExtra("event_title");
        long eventTimeMs = intent.getLongExtra("event_time_ms", 0);

        if (eventTimeMs == 0 || eventTitle == null) return;

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Etkinlik Geri Sayımı",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Yaklaşan etkinlikler için canlı geri sayım bildirimi");
            manager.createNotificationChannel(channel);
        }

        int iconRes = context.getApplicationInfo().icon;

        int notificationId = eventId != null ? eventId.hashCode() : (int) (eventTimeMs / 1000);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.service.notification.StatusBarNotification[] activeNotifications = manager.getActiveNotifications();
            if (activeNotifications != null) {
                for (android.service.notification.StatusBarNotification sbn : activeNotifications) {
                    if (sbn.getId() == notificationId) {
                        return;
                    }
                }
            }
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(iconRes != 0 ? iconRes : android.R.drawable.ic_dialog_info)
            .setContentTitle("Yaklaşan Etkinlik ⏳")
            .setContentText(eventTitle)
            .setWhen(eventTimeMs)
            .setUsesChronometer(true)
            .setShowWhen(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.setChronometerCountDown(true);
        }

        manager.notify(notificationId, builder.build());
    }
}
