import SwiftUI
import Observation

@MainActor @Observable final class TeamWorkspaceModel {
    let engine: EngineClient
    let destination: Destination
    private var active = true
    private var generation = 0
    var rows: [JSONValue] = []
    var selected: String?
    var detail: JSONValue = .null
    var materials: [JSONValue] = []
    var asset: JSONValue = .null
    var error = ""
    var notice = ""
    var busy = false
    var query = ""
    var note = ""
    var noteId = UUID().uuidString
    var materialsCursor: String?
    var title = ""
    var body = ""
    var urgent = false
    var createId = UUID().uuidString
    var showCreate = false
    var offset = 0
    var total = 0
    var groupCursor: String?
    var hasMoreGroups = false
    init(engine: EngineClient, destination: Destination) { self.engine = engine; self.destination = destination }
    func close() { active = false; generation += 1; rows = []; detail = .null; materials = []; asset = .null; note = ""; title = ""; body = "" }
    func request(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> JSONValue {
        let epoch = generation
        guard active else { throw CancellationError() }
        var input: [String: JSONValue] = ["path": .string(path), "method": .string(method)]
        if let body { input["body"] = body }
        let result = try await engine.call("team-request", args: [.object(input)])
        guard active, epoch == generation else { throw CancellationError() }
        return result
    }
    func perform(_ action: @MainActor () async throws -> Void) async {
        guard active, !busy else { return }; busy = true; error = ""
        defer { busy = false }
        do { try await action() } catch is CancellationError {} catch { if active { self.error = error.localizedDescription } }
    }
    func refresh() async {
        await perform {
            let response = try await request(destination == .tasks ? "/tasks?offset=\(offset)" : "/worship-groups")
            rows = response[destination == .tasks ? "items" : "groups"].array
            total = Int(response["total"].number)
            groupCursor = response["nextCursor"].string.isEmpty ? nil : response["nextCursor"].string
            hasMoreGroups = groupCursor != nil
        }
    }
    func nextGroups() async {
        guard let cursor = groupCursor, let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return }
        await perform {
            let response = try await request("/worship-groups?before=\(encoded)")
            let known = Set(rows.map(\.id)); rows += response["groups"].array.filter { !known.contains($0.id) }
            groupCursor = response["nextCursor"].string.isEmpty ? nil : response["nextCursor"].string; hasMoreGroups = groupCursor != nil
        }
    }
    func select() async {
        guard let id = selected else { return }
        generation += 1; detail = .null; materials = []; asset = .null; note = ""
        // Allow replacement of an in-flight selection without publishing its result.
        busy = false
        await perform {
            let result = try await request(destination == .tasks ? "/tasks/\(id)" : "/worship-groups/\(id)")
            guard selected == id else { return }
            detail = destination == .tasks ? result : result["group"]
            if destination == .groups {
                let files = try await request("/group-materials?groupId=\(id)")
                guard selected == id else { return }; materials = files["materials"].array
                materialsCursor = files["nextCursor"].string.isEmpty ? nil : files["nextCursor"].string
            }
        }
    }
    func updateStatus(_ status: String) async {
        let task = detail["task"]
        await perform {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string("update"), "id": .string(task.id), "revision": task["revision"], "title": task["title"], "body": task["body"], "urgent": task["urgent"], "status": .string(status)]))
            detail = result; notice = "Task status saved."
        }
        if error.isEmpty { await refresh() }
    }
    func addNote() async {
        let task = detail["task"], text = note, noteId = self.noteId
        await perform {
            detail = try await request("/tasks", method: "POST", body: .object(["action": .string("note"), "id": .string(task.id), "revision": task["revision"], "noteId": .string(noteId), "body": .string(text)]))
            note = ""; self.noteId = UUID().uuidString; notice = "Note added."
        }
    }
    func createTask() async {
        await perform {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string("create"), "id": .string(createId), "title": .string(title), "body": .string(body), "urgent": .bool(urgent)]))
            detail = result; selected = result["task"].id; showCreate = false; title = ""; body = ""; urgent = false; createId = UUID().uuidString
        }
        if error.isEmpty { await refresh() }
    }
    func nextMaterials() async {
        guard let id = selected, let cursor = materialsCursor, let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return }
        await perform {
            let result = try await request("/group-materials?groupId=\(id)&before=\(encoded)")
            guard selected == id else { return }
            let known = Set(materials.map(\.id)); materials += result["materials"].array.filter { !known.contains($0.id) }
            materialsCursor = result["nextCursor"].string.isEmpty ? nil : result["nextCursor"].string
        }
    }
    func loadAsset(_ path: String) async {
        await perform {
            let epoch = generation
            let result = try await engine.call("team-read", args: [.string(path)])
            guard active, generation == epoch else { return }; asset = result
        }
    }
}
