# Stați native development source

This tree contains canonical native build 26 source for iPhone and iPad. Use Xcode with the iOS/iPadOS 27 SDK. Open `Stati.xcodeproj`, select your own signing team for physical-device development, and preserve existing app data when installing updates.

Run `swift test --package-path ios` from the repository root for the Foundation core tests. The project can be regenerated with `python3 ios/scripts/generate-project.py`; update its signing-team setting when building a fork. No private key or provisioning profile is included.

See the [root README](../README.md) and [development notes](../docs/development.md) for build commands, backend configuration, review-only simulator fixtures and verification boundaries. Nearby reader following, Share extensions and Live Activities remain future work; they are not shipped by this snapshot.
