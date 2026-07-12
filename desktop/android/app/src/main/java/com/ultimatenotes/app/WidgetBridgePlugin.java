package com.ultimatenotes.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void refreshWidgets(PluginCall call) {
        Context context = getContext();
        
        Intent taskIntent = new Intent(context, WidgetProvider.class);
        taskIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        context.sendBroadcast(taskIntent);
        
        Intent musicIntent = new Intent(context, MusicWidgetProvider.class);
        musicIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        context.sendBroadcast(musicIntent);
        
        Intent factoryIntent = new Intent(context, NoteFactoryWidgetProvider.class);
        factoryIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        context.sendBroadcast(factoryIntent);
        
        call.resolve();
    }

    @PluginMethod
    public void sendMusicCommand(PluginCall call) {
        String cmd = call.getString("command");
        String trackPath = call.getString("track_path");
        Double volume = call.getDouble("volume");
        Context context = getContext();
        
        Intent intent = new Intent(context, BackgroundMusicService.class);
        intent.setAction("com.ultimatenotes.app.action.COMMAND");
        intent.putExtra("command", cmd);
        intent.putExtra("track_path", trackPath);
        if (volume != null) {
            intent.putExtra("volume", volume.floatValue());
        }
        
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        
        call.resolve();
    }

    @PluginMethod
    public void scheduleEventCountdowns(PluginCall call) {
        JSArray events = call.getArray("events");
        if (events == null) {
            call.reject("Events array is required");
            return;
        }

        Context context = getContext();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        try {
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                String id = event.getString("id");
                String title = event.getString("title");
                long eventTimeMs = event.getLong("eventTimeMs");
                long triggerTimeMs = eventTimeMs - 10 * 60 * 1000;
                int requestCode = id.hashCode();

                Intent intent = new Intent(context, EventReminderReceiver.class);
                intent.putExtra("event_id", id);
                intent.putExtra("event_title", title);
                intent.putExtra("event_time_ms", eventTimeMs);

                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context,
                    requestCode,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
                );

                alarmManager.cancel(pendingIntent);

                boolean completed = event.optBoolean("completed", false);
                long now = System.currentTimeMillis();
                if (eventTimeMs > now && !completed) {
                    if (triggerTimeMs > now) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (alarmManager.canScheduleExactAlarms()) {
                                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTimeMs, pendingIntent);
                            } else {
                                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerTimeMs, pendingIntent);
                            }
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTimeMs, pendingIntent);
                        } else {
                            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTimeMs, pendingIntent);
                        }
                    } else {
                        Intent immediateIntent = new Intent(context, EventReminderReceiver.class);
                        immediateIntent.putExtra("event_id", id);
                        immediateIntent.putExtra("event_title", title);
                        immediateIntent.putExtra("event_time_ms", eventTimeMs);
                        context.sendBroadcast(immediateIntent);
                    }
                } else {
                    alarmManager.cancel(pendingIntent);
                    notificationManager.cancel(requestCode);
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to schedule countdowns", e);
        }
    }
}
