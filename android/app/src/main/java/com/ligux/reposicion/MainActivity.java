package com.ligux.reposicion;

import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean rpNativeReady = false;

    private void attachRpNative() {
        if (rpNativeReady) return;
        Bridge bridge = getBridge();
        if (bridge == null) return;
        WebView wv = bridge.getWebView();
        if (wv == null) return;
        wv.addJavascriptInterface(new RpNativeBridge(this), "RpNative");
        rpNativeReady = true;
    }

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ApkInstallPlugin.class);
        super.onCreate(savedInstanceState);
        attachRpNative();
    }

    @Override
    public void onResume() {
        super.onResume();
        attachRpNative();
    }
}
