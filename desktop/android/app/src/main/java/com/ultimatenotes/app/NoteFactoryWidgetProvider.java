package com.ultimatenotes.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class NoteFactoryWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if ("com.ultimatenotes.app.action.REFRESH".equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            int[] appWidgetIds = mgr.getAppWidgetIds(new android.content.ComponentName(context, NoteFactoryWidgetProvider.class));
            if (appWidgetIds != null) {
                for (int id : appWidgetIds) {
                    updateAppWidget(context, mgr, id);
                }
            }
        }
    }

    private static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.note_factory_widget_layout);

        Intent mockInputIntent = new Intent(context, NoteFactoryActivity.class);
        mockInputIntent.putExtra("mode", "add");
        PendingIntent inputPI = PendingIntent.getActivity(
            context, appWidgetId + 6000, mockInputIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_mock_input, inputPI);

        Intent shoppingIntent = new Intent(context, NoteFactoryActivity.class);
        shoppingIntent.putExtra("mode", "shortcut");
        shoppingIntent.putExtra("prefill", "@Kişisel !Alışveriş #todo ");
        PendingIntent shoppingPI = PendingIntent.getActivity(
            context, appWidgetId + 6001, shoppingIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_shortcut_shopping, shoppingPI);

        Intent ideaIntent = new Intent(context, NoteFactoryActivity.class);
        ideaIntent.putExtra("mode", "shortcut");
        ideaIntent.putExtra("prefill", "@Fikirler !Kutusu #todo ");
        PendingIntent ideaPI = PendingIntent.getActivity(
            context, appWidgetId + 6002, ideaIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_shortcut_idea, ideaPI);

        Intent journalIntent = new Intent(context, NoteFactoryActivity.class);
        journalIntent.putExtra("mode", "shortcut");
        journalIntent.putExtra("prefill", "@Günlük !Defter #günlük ");
        PendingIntent journalPI = PendingIntent.getActivity(
            context, appWidgetId + 6003, journalIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_shortcut_journal, journalPI);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
