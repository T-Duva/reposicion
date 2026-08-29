package com.ligux.reposicion;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Build;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** HTTP fuera del WebView (4G/Wi‑Fi real del celu). DNS alternativo si el operador falla. */
final class NativeHttp {
    private static final String APP_ID = "com.ligux.reposicion";
    private static OkHttpClient httpClient;

    private NativeHttp() {}

    static {
        try {
            System.setProperty("java.net.preferIPv4Stack", "true");
        } catch (Exception ignored) {
            /* ok */
        }
    }

    static OkHttpClient client() {
        if (httpClient == null) {
            httpClient =
                    new OkHttpClient.Builder()
                            .dns(new DohDns())
                            .connectTimeout(20, TimeUnit.SECONDS)
                            .readTimeout(20, TimeUnit.SECONDS)
                            .callTimeout(25, TimeUnit.SECONDS)
                            .followRedirects(true)
                            .build();
        }
        return httpClient;
    }

    static JSONObject request(String method, String urlStr, String headersJson, String body, int timeoutMs) {
        try {
            JSONObject headers =
                    new JSONObject(
                            headersJson != null && !headersJson.isEmpty() ? headersJson : "{}");
            Request.Builder rb = new Request.Builder().url(urlStr);
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                rb.header(k, headers.optString(k, ""));
            }
            if (!headers.has("User-Agent")) rb.header("User-Agent", "REPOSICION-app");
            if (urlStr.contains("trycloudflare.com") && !headers.has("bypass-tunnel-reminder")) {
                rb.header("bypass-tunnel-reminder", "1");
            }

            String m = method != null ? method.toUpperCase(Locale.US) : "GET";
            if ("POST".equals(m) || "PUT".equals(m) || "PATCH".equals(m)) {
                String raw = body != null ? body : "";
                rb.method(m, RequestBody.create(raw, MediaType.parse("application/json")));
            } else {
                rb.get();
            }

            OkHttpClient c =
                    client()
                            .newBuilder()
                            .callTimeout(Math.max(timeoutMs, 3000), TimeUnit.MILLISECONDS)
                            .build();
            try (Response res = c.newCall(rb.build()).execute()) {
                String text = res.body() != null ? res.body().string() : "";
                String contentType = res.header("Content-Type", "application/json");
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("status", res.code());
                out.put("text", text);
                out.put("contentType", contentType);
                return out;
            }
        } catch (Exception e) {
            JSONObject out = new JSONObject();
            try {
                out.put("ok", false);
                String msg = e.getMessage() != null ? e.getMessage() : "error";
                if (msg.toLowerCase(Locale.US).contains("unable to resolve host")) {
                    String host = hostFromUrl(urlStr);
                    String dohIp = host != null ? DohDns.resolveA(host) : null;
                    if (dohIp != null) {
                        msg = msg + " (DoH=" + dohIp + " pero falló conexión)";
                    } else {
                        msg = msg + " (DoH tampoco resolvió)";
                    }
                }
                out.put("error", msg);
            } catch (Exception ignored) {
                /* ok */
            }
            return out;
        }
    }

    private static String hostFromUrl(String urlStr) {
        try {
            return new java.net.URL(urlStr).getHost();
        } catch (Exception e) {
            return null;
        }
    }

    static String readAssetText(Context ctx, String path) {
        try (InputStream is = ctx.getAssets().open(path);
                InputStreamReader r = new InputStreamReader(is, StandardCharsets.UTF_8)) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) != -1) sb.append(buf, 0, n);
            return sb.toString().trim();
        } catch (Exception e) {
            return "";
        }
    }

    static String readBundledTunnelUrl(Context ctx) {
        for (String path : new String[] {"public/server.json", "www/server.json", "server.json"}) {
            String raw = readAssetText(ctx, path);
            if (raw.isEmpty()) continue;
            try {
                JSONObject j = new JSONObject(raw);
                String u = j.optString("url", "").trim().replaceAll("/+$", "");
                if (!u.isEmpty() && u.toLowerCase(Locale.US).startsWith("https://")) return u;
            } catch (Exception ignored) {
                /* siguiente */
            }
        }
        return "";
    }

    static String networkKind(Context ctx) {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return "desconocida";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                android.net.Network net = cm.getActiveNetwork();
                if (net == null) return "sin red";
                NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                if (caps == null) return "sin caps";
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "datos móviles";
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
            }
            return "activa";
        } catch (Exception e) {
            return "error";
        }
    }

    static boolean healthLooksLikeOurs(String text) {
        if (text == null || text.isEmpty()) return false;
        try {
            JSONObject j = new JSONObject(text.trim());
            if (!j.optBoolean("ok", false)) return false;
            if (APP_ID.equals(j.optString("appId", ""))) return true;
            return "reposicion".equals(j.optString("app", ""));
        } catch (Exception e) {
            return false;
        }
    }

    static JSONObject bootstrapConnect(Context ctx) {
        JSONObject out = new JSONObject();
        try {
            String bundled = readBundledTunnelUrl(ctx);
            out.put("bundledUrl", bundled.isEmpty() ? JSONObject.NULL : bundled);
            out.put("network", networkKind(ctx));
            if (bundled.isEmpty()) {
                out.put("ok", false);
                out.put("error", "sin server.json embebido");
                return out;
            }
            String host = hostFromUrl(bundled);
            if (host != null) {
                try {
                    out.put("dnsSistema", java.net.InetAddress.getByName(host).getHostAddress());
                } catch (Exception e) {
                    out.put("dnsSistema", "falló");
                }
                String doh = DohDns.resolveA(host);
                out.put("dnsDoH", doh != null ? doh : "falló");
            }
            JSONObject hdr = new JSONObject();
            hdr.put("Accept", "application/json");
            hdr.put("bypass-tunnel-reminder", "1");
            hdr.put("User-Agent", "REPOSICION-app");
            long t0 = System.currentTimeMillis();
            JSONObject res = request("GET", bundled + "/api/health", hdr.toString(), null, 25000);
            out.put("ms", System.currentTimeMillis() - t0);
            if (!res.optBoolean("ok", false)) {
                out.put("ok", false);
                out.put("error", res.optString("error", "falló"));
                return out;
            }
            int status = res.optInt("status", 0);
            String text = res.optString("text", "");
            out.put("httpStatus", status);
            if (status < 200 || status >= 300) {
                out.put("ok", false);
                out.put("error", "HTTP " + status);
                return out;
            }
            if (!healthLooksLikeOurs(text)) {
                out.put("ok", false);
                out.put("error", "respuesta no es REPOSICION");
                return out;
            }
            out.put("ok", true);
            out.put("url", bundled);
            return out;
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("error", e.getMessage() != null ? e.getMessage() : "error");
            } catch (Exception ignored) {
                /* ok */
            }
            return out;
        }
    }

    static JSONObject connectDiag(Context ctx) {
        JSONObject out = new JSONObject();
        try {
            out.put("bundledUrl", readBundledTunnelUrl(ctx));
            out.put("network", networkKind(ctx));
            out.put("bootstrap", bootstrapConnect(ctx));
        } catch (Exception e) {
            try {
                out.put("error", e.getMessage());
            } catch (Exception ignored) {
                /* ok */
            }
        }
        return out;
    }
}
