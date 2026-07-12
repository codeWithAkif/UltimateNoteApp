package com.ultimatenotes.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;
import org.json.JSONObject;

public class MusicWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] appWidgetIds = mgr.getAppWidgetIds(new android.content.ComponentName(context, MusicWidgetProvider.class));

        if ("com.ultimatenotes.app.action.REFRESH".equals(action)) {
            if (appWidgetIds != null) {
                mgr.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.music_widget_list);
                for (int id : appWidgetIds) {
                    updateAppWidget(context, mgr, id);
                }
            }
        }
    }

    private static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        boolean isPlaying = "true".equals(prefs.getString("music_is_playing", "false"));
        String currentTrackJson = prefs.getString("music_current_track", null);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.music_widget_layout);

        String title = "Müzik Oynatılmıyor";
        String subtitle = "Çalma listesinden bir şarkı seçin";

        if (currentTrackJson != null && !currentTrackJson.trim().isEmpty()) {
            try {
                JSONObject json = new JSONObject(currentTrackJson);
                title = json.optString("name", "Bilinmeyen Şarkı");
                String src = json.optString("source", "local");
                subtitle = "local".equals(src) ? "Yerel Kitaplık" : "online".equals(src) ? "Çevrimiçi" : "YouTube Medya";
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        views.setTextViewText(R.id.music_widget_track_title, title);
        views.setTextViewText(R.id.music_widget_track_subtitle, subtitle);
        views.setImageViewResource(R.id.music_widget_play_button, isPlaying ? R.drawable.ic_pause : R.drawable.ic_play);

        Intent playIntent = new Intent(context, BackgroundMusicService.class);
        playIntent.setAction("com.ultimatenotes.app.action.COMMAND");
        playIntent.putExtra("command", "play_pause");
        PendingIntent playPI;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            playPI = PendingIntent.getForegroundService(
                context, appWidgetId + 7000, playIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        } else {
            playPI = PendingIntent.getService(
                context, appWidgetId + 7000, playIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        }
        views.setOnClickPendingIntent(R.id.music_widget_play_button, playPI);

        Intent nextIntent = new Intent(context, BackgroundMusicService.class);
        nextIntent.setAction("com.ultimatenotes.app.action.COMMAND");
        nextIntent.putExtra("command", "next");
        PendingIntent nextPI;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            nextPI = PendingIntent.getForegroundService(
                context, appWidgetId + 7001, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        } else {
            nextPI = PendingIntent.getService(
                context, appWidgetId + 7001, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        }
        views.setOnClickPendingIntent(R.id.music_widget_next_button, nextPI);

        Intent prevIntent = new Intent(context, BackgroundMusicService.class);
        prevIntent.setAction("com.ultimatenotes.app.action.COMMAND");
        prevIntent.putExtra("command", "prev");
        PendingIntent prevPI;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            prevPI = PendingIntent.getForegroundService(
                context, appWidgetId + 7002, prevIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        } else {
            prevPI = PendingIntent.getService(
                context, appWidgetId + 7002, prevIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        }
        views.setOnClickPendingIntent(R.id.music_widget_prev_button, prevPI);

        Intent serviceIntent = new Intent(context, MusicWidgetService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        serviceIntent.setData(Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.music_widget_list, serviceIntent);

        Intent clickIntent = new Intent(context, BackgroundMusicService.class);
        clickIntent.setAction("com.ultimatenotes.app.action.COMMAND");
        clickIntent.putExtra("command", "play_track");
        PendingIntent clickPI;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            clickPI = PendingIntent.getForegroundService(
                context, appWidgetId + 7003, clickIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        } else {
            clickPI = PendingIntent.getService(
                context, appWidgetId + 7003, clickIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
        }
        views.setPendingIntentTemplate(R.id.music_widget_list, clickPI);

        views.setEmptyView(R.id.music_widget_list, R.id.music_widget_empty_view);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
