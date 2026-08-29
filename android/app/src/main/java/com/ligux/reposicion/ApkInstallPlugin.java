package com.ligux.reposicion;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "ApkInstall")
public class ApkInstallPlugin extends Plugin {

    private static final int MAX_REDIRECTS = 8;
    private static final long MIN_APK_BYTES = 100_000L;

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta url");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                s.setData(Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
            } catch (Exception ignored) {
                /* ok */
            }
            call.reject("Activá «Permitir de esta fuente» para REPOSICION y tocá Actualizar de nuevo");
            return;
        }
        new Thread(() -> {
            File out = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "reposicion-update.apk");
            try {
                File dir = out.getParentFile();
                if (dir != null) dir.mkdirs();
                if (out.exists()) out.delete();
                downloadApk(url, out);
                if (!looksLikeApk(out)) {
                    call.reject("La descarga no es un APK válido (¿redirect de GitHub?)");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    out
                );
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    try {
                        getContext().startActivity(intent);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject(String.valueOf(e.getMessage()));
                    }
                });
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    /** GitHub hace 302 a otro host; HttpURLConnection a veces no lo sigue → hay que hacerlo a mano. */
    private static void downloadApk(String startUrl, File out) throws Exception {
        String current = startUrl;
        for (int hop = 0; hop < MAX_REDIRECTS; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(25000);
            c.setReadTimeout(180000);
            c.setRequestProperty("User-Agent", "REPOSICION-ApkInstall/1.0");
            c.setRequestProperty("Accept", "*/*");
            c.connect();
            int code = c.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                    || code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_SEE_OTHER
                    || code == 307
                    || code == 308) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null || loc.isEmpty()) {
                    throw new Exception("Redirect sin Location (" + code + ")");
                }
                current = new URL(new URL(current), loc).toString();
                continue;
            }
            if (code >= 400) {
                c.disconnect();
                throw new Exception("No se bajó el APK (" + code + ")");
            }
            try (InputStream in = c.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            } finally {
                c.disconnect();
            }
            return;
        }
        throw new Exception("Demasiados redirects bajando el APK");
    }

    private static boolean looksLikeApk(File f) {
        if (f == null || !f.isFile() || f.length() < MIN_APK_BYTES) return false;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] mag = new byte[4];
            if (in.read(mag) < 4) return false;
            // ZIP/APK: PK\x03\x04
            return mag[0] == 'P' && mag[1] == 'K' && mag[2] == 3 && mag[3] == 4;
        } catch (Exception e) {
            return false;
        }
    }
}
