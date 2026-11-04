package ev.solar.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// Full-screen WebView on the Solar EV server's /app/ page. Keeps the screen on (wall tablet) and
// retries every 10 s while the PC is unreachable. The URL (with the LAN key) is set at build time.
public class MainActivity extends Activity {
  private WebView web;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private boolean failed;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#0b131a"));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setCacheMode(WebSettings.LOAD_NO_CACHE);
    web.setWebViewClient(new WebViewClient() {
      @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
        if (!req.isForMainFrame()) return;
        failed = true;
        v.loadData("<body style='background:#0b131a;color:#8ea3b4;font:20px sans-serif;display:flex;align-items:center;justify-content:center;height:90vh'>"
          + "Can't reach the Solar EV computer. Retrying…</body>", "text/html", "utf-8");
        handler.postDelayed(MainActivity.this::load, 10_000);
      }
      @Override public void onPageFinished(WebView v, String url) { if (!url.startsWith("data:")) failed = false; }
    });
    setContentView(web);
    if (state == null) load(); else web.restoreState(state);
  }

  private void load() { web.loadUrl(getString(R.string.app_url)); }

  @Override protected void onResume() {
    super.onResume();
    hideBars();
    if (failed) load();
  }

  @Override public void onWindowFocusChanged(boolean focus) { if (focus) hideBars(); }

  private void hideBars() {
    WindowInsetsController c = getWindow().getInsetsController();
    if (c == null) return;
    c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
  }

  @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

  @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); }
}
