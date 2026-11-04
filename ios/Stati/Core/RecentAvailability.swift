import Foundation

@MainActor enum RecentAvailability {
    static func reconcile(store: AppStore) async throws {
        let owner = store.me?.id, epoch = store.accountEpoch
        guard owner != nil, store.api.signedIn else { return }
        let snapshot = store.recents.items
        let items: [JSONValue] = snapshot.compactMap { recent in
            if recent.kind == .song {
                guard UUID(uuidString: recent.computerID) != nil, recent.itemID.count == 64 else { return nil }
                return .object(["id": .string(recent.id), "kind": .string("song"), "computerId": .string(recent.computerID), "songId": .string(recent.itemID)])
            }
            guard recent.previewItem != nil else { return nil }
            return .object(["id": .string(recent.id), "kind": .string("file"), "filePath": .string(recent.filePath)])
        }
        guard !items.isEmpty else { return }
        let requested = Set(items.map { $0["id"].text })
        let value = try await store.api.request("/recents/availability", method: "POST", body: .object(["items": .array(items)]))
        try Task.checkCancellation(); guard store.me?.id == owner, store.accountEpoch == epoch else { return }
        let checked = value["checkedIds"].items.map(\.text), available = value["availableIds"].items.map(\.text)
        guard case .array = value["checkedIds"], case .array = value["availableIds"], Set(checked) == requested, checked.count == requested.count, Set(available).isSubset(of: requested), Set(available).count == available.count else {
            throw APIError(status: 409, message: "Recents could not be checked. Existing history has been kept.")
        }
        let dates = Dictionary(uniqueKeysWithValues: snapshot.map { ($0.id, $0.openedAt) })
        let stillCurrent = Set(store.recents.items.filter { requested.contains($0.id) && dates[$0.id] == $0.openedAt }.map(\.id))
        store.recents.reconcile(checkedIDs: stillCurrent, availableIDs: Set(available).intersection(stillCurrent))
    }
}
