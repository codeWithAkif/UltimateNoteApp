package com.ultimatenotes.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Environment;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class WidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new ChecklistRemoteViewsFactory(this.getApplicationContext(), intent);
    }

    private static class ChecklistRemoteViewsFactory implements RemoteViewsFactory {
        private final Context context;
        private final List<TodoItem> items = new ArrayList<>();
        private String pinnedPath;

        public ChecklistRemoteViewsFactory(Context context, Intent intent) {
            this.context = context;
        }

        @Override
        public void onCreate() {
            loadData();
        }

        @Override
        public void onDataSetChanged() {
            loadData();
        }

        private void loadData() {
            items.clear();

            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            pinnedPath = prefs.getString("widget_pinned_list", null);

            if (pinnedPath == null || pinnedPath.trim().isEmpty()) {
                return;
            }

            File file = null;
            File[] rootDirs = new File[]{
                new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
                new File(context.getExternalFilesDir(null), "Documents/UltimateNotes"),
                new File(context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
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

            try (BufferedReader br = new BufferedReader(new FileReader(file))) {
                String line;
                int lineIdx = 0;
                while ((line = br.readLine()) != null) {
                    String trimmed = line.trim();
                    // Yalnızca todo (checkbox) satırlarını göster; düz madde
                    // işaretlerini ("- ...") ve diğer satırları atla.
                    if (trimmed.startsWith("- [ ]")) {
                        String text = trimmed.substring(5).trim();
                        TodoItem item = new TodoItem(text, false);
                        item.lineIndex = lineIdx;
                        items.add(item);
                    } else if (trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]")) {
                        String text = trimmed.substring(5).trim();
                        TodoItem item = new TodoItem(text, true);
                        item.lineIndex = lineIdx;
                        items.add(item);
                    }
                    lineIdx++;
                }
            } catch (IOException e) {
                e.printStackTrace();
            }

            // İşaretlenenleri (tamamlananları) listenin en altına taşı:
            // önce yapılacaklar, sonra tamamlananlar. Collections.sort kararlıdır,
            // dolayısıyla her grup içinde dosyadaki orijinal sıra korunur.
            java.util.Collections.sort(items, new java.util.Comparator<TodoItem>() {
                @Override
                public int compare(TodoItem a, TodoItem b) {
                    if (a.isChecked == b.isChecked) return 0;
                    return a.isChecked ? 1 : -1;
                }
            });
        }

        private static String formatDateText(String dateStr) {
            String[] turkishMonths = {"Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"};
            try {
                String[] parts = dateStr.split("-");
                int month = Integer.parseInt(parts[1]);
                int day = Integer.parseInt(parts[2]);
                String monthName = turkishMonths[month - 1];
                if (monthName.length() > 3) {
                    monthName = monthName.substring(0, 3);
                }
                return day + " " + monthName;
            } catch (Exception e) {
                return dateStr;
            }
        }

        @Override
        public void onDestroy() {
            items.clear();
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= items.size()) {
                return null;
            }

            TodoItem item = items.get(position);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_item);
            
            views.setTextViewText(R.id.item_text, item.text);

            if (item.isBulletOnly) {
                views.setImageViewResource(R.id.item_status, R.drawable.widget_bullet);
                views.setTextColor(R.id.item_text, 0xfff1f5f9);
                views.setInt(R.id.item_text, "setPaintFlags", 0);
            } else if (item.isChecked) {
                views.setImageViewResource(R.id.item_status, R.drawable.widget_checked);
                views.setTextColor(R.id.item_text, 0xff64748b);
                views.setInt(R.id.item_text, "setPaintFlags", 16); // Paint.STRIKE_THRU_TEXT_FLAG
            } else {
                views.setImageViewResource(R.id.item_status, R.drawable.widget_unchecked);
                views.setTextColor(R.id.item_text, 0xfff1f5f9);
                views.setInt(R.id.item_text, "setPaintFlags", 0);
            }

            // Bind badges
            StringBuilder badgeBuilder = new StringBuilder();
            if (!item.dueDate.isEmpty()) {
                badgeBuilder.append("📅 ").append(formatDateText(item.dueDate));
            }
            if (!item.dueTime.isEmpty()) {
                if (badgeBuilder.length() > 0) badgeBuilder.append("   ");
                badgeBuilder.append("⏰ ").append(item.dueTime);
            }
            if (!item.repeat.isEmpty() && !"none".equals(item.repeat)) {
                if (badgeBuilder.length() > 0) badgeBuilder.append("   ");
                String repText = "Yinelenen";
                if ("daily".equals(item.repeat)) repText = "Günlük";
                else if ("weekly".equals(item.repeat)) repText = "Haftalık";
                else if ("monthly".equals(item.repeat)) repText = "Aylık";
                badgeBuilder.append("🔁 ").append(repText);
            }

            if (badgeBuilder.length() > 0) {
                views.setViewVisibility(R.id.layout_badge_container, android.view.View.VISIBLE);
                views.setTextViewText(R.id.tv_widget_badge, badgeBuilder.toString());
            } else {
                views.setViewVisibility(R.id.layout_badge_container, android.view.View.GONE);
            }

            // 1. Toggle Action — mutlak satır indeksini taşı (ekran sırasından bağımsız)
            Intent toggleIntent = new Intent();
            toggleIntent.putExtra("line_index", item.lineIndex);
            toggleIntent.putExtra("click_action", "toggle");
            views.setOnClickFillInIntent(R.id.item_status, toggleIntent);

            // 2. Edit Action
            Intent editIntent = new Intent();
            editIntent.putExtra("line_index", item.lineIndex);
            editIntent.putExtra("click_action", "edit");
            editIntent.putExtra("item_text", item.text);
            views.setOnClickFillInIntent(R.id.item_text, editIntent);

            // 3. Delete Action
            Intent deleteIntent = new Intent();
            deleteIntent.putExtra("line_index", item.lineIndex);
            deleteIntent.putExtra("click_action", "delete");
            views.setOnClickFillInIntent(R.id.item_delete, deleteIntent);

            return views;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }
    }

    private static class TodoItem {
        final String text;
        final boolean isChecked;
        final boolean isBulletOnly;

        // Dosyadaki mutlak satır indeksi (0 tabanlı). Toggle/düzenle/sil
        // işlemleri, ekrandaki sıralamadan bağımsız olarak bu indekse göre yapılır.
        int lineIndex = -1;
        String dueDate = "";
        String dueTime = "";
        String repeat = "";

        TodoItem(String rawText, boolean isChecked) {
            this(rawText, isChecked, false);
        }

        TodoItem(String rawText, boolean isChecked, boolean isBulletOnly) {
            this.isChecked = isChecked;
            this.isBulletOnly = isBulletOnly;

            String temp = rawText;

            java.util.regex.Matcher dueMatcher = java.util.regex.Pattern.compile("\\[due:(\\d{4}-\\d{2}-\\d{2})\\]").matcher(temp);
            if (dueMatcher.find()) {
                this.dueDate = dueMatcher.group(1);
                temp = dueMatcher.replaceAll("");
            }

            java.util.regex.Matcher timeMatcher = java.util.regex.Pattern.compile("\\[time:(\\d{2}:\\d{2})-\\d{2}:\\d{2}\\]").matcher(temp);
            if (timeMatcher.find()) {
                this.dueTime = timeMatcher.group(1);
                temp = timeMatcher.replaceAll("");
            }

            java.util.regex.Matcher repeatMatcher = java.util.regex.Pattern.compile("\\[repeat:(daily|günlük|weekly|haftalık|monthly|aylık)\\]", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(temp);
            if (repeatMatcher.find()) {
                String r = repeatMatcher.group(1).toLowerCase();
                if (r.equals("günlük")) this.repeat = "daily";
                else if (r.equals("haftalık")) this.repeat = "weekly";
                else if (r.equals("aylık")) this.repeat = "monthly";
                else this.repeat = r;
                temp = repeatMatcher.replaceAll("");
            }

            temp = temp.replaceAll("#[a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+", "").trim();

            if (temp.startsWith("[")) {
                int closingIndex = temp.indexOf("]");
                if (closingIndex != -1 && closingIndex < 25) {
                    temp = temp.substring(closingIndex + 1).trim();
                }
            }

            this.text = temp.trim();
        }
    }
}
