# Stați for Android

The Android package opens the live Stați site in a Trusted Web Activity using Google's Android Browser Helper. Passkeys and uploads use the browser's existing secure web implementation. Conversion, OCR and ProPresenter tools are excluded from Android.

## Test APK

```sh
npm run android:apk:test
```

Requires a JDK compatible with Gradle 9.3, Android SDK platform/build tools 36, and `ANDROID_HOME` if the SDK is outside the default macOS location. The Gradle wrapper pins the distribution checksum.

Output: `release/Stati-Android-0.1.0-test.apk`. Package: `org.hapiproducts.stati.debug`, label **Stați (Test)**, Android 9 or newer. It uses Android's development signing key. Do not distribute it as production. The production website does not trust the debug certificate, so the browser may show its address bar.

## Production signing

```sh
npm run android:release
```

All of these environment variables are required; keep their values out of source control and logs:

- `STATI_ANDROID_KEYSTORE`: absolute path to the existing private keystore.
- `STATI_ANDROID_STORE_PASSWORD`: keystore password.
- `STATI_ANDROID_KEY_ALIAS`: app signing alias.
- `STATI_ANDROID_KEY_PASSWORD`: alias password.

The release script refuses to distribute an unsigned production APK. Preserve the signing key and an independently recoverable backup before the first production distribution: future updates must use the same app identity and signing key. Google Play App Signing may use a different app-signing certificate from the upload certificate.

The private signing identity is not included in this repository. The local release helper can create or reuse an OS-protected identity on the publisher's machine; inspect its configuration before use. A fork needs its own package identity and signing key. After verifying an independent signing-key backup, publish `/.well-known/assetlinks.json` with the **actual app-signing certificate's SHA-256 fingerprint**, not the debug or upload certificate. Verify it over HTTPS with no redirects, then verify origin association on a real Android phone. The checked-in certificate fingerprint is public identity metadata, not a private key.

Required phone acceptance: install, verified origin, existing passkey sign-in, real new-user code enrollment, QR receiver deep link, file chooser/upload, expired/closed receivers, offline-member request, and uninstall/reinstall behavior. Build success is not proof of these flows.

Sources: https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities and https://github.com/GoogleChrome/android-browser-helper
