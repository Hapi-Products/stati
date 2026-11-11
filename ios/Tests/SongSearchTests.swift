import Foundation
import Testing
@testable import StatiCore
@Suite struct SongSearchTests {
    private func song(_ id: String, _ title: String, _ first: String, _ group: String = "") -> APIRecord {
        APIRecord(raw: ["id": .string(id), "title": .string(title), "firstSlide": .string(first), "groupName": .string(group)])
    }
    @Test func titleAndFirstLineAlwaysPrecedeOtherLyricsAcrossGroups() {
        let rows = [song("lyrics", "A title", "Unrelated", "Choir"), song("first", "Z title", "Îți cânt sfânt", "Worship"), song("title", "Sfânt", "Unrelated", "Choir")]
        let sections = SongSearchGroup.sections(rows, query: "sfant")
        #expect(sections.flatMap(\.songs).map(\.id) == ["title", "first", "lyrics"])
        #expect(sections.map(\.name) == ["Choir", "Worship", "Choir"])
        #expect(sections.map(\.primaryMatch) == [true, true, false])
    }
    @Test func laterLinesDoNotCountAsFirstLineAndAllWordsMustMatch() {
        let rows = [song("later", "A", "One\nAmazing grace"), song("first", "Z", "Amazing grace, how sweet")]
        #expect(SongSearchGroup.sections(rows, query: "amazing grace").flatMap(\.songs).map(\.id) == ["first", "later"])
    }
    @Test func tiesHaveStableAlphabeticIdentityOrderAndEveryRowRemains() {
        let rows = [song("b", "Holy", "Holy"), song("a", "Holy", "Holy"), song("c", "Other", "Other")]
        let sections = SongSearchGroup.sections(rows, query: "holy")
        #expect(sections.flatMap(\.songs).map(\.id) == ["a", "b", "c"])
        #expect(Set(sections.map(\.id)).count == sections.count)
    }
    @Test func spokenSearchFindsAccentedTitlesAndKeepsDuplicateVersionsForSelection() {
        let exact = song("exact", "Sfânt, sfânt", "First verse")
        let longer = song("long", "Sfânt, sfânt e Domnul", "Other verse")
        #expect(SongSearchGroup.directMatch([longer, exact], query: "sfant sfant")?.id == "exact")
        #expect(SongSearchGroup.directMatch([exact, song("second", "Sfânt sfânt", "Other version")], query: "sfant sfant") == nil)
        #expect(SongSearchGroup.directMatch([exact], query: "first verse")?.id == "exact")
    }
}
