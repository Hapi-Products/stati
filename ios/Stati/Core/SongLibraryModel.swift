import SwiftUI

@MainActor @Observable final class SongLibraryModel {
    private(set) var items: [APIRecord] = []
    private(set) var groups: [String] = []
    private(set) var total = 0
    private var fetching = false
    var loading: Bool { fetching && items.isEmpty }
    private var loadMessage = ""
    private var computer = ""
    private(set) var message: String {
        get { loadMessage.isEmpty ? store.offlineSongs.issue(computer: computer) : loadMessage }
        set { loadMessage = newValue }
    }
    @ObservationIgnored private let store: AppStore
    private var generation = UUID()
    private var context = ""
    private let fetch: @MainActor (String) async throws -> JSONValue
    init(store: AppStore, request: (@MainActor (String) async throws -> JSONValue)? = nil) {
        self.store = store; fetch = request ?? { try await store.api.request($0) }
    }
    private func filtered(_ rows: [APIRecord], group: String, query: String) -> [APIRecord] {
        let words = query.folding(options: [.diacriticInsensitive,.caseInsensitive], locale: .current).split(whereSeparator: \.isWhitespace).map(String.init)
        return rows.filter { row in
            let name = row["groupName"].text
            let matchesGroup = group.isEmpty || (group == "__generic__" ? name.isEmpty : name == group)
            let text = (row.title + " " + row["text"].text).folding(options: [.diacriticInsensitive,.caseInsensitive], locale: .current)
            return matchesGroup && words.allSatisfy { text.contains($0) }
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    func load(computerID: String, group: String, query: String) async {
        let stamp = UUID(), epoch = store.accountEpoch, owner = store.me?.id
        generation = stamp; computer = computerID
        let key = epoch.uuidString + "|" + computerID + "|" + group + "|" + query
        if context != key { items = []; total = 0; groups = []; context = key }
        guard owner != nil, !computerID.isEmpty, computerID == store.selectedComputer else { return }
        fetching = true; message = ""
        defer { if generation == stamp { fetching = false } }
        let cached = (try? store.offlineSongs.rows(computer: computerID)) ?? []
        if !cached.isEmpty {
            items = filtered(cached, group: group, query: query); total = items.count
            groups = Array(Set(cached.map { $0["groupName"].text }.filter { !$0.isEmpty })).sorted()
        }
        var offset = 0, expected = 0, received: [APIRecord] = [], seen: Set<String> = []
        var snapshot: JSONValue?
        var latestGroups: [String] = []
        do {
            repeat {
                let result = try await fetch("/computers/" + computerID + "/songs?includeText=1&limit=250&groupName=" + group.queryEncoded + "&query=" + query.queryEncoded + "&offset=\(offset)")
                try Task.checkCancellation()
                guard generation == stamp, store.accountEpoch == epoch, owner == store.me?.id, store.selectedComputer == computerID else { return }
                if let snapshot, snapshot != result["updatedAt"] { throw APIError(status: 409, message: "The library changed while loading. Try again to load its current songs.") }
                snapshot = result["updatedAt"]
                let page = result["items"].records, unique = page.filter { seen.insert($0.id).inserted }
                expected = Int(result["total"].number); latestGroups = result["groups"].items.map(\.text)
                if unique.isEmpty && received.count < expected { throw APIError(status: 409, message: "Only \(received.count) of \(expected) songs loaded. Try again to finish loading the library.") }
                received += unique; offset += page.count
                if cached.isEmpty { items = received; total = expected; groups = latestGroups }
                if offset > 10000 && received.count < expected { throw APIError(status: 413, message: "This library exceeds the available page range. Search or open a group to narrow it.") }
            } while received.count < expected
            items = received; total = expected; groups = latestGroups
            if received.allSatisfy({ $0.raw["text"] != nil && $0.id.count == 64 }) {
                do { try await store.offlineSongs.save(received, computer: computerID, complete: group.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                catch { message = "Offline copies could not finish saving. " + error.localizedDescription }
            }
        } catch is CancellationError { }
        catch {
            guard !Task.isCancelled, generation == stamp, store.accountEpoch == epoch, owner == store.me?.id, store.selectedComputer == computerID else { return }
            if let failure = error as? APIError, [401,403,404].contains(failure.status) {
                items = []; groups = []; total = 0; store.offlineSongs.invalidate(computer: computerID); message = error.localizedDescription; return
            }
            if !received.isEmpty && received.allSatisfy({ $0.raw["text"] != nil && $0.id.count == 64 }) { try? await store.offlineSongs.save(received, computer: computerID) }
            if OfflineReadPolicy.permits(error), let rows = try? store.offlineSongs.rows(computer: computerID), !rows.isEmpty {
                items = filtered(rows, group: group, query: query); total = items.count
                groups = Array(Set(rows.map { $0["groupName"].text }.filter { !$0.isEmpty })).sorted()
                message = "Offline · \(items.count) saved songs."
            } else { message = error.localizedDescription }
        }
    }
}
