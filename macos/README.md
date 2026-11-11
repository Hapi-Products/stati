# Stați Native Preview

This is a genuine SwiftUI macOS 14+ frontend. The existing Electron services run as a bundled, private child-process helper. There is no WebView in the native frontend and no localhost listener.

Build on an Apple Silicon Mac with Xcode-beta:

```sh
node scripts/build-native-mac.mjs --engine-app /absolute/path/to/packaged-engine.app --output /absolute/path/to/new-immutable-directory
```

The supplied engine must include the `--stati-native-helper` host and compiled `desktop/native-support/slides.cjs`. The script refuses an existing output directory, copies the original engine without modifying it, compiles with Swift 6 and warnings as errors, signs the inner and outer apps ad hoc or with the supplied Apple Development identity, verifies both signatures and records hashes in `native-preview-verification.json`. It does not notarize or publish.

Native transport checks:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcrun swiftc -swift-version 6 -warnings-as-errors -target arm64-apple-macos14.0 -parse-as-library macos/Sources/JSONValue.swift macos/Sources/EngineClient.swift macos/Tests/EngineClientTests.swift -o /tmp/stati-native-transport-tests
/tmp/stati-native-transport-tests
```

The preview has bundle identifier `org.hapiproducts.stati.mac.native` and the helper uses separate protected application data. Fresh pairing is required; existing installed Stați credentials and published apps are preserved.

## Migrated surfaces

- Station: native table, search, receive/pause, queue delivery, file opening/reveal and optional native text/slide/image/PDF/media inspector.
- Authentication: pair the Mac once, then click your profile photo or initials in the grid. Administrators can enter their existing four-digit Stați account PIN or use their phone passkey. Cancel returns to the grid after closing a sign-in attempt.
- Library: actual shared-engine search, pagination, favorites, library rescan/sharing and original lyric text.
- Prepare: protected profile drafts, canonical shared slide splitter, native preview, lyrics/PowerPoint/ProPresenter exports and insertion through existing services.
- Services: shared plans and running orders, creation, leadership/finalization/acknowledgment, readiness, version summaries and passphrase-protected offline preparation.
- Desktop clocks: independent SwiftUI floating windows with local settings, display size, seconds, 24-hour time, background and text colors.
- Settings: computer rename, Downloads, notifications and diagnostics. Send to Developer previews a limited connection report and opens a draft in the public Stați issue tracker.
- Tasks: real paginated board, original descriptions/correction text, status updates, task creation, revision-safe discussion notes and native image previews.
- Groups: real private group list and roster, paginated shared materials and native image/PDF previews.

## Migration and verification boundaries

The UI identifies remaining advanced tools directly: library editing/history, running-order editing, packages/rehearsal, task editing/deletion/uploads, group creation/membership/uploads/song attachments and presentation synchronization remain in the existing desktop app. Native clocks do not migrate Electron overlays or automatic screen contrast. This is a functional incremental preview, not a claim of complete feature parity.

Workspace refresh runs every 20 seconds while the app is active. The phone approval sheet checks more frequently until you approve, cancel, or the code expires. The helper owns receiver/sync work. Workspace-reset events immediately clear private views and cached previews; scoped response checks reject old identity responses. Unsaved Prepare changes remain in memory for their original profile across a lock; protected drafts autosave while that profile is authorized. Explicit profile switches save dirty drafts first.

Local compilation and transport tests do not establish authenticated organization acceptance, physical church-PC/ProPresenter behavior, distribution signing, notarization or protected-state migration.
