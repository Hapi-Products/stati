## Changes

- Simplified Prepare slides into Prepare, Library, and Services tabs, with optional tools and settings collapsed.
- Saved local lyric drafts, searchable song library, favorites, revised copies that preserve originals, and local service plans/setlists/checklists/templates.
- Inbox search, saved-file rename, original filenames, repeat copies, and sender identity retained on file cards.
- Website upload progress and cancellation, with favorite and recently used computers.
- SHA-256 transfer checks from upload through storage and desktop download; corrupted transfers are not acknowledged as delivered. Legacy transfers remain compatible.
- Windows startup/unlock profile prompt: full screen only in the two hours before service, a small window during/after service, and administrator settings for in-app or automatic prompts off. Selected users remain selected through service; lock/sleep and Switch User ask again.
- Clock dragging uses native window movement without a grabber or cursor-following code.
- Windows keeps the paired receiver running in the background when its window closes, with Open and Exit in the tray. It starts at Windows sign-in and retries its real connection after interruptions, including when automatic profile prompts are off.
- Valid file headers can arrive across multiple network chunks without causing a false file-type rejection.
- Clean builds automatically bundle and verify the English/Romanian OCR language packs and local OCR runtime.

Service timing: Sunday 10 AM and 6 PM; Tuesday and Thursday 7 PM, Phoenix time.

## Testing status

The website is deployed. Windows remains an unsigned preview for church-PC testing. Native Acrylic requires Windows 11 22H2+ and system transparency support. Reboot/unlock, tray/background receiving, actual clock dragging across different-DPI monitors, phone-to-PC transfers/alerts, and ProPresenter 7.11 rendering still need target-device checks.

The computer is online while the receiver has a working authenticated connection. Sleep, a lost internet connection, Exit, or ending the process can make it offline. Stați remains visible and stoppable in Windows Task Manager.

Local services and song-library preferences are local to the computer/profile; this release does not claim shared multi-church services, offline networking, or native iOS features. Advanced conversion remains on the computer. No cloud AI service is added.

The included Android test APK retains its existing separate debug identity. Production signing and independent recovery checks remain separate requirements.
