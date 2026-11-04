## Changes

- Allows a song with a very long first lyric line to save normally. Only the internal validation title is bounded; the complete lyrics, intended generated name and existing Library song title stay intact.
- Wraps pasted lyrics containing nonbreaking, narrow or typographic spaces into readable lines. The original editor/draft text is preserved. Preview and ProPresenter export use the same padded Arial bold layout.
- Removes repeat notation from typed song names as well as the first lyric. A name such as “Our Father Everlasting (I Believe)” stays that name instead of becoming a nested duplicate. Existing Library saves retain their original title and document identity.
- Keeps bounded new titles from ending in half a Unicode character.
- Improves automatic Romanian recognition using diacritics and additional worship words. A phrase such as “Dumnezeu are putere” selects Amin; English and explicit language choices retain their behavior. The final ending remains small, regular-weight italic text at the bottom right.

## Testing status

Local checks cover long-line saving, Unicode title bounds, repeat-mark cleanup, duplicate-title prevention, English/Romanian ending choices, manual overrides, and preview/native layout parity. The isolated browser editor saves a 419-character first line and nonbreaking-space lyrics through the real native Library writer. Decoded files retain their title/UUID and all 60 lyric words, create no visible revision copy, and use black backgrounds with a single 32-point, nonbold italic Amin ending. No production account or test upload is created.

Windows remains an unsigned preview. Real Windows startup/clock-edge checks, phone-to-PC acceptance and ProPresenter 7.11 rendering remain pending. The website's separately deployed media sending support works with this preview; Android is unchanged. No AI service or paid conversion provider is added.
