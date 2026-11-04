import Foundation

nonisolated struct FileEditTarget: Codable, Equatable, Sendable {
    let kind: String
    let id: String
    var endpoint: String { "/file-edits/" + kind + "/" + id }
    init?(path: String) {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        if parts.count == 5, parts[0].isEmpty, parts[1] == "api", parts[2] == "group-materials", parts[4] == "file", UUID(uuidString: String(parts[3])) != nil { kind = "group"; id = String(parts[3]); return }
        if parts.count == 6, parts[0].isEmpty, parts[1] == "api", parts[2] == "tasks", UUID(uuidString: String(parts[3])) != nil, parts[4] == "images", UUID(uuidString: String(parts[5])) != nil { kind = "task"; id = String(parts[5]); return }
        return nil
    }
}
nonisolated struct FileEditIntent: Codable, Identifiable, Equatable, Sendable {
    enum State: String, Codable, Sendable { case editing, ready, unconfirmed, synced, keptOnDevice }
    let id: String
    let ownerID: String
    let sourcePath: String
    let target: FileEditTarget
    let baseSHA256: String
    var sha256: String
    var bytes: Int
    var filename: String
    var contentFile: String
    var state: State
    let createdAt: Date
    var needsSync: Bool { state == .ready || state == .unconfirmed }
    func accepts(_ receipt: JSONValue) -> Bool {
        receipt["ok"].flag && receipt["state"].text == "committed" && receipt["id"].text == id && receipt["targetKind"].text == target.kind && receipt["targetId"].text == target.id && receipt["baseSha256"].text == baseSHA256 && receipt["sha256"].text == sha256 && receipt["bytes"].number == Double(bytes) && receipt["filename"].text == filename
    }
}
