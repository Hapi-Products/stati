import Testing
import Foundation
@testable import StatiCore

@Suite struct SongPagesTests {
    @Test func preservesAllLyricLinesAndNeverAddsAnEnding() {
        let text = "First line\r\nSecond line\r\n\r\nThird line\r\nFourth line"
        let pages = SongPages(text: text)
        #expect(pages.source == text)
        #expect(pages.pages == ["First line\nSecond line", "Third line\nFourth line"])
        #expect(!pages.pages.joined().contains("Amen"))
    }
    @Test func longStanzasSplitWithoutDroppingOrRepeatingLines() {
        let lines = (1...15).map { "Line \($0)" }
        let pages = SongPages(text: lines.joined(separator: "\n"))
        #expect(pages.pages.count == 3)
        #expect(pages.pages.flatMap { $0.components(separatedBy: "\n") } == lines)
    }
    @Test func pageControlsStayInsideOneSongAndStopAtTheEdges() throws {
        let song = SongPages(text: "One\n\nTwo")
        var position = try #require(song.position)
        let back = position.move(by: -1)
        let forward = position.move(by: 1)
        #expect(!back)
        #expect(forward)
        #expect(position.selectedID == "page-1")
        let pastEnd = position.move(by: 1)
        #expect(!pastEnd)
        #expect(position.ids == ["page-0", "page-1"])
    }
    @Test func emptyLyricsDoNotInventABlankSongPage() {
        let song = SongPages(text: "\n  \n")
        #expect(song.pages.isEmpty)
        #expect(song.position == nil)
    }
}

@Suite struct SlideEndingTests {
    @Test func slidesPlaceAmenOnTheFinalLyricPageWithoutChangingSource() {
        let original = "First verse\n\nLast verse"
        let song = SongPages(text: original)
        #expect(song.slides == ["First verse", "Last verse\nAmen"])
        #expect(song.source == original)
        #expect(song.pages == ["First verse", "Last verse"])
    }
    @Test func existingAmenOrAminEndingIsNotRepeated() {
        for ending in ["Amen", " AMEN. ", "Amin!", "amin"] {
            let song = SongPages(text: "Final verse\n" + ending)
            #expect(song.slides == song.pages)
        }
    }
    @Test func earlierAmenDoesNotPreventTheFinalEndingAndEmptySongsStayEmpty() {
        #expect(SongPages(text: "Amen\n\nFinal verse").slides == ["Amen", "Final verse\nAmen"])
        #expect(SongPages(text: " \n").slides.isEmpty)
    }
}

@Suite struct SameSlideEndingTests {
    @Test func separateSourceEndingStaysWithFinalLyrics() {
        let song = SongPages(text: "Final lyric\n\nAmen")
        #expect(song.slides == ["Final lyric\nAmen"])
        #expect(song.source == "Final lyric\n\nAmen")
        #expect(song.pages == ["Final lyric", "Amen"])
    }
    @Test func fullFinalSlideDoesNotPushEndingOrLyricsToAnotherPage() {
        let lines = (1...6).map { "Lyric \($0)" }
        let song = SongPages(text: lines.joined(separator: "\n"))
        #expect(song.slides.count == 1)
        #expect(song.slides[0] == lines.joined(separator: "\n") + "\nAmen")
    }
}

@Suite struct SourceSlideBoundariesTests {
    @Test func aLongSourceSlideRemainsTogetherAtAnyReadingPageLimit() {
        let verse = (1...14).map { "Line \($0)" }.joined(separator: "\n")
        let song = SongPages(text: verse + "\n\nFinal line\nAmin", linesPerSlide: 3)
        #expect(song.pages.count > 2)
        #expect(song.slides == [verse, "Final line\nAmin"])
    }
}
