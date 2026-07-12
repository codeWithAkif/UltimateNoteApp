package com.ultimatenotes.app;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.MediaPlayer;
import android.os.Environment;
import android.os.IBinder;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class BackgroundMusicService extends Service {
    private MediaPlayer mediaPlayer;
    private List<TrackItem> tracks = new ArrayList<>();
    private int currentTrackIndex = -1;

    private final android.os.Handler progressHandler = new android.os.Handler();
    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (mediaPlayer != null && mediaPlayer.isPlaying()) {
                SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                editor.putString("music_position", String.valueOf(mediaPlayer.getCurrentPosition() / 1000));
                editor.putString("music_duration", String.valueOf(mediaPlayer.getDuration() / 1000));
                editor.apply();
            }
            progressHandler.postDelayed(this, 1000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        showNotification();
        if (intent != null && "com.ultimatenotes.app.action.COMMAND".equals(intent.getAction())) {
            loadTracksFromPrefs();
            handleCommand(intent);
        }
        return START_NOT_STICKY;
    }

    private void handleCommand(Intent intent) {
        if (intent == null) return;
        String cmd = intent.getStringExtra("command");
        String trackPath = intent.getStringExtra("track_path");
        if ("play_pause".equals(cmd)) {
            togglePlayPause();
        } else if ("next".equals(cmd)) {
            playNext();
        } else if ("prev".equals(cmd)) {
            playPrev();
        } else if ("play_track".equals(cmd)) {
            playTrackByPath(trackPath);
        } else if ("stop".equals(cmd)) {
            stopPlayback();
        } else if ("set_volume".equals(cmd)) {
            float vol = intent.getFloatExtra("volume", 1.0f);
            if (mediaPlayer != null) {
                try {
                    mediaPlayer.setVolume(vol, vol);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
    }

    private void loadTracksFromPrefs() {
        tracks.clear();
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
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
                    tracks.add(new TrackItem(name, path, source));
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        String currentTrackJson = prefs.getString("music_current_track", null);
        if (currentTrackJson != null && !currentTrackJson.trim().isEmpty()) {
            try {
                JSONObject json = new JSONObject(currentTrackJson);
                String path = json.optString("path", "");
                for (int i = 0; i < tracks.size(); i++) {
                    if (tracks.get(i).path.equals(path)) {
                        currentTrackIndex = i;
                        break;
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    private void playTrackAtIndex(int index) {
        if (index < 0 || index >= tracks.size()) return;
        currentTrackIndex = index;
        TrackItem track = tracks.get(index);

        if (mediaPlayer != null) {
            mediaPlayer.release();
            mediaPlayer = null;
        }

        try {
            mediaPlayer = new MediaPlayer();
            if (track.path.startsWith("http://") || track.path.startsWith("https://")) {
                mediaPlayer.setDataSource(track.path);
            } else {
                File file = getPlaybackFile(track.path);
                if (file == null || !file.exists()) {
                    updatePlaybackState(false);
                    return;
                }
                mediaPlayer.setDataSource(file.getAbsolutePath());
            }

            mediaPlayer.setOnPreparedListener(mp -> {
                mp.start();
                updatePlaybackState(true);
                progressHandler.removeCallbacks(progressRunnable);
                progressHandler.post(progressRunnable);
            });

            mediaPlayer.setOnCompletionListener(mp -> {
                playNext();
            });

            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                updatePlaybackState(false);
                return false;
            });

            mediaPlayer.prepareAsync();
        } catch (Exception e) {
            e.printStackTrace();
            updatePlaybackState(false);
        }
    }

    private void playTrackByPath(String path) {
        if (path == null) return;
        int idx = -1;
        for (int i = 0; i < tracks.size(); i++) {
            if (tracks.get(i).path.equals(path)) {
                idx = i;
                break;
            }
        }
        if (idx != -1) {
            playTrackAtIndex(idx);
        }
    }

    private void togglePlayPause() {
        if (mediaPlayer != null) {
            if (mediaPlayer.isPlaying()) {
                mediaPlayer.pause();
                updatePlaybackState(false);
                progressHandler.removeCallbacks(progressRunnable);
            } else {
                mediaPlayer.start();
                updatePlaybackState(true);
                progressHandler.removeCallbacks(progressRunnable);
                progressHandler.post(progressRunnable);
            }
        } else {
            if (currentTrackIndex != -1) {
                playTrackAtIndex(currentTrackIndex);
            } else if (!tracks.isEmpty()) {
                playTrackAtIndex(0);
            }
        }
    }

    private void playNext() {
        if (tracks.isEmpty()) return;
        int next = (currentTrackIndex + 1) % tracks.size();
        playTrackAtIndex(next);
    }

    private void playPrev() {
        if (tracks.isEmpty()) return;
        int prev = (currentTrackIndex - 1 + tracks.size()) % tracks.size();
        playTrackAtIndex(prev);
    }

    private void stopPlayback() {
        progressHandler.removeCallbacks(progressRunnable);
        if (mediaPlayer != null) {
            mediaPlayer.stop();
            mediaPlayer.release();
            mediaPlayer = null;
        }
        updatePlaybackState(false);
        stopForeground(true);
        stopSelf();
    }

    private void updatePlaybackState(boolean isPlaying) {
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString("music_is_playing", String.valueOf(isPlaying));
        if (currentTrackIndex != -1 && currentTrackIndex < tracks.size()) {
            TrackItem track = tracks.get(currentTrackIndex);
            try {
                JSONObject json = new JSONObject();
                json.put("name", track.name);
                json.put("path", track.path);
                json.put("source", track.source);
                editor.putString("music_current_track", json.toString());
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        editor.apply();

        if (isPlaying) {
            showNotification();
        } else {
            stopForeground(true);
            stopSelf();
        }

        Intent refreshIntent = new Intent(this, MusicWidgetProvider.class);
        refreshIntent.setAction("com.ultimatenotes.app.action.REFRESH");
        sendBroadcast(refreshIntent);
    }

    private void showNotification() {
        String channelId = "music_playback_channel";
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                channelId, "Music Playback", android.app.NotificationManager.IMPORTANCE_LOW
            );
            android.app.NotificationManager manager = getSystemService(android.app.NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }

        String title = "Müzik Oynatıcı";
        String subtitle = "Çalma listesinden bir şarkı seçin";
        if (tracks != null && currentTrackIndex >= 0 && currentTrackIndex < tracks.size()) {
            TrackItem track = tracks.get(currentTrackIndex);
            title = track.name;
            subtitle = "Uygulama arka planda çalıyor";
        }

        android.content.Intent mainIntent = new android.content.Intent(this, MainActivity.class);
        mainIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
        android.app.PendingIntent contentIntent = android.app.PendingIntent.getActivity(
            this, 0, mainIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
        );

        android.app.Notification notification = new android.app.Notification.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build();

        startForeground(1001, notification);
    }

    private File getPlaybackFile(String path) {
        File file = getTrackFile(path);
        if (file == null || !file.exists()) return null;
        try {
            java.io.FileInputStream fis = new java.io.FileInputStream(file);
            byte[] header = new byte[20];
            int read = fis.read(header);
            fis.close();
            
            if (read > 0) {
                String headerStr = new String(header, 0, read, "UTF-8");
                if (headerStr.startsWith("data:")) {
                    java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(file));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        sb.append(line);
                    }
                    br.close();
                    String content = sb.toString().trim();
                    int commaIndex = content.indexOf(",");
                    if (commaIndex != -1) {
                        String base64Str = content.substring(commaIndex + 1);
                        byte[] decodedBytes = android.util.Base64.decode(base64Str, android.util.Base64.DEFAULT);
                        File tempFile = new File(getCacheDir(), "temp_playing.mp3");
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(tempFile);
                        fos.write(decodedBytes);
                        fos.close();
                        return tempFile;
                    }
                }
            }
            return file;
        } catch (Exception e) {
            e.printStackTrace();
            return file;
        }
    }

    private File getTrackFile(String path) {
        File[] rootDirs = new File[]{
            new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getExternalFilesDir(null), "Documents/UltimateNotes"),
            new File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "UltimateNotes"),
            new File(getFilesDir(), "UltimateNotes"),
            new File(getFilesDir(), "Documents/UltimateNotes")
        };
        for (File rootDir : rootDirs) {
            File file = new File(rootDir, path);
            if (file.exists() && file.isFile()) {
                return file;
            }
        }
        return null;
    }

    @Override
    public void onDestroy() {
        progressHandler.removeCallbacks(progressRunnable);
        if (mediaPlayer != null) {
            mediaPlayer.release();
            mediaPlayer = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static class TrackItem {
        final String name;
        final String path;
        final String source;

        TrackItem(String name, String path, String source) {
            this.name = name;
            this.path = path;
            this.source = source;
        }
    }
}
