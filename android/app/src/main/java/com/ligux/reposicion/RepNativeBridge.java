package com.ligux.reposicion;

import android.content.Context;
import android.webkit.JavascriptInterface;

public final class RepNativeBridge {
    private final Context ctx;

    public RepNativeBridge(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    @JavascriptInterface
    public String httpGet(String url, String headersJson, int timeoutMs) {
        return NativeHttp.request("GET", url, headersJson, null, timeoutMs).toString();
    }

    @JavascriptInterface
    public String httpPost(String url, String headersJson, String body, int timeoutMs) {
        return NativeHttp.request("POST", url, headersJson, body == null ? "" : body, timeoutMs).toString();
    }

    @JavascriptInterface
    public String bootstrapConnect() {
        return NativeHttp.bootstrapConnect(ctx).toString();
    }

    @JavascriptInterface
    public String connectDiag() {
        return NativeHttp.connectDiag(ctx).toString();
    }
}
