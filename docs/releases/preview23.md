## Changes

- Automatically retries queued administrator-sent files after temporary network or save failures, with capped backoff and fewer repeated failure alerts.
- Reuses the existing saved file after a receipt or delivery-confirmation failure, including recovery from a verified checkpoint after restart.
- Preserves damaged records and conflicting files for recovery instead of overwriting them or producing another saved copy.
- Verifies saved-file bytes again before confirming delivery, retaining checkpoints across a lost confirmation.
- Waits for delivery confirmation before allowing a saved file to be renamed.
- Stops automatic saves when receiving is paused, access is revoked, a transfer is rejected or the app exits. Save and Reject share the appropriate file guard.
- Keeps member files behind the existing explicit Save action and operator checks. Administrator background receiving still works with the profile locked.
- Handles redirected Downloads paths and uses exclusive verified copies when the volume does not support hard links.

The publisher now uses the verified faster local Windows workflow. The Android test build is unchanged and is not included in this Windows-only preview.

## Testing status

Windows remains an unsigned preview. Local filesystem and actual-main boundary tests cover retries, saved-file recovery, pause/reject/revocation and shutdown. Real Windows11 interrupted-network, restart, redirected-folder and phone-notification checks remain pending. A torn checkpoint or interrupted fallback copy may require manual recovery; existing files are preserved. Browser upload resumption is separate unfinished work.

Earlier preview22 changes and its signing/device verification limits still apply. Advanced conversion remains on the computer. No AI service is added.
