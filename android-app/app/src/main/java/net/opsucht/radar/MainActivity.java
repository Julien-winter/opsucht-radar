package net.opsucht.radar;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

public final class MainActivity extends Activity {
    private WebView webView;
    private SwipeRefreshLayout refreshLayout;
    private TextView offlineView;
    private View loadingView;
    private FrameLayout rootLayout;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private boolean updateCheckStarted;
    private boolean offlineFallbackAttempted;
    private boolean loadFinished;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable loadTimeout = () -> {
        if (!loadFinished && webView != null) {
            if (!offlineFallbackAttempted) {
                offlineFallbackAttempted = true;
                webView.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                webView.reload();
            } else {
                showOffline();
            }
        }
    };
    private final Runnable contentCheck = () -> {
        if (webView == null || offlineView == null) return;
        webView.evaluateJavascript("(function(){var b=document.body;return b&&((b.innerText||'').trim().length>20)?'ok':'empty';})()", value -> {
            if (webView == null) return;
            if ("\"ok\"".equals(value) || "ok".equals(value)) {
                loadFinished = true;
                mainHandler.removeCallbacks(loadTimeout);
                loadingView.setVisibility(View.GONE);
                offlineView.setVisibility(View.GONE);
                refreshLayout.setRefreshing(false);
            } else if (!offlineFallbackAttempted) {
                offlineFallbackAttempted = true;
                webView.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                webView.reload();
            } else {
                showOffline();
            }
        });
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_main);
        rootLayout = findViewById(R.id.root_layout);
        refreshLayout = findViewById(R.id.refresh_layout);
        webView = findViewById(R.id.web_view);
        offlineView = findViewById(R.id.offline_view);
        loadingView = findViewById(R.id.loading_view);

        // Android 15 enforces edge-to-edge for targetSdk 35. Apply system-bar
        // insets to the root so the website header never sits below the clock.
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, bars.top, 0, bars.bottom);
            return insets;
        });
        ViewCompat.requestApplyInsets(rootLayout);

        WebSettings settings = webView.getSettings();
        webView.setBackgroundColor(getColor(R.color.radar_background));
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(isNetworkAvailable() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
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
                loadFinished = false;
                loadingView.setVisibility(View.VISIBLE);
                offlineView.setVisibility(View.GONE);
                mainHandler.removeCallbacks(loadTimeout);
                mainHandler.postDelayed(loadTimeout, 12000);
            }
            @Override public void onPageFinished(WebView view, String url) {
                // WebView can report a successful navigation while rendering an
                // empty document (the former black-screen failure). Verify that
                // the app actually rendered content before removing the overlay.
                mainHandler.removeCallbacks(contentCheck);
                mainHandler.postDelayed(contentCheck, 350);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    if (!offlineFallbackAttempted) {
                        offlineFallbackAttempted = true;
                        view.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                        view.loadUrl(BuildConfig.RADAR_URL);
                    } else showOffline();
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, android.webkit.WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) showOffline();
            }
        });

        refreshLayout.setOnRefreshListener(this::retryLoad);
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
        loadFinished = false;
        mainHandler.removeCallbacks(loadTimeout);
        loadingView.setVisibility(View.GONE);
        refreshLayout.setRefreshing(false);
        offlineView.setVisibility(View.VISIBLE);
        offlineView.setOnClickListener(v -> retryLoad());
        offlineView.setText("OPSUCHT Radar konnte nicht geladen werden.\nTippen zum erneuten Versuch");
    }

    private void retryLoad() {
        if (webView == null) return;
        offlineFallbackAttempted = false;
        loadFinished = false;
        webView.getSettings().setCacheMode(isNetworkAvailable() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        webView.loadUrl(BuildConfig.RADAR_URL);
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.net.Network network = manager.getActiveNetwork();
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        }
        return manager.getActiveNetworkInfo() != null && manager.getActiveNetworkInfo().isConnected();
    }

    @Override protected void onResume() { super.onResume(); if (refreshLayout != null) refreshLayout.setRefreshing(false); if (offlineView != null && offlineView.getVisibility() == View.VISIBLE && isNetworkAvailable()) retryLoad(); }
    @Override protected void onPause() { super.onPause(); if (webView != null) webView.onPause(); }
    @Override protected void onStop() { if (webView != null) webView.onPause(); super.onStop(); }
    @Override protected void onDestroy() { mainHandler.removeCallbacks(loadTimeout); updateExecutor.shutdownNow(); if (webView != null) webView.destroy(); super.onDestroy(); }

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
