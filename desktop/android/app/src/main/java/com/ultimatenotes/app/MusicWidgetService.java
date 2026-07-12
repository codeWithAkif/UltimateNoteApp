package com.ultimatenotes.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class MusicWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new MusicListRemoteViewsFactory(this.getApplicationContext());
    }

    private static class MusicListRemoteViewsFactory implements RemoteViewsFactory {
        private final Context context;
        private final List<TrackItem> items = new ArrayList<>();

        public MusicListRemoteViewsFactory(Context context) {
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
            String jsonStr = prefs.getString("music_tracks", null);
            if (jsonStr != null && !jsonStr.trim().isEmpty()) {
                try {
                    JSONArray arr = new JSONArray(jsonStr);
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject obj = arr.getJSONObject(i);
                        String name = obj.optString("name", "");
                        String path = obj.optString("path", "");
                        String source = obj.optString("source", "local");
                        if ("youtube".equals(source)) {
                            continue;
                        }
                        if (!name.isEmpty()) {
                            items.add(new TrackItem(name, path));
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
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
            TrackItem item = items.get(position);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.music_widget_item);
            views.setTextViewText(R.id.music_item_text, item.name);

            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            boolean isPlaying = "true".equals(prefs.getString("music_is_playing", "false"));
            String currentTrackJson = prefs.getString("music_current_track", null);
            String currentPath = "";
            if (currentTrackJson != null && !currentTrackJson.trim().isEmpty()) {
                try {
                    org.json.JSONObject json = new org.json.JSONObject(currentTrackJson);
                    currentPath = json.optString("path", "");
                } catch (Exception e) {}
            }

            boolean isActive = currentPath.equals(item.path);
            if (isActive && isPlaying) {
                views.setImageViewResource(R.id.music_item_icon, R.drawable.ic_play);
                views.setTextColor(R.id.music_item_text, 0xff38bdf8);
            } else if (isActive) {
                views.setImageViewResource(R.id.music_item_icon, R.drawable.ic_music_note);
                views.setTextColor(R.id.music_item_text, 0xfffbbf24);
            } else {
                views.setImageViewResource(R.id.music_item_icon, R.drawable.ic_music_note);
                views.setTextColor(R.id.music_item_text, 0xfff1f5f9);
            }

            Intent fillInIntent = new Intent();
            fillInIntent.putExtra("track_path", item.path);
            views.setOnClickFillInIntent(R.id.music_item_text, fillInIntent);

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

    private static class TrackItem {
        final String name;
        final String path;

        TrackItem(String name, String path) {
            this.name = name;
            this.path = path;
        }
    }
}
