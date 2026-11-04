# Media fixture sources

media-formats.json contains eleven synthetic 0.4-second FFmpeg patterns/tones and one truncated upstream OGV detection sample. Regenerate with scripts/generate-media-fixtures.mjs. Each record includes its exact byte length, SHA-256 and generation arguments or upstream blob identity. These files contain no user media or production account data.

The OGV record is the 256-byte detection fixture from [file-type 22.2.0](https://github.com/sindresorhus/file-type/blob/v22.2.0/fixture/fixture.ogv), Git blob 6c72c8fd749b79bd74509d0815034b0cc48f4875. Its MIT license is preserved in media-OGV-LICENSE.txt. It proves header recognition/transport only. It is not a playable-video sample or evidence of Theora codec support. The local FFmpeg installation has no Theora encoder.

The complete synthetic MP4 is additionally used by the real React sender/browser fixture. Windows codecs and the physical phone-to-PC flow require separate acceptance.
