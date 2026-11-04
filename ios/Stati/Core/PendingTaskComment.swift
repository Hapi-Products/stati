import Foundation

/// Persist this identity and exact body before posting; lost replies retry it.
nonisolated struct PendingTaskComment: Equatable, Sendable {
    let id: String
    let body: String
    init?(id: String, body: String) {
        let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard UUID(uuidString: id) != nil, !body.isEmpty, body.utf16.count <= 2000 else { return nil }
        self.id = id; self.body = body
    }
    func isAcknowledged(_ detail: JSONValue, taskID: String) -> Bool {
        detail["task"]["id"].text == taskID && detail["notes"].records.contains { $0.id == id && $0["body"].text == body }
    }
    func composerAfterAcknowledgement(_ current: String) -> String {
        current.trimmingCharacters(in: .whitespacesAndNewlines) == body ? "" : current
    }
}
