import SwiftUI

// Canonical task board shared by iPhone and iPad.
@MainActor @Observable final class IPadTasksModel {
    var tasks: [APIRecord] = []
    var total = 0
    var removed: APIRecord?
    var message = ""
    var loading = false
    var working: Set<String> = []
    @ObservationIgnored private let store: AppStore
    private let ownerID: String
    private let epoch: UUID
    private var generation = UUID()
    private let fetch: @MainActor (String, String, JSONValue?) async throws -> JSONValue
    func apply(_ row: APIRecord) {
        guard active, !row.id.isEmpty else { return }
        generation = UUID(); loading = false
        if row["deleted"].flag { if tasks.contains(where: { $0.id == row.id }) { tasks.removeAll { $0.id == row.id }; total = max(0, total - 1) }; store.taskCount = total; return }
        if let i = tasks.firstIndex(where: { $0.id == row.id }) { if row["revision"].number >= tasks[i]["revision"].number { tasks[i] = row } }
        else { tasks.insert(row, at: 0); total += 1 }
        store.taskCount = total
    }
    init(store: AppStore, request: (@MainActor (String, String, JSONValue?) async throws -> JSONValue)? = nil) {
        self.store = store; ownerID = store.me?.id ?? ""; epoch = store.accountEpoch
        fetch = request ?? { path, method, body in try await store.api.request(path, method: method, body: body) }
    }
    private func request(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> JSONValue { try await fetch(path, method, body) }
    private var active: Bool { !ownerID.isEmpty && store.me?.id == ownerID && store.accountEpoch == epoch && store.api.signedIn }
    func load(more: Bool = false) async {
        guard active, !more || !loading && tasks.count < total else { return }
        let scope = UUID(), revision = store.taskChangeRevision; generation = scope; loading = true
        defer { if generation == scope { loading = false } }
        do {
            let result = try await request("/tasks?offset=\(more ? tasks.count : 0)")
            try Task.checkCancellation(); guard active, generation == scope, revision == store.taskChangeRevision else { return }
            let page = result["items"].records
            tasks = more ? tasks + page.filter { item in !tasks.contains(where: { $0.id == item.id }) } : page
            total = Int(result["total"].number); store.taskCount = total; message = ""
        } catch is CancellationError { }
        catch { if active && scope == generation { message = error.localizedDescription } }
    }
    func move(id: String, status: String) async {
        guard active, let task = tasks.first(where: { $0.id == id }), task["canManage"].flag, !working.contains(id), ["new", "in-progress", "complete"].contains(status) else { return }
        working.insert(id); defer { working.remove(id) }
        do {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string("update"), "id": .string(id), "revision": task["revision"], "title": task["title"], "body": task["body"], "urgent": task["urgent"], "status": .string(status)]))
            guard active else { return }
            guard result["task"]["id"].text == id, result["task"]["status"].text == status else { throw APIError(status: 409, message: "The move was not confirmed. Refresh tasks before trying again.") }
            let saved = APIRecord(raw: result["task"].fields); apply(saved); store.taskChanged(saved)
        } catch { if active { message = error.localizedDescription } }
    }
    func delete(_ task: APIRecord) async {
        guard active, task["canDelete"].flag, !working.contains(task.id) else { return }
        working.insert(task.id); defer { working.remove(task.id) }
        do {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string("delete"), "id": .string(task.id), "revision": task["revision"]]))
            guard active else { return }
            guard result["deleted"].flag, result["id"].text == task.id else { throw APIError(status: 409, message: "The removal was not confirmed. Refresh tasks before trying again.") }
            removed = APIRecord(raw: result.fields); apply(removed!); store.taskChanged(removed!)
        } catch { if active { message = error.localizedDescription } }
    }
    func undo() async {
        guard active, let removed, !working.contains(removed.id) else { return }
        working.insert(removed.id); defer { working.remove(removed.id) }
        do {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string("restore"), "id": .string(removed.id), "revision": removed["revision"]]))
            guard active else { return }
            guard result["task"]["id"].text == removed.id else { throw APIError(status: 409, message: "Restoring this task was not confirmed. Refresh before trying again.") }
            self.removed = nil; let saved = APIRecord(raw: result["task"].fields); apply(saved); store.taskChanged(saved)
        } catch { if active { message = error.localizedDescription } }
    }
}
