import Foundation

nonisolated struct SongCommand: Codable, Equatable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable { case clone, archive }
    enum Status: String, Codable, Sendable { case unconfirmed, pending, applied, failed }
    let id: String
    let ownerID: String
    let computerID: String
    let songID: String
    let contentHash: String
    let kind: Kind
    let groupName: String?
    var songTitle: String?
    var status: Status = .unconfirmed
    var message = ""

    var key: String { computerID + "/" + songID }
    var isTerminal: Bool { status == .applied || status == .failed }
    var title: String { kind == .clone ? "Group version · " + (groupName ?? "") : "Delete song" }
    var statusText: String {
        switch status {
        case .unconfirmed: "No confirmation yet. Retry checks the same request before sending it again."
        case .pending: "Waiting for an administrator in the updated PC app. You can leave this screen."
        case .applied: message.isEmpty ? "The computer finished this action." : message
        case .failed: message.isEmpty ? "The computer could not finish this action. Check it before starting another request." : message
        }
    }
    var body: JSONValue {
        var fields: [String: JSONValue] = ["id": .string(id), "action": .string(kind.rawValue), "contentHash": .string(contentHash)]
        if let groupName { fields["groupName"] = .string(groupName) }
        return .object(fields)
    }
    var isValid: Bool {
        let hexadecimal = Set("0123456789abcdef")
        func hash(_ value: String) -> Bool { value.count == 64 && value.allSatisfy { hexadecimal.contains($0) } }
        guard UUID(uuidString: id) != nil, UUID(uuidString: ownerID) != nil, UUID(uuidString: computerID) != nil, hash(songID), hash(contentHash), (songTitle?.utf16.count ?? 0) <= 300 else { return false }
        if kind == .archive { return groupName == nil }
        guard let groupName else { return false }
        return !groupName.isEmpty && groupName.utf16.count <= 80 && groupName == Self.normalized(groupName)
    }
    static func normalized(_ text: String) -> String { text.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines) }
    func sameRequest(as other: SongCommand) -> Bool {
        id == other.id && ownerID == other.ownerID && computerID == other.computerID && songID == other.songID && contentHash == other.contentHash && kind == other.kind && groupName == other.groupName
    }
    /// GET receipts carry the full request fingerprint. A sparse POST ack alone cannot finish an action.
    func accepting(_ receipt: JSONValue, acknowledgement: Bool = false) -> SongCommand? {
        guard receipt["id"].text == id, receipt["kind"].text == kind.rawValue,
              let status = Status(rawValue: receipt["status"].text), status != .unconfirmed else { return nil }
        let fullMatch = receipt["songId"].text == songID && receipt["contentHash"].text == contentHash && receipt["groupName"] == (groupName.map(JSONValue.string) ?? .null)
        guard fullMatch || (acknowledgement && status == .pending && receipt["songId"] == .null && receipt["contentHash"] == .null && receipt["groupName"] == .null) else { return nil }
        guard !isTerminal || self.status == status else { return nil }
        var updated = self; updated.status = status; updated.message = receipt["message"].text
        return updated
    }
}
