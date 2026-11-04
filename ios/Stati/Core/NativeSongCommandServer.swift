#if DEBUG && targetEnvironment(simulator)
import Foundation

/// Injected local responses for recovery checks; never opens a network connection.
@MainActor final class NativeSongCommandServer {
    let songID: String
    var receipts: [String: JSONValue] = [:]
    var posts: [JSONValue] = []
    var postFailure = "after"
    var getFailure = false
    var mismatch = false
    var onLookup: (() -> Void)?
    init(songID: String) { self.songID = songID }
    func fetch(_ path: String, method: String, body: JSONValue?) throws -> JSONValue {
        if method == "GET" {
            onLookup?()
            if getFailure { throw APIError(status: 0, message: "Injected lookup failure") }
            let id = URLComponents(string: "https://local.invalid" + path)?.queryItems?.first(where: { $0.name == "id" })?.value ?? ""
            guard var receipt = receipts[id] else { return .object(["commands": .array([])]) }
            if mismatch { var fields = receipt.fields; fields["contentHash"] = .string(String(repeating: "c", count: 64)); receipt = .object(fields) }
            return .object(["commands": .array([receipt])])
        }
        guard let body else { throw APIError(status: 0, message: "Missing local test body") }
        posts.append(body)
        if postFailure == "before" { throw APIError(status: 0, message: "Injected disconnect before acceptance") }
        let receipt: JSONValue = .object(["id": body["id"], "kind": body["action"], "songId": .string(songID), "contentHash": body["contentHash"], "groupName": body["groupName"], "status": .string("pending")])
        receipts[body["id"].text] = receipt
        if postFailure == "after" { throw APIError(status: 0, message: "Injected lost acknowledgement") }
        return .object(["command": receipt])
    }
}
#endif
