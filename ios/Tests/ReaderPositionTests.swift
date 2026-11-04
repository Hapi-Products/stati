import Testing
@testable import StatiCore

struct ReaderPositionTests {
    @Test func preservesVisibleOrderAndStartsOnTappedSong() {
        let position = ReaderPosition(ids: ["b", "a", "b", "c"], selectedID: "a")
        #expect(position?.ids == ["b", "a", "c"])
        #expect(position?.index == 1)
        #expect(position?.selectedID == "a")
    }
    @Test func navigationStopsAtEdgesAndNeverSkipsOrWraps() {
        var position = ReaderPosition(ids: ["b", "a", "c"], selectedID: "b")!
        let beforeStart = position.move(by: -1)
        #expect(!beforeStart)
        let next = position.move(by: 1)
        #expect(next)
        #expect(position.selectedID == "a")
        let last = position.move(by: 1)
        #expect(last)
        #expect(position.selectedID == "c")
        let beyondEnd = position.move(by: 1)
        #expect(!beyondEnd)
        let invalidStep = position.move(by: 9)
        #expect(!invalidStep)
        #expect(position.index == 2)
    }
    @Test func invalidInitialSelectionIsRejected() {
        #expect(ReaderPosition(ids: [], selectedID: "a") == nil)
        #expect(ReaderPosition(ids: ["b"], selectedID: "a") == nil)
    }
}
