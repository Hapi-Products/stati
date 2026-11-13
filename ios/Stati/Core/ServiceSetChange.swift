import Foundation

nonisolated struct ServiceSetChange: Identifiable, Equatable {
    let id: String
    let title: String
    let added: Bool

    private struct Entry: Hashable {
        let itemID: String
        let songID: String
        let hash: String
        let title: String

        init(_ song: APIRecord) {
            itemID = song.id
            songID = song["songId"].text
            hash = song["contentHash"].text
            title = song.title
        }
    }

    static func compare(previous: [APIRecord], current: [APIRecord]) -> [Self] {
        let old = previous.map(Entry.init)
        let new = current.map(Entry.init)
        let difference = new.difference(from: old).inferringMoves()
        let moved = Set(difference.removals.compactMap { change -> String? in
            guard case .remove(_, let entry, .some) = change else { return nil }
            return entry.itemID
        })
        return difference.removals.compactMap { change in
            guard case .remove(let index, let entry, _) = change else { return nil }
            return Self(id: "remove-\(index)", title: moved.contains(entry.itemID) ? "\(entry.title) · position \(index + 1)" : entry.title, added: false)
        } + difference.insertions.compactMap { change in
            guard case .insert(let index, let entry, _) = change else { return nil }
            return Self(id: "add-\(index)", title: moved.contains(entry.itemID) ? "\(entry.title) · position \(index + 1)" : entry.title, added: true)
        }
    }
}
