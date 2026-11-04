import Foundation
import Testing
@testable import StatiCore

@Suite struct SongAlphabetTests {
    private func song(_ id: String, _ title: String) -> APIRecord { APIRecord(raw: ["id": .string(id), "title": .string(title)]) }
    @Test func groupsRomanianLettersUnderTheirBaseLetterAndKeepsEverySong() {
        let rows = [song("1", "Și astăzi"), song("2", "  Îți cânt"), song("3", "Amazing Grace"), song("4", "123"), song("5", ""), song("6", "Slavă")]
        let sections = SongAlphabet.sections(rows)
        #expect(sections.map(\.id) == ["A", "I", "S", "#"])
        #expect(Set(sections.flatMap(\.songs).map(\.id)) == Set(rows.map(\.id)))
        #expect(sections.first { $0.id == "S" }?.songs.count == 2)
    }
    @Test func equalTitlesHaveStableIdentityOrderAcrossPages() {
        let rows = [song("b", "Holy"), song("a", "Holy")]
        #expect(SongAlphabet.sections(rows).flatMap(\.songs).map(\.id) == ["a", "b"])
    }
}
