import Foundation
import Testing
@testable import StatiCore

@Test func hymnarySearchKeepsTheFirstFifteenUniqueResultsInOrder() throws {
    var rows = ["textAuthNumber,displayTitle,firstLine", "invalid id,Ignore me,Ignore me"]
    for index in 0..<18 {
        rows.append("hymn_\(index),\"Hymn \(index), revised\",First line")
        rows.append("hymn_\(index),Duplicate,Later line")
    }
    let hymns = try #require(HymnaryResults.search(rows.joined(separator: "\r\n")))
    #expect(hymns.map(\.id) == (0..<15).map { "hymn_\($0)" })
    #expect(hymns.first?.title == "Hymn 0, revised")
}

@Test func hymnaryPreviewsSkipRepeatedLyricsAndKeepTheFirstTwelvePermittedVersions() throws {
    func entry(_ number: String, text: String, permissions: String = "all") -> [String: String] {
        ["title": "Hymn", "hymnalID": "TEST", "number": number, "text": text, "displayPermissions": permissions]
    }
    var entries = [entry("restricted", text: "Restricted text", permissions: "none"), entry("empty", text: " \n ")]
    for index in 0..<15 {
        entries.append(entry(String(index), text: "Line \(index)\r\nLast line"))
        entries.append(entry("duplicate-\(index)", text: "Line \(index)\nLast line"))
    }
    let data = try JSONSerialization.data(withJSONObject: entries)
    let previews = try HymnaryResults.versions(data)
    #expect(previews.map(\.number) == (0..<12).map(String.init))
    #expect(previews.first?.lyrics == "Line 0\nLast line")
}
