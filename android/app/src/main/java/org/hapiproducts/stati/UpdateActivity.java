package org.hapiproducts.stati;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** GitHub APK updates require the installed app's signer and Android's installation approval. */
public final class UpdateActivity extends Activity {
    private static final String REPOSITORY = "https://github.com/markusciani/stati-releases/releases/latest/download/android-update.json";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean canceled;
    private File pendingApk;
    private boolean waitingForPermission;
    private boolean launched;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView status = new TextView(this); status.setText("Stați\nChecking for updates…"); status.setTextSize(20); status.setPadding(32,64,32,32); setContentView(status);
        boolean manual = "org.hapiproducts.stati.CHECK_UPDATES".equals(getIntent().getAction()) || "stati-update".equals(getIntent().getScheme());
        if (getPackageName().endsWith(".debug")) { openApp(); return; }
        long last = getPreferences(MODE_PRIVATE).getLong("lastUpdateCheck",0);
        if (!manual && System.currentTimeMillis()-last < 60*60*1000L) { openApp(); return; }
        executor.execute(() -> {
            try {
                JSONObject update=new JSONObject(new String(readSmall(REPOSITORY,16384),java.nio.charset.StandardCharsets.UTF_8));
                validateUpdate(update);
                long current=getPackageManager().getPackageInfo(getPackageName(),0).getLongVersionCode();
                getPreferences(MODE_PRIVATE).edit().putLong("lastUpdateCheck",System.currentTimeMillis()).apply();
                if(update.getLong("versionCode")<=current){runOnUiThread(()->{if(manual)showMessage("Stați is up to date.");else openApp();});return;}
                runOnUiThread(()->{if(isFinishing()||isDestroyed())return;new AlertDialog.Builder(this).setTitle("Stați update available").setMessage("Version "+update.optString("versionName")+" is ready. Android will ask you to approve installation.").setPositiveButton("Update",(dialog,which)->download(update)).setNegativeButton("Not now",(dialog,which)->openApp()).setOnCancelListener(dialog->openApp()).show();});
            } catch(Exception error) { runOnUiThread(()->{if(manual)showMessage("Could not check for updates. Try again later.");else openApp();}); }
        });
    }

    private static void validateUpdate(JSONObject update) throws Exception {
        if(!"org.hapiproducts.stati".equals(update.getString("packageName")) || update.getLong("versionCode")<1 || !update.getString("versionName").matches("[0-9]+\\.[0-9]+\\.[0-9]+") || !update.getString("sha256").matches("[a-f0-9]{64}"))throw new IOException("Invalid update manifest.");
        long bytes=update.getLong("bytes");if(bytes<1||bytes>100*1024*1024)throw new IOException("Invalid APK size.");
        String url=update.getString("url");if(!url.startsWith("https://github.com/markusciani/stati-releases/releases/download/"))throw new IOException("Unexpected update source.");
    }

    private void download(JSONObject update) {
        canceled=false;ProgressBar progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);LinearLayout content=new LinearLayout(this);content.setPadding(32,24,32,24);content.addView(progress,new LinearLayout.LayoutParams(-1,-2));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Downloading Stați…").setView(content).setNegativeButton("Cancel",(d,w)->{canceled=true;openApp();}).setCancelable(false).create();dialog.show();
        executor.execute(()->{
            File directory=new File(getCacheDir(),"updates");directory.mkdirs();File partial=new File(directory,"stati-update.part"),apk=new File(directory,"stati-update.apk");
            try {
                long expected=update.getLong("bytes"),received=0;MessageDigest digest=MessageDigest.getInstance("SHA-256");
                HttpURLConnection connection=connection(update.getString("url"));
                try(InputStream input=connection.getInputStream();OutputStream output=new FileOutputStream(partial)){
                    byte[] buffer=new byte[65536];int count;
                    while((count=input.read(buffer))!=-1){if(canceled)throw new IOException("Canceled");received+=count;if(received>expected)throw new IOException("Unexpected APK size.");output.write(buffer,0,count);digest.update(buffer,0,count);final int percentage=(int)(received*100/expected);runOnUiThread(()->progress.setProgress(percentage));}
                }finally{connection.disconnect();}
                if(received!=expected || !hex(digest.digest()).equals(update.getString("sha256")))throw new IOException("The update checksum did not match.");
                verifySigner(partial,update.getLong("versionCode"));
                if(apk.exists()&&!apk.delete())throw new IOException("Could not replace the previous cached update.");if(!partial.renameTo(apk))throw new IOException("Could not save the update.");pendingApk=apk;
                runOnUiThread(()->{dialog.dismiss();requestInstall();});
            }catch(Exception error){partial.delete();runOnUiThread(()->{dialog.dismiss();if(!canceled)showMessage("The update could not be verified or downloaded. Your installed app was kept.");});}
        });
    }

    private void verifySigner(File apk,long version) throws Exception {
        PackageManager manager=getPackageManager();PackageInfo incoming=manager.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES),installed=manager.getPackageInfo(getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        if(incoming==null||!getPackageName().equals(incoming.packageName)||incoming.getLongVersionCode()!=version||version<=installed.getLongVersionCode()||incoming.signingInfo==null||installed.signingInfo==null)throw new IOException("Unexpected app identity.");
        Set<String> current=signers(installed.signingInfo.getApkContentsSigners()),next=signers(incoming.signingInfo.getApkContentsSigners());
        if(current.isEmpty()||!current.equals(next))throw new IOException("The signing identity changed.");
    }
    private static Set<String> signers(Signature[] signatures)throws Exception{Set<String> values=new HashSet<>();for(Signature signature:signatures)values.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));return values;}
    private static String hex(byte[] bytes){StringBuilder output=new StringBuilder();for(byte value:bytes)output.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return output.toString();}

    private void requestInstall(){
        if(isFinishing()||pendingApk==null)return;
        if(!getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(this).setTitle("Allow app updates").setMessage("Android requires your permission for Stați to open its updated installer. You stay in control of installation.").setPositiveButton("Open settings",(d,w)->{waitingForPermission=true;startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}).setNegativeButton("Not now",(d,w)->openApp()).show();return;
        }
        Uri uri=FileProvider.getUriForFile(this,getPackageName()+".updates",pendingApk);
        Intent installer=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(installer);finish();
    }
    @Override protected void onResume(){super.onResume();if(waitingForPermission){waitingForPermission=false;if(getPackageManager().canRequestPackageInstalls())requestInstall();else showMessage("Update permission was not granted. You can try again later.");}}
    private void showMessage(String message){if(isFinishing())return;new AlertDialog.Builder(this).setTitle("Stați").setMessage(message).setPositiveButton("Open Stați",(d,w)->openApp()).setOnCancelListener(d->openApp()).show();}
    private void openApp(){if(launched||isFinishing())return;launched=true;Uri data=getIntent().getData();boolean trusted=data!=null&&"https".equals(data.getScheme())&&"stati.ciani01.org".equals(data.getHost())&&(data.getPort()==-1||data.getPort()==443)&&data.getUserInfo()==null;Intent intent=new Intent(this,com.google.androidbrowserhelper.trusted.LauncherActivity.class);try{Uri target=trusted?data:Uri.parse("https://stati.ciani01.org/");target=target.buildUpon().appendQueryParameter("android_version",getPackageManager().getPackageInfo(getPackageName(),0).versionName).appendQueryParameter("android_code",String.valueOf(getPackageManager().getPackageInfo(getPackageName(),0).getLongVersionCode())).build();intent.setData(target);}catch(Exception ignored){}startActivity(intent);finish();}
    private static byte[] readSmall(String url,int limit)throws Exception{HttpURLConnection connection=connection(url);try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>limit)throw new IOException("Response too large.");output.write(buffer,0,count);}return output.toByteArray();}finally{connection.disconnect();}}
    private static HttpURLConnection connection(String raw)throws Exception{
        URI uri=new URI(raw);for(int redirects=0;redirects<6;redirects++){
            String host=uri.getHost();if(!"https".equals(uri.getScheme())||uri.getUserInfo()!=null||(uri.getPort()!=-1&&uri.getPort()!=443)||!("api.github.com".equals(host)||"github.com".equals(host)||"release-assets.githubusercontent.com".equals(host)||"objects.githubusercontent.com".equals(host)))throw new IOException("Untrusted update host.");
            HttpURLConnection connection=(HttpURLConnection)uri.toURL().openConnection();connection.setConnectTimeout(5000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("User-Agent","Stati-Android-Updater");connection.setRequestProperty("Accept","application/vnd.github+json");int status=connection.getResponseCode();
            if(status>=300&&status<400){String target=connection.getHeaderField("Location");connection.disconnect();if(target==null)throw new IOException("Invalid redirect.");uri=uri.resolve(target);continue;}
            if(status!=200){connection.disconnect();throw new IOException("Update unavailable.");}return connection;
        }throw new IOException("Too many redirects.");
    }
    @Override protected void onDestroy(){canceled=true;executor.shutdownNow();super.onDestroy();}
}
