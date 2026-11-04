import SwiftUI

@MainActor @Observable final class IPadLibraryOverview {
    private(set) var songGroups: [String] = []
    private(set) var fileGroups: [String] = []
    private(set) var groupsLoaded = false
    private(set) var message = ""
    private(set) var services: [APIRecord] = []
    private var context = ""
    @ObservationIgnored private let store: AppStore
    @ObservationIgnored private var generation = UUID()
    private let fetch: @MainActor (String) async throws -> JSONValue
    init(store: AppStore, request: (@MainActor (String) async throws -> JSONValue)? = nil) { self.store = store; fetch = request ?? { try await store.api.request($0) } }
    func load() async {
        let scope = UUID(); generation = scope
        let owner = store.me?.id, epoch = store.accountEpoch, computer = store.selectedComputer, key = store.accountEpoch.uuidString + store.selectedComputer
        if context != key { reset(); context = key; generation = scope }
        message = ""; groupsLoaded = false
        guard owner != nil else { return }
        do {
            async let serviceLoad: Void = loadServices()
            var labels: Set<String> = [], cursor = "", seen: Set<String> = []
            repeat {
                let shared = try await fetch("/group-materials" + (cursor.isEmpty ? "" : "?before=" + cursor.queryEncoded))
                try Task.checkCancellation(); guard current(owner, epoch, computer, scope) else { return }
                let rows = shared["materials"].records
                for row in rows where row["groupId"].text.isEmpty && !row["groupName"].text.isEmpty { labels.insert(row["groupName"].text) }
                cursor = shared["nextCursor"].text
                if !cursor.isEmpty && (rows.isEmpty || !seen.insert(cursor).inserted || seen.count > 250) { throw APIError(status: 409, message: "The file groups could not finish loading. Try again.") }
            } while !cursor.isEmpty
            fileGroups = labels.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            if !computer.isEmpty && store.canReadSongs {
                let catalog = try await fetch("/computers/" + computer + "/songs?offset=0")
                try Task.checkCancellation(); guard current(owner, epoch, computer, scope) else { return }
                songGroups = Set(catalog["groups"].items.map(\.text).filter { !$0.isEmpty }).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            }
            groupsLoaded = true; await serviceLoad
        } catch is CancellationError { }
        catch { if current(owner, epoch, computer, scope) { message = error.localizedDescription } }
    }
    func reset() { generation = UUID(); songGroups = []; fileGroups = []; services = []; groupsLoaded = false; message = "" }
    func loadServices() async {
        let owner = store.me?.id, epoch = store.accountEpoch, computer = store.selectedComputer
        guard owner != nil, !computer.isEmpty, store.canReadSongs else { services = []; return }
        do {
            let result = try await fetch("/computers/" + computer + "/services")
            try Task.checkCancellation(); guard owner == store.me?.id, epoch == store.accountEpoch, computer == store.selectedComputer else { return }
            services = result["plans"].records.filter { !$0["archived"].flag }
        } catch is CancellationError { }
        catch { if owner == store.me?.id, epoch == store.accountEpoch, computer == store.selectedComputer { message = error.localizedDescription } }
    }
    var allGroups: [String] { Array(Set(songGroups + fileGroups)).sorted { $0.localizedStandardCompare($1) == .orderedAscending } }
    private func current(_ owner: String?, _ epoch: UUID, _ computer: String, _ scope: UUID) -> Bool { owner != nil && store.me?.id == owner && store.accountEpoch == epoch && store.selectedComputer == computer && generation == scope }
}
