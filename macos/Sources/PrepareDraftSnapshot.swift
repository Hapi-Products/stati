import Foundation

struct PrepareDraftSnapshot: Equatable, Sendable {
    let owner: String
    let epoch: Int
    let title: String
    let text: String
    let lines: Int
    var payload: JSONValue {
        .object(["text": .string(text), "title": .string(title), "source": .string(""), "url": .string(""), "songLang": .string("auto"), "language": .string("both"), "lines": .number(Double(lines)), "fontSizeInput": .string("96"), "amenFontSizeInput": .string("48"), "libraryId": .null, "libraryHash": .null])
    }
}
