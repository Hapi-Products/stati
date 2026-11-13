import Testing
@testable import StatiCore

@Suite struct ServiceSetChangeTests {
    private func item(_ id: String, hash: String = "a", reviewed: Bool = false) -> APIRecord {
        APIRecord(raw: ["id": .string(id), "songId": .string(id), "title": .string(id),
                        "contentHash": .string(hash), "reviewed": .bool(reviewed)])
    }

    @Test func showsAddedRemovedAndReplacedSongVersions() {
        let changes = ServiceSetChange.compare(
            previous: [item("Grace"), item("Holy"), item("Praise")],
            current: [item("Holy", hash: "b"), item("Praise", reviewed: true), item("Amen")]
        )
        #expect(changes.filter { !$0.added }.map(\.title).sorted() == ["Grace", "Holy"])
        #expect(changes.filter(\.added).map(\.title).sorted() == ["Amen", "Holy"])
    }

    @Test func marksReordersWithTheOldAndNewPositions() {
        let first = item("Grace")
        let second = item("Holy")
        let changes = ServiceSetChange.compare(previous: [first, second], current: [second, first])
        #expect(changes.count == 2)
        #expect(changes.first?.added == false)
        #expect(changes.last?.added == true)
        #expect(changes.allSatisfy { $0.title.contains("position") })
    }
}
