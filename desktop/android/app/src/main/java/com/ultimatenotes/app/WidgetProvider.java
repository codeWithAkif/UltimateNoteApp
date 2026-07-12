package com.ultimatenotes.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.io.BufferedReader;
import java.io.File;
import java.util.List;

public class WidgetProvider extends AppWidgetProvider {

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
        int[] appWidgetIds = intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS);
        if (appWidgetIds == null) {
            int widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                appWidgetIds = new int[]{widgetId};
            }
        }
        if (appWidgetIds == null || appWidgetIds.length == 0) {
            appWidgetIds = mgr.getAppWidgetIds(new android.content.ComponentName(context, WidgetProvider.class));
        }

        if ("com.ultimatenotes.app.action.REFRESH".equals(action)) {
            if (appWidgetIds != null && appWidgetIds.length > 0) {
                mgr.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_list);
                for (int appWidgetId : appWidgetIds) {
                    updateAppWidget(context, mgr, appWidgetId);
                }
            }
        } else if ("com.ultimatenotes.app.action.PREV_LIST".equals(action) || "com.ultimatenotes.app.action.NEXT_LIST".equals(action)) {
            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String pinnedPath = prefs.getString("widget_pinned_list", null);
            List<String> mdFiles = getPinnedLists(context);
            if (!mdFiles.isEmpty()) {
                int currentIndex = -1;
                if (pinnedPath != null) {
                    currentIndex = mdFiles.indexOf(pinnedPath);
                }
                int newIndex;
                if ("com.ultimatenotes.app.action.PREV_LIST".equals(action)) {
                    newIndex = (currentIndex <= 0) ? mdFiles.size() - 1 : currentIndex - 1;
                } else {
                    newIndex = (currentIndex >= mdFiles.size() - 1) ? 0 : currentIndex + 1;
                }
                String newPath = mdFiles.get(newIndex);
                prefs.edit().putString("widget_pinned_list", newPath).apply();
                
                mgr.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_list);
                for (int appWidgetId : appWidgetIds) {
                    updateAppWidget(context, mgr, appWidgetId);
                }
            }
        } else if ("com.ultimatenotes.app.action.TOGGLE_ITEM".equals(action)) {
            int position = intent.getIntExtra("item_position", -1);
            String clickAction = intent.getStringExtra("click_action");
            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String pinnedPath = prefs.getString("widget_pinned_list", null);
            if (position != -1 && pinnedPath != null) {
                if ("delete".equals(clickAction)) {
                    deleteItemInFile(context, pinnedPath, position);
                    mgr.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_list);
                    for (int appWidgetId : appWidgetIds) {
                        updateAppWidget(context, mgr, appWidgetId);
                    }
                } else if ("edit".equals(clickAction)) {
                    String currentText = intent.getStringExtra("item_text");
                    Intent editIntent = new Intent(context, QuickAddActivity.class);
                    editIntent.putExtra("mode", "edit");
                    editIntent.putExtra("item_position", position);
                    editIntent.putExtra("item_text", currentText);
                    editIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(editIntent);
                } else {
                    toggleItemInFile(context, pinnedPath, position);
                    mgr.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_list);
                    for (int appWidgetId : appWidgetIds) {
                        updateAppWidget(context, mgr, appWidgetId);
                    }
                }
            }
        }
    }

    private static boolean isHarcamaFile(Context context, String pinnedPath) {
        if (pinnedPath == null || pinnedPath.trim().isEmpty()) {
            return false;
        }
        File[] rootDirs = new File[]{
            new File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(context.getExternalFilesDir(null), "Documents/UltimateNotes"),
            new File(context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(context.getFilesDir(), "UltimateNotes"),
            new File(context.getFilesDir(), "Documents/UltimateNotes")
        };
        for (File rootDir : rootDirs) {
            File testFile = new File(rootDir, pinnedPath);
            if (testFile.exists() && testFile.isFile()) {
                try (BufferedReader br = new BufferedReader(new java.io.FileReader(testFile))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        if (line.toLowerCase().contains("#harcama")) {
                            return true;
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
                break;
            }
        }
        return false;
    }

    private static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String pinnedPath = prefs.getString("widget_pinned_list", null);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);

        if (pinnedPath == null || pinnedPath.trim().isEmpty()) {
            views.setTextViewText(R.id.widget_title, "Ultimate Notes");
            views.setViewVisibility(R.id.widget_list, android.view.View.GONE);
            views.setViewVisibility(R.id.widget_empty_view, android.view.View.VISIBLE);
            views.setViewVisibility(R.id.widget_receipt_button, android.view.View.GONE);
        } else {
            String title = pinnedPath;
            if (title.contains("/")) {
                title = title.substring(title.lastIndexOf("/") + 1);
            }
            if (title.endsWith(".md")) {
                title = title.substring(0, title.length() - 3);
            }
            title = title.replace("_", " ");
            views.setTextViewText(R.id.widget_title, title);

            views.setViewVisibility(R.id.widget_list, android.view.View.VISIBLE);
            views.setViewVisibility(R.id.widget_empty_view, android.view.View.GONE);

            Intent serviceIntent = new Intent(context, WidgetService.class);
            serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            serviceIntent.setData(android.net.Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
            views.setRemoteAdapter(R.id.widget_list, serviceIntent);

            boolean showReceipt = isHarcamaFile(context, pinnedPath);
            views.setViewVisibility(R.id.widget_receipt_button, showReceipt ? android.view.View.VISIBLE : android.view.View.GONE);
            if (showReceipt) {
                Intent receiptIntent = new Intent(context, QuickAddActivity.class);
                receiptIntent.putExtra("mode", "receipt");
                PendingIntent receiptPI = PendingIntent.getActivity(
                    context, appWidgetId + 9000, receiptIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(R.id.widget_receipt_button, receiptPI);
            }
        }

        // 1. Refresh Button Click
        Intent refreshIntent = new Intent(context, WidgetProvider.class);
        refreshIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        refreshIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[]{appWidgetId});
        PendingIntent refreshPendingIntent = PendingIntent.getBroadcast(
            context, appWidgetId, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_refresh_button, refreshPendingIntent);

        // 1.5. Add Button Click (Starts QuickAddActivity)
        Intent addIntent = new Intent(context, QuickAddActivity.class);
        addIntent.putExtra("mode", "add");
        PendingIntent addPI = PendingIntent.getActivity(
            context, appWidgetId + 5000, addIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_add_button, addPI);

        // 2. Navigation Click Listeners (Prev/Next)
        Intent prevIntent = new Intent(context, WidgetProvider.class);
        prevIntent.setAction("com.ultimatenotes.app.action.PREV_LIST");
        prevIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[]{appWidgetId});
        PendingIntent prevPI = PendingIntent.getBroadcast(
            context, appWidgetId + 1000, prevIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_prev_button, prevPI);

        Intent nextIntent = new Intent(context, WidgetProvider.class);
        nextIntent.setAction("com.ultimatenotes.app.action.NEXT_LIST");
        nextIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[]{appWidgetId});
        PendingIntent nextPI = PendingIntent.getBroadcast(
            context, appWidgetId + 2000, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_next_button, nextPI);

        // 3. ListView Item Click Handler Template (FLAG_MUTABLE is mandatory for template fill-ins)
        Intent clickIntent = new Intent(context, WidgetProvider.class);
        clickIntent.setAction("com.ultimatenotes.app.action.TOGGLE_ITEM");
        clickIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        PendingIntent clickPI = PendingIntent.getBroadcast(
            context, appWidgetId + 3000, clickIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        views.setPendingIntentTemplate(R.id.widget_list, clickPI);

        views.setEmptyView(R.id.widget_list, R.id.widget_empty_view);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static List<String> getPinnedLists(Context context) {
        List<String> lists = new java.util.ArrayList<>();
        SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String json = prefs.getString("widget_pinned_lists", null);
        if (json != null && !json.trim().isEmpty()) {
            try {
                String content = json.trim();
                if (content.startsWith("[") && content.endsWith("]")) {
                    content = content.substring(1, content.length() - 1);
                }
                if (!content.trim().isEmpty()) {
                    String[] items = content.split(",");
                    for (String item : items) {
                        String clean = item.trim();
                        if (clean.startsWith("\"") && clean.endsWith("\"")) {
                            clean = clean.substring(1, clean.length() - 1);
                        } else if (clean.startsWith("'") && clean.endsWith("'")) {
                            clean = clean.substring(1, clean.length() - 1);
                        }
                        clean = clean.replace("\\/", "/");
                        if (!clean.isEmpty()) {
                            lists.add(clean);
                        }
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        
        if (lists.isEmpty()) {
            String single = prefs.getString("widget_pinned_list", null);
            if (single != null && !single.trim().isEmpty()) {
                lists.add(single);
            }
        }
        return lists;
    }

    private static void toggleItemInFile(Context context, String pinnedPath, int position) {
        File file = null;
        File[] rootDirs = new File[]{
            new File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(context.getExternalFilesDir(null), "Documents/UltimateNotes"),
            new File(context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(context.getFilesDir(), "UltimateNotes"),
            new File(context.getFilesDir(), "Documents/UltimateNotes")
        };

        for (File rootDir : rootDirs) {
            File testFile = new File(rootDir, pinnedPath);
            if (testFile.exists() && testFile.isFile()) {
                file = testFile;
                break;
            }
        }

        if (file == null) {
            return;
        }

        List<String> lines = new java.util.ArrayList<>();
        try (BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(file))) {
            String line;
            int currentIndex = 0;
            while ((line = br.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]") || (trimmed.startsWith("- ") && !trimmed.startsWith("- ["))) {
                    if (currentIndex == position) {
                        if (trimmed.startsWith("- [ ]")) {
                            line = line.replace("- [ ]", "- [x]");
                        } else if (trimmed.startsWith("- [x]")) {
                            line = line.replace("- [x]", "- [ ]");
                        } else if (trimmed.startsWith("- [X]")) {
                            line = line.replace("- [X]", "- [ ]");
                        } else if (trimmed.startsWith("- ")) {
                            line = line.replace("- ", "- [x] ");
                        }
                    }
                    currentIndex++;
                }
                lines.add(line);
            }
        } catch (Exception e) {
            e.printStackTrace();
            return;
        }

        try (java.io.BufferedWriter bw = new java.io.BufferedWriter(new java.io.FileWriter(file))) {
            for (int i = 0; i < lines.size(); i++) {
                bw.write(lines.get(i));
                if (i < lines.size() - 1) {
                    bw.newLine();
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static void deleteItemInFile(Context context, String pinnedPath, int position) {
        File file = null;
        File[] rootDirs = new File[]{
            new File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(context.getExternalFilesDir(null), "Documents/UltimateNotes"),
            new File(context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(context.getFilesDir(), "UltimateNotes"),
            new File(context.getFilesDir(), "Documents/UltimateNotes")
        };

        for (File rootDir : rootDirs) {
            File testFile = new File(rootDir, pinnedPath);
            if (testFile.exists() && testFile.isFile()) {
                file = testFile;
                break;
            }
        }

        if (file == null) {
            return;
        }

        List<String> lines = new java.util.ArrayList<>();
        try (BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(file))) {
            String line;
            int currentIndex = 0;
            while ((line = br.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]") || (trimmed.startsWith("- ") && !trimmed.startsWith("- ["))) {
                    if (currentIndex == position) {
                        currentIndex++;
                        continue;
                    }
                    currentIndex++;
                }
                lines.add(line);
            }
        } catch (Exception e) {
            e.printStackTrace();
            return;
        }

        try (java.io.BufferedWriter bw = new java.io.BufferedWriter(new java.io.FileWriter(file))) {
            for (int i = 0; i < lines.size(); i++) {
                bw.write(lines.get(i));
                if (i < lines.size() - 1) {
                    bw.newLine();
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
