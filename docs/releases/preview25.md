## Changes

- Adds video thumbnails and a Preview button for supported audio/video files in Received files. Playback starts only when the operator presses Play, with sound initially muted. Closing the preview releases its media; the file stays in the inbox.
- Adds saved PowerPoint/Word thumbnails, first-slide/paragraph text when a thumbnail is unavailable, and native ProPresenter lyric previews. PDFs show their first page; images retain their thumbnails. Saved document thumbnails are labeled because they reflect the document's last saved thumbnail.
- Shows an explicit fallback when a format or codec cannot be previewed. Save and Open remain available. Legacy .ppt, image-only ProPresenter presentations and unsupported codecs still need their usual application.
- Checks remote preview size and SHA-256 when available before exposing bytes. Stable local files can be previewed after editing, with a Local copy changed badge; this never creates a replacement delivery receipt.
- Limits simultaneous thumbnail work and document/image sizes, keeps parsing off the main process, and cancels preview work on operator changes, Reject and shutdown. Previewing never saves or acknowledges a transfer, and media previews never automatically play sound.
- Uses the corrected release publisher that captures GitHub's newly created release ID directly, avoiding the stale draft-list lookup encountered with earlier previews.

## Testing status

Local tests cover actual native preview authorization, checksum/size failures, interrupted reads, local file replacement, changed-copy detection, bounded Office extraction, Romanian native-file text, renderer playback cleanup and operator reset. Both interfaces and typecheck pass. An isolated local browser check verifies real H264 video decoding and manual muted playback, PDF/PowerPoint/image thumbnails, ProPresenter text, unsupported-media guidance, retained inbox cards and released Blob URLs. These checks create no production account or upload.

Windows remains an unsigned preview. Windows codec support, the real phone-to-PC workflow, startup/clock edge behavior and ProPresenter 7.11 checks remain pending on the church computer. Previewing is limited to files up to 50 MiB; unsupported content keeps its saved original. Android is unchanged. No AI service or paid conversion service is added.
