package com.ultimatenotes.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        handleWidgetIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWidgetIntent(intent);
    }

    private void handleWidgetIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if ("com.ultimatenotes.app.ACTION_MUSIC_COMMAND".equals(action)) {
            String cmd = intent.getStringExtra("command");
            String trackPath = intent.getStringExtra("track_path");
            if (cmd != null) {
                final String js = "window.dispatchEvent(new CustomEvent('widget-music', { detail: { command: '" + cmd + "', trackPath: '" + (trackPath != null ? trackPath.replace("'", "\\'") : "") + "' } }));";
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().evaluateJavascript(js, null);
                        }
                    }
                });
            }
        }
    }
}
