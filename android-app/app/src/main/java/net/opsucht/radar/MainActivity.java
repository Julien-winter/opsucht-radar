package net.opsucht.radar;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Environment;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
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
import android.widget.Toast;

import org.json.JSONObject;
import org.json.JSONArray;

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
    private static final String UPDATE_CHANNEL = "updates";
    private static final String ACTION_INSTALL_UPDATE = "net.opsucht.radar.INSTALL_UPDATE";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1708;
    private static final String UPDATE_PREFS = "update-download";
    private static final String UPDATE_ID = "download-id";
    private WebView webView;
    private SwipeRefreshLayout refreshLayout;
    private TextView offlineView;
    private View loadingView;
    private FrameLayout rootLayout;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private boolean updateCheckStarted;
    private long lastUpdateCheckAt;
    private String promptedUpdateVersion = "";
    private boolean offlineFallbackAttempted;
    private boolean loadFinished;
    private boolean rendererRestarting;
    private boolean backgrounded;
    private long pendingDownloadId = -1L;
    private BroadcastReceiver updateReceiver;
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
                offlineFallbackAttempted = false;
                mainHandler.removeCallbacks(loadTimeout);
                // The offline fallback hides the WebView while keeping the
                // cached document alive. If that document becomes usable
                // again after resume, reveal it before hiding the fallback;
                // otherwise the activity can keep showing only its gray root.
                webView.setVisibility(View.VISIBLE);
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
        settings.setLoadsImagesAutomatically(true);
        settings.setBlockNetworkImage(false);
        settings.setUserAgentString(settings.getUserAgentString() + " OPSUCHT-Market-Android/" + BuildConfig.VERSION_NAME);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        if (Build.VERSION.SDK_INT >= 26) webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);

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
                mainHandler.removeCallbacks(contentCheck);
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
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // Android may reclaim the WebView renderer while the app is in
                // the background. A dead renderer cannot be reused and used
                // to leave the app on a blank/gray screen after reopening.
                if (!rendererRestarting) {
                    rendererRestarting = true;
                    runOnUiThread(() -> recreate());
                }
                return true;
            }
        });

        refreshLayout.setOnRefreshListener(this::retryLoad);
        webView.setOnScrollChangeListener((v, scrollX, scrollY, oldScrollX, oldScrollY) -> refreshLayout.setEnabled(scrollY <= 0));
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> openExternalIfNeeded(Uri.parse(url)));
        webView.loadUrl(BuildConfig.RADAR_URL);
        registerUpdateReceiver();
        recoverCompletedDownload();
        handleInstallIntent(getIntent());
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, NOTIFICATION_PERMISSION_REQUEST);
        }
        checkForUpdate();
    }

    private void registerUpdateReceiver() {
        updateReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (id != pendingDownloadId) return;
                pendingDownloadId = -1L;
                getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).edit().remove(UPDATE_ID).apply();
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                Uri apk = manager == null ? null : manager.getUriForDownloadedFile(id);
                if (apk == null) {
                    Toast.makeText(MainActivity.this, "APK-Download fehlgeschlagen. Bitte erneut versuchen.", Toast.LENGTH_LONG).show();
                    return;
                }
                showInstallNotification(apk);
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Update bereit")
                    .setMessage("Die neue OPSUCHT-Market-Version wurde heruntergeladen.")
                    .setNegativeButton("Später", null)
                    .setPositiveButton("Jetzt installieren", (dialog, which) -> installApk(apk))
                    .show();
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(updateReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(updateReceiver, filter);
    }

    private void showInstallNotification(Uri apk) {
        // Route the notification back through this activity. That way a tap
        // also handles Android's "install unknown apps" permission instead
        // of silently failing inside the package installer.
        Intent install = new Intent(this, MainActivity.class);
        install.setAction(ACTION_INSTALL_UPDATE).setData(apk);
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 1707, install,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        NotificationManager notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (notifications == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(UPDATE_CHANNEL, "App-Updates", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Neue OPSUCHT-Market-Versionen");
            notifications.createNotificationChannel(channel);
        }
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, UPDATE_CHANNEL)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.opsucht_favicon)
            .setContentTitle("OPSUCHT Market · Update bereit")
            .setContentText("Tippen, um die APK zu installieren")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS);
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) {
            notifications.notify(1707, builder.build());
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleInstallIntent(intent);
    }

    private void handleInstallIntent(Intent intent) {
        if (intent == null || !ACTION_INSTALL_UPDATE.equals(intent.getAction())) return;
        Uri apk = intent.getData();
        if (apk != null) installApk(apk);
    }

    private void installApk(Uri apk) {
        if (apk == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName()));
                startActivity(settings);
                Toast.makeText(this, "Erlaube die Installation unbekannter Apps und tippe danach erneut auf das Update.", Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {
                Toast.makeText(this, "Installation blockiert. Öffne die APK bitte aus Downloads.", Toast.LENGTH_LONG).show();
            }
            return;
        }
        Intent install = new Intent(Intent.ACTION_VIEW, apk);
        install.setDataAndType(apk, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(install);
        } catch (Exception error) {
            Toast.makeText(this, "Kein Paket-Installer verfügbar. Öffne die Datei bitte aus Downloads.", Toast.LENGTH_LONG).show();
        }
    }

    /** Recover a completed update if Android killed the activity during download. */
    private void recoverCompletedDownload() {
        long id = getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).getLong(UPDATE_ID, -1L);
        if (id < 0L) return;
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        if (manager == null) return;
        try (android.database.Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                pendingDownloadId = id;
                Uri apk = manager.getUriForDownloadedFile(id);
                if (apk != null) {
                    pendingDownloadId = -1L;
                    getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).edit().remove(UPDATE_ID).apply();
                    showInstallNotification(apk);
                }
            } else if (status == DownloadManager.STATUS_FAILED) {
                getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).edit().remove(UPDATE_ID).apply();
            }
        } catch (Exception ignored) { }
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
        webView.setVisibility(View.GONE);
        refreshLayout.setRefreshing(false);
        offlineView.setVisibility(View.VISIBLE);
        offlineView.setOnClickListener(v -> retryLoad());
        offlineView.setText("OPSUCHT Market\n\nKeine Verbindung zur Website.\nTippen zum erneuten Laden.");
    }

    private void retryLoad() {
        if (webView == null) return;
        offlineFallbackAttempted = false;
        loadFinished = false;
        mainHandler.removeCallbacks(contentCheck);
        mainHandler.removeCallbacks(loadTimeout);
        webView.setVisibility(View.VISIBLE);
        offlineView.setVisibility(View.GONE);
        loadingView.setVisibility(View.VISIBLE);
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

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) {
            // WebView is explicitly paused in onStop; resume it before the
            // first frame so returning to the app never shows a stale gray
            // surface. Re-check the DOM after a short render opportunity.
            webView.onResume();
            webView.resumeTimers();
            if (offlineView == null || offlineView.getVisibility() != View.VISIBLE) {
                webView.setVisibility(View.VISIBLE);
            }
            // Validate an already loaded page after resume. The first navigation can have an empty body briefly.
            if (backgrounded) {
                mainHandler.removeCallbacks(contentCheck);
                mainHandler.postDelayed(contentCheck, 220);
            }
        }
        backgrounded = false;
        if (refreshLayout != null) refreshLayout.setRefreshing(false);
        if (offlineView != null && offlineView.getVisibility() == View.VISIBLE && isNetworkAvailable()) retryLoad();
        // A release may have been published while the app was suspended or
        // offline. Re-check periodically instead of requiring a full restart.
        if (isNetworkAvailable()) checkForUpdate();
    }
    @Override protected void onPause() { backgrounded = true; if (webView != null) webView.onPause(); super.onPause(); }
    // onPause() is called before onStop(). Pausing the WebView again here can
    // leave Android WebView's renderer suspended after returning to the app,
    // which presents as a grey/empty surface until a process restart.
    @Override protected void onStop() { super.onStop(); }
    @Override protected void onDestroy() { mainHandler.removeCallbacks(contentCheck); mainHandler.removeCallbacks(loadTimeout); if (updateReceiver != null) { try { unregisterReceiver(updateReceiver); } catch (Exception ignored) {} } updateExecutor.shutdownNow(); if (webView != null) webView.destroy(); super.onDestroy(); }

    /** Checks release metadata only; installation stays with the user. */
    private void checkForUpdate() {
        long now = System.currentTimeMillis();
        if (updateCheckStarted || now - lastUpdateCheckAt < 30 * 60 * 1000L || BuildConfig.UPDATE_API == null || BuildConfig.UPDATE_API.trim().isEmpty()) return;
        updateCheckStarted = true;
        updateExecutor.execute(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.UPDATE_API).openConnection();
                connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "OPSUCHT-Market-Android/" + BuildConfig.VERSION_NAME);
                if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return;
                // Only throttle after a successful metadata request. A failed
                // offline check must be retried as soon as connectivity returns.
                lastUpdateCheckAt = System.currentTimeMillis();
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                    String line; while ((line = reader.readLine()) != null) body.append(line);
                }
                JSONObject release = new JSONObject(body.toString());
                String latest = release.optString("tag_name", release.optString("name", ""));
                String download = findApkAsset(release.optJSONArray("assets"));
                String notes = release.optString("body", "").trim();
                if (latest.isEmpty() || download.isEmpty() || !isNewer(latest, BuildConfig.VERSION_NAME) || latest.equals(promptedUpdateVersion)) return;
                final String changelog = notes.isEmpty() ? "Keine zusätzlichen Änderungen veröffentlicht." : notes.substring(0, Math.min(3500, notes.length()));
                promptedUpdateVersion = latest;
                runOnUiThread(() -> new AlertDialog.Builder(this)
                    .setTitle("Neue OPSUCHT-Market-Version · " + latest)
                    .setMessage("Änderungen:\n\n" + changelog + "\n\nDie APK wird direkt in der App heruntergeladen. Es wird nichts ohne deine Bestätigung installiert.")
                    .setNegativeButton("Später", null)
                    .setPositiveButton("APK herunterladen", (dialog, which) -> downloadUpdate(download, latest))
                    .show());
            } catch (Exception ignored) { }
            finally { updateCheckStarted = false; }
        });
    }

    /** Select only a real APK asset from the trusted GitHub release response. */
    private static String findApkAsset(JSONArray assets) {
        if (assets == null) return "";
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset == null) continue;
            String name = asset.optString("name", "").toLowerCase();
            String url = asset.optString("browser_download_url", "");
            if (name.endsWith(".apk") && isTrustedDownloadUrl(url)) return url;
        }
        return "";
    }

    private static boolean isTrustedDownloadUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            return "https".equalsIgnoreCase(uri.getScheme()) &&
                ("github.com".equals(host) || "objects.githubusercontent.com".equals(host) || "githubusercontent.com".equals(host));
        } catch (Exception ignored) { return false; }
    }

    private void downloadUpdate(String url, String version) {
        if (!isTrustedDownloadUrl(url)) { Toast.makeText(this, "Unsichere Update-Adresse abgelehnt.", Toast.LENGTH_LONG).show(); return; }
        try {
            String safeVersion = version.replaceAll("[^A-Za-z0-9._-]", "_");
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("OPSUCHT Market " + version);
            request.setDescription("APK wird heruntergeladen …");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "OPSUCHT-Market-" + safeVersion + ".apk");
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("Download-Dienst nicht verfügbar");
            pendingDownloadId = manager.enqueue(request);
            getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).edit().putLong(UPDATE_ID, pendingDownloadId).apply();
            Toast.makeText(this, "Download gestartet. Die Android-Benachrichtigung öffnet die APK danach.", Toast.LENGTH_LONG).show();
        } catch (Exception error) { Toast.makeText(this, "Download konnte nicht gestartet werden.", Toast.LENGTH_LONG).show(); }
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
