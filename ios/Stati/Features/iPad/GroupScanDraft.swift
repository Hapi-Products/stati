import Foundation

nonisolated struct GroupScanDraft: Codable, Identifiable, Equatable {
    let id: String
    let ownerID: String
    let bytes: Int
    let sha256: String
    var title: String
    var groupName: String
    var groupID: String?
    var sharingUnconfirmed: Bool
    var filename: String { "Scan-" + String(id.prefix(8)) + ".pdf" }
}
