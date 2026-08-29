package com.ligux.reposicion;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Si el DNS del celu no resuelve trycloudflare.com, pregunta a Google DNS (HTTPS). */
final class DohDns implements Dns {
    private static final Pattern A_DATA = Pattern.compile("\"type\"\\s*:\\s*1\\s*,\\s*\"data\"\\s*:\\s*\"([0-9.]+)\"");

    @Override
    public List<InetAddress> lookup(String hostname) throws UnknownHostException {
        if (hostname == null || hostname.isEmpty()) {
            throw new UnknownHostException("hostname vacío");
        }
        try {
            return Dns.SYSTEM.lookup(hostname);
        } catch (UnknownHostException first) {
            String ip = resolveA(hostname);
            if (ip != null && !ip.isEmpty()) {
                return Arrays.asList(InetAddress.getByName(ip));
            }
            throw first;
        }
    }

    static String resolveA(String hostname) {
        if (hostname == null || hostname.isEmpty()) return null;
        for (String dohUrl :
                new String[] {
                    "https://dns.google/resolve?name=" + hostname + "&type=A",
                    "https://cloudflare-dns.com/dns-query?name=" + hostname + "&type=A"
                }) {
            try {
                Request req =
                        new Request.Builder()
                                .url(dohUrl)
                                .header("Accept", "application/dns-json")
                                .build();
                try (Response res = new OkHttpClient().newCall(req).execute()) {
                    if (!res.isSuccessful() || res.body() == null) continue;
                    String json = res.body().string();
                    Matcher m = A_DATA.matcher(json);
                    if (m.find()) return m.group(1);
                    int ans = json.indexOf("\"Answer\"");
                    if (ans >= 0) {
                        Matcher m2 =
                                Pattern.compile("\"data\"\\s*:\\s*\"([0-9.]+)\"")
                                        .matcher(json.substring(ans));
                        if (m2.find()) return m2.group(1);
                    }
                }
            } catch (Exception ignored) {
                /* siguiente DoH */
            }
        }
        return null;
    }
}
