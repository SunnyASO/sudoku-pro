package com.antigravity.sudokupro;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SudokuAnalyticsPlugin.class);
        registerPlugin(BillingPlugin.class);
        registerPlugin(NativeAdPlugin.class);
        registerPlugin(RemoteConfigPlugin.class);
        registerPlugin(AppOpenAdPlugin.class);
        registerPlugin(ReviewPlugin.class);
        registerPlugin(HapticsPlugin.class);
        registerPlugin(InAppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setTextZoom(100);
        }
    }
}
