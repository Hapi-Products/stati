import SwiftUI

@MainActor @Observable final class WorshipGroupsModel {
    private(set) var groups: [APIRecord] = []
    private(set) var canCreate = false
    private(set) var loaded = false
    private(set) var loading = false
    private(set) var message = ""
    private(set) var revision = 0
    @ObservationIgnored private let store: AppStore
    private let ownerID: String
    private let epoch: UUID
    private var generation = UUID()
    private let fetch: @MainActor (String, String, JSONValue?) async throws -> JSONValue
    init(store: AppStore, request: (@MainActor (String, String, JSONValue?) async throws -> JSONValue)? = nil) {
        self.store = store; ownerID = store.me?.id ?? ""; epoch = store.accountEpoch
        fetch = request ?? { path, method, body in try await store.api.request(path, method: method, body: body) }
    }
    var active: Bool { !ownerID.isEmpty && store.me?.id == ownerID && store.accountEpoch == epoch && store.api.signedIn }
    func reset() { generation = UUID(); groups = []; canCreate = false; loaded = false; loading = false; message = ""; revision += 1 }
    func load() async {
        guard active else { reset(); return }
        let scope = UUID(); generation = scope; loading = true; message = ""
        defer { if generation == scope { loading = false } }
        do {
            var rows: [APIRecord] = [], cursor = "", seen: Set<String> = [], ids: Set<String> = [], create = false
            repeat {
                let result = try await fetch("/worship-groups" + (cursor.isEmpty ? "" : "?before=" + cursor.queryEncoded), "GET", nil)
                try Task.checkCancellation(); guard active else { reset(); return }; guard generation == scope else { return }
                guard case .array = result["groups"], result["canCreate"] == .bool(true) || result["canCreate"] == .bool(false) else { throw invalid() }
                let page = try result["groups"].records.map(Self.validated)
                guard page.allSatisfy({ ids.insert($0.id).inserted }) else { throw invalid() }
                rows += page; create = result["canCreate"].flag
                guard result["nextCursor"] == .null || { if case .string = result["nextCursor"] { return true }; return false }() else { throw invalid() }
                cursor = result["nextCursor"].text
                if !cursor.isEmpty && (page.isEmpty || !seen.insert(cursor).inserted || rows.count > 10_000) { throw invalid() }
            } while !cursor.isEmpty
            let sorted = rows.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending || $0.name == $1.name && $0.id < $1.id }
            if sorted != groups { store.resources.clear(); revision += 1 }
            groups = sorted; canCreate = create; loaded = true
        } catch is CancellationError { }
        catch {
            guard active else { reset(); return }; guard generation == scope else { return }
            // An incomplete access list must never validate a default or retain private metadata.
            groups = []; canCreate = false; loaded = false; message = error.localizedDescription; store.resources.clear(); revision += 1
        }
    }
    func detail(_ id: String) async throws -> JSONValue {
        guard active, UUID(uuidString: id) != nil else { throw CancellationError() }
        do {
            let value = try await fetch("/worship-groups/" + id, "GET", nil)
            guard active else { reset(); throw CancellationError() }
            let group = try Self.validated(APIRecord(raw: value["group"].fields))
            guard group.id == id, case .array = value["group"]["members"] else { throw invalid() }
            return value["group"]
        } catch let error as APIError where [401, 403, 404].contains(error.status) {
            groups.removeAll { $0.id == id }; store.resources.clear(); revision += 1
            throw error
        }
    }
    func candidates() async throws -> [APIRecord] {
        var rows: [APIRecord] = [], cursor = "", seen: Set<String> = [], ids: Set<String> = []
        repeat {
            guard active else { throw CancellationError() }
            let value = try await fetch("/worship-groups/candidates" + (cursor.isEmpty ? "" : "?before=" + cursor.queryEncoded), "GET", nil)
            try Task.checkCancellation(); guard active else { throw CancellationError() }
            guard case .array = value["members"] else { throw invalid() }
            let page = value["members"].records
            guard page.allSatisfy({ UUID(uuidString: $0.id) != nil && !$0.name.isEmpty && ids.insert($0.id).inserted }) else { throw invalid() }
            rows += page; cursor = value["nextCursor"].text
            if !cursor.isEmpty && (page.isEmpty || !seen.insert(cursor).inserted || rows.count > 10_000) { throw invalid() }
        } while !cursor.isEmpty
        return rows.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    func save(_ intent: GroupMutation) async throws -> JSONValue {
        guard active, intent.ownerID == ownerID else { throw CancellationError() }
        let value = try await fetch("/worship-groups" + (intent.revision == nil ? "" : "/" + intent.id), intent.revision == nil ? "POST" : "PATCH", intent.body)
        guard active else { reset(); throw CancellationError() }
        let group = try Self.validated(APIRecord(raw: value["group"].fields))
        guard value["ok"].flag, group.id == intent.id, group["ownerId"].text == intent.groupOwnerID else { throw invalid() }
        generation = UUID(); loading = false
        groups.removeAll { $0.id == group.id }; groups.append(group); groups.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        store.resources.clear(); revision += 1
        return value["group"]
    }
    func remove(_ group: APIRecord) async throws {
        guard active, group["canManage"].flag, UUID(uuidString: group.id) != nil else { throw CancellationError() }
        let value = try await fetch("/worship-groups/" + group.id, "DELETE", .object(["revision": group["revision"]]))
        guard active else { reset(); throw CancellationError() }
        guard value["ok"].flag else { throw invalid() }
        generation = UUID()
        loading = false
        groups.removeAll { $0.id == group.id }
        store.resources.clear()
        revision += 1
        store.filesChanged()
    }

    private static func validated(_ group: APIRecord) throws -> APIRecord {
        guard UUID(uuidString: group.id) != nil, UUID(uuidString: group["ownerId"].text) != nil, !group.name.isEmpty, group.name.utf16.count <= 80,
              let revision = Int(exactly: group["revision"].number), revision >= 1,
              let members = Int(exactly: group["memberCount"].number), members >= 0 else {
            throw APIError(status: 503, message: "The group list could not be verified. Refresh before choosing a group.")
        }
        return group
    }
    private func invalid() -> APIError { APIError(status: 503, message: "The complete group list could not be verified. Refresh before choosing a group.") }
}
