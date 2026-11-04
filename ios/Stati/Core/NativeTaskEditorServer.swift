#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor final class NativeTaskEditorServer {
    var task = NativeReview.task
    var notes: [JSONValue] = []
    var posts: [JSONValue] = []
    var loseReply = false
    var failLookup = false
    var wrongReceipt = false
    var beforeReply: (@MainActor () async -> Void)?
    var detail: JSONValue { .object(["task": task, "notes": .array(notes), "images": .array([])]) }
    func request(_ path: String, method: String, body: JSONValue?) async throws -> JSONValue {
        if method == "GET" {
            if failLookup { throw APIError(status: 503, message: "Injected lookup failure") }
            return detail
        }
        guard path == "/tasks", method == "POST", let body else { throw APIError(status: 0, message: "Unexpected model-check request") }
        posts.append(body)
        if body["action"].text == "note" {
            let id = body["noteId"].text
            if !notes.contains(where: { $0["id"].text == id }) {
                notes.append(.object(["id": .string(id), "body": body["body"], "authorName": .string("Sample M.")]))
                var fields = task.fields; fields["revision"] = .number(fields["revision"]!.number + 1); task = .object(fields)
            }
        }
        await beforeReply?()
        if loseReply { throw APIError(status: 503, message: "Injected lost acknowledgement") }
        if wrongReceipt { return .object(["task": task, "notes": .array([]), "images": .array([])]) }
        return detail
    }
}
#endif
