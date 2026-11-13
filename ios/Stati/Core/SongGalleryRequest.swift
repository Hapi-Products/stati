import Foundation

nonisolated struct SongGalleryRequest: Identifiable, Sendable {
    let id = UUID()
    let computerID: String
    let items: [SongGalleryItem]
    let position: ReaderPosition
    let isService: Bool
    let offline: Bool
    init?(computerID: String, items: [SongGalleryItem], selectedID: String, service: Bool = false, offline: Bool = false) {
        guard !computerID.isEmpty, let position = ReaderPosition(ids: items.map(\.id), selectedID: selectedID) else { return nil }
        self.computerID = computerID; self.position = position; self.isService = service; self.offline = offline
        let byID = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        self.items = position.ids.compactMap { byID[$0] }
    }
    init?(computerID: String, songs: [APIRecord], selectedID: String, service: Bool = false, offline: Bool = false) {
        self.init(computerID: computerID, items: songs.map { SongGalleryItem(id: $0.id, songID: service ? $0["songId"].text : $0.id, title: $0.title, contentHash: $0["contentHash"].text) }.filter { !$0.songID.isEmpty }, selectedID: selectedID, service: service, offline: offline)
    }
}
