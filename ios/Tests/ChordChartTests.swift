import Testing
@testable import StatiCore

struct ChordChartTests {
    @Test func transposesRootsAndBassAndPreservesQuality() {
        #expect(ChartChord("D/F♯")?.moved(2, flats: false) == "E/G♯")
        #expect(ChartChord("Em7")?.moved(2, flats: false) == "F♯m7")
        #expect(ChartChord("B♭maj7/D")?.moved(-2, flats: true) == "A♭maj7/C")
        #expect(ChartChord("Cadd9")?.moved(-1, flats: false) == "Badd9")
        #expect(ChartChord("Amazing") == nil)
    }

    @Test func parsesChartPositionsAndLeavesLyricsAlone() {
        let chart = ChartLine.parse("G     D/F#\nAmazing grace\nA")
        #expect(chart[0].chords.map(\.column) == [0, 6])
        #expect(chart[1].chords.isEmpty)
        #expect(chart[2].chords.isEmpty)
        #expect(ChartLine.parse("A", markedRows: [0])[0].chords.count == 1)
    }
}
