# QR-only administrator invitations — November 4, 2026

Administrator invitations on iPhone and desktop no longer display a separate six-digit number. They show the QR, expiry countdown and signup/approval instructions. The desktop QR now includes the existing joining grant in the official URL fragment, so it does not open an empty manual-entry page. Failed refreshes hide an expired QR.

This changes the invitation presentation, not server invitation entropy, lifetime, approval policy or the manual connection-code field in Add computer. New-computer pairing remains a separate confirmed `/pair/…` flow, accepted by the owner on native26.

Verified: 1,274 desktop tests, including the actual desktop IPC QR URL; native27 signed and simulator builds; light and accessibility-large dark QR-only invite captures. Native27 installed, version read back and launched on the owner's iPhone. The local Mac preview is ad-hoc signed, not notarized. Its updated QR-only window still needs verification after the owner completes the macOS Keychain prompt. No Windows41 installer or server deployment was made in this batch. Physical signup by a new member remains a separate acceptance check.
