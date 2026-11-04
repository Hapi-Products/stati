## Changes

- Profile pictures recover after a temporary failed load on “Who are you?”, the connected profile and file cards. Successful thumbnails are shared briefly; failed requests remain retryable and pictures refresh without rebuilding unchanged cards.
- Supports accepted WebP profile photos using Chromium's decoder when Electron's native image API cannot open them. Decoding stays bounded, produces a small PNG thumbnail and releases the bitmap/canvas after use or a user change. JPEG and PNG retain their native thumbnail path.
- Checks actual image headers and dimensions before profile-photo storage or decoding. Streamed reads stay within 1 MiB; images are limited to 25 million pixels and 16,384 pixels per side. A linear JPEG header reader avoids repeatedly copying malformed input.
- Limits simultaneous photo work, waiting jobs and cached bytes. Switching users, removing/replacing a computer, locking or closing Stați cancels old work and clears its pictures. Removing/replacing a computer also clears the previous operator proof and visible workspace state.
- Prevents an ordinary file thumbnail queued immediately before a user change from starting under the new identity.

## Verification and limitations

Checks use isolated local accounts and storage, synthetic image fixtures, the real renderer, and actual Mac Electron JPEG/PNG decoding. Real browser verification covers WebP decoding and recovered pictures. No production test account, profile upload, or transfer is created. Header validation bounds dimensions; it does not claim to decode every compressed frame or scan files for malware.

Windows remains an unsigned preview. Physical Windows/phone acceptance, startup blur, clock-edge behavior and ProPresenter 7.11 rendering remain pending. No AI service or paid dependency is added. Android is unchanged.
