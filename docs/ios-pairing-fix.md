# Native scanner pairing fix — November 4, 2026

Native build26 recognizes new-computer `/pair/…` QR links on the exact official HTTPS origin. The earlier scanner recognized only invite codes and sending links, so it detected a new Mac QR without accepting it.

Pairing now presents a native Cancel/Pair computer alert before calling the existing authenticated, expiring, single-use device-claim API. The confirmation captures account identity and epoch; changing accounts cancels it. Existing six-digit connection codes and sending-link behavior remain. No server permission or pairing-token entropy was changed. Six-digit codes are for computers already set up; initial registration uses its pairing QR.

Verified:98 Foundation tests/33 suites, fresh signed device and simulator builds, signature verification, light/default and dark/accessibility-large alert captures. Build26 installed and its version read back on the owner's iPhone, then launched. Actual optical scanning and completed Mac pairing remain owner acceptance checks. The Mac Keychain prompt was completed by the owner; QR creation succeeded afterward.

The public source uses canonical native24 plus this scoped fix. Unfinished native25 nearby transport work remains separate. No iPad update was installed in this batch.
