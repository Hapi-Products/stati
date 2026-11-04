import SwiftUI

@MainActor @Observable final class SongCommentsModel {
    private(set) var items: [APIRecord] = []
    private(set) var service: APIRecord?
    private(set) var loading = false
    private(set) var message = ""
    var song: APIRecord?
    private let store: AppStore
    private var generation = UUID()
    init(store: AppStore) { self.store = store }
    func load() async {
        let epoch = store.accountEpoch, owner = store.me?.id, computer = store.selectedComputer, scope = UUID(); generation = scope
        guard owner != nil, !computer.isEmpty else { items = []; service = nil; return }
        loading = true; defer { if generation == scope { loading = false } }
        do {
            let value = try await store.api.request("/computers/" + computer + "/song-comments")
            try Task.checkCancellation(); guard generation == scope, epoch == store.accountEpoch, owner == store.me?.id, computer == store.selectedComputer else { return }
            items = value["items"].records; service = value["service"] == .null ? nil : APIRecord(raw: value["service"].fields); message = ""
        } catch is CancellationError { }
        catch { if generation == scope, epoch == store.accountEpoch { items = []; service = nil; message = error.localizedDescription } }
    }
    func open(_ id: String) async {
        let epoch = store.accountEpoch, owner = store.me?.id, computer = store.selectedComputer
        guard owner != nil, !computer.isEmpty, !id.isEmpty else { return }
        do {
            let value = try await store.api.request("/computers/" + computer + "/songs/" + id)
            try Task.checkCancellation(); guard epoch == store.accountEpoch, owner == store.me?.id, computer == store.selectedComputer else { return }
            guard value["id"].text == id else { throw APIError(status: 409, message: "The song could not be verified.") }
            song = APIRecord(raw: value.fields)
        } catch { if epoch == store.accountEpoch { message = error.localizedDescription } }
    }
}
