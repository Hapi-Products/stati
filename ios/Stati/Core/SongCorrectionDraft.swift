import Foundation

nonisolated struct SongCorrectionDraft: Codable, Sendable {
    enum Phase: String, Codable, Sendable { case editing, unconfirmed, accepted, sent, rejected }
    let id: String
    let ownerID: String
    let computerID: String
    let song: APIRecord
    var message = ""
    var quote = ""
    var replacement = ""
    var images: [SongCorrectionImage] = []
    var edits: [SongCorrectionEdit] = []
    var confirmedImages: Set<String> = []
    var phase: Phase = .editing
    private(set) var frozen: JSONValue?
    init(ownerID: String, computerID: String, song: APIRecord) { id = UUID().uuidString.lowercased(); self.ownerID = ownerID; self.computerID = computerID; self.song = song }
    private enum CodingKeys: String, CodingKey { case id, ownerID, computerID, song, message, quote, replacement, images, edits, confirmedImages, phase, frozen }
    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id); ownerID = try values.decode(String.self, forKey: .ownerID)
        computerID = try values.decode(String.self, forKey: .computerID); song = try values.decode(APIRecord.self, forKey: .song)
        message = try values.decode(String.self, forKey: .message); quote = try values.decode(String.self, forKey: .quote)
        replacement = try values.decode(String.self, forKey: .replacement); images = try values.decode([SongCorrectionImage].self, forKey: .images)
        confirmedImages = try values.decode(Set<String>.self, forKey: .confirmedImages); phase = try values.decode(Phase.self, forKey: .phase)
        frozen = try values.decodeIfPresent(JSONValue.self, forKey: .frozen)
        edits = try values.decodeIfPresent([SongCorrectionEdit].self, forKey: .edits) ?? []
    }
    var payload: JSONValue {
        if let frozen { return frozen }
        var fields: [String: JSONValue] = ["id": .string(id), "songId": .string(song.id), "contentHash": song["contentHash"], "message": .string(message), "quote": .string(quote), "replacement": .string(replacement)]
        if !edits.isEmpty { fields["edits"] = .array(edits.map(\.payload)) }
        return .object(fields)
    }
    mutating func migrateEditableSelection() {
        guard phase == .editing, edits.isEmpty, !quote.isEmpty, let range = song["text"].text.range(of: quote) else { return }
        let selected = NSRange(range, in: song["text"].text)
        let edit = SongCorrectionEdit(id: UUID().uuidString.lowercased(), location: selected.location, length: selected.length, quote: quote, replacement: replacement)
        guard edit.valid(in: song["text"].text, requireReplacementLimit: false) else { return }
        edits = [edit]; quote = ""; replacement = ""
    }
    var exceedsReviewTextLimit: Bool {
        !edits.isEmpty && message.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count + edits.reduce(0) { $0 + $1.quote.utf16.count + $1.replacement.utf16.count } > 4000
    }
    mutating func freeze() throws {
        guard phase == .editing else { return }
        message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, message.count <= 2000, quote.count <= 1000, replacement.count <= 1000, replacement.isEmpty || !quote.isEmpty,
              quote.isEmpty || song["text"].text.contains(quote), images.count <= 6,
              !exceedsReviewTextLimit, edits.count <= 10, Set(edits.map(\.id)).count == edits.count,
              edits.allSatisfy({ $0.valid(in: song["text"].text) }), edits.isEmpty || quote.isEmpty && replacement.isEmpty else { throw CocoaError(.validationMissingMandatoryProperty) }
        frozen = payload; phase = .unconfirmed
    }
    func accepts(_ value: JSONValue) -> Bool {
        let row = value["correction"], sent = payload
        let passagesMatch = sent["edits"] == .null ? row["edits"].items.isEmpty : row["edits"] == sent["edits"]
        return passagesMatch && row["id"].text == id && row["computerId"].text == computerID && row["songId"].text == song.id && row["contentHash"] == sent["contentHash"] && row["message"] == sent["message"] && row["quote"] == sent["quote"] && row["replacement"] == sent["replacement"]
    }
}
nonisolated struct SongCorrectionImage: Codable, Sendable, Identifiable {
    let id: String
    let filename: String
    let bytes: Int
    let sha256: String
    func accepts(_ value: JSONValue) -> Bool { value["id"].text == id && (value["uploadFilename"] == .null ? value["filename"].text : value["uploadFilename"].text) == filename && (value["uploadBytes"] == .null ? value["bytes"].number : value["uploadBytes"].number) == Double(bytes) && (value["uploadSha256"] == .null ? value["sha256"].text : value["uploadSha256"].text) == sha256 }
}
