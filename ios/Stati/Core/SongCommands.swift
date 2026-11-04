import SwiftUI

@MainActor @Observable
final class SongCommands {
    private(set) var requests: [SongCommand] = []
    private(set) var needsRecovery = false
    private(set) var busy: Set<String> = []
    private(set) var errors: [String: String] = [:]
    private var ownerID = ""
    private var generation = 0
    private let fetch: @MainActor (String, String, JSONValue?) async throws -> JSONValue
    init(api: APIClient) { fetch = { path, method, body in try await api.request(path, method: method, body: body) } }
    #if DEBUG && targetEnvironment(simulator)
    init(localCheckRequest: @escaping @MainActor (String, String, JSONValue?) async throws -> JSONValue) { fetch = localCheckRequest }
    #endif
    func request(computerID: String, songID: String) -> SongCommand? { requests.first { $0.computerID == computerID && $0.songID == songID } }
    func load(ownerID: String) {
        guard ownerID != self.ownerID else { return }
        reset(); self.ownerID = ownerID; read()
    }
    func retryReading() { guard needsRecovery, busy.isEmpty else { return }; read() }
    private func read() {
        do { requests = try SongCommandStorage.load(ownerID: ownerID); needsRecovery = false }
        catch { needsRecovery = true }
    }
    func reset() { generation += 1; ownerID = ""; requests = []; errors = [:]; busy = []; needsRecovery = false }
    private func commit(_ updated: [SongCommand]) throws {
        guard !needsRecovery, !ownerID.isEmpty else { throw APIError(status: 0, message: "Read the saved song requests before starting another action. The existing file has been kept.") }
        try SongCommandStorage.save(updated, ownerID: ownerID); requests = updated
    }
    func start(computerID: String, song: APIRecord, kind: SongCommand.Kind, groupName: String = "") async {
        let key = computerID + "/" + song.id
        guard !busy.contains(key) else { return }
        do {
            guard request(computerID: computerID, songID: song.id) == nil else { throw APIError(status: 409, message: "Check the previous song request before starting another action.") }
            let command = SongCommand(id: UUID().uuidString.lowercased(), ownerID: ownerID, computerID: computerID, songID: song.id, contentHash: song["contentHash"].text, kind: kind, groupName: kind == .clone ? SongCommand.normalized(groupName) : nil, songTitle: song.title)
            try commit(requests + [command])
            await check(command.id, resendIfAbsent: true)
        } catch { errors[key] = error.localizedDescription }
    }
    func dismiss(_ id: String) {
        guard let current = requests.first(where: { $0.id == id }), current.isTerminal, !busy.contains(current.key) else { return }
        do { try commit(requests.filter { $0.id != id }); errors.removeValue(forKey: current.key) }
        catch { errors[current.key] = error.localizedDescription }
    }
    func check(_ id: String, resendIfAbsent: Bool = false) async {
        guard let current = requests.first(where: { $0.id == id }), !current.isTerminal, !needsRecovery, !busy.contains(current.key) else { return }
        let scope = generation
        busy.insert(current.key); errors.removeValue(forKey: current.key)
        defer { if generation == scope { busy.remove(current.key) } }
        do {
            let path = "/computers/" + current.computerID + "/song-commands"
            let response = try await fetch(path + "?id=" + current.id, "GET", nil)
            try ensureCurrent(current, scope: scope)
            guard case .array(let receipts) = response["commands"], receipts.count <= 1 else { throw APIError(status: 0, message: "The PC request status could not be confirmed. Your original request has been kept.") }
            if let receipt = receipts.first {
                guard let updated = current.accepting(receipt) else { throw APIError(status: 0, message: "The PC response did not match this song request. Your original request has been kept.") }
                try replace(updated)
            } else if resendIfAbsent && current.status == .unconfirmed {
                let response = try await fetch(path + "/" + current.songID, "POST", current.body)
                try ensureCurrent(current, scope: scope)
                guard let updated = current.accepting(response["command"], acknowledgement: true) else { throw APIError(status: 0, message: "The PC request could not be confirmed. Retry will check the same request.") }
                try replace(updated)
            } else if current.status == .pending {
                errors[current.key] = "This accepted request is not in the server response. Check the computer before starting another action."
            }
        } catch {
            if generation == scope { errors[current.key] = error.localizedDescription }
        }
    }
    private func ensureCurrent(_ request: SongCommand, scope: Int) throws {
        try Task.checkCancellation()
        guard generation == scope, ownerID == request.ownerID, requests.contains(where: { $0.sameRequest(as: request) }) else { throw CancellationError() }
    }
    private func replace(_ request: SongCommand) throws {
        guard let index = requests.firstIndex(where: { $0.sameRequest(as: request) }) else { throw CancellationError() }
        var updated = requests; updated[index] = request; try commit(updated)
    }
}
