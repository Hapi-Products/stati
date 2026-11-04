# Stați

Church presentation and worship tools by Hapi Products. Stați connects a Windows presentation computer with a website and native iPhone/iPad readers: send materials, manage songs and services, share group files, and coordinate tasks and song corrections.

This repository contains the application sources under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The license does not grant rights to church song lyrics, uploaded documents, or third-party media. No church library, account database, private signing key, or production secret is included.

## Applications

| Directory | Application | Current scope |
| --- | --- | --- |
| `desktop/`, `src/desktop/` | Electron Windows companion | Preview 39 source; ProPresenter 7.11 integration and physical Windows acceptance remain under active review. |
| `src/web/`, `src/server/`, `src/shared/` | Responsive website and Cloudflare backend | React, Workers, D1, R2 and Durable Objects. |
| `ios/` | Native SwiftUI iPhone/iPad app | Development build 24; requires iOS/iPadOS 27 and a matching Xcode toolchain. |
| `android/` | Android Trusted Web Activity | Uses the web app through Android Browser Helper. |
| `tests/`, `migrations/`, `vendor/` | Tests, database migrations and licensed supporting resources | Test fixtures use synthetic data. |

MacBook companion development has resumed using the shared Electron interface. Local Apple Silicon previews are ad-hoc signed, not notarized distribution builds. Windows-only Microsoft PowerPoint automation remains unavailable on Mac. Existing downloadable builds and update URLs remain in [stati-releases](https://github.com/markusciani/stati-releases/releases); publishing this source does not replace them or create a new signed release.

## Website and backend development

Use Node.js 24 and npm 11 with the committed `package-lock.json`:

```sh
npm ci --ignore-scripts
npm run db:local
npm run dev
```

The local app opens at `http://localhost:8787`. Copy `.dev.vars.example` to `.dev.vars` and supply a local enrollment secret before testing enrollment. Provision your own administrator/account for authenticated flows; local development does not copy production users or files. Inspect the account setup tools in `scripts/` before using them.

`wrangler.jsonc` contains a placeholder D1 database ID. Before deploying your own instance, create your own D1 database and R2 bucket, configure your own domain, passkey relying-party ID, resource bindings and secrets, then apply migrations to that instance. The checked-in Hapi domain values document the official client's defaults. Do not run publishing or administrator scripts against someone else's deployment. See [docs/development.md](docs/development.md).

## Windows companion

Build the UI with `npm run build:desktop-ui`. The Electron executable needs its reviewed installation step after the script-disabled dependency install:

```sh
node node_modules/electron/install.js
npm run desktop
```

The companion normally connects to the official service. To use your local backend:

```sh
STATI_DEV_ORIGIN=http://localhost:8787 npm run desktop
```

`npm run desktop:pack` prepares an unpacked Windows preview. Packaging on macOS is not proof of Windows runtime behavior, PowerPoint automation, ProPresenter compatibility, or production signing. Production release scripts require the appropriate signing identity and publisher credentials. Existing published artifacts must remain immutable.

## iPhone and iPad

Open `ios/Stati.xcodeproj`, select the Stati scheme, and choose your own signing team and bundle identifier for a device build. The checked-in team identifier is a public build setting, not a signing credential. For regenerated projects, change that setting in `ios/scripts/generate-project.py` as well.

```sh
swift test --package-path ios
xcodebuild -project ios/Stati.xcodeproj -scheme Stati \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

The native source matches build 24. Experimental nearby following, Share extensions and Live Activities are not represented as shipped features. The app uses the existing passkey authorization flow; credentials remain in device Keychain storage. This is development distribution, not an App Store/TestFlight release.

## Android

See [android/README.md](android/README.md). A JDK compatible with Gradle 9.3 and Android SDK 36 are required.

```sh
npm run android:apk:test
```

Release signing requires your own private keystore and environment configuration. Never commit the keystore or its passwords. A fork needs its own package identity, origin association and public certificate fingerprint.

## Verification

```sh
npm run typecheck
npm test
npm run test:desktop
npm run build:web
npm run build:desktop-ui
swift test --package-path ios
```

These checks do not replace physical device acceptance, a production signing check, or a complete security audit. Known Windows playlist/service failures are being investigated; source publication is not a claim that every reported bug has been fixed.

Contributions are welcome through issues and pull requests. Include reproduction steps and relevant tests. Report security concerns privately using [SECURITY.md](SECURITY.md).
