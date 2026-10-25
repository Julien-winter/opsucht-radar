package net.opsucht.radar;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public final class MainActivity extends Activity {
    private WebView webView;
    private SwipeRefreshLayout refreshLayout;
    private TextView offlineView;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private boolean updateCheckStarted;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        refreshLayout = findViewById(R.id.refresh_layout);
        webView = findViewById(R.id.web_view);
        offlineView = findViewById(R.id.offline_view);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(settings.getUserAgentString() + " OPSUCHT-Radar-Android/1.0");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternalIfNeeded(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternalIfNeeded(Uri.parse(url));
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                offlineView.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
        });

        refreshLayout.setOnRefreshListener(() -> webView.reload());
        webView.setOnScrollChangeListener((v, scrollX, scrollY, oldScrollX, oldScrollY) -> refreshLayout.setEnabled(scrollY <= 0));
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> openExternalIfNeeded(Uri.parse(url)));
        webView.loadUrl(BuildConfig.RADAR_URL);
        checkForUpdate();
    }

    private boolean openExternalIfNeeded(Uri uri) {
        if (uri == null) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        String configuredHost;
        try { configuredHost = Uri.parse(BuildConfig.RADAR_URL).getHost(); } catch (Exception ignored) { configuredHost = ""; }
        if (host.equalsIgnoreCase(configuredHost) || host.isEmpty()) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
        return true;
    }

    private void showOffline() {
        refreshLayout.setRefreshing(false);
        offlineView.setVisibility(View.VISIBLE);
        offlineView.setOnClickListener(v -> webView.reload());
    }

    @Override protected void onResume() { super.onResume(); if (refreshLayout != null) refreshLayout.setRefreshing(false); }
    @Override protected void onPause() { super.onPause(); if (webView != null) webView.onPause(); }
    @Override protected void onStop() { if (webView != null) webView.onPause(); super.onStop(); }
    @Override protected void onDestroy() { updateExecutor.shutdownNow(); if (webView != null) webView.destroy(); super.onDestroy(); }

    /** Checks release metadata only; installation stays with the user. */
    private void checkForUpdate() {
        if (updateCheckStarted || BuildConfig.UPDATE_API == null || BuildConfig.UPDATE_API.trim().isEmpty()) return;
        updateCheckStarted = true;
        updateExecutor.execute(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.UPDATE_API).openConnection();
                connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "OPSUCHT-Radar-Android/" + BuildConfig.VERSION_NAME);
                if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return;
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                    String line; while ((line = reader.readLine()) != null) body.append(line);
                }
                JSONObject release = new JSONObject(body.toString());
                String latest = release.optString("tag_name", release.optString("name", ""));
                String download = release.optString("html_url", "");
                if (latest.isEmpty() || download.isEmpty() || !isNewer(latest, BuildConfig.VERSION_NAME)) return;
                runOnUiThread(() -> new AlertDialog.Builder(this)
                    .setTitle("Neue OPSUCHT-Radar-Version")
                    .setMessage("Version " + latest + " ist verfügbar. Jetzt die GitHub-Release-Seite öffnen?")
                    .setNegativeButton("Später", null)
                    .setPositiveButton("Öffnen", (dialog, which) -> openExternalIfNeeded(Uri.parse(download)))
                    .show());
            } catch (Exception ignored) { }
        });
    }

    private static boolean isNewer(String remote, String current) {
        String a = remote.replaceFirst("^[vV]", "").split("[-+]")[0];
        String b = current.replaceFirst("^[vV]", "").split("[-+]")[0];
        String[] left = a.split("\\."), right = b.split("\\.");
        for (int i = 0; i < Math.max(left.length, right.length); i++) {
            int x = i < left.length ? parsePart(left[i]) : 0, y = i < right.length ? parsePart(right[i]) : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    private static int parsePart(String value) { try { return Integer.parseInt(value.replaceAll("\\D.*", "")); } catch (Exception ignored) { return 0; } }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
