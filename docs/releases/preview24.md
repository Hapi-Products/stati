## Changes

- Simplifies Library cards to the song title, folder/category, added date, favorite, lyric preview and Edit lyrics. Extra filters stay collapsed.
- Saves library edits back to the same file, preserving its title, ProPresenter document identity, credits and added date. A hidden local recovery copy preserves earlier bytes. A changed file or switched operator stops replacement and keeps the draft. The previous visible revision-copy workflow is removed.
- Reads RTF formatting groups correctly, so font/color/list metadata does not become symbols before the lyrics. English/Romanian Unicode, escaped punctuation and common Windows text encodings are retained.
- Removes leading/trailing repeat notation such as /: and :/ from newly generated song titles. Lyrics keep their repeat marks.
- Adds Clear beside the lyric import buttons. It clears the lyrics, song selection and saved draft, so they remain cleared after reopening.
- Wraps overly long lyric lines between words, splits additional slides using the selected line limit, and shares layout between the preview and native export. Ordinary lines retain longest-line fitting, padded Arial bold text and the small italic Amen/Amin ending. Definite unreadable-text problems are reported before saving slides; plain lyrics can still be exported for recovery.
- Reads supported editable .pptx songs directly, without launching PowerPoint. Grouped or inherited/ambiguous formatting and older .ppt files retain the PowerPoint fallback. One conversion worker serves the batch; unchanged library files reuse their parsed text while changed/new files are checked again. Originals, resume markers and Stop after this file remain.
- Shows the startup window before waiting for the old operator's network reset. The full-screen identity prompt now works outside service, including earlier than the previous two-hour lead-in. During service and the two hours afterward it remains a small window. In-app and Off settings remain available.
- Adds a bounded local desktop thumbnail as a blurred identity backdrop, with a one-second capture deadline and Acrylic fallback. The thumbnail stays in memory, is never uploaded or written to disk, and is cleared on selection/dismissal. Late captures cannot cover an active service or a selected workspace.
- Uses a fixed transparent native clock frame without Windows resize borders/shadows or maximize/Snap behavior. Width and height remain adjustable in Settings. This addresses an unsupported transparent/resizable window combination; the exact edge flicker still needs a real Windows check.

## Testing status

Windows remains an unsigned preview. Local tests cover real native-file replacement/recovery, document identity, concurrent-edit refusal, Romanian text, layout parity, clear/reopen behavior, direct PPTX extraction/fallback, batch resume, reusable workers, cached-search invalidation, startup ordering and backdrop cancellation. Both UIs and typecheck pass. The isolated local UI verifies same-file save and the simplified Library; no production test account or upload is created.

A local 12-song supported-PPTX fixture plus resume took 0.30 seconds with zero PowerPoint launches. This is not a church-PC timing or proof that every PowerPoint can use the direct path. Real Windows11 startup/edge-flicker checks and representative old/new songs in ProPresenter7.11 remain pending. Existing duplicate revision files are preserved; this update does not guess which historical copies should be removed.

The Android preview is unchanged. Advanced conversion stays on the computer. No AI or paid conversion service is added.
