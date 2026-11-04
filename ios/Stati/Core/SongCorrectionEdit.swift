import Foundation

nonisolated struct SongCorrectionEdit: Codable, Sendable, Identifiable, Equatable {
    let id: String
    var location: Int
    var length: Int
    var quote: String
    var replacement: String
    var range: NSRange { NSRange(location: location, length: length) }
    var payload: JSONValue { .object(["id": .string(id), "location": .number(Double(location)), "length": .number(Double(length)), "quote": .string(quote), "replacement": .string(replacement)]) }
    func valid(in source: String, requireReplacementLimit: Bool = true) -> Bool {
        guard UUID(uuidString: id) != nil, location >= 0, length > 0, length <= 1000,
              location <= source.utf16.count, length <= source.utf16.count - location,
              let selected = Range(range, in: source), String(source[selected]) == quote,
              !requireReplacementLimit || replacement.utf16.count <= 1000 else { return false }
        return true
    }
}
